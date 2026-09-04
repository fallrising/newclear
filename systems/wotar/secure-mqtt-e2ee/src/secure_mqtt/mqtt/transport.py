"""MQTT transport protocol."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from secure_mqtt.protocol.constants import MQTT_CONTENT_TYPE


class ConnectionState(StrEnum):
    """MQTT session connection lifecycle."""

    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"


@dataclass(frozen=True)
class IncomingMessage:
    """Message received from MQTT broker."""

    topic: str
    payload: bytes
    qos: int


OnMessageCallback = Callable[[IncomingMessage], None]


class Transport(Protocol):
    """Abstract MQTT transport with strict TLS and QoS tracking."""

    @property
    def connection_state(self) -> ConnectionState: ...

    def connect(self, *, timeout: float) -> None: ...

    def disconnect(self) -> None: ...

    def register_on_message(self, callback: OnMessageCallback) -> None: ...

    def add_subscription(self, topic_filter: str, qos: int = 1) -> None: ...

    def publish(
        self,
        topic: str,
        payload: bytes,
        *,
        qos: int = 1,
        content_type: str = MQTT_CONTENT_TYPE,
    ) -> int: ...

    def wait_puback(self, mid: int, *, timeout: float) -> None: ...

    def wait_suback(self, mid: int, *, timeout: float) -> None: ...

    def start(self) -> None: ...

    def stop(self) -> None: ...

    def wait_pending_subacks(self, *, timeout: float) -> None: ...
