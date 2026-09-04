"""Topic policy resolver and loader tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from secure_mqtt.errors import ConfigurationError
from secure_mqtt.policy.loader import load_topic_policies
from secure_mqtt.policy.topic_policy import TopicPolicyResolver, TopicPolicyRule


def test_wildcard_subscription_match() -> None:
    resolver = TopicPolicyResolver(
        [
            TopicPolicyRule(
                filter="sensors/+/temp",
                topic_group="sensors",
                schema_id="s.v1",
                ttl_seconds=300,
                max_ttl_seconds=3600,
            ),
            TopicPolicyRule(
                filter="sensors/#",
                topic_group="sensors-all",
                schema_id="s.v1",
                ttl_seconds=300,
                max_ttl_seconds=3600,
            ),
        ]
    )
    assert resolver.resolve("sensors/room1/temp").topic_group == "sensors"
    assert resolver.resolve("sensors/room1/humidity").topic_group == "sensors-all"


def test_publish_acl_enforced() -> None:
    resolver = TopicPolicyResolver(
        [
            TopicPolicyRule(
                filter="restricted/#",
                topic_group="r",
                schema_id="x",
                ttl_seconds=60,
                max_ttl_seconds=3600,
                allowed_publishers=frozenset({"allowed-device"}),
            ),
        ]
    )
    resolver.assert_publish_allowed("restricted/t", "allowed-device")
    with pytest.raises(ConfigurationError):
        resolver.assert_publish_allowed("restricted/t", "other-device")


def test_loader_invalid_file(tmp_path: Path) -> None:
    bad = tmp_path / "bad.toml"
    bad.write_text("rules = []\n", encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load_topic_policies(bad)
