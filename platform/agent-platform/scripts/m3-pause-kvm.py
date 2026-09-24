#!/usr/bin/env python3
"""Opt-in safe pause/resume on a dedicated real zero-warm KVM node.

Only the deterministic guest model is delayed for acceptance. Product connector,
Agent Server, terminal, process attestation and DB command flow are unchanged.
"""

import argparse
import json
import os
import secrets
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient

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


def wait(check, seconds=90):
    deadline = time.monotonic() + seconds
    while not (value := check()):
        require(time.monotonic() < deadline, "acceptance_wait_expired")
        time.sleep(0.1)
    return value


def fixture(sb, run_id, case):
    sb.exec(
        "python3",
        "-c",
        (
            "import os,signal;from pathlib import Path;"
            "[(os.kill(int(p.name),signal.SIGTERM)) for p in Path('/proc').iterdir() "
            "if p.name.isdigit() and (p/'cmdline').exists() "
            "and b'/opt/agent-platform/guest_fixture.py' "
            "in (p/'cmdline').read_bytes().split(bytes([0]))]"
        ),
        timeout=15,
    )
    source = (
        Path("src/agent_platform/guest_fixture.py")
        .read_text()
        .replace("time.sleep(1)", "time.sleep(5)")
    )
    if case in {"background", "inflight"}:
        command = (
            'python3 -c "from pathlib import Path;import time;'
            "Path('/tmp/pause-tool-started').write_text('yes');time.sleep(8)\"; "
        )
        if case == "background":
            command = (
                'python3 -c "from pathlib import Path;import subprocess;'
                "p=subprocess.Popen(['python3','-c','import ctypes,time;"
                "assert ctypes.CDLL(None).prctl(4,0)==0;time.sleep(15)'],"
                "stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);"
                "Path('/tmp/pause-hidden-pid').write_text(str(p.pid));"
                "Path('/tmp/pause-tool-started').write_text('yes')\"; "
            )
        source = source.replace(
            "class Handler(", "COMMAND = " + repr(command) + " + COMMAND\n\nclass Handler("
        )
    sb.write_file("/opt/agent-platform/pause_fixture.py", source.encode(), mode=0o644)
    sb.spawn(
        "python3",
        "-I",
        "/opt/agent-platform/pause_fixture.py",
        user="agentcontrol",
        cwd="/var/lib/agent-platform/control",
        env={"FIXTURE_RUN_ID": run_id},
    )
    sb.exec(
        "python3",
        "-c",
        "import socket,time\nfor _ in range(50):\n try:\n"
        "  s=socket.create_connection(('127.0.0.1',18080),.2);s.close();break\n"
        " except OSError: time.sleep(.1)\nelse: raise RuntimeError('fixture_not_ready')\n",
        timeout=15,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--case", choices=["automatic", "approval", "background", "inflight", "cancel", "deadline"]
    )
    args = parser.parse_args()
    config = json.loads(private_file(args.config).read_text())
    url = os.environ["TEST_DATABASE_URL"]
    with psycopg.connect(url) as conn:
        require(conn.info.dbname == "agent_platform_test", "dedicated_test_database_required")
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    host = Host(Path(config["cocoon_config"]), Path(config["sandbox_data_dir"]))
    node = SingleNodeClient(
        config["origin"], private_file(config["sandbox_token_file"]).read_text().strip()
    )
    require(not node.sandboxes() and not host.vms(), "dedicated_node_must_be_empty")
    require(all(p["target"] == 0 for p in node.info()["pools"]), "warm_pool_not_zero")
    migrate(url)
    db = Database(url)
    db.open()
    issued, threads = [], []
    report = {
        "schema_version": 1,
        "started_at": datetime.now(UTC).isoformat(),
        "transport": "cocoon-kvm-platform-pause",
        "template": config["template"],
        "cases": [],
        "passed": False,
    }

    def journal(run_id):
        return json.loads((Path(config["state_dir"]) / (run_id + ".json")).read_text())

    class Client(RuntimeClient):
        case = None

        def operation(self, run, action):
            if action == "prompt":
                handle = journal(str(run["id"]))["handle"]
                sb = node.attach(handle["owner"], handle["id"], handle["token"])
                fixture(sb, str(run["id"]), self.case)
            return super().operation(run, action)

    client = Client(args.origin, private_file(config["connector_token_file"]).read_text().strip())
    try:
        with db.transaction() as conn:
            conn.execute("TRUNCATE operators,projects,agent_profile_revisions CASCADE")
        password = secrets.token_urlsafe(32)
        bootstrap(db, "pause-operator", password)
        client.register(db)
        settings = Settings(url, origin="https://testserver")
        with TestClient(create_app(settings, db), base_url=settings.origin) as api:
            csrf = api.get("/api/v1/session").json()["csrf_token"]
            login = api.post(
                "/api/v1/session",
                json={"username": "pause-operator", "password": password},
                headers={"Origin": settings.origin, "X-CSRF-Token": csrf},
            )
            require(login.status_code == 200, "login_failed")

            def post(path, data):
                reply = api.post(
                    "/api/v1" + path,
                    json=data,
                    headers={
                        "Origin": settings.origin,
                        "X-CSRF-Token": login.json()["csrf_token"],
                        "Idempotency-Key": uuid4().hex,
                    },
                )
                require(reply.status_code in {200, 201, 202}, "api_" + str(reply.status_code))
                return reply.json()

            repo = config["repositories"][0]
            project = post(
                "/projects", {"name": "Pause KVM", "canonical_repo": repo["canonical_repo"]}
            )
            for case in (
                [args.case]
                if args.case
                else ["automatic", "approval", "background", "inflight", "cancel", "deadline"]
            ):
                client.case = case
                profile = post(
                    "/agent-profiles",
                    {
                        "name": "Pause " + case,
                        "backend": "openhands",
                        "require_approval": case == "approval",
                        "deadline_seconds": 300,
                        "verification": {
                            "mode": "fixture-m2",
                            "revision": "fixture-m2-v1",
                            "checks": [],
                        },
                    },
                )
                run = post(
                    "/tasks",
                    {
                        "project_id": project["id"],
                        "profile_revision": profile["id"],
                        "title": case,
                        "goal": "Fixed pause acceptance",
                        "base_sha": repo["base_sha"],
                    },
                )["run"]
                issued.append(run["id"])

                def view(run_id=run["id"]):
                    return Store(db).run(run_id)

                def action(value, run_id=run["id"]):
                    return post(
                        f"/runs/{run_id}/actions",
                        {"action": value, "expected_state_version": view()["state_version"]},
                    )

                def thread():
                    resuming = view()["state"] == "resuming"

                    def execute():
                        worker = Worker(db, client)
                        worker.run_once()
                        if resuming and view()["state"] == "running":
                            worker.run_once()

                    value = threading.Thread(target=execute, daemon=True)
                    threads.append(value)
                    value.start()
                    return value

                execution = thread()
                wait(
                    lambda case=case: (
                        view()["backend_cursor"]
                        and (case != "approval" or view()["state"] == "awaiting_approval")
                    )
                )
                before = journal(run["id"])
                handle = before["handle"]
                sb = node.attach(handle["owner"], handle["id"], handle["token"])
                old_approval = None
                if case == "approval":
                    old_approval = api.get(f"/api/v1/runs/{run['id']}/approvals").json()["items"][
                        -1
                    ]
                if case in {"background", "inflight"}:
                    wait(
                        lambda sb=sb: (
                            sb.exec(
                                "python3",
                                "-c",
                                "from pathlib import Path;"
                                "print(Path('/tmp/pause-tool-started').exists())",
                                timeout=5,
                            ).strip()
                            == "True"
                        )
                    )
                if case == "background":
                    wait(
                        lambda sb=sb: (
                            sb.exec(
                                "python3",
                                "-I",
                                "-c",
                                "from pathlib import Path;"
                                "p=Path('/proc')/Path('/tmp/pause-hidden-pid').read_text();"
                                "s=dict(line.split(':',1) "
                                "for line in (p/'status').read_text().splitlines());"
                                "print((p/'environ').stat().st_uid==0 "
                                "and s['Uid'].split()[0]=='2000')",
                                timeout=5,
                            ).strip()
                            == "True"
                        )
                    )
                accepted = action("pause")
                require(
                    accepted["status"] == "pending" and view()["state"] == "pausing",
                    "pause_not_pending",
                )
                execution.join(timeout=15)
                require(not execution.is_alive(), "old_worker_not_fenced")
                pending_seen = False

                def pause_step(run_id=run["id"]):
                    nonlocal pending_seen
                    with db.transaction() as conn:
                        conn.execute(
                            "UPDATE jobs SET available_at=now() WHERE run_id=%s", (run_id,)
                        )
                    Worker(db, client).run_once()
                    value = view()
                    require(
                        value["state"] in {"pausing", "paused"},
                        "pause_failed:" + str(value["reason"]),
                    )
                    require(Store(db).runtime()["occupied"] == 1, "pause_lost_capacity")
                    pending_seen |= value["state"] == "pausing"
                    return value["state"] == "paused"

                wait(pause_step)
                require(journal(run["id"])["handle"] == before["handle"], "pause_replaced_instance")
                if case == "background":
                    require(pending_seen, "background_not_observed_pending")
                if case not in {"background", "inflight"}:
                    require(
                        sb.exec(
                            "python3",
                            "-c",
                            "from pathlib import Path;"
                            "print(Path('/home/agentprobe/workspace/m2-result.txt').exists())",
                            timeout=5,
                        ).strip()
                        == "False",
                        "tool_ran_before_resume",
                    )
                if case == "deadline":
                    with db.transaction() as conn:
                        conn.execute(
                            "UPDATE runs SET deadline=now()-interval '1 second' WHERE id=%s",
                            (run["id"],),
                        )
                        conn.execute(
                            "UPDATE jobs SET available_at=now() WHERE run_id=%s", (run["id"],)
                        )
                    Worker(db, client).run_once()
                elif case == "cancel":
                    action("cancel")
                    Worker(db, client).run_once()
                else:
                    action("resume")
                    execution = thread()
                    if case == "approval":
                        wait(lambda: view()["state"] == "awaiting_approval")
                        grant = api.get(f"/api/v1/runs/{run['id']}/approvals").json()["items"][-1]
                        require(
                            grant["generation"] != old_approval["generation"]
                            and grant["action_digest"] != old_approval["action_digest"],
                            "old_approval_reused",
                        )
                        require(
                            sb.exec(
                                "python3",
                                "-c",
                                "from pathlib import Path;"
                                "print(Path('/home/agentprobe/workspace/m2-result.txt').exists())",
                                timeout=5,
                            ).strip()
                            == "False",
                            "resume_implicitly_approved",
                        )
                        post(
                            f"/approvals/{grant['id']}/decision",
                            {
                                "decision": "approve",
                                "generation": grant["generation"],
                                "action_digest": grant["action_digest"],
                                "expected_state_version": view()["state_version"],
                            },
                        )
                    execution.join(timeout=60)
                    require(not execution.is_alive(), "resume_worker_still_running")
                value = view()
                expected = {"cancel": "cancelled", "deadline": "failed"}.get(case, "succeeded")
                require(value["state"] == expected, "completion_failed:" + str(value["reason"]))
                require(
                    value["cleanup_state"] == "confirmed" and Store(db).runtime()["occupied"] == 0,
                    "cleanup_unconfirmed",
                )
                after = journal(run["id"])
                require(after["handle"] == before["handle"], "resume_replaced_instance")
                with db.transaction() as conn:
                    events = conn.execute(
                        "SELECT payload FROM run_events WHERE run_id=%s AND source='openhands'",
                        (run["id"],),
                    ).fetchall()
                prompts = sum(
                    e["payload"].get("kind") == "MessageEvent"
                    and json.loads(e["payload"]["content"]).get("source") == "user"
                    for e in events
                )
                require(prompts == 1, "initial_prompt_not_unique")
                report["cases"].append(
                    {
                        "case": case,
                        "run_id": run["id"],
                        "vm_id": before["observed"]["vm_id"],
                        "same_instance": True,
                        "state": value["state"],
                        "generation": value["generation"],
                        "pending_observed": pending_seen,
                        "user_message_count": prompts,
                        "proof": host.wait_removed(before["observed"]),
                    }
                )
                print(case + ": passed", flush=True)
            report["passed"] = True
    except Exception as exc:
        report["error"] = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
        print("KVM pause failed: " + report["error"], flush=True)
    finally:
        with db.transaction() as conn:
            conn.execute("UPDATE jobs SET lease_owner=NULL,lease_until=NULL,status='interrupted'")
        for value in threads:
            value.join(timeout=10)
        errors = []
        for identifier in issued:
            path = Path(config["state_dir"]) / (identifier + ".json")
            if not path.exists():
                continue
            row = json.loads(path.read_text())
            try:
                if row.get("handle") and row.get("observed"):
                    h = row["handle"]
                    node.attach(h["owner"], h["id"], h["token"]).close()
                    host.wait_removed(row["observed"])
            except Exception:
                errors.append(identifier)
        report.update(
            cleanup_errors=errors,
            vm_count_after=len(host.vms()),
            claim_count_after=len(node.sandboxes()),
            finished_at=datetime.now(UTC).isoformat(),
        )
        report["passed"] &= (
            not errors and report["vm_count_after"] == report["claim_count_after"] == 0
        )
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        db.close()
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
