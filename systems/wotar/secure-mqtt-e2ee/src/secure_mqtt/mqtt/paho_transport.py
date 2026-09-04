"""Paho MQTT v5 transport with strict TLS."""

from __future__ import annotations

import logging
import ssl
import threading
import time
from dataclasses import dataclass, field

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion, MQTTErrorCode, MQTTProtocolVersion
from paho.mqtt.properties import Properties
from paho.mqtt.reasoncodes import ReasonCode

from secure_mqtt.config import TlsConfig
from secure_mqtt.errors import ConfigurationError, ConnectionError, PublishError, SubscriptionError
from secure_mqtt.mqtt.properties import envelope_publish_properties
from secure_mqtt.mqtt.transport import ConnectionState, IncomingMessage, OnMessageCallback
from secure_mqtt.observability.metrics import Metrics
from secure_mqtt.protocol.constants import MQTT_CONTENT_TYPE

logger = logging.getLogger(__name__)


@dataclass
class PahoMqttTransport:
    """MQTT v5 transport using paho with CERT_REQUIRED TLS."""

    host: str
    port: int
    client_id: str
    tls: TlsConfig
    metrics: Metrics
    reconnect_base_seconds: float = 1.0
    reconnect_max_seconds: float = 30.0
    _state: ConnectionState = field(default=ConnectionState.DISCONNECTED, init=False)
    _client: mqtt.Client = field(init=False)
    _on_message: OnMessageCallback | None = field(default=None, init=False)
    _pending_subscriptions: list[tuple[str, int]] = field(default_factory=list, init=False)
    _puback_events: dict[int, threading.Event] = field(default_factory=dict, init=False)
    _puback_reasons: dict[int, ReasonCode] = field(default_factory=dict, init=False)
    _suback_events: dict[int, threading.Event] = field(default_factory=dict, init=False)
    _suback_reasons: dict[int, list[ReasonCode]] = field(default_factory=dict, init=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False)
    _reconnect_attempt: int = field(default=0, init=False)
    _stop_reconnect: bool = field(default=False, init=False)

    def __post_init__(self) -> None:
        self._client = mqtt.Client(
            callback_api_version=CallbackAPIVersion.VERSION2,
            client_id=self.client_id,
            protocol=MQTTProtocolVersion.MQTTv5,
        )
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message_cb
        self._client.on_publish = self._on_publish
        self._client.on_subscribe = self._on_subscribe
        self._client.reconnect_delay_set(
            min_delay=int(self.reconnect_base_seconds),
            max_delay=int(self.reconnect_max_seconds),
        )
        self._configure_tls()

    @property
    def connection_state(self) -> ConnectionState:
        return self._state

    def _configure_tls(self) -> None:
        self.tls.validate()
        context = ssl.create_default_context(cafile=str(self.tls.ca_file))
        context.verify_mode = ssl.CERT_REQUIRED
        context.check_hostname = self.tls.server_hostname is not None
        if context.verify_mode == ssl.CERT_NONE:
            raise ConfigurationError("TLS verify_mode must not be CERT_NONE")
        certfile = str(self.tls.cert_file) if self.tls.cert_file else None
        keyfile = str(self.tls.key_file) if self.tls.key_file else None
        if certfile and keyfile:
            context.load_cert_chain(certfile=certfile, keyfile=keyfile)
        self._client.tls_set_context(context)
        if self.tls.server_hostname:
            self._client.tls_insecure_set(False)

    def register_on_message(self, callback: OnMessageCallback) -> None:
        self._on_message = callback

    def add_subscription(self, topic_filter: str, qos: int = 1) -> None:
        with self._lock:
            if (topic_filter, qos) not in self._pending_subscriptions:
                self._pending_subscriptions.append((topic_filter, qos))

    def start(self) -> None:
        self._stop_reconnect = False
        self._client.loop_start()

    def stop(self) -> None:
        self._stop_reconnect = True
        self._client.loop_stop()
        if self._client.is_connected():
            self._client.disconnect()
        self._state = ConnectionState.DISCONNECTED

    def connect(self, *, timeout: float) -> None:
        self._state = ConnectionState.CONNECTING
        try:
            self._client.connect(self.host, self.port, keepalive=60)
        except Exception as exc:
            self._state = ConnectionState.DISCONNECTED
            self.metrics.inc("mqtt_connect_total", result="failure")
            msg = "MQTT connect failed"
            raise ConnectionError(msg) from exc
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._state == ConnectionState.CONNECTED:
                return
            time.sleep(0.05)
        self.metrics.inc("mqtt_connect_total", result="timeout")
        raise ConnectionError("MQTT connect timed out")

    def disconnect(self) -> None:
        self._stop_reconnect = True
        if self._client.is_connected():
            self._client.disconnect()
        self._state = ConnectionState.DISCONNECTED

    def wait_pending_subacks(self, *, timeout: float) -> None:
        with self._lock:
            mids = [mid for mid in self._suback_events if not self._suback_events[mid].is_set()]
        for mid in mids:
            self.wait_suback(mid, timeout=timeout)

    def publish(
        self,
        topic: str,
        payload: bytes,
        *,
        qos: int = 1,
        content_type: str | None = None,
    ) -> int:
        if not self._client.is_connected():
            raise PublishError("Transport is not connected")
        props = envelope_publish_properties(content_type or MQTT_CONTENT_TYPE)
        info = self._client.publish(topic, payload, qos=qos, properties=props)
        if info.rc != MQTTErrorCode.MQTT_ERR_SUCCESS:
            self.metrics.inc("mqtt_publish_total", result="failure")
            raise PublishError("MQTT publish rejected by client")
        if qos == 0:
            self.metrics.inc("mqtt_publish_total", result="success")
            return int(info.mid)
        event = threading.Event()
        with self._lock:
            self._puback_events[int(info.mid)] = event
        return int(info.mid)

    def wait_puback(self, mid: int, *, timeout: float) -> None:
        with self._lock:
            event = self._puback_events.get(mid)
        if event is None:
            event = threading.Event()
            with self._lock:
                self._puback_events[mid] = event
        if not event.wait(timeout):
            self.metrics.inc("mqtt_puback_total", result="timeout")
            raise PublishError(f"PUBACK timeout for mid={mid}")
        with self._lock:
            reason = self._puback_reasons.pop(mid, None)
            self._puback_events.pop(mid, None)
        if reason is not None and not reason.is_failure:
            self.metrics.inc("mqtt_puback_total", result="success")
            return
        if reason is not None and reason.is_failure:
            self.metrics.inc("mqtt_puback_total", result="failure")
            raise PublishError("Broker rejected publish")
        self.metrics.inc("mqtt_puback_total", result="success")

    def wait_suback(self, mid: int, *, timeout: float) -> None:
        with self._lock:
            event = self._suback_events.get(mid)
        if event is None:
            event = threading.Event()
            with self._lock:
                self._suback_events[mid] = event
        if not event.wait(timeout):
            self.metrics.inc("mqtt_suback_total", result="timeout")
            raise SubscriptionError(f"SUBACK timeout for mid={mid}")
        with self._lock:
            reasons = self._suback_reasons.pop(mid, [])
            self._suback_events.pop(mid, None)
        if any(reason.is_failure for reason in reasons):
            self.metrics.inc("mqtt_suback_total", result="failure")
            raise SubscriptionError("Broker rejected subscription")
        self.metrics.inc("mqtt_suback_total", result="success")

    def _on_connect(
        self,
        client: mqtt.Client,
        userdata: object,
        flags: object,
        reason_code: ReasonCode,
        properties: Properties | None,
    ) -> None:
        _ = (client, userdata, flags, properties)
        if reason_code.is_failure:
            self._state = ConnectionState.DISCONNECTED
            self.metrics.inc("mqtt_connect_total", result="failure")
            logger.warning("MQTT connect rejected", extra={"reason": str(reason_code)})
            return
        self._state = ConnectionState.CONNECTED
        self._reconnect_attempt = 0
        self.metrics.inc("mqtt_connect_total", result="success")
        self._restore_subscriptions()

    def _on_disconnect(
        self,
        client: mqtt.Client,
        userdata: object,
        disconnect_flags: object,
        reason_code: ReasonCode,
        properties: Properties | None,
    ) -> None:
        _ = (client, userdata, disconnect_flags, properties, reason_code)
        if self._stop_reconnect:
            self._state = ConnectionState.DISCONNECTED
            return
        self._state = ConnectionState.RECONNECTING
        self._reconnect_attempt += 1
        self.metrics.inc("mqtt_disconnect_total", result="reconnecting")

    def _restore_subscriptions(self) -> None:
        with self._lock:
            subscriptions = list(self._pending_subscriptions)
        for topic_filter, qos in subscriptions:
            _rc, mid = self._client.subscribe(topic_filter, qos=qos)
            if mid is not None:
                with self._lock:
                    self._suback_events[int(mid)] = threading.Event()

    def _on_message_cb(
        self,
        client: mqtt.Client,
        userdata: object,
        message: mqtt.MQTTMessage,
    ) -> None:
        _ = (client, userdata)
        if self._on_message is None:
            return
        incoming = IncomingMessage(
            topic=message.topic,
            payload=bytes(message.payload),
            qos=int(message.qos),
        )
        self.metrics.inc("mqtt_receive_total", result="queued")
        self._on_message(incoming)

    def _on_publish(
        self,
        client: mqtt.Client,
        userdata: object,
        mid: int,
        reason_code: ReasonCode,
        properties: Properties,
    ) -> None:
        _ = (client, userdata, properties)
        with self._lock:
            self._puback_reasons[int(mid)] = reason_code
            event = self._puback_events.get(int(mid))
            if event is not None:
                event.set()

    def _on_subscribe(
        self,
        client: mqtt.Client,
        userdata: object,
        mid: int,
        reason_codes: list[ReasonCode],
        properties: Properties | None,
    ) -> None:
        _ = (client, userdata, properties)
        with self._lock:
            self._suback_reasons[int(mid)] = reason_codes
            event = self._suback_events.get(int(mid))
            if event is not None:
                event.set()
