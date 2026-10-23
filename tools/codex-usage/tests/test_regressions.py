"""Offline regressions with an isolated fake CLI."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from test_codex_usage import m, P

class SchemaRegression(unittest.TestCase):
    def test_unknown_rates_are_partial(self):
        for payload in ({}, {"rateLimitsByLimitId": {}}, {"rateLimits": {}}, {"rateLimitsByLimitId": {"a": 7}}, {"rateLimits": {"primary": "bad"}}):
            with self.subTest(payload=payload):
                buckets, issues = m.normalize_rates(payload, 100)
                self.assertTrue(issues)
                self.assertFalse(buckets)

    def test_only_known_windows(self):
        buckets, _ = m.normalize_rates({"rateLimits": {"metadata": {"usedPercent": 99}, "primary": {"usedPercent": 20}}}, 100)
        self.assertEqual([w["name"] for w in buckets[0]["windows"]], ["primary"])

    def test_invalid_fields_keep_valid_data(self):
        buckets, issues = m.normalize_rates({"rateLimits": {"primary": {"usedPercent": "20", "resetsAt": 200, "windowDurationMins": True}}}, 100)
        self.assertTrue(issues)
        self.assertEqual(buckets[0]["windows"][0]["seconds_until_reset"], 100)
        self.assertIsNone(buckets[0]["windows"][0]["used_percent"])
        data, issues = m.normalize_usage({"summary": {"lifetimeTokens": 42, "peakDailyTokens": "bad"}})
        self.assertTrue(issues)
        self.assertEqual(data["summary"]["lifetimeTokens"], 42)
        self.assertIsNone(data["cycle_tokens"])

    def test_invalid_and_unknown_usage(self):
        for payload in ({}, {"surprise": 1}, {"summary": "bad"}, {"dailyUsageBuckets": [7]}, {"summary": {"lifetimeTokens": True}}, {"dailyUsageBuckets": [{"startDate": 7, "tokens": -1}]}):
            with self.subTest(payload=payload):
                _, issues = m.normalize_usage(payload)
                self.assertTrue(issues)

FAKE = '''#!{python}
import json, os, sys, time
cfg = {config}
if sys.argv[1:] == ["--version"]:
    print("fake-codex 0.0")
    raise SystemExit(0)
with open(cfg["pid"], "w") as f:
    f.write(str(os.getpid()))
count = 0
for line in sys.stdin:
    request = json.loads(line)
    method = request["method"]
    with open(cfg["log"], "a") as f:
        f.write(json.dumps(request) + "\\n")
    if method == "initialized":
        continue
    if cfg["mode"] == "timeout":
        time.sleep(30)
    if cfg["mode"] == "exit":
        raise SystemExit(3)
    if cfg["mode"] == "protocol":
        print("private invalid json", flush=True)
        continue
    if method == "initialize":
        value = {{}}
    elif method == "account/read":
        count += 1
        if count == 2 and cfg["mode"] == "final_error":
            print(json.dumps({{"id": request["id"], "error": {{"code": 401, "message": "private account data"}}}}), flush=True)
            continue
        email = "wrong@example.test" if count == 2 and cfg["mode"] == "mismatch" else "test@example.test"
        value = {{"account": {{"type": "chatgpt", "email": email}}}}
    elif method == "account/rateLimits/read":
        value = {{"rateLimits": {{"limitId": "codex", "primary": {{"usedPercent": 20, "resetsAt": 200}}}}}}
    elif method == "account/usage/read":
        value = {{}} if cfg["mode"] == "partial" else {{"summary": {{"lifetimeTokens": 12}}, "dailyUsageBuckets": []}}
    else:
        raise SystemExit("unexpected mutation or model call")
    print(json.dumps({{"id": request["id"], "result": value}}), flush=True)
'''

class FakeCLI(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.target = self.base / "target.json"
        self.target.write_text(json.dumps({"expected_email": "test@example.test", "use_current_cli_workspace": True}))
        self.cli = self.base / "fake-codex"

    def configure(self, mode="ok"):
        self.log = self.base / "requests.jsonl"
        self.pid = self.base / "pid"
        config = {"mode": mode, "log": str(self.log), "pid": str(self.pid)}
        self.cli.write_text(FAKE.format(python=sys.executable, config=repr(config)))
        self.cli.chmod(0o700)

    def run_cli(self, *extra):
        result = subprocess.run([sys.executable, str(P), "--codex", str(self.cli), "--target-file", str(self.target), *extra], capture_output=True, text=True, timeout=12)
        self.assertNotIn("Traceback", result.stderr)
        self.assertNotIn("private", result.stdout)
        return result, json.loads(result.stdout)

    def test_exact_read_only_sequence_and_cleanup(self):
        self.configure()
        result, data = self.run_cli()
        self.assertEqual(result.returncode, 0)
        requests = [json.loads(row) for row in self.log.read_text().splitlines()]
        methods = [request["method"] for request in requests]
        self.assertEqual(methods, ["initialize", "initialized", "account/read", "account/rateLimits/read", "account/usage/read", "account/read"])
        self.assertEqual(requests[2]["params"], {"refreshToken": False})
        self.assertEqual(requests[3]["params"], {})
        self.assertEqual(requests[4]["params"], {})
        self.assertEqual(requests[5]["params"], {"refreshToken": False})
        with self.assertRaises(ProcessLookupError):
            os.kill(int(self.pid.read_text()), 0)

    def test_partial_exit_two_retains_json(self):
        self.configure("partial")
        result, data = self.run_cli()
        self.assertEqual(result.returncode, 2)
        self.assertEqual(data["queries"]["usage"]["status"], "partial")
        self.assertTrue(data["quota_buckets"])

    def test_final_identity_failure_discards_account_data(self):
        for mode in ("mismatch", "final_error"):
            with self.subTest(mode=mode):
                self.configure(mode)
                result, data = self.run_cli()
                self.assertEqual(result.returncode, 1)
                for key in ("identity", "quota_buckets", "token_statistics"):
                    self.assertIsNone(data[key])
                self.assertEqual(data["queries"]["account"]["status"], "error")

    def test_process_protocol_timeout_failures(self):
        for mode in ("timeout", "exit", "protocol"):
            with self.subTest(mode=mode):
                self.configure(mode)
                result, data = self.run_cli("--timeout", "0.3")
                self.assertEqual(result.returncode, 1)
                self.assertTrue(data["errors"])
                with self.assertRaises(ProcessLookupError):
                    os.kill(int(self.pid.read_text()), 0)

    def test_invalid_target_files_are_json(self):
        self.configure()
        for content in (b"not-json", b'"wrong"', b'{"expected_email":""}', b'{"expected_email":"test@example.test","use_current_cli_workspace":"yes"}', b'\xff', b'x' * 65537):
            with self.subTest(content=content[:40]):
                self.target.write_bytes(content)
                result, data = self.run_cli()
                self.assertEqual(result.returncode, 1)
                self.assertEqual(data["errors"][0]["kind"], "target_file_invalid")

    def test_invalid_options_are_json(self):
        self.configure()
        for value in ("nan", "inf", "0", "-1", "999999999", "wrong"):
            with self.subTest(value=value):
                result, data = self.run_cli("--timeout", value)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(data["status"], "error")

    def test_broken_pipe_is_sanitized(self):
        self.configure()
        with mock.patch.object(m.RPC, "send", side_effect=BrokenPipeError("private")):
            data = m.collect(m.Options(str(self.cli), target_file=str(self.target)))
        self.assertEqual(data["status"], "error")
        self.assertEqual(data["errors"][0]["kind"], "process_write_failed")

class SchemaTyping(unittest.TestCase):
    def test_nullable_usage_fields_and_empty_summary_are_known(self):
        for summary in ({}, {"lifetimeTokens": None}):
            data, issues = m.normalize_usage({"summary": summary, "dailyUsageBuckets": None})
            self.assertEqual(issues, [])
            self.assertIsNone(data["source_updated_at"])
            self.assertIsNone(data["cycle_tokens"])

    def test_noninteger_percent_is_partial_and_null(self):
        buckets, issues = m.normalize_rates({"rateLimits": {"primary": {"usedPercent": 1.5}}}, 100)
        self.assertTrue(issues)
        self.assertIsNone(buckets[0]["windows"][0]["used_percent"])

    def test_invalid_bucket_metadata_is_partial(self):
        buckets, issues = m.normalize_rates({"rateLimits": {"limitId": 9, "limitName": True, "primary": {"usedPercent": 20}}}, 100)
        self.assertTrue(issues)
        self.assertIsNone(buckets[0]["bucket"])
        self.assertIsNone(buckets[0]["limit_name"])

    def test_unknown_summary_fields_are_partial(self):
        _, issues = m.normalize_usage({"summary": {"newUnsupportedTokens": 123}})
        self.assertTrue(issues)


@unittest.skipUnless(hasattr(os, "fork"), "POSIX process group cleanup")
class ProcessTreeCleanup(unittest.TestCase):
    def test_exited_parent_does_not_leave_running_descendant(self):
        import signal
        import time
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "survived"
            script = """import json, os, signal, sys, time
pid = os.fork()
if pid:
    print(json.dumps({"pid": pid}), flush=True)
else:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    time.sleep(2.5)
    open(sys.argv[1], "w").close()
    time.sleep(3)
"""
            rpc = m.RPC([sys.executable, "-c", script, str(marker)], os.environ.copy())
            try:
                child = rpc.recv(time.monotonic() + 2)["pid"]
                rpc.p.wait(timeout=2)
                rpc.close()
                time.sleep(2.6)
                self.assertFalse(marker.exists(), "descendant survived owned group cleanup")
            finally:
                try:
                    os.killpg(rpc.p.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                rpc.close()
