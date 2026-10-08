"""Offline harness contracts. These tests do not certify the upstream runtime."""

import hashlib
import copy
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import io
import os
import signal
from pathlib import Path
import socket
import socketserver
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lab
import cold_backup


class ColdRecoveryHarnessTests(unittest.TestCase):
    def test_restored_scope_cleanup_interrupts_blocking_remove(self):
        with tempfile.TemporaryDirectory() as directory:
            scope = lab.OwnedScope(Path(directory) / "restored", 8787)
            scope.create()
            restored = dict(scope.identity)
            original = {"device": restored["device"], "inode": restored["inode"] + 1}
            previous = signal.getsignal(signal.SIGALRM)
            started = time.monotonic()
            with patch.object(scope, "remove", side_effect=lambda **_: time.sleep(1)), \
                 patch("cold_backup.CLEANUP_SECONDS", 0.03):
                with self.assertRaises(cold_backup.CleanupDeadline):
                    lab.cleanup_scope(scope, True, original, restored)
            self.assertLess(time.monotonic() - started, 0.5)
            self.assertTrue(scope.path.is_dir())
            self.assertEqual(signal.getsignal(signal.SIGALRM), previous)
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def _source_for_archive(self, root):
        scope = lab.OwnedScope(root / "scope", 8787)
        scope.create()
        for relative in cold_backup.REQUIRED_FILES | set(cold_backup.LOCKS) | {
                cold_backup.DATA + "/d1/original/data.sqlite",
                cold_backup.DATA + "/objects/objects/original/object.ocobj"}:
            path = scope.path / relative
            if path.exists():
                continue
            pending, parent = [], path.parent
            while parent != scope.path and not parent.exists():
                pending.append(parent)
                parent = parent.parent
            for parent in reversed(pending):
                parent.mkdir(mode=0o700)
            lab.exclusive_file(path, b"synthetic-authority-" + relative.encode())
        return scope

    def test_later_package_corruption_cannot_delete_source_through_finally(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"RUNNER_TEMP": directory}):
            root = Path(directory)
            scope = self._source_for_archive(root)
            original_identity = dict(scope.identity)
            original_config = (scope.path / "ocd.toml").read_bytes()
            events = []
            def progress(event, _summary):
                events.append(event)
                if event == "backup_verified":
                    package = recovery.private.path / "payload.ocb"
                    package.write_bytes(package.read_bytes()[:-1])
            recovery = cold_backup.ColdRestore(scope, root / "cache", root / "report",
                                               time.monotonic() + 30, progress)
            with patch.object(scope, "remove", wraps=scope.remove) as remove:
                try:
                    with self.assertRaises(cold_backup.BackupError):
                        recovery.recover()
                finally:
                    outcome = lab.cleanup_scope(scope, True, original_identity, None)
                    cleanup = recovery.cleanup(processes_stopped=True)
                remove.assert_not_called()
            self.assertIn("backup_verified", events)
            self.assertNotIn("source_removed", events)
            self.assertTrue(outcome["source_preserved"])
            self.assertFalse(outcome["scope_removed"])
            self.assertTrue(all(cleanup.values()))
            self.assertEqual(scope.identity, original_identity)
            self.assertEqual((scope.path / "ocd.toml").read_bytes(), original_config)

    def test_finally_can_remove_only_transferred_restored_identity(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"RUNNER_TEMP": directory}):
            root = Path(directory)
            scope = self._source_for_archive(root)
            original_identity = dict(scope.identity)
            recovery = cold_backup.ColdRestore(scope, root / "cache", root / "report",
                                               time.monotonic() + 30, lambda *_: None)
            recovered = recovery.recover()
            self.assertNotEqual(recovered["restored_root"], original_identity)
            preserved = lab.cleanup_scope(scope, True, original_identity, {"device": 0, "inode": 0})
            self.assertTrue(preserved["scope_preserved"])
            self.assertFalse(preserved["source_preserved"])
            self.assertTrue(scope.path.is_dir())
            cleaned = lab.cleanup_scope(scope, True, original_identity, recovered["restored_root"])
            self.assertTrue(cleaned["scope_removed"])
            self.assertFalse(scope.path.exists())
            self.assertTrue(all(recovery.cleanup(True).values()))

    def test_readback_write_rejected_before_network(self):
        client = lab.ReadOnlyHTTP(8787, "synthetic-token")
        with patch.object(lab.LocalHTTP, "request", return_value={"ok": True}) as request:
            for method in ("POST", "PUT", "PATCH", "DELETE"):
                with self.subTest(method=method), self.assertRaisesRegex(lab.LabError, "prohibits"):
                    client.request(method, "/client/v4/accounts/test", {})
            request.assert_not_called()
            self.assertEqual(client.request("GET", "/health"), {"ok": True})
            self.assertEqual(client.read_requests, 1)

    def test_recovery_budget_interrupts_and_restores_alarm(self):
        previous = signal.getsignal(signal.SIGALRM)
        started = time.monotonic()
        with patch("lab.RECOVERY_TOTAL_TIMEOUT", 0.05):
            with self.assertRaisesRegex(lab.LabError, "total deadline"):
                with lab.recovery_deadline():
                    time.sleep(1)
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def test_private_backup_details_cannot_enter_public_summary(self):
        for detail in ({"manifest": []}, {"master_key_sha256": "a" * 64},
                       {"backup_path": "/private/synthetic"}, {"source_root": {"path": "/private"}}):
            with self.subTest(detail=detail), self.assertRaises(lab.LabError):
                lab.public_backup_summary(detail)

    def test_r2_byte_or_metadata_loss_fails_readback(self):
        payload, nonce = b"\x00\xff\r\n", "a" * 32
        observation = {"key": lab.R2_KEY, "bytes": list(payload), "size": len(payload),
                       "httpMetadata": lab.R2_HTTP_METADATA,
                       "customMetadata": {"purpose": "cold-restore", "nonce": nonce},
                       "headers": {"content-type": "application/octet-stream", "cache-control": "private, max-age=60",
                                   "content-disposition": 'attachment; filename="sentinel.bin"'},
                       "etag": "synthetic-etag", "httpEtag": '"synthetic-etag"', "version": "original",
                       "uploaded": "2026-10-08T00:00:00.000Z"}
        lab.assert_r2(observation, payload, nonce)
        for change in ({"bytes": [0, 255, 13, True]}, {"httpMetadata": {}}, {"customMetadata": {}},
                       {"headers": {}}, {"version": ""}):
            broken = copy.deepcopy(observation)
            broken.update(change)
            with self.subTest(change=change), self.assertRaises(lab.LabError):
                lab.assert_r2(broken, payload, nonce)

    def test_m2_bootstrap_failure_preserves_created_source(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            scope = home / ".open-compute"
            binary = home / "synthetic-binary"
            binary.write_bytes(b"not executed")
            args = SimpleNamespace(port=8787, cache=str(home / "cache"), output=str(home / "evidence"))
            stdout = io.StringIO()
            with patch("lab.pwd.getpwuid", return_value=SimpleNamespace(pw_dir=str(home))), \
                 patch("lab.source_commit", return_value=None), patch("lab.preflight", return_value=scope), \
                 patch("lab.download_binary", return_value=binary), patch("lab.command", return_value="ocd 0.2.4"), \
                 patch("lab.Process", side_effect=lab.LabError("synthetic bootstrap failure")), \
                 patch.object(lab.OwnedScope, "remove") as remove, redirect_stdout(stdout):
                self.assertEqual(lab.integration(args, restore=True), 1)
                remove.assert_not_called()
            report = json.loads(stdout.getvalue())
            self.assertTrue(report["source_preserved"])
            self.assertFalse(report["scope_removed"])
            self.assertEqual(report["acceptance"]["M2-04"], "not_run")
            self.assertTrue((scope / "ocd.toml").is_file())
            self.assertTrue((scope / "keys/admin.token").is_file())
            self.assertEqual((home / "evidence/report.json").read_text(), stdout.getvalue())


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

    def test_initial_artifact_url_requires_https_and_no_userinfo(self):
        for repository in ("http://github.com/elliothux/open-compute",
                           "https://user:password@github.com/elliothux/open-compute"):
            lock = json.loads((lab.HERE / "upstream.lock.json").read_text())
            lock["repository"] = repository
            lock["artifact"]["url"] = repository + "/releases/download/" + lock["release"] + "/" + lock["artifact"]["name"]
            with self.subTest(repository=repository), self.assertRaisesRegex(lab.LabError, "HTTPS"):
                lab.validate_lock(lock)

    def test_partial_collision_preserves_preexisting_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            partial = cache / "binary.partial-collision"
            partial.write_bytes(b"preserve-existing")
            response = Mock(status=200)
            opener = Mock()
            opener.open.return_value.__enter__ = Mock(return_value=response)
            opener.open.return_value.__exit__ = Mock(return_value=False)
            artifact = {"name": "binary", "url": "https://github.com/example/binary",
                        "bytes": 3, "sha256": hashlib.sha256(b"abc").hexdigest()}
            with patch("lab.urllib.request.build_opener", return_value=opener):
                with self.assertRaises(FileExistsError):
                    lab.download_binary(cache, artifact, "collision")
            self.assertEqual(partial.read_bytes(), b"preserve-existing")

    def test_download_total_deadline_covers_response_headers_and_restores_alarm(self):
        with tempfile.TemporaryDirectory() as directory:
            opener = Mock()
            opener.open.side_effect = lambda *_args, **_kwargs: time.sleep(1)
            artifact = {"name": "binary", "url": "https://github.com/example/binary",
                        "bytes": 3, "sha256": hashlib.sha256(b"abc").hexdigest()}
            previous = signal.getsignal(signal.SIGALRM)
            started = time.monotonic()
            with patch("lab.urllib.request.build_opener", return_value=opener), patch("lab.DOWNLOAD_TOTAL_TIMEOUT", 0.05):
                with self.assertRaisesRegex(lab.LabError, "total deadline"):
                    lab.download_binary(Path(directory), artifact, "deadline")
            self.assertLess(time.monotonic() - started, 0.5)
            self.assertEqual(signal.getsignal(signal.SIGALRM), previous)
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))


class OwnershipTests(unittest.TestCase):
    def test_artifact_paths_cannot_write_or_recreate_a_refused_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            scope = home / ".open-compute"
            scope.mkdir()
            sentinel = scope / "existing-data"
            sentinel.write_text("preserve-existing")
            alias = home / "alias"
            alias.symlink_to(scope, target_is_directory=True)
            variants = [(home / "cache", scope / "report"), (scope / "cache", home / "report"),
                        (home / "cache", alias / "report")]
            original = sorted(str(path.relative_to(home)) for path in home.rglob("*"))
            for cache, output in variants:
                stdout = io.StringIO()
                args = SimpleNamespace(port=8787, cache=str(cache), output=str(output))
                with self.subTest(cache=cache, output=output), \
                     patch("lab.pwd.getpwuid", return_value=SimpleNamespace(pw_dir=str(home))), \
                     patch("lab.source_commit", return_value=None), patch("lab.download_binary") as download, \
                     patch("lab.Process") as spawn, redirect_stdout(stdout):
                    self.assertEqual(lab.integration(args), 1)
                    download.assert_not_called()
                    spawn.assert_not_called()
                report = json.loads(stdout.getvalue())
                self.assertFalse(report["evidence_file_written"])
                self.assertEqual(report["result"], "failed")
                self.assertEqual(sentinel.read_text(), "preserve-existing")
                self.assertEqual(sorted(str(path.relative_to(home)) for path in home.rglob("*")), original)

    def test_existing_output_and_output_containing_cache_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "existing-output"
            output.mkdir()
            sentinel = output / "report.json"
            sentinel.write_text("preserve-existing")
            with self.assertRaisesRegex(lab.LabError, "already exists"):
                lab.validate_artifact_paths(root / "scope", root / "cache", output)
            self.assertEqual(sentinel.read_text(), "preserve-existing")
            new_output = root / "new-output"
            with self.assertRaisesRegex(lab.LabError, "contain"):
                lab.validate_artifact_paths(root / "scope", new_output / "cache", new_output)
            self.assertFalse(new_output.exists())

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

    def test_total_deadline_interrupts_trickling_headers_and_body(self):
        for phase in ("headers", "body"):
            class Handler(socketserver.BaseRequestHandler):
                def handle(self):
                    self.request.recv(4096)
                    try:
                        if phase == "headers":
                            self.request.sendall(b"HTTP/1.1 200 OK\r\nX-Slow: ")
                        else:
                            self.request.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n")
                        for _ in range(30):
                            self.request.sendall(b" ")
                            time.sleep(0.03)  # Always faster than inactivity timeout.
                    except OSError:
                        pass
            class Server(socketserver.ThreadingTCPServer):
                daemon_threads = True
            server = Server(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
            thread.start()
            started = time.monotonic()
            try:
                with self.subTest(phase=phase), patch("lab.HTTP_TOTAL_TIMEOUT", 0.15):
                    with self.assertRaisesRegex(lab.LabError, "total deadline"):
                        lab.LocalHTTP(server.server_address[1]).request("GET", "/probe")
                    self.assertLess(time.monotonic() - started, 0.8)
            finally:
                server.shutdown()
                thread.join(timeout=2)
                server.server_close()


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
    def test_namespace_mismatch_refuses_before_spawn(self):
        with patch("lab.proc_namespace_supported", return_value=False), patch("lab.subprocess.Popen") as spawn:
            with self.assertRaisesRegex(lab.LabError, "PID namespace"):
                lab.Process(["never-run"])
            spawn.assert_not_called()

    def test_missing_process_is_gone_but_unreadable_or_malformed_is_unknown(self):
        with patch.object(Path, "read_text", side_effect=FileNotFoundError):
            self.assertIsNone(lab.process_info(123))
            self.assertFalse(lab.same_process({"pid": 123, "start_ticks": 45}))
        for failure in (PermissionError("denied"), OSError("I/O failure")):
            with self.subTest(failure=type(failure).__name__), patch.object(Path, "read_text", side_effect=failure):
                with self.assertRaises(lab.ProcessObservationError):
                    lab.process_info(123)
        with patch.object(Path, "read_text", return_value="malformed"):
            with self.assertRaises(lab.ProcessObservationError):
                lab.process_info(123)

    def test_monitor_failure_is_propagated_to_foreground(self):
        process = lab.Process.__new__(lab.Process)
        process.done = Mock()
        process.done.wait.return_value = False
        process.observation_error = None
        process.snapshot = Mock(side_effect=lab.ProcessObservationError("unreadable process"))
        process._monitor()
        with self.assertRaisesRegex(lab.ProcessObservationError, "unreadable"):
            process.live()

    def test_unknown_identity_is_never_signaled(self):
        process = lab.Process.__new__(lab.Process)
        process.observation_error = None
        with patch("lab.same_process", side_effect=lab.ProcessObservationError("unknown")), patch("lab.os.kill") as kill:
            process.signal_owned({"pid": 123, "start_ticks": 45}, 15)
            kill.assert_not_called()
            self.assertEqual(process.observation_error, "unknown")

    def test_incomplete_reader_cannot_be_called_clean(self):
        process = lab.Process.__new__(lab.Process)
        process.done, process.monitor, process.reader = Mock(), Mock(), Mock()
        process.monitor.is_alive.return_value = False
        process.reader.is_alive.return_value = True
        process.observation_error = None
        process.finish_threads()
        with self.assertRaisesRegex(lab.ProcessObservationError, "did not finish"):
            process.live()

    def test_reader_error_cannot_be_called_clean(self):
        process = lab.Process.__new__(lab.Process)
        process.process = Mock()
        process.process.stdout.read1.side_effect = OSError("read failed")
        process.observation_error = None
        process._read()
        with self.assertRaisesRegex(lab.ProcessObservationError, "output read failed"):
            process.live()

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
