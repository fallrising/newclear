"""Keyring administration for self-managed file keyrings."""

from __future__ import annotations

import secrets
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from secure_mqtt.crypto import signing
from secure_mqtt.errors import ConfigurationError, InvalidKeyStateError, UnknownKeyError
from secure_mqtt.keys.file_keyring import FileKeyringProvider
from secure_mqtt.keys.provider import KeyState


@dataclass(frozen=True)
class KeyringListEntry:
    """Non-secret view of a DEK entry."""

    topic_group: str
    kid: str
    state: str
    is_active: bool


def _read_keyring(path: Path) -> dict[str, Any]:
    provider = FileKeyringProvider.from_path(path)
    return _provider_to_mapping(provider)


def _provider_to_mapping(provider: FileKeyringProvider) -> dict[str, Any]:
    topic_groups: dict[str, Any] = {}
    for group_name, group in provider.topic_groups.items():
        keys = [
            {"kid": kid, "dek_hex": dek.hex(), "state": state.value}
            for kid, (dek, state) in group.keys.items()
        ]
        topic_groups[group_name] = {"active_kid": group.active_kid, "keys": keys}
    return {
        "sender_id": provider.sender_id,
        "sig_kid": provider.sig_kid,
        "signing_seed_hex": provider.signing_seed.hex(),
        "topic_groups": topic_groups,
    }


def _write_keyring(path: Path, data: dict[str, Any]) -> None:
    FileKeyringProvider.write_keyring_atomic(path, data)


def generate_local_keyring(
    path: Path,
    *,
    sender_id: str | None = None,
    sig_kid: str | None = None,
    topic_group: str = "default",
    topic_groups: Sequence[str] | None = None,
    dek_kid: str | None = None,
) -> dict[str, Any]:
    """Create a new local keyring with random signing seed and DEK(s).

    Pass ``topic_groups`` to provision multiple topic groups (each with its own
    ACTIVE DEK). When omitted, a single group from ``topic_group`` is created.
    """
    resolved_sender = sender_id or f"device-{uuid.uuid4().hex[:8]}"
    resolved_sig_kid = sig_kid or f"sig-{uuid.uuid4().hex[:8]}"
    groups = list(topic_groups) if topic_groups is not None else [topic_group]
    if not groups:
        raise ConfigurationError("At least one topic group is required")
    if len(groups) != len(set(groups)):
        raise ConfigurationError("Duplicate topic groups are not allowed")

    signing_seed = secrets.token_bytes(32)
    topic_group_data: dict[str, Any] = {}
    active_kids: dict[str, str] = {}
    for group_name in groups:
        if not group_name:
            raise ConfigurationError("topic group name must be non-empty")
        # Keep an explicit --dek-kid only when generating a single group.
        resolved_dek_kid = (
            dek_kid if dek_kid is not None and len(groups) == 1 else f"dek-{uuid.uuid4().hex[:8]}"
        )
        dek = secrets.token_bytes(32)
        topic_group_data[group_name] = {
            "active_kid": resolved_dek_kid,
            "keys": [
                {
                    "kid": resolved_dek_kid,
                    "dek_hex": dek.hex(),
                    "state": KeyState.ACTIVE.value,
                }
            ],
        }
        active_kids[group_name] = resolved_dek_kid

    data = {
        "sender_id": resolved_sender,
        "sig_kid": resolved_sig_kid,
        "signing_seed_hex": signing_seed.hex(),
        "topic_groups": topic_group_data,
    }
    _write_keyring(path, data)
    primary_group = groups[0]
    return {
        "sender_id": resolved_sender,
        "sig_kid": resolved_sig_kid,
        "topic_group": primary_group,
        "topic_groups": list(groups),
        "active_kid": active_kids[primary_group],
        "active_kids": active_kids,
        "public_key_hex": signing.private_key_from_seed(signing_seed)
        .public_key()
        .public_bytes_raw()
        .hex(),
    }


def list_keys(path: Path) -> list[KeyringListEntry]:
    """Return key metadata without secret material."""
    provider = FileKeyringProvider.from_path(path)
    entries: list[KeyringListEntry] = []
    for group_name, group in provider.topic_groups.items():
        for kid, (_dek, state) in group.keys.items():
            entries.append(
                KeyringListEntry(
                    topic_group=group_name,
                    kid=kid,
                    state=state.value,
                    is_active=group.active_kid == kid,
                )
            )
    return entries


def add_pending_dek(path: Path, *, topic_group: str, kid: str | None = None) -> str:
    """Add a new DEK without making it active (stored as retired/pending)."""
    data = _read_keyring(path)
    groups = data.setdefault("topic_groups", {})
    group = groups.setdefault(topic_group, {"active_kid": None, "keys": []})
    if not isinstance(group, dict):
        raise ConfigurationError(f"Invalid topic group: {topic_group}")
    keys = group.setdefault("keys", [])
    if not isinstance(keys, list):
        raise ConfigurationError(f"Invalid keys list for {topic_group}")
    resolved_kid = kid or f"dek-{uuid.uuid4().hex[:8]}"
    for item in keys:
        if isinstance(item, dict) and item.get("kid") == resolved_kid:
            raise ConfigurationError(f"DEK kid already exists: {resolved_kid}")
    keys.append(
        {
            "kid": resolved_kid,
            "dek_hex": secrets.token_bytes(32).hex(),
            "state": KeyState.RETIRED.value,
        }
    )
    _write_keyring(path, data)
    return resolved_kid


def activate_dek(path: Path, *, topic_group: str, kid: str) -> None:
    """Activate a pending DEK and demote the previous active key to decrypt-only."""
    data = _read_keyring(path)
    group = data.get("topic_groups", {}).get(topic_group)
    if not isinstance(group, dict):
        raise UnknownKeyError(f"Unknown topic group: {topic_group}")
    keys = group.get("keys")
    if not isinstance(keys, list):
        raise ConfigurationError(f"Invalid keys for {topic_group}")
    found = False
    previous_active = group.get("active_kid")
    for item in keys:
        if not isinstance(item, dict):
            continue
        item_kid = item.get("kid")
        if item_kid == previous_active and item_kid != kid:
            item["state"] = KeyState.DECRYPT_ONLY.value
        if item_kid == kid:
            item["state"] = KeyState.ACTIVE.value
            found = True
    if not found:
        raise UnknownKeyError(f"Unknown DEK kid: {kid}")
    group["active_kid"] = kid
    _write_keyring(path, data)


def mark_decrypt_only(path: Path, *, topic_group: str, kid: str) -> None:
    """Mark a DEK decrypt-only (cannot seal new messages)."""
    _set_dek_state(path, topic_group=topic_group, kid=kid, state=KeyState.DECRYPT_ONLY)


def retire_dek(path: Path, *, topic_group: str, kid: str) -> None:
    """Retire a DEK (cannot seal or decrypt)."""
    data = _read_keyring(path)
    group = data.get("topic_groups", {}).get(topic_group)
    if isinstance(group, dict) and group.get("active_kid") == kid:
        raise InvalidKeyStateError("Cannot retire the active DEK; activate another key first")
    _set_dek_state(path, topic_group=topic_group, kid=kid, state=KeyState.RETIRED)


def revoke_dek(path: Path, *, topic_group: str, kid: str) -> None:
    """Revoke a DEK permanently."""
    data = _read_keyring(path)
    group = data.get("topic_groups", {}).get(topic_group)
    if isinstance(group, dict) and group.get("active_kid") == kid:
        raise InvalidKeyStateError("Cannot revoke the active DEK; activate another key first")
    _set_dek_state(path, topic_group=topic_group, kid=kid, state=KeyState.REVOKED)


def _set_dek_state(path: Path, *, topic_group: str, kid: str, state: KeyState) -> None:
    data = _read_keyring(path)
    group = data.get("topic_groups", {}).get(topic_group)
    if not isinstance(group, dict):
        raise UnknownKeyError(f"Unknown topic group: {topic_group}")
    keys = group.get("keys")
    if not isinstance(keys, list):
        raise ConfigurationError(f"Invalid keys for {topic_group}")
    for item in keys:
        if isinstance(item, dict) and item.get("kid") == kid:
            item["state"] = state.value
            _write_keyring(path, data)
            return
    raise UnknownKeyError(f"Unknown DEK kid: {kid}")


def validate_keyring(path: Path) -> list[str]:
    """Validate keyring structure and lifecycle invariants."""
    issues: list[str] = []
    try:
        provider = FileKeyringProvider.from_path(path)
    except ConfigurationError as exc:
        return [str(exc)]

    for group_name, group in provider.topic_groups.items():
        if group.active_kid is None:
            issues.append(f"{group_name}: no active DEK")
            continue
        active_state = group.keys.get(group.active_kid)
        if active_state is None:
            issues.append(f"{group_name}: active_kid {group.active_kid} not found")
        else:
            _dek, state = active_state
            if state != KeyState.ACTIVE:
                issues.append(f"{group_name}: active kid {group.active_kid} is not ACTIVE")
        active_count = sum(1 for _kid, (_d, st) in group.keys.items() if st == KeyState.ACTIVE)
        if active_count > 1:
            issues.append(f"{group_name}: multiple ACTIVE DEKs ({active_count})")

    if len(provider.signing_seed) != 32:
        issues.append("signing_seed_hex must be 32 bytes")
    return issues
