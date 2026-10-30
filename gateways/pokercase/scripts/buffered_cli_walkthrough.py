#!/usr/bin/env python3
"""Bounded real gateway/fake CLI buffered settlement acceptance; stdlib only."""
import argparse
import csv
import io
import socket
import subprocess
from contextlib import ExitStack
import http.client
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time

from buffered_cli_fixture import TEXT, TOOL_TEXT, IMAGE
from claude_walkthrough import ClaudeGateway, owned_processes, preserve_evidence, trace_rows, process_matches
from offline_fixture import Fixture
from offline_walkthrough import ENDPOINTS, digest, payload, require, JourneyFailure, text_response, tool_request, tool_reply

SOURCE_FILES = ("buffered_cli_walkthrough.py", "buffered_cli_fixture.py", "buffered_cli_check.py", "claude_walkthrough.py",
                "claude_fixture.py", "offline_walkthrough.py", "offline_fixture.py")


class BufferedGateway(ClaudeGateway):
    def __init__(self, binary, fixture, directory):
        super().__init__(binary, fixture, directory)
        source = Path(__file__).with_name("buffered_cli_fixture.py").read_text()
        self.fake.write_text("#!" + sys.executable + "\n" + source.split("\n", 1)[1])
        self.fake.chmod(0o700)
        self.counts = {"client_requests": 0, "admin_requests": 0}
        self.request_trace = []
        (directory / "fake/current-case").write_text("baseline")
        self.runtime = directory / "fake/runtime"
        self.cursor = directory / "fake/cursor-agent"
        for target in (self.runtime, self.cursor):
            target.write_bytes(self.fake.read_bytes()); target.chmod(0o700)
        self.cursor_enabled = True
        self.listener_ports = []

    def start(self):
        with socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0)); self.port = reserve.getsockname()[1]
        self.listener_ports.append(self.port)
        (self.directory / "fake/expected-gateway").write_text(f"127.0.0.1:{self.port}")
        self.log = (self.directory / "gateway.log").open("ab")
        env = {"PATH": "/usr/bin:/bin", "HOME": str(self.directory), "CLAUDE_CONFIG_DIR": str(self.directory / "claude-config"),
               "HTTP_PROXY": self.fixture.proxy_url, "HTTPS_PROXY": self.fixture.proxy_url, "ALL_PROXY": self.fixture.proxy_url, "RUST_LOG": "warn"}
        command = [str(self.binary), "serve", "--host", "127.0.0.1", "--port", str(self.port), "--data-dir", str(self.directory),
                   "--admin-token", self.admin, "--claude-bin", str(self.fake), "--claude-idle-secs", "120", "--cursor-bin", str(self.cursor),
                   "--cursor-runtime-bin", str(self.runtime), "--cursor-image", IMAGE, "--cursor-profile-volume", "thinrouter-cursor-offline", "--cursor-max-runs", "1"]
        if self.cursor_enabled: command.append("--cursor-accept-account-plugins")
        self.child = subprocess.Popen(command, env=env, cwd=self.directory, stdin=subprocess.DEVNULL, stdout=self.log, stderr=self.log, start_new_session=True)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            require(self.child.poll() is None, "gateway_exited_before_ready")
            try:
                status, raw = self.request("GET", "/admin/api/stats", admin=True, timeout=.3)
                if status == 200 and "usage_events" in json.loads(raw): return
            except (OSError, http.client.HTTPException, JourneyFailure): pass
            threading.Event().wait(.05)
        raise JourneyFailure("gateway_readiness_timeout")

    def open(self, method, path, body=None, **kwargs):
        key = "admin_requests" if path.startswith("/admin") else "client_requests"
        self.counts[key] += 1
        self.request_trace.append({"sequence": len(self.request_trace) + 1, "case": (self.directory / "fake/current-case").read_text(), "method": method, "path": path, "destination": f"http://127.0.0.1:{self.port}", "kind": "admin" if key == "admin_requests" else "client"})
        return super().open(method, path, body, **kwargs)


def database_rows(gateway):
    with sqlite3.connect((gateway.directory / "thinrouter.db").as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = [dict(row) for row in db.execute("SELECT * FROM usage_events ORDER BY id")]
    return rows


def normalized_rows(gateway):
    result = []
    for original in database_rows(gateway):
        row = dict(original)
        raw = {field: row.pop("reported_" + field) for field in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")}
        row["reported_usage"] = raw if any(value is not None for value in raw.values()) else None
        result.append(row)
    return result


def isolation(gateway, fixture):
    require(gateway.fake.is_file() and not gateway.fake.is_symlink(), "fake_executable")
    require(gateway.fake.read_text().splitlines()[0] == "#!" + sys.executable and Path(sys.executable).is_absolute(), "absolute_python")
    require(all(p.is_file() and not p.is_symlink() and p.parent == gateway.directory / "fake" and digest(p) == digest(gateway.fake) for p in (gateway.fake, gateway.cursor, gateway.runtime)), "exact_owned_executables")
    require(all(server.server_address[0] == "127.0.0.1" for server in fixture._servers) and len(fixture._servers) == 2, "owned_fixture_listeners")
    before = fixture.denied_count
    probes = []
    port = int(fixture.proxy_url.rsplit(":", 1)[1])
    for method, target in (("GET", "http://unknown.invalid/"), ("CONNECT", "unknown.invalid:443"), ("GET", "http://unknown.invalid/redirect")):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
        try:
            conn.request(method, target)
            response = conn.getresponse(); response.read()
            require(response.status == 403, "nonforwarding_probe")
            probes.append({"method": method, "status": response.status})
        finally: conn.close()
    require(fixture.denied_count == before + 3, "proof_denial_count")
    return {"status": "passed", "probes": probes, "proof_denied_requests": 3,
            "owned_home": str(gateway.directory), "fake_executable": str(gateway.fake),
            "fake_sha256": digest(gateway.fake), "python": sys.executable,
            "runtime": str(gateway.runtime), "runtime_sha256": digest(gateway.runtime),
            "cursor": str(gateway.cursor), "cursor_sha256": digest(gateway.cursor),
            "proxy": fixture.proxy_url, "no_provider_configuration_before_launch": True,
            "helper_binary": str(gateway.binary), "helper_sha256": digest(gateway.binary)}


def connection(g, provider, name):
    return g.api("POST", "connections/oauth/import", {"name": "synthetic-" + name, "provider": provider,
        "access_token": "", "default_model": "complete"})["connection"]["id"]


def route(g, name, conn, model):
    g.api("POST", "routes", {"public_model": name, "targets": [{"connection_id": conn, "model_override": model}]})


def baseline(g, report, update):
    g.start()
    g.key = g.api("POST", "keys", {"name": "synthetic-buffered-cli"})["secret"]
    conn = connection(g, "claude", "baseline")
    route(g, "baseline", conn, "complete")
    report["stage"] = "baseline_request"; update()
    code, raw = g.request("POST", ENDPOINTS["chat"], payload("chat", "baseline"))
    report["wire"] = {"status": code, "body": json.loads(raw)}
    report["phase_trace"] = trace_rows(g.directory)
    report["sqlite_rows"] = normalized_rows(g)
    update()
    require(code == 200 and text_response("chat", json.loads(raw)) == TEXT, "baseline_wire")
    inputs = [x for x in report["phase_trace"] if x["kind"] == "user_input"]
    require(len(inputs) == 1, "baseline_input_count")
    require(inputs[0]["pending_count"] == 1, "baseline_missing_reservation")
    rows = report["sqlite_rows"]
    require(len(rows) == 1, "baseline_duplicate_or_missing_row")
    row = rows[0]; pending = inputs[0]["pending"][0]
    require(row["attempt_id"] == pending["attempt_id"] and row["request_id"] == pending["request_id"], "baseline_identity")
    require(row["prompt_tokens"] == 17 and row["completion_tokens"] == 5 and row["usage_status"] == "complete", "baseline_raw_usage")
    require(row["usage_source"] == "claude_code_stream_event_v1" and row["status"] is None, "baseline_cli_source")
    report["stages"].append({"stage": "baseline_request", "status": "passed"})



def set_case(g, name):
    (g.directory / "fake/current-case").write_text(name)


def raw_events(g):
    path = g.directory / "fake/raw.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def dispatch_counts(events):
    return {"actual_spawns": sum(e["kind"] == "spawn" for e in events),
            "actual_user_inputs": sum(e["kind"] == "user_input" for e in events),
            "actual_tool_dispatches": sum(e["kind"] == "tool_dispatch" for e in events)}


def wait_for(g, predicate, code, seconds=10):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if predicate(): return
        threading.Event().wait(.02)
    raise JourneyFailure(code)


def inject(g, final=False):
    with sqlite3.connect(g.directory / "thinrouter.db") as db:
        db.execute("CREATE TRIGGER deny_fixture BEFORE " + ("UPDATE OF finalized_at" if final else "INSERT") + " ON usage_events BEGIN SELECT RAISE(FAIL, 'synthetic storage refusal'); END")


def uninject(g):
    with sqlite3.connect(g.directory / "thinrouter.db") as db: db.execute("DROP TRIGGER deny_fixture")


def wire(g, protocol, request, record):
    code, raw = g.request("POST", ENDPOINTS[protocol], request, timeout=20)
    body = json.loads(raw)
    record["wire"].append({"status": code, "body": body})
    return code, body


def answer(protocol, body):
    if protocol == "chat": return body["choices"][0]["message"].get("content")
    if protocol == "messages": return "".join(x.get("text", "") for x in body["content"])
    return "".join(c.get("text", "") for x in body["output"] for c in x.get("content", []))


def continue_request(request):
    request = json.loads(json.dumps(request))
    request["messages"] += [{"role": "assistant", "content": TEXT}, {"role": "user", "content": "next synthetic turn"}]
    return request


def full_check(g, report, contract, update):
    g.start(); g.key = g.api("POST", "keys", {"name": "synthetic-buffered-cli"})["secret"]
    report["case_inventory"] = contract["case_inventory"]
    report["stage_inventory"] = contract["stage_inventory"]
    report["cases"] = []
    for stage in contract["stage_inventory"]:
        if stage == "surfaces": continue
        report["stage"] = stage; update()
        for spec in [c for c in contract["cases"] if c["stage"] == stage]:
            name, provider, model = spec["name"], spec["provider"], spec["fixture_model"]
            set_case(g, name)
            before_ids = {row["id"] for row in normalized_rows(g)}
            before_counts = dict(g.counts)
            record = {"name": name, "stage": stage, "status": "running", "wire": []}
            report["cases"].append(record); update()
            conn = connection(g, provider, name)
            route(g, name, conn, model)
            protocol = next((x for x in ENDPOINTS if name.endswith("_" + x)), "chat")
            request = payload(protocol, name)
            if stage == "cancellation":
                client = http.client.HTTPConnection("127.0.0.1", g.port, timeout=5)
                g.counts["client_requests"] += 1
                g.request_trace.append({"sequence": len(g.request_trace) + 1, "case": name, "method": "POST", "path": ENDPOINTS[protocol], "destination": f"http://127.0.0.1:{g.port}", "kind": "client"})
                try:
                    client.request("POST", ENDPOINTS[protocol], json.dumps(request), {"Content-Type": "application/json", "Authorization": "Bearer " + g.key})
                    wait_for(g, lambda: any(e["case"] == name and e["kind"] == "waiting" for e in trace_rows(g.directory)), "cancel_fixture_not_waiting")
                finally:
                    if client.sock is not None: client.sock.shutdown(socket.SHUT_RDWR)
                    client.close()
                record["wire"].append({"status": None, "body": None, "caller_cancelled": True})
            elif stage == "fallback":
                retry = connection(g, provider, name + "-retry")
                g.api("POST", "routes", {"public_model": name, "strategy": "fallback", "targets": [{"connection_id": retry, "model_override": "retry"}, {"connection_id": conn, "model_override": "complete"}]})
                code, body = wire(g, protocol, request, record); require(code == 200 and answer(protocol, body) == TEXT, "fallback_wire")
            elif name.startswith("claude_tool_") or name == "claude_reserve_tool":
                request = tool_request(protocol, name)
                code, body = wire(g, protocol, request, record); require(code == 200, "tool_first_wire")
                second = tool_reply(protocol, request, body)
                if name == "claude_reserve_tool":
                    inject(g); denied, _ = wire(g, protocol, second, record); uninject(g); require(denied == 503, "tool_reservation_refusal")
                code, body = wire(g, protocol, second, record); require(code == 200 and answer(protocol, body) == TOOL_TEXT, "tool_final_wire")
            elif name in ["claude_live_saved_resume", "claude_resume_retry", "claude_reserve_live", "claude_reserve_saved"]:
                code, body = wire(g, "chat", request, record); require(code == 200 and answer("chat", body) == TEXT, "reuse_first_wire")
                second = continue_request(request)
                if name == "claude_live_saved_resume":
                    code, body = wire(g, "chat", second, record); require(code == 200 and answer("chat", body) == TEXT, "reuse_live_wire")
                    second = continue_request(second)
                if name != "claude_reserve_live": g.stop(); g.start()
                if name.startswith("claude_reserve_"):
                    inject(g); denied, _ = wire(g, "chat", second, record); uninject(g); require(denied == 503, "reuse_reservation_refusal")
                code, body = wire(g, "chat", second, record); require(code == 200 and answer("chat", body) == TEXT, "reuse_final_wire")
            elif name.endswith("_reserve_fresh"):
                inject(g); code, _ = wire(g, protocol, request, record); uninject(g); require(code == 503, "fresh_reservation_refusal")
            elif name.endswith("_finalization_restart"):
                inject(g, True); code, body = wire(g, protocol, request, record); require(code == 200 and answer(protocol, body) == TEXT, "finalization_failure_wire")
                before = normalized_rows(g); pending = [x for x in before if x["id"] not in before_ids]
                require(len(pending) == 1 and pending[0]["finalized_at"] is None, "finalization_failure_pending")
                uninject(g); counts = dispatch_counts(trace_rows(g.directory)); g.stop(); g.start()
                first = normalized_rows(g); first_counts = dispatch_counts(trace_rows(g.directory)); g.stop(); g.start()
                second = normalized_rows(g); second_counts = dispatch_counts(trace_rows(g.directory))
                record["recovery"] = {"before_rows": before, "after_first_rows": first, "after_second_rows": second,
                    "dispatch_counts_before": counts, "dispatch_counts_after_first": first_counts, "dispatch_counts_after_second": second_counts}
                require(first == second and counts == first_counts == second_counts, "recovery_once_no_replay")
                require([x for x in before if x["id"] in before_ids] == [x for x in second if x["id"] in before_ids], "recovery_history_preserved")
            elif stage == "admission":
                if "tool_refusal" in name: request = tool_request(protocol, name)
                elif "image" in name: request["messages"][0]["content"] = [{"type": "image_url", "image_url": {"url": "data:image/png;base64,c3ludGhldGlj"}}]
                elif "disabled" in name: g.stop(); g.cursor_enabled = False; g.start()
                code, _ = wire(g, protocol, request, record); require(code == (503 if "disabled" in name else 501), "cursor_admission_status")
                if "disabled" in name: g.stop(); g.cursor_enabled = True; g.start()
            else:
                code, body = wire(g, protocol, request, record)
                expected = 502 if model in ["error", "limit"] or (provider == "cursor" and model == "eof") else 200
                require(code == expected, "buffered_wire_status")
                if code == 200: require(answer(protocol, body) == TEXT, "buffered_wire_text")
            expected_count = len(spec["rows"])
            wait_for(g, lambda: len([x for x in normalized_rows(g) if x["id"] not in before_ids]) == expected_count and all(x["finalized_at"] is not None for x in normalized_rows(g) if x["id"] not in before_ids), "case_settlement_timeout")
            rows = [x for x in normalized_rows(g) if x["id"] not in before_ids]
            events = [e for e in trace_rows(g.directory) if e["case"] == name]
            record.update(rows=rows, phase_trace=events, raw_events=[e for e in raw_events(g) if e["case"] == name],
                counts={**dispatch_counts(events), "client_requests": g.counts["client_requests"] - before_counts["client_requests"],
                        "preflight_refusals": int(stage == "admission" and not rows and all(w["status"] in [501, 503] for w in record["wire"]))})
            # Every actual inference phase has one already persisted selected attempt.
            for e in events:
                if e["kind"] in ["spawn", "user_input", "tool_dispatch"]:
                    require(e["pending_count"] == 1 and e["attempt_id"] in {row["attempt_id"] for row in rows}, "dispatch_without_reservation")
            require(record["counts"] == spec["counts"], "case_dispatch_count")
            for actual, expected in zip(rows, spec["rows"]):
                for field, value in expected.items():
                    if field.endswith("_present"):
                        key = field.removesuffix("_present"); require((actual.get(key + "_ms") is not None) == value, "case_timing_presence")
                    else: require(actual.get(field) == value, "case_raw_or_outcome")
            require([w["status"] for w in record["wire"]] == spec["wire_statuses"], "case_wire_statuses")
            record["status"] = "passed"; update()
        report["stages"].append({"stage": stage, "status": "passed", "case_names": [c["name"] for c in contract["cases"] if c["stage"] == stage]}); update()
    rows = normalized_rows(g)
    report["sqlite_original_rows"] = database_rows(g); report["sqlite_rows"] = rows
    events = g.api("GET", "usage"); daily = g.api("GET", "usage/daily?schema=2")
    csv_status, csv_raw = g.request("GET", "/admin/api/usage/export.csv", admin=True)
    html_status, html = g.request("GET", "/admin/usage", admin=True)
    require(csv_status == html_status == 200, "surface_http_status")
    report["surfaces"] = {"events_rows": events["data"], "csv_raw": csv_raw.decode(), "html_raw": html.decode(), "daily_api": daily,
        "selected_ids": [row["id"] for row in rows], "filter": None, "limits": contract["scope"]}
    from buffered_cli_check import validate_surfaces
    validate_surfaces(report["surfaces"], rows, report["sqlite_original_rows"])
    report["stages"].append({"stage": "surfaces", "status": "passed", "case_names": []})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--baseline", action="store_true")
    mode.add_argument("--check", action="store_true")
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--expected-binary-sha256", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--contract", type=Path)
    args = parser.parse_args(argv)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="buffered-cli-", dir=args.output_dir.resolve()))
    report = {"schema_version": 1, "synthetic": True, "mode": "baseline" if args.baseline else "check",
              "journey_status": "running", "stage": "binary", "stages": [], "cleanup": "pending",
              "real_cli_version": None, "actual_cost_usd": None, "whole_round_metrics": None,
              "live_client_version_provider_verified": False, "owner_personal_run_claimed": False,
              "mainline": "incomplete", "usable_tag": None}
    def update():
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    update(); g = fixture = None; code = 1; owned = None
    try:
        binary = args.binary.resolve(strict=True)
        require(binary.is_file() and os.access(binary, os.X_OK), "binary_executable")
        report["binary_sha256"] = digest(binary)
        require(report["binary_sha256"] == args.expected_binary_sha256, "binary_digest_mismatch")
        report["source_sha256"] = {name: digest(Path(__file__).with_name(name)) for name in SOURCE_FILES}
        with ExitStack() as resources:
            owned = Path(resources.enter_context(tempfile.TemporaryDirectory(prefix="thinrouter-buffered-cli-")))
            fixture = resources.enter_context(Fixture())
            g = BufferedGateway(binary, fixture, owned)
            resources.callback(g.stop)
            report["isolation"] = isolation(g, fixture); update()
            try:
                if args.baseline: baseline(g, report, update)
                else:
                    require(args.contract is not None, "contract_required")
                    contract = json.loads(args.contract.read_text())
                    report["contract_sha256"] = digest(args.contract)
                    full_check(g, report, contract, update)
                report["journey_status"] = "passed"; code = 0
            finally:
                # Freeze owned producers before copying trace/raw evidence. A successful
                # client response can precede the ignored session aggregate or process exit.
                g.stop()
                final_raw_events = raw_events(g)
                for case in report.get("cases", []):
                    case["raw_events"] = [event for event in final_raw_events if event["case"] == case["name"]]
                report["phase_trace"] = trace_rows(owned)
                report["request_trace"] = g.request_trace
                if (owned / "thinrouter.db").exists():
                    report["sqlite_rows"] = normalized_rows(g)
                    report["sqlite_original_rows"] = database_rows(g)
                report["counts"] = {**g.counts, "actual_spawns": sum(e["kind"] == "spawn" for e in report["phase_trace"]),
                    "actual_user_inputs": sum(e["kind"] == "user_input" for e in report["phase_trace"]),
                    "actual_tool_dispatches": sum(e["kind"] == "tool_dispatch" for e in report["phase_trace"]),
                    "selected_reservations": len([row for row in report.get("sqlite_rows", []) if row.get("attempt_id")]),
                    "preflight_refusals": sum(case.get("counts", {}).get("preflight_refusals", 0) for case in report.get("cases", [])),
                    "http_inference": sum(e["kind"] == "upstream" for e in fixture.snapshot()),
                    "unexpected_destinations": fixture.denied_count - report["isolation"]["proof_denied_requests"],
                    "refresh": 0, "discovery": 0,
                    "helper_stdio_rpc_requests": sum(e["kind"] == "helper_rpc" for e in report["phase_trace"]),
                    "helper_callback_http_requests": None}
                preserve_evidence(g, output, report)
                identities = [(event["pid"], event.get("birth")) for event in trace_rows(owned)]
                identities += [(event["helper_pid"], event.get("helper_birth")) for event in trace_rows(owned) if "helper_pid" in event]
                report["owned_process_identities"] = sorted(set(identities))
                report["owned_listener_ports"] = [server.server_port for server in fixture._servers] + g.listener_ports
                raw = owned / "fake/raw.jsonl"
                if raw.exists():
                    target = output / "raw.jsonl"; target.write_bytes(raw.read_bytes())
                    report["raw_log"] = {"path": target.name, "sha256": digest(target)}
        report["cleanup"] = {"gateway_stopped": g.child is None, "owned_children_stopped": not any(process_matches(pid, birth) for pid, birth in report.get("owned_process_identities", [])),
            "fixture_closed": fixture._closed, "temporary_data_removed": not owned.exists()}
    except JourneyFailure as error:
        report["journey_status"] = "failed"; report["error_code"] = str(error); code = 1
    except Exception as error:
        report["journey_status"] = "failed"; report["error_code"] = "unexpected_" + type(error).__name__; code = 1
    finally:
        if owned is not None and not owned.exists():
            report["cleanup"] = {"gateway_stopped": g is None or g.child is None,
                "owned_children_stopped": not any(process_matches(pid, birth) for pid, birth in report.get("owned_process_identities", [])), "fixture_closed": fixture is None or fixture._closed,
                "temporary_data_removed": True,
                "active_children": sum(process_matches(pid, birth) for pid, birth in report.get("owned_process_identities", [])),
                "active_listeners": sum(thread.is_alive() for thread in fixture._threads) if fixture else 0}
            rebound = True
            for port in report.get("owned_listener_ports", []):
                try:
                    with socket.socket() as probe:
                        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); probe.bind(("127.0.0.1", port))
                except OSError: rebound = False
            report["cleanup"]["listeners_rebound"] = rebound
            if not rebound or report["cleanup"]["active_children"] or report["cleanup"]["active_listeners"]:
                report["journey_status"] = "failed"; report["error_code"] = "owned_cleanup_failed"; code = 1
        update()
    print(f'{report["journey_status"]}: {output / "report.json"}', flush=True)
    return code

if __name__ == "__main__":
    raise SystemExit(main())
