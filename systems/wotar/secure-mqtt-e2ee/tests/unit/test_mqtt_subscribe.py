"""MQTT subscription registration with mock transport."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field

from tests.fixtures import test_vector

from secure_mqtt.client import SecureMqttClient, build_default_policy_resolver
from secure_mqtt.config import ClientConfig, TlsConfig
from secure_mqtt.keys.memory import InMemoryKeyProvider
from secure_mqtt.keys.provider import KeyState
from secure_mqtt.keys.public_key_registry import SigningPublicKeyRecord, SigningPublicKeyRegistry
from secure_mqtt.mqtt.transport import ConnectionState, OnMessageCallback
from secure_mqtt.protocol.constants import MQTT_CONTENT_TYPE


@dataclass
class MockTransport:
    host: str = "mock"
    port: int = 8883
    client_id: str = "mock-client"
    _state: ConnectionState = field(default=ConnectionState.DISCONNECTED, init=False)
    _on_message: OnMessageCallback | None = field(default=None, init=False)
    subscriptions: list[tuple[str, int]] = field(default_factory=list, init=False)
    connected_event: threading.Event = field(default_factory=threading.Event, init=False)

    @property
    def connection_state(self) -> ConnectionState:
        return self._state

    def register_on_message(self, callback: OnMessageCallback) -> None:
        self._on_message = callback

    def add_subscription(self, topic_filter: str, qos: int = 1) -> None:
        self.subscriptions.append((topic_filter, qos))

    def start(self) -> None:
        return

    def stop(self) -> None:
        self._state = ConnectionState.DISCONNECTED

    def connect(self, *, timeout: float) -> None:
        _ = timeout
        self._state = ConnectionState.CONNECTED
        self.connected_event.set()

    def disconnect(self) -> None:
        self._state = ConnectionState.DISCONNECTED

    def publish(
        self, topic: str, payload: bytes, *, qos: int = 1, content_type: str = MQTT_CONTENT_TYPE
    ) -> int:
        _ = (topic, payload, qos, content_type)
        return 1

    def wait_puback(self, mid: int, *, timeout: float) -> None:
        _ = (mid, timeout)

    def wait_suback(self, mid: int, *, timeout: float) -> None:
        _ = (mid, timeout)

    def wait_pending_subacks(self, *, timeout: float) -> None:
        _ = timeout


def _client(tmp_path, transport: MockTransport) -> SecureMqttClient:
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
        client_id="unit-test",
        tls=TlsConfig(ca_file=tmp_path / "ca.pem"),
        key_provider=keys,
        db_path=tmp_path / "state.db",
    )
    config.tls.ca_file.write_text("dummy-ca", encoding="utf-8")
    return SecureMqttClient(
        config=config,
        registry=registry,
        policy_resolver=build_default_policy_resolver(),
        transport=transport,
    )


def test_subscriptions_registered_before_connect(tmp_path) -> None:
    transport = MockTransport()
    client = _client(tmp_path, transport)

    received: list[str] = []

    def handler(message) -> None:
        received.append(message.topic)

    client.register_subscription("test/#", handler, qos=1)
    client.connect()
    assert ("test/#", 1) in transport.subscriptions
    client.shutdown()
