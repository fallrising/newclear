"""Offline harness contracts. These tests do not certify the upstream runtime."""

import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lab


class PinTests(unittest.TestCase):
    def test_checked_in_lock_is_complete(self):
        lock = json.loads((lab.HERE / "upstream.lock.json").read_text())
        lab.validate_lock(lock)
        self.assertEqual(lock["release"], "v0.2.4")
        self.assertEqual(lock["artifact"]["bytes"], 195537392)

    def test_modified_and_truncated_binary_fail_before_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "binary"
            file.write_bytes(b"original")
            pin = {"bytes": 8, "sha256": hashlib.sha256(b"original").hexdigest()}
            self.assertEqual(lab.verify_binary(file, pin), pin["sha256"])
            file.write_bytes(b"tampered")
            with self.assertRaisesRegex(lab.LabError, "SHA256"):
                lab.verify_binary(file, pin)
            file.write_bytes(b"short")
            with self.assertRaisesRegex(lab.LabError, "size"):
                lab.verify_binary(file, pin)

    def test_symlink_binary_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "binary"
            file.symlink_to("missing")
            with self.assertRaisesRegex(lab.LabError, "non-symlink"):
                lab.verify_binary(file, {"bytes": 1, "sha256": "x"})


class OwnershipTests(unittest.TestCase):
    def test_root_rejected_before_home_or_port(self):
        with patch("lab.platform.system", return_value="Linux"), \
             patch("lab.platform.machine", return_value="x86_64"), \
             patch("lab.os.geteuid", return_value=0), \
             patch("lab.pwd.getpwuid") as home:
            with self.assertRaisesRegex(lab.LabError, "non-root"):
                lab.preflight(8787)
            home.assert_not_called()

    def test_unsupported_platform_rejected(self):
        with patch("lab.platform.system", return_value="Darwin"):
            with self.assertRaisesRegex(lab.LabError, "Linux"):
                lab.preflight(8787)

    def test_existing_scope_and_dangling_symlink_are_never_adopted(self):
        with tempfile.TemporaryDirectory() as directory:
            scope = Path(directory) / "scope"
            scope.mkdir()
            original = scope / "user-data"
            original.write_text("keep")
            with self.assertRaises(FileExistsError):
                lab.OwnedScope(scope, 8787).create()
            self.assertEqual(original.read_text(), "keep")
            link = Path(directory) / "link"
            link.symlink_to("missing")
            with self.assertRaises(FileExistsError):
                lab.OwnedScope(link, 8787).create()
            self.assertTrue(link.is_symlink())

    def test_preflight_refuses_existing_scope_and_occupied_port(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch("lab.platform.system", return_value="Linux"), \
             patch("lab.platform.machine", return_value="x86_64"), \
             patch("lab.os.geteuid", return_value=1001), \
             patch("lab.os.getuid", return_value=1001), \
             patch("lab.pwd.getpwuid", return_value=SimpleNamespace(pw_dir=directory)), \
             patch("lab.os.access", return_value=True):
            original_stat = Path.stat
            def home_stat(path, *args, **kwargs):
                result = original_stat(path, *args, **kwargs)
                if str(path) == directory:
                    values = list(result)
                    values[4] = 1001
                    return os.stat_result(values)
                return result
            with patch.object(Path, "stat", home_stat):
                scope = Path(directory) / ".open-compute"
                scope.mkdir()
                with self.assertRaisesRegex(lab.LabError, "existing scope"):
                    lab.preflight(8787)
                scope.rmdir()
                with socket.socket() as occupied:
                    occupied.bind(("127.0.0.1", 0))
                    with self.assertRaisesRegex(lab.LabError, "unavailable"):
                        lab.preflight(occupied.getsockname()[1])

    def test_marker_and_live_process_guard_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            scope = lab.OwnedScope(Path(directory) / "scope", 8787)
            scope.create()
            self.assertEqual(scope.path.stat().st_mode & 0o777, 0o700)
            self.assertEqual((scope.path / "ocd.toml").stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(lab.LabError, "live"):
                scope.remove(False)
            marker = scope.path / lab.MARKER
            original = marker.read_text()
            marker.write_text("other owner")
            with self.assertRaisesRegex(lab.LabError, "marker"):
                scope.remove(True)
            marker.write_text(original)
            scope.remove(True)
            self.assertFalse(scope.path.exists())


class HTTPTests(unittest.TestCase):
    def test_endpoint_cannot_redirect_connections_or_headers(self):
        good = {"url": "http://m1-worker.example.localhost:8787/", "kind": "local_origin", "scope": "local_machine"}
        self.assertEqual(lab.worker_host(good, 8787), "m1-worker.example.localhost:8787")
        for url in ("https://m1.localhost:8787/", "http://evil.example:8787/",
                    "http://127.0.0.1:8787/", "http://m1.localhost:9999/",
                    "http://user:password@m1.localhost:8787/", "http://m1.localhost:8787/?key=value",
                    "http://m1.localhost:8787/route", "http://m1.localhost:8787/#fragment"):
            with self.subTest(url=url), self.assertRaises(lab.LabError):
                lab.worker_host(dict(good, url=url), 8787)

    def test_redirect_is_not_followed_and_worker_receives_no_token(self):
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.path, self.headers.get("Authorization")))
                if self.path == "/client/v4/redirect":
                    self.send_response(302)
                    self.send_header("Location", "http://example.invalid/credential-target")
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"{}")
            def log_message(self, *_args):
                pass
        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = lab.LocalHTTP(server.server_port, "test-credential")
            with self.assertRaisesRegex(lab.LabError, "redirects"):
                client.request("GET", "/client/v4/redirect")
            client.request("GET", "/health", host="m1.localhost")
            self.assertEqual(requests, [("/client/v4/redirect", "Bearer test-credential"), ("/health", None)])
            with self.assertRaisesRegex(lab.LabError, "restricted"):
                client.request("GET", "/outside-api")
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_artifact_redirect_to_http_or_unrelated_origin_refused(self):
        for url in ("http://github.com/file", "https://example.invalid/file"):
            with self.subTest(url=url), self.assertRaises(lab.LabError):
                lab.ArtifactRedirects().redirect_request(None, None, 302, "", {}, url)


class WorkflowTests(unittest.TestCase):
    def test_terminal_failure_does_not_wait_until_timeout(self):
        api = SimpleNamespace(v4=lambda *_: {"status": "errored", "error": {"name": "FixtureError"}})
        with self.assertRaisesRegex(lab.LabError, "errored"):
            lab.wait_workflow(api, "/fixture", "waiting")

    def test_polling_is_bounded(self):
        with patch("lab.time.monotonic", side_effect=[0, 0, 2]), patch("lab.time.sleep"):
            with self.assertRaisesRegex(lab.LabError, "deadline"):
                lab.poll(lambda: False, bool, 1, "probe")

    def test_replay_and_changed_nonce_cannot_pass(self):
        before = {"id": "job-one", "payload": "synthetic", "callback_count": 1,
                  "step_nonce": "nonce-one", "completed": 0}
        after = dict(before, completed=1)
        output = {"jobId": "job-one", "nonce": "nonce-one"}
        lab.assert_resume(before, before.copy(), after, output, "job-one")
        for changed in (dict(after, callback_count=2), dict(after, step_nonce="nonce-two"),
                        dict(after, completed=0), dict(after, id="different")):
            with self.subTest(changed=changed), self.assertRaises(lab.LabError):
                lab.assert_resume(before, before.copy(), changed, output, "job-one")
        with self.assertRaisesRegex(lab.LabError, "across restart"):
            lab.assert_resume(before, dict(before, callback_count=2), after, output, "job-one")


class DiagnosticsAndProcessTests(unittest.TestCase):
    def test_redaction_and_final_secret_scan(self):
        redactor = lab.Redactor()
        redactor.secrets = ["specific-test-secret"]
        raw = ("Authorization: Bearer unknown\nvalue=specific-test-secret\n"
               "configuration /home/operator/.open-compute/ocd.toml\n" + "x" * 64)
        cleaned = redactor.clean(raw)
        self.assertNotIn("specific-test-secret", cleaned)
        self.assertNotIn("unknown", cleaned)
        self.assertNotIn("/home/operator", cleaned)
        self.assertNotIn("x" * 64, cleaned)
        with self.assertRaisesRegex(lab.LabError, "secret scan"):
            redactor.check_report({"error": "specific-test-secret"})

    @unittest.skipUnless(lab.proc_namespace_supported(), "PID namespace is not observable through /proc; required on CI")
    def test_cli_output_is_bounded_and_nonzero_fails(self):
        value = lab.command([sys.executable, "-c", "print('x' * 100000)"])
        self.assertLessEqual(len(value.encode()), lab.LOG_LIMIT)
        with self.assertRaisesRegex(lab.LabError, "CLI command failed"):
            lab.command([sys.executable, "-c", "raise SystemExit(7)"])

    @unittest.skipUnless(lab.proc_namespace_supported(), "PID namespace is not observable through /proc; required on CI")
    def test_separate_process_group_child_is_observed_and_exits(self):
        code = (
            "import signal,subprocess,sys,time\n"
            "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'], start_new_session=True)\n"
            "def stop(*args):\n child.terminate(); child.wait(timeout=2); sys.exit(0)\n"
            "signal.signal(signal.SIGTERM,stop)\n"
            "print('ready',flush=True)\n"
            "time.sleep(30)\n"
        )
        process = lab.Process([sys.executable, "-c", code])
        try:
            deadline = time.monotonic() + 5
            while (not process.children() or "ready" not in process.text()) and time.monotonic() < deadline:
                time.sleep(0.05)
            children = process.children()
            self.assertTrue(children)
            self.assertTrue(any(child["pgid"] != process.identity["pgid"] for child in children))
            result = process.stop(grace=5)
            self.assertTrue(result["all_owned_exited"])
            self.assertFalse(result["forced"])
            self.assertEqual(result["exit_code"], 0)
        finally:
            if process.live():
                process.stop(grace=1)


if __name__ == "__main__":
    unittest.main()
