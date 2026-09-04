"""Topic policy resolution with MQTT wildcard matching."""

from __future__ import annotations

from dataclasses import dataclass

from secure_mqtt.errors import ConfigurationError


def mqtt_topic_matches(filter_pattern: str, topic: str) -> bool:
    """Return True when topic matches MQTT filter (+/# wildcards)."""
    filter_levels = filter_pattern.split("/")
    topic_levels = topic.split("/")

    for index, level in enumerate(filter_levels):
        if level == "#":
            return index == len(filter_levels) - 1
        if index >= len(topic_levels):
            return False
        if level != "+" and level != topic_levels[index]:
            return False

    return len(filter_levels) == len(topic_levels)


@dataclass(frozen=True)
class TopicPolicy:
    """Resolved policy for a concrete MQTT topic."""

    topic_group: str
    schema_id: str
    ttl_seconds: int
    max_ttl_seconds: int
    allowed_publishers: frozenset[str] | None = None


@dataclass(frozen=True)
class TopicPolicyRule:
    """Static policy rule bound to a topic filter pattern."""

    filter: str
    topic_group: str
    schema_id: str
    ttl_seconds: int
    max_ttl_seconds: int
    allowed_publishers: frozenset[str] | None = None


class TopicPolicyResolver:
    """Resolve topic policies using longest matching MQTT filter."""

    def __init__(self, rules: list[TopicPolicyRule]) -> None:
        if not rules:
            raise ConfigurationError("At least one topic policy rule is required")
        self._rules = sorted(rules, key=lambda rule: len(rule.filter), reverse=True)

    def resolve(self, topic: str) -> TopicPolicy:
        for rule in self._rules:
            if mqtt_topic_matches(rule.filter, topic):
                return TopicPolicy(
                    topic_group=rule.topic_group,
                    schema_id=rule.schema_id,
                    ttl_seconds=rule.ttl_seconds,
                    max_ttl_seconds=rule.max_ttl_seconds,
                    allowed_publishers=rule.allowed_publishers,
                )
        msg = f"No policy rule matches topic: {topic}"
        raise ConfigurationError(msg)

    def assert_publish_allowed(self, topic: str, sender_id: str) -> TopicPolicy:
        policy = self.resolve(topic)
        if policy.allowed_publishers is not None and sender_id not in policy.allowed_publishers:
            msg = f"Sender {sender_id} not allowed to publish to {topic}"
            raise ConfigurationError(msg)
        return policy
