#!/usr/bin/env python3
"""Opt-in TB-2b acceptance: dedicated KVM node, SQL and real SDK terminal.

Run beside the fixture-enabled connector using the same private config and a
fresh agent_platform_test database. Only synthetic loopback GitHub is used.
Reports contain booleans/counts; private configuration and credentials stay local.
"""

import argparse
import base64
import json
import os
import secrets
import socket
import threading
import time
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import UUID, uuid4

import psycopg
from fastapi.testclient import TestClient
from tool_kvm_probe import GUEST_PROBE, PROOF_PATH, validate_proof

from agent_platform.api import create_app
from agent_platform.auth import bootstrap
from agent_platform.cancellation import execute_cancel
from agent_platform.config import Settings
from agent_platform.connector_isolation import CODE, CONTROL
from agent_platform.connector_journal import private_file
from agent_platform.connector_recovery import STOP_KEYS, stopped
from agent_platform.controls import execute_control
from agent_platform.db import Database, migrate
from agent_platform.domain import Problem
from agent_platform.egress_node import attest
from agent_platform.egress_policy import digest as egress_digest
from agent_platform.model_policy import Policy as ModelPolicy
from agent_platform.model_proxy import ModelProxy
from agent_platform.runtime_client import RuntimeClient
from agent_platform.runtime_worker import heartbeat
from agent_platform.tool_broker.broker import Broker
from agent_platform.tool_broker.policy import Policy
from agent_platform.tool_session import ToolSession
from agent_platform.worker import Worker
from agent_platform_m0.kvm_lifecycle import Host
from agent_platform_m0.sandbox_client import SingleNodeClient
from agent_platform_m0.transport import HTTP

CASES = (
    "complete",
    "cross-run",
    "helper-restart",
    "session-rebind",
    "worker-takeover",
    "revoke",
    "pause",
    "cancel",
    "cutoff",
    "stop-proof",
)
ROUNDTRIP = "/home/agentprobe/workspace/tool-roundtrip-proof.json"
REPOSITORY = {"id": 123, "full_name": "example/project", "private": True}
ISSUE = {"number": 1, "title": "Synthetic issue", "body": "Untrusted fixture text", "state": "open"}
CONTENT = b"Synthetic read-only file\n"
REQUESTS = [
    {"operation": "github.repository.get", "repository_id": 123},
    {"operation": "github.issue.get", "repository_id": 123, "issue_number": 1},
    {"operation": "github.file.get", "repository_id": 123, "commit": "a" * 40, "path": "README.md"},
]


def require(value, code):
    if not value:
        raise RuntimeError(code)


def until(check, *, seconds=60):
    deadline = time.monotonic() + seconds
    while not (value := check()):
        require(time.monotonic() < deadline, "acceptance_wait_expired")
        time.sleep(0.1)
    return value


def terminal_proof(context, path):
    """Read only a fixed test artifact; do not drive SDK state after approval."""
    return json.loads(
        context["sb"].exec(
            "python3",
            "-I",
            "-c",
            "from pathlib import Path; p=Path(" + repr(path) + ");"
            "print(p.read_text() if p.exists() else 'null')",
            timeout=5,
        )
    )


class GitHubMock(ThreadingHTTPServer):
    """Fixed routes with one controllable first-hop barrier; no request logging."""

    daemon_threads = True

    def __init__(self):
        self.secret = secrets.token_urlsafe(32)
        self.calls = 0
        self.authenticated = 0
        self.hold = False
        self.entered, self.release = threading.Event(), threading.Event()
        self.waiting = threading.Event()
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
                if fixture.hold:
                    fixture.waiting.set()
                    released = fixture.release.wait(4)
                    fixture.waiting.clear()
                    if not released:
                        self.send_error(504)
                        return
                root = "/repos/example/project"
                routes = {
                    root: REPOSITORY,
                    root + "/issues/1": ISSUE,
                    root + "/git/commits/" + "a" * 40: {"sha": "a" * 40, "tree": {"sha": "b" * 40}},
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
                        "size": len(CONTENT),
                        "content": base64.b64encode(CONTENT).decode(),
                    },
                }
                value = routes.get(self.path)
                if value is None:
                    self.send_error(404)
                    return
                raw = json.dumps(value).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                try:
                    self.wfile.write(raw)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        super().__init__(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.release.set()
        self.shutdown()
        self.server_close()
        self.thread.join(5)

    def reset(self, hold=False):
        self.calls = self.authenticated = 0
        self.hold = hold
        self.entered.clear()
        self.release.clear()
        self.waiting.clear()

    def policy(self):
        origin = f"http://127.0.0.1:{self.server_port}"
        return Policy(
            service_id=uuid4(),
            credential_revision=uuid4(),
            origin=origin,
            credential_origin=origin,
            credential_path_prefix="/repos/example/project/",
            secret=self.secret,
            repository_id=123,
            owner="example",
            repository="project",
            commit="a" * 40,
            paths=("README.md",),
            issues=(1,),
        )


def install_fixture(sb, run_id, *, complete):
    """Replace only the deterministic model in this driver's own guest."""
    sb.write_file(CODE + "/tool_kvm_probe.py", GUEST_PROBE.encode(), mode=0o644)
    program = f"""
import json,subprocess,time
from pathlib import Path
requests={REQUESTS!r} if {complete!r} else {REQUESTS[:1]!r}
checks={{}}
for index,payload in enumerate(requests,1):
    reply=subprocess.run(['python3','-I','{CODE}/guest_tool_client.py',json.dumps(payload)],
                         capture_output=True,text=True,timeout=20)
    value=json.loads(reply.stdout)
    if {complete!r}:
        expected=[{REPOSITORY!r},{ISSUE!r},
                  {{'path':'README.md','commit':{"a" * 40!r},'sha':{"c" * 40!r},
                    'encoding':'base64','size':{len(CONTENT)},
                    'content':{base64.b64encode(CONTENT).decode()!r}}}][index-1]
        checks['operation_'+str(index)]=reply.returncode==0 and value==expected
        deadline=time.monotonic()+15
        while not Path('{CODE}/tool-ack-'+str(index)).exists():
            if time.monotonic()>deadline: raise RuntimeError('host_ack_missing')
            time.sleep(.1)
    else:
        checks['withheld_result']=(reply.returncode!=0 and
                                  value=={{'error':'tool_transport_unavailable'}})
Path({ROUNDTRIP!r}).write_text(json.dumps(checks))
"""
    sb.write_file(CODE + "/tool_roundtrip.py", program.encode(), mode=0o644)
    sb.exec(
        "python3",
        "-I",
        "-c",
        "import os,signal;from pathlib import Path\n"
        "for p in Path('/proc').glob('[0-9]*'):\n"
        " try:\n"
        "  args=(p/'cmdline').read_bytes().split(b'\\0')\n"
        "  if b'/opt/agent-platform/guest_fixture.py' in args:\n"
        "   os.kill(int(p.name),signal.SIGTERM)\n"
        " except (FileNotFoundError,ProcessLookupError): pass\n",
        timeout=10,
    )
    command = f"python3 -I {CODE}/tool_roundtrip.py"
    if complete:
        command = f"python3 -I {CODE}/tool_kvm_probe.py && " + command
    source = (
        Path(__file__).resolve().parents[1] / "src/agent_platform/guest_fixture.py"
    ).read_text()
    marker = "class Handler("
    require(source.count(marker) == 1, "fixture_seam_changed")
    source = source.replace(
        marker,
        "def edit_command(messages, run_id):\n    return " + repr(command) + "\n\n" + marker,
    )
    sb.write_file(CODE + "/tool_fixture.py", source.encode(), mode=0o644)
    sb.spawn(
        "python3",
        "-I",
        CODE + "/tool_fixture.py",
        user="agentcontrol",
        cwd=CONTROL,
        env={"FIXTURE_RUN_ID": str(run_id)},
    )
    sb.exec(
        "python3",
        "-I",
        "-c",
        "import socket,time\nfor _ in range(50):\n try:\n"
        "  s=socket.create_connection(('127.0.0.1',18080),.2);s.close();break\n"
        " except OSError: time.sleep(.1)\nelse: raise RuntimeError('fixture_not_ready')\n",
        timeout=10,
    )


class Harness:
    def __init__(self, config, origin, db, api, post, mock):
        self.config, self.db, self.api, self.post, self.mock = config, db, api, post, mock
        self.client = RuntimeClient(
            origin, private_file(config["connector_token_file"]).read_text().strip()
        )
        self.node = SingleNodeClient(
            config["origin"], private_file(config["sandbox_token_file"]).read_text().strip()
        )
        self.host = Host(Path(config["cocoon_config"]), Path(config["sandbox_data_dir"]))
        self.catalog = self.client.register(db)
        require(
            config.get("egress_policy") == {"revision": "node-egress-v1", "allow": []},
            "deny_all_policy_required",
        )
        observed = attest(config)
        require(
            observed["policy_sha256"]
            == self.catalog["egress_policy_sha256"]
            == egress_digest(config["egress_policy"]),
            "sealed_policy_digest_mismatch",
        )
        self.repo = config["repositories"][0]
        self.project = post(
            "/projects", {"name": "Tool broker KVM", "canonical_repo": self.repo["canonical_repo"]}
        )
        self.profile = post(
            "/agent-profiles",
            {
                "name": "Tool broker KVM",
                "backend": "openhands",
                "require_approval": True,
                "deadline_seconds": 600,
                "verification": {"mode": "fixture-m2", "revision": "fixture-m2-v1", "checks": []},
            },
        )
        self.issued = []
        self.stack = ExitStack()

    def row(self, run_id):
        return json.loads(
            private_file(Path(self.config["state_dir"]) / (str(run_id) + ".json")).read_text()
        )

    def snapshot(self, worker, claim):
        with worker.owned(claim) as (conn, run):
            context = conn.execute(
                "SELECT provider_handle FROM sandbox_bindings WHERE id=%s", (run["sandbox_id"],)
            ).fetchone()
            return {**run, **context}

    def scalar(self, sql, params=()):
        with self.db.transaction() as conn:
            return next(iter(conn.execute(sql, params).fetchone().values()))

    def allocate(self, case, *, model_transport=False):
        created = self.post(
            "/tasks",
            {
                "project_id": self.project["id"],
                "profile_revision": self.profile["id"],
                "title": case,
                "goal": "Tool broker KVM acceptance",
                "base_sha": self.repo["base_sha"],
            },
        )["run"]
        run_id = UUID(created["id"])
        self.issued.append(run_id)  # Include failed allocations in cleanup.
        worker = Worker(self.db, self.client)
        claim = worker.claim_node("cocoon-local", "openhands")
        require(claim and claim["run_id"] == run_id, "claim_mismatch")
        lost = self.stack.enter_context(heartbeat(worker, claim))
        run = self.snapshot(worker, claim)
        self.client.fence(run)
        allocated = self.client.call(
            "POST",
            "/v1/runs/" + str(run_id),
            {
                "generation": run["generation"],
                "template": self.catalog["template_digest"],
                "canonical_repo": self.repo["canonical_repo"],
                "base_sha": self.repo["base_sha"],
                "deadline": run["deadline"].isoformat(),
                "require_approval": True,
                "tool_transport": True,
                "model_transport": model_transport,
                "egress_policy_sha256": self.catalog["egress_policy_sha256"],
                "verification": {"mode": "fixture-m2", "revision": "fixture-m2-v1", "checks": []},
            },
        )
        with worker.owned(claim) as (conn, current):
            conn.execute(
                "UPDATE sandbox_bindings SET provider_handle=%s,observed_state='running',"
                "lease_deadline=%s WHERE id=%s",
                (allocated["handle"], allocated["lease_deadline"], current["sandbox_id"]),
            )
        prepared = self.client.operation(run, "prepare")
        require(prepared.get("model_transport") is model_transport, "model_transport_mismatch")
        with worker.owned(claim) as (conn, current):
            conn.execute("UPDATE runs SET backend_ref=%s WHERE id=%s", (prepared["ref"], run_id))
            worker.state(conn, current, "running")
        run = self.snapshot(worker, claim)
        row = self.row(run_id)
        sb = self.node.attach(row["handle"]["owner"], row["handle"]["id"], row["handle"]["token"])
        broker = Broker(self.db, self.mock.policy())
        broker.provision(
            run_id,
            run["generation"],
            worker.owner,
            run["sandbox_id"],
            expires_at=datetime.now(UTC) + timedelta(minutes=2),
        )
        session = ToolSession(
            broker,
            self.client,
            run_id=run_id,
            generation=run["generation"],
            owner=worker.owner,
            binding_id=run["sandbox_id"],
        )
        self.stack.callback(session.close)
        session.step()
        require(session.binding and not session.closed and not lost.is_set(), "tool_bind_failed")
        return {
            "run": run,
            "worker": worker,
            "claim": claim,
            "sb": sb,
            "session": session,
            "broker": broker,
        }

    def events(self, context):
        run = context["run"]
        events = self.client.events(run)
        if events["events"]:
            run["backend_cursor"] = events["events"][-1]["cursor"]
            with self.db.transaction() as conn:
                conn.execute(
                    "UPDATE runs SET backend_cursor=%s WHERE id=%s",
                    (run["backend_cursor"], run["id"]),
                )
        return events

    def prompt(self, context, complete=False):
        install_fixture(context["sb"], context["run"]["id"], complete=complete)
        self.client.operation(context["run"], "prompt")
        events = until(lambda: self.awaiting(context))
        require(
            context["sb"].exec("test", "!", "-e", ROUNDTRIP, timeout=5) == "",
            "terminal_ran_before_approval",
        )
        approval = events["approval"]
        self.client.approve(
            context["run"],
            {
                "id": uuid4(),
                "action_digest": approval["action_digest"],
                "expires_at": datetime.now(UTC) + timedelta(seconds=60),
            },
        )

    def awaiting(self, context):
        events = self.events(context)
        return (
            events
            if events["state"] == "waiting_for_confirmation" and events["caught_up"]
            else None
        )

    def operations(self, context):
        with self.db.transaction() as conn:
            return conn.execute(
                "SELECT status,delivery FROM tool_broker_operations "
                "WHERE run_id=%s ORDER BY admitted_at",
                (context["run"]["id"],),
            ).fetchall()

    def tick(self, context):
        context["session"].step()
        return self.mock.entered.is_set()

    def complete(self, context):
        self.prompt(context, complete=True)
        written = 0

        def progress():
            nonlocal written
            context["session"].step()
            require(not context["session"].closed, "tool_session_closed_during_roundtrip")
            rows = self.operations(context)
            acknowledged = sum(row["delivery"] == "acknowledged" for row in rows)
            while written < acknowledged:
                written += 1
                context["sb"].write_file(CODE + "/tool-ack-" + str(written), b"ack\n", mode=0o444)
            return acknowledged == 3

        until(progress, seconds=90)
        proof = until(lambda: terminal_proof(context, ROUNDTRIP), seconds=15)
        require(
            proof == {"operation_1": True, "operation_2": True, "operation_3": True},
            "roundtrip_mismatch",
        )
        isolation = validate_proof(json.loads(context["sb"].exec("cat", PROOF_PATH, timeout=5)))
        require(self.mock.calls == self.mock.authenticated == 7, "upstream_hop_count_mismatch")
        return {
            "sdk_terminal_roundtrip": True,
            "broker_acknowledged": 3,
            "authenticated_upstream_hops": 7,
            "isolation": isolation,
            "approval_required": True,
        }

    def action(self, run_id, name):
        current = self.api.get("/api/v1/runs/" + str(run_id)).json()
        return self.post(
            "/runs/" + str(run_id) + "/actions",
            {"action": name, "expected_state_version": current["state_version"]},
        )

    def reserved(self, run_id):
        return self.scalar(
            "SELECT count(*) FROM resource_reservations r JOIN sandbox_bindings b "
            "ON b.id=r.sandbox_id WHERE b.run_id=%s AND r.released_at IS NULL",
            (run_id,),
        )

    def cancel(self, run_id, *, incomplete=False):
        current = self.api.get("/api/v1/runs/" + str(run_id)).json()
        if current["cleanup_state"] == "confirmed":
            return {"cleanup_confirmed": True}
        if current["state"] != "cancelling":
            self.action(run_id, "cancel")
        worker = Worker(self.db, self.client)
        claim = worker.claim_cancel()
        require(claim and claim["run_id"] == run_id, "cancel_claim_mismatch")
        with heartbeat(worker, claim):
            run = self.snapshot(worker, claim)
            self.client.fence(run)
            proof = self.client.cancel(run)
            require(
                stopped(proof)
                or proof
                == {"observed_state": "not_allocated", "proof": {"no_allocation_intent": True}},
                "stop_proof_incomplete",
            )
            require(self.reserved(run_id) == 1, "capacity_released_before_proof_application")
            if incomplete:
                bad = {"observed_state": "stopped", "proof": {key: True for key in STOP_KEYS}}
                bad["proof"]["cpu_scope_gone"] = False

                class IncompleteClient:
                    def cancel(self, run):
                        return bad

                worker.connector = IncompleteClient()
                try:
                    execute_cancel(worker, claim, run)
                except Problem as exc:
                    require(exc.code == "cancellation_unconfirmed", "unexpected_stop_error")
                else:
                    raise RuntimeError("partial_proof_accepted")
                require(self.reserved(run_id) == 1, "partial_proof_released_capacity")
                worker.connector = self.client
            execute_cancel(worker, claim, run)
            require(self.reserved(run_id) == 0, "full_proof_did_not_release_capacity")
        return {
            "cleanup_confirmed": True,
            "capacity_retained_until_full_proof": True,
            "partial_proof_rejected": incomplete,
        }

    def control(self, run_id, target):
        def progress():
            worker = Worker(self.db, self.client)
            claim = worker.claim_control()
            if claim:
                require(claim["run_id"] == run_id, "control_claim_mismatch")
                with heartbeat(worker, claim):
                    run = self.snapshot(worker, claim)
                    self.client.fence(run)
                    execute_control(worker, claim, run)
            current = self.api.get("/api/v1/runs/" + str(run_id)).json()
            return current["state"] == target

        until(progress, seconds=60)

    def withheld(self, context):
        # The tool assertion concerns the fixed terminal invocation and SQL
        # delivery ledger, independently of later SDK finish/approval events.
        proof = until(lambda: terminal_proof(context, ROUNDTRIP), seconds=45)
        require(proof == {"withheld_result": True}, "late_result_exposed")
        rows = self.operations(context)
        require(len(rows) == 1 and rows[0]["delivery"] != "acknowledged", "unexpected_delivery")
        require(self.mock.calls == 1, "operation_replayed")

    def cleanup(self):
        failures = 0
        for run_id in self.issued:
            try:
                self.cancel(run_id)
            except Exception:
                failures += 1
        self.stack.close()
        return {
            "cleanup_failures": failures,
            "remaining_claims": len(self.node.sandboxes()),
            "remaining_vms": len(self.host.vms()),
            "remaining_reservations": sum(self.reserved(run_id) for run_id in self.issued),
        }


def deny(call, expected=(409, "tool_connector_operation_unconfirmed")):
    try:
        call()
    except Problem as exc:
        require((exc.status, exc.code) == expected, "unexpected_negative_transport_failure")
        return True
    raise RuntimeError("forbidden_operation_accepted")


def cross_run(harness, first):
    second = harness.allocate("cross-run-sibling", model_transport=True)
    require(len(harness.node.sandboxes()) == len(harness.host.vms()) == 2, "two_guests_required")
    a, b = first["run"], second["run"]
    require(harness.client.tool(a, "poll")["pending"] is None, "valid_poll_failed")
    deny(lambda: harness.client.tool({**a, "sandbox_id": b["sandbox_id"]}, "poll"))
    deny(lambda: harness.client.tool({**a, "generation": a["generation"] + 1}, "poll"))
    deny(
        lambda: first["broker"].authorize(b["id"], first["session"].token),
        expected=(401, "tool_token_invalid"),
    )
    require(harness.client.tool(a, "poll")["pending"] is None, "valid_poll_after_denials_failed")
    row = harness.row(a["id"])
    sibling = harness.row(b["id"])
    keys = [sibling[name] for name in ("model_local_key", "session_key", "tool_relay_key")]
    require(
        all(isinstance(key, str) and len(key) >= 32 for key in keys) and len(set(keys)) == 3,
        "credential_audiences_not_distinct",
    )
    listener = second["sb"].proxy_port("127.0.0.1:0", 18081)
    try:
        http = HTTP(
            f"http://127.0.0.1:{listener.getsockname()[1]}", row["tool_relay_key"], timeout=2
        )
        status, _ = http.request("GET", "/mailbox")
        require(status == 401, "cross_guest_relay_key_accepted")
        http = HTTP(
            f"http://127.0.0.1:{listener.getsockname()[1]}",
            harness.row(b["id"])["session_key"],
            timeout=2,
        )
        status, _ = http.request("GET", "/mailbox")
        require(status == 401, "agent_server_key_accepted_by_tool")
        http = HTTP(
            f"http://127.0.0.1:{listener.getsockname()[1]}",
            harness.row(b["id"])["model_local_key"],
            timeout=2,
        )
        status, _ = http.request("GET", "/mailbox")
        require(status == 401, "model_local_key_accepted_by_tool")
    finally:
        try:
            listener.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        listener.close()
    require(
        not harness.operations(first)
        and not harness.operations(second)
        and harness.mock.calls == 0,
        "cross_run_dispatched",
    )
    harness.cancel(b["id"])
    return {
        "two_live_guests": True,
        "cross_binding_denied": True,
        "stale_generation_denied": True,
        "cross_run_bearer_denied": True,
        "cross_guest_relay_key_denied": True,
        "agent_server_key_denied_by_tool": True,
        "model_local_key_denied_by_tool": True,
        "zero_dispatch": True,
    }


def run_case(harness, case):
    harness.mock.reset(hold=case not in {"complete", "cross-run", "stop-proof"})
    context = harness.allocate(case)
    run, session, broker = context["run"], context["session"], context["broker"]
    result = {"case": case, "passed": False}
    if case == "complete":
        result.update(harness.complete(context))
    elif case == "cross-run":
        result.update(cross_run(harness, context))
    elif case == "session-rebind":
        harness.prompt(context)
        until(lambda: harness.tick(context), seconds=20)
        require(harness.mock.waiting.is_set(), "upstream_not_blocked_at_rebind")
        replacement = ToolSession(
            broker,
            harness.client,
            run_id=run["id"],
            generation=run["generation"],
            owner=context["worker"].owner,
            binding_id=run["sandbox_id"],
        )
        replacement.step()
        require(
            replacement.closed and replacement.error and harness.mock.calls == 1,
            "host_rebind_accepted",
        )
        session.step()
        require(session.closed, "original_host_authority_survived_rebind")
        harness.mock.release.set()
        harness.withheld(context)
        result.update(
            fresh_host_session_denied=True,
            original_authority_revoked=True,
            original_dispatches=1,
            no_replay=True,
        )
    elif case == "worker-takeover":
        harness.prompt(context)
        until(lambda: harness.tick(context), seconds=20)
        require(harness.mock.waiting.is_set(), "upstream_not_blocked_at_takeover")
        with harness.db.transaction() as conn:
            conn.execute(
                "UPDATE jobs SET lease_until=clock_timestamp() WHERE run_id=%s", (run["id"],)
            )
        successor = Worker(harness.db, harness.client)
        require(successor.reconcile_expired() == 1, "takeover_lease_not_expired")
        claim = successor.claim()
        require(
            claim and claim["run_id"] == run["id"] and claim["generation"] > run["generation"],
            "takeover_generation_missing",
        )
        harness.stack.enter_context(heartbeat(successor, claim))
        recovered = harness.snapshot(successor, claim)
        harness.client.fence(recovered)
        replacement = ToolSession(
            broker,
            harness.client,
            run_id=run["id"],
            generation=recovered["generation"],
            owner=successor.owner,
            binding_id=recovered["sandbox_id"],
        )
        replacement.step()
        session.step()
        require(replacement.closed and session.closed, "takeover_restored_old_authority")
        harness.mock.release.set()
        require(harness.reserved(run["id"]) == 1, "takeover_released_capacity")
        # The original tool invocation drains with an error; do not replay the SDK prompt.
        context["run"] = recovered
        harness.withheld(context)
        result.update(
            worker_owner_changed=successor.owner != context["worker"].owner,
            generation_advanced=True,
            capacity_retained=True,
            original_dispatches=1,
            no_replay=True,
        )
    elif case == "helper-restart":
        harness.prompt(context)
        until(lambda: harness.tick(context), seconds=20)
        require(harness.mock.waiting.is_set(), "upstream_not_blocked_at_helper_restart")
        sb, row = context["sb"], harness.row(run["id"])
        sb.exec(
            "python3",
            "-I",
            "-c",
            "import os,signal;from pathlib import Path\n"
            "for p in Path('/proc').glob('[0-9]*'):\n"
            " try:\n"
            "  args=(p/'cmdline').read_bytes().split(b'\\0')\n"
            "  if b'/opt/agent-platform/guest_tool.py' in args:\n"
            "   os.kill(int(p.name),signal.SIGKILL)\n"
            " except (FileNotFoundError,ProcessLookupError): pass\n",
            timeout=10,
        )
        sb.spawn(
            "python3",
            "-I",
            CODE + "/guest_tool.py",
            user="agentcontrol",
            cwd=CONTROL,
            env={"TOOL_RUN_ID": str(run["id"]), "TOOL_RELAY_KEY": row["tool_relay_key"]},
        )
        session.step()
        require(
            session.closed and harness.mock.calls == 1 and len(harness.operations(context)) == 1,
            "helper_restart_reopened",
        )
        harness.mock.release.set()
        harness.withheld(context)
        result.update(
            helper_restart_denied=True,
            original_dispatches=1,
            no_replay=True,
            restart_with_existing_socket=True,
        )
    elif case == "stop-proof":
        result.update(harness.cancel(run["id"], incomplete=True))
    else:
        harness.prompt(context)
        until(lambda: harness.tick(context), seconds=20)
        require(harness.mock.calls == harness.mock.authenticated == 1, "inflight_request_missing")
        require(harness.mock.waiting.is_set(), "upstream_not_blocked_at_control")
        start = time.monotonic()
        if case == "revoke":
            broker.revoke(run["id"])
        elif case in {"pause", "cancel"}:
            harness.action(run["id"], case)
        else:
            model = ModelProxy(
                harness.db, ModelPolicy(origin=broker.policy.origin, credential=harness.mock.secret)
            )
            model.cutoff(
                run["id"], run["generation"], context["worker"].owner, "model_fixture_cutoff"
            )
        session.step()
        require(session.closed and time.monotonic() - start < 5, "inflight_control_blocked")
        require(
            harness.mock.waiting.is_set() and not harness.mock.release.is_set(),
            "upstream_finished_before_control_returned",
        )
        require(harness.reserved(run["id"]) == 1, "inflight_control_released_capacity")
        harness.mock.release.set()
        if case == "cancel":
            result.update(harness.cancel(run["id"]))
            require(harness.mock.calls == 1, "cancel_replayed")
        elif case == "pause":
            harness.control(run["id"], "paused")
            require(harness.reserved(run["id"]) == 1, "pause_released_capacity")
            proof = json.loads(context["sb"].exec("cat", ROUNDTRIP, timeout=5))
            require(proof == {"withheld_result": True}, "pause_exposed_result")
            harness.action(run["id"], "resume")
            harness.control(run["id"], "running")
            require(harness.mock.calls == 1, "resume_replayed")
            result.update(pause_observed=True, resume_observed=True, no_replay_after_resume=True)
        else:
            harness.withheld(context)
        rows = harness.operations(context)
        require(
            len(rows) == 1 and rows[0]["delivery"] != "acknowledged", "late_result_acknowledged"
        )
        result.update(
            inflight_dispatches=1,
            control_returned_while_upstream_blocked=True,
            admission_closed=True,
            capacity_retained=True,
            late_result_not_acknowledged=all(
                row["delivery"] != "acknowledged" for row in harness.operations(context)
            ),
        )
    result.update(harness.cancel(run["id"]))
    require(not harness.node.sandboxes() and not harness.host.vms(), "case_cleanup_incomplete")
    result["passed"] = True
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--origin", default="http://127.0.0.1:17888")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--case", choices=CASES)
    args = parser.parse_args()
    os.umask(0o077)
    config = json.loads(private_file(args.config).read_text())
    require(config.get("tool_transport_fixture") is True, "fixture_switch_required")
    require(
        config.get("egress_policy") == {"revision": "node-egress-v1", "allow": []},
        "deny_all_policy_required",
    )
    require(not os.environ.get("MODEL_PROXY_CONFIG"), "ambient_model_config_forbidden")
    url = os.environ["TEST_DATABASE_URL"]
    with psycopg.connect(url) as conn:
        require(conn.info.dbname == "agent_platform_test", "dedicated_database_required")
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    report = {
        "schema_version": 1,
        "started_at": datetime.now(UTC).isoformat(),
        "transport": "sdk-terminal-unix-connector-http-sql-broker-mock-github",
        "live_github": False,
        "production_activation": False,
        "passed": False,
        "cases": [],
    }
    db, mock, harness = None, None, None
    try:
        node = SingleNodeClient(
            config["origin"], private_file(config["sandbox_token_file"]).read_text().strip()
        )
        host = Host(Path(config["cocoon_config"]), Path(config["sandbox_data_dir"]))
        require(not node.sandboxes() and not host.vms(), "dedicated_node_must_be_empty")
        require(all(pool["target"] == 0 for pool in node.info()["pools"]), "warm_pool_not_zero")
        migrate(url)
        db = Database(url)
        db.open()
        with db.transaction() as conn:
            require(
                conn.execute("SELECT count(*) AS n FROM runs").fetchone()["n"] == 0,
                "fresh_database_required",
            )
        password = secrets.token_urlsafe(32)
        bootstrap(db, "tool-kvm", password)
        settings = Settings(url, origin="https://testserver")
        mock = GitHubMock()
        with TestClient(create_app(settings, db), base_url=settings.origin) as api:
            csrf = api.get("/api/v1/session").json()["csrf_token"]
            login = api.post(
                "/api/v1/session",
                json={"username": "tool-kvm", "password": password},
                headers={"Origin": settings.origin, "X-CSRF-Token": csrf},
            )
            require(login.status_code == 200, "login_failed")

            def post(path, data):
                response = api.post(
                    "/api/v1" + path,
                    json=data,
                    headers={
                        "Origin": settings.origin,
                        "X-CSRF-Token": login.json()["csrf_token"],
                        "Idempotency-Key": uuid4().hex,
                    },
                )
                require(response.status_code in {200, 201, 202}, "acceptance_api_rejected")
                return response.json()

            harness = Harness(config, args.origin, db, api, post, mock)
            report["sealed_deny_all_policy_confirmed"] = True
            report["egress_policy_sha256"] = harness.catalog["egress_policy_sha256"]
            try:
                for case in [args.case] if args.case else CASES:
                    try:
                        entry = run_case(harness, case)
                    except Exception:
                        report["cases"].append({"case": case, "passed": False})
                        raise
                    report["cases"].append(entry)
                    print(json.dumps(entry), flush=True)
            finally:
                mock.release.set()
                report.update(harness.cleanup())
            require(
                not any(
                    report[key]
                    for key in (
                        "cleanup_failures",
                        "remaining_claims",
                        "remaining_vms",
                        "remaining_reservations",
                    )
                ),
                "final_cleanup_incomplete",
            )
            report["passed"] = True
    except Exception as exc:
        report["failure_type"] = type(exc).__name__
        # Never serialize upstream exception messages or raw private diagnostics.
        raise
    finally:
        if mock:
            mock.close()
        if db:
            db.close()
        report["finished_at"] = datetime.now(UTC).isoformat()
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
