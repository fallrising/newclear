"""Policy and registry loader error-path tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from secure_mqtt.errors import ConfigurationError
from secure_mqtt.policy.loader import load_public_key_registry, load_topic_policies


def test_registry_missing_keys_array(tmp_path: Path) -> None:
    path = tmp_path / "pk.json"
    path.write_text("{}", encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load_public_key_registry(path)


def test_registry_missing_field(tmp_path: Path) -> None:
    path = tmp_path / "pk.json"
    path.write_text(json.dumps({"keys": [{"sig_kid": "x"}]}), encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load_public_key_registry(path)


def test_registry_entry_must_be_an_object(tmp_path: Path) -> None:
    path = tmp_path / "pk.json"
    path.write_text(json.dumps({"keys": ["invalid"]}), encoding="utf-8")
    with pytest.raises(ConfigurationError, match="object"):
        load_public_key_registry(path)


def test_registry_rejects_invalid_key_state(tmp_path: Path) -> None:
    path = tmp_path / "pk.json"
    path.write_text(
        json.dumps(
            {
                "keys": [
                    {
                        "sig_kid": "sig-v1-test",
                        "sender_id": "device-001",
                        "public_key_hex": "00" * 32,
                        "state": "pending",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError, match="Invalid public key entry"):
        load_public_key_registry(path)


def test_policy_missing_rules_key(tmp_path: Path) -> None:
    path = tmp_path / "p.toml"
    path.write_text("[meta]\nversion=1\n", encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load_topic_policies(path)


def test_policy_rule_must_be_a_table(tmp_path: Path) -> None:
    path = tmp_path / "p.toml"
    path.write_text("rules = [1]\n", encoding="utf-8")
    with pytest.raises(ConfigurationError, match="table"):
        load_topic_policies(path)


def test_policy_rule_missing_required_field(tmp_path: Path) -> None:
    path = tmp_path / "p.toml"
    path.write_text(
        "[[rules]]\nfilter = 'test/#'\ntopic_group = 'default'\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError, match="missing field"):
        load_topic_policies(path)


def test_policy_allowed_publishers_must_be_a_list(tmp_path: Path) -> None:
    path = tmp_path / "p.toml"
    path.write_text(
        """
[[rules]]
filter = "test/#"
topic_group = "default"
schema_id = "text.v1"
ttl_seconds = 60
max_ttl_seconds = 300
allowed_publishers = "device-001"
""".strip(),
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError, match="allowed_publishers"):
        load_topic_policies(path)
