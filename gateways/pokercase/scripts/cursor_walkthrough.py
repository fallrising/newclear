#!/usr/bin/env python3
"""Headless text-only Cursor settlement using owned fake runtime/CLI processes."""
import argparse
from contextlib import ExitStack
import csv
import http.client
import io
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time

from cursor_fixture import ERROR_CANARY, IMAGE, TEXT
from claude_walkthrough import (RAW_FIELDS, html_cells, owned_processes,
                                process_matches, require_html_usage, trace_rows, wait_rows)
from offline_fixture import Fixture
from offline_walkthrough import (ENDPOINTS, Gateway, JourneyFailure, cost_summary,
                                 digest, payload, request_deadline, require,
                                 require_csv_accounting, stream_text, tool_request)

STAGES = ("setup_and_auth", "chat_text_stream", "messages_text_stream",
          "responses_text_stream", "text_only_refusal_and_fallback", "failure_and_usage_quality",
          "cancellation_and_post_output_stall", "admin_usage_html_csv", "restart_and_reuse")
SOURCE_FILES = ("cursor_walkthrough.py", "cursor_fixture.py", "claude_walkthrough.py",
                "claude_fixture.py", "offline_walkthrough.py", "offline_fixture.py")
FULL = (9359, 33, 3328, 0)
UNKNOWN = (None,) * 4


class CursorGateway(Gateway):
    def __init__(self, binary, fixture, directory):
        super().__init__(binary, fixture, directory)
        fake = directory / "fake"
        fake.mkdir()
        source = Path(__file__).with_name("cursor_fixture.py").read_text()
        for name in ("cursor-agent", "runtime"):
            target = fake / name
            target.write_text("#!" + sys.executable + "\n" + source.split("\n", 1)[1])
            target.chmod(0o700)
        self.fake, self.runtime = fake / "cursor-agent", fake / "runtime"

    def start(self):
        with socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0))
            self.port = reserve.getsockname()[1]
        self.log = (self.directory / "gateway.log").open("ab")
        env = {"PATH": "/usr/bin:/bin", "HOME": str(self.directory),
               "HTTP_PROXY": self.fixture.proxy_url, "HTTPS_PROXY": self.fixture.proxy_url,
               "ALL_PROXY": self.fixture.proxy_url, "RUST_LOG": "warn"}
        self.child = subprocess.Popen([str(self.binary), "serve", "--host", "127.0.0.1",
            "--port", str(self.port), "--data-dir", str(self.directory), "--admin-token", self.admin,
            "--sse-stall-secs", "5", "--cursor-bin", str(self.fake),
            "--cursor-runtime-bin", str(self.runtime), "--cursor-accept-account-plugins",
            "--cursor-image", IMAGE, "--cursor-profile-volume", "thinrouter-cursor-offline",
            "--cursor-max-runs", "1"], env=env, cwd=self.directory, stdin=subprocess.DEVNULL,
            stdout=self.log, stderr=self.log, start_new_session=True)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            require(self.child.poll() is None, "gateway_exited_before_ready")
            try:
                status, raw = self.request("GET", "/admin/api/stats", admin=True, timeout=.3)
                if status == 200 and "usage_events" in json.loads(raw):
                    return
            except (OSError, http.client.HTTPException):
                pass
            except JourneyFailure as error:
                if str(error) != "request_deadline":
                    raise
            threading.Event().wait(.05)
        raise JourneyFailure("gateway_readiness_timeout")

    def stop(self):
        super().stop()
        # Identity checks exclude PID reuse and zombies. Only our traced fixtures.
        for signum, duration in ((signal.SIGTERM, 3), (signal.SIGKILL, 2)):
            for pid, birth in owned_processes(self.directory):
                if process_matches(pid, birth):
                    try:
                        os.kill(pid, signum)
                    except ProcessLookupError:
                        pass
            deadline = time.monotonic() + duration
            while owned_processes(self.directory) and time.monotonic() < deadline:
                threading.Event().wait(.02)
        require(not owned_processes(self.directory), "owned_process_cleanup")


def require_cursor_row(row, outcome, counters, quality, *, output, ready=True):
    require(row.get("usage_source") == "cursor_cli_result_v1", "cursor_usage_source")
    require(row.get("outcome") == outcome, "cursor_usage_outcome")
    for field in ("request_id", "attempt_id", "finalized_at"):
        require(isinstance(row.get(field), str) and bool(row[field].strip()), "cursor_usage_identity")
    require(row.get("status") is None and row.get("headers_ms") is None, "cli_is_not_http")
    require(row.get("estimated_cost_usd") is None, "cli_cost_not_inferred")
    require(row.get("prompt_tokens") is None, "cursor_cache_relation_unverified")
    require(row.get("completion_tokens") == counters[1], "cursor_output_independent")
    require(row.get("usage_status") == quality, "cursor_usage_quality")
    raw = row.get("reported_usage")
    require(raw is None or isinstance(raw, dict), "cursor_raw_shape")
    values = tuple((raw or {}).get(field) for field in RAW_FIELDS)
    require(values == counters and all(value is None or type(value) is int for value in values), "cursor_raw_usage")
    total = row.get("total_observed_ms")
    require(type(total) is int and 0 <= total < 60000, "cursor_total_time")
    prior = 0
    for field, present in (("cli_ready_ms", ready), ("first_output_ms", output)):
        value = row.get(field)
        if present:
            require(type(value) is int and prior <= value <= total, "cursor_observed_times")
            prior = value
        else:
            require(value is None, "cursor_unobserved_time")


def dispatches(directory):
    return [event for event in trace_rows(directory) if event["kind"] == "dispatch"]


def wait_fixture(gateway, model, kind="waiting"):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if any(event["kind"] == kind and event.get("model") == model for event in trace_rows(gateway.directory)):
            return
        threading.Event().wait(.02)
    raise JourneyFailure("fixture_observation_timeout")


def require_stopped_fixtures(gateway):
    deadline = time.monotonic() + 5
    while owned_processes(gateway.directory) and time.monotonic() < deadline:
        threading.Event().wait(.02)
    require(not owned_processes(gateway.directory), "fixture_process_not_reaped")


def run_journey(g, fixture, report, update):
    expected = {}

    def stage(name, action):
        report["stage"] = name
        update()
        action()
        report["stages"].append({"stage": name, "status": "passed"})
        print("PASS " + name, flush=True)
        update()

    def connection(name):
        return g.api("POST", "connections/oauth/import", {"name": "synthetic-" + name,
            "provider": "cursor", "access_token": "", "default_model": "text"})["connection"]["id"]

    def route(name, conn, model):
        g.api("POST", "routes", {"public_model": name, "targets": [{"connection_id": conn, "model_override": model}]})

    def want(name, outcome="succeeded", counters=FULL, quality="partial", output=True, ready=True):
        expected.setdefault(name, []).append((outcome, counters, quality, output, ready))

    def setup():
        g.start()
        require(all(g.api("GET", "stats")[key] == 0 for key in ("connections", "routes", "api_keys", "usage_events")), "fresh_store")
        require(g.request("GET", "/admin/api/stats", auth=False)[0] == 401, "admin_auth")
        require(g.request("POST", ENDPOINTS["chat"], payload("chat", "missing", True), auth=False)[0] == 401, "gateway_auth")
        require(not dispatches(g.directory), "auth_dispatched")
        g.key = g.api("POST", "keys", {"name": "synthetic-cursor-demo"})["secret"]
        primary = connection("cursor")
        for protocol in ENDPOINTS:
            route(protocol + "-text", primary, "text")
            # A 501 cools its connection; refusals must not cool later fallback.
            route(protocol + "-refusal", connection(protocol + "-refusal"), "text")
        route("image-refusal", connection("image-refusal"), "text")
        for name in ("failure", "bad_result", "partial", "missing", "invalid", "result_only", "cancel", "cancel_before", "stall", "reuse"):
            route(name, connection(name), name)
        g.api("POST", "routes", {"public_model": "fallback", "strategy": "fallback", "targets": [
            {"connection_id": connection("retry"), "model_override": "retry"},
            {"connection_id": primary, "model_override": "text"}]})
    stage(STAGES[0], setup)

    for protocol in ENDPOINTS:
        def exercise(protocol=protocol):
            name = protocol + "-text"
            before = len(dispatches(g.directory))
            require(stream_text(protocol, g.infer(protocol, payload(protocol, name, True))) == TEXT, "text_content")
            require(len(dispatches(g.directory)) == before + 1, "text_dispatch_count")
            want(name)
        stage(protocol + "_text_stream", exercise)

    def refusal_and_fallback():
        before = len(dispatches(g.directory))
        for protocol in ENDPOINTS:
            body = tool_request(protocol, protocol + "-refusal")
            body["stream"] = True
            g.infer(protocol, body, 501)
        body = payload("chat", "image-refusal", True)
        body["messages"][0]["content"] = [{"type": "image_url", "image_url": {"url": "data:image/png;base64,QQ=="}}]
        g.infer("chat", body, 501)
        require(len(dispatches(g.directory)) == before, "refusal_dispatched")
        require(len(g.api("GET", "usage")["data"]) == sum(map(len, expected.values())), "refusal_reserved_attempt")
        require(stream_text("chat", g.infer("chat", payload("chat", "fallback", True))) == TEXT, "fallback_content")
        require([event["model"] for event in dispatches(g.directory)[before:]] == ["retry", "text"], "fallback_dispatch_order")
        want("fallback", "failed", UNKNOWN, "missing", False, False)
        want("fallback")
        report["text_only"] = {"tool_refusals": 3, "image_refusals": 1, "refusal_dispatches": 0}
    stage(STAGES[4], refusal_and_fallback)

    def failures():
        raw = g.infer("chat", payload("chat", "failure", True), 401)
        require(ERROR_CANARY.encode() not in raw, "caller_error_redaction")
        want("failure", "failed", UNKNOWN, "missing", False, False)
        status, raw = g.request("POST", ENDPOINTS["responses"], payload("responses", "bad_result", True))
        require(status == 200, "failed_stream_status")
        events = [json.loads(line[5:]) for line in raw.decode().splitlines() if line.startswith("data:")]
        require(events[-1].get("type") == "response.failed", "failed_stream_terminal")
        require(ERROR_CANARY.encode() not in raw, "failed_result_redaction")
        want("bad_result", "failed")
        for name, counters, quality in (("partial", (None, 7, None, None), "partial"),
                                         ("missing", UNKNOWN, "missing"),
                                         ("invalid", (None, 7, None, None), "invalid"),
                                         ("result_only", FULL, "partial")):
            require(stream_text("chat", g.infer("chat", payload("chat", name, True))) == TEXT, "quality_text_content")
            want(name, counters=counters, quality=quality)
    stage(STAGES[5], failures)

    def cancellation():
        # Close a socket only after the silent fake confirms actual dispatch.
        conn = http.client.HTTPConnection("127.0.0.1", g.port, timeout=5)
        try:
            conn.request("POST", ENDPOINTS["chat"], json.dumps(payload("chat", "cancel_before", True)),
                         {"Content-Type": "application/json", "Authorization": "Bearer " + g.key})
            wait_fixture(g, "cancel_before")
        finally:
            if conn.sock is not None:
                conn.sock.shutdown(socket.SHUT_RDWR)
            conn.close()
        want("cancel_before", "cancelled", UNKNOWN, "missing", False, False)
        wait_rows(g, sum(map(len, expected.values())))
        require_stopped_fixtures(g)
        with request_deadline(10):
            conn, response = g.open("POST", ENDPOINTS["chat"], payload("chat", "cancel", True))
            try:
                require(response.status == 200, "cancel_started")
                require(any(b"partial" in response.readline(8192) for _ in range(20)), "cancel_first_output")
            finally:
                response.close()
                conn.close()
        want("cancel", "cancelled", UNKNOWN, "missing")
        wait_rows(g, sum(map(len, expected.values())))
        require_stopped_fixtures(g)
        status, raw = g.request("POST", ENDPOINTS["responses"], payload("responses", "stall", True), timeout=12)
        require(status == 200, "stall_started")
        events = [json.loads(line[5:]) for line in raw.decode().splitlines() if line.startswith("data:")]
        require(events[-1].get("type") == "response.failed", "stall_terminal")
        want("stall", "timeout", UNKNOWN, "missing")
        wait_rows(g, sum(map(len, expected.values())))
        require_stopped_fixtures(g)
        require(g.request("GET", "/health", auth=False)[0] == 200, "health_after_cancel")
        report["cancellation"] = {"before_output": True, "after_output": True, "post_output_stall": True,
                                  "bounded_pre_output_timeout": "not_claimed"}
    stage(STAGES[6], cancellation)

    def inspect():
        before = len(dispatches(g.directory))
        rows = wait_rows(g, sum(map(len, expected.values())))
        require(len({row["attempt_id"] for row in rows}) == len(rows), "duplicate_attempt")
        require(len(rows) == before, "attempt_dispatch_reconciliation")
        for name, wants in expected.items():
            actual = sorted((row for row in rows if row["public_model"] == name), key=lambda row: row["id"])
            require(len(actual) == len(wants), "route_row_count")
            for row, (outcome, counters, quality, output, ready) in zip(actual, wants):
                require_cursor_row(row, outcome, counters, quality, output=output, ready=ready)
        fallback = [row for row in rows if row["public_model"] == "fallback"]
        require(len({row["request_id"] for row in fallback}) == 1, "fallback_request_link")
        require(len({row["request_id"] for row in rows}) == len(rows) - 1, "independent_request_identity")
        summary = cost_summary(rows)
        stats = g.api("GET", "stats")
        require(stats["usage_events"] == len(rows) and stats["cost_summary"] == summary, "stats_reconciliation")
        require(summary["status"] == "unknown" and summary["known_sum"] is None and stats["estimated_cost_usd"] is None, "all_cost_unknown")
        for day in g.api("GET", "usage/daily")["data"]:
            require(day["cost_summary"] == cost_summary([row for row in rows if row["ts"].startswith(day["day"])]), "daily_reconciliation")
        surfaces = [json.dumps(rows)]
        for path in ("/admin", "/admin/usage"):
            status, raw = g.request("GET", path, admin=True)
            require(status == 200 and b"All-time" in raw, "admin_html")
            require(f"Unknown · 0/{len(rows)} rows".encode() in raw, "admin_unknown_cost")
            if path == "/admin/usage":
                require_html_usage(raw, rows)
            surfaces.append(raw.decode())
        status, raw = g.request("GET", "/admin/api/usage/export.csv", admin=True)
        require(status == 200, "csv_status")
        exported = list(csv.DictReader(io.StringIO(raw.decode())))
        require(len(exported) == len(rows), "csv_row_count")
        by_id = {str(row["id"]): row for row in rows}
        require({row["id"] for row in exported} == set(by_id), "csv_row_identity")
        for row in exported:
            original = by_id[row["id"]]
            require_csv_accounting(original, row)
            value = original["cli_ready_ms"]
            require(row["cli_ready_ms"] == ("" if value is None else str(value)), "csv_cli_ready")
            for field in RAW_FIELDS:
                value = (original.get("reported_usage") or {}).get(field)
                require(row["reported_" + field] == ("" if value is None else str(value)), "csv_raw_usage")
        surfaces.append(raw.decode())
        for sensitive in (ERROR_CANARY, g.admin, g.key, "synthetic-not-persisted", "synthetic greeting"):
            require(not any(sensitive in surface for surface in surfaces), "sensitive_usage_persistence")
        require(len(dispatches(g.directory)) == before, "admin_read_dispatched")
        report["usage"] = {"rows": len(rows), "cost_summary": summary, "attempts": rows,
            "scope": "synthetic Cursor result only; CLI version/cache relationship/billing unverified"}
        return rows
    stage(STAGES[7], inspect)

    def restart():
        for _ in range(2):
            require(stream_text("chat", g.infer("chat", payload("chat", "reuse", True))) == TEXT, "independent_content")
            want("reuse")
        starts = [event for event in trace_rows(g.directory) if event["kind"] == "start" and event["model"] == "reuse"]
        require(len(starts) == 2 and len({(event["pid"], event["birth"]) for event in starts}) == 2, "independent_processes")
        previous = inspect()
        config = {key: g.api("GET", key) for key in ("connections", "routes", "keys")}
        g.stop()
        g.start()
        require(g.api("GET", "usage")["data"] == previous, "restart_history")
        require({key: g.api("GET", key) for key in config} == config, "restart_config")
        require(stream_text("chat", g.infer("chat", payload("chat", "reuse", True))) == TEXT, "restart_content")
        want("reuse")
        inspect()
        require(len([event for event in trace_rows(g.directory) if event["kind"] == "start" and event["model"] == "reuse"]) == 3, "restart_new_dispatch")
        report["reuse"] = {"independent_requests": 3, "same_process_or_session_reuse": False,
                           "restart_history_preserved": True, "pending_recovery": "not_exercised_by_this_journey"}
    stage(STAGES[8], restart)
    require(tuple(item["stage"] for item in report["stages"]) == STAGES, "stage_coverage")
    require(fixture.denied_count == 0, "unexpected_egress_attempt")
    report["proxy_denied_requests"] = fixture.denied_count
    report["fixture_trace"] = trace_rows(g.directory)
    report["stage"], report["journey_status"] = "verified", "passed"
    update()


def preserve_evidence(gateway, output, report):
    # Never preserve arbitrary stderr/request text. Retain structured safe traces
    # and log size/digest only, even when the gateway fails before readiness.
    artifacts = {}
    trace = output / "fixture-trace.json"
    trace.write_text(json.dumps(trace_rows(gateway.directory), indent=2) + "\n")
    artifacts["trace"] = {"path": trace.name, "sha256": digest(trace)}
    log = gateway.directory / "gateway.log"
    if log.exists():
        artifacts["gateway_log"] = {"bytes": log.stat().st_size, "sha256": digest(log), "contents": "not_retained"}
    report["diagnostic_artifacts"] = artifacts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="default: verify then stop owned resources")
    mode.add_argument("--serve", action="store_true", help="verify then keep the local demo until stopped")
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("cursor-offline-results"))
    parser.add_argument("--expected-binary-sha256", help="accepted digest; mismatch fails before launch")
    args = parser.parse_args(argv)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="journey-", dir=args.output_dir.resolve()))
    report_path = output / "report.json"
    report = {"synthetic": True, "journey_status": "running", "stage": "binary", "stages": [],
              "mode": "serve" if args.serve else "check", "cleanup": "not_started",
              "real_provider_requests": 0, "real_cli_version": None, "actual_cost_usd": None}
    def update():
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    update()
    handlers, stopped, exit_code = {}, threading.Event(), 1
    try:
        binary = args.binary.resolve(strict=True)
        require(binary.is_file() and os.access(binary, os.X_OK), "binary_not_executable")
        report["binary_sha256"] = digest(binary)
        if args.expected_binary_sha256:
            require(report["binary_sha256"] == args.expected_binary_sha256, "binary_digest_mismatch")
        report["source_sha256"] = {name: digest(Path(__file__).with_name(name)) for name in SOURCE_FILES}
        for sig in (signal.SIGINT, signal.SIGTERM):
            handlers[sig] = signal.signal(sig, lambda *_: stopped.set())
        resources = ExitStack()
        try:
            owned = resources.enter_context(tempfile.TemporaryDirectory(prefix="thinrouter-cursor-offline-"))
            fixture = resources.enter_context(Fixture())
            g = CursorGateway(binary, fixture, Path(owned))
            resources.callback(preserve_evidence, g, output, report)
            resources.callback(g.stop)
            run_journey(g, fixture, report, update)
            if args.serve:
                print(f"Demo ready: http://127.0.0.1:{g.port}/admin", flush=True)
                print(f"Synthetic admin token file: {g.directory / 'admin-token'}", flush=True)
                print("Ctrl-C stops this demo and removes its temporary data.", flush=True)
                stopped.wait()
        finally:
            report["cleanup"] = "failed"
            resources.close()
            report["cleanup"] = "passed"
        exit_code = 0
    except JourneyFailure as error:
        report["journey_status"] = "failed"
        report["error_code"] = str(error)
    except Exception as error:
        report["journey_status"] = "failed"
        report["error_code"] = "unexpected_" + type(error).__name__
    finally:
        for sig, handler in handlers.items():
            signal.signal(sig, handler)
        update()
    print(f"{'PASSED' if exit_code == 0 else 'FAILED'} stage={report['stage']}; report={report_path}", flush=True)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
