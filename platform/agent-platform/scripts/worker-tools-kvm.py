#!/usr/bin/env python3
"""Opt-in normal Worker KVM acceptance; only owned loopback fixtures/resources."""

import argparse
import base64
import copy
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
from dataclasses import asdict, replace
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

from tool_process_fixture import baseline

from agent_platform.connector_isolation import CODE, CONTROL
from agent_platform.connector_journal import private_file
from agent_platform.connector_recovery import stopped
from agent_platform.db import Database
from agent_platform.domain import TERMINAL
from agent_platform.runtime_client import RuntimeClient
from agent_platform.verification import VerificationPolicy, contract_sha256
from agent_platform.worker import Worker
from agent_platform_m0.sandbox_client import SingleNodeClient

base = baseline()
CASES = ("normal", "disabled", "cancel-in-flight", "tool-outcome-uncertain", "partial-stop-proof")
RESULT_FILE = "worker-tools.json"


def expected_checks(case):
    return (
        {"disabled": True} if case == "disabled" else {f"operation_{i}": True for i in range(1, 4)}
    )


def verification(case):
    return {
        "mode": "commands",
        "revision": "worker-tools-kvm-v1",
        "checks": [
            {
                "id": "tool-results",
                "argv": [
                    "python3",
                    "-I",
                    "-c",
                    "import json;from pathlib import Path;assert "
                    f"json.loads(Path({RESULT_FILE!r}).read_text()) == {expected_checks(case)!r}",
                ],
                "timeout_seconds": 10,
            }
        ],
    }


def validate_trace(pages, *, finished):
    """Check the actual responses consumed by Worker, before SQL deduplication."""
    ids, cursor, markers = [], None, []
    for page in pages:
        base.require(page["request_cursor"] == cursor, "sdk_cursor_discontinuity")
        for item in page["events"]:
            base.require(item["event_id"] not in ids, "sdk_event_replayed")
            base.require(item["cursor"] == item["event_id"], "sdk_cursor_invalid")
            ids.append(item["event_id"])
            cursor = item["cursor"]
            markers.extend(item["markers"])
        base.require(page["response_cursor"] == cursor, "sdk_response_cursor_invalid")
    complete = bool(pages and pages[-1]["state"] == "finished" and pages[-1]["caught_up"] is True)
    if finished:
        base.require(complete, "sdk_completion_missing")
    return {
        "sdk_finished": complete,
        "sdk_caught_up": complete,
        "sdk_poll_count": len(pages),
        "sdk_event_count": len(ids),
        "sdk_no_duplicate_events": True,
        "markers": markers,
    }


def validate_result(result, case, base_sha):
    raw = json.dumps(expected_checks(case), sort_keys=True) + "\n"
    patch = result["diff"]
    # Git's new-file header contains an object hash; assert all content and paths.
    lines = patch.splitlines()
    base.require(
        len(lines) == 7
        and lines[0] == f"diff --git a/{RESULT_FILE} b/{RESULT_FILE}"
        and lines[1] == "new file mode 100644"
        and lines[2].startswith("index 0000000..")
        and lines[3:6] == ["--- /dev/null", f"+++ b/{RESULT_FILE}", "@@ -0,0 +1 @@"]
        and lines[6] == "+" + raw.rstrip("\n"),
        "result_patch_mismatch",
    )
    digest = hashlib.sha256(patch.encode()).hexdigest()
    check = result["verification"]
    base.require(
        result["base_sha"] == base_sha
        and result["diff_sha256"] == digest
        and result["diff_bytes"] == len(patch.encode()),
        "result_integrity_mismatch",
    )
    base.require(
        check["status"] == "passed"
        and check["name"] == "profile_verification"
        and check["contract_sha256"]
        == contract_sha256(VerificationPolicy.model_validate(verification(case)))
        and check["diff_sha256"] == digest
        and len(check["checks"]) == 1
        and check["checks"][0]["id"] == "tool-results"
        and check["checks"][0]["status"] == "passed"
        and check["checks"][0]["exit_code"] == 0,
        "profile_verification_missing",
    )
    return {
        "diff_sha256": digest,
        "verification_contract_sha256": check["contract_sha256"],
        "profile_verification_passed": True,
    }


class Mock(base.GitHubMock):
    def __init__(self):
        super().__init__()
        self.fail = False
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                fixture.calls += 1
                if self.headers.get("Authorization") != "Bearer " + fixture.secret:
                    self.send_error(401)
                    return
                fixture.authenticated += 1
                fixture.entered.set()
                if fixture.fail:
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                if fixture.hold:
                    fixture.waiting.set()
                    released = fixture.release.wait(8)
                    fixture.waiting.clear()
                    if not released:
                        self.send_error(504)
                        return
                root = "/repos/" + fixture.full_name
                routes = {
                    root: fixture.repository,
                    root + "/issues/1": base.ISSUE,
                    root + "/git/commits/" + fixture.commit: {
                        "sha": fixture.commit,
                        "tree": {"sha": "b" * 40},
                    },
                    root + "/git/trees/" + "b" * 40: {
                        "sha": "b" * 40,
                        "truncated": False,
                        "tree": [
                            {"path": "README.md", "type": "blob", "mode": "100644", "sha": "c" * 40}
                        ],
                    },
                    root + "/git/blobs/" + "c" * 40: {
                        "sha": "c" * 40,
                        "encoding": "base64",
                        "size": len(base.CONTENT),
                        "content": base64.b64encode(base.CONTENT).decode(),
                    },
                }
                if self.path not in routes:
                    self.send_error(404)
                    return
                raw = json.dumps(routes[self.path]).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                try:
                    self.wfile.write(raw)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.RequestHandlerClass = Handler

    def configure(self, repo):
        address = urlsplit(repo["canonical_repo"])
        base.require(address.hostname == "github.com", "fixture_repository_invalid")
        self.full_name = address.path.strip("/")
        self.owner, self.repository_name = self.full_name.split("/")
        self.commit = repo["base_sha"]
        self.repository = {**base.REPOSITORY, "full_name": self.full_name}

    def policy(self):
        return replace(
            super().policy(),
            owner=self.owner,
            repository=self.repository_name,
            credential_path_prefix=f"/repos/{self.full_name}/",
            commit=self.commit,
            total_timeout=10,
            idle_timeout=5,
        )


def install_model(config, run, init):
    """Test-model setup only, after native prepare, before Worker bind/prompt."""
    row = json.loads(
        private_file(Path(config["state_dir"]) / (str(run["id"]) + ".json")).read_text()
    )
    node = SingleNodeClient(
        config["origin"], private_file(config["sandbox_token_file"]).read_text().strip()
    )
    sb = node.attach(row["handle"]["owner"], row["handle"]["id"], row["handle"]["token"])
    case = init["case"]
    requests = copy.deepcopy(base.REQUESTS)
    requests[2]["commit"] = run["base_sha"]
    expected = [
        init["repository"],
        base.ISSUE,
        {
            "path": "README.md",
            "commit": run["base_sha"],
            "sha": "c" * 40,
            "encoding": "base64",
            "size": len(base.CONTENT),
            "content": base64.b64encode(base.CONTENT).decode(),
        },
    ]
    program = f"""
import json,subprocess,sys
from pathlib import Path
stage=int(sys.argv[1]); disabled={case == "disabled"!r}
reply=subprocess.run(['python3','-I','{CODE}/guest_tool_client.py',json.dumps({requests!r}[stage])],capture_output=True,text=True,timeout=20)
value=json.loads(reply.stdout)
if disabled:
    assert reply.returncode != 0 and value == {{'error':'tool_transport_unavailable'}}
    checks={{'disabled':True}}
else:
    assert reply.returncode == 0 and value == {expected!r}[stage]
    path=Path({RESULT_FILE!r})
    checks=json.loads(path.read_text()) if path.exists() else {{}}
    checks['operation_'+str(stage+1)]=True
Path({RESULT_FILE!r}).write_text(json.dumps(checks,sort_keys=True)+'\\n')
print('WORKER_TOOL_DISABLED' if disabled else 'WORKER_TOOL_'+str(stage+1),flush=True)
"""
    sb.write_file(CODE + "/worker_tool_step.py", program.encode(), mode=0o644)
    if case == "disabled":
        client = Path(__file__).resolve().parents[1] / "src/agent_platform/guest_tool_client.py"
        sb.write_file(CODE + "/guest_tool_client.py", client.read_bytes(), mode=0o644)
    source = (
        Path(__file__).resolve().parents[1] / "src/agent_platform/guest_fixture.py"
    ).read_text()
    helper = f"""
LAST_ACK=None
def edit_command(messages, run_id):
    global LAST_ACK
    stage=sum(m.get('role')=='tool' for m in messages)
    if stage and {case != "disabled"!r}:
        from pathlib import Path
        deadline=time.monotonic()+15
        while True:
            value=json.loads(Path('{CONTROL}/tool-mailbox.json').read_text())
            if value.get('state')=='acknowledged' and value.get('operation_id') != LAST_ACK:
                LAST_ACK=value['operation_id']; break
            if time.monotonic()>deadline: raise RuntimeError('worker_ack_not_observed')
            time.sleep(.05)
    return 'python3 -I {CODE}/worker_tool_step.py '+str(stage)

"""
    base.require(source.count("class Handler(") == 1, "fixture_seam_changed")
    source = source.replace("class Handler(", helper + "class Handler(")
    source = source.replace(
        'called = any(m.get("role") == "tool" for m in messages)',
        'called = sum(m.get("role") == "tool" for m in messages)',
    )
    source = source.replace(
        'if not called and "terminal" in functions:',
        f'if called < {1 if case == "disabled" else 3} and "terminal" in functions:',
    )
    source = source.replace('("_finish" if called else "_edit")', '("_stage_" + str(called))')
    sb.exec(
        "python3",
        "-I",
        "-c",
        "import os,signal;from pathlib import Path\n"
        "for p in Path('/proc').glob('[0-9]*'):\n try:\n"
        "  if b'/opt/agent-platform/guest_fixture.py' in (p/'cmdline').read_bytes().split(b'\\0'):"
        " os.kill(int(p.name),signal.SIGTERM)\n"
        " except (FileNotFoundError,ProcessLookupError): pass\n",
        timeout=10,
    )
    sb.write_file(CODE + "/worker_tool_model.py", source.encode(), mode=0o644)
    sb.spawn(
        "python3",
        "-I",
        CODE + "/worker_tool_model.py",
        user="agentcontrol",
        cwd=CONTROL,
        env={"FIXTURE_RUN_ID": str(run["id"])},
    )
    sb.exec(
        "python3",
        "-I",
        "-c",
        "import socket,time\nfor _ in range(50):\n try:\n"
        "  s=socket.create_connection(('127.0.0.1',18080),.2);s.close();break\n"
        " except OSError: time.sleep(.1)\nelse: raise RuntimeError('model_not_ready')\n",
        timeout=10,
    )


def mask_proofs(value, active):
    """Mask all proof-bearing responses, including fallback cancel and inspect."""
    result = copy.deepcopy(value)
    proofs = []

    def walk(node):
        if isinstance(node, dict):
            if node.get("observed_state") == "stopped" and "proof" in node:
                proofs.append({"complete": stopped(node), "withheld": active})
                if active:
                    node["proof"]["cpu_scope_gone"] = False
            for item in node.values():
                walk(item)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(result)
    return result, proofs


def worker_main(init_path):
    init = json.loads(private_file(init_path).read_text())
    config = json.loads(private_file(init["config"]).read_text())
    db = Database(os.environ["TEST_DATABASE_URL"])
    db.open()
    trace = Path(init["trace"])

    def emit(value):
        with trace.open("a") as out:
            out.write(json.dumps(value, default=str) + "\n")

    class ObservedClient(RuntimeClient):
        def call(self, method, path, data=None):
            value = super().call(method, path, data)
            value, proofs = mask_proofs(value, Path(init["mask"]).exists())
            for proof in proofs:
                with db.transaction() as conn:
                    count = conn.execute(
                        "SELECT count(*) AS n FROM resource_reservations WHERE released_at IS NULL"
                    ).fetchone()["n"]
                emit({"kind": "proof", **proof, "reserved_before_return": count})
            return value

        def operation(self, run, action):
            result = super().operation(run, action)
            if action == "prepare":
                install_model(config, run, init)
            return result

        def tool(self, run, action, **data):
            emit({"kind": "tool", "action": action, "operation_id": data.get("operation_id")})
            return super().tool(run, action, **data)

        def events(self, run):
            value = super().events(run)
            events = []
            for item in value["events"]:
                content = item["payload"].get("content", "")
                events.append(
                    {
                        "event_id": item["event_id"],
                        "cursor": item["cursor"],
                        "markers": [
                            m
                            for m in (
                                "WORKER_TOOL_1",
                                "WORKER_TOOL_2",
                                "WORKER_TOOL_3",
                                "WORKER_TOOL_DISABLED",
                            )
                            if item["payload"]["kind"] == "ObservationEvent" and m in content
                        ],
                    }
                )
            emit(
                {
                    "kind": "events",
                    "request_cursor": run["backend_cursor"],
                    "response_cursor": events[-1]["cursor"] if events else run["backend_cursor"],
                    "events": events,
                    "state": value["state"],
                    "caught_up": value["caught_up"],
                }
            )
            return value

    try:
        client = ObservedClient(
            init["origin"], private_file(config["connector_token_file"]).read_text().strip()
        )
        worker = Worker(db, client)
        emit({"kind": "worker", "pid": os.getpid(), "owner": worker.owner})
        deadline = time.monotonic() + 180
        while True:
            worker.run_once()
            with db.transaction() as conn:
                run = conn.execute(
                    "SELECT cleanup_state FROM runs WHERE id=%s", (UUID(init["run_id"]),)
                ).fetchone()
            if run["cleanup_state"] == "confirmed":
                return
            base.require(time.monotonic() < deadline, "worker_acceptance_deadline")
            time.sleep(0.1)
    finally:
        db.close()


class Harness(base.Harness):
    output = config_path = None

    def __init__(self, config, origin, db, api, post, mock):
        self.children = []
        self.connector = None
        self.origin = origin
        address = urlsplit(origin)
        base.require(address.hostname == "127.0.0.1", "loopback_connector_required")
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind((address.hostname, address.port))
        with (self.output / "connector.log").open("w") as log:
            self.connector = subprocess.Popen(
                [
                    sys.executable,
                    str(Path(__file__).with_name("tool_process_fixture.py")),
                    "connector",
                    str(self.config_path),
                    str(address.port),
                ],
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        try:

            def ready():
                base.require(self.connector.poll() is None, "connector_exited")
                try:
                    with socket.create_connection((address.hostname, address.port), timeout=0.2):
                        return True
                except OSError:
                    return False

            base.until(ready, seconds=20)
            super().__init__(config, origin, db, api, post, mock)
            mock.configure(self.repo)
        except BaseException:
            self.stop_children()
            raise

    def stop_children(self):
        for process in [*self.children, self.connector]:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)

    def run(self, run_id):
        with self.db.transaction() as conn:
            return conn.execute("SELECT * FROM runs WHERE id=%s", (run_id,)).fetchone()

    def rows(self, sql, params=()):
        with self.db.transaction() as conn:
            return conn.execute(sql, params).fetchall()

    def start_worker(self, run_id, case):
        directory = self.output / f"worker-{len(self.children)}"
        directory.mkdir(mode=0o700)
        policy = asdict(self.mock.policy())
        secret = directory / "tool.secret"
        secret.write_text(policy.pop("secret"))
        policy["secret_file"] = str(secret)
        config = directory / "tool.json"
        config.write_text(json.dumps(policy, default=str))
        trace, mask = directory / "trace.jsonl", self.output / "mask-proof"
        init = {
            "config": str(self.config_path),
            "origin": self.origin,
            "run_id": str(run_id),
            "trace": str(trace),
            "mask": str(mask),
            "case": case,
            "repository": self.mock.repository,
        }
        path = directory / "init.json"
        path.write_text(json.dumps(init))
        env = {**os.environ, "TOOL_BROKER_MOCK_CONFIG": str(config)}
        with (directory / "worker.log").open("w") as log:
            child = subprocess.Popen(
                [sys.executable, str(Path(__file__)), "--worker", str(path)],
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        self.children.append(child)
        return child, trace

    def create(self, case):
        profile = {
            "name": "Normal Worker KVM",
            "backend": "openhands",
            "require_approval": True,
            "deadline_seconds": 600,
            "verification": verification(case),
        }
        if case != "disabled":
            profile["mock_tools"] = True
        revision = self.post("/agent-profiles", profile)
        run = self.post(
            "/tasks",
            {
                "project_id": self.project["id"],
                "profile_revision": revision["id"],
                "title": case,
                "goal": "Execute bounded Worker tool acceptance",
                "base_sha": self.repo["base_sha"],
            },
        )["run"]
        run_id = UUID(run["id"])
        self.issued.append(run_id)
        return run_id

    def cleanup(self):
        failures = 0
        try:
            for run_id in self.issued:
                try:
                    row = self.run(run_id)
                    if row["cleanup_state"] == "confirmed":
                        continue
                    (self.output / "mask-proof").unlink(missing_ok=True)
                    if row["state"] not in TERMINAL:
                        self.action(run_id, "cancel")
                    if not any(child.poll() is None for child in self.children):
                        self.start_worker(run_id, "cleanup")
                    base.until(
                        lambda run_id=run_id: self.run(run_id)["cleanup_state"] == "confirmed",
                        seconds=100,
                    )
                except Exception:
                    failures += 1
        finally:
            self.stop_children()
        workers = sum(p.poll() is None for p in self.children)
        connectors = int(self.connector is not None and self.connector.poll() is None)
        return {
            "cleanup_failures": failures + workers + connectors,
            "remaining_claims": len(self.node.sandboxes()),
            "remaining_vms": len(self.host.vms()),
            "remaining_reservations": self.scalar(
                "SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"
            ),
            "remaining_worker_processes": workers,
            "remaining_connector_processes": connectors,
        }


def validate_approvals(decisions, actual, events, case):
    count = 3 if case in {"normal", "partial-stop-proof"} else 1
    base.require(len(decisions) == len(actual) == count, "approval_count_mismatch")
    for expected in decisions:
        rows = [v for v in actual if str(v["id"]) == expected["id"]]
        base.require(len(rows) == 1, "approval_identity_changed")
        row = rows[0]
        base.require(
            row["action_digest"] == expected["digest"]
            and row["generation"] == expected["generation"],
            "approval_identity_changed",
        )
        base.require(row["status"] == "applied", "approval_not_applied")
        kinds = [v["type"] for v in events if v["payload"].get("approval_id") == expected["id"]]
        base.require(
            kinds == ["approval.requested", "approval.decided", "approval.applied"],
            "approval_order_invalid",
        )


def validate_fault_delivery(records, operations):
    base.require(
        not any(v["kind"] == "tool" and v["action"] in {"deliver", "ack"} for v in records)
        and all(v["delivery"] in {"none", "withheld"} for v in operations),
        "fault_tool_delivery_attempted",
    )


def run_case(harness, case):
    started_at = datetime.now(UTC).isoformat()
    mock = harness.mock
    mock.reset(hold=case == "cancel-in-flight")
    mock.fail = case == "tool-outcome-uncertain"
    mask = harness.output / "mask-proof"
    if case == "partial-stop-proof":
        mask.write_text("withhold cpu scope proof\n")
    run_id = harness.create(case)
    child, trace = harness.start_worker(run_id, case)
    approvals, cancelled, retained = [], False, False
    started = time.monotonic()
    while True:
        run = harness.run(run_id)
        pending = harness.rows(
            "SELECT a.*,r.state AS observed_state,r.state_version AS observed_version "
            "FROM approvals a JOIN runs r ON r.id=a.run_id "
            "WHERE a.run_id=%s AND a.status='pending'",
            (run_id,),
        )
        for approval in pending:
            base.require(
                approval["observed_state"] == "awaiting_approval", "approval_state_missing"
            )
            before = mock.authenticated
            if not approvals:
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
            approvals.append(
                {
                    "id": str(approval["id"]),
                    "generation": approval["generation"],
                    "digest": approval["action_digest"],
                    "dispatches_before": before,
                }
            )
        if case == "cancel-in-flight" and mock.waiting.is_set() and not cancelled:
            base.require(harness.reserved(run_id) == 1, "cancel_capacity_missing")
            harness.action(run_id, "cancel")
            base.require(
                mock.waiting.is_set() and not mock.release.is_set(), "cancel_waited_for_upstream"
            )
            base.require(harness.reserved(run_id) == 1, "cancel_released_capacity_early")
            cancelled = True
            mock.release.set()
        if case == "partial-stop-proof" and run["cleanup_state"] == "unknown" and not retained:
            base.require(
                harness.reserved(run_id) == 1 and mask.exists(), "partial_proof_released_capacity"
            )
            retained = True
            mask.unlink()
        if child.poll() is not None:
            base.require(child.returncode == 0, "normal_worker_child_failed")
            break
        base.require(time.monotonic() - started < 220, "case_deadline")
        time.sleep(0.05)
    records = [json.loads(line) for line in trace.read_text().splitlines()]
    pages = [v for v in records if v["kind"] == "events"]
    normal = case in {"normal", "disabled", "partial-stop-proof"}
    result = {"case": case, "worker_pid": child.pid, **validate_trace(pages, finished=normal)}
    run = harness.run(run_id)
    operations = harness.rows(
        "SELECT operation_id,binding_id,generation,status,delivery,http_calls, "
        "(receipt_hash IS NOT NULL) AS receipt_present "
        "FROM tool_broker_operations WHERE run_id=%s ORDER BY admitted_at",
        (run_id,),
    )
    events = harness.rows(
        "SELECT type,source_event_id,payload FROM run_events WHERE run_id=%s ORDER BY seq",
        (run_id,),
    )
    ids = [item["event_id"] for page in pages for item in page["events"]]
    stored = harness.rows(
        "SELECT source_event_id FROM run_events WHERE run_id=%s "
        "AND source='openhands' ORDER BY seq",
        (run_id,),
    )
    base.require(ids == [v["source_event_id"] for v in stored], "worker_events_not_persisted")
    actual_approvals = harness.rows(
        "SELECT id,status,action_digest,generation FROM approvals WHERE run_id=%s", (run_id,)
    )
    validate_approvals(approvals, actual_approvals, events, case)
    if normal:
        base.require(run["state"] == "succeeded", "worker_did_not_succeed")
        result.update(validate_result(run["result"], case, harness.repo["base_sha"]))
        wanted = (
            ["WORKER_TOOL_DISABLED"]
            if case == "disabled"
            else [f"WORKER_TOOL_{i}" for i in range(1, 4)]
        )
        base.require(result["markers"] == wanted, "sdk_observations_missing")
    else:
        base.require(
            run["state"] == ("cancelled" if cancelled else "failed") and run["result"] is None,
            "fault_reported_success",
        )
    expected_ops = 0 if case == "disabled" else 3 if normal else 1
    expected_hops = 0 if case == "disabled" else 7 if normal else 1
    base.require(
        len(operations) == expected_ops and mock.calls == mock.authenticated == expected_hops,
        "tool_replay_or_dispatch_mismatch",
    )
    base.require(
        all(
            v["status"] == "succeeded" and v["delivery"] == "acknowledged" and v["receipt_present"]
            for v in operations
        )
        if normal
        else all(v["delivery"] != "acknowledged" for v in operations),
        "tool_delivery_mismatch",
    )
    if case == "disabled":
        base.require(
            harness.scalar("SELECT count(*) FROM tool_broker_runs WHERE run_id=%s", (run_id,)) == 0,
            "disabled_grant_created",
        )
        base.require(not harness.row(run_id).get("tool_channel"), "disabled_channel_bound")
    else:
        base.require(
            harness.scalar("SELECT count(*) FROM tool_broker_runs WHERE run_id=%s", (run_id,)) == 1
            and harness.scalar(
                "SELECT count(*) FROM tool_broker_runs WHERE run_id=%s AND revoked_at IS NULL",
                (run_id,),
            )
            == 0
            and harness.scalar("SELECT count(*) FROM tool_broker_tokens WHERE run_id=%s", (run_id,))
            > 0
            and harness.scalar(
                "SELECT count(*) FROM tool_broker_tokens WHERE run_id=%s AND revoked_at IS NULL",
                (run_id,),
            )
            == 0,
            "tool_authority_not_revoked",
        )
    if not normal:
        validate_fault_delivery(records, operations)
    if case == "partial-stop-proof":
        base.require(retained, "partial_proof_not_exercised")
    proofs = [v for v in records if v["kind"] == "proof"]
    base.require(
        proofs
        and all(v["complete"] and v["reserved_before_return"] == 1 for v in proofs)
        and any(not v["withheld"] for v in proofs),
        "full_stop_proof_missing",
    )
    base.require(
        run["cleanup_state"] == "confirmed" and harness.reserved(run_id) == 0,
        "worker_cleanup_incomplete",
    )
    base.require(not harness.node.sandboxes() and not harness.host.vms(), "owned_vm_remains")
    result.update(
        {
            "started_at": started_at,
            "finished_at": datetime.now(UTC).isoformat(),
            "normal_worker_lifecycle": True,
            "run_state": run["state"],
            "approvals": approvals,
            "operations": [
                {k: str(v) if isinstance(v, UUID) else v for k, v in row.items()}
                for row in operations
            ],
            "authenticated_upstream_hops": mock.authenticated,
            "no_replay": True,
            "tool_authority_revoked_or_absent": True,
            "fault_zero_deliver_ack": not normal,
            "partial_proof_retained_capacity": retained,
            "cancel_returned_while_upstream_held": cancelled,
            "capacity_retained_until_full_proof": True,
            "cleanup_confirmed": True,
            "passed": True,
        }
    )
    return result


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--worker":
        worker_main(Path(sys.argv[2]))
        return
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args, _ = parser.parse_known_args()
    Harness.config_path, Harness.output = args.config, args.output
    base.CASES, base.Harness, base.GitHubMock, base.run_case = CASES, Harness, Mock, run_case
    base.main()


if __name__ == "__main__":
    main()
