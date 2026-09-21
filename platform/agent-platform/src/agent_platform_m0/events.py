"""A private probe journal proving replay de-duplication, not production storage."""

import hashlib
import json
import os
import sqlite3
from pathlib import Path

from .transport import ProbeError


class Journal:
    def __init__(self, path: Path):
        # Refuse overwrite/symlinks; a run owns a fresh output directory.
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        self.db = sqlite3.connect(path)
        self.db.execute(
            "CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, "
            "event_id TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL)"
        )

    def append(self, event: dict) -> bool:
        event_id = event.get("id")
        if not isinstance(event_id, str) or not event_id or len(event_id) > 256:
            raise ProbeError("event_missing_stable_id")
        fingerprint = hashlib.sha256(
            json.dumps(event, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        existing = self.db.execute(
            "SELECT fingerprint FROM events WHERE event_id=?", (event_id,)
        ).fetchone()
        if existing:
            if existing[0] != fingerprint:
                raise ProbeError("event_id_payload_conflict")
            return False
        with self.db:
            self.db.execute(
                "INSERT INTO events(event_id, fingerprint) VALUES (?, ?)",
                (event_id, fingerprint),
            )
        return True

    def count(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM events").fetchone()[0]

    def close(self):
        self.db.close()
