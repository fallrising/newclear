"""Persistent replay deduplication."""

from __future__ import annotations

import sqlite3

from secure_mqtt.errors import ReplayError
from secure_mqtt.persistence.database import Database, utc_now_iso


class ReplayGuard:
    """Track seen (sender_id, msg_id) pairs with UNIQUE constraint."""

    def __init__(self, database: Database) -> None:
        self._db = database

    def check_and_record(self, sender_id: str, msg_id: bytes) -> bool:
        """
        Record message identity.

        Returns True when message is new. Raises ReplayError on duplicate.
        """
        try:
            with self._db.connection:
                self._db.connection.execute(
                    "INSERT INTO replay(sender_id, msg_id, seen_at) VALUES (?, ?, ?)",
                    (sender_id, msg_id, utc_now_iso()),
                )
        except sqlite3.IntegrityError as exc:
            raise ReplayError("Duplicate message detected") from exc
        return True

    def has_seen(self, sender_id: str, msg_id: bytes) -> bool:
        row = self._db.connection.execute(
            "SELECT 1 FROM replay WHERE sender_id = ? AND msg_id = ?",
            (sender_id, msg_id),
        ).fetchone()
        return row is not None
