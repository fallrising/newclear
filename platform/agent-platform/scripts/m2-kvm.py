#!/usr/bin/env python3
"""Opt-in AT-02: real platform workers + four live VMs, fifth queued, owned cleanup.

Use a dedicated empty zero-warm node and isolated PostgreSQL. The connector
must already be running from the specified private config. No real model key.
"""

import argparse
import concurrent.futures
import json
import os
import threading
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
    runs = []
    report = {
        "schema_version": 1,
        "started_at": datetime.now(UTC).isoformat(),
        "transport": "cocoon-kvm-platform",
        "template": config["template"],
        "checks": {},
        "m2_kvm_passed": False,
    }

    def check(name, value=True):
        report["checks"][name] = value
        print(name + ": passed", flush=True)

    try:
        with db.transaction() as conn:
            conn.execute("TRUNCATE operators,projects,agent_profile_revisions CASCADE")
        password = __import__("secrets").token_urlsafe(32)
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
                    "/api/v1" + path, json=data, headers={**headers, "Idempotency-Key": uuid4().hex}
                )
                require(response.status_code in {200, 201, 202}, "api_" + str(response.status_code))
                return response.json()

            repo = config["repositories"][0]
            project = post(
                "/projects", {"name": "KVM fixture", "canonical_repo": repo["canonical_repo"]}
            )
            profile = post(
                "/agent-profiles",
                {
                    "name": "OpenHands real VM fixture",
                    "backend": "openhands",
                    "deadline_seconds": 600,
                },
            )
            for i in range(5):
                value = post(
                    "/tasks",
                    {
                        "project_id": project["id"],
                        "profile_revision": profile["id"],
                        "title": f"M2 parallel {i + 1}",
                        "goal": "Run the fixed M2 edit fixture",
                        "base_sha": repo["base_sha"],
                    },
                )
                runs.append(value["run"])
            # Barrier exists only in the acceptance driver, before prompt dispatch;
            # every allocation/checkout/event/result/release uses the product adapters.
            barrier = threading.Barrier(4, timeout=180)
            observations = []
            lock = threading.Lock()

            class GatedClient(RuntimeClient):
                def operation(self, run, action):
                    if action == "prompt" and str(run["id"]) in {r["id"] for r in runs[:4]}:
                        barrier.wait()
                        with lock:
                            if not observations:
                                live = host.vms()
                                require(len(live) == 4, "four_real_vms_not_live")
                                require(
                                    Store(db).run(runs[4]["id"])["state"] == "queued",
                                    "fifth_not_queued",
                                )
                                for r in runs[:4]:
                                    row = json.loads(
                                        (
                                            Path(config["state_dir"]) / (r["id"] + ".json")
                                        ).read_text()
                                    )
                                    sb = node.attach(
                                        row["handle"]["owner"],
                                        row["handle"]["id"],
                                        row["handle"]["token"],
                                    )
                                    sb.write_file("/tmp/m2-isolation.txt", r["id"].encode())
                                for r in runs[:4]:
                                    row = json.loads(
                                        (
                                            Path(config["state_dir"]) / (r["id"] + ".json")
                                        ).read_text()
                                    )
                                    sb = node.attach(
                                        row["handle"]["owner"],
                                        row["handle"]["id"],
                                        row["handle"]["token"],
                                    )
                                    require(
                                        sb.read_file("/tmp/m2-isolation.txt") == r["id"].encode(),
                                        "workspace_not_isolated",
                                    )
                                    observations.append(row["observed"])
                                check("four_real_vms_live_fifth_queued_and_isolated")
                    return super().operation(run, action)

            gated = GatedClient(args.origin, client.http.token)
            worker = Worker(db, gated)
            claims = [worker.claim() for _ in range(4)]
            require(all(claims) and worker.claim() is None, "four_slot_admission_failed")
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(worker.execute, claims))
            for r in runs[:4]:
                view = Store(db).run(r["id"])
                require(view["state"] == "succeeded", "run_not_succeeded:" + str(view["reason"]))
                require(view["cleanup_state"] == "confirmed", "cleanup_unconfirmed")
                result = view["result"]
                require(result["workspace_value"] == r["id"] + "\n", "result_not_isolated")
                require(result["verification"]["status"] == "passed", "fixture_verification_failed")
                require(
                    "diff --git a/m2-result.txt b/m2-result.txt" in result["diff"], "diff_missing"
                )
                require("conversations/" not in result["diff"], "runtime_state_in_diff")
            check("four_platform_results_persisted_before_cleanup")
            require(not host.vms(), "vm_residue")
            check("stop_evidence_before_capacity_release", [host.removal(o) for o in observations])
            require(Store(db).runtime()["occupied"] == 0, "capacity_not_released")
            require(Worker(db, client).run_once(), "fifth_not_admitted_after_cleanup")
            fifth = Store(db).run(runs[4]["id"])
            require(
                fifth["state"] == "succeeded" and fifth["cleanup_state"] == "confirmed",
                "fifth_failed",
            )
            check("fifth_runs_only_after_capacity_return")
            before = []
            for r in runs:
                row = json.loads((Path(config["state_dir"]) / (r["id"] + ".json")).read_text())
                before.append({k: v["state"] for k, v in row["operations"].items()})
                for _ in range(2):
                    response = api.get(f"/api/v1/runs/{r['id']}/events?follow=false")
                    require(response.status_code == 200, "replay_failed")
                after = json.loads((Path(config["state_dir"]) / (r["id"] + ".json")).read_text())
                require(
                    before[-1] == {k: v["state"] for k, v in after["operations"].items()},
                    "replay_caused_mutation",
                )
            check("replay_does_not_repeat_runtime_operations", before)
            report["runs"] = [
                {
                    "run_id": r["id"],
                    "state": Store(db).run(r["id"])["state"],
                    "diff_sha256": Store(db).run(r["id"])["result"]["diff_sha256"],
                    "verification": Store(db).run(r["id"])["result"]["verification"],
                }
                for r in runs
            ]
            report["observations"] = observations
            report["m2_kvm_passed"] = True
    except Exception as exc:
        report["error"] = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
        print("KVM acceptance failed:", report["error"], flush=True)
    finally:
        errors = []
        for run in runs:
            path = Path(config["state_dir"]) / (run["id"] + ".json")
            if not path.exists():
                continue
            row = json.loads(path.read_text())
            try:
                # Test finalizer owns only these handles; expired worker leases must
                # not be fabricated to bypass the product connector fence.
                if row.get("handle") and row.get("observed"):
                    handle = row["handle"]
                    node.attach(handle["owner"], handle["id"], handle["token"]).close()
                    host.wait_removed(row["observed"])
            except Exception:
                errors.append(run["id"])
        report["cleanup_errors"] = errors
        report["vm_count_after"] = len(host.vms())
        report["claim_count_after"] = len(node.sandboxes())
        report["m2_kvm_passed"] &= (
            not errors and report["vm_count_after"] == report["claim_count_after"] == 0
        )
        report["finished_at"] = datetime.now(UTC).isoformat()
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        db.close()
    return 0 if report["m2_kvm_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
