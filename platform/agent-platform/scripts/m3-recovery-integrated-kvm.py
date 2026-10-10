#!/usr/bin/env python3
"""Opt-in ordinary combined Worker recovery after exact owned process boundaries."""

import argparse
import hashlib
import importlib.util
import json
import os
import secrets
import subprocess
import sys
import time
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request
from uuid import UUID

import m3_recovery_checks as checks

from agent_platform.connector_journal import private_file
from agent_platform.model_proxy import ModelProxy, usage_view

spec = importlib.util.spec_from_file_location(
    "recovery_combined", Path(__file__).with_name("m3-integrated-acceptance.py")
)
combined = importlib.util.module_from_spec(spec)
spec.loader.exec_module(combined)
worker, base = combined.worker, combined.base
CASES = checks.CASES


def sql_snapshot(db, run_id):
    with db.transaction() as conn:
        value = {"run": conn.execute("SELECT * FROM runs WHERE id=%s", (run_id,)).fetchone()}
        value["job"] = conn.execute(
            "SELECT *,clock_timestamp() AS observed_at,"
            "lease_until<=clock_timestamp() AS lease_expired FROM jobs WHERE run_id=%s",
            (run_id,),
        ).fetchone()
        for key, table, order in (
            ("bindings", "sandbox_bindings", "id"),
            ("model_policy", "model_proxy_runs", "run_id"),
            ("model_tokens", "model_proxy_tokens", "token_hash"),
            ("tool_grants", "tool_broker_runs", "run_id"),
            ("tool_tokens", "tool_broker_tokens", "token_hash"),
            ("operations", "tool_broker_operations", "admitted_at,operation_id"),
            ("events", "run_events", "seq"),
            ("approvals", "approvals", "id"),
        ):
            value[key] = conn.execute(
                f"SELECT * FROM {table} WHERE run_id=%s ORDER BY {order}", (run_id,)
            ).fetchall()
        value["reservations"] = conn.execute(
            "SELECT rr.* FROM resource_reservations rr JOIN sandbox_bindings b "
            "ON b.id=rr.sandbox_id WHERE b.run_id=%s ORDER BY rr.sandbox_id",
            (run_id,),
        ).fetchall()
    value["usage"] = usage_view(db, run_id)
    return value


def child_main(path):
    init = json.loads(private_file(path).read_text())
    trace = Path(init["trace"])
    current = {}

    def emit(value):
        with trace.open("a") as stream:
            stream.write(json.dumps(value, default=str) + "\n")

    def boundary(name, **details):
        if init["role"] != "original" or init["case"] != name:
            return
        checks.stop_at_barrier(
            Path(init["barrier"]),
            {
                "nonce": init["nonce"],
                "case": name,
                "run_id": init["run_id"],
                "claim": current["claim"],
                **details,
            },
        )

    original_worker, original_client = worker.Worker, worker.RuntimeClient
    original_reserve, original_settle = ModelProxy.reserve, ModelProxy.settle

    class ObservedWorker(original_worker):
        def reconcile_expired(self):
            with self.db.transaction() as conn:
                prior = conn.execute(
                    "SELECT *,clock_timestamp() AS observed_at,"
                    "lease_until<=clock_timestamp() AS lease_expired FROM jobs WHERE run_id=%s",
                    (UUID(init["run_id"]),),
                ).fetchone()
            if prior and prior["status"] == "leased" and prior["lease_expired"] is True:
                emit({"kind": "expired_lease", "job": prior})
            return super().reconcile_expired()

        def execute(self, claim):
            current["db"] = self.db
            observed = sql_snapshot(self.db, UUID(init["run_id"]))
            current["claim"] = {
                **claim,
                "owner": self.owner,
                "binding_id": observed["run"]["sandbox_id"],
                "lease_until": observed["job"]["lease_until"],
                "observed_at": observed["job"]["observed_at"],
                "reserved": sum(r["released_at"] is None for r in observed["reservations"]),
            }
            emit({"kind": "claim", **current["claim"]})
            return super().execute(claim)

    class Client(original_client):
        def call(self, method, path, data=None):
            value = super().call(method, path, data)

            def observe(node):
                if isinstance(node, dict):
                    if node.get("observed_state") == "stopped" and "proof" in node:
                        with current["db"].transaction() as conn:
                            count = conn.execute(
                                "SELECT count(*) AS n FROM resource_reservations rr "
                                "JOIN sandbox_bindings b ON b.id=rr.sandbox_id "
                                "WHERE b.run_id=%s AND rr.released_at IS NULL",
                                (UUID(init["run_id"]),),
                            ).fetchone()["n"]
                        emit(
                            {
                                "kind": "raw_proof",
                                "observed_state": "stopped",
                                "proof": node["proof"],
                                "reserved_before_return": count,
                            }
                        )
                    for item in node.values():
                        observe(item)
                elif isinstance(node, list):
                    for item in node:
                        observe(item)

            observe(value)
            return value

        def allocate(self, run):
            emit({"kind": "allocate", "generation": run["generation"]})
            return super().allocate(run)

        def inspect(self, run):
            value = super().inspect(run)
            emit({"kind": "inspect", "phase": value["phase"], "generation": run["generation"]})
            return value

        def operation(self, run, action):
            value = super().operation(run, action)
            emit({"kind": "operation", "action": action})
            return checks.result_boundary(value, boundary, action)

        def tool(self, run, action, **data):
            return checks.tool_boundary(super().tool, boundary, run, action, **data)

    def reserve(proxy, run_id, token, request_id, payload):
        return checks.reserve_boundary(
            original_reserve, boundary, proxy, run_id, token, request_id, payload
        )

    def settle(proxy, run_id, request_id, **kwargs):
        return checks.settle_boundary(
            original_settle, boundary, proxy, run_id, request_id, **kwargs
        )

    worker.Worker, worker.RuntimeClient = ObservedWorker, Client
    worker.install_model = combined.install_step
    ModelProxy.reserve, ModelProxy.settle = reserve, settle
    try:
        worker.worker_main(path)
    finally:
        worker.Worker, worker.RuntimeClient = original_worker, original_client
        ModelProxy.reserve, ModelProxy.settle = original_reserve, original_settle


class Harness(combined.Harness):
    def __init__(self, *args):
        self.policies, self.processes, self.case_by_run = {}, {}, {}
        self.child_cleanup_errors = []
        super().__init__(*args)

    def create(self, case):
        run_id = super().create("normal")
        self.case_by_run[run_id] = case
        return run_id

    def policy_files(self, run_id):
        if run_id in self.policies:
            return self.policies[run_id]
        directory = self.output / ("policy-" + str(run_id))
        directory.mkdir(mode=0o700)
        tool = asdict(self.mock.policy())
        (directory / "tool.secret").write_text(tool.pop("secret"))
        tool["secret_file"] = str(directory / "tool.secret")
        (directory / "tool.json").write_text(json.dumps(tool, default=str))
        (directory / "model.secret").write_text(self.mock.model_secret)
        (directory / "model.json").write_text(
            json.dumps(
                {
                    "origin": f"http://127.0.0.1:{self.mock.model.server_port}",
                    "credential_file": str(directory / "model.secret"),
                    "mode": "openai-compatible-mock-v1",
                    "model": combined.MODEL,
                    "request_limit": 10,
                }
            )
        )
        self.policies[run_id] = directory
        return directory

    def start_worker(self, run_id, role):
        case = self.case_by_run[run_id]
        policy = self.policy_files(run_id)
        directory = self.output / f"worker-{len(self.children)}"
        directory.mkdir(mode=0o700)
        trace, barrier = directory / "trace.jsonl", directory / "barrier.json"
        init = {
            "config": str(self.config_path),
            "origin": self.origin,
            "run_id": str(run_id),
            "trace": str(trace),
            "mask": str(self.output / "unused-proof-mask"),
            "case": case,
            "role": role,
            "repository": self.mock.repository,
            "barrier": str(barrier),
            "nonce": secrets.token_hex(24),
        }
        path = directory / "init.json"
        path.write_text(json.dumps(init))
        env = {
            key: os.environ[key]
            for key in (
                "PATH",
                "PYTHONPATH",
                "HOME",
                "TMPDIR",
                "LANG",
                "LC_ALL",
                "TEST_DATABASE_URL",
            )
            if key in os.environ
        }
        env.update(
            MODEL_PROXY_CONFIG=str(policy / "model.json"),
            TOOL_BROKER_MOCK_CONFIG=str(policy / "tool.json"),
        )
        with (directory / "worker.log").open("w") as log:
            child = subprocess.Popen(
                [sys.executable, str(Path(__file__)), "--worker", str(path)],
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        self.children.append(child)
        identity = checks.process_identity(child.pid)
        self.processes[child.pid] = {
            "child": child,
            "trace": trace,
            "barrier": barrier,
            "role": role,
            "expected": {
                "pid": child.pid,
                "start_ticks": identity["start_ticks"],
                "nonce": init["nonce"],
                "case": case,
                "run_id": str(run_id),
            },
            "policy_hashes": {
                p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(policy.iterdir())
            },
        }
        return child, trace

    def snapshot(self, run_id):
        value = sql_snapshot(self.db, run_id)
        journal = self.row(run_id)
        value["journal"] = {
            "handle": {key: journal["handle"][key] for key in ("owner", "id")},
            "observed": journal["observed"],
            "claim_ref": journal["claim_ref"],
            "operations": {
                key: journal["operations"].get(key)
                for key in ("allocate", "prompt", "result", "release")
            },
            "tool_channel": journal.get("tool_channel"),
        }
        calls = self.mock.model.model_calls
        value["upstream"] = {
            "model_calls": len(calls),
            "tool_calls": self.mock.calls,
            "tool_authenticated": self.mock.authenticated,
            "model_authenticated": all(
                c["path"] == "/v1/chat/completions"
                and c["authorization"] == "Bearer " + self.mock.model_secret
                and c["test_run_header"] == str(run_id)
                for c in calls
            ),
        }
        value["resources"] = {"claims": len(self.node.sandboxes()), "vms": len(self.host.vms())}
        return json.loads(json.dumps(value, default=str))

    def stop_children(self):
        primary = sys.exception()
        try:
            super().stop_children()
        except Exception as exc:
            self.child_cleanup_errors.append(type(exc).__name__)
            if primary is None:
                raise
            # The inherited constructor invokes cleanup while handling its error.
            print(json.dumps({"child_cleanup_errors": self.child_cleanup_errors}), file=sys.stderr)

    def cleanup(self):
        errors = []
        # A faulted stopped child cannot process public cancellation. Reap only owned Popen.
        for child in self.children:
            try:
                if child.poll() is None and checks.process_identity(child.pid)["state"] in {
                    "T",
                    "t",
                }:
                    child.kill()
                    child.wait(timeout=10)
            except Exception as exc:
                errors.append(type(exc).__name__)
        result = super().cleanup()
        result["cleanup_failures"] += len(errors) + len(self.child_cleanup_errors)
        if self.child_cleanup_errors:
            result["child_cleanup_errors"] = self.child_cleanup_errors
        if errors:
            result["stopped_child_cleanup_errors"] = errors
        return result


def approve_pending(harness, run_id, decisions):
    pending = harness.rows(
        "SELECT a.*,r.state AS observed_state,r.state_version AS observed_version "
        "FROM approvals a JOIN runs r ON r.id=a.run_id WHERE a.run_id=%s AND a.status='pending'",
        (run_id,),
    )
    for approval in pending:
        base.require(
            not decisions and approval["observed_state"] == "awaiting_approval",
            "unexpected_public_approval",
        )
        base.require(harness.mock.calls == 0, "dispatch_before_approval")
        harness.post(
            f"/approvals/{approval['id']}/decision",
            {
                "decision": "approve",
                "expected_state_version": approval["observed_version"],
                "generation": approval["generation"],
                "action_digest": approval["action_digest"],
            },
        )
        decisions.append(
            {
                "id": str(approval["id"]),
                "generation": approval["generation"],
                "digest": approval["action_digest"],
                "dispatches_before": 0,
            }
        )


def probe_generation(transport, run_id, generation):
    """Read the bounded denial body through the existing no-proxy/no-redirect opener."""
    base.require(type(generation) is int and generation > 0, "fence_generation_invalid")
    identity = str(UUID(str(run_id)))
    request = Request(
        transport.origin + f"/v1/runs/{identity}?generation={generation}",
        headers={"X-Session-API-Key": transport.token},
        method="GET",
    )
    try:
        with transport.opener.open(request, timeout=min(transport.timeout, 5)):
            raise RuntimeError("old_generation_was_not_denied")
    except HTTPError as exc:
        try:
            base.require(exc.code == 409, "fence_denial_status_mismatch")
            raw = exc.read(1025)
            base.require(len(raw) <= 1024, "fence_denial_body_too_large")
            try:
                body = json.loads(raw)
            except (ValueError, UnicodeError):
                raise RuntimeError("fence_denial_body_invalid") from None
            base.require(
                body == {"error": "connector_generation_stale"}, "fence_denial_code_mismatch"
            )
            return {"status": 409, "error": "connector_generation_stale"}
        finally:
            exc.close()
    except (URLError, TimeoutError, OSError):
        raise RuntimeError("fence_probe_transport_unavailable") from None


def persist_case(harness, case, observed):
    path = harness.output / (case + "-observations.json")
    temporary = path.with_suffix(".json.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(observed, stream, default=str, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def run_case(harness, case):
    observed = {"case": case, "complete": False, "snapshots": {}, "segments": []}
    try:
        result = execute_case(harness, case, observed)
        observed["complete"] = True
        persist_case(harness, case, observed)
        return result
    except BaseException as exc:
        observed["complete"] = False
        observed["failure_type"] = type(exc).__name__
        try:
            persist_case(harness, case, observed)
        except Exception as write_error:
            print(
                json.dumps(
                    {"case": case, "evidence_write_failure_type": type(write_error).__name__}
                ),
                file=sys.stderr,
            )
        raise


def execute_case(harness, case, observed):
    started = datetime.now(UTC).isoformat()
    harness.mock.reset()
    harness.mock.case = "normal"
    harness.mock.model.model_calls.clear()
    run_id = harness.create(case)
    decisions, snapshots, fault = [], observed["snapshots"], None
    observed.update(run_id=str(run_id), base_sha=harness.repo["base_sha"], decisions=decisions)
    persist_case(harness, case, observed)
    child, _ = harness.start_worker(run_id, "original")
    original = harness.processes[child.pid]
    deadline = time.monotonic() + 230
    while True:
        approve_pending(harness, run_id, decisions)
        if case != "normal" and original["barrier"].exists():
            checks.wait_stopped_barrier(child, original["barrier"], expected=original["expected"])
            snapshots["before_kill"] = harness.snapshot(run_id)
            persist_case(harness, case, observed)
            fault = checks.kill_at_barrier(
                child, original["barrier"], expected=original["expected"]
            )
            observed["fault"] = fault
            snapshots["after_kill"] = harness.snapshot(run_id)
            persist_case(harness, case, observed)
            child, _ = harness.start_worker(run_id, "successor")
            break
        if child.poll() is not None:
            base.require(
                case == "normal" and child.returncode == 0, "original_boundary_not_reached"
            )
            break
        base.require(time.monotonic() < deadline, "recovery_case_deadline")
        time.sleep(0.05)
    while child.poll() is None:
        base.require(time.monotonic() < deadline, "recovery_case_deadline")
        time.sleep(0.1)
    base.require(child.returncode == 0, "recovery_worker_failed")
    snapshots["final"] = harness.snapshot(run_id)
    persist_case(harness, case, observed)
    segments = []
    for process in harness.processes.values():
        if process["expected"]["run_id"] != str(run_id):
            continue
        segments.append(
            {
                "role": process["role"],
                **process["expected"],
                "returncode": process["child"].returncode,
                "policy_hashes": process["policy_hashes"],
                "records": [json.loads(line) for line in process["trace"].read_text().splitlines()],
            }
        )
    observed.update(segments=segments, fault=fault)
    persist_case(harness, case, observed)
    fence_probe = None
    if case != "normal":
        generation = snapshots["before_kill"]["run"]["generation"]
        denial = probe_generation(harness.client.http, run_id, generation)
        fence_probe = {
            **denial,
            "before": snapshots["final"]["upstream"],
            "after": harness.snapshot(run_id)["upstream"],
        }
    observed.update(fence_probe=fence_probe, segments=segments, fault=fault)
    persist_case(harness, case, observed)
    return {
        **checks.validate_case(observed, combined),
        "started_at": started,
        "finished_at": datetime.now(UTC).isoformat(),
    }


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--worker":
        child_main(Path(sys.argv[2]))
        return
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args, _ = parser.parse_known_args()
    Harness.config_path, Harness.output = args.config.resolve(), args.output.resolve()
    base.CASES, base.Harness, base.GitHubMock, base.run_case = (
        CASES,
        Harness,
        combined.Mock,
        run_case,
    )
    base.Database = combined.ObservedDatabase
    combined.ObservedDatabase.close_errors = []
    combined.model_mock.mock_response = lambda data, run_id: combined.model_response(
        data, run_id, "normal"
    )
    try:
        combined.run_shell(args.output)
    finally:
        combined.model_mock.mock_response = combined.original_mock_response


if __name__ == "__main__":
    main()
