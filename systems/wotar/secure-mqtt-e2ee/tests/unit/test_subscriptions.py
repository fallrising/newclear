"""Subscription registry wildcard dispatch."""

from __future__ import annotations

from secure_mqtt.mqtt.subscriptions import SubscriptionRegistry


def test_exact_subscription_dispatch() -> None:
    registry = SubscriptionRegistry()
    seen: list[str] = []

    def handler(message) -> None:
        seen.append(message.topic)

    registry.register("test/e2ee/vector1/data", handler)
    handlers = registry.handlers_for_topic("test/e2ee/vector1/data")
    assert len(handlers) == 1


def test_wildcard_plus_and_hash() -> None:
    registry = SubscriptionRegistry()
    plus_hits: list[str] = []
    hash_hits: list[str] = []

    registry.register("test/+/vector1/data", lambda m: plus_hits.append(m.topic))
    registry.register("test/#", lambda m: hash_hits.append(m.topic))

    topic = "test/e2ee/vector1/data"
    assert len(registry.handlers_for_topic(topic)) == 2
