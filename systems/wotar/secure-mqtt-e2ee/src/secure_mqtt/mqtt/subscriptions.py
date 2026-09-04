"""Subscription registry with MQTT wildcard dispatch."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from secure_mqtt.models import MessageHandler, SubscriptionHandle
from secure_mqtt.policy.topic_policy import mqtt_topic_matches


@dataclass
class _SubscriptionEntry:
    subscription_id: str
    filter: str
    qos: int
    handler: MessageHandler


@dataclass
class SubscriptionRegistry:
    """Track registered subscription filters and handlers."""

    _entries: list[_SubscriptionEntry] = field(default_factory=list)

    def register(
        self,
        topic_filter: str,
        handler: MessageHandler,
        *,
        qos: int = 1,
    ) -> SubscriptionHandle:
        subscription_id = uuid.uuid4().hex
        self._entries.append(
            _SubscriptionEntry(
                subscription_id=subscription_id,
                filter=topic_filter,
                qos=qos,
                handler=handler,
            )
        )
        return SubscriptionHandle(subscription_id=subscription_id, filter=topic_filter, qos=qos)

    def list_filters(self) -> list[tuple[str, int]]:
        return [(entry.filter, entry.qos) for entry in self._entries]

    def handlers_for_topic(self, topic: str) -> list[MessageHandler]:
        return [entry.handler for entry in self._entries if mqtt_topic_matches(entry.filter, topic)]

    def remove(self, subscription_id: str) -> bool:
        before = len(self._entries)
        self._entries = [
            entry for entry in self._entries if entry.subscription_id != subscription_id
        ]
        return len(self._entries) < before
