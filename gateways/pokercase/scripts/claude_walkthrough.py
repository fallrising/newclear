#!/usr/bin/env python3
"""Verify a real gateway with an owned fake Claude CLI, entirely from a terminal."""
import argparse
from contextlib import ExitStack
import csv
import http.client
from html.parser import HTMLParser
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

from claude_fixture import ERROR_CANARY, TEXT, TOOL_TEXT
from offline_fixture import Fixture
from offline_walkthrough import (ENDPOINTS, Gateway, JourneyFailure, cost_summary,
                                 digest, payload, request_deadline, require,
                                 require_csv_accounting, stream_text, tool_reply,
                                 tool_request)

STAGES = ("setup_and_auth", "chat_text_stream_tool", "messages_text_stream_tool",
          "responses_text_stream_tool", "fallback", "failure", "downstream_cancel",
          "admin_usage_html_csv", "restart_and_reuse")
RAW_FIELDS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


def trace_rows(directory):
    path = directory / "fake" / "trace.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def process_matches(pid, birth):
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return fields[19] == birth and fields[0] != "Z"
    except (FileNotFoundError, ProcessLookupError, IndexError):
        return False


def owned_processes(directory):
    identities = set()
    for event in trace_rows(directory):
        identities.add((event["pid"], event.get("birth")))
        if "helper_pid" in event:
            identities.add((event["helper_pid"], event["helper_birth"]))
    return [(pid, birth) for pid, birth in identities if birth is not None and process_matches(pid, birth)]


class ClaudeGateway(Gateway):
    def __init__(self, binary, fixture, directory):
        super().__init__(binary, fixture, directory)
        fake = directory / "fake"
        fake.mkdir()
        self.fake = fake / "claude"
        source = Path(__file__).with_name("claude_fixture.py").read_text()
        # An absolute Python executable avoids an accidental installed agent on PATH.
        self.fake.write_text("#!" + sys.executable + "\n" + source.split("\n", 1)[1])
        self.fake.chmod(0o700)
        (fake / "expected-binary").write_text(str(binary))
        (directory / "claude-config").mkdir()

    def start(self):
        with socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0))
            self.port = reserve.getsockname()[1]
        self.log = (self.directory / "gateway.log").open("ab")
        env = {"PATH": "/usr/bin:/bin", "HOME": str(self.directory),
               "CLAUDE_CONFIG_DIR": str(self.directory / "claude-config"),
               "HTTP_PROXY": self.fixture.proxy_url, "HTTPS_PROXY": self.fixture.proxy_url,
               "ALL_PROXY": self.fixture.proxy_url, "RUST_LOG": "warn"}
        self.child = subprocess.Popen([str(self.binary), "serve", "--host", "127.0.0.1",
            "--port", str(self.port), "--data-dir", str(self.directory),
            "--admin-token", self.admin, "--sse-stall-secs", "5",
            "--claude-bin", str(self.fake), "--claude-idle-secs", "120"],
            env=env, cwd=self.directory, stdin=subprocess.DEVNULL,
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
        # Let the gateway shelf idle sessions before cleaning up its owned children.
        if self.child is not None:
            if self.child.poll() is None:
                self.child.terminate()
                try:
                    self.child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(self.child.pid, signal.SIGKILL)
                    self.child.wait(timeout=5)
            self.child = None
        for pid, birth in owned_processes(self.directory):
            if process_matches(pid, birth):
                os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + 3
        while owned_processes(self.directory) and time.monotonic() < deadline:
            threading.Event().wait(.02)
        for pid, birth in owned_processes(self.directory):
            if process_matches(pid, birth):
                os.kill(pid, signal.SIGKILL)
        if self.log:
            self.log.close()
            self.log = None
        require(not owned_processes(self.directory), "owned_process_cleanup")


def stream_tool(protocol, raw):
    """Require a complete protocol-specific tool phase before submitting its result."""
    events = []
    done = False
    for line in raw.decode().splitlines():
        if not line.startswith("data:"):
            continue
        value = line[5:].strip()
        if value == "[DONE]":
            done = True
        else:
            event = json.loads(value)
            require("error" not in event and event.get("type") not in ("error", "response.failed", "response.incomplete"), "tool_stream_error")
            events.append(event)
    if protocol == "responses":
        require(events and events[-1].get("type") == "response.completed", "tool_terminal")
        require(events[-1]["response"]["status"] == "completed", "tool_terminal")
        response = events[-1]["response"]
    elif protocol == "messages":
        require(events and events[-1].get("type") == "message_stop", "tool_terminal")
        require(any(e.get("type") == "message_delta" and e["delta"].get("stop_reason") == "tool_use" for e in events), "tool_finish_reason")
        blocks = {}
        arguments = {}
        for event in events:
            if event.get("type") == "content_block_start":
                blocks[event["index"]] = event["content_block"]
            if event.get("type") == "content_block_delta" and event["delta"].get("type") == "input_json_delta":
                index = event["index"]
                arguments[index] = arguments.get(index, "") + event["delta"]["partial_json"]
        for index, text in arguments.items():
            blocks[index]["input"] = json.loads(text)
        response = {"content": list(blocks.values())}
    else:
        require(done, "tool_terminal")
        calls = {}
        finish = None
        for event in events:
            for choice in event.get("choices", []):
                if choice.get("finish_reason") is not None:
                    finish = choice["finish_reason"]
                for piece in choice.get("delta", {}).get("tool_calls", []):
                    call = calls.setdefault(piece["index"], {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                    call["id"] += piece.get("id", "")
                    call["function"]["name"] += piece.get("function", {}).get("name", "")
                    call["function"]["arguments"] += piece.get("function", {}).get("arguments", "")
        require(finish == "tool_calls", "tool_finish_reason")
        response = {"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": list(calls.values())}}]}
    # tool_reply validates call identity, name and arguments, not merely terminal presence.
    tool_reply(protocol, tool_request(protocol, "validation"), response)
    return response


def require_claude_row(row, outcome, counters=None, complete=False):
    require(row.get("usage_source") == "claude_code_stream_event_v1", "claude_usage_source")
    require(row.get("outcome") == outcome, "claude_usage_outcome")
    for field in ("request_id", "attempt_id", "finalized_at"):
        require(isinstance(row.get(field), str) and bool(row[field]), "claude_usage_identity")
    require(row.get("status") is None and row.get("headers_ms") is None, "cli_is_not_http")
    require(row.get("estimated_cost_usd") is None, "cli_cost_not_inferred")
    require(type(row.get("total_observed_ms")) is int and row["total_observed_ms"] >= 0, "claude_total_time")
    if counters is not None:
        raw = row.get("reported_usage")
        require(isinstance(raw, dict), "claude_raw_usage")
        require((raw.get("input_tokens"), raw.get("output_tokens")) == counters, "claude_raw_usage")
        require(row.get("completion_tokens") == counters[1], "claude_output_usage")
        require(row.get("prompt_tokens") == (counters[0] if complete else None), "claude_input_coverage")
        require(row.get("usage_status") == ("complete" if complete else "partial"), "claude_usage_quality")
        for name in RAW_FIELDS[2:]:
            require(raw.get(name) == (0 if complete else None), "claude_cache_coverage")
        times = [row.get(name) for name in ("cli_ready_ms", "first_output_ms", "total_observed_ms")]
        require(all(type(value) is int for value in times) and 0 <= times[0] <= times[1] <= times[2], "claude_observed_times")
    else:
        require(row.get("prompt_tokens") is None and row.get("completion_tokens") is None, "failed_usage_not_invented")



class UsageTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.cell = None
        self.row = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag == "div" and dict(attrs).get("aria-label") == "Recent usage table":
            self.active = True
        if self.active and tag == "tr":
            self.row = []
        if self.active and tag == "td":
            self.cell = []

    def handle_data(self, text):
        if self.cell is not None:
            self.cell.append(text)

    def handle_endtag(self, tag):
        if self.active and tag == "td" and self.cell is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        if self.active and tag == "tr" and self.row:
            self.rows.append(self.row)
        if self.active and tag == "table":
            self.active = False


def html_cells(row):
    number = lambda value: "—" if value is None else str(value)
    timing = lambda value: "—" if value is None else str(value) + " ms"
    raw = row.get("reported_usage")
    return [row["ts"], row["public_model"] or "—", row["connection_id"] or "—", number(row["status"]),
            " / ".join(timing(row.get(key)) for key in ("headers_ms", "cli_ready_ms", "first_output_ms", "total_observed_ms")),
            number(row["prompt_tokens"]) + "/" + number(row["completion_tokens"]), "—", row["error"] or "",
            row["outcome"], row["usage_status"] + " / " + row["usage_source"],
            " / ".join(number(raw.get(key)) for key in RAW_FIELDS) if raw else "—"]


def require_html_usage(raw, rows):
    parsed = UsageTable()
    parsed.feed(raw.decode())
    require(parsed.rows == [html_cells(row) for row in rows], "html_usage_reconciliation")


def wait_rows(gateway, count):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        rows = gateway.api("GET", "usage")["data"]
        if len(rows) == count and all(row.get("finalized_at") for row in rows):
            return rows
        threading.Event().wait(.025)
    raise JourneyFailure("usage_settlement_timeout")


def run_journey(g, fixture, report, update):
    expected = {}

    def stage(name, action):
        report["stage"] = name
        update()
        action()
        report["stages"].append({"stage": name, "status": "passed"})
        print("PASS " + name, flush=True)
        update()

    def route(name, connection, model):
        g.api("POST", "routes", {"public_model": name, "targets": [{"connection_id": connection, "model_override": model}]})

    def connection(name):
        return g.api("POST", "connections/oauth/import", {"name": name, "provider": "claude", "access_token": "", "default_model": "text"})["connection"]["id"]

    def setup():
        g.start()
        require(all(g.api("GET", "stats")[key] == 0 for key in ("connections", "routes", "api_keys", "usage_events")), "fresh_store")
        require(g.request("GET", "/admin/api/stats", auth=False)[0] == 401, "admin_auth")
        require(g.request("POST", ENDPOINTS["chat"], payload("chat", "missing", True), auth=False)[0] == 401, "gateway_auth")
        g.key = g.api("POST", "keys", {"name": "synthetic-cli-demo"})["secret"]
        primary = connection("synthetic-claude")
        for protocol in ENDPOINTS:
            route(protocol + "-text", primary, "text_complete" if protocol == "chat" else "text")
            route(protocol + "-tool", primary, "tool-" + protocol)
        for name in ("failure", "cancel", "stall", "reuse"):
            route(name, connection("synthetic-" + name), name)
        retry = connection("synthetic-retry")
        g.api("POST", "routes", {"public_model": "fallback", "strategy": "fallback", "targets": [
            {"connection_id": retry, "model_override": "retry"},
            {"connection_id": primary, "model_override": "text"}]})

    stage(STAGES[0], setup)
    for protocol in ENDPOINTS:
        def exercise(protocol=protocol):
            name = protocol + "-text"
            require(stream_text(protocol, g.infer(protocol, payload(protocol, name, True))) == TEXT, "text_content")
            expected[name] = [("succeeded", (12, 5), protocol == "chat")]
            name = protocol + "-tool"
            request = tool_request(protocol, name)
            request["stream"] = True
            before = len([e for e in trace_rows(g.directory) if e["kind"] == "start"])
            first = stream_tool(protocol, g.infer(protocol, request))
            final = tool_reply(protocol, request, first)
            require(stream_text(protocol, g.infer(protocol, final)) == TOOL_TEXT, "tool_final_content")
            events = trace_rows(g.directory)
            require(len([e for e in events if e["kind"] == "start"]) == before + 1, "tool_process_not_reused")
            require(any(e["kind"] == "tool_result" and e["model"] == "tool-" + protocol for e in events), "mcp_result_not_delivered")
            expected[name] = [("succeeded", (20, 9), False), ("succeeded", (21, 6), False)]
        stage(protocol + "_text_stream_tool", exercise)

    def fallback():
        offset = len(trace_rows(g.directory))
        require(stream_text("chat", g.infer("chat", payload("chat", "fallback", True))) == TEXT, "fallback_content")
        dispatches = [e["model"] for e in trace_rows(g.directory)[offset:] if e["kind"] == "start"]
        require(dispatches == ["retry", "text"], "fallback_dispatch_order")
        expected["fallback"] = [("failed", None, False), ("succeeded", (12, 5), False)]
    stage("fallback", fallback)

    def failure():
        raw = g.infer("chat", payload("chat", "failure", True), 401)
        require(ERROR_CANARY.encode() in raw, "caller_error_contract")
        expected["failure"] = [("failed", None, False)]
        code, raw = g.request("POST", ENDPOINTS["responses"], payload("responses", "stall", True), timeout=12)
        require(code == 200, "stall_started")
        events = [json.loads(line[5:]) for line in raw.decode().splitlines() if line.startswith("data:")]
        require(any(e.get("type") == "response.failed" for e in events), "stall_terminal")
        expected["stall"] = [("timeout", (4, 0), False)]
    stage("failure", failure)

    def cancel():
        with request_deadline(10):
            conn, response = g.open("POST", ENDPOINTS["chat"], payload("chat", "cancel", True))
            try:
                require(response.status == 200, "cancel_start")
                found = False
                for _ in range(20):
                    line = response.readline(8192)
                    if b"partial" in line:
                        found = True
                        break
                require(found, "cancel_first_output")
            finally:
                response.close()
                conn.close()
        expected["cancel"] = [("cancelled", (4, 0), False)]
        wait_rows(g, sum(map(len, expected.values())))
        require(g.request("GET", "/health", auth=False)[0] == 200, "health_after_cancel")
    stage("downstream_cancel", cancel)

    def inspect():
        rows = wait_rows(g, sum(map(len, expected.values())))
        require(len({row["attempt_id"] for row in rows}) == len(rows), "duplicate_attempt")
        for name, wants in expected.items():
            actual = sorted((row for row in rows if row["public_model"] == name), key=lambda row: row["id"])
            require(len(actual) == len(wants), "route_row_count")
            for row, (outcome, counters, complete) in zip(actual, wants):
                require_claude_row(row, outcome, counters, complete)
        fallback_rows = [row for row in rows if row["public_model"] == "fallback"]
        require(len({row["request_id"] for row in fallback_rows}) == 1, "fallback_request_link")
        summary = cost_summary(rows)
        stats = g.api("GET", "stats")
        require(stats["usage_events"] == len(rows) and stats["cost_summary"] == summary, "stats_reconciliation")
        require(summary["status"] == "unknown" and summary["known_sum"] is None and stats["estimated_cost_usd"] is None, "cost_unknown")
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
            for field in ("cli_ready_ms",):
                require(row[field] == ("" if original[field] is None else str(original[field])), "csv_cli_ready")
            for field in RAW_FIELDS:
                value = (original.get("reported_usage") or {}).get(field)
                require(row["reported_" + field] == ("" if value is None else str(value)), "csv_raw_usage")
        surfaces.append(raw.decode())
        for sensitive in (ERROR_CANARY, g.admin, g.key):
            require(not any(sensitive in surface for surface in surfaces), "sensitive_usage_persistence")
        report["usage"] = {"rows": len(rows), "cost_summary": summary, "attempts": rows,
                           "scope": "synthetic Claude stream_event only; no real CLI/version/billing verification"}
        return rows
    stage("admin_usage_html_csv", inspect)

    def restart():
        initial = payload("chat", "reuse", True)
        initial["messages"][0]["content"] = "first synthetic reuse turn"
        require(stream_text("chat", g.infer("chat", initial)) == TEXT, "reuse_first_content")
        events = trace_rows(g.directory)
        starts = [e for e in events if e["kind"] == "start" and e["model"] == "reuse"]
        require(len(starts) == 1, "reuse_initial_process")
        second = json.loads(json.dumps(initial))
        second["messages"] += [{"role": "assistant", "content": TEXT}, {"role": "user", "content": "second synthetic reuse turn"}]
        require(stream_text("chat", g.infer("chat", second)) == TEXT, "reuse_second_content")
        require(len([e for e in trace_rows(g.directory) if e["kind"] == "start" and e["model"] == "reuse"]) == 1, "user_process_not_reused")
        expected["reuse"] = [("succeeded", (12, 5), False)] * 2
        previous = inspect()
        config = {key: g.api("GET", key) for key in ("connections", "routes", "keys")}
        g.stop()
        g.start()
        require(g.api("GET", "usage")["data"] == previous, "restart_history")
        require({key: g.api("GET", key) for key in config} == config, "restart_config")
        third = json.loads(json.dumps(second))
        third["messages"] += [{"role": "assistant", "content": TEXT}, {"role": "user", "content": "third synthetic after restart"}]
        require(stream_text("chat", g.infer("chat", third)) == TEXT, "restart_content")
        starts = [e for e in trace_rows(g.directory) if e["kind"] == "start" and e["model"] == "reuse"]
        require(len(starts) == 2 and starts[-1]["resumed"], "saved_session_not_resumed")
        require(sum(e["kind"] == "resume" and e["model"] == "reuse" for e in trace_rows(g.directory)) == 1, "resume_session_missing")
        expected["reuse"].append(("succeeded", (12, 5), False))
        inspect()
        report["reuse"] = {"initial_process": starts[0]["pid"], "resumed_process": starts[1]["pid"],
                           "same_process_second_turn": True, "restart_resume": True,
                           "pending_recovery": "not_exercised_by_this_journey"}
    stage("restart_and_reuse", restart)
    require(tuple(item["stage"] for item in report["stages"]) == STAGES, "stage_coverage")
    require(fixture.denied_count == 0, "unexpected_egress_attempt")
    report["proxy_denied_requests"] = fixture.denied_count
    report["fixture_trace"] = trace_rows(g.directory)
    report["stage"] = "verified"
    report["journey_status"] = "passed"
    update()


def preserve_evidence(gateway, output, report):
    """Keep sanitized fixture diagnostics before owned temporary data is removed."""
    artifacts = {}
    for relative in ("gateway.log", "fake/trace.jsonl"):
        source = gateway.directory / relative
        if not source.exists():
            continue
        text = source.read_text(errors="replace")
        for value in (gateway.admin, gateway.key, gateway.fixture.api_key):
            if value:
                text = text.replace(value, "[synthetic-secret-redacted]")
        target = output / relative.replace("/", "-")
        target.write_text(text)
        artifacts[relative] = {"path": target.name, "sha256": digest(target)}
    report["diagnostic_artifacts"] = artifacts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="default: verify then stop owned resources")
    mode.add_argument("--serve", action="store_true", help="verify then keep the local demo until Ctrl-C")
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("claude-offline-results"))
    parser.add_argument("--expected-binary-sha256", help="optional accepted binary digest; mismatch fails before launch")
    args = parser.parse_args(argv)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="journey-", dir=args.output_dir.resolve()))
    report_path = output / "report.json"
    report = {"synthetic": True, "journey_status": "running", "stage": "binary", "stages": [],
              "mode": "serve" if args.serve else "check", "cleanup": "pending",
              "real_provider_requests": 0, "real_cli_version": None, "actual_cost_usd": None}
    def update():
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    update()
    handlers = {}
    stopped = threading.Event()
    exit_code = 1
    try:
        binary = args.binary.resolve(strict=True)
        require(binary.is_file() and os.access(binary, os.X_OK), "binary_not_executable")
        report["binary_sha256"] = digest(binary)
        if args.expected_binary_sha256:
            require(report["binary_sha256"] == args.expected_binary_sha256, "binary_digest_mismatch")
        report["source_sha256"] = {name: digest(Path(__file__).with_name(name)) for name in (
            "claude_walkthrough.py", "claude_fixture.py", "offline_walkthrough.py", "offline_fixture.py")}
        for sig in (signal.SIGINT, signal.SIGTERM):
            handlers[sig] = signal.signal(sig, lambda *_: stopped.set())
        resources = ExitStack()
        try:
            owned = resources.enter_context(tempfile.TemporaryDirectory(prefix="thinrouter-claude-offline-"))
            fixture = resources.enter_context(Fixture())
            g = ClaudeGateway(binary, fixture, Path(owned))
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
