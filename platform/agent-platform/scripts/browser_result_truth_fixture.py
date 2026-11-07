"""Owned Worker-to-browser fixture; scripted HTTP is not a VM or verifier run.

The stdin-held process keeps one existing Runtime double alive until browser
observations finish. No maintenance endpoint, SQL lifecycle rewrite or reset.
"""

import hashlib
import json
import os
import secrets
import signal
import stat
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.encoders import jsonable_encoder
from psycopg import sql

from agent_platform.domain import ProfileInput, TaskInput
from agent_platform.result_archive import read_archive
from agent_platform.store import Store
from agent_platform.worker import Worker

COMPONENT = Path(__file__).resolve().parents[1]
TABLES = (
    "runs",
    "jobs",
    "sandbox_bindings",
    "result_archives",
    "run_events",
    "run_event_identities",
    "adapter_operations",
    "run_messages",
)


def require(condition):
    if not condition:
        raise AssertionError("result_truth_fixture_ownership_or_state_mismatch")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def json_rows(conn, table, *, run_ids=None, column="run_id"):
    query = sql.SQL("SELECT to_jsonb(t) AS value FROM {} t").format(sql.Identifier(table))
    if run_ids is not None:
        query += sql.SQL(" WHERE {}=ANY(%s::uuid[])").format(sql.Identifier(column))
    rows = conn.execute(query, (run_ids,) if run_ids is not None else ()).fetchall()
    return sorted(json.dumps(row["value"], sort_keys=True) for row in rows)


def snapshot(db, run_ids):
    with db.transaction() as conn:
        require(conn.info.dbname == "agent_platform_test")
        result = {
            table: json_rows(
                conn, table, run_ids=run_ids, column="id" if table == "runs" else "run_id"
            )
            for table in TABLES
        }
        result["resource_reservations"] = json_rows(conn, "resource_reservations")
        for table in ("commands", "github_exports", "runtime_capacity", "runtime_catalog"):
            result[table] = json_rows(conn, table)
        result["identity"] = str(
            conn.execute("SELECT id FROM maintenance_identity").fetchone()["id"]
        )
    return result


def effects(runtime):
    actions = runtime.actions("/operations")
    return {
        "allocate": len(runtime.allocations),
        **{action: actions.count(action) for action in ("prepare", "prompt", "result", "release")},
        "cancel": sum(path.endswith("/cancel") for _, path, _ in runtime.calls),
    }


def result(base, kind):
    patch_text = (
        f"diff --git a/{kind}.txt b/{kind}.txt\nnew file mode 100644\n"
        f"--- /dev/null\n+++ b/{kind}.txt\n@@ -0,0 +1 @@\n+scripted {kind}\n"
    )
    verification = {"status": "unknown", "reason": "verification_not_configured", "checks": []}
    if kind == "failed":
        verification = {
            "status": "failed",
            "reason": "check_failed",
            "name": "scripted_check",
            "checks": [
                {
                    "id": "nonzero",
                    "status": "failed",
                    "exit_code": 7,
                    "duration_ms": 1,
                    "output_bytes": 0,
                    "output_sha256": hashlib.sha256(b"").hexdigest(),
                    "reason": "check_exit_nonzero",
                }
            ],
        }
    return {
        "execution_mode": "cocoon-fixture",
        "base_sha": base,
        "summary": "Untrusted agent claim: tests passed <img src=x onerror=window.__truthClaim=1>"
        if kind == "unknown"
        else f"Scripted {kind} result",
        "diff": patch_text,
        "diff_bytes": len(patch_text.encode()),
        "diff_sha256": hashlib.sha256(patch_text.encode()).hexdigest(),
        "verification": verification,
    }


def execute_exact(worker, expected):
    claim = worker.claim()
    require(claim is not None and str(claim.get("run_id")) == str(expected))
    require(not claim.get("expired"))
    worker.execute(claim)


def prepare(db, fixture, runtime, nonce):
    store = Store(db)
    # Complete only the normal bootstrap task via its actual fake Worker.
    execute_exact(Worker(db), fixture["run_id"])
    bootstrap = store.run(fixture["run_id"])
    require(bootstrap["state"] == "succeeded" and bootstrap["cleanup_state"] == "confirmed")
    runtime.client.register(db)
    with db.transaction() as conn:
        source = conn.execute(
            "SELECT t.project_id,t.created_by FROM tasks t WHERE id=%s", (fixture["task_id"],)
        ).fetchone()
        require(source is not None)
        require(conn.execute("SELECT count(*) AS n FROM github_exports").fetchone()["n"] == 0)
    cases = {}
    for kind in ("failed", "unknown", "fault"):
        profile_input = {"name": f"Truth {kind} {nonce}", "backend": "openhands"}
        if kind == "failed":
            profile_input["verification"] = {
                "mode": "commands",
                "checks": [{"id": "nonzero", "argv": ["false"], "timeout_seconds": 1}],
            }
        with db.transaction() as conn:
            profile = store.create_profile(conn, ProfileInput(**profile_input))["body"]
        task = TaskInput(
            title=f"Worker truth {kind} {nonce}",
            goal=f"Scripted {kind} outcome",
            project_id=source["project_id"],
            profile_revision=profile["id"],
            base_sha=runtime.base_sha,
        )
        created = store.command(
            source["created_by"],
            "tasks.create",
            uuid4().hex,
            task,
            lambda conn, command, task=task: store.create_task(
                conn, source["created_by"], task, command
            ),
        )["body"]
        run_id = created["run"]["id"]
        runtime.result = result(runtime.base_sha, kind)
        worker = Worker(db, runtime.client)
        if kind == "fault":
            with patch(
                "agent_platform.runtime_worker.persist_archive",
                side_effect=RuntimeError("synthetic persist boundary failure"),
            ):
                execute_exact(worker, run_id)
        else:
            execute_exact(worker, run_id)
        actual = store.run(run_id)
        actions = [
            body["action"]
            for _, path, body in runtime.calls
            if path == f"/v1/runs/{run_id}/operations"
        ]
        require(
            actions == ["prepare", "prompt", "result"] + ([] if kind == "fault" else ["release"])
        )
        item = {
            "task_id": created["task"]["id"],
            "run_id": run_id,
            "title": task.title,
            "run": jsonable_encoder(actual),
        }
        with db.transaction() as conn:
            job = conn.execute("SELECT status FROM jobs WHERE run_id=%s", (run_id,)).fetchone()
            archives = conn.execute(
                "SELECT id,sha256,size FROM result_archives WHERE run_id=%s", (run_id,)
            ).fetchall()
            held = conn.execute(
                "SELECT count(*) AS n FROM resource_reservations rr JOIN "
                "sandbox_bindings b ON b.id=rr.sandbox_id "
                "WHERE b.run_id=%s AND rr.released_at IS NULL",
                (run_id,),
            ).fetchone()["n"]
        if kind == "fault":
            require(
                actual["state"] == "interrupted" and actual["reason"] == "artifact_persist_failed"
            )
            require(actual["result"] is None and actual["cleanup_state"] == "unknown")
            require(job["status"] == "interrupted" and not archives and held == 1)
        else:
            require(actual["state"] == "failed" and actual["cleanup_state"] == "confirmed")
            require(
                actual["reason"]
                == ("verification_failed" if kind == "failed" else "verification_unverified")
            )
            require(actual["result"] == runtime.result and job["status"] == "done" and held == 0)
            require(len(archives) == 1)
            payload = read_archive(db, run_id, archives[0]["id"])
            require(hashlib.sha256(payload).hexdigest() == archives[0]["sha256"])
            require(
                len(payload) == archives[0]["size"]
                and json.loads(payload)["result"] == actual["result"]
            )
            item["archive"] = {**archives[0], "id": str(archives[0]["id"])}
        cases[kind] = item
    require(
        effects(runtime)
        == {"allocate": 3, "prepare": 3, "prompt": 3, "result": 3, "release": 2, "cancel": 0}
    )
    require(Store(db).runtime()["occupied"] == 1)
    return cases


def hold_result_truth(db, output):
    fixture = json.loads(output.read_text())
    require(output.stat().st_size < 16384)
    manifest_path = output.with_name("browser-result-truth-" + digest(fixture)[:16] + ".json")
    sys.path.insert(0, str(COMPONENT / "tests_platform"))
    from worker_tools_fixture import Runtime

    old_handlers = {}
    try:
        for sig in (signal.SIGTERM, signal.SIGINT):
            old_handlers[sig] = signal.signal(sig, lambda *_: sys.exit(0))
        with ExitStack() as resources:
            resources.enter_context(patch.dict(os.environ, {"MODEL_PROXY_CONFIG": ""}))
            with db.transaction() as conn:
                require(conn.info.dbname == "agent_platform_test")
                template = conn.execute(
                    "SELECT p.canonical_repo,r.base_sha FROM runs r "
                    "JOIN tasks t ON t.id=r.task_id JOIN projects p ON p.id=t.project_id "
                    "WHERE r.id=%s",
                    (fixture["run_id"],),
                ).fetchone()
                require(template is not None)
            runtime = Runtime(template["canonical_repo"], template["base_sha"])
            resources.callback(runtime.close)
            nonce = secrets.token_hex(12)
            cases = prepare(db, fixture, runtime, nonce)
            ids = [fixture["run_id"], *(item["run_id"] for item in cases.values())]
            baseline = snapshot(db, ids)
            calls_hash = digest(runtime.calls)
            manifest = {
                "boot": digest(fixture),
                "nonce": nonce,
                "cases": cases,
                "snapshot": baseline,
                "calls": calls_hash,
                "effects": effects(runtime),
            }
            encoded = json.dumps(manifest, default=str).encode()
            require(len(encoded) < 262144)
            fd = os.open(manifest_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as target:
                target.write(encoded)

            def observe():
                info = manifest_path.lstat()
                require(
                    stat.S_ISREG(info.st_mode)
                    and info.st_uid == os.getuid()
                    and info.st_mode & 0o777 == 0o600
                    and info.st_nlink == 1
                    and info.st_size < 262144
                )
                require(
                    manifest_path.read_bytes() == encoded
                    and digest(json.loads(output.read_text())) == manifest["boot"]
                )
                require(snapshot(db, ids) == baseline and digest(runtime.calls) == calls_hash)
                require(
                    effects(runtime) == manifest["effects"] and Store(db).runtime()["occupied"] == 1
                )
                return {
                    "owned": True,
                    "unchanged": True,
                    "occupied": 1,
                    "exports": 0,
                    "effects": effects(runtime),
                    "runtime_calls": len(runtime.calls),
                }

            print(
                json.dumps({"ready": True, "cases": cases, "observation": observe()}, default=str),
                flush=True,
            )
            while True:
                raw = sys.stdin.buffer.readline(4097)
                if not raw:
                    break
                require(len(raw) <= 4096)
                command = json.loads(raw)
                require(type(command) is dict and set(command) == {"action"})
                if command["action"] == "observe":
                    print(json.dumps(observe()), flush=True)
                elif command["action"] == "close":
                    print(json.dumps({"closed": True}), flush=True)
                    break
                else:
                    raise ValueError("unknown_result_truth_command")
    finally:
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
