"""Replay guard persistence tests."""

from __future__ import annotations

import pytest
from tests.fixtures import test_vector

from secure_mqtt.errors import ReplayError
from secure_mqtt.persistence.replay import ReplayGuard


def test_replay_guard_records_new_message(tmp_db) -> None:
    guard = ReplayGuard(tmp_db)
    assert guard.check_and_record("device-001", test_vector.MSG_ID) is True
    assert guard.has_seen("device-001", test_vector.MSG_ID)


def test_replay_guard_rejects_duplicate(tmp_db) -> None:
    guard = ReplayGuard(tmp_db)
    guard.check_and_record("device-001", test_vector.MSG_ID)
    with pytest.raises(ReplayError):
        guard.check_and_record("device-001", test_vector.MSG_ID)
