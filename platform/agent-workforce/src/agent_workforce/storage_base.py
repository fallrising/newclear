"""Shared SQLite boundary and transaction primitives for the offline core."""
from contextlib import contextmanager
import fcntl
import json
import math
import os
from pathlib import Path
import sqlite3
import threading

class StoreError(ValueError):
    """Invalid durable-store operation."""

class ConflictError(StoreError):
    """Immutable identity or a held resource conflicts."""

class StaleFenceError(StoreError):
    """A former lease owner cannot publish current state."""

DDL = """
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,key));
CREATE TABLE IF NOT EXISTS inbox (receipt_id TEXT PRIMARY KEY, sender TEXT NOT NULL, message_id TEXT NOT NULL, recipient TEXT NOT NULL, payload_digest TEXT NOT NULL, envelope TEXT NOT NULL, UNIQUE(sender,message_id,recipient));
CREATE TABLE IF NOT EXISTS outbox (outbox_id TEXT PRIMARY KEY, message_id TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, payload_digest TEXT NOT NULL, payload TEXT NOT NULL, receipt_id TEXT, UNIQUE(sender,message_id,recipient));
CREATE TABLE IF NOT EXISTS commands (command_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, step_id TEXT NOT NULL, input_digest TEXT NOT NULL, input_payload TEXT NOT NULL, worker_id TEXT NOT NULL, route_policy TEXT NOT NULL, grant_id TEXT NOT NULL, state TEXT NOT NULL, UNIQUE(job_id,step_id));
CREATE TABLE IF NOT EXISTS attempts (attempt_id TEXT PRIMARY KEY, command_id TEXT NOT NULL REFERENCES commands(command_id), operation_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, route TEXT NOT NULL, grant_snapshot TEXT NOT NULL, controller_epoch INTEGER NOT NULL, fence INTEGER NOT NULL, lease_until REAL NOT NULL, stop_proven INTEGER NOT NULL DEFAULT 0, effects_resolved INTEGER NOT NULL DEFAULT 0, result TEXT, lease_expired INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS reservations (reservation_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id), kind TEXT NOT NULL, key TEXT NOT NULL, capacity INTEGER NOT NULL, released INTEGER NOT NULL DEFAULT 0, UNIQUE(attempt_id,kind,key));
CREATE TABLE IF NOT EXISTS audit (event_id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL);
"""

def text_value(value):
    if not isinstance(value, str) or not value or "\x00" in value:
        raise StoreError("nonempty text required")
    return value

def finite_time(value):
    if type(value) not in (int, float):
        raise StoreError("finite time required")
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise StoreError("finite time required")
    return value

def positive_int(value):
    if type(value) is not int or not 1 <= value <= 2**63-1:
        raise StoreError("positive SQLite integer required")
    return value

class StorageBase:
    """One controller per database inode, with serialized nested transactions."""
    def __init__(self, path, *, fault=None):
        self.fault = fault
        self._lock = threading.RLock()
        self._depth = 0
        self._db = None
        self._instance_fd = None
        self.path = str(path)
        try:
            if self.path != ":memory:":
                target = Path(self.path).resolve()
                target.parent.mkdir(parents=True, exist_ok=True)
                self.path = str(target)
                self._instance_fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
                try:
                    fcntl.flock(self._instance_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError as exc:
                    raise ConflictError("controller instance lock is already active") from exc
            self._db = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False)
            self._db.row_factory = sqlite3.Row
            self._db.execute("PRAGMA foreign_keys=ON")
            version = self._db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                raise StoreError("unsupported schema version")
            self._db.executescript(DDL)
            columns = {row["name"] for row in self._db.execute("PRAGMA table_info(attempts)")}
            if "lease_expired" not in columns:
                self._db.execute("ALTER TABLE attempts ADD COLUMN lease_expired INTEGER NOT NULL DEFAULT 0")
            self._db.execute("PRAGMA user_version=1")
            with self.transaction():
                self._db.execute("INSERT OR IGNORE INTO metadata(key,value) VALUES('controller_epoch',0)")
                self._db.execute("INSERT OR IGNORE INTO metadata(key,value) VALUES('fence',0)")
                self._db.execute("UPDATE metadata SET value=value+1 WHERE key='controller_epoch'")
                self.controller_epoch = self._db.execute("SELECT value FROM metadata WHERE key='controller_epoch'").fetchone()[0]
        except (OSError, sqlite3.Error) as exc:
            self.close()
            raise StoreError("cannot open durable store") from exc
        except BaseException:
            self.close()
            raise

    def close(self):
        with self._lock:
            if self._db is not None:
                self._db.close()
                self._db = None
            if self._instance_fd is not None:
                os.close(self._instance_fd)
                self._instance_fd = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    @contextmanager
    def transaction(self):
        with self._lock:
            if self._db is None:
                raise StoreError("store is closed")
            level = self._depth
            name = "wf_savepoint_" + str(level)
            self._db.execute("BEGIN IMMEDIATE" if level == 0 else "SAVEPOINT " + name)
            self._depth += 1
            try:
                yield self
                self._db.execute("COMMIT" if level == 0 else "RELEASE " + name)
            except BaseException:
                if level == 0:
                    if self._db.in_transaction:
                        self._db.execute("ROLLBACK")
                else:
                    self._db.execute("ROLLBACK TO " + name)
                    self._db.execute("RELEASE " + name)
                raise
            finally:
                self._depth -= 1

    def _json(self, value):
        def plain(item, depth=0):
            if depth > 40:
                raise StoreError("JSON nesting limit exceeded")
            if item is None or type(item) in (bool, str, int):
                return
            if type(item) is float and math.isfinite(item):
                return
            if type(item) is list:
                for child in item:
                    plain(child, depth+1)
                return
            if type(item) is dict and all(type(k) is str for k in item):
                for child in item.values():
                    plain(child, depth+1)
                return
            raise StoreError("finite JSON values required")
        plain(value)
        try:
            encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
            if len(encoded.encode("utf-8")) > 65536:
                raise StoreError("JSON payload limit exceeded")
            return encoded
        except (TypeError, ValueError, UnicodeError) as exc:
            raise StoreError("invalid or oversized JSON payload") from exc

    def _check_fault(self, point):
        if self.fault is not None:
            self.fault(point)

    def _audit(self, kind, payload):
        self._check_fault("audit_before_write")
        self._db.execute("INSERT INTO audit(kind,payload) VALUES(?,?)", (kind, self._json(payload)))

    def _next_fence(self):
        self._db.execute("UPDATE metadata SET value=value+1 WHERE key='fence'")
        return self._db.execute("SELECT value FROM metadata WHERE key='fence'").fetchone()[0]

    def audit_rows(self):
        with self._lock:
            return [{"event_id": row["event_id"], "kind": row["kind"], "action": row["kind"], "payload": json.loads(row["payload"])}
                    for row in self._db.execute("SELECT * FROM audit ORDER BY event_id")]
