"""Fault/attack fixtures used only by the opt-in guest model KVM driver."""

import json
import os
import runpy
import signal
import socket
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx

from agent_platform.db import Database
from agent_platform.domain import Problem
from agent_platform.model_dialect import SDKCompletion
from agent_platform.model_proxy import ModelProxy
from agent_platform.runtime_client import RuntimeClient
from agent_platform.worker import Worker


def child(config, origin, output, stage):
    db = Database(os.environ["TEST_DATABASE_URL"])
    db.open()

    def stop(point):
        if point == stage:
            (output / "worker-stopped").write_text(point)
            os.kill(os.getpid(), signal.SIGSTOP)

    reserve, settle, exchange = ModelProxy.reserve, ModelProxy.settle, RuntimeClient.model

    def reserved(self, *args, **kwargs):
        value = reserve(self, *args, **kwargs)
        stop("reserved")
        return value

    def settled(self, *args, **kwargs):
        value = settle(self, *args, **kwargs)
        stop("settled")
        return value

    def delivered(self, run, action, **data):
        value = exchange(self, run, action, **data)
        if action == "deliver":
            stop("delivered")
        return value

    ModelProxy.reserve, ModelProxy.settle, RuntimeClient.model = reserved, settled, delivered
    client = RuntimeClient(origin, Path(config["connector_token_file"]).read_text().strip())
    Worker(db, client).run_once()
    db.close()


def install_attack(sb):
    source = runpy.run_path(str(Path(__file__).with_name("m3-isolation-kvm.py")))["GUEST"]
    source = source.replace(
        "if b'/usr/local/bin/openhands-agent-server' in args:",
        "if b'/usr/local/bin/openhands-agent-server' in args "
        "or b'/opt/agent-platform/guest_model.py' in args:",
    ).replace("k.startswith(b'SESSION_API_KEY=')", "k.startswith((b'SESSION_API_KEY=',b'MODEL_'))")
    source = source.replace(
        "'model','/opt/agent-platform/guest_fixture.py'",
        "'model','/opt/agent-platform/guest_model.py'",
    )
    extra = r"""
for name,method,path in [('poll','GET','/mailbox'),('rotate','POST','/credential'),
                         ('deliver','POST','/response'),('model','POST','/v1/chat/completions')]:
    c=http.client.HTTPConnection('127.0.0.1',18080,timeout=5)
    try:
        c.request(method,path,body='{}',headers={'Content-Type':'application/json',
                                               'Authorization':'Bearer m2-fixture-no-provider-key'})
        r=c.getresponse();r.read(4096)
        checks['mailbox_'+name+'_unauthorized']=r.status in (401,403)
    finally:c.close()
try:
    Path(control+'/model-mailbox.json').read_bytes()
    checks['mailbox_file_unreadable']=False
except PermissionError: checks['mailbox_file_unreadable']=True
checks['model_environment_absent']=not any(k.startswith('MODEL_') for k in os.environ)
"""
    source = source.replace(
        "Path('/home/agentprobe/workspace/isolation-proof.json')",
        extra + "\nPath('/tmp/model-isolation-proof.json')",
    )
    sb.write_file("/opt/agent-platform/model_attack.py", source.encode(), mode=0o644)
    bait = runpy.run_path(str(Path(__file__).with_name("m3-isolation-kvm.py")))["BAIT"]
    sb.exec("python3", "-I", "-c", bait, user="agentprobe", timeout=15)


def attack_response(value, run_id):
    call = value["choices"][0]["message"]["tool_calls"][0]["function"]
    if call["name"] == "terminal":
        command = json.loads(call["arguments"])["command"]
        call["arguments"] = json.dumps(
            {"command": f"python3 -I /opt/agent-platform/model_attack.py {run_id}; " + command}
        )
    return value


def cross_run_probe(node, first, second, proxy, payload):
    handle = second["handle"]
    sb = node.attach(handle["owner"], handle["id"], handle["token"])
    listener = sb.proxy_port("127.0.0.1:0", 18080)
    try:
        with httpx.Client(
            base_url=f"http://127.0.0.1:{listener.getsockname()[1]}", trust_env=False
        ) as transport:
            assert (
                transport.get(
                    "/mailbox", headers={"X-Session-API-Key": first["session_key"]}
                ).status_code
                == 401
            )
            assert (
                transport.post(
                    "/v1/chat/completions",
                    json={},
                    headers={"Authorization": "Bearer " + first["model_local_key"]},
                ).status_code
                == 401
            )
    finally:
        listener.shutdown(socket.SHUT_RDWR)
        listener.close()
    try:
        proxy.complete(
            second["run_id"],
            first["model_credential"]["token"],
            uuid4(),
            SDKCompletion(payload),
            sdk=True,
        )
    except Problem as exc:
        assert exc.code == "model_token_invalid"
    else:
        raise RuntimeError("cross_run_proxy_token_accepted")
    return {
        "two_live_vms": True,
        "cross_run_relay_rejected": True,
        "cross_run_sdk_rejected": True,
        "cross_run_proxy_rejected": True,
    }


def finalize_acceptance(report, *, cleanups, host, node, servers, db, restore, save):
    """Keep case failures and attempt every owned cleanup before persisting verdict."""
    original_error = sys.exception()
    case_passed = report["passed"] is True and original_error is None
    report["case_passed"] = case_passed
    report["passed"] = False
    failures = []

    def attempt(stage, operation):
        try:
            return operation()
        except Exception as exc:
            # Error messages may contain credentials or private fixture data.
            failures.append({"stage": stage, "error": type(exc).__name__})
            return None

    for index, cleanup in enumerate(cleanups):
        attempt(f"run_{index}", cleanup)
    for key, observe in (("zero_vms", host.vms), ("zero_claims", node.sandboxes)):
        resources = attempt(key, observe)
        report[key] = resources is not None and not resources
        if resources is not None and resources:
            failures.append({"stage": key, "error": "resource_residue"})
    for index, server in enumerate(servers):
        attempt(f"server_{index}_shutdown", server.shutdown)
        attempt(f"server_{index}_close", server.server_close)
    attempt("database_close", db.close)
    attempt("restore", restore)
    report["cleanup_failures"] = failures
    report["finished_at"] = datetime.now(UTC).isoformat()
    report["passed"] = case_passed and not failures and report["zero_vms"] and report["zero_claims"]
    attempt("report_save", save)
    if failures:
        report["passed"] = False
    if not report["passed"] and original_error is None:
        raise RuntimeError("acceptance_cleanup_failed")


class ObservedRuntimeClient(RuntimeClient):
    """Pass through polling unchanged, retaining only acceptance metadata."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.event_pages = {}

    def events(self, run):
        request_cursor = run["backend_cursor"]
        value = super().events(run)
        events = [
            {"event_id": item["event_id"], "cursor": item["cursor"]} for item in value["events"]
        ]
        self.event_pages.setdefault(str(run["id"]), []).append(
            {
                "generation": run["generation"],
                "request_cursor": request_cursor,
                "response_cursor": events[-1]["cursor"] if events else request_cursor,
                "state": value["state"],
                "caught_up": value["caught_up"],
                "events": events,
            }
        )
        return value


def validate_model_trace(pages, *, finished, resumed=False):
    """Validate consumed polling metadata; recovery only proves its observed suffix."""
    initial_cursor = pages[0]["request_cursor"] if pages else None
    cursor = initial_cursor if resumed else None
    ids = set()
    for page in pages:
        if page["request_cursor"] != cursor:
            raise RuntimeError("sdk_cursor_discontinuity")
        for item in page["events"]:
            if item["event_id"] in ids or item["event_id"] == initial_cursor:
                raise RuntimeError("sdk_event_replayed")
            if not item["event_id"] or item["cursor"] != item["event_id"]:
                raise RuntimeError("sdk_cursor_invalid")
            ids.add(item["event_id"])
            cursor = item["cursor"]
        if page["response_cursor"] != cursor:
            raise RuntimeError("sdk_response_cursor_invalid")
    sdk_finished = bool(pages and pages[-1]["state"] == "finished")
    caught_up = bool(pages and pages[-1]["caught_up"] is True)
    if finished and not (sdk_finished and caught_up):
        raise RuntimeError("sdk_completion_missing")
    return {
        "sdk_finished": sdk_finished,
        "sdk_caught_up": caught_up,
        "sdk_completion_required": finished,
        "sdk_poll_count": len(pages),
        "sdk_event_count": len(ids),
        "sdk_no_duplicate_events": True,
        "sdk_cursor_continuity": True,
        "sdk_initial_cursor": initial_cursor,
        "sdk_observation_scope": "post_recovery_suffix" if resumed else "entire_worker",
        "sdk_pages": pages,
    }


def validate_mock_usage(case, usage):
    """Separate final measurement provenance from retained invalid usage."""
    if case not in {"mock-complete", "mock-cutoff", "mock-unknown", "mock-https-complete"}:
        raise RuntimeError("mock_case_invalid")
    if usage["hard_money_limit_supported"] is not False:
        raise RuntimeError("mock_claimed_hard_money")
    if usage["amount_decimal"] is not None:
        raise RuntimeError("mock_claimed_provider_bill")
    unknown = case == "mock-unknown"
    reason = (
        "model_response_invalid"
        if unknown
        else "provider_reported_usage_unbilled"
        if case == "mock-https-complete"
        else "mock_reported_usage"
    )
    entries = usage["entries"]
    if (
        not entries
        or (unknown and len(entries) != 1)
        or type(usage["uncertain_requests"]) is not int
        or usage["uncertain_requests"] != int(unknown)
        or any(
            entry["status"] != ("unknown" if unknown else "final") or entry["reason"] != reason
            for entry in entries
        )
    ):
        raise RuntimeError("mock_usage_source_invalid")
