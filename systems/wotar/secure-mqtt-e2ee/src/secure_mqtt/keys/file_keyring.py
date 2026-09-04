"""Self-managed file keyring provider (official key path)."""

from __future__ import annotations

import json
import os
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from secure_mqtt.crypto import signing
from secure_mqtt.crypto.key_material import KeyMaterial
from secure_mqtt.errors import ConfigurationError, InvalidKeyStateError, UnknownKeyError
from secure_mqtt.keys.provider import KeyState


def _check_posix_permissions(path: Path) -> None:
    """Fail closed when keyring path is group/world accessible."""
    if os.name != "posix":
        return
    mode = path.stat().st_mode
    if path.is_dir():
        if mode & (stat.S_IRWXG | stat.S_IRWXO):
            msg = f"Keyring directory permissions too open: {path}"
            raise ConfigurationError(msg)
        return
    if mode & (stat.S_IRGRP | stat.S_IWGRP | stat.S_IROTH | stat.S_IWOTH):
        msg = f"Keyring file permissions too open: {path}"
        raise ConfigurationError(msg)


def _parse_key_state(value: str) -> KeyState:
    try:
        return KeyState(value)
    except ValueError as exc:
        msg = f"Invalid key state: {value}"
        raise ConfigurationError(msg) from exc


@dataclass
class _TopicGroupEntry:
    active_kid: str | None
    keys: dict[str, tuple[bytes, KeyState]]


@dataclass
class FileKeyringProvider:
    """Load DEK keyring and signing seed from a self-managed JSON keyring file.

    This is the official key management path: operators own the keyring file,
    distribute it out-of-band (or as a self-encrypted blob), and may point any
    MQTT broker profile at the same key material. Endpoint compromise exposes
    the keyring — that is an explicit trust-boundary trade-off.
    """

    keyring_path: Path
    sender_id: str
    sig_kid: str
    signing_seed: bytes
    topic_groups: dict[str, _TopicGroupEntry]
    _signing_key: Ed25519PrivateKey | None = None

    @classmethod
    def from_path(cls, keyring_path: Path) -> FileKeyringProvider:
        path = keyring_path.expanduser().resolve()
        if not path.exists():
            msg = f"Keyring file not found: {path}"
            raise ConfigurationError(msg)
        parent = path.parent
        _check_posix_permissions(parent)
        _check_posix_permissions(path)
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls._from_mapping(path, data)

    @classmethod
    def _from_mapping(cls, path: Path, data: dict[str, Any]) -> FileKeyringProvider:
        sender_id = data.get("sender_id")
        sig_kid = data.get("sig_kid")
        signing_seed_hex = data.get("signing_seed_hex")
        topic_groups_raw = data.get("topic_groups")
        if not isinstance(sender_id, str) or not sender_id:
            raise ConfigurationError("Keyring missing sender_id")
        if not isinstance(sig_kid, str) or not sig_kid:
            raise ConfigurationError("Keyring missing sig_kid")
        if not isinstance(signing_seed_hex, str):
            raise ConfigurationError("Keyring missing signing_seed_hex")
        if not isinstance(topic_groups_raw, dict):
            raise ConfigurationError("Keyring missing topic_groups")
        signing_seed = bytes.fromhex(signing_seed_hex)
        if len(signing_seed) != 32:
            raise ConfigurationError("signing_seed_hex must be 32 bytes")

        topic_groups: dict[str, _TopicGroupEntry] = {}
        for group_name, group_data in topic_groups_raw.items():
            if not isinstance(group_data, dict):
                raise ConfigurationError(f"Invalid topic group entry: {group_name}")
            active_kid = group_data.get("active_kid")
            keys_raw = group_data.get("keys")
            if not isinstance(keys_raw, list):
                raise ConfigurationError(f"topic_groups.{group_name}.keys must be a list")
            keys: dict[str, tuple[bytes, KeyState]] = {}
            for item in keys_raw:
                if not isinstance(item, dict):
                    raise ConfigurationError("Key entry must be an object")
                kid = item.get("kid")
                dek_hex = item.get("dek_hex")
                state_raw = item.get("state", KeyState.ACTIVE.value)
                if not isinstance(kid, str) or not isinstance(dek_hex, str):
                    raise ConfigurationError("Key entry missing kid or dek_hex")
                dek = bytes.fromhex(dek_hex)
                state = _parse_key_state(str(state_raw))
                keys[kid] = (dek, state)
            topic_groups[group_name] = _TopicGroupEntry(
                active_kid=str(active_kid) if active_kid else None,
                keys=keys,
            )
        return cls(
            keyring_path=path,
            sender_id=sender_id,
            sig_kid=sig_kid,
            signing_seed=signing_seed,
            topic_groups=topic_groups,
        )

    @classmethod
    def write_keyring_atomic(cls, keyring_path: Path, data: dict[str, Any]) -> None:
        """Atomically write keyring JSON with restrictive POSIX permissions."""
        path = keyring_path.expanduser().resolve()
        parent = path.parent
        parent.mkdir(parents=True, exist_ok=True)
        if os.name == "posix":
            parent.chmod(0o700)
        payload = json.dumps(data, indent=2, sort_keys=True).encode("utf-8")
        fd, tmp_name = tempfile.mkstemp(prefix=".keyring.", suffix=".tmp", dir=parent)
        tmp_path = Path(tmp_name)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            if os.name == "posix":
                os.chmod(tmp_path, 0o600)
            os.replace(tmp_path, path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    def get_signing_key(self) -> Ed25519PrivateKey:
        if self._signing_key is None:
            self._signing_key = signing.private_key_from_seed(self.signing_seed)
        return self._signing_key

    def has_active_dek(self, topic_group: str) -> bool:
        group = self.topic_groups.get(topic_group)
        return group is not None and group.active_kid is not None

    def get_active_dek(self, topic_group: str) -> KeyMaterial:
        group = self.topic_groups.get(topic_group)
        if group is None or group.active_kid is None:
            raise UnknownKeyError(f"No active DEK for topic group {topic_group}")
        kid = group.active_kid
        dek, state = group.keys[kid]
        if state != KeyState.ACTIVE:
            raise InvalidKeyStateError(f"DEK {kid} is not active")
        return KeyMaterial(kid=kid, secret=dek)

    def get_dek_for_decrypt(self, topic_group: str, kid: str) -> KeyMaterial:
        group = self.topic_groups.get(topic_group)
        if group is None or kid not in group.keys:
            raise UnknownKeyError(f"Unknown DEK {kid} for topic group {topic_group}")
        dek, state = group.keys[kid]
        if state not in (KeyState.ACTIVE, KeyState.DECRYPT_ONLY):
            raise InvalidKeyStateError(f"DEK {kid} cannot decrypt")
        return KeyMaterial(kid=kid, secret=dek)


# Backward-compatible alias (deprecated name).
LocalDevKeyProvider = FileKeyringProvider
