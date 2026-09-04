"""Receive worker isolation and handler failure tests."""

from __future__ import annotations

import threading
import time
from datetime import UTC, datetime

import pytest
from tests.fixtures import test_vector

from secure_mqtt.errors import UnknownSenderError
from secure_mqtt.keys.public_key_registry import SigningPublicKeyRecord, SigningPublicKeyRegistry
from secure_mqtt.models import SecureMessage
from secure_mqtt.mqtt.subscriptions import SubscriptionRegistry
from secure_mqtt.mqtt.transport import IncomingMessage
from secure_mqtt.observability.metrics import Metrics
from secure_mqtt.persistence.inbox import InboxStore
from secure_mqtt.persistence.replay import ReplayGuard
from secure_mqtt.protocol import envelope
from secure_mqtt.workers.receive_worker import ReceiveWorker


def _fresh_envelope(**kwargs) -> envelope.SealedEnvelope:
    import time

    now_ms = int(time.time() * 1000)
    defaults = dict(
        topic=test_vector.TOPIC,
        plaintext=test_vector.PLAINTEXT,
        dek=test_vector.DEK,
        signing_key=test_vector.signing_key(),
        kid="dek-v1-test",
        sender_id="device-001",
        sig_kid="sig-v1-test",
        seq=kwargs.pop("seq", 42),
        schema_id="sensor.temp.v1",
        content_type="application/json",
        iat_ms=now_ms,
        ttl_seconds=300,
    )
    defaults.update(kwargs)
    return envelope.seal(**defaults)


def _build_worker(tmp_db, in_memory_keys, registry, policy_resolver) -> ReceiveWorker:
    return ReceiveWorker(
        key_provider=in_memory_keys,
        registry=registry,
        policy_resolver=policy_resolver,
        replay_guard=ReplayGuard(tmp_db),
        inbox=InboxStore(tmp_db),
        subscriptions=SubscriptionRegistry(),
        metrics=Metrics(),
        poll_interval_seconds=0.05,
    )


def test_handler_runs_off_network_thread(
    tmp_db,
    in_memory_keys,
    registry,
    policy_resolver,
) -> None:
    worker = _build_worker(tmp_db, in_memory_keys, registry, policy_resolver)
    handler_threads: list[int] = []
    network_tid = threading.get_ident()
    sealed = _fresh_envelope()

    def handler(msg: SecureMessage) -> None:
        handler_threads.append(threading.get_ident())

    worker.subscriptions.register(test_vector.TOPIC, handler, qos=1)
    worker.start()
    try:
        worker.offer(IncomingMessage(topic=test_vector.TOPIC, payload=sealed.wire_bytes, qos=1))
        deadline = time.time() + 5.0
        while time.time() < deadline and not handler_threads:
            time.sleep(0.05)
        assert handler_threads
        assert handler_threads[0] != network_tid
    finally:
        worker.stop(timeout=3.0)


def test_handler_exception_does_not_block_offer(
    tmp_db,
    in_memory_keys,
    registry,
    policy_resolver,
) -> None:
    """Security matrix #38: handler failure must not block the receive worker loop."""
    worker = _build_worker(tmp_db, in_memory_keys, registry, policy_resolver)
    call_count = 0
    sealed = _fresh_envelope(seq=42)

    def failing_handler(_msg: SecureMessage) -> None:
        nonlocal call_count
        call_count += 1
        raise RuntimeError("handler boom")

    worker.subscriptions.register(test_vector.TOPIC, failing_handler, qos=1)
    worker.start()
    try:
        t0 = time.monotonic()
        worker.offer(IncomingMessage(topic=test_vector.TOPIC, payload=sealed.wire_bytes, qos=1))
        elapsed_offer = time.monotonic() - t0
        assert elapsed_offer < 1.0

        second = _fresh_envelope(seq=99, plaintext=b"second", content_type="text/plain")
        worker.offer(IncomingMessage(topic=test_vector.TOPIC, payload=second.wire_bytes, qos=1))
        # Worker should continue processing (first fails, loop alive)
        time.sleep(0.5)
        assert call_count >= 1
    finally:
        worker.stop(timeout=3.0)


def test_receive_rejects_envelope_issued_before_signing_key_validity(
    tmp_db,
    in_memory_keys,
    policy_resolver,
) -> None:
    issued_at_ms = int(time.time() * 1000)
    registry = SigningPublicKeyRegistry(
        [
            SigningPublicKeyRecord(
                sig_kid="sig-v1-test",
                sender_id="device-001",
                public_key=test_vector.public_key(),
                not_before=datetime.fromtimestamp((issued_at_ms + 1_000) / 1000, tz=UTC),
            )
        ]
    )
    worker = _build_worker(tmp_db, in_memory_keys, registry, policy_resolver)
    sealed = _fresh_envelope(iat_ms=issued_at_ms)

    with pytest.raises(UnknownSenderError, match="validity window"):
        worker._open_envelope(test_vector.TOPIC, sealed.wire_bytes)  # noqa: SLF001
