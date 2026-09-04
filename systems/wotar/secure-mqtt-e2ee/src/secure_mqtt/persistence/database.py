"""SQLite persistence with WAL mode."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path


def utc_now() -> datetime:
    """Return current timezone-aware UTC timestamp."""
    return datetime.now(UTC)


def utc_now_iso() -> str:
    """Return ISO-8601 UTC timestamp."""
    return utc_now().isoformat()


SCHEMA_VERSION = 1

_SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS schema_meta (
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sender_state (
    sender_id TEXT PRIMARY KEY,
    next_seq INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    topic_group TEXT NOT NULL,
    msg_id BLOB NOT NULL,
    seq INTEGER NOT NULL,
    envelope BLOB NOT NULL,
    state TEXT NOT NULL,
    mqtt_mid INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(sender_id, msg_id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_state ON outbox(state);

CREATE TABLE IF NOT EXISTS inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    msg_id BLOB NOT NULL,
    envelope BLOB NOT NULL,
    plaintext BLOB,
    schema_id TEXT NOT NULL,
    content_type TEXT NOT NULL,
    state TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(sender_id, msg_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_state_retry ON inbox(state, next_retry_at);

CREATE TABLE IF NOT EXISTS replay (
    sender_id TEXT NOT NULL,
    msg_id BLOB NOT NULL,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (sender_id, msg_id)
);
"""


class Database:
    """SQLite connection wrapper with schema initialization."""

    def __init__(self, path: Path) -> None:
        self.path = path.expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._initialize()

    @property
    def connection(self) -> sqlite3.Connection:
        return self._conn

    def _initialize(self) -> None:
        with self._conn:
            self._conn.executescript(_SCHEMA_SQL)
            row = self._conn.execute("SELECT version FROM schema_meta LIMIT 1").fetchone()
            if row is None:
                self._conn.execute(
                    "INSERT INTO schema_meta(version) VALUES (?)",
                    (SCHEMA_VERSION,),
                )

    def close(self) -> None:
        self._conn.close()
