#!/usr/bin/env python3
"""Opt-in guest mailbox acceptance using real KVM, SQL and the pinned SDK."""

import argparse
import json
import os
import secrets
import signal
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient
from model_kvm_checks import attack_response, child, cross_run_probe, install_attack

import agent_platform.model_fixture as model_fixture
import agent_platform.model_worker as model_worker
from agent_platform.api import create_app
from agent_platform.auth import bootstrap
from agent_platform.config import Settings
from agent_platform.connector_journal import private_file
from agent_platform.db import Database, migrate
from agent_platform.domain import Problem
from agent_platform.model_fixture import fixture_server
from agent_platform.model_policy import Policy
from agent_platform.model_proxy import ModelProxy, usage_view
from agent_platform.runtime_client import RuntimeClient
from agent_platform.store import Store
from agent_platform.worker import Worker
from agent_platform_m0.kvm_lifecycle import Host
from agent_platform_m0.sandbox_client import SingleNodeClient


def require(value, code):
    if not value:
        raise RuntimeError(code)


def wait(check, seconds=120):
    deadline = time.monotonic() + seconds
    while not (value := check()):
        require(time.monotonic() < deadline, "acceptance_wait_expired")
        time.sleep(0.1)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--origin", default="http://127.0.0.1:17888")
    parser.add_argument("--output", type=Path, required=True)
    cases = [
        "complete",
        "cutoff",
        "approval",
        "pause",
        "cancel",
        "isolation",
        "rotate",
        "expired",
        "revoked",
        "crash-reserved",
        "crash-settled",
        "crash-delivered",
        "cross-run",
        "fixture-credits",
        "fixture-budget-cutoff",
        "fixture-budget-unknown",
    ]
    parser.add_argument("--case", choices=cases)
    parser.add_argument("--worker-fault", choices=["reserved", "settled", "delivered"])
    args = parser.parse_args()
    os.umask(0o077)
    config = json.loads(private_file(args.config).read_text())
    if args.worker_fault:
        child(config, args.origin, args.output, args.worker_fault)
        return
    url = os.environ["TEST_DATABASE_URL"]
    with psycopg.connect(url) as conn:
        require(conn.info.dbname == "agent_platform_test", "dedicated_database_required")
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
    secret = secrets.token_urlsafe(32)
    upstream = fixture_server(0, secret)
    upstream_thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    upstream_thread.start()
    key = args.output / "fixture.key"
    key.write_text(secret)
    policy = args.output / "model.json"
    os.environ["MODEL_PROXY_CONFIG"] = str(policy)
    fixture = {"case": None, "rotated": False, "checks": None, "upstream_calls": 0}
    original_response = model_fixture.tool_response

    def fixture_response(data):
        fixture["upstream_calls"] += 1
        result = original_response(data)
        if fixture["case"] == "fixture-budget-unknown":
            result["usage"] = {
                "prompt_tokens": 1_000_000,
                "completion_tokens": 5,
                "total_tokens": 1_000_005,
            }
        return (
            attack_response(result, data["fixture_run_id"])
            if fixture["case"] == "isolation"
            else result
        )

    model_fixture.tool_response = fixture_response

    class Client(RuntimeClient):
        def operation(self, run, action):
            if fixture["case"] == "isolation" and action in {"prompt", "result"}:
                row = json.loads(
                    (Path(config["state_dir"]) / (str(run["id"]) + ".json")).read_text()
                )
                handle = row["handle"]
                sb = node.attach(handle["owner"], handle["id"], handle["token"])
                if action == "prompt":
                    install_attack(sb)
                else:
                    proof = json.loads(sb.exec("cat", "/tmp/model-isolation-proof.json", timeout=5))
                    require(
                        proof and all(v is True for v in proof.values()),
                        "terminal_isolation_failed",
                    )
                    fixture["checks"] = proof
            return super().operation(run, action)

    client = Client(args.origin, private_file(config["connector_token_file"]).read_text().strip())
    issued, threads = [], []
    report = {
        "started_at": datetime.now(UTC).isoformat(),
        "passed": False,
        "transport": "guest-mailbox-v1",
        "egress": "deny-all",
        "cases": [],
    }
    original_completion = model_worker.SDKCompletion

    class CaptureCompletion(original_completion):
        def payload(self):
            # Private acceptance artifact only; never copy raw prompt/tool schemas
            # to a public report, log or repository.
            (args.output / "sdk-request.json").write_text(json.dumps(self.data))
            return super().payload()

    model_worker.SDKCompletion = CaptureCompletion
    original_step, original_complete = model_worker.ModelSession.step, ModelProxy.complete

    def step(session, run):
        if fixture["case"] == "rotate" and session.token and not fixture["rotated"]:
            old = session.token
            session.issued -= 121
            result = original_step(session, run)
            with db.transaction() as conn:
                try:
                    session.proxy.authorize(conn, run["id"], old)
                except Problem as exc:
                    require(exc.code == "model_token_invalid", "old_token_not_revoked")
                else:
                    raise RuntimeError("old_token_still_valid")
            fixture["rotated"] = True
            return result
        return original_step(session, run)

    def complete(proxy, run_id, token, request_id, data, **kwargs):
        if fixture["case"] == "expired":
            with db.transaction() as conn:
                conn.execute(
                    "UPDATE model_proxy_tokens SET expires_at=clock_timestamp() WHERE run_id=%s",
                    (run_id,),
                )
        elif fixture["case"] == "revoked":
            proxy.revoke(run_id)
        return original_complete(proxy, run_id, token, request_id, data, **kwargs)

    model_worker.ModelSession.step, ModelProxy.complete = step, complete
    try:
        with db.transaction() as conn:
            conn.execute("TRUNCATE operators,projects,agent_profile_revisions CASCADE")
        password = secrets.token_urlsafe(32)
        bootstrap(db, "model-kvm", password)
        client.register(db)
        settings = Settings(url, origin="https://testserver")
        with TestClient(create_app(settings, db), base_url=settings.origin) as api:
            csrf = api.get("/api/v1/session").json()["csrf_token"]
            login = api.post(
                "/api/v1/session",
                json={"username": "model-kvm", "password": password},
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
                "/projects", {"name": "Guest model KVM", "canonical_repo": repo["canonical_repo"]}
            )
            for case in [args.case] if args.case else cases:
                fixture.update(case=case, rotated=False, checks=None, upstream_calls=0)
                model_config = {
                    "origin": f"http://127.0.0.1:{upstream.server_port}",
                    "credential_file": str(key),
                    "mode": "fixture-http-v1",
                    "request_limit": 1 if case == "cutoff" else 10,
                }
                if case in {"fixture-credits", "fixture-budget-cutoff", "fixture-budget-unknown"}:
                    model_config["fixture_budget"] = {
                        "revision": "fixture-credit-2026-09",
                        "limit_microcredits": 1 if case == "fixture-budget-cutoff" else 10_000_000,
                        "input_microcredits_per_token": 1,
                        "output_microcredits_per_token": 1,
                    }
                policy.write_text(json.dumps(model_config))
                profile = post(
                    "/agent-profiles",
                    {
                        "name": case,
                        "backend": "openhands",
                        "require_approval": case in {"approval", "pause", "cancel", "cross-run"},
                        "deadline_seconds": 600,
                    },
                )
                run = post(
                    "/tasks",
                    {
                        "project_id": project["id"],
                        "profile_revision": profile["id"],
                        "title": case,
                        "goal": "Fixed model transport acceptance",
                        "base_sha": repo["base_sha"],
                    },
                )["run"]
                issued.append(run["id"])

                def view(run_id=run["id"]):
                    return Store(db).run(run_id)

                def journal(run_id=run["id"]):
                    return json.loads((Path(config["state_dir"]) / (run_id + ".json")).read_text())

                def execute():
                    worker = Worker(db, client)
                    worker.run_once()

                def start():
                    thread = threading.Thread(target=execute, daemon=True)
                    threads.append(thread)
                    thread.start()
                    return thread

                def action(name, run_id=run["id"]):
                    return post(
                        f"/runs/{run_id}/actions",
                        {"action": name, "expected_state_version": view()["state_version"]},
                    )

                if case.startswith("crash-"):
                    marker = args.output / "worker-stopped"
                    # Each marker belongs to this driver's prior, proven-dead child.
                    marker.unlink(missing_ok=True)
                    with (args.output / (case + ".log")).open("w") as log:
                        process = subprocess.Popen(
                            [
                                sys.executable,
                                __file__,
                                "--config",
                                str(args.config),
                                "--origin",
                                args.origin,
                                "--output",
                                str(args.output),
                                "--worker-fault",
                                case.removeprefix("crash-"),
                            ],
                            stdout=log,
                            stderr=log,
                        )
                        try:
                            wait(
                                lambda marker=marker, process=process: (
                                    marker.exists() or process.poll() is not None
                                )
                            )
                            require(
                                marker.exists() and process.poll() is None,
                                "child_fault_not_reached",
                            )
                            before = journal()
                            process.kill()
                            require(process.wait(10) == -signal.SIGKILL, "worker_not_killed")
                        finally:
                            if process.poll() is None:
                                process.kill()
                                process.wait(10)
                    with db.transaction() as conn:
                        conn.execute(
                            "UPDATE jobs SET lease_until=clock_timestamp() WHERE run_id=%s",
                            (run["id"],),
                        )
                    Worker(db, client).reconcile_expired()
                    require(Store(db).runtime()["occupied"] == 1, "crash_lost_reservation")
                    thread = start()
                else:
                    before = None
                    thread = start()
                if case == "cross-run":
                    wait(lambda: view()["state"] == "awaiting_approval")
                    sibling = post(
                        "/tasks",
                        {
                            "project_id": project["id"],
                            "profile_revision": profile["id"],
                            "title": "sibling",
                            "goal": "Fixed sibling acceptance",
                            "base_sha": repo["base_sha"],
                        },
                    )["run"]
                    issued.append(sibling["id"])
                    sibling_thread = start()
                    wait(
                        lambda sibling=sibling: (
                            Store(db).run(sibling["id"])["state"] == "awaiting_approval"
                        )
                    )
                    require(
                        len(node.sandboxes()) == len(host.vms()) == 2, "two_live_guests_required"
                    )
                    second = json.loads(
                        (Path(config["state_dir"]) / (sibling["id"] + ".json")).read_text()
                    )
                    proof = cross_run_probe(
                        node,
                        journal(),
                        second,
                        ModelProxy(db, Policy.read(policy)),
                        json.loads((args.output / "sdk-request.json").read_text()),
                    )
                    for identity in (run["id"], sibling["id"]):
                        post(
                            f"/runs/{identity}/actions",
                            {
                                "action": "cancel",
                                "expected_state_version": Store(db).run(identity)["state_version"],
                            },
                        )
                    thread.join(15)
                    sibling_thread.join(15)
                    Worker(db, client).run_once()
                    Worker(db, client).run_once()
                    require(not node.sandboxes() and not host.vms(), "cross_run_cleanup_failed")
                    require(fixture["upstream_calls"] == 2, "cross_run_model_dispatched")
                    report["cases"].append({"case": case, **proof, "cleanup_confirmed": True})
                    print(json.dumps(report["cases"][-1]), flush=True)
                    continue
                if case in {"approval", "pause", "cancel"}:
                    wait(lambda: view()["state"] in {"awaiting_approval", "failed", "interrupted"})
                    require(
                        view()["state"] == "awaiting_approval",
                        "approval_not_reached:" + str(view()["reason"]),
                    )
                    before = journal()
                    if case == "cancel":
                        action("cancel")
                        thread.join(15)
                        Worker(db, client).run_once()
                    elif case == "pause":
                        action("pause")
                        thread.join(15)
                        Worker(db, client).run_once()
                        require(view()["state"] == "paused", "pause_unconfirmed")
                        require(Store(db).runtime()["occupied"] == 1, "pause_lost_reservation")
                        action("resume")
                        Worker(db, client).run_once()
                        thread = start()
                        wait(lambda: view()["state"] == "awaiting_approval")
                        require(journal()["handle"] == before["handle"], "resume_replaced_vm")
                    if case != "cancel":
                        grant = api.get(f"/api/v1/runs/{run['id']}/approvals").json()["items"][-1]
                        post(
                            f"/approvals/{grant['id']}/decision",
                            {
                                "decision": "approve",
                                "action_digest": grant["action_digest"],
                                "generation": grant["generation"],
                                "expected_state_version": view()["state_version"],
                            },
                        )
                thread.join(120)
                require(not thread.is_alive(), "worker_not_bounded")
                current = view()
                expected = (
                    "failed"
                    if case
                    in {
                        "cutoff",
                        "expired",
                        "revoked",
                        "crash-reserved",
                        "crash-settled",
                        "fixture-budget-cutoff",
                        "fixture-budget-unknown",
                    }
                    else "cancelled"
                    if case == "cancel"
                    else "succeeded"
                )
                require(
                    current["state"] == expected,
                    "unexpected_state:" + current["state"] + ":" + str(current["reason"]),
                )
                require(current["cleanup_state"] == "confirmed", "cleanup_not_confirmed")
                require(not node.sandboxes() and not host.vms(), "runtime_not_empty")
                usage = usage_view(db, run["id"])
                require(usage["guest_connected"], "guest_model_not_connected")
                requests = (
                    0
                    if case in {"expired", "revoked", "fixture-budget-cutoff"}
                    else 1
                    if case
                    in {
                        "cutoff",
                        "cancel",
                        "crash-reserved",
                        "crash-settled",
                        "fixture-budget-unknown",
                    }
                    else 2
                )
                require(usage["request_slots_consumed"] == requests, "request_count_mismatch")
                require(
                    fixture["upstream_calls"]
                    == (0 if case in {"crash-reserved", "fixture-budget-cutoff"} else requests),
                    "upstream_redispatched",
                )
                if case in {"fixture-credits", "fixture-budget-cutoff", "fixture-budget-unknown"}:
                    require(usage["fixture_credit_limit_supported"], "fixture_budget_missing")
                    require(not usage["hard_money_limit_supported"], "fixture_claimed_real_money")
                    require(usage["amount_decimal"] is None, "fixture_claimed_real_cost")
                    if case == "fixture-budget-unknown":
                        require(
                            usage["entries"][0]["status"] == "unknown"
                            and usage["fixture_credits_uncertain"]
                            and usage["fixture_credits_committed_microcredits"]
                            == usage["entries"][0]["fixture_reserved_microcredits"]
                            > 0,
                            "unknown_fixture_credit_was_refunded",
                        )
                    else:
                        require(
                            usage["fixture_credits_committed_microcredits"]
                            == (30 if requests == 2 else 0),
                            "fixture_credit_settlement_mismatch",
                        )
                raw = journal()
                if before and case.startswith("crash-"):
                    require(raw["handle"] == before["handle"], "recovery_replaced_vm")
                    require(
                        raw["operations"]["prompt"] == before["operations"]["prompt"],
                        "recovery_resent_prompt",
                    )
                    require(view()["generation"] > before["generation"], "generation_not_advanced")
                if case == "rotate":
                    require(
                        fixture["rotated"] and len(raw["model_tokens"]) == 2,
                        "rotation_not_observed",
                    )
                public = json.dumps(api.get(f"/api/v1/runs/{run['id']}").json())
                public += api.get(f"/api/v1/runs/{run['id']}/events?follow=false").text
                for value in [
                    secret,
                    raw["session_key"],
                    raw["model_local_key"],
                    *raw.get("model_tokens", []),
                ]:
                    require(value not in public, "public_secret_leak")
                report["cases"].append(
                    {
                        "case": case,
                        "state": current["state"],
                        "requests": usage["request_slots_consumed"],
                        "guest_connected": True,
                        "cleanup_confirmed": True,
                        "public_secret_scan": True,
                        "upstream_calls": fixture["upstream_calls"],
                        "fixture_credits_committed_microcredits": usage[
                            "fixture_credits_committed_microcredits"
                        ],
                        "terminal_checks": fixture["checks"],
                        "generation": current["generation"],
                    }
                )
                print(json.dumps(report["cases"][-1]), flush=True)
            report["passed"] = True
    finally:
        # Do not destroy unknown resources, reset generations, or delete journals.
        for run_id in issued:
            for _ in range(8):
                current = Store(db).run(run_id)
                if current["cleanup_state"] in {"confirmed", "not_allocated"}:
                    break
                with db.transaction() as conn:
                    conn.execute(
                        "UPDATE jobs SET available_at=clock_timestamp() "
                        "WHERE run_id=%s AND status='interrupted'",
                        (run_id,),
                    )
                Worker(db, client).run_once()
                time.sleep(0.2)
        report["zero_vms"] = not host.vms()
        report["zero_claims"] = not node.sandboxes()
        report["finished_at"] = datetime.now(UTC).isoformat()
        (args.output / "report.json").write_text(json.dumps(report, indent=2))
        upstream.shutdown()
        upstream.server_close()
        db.close()
        model_worker.SDKCompletion = original_completion
        model_worker.ModelSession.step, ModelProxy.complete = original_step, original_complete
        model_fixture.tool_response = original_response


if __name__ == "__main__":
    main()
