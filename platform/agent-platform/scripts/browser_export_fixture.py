"""Test-only export fixture: real API/DB/worker and synthetic loopback GitHub."""

import json
import sys
from pathlib import Path
from uuid import uuid4

from agent_platform.domain import TaskInput
from agent_platform.store import Store
from agent_platform.worker import Worker

COMPONENT = Path(__file__).resolve().parents[1]


def fixture_types():
    sys.path.insert(0, str(COMPONENT / "tests_platform"))
    from github_export_fixture import FakeGitHub, LoopbackOpener

    return FakeGitHub, LoopbackOpener


def start_fake():
    fake, _ = fixture_types()
    return fake(files={})


def seed(db, value):
    remote = value["export_fixture"]
    store = Store(db)
    with db.transaction() as conn:
        template = conn.execute(
            "SELECT t.project_id,r.profile_revision FROM runs r "
            "JOIN tasks t ON t.id=r.task_id WHERE r.id=%s",
            (value["run_id"],),
        ).fetchone()
        operator = conn.execute(
            "SELECT id FROM operators WHERE username=%s", (value["username"],)
        ).fetchone()["id"]
    task = TaskInput(
        title="Explicit export browser fixture",
        goal=(
            "FILE export-note.txt\nTEXT approved export\n<script>window.__exportExecuted=1</script>"
        ),
        project_id=template["project_id"],
        profile_revision=template["profile_revision"],
        base_sha=remote["base_sha"],
    )
    created = store.command(
        operator,
        "tasks.create",
        uuid4().hex,
        task,
        lambda conn, command: store.create_task(conn, operator, task, command),
    )["body"]
    with db.transaction() as conn:
        conn.execute(
            "UPDATE jobs SET available_at=now()-interval '1 day' WHERE run_id=%s",
            (created["run"]["id"],),
        )
    worker = Worker(db)
    claim = worker.claim()
    if str(claim["run_id"]) != created["run"]["id"]:
        raise AssertionError("export fixture claimed another run")
    worker.execute(claim)
    run = store.run(created["run"]["id"])
    if run["state"] != "succeeded" or run["cleanup_state"] != "confirmed":
        raise AssertionError("export source did not complete")
    return {"task_id": created["task"]["id"], "run": run, **remote}


def export_action(action, db, output):
    from agent_platform.export_worker import ExportWorker
    from agent_platform.github_client import GitHubClient

    value = json.loads(output.read_text())
    if action == "export":
        print(json.dumps(seed(db, value), default=str))
        return
    remote = value["export_fixture"]
    _, opener_type = fixture_types()
    opener = opener_type(remote["url"])

    class LosePullResponse:
        def open(self, request, timeout):
            response = opener.open(request, timeout=timeout)
            if request.get_method() == "POST" and request.full_url.endswith("/pulls"):
                response.read()
                response.close()
                raise TimeoutError("synthetic lost response after remote PR creation")
            return response

    client = GitHubClient(
        "synthetic-export-token",
        opener=LosePullResponse() if action == "export-dispatch-lost-pr" else opener,
    )
    if action in {"export-dispatch", "export-dispatch-lost-pr"}:
        worker = ExportWorker(
            db, ({"repo": remote["repo"], "base_branch": remote["base_branch"]},), client
        )
        print(json.dumps({"processed": worker.run_once()}))
    elif action == "export-observe":
        pulls = client.request("GET", f"/repos/{remote['repo']}/pulls?state=all&per_page=100")
        with db.transaction() as conn:
            operations = conn.execute(
                "SELECT id,run_id,state,branch FROM github_exports ORDER BY created_at"
            ).fetchall()
        observations = client.request("GET", f"/repos/{remote['repo']}/_fixture/observations")
        print(json.dumps({"pulls": pulls, "operations": operations, **observations}, default=str))
    else:
        raise ValueError("unknown_export_fixture_action")
