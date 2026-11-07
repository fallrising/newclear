#!/usr/bin/env python3
"""Headless existing named HTTP journey with isolated synthetic authentication."""
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
import tempfile
import threading
import time

from named_http_fixture import (BORROWED_NEW, BORROWED_OLD, ERROR_CANARY,
                                PROVIDERS, Fixture, TEXT, TOOL_TEXT)
from claude_walkthrough import require_html_usage, stream_tool, wait_rows
from offline_walkthrough import (ENDPOINTS, Gateway, JourneyFailure, cost_summary,
                                 digest, payload, request_deadline, require,
                                 require_csv_accounting, stream_text, tool_reply, tool_request)

STAGES = ("setup_auth_and_discovery", "chat_text_stream_tool", "messages_text_stream_tool",
          "responses_text_stream_tool", "fallback_and_borrowed_401", "failure_and_usage_quality",
          "downstream_cancel_and_timeout", "admin_usage_html_csv", "restart_and_reuse")
SOURCE_FILES = ("named_http_fixture.py", "named_http_walkthrough.py", "claude_walkthrough.py",
                "claude_fixture.py", "offline_walkthrough.py", "offline_fixture.py")


class NamedGateway(Gateway):
    def __init__(self, binary, fixture, directory):
        super().__init__(binary, fixture, directory)
        borrowed = directory / ".grok" / "auth.json"
        borrowed.parent.mkdir()
        borrowed.write_text(json.dumps({"synthetic": {"key": BORROWED_OLD}}))
        borrowed.chmod(0o600)
        fixture.borrowed_path = borrowed.resolve()

    def command_environment(self):
        # A wholly constructed child environment cannot inherit real credential or
        # proxy selectors. The fixture proxy itself has no forwarding capability.
        return {"PATH": "/usr/bin:/bin", "HOME": str(self.directory),
                "HTTP_PROXY": self.fixture.proxy_url, "HTTPS_PROXY": self.fixture.proxy_url,
                "ALL_PROXY": self.fixture.proxy_url, "RUST_LOG": "warn"}

    def start(self):
        require(set(self.fixture.base_urls) == set(PROVIDERS), "fixture_provider_scope")
        require(self.fixture.borrowed_path == (self.directory / ".grok" / "auth.json").resolve(),
                "fixture_borrowed_scope")
        with socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0))
            self.port = reserve.getsockname()[1]
        self.log = (self.directory / "gateway.log").open("ab")
        overrides = ",".join(f"{provider}={self.fixture.base_urls[provider]}" for provider in PROVIDERS)
        self.child = subprocess.Popen([str(self.binary), "serve", "--host", "127.0.0.1",
            "--port", str(self.port), "--data-dir", str(self.directory), "--admin-token", self.admin,
            "--sse-stall-secs", "5", "--provider-base-override", overrides],
            env=self.command_environment(), cwd=self.directory, stdin=subprocess.DEVNULL,
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


def connection_payload(fixture, provider, name, *, borrowed=False):
    require(provider in PROVIDERS and (not borrowed or provider == "grok"), "provider_scope")
    meta = {"client_id": "oaiapp_synthetic"} if provider == "siwc" else {}
    if borrowed:
        require(fixture.borrowed_path is not None and fixture.borrowed_path.is_absolute(), "borrowed_path")
        meta["source"] = str(fixture.borrowed_path)
    # Deliberately omit refresh_token and expires_at. Even a401 cannot refresh
    # these imports; borrowed Grok is additionally prohibited from refreshing.
    return {"name": "synthetic-" + name, "provider": provider,
            "access_token": fixture.api_key, "base_url": fixture.base_urls[provider],
            "default_model": "text", "meta": json.dumps(meta)}


def require_http_row(row, provider, outcome="succeeded", counts=(11, 7), quality="complete",
                     status=200, output=True):
    source = "openai_chat_v1" if provider == "opencode" else "openai_responses_v1"
    require(row.get("usage_source") == source, "http_usage_source")
    require(row.get("outcome") == outcome, "http_usage_outcome")
    require(row.get("usage_status") == quality, "http_usage_quality")
    values = (row.get("prompt_tokens"), row.get("completion_tokens"))
    require(values == counts and all(value is None or type(value) is int for value in values),
            "http_raw_usage")
    require(row.get("estimated_cost_usd") is None, "subscription_cost_unknown")
    require(row.get("status") == status and row.get("cli_ready_ms") is None, "http_transport_status")
    for field in ("request_id", "attempt_id", "finalized_at"):
        require(isinstance(row.get(field), str) and bool(row[field].strip()), "http_usage_identity")
    headers, first, total = (row.get(field) for field in ("headers_ms", "first_output_ms", "total_observed_ms"))
    require(type(headers) is int and type(total) is int and 0 <= headers <= total < 60000,
            "http_observed_times")
    require((type(first) is int and headers <= first <= total) if output else first is None,
            "http_first_output_time")
    if outcome == "succeeded" and quality in ("complete", "partial", "missing"):
        require(row.get("error") is None, "http_success_error")


def run_journey(g, fixture, report, update):
    expected, connections = {}, {}

    def stage(name, action):
        report["stage"] = name
        update()
        action()
        report["stages"].append({"stage": name, "status": "passed"})
        print("PASS " + name, flush=True)
        update()

    def connection(provider, name, borrowed=False):
        return g.api("POST", "connections/oauth/import",
                     connection_payload(fixture, provider, name, borrowed=borrowed))["connection"]["id"]

    def route(name, provider, model="text", conn=None):
        g.api("POST", "routes", {"public_model": name, "targets": [{
            "connection_id": conn or connections[provider], "model_override": model}]})

    def want(name, provider, outcome="succeeded", counts=(11, 7), quality="complete", status=200, output=True):
        expected.setdefault(name, []).append((provider, outcome, counts, quality, status, output))

    def setup():
        g.start()
        require(all(g.api("GET", "stats")[key] == 0 for key in ("connections", "routes", "api_keys", "usage_events")), "fresh_store")
        require(g.request("GET", "/admin/api/stats", auth=False)[0] == 401, "admin_auth")
        require(g.request("POST", ENDPOINTS["chat"], payload("chat", "missing", True), auth=False)[0] == 401, "gateway_auth")
        require(not fixture.snapshot(), "auth_dispatched")
        g.key = g.api("POST", "keys", {"name": "synthetic-named-http"})["secret"]
        for provider in PROVIDERS:
            connections[provider] = connection(provider, provider)
            code, raw = g.request("POST", f"/admin/api/connections/{connections[provider]}/test", admin=True)
            require(code == 200 and json.loads(raw)["ok"] is True, "fake_discovery")
            for protocol in ENDPOINTS:
                for model in ("text", "tool"):
                    route(f"{provider}-{protocol}-{model}", provider, model)
        require(len([event for event in fixture.snapshot() if event["kind"] == "discovery"]) == 3 and not fixture.inference(), "discovery_not_inference")
        require(g.api("GET", "usage")["data"] == [], "discovery_not_usage")
        # HTTP failures cool only their dedicated connection; no fixture-order dependency.
        route("failure", "opencode", "failure", connection("opencode", "failure"))
        for model in ("failed_stream", "truncated", "missing", "partial", "zero", "invalid", "cancel", "stall"):
            route(model, "siwc", model, connection("siwc", model))
        route("borrowed", "grok", "borrowed", connection("grok", "borrowed", borrowed=True))
        g.api("POST", "routes", {"public_model": "fallback", "strategy": "fallback", "targets": [
            {"connection_id": connection("opencode", "retry"), "model_override": "retry"},
            {"connection_id": connections["siwc"], "model_override": "text"}]})
    stage(STAGES[0], setup)

    for protocol in ENDPOINTS:
        def exercise(protocol=protocol):
            for provider in PROVIDERS:
                before = len(fixture.inference())
                name = f"{provider}-{protocol}-text"
                require(stream_text(protocol, g.infer(protocol, payload(protocol, name, True))) == TEXT, "text_content")
                want(name, provider)
                name = f"{provider}-{protocol}-tool"
                request = tool_request(protocol, name)
                request["stream"] = True
                result = stream_tool(protocol, g.infer(protocol, request))
                followup = tool_reply(protocol, request, result)
                followup["stream"] = True
                require(stream_text(protocol, g.infer(protocol, followup)) == TOOL_TEXT, "tool_result_content")
                want(name, provider)
                want(name, provider)
                events = fixture.inference()[before:]
                require(len(events) == 3 and [event["tool_phase"] for event in events] == ["none", "call", "result"], "tool_dispatch_contract")
        stage(protocol + "_text_stream_tool", exercise)

    def retry():
        before = len(fixture.inference())
        require(stream_text("messages", g.infer("messages", payload("messages", "fallback", True))) == TEXT, "fallback_content")
        events = fixture.inference()[before:]
        require([(event["provider"], event["status"]) for event in events] == [("opencode", 429), ("siwc", 200)], "fallback_order")
        want("fallback", "opencode", "failed", (None, None), "missing", 429, False)
        want("fallback", "siwc")
        before = len(fixture.inference())
        require(stream_text("responses", g.infer("responses", payload("responses", "borrowed", True))) == TEXT, "borrowed_content")
        events = fixture.inference()[before:]
        require([event["status"] for event in events] == [401, 200], "borrowed_retry_once")
        require(json.loads(fixture.borrowed_path.read_text()) == {"synthetic": {"key": BORROWED_NEW}}, "borrowed_file_preserved")
        report["borrowed_file_sha256_after_fixture_rotation"] = digest(fixture.borrowed_path)
        want("borrowed", "grok", "failed", (None, None), "missing", 401, False)
        want("borrowed", "grok")
    stage(STAGES[4], retry)

    def failure():
        require(ERROR_CANARY.encode() in g.infer("chat", payload("chat", "failure", True), 400), "caller_error_contract")
        want("failure", "opencode", "failed", (None, None), "missing", 400, False)
        for model, counts, quality in (("failed_stream", (11, 7), "complete"), ("truncated", (None, None), "missing")):
            raw = g.infer("responses", payload("responses", model, True))
            events = [json.loads(line[5:]) for line in raw.decode().splitlines() if line.startswith("data:")]
            require(events and events[-1].get("type") in ("response.failed", "error"), "failed_stream_terminal")
            require(not any(event.get("type") == "response.completed" for event in events), "failed_stream_false_success")
            want(model, "siwc", "failed", counts, quality)
        for model, counts, quality in (("missing", (None, None), "missing"), ("partial", (None, 7), "partial"),
                                      ("zero", (0, 0), "complete"), ("invalid", (None, 7), "invalid")):
            require(stream_text("messages", g.infer("messages", payload("messages", model, True))) == TEXT, "quality_content")
            want(model, "siwc", counts=counts, quality=quality)
    stage(STAGES[5], failure)

    def cancellation():
        with request_deadline(10):
            conn, response = g.open("POST", ENDPOINTS["chat"], payload("chat", "cancel", True))
            try:
                require(response.status == 200, "cancel_started")
                require(any(TEXT.encode() in response.readline(8192) for _ in range(20)), "cancel_first_output")
            finally:
                response.close()
                conn.close()
        require(fixture.wait_closed("cancel"), "cancel_upstream_not_closed")
        want("cancel", "siwc", "cancelled", (None, None), "missing")
        code, raw = g.request("POST", ENDPOINTS["responses"], payload("responses", "stall", True), timeout=12)
        require(code == 200 and b"upstream_stream_timeout" in raw, "timeout_wire")
        require(fixture.wait_closed("stall"), "timeout_upstream_not_closed")
        want("stall", "siwc", "timeout", (None, None), "missing")
        require(g.request("GET", "/health", auth=False)[0] == 200, "health_after_cancel")
    stage(STAGES[6], cancellation)

    def inspect():
        before = len(fixture.inference())
        rows = wait_rows(g, sum(map(len, expected.values())))
        require(len(rows) == before and len({row["attempt_id"] for row in rows}) == len(rows), "attempt_dispatch_reconciliation")
        for name, wants in expected.items():
            actual = sorted((row for row in rows if row["public_model"] == name), key=lambda row: row["id"])
            require(len(actual) == len(wants), "route_row_count")
            for row, values in zip(actual, wants):
                require_http_row(row, *values)
        for name in ("fallback", "borrowed"):
            group = [row for row in rows if row["public_model"] == name]
            require(len(group) == 2 and len({row["request_id"] for row in group}) == 1 and len({row["attempt_id"] for row in group}) == 2,
                    "retry_attempt_identity")
        require(len({row["request_id"] for row in rows}) == len(rows) - 2, "independent_request_identity")
        summary, stats = cost_summary(rows), g.api("GET", "stats")
        require(stats["usage_events"] == len(rows) and stats["cost_summary"] == summary, "stats_reconciliation")
        require(summary["status"] == "unknown" and summary["known_sum"] is None and stats["estimated_cost_usd"] is None, "all_cost_unknown")
        for day in g.api("GET", "usage/daily")["data"]:
            require(day["cost_summary"] == cost_summary([row for row in rows if row["ts"].startswith(day["day"])]), "daily_reconciliation")
        surfaces = [json.dumps(rows)]
        for path in ("/admin", "/admin/usage"):
            code, raw = g.request("GET", path, admin=True)
            require(code == 200 and b"All-time" in raw, "admin_html")
            require(f"Unknown · 0/{len(rows)} rows".encode() in raw, "admin_unknown_cost")
            if path == "/admin/usage":
                require_html_usage(raw, rows)
            surfaces.append(raw.decode())
        code, raw = g.request("GET", "/admin/api/usage/export.csv", admin=True)
        require(code == 200, "csv_status")
        exported = list(csv.DictReader(io.StringIO(raw.decode())))
        by_id = {str(row["id"]): row for row in rows}
        require(len(exported) == len(rows) and {row["id"] for row in exported} == set(by_id), "csv_row_identity")
        for row in exported:
            require_csv_accounting(by_id[row["id"]], row)
        surfaces += [raw.decode(), (g.directory / "gateway.log").read_text()]
        for sensitive in (ERROR_CANARY, g.admin, g.key, fixture.api_key, BORROWED_OLD, BORROWED_NEW, "synthetic greeting"):
            require(not any(sensitive in surface for surface in surfaces), "sensitive_persistence")
        require(len(fixture.inference()) == before, "admin_read_dispatched")
        report["usage"] = {"rows": len(rows), "cost_summary": summary, "attempts": rows,
                           "basis": "synthetic raw HTTP observations; subscription billing unknown"}
        return rows
    stage(STAGES[7], inspect)

    def restart():
        previous = g.api("GET", "usage")["data"]
        config = {key: g.api("GET", key) for key in ("connections", "routes", "keys")}
        borrowed_hash = digest(fixture.borrowed_path)
        g.stop()
        g.start()
        require(g.api("GET", "usage")["data"] == previous, "restart_history")
        require({key: g.api("GET", key) for key in config} == config, "restart_config")
        name = "opencode-chat-text"
        require(stream_text("chat", g.infer("chat", payload("chat", name, True))) == TEXT, "restart_content")
        want(name, "opencode")
        inspect()
        require(digest(fixture.borrowed_path) == borrowed_hash, "gateway_modified_borrowed_file")
        report["reuse"] = {"restart_history_preserved": True, "configuration_reused": True,
                           "new_request_after_restart": True, "pending_recovery": "covered_by_separate_storage_tests"}
    stage(STAGES[8], restart)
    require(tuple(item["stage"] for item in report["stages"]) == STAGES, "stage_coverage")
    require(fixture.denied_count == 0, "unexpected_egress_attempt")
    report["isolation"] = {"proxy_denied_requests": fixture.denied_count, "refresh_requests": 0,
        "discovery_requests": 3, "inference_requests": len(fixture.inference()),
        "refresh_evidence": "separate test-only injected transport tests; this binary journey has no refresh token",
        "network_boundary": "exact owned loopback URLs; non-forwarding proxy rejects all other destinations"}
    report["fixture_trace"] = fixture.snapshot()
    report["stage"], report["journey_status"] = "verified", "passed"
    update()


def preserve_evidence(gateway, fixture, output, report):
    trace = output / "fixture-trace.json"
    trace.write_text(json.dumps(fixture.snapshot(), indent=2) + "\n")
    artifacts = {"trace": {"path": trace.name, "sha256": digest(trace)}}
    log = gateway.directory / "gateway.log"
    if log.exists():
        artifacts["gateway_log"] = {"bytes": log.stat().st_size, "sha256": digest(log), "contents": "not_retained"}
    report["diagnostic_artifacts"] = artifacts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="default: verify and clean owned resources")
    mode.add_argument("--serve", action="store_true", help="verify then retain the disposable admin demo")
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("named-http-offline-results"))
    parser.add_argument("--expected-binary-sha256", help="reject executable drift before launch")
    args = parser.parse_args(argv)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="journey-", dir=args.output_dir.resolve()))
    report_path = output / "report.json"
    report = {"synthetic": True, "journey_status": "running", "stage": "binary", "stages": [],
              "mode": "serve" if args.serve else "check", "cleanup": "not_started",
              "actual_cost_usd": None, "live_client_version_provider_verified": False}
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
            owned = resources.enter_context(tempfile.TemporaryDirectory(prefix="thinrouter-named-http-offline-"))
            fixture = resources.enter_context(Fixture())
            g = NamedGateway(binary, fixture, Path(owned))
            resources.callback(preserve_evidence, g, fixture, output, report)
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
        report["journey_status"], report["error_code"] = "failed", str(error)
    except Exception as error:
        report["journey_status"], report["error_code"] = "failed", "unexpected_" + type(error).__name__
    finally:
        for sig, handler in handlers.items():
            signal.signal(sig, handler)
        update()
    print(f"{'PASSED' if exit_code == 0 else 'FAILED'} stage={report['stage']}; report={report_path}", flush=True)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
