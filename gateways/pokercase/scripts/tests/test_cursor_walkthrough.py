#!/usr/bin/env python3
"""Standard-library evidence and isolation checks; no provider or gateway required."""
import copy
import html
from types import SimpleNamespace
import json
import os
from pathlib import Path
import signal
import time
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cursor_walkthrough as journey
import cursor_fixture as fixture


def row():
    return {"usage_source": "cursor_cli_result_v1", "outcome": "succeeded",
            "request_id": "synthetic-request", "attempt_id": "synthetic-attempt", "finalized_at": "synthetic-time",
            "status": None, "headers_ms": None, "estimated_cost_usd": None,
            "cli_ready_ms": 1, "first_output_ms": 2, "total_observed_ms": 3,
            "prompt_tokens": None, "completion_tokens": 33, "usage_status": "partial",
            "reported_usage": dict(zip(journey.RAW_FIELDS, (9359, 33, 3328, 0)))}


class EvidenceTests(unittest.TestCase):
    def test_all_raw_fields_preserved_without_inferred_prompt(self):
        journey.require_cursor_row(row(), "succeeded", (9359, 33, 3328, 0), "partial", output=True)

    def test_manufactured_usage_and_timing_rejected(self):
        changes = ({"prompt_tokens": 9359}, {"estimated_cost_usd": 0}, {"status": 200},
                   {"headers_ms": 1}, {"usage_source": "openai_chat_v1"},
                   {"usage_status": "complete"}, {"outcome": "failed"},
                   {"cli_ready_ms": True}, {"first_output_ms": 5}, {"attempt_id": None},
                   {"completion_tokens": 0})
        for change in changes:
            with self.subTest(change=change):
                bad = row()
                bad.update(change)
                with self.assertRaises(journey.JourneyFailure):
                    journey.require_cursor_row(bad, "succeeded", (9359, 33, 3328, 0), "partial", output=True)

    def test_raw_buckets_never_added_or_zero_filled(self):
        for values in ((12687, 33, 3328, 0), (9359, 9000, 3328, 0), (9359, 33, 0, 0)):
            bad = row()
            bad["reported_usage"] = dict(zip(journey.RAW_FIELDS, values))
            with self.subTest(values=values), self.assertRaises(journey.JourneyFailure):
                journey.require_cursor_row(bad, "succeeded", (9359, 33, 3328, 0), "partial", output=True)

    def test_missing_invalid_and_output_independence(self):
        for values, quality in (((None, 7, None, None), "partial"), ((None, 7, None, None), "invalid"), ((None,) * 4, "missing")):
            observed = row()
            observed.update(completion_tokens=values[1], usage_status=quality,
                            reported_usage=dict(zip(journey.RAW_FIELDS, values)))
            journey.require_cursor_row(observed, "succeeded", values, quality, output=True)
            bad = copy.deepcopy(observed)
            bad["reported_usage"]["input_tokens"] = 0
            with self.assertRaises(journey.JourneyFailure):
                journey.require_cursor_row(bad, "succeeded", values, quality, output=True)

    def test_before_output_cancel_has_no_invented_ready_or_output(self):
        observed = row()
        observed.update(outcome="cancelled", completion_tokens=None, usage_status="missing",
                        cli_ready_ms=None, first_output_ms=None, reported_usage=None)
        journey.require_cursor_row(observed, "cancelled", (None,) * 4, "missing", output=False, ready=False)
        observed["first_output_ms"] = 0
        with self.assertRaises(journey.JourneyFailure):
            journey.require_cursor_row(observed, "cancelled", (None,) * 4, "missing", output=False, ready=False)

    def test_binary_digest_mismatch_prevents_all_launches(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(journey.subprocess, "Popen", side_effect=AssertionError("must not launch")):
                code = journey.main(["--binary", sys.executable, "--output-dir", directory,
                                     "--expected-binary-sha256", "0" * 64])
            self.assertEqual(code, 1)
            report = json.loads(next(Path(directory).glob("journey-*/report.json")).read_text())
            self.assertEqual(report["error_code"], "binary_digest_mismatch")
            self.assertEqual(report["stages"], [])
            self.assertEqual(report["mode"], "check")

    def test_unknown_exception_details_never_reach_report(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(journey, "digest", side_effect=RuntimeError("secret-request-canary")):
                self.assertEqual(journey.main(["--binary", sys.executable, "--output-dir", directory]), 1)
            raw = next(Path(directory).glob("journey-*/report.json")).read_text()
            self.assertNotIn("secret-request-canary", raw)
            self.assertIn("unexpected_RuntimeError", raw)


class FixtureSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        source = Path(fixture.__file__).read_text()
        for name in ("cursor-agent", "runtime"):
            path = self.root / name
            path.write_text("#!" + sys.executable + "\n" + source.split("\n", 1)[1])
            path.chmod(0o700)
        self.args = [fixture.RUNTIME_HOST, "run", "--read-only", "--pull=never", "--user", "1000:1000",
                     "--network", "bridge", "--entrypoint", str(self.root / "cursor-agent"), fixture.IMAGE,
                     "-p", "--model", "text", "--mode", "ask", "--sandbox", "disabled",
                     "--output-format", "stream-json", "--stream-partial-output", "synthetic-request-canary"]

    def test_runtime_cannot_execute_host_binary_relative_entry_or_unknown_model(self):
        for target in ("/usr/bin/python3", "cursor-agent"):
            args = list(self.args)
            args[args.index("--entrypoint") + 1] = target
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, "fixture_runtime_entrypoint"):
                fixture.runtime_command(self.root, args)
        args = list(self.args)
        args[args.index("--model") + 1] = "unapproved"
        with self.assertRaisesRegex(ValueError, "fixture_runtime_model"):
            fixture.runtime_command(self.root, args)

    def test_symlink_target_is_rejected(self):
        (self.root / "cursor-agent").unlink()
        (self.root / "cursor-agent").symlink_to(sys.executable)
        with self.assertRaisesRegex(ValueError, "fixture_runtime_entrypoint"):
            fixture.runtime_command(self.root, self.args)

    def test_missing_security_and_bind_mount_rejected(self):
        for flag in ("--read-only", "--pull=never", "--stream-partial-output"):
            args = [value for value in self.args if value != flag]
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                fixture.runtime_command(self.root, args)
        args = list(self.args)
        args[2:2] = ["--mount", "type=bind,source=/,target=/host"]
        with self.assertRaisesRegex(ValueError, "fixture_runtime_bind"):
            fixture.runtime_command(self.root, args)

    def test_unknown_runtime_command_does_not_spawn(self):
        with mock.patch.object(fixture.os, "execve", side_effect=AssertionError("must not execute")):
            for args in (["pull", fixture.IMAGE], ["rm", "-f"], ["rm", "-f", "a", "b"]):
                with self.subTest(args=args), self.assertRaises(ValueError):
                    fixture.runtime(self.root, args)

    def test_cleanup_only_accepts_exact_local_runtime_command(self):
        name = "thinrouter-cursor-12345678-1234-1234-1234-123456789abc"
        with mock.patch.object(fixture.os, "execve", side_effect=AssertionError("must not execute")):
            self.assertEqual(fixture.runtime(self.root, [fixture.RUNTIME_HOST, "rm", "-f", name]), 0)
            for args in ([fixture.RUNTIME_HOST, "rm", "-f", "unowned"],
                         ["--host=tcp://remote:2375", "rm", "-f", name],
                         [fixture.RUNTIME_HOST, "rm", "-f", name, "extra"]):
                with self.subTest(args=args), self.assertRaises(ValueError):
                    fixture.runtime(self.root, args)

    def test_fake_runtime_execs_only_owned_cli_and_trace_omits_prompt(self):
        result = subprocess.run([str(self.root / "runtime"), *self.args], capture_output=True,
                                text=True, timeout=5, env={"PATH": "/usr/bin:/bin", "HOST_SECRET_CANARY": "synthetic-secret"})
        self.assertEqual(result.returncode, 0, result.stderr)
        events = [json.loads(line) for line in result.stdout.splitlines()]
        first_result = next(event for event in events if event["type"] == "result")
        self.assertEqual(first_result["usage"], {"inputTokens": 9359, "outputTokens": 33,
                                               "cacheReadTokens": 3328, "cacheWriteTokens": 0})
        trace = (self.root / "trace.jsonl").read_text()
        self.assertNotIn("synthetic-request-canary", trace)
        self.assertNotIn("synthetic-secret", trace)
        rows = [json.loads(line) for line in trace.splitlines()]
        self.assertEqual([row["kind"] for row in rows], ["dispatch", "start", "terminal"])
        self.assertEqual(len({row["pid"] for row in rows}), 1)

    def test_hanging_fake_is_exact_runtime_pid_and_stops(self):
        args = list(self.args)
        args[args.index("--model") + 1] = "cancel_before"
        child = subprocess.Popen([str(self.root / "runtime"), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                path = self.root / "trace.jsonl"
                if path.exists() and '"kind": "waiting"' in path.read_text():
                    break
                time.sleep(.01)
            else:
                self.fail("fixture did not reach waiting phase")
            trace = [json.loads(line) for line in path.read_text().splitlines()]
            self.assertEqual({row["pid"] for row in trace}, {child.pid})
            child.terminate()
            out, err = child.communicate(timeout=3)
            self.assertEqual((out, err), (b"", b""))
            self.assertEqual(child.returncode, 0)
        finally:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=3)


class CleanupTests(unittest.TestCase):
    def test_refusal_connections_are_isolated_from_text_and_fallback(self):
        class SetupComplete(Exception):
            pass
        with tempfile.TemporaryDirectory() as root:
            gateway = mock.Mock(directory=Path(root))
            routes = {}
            counter = 0
            def api(method, path, body=None):
                nonlocal counter
                if path == "stats":
                    return dict.fromkeys(("connections", "routes", "api_keys", "usage_events"), 0)
                if path == "keys":
                    return {"secret": "synthetic-test-key"}
                if path == "connections/oauth/import":
                    counter += 1
                    return {"connection": {"id": str(counter)}}
                if path == "routes":
                    routes[body["public_model"]] = body["targets"]
                    return {}
                self.fail("unexpected setup API")
            gateway.api.side_effect = api
            gateway.request.return_value = (401, b"")
            gateway.infer.side_effect = SetupComplete
            report = {"stages": []}
            with self.assertRaises(SetupComplete):
                journey.run_journey(gateway, mock.Mock(), report, lambda: None)
            success_ids = {routes[p + "-text"][0]["connection_id"] for p in journey.ENDPOINTS}
            fallback_ids = {target["connection_id"] for target in routes["fallback"]}
            refusal_names = [p + "-refusal" for p in journey.ENDPOINTS] + ["image-refusal"]
            self.assertTrue(all(name in routes for name in refusal_names), "dedicated refusal routes required")
            refusal_ids = {routes[name][0]["connection_id"] for name in refusal_names}
            self.assertEqual(len(refusal_ids), 4)
            self.assertTrue(refusal_ids.isdisjoint(success_ids | fallback_ids))
            self.assertEqual(routes["fallback"][-1]["connection_id"], routes["chat-text"][0]["connection_id"])

    def test_source_hashes_include_transitive_imports(self):
        self.assertEqual(set(journey.SOURCE_FILES), {"cursor_walkthrough.py", "cursor_fixture.py",
            "claude_walkthrough.py", "claude_fixture.py", "offline_walkthrough.py", "offline_fixture.py"})
        self.assertTrue(all(Path(journey.__file__).with_name(name).is_file() for name in journey.SOURCE_FILES))

    def test_html_checks_raw_counter_and_unknown_prompt(self):
        observed = row()
        observed.update(ts="synthetic-ts", public_model="synthetic-model", connection_id="synthetic-connection", error=None)
        cells = journey.html_cells(observed)
        document = '<div aria-label="Recent usage table"><table><tr>' + ''.join('<td>' + html.escape(cell) + '</td>' for cell in cells) + '</tr></table></div>'
        journey.require_html_usage(document.encode(), [observed])
        for old, new in (("9359 / 33 / 3328 / 0", "12687 / 33 / 3328 / 0"), ("1 ms", "7 ms"), ("—/33", "9359/33")):
            with self.subTest(old=old), self.assertRaises(journey.JourneyFailure):
                journey.require_html_usage(document.replace(old, new).encode(), [observed])

    def test_pending_attempt_is_not_accepted(self):
        gateway = mock.Mock()
        gateway.api.return_value = {"data": [{"finalized_at": None}]}
        with mock.patch.object(journey.time, "monotonic", side_effect=[0, 0, 11]):
            with self.assertRaisesRegex(journey.JourneyFailure, "usage_settlement_timeout"):
                journey.wait_rows(gateway, 1)

    def test_diagnostics_never_copy_arbitrary_gateway_log(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / "out"
            output.mkdir()
            (root / "gateway.log").write_text("synthetic-secret arbitrary-request-text " + fixture.ERROR_CANARY)
            report = {}
            journey.preserve_evidence(SimpleNamespace(directory=root), output, report)
            self.assertEqual(report["diagnostic_artifacts"]["gateway_log"]["contents"], "not_retained")
            self.assertFalse((output / "gateway.log").exists())
            self.assertNotIn("synthetic-secret", json.dumps(report))

    def run_mock_main(self, serve=False, cleanup_fails=False):
        with tempfile.TemporaryDirectory() as temp:
            owned = []
            fake = mock.MagicMock()
            fake.__enter__.return_value = fake
            def gateway(binary, fixture, directory):
                owned.append(directory)
                result = mock.Mock(directory=directory, port=12345)
                if cleanup_fails:
                    result.stop.side_effect = journey.JourneyFailure("owned_process_cleanup")
                return result
            def completed(gateway, fixture, report, update):
                report["journey_status"] = "passed"
                report["stage"] = "verified"
                report["stages"] = [{"stage": name, "status": "passed"} for name in journey.STAGES]
            with mock.patch.object(journey, "Fixture", return_value=fake), mock.patch.object(journey, "CursorGateway", side_effect=gateway) as ctor, mock.patch.object(journey, "run_journey", side_effect=completed), mock.patch.object(journey.threading.Event, "wait", return_value=True) as wait:
                args = ["--binary", sys.executable, "--output-dir", temp]
                if serve:
                    args.append("--serve")
                code = journey.main(args)
                self.assertEqual(wait.call_count, 1 if serve else 0)
                self.assertEqual(ctor.call_count, 1)
            self.assertEqual(len(owned), 1)
            self.assertFalse(owned[0].exists())
            return code, json.loads(next(Path(temp).glob("journey-*/report.json")).read_text())

    def test_serve_waits_and_cleans_owned_directory(self):
        code, report = self.run_mock_main(serve=True)
        self.assertEqual(code, 0)
        self.assertEqual(report["cleanup"], "passed")
        self.assertEqual(report["mode"], "serve")

    def test_check_default_returns_after_verification(self):
        code, report = self.run_mock_main()
        self.assertEqual(code, 0)
        self.assertEqual(report["mode"], "check")
        self.assertEqual(report["cleanup"], "passed")

    def test_cleanup_failure_cannot_return_success(self):
        code, report = self.run_mock_main(serve=True, cleanup_fails=True)
        self.assertEqual(code, 1)
        self.assertEqual(report["cleanup"], "failed")
        self.assertEqual(report["journey_status"], "failed")
        self.assertEqual(report["error_code"], "owned_process_cleanup")


if __name__ == "__main__":
    unittest.main()
