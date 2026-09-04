"""Extended inbox retry and dead-letter tests."""

from __future__ import annotations

from pathlib import Path

from secure_mqtt.persistence.database import Database
from secure_mqtt.persistence.inbox import InboxState, InboxStore


def test_inbox_retry_and_dead_letter(tmp_path: Path) -> None:
    db = Database(tmp_path / "inbox.db")
    store = InboxStore(db, max_retries=2, retry_base_seconds=0.01)
    record = store.insert_received(
        topic="t/1",
        sender_id="s1",
        msg_id=b"\x01" * 16,
        envelope=b"env",
        plaintext=b"plain",
        schema_id="s.v1",
        content_type="text/plain",
    )
    assert record is not None
    claimed = store.claim_pending(limit=10)
    assert len(claimed) == 1
    store.schedule_retry(claimed[0].id, "handler failed")
    retry_row = db.connection.execute(
        "SELECT state FROM inbox WHERE id = ?", (claimed[0].id,)
    ).fetchone()
    assert retry_row is not None
    assert retry_row["state"] in (InboxState.RETRY.value, InboxState.PENDING.value)
    store.schedule_retry(claimed[0].id, "again")
    store.schedule_retry(claimed[0].id, "final")
    dead = db.connection.execute(
        "SELECT state FROM inbox WHERE id = ?", (claimed[0].id,)
    ).fetchone()
    assert dead is not None
    assert dead["state"] == InboxState.DEAD.value
    db.close()


def test_inbox_duplicate_returns_none(tmp_path: Path) -> None:
    db = Database(tmp_path / "dup.db")
    store = InboxStore(db)
    kwargs = dict(
        topic="t",
        sender_id="s",
        msg_id=b"\xab" * 16,
        envelope=b"e",
        plaintext=b"p",
        schema_id="x",
        content_type="text/plain",
    )
    assert store.insert_received(**kwargs) is not None
    assert store.insert_received(**kwargs) is None
    db.close()
