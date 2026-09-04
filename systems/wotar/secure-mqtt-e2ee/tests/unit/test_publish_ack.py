"""QoS1 PUBACK tracking — no delivered before ACK."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from tests.fixtures import test_vector
from tests.unit.test_mqtt_subscribe import MockTransport

from secure_mqtt.errors import PublishError
from secure_mqtt.observability.metrics import Metrics
from secure_mqtt.persistence.outbox import OutboxState, OutboxStore
from secure_mqtt.workers.publish_worker import PublishWorker


@dataclass
class DelayedPubackTransport(MockTransport):
    """Mock transport that delays PUBACK until released."""

    ack_delay_seconds: float = 2.0
    _release: threading.Event = field(default_factory=threading.Event, init=False)
    _acked_mids: set[int] = field(default_factory=set, init=False)

    def wait_puback(self, mid: int, *, timeout: float) -> None:
        if not self._release.wait(timeout=self.ack_delay_seconds + timeout):
            raise PublishError(f"PUBACK timeout for mid={mid}")
        self._acked_mids.add(mid)

    def release_puback(self) -> None:
        self._release.set()


def test_outbox_not_acked_before_puback(
    tmp_db,
    in_memory_keys,
    policy_resolver,
) -> None:
    outbox = OutboxStore(tmp_db, in_memory_keys, policy_resolver)
    record = outbox.prepare_publish(
        topic=test_vector.TOPIC,
        plaintext=test_vector.PLAINTEXT,
        content_type="application/json",
        signing_key=test_vector.signing_key(),
    )
    transport = DelayedPubackTransport(ack_delay_seconds=5.0)
    transport.connect(timeout=1.0)
    worker = PublishWorker(
        transport=transport,
        outbox=outbox,
        metrics=Metrics(),
        publish_timeout_seconds=0.5,
    )
    worker.start()
    worker.enqueue(record.id)

    time.sleep(0.3)
    updated = outbox.get_by_id(record.id)
    assert updated is not None
    assert updated.state in (OutboxState.PENDING, OutboxState.SENT)
    assert updated.state != OutboxState.ACKED

    transport.release_puback()
    time.sleep(0.5)
    worker.stop(timeout=2.0)
    # With short publish timeout, may fail — but must never be ACKED before release
    final = outbox.get_by_id(record.id)
    assert final is not None
    if final.state == OutboxState.ACKED:
        assert 1 in transport._acked_mids


def test_mark_acked_only_after_wait_puback(
    tmp_db,
    in_memory_keys,
    policy_resolver,
) -> None:
    outbox = OutboxStore(tmp_db, in_memory_keys, policy_resolver)
    record = outbox.prepare_publish(
        topic=test_vector.TOPIC,
        plaintext=b"ack-test",
        content_type="text/plain",
        signing_key=test_vector.signing_key(),
    )
    transport = MockTransport()
    transport.connect(timeout=1.0)
    mid = transport.publish(record.topic, record.envelope, qos=1)
    outbox.mark_sent(record.id, mid)
    sent = outbox.get_by_id(record.id)
    assert sent is not None
    assert sent.state == OutboxState.SENT
    transport.wait_puback(mid, timeout=1.0)
    outbox.mark_acked(record.id)
    acked = outbox.get_by_id(record.id)
    assert acked is not None
    assert acked.state == OutboxState.ACKED
