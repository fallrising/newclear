#!/usr/bin/env python3
"""One real MicroVM run of a FILE/TEXT card through the in-guest fixture model.

The connector must already be running. No provider key and no paid API.
"""

import argparse
import json
import os
import secrets
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

GOAL = "FILE note.txt\nTEXT hello"


def require(value, code):
    if not value:
        raise RuntimeError(code)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--output", type=Path, required=True)
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
    migrate(url)
    db = Database(url)
    db.open()
    client = RuntimeClient(
        args.origin, private_file(config["connector_token_file"]).read_text().strip()
    )
    run_id = None
    report = {
        "schema_version": 1,
        "started_at": datetime.now(UTC).isoformat(),
        "goal": GOAL,
        "card_kvm_passed": False,
    }
    try:
        with db.transaction() as conn:
            conn.execute("TRUNCATE operators,projects,agent_profile_revisions CASCADE")
        password = secrets.token_urlsafe(32)
        bootstrap(db, "kvm-operator", password)
        client.register(db)
        settings = Settings(url, origin="https://testserver")
        with TestClient(create_app(settings, db), base_url=settings.origin) as api:
            csrf = api.get("/api/v1/session").json()["csrf_token"]
            response = api.post(
                "/api/v1/session",
                json={"username": "kvm-operator", "password": password},
                headers={"Origin": settings.origin, "X-CSRF-Token": csrf},
            )
            require(response.status_code == 200, "login_failed")
            headers = {"Origin": settings.origin, "X-CSRF-Token": response.json()["csrf_token"]}

            def post(path, data):
                response = api.post(
                    "/api/v1" + path,
                    json=data,
                    headers={**headers, "Idempotency-Key": uuid4().hex},
                )
                require(response.status_code in {200, 201, 202}, "api_" + str(response.status_code))
                return response.json()

            repo = config["repositories"][0]
            project = post(
                "/projects", {"name": "KVM card", "canonical_repo": repo["canonical_repo"]}
            )
            profile = post(
                "/agent-profiles",
                {
                    "name": "OpenHands card",
                    "backend": "openhands",
                    "deadline_seconds": 600,
                    "verification": {
                        "mode": "fixture-m2",
                        "revision": "fixture-m2-v1",
                        "checks": [],
                    },
                },
            )
            created = post(
                "/tasks",
                {
                    "project_id": project["id"],
                    "profile_revision": profile["id"],
                    "title": "Local card on a real VM",
                    "goal": GOAL,
                    "base_sha": repo["base_sha"],
                },
            )
            run_id = created["run"]["id"]
            require(Worker(db, client).run_once(), "run_not_admitted")
            view = Store(db).run(run_id)
            result = view["result"] or {}
            diff = result.get("diff") or ""
            report["state"] = view["state"]
            report["reason"] = view["reason"]
            report["verification"] = result.get("verification")
            require(view["state"] == "succeeded", "run_not_succeeded")
            require(view["cleanup_state"] == "confirmed", "cleanup_unconfirmed")
            require(result.get("verification", {}).get("status") == "passed", "fixture_failed")
            require("diff --git a/note.txt b/note.txt" in diff, "card_file_missing")
            require("\n+hello\n" in diff or diff.endswith("\n+hello\n"), "card_text_missing")
            require("diff --git a/m2-result.txt b/m2-result.txt" in diff, "fixture_file_missing")
            require(run_id in diff, "run_id_missing")
            require(not host.vms() and not node.sandboxes(), "runtime_not_empty")
            report["card_kvm_passed"] = True
            print("card_kvm_passed", flush=True)
    except Exception as exc:
        report["error"] = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
        print("card kvm failed:", report["error"], flush=True)
    finally:
        if run_id:
            path = Path(config["state_dir"]) / (run_id + ".json")
            if path.exists():
                row = json.loads(path.read_text())
                handle = row.get("handle")
                observed = row.get("observed")
                if handle and observed:
                    try:
                        node.attach(handle["owner"], handle["id"], handle["token"]).close()
                        host.wait_removed(observed)
                    except Exception:
                        report["cleanup_error"] = True
        report["vm_count_after"] = len(host.vms())
        report["claim_count_after"] = len(node.sandboxes())
        report["card_kvm_passed"] = bool(
            report["card_kvm_passed"]
            and report["vm_count_after"] == 0
            and report["claim_count_after"] == 0
        )
        report["finished_at"] = datetime.now(UTC).isoformat()
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        db.close()
        if not report["card_kvm_passed"]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
