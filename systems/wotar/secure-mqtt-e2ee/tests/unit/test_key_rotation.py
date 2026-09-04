"""DEK rotation via keyring admin operations."""

from __future__ import annotations

from pathlib import Path

import pytest

from secure_mqtt.errors import InvalidKeyStateError
from secure_mqtt.keys.keyring_admin import (
    activate_dek,
    add_pending_dek,
    list_keys,
    validate_keyring,
)
from secure_mqtt.keys.file_keyring import FileKeyringProvider
from secure_mqtt.keys.provider import KeyState


def test_rotation_activate_demotes_previous(tmp_path: Path) -> None:
    path = tmp_path / "keyring.json"
    FileKeyringProvider.write_keyring_atomic(
        path,
        {
            "sender_id": "device-1",
            "sig_kid": "sig-1",
            "signing_seed_hex": "01" * 32,
            "topic_groups": {
                "default": {
                    "active_kid": "dek-a",
                    "keys": [
                        {"kid": "dek-a", "dek_hex": "02" * 32, "state": KeyState.ACTIVE.value},
                    ],
                }
            },
        },
    )
    pending = add_pending_dek(path, topic_group="default")
    activate_dek(path, topic_group="default", kid=pending)
    entries = {entry.kid: entry for entry in list_keys(path)}
    assert entries[pending].is_active
    assert entries[pending].state == KeyState.ACTIVE.value
    assert entries["dek-a"].state == KeyState.DECRYPT_ONLY.value
    assert validate_keyring(path) == []


def test_cannot_retire_active_key(tmp_path: Path) -> None:
    path = tmp_path / "keyring.json"
    FileKeyringProvider.write_keyring_atomic(
        path,
        {
            "sender_id": "device-1",
            "sig_kid": "sig-1",
            "signing_seed_hex": "01" * 32,
            "topic_groups": {
                "default": {
                    "active_kid": "dek-a",
                    "keys": [
                        {"kid": "dek-a", "dek_hex": "02" * 32, "state": KeyState.ACTIVE.value},
                    ],
                }
            },
        },
    )
    from secure_mqtt.keys.keyring_admin import retire_dek

    with pytest.raises(InvalidKeyStateError):
        retire_dek(path, topic_group="default", kid="dek-a")
