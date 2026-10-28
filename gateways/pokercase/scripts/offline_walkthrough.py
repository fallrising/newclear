#!/usr/bin/env python3
"""Run a real gateway against owned synthetic HTTP fixtures; Python stdlib only."""
import argparse
from contextlib import ExitStack, contextmanager
import csv
import hashlib
import http.client
import io
import json
import math
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import tempfile
import threading
import time

from offline_fixture import ERROR_CANARY, Fixture

TEXT = "Hello from the offline gateway."
TOOL_TEXT = "Tool result: 5."
ENDPOINTS = {"chat": "/v1/chat/completions", "messages": "/v1/messages",
             "responses": "/v1/responses"}
LIMIT = 2 * 1024 * 1024
ISSUES = {"stream_settlement": 698, "remaining_metering": 699,
          "live_acceptance": 700, "fixture_reliability": 701,
          "antigravity_isolation": 702}


class JourneyFailure(Exception):
    """Only fixed diagnostic codes may reach persistent output."""


def require(condition, code):
    if not condition:
        raise JourneyFailure(code)


@contextmanager
def request_deadline(seconds):
    """Bound total HTTP time, including a peer that keeps sending bytes (POSIX)."""
    def expired(*_):
        raise JourneyFailure("request_deadline")
    started = time.monotonic()
    previous = signal.signal(signal.SIGALRM, expired)
    timer = signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        if timer[0]:
            signal.setitimer(signal.ITIMER_REAL, max(.001, timer[0] - (time.monotonic() - started)), timer[1])


def digest(path):
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def payload(protocol, model, stream=False):
    body = {"model": model, "stream": stream}
    if protocol == "responses":
        body.update(input="synthetic greeting", max_output_tokens=32)
    else:
        body["messages"] = [{"role": "user", "content": "synthetic greeting"}]
        body["max_tokens"] = 32
    return body


def text_response(protocol, body):
    if protocol == "chat":
        require(body["choices"][0]["finish_reason"] == "stop", "buffered_terminal")
        return body["choices"][0]["message"]["content"]
    if protocol == "messages":
        require(body["stop_reason"] == "end_turn", "buffered_terminal")
        return "".join(b.get("text", "") for b in body["content"])
    require(body["status"] == "completed", "buffered_terminal")
    return "".join(c.get("text", "") for b in body["output"]
                   for c in b.get("content", []))


def stream_text(protocol, raw):
    """Require exact content AND the protocol's terminal event, including EOF cases."""
    pieces, terminal, finished = [], False, False
    for line in raw.decode("utf-8").splitlines():
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            if protocol == "chat":
                require(finished, "stream_finish_reason")
                terminal = True
            continue
        event = json.loads(data)
        require("error" not in event and event.get("type") not in (
            "error", "response.failed", "response.incomplete", "response.cancelled"), "stream_error")
        if protocol == "chat":
            for choice in event.get("choices", []):
                pieces.append(choice.get("delta", {}).get("content") or "")
                if choice.get("finish_reason") is not None:
                    require(choice["finish_reason"] == "stop", "stream_finish_reason")
                    finished = True
        elif protocol == "messages":
            if event.get("type") == "content_block_delta":
                pieces.append(event["delta"].get("text", ""))
            if event.get("type") == "message_delta" and event["delta"].get("stop_reason") is not None:
                require(event["delta"]["stop_reason"] == "end_turn", "stream_finish_reason")
                finished = True
            if event.get("type") == "message_stop":
                require(finished, "stream_finish_reason")
                terminal = True
        else:
            if event.get("type") == "response.output_text.delta":
                pieces.append(event["delta"])
            if event.get("type") == "response.completed":
                require(event["response"]["status"] == "completed", "stream_terminal")
                terminal = True
    require(terminal, "stream_terminal_missing")
    return "".join(pieces)


def tool_request(protocol, model):
    body = payload(protocol, model)
    schema = {"type": "object", "properties": {"a": {"type": "integer"},
              "b": {"type": "integer"}}, "required": ["a", "b"]}
    function = {"name": "add", "description": "Add two synthetic integers",
                "parameters": schema}
    if protocol == "chat":
        body["tools"] = [{"type": "function", "function": function}]
    elif protocol == "messages":
        body["tools"] = [{"name": "add", "description": function["description"],
                          "input_schema": schema}]
    else:
        body["tools"] = [{"type": "function", **function}]
    return body


def tool_reply(protocol, request, response):
    if protocol == "chat":
        message = response["choices"][0]["message"]
        calls = message["tool_calls"]
        require(len(calls) == 1, "tool_count")
        call_id, name, args = calls[0]["id"], calls[0]["function"]["name"], json.loads(calls[0]["function"]["arguments"])
    elif protocol == "messages":
        calls = [c for c in response["content"] if c["type"] == "tool_use"]
        require(len(calls) == 1, "tool_count")
        call_id, name, args = calls[0]["id"], calls[0]["name"], calls[0]["input"]
    else:
        calls = [c for c in response["output"] if c["type"] == "function_call"]
        require(len(calls) == 1, "tool_count")
        call_id, name, args = calls[0]["call_id"], calls[0]["name"], json.loads(calls[0]["arguments"])
    require(call_id == "call_demo_add" and name == "add" and args == {"a": 2, "b": 3}, "tool_contract")
    result = str(args["a"] + args["b"])
    if protocol == "chat":
        request["messages"] += [message, {"role": "tool", "tool_call_id": call_id, "content": result}]
    elif protocol == "messages":
        request["messages"] += [{"role": "assistant", "content": response["content"]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": call_id, "content": result}]}]
    else:
        request["input"] = [{"role": "user", "content": request["input"]}, *calls,
            {"type": "function_call_output", "call_id": call_id, "output": result}]
    return request


def cost_summary(rows):
    known = [r["estimated_cost_usd"] for r in rows if r["estimated_cost_usd"] is not None]
    require(all(isinstance(n, (int, float)) and math.isfinite(n) for n in known), "cost_nonfinite")
    total = len(rows)
    return {"known_sum": sum(known) if known else None, "known_count": len(known),
            "unknown_count": total - len(known), "total_count": total,
            "coverage": len(known) / total if total else None,
            "status": "no_data" if not total else "unknown" if not known else "complete" if len(known) == total else "partial",
            "basis": "stored_estimate_usd"}


def require_stream_accounting(row):
    """Require persisted raw Chat-upstream usage, never converter default counters."""
    values = (row["prompt_tokens"], row["completion_tokens"], row["estimated_cost_usd"])
    require(values == (5, 3, 2.0), "stream_usage_false_value")
    require(row.get("outcome") == "succeeded" and row.get("usage_status") == "complete",
            "stream_accounting_terminal")
    require(row.get("usage_source") == "openai_chat_v1" and row.get("upstream_model") == "demo-text",
            "stream_accounting_source")
    for field in ("request_id", "attempt_id", "finalized_at"):
        require(isinstance(row.get(field), str) and bool(row[field].strip()), "stream_accounting_identity")
    timings = tuple(row.get(field) for field in ("headers_ms", "first_output_ms", "total_observed_ms"))
    require(all(type(value) is int for value in timings), "stream_accounting_timing")
    require(0 <= timings[0] <= timings[1] <= timings[2], "stream_accounting_timing")
    require(row["status"] == 200 and row["error"] is None, "stream_accounting_status")
    return {field: row[field] for field in (
        "prompt_tokens", "completion_tokens", "estimated_cost_usd", "outcome", "usage_status",
        "usage_source", "upstream_model", "request_id", "attempt_id", "finalized_at",
        "headers_ms", "first_output_ms", "total_observed_ms")}


def require_html_cost_summary(raw, summary):
    phrase = {"partial": "Partial estimate", "complete": "Estimated total"}[summary["status"]]
    pattern = (re.escape(phrase) + r' \$([0-9]+(?:\.[0-9]+)?) · ' +
               f'{summary["known_count"]}/{summary["total_count"]} rows')
    match = re.search(pattern, raw.decode())
    require(match is not None and float(match.group(1)) == summary["known_sum"],
            "html_cost_reconciliation")


def require_csv_accounting(original, exported):
    for field in ("status", "latency_ms", "prompt_tokens", "completion_tokens", "estimated_cost_usd",
                  "headers_ms", "first_output_ms", "total_observed_ms"):
        require((exported[field] == "" if original[field] is None else float(exported[field]) == original[field]),
                "csv_usage_reconciliation")
    for field in ("ts", "public_model", "connection_id", "error", "request_id", "attempt_id", "upstream_model",
                  "finalized_at", "outcome", "usage_status", "usage_source"):
        require(exported[field] == ("" if original[field] is None else str(original[field])),
                "csv_metadata_reconciliation")


class Gateway:
    def __init__(self, binary, fixture, directory):
        self.binary, self.fixture, self.directory = binary, fixture, directory
        self.admin = "synthetic-" + secrets.token_hex(24)
        self.key = None
        self.child = None
        self.log = None
        self.port = None
        token_file = directory / "admin-token"
        token_file.write_text(self.admin)
        token_file.chmod(0o600)

    def start(self):
        with socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0))
            self.port = reserve.getsockname()[1]
        self.log = (self.directory / "gateway.log").open("ab")
        env = {"PATH": "/usr/bin:/bin", "HOME": str(self.directory),
               "HTTP_PROXY": self.fixture.proxy_url, "HTTPS_PROXY": self.fixture.proxy_url,
               "ALL_PROXY": self.fixture.proxy_url, "RUST_LOG": "warn"}
        self.child = subprocess.Popen([str(self.binary), "serve", "--host", "127.0.0.1",
            "--port", str(self.port), "--data-dir", str(self.directory),
            "--admin-token", self.admin, "--sse-stall-secs", "5"],
            env=env, cwd=self.directory, stdin=subprocess.DEVNULL,
            stdout=self.log, stderr=self.log, start_new_session=True)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            require(self.child.poll() is None, "gateway_exited_before_ready")
            try:
                status, raw = self.request("GET", "/admin/api/stats", admin=True, timeout=0.3)
                if status == 200 and "usage_events" in json.loads(raw):
                    return
            except (OSError, http.client.HTTPException):
                pass
            except JourneyFailure as error:
                if str(error) != "request_deadline":
                    raise
            threading.Event().wait(0.05)
        raise JourneyFailure("gateway_readiness_timeout")

    def request(self, method, path, body=None, *, admin=False, auth=True, timeout=10):
        with request_deadline(timeout):
            conn, response = self.open(method, path, body, admin=admin, auth=auth, timeout=timeout)
            try:
                raw = response.read(LIMIT + 1)
                require(len(raw) <= LIMIT, "response_size_limit")
                return response.status, raw
            finally:
                response.close()
                conn.close()

    def open(self, method, path, body=None, *, admin=False, auth=True, timeout=10):
        headers = {"Content-Type": "application/json", "Connection": "close"}
        if admin:
            headers["x-admin-token"] = self.admin
        elif auth and self.key:
            headers["Authorization"] = "Bearer " + self.key
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        try:
            conn.request(method, path, json.dumps(body) if body is not None else None, headers)
            return conn, conn.getresponse()
        except BaseException:
            conn.close()
            raise

    def api(self, method, path, body=None):
        status, raw = self.request(method, "/admin/api/" + path, body, admin=True)
        require(status == (201 if method == "POST" else 200), "admin_status")
        return json.loads(raw)

    def infer(self, protocol, body, status=200):
        code, raw = self.request("POST", ENDPOINTS[protocol], body)
        require(code == status, "inference_status")
        return raw

    def stop(self):
        if self.child is not None:
            if self.child.poll() is None:
                os.killpg(self.child.pid, signal.SIGTERM)
                try:
                    self.child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(self.child.pid, signal.SIGKILL)
                    self.child.wait(timeout=5)
            self.child = None
        if self.log:
            self.log.close()
            self.log = None


def run_journey(gateway, fixture, report, update):
    g = gateway
    expected = {}  # route -> [(buffered|stream|failed|cancel, HTTP status)]

    def stage(name, fn):
        report["stage"] = name
        update()
        fn()
        report["stages"].append({"stage": name, "status": "passed"})
        print(f"PASS {name}", flush=True)
        update()

    def route(name, model, connection):
        g.api("POST", "routes", {"public_model": name, "targets": [
            {"connection_id": connection, "model_override": model}]})

    def setup():
        g.start()
        stats = g.api("GET", "stats")
        require(all(stats[k] == 0 for k in ("connections", "routes", "api_keys", "usage_events")), "fresh_store")
        require(g.request("GET", "/admin/api/stats", auth=False)[0] == 401, "admin_auth")
        require(g.request("POST", ENDPOINTS["chat"], payload("chat", "missing"), auth=False)[0] == 401, "gateway_auth")
        g.key = g.api("POST", "keys", {"name": "offline-demo"})["secret"]
        connection = g.api("POST", "connections", {"name": "synthetic-local-only",
            "base_url": fixture.base_url, "api_key": fixture.api_key, "default_model": "demo-text",
            "input_price_per_m": 250000, "output_price_per_m": 250000})["id"]
        report["connection_count"] = 1
        for protocol in ENDPOINTS:
            for kind, model in (("text", "demo-text"), ("stream", "demo-text"), ("tool", "demo-tool")):
                route(protocol + "-" + kind, model, connection)
        route("failure", "demo-error", connection)
        route("cancel", "demo-cancel", connection)
        # Distinct target connections prevent the first target's cooldown hiding the next.
        retry = g.api("POST", "connections", {"name": "synthetic-retry-only",
            "base_url": fixture.base_url, "api_key": fixture.api_key, "default_model": "demo-retry"})["id"]
        report["connection_count"] = 2
        g.api("POST", "routes", {"public_model": "fallback", "strategy": "fallback", "targets": [
            {"connection_id": retry}, {"connection_id": connection}]})

    stage("setup_and_auth", setup)
    for protocol in ENDPOINTS:
        def exercise(protocol=protocol):
            name = protocol + "-text"
            require(text_response(protocol, json.loads(g.infer(protocol, payload(protocol, name)))) == TEXT, "buffered_content")
            expected[name] = [("buffered", 200)]
            name = protocol + "-stream"
            require(stream_text(protocol, g.infer(protocol, payload(protocol, name, True))) == TEXT, "stream_content")
            expected[name] = [("stream", 200)]
            name = protocol + "-tool"
            request = tool_request(protocol, name)
            response = json.loads(g.infer(protocol, request))
            final = json.loads(g.infer(protocol, tool_reply(protocol, request, response)))
            require(text_response(protocol, final) == TOOL_TEXT, "tool_final_content")
            expected[name] = [("buffered", 200), ("buffered", 200)]
        stage(protocol + "_text_stream_tool", exercise)

    def fallback():
        before = len(fixture.snapshot())
        require(text_response("chat", json.loads(g.infer("chat", payload("chat", "fallback")))) == TEXT, "fallback_content")
        attempts = [e["model"] for e in fixture.snapshot()[before:] if e["kind"] == "upstream"]
        require(attempts == ["demo-retry", "demo-text"], "fallback_dispatch_order")
        expected["fallback"] = [("failed", 429), ("buffered", 200)]
    stage("fallback", fallback)

    def failure():
        raw = g.infer("chat", payload("chat", "failure"), 400)
        require(ERROR_CANARY.encode() in raw, "caller_error_contract")
        expected["failure"] = [("failed", 400)]
    stage("failure", failure)

    def cancel():
        with request_deadline(10):
            conn, response = g.open("POST", ENDPOINTS["chat"], payload("chat", "cancel", True))
            try:
                require(response.status == 200, "cancel_start")
                require(response.readline(8192).startswith(b"data:"), "cancel_first_event")
            finally:
                response.close()
                conn.close()
        require(fixture.cancel_seen.wait(10), "upstream_cancel_not_observed")
        expected["cancel"] = [("cancel", 200)]
        require(g.request("GET", "/health", auth=False)[0] == 200, "health_after_cancel")
    stage("downstream_cancel", cancel)

    def inspect():
        rows = g.api("GET", "usage")["data"]
        require(len(rows) == sum(map(len, expected.values())), "usage_row_count")
        unknown = 0
        normal_streams = {}
        for name, want in expected.items():
            actual = sorted((r for r in rows if r["public_model"] == name), key=lambda r: r["id"])
            require(len(actual) == len(want), "usage_route_count")
            for row, (kind, status) in zip(actual, want):
                require(row["status"] == status, "usage_http_status")
                values = (row["prompt_tokens"], row["completion_tokens"], row["estimated_cost_usd"])
                if kind == "buffered":
                    require(values == (5, 3, 2.0), "buffered_usage")
                elif kind == "stream":
                    normal_streams[name] = require_stream_accounting(row)
                else:
                    require(values == (None, None, None), "unfinished_usage_false_value")
                if kind == "failed":
                    require(row["error"] == "upstream_attempt_failed", "persisted_error_contract")
                unknown += values[0] is None
        for field in ("request_id", "attempt_id"):
            require(len({row[field] for row in normal_streams.values()}) == len(ENDPOINTS),
                    "stream_accounting_duplicate_identity")
        summary = cost_summary(rows)
        stats = g.api("GET", "stats")
        require(stats["cost_summary"] == summary and stats["usage_events"] == len(rows), "stats_reconciliation")
        complete = summary["known_sum"] if summary["status"] == "complete" else None
        require(stats["estimated_cost_usd"] == complete, "legacy_cost_reconciliation")
        daily = g.api("GET", "usage/daily")["data"]
        require({d["day"] for d in daily} == {r["ts"][:10] for r in rows}, "daily_scope")
        for day in daily:
            require(day["cost_summary"] == cost_summary([r for r in rows if r["ts"].startswith(day["day"])]), "daily_reconciliation")
        surfaces = [json.dumps(rows)]
        for path in ("/admin", "/admin/usage"):
            status, raw = g.request("GET", path, admin=True)
            require(status == 200 and b"All-time" in raw, "admin_html")
            require_html_cost_summary(raw, summary)
            surfaces.append(raw.decode())
        status, raw = g.request("GET", "/admin/api/usage/export.csv", admin=True)
        require(status == 200, "csv_status")
        exported = list(csv.DictReader(io.StringIO(raw.decode())))
        require(len(exported) == len(rows), "csv_row_count")
        by_id = {str(r["id"]): r for r in rows}
        require({r["id"] for r in exported} == set(by_id), "csv_row_identity")
        for row in exported:
            original = by_id[row["id"]]
            require_csv_accounting(original, row)
        surfaces.append(raw.decode())
        surfaces.append((g.directory / "gateway.log").read_text())
        for sensitive in (ERROR_CANARY, g.admin, g.key, fixture.api_key):
            require(not any(sensitive in surface for surface in surfaces), "sensitive_persistence")
        report["usage"] = {"rows": len(rows), "unknown_token_rows": unknown, "cost_summary": summary,
            "normal_streams": normal_streams,
            "terminal_outcomes": "normal_streams_client_terminal_and_persisted_succeeded_verified",
            "remaining_unknowns": "failed_or_cancelled_usage_may_be_unknown_buffered_outcome_is_legacy",
            "prices": "synthetic_fixture_only_not_provider_pricing"}
        return rows
    stage("admin_usage_html_csv", inspect)

    def restart():
        previous = g.api("GET", "usage")["data"]
        config = {k: g.api("GET", k) for k in ("connections", "routes", "keys")}
        g.stop()
        g.start()
        require(g.api("GET", "usage")["data"] == previous, "restart_history")
        require({k: g.api("GET", k) for k in config} == config, "restart_config")
        require(text_response("chat", json.loads(g.infer("chat", payload("chat", "chat-text")))) == TEXT, "restart_request")
        expected["chat-text"].append(("buffered", 200))
        inspect()
    stage("restart_and_reuse", restart)
    require(fixture.denied_count == 0, "unexpected_egress_attempt")
    report["proxy_denied_requests"] = fixture.denied_count
    report["stage"] = "verified"
    report["journey_status"] = "passed"
    update()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="verify then stop owned resources")
    mode.add_argument("--serve", action="store_true", help="verify then keep admin demo until Ctrl-C")
    parser.add_argument("--binary", type=Path, required=True, help="locally built thinrouter binary")
    parser.add_argument("--output-dir", type=Path, default=Path("offline-results"), help="parent for a new sanitized report directory")
    args = parser.parse_args(argv)
    # Never overwrite a caller's report; each invocation owns a newly created child.
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="journey-", dir=args.output_dir.resolve()))
    report_path = output / "report.json"
    report = {"synthetic": True, "journey_status": "running", "mode": "serve" if args.serve else "check",
              "stage": "binary", "stages": [], "cleanup": "pending",
              "issues": {k: f"https://github.com/fallrising/newclear/issues/{v}" for k, v in ISSUES.items()}}
    def update():
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    update()
    stopped = threading.Event()
    previous_handlers = {}
    g = None
    exit_code = 1
    try:
        binary = args.binary.resolve(strict=True)
        require(binary.is_file() and os.access(binary, os.X_OK), "binary_not_executable")
        report["binary_sha256"] = digest(binary)
        # This identifies the checkout only; it does not attest how the binary was built.
        revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=Path(__file__).parent,
            capture_output=True, text=True, timeout=5, check=False)
        report["source_checkout"] = revision.stdout.strip() if revision.returncode == 0 else None
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous_handlers[sig] = signal.signal(sig, lambda *_: stopped.set())
        resources = ExitStack()
        try:
            owned = resources.enter_context(tempfile.TemporaryDirectory(prefix="thinrouter-offline-"))
            fixture = resources.enter_context(Fixture())
            g = Gateway(binary, fixture, Path(owned))
            resources.callback(g.stop)
            run_journey(g, fixture, report, update)
            if args.serve:
                report["admin_url"] = f"http://127.0.0.1:{g.port}/admin"
                report["admin_token_file"] = str(g.directory / "admin-token")
                update()
                print(f'Demo ready: {report["admin_url"]}', flush=True)
                print(f'Admin token file (local synthetic only): {report["admin_token_file"]}', flush=True)
                print("Ctrl-C stops this demo and removes its temporary data.", flush=True)
                stopped.wait()
        finally:
            report["cleanup"] = "failed"
            resources.close()  # Attempts every owned cleanup even if an earlier callback fails.
            report["cleanup"] = "passed"
        exit_code = 0
    except JourneyFailure as error:
        report["journey_status"] = "failed"
        report["error_code"] = str(error)
    except Exception as error:
        report["journey_status"] = "failed"
        # Exception text can include request bodies/credentials. Only the class is safe.
        report["error_code"] = "unexpected_" + type(error).__name__
    finally:
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)
        update()
    print(f'{report["journey_status"].upper()} stage={report["stage"]}; report={report_path}', flush=True)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
