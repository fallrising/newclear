"""SecureMqttClient public API."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

from secure_mqtt.config import ClientConfig
from secure_mqtt.errors import ConfigurationError, PublishError, QueueFullError
from secure_mqtt.keys.public_key_registry import SigningPublicKeyRegistry
from secure_mqtt.models import MessageHandler, PublishReceipt, SubscriptionHandle
from secure_mqtt.mqtt.paho_transport import PahoMqttTransport
from secure_mqtt.mqtt.subscriptions import SubscriptionRegistry
from secure_mqtt.mqtt.transport import IncomingMessage, Transport
from secure_mqtt.observability.metrics import Metrics
from secure_mqtt.persistence.database import Database, utc_now
from secure_mqtt.persistence.inbox import InboxStore
from secure_mqtt.persistence.outbox import OutboxStore
from secure_mqtt.persistence.replay import ReplayGuard
from secure_mqtt.policy.topic_policy import TopicPolicyResolver, TopicPolicyRule
from secure_mqtt.workers.publish_worker import PublishWorker
from secure_mqtt.workers.receive_worker import ReceiveWorker


@dataclass
class SecureMqttClient:
    """End-to-end encrypted MQTT client with durable inbox/outbox."""

    config: ClientConfig
    registry: SigningPublicKeyRegistry
    policy_resolver: TopicPolicyResolver
    transport: Transport | None = None
    metrics: Metrics = field(default_factory=Metrics)
    _database: Database | None = field(default=None, init=False)
    _outbox: OutboxStore | None = field(default=None, init=False)
    _inbox: InboxStore | None = field(default=None, init=False)
    _replay: ReplayGuard | None = field(default=None, init=False)
    _subscriptions: SubscriptionRegistry = field(default_factory=SubscriptionRegistry, init=False)
    _publish_worker: PublishWorker | None = field(default=None, init=False)
    _receive_worker: ReceiveWorker | None = field(default=None, init=False)
    _started: bool = field(default=False, init=False)

    def __post_init__(self) -> None:
        self.config.validate()

    def _ensure_components(self) -> None:
        if self._database is not None:
            return
        self._database = Database(self.config.db_path)
        self._outbox = OutboxStore(self._database, self.config.key_provider, self.policy_resolver)
        self._inbox = InboxStore(
            self._database,
            max_retries=self.config.max_inbox_retries,
            retry_base_seconds=self.config.inbox_retry_base_seconds,
        )
        self._replay = ReplayGuard(self._database)
        if self.transport is None:
            self.transport = PahoMqttTransport(
                host=self.config.broker_host,
                port=self.config.broker_port,
                client_id=self.config.client_id,
                tls=self.config.tls,
                metrics=self.metrics,
                reconnect_base_seconds=self.config.reconnect_base_seconds,
                reconnect_max_seconds=self.config.reconnect_max_seconds,
            )
        if self.transport is None:
            raise ConfigurationError("Transport initialization failed")
        self.transport.register_on_message(self._on_transport_message)
        for topic_filter, qos in self._subscriptions.list_filters():
            self.transport.add_subscription(topic_filter, qos)
        self._receive_worker = ReceiveWorker(
            key_provider=self.config.key_provider,
            registry=self.registry,
            policy_resolver=self.policy_resolver,
            replay_guard=self._replay,
            inbox=self._inbox,
            subscriptions=self._subscriptions,
            metrics=self.metrics,
            clock_skew_seconds=self.config.clock_skew_seconds,
            max_queue_size=self.config.receive_queue_size,
        )
        if self._outbox is None:
            raise ConfigurationError("Outbox initialization failed")
        self._publish_worker = PublishWorker(
            transport=self.transport,
            outbox=self._outbox,
            metrics=self.metrics,
            publish_timeout_seconds=self.config.publish_timeout_seconds,
            max_queue_size=self.config.publish_queue_size,
        )

    def register_subscription(
        self,
        topic_filter: str,
        handler: MessageHandler,
        *,
        qos: int = 1,
    ) -> SubscriptionHandle:
        if self._started:
            raise ConfigurationError("Subscriptions must be registered before connect")
        handle = self._subscriptions.register(topic_filter, handler, qos=qos)
        if self.transport is not None:
            self.transport.add_subscription(topic_filter, qos=qos)
        return handle

    def connect(self) -> None:
        self._ensure_components()
        if self.transport is None or self._publish_worker is None or self._receive_worker is None:
            raise ConfigurationError("Client components not initialized")
        self.transport.start()
        self._receive_worker.start()
        self._publish_worker.start()
        self.transport.connect(timeout=self.config.connect_timeout_seconds)
        self.transport.wait_pending_subacks(timeout=self.config.connect_timeout_seconds)
        self._publish_worker.flush_pending()
        self._started = True

    def disconnect(self) -> None:
        if self.transport is not None:
            self.transport.disconnect()

    def shutdown(self) -> None:
        if self._publish_worker is not None:
            self._publish_worker.stop(timeout=self.config.shutdown_timeout_seconds)
        if self._receive_worker is not None:
            self._receive_worker.stop(timeout=self.config.shutdown_timeout_seconds)
        if self.transport is not None:
            self.transport.stop()
        if self._database is not None:
            self._database.close()
        self._started = False

    def publish_bytes(
        self,
        topic: str,
        payload: bytes,
        *,
        content_type: str = "application/octet-stream",
        wait_ack: bool = True,
    ) -> PublishReceipt:
        self._ensure_components()
        if self._outbox is None or self._publish_worker is None:
            raise ConfigurationError("Publish pipeline not initialized")
        record = self._outbox.prepare_publish(
            topic=topic,
            plaintext=payload,
            content_type=content_type,
        )
        self.metrics.inc("outbox_prepare_total", result="success")
        self._publish_worker.enqueue(record.id)
        if wait_ack:
            deadline = utc_now().timestamp() + self.config.publish_timeout_seconds
            while utc_now().timestamp() < deadline:
                updated = self._outbox.get_by_id(record.id)
                if updated is not None and updated.state.value == "acked":
                    return PublishReceipt(
                        topic=updated.topic,
                        msg_id=updated.msg_id,
                        seq=updated.seq,
                        outbox_id=updated.id,
                        published_at=utc_now(),
                    )
                time.sleep(0.05)
            raise PublishError("Publish acknowledgement timed out")
        return PublishReceipt(
            topic=record.topic,
            msg_id=record.msg_id,
            seq=record.seq,
            outbox_id=record.id,
            published_at=utc_now(),
        )

    def publish_text(self, topic: str, text: str, *, wait_ack: bool = True) -> PublishReceipt:
        return self.publish_bytes(
            topic,
            text.encode("utf-8"),
            content_type="text/plain; charset=utf-8",
            wait_ack=wait_ack,
        )

    def publish_json(self, topic: str, obj: Any, *, wait_ack: bool = True) -> PublishReceipt:
        payload = json.dumps(obj, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return self.publish_bytes(
            topic,
            payload,
            content_type="application/json",
            wait_ack=wait_ack,
        )

    def _on_transport_message(self, message: IncomingMessage) -> None:
        if self._receive_worker is None:
            return
        try:
            self._receive_worker.offer(message)
        except QueueFullError:
            return


def build_default_policy_resolver(
    rules: list[TopicPolicyRule] | None = None,
) -> TopicPolicyResolver:
    if rules is not None:
        return TopicPolicyResolver(rules)
    return TopicPolicyResolver(
        [
            TopicPolicyRule(
                filter="#",
                topic_group="default",
                schema_id="default.v1",
                ttl_seconds=300,
                max_ttl_seconds=24 * 3600,
            )
        ]
    )
