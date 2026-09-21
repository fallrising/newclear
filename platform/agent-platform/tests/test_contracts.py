import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from websockets.sync.server import serve

from agent_platform_m0 import docker_smoke
from agent_platform_m0.contracts import REQUIRED_ROUTES
from agent_platform_m0.events import Journal
from agent_platform_m0.probe import Probe, validate_schema, wait_ready
from agent_platform_m0.relay import Relay
from agent_platform_m0.transport import HTTP, ProbeError, validate_origin


class OriginTests(unittest.TestCase):
    def test_rejects_cleartext_remote_or_ambiguous_origins(self):
        for origin in (
            "http://example.com",
            "http://localhost",
            "http://10.0.0.1",
            "https://u:p@example.com",
            "https://example.com/path",
            "https://example.com?q=x",
            "https://example.com#fragment",
            "https://example.com:0",
            "file:///tmp/x",
            "https://example.com:99999",
            "https://[::1",
        ):
            with self.subTest(origin=origin), self.assertRaises(ProbeError):
                validate_origin(origin)

    def test_accepts_explicit_loopback_or_tls(self):
        for origin in ("http://127.0.0.1:8000", "http://[::1]:8000", "https://server.example"):
            self.assertEqual(validate_origin(origin + "/"), origin)

    def test_rejects_header_injection(self):
        for token in ("", "secret\r\nInjected: true", "secret\x7f"):
            with self.assertRaisesRegex(ProbeError, "invalid_session_token"):
                HTTP("http://127.0.0.1", token)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        requests = self.requests

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                requests.append((self.path, self.headers.get("X-Session-API-Key")))
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "/should-not-receive-token")
                    self.end_headers()
                    return
                raw = b"secret-not-json" if self.path == "/malformed" else b'{"ok":true}'
                self.send_response(200)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.http = HTTP(self.origin, "private-token")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_redirect_does_not_forward_credentials(self):
        self.assertEqual(self.http.request("GET", "/redirect"), (302, None))
        self.assertEqual(self.requests, [("/redirect", "private-token")])

    def test_malformed_body_is_not_in_diagnostic(self):
        with self.assertRaisesRegex(ProbeError, "^invalid_json_response$"):
            self.http.request("GET", "/malformed")

    def test_unauthenticated_call_omits_token(self):
        self.assertEqual(self.http.request("GET", "/", auth=False), (200, {"ok": True}))
        self.assertEqual(self.requests, [("/", None)])

    def test_ignores_environment_proxy(self):
        with patch.dict(os.environ, {"http_proxy": "http://127.0.0.1:1", "no_proxy": ""}):
            self.assertEqual(HTTP(self.origin, "x").request("GET", "/")[0], 200)

    def test_loopback_relay_preserves_http(self):
        relay = Relay(("127.0.0.1", self.server.server_port))
        try:
            self.assertEqual(HTTP(relay.origin, "x").expect("GET", "/"), {"ok": True})
        finally:
            relay.close()

    def test_rejects_absolute_request_targets(self):
        for path in ("https://other.example", "//other.example"):
            with self.assertRaisesRegex(ProbeError, "invalid_request_path"):
                self.http.request("GET", path)
        self.assertEqual(self.requests, [])

    def test_websocket_redirect_is_rejected_before_auth(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Journal(Path(directory) / "events")
            probe = Probe(self.http, journal, {"checks": {}})
            # Route the WS handshake to the local HTTP redirect handler.
            probe.conversation_id = "unused"
            from websockets.datastructures import Headers
            from websockets.http11 import Response

            def redirect(connection, request):
                return Response(
                    302,
                    "Found",
                    Headers({"Location": self.origin.replace("http", "ws", 1) + "/target"}),
                )

            with serve(lambda ws: None, "127.0.0.1", 0, process_request=redirect) as server:
                thread = threading.Thread(target=server.serve_forever)
                thread.start()
                try:
                    probe.http = HTTP(
                        f"http://127.0.0.1:{server.socket.getsockname()[1]}", "private-token"
                    )
                    with self.assertRaisesRegex(ValueError, "cannot follow redirect"):
                        probe.replay([{"id": "event"}])
                    self.assertEqual(self.requests, [])
                finally:
                    server.shutdown()
                    thread.join()
                    journal.close()


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "events.sqlite3"
        self.journal = Journal(self.path)

    def tearDown(self):
        self.journal.close()
        self.directory.cleanup()

    def test_replay_is_idempotent_and_keeps_original_sequence(self):
        self.assertTrue(self.journal.append({"id": "first", "text": "private-prompt"}))
        self.assertTrue(self.journal.append({"id": "second"}))
        self.assertFalse(self.journal.append({"text": "private-prompt", "id": "first"}))
        self.assertEqual(
            self.journal.db.execute("SELECT seq, event_id FROM events").fetchall(),
            [(1, "first"), (2, "second")],
        )
        self.assertNotIn(b"private-prompt", self.path.read_bytes())
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_conflicting_duplicate_fails(self):
        self.journal.append({"id": "same", "text": "original"})
        with self.assertRaisesRegex(ProbeError, "event_id_payload_conflict"):
            self.journal.append({"id": "same", "text": "changed"})
        self.assertEqual(self.journal.count(), 1)

    def test_missing_id_fails(self):
        for event in ({}, {"id": None}, {"id": ""}, {"id": "x" * 257}):
            with self.assertRaisesRegex(ProbeError, "event_missing_stable_id"):
                self.journal.append(event)

    def test_refuses_existing_file_and_symlink(self):
        with self.assertRaises(FileExistsError):
            Journal(self.path)
        link = self.path.with_name("link")
        link.symlink_to(self.path)
        with self.assertRaises(FileExistsError):
            Journal(link)


class ContractTests(unittest.TestCase):
    def test_missing_route_or_method_blocks_schema(self):
        schema = {
            "paths": {path: dict.fromkeys(methods, {}) for path, methods in REQUIRED_ROUTES.items()}
        }
        self.assertEqual(len(validate_schema(schema)), 64)
        del schema["paths"]["/api/conversations/{conversation_id}"]["delete"]
        with self.assertRaisesRegex(ProbeError, "openapi_contract_mismatch"):
            validate_schema(schema)

    def test_readiness_has_deadline(self):
        with self.assertRaisesRegex(ProbeError, "ready_deadline_exceeded"):
            wait_ready(None, seconds=0)

    def test_pagination_cycle_fails(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(HTTP, "expect") as request:
            request.return_value = {"items": [], "next_page_id": "same"}
            journal = Journal(Path(directory) / "events")
            try:
                probe = Probe(HTTP("http://127.0.0.1", "token"), journal, {"checks": {}})
                with self.assertRaisesRegex(ProbeError, "event_pagination_cycle"):
                    probe.events()
            finally:
                journal.close()

    def test_websocket_auth_replay_snapshot_and_deduplication(self):
        frames = []
        event = {"id": "durable", "kind": "MessageEvent", "text": "fixture"}

        def handler(ws):
            frames.append(json.loads(ws.recv(timeout=2)))
            ws.send(
                json.dumps(
                    {
                        "id": "ephemeral",
                        "kind": "ConversationStateUpdateEvent",
                        "key": "full_state",
                        "value": {},
                    }
                )
            )
            ws.send(json.dumps(event))

        with tempfile.TemporaryDirectory() as directory, serve(handler, "127.0.0.1", 0) as server:
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            journal = Journal(Path(directory) / "events")
            try:
                report = {"checks": {}}
                http = HTTP(f"http://127.0.0.1:{server.socket.getsockname()[1]}", "fixture-token")
                probe = Probe(http, journal, report)
                probe.replay([event])
                probe.replay([event])
                self.assertEqual(journal.count(), 1)
                self.assertEqual(report["subscription_snapshots"], 2)
                self.assertEqual(frames, [{"type": "auth", "session_api_key": "fixture-token"}] * 2)
            finally:
                journal.close()
                server.shutdown()
                thread.join()


class CleanupTests(unittest.TestCase):
    def test_uncertain_container_creation_still_attempts_both_cleanups(self):
        calls = []

        def docker(*args, **kwargs):
            calls.append(args)
            if args[0] == "run":
                raise ProbeError("docker_command_unavailable_or_timeout")
            return ""

        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(docker_smoke, "docker", docker),
        ):
            output = Path(directory) / "probe"
            report = docker_smoke.run(output)
            self.assertFalse(report["docker_contract_passed"])
            self.assertFalse(report["full_m0_complete"])
            self.assertEqual(report["checks"]["owned_docker_resources_removed"], "passed")
            self.assertTrue(any(c[:2] == ("rm", "-f") for c in calls))
            self.assertTrue(any(c[:2] == ("network", "rm") for c in calls))
            self.assertEqual((output / "report.json").stat().st_mode & 0o777, 0o600)
            self.assertNotIn("SESSION_API_KEY", (output / "report.json").read_text())

    def test_cleanup_failure_cannot_pass(self):
        def docker(*args, **kwargs):
            if args[0] in {"run", "rm"}:
                raise ProbeError("fixture_failure")
            return ""

        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(docker_smoke, "docker", docker),
        ):
            report = docker_smoke.run(Path(directory) / "probe")
            self.assertFalse(report["docker_contract_passed"])
            self.assertEqual(report["checks"]["owned_docker_resources_removed"], "failed")
            self.assertIn("cleanup_resource_names", report)

    def test_interrupt_records_failure_and_cleans_up(self):
        calls = []

        def docker(*args, **kwargs):
            calls.append(args)
            if args[0] == "run":
                raise KeyboardInterrupt
            return ""

        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(docker_smoke, "docker", docker),
        ):
            report = docker_smoke.run(Path(directory) / "probe")
            self.assertFalse(report["docker_contract_passed"])
            self.assertEqual(report["error"], "KeyboardInterrupt")
            self.assertTrue(any(c[:2] == ("rm", "-f") for c in calls))

    def test_refuses_to_overwrite_reports(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(FileExistsError):
            docker_smoke.run(Path(directory))


if __name__ == "__main__":
    unittest.main()
