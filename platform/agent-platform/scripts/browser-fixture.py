#!/usr/bin/env python3
"""AT-03 fixture against real PostgreSQL/API; never installed as product endpoints."""

import json
import os
import secrets
import sys
import time
from pathlib import Path
from uuid import UUID, uuid4

import psycopg
import uvicorn
from psycopg.types.json import Jsonb

from agent_platform.adapters import FakeAgentBackend
from agent_platform.api import create_app
from agent_platform.auth import bootstrap
from agent_platform.config import Settings
from agent_platform.db import Database, migrate
from agent_platform.domain import ProfileInput, ProjectInput, TaskInput
from agent_platform.store import Store, event
from agent_platform.worker import Worker


def main():
    url = os.environ["TEST_DATABASE_URL"]
    with psycopg.connect(url) as conn:
        if conn.info.dbname != "agent_platform_test":
            raise ValueError("dedicated_test_database_required")
    action = sys.argv[1]
    output = Path(__file__).resolve().parents[1] / ".artifacts/browser-fixture.json"
    if action == "serve":
        migrate(url)
    db = Database(url)
    db.open()
    try:
        if action == "serve":
            with db.transaction() as conn:
                conn.execute("TRUNCATE operators,projects,agent_profile_revisions CASCADE")
            password = secrets.token_urlsafe(32)
            operator = bootstrap(db, "browser-operator", password)
            store = Store(db)
            with db.transaction() as conn:
                project = store.create_project(
                    conn,
                    ProjectInput(
                        name="Browser fixture",
                        canonical_repo="https://example.invalid/browser/fixture",
                    ),
                )["body"]
                profile = store.create_profile(conn, ProfileInput(name="AT-03 burst"))["body"]
            task = TaskInput(
                title="100 durable events",
                goal="AT-03 reconnect",
                project_id=project["id"],
                profile_revision=profile["id"],
                base_sha="a" * 40,
            )
            value = store.command(
                operator,
                "tasks.create",
                uuid4().hex,
                task,
                lambda conn, command: store.create_task(conn, operator, task, command),
            )["body"]
            output.parent.mkdir(exist_ok=True)
            output.write_text(
                json.dumps(
                    {
                        "username": "browser-operator",
                        "password": password,
                        "task_id": value["task"]["id"],
                        "run_id": value["run"]["id"],
                    }
                )
            )
            output.chmod(0o600)
            uvicorn.run(
                create_app(
                    Settings(
                        url, origin="http://127.0.0.1:18600", insecure_local=True, stream_seconds=1
                    ),
                    db,
                    web_dist=Path(__file__).resolve().parents[1] / "web/dist",
                ),
                host="127.0.0.1",
                port=18600,
                access_log=False,
            )
        elif action == "produce":
            value = json.loads(output.read_text())
            run_id = UUID(value["run_id"])
            worker = Worker(db)
            claim = worker.claim()
            # One real fake-adapter prompt effect, then a timed source-event producer.
            with worker.owned(claim) as (conn, run):
                worker.sandbox.allocate(conn, run, f"{run_id}:allocate")
                backend = worker.agent.create(conn, run, f"{run_id}:conversation")
                conn.execute("UPDATE runs SET backend_ref=%s WHERE id=%s", (backend["ref"], run_id))
                worker.state(conn, run, "running")
                command = conn.execute(
                    "SELECT command_id FROM run_messages WHERE run_id=%s", (run_id,)
                ).fetchone()
                FakeAgentBackend().send_message(conn, run, str(command["command_id"]))
            for i in range(100):
                with worker.owned(claim) as (conn, run):
                    event(
                        conn,
                        run_id,
                        "fixture.event",
                        {"content": f"AT03 event {i + 1}"},
                        source="fake-burst",
                        source_id=str(i),
                    )
                time.sleep(0.05)
            with worker.owned(claim) as (conn, run):
                worker.state(conn, run, "finalizing")
                conn.execute(
                    "UPDATE runs SET result=%s WHERE id=%s",
                    (
                        Jsonb(
                            {
                                "summary": "100 events fixture",
                                "verification": {"status": "not_run", "reason": "AT03 only"},
                            }
                        ),
                        run_id,
                    ),
                )
                worker.state(conn, run, "succeeded")
                worker.sandbox.release(conn, run, f"{run_id}:release")
                conn.execute(
                    "UPDATE resource_reservations SET released_at=now() WHERE sandbox_id=%s",
                    (run["sandbox_id"],),
                )
                conn.execute("UPDATE runs SET cleanup_state='confirmed' WHERE id=%s", (run_id,))
                conn.execute("UPDATE jobs SET status='done' WHERE id=%s", (claim["job_id"],))
        elif action == "counts":
            with db.transaction() as conn:
                print(
                    json.dumps(
                        conn.execute(
                            "SELECT (SELECT count(*) FROM adapter_operations WHERE "
                            "kind='agent.prompt') AS prompts,(SELECT count(*) FROM "
                            "adapter_operations WHERE kind='sandbox.allocate') AS "
                            "allocations,(SELECT count(*) FROM run_events WHERE "
                            "source='fake-burst') AS events"
                        ).fetchone()
                    )
                )
    finally:
        db.close()


if __name__ == "__main__":
    main()
