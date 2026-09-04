"""Durable inbox for receive-side handler processing."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum

from secure_mqtt.persistence.database import Database, utc_now, utc_now_iso


class InboxState(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    RETRY = "retry"
    DEAD = "dead"


@dataclass(frozen=True)
class InboxRecord:
    """Inbox row with decrypted plaintext for handler retries."""

    id: int
    topic: str
    sender_id: str
    msg_id: bytes
    envelope: bytes
    plaintext: bytes | None
    schema_id: str
    content_type: str
    state: InboxState
    retry_count: int
    next_retry_at: datetime | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime


class InboxStore:
    """Insert and process inbox rows with retry policy."""

    def __init__(
        self,
        database: Database,
        *,
        max_retries: int = 5,
        retry_base_seconds: float = 1.0,
    ) -> None:
        self._db = database
        self._max_retries = max_retries
        self._retry_base_seconds = retry_base_seconds

    def insert_received(
        self,
        *,
        topic: str,
        sender_id: str,
        msg_id: bytes,
        envelope: bytes,
        plaintext: bytes,
        schema_id: str,
        content_type: str,
    ) -> InboxRecord | None:
        """
        Insert decrypted message before handler execution.

        Returns None when UNIQUE(sender_id, msg_id) already exists.
        """
        now_iso = utc_now_iso()
        try:
            with self._db.connection:
                cursor = self._db.connection.execute(
                    """
                    INSERT INTO inbox(
                        topic, sender_id, msg_id, envelope, plaintext, schema_id,
                        content_type, state, retry_count, next_retry_at, last_error,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
                    """,
                    (
                        topic,
                        sender_id,
                        msg_id,
                        envelope,
                        plaintext,
                        schema_id,
                        content_type,
                        InboxState.PENDING.value,
                        now_iso,
                        now_iso,
                    ),
                )
                row_id = cursor.lastrowid
                if row_id is None:
                    raise ValueError("Failed to allocate inbox row")
                inbox_id = int(row_id)
        except sqlite3.IntegrityError:
            return None

        return InboxRecord(
            id=inbox_id,
            topic=topic,
            sender_id=sender_id,
            msg_id=msg_id,
            envelope=envelope,
            plaintext=plaintext,
            schema_id=schema_id,
            content_type=content_type,
            state=InboxState.PENDING,
            retry_count=0,
            next_retry_at=None,
            last_error=None,
            created_at=utc_now(),
            updated_at=utc_now(),
        )

    def claim_pending(self, limit: int = 32) -> list[InboxRecord]:
        now_iso = utc_now_iso()
        with self._db.connection:
            rows = self._db.connection.execute(
                """
                SELECT * FROM inbox
                WHERE state IN (?, ?)
                  AND (next_retry_at IS NULL OR next_retry_at <= ?)
                ORDER BY id ASC
                LIMIT ?
                """,
                (InboxState.PENDING.value, InboxState.RETRY.value, now_iso, limit),
            ).fetchall()
            claimed: list[InboxRecord] = []
            for row in rows:
                updated = self._db.connection.execute(
                    """
                    UPDATE inbox
                    SET state = ?, updated_at = ?
                    WHERE id = ? AND state IN (?, ?)
                    """,
                    (
                        InboxState.PROCESSING.value,
                        now_iso,
                        int(row["id"]),
                        InboxState.PENDING.value,
                        InboxState.RETRY.value,
                    ),
                ).rowcount
                if updated:
                    claimed.append(self._row_to_record(row, state=InboxState.PROCESSING))
        return claimed

    def mark_done(self, inbox_id: int) -> None:
        with self._db.connection:
            self._db.connection.execute(
                "UPDATE inbox SET state = ?, updated_at = ? WHERE id = ?",
                (InboxState.DONE.value, utc_now_iso(), inbox_id),
            )

    def schedule_retry(self, inbox_id: int, error: str) -> InboxState:
        row = self._db.connection.execute(
            "SELECT retry_count FROM inbox WHERE id = ?",
            (inbox_id,),
        ).fetchone()
        if row is None:
            msg = f"Inbox row {inbox_id} not found"
            raise ValueError(msg)
        retry_count = int(row["retry_count"]) + 1
        if retry_count > self._max_retries:
            with self._db.connection:
                self._db.connection.execute(
                    """
                    UPDATE inbox
                    SET state = ?, retry_count = ?, last_error = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (InboxState.DEAD.value, retry_count, error, utc_now_iso(), inbox_id),
                )
            return InboxState.DEAD

        delay = self._retry_base_seconds * (2 ** (retry_count - 1))
        next_retry = utc_now() + timedelta(seconds=delay)
        with self._db.connection:
            self._db.connection.execute(
                """
                UPDATE inbox
                SET state = ?, retry_count = ?, next_retry_at = ?, last_error = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    InboxState.RETRY.value,
                    retry_count,
                    next_retry.isoformat(),
                    error,
                    utc_now_iso(),
                    inbox_id,
                ),
            )
        return InboxState.RETRY

    def release_processing(self, inbox_id: int) -> None:
        with self._db.connection:
            self._db.connection.execute(
                """
                UPDATE inbox
                SET state = ?, updated_at = ?
                WHERE id = ? AND state = ?
                """,
                (InboxState.PENDING.value, utc_now_iso(), inbox_id, InboxState.PROCESSING.value),
            )

    def _row_to_record(self, row: sqlite3.Row, *, state: InboxState | None = None) -> InboxRecord:
        next_retry_raw = row["next_retry_at"]
        next_retry = (
            datetime.fromisoformat(str(next_retry_raw)).astimezone(UTC)
            if next_retry_raw is not None
            else None
        )
        return InboxRecord(
            id=int(row["id"]),
            topic=str(row["topic"]),
            sender_id=str(row["sender_id"]),
            msg_id=bytes(row["msg_id"]),
            envelope=bytes(row["envelope"]),
            plaintext=bytes(row["plaintext"]) if row["plaintext"] is not None else None,
            schema_id=str(row["schema_id"]),
            content_type=str(row["content_type"]),
            state=state if state is not None else InboxState(str(row["state"])),
            retry_count=int(row["retry_count"]),
            next_retry_at=next_retry,
            last_error=str(row["last_error"]) if row["last_error"] is not None else None,
            created_at=datetime.fromisoformat(str(row["created_at"])).astimezone(UTC),
            updated_at=datetime.fromisoformat(str(row["updated_at"])).astimezone(UTC),
        )
