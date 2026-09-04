"""Inbox handler retry and dead-letter policy tests."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from tests.fixtures import test_vector

from secure_mqtt.persistence.inbox import InboxState, InboxStore


def test_handler_failure_schedules_retry(tmp_db, sealed_envelope) -> None:
    inbox = InboxStore(tmp_db, max_retries=5, retry_base_seconds=0.01)
    record = inbox.insert_received(
        topic=test_vector.TOPIC,
        sender_id="device-001",
        msg_id=test_vector.MSG_ID,
        envelope=sealed_envelope.wire_bytes,
        plaintext=test_vector.PLAINTEXT,
        schema_id="sensor.temp.v1",
        content_type="application/json",
    )
    assert record is not None
    claimed = inbox.claim_pending(limit=1)
    assert len(claimed) == 1
    state = inbox.schedule_retry(claimed[0].id, "ValueError")
    assert state == InboxState.RETRY
    row = tmp_db.connection.execute(
        "SELECT state, retry_count FROM inbox WHERE id = ?",
        (claimed[0].id,),
    ).fetchone()
    assert row is not None
    assert row["state"] == InboxState.RETRY.value
    assert int(row["retry_count"]) == 1


def test_exhausted_retries_become_dead_letter(tmp_db, sealed_envelope) -> None:
    inbox = InboxStore(tmp_db, max_retries=2, retry_base_seconds=0.01)
    record = inbox.insert_received(
        topic=test_vector.TOPIC,
        sender_id="device-001",
        msg_id=b"\xcc" * 16,
        envelope=sealed_envelope.wire_bytes,
        plaintext=test_vector.PLAINTEXT,
        schema_id="sensor.temp.v1",
        content_type="application/json",
    )
    assert record is not None
    inbox.claim_pending(limit=1)
    inbox.schedule_retry(record.id, "err1")
    inbox.schedule_retry(record.id, "err2")
    final = inbox.schedule_retry(record.id, "err3")
    assert final == InboxState.DEAD
    row = tmp_db.connection.execute(
        "SELECT state FROM inbox WHERE id = ?",
        (record.id,),
    ).fetchone()
    assert row is not None
    assert row["state"] == InboxState.DEAD.value


def test_retry_becomes_claimable_after_next_retry_at(tmp_db, sealed_envelope) -> None:
    inbox = InboxStore(tmp_db, max_retries=5, retry_base_seconds=0.01)
    record = inbox.insert_received(
        topic=test_vector.TOPIC,
        sender_id="device-001",
        msg_id=b"\xdd" * 16,
        envelope=sealed_envelope.wire_bytes,
        plaintext=test_vector.PLAINTEXT,
        schema_id="sensor.temp.v1",
        content_type="application/json",
    )
    assert record is not None
    inbox.claim_pending(limit=1)
    inbox.schedule_retry(record.id, "transient")
    past = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
    tmp_db.connection.execute(
        "UPDATE inbox SET next_retry_at = ?, state = ? WHERE id = ?",
        (past, InboxState.RETRY.value, record.id),
    )
    tmp_db.connection.commit()
    claimed = inbox.claim_pending(limit=5)
    assert any(r.id == record.id for r in claimed)
