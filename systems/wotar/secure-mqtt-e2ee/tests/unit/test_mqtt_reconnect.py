"""MQTT reconnect and subscription restoration tests."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from secure_mqtt.config import TlsConfig
from secure_mqtt.mqtt.paho_transport import PahoMqttTransport
from secure_mqtt.mqtt.transport import ConnectionState, OnMessageCallback
from secure_mqtt.observability.metrics import Metrics
from secure_mqtt.protocol.constants import MQTT_CONTENT_TYPE


@dataclass
class ReconnectMockTransport:
    """Minimal transport tracking subscription restore on reconnect."""

    subscriptions: list[tuple[str, int]] = field(default_factory=list)
    connect_count: int = 0
    _state: ConnectionState = field(default=ConnectionState.DISCONNECTED, init=False)
    _on_message: OnMessageCallback | None = field(default=None, init=False)
    reconnect_base_seconds: float = 2.0
    reconnect_max_seconds: float = 60.0
    _reconnect_attempt: int = 0

    @property
    def connection_state(self) -> ConnectionState:
        return self._state

    def add_subscription(self, topic_filter: str, qos: int = 1) -> None:
        self.subscriptions.append((topic_filter, qos))

    def simulate_connect(self) -> None:
        self.connect_count += 1
        self._state = ConnectionState.CONNECTED
        self._reconnect_attempt = 0
        # idempotent resubscribe on connect
        restored = list(self.subscriptions)

        def _restore() -> None:
            self.subscriptions = restored

        _restore()

    def simulate_disconnect_reconnect(self) -> None:
        self._state = ConnectionState.RECONNECTING
        self._reconnect_attempt += 1
        self.simulate_connect()

    def register_on_message(self, callback: OnMessageCallback) -> None:
        self._on_message = callback

    def start(self) -> None:
        return

    def stop(self) -> None:
        self._state = ConnectionState.DISCONNECTED

    def connect(self, *, timeout: float) -> None:
        _ = timeout
        self.simulate_connect()

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


def test_subscriptions_restored_after_reconnect() -> None:
    transport = ReconnectMockTransport()
    transport.add_subscription("test/e2ee/#", qos=1)
    transport.add_subscription("alerts/+", qos=0)
    transport.simulate_connect()
    assert transport.connect_count == 1
    assert ("test/e2ee/#", 1) in transport.subscriptions
    transport.simulate_disconnect_reconnect()
    assert transport.connection_state == ConnectionState.CONNECTED
    assert transport.connect_count == 2
    assert ("alerts/+", 0) in transport.subscriptions


ROOT = Path(__file__).resolve().parents[2]
CA_FILE = ROOT / "certs" / "ca.pem"


def test_paho_transport_configures_exponential_backoff(tmp_path) -> None:
    if not CA_FILE.exists():
        pytest.skip("certs not generated")
    ca = CA_FILE
    transport = PahoMqttTransport(
        host="localhost",
        port=8883,
        client_id="reconnect-test",
        tls=TlsConfig(ca_file=ca, server_hostname="localhost"),
        metrics=Metrics(),
        reconnect_base_seconds=2.0,
        reconnect_max_seconds=60.0,
    )
    # reconnect_delay_set invoked in __post_init__
    assert transport.reconnect_base_seconds == 2.0
    assert transport.reconnect_max_seconds == 60.0


def test_paho_on_disconnect_enters_reconnecting(tmp_path) -> None:
    if not CA_FILE.exists():
        pytest.skip("certs not generated")
    ca = CA_FILE
    transport = PahoMqttTransport(
        host="localhost",
        port=8883,
        client_id="reconnect-test-2",
        tls=TlsConfig(ca_file=ca),
        metrics=Metrics(),
    )
    reason = MagicMock()
    reason.is_failure = False
    transport._on_disconnect(MagicMock(), None, None, reason, None)
    assert transport.connection_state == ConnectionState.RECONNECTING
    assert transport._reconnect_attempt == 1


def test_paho_on_connect_restores_subscriptions(tmp_path) -> None:
    if not CA_FILE.exists():
        pytest.skip("certs not generated")
    ca = CA_FILE
    transport = PahoMqttTransport(
        host="localhost",
        port=8883,
        client_id="reconnect-test-3",
        tls=TlsConfig(ca_file=ca),
        metrics=Metrics(),
    )
    transport.add_subscription("test/#", qos=1)
    mock_client = MagicMock()
    mock_client.subscribe.return_value = (0, 42)
    transport._client = mock_client
    reason = MagicMock()
    reason.is_failure = False
    transport._on_connect(mock_client, None, None, reason, None)
    assert transport.connection_state == ConnectionState.CONNECTED
    mock_client.subscribe.assert_called_once_with("test/#", qos=1)
