"""Connect, publish, and shutdown timeout tests."""

from __future__ import annotations

import time
from dataclasses import dataclass

import pytest
from tests.fixtures import test_vector
from tests.unit.test_mqtt_subscribe import MockTransport

from secure_mqtt.client import SecureMqttClient, build_default_policy_resolver
from secure_mqtt.config import ClientConfig, TlsConfig
from secure_mqtt.errors import ConnectionError, PublishError
from secure_mqtt.keys.memory import InMemoryKeyProvider
from secure_mqtt.keys.provider import KeyState
from secure_mqtt.keys.public_key_registry import SigningPublicKeyRecord, SigningPublicKeyRegistry
from secure_mqtt.mqtt.transport import ConnectionState
from secure_mqtt.observability.metrics import Metrics
from secure_mqtt.workers.publish_worker import PublishWorker


@dataclass
class NeverConnectTransport(MockTransport):
    """Transport that never reaches CONNECTED."""

    def connect(self, *, timeout: float) -> None:
        self._state = ConnectionState.CONNECTING
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            time.sleep(0.05)
        raise ConnectionError("MQTT connect timed out")


@dataclass
class NeverAckTransport(MockTransport):
    """Transport that never completes PUBACK."""

    def wait_puback(self, mid: int, *, timeout: float) -> None:
        _ = mid
        time.sleep(timeout + 0.1)
        raise PublishError("PUBACK timeout")


def _client(tmp_path, transport) -> SecureMqttClient:
    keys = InMemoryKeyProvider(
        sender_id="device-001",
        sig_kid="sig-v1-test",
        signing_seed=test_vector.SIGN_SEED,
    )
    keys.add_dek("default", "dek-v1-test", test_vector.DEK, state=KeyState.ACTIVE)
    registry = SigningPublicKeyRegistry(
        [
            SigningPublicKeyRecord(
                sig_kid="sig-v1-test",
                sender_id="device-001",
                public_key=test_vector.public_key(),
            )
        ]
    )
    config = ClientConfig(
        broker_host="localhost",
        broker_port=8883,
        client_id="timeout-test",
        tls=TlsConfig(ca_file=tmp_path / "ca.pem"),
        key_provider=keys,
        db_path=tmp_path / "state.db",
        connect_timeout_seconds=0.2,
        publish_timeout_seconds=0.3,
        shutdown_timeout_seconds=1.0,
    )
    config.tls.ca_file.write_text("dummy-ca", encoding="utf-8")
    return SecureMqttClient(
        config=config,
        registry=registry,
        policy_resolver=build_default_policy_resolver(),
        transport=transport,
    )


def test_connect_timeout(tmp_path) -> None:
    client = _client(tmp_path, NeverConnectTransport())
    with pytest.raises(ConnectionError, match="timed out"):
        client.connect()


def test_publish_timeout_when_no_puback(tmp_path) -> None:
    transport = NeverAckTransport()
    client = _client(tmp_path, transport)
    client.connect()
    try:
        with pytest.raises(PublishError, match="acknowledgement timed out"):
            client.publish_text("test/topic", "hello", wait_ack=True)
    finally:
        client.shutdown()


def test_shutdown_timeout_completes(tmp_path) -> None:
    transport = MockTransport()
    client = _client(tmp_path, transport)
    client.connect()
    client.shutdown()
    assert transport.connection_state == ConnectionState.DISCONNECTED


def test_publish_worker_respects_puback_timeout(
    tmp_db,
    in_memory_keys,
    policy_resolver,
) -> None:
    from secure_mqtt.persistence.outbox import OutboxStore

    outbox = OutboxStore(tmp_db, in_memory_keys, policy_resolver)
    record = outbox.prepare_publish(
        topic=test_vector.TOPIC,
        plaintext=b"t",
        content_type="text/plain",
        signing_key=test_vector.signing_key(),
    )
    transport = NeverAckTransport()
    transport.connect(timeout=1.0)
    worker = PublishWorker(
        transport=transport,
        outbox=outbox,
        metrics=Metrics(),
        publish_timeout_seconds=0.2,
    )
    worker.start()
    worker.enqueue(record.id)
    time.sleep(0.6)
    worker.stop(timeout=1.0)
    row = outbox.get_by_id(record.id)
    assert row is not None
    assert row.state.value != "acked"
