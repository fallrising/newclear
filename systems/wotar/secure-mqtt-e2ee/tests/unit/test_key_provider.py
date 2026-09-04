"""Key provider lifecycle and fail-closed behavior."""

from __future__ import annotations

import pytest
from tests.fixtures import test_vector

from secure_mqtt.errors import InvalidKeyStateError, UnknownKeyError
from secure_mqtt.keys.memory import InMemoryKeyProvider
from secure_mqtt.keys.provider import KeyState


def test_active_dek_roundtrip(in_memory_keys: InMemoryKeyProvider) -> None:
    material = in_memory_keys.get_active_dek("vector1")
    assert material.kid == "dek-v1-test"
    assert material.as_bytes() == test_vector.DEK


def test_unknown_topic_group_raises(in_memory_keys: InMemoryKeyProvider) -> None:
    with pytest.raises(UnknownKeyError):
        in_memory_keys.get_active_dek("missing")


def test_retired_dek_cannot_decrypt(in_memory_keys: InMemoryKeyProvider) -> None:
    in_memory_keys.add_dek("vector1", "dek-old", test_vector.DEK, state=KeyState.RETIRED)
    with pytest.raises(InvalidKeyStateError):
        in_memory_keys.get_dek_for_decrypt("vector1", "dek-old")


def test_decrypt_only_can_decrypt_but_not_seal(in_memory_keys: InMemoryKeyProvider) -> None:
    in_memory_keys.add_dek("vector1", "dek-old", b"\x09" * 32, state=KeyState.DECRYPT_ONLY)
    in_memory_keys.topic_groups["vector1"].active_kid = "dek-old"
    with pytest.raises(InvalidKeyStateError):
        in_memory_keys.get_active_dek("vector1")
    material = in_memory_keys.get_dek_for_decrypt("vector1", "dek-old")
    assert material.kid == "dek-old"


def test_no_active_dek_has_active_false(in_memory_keys: InMemoryKeyProvider) -> None:
    in_memory_keys.topic_groups.clear()
    assert not in_memory_keys.has_active_dek("vector1")
