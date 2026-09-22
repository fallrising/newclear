#!/usr/bin/env python3
"""Opt-in worker SIGKILL recovery on the same real VM; no provider credentials.

Requires an empty dedicated zero-warm node, running connector, and isolated test
PostgreSQL. Fault injection is confined to this acceptance driver.
"""

import argparse
import json
import os
import secrets
import signal
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient

import agent_platform.runtime_worker as runtime_worker
from agent_platform.api import create_app
from agent_platform.auth import bootstrap
from agent_platform.config import Settings
from agent_platform.connector_journal import private_file
from agent_platform.db import Database, migrate
from agent_platform.runtime_client import RuntimeClient
from agent_platform.store import Store
from agent_platform.worker import Worker
from agent_platform_m0.kvm_lifecycle import Host
from agent_platform_m0.sandbox_client import SingleNodeClient


def require(value, code):
    if not value:
        raise RuntimeError(code)


def long_command_fixture(config, run):
    # Acceptance-only replacement of the guest-local fixture model. Product code
    # still supplies the pinned Agent Server, tool loop, connector and VM lifecycle.
    row = json.loads((Path(config["state_dir"]) / (str(run["id"]) + ".json")).read_text())
    node = SingleNodeClient(
        config["origin"], private_file(config["sandbox_token_file"]).read_text().strip()
    )
    handle = row["handle"]
    sb = node.attach(handle["owner"], handle["id"], handle["token"])
    sb.exec(
        "python3",
        "-c",
        (
            "import os,signal;from pathlib import Path;"
            "[(os.kill(int(p.name),signal.SIGTERM)) for p in Path('/proc').iterdir() "
            "if p.name.isdigit() and (p/'cmdline').exists() "
            "and b'/tmp/guest_fixture.py' in (p/'cmdline').read_bytes().split(bytes([0]))]"
        ),
        timeout=15,
    )
    command = (
        'python3 -c "from pathlib import Path; import time; '
        "Path('/tmp/m3-long-command').write_text('ready'); time.sleep(120)\""
    )
    program = (
        "from http.server import ThreadingHTTPServer\nimport guest_fixture\n"
        + f"guest_fixture.COMMAND = {command!r}\n"
        + "ThreadingHTTPServer(('127.0.0.1',18080),guest_fixture.Handler).serve_forever()\n"
    )
    sb.write_file("/tmp/cancel_fixture.py", program.encode(), mode=0o644)
    sb.spawn(
        "python3",
        "/tmp/cancel_fixture.py",
        user="agentprobe",
        env={"FIXTURE_RUN_ID": str(run["id"])},
    )
    sb.exec(
        "python3",
        "-c",
        "import socket,time\n"
        "for _ in range(50):\n"
        " try:\n"
        "  s=socket.create_connection(('127.0.0.1',18080),.2);s.close();break\n"
        " except OSError: time.sleep(.1)\n"
        "else: raise RuntimeError('fixture_not_ready')\n",
        timeout=15,
    )


def child(args, config, db):
    def boundary(point):
        if point == args.worker_fault:
            (args.output / "ready").write_text(point)
            os.kill(os.getpid(), signal.SIGSTOP)

    class FaultClient(RuntimeClient):
        def allocate(self, run):
            result = super().allocate(run)
            boundary("after_allocate")
            return result

        def operation(self, run, action):
            if action == "prompt" and args.scenario == "cancel":
                long_command_fixture(config, run)
            result = super().operation(run, action)
            if action == "prompt":
                boundary("after_prompt")
            return result

    original = runtime_worker.event

    def event(*values, **kwargs):
        result = original(*values, **kwargs)
        if kwargs.get("source") == "openhands":
            boundary("before_event_commit")
        return result

    runtime_worker.event = event
    client = FaultClient(
        args.origin, private_file(config["connector_token_file"]).read_text().strip()
    )
    Worker(db, client).run_once()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--scenario", choices=["recovery", "cancel", "approval"], default="recovery"
    )
    parser.add_argument(
        "--worker-fault", choices=["after_allocate", "after_prompt", "before_event_commit"]
    )
    args = parser.parse_args()
    config = json.loads(private_file(args.config).read_text())
    url = os.environ["TEST_DATABASE_URL"]
    with psycopg.connect(url) as conn:
        require(conn.info.dbname == "agent_platform_test", "dedicated_test_database_required")
    db = Database(url)
    if args.worker_fault:
        db.open()
        try:
            child(args, config, db)
        finally:
            db.close()
        return 0
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    host = Host(Path(config["cocoon_config"]), Path(config["sandbox_data_dir"]))
    node = SingleNodeClient(
        config["origin"], private_file(config["sandbox_token_file"]).read_text().strip()
    )
    require(not node.sandboxes() and not host.vms(), "dedicated_node_must_be_empty")
    require(all(p["target"] == 0 for p in node.info()["pools"]), "warm_pool_not_zero")
    migrate(url)
    db.open()
    client = RuntimeClient(
        args.origin, private_file(config["connector_token_file"]).read_text().strip()
    )
    report = {
        "schema_version": 1,
        "started_at": datetime.now(UTC).isoformat(),
        "transport": "cocoon-kvm-platform-" + args.scenario,
        "template": config["template"],
        "cases": [],
        "passed": False,
    }
    issued = []
    try:
        with db.transaction() as conn:
            conn.execute("TRUNCATE operators,projects,agent_profile_revisions CASCADE")
        password = secrets.token_urlsafe(32)
        bootstrap(db, "recovery-operator", password)
        client.register(db)
        settings = Settings(url, origin="https://testserver")
        with TestClient(create_app(settings, db), base_url=settings.origin) as api:
            csrf = api.get("/api/v1/session").json()["csrf_token"]
            login = api.post(
                "/api/v1/session",
                json={"username": "recovery-operator", "password": password},
                headers={"Origin": settings.origin, "X-CSRF-Token": csrf},
            )
            require(login.status_code == 200, "login_failed")
            headers = {"Origin": settings.origin, "X-CSRF-Token": login.json()["csrf_token"]}

            def post(path, value):
                response = api.post(
                    "/api/v1" + path,
                    json=value,
                    headers={**headers, "Idempotency-Key": uuid4().hex},
                )
                require(response.status_code in {200, 201, 202}, "api_" + str(response.status_code))
                return response.json()

            repo = config["repositories"][0]
            project = post(
                "/projects", {"name": "Recovery KVM", "canonical_repo": repo["canonical_repo"]}
            )
            profile = post(
                "/agent-profiles",
                {
                    "name": "Recovery KVM",
                    "backend": "openhands",
                    "deadline_seconds": 300,
                    "require_approval": args.scenario == "approval",
                },
            )
            points = ["after_allocate", "after_prompt"]
            if args.scenario == "recovery":
                points.append("before_event_commit")
            for point in points:
                run = post(
                    "/tasks",
                    {
                        "project_id": project["id"],
                        "profile_revision": profile["id"],
                        "title": "M3 " + point,
                        "goal": "Run the fixed edit fixture",
                        "base_sha": repo["base_sha"],
                    },
                )["run"]
                issued.append(run["id"])
                ready = args.output / "ready"
                ready.unlink(missing_ok=True)
                with (args.output / (point + ".log")).open("w") as log:
                    process = subprocess.Popen(
                        [
                            sys.executable,
                            str(Path(__file__).resolve()),
                            "--config",
                            str(args.config),
                            "--origin",
                            args.origin,
                            "--output",
                            str(args.output),
                            "--worker-fault",
                            point,
                            "--scenario",
                            args.scenario,
                        ],
                        stdout=log,
                        stderr=log,
                    )
                    try:
                        deadline = time.monotonic() + 150
                        while not ready.exists():
                            require(
                                process.poll() is None and time.monotonic() < deadline,
                                "worker_did_not_reach_fault:" + point,
                            )
                            time.sleep(0.1)
                        process.kill()
                        require(process.wait(timeout=10) == -signal.SIGKILL, "worker_not_killed")
                    finally:
                        if process.poll() is None:
                            process.kill()
                            process.wait(timeout=10)
                journal = Path(config["state_dir"]) / (run["id"] + ".json")
                before = json.loads(journal.read_text())
                initial_vm = before["observed"]
                require(len(host.vms()) == len(node.sandboxes()) == 1, "one_vm_required")
                require(Store(db).runtime()["occupied"] == 1, "lost_reservation")
                old = Store(db).run(run["id"])
                if args.scenario == "cancel":
                    if point == "after_prompt":
                        handle = before["handle"]
                        sb = node.attach(handle["owner"], handle["id"], handle["token"])
                        sb.exec(
                            "python3",
                            "-c",
                            "from pathlib import Path\nimport time\n"
                            "for _ in range(100):\n"
                            " if Path('/tmp/m3-long-command').exists(): break\n"
                            " time.sleep(.1)\n"
                            "else: raise RuntimeError('long_command_not_started')\n",
                            timeout=15,
                        )
                    accepted = post(
                        f"/runs/{run['id']}/actions",
                        {
                            "action": "cancel",
                            "expected_state_version": old["state_version"],
                        },
                    )
                    require(accepted["status"] == "pending", "cancel_not_pending")
                    require(Store(db).runtime()["occupied"] == 1, "capacity_released_before_stop")
                    start = time.monotonic()
                    Worker(db, client).run_once()
                    elapsed = time.monotonic() - start
                    view = Store(db).run(run["id"])
                    require(
                        view["state"] == "cancelled" and view["cleanup_state"] == "confirmed",
                        "cancel_not_observed:" + str(view["reason"]),
                    )
                    require(view["result"] is None, "cancel_invented_result")
                    require(Store(db).runtime()["occupied"] == 0, "cancel_capacity_not_released")
                    after = json.loads(journal.read_text())
                    require(after["handle"] == before["handle"], "cancel_replaced_instance")
                    report["cases"].append(
                        {
                            "fault": point,
                            "run_id": run["id"],
                            "vm_id": initial_vm["vm_id"],
                            "state": view["state"],
                            "generation": view["generation"],
                            "long_terminal_command": point == "after_prompt",
                            "cancel_seconds": round(elapsed, 3),
                            "proof": host.wait_removed(initial_vm),
                        }
                    )
                    print("cancel_" + point + ": passed", flush=True)
                    continue
                # Fault harness advances only this dead worker's lease, avoiding a 30 s wait.
                with db.transaction() as conn:
                    conn.execute(
                        "UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second' "
                        "WHERE run_id=%s",
                        (run["id"],),
                    )
                worker = Worker(db, client)
                worker.reconcile_expired()
                claim = worker.claim()
                require(
                    claim and claim["recovery"] and claim["generation"] == 2,
                    "not_same_run_recovery",
                )
                with worker.owned(claim) as (conn, current):
                    lease = dict(current)
                client.fence(lease)
                try:
                    client.operation(old, "prompt")
                except Exception:
                    pass
                else:
                    raise RuntimeError("stale_generation_accepted")
                if args.scenario == "approval":
                    from approval_kvm import exercise

                    choice = "approve" if point == "after_allocate" else "deny"
                    report["cases"].append(
                        exercise(
                            db, client, api, post, run, before, node, host, claim, worker, choice
                        )
                    )
                    after = json.loads(journal.read_text())
                    require(after["handle"] == before["handle"], "approval_replaced_instance")
                    applied = [k for k in after["operations"] if k.startswith("approval:")]
                    require(
                        len(applied) == (1 if choice == "approve" else 0), "approval_count_mismatch"
                    )
                    print("approval_" + choice + ": passed", flush=True)
                    continue
                worker.execute(claim)
                view = Store(db).run(run["id"])
                require(view["state"] == "succeeded", "recovery_failed:" + str(view["reason"]))
                require(
                    view["generation"] == 2 and view["cleanup_state"] == "confirmed",
                    "recovery_cleanup_failed",
                )
                require(view["result"]["workspace_value"] == run["id"] + "\n", "wrong_workspace")
                after = json.loads(journal.read_text())
                require(
                    after["observed"] == initial_vm and before["handle"] == after["handle"],
                    "instance_replaced",
                )
                require(
                    all(v["state"] == "completed" for v in after["operations"].values()),
                    "operation_uncertain",
                )
                with db.transaction() as conn:
                    source = conn.execute(
                        "SELECT source_event_id,payload FROM run_events WHERE run_id=%s "
                        "AND source='openhands'",
                        (run["id"],),
                    ).fetchall()
                require(
                    source and len(source) == len({r["source_event_id"] for r in source}),
                    "event_gap_or_duplicates",
                )
                user_events = sum(
                    row["payload"].get("kind") == "MessageEvent"
                    and json.loads(row["payload"]["content"]).get("source") == "user"
                    for row in source
                )
                require(user_events == 1, "initial_prompt_not_unique")
                require(Store(db).runtime()["occupied"] == 0, "capacity_not_released")
                proof = host.wait_removed(initial_vm)
                report["cases"].append(
                    {
                        "fault": point,
                        "run_id": run["id"],
                        "vm_id": initial_vm["vm_id"],
                        "generation": view["generation"],
                        "same_instance": True,
                        "event_count": len(source),
                        "user_message_count": user_events,
                        "diff_sha256": view["result"]["diff_sha256"],
                        "proof": proof,
                        "operations": {k: v["state"] for k, v in after["operations"].items()},
                    }
                )
                print(point + ": passed", flush=True)
            report["passed"] = True
    except Exception as exc:
        report["error"] = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
        print("KVM recovery failed:", report["error"], flush=True)
    finally:
        errors = []
        for identifier in issued:
            path = Path(config["state_dir"]) / (identifier + ".json")
            if not path.exists():
                continue
            row = json.loads(path.read_text())
            try:
                if row.get("handle") and row.get("observed"):
                    handle = row["handle"]
                    node.attach(handle["owner"], handle["id"], handle["token"]).close()
                    host.wait_removed(row["observed"])
            except Exception:
                errors.append(identifier)
        report["cleanup_errors"] = errors
        report["vm_count_after"] = len(host.vms())
        report["claim_count_after"] = len(node.sandboxes())
        report["passed"] &= (
            not errors and report["vm_count_after"] == report["claim_count_after"] == 0
        )
        report["finished_at"] = datetime.now(UTC).isoformat()
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        db.close()
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
