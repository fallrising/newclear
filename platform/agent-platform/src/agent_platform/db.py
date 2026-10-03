"""Transactions, versioned SQL migrations, and bounded connection pooling."""

import hashlib
from importlib.resources import files

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


class Database:
    def __init__(self, url):
        self.pool = ConnectionPool(
            url,
            min_size=1,
            max_size=16,
            max_waiting=32,
            timeout=5,
            open=False,
            kwargs={
                "row_factory": dict_row,
                "connect_timeout": 5,
                "options": "-c timezone=UTC -c statement_timeout=10000 -c lock_timeout=5000",
            },
            check=ConnectionPool.check_connection,
        )

    def open(self):
        self.pool.open()
        self.pool.wait(timeout=10)

    def close(self):
        self.pool.close()

    def transaction(self):
        return self.pool.connection()


def migrate(url):
    with psycopg.connect(url) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(77310401)")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(version text PRIMARY KEY, sha256 text NOT NULL, "
            "applied_at timestamptz NOT NULL DEFAULT now())"
        )
        for path in sorted(files("agent_platform").joinpath("migrations").iterdir(), key=str):
            if not path.name.endswith(".sql"):
                continue
            content = path.read_text()
            digest = hashlib.sha256(content.encode()).hexdigest()
            row = conn.execute(
                "SELECT sha256 FROM schema_migrations WHERE version=%s", (path.name,)
            ).fetchone()
            if row:
                if row[0] != digest:
                    raise ValueError("Applied migration checksum changed: " + path.name)
                continue
            conn.execute(content)
            conn.execute(
                "INSERT INTO schema_migrations(version,sha256) VALUES (%s,%s)",
                (path.name, digest),
            )
