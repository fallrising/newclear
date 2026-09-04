"""Load topic policies and public key registry from config files."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from secure_mqtt.errors import ConfigurationError
from secure_mqtt.keys.provider import KeyState
from secure_mqtt.keys.public_key_registry import SigningPublicKeyRecord, SigningPublicKeyRegistry
from secure_mqtt.policy.topic_policy import TopicPolicyResolver, TopicPolicyRule

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    import tomli as tomllib  # type: ignore[no-redef]


def _parse_publishers(value: object) -> frozenset[str] | None:
    if value is None:
        return None
    if not isinstance(value, list):
        raise ConfigurationError("allowed_publishers must be a list")
    return frozenset(str(item) for item in value)


def _parse_optional_datetime(value: object, field: str) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ConfigurationError(f"{field} must be an RFC 3339 timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ConfigurationError(f"{field} must be an RFC 3339 timestamp") from exc
    if parsed.tzinfo is None:
        raise ConfigurationError(f"{field} must include a UTC offset")
    return parsed.astimezone(UTC)


def load_topic_policies(path: Path) -> TopicPolicyResolver:
    """Load topic policy rules from a TOML file."""
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    rules_raw = data.get("rules")
    if not isinstance(rules_raw, list) or not rules_raw:
        raise ConfigurationError("Policy file must contain a non-empty rules list")
    rules: list[TopicPolicyRule] = []
    for item in rules_raw:
        if not isinstance(item, dict):
            raise ConfigurationError("Each policy rule must be a table")
        try:
            rules.append(
                TopicPolicyRule(
                    filter=str(item["filter"]),
                    topic_group=str(item["topic_group"]),
                    schema_id=str(item["schema_id"]),
                    ttl_seconds=int(item["ttl_seconds"]),
                    max_ttl_seconds=int(item["max_ttl_seconds"]),
                    allowed_publishers=_parse_publishers(item.get("allowed_publishers")),
                )
            )
        except KeyError as exc:
            raise ConfigurationError(f"Policy rule missing field: {exc}") from exc
    return TopicPolicyResolver(rules)


def load_public_key_registry(path: Path) -> SigningPublicKeyRegistry:
    """Load trusted signing public keys from JSON."""
    from secure_mqtt.crypto.signing import public_key_from_bytes

    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    keys_raw = data.get("keys")
    if not isinstance(keys_raw, list):
        raise ConfigurationError("public-keys file must contain a keys array")
    records: list[SigningPublicKeyRecord] = []
    for item in keys_raw:
        if not isinstance(item, dict):
            raise ConfigurationError("Each public key entry must be an object")
        try:
            state = KeyState(str(item.get("state", KeyState.ACTIVE.value)))
            records.append(
                SigningPublicKeyRecord(
                    sig_kid=str(item["sig_kid"]),
                    sender_id=str(item["sender_id"]),
                    public_key=public_key_from_bytes(bytes.fromhex(str(item["public_key_hex"]))),
                    state=state,
                    not_before=_parse_optional_datetime(item.get("not_before"), "not_before"),
                    not_after=_parse_optional_datetime(item.get("not_after"), "not_after"),
                )
            )
        except KeyError as exc:
            raise ConfigurationError(f"Public key entry missing field: {exc}") from exc
        except (TypeError, ValueError) as exc:
            raise ConfigurationError("Invalid public key entry") from exc
    return SigningPublicKeyRegistry(records)
