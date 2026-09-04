"""Timezone-aware UTC timestamp tests."""

from __future__ import annotations

from datetime import UTC

from tests.fixtures import test_vector

from secure_mqtt.persistence.database import utc_now, utc_now_iso
from secure_mqtt.persistence.inbox import InboxStore


def test_utc_now_is_timezone_aware() -> None:
    now = utc_now()
    assert now.tzinfo is not None
    assert now.tzinfo == UTC


def test_utc_now_iso_contains_offset() -> None:
    iso = utc_now_iso()
    assert "+00:00" in iso or iso.endswith("Z")


def test_inbox_timestamps_are_utc(tmp_db, sealed_envelope) -> None:
    inbox = InboxStore(tmp_db)
    record = inbox.insert_received(
        topic=test_vector.TOPIC,
        sender_id="device-001",
        msg_id=b"\xee" * 16,
        envelope=sealed_envelope.wire_bytes,
        plaintext=test_vector.PLAINTEXT,
        schema_id="sensor.temp.v1",
        content_type="application/json",
    )
    assert record is not None
    assert record.created_at.tzinfo is not None
    assert record.updated_at.tzinfo is not None
