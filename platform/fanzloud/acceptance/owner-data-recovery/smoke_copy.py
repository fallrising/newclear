"""Explicit synthetic-only integration test; requires local Docker and AP dependencies.

Creates only fresh synthetic data under /tmp. Never accepts private input arguments.
The read-only production launcher is unchanged; only seed construction writes its
own synthetic source. No provider/worker is involved. Not part of stdlib CI discovery.
"""

import hashlib
import json
import os
import sys
import tarfile
import tempfile
import time
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import copy_validation as cv
from test_copy_validation import CompareTests, database, uid

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "agent-platform/src"))
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb


def connect(socket):
    deadline = time.monotonic() + 35
    while True:
        try:
            return psycopg.connect(
                host=str(socket),
                user="postgres",
                dbname="postgres",
                connect_timeout=2,
                options="-c default_transaction_read_only=off",
            )
        except psycopg.OperationalError:
            if time.monotonic() > deadline:
                raise
            time.sleep(0.2)


def seed(conn, refs, observed):
    migration_dir = (
        Path(__file__).resolve().parents[3]
        / "agent-platform/src/agent_platform/migrations"
    )
    conn.execute(
        "CREATE TABLE schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())"
    )
    for path in sorted(migration_dir.glob("*.sql")):
        content = path.read_bytes()
        conn.execute(content.decode())
        conn.execute(
            "INSERT INTO schema_migrations(version,sha256) VALUES(%s,%s)",
            (path.name, hashlib.sha256(content).hexdigest()),
        )

    def insert(table, values):
        conn.execute(
            sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                sql.Identifier(table),
                sql.SQL(",").join(map(sql.Identifier, values)),
                sql.SQL(",").join(sql.Placeholder() for _ in values),
            ),
            [Jsonb(v) if isinstance(v, dict) else v for v in values.values()],
        )

    insert(
        "operators",
        {"id": uid(30), "username": "synthetic", "password_hash": "not-a-credential"},
    )
    insert(
        "projects",
        {
            "id": uid(40),
            "name": "synthetic",
            "canonical_repo": "https://invalid.example/fixture",
        },
    )
    for n, r in enumerate(refs):
        profile = r["receipt"]["run"]["profile_revision"]
        insert(
            "agent_profile_revisions",
            {
                "id": profile,
                "profile_id": profile,
                "revision": 1,
                "name": "synthetic",
                "backend": "fake",
                "model_ref": "fixture:m1",
                "template_digest": "fixture:m1",
                "tool_policy": {},
                "limits": {},
            },
        )
        insert("tasks", observed["tasks"][n])
        run = dict(observed["runs"][n], attempt_no=1, deadline="2030-01-01T00:00:00Z")
        if run.get("review_candidate"):
            run["review_candidate"] = bytes.fromhex(run["review_candidate"])
        insert("runs", run)
        binding = uid(100 + n)
        insert(
            "sandbox_bindings",
            {
                "id": binding,
                "run_id": run["id"],
                "node_id": "fake-local",
                "provider_handle": "fixture-" + str(n),
                "generation": 0,
                "desired_state": "stopped",
                "observed_state": "stopped",
                "lease_deadline": "2030-01-01T00:00:00Z",
                "cleanup_state": "confirmed",
            },
        )
        insert(
            "resource_reservations",
            {
                "sandbox_id": binding,
                "cpu": 1,
                "memory_bytes": 1,
                "disk_bytes": 1,
                "released_at": "2026-01-01T00:00:00Z",
            },
        )
        conn.execute("UPDATE runs SET sandbox_id=%s WHERE id=%s", (binding, run["id"]))
        insert("commands", dict(observed["commands"][n], id=uid(200 + n)))
    for archive in observed["archives"]:
        insert(
            "result_archives",
            dict(
                archive,
                payload=bytes.fromhex(archive["payload"]),
                mime="application/json",
                kind="result",
            ),
        )
    insert("review_lineages", observed["lineages"][0])
    conn.execute("UPDATE runtime_capacity SET draining=true")
    conn.commit()


def main():
    root = Path(tempfile.mkdtemp(prefix="fzcopy-smoke-", dir="/tmp"))
    root.chmod(0o700)
    private = Path(os.environ["COPY_SMOKE_RECEIPT"]).resolve()
    if private.exists():
        raise RuntimeError("receipt must be new")
    refs, observed, expected = CompareTests().fixture()
    (root / "seed").mkdir(mode=0o700)
    seed_packet = root / "seed"
    (seed_packet / "data").mkdir(mode=0o700)
    cv.setup_tools(seed_packet)
    # The only writable source mount in this test belongs to this newly created seed.
    (seed_packet / "tools/server.sh").write_text(
        "set -eu\n/usr/local/bin/initdb -D /source --no-locale --encoding=UTF8 --auth-local=trust --auth-host=reject -U postgres >&2\nexec /usr/local/bin/postgres -D /source -c config_file=/tools/postgresql.conf\n"
    )
    seed_name = "fz-copy-seed-" + uuid4().hex
    command = cv.container_command(seed_packet, seed_name, os.getuid(), os.getgid())
    command = [
        x.removesuffix(",readonly") if "target=/source," in x else x for x in command
    ]
    try:
        cv.docker(*command)
        cv.docker("start", seed_name)
        with connect(seed_packet / "socket") as conn:
            seed(conn, refs, observed)
        try:
            cv.docker(
                "exec",
                seed_name,
                "/usr/local/bin/pg_ctl",
                "-D",
                "/source",
                "-m",
                "fast",
                "-w",
                "stop",
            )
        except cv.Rejected:
            # The exec client can lose its process as PID1 exits. Require actual
            # clean server/container exit and removed PID file, never infer success.
            state = cv.inspect_owned(seed_name)["State"]
            if (
                state["Running"]
                or state["ExitCode"] != 0
                or (seed_packet / "data/postmaster.pid").exists()
            ):
                raise
    finally:
        if not cv.cleanup(seed_name):
            raise RuntimeError("seed cleanup unknown")
    archive = root / "synthetic.tar"
    with tarfile.open(archive, "w", format=tarfile.USTAR_FORMAT) as tar:
        tar.add(seed_packet / "data", arcname=".")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    sqlite = root / "synthetic.sqlite"
    database(sqlite, refs)
    packet = root / "check"
    loaded = cv.stage(archive, digest, sqlite, packet)
    readonly = []
    original_collect = cv.collect

    def checked_collect(conn, refs):
        try:
            with conn.transaction():
                conn.execute("CREATE TABLE forbidden_synthetic_write(id integer)")
        except psycopg.errors.ReadOnlySqlTransaction:
            readonly.append(True)
        return original_collect(conn, refs)

    with (
        patch.object(cv, "EXPECTED_ARCHIVES", expected),
        patch.object(
            cv, "DIFF_SHA256", hashlib.sha256(b"synthetic diff\n").hexdigest()
        ),
        patch.object(cv, "collect", checked_collect),
    ):
        result = cv.execute(packet, loaded, "postgres", "postgres")
    if result["status"] != "logical_candidate_verified" or readonly != [True]:
        # Paths and any server exceptions are private smoke evidence only.
        cv.private_write(
            private,
            json.dumps(
                {
                    "status": "failed",
                    "root": str(root),
                    "result": result,
                    "readonly": readonly,
                }
            ).encode(),
        )
        raise RuntimeError("synthetic logical check failed; inspect private receipt")
    timeout_packet = root / "deadline"
    cv.stage(archive, digest, sqlite, timeout_packet)
    cv.setup_tools(timeout_packet)
    name = "fz-copy-deadline-" + uuid4().hex
    started = time.monotonic()
    try:
        # Docker create/start return immediately: no host watchdog issues a stop.
        cv.docker(*cv.container_command(timeout_packet, name, os.getuid(), os.getgid()))
        cv.check_boundary(cv.inspect_owned(name), timeout_packet)
        cv.docker("start", name)
        with connect(timeout_packet / "socket") as conn:
            conn.execute("SELECT 1")
        running = cv.inspect_owned(name)["State"]["Running"]
        while (
            cv.inspect_owned(name)["State"]["Running"]
            and time.monotonic() - started < 140
        ):
            time.sleep(1)
        state = cv.inspect_owned(name)["State"]
        elapsed = round(time.monotonic() - started, 2)
        if not running or state["Running"] or not 110 <= elapsed <= 140:
            raise RuntimeError("independent deadline failed")
    finally:
        stopped = cv.cleanup(name)
    if not stopped:
        raise RuntimeError("deadline cleanup unknown")
    unchanged = hashlib.sha256(archive.read_bytes()).hexdigest() == digest
    receipt = {
        "status": "passed",
        "root_private": str(root),
        "image": cv.IMAGE,
        "logical": result,
        "readonly_enforced": readonly == [True],
        "source_unchanged": unchanged,
        "deadline_elapsed_seconds": elapsed,
        "deadline_exit": state["ExitCode"],
        "cleanup_confirmed": stopped,
        "private_candidate_used": False,
    }
    cv.private_write(private, json.dumps(receipt, sort_keys=True, indent=2).encode())
    print(
        json.dumps(
            {k: v for k, v in receipt.items() if k != "root_private"}, sort_keys=True
        )
    )


if __name__ == "__main__":
    main()
