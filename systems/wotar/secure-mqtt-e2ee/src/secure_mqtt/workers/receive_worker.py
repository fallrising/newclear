"""Background worker for secure receive pipeline."""

from __future__ import annotations

import json
import logging
import queue
import threading
from dataclasses import dataclass, field

from secure_mqtt.errors import (
    DecryptionError,
    EnvelopeFormatError,
    ExpiredMessageError,
    FutureMessageError,
    InvalidSignatureError,
    PayloadTooLargeError,
    QueueFullError,
    ReplayError,
    SchemaValidationError,
    SecureMqttError,
    UnknownKeyError,
    UnknownSenderError,
    UnsupportedProtocolError,
)
from secure_mqtt.keys.provider import KeyProvider
from secure_mqtt.keys.public_key_registry import SigningPublicKeyRegistry
from secure_mqtt.models import SecureMessage
from secure_mqtt.mqtt.subscriptions import SubscriptionRegistry
from secure_mqtt.mqtt.transport import IncomingMessage
from secure_mqtt.observability.metrics import Metrics
from secure_mqtt.persistence.database import utc_now
from secure_mqtt.persistence.inbox import InboxStore
from secure_mqtt.persistence.replay import ReplayGuard
from secure_mqtt.policy.topic_policy import TopicPolicyResolver
from secure_mqtt.protocol import codec, envelope
from secure_mqtt.protocol.constants import MAX_ENVELOPE_SIZE
from secure_mqtt.protocol.envelope import OpenedEnvelope

logger = logging.getLogger(__name__)


@dataclass
class ReceiveWorker:
    """Process incoming MQTT payloads off the network callback thread."""

    key_provider: KeyProvider
    registry: SigningPublicKeyRegistry
    policy_resolver: TopicPolicyResolver
    replay_guard: ReplayGuard
    inbox: InboxStore
    subscriptions: SubscriptionRegistry
    metrics: Metrics
    clock_skew_seconds: int = 60
    poll_interval_seconds: float = 0.25
    max_queue_size: int = 256
    _queue: queue.Queue[IncomingMessage] = field(init=False)
    _thread: threading.Thread | None = field(default=None, init=False)
    _stop_event: threading.Event = field(default_factory=threading.Event, init=False)

    def __post_init__(self) -> None:
        self._queue = queue.Queue(maxsize=self.max_queue_size)

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="receive-worker", daemon=True)
        self._thread.start()

    def stop(self, *, timeout: float = 10.0) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    def offer(self, message: IncomingMessage) -> None:
        """Enqueue message from MQTT callback; fail closed when full."""
        try:
            self._queue.put_nowait(message)
        except queue.Full as exc:
            self.metrics.inc("queue_full_total", result="receive")
            raise QueueFullError("Receive queue is full") from exc

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                incoming = self._queue.get(timeout=self.poll_interval_seconds)
            except queue.Empty:
                self._process_inbox_retries()
                continue
            try:
                self._handle_incoming(incoming)
            finally:
                self._queue.task_done()

    def _process_inbox_retries(self) -> None:
        for record in self.inbox.claim_pending(limit=16):
            if record.plaintext is None:
                self.inbox.schedule_retry(record.id, "missing plaintext")
                continue
            secure = SecureMessage(
                topic=record.topic,
                plaintext=record.plaintext,
                sender_id=record.sender_id,
                msg_id=record.msg_id,
                seq=0,
                schema_id=record.schema_id,
                content_type=record.content_type,
                received_at=utc_now(),
            )
            self._dispatch_handlers(secure, inbox_id=record.id)

    def _handle_incoming(self, incoming: IncomingMessage) -> None:
        if len(incoming.payload) > MAX_ENVELOPE_SIZE:
            self.metrics.inc("envelope_open_fail_total", reason="oversized")
            return
        try:
            opened = self._open_envelope(incoming.topic, incoming.payload)
            self.replay_guard.check_and_record(opened.protected.sender_id, opened.protected.msg_id)
            inbox_record = self.inbox.insert_received(
                topic=incoming.topic,
                sender_id=opened.protected.sender_id,
                msg_id=opened.protected.msg_id,
                envelope=incoming.payload,
                plaintext=opened.plaintext,
                schema_id=opened.protected.schema_id,
                content_type=opened.protected.content_type,
            )
            if inbox_record is None:
                self.metrics.inc("replay_duplicate_total", result="inbox")
                return
            self._validate_schema(opened.plaintext, opened.protected.content_type)
            secure = SecureMessage(
                topic=incoming.topic,
                plaintext=opened.plaintext,
                sender_id=opened.protected.sender_id,
                msg_id=opened.protected.msg_id,
                seq=opened.protected.seq,
                schema_id=opened.protected.schema_id,
                content_type=opened.protected.content_type,
                received_at=utc_now(),
            )
            self._dispatch_handlers(secure, inbox_id=inbox_record.id)
            self.metrics.inc("envelope_open_success_total", result="success")
        except ReplayError:
            self.metrics.inc("replay_duplicate_total", result="guard")
        except (
            EnvelopeFormatError,
            UnsupportedProtocolError,
            InvalidSignatureError,
            UnknownSenderError,
            ExpiredMessageError,
            FutureMessageError,
            UnknownKeyError,
            DecryptionError,
            PayloadTooLargeError,
        ) as exc:
            reason = exc.__class__.__name__
            self.metrics.inc("envelope_open_fail_total", reason=reason)
            logger.info("Envelope rejected", extra={"reason": reason, "topic": incoming.topic})
        except SchemaValidationError:
            self.metrics.inc("envelope_open_fail_total", reason="schema")
        except SecureMqttError as exc:
            self.metrics.inc("envelope_open_fail_total", reason=exc.__class__.__name__)

    def _open_envelope(self, topic: str, wire_bytes: bytes) -> OpenedEnvelope:
        envelope_map = codec.parse_envelope_map(wire_bytes)
        protected_dict = codec.extract_protected_header(envelope_map)
        record = self.registry.resolve_for_envelope(
            protected_dict["sender_id"],
            protected_dict["sig_kid"],
            issued_at_ms=protected_dict["iat_ms"],
        )
        policy = self.policy_resolver.resolve(topic)
        dek = self.key_provider.get_dek_for_decrypt(policy.topic_group, protected_dict["kid"])
        return envelope.open_envelope(
            topic=topic,
            wire_bytes=wire_bytes,
            dek=dek.as_bytes(),
            public_key=record.public_key,
            clock_skew_seconds=self.clock_skew_seconds,
            max_ttl_seconds=policy.max_ttl_seconds,
        )

    def _validate_schema(self, plaintext: bytes, content_type: str) -> None:
        if content_type == "application/json":
            try:
                json.loads(plaintext.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise SchemaValidationError("Invalid JSON payload") from exc

    def _dispatch_handlers(self, message: SecureMessage, *, inbox_id: int) -> None:
        handlers = self.subscriptions.handlers_for_topic(message.topic)
        if not handlers:
            self.inbox.mark_done(inbox_id)
            return
        for handler in handlers:
            try:
                handler(message)
            except Exception as exc:
                state = self.inbox.schedule_retry(inbox_id, exc.__class__.__name__)
                self.metrics.inc("inbox_handler_total", result="failure")
                if state.value == "retry":
                    self.metrics.inc("inbox_retry_total", result="scheduled")
                return
        self.inbox.mark_done(inbox_id)
        self.metrics.inc("inbox_handler_total", result="success")
