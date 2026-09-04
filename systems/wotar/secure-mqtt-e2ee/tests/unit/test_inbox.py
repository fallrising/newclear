"""Inbox insert and deduplication."""

from __future__ import annotations

from tests.fixtures import test_vector

from secure_mqtt.persistence.inbox import InboxState, InboxStore


def test_insert_received_creates_pending_row(tmp_db, sealed_envelope) -> None:
    inbox = InboxStore(tmp_db)
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
    assert record.state == InboxState.PENDING
    assert record.plaintext == test_vector.PLAINTEXT


def test_insert_duplicate_returns_none(tmp_db, sealed_envelope) -> None:
    inbox = InboxStore(tmp_db)
    first = inbox.insert_received(
        topic=test_vector.TOPIC,
        sender_id="device-001",
        msg_id=test_vector.MSG_ID,
        envelope=sealed_envelope.wire_bytes,
        plaintext=test_vector.PLAINTEXT,
        schema_id="sensor.temp.v1",
        content_type="application/json",
    )
    second = inbox.insert_received(
        topic=test_vector.TOPIC,
        sender_id="device-001",
        msg_id=test_vector.MSG_ID,
        envelope=sealed_envelope.wire_bytes,
        plaintext=test_vector.PLAINTEXT,
        schema_id="sensor.temp.v1",
        content_type="application/json",
    )
    assert first is not None
    assert second is None
