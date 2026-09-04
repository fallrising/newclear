"""Background worker for durable outbox publishing."""

from __future__ import annotations

import logging
import queue
import threading
from dataclasses import dataclass, field

from secure_mqtt.errors import PublishError
from secure_mqtt.mqtt.transport import Transport
from secure_mqtt.observability.metrics import Metrics
from secure_mqtt.persistence.outbox import OutboxRecord, OutboxStore

logger = logging.getLogger(__name__)


@dataclass
class PublishWorker:
    """Drain outbox rows and publish with QoS1 PUBACK tracking."""

    transport: Transport
    outbox: OutboxStore
    metrics: Metrics
    publish_timeout_seconds: float = 30.0
    poll_interval_seconds: float = 0.25
    max_queue_size: int = 256
    _queue: queue.Queue[int] = field(init=False)
    _thread: threading.Thread | None = field(default=None, init=False)
    _stop_event: threading.Event = field(default_factory=threading.Event, init=False)

    def __post_init__(self) -> None:
        self._queue = queue.Queue(maxsize=self.max_queue_size)

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="publish-worker", daemon=True)
        self._thread.start()

    def stop(self, *, timeout: float = 10.0) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    def enqueue(self, outbox_id: int) -> None:
        try:
            self._queue.put_nowait(outbox_id)
        except queue.Full as exc:
            self.metrics.inc("queue_full_total", result="publish")
            raise PublishError("Publish queue is full") from exc

    def flush_pending(self) -> None:
        for record in self.outbox.list_pending():
            self.enqueue(record.id)

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                outbox_id = self._queue.get(timeout=self.poll_interval_seconds)
            except queue.Empty:
                for record in self.outbox.list_pending(limit=16):
                    try:
                        self._queue.put_nowait(record.id)
                    except queue.Full:
                        break
                continue
            try:
                self._publish_one(outbox_id)
            except PublishError:
                logger.warning("Publish failed", extra={"outbox_id": outbox_id})
            finally:
                self._queue.task_done()

    def _publish_one(self, outbox_id: int) -> None:
        record = self.outbox.get_by_id(outbox_id)
        if record is None:
            return
        self._send_record(record)

    def _send_record(self, record: OutboxRecord) -> None:
        mid = self.transport.publish(record.topic, record.envelope, qos=1)
        self.outbox.mark_sent(record.id, mid)
        self.transport.wait_puback(mid, timeout=self.publish_timeout_seconds)
        self.outbox.mark_acked(record.id)
        self.metrics.inc("outbox_ack_total", result="success")
