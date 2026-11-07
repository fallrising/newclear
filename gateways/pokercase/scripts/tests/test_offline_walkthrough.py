"""Failure guards for the offline journey, independent of a running gateway."""
import contextlib
import io
import json
import http.client
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import offline_walkthrough as walk


class WalkthroughTests(unittest.TestCase):
    @staticmethod
    def completed_stream_row():
        return {"id": 1, "ts": "2026-10-28T00:00:00Z", "public_model": "chat-stream", "connection_id": 1,
                "status": 200, "latency_ms": 2, "error": None,
                "prompt_tokens": 5, "completion_tokens": 3, "estimated_cost_usd": 2.0,
                "request_id": "synthetic-request", "attempt_id": "synthetic-attempt",
                "finalized_at": "2026-10-28T00:00:01Z", "upstream_model": "demo-text",
                "outcome": "succeeded", "usage_status": "complete", "usage_source": "openai_chat_v1",
                "headers_ms": 2, "first_output_ms": 3, "total_observed_ms": 20}

    def test_html_cost_summary_rejects_wrong_subtotal_with_correct_coverage(self):
        summary = {"status": "partial", "known_sum": 28.0, "known_count": 14, "total_count": 17}
        for amount in ("0", "280", "28.01"):
            raw = f'<strong>Partial estimate ${amount} · 14/17 rows</strong>'.encode()
            with self.subTest(amount=amount), self.assertRaisesRegex(
                    walk.JourneyFailure, "html_cost_reconciliation"):
                walk.require_html_cost_summary(raw, summary)
        for amount in ("28", "28.0", "28.00"):
            walk.require_html_cost_summary(
                f'<strong>Partial estimate ${amount} · 14/17 rows</strong>'.encode(), summary)

    def test_normal_stream_accounting_rejects_old_null_usage(self):
        for protocol in walk.ENDPOINTS:
            row = {"public_model": protocol + "-stream", "prompt_tokens": None,
                   "completion_tokens": None, "estimated_cost_usd": None}
            with self.subTest(protocol=protocol), self.assertRaisesRegex(
                    walk.JourneyFailure, "stream_usage_false_value"):
                walk.require_stream_accounting(row)

    def test_normal_stream_accounting_accepts_observed_upstream_usage(self):
        row = self.completed_stream_row()
        observed = walk.require_stream_accounting(row)
        self.assertEqual(observed["prompt_tokens"], 5)
        self.assertEqual(observed["completion_tokens"], 3)
        self.assertEqual(observed["estimated_cost_usd"], 2.0)
        self.assertEqual(observed["usage_source"], "openai_chat_v1")
        self.assertEqual(observed["attempt_id"], row["attempt_id"])
        self.assertEqual(observed["total_observed_ms"], 20)

    def test_normal_stream_accounting_accepts_submillisecond_observation(self):
        row = {**self.completed_stream_row(), "headers_ms": 0,
               "first_output_ms": 0, "total_observed_ms": 0}
        observed = walk.require_stream_accounting(row)
        self.assertEqual(observed["headers_ms"], 0)
        self.assertEqual(observed["first_output_ms"], 0)
        self.assertEqual(observed["total_observed_ms"], 0)

    def test_normal_stream_accounting_rejects_incomplete_metadata(self):
        for field, value, code in (
            ("prompt_tokens", 0, "stream_usage_false_value"),
            ("completion_tokens", 6, "stream_usage_false_value"),
            ("estimated_cost_usd", 4.0, "stream_usage_false_value"),
            ("outcome", "failed", "stream_accounting_terminal"),
            ("usage_status", "missing", "stream_accounting_terminal"),
            ("usage_source", "unknown", "stream_accounting_source"),
            ("request_id", None, "stream_accounting_identity"),
            ("attempt_id", "", "stream_accounting_identity"),
            ("finalized_at", None, "stream_accounting_identity"),
            ("headers_ms", -1, "stream_accounting_timing"),
            ("first_output_ms", None, "stream_accounting_timing"),
            ("first_output_ms", 21, "stream_accounting_timing"),
            ("total_observed_ms", 0, "stream_accounting_timing"),
        ):
            row = self.completed_stream_row()
            row[field] = value
            with self.subTest(field=field, value=value), self.assertRaisesRegex(walk.JourneyFailure, code):
                walk.require_stream_accounting(row)

    def test_csv_accounting_preserves_usage_and_attempt_metadata(self):
        original = self.completed_stream_row()
        exported = {key: "" if value is None else str(value) for key, value in original.items()}
        walk.require_csv_accounting(original, exported)
        for field, value, code in (
            ("prompt_tokens", "0", "csv_usage_reconciliation"),
            ("first_output_ms", "0", "csv_usage_reconciliation"),
            ("outcome", "unknown", "csv_metadata_reconciliation"),
            ("usage_source", "unknown", "csv_metadata_reconciliation"),
            ("attempt_id", "another-attempt", "csv_metadata_reconciliation"),
            ("finalized_at", "", "csv_metadata_reconciliation"),
        ):
            with self.subTest(field=field), self.assertRaisesRegex(walk.JourneyFailure, code):
                walk.require_csv_accounting(original, {**exported, field: value})
        unknown = {**original, "prompt_tokens": None, "completion_tokens": None,
                   "estimated_cost_usd": None, "first_output_ms": None,
                   "outcome": "cancelled", "usage_status": "missing"}
        walk.require_csv_accounting(unknown, {
            key: "" if value is None else str(value) for key, value in unknown.items()})

    def test_continuous_stream_cannot_extend_request_deadline(self):
        with tempfile.TemporaryDirectory() as directory, walk.Fixture() as fixture:
            gateway = walk.Gateway(Path(sys.executable), fixture, Path(directory))
            gateway.port = urlsplit(fixture.base_url).port
            gateway.key = fixture.api_key
            started = time.monotonic()
            with self.assertRaisesRegex(walk.JourneyFailure, "request_deadline"):
                gateway.request("POST", "/v1/chat/completions", walk.payload("chat", "demo-cancel", True), timeout=.15)
            self.assertLess(time.monotonic() - started, 2)

    def test_cleanup_failure_must_return_nonzero(self):
        class BrokenCleanup:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                raise RuntimeError("synthetic-sensitive-cleanup-detail")

        def passed(_gateway, _fixture, report, _update):
            report["journey_status"] = "passed"

        with tempfile.TemporaryDirectory() as directory, mock.patch.object(walk, "Fixture", BrokenCleanup), \
                mock.patch.object(walk, "run_journey", passed), contextlib.redirect_stdout(io.StringIO()) as output:
            result = walk.main(["--check", "--binary", sys.executable, "--output-dir", directory])
            report_text = next(Path(directory).glob("journey-*/report.json")).read_text()
            report = json.loads(report_text)
            self.assertEqual(result, 1)
            self.assertEqual(report["journey_status"], "failed")
            self.assertEqual(report["cleanup"], "failed")
            self.assertNotIn("synthetic-sensitive-cleanup-detail", report_text + output.getvalue())

    def test_transport_content_without_terminal_is_not_success(self):
        for protocol, event in (
            ("chat", {"choices": [{"delta": {"content": walk.TEXT}}]}),
            ("messages", {"type": "content_block_delta", "delta": {"text": walk.TEXT}}),
            ("responses", {"type": "response.output_text.delta", "delta": walk.TEXT}),
        ):
            with self.subTest(protocol=protocol), self.assertRaisesRegex(walk.JourneyFailure, "stream_terminal_missing"):
                walk.stream_text(protocol, ("data: " + json.dumps(event) + "\n\n").encode())

    def test_gateway_cleanup_exception_never_prints_command_credentials(self):
        detail = "synthetic-admin-credential-must-not-print"
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(walk, "Fixture", return_value=contextlib.nullcontext(object())), \
                mock.patch.object(walk, "run_journey"), \
                mock.patch.object(walk.Gateway, "stop", side_effect=subprocess.TimeoutExpired(["thinrouter", "--admin-token", detail], 5)), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            result = walk.main(["--check", "--binary", sys.executable, "--output-dir", directory])
            report_text = next(Path(directory).glob("journey-*/report.json")).read_text()
            self.assertEqual(result, 1)
            self.assertEqual(json.loads(report_text)["cleanup"], "failed")
            self.assertNotIn(detail, report_text + output.getvalue())

    def test_failed_response_terminal_cannot_be_completed(self):
        raw = b'data: {"type":"response.completed","response":{"status":"failed"}}\n\n'
        with self.assertRaisesRegex(walk.JourneyFailure, "stream_terminal"):
            walk.stream_text("responses", raw)

    def test_error_then_final_marker_is_not_terminal_success(self):
        streams = {
            "chat": [
                {"choices": [{"delta": {"content": walk.TEXT}, "finish_reason": "stop"}]},
                {"error": {"message": "synthetic-error"}}, "[DONE]"],
            "messages": [
                {"type": "content_block_delta", "delta": {"text": walk.TEXT}},
                {"type": "message_delta", "delta": {"stop_reason": "end_turn"}},
                {"type": "error", "error": {"message": "synthetic-error"}},
                {"type": "message_stop"}],
        }
        for protocol, events in streams.items():
            raw = "".join("data: " + (e if isinstance(e, str) else json.dumps(e)) + "\n\n" for e in events).encode()
            with self.subTest(protocol=protocol), self.assertRaises(walk.JourneyFailure):
                walk.stream_text(protocol, raw)

    def test_final_marker_requires_success_finish_reason(self):
        for protocol, events in (
            ("chat", [{"choices": [{"delta": {"content": walk.TEXT}, "finish_reason": "length"}]}, "[DONE]"]),
            ("messages", [{"type": "content_block_delta", "delta": {"text": walk.TEXT}}, {"type": "message_stop"}]),
        ):
            raw = "".join("data: " + (e if isinstance(e, str) else json.dumps(e)) + "\n\n" for e in events).encode()
            with self.subTest(protocol=protocol), self.assertRaises(walk.JourneyFailure):
                walk.stream_text(protocol, raw)

    def test_tool_is_fixed_local_add_not_arbitrary_execution(self):
        request = walk.tool_request("chat", "chat-tool")
        response = {"choices": [{"message": {"tool_calls": [{"id": "call_demo_add",
            "function": {"name": "shell", "arguments": '{"a":2,"b":3}'}}]}}]}
        with self.assertRaisesRegex(walk.JourneyFailure, "tool_contract"):
            walk.tool_reply("chat", request, response)

    def test_partial_cost_keeps_unknown_distinct_from_observed_zero(self):
        summary = walk.cost_summary([{"estimated_cost_usd": 0.0}, {"estimated_cost_usd": None}])
        self.assertEqual(summary["status"], "partial")
        self.assertEqual(summary["known_sum"], 0.0)
        self.assertEqual(summary["known_count"], 1)
        self.assertEqual(summary["unknown_count"], 1)
        self.assertIsNone(walk.cost_summary([])["known_sum"])
        with self.assertRaisesRegex(walk.JourneyFailure, "cost_nonfinite"):
            walk.cost_summary([{"estimated_cost_usd": float("nan")}])

    def test_invalid_binary_fails_safely_and_preserves_existing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            existing = parent / "report.json"
            existing.write_text("caller-owned")
            secret_path = parent / "do-not-print-synthetic-credential"
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                status = walk.main(["--check", "--binary", str(secret_path), "--output-dir", str(parent)])
            self.assertEqual(status, 1)
            self.assertEqual(existing.read_text(), "caller-owned")
            reports = list(parent.glob("journey-*/report.json"))
            self.assertEqual(len(reports), 1)
            report = json.loads(reports[0].read_text())
            self.assertEqual(report["journey_status"], "failed")
            self.assertEqual(report["error_code"], "unexpected_FileNotFoundError")
            self.assertNotIn(secret_path.name, output.getvalue() + reports[0].read_text())

    def test_serve_keeps_authenticated_admin_then_reaps_owned_gateway(self):
        product = Path(__file__).resolve().parents[2]
        target = Path(os.environ.get("CARGO_TARGET_DIR", product / "target"))
        binary = target / "debug" / "thinrouter"
        self.assertTrue(binary.is_file(), "build thinrouter with cargo +1.99.0 build --locked first")
        with tempfile.TemporaryDirectory() as directory:
            process = subprocess.Popen([sys.executable, str(product / "scripts/offline_walkthrough.py"),
                "--serve", "--binary", str(binary), "--output-dir", directory],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                deadline = time.monotonic() + 30
                report = {}
                while time.monotonic() < deadline:
                    self.assertIsNone(process.poll(), "serve exited before ready")
                    reports = list(Path(directory).glob("journey-*/report.json"))
                    if reports:
                        try:
                            report = json.loads(reports[0].read_text())
                        except json.JSONDecodeError:
                            continue
                    if "admin_url" in report:
                        break
                    time.sleep(.05)
                self.assertIn("admin_url", report)
                self.assertEqual(report["journey_status"], "passed")
                token_file = Path(report["admin_token_file"])
                token = token_file.read_text()
                endpoint = urlsplit(report["admin_url"])
                client = http.client.HTTPConnection(endpoint.hostname, endpoint.port, timeout=5)
                try:
                    client.request("GET", "/admin/usage", headers={"x-admin-token": token})
                    response = client.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertIn(b"All-time", response.read())
                finally:
                    client.close()
                process.send_signal(signal.SIGTERM)
                stdout, stderr = process.communicate(timeout=10)
                self.assertEqual(process.returncode, 0)
                self.assertNotIn(token, stdout + stderr + reports[0].read_text())
                self.assertFalse(token_file.parent.exists())
                self.assertEqual(json.loads(reports[0].read_text())["cleanup"], "passed")
                with socket.socket() as probe:
                    probe.settimeout(1)
                    self.assertNotEqual(probe.connect_ex((endpoint.hostname, endpoint.port)), 0)
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.communicate(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
