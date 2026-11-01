#!/usr/bin/env python3
"""Opt-in combined ordinary Worker model-mailbox and tool-broker KVM acceptance."""

import argparse
import importlib.util
import json
import os
import secrets
import subprocess
import sys
import threading
import time
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import m3_integrated_checks as checks

import agent_platform.model_mock as model_mock
from agent_platform.connector_isolation import CODE
from agent_platform.connector_journal import private_file
from agent_platform.model_proxy import usage_view
from agent_platform_m0.sandbox_client import SingleNodeClient

spec = importlib.util.spec_from_file_location(
    "m3_worker_tools", Path(__file__).with_name("worker-tools-kvm.py")
)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
base = worker.base
CASES = ("normal", "request-cutoff", "invalid-usage")
MODEL = "local/m3-integrated-v1"
original_mock_response = model_mock.mock_response


def model_response(data, run_id, case):
    result = original_mock_response(data, run_id)
    function = result["choices"][0]["message"]["tool_calls"][0]["function"]
    if function["name"] == "terminal":
        function["arguments"] = json.dumps({"command": f"python3 -I {CODE}/m3_integrated_step.py"})
    if case == "invalid-usage":
        result["usage"]["completion_tokens"] = data["max_tokens"] + 1
        result["usage"]["total_tokens"] = 10 + data["max_tokens"] + 1
    return result


def install_step(config, run, init):
    """Only install a credential-free bounded program; keep native model processes."""
    row = json.loads(
        private_file(Path(config["state_dir"]) / (str(run["id"]) + ".json")).read_text()
    )
    node = SingleNodeClient(
        config["origin"], private_file(config["sandbox_token_file"]).read_text().strip()
    )
    handle = row["handle"]
    sandbox = node.attach(handle["owner"], handle["id"], handle["token"])
    program = f"""
import json,subprocess
from pathlib import Path
reply=subprocess.run(['python3','-I','{CODE}/guest_tool_client.py',json.dumps({base.REQUESTS[0]!r})],capture_output=True,text=True,timeout=20)
assert reply.returncode == 0
assert json.loads(reply.stdout) == {init["repository"]!r}
Path({checks.RESULT_FILE!r}).write_text(json.dumps({checks.EXPECTED!r},sort_keys=True)+'\\n')
print('WORKER_TOOL_1',flush=True)
"""
    sandbox.write_file(CODE + "/m3_integrated_step.py", program.encode(), mode=0o644)


class Mock(worker.Mock):
    last = None

    def __init__(self):
        Mock.last = self
        self.close_errors = []
        self.model_secret = secrets.token_urlsafe(32)
        self.case = None
        self.model = None
        self.model_thread = None
        try:
            super().__init__()
            self.model = model_mock.mock_server(0, self.model_secret, MODEL)
            self.model_thread = threading.Thread(target=self.model.serve_forever, daemon=True)
            self.model_thread.start()
        except BaseException:
            self.close()
            raise

    def close(self):
        # Split every action: a failed shutdown must not skip socket close or join.
        actions = []
        release = getattr(self, "release", None)
        if release is not None:
            actions.append(release.set)
        fixtures = ((self, getattr(self, "thread", None)), (self.model, self.model_thread))
        for server, thread in fixtures:
            if server is None:
                continue
            # BaseServer.shutdown waits forever if serve_forever never started.
            if thread is not None and thread.is_alive():
                actions.append(server.shutdown)
            if getattr(server, "socket", None) is not None:
                actions.append(server.server_close)
            if thread is not None and thread.ident is not None:
                actions.append(lambda thread=thread: thread.join(5))
        for action in actions:
            try:
                action()
            except Exception as exc:
                self.close_errors.append(type(exc).__name__)
        if any(thread is not None and thread.is_alive() for _, thread in fixtures):
            self.close_errors.append("FixtureThreadStillAlive")


class ObservedDatabase(base.Database):
    close_errors = []

    def close(self):
        try:
            super().close()
        except Exception as exc:
            # The report remains writable and the primary case failure survives.
            self.close_errors.append(type(exc).__name__)


class Harness(worker.Harness):
    def create(self, case):
        revision = self.post(
            "/agent-profiles",
            {
                "name": "Combined Worker " + case,
                "backend": "openhands",
                "mock_tools": True,
                "require_approval": case == "normal",
                "deadline_seconds": 600,
                "verification": checks.verification(),
            },
        )
        run = self.post(
            "/tasks",
            {
                "project_id": self.project["id"],
                "profile_revision": revision["id"],
                "title": case,
                "goal": "Read one repository through native model and tool mailboxes",
                "base_sha": self.repo["base_sha"],
            },
        )["run"]
        run_id = UUID(run["id"])
        self.issued.append(run_id)
        return run_id

    def start_worker(self, run_id, case):
        directory = self.output / f"worker-{len(self.children)}"
        directory.mkdir(mode=0o700)
        policy = asdict(self.mock.policy())
        secret = directory / "tool.secret"
        secret.write_text(policy.pop("secret"))
        policy["secret_file"] = str(secret)
        tool_config = directory / "tool.json"
        tool_config.write_text(json.dumps(policy, default=str))
        model_secret = directory / "model.secret"
        model_secret.write_text(self.mock.model_secret)
        model_config = directory / "model.json"
        model_config.write_text(
            json.dumps(
                {
                    "origin": f"http://127.0.0.1:{self.mock.model.server_port}",
                    "credential_file": str(model_secret),
                    "mode": "openai-compatible-mock-v1",
                    "model": MODEL,
                    "request_limit": 1 if case == "request-cutoff" else 10,
                }
            )
        )
        trace = directory / "trace.jsonl"
        path = directory / "init.json"
        path.write_text(
            json.dumps(
                {
                    "config": str(self.config_path),
                    "origin": self.origin,
                    "run_id": str(run_id),
                    "trace": str(trace),
                    "mask": str(self.output / "unused-proof-mask"),
                    "case": case,
                    "repository": self.mock.repository,
                }
            )
        )
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
        env.update(MODEL_PROXY_CONFIG=str(model_config), TOOL_BROKER_MOCK_CONFIG=str(tool_config))
        with (directory / "worker.log").open("w") as log:
            child = subprocess.Popen(
                [sys.executable, str(Path(__file__)), "--worker", str(path)],
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        self.children.append(child)
        return child, trace

    def stop_children(self):
        failures = []
        for process in [*self.children, self.connector]:
            if process and process.poll() is None:
                try:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=10)
                except Exception as exc:
                    failures.append(type(exc).__name__)
        if failures:
            raise RuntimeError("owned_process_cleanup_failed")

    def cleanup(self):
        try:
            return super().cleanup()
        except Exception as exc:
            # Base shell retains the original case exception; failed observations fail closed.
            result = {key: -1 for key in checks.CLEANUP_KEYS}
            result["cleanup_failures"] = 1
            result["cleanup_failure_type"] = type(exc).__name__
            return result


def run_case(harness, case):
    started = datetime.now(UTC).isoformat()
    mock = harness.mock
    mock.reset()
    mock.case = case
    mock.model.model_calls.clear()
    run_id = harness.create(case)
    child, trace = harness.start_worker(run_id, case)
    decisions = []
    deadline = time.monotonic() + 220
    while True:
        pending = harness.rows(
            "SELECT a.*,r.state AS observed_state,r.state_version AS observed_version "
            "FROM approvals a JOIN runs r ON r.id=a.run_id "
            "WHERE a.run_id=%s AND a.status='pending'",
            (run_id,),
        )
        for approval in pending:
            base.require(case == "normal" and not decisions, "unexpected_public_approval")
            base.require(
                approval["observed_state"] == "awaiting_approval", "approval_state_missing"
            )
            before = mock.authenticated
            base.require(before == 0, "dispatch_before_approval")
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
                    "dispatches_before": before,
                }
            )
        if child.poll() is not None:
            base.require(child.returncode == 0, "combined_worker_child_failed")
            break
        base.require(time.monotonic() < deadline, "case_deadline")
        time.sleep(0.05)
    records = [json.loads(line) for line in trace.read_text().splitlines()]
    authority = {}
    for prefix, table in (("model", "model_proxy"), ("tool", "tool_broker")):
        for suffix, relation, predicate in (
            ("runs", "runs", ""),
            ("tokens", "tokens", ""),
            ("active_tokens", "tokens", " AND revoked_at IS NULL"),
        ):
            authority[prefix + "_" + suffix] = harness.scalar(
                f"SELECT count(*) FROM {table}_{relation} WHERE run_id=%s{predicate}", (run_id,)
            )
    authority["tool_active_runs"] = harness.scalar(
        "SELECT count(*) FROM tool_broker_runs WHERE run_id=%s AND revoked_at IS NULL", (run_id,)
    )
    observed = {
        "case": case,
        "base_sha": harness.repo["base_sha"],
        "run": harness.run(run_id),
        "pages": [v for v in records if v["kind"] == "events"],
        "records": records,
        "stored_ids": [
            v["source_event_id"]
            for v in harness.rows(
                "SELECT source_event_id FROM run_events WHERE run_id=%s "
                "AND source='openhands' ORDER BY seq",
                (run_id,),
            )
        ],
        "decisions": decisions,
        "approvals": harness.rows(
            "SELECT id,status,action_digest,generation FROM approvals WHERE run_id=%s", (run_id,)
        ),
        "events": harness.rows(
            "SELECT type,payload FROM run_events WHERE run_id=%s ORDER BY seq", (run_id,)
        ),
        "operations": harness.rows(
            "SELECT operation_id,status,delivery,http_calls,"
            "(receipt_hash IS NOT NULL) AS receipt_present "
            "FROM tool_broker_operations WHERE run_id=%s ORDER BY admitted_at",
            (run_id,),
        ),
        "tool_calls": mock.calls,
        "tool_authenticated": mock.authenticated,
        "model_calls": len(mock.model.model_calls),
        "model_authenticated": all(
            item["path"] == "/v1/chat/completions"
            and item["authorization"] == "Bearer " + mock.model_secret
            and item["test_run_header"] == str(run_id)
            for item in mock.model.model_calls
        ),
        "usage": usage_view(harness.db, run_id),
        "authority": authority,
        "reservations": harness.reserved(run_id),
        "claims": len(harness.node.sandboxes()),
        "vms": len(harness.host.vms()),
    }
    # Durable private evidence supports failed-oracle diagnosis without raw prompts/credentials.
    (harness.output / (case + "-observations.json")).write_text(
        json.dumps(observed, default=str, indent=2) + "\n"
    )
    return {
        **checks.validate_observations(observed, worker),
        "started_at": started,
        "finished_at": datetime.now(UTC).isoformat(),
        "worker_pid": child.pid,
    }


def run_shell(output):
    """Reuse baseline shell without allowing report I/O to mask its original failure."""
    if output.exists():
        raise FileExistsError("acceptance_output_must_be_new")
    failure = None
    try:
        base.main()
    except BaseException as exc:
        failure = exc
    finally:
        path = output / "report.json"
        report = {"passed": False, "cases": []}
        report_errors = []
        writable = True
        if path.exists():
            try:
                report = json.loads(path.read_text())
                if not isinstance(report, dict):
                    raise ValueError("report_object_required")
            except Exception as exc:
                report = {"passed": False, "cases": []}
                report_errors.append({"operation": "read", "error_type": type(exc).__name__})
                # Preserve owned corrupt bytes before writing a fresh failed report.
                backup = output / ("report-corrupt-" + str(time.time_ns()) + ".json")
                try:
                    path.replace(backup)
                    report["corrupt_report_artifact"] = backup.name
                except Exception as backup_error:
                    writable = False
                    report_errors.append(
                        {
                            "operation": "preserve",
                            "error_type": type(backup_error).__name__,
                        }
                    )
        mock = Mock.last
        fixture_errors = mock.close_errors if mock else ["FixtureNotStarted"]
        report.update(
            transport="native-model-mailbox-and-tool-broker",
            real_provider=False,
            fixture_cleanup_errors=fixture_errors,
            database_cleanup_errors=ObservedDatabase.close_errors,
            report_io_errors=report_errors,
        )
        report["passed"] = (
            report.get("passed") is True
            and failure is None
            and checks.cleanup_passed(report)
            and not fixture_errors
            and not ObservedDatabase.close_errors
            and not report_errors
        )
        if failure:
            report["failure_type"] = type(failure).__name__
        if writable and output.is_dir() and (path.exists() or mock is not None or report_errors):
            try:
                path.write_text(json.dumps(report, indent=2) + "\n")
            except Exception as exc:
                report["passed"] = False
                report_errors.append({"operation": "write", "error_type": type(exc).__name__})
        if report_errors:
            # Retain an observable failure even when report storage itself is unavailable.
            print(json.dumps({"report_io_errors": report_errors}), file=sys.stderr)
    if failure:
        raise failure
    base.require(report["passed"], "combined_final_cleanup_incomplete")


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--worker":
        worker.install_model = install_step
        worker.worker_main(Path(sys.argv[2]))
        return
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args, _ = parser.parse_known_args()
    Harness.config_path, Harness.output = args.config.resolve(), args.output.resolve()
    base.CASES, base.Harness, base.GitHubMock, base.run_case = CASES, Harness, Mock, run_case
    base.Database = ObservedDatabase
    ObservedDatabase.close_errors = []
    model_mock.mock_response = lambda data, run_id: model_response(data, run_id, Mock.last.case)
    try:
        run_shell(args.output)
    finally:
        model_mock.mock_response = original_mock_response


if __name__ == "__main__":
    main()
