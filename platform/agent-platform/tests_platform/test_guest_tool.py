"""Real local socket and authenticated mailbox fixtures, without KVM claims."""

import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx

from agent_platform.guest_tool import Mailbox, local_server, receive, server

PAYLOAD = {"operation": "github.repository.get", "repository_id": 123}


class GuestToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.mailbox = Mailbox(self.temp.name, str(uuid4()), secrets.token_urlsafe(32), timeout=2)
        self.binding = {
            "instance_id": self.mailbox.instance_id,
            "run_id": self.mailbox.run_id,
            "binding_id": str(uuid4()),
            "generation": 1,
        }
        self.assertEqual(self.mailbox.bind(self.binding), (200, self.binding))
        self.path = self.temp.name + "/request.sock"
        self.local = local_server(self.mailbox, self.path, terminal_uid=os.getuid())
        self.http = server(self.mailbox, 0)
        for service in (self.local, self.http):
            threading.Thread(target=service.serve_forever, daemon=True).start()
            self.addCleanup(service.server_close)
            self.addCleanup(service.shutdown)
        self.client = httpx.Client(
            base_url=f"http://127.0.0.1:{self.http.server_port}",
            headers={"X-Session-API-Key": self.mailbox.relay_key},
            timeout=3,
        )
        self.addCleanup(self.client.close)
        self.addCleanup(lambda: self.mailbox.close(self.binding))

    def connect(self, payload=PAYLOAD):
        conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        conn.settimeout(3)
        conn.connect(self.path)
        conn.sendall(json.dumps(payload).encode() + b"\n")
        self.addCleanup(conn.close)
        return conn

    def pending(self):
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            status, value = self.mailbox.take()
            self.assertEqual(status, 200)
            if value["pending"]:
                return value["pending"]
            time.sleep(0.005)
        self.fail("request was not admitted")

    def response(self, pending):
        return {
            **self.binding,
            "operation_id": pending["operation_id"],
            "result": {"id": 123, "full_name": "example/project", "private": True},
            "receipt": "a" * 43,
        }

    def test_socket_result_requires_consumption_then_host_ack_without_replay(self):
        conn = self.connect()
        pending = self.pending()
        self.assertEqual(set(pending), set(self.binding) | {"operation_id", "payload"})
        response = self.response(pending)
        self.assertEqual(self.client.post("/response", json=response).status_code, 200)
        result = json.loads(conn.makefile("rb").readline())
        self.assertEqual(set(result), {"operation_id", "result"})
        self.assertNotIn("receipt", json.dumps(result))
        self.assertIsNone(self.mailbox.take()[1]["ack"])
        premature = {**self.binding, "operation_id": pending["operation_id"]}
        self.assertEqual(self.client.post("/ack", json=premature).status_code, 409)
        conn.sendall(json.dumps({"ack": pending["operation_id"]}).encode() + b"\n")
        deadline = time.monotonic() + 1
        while self.mailbox.take()[1]["ack"] is None and time.monotonic() < deadline:
            time.sleep(0.005)
        status, value = self.mailbox.take()
        self.assertEqual(status, 200)
        self.assertIsNone(value["pending"])
        self.assertEqual(value["ack"], {**premature, "receipt": response["receipt"]})
        self.assertEqual(self.client.post("/ack", json=premature).json(), {"accepted": True})
        self.assertEqual(self.client.post("/ack", json=premature).status_code, 409)
        duplicate = self.connect()
        self.assertEqual(json.loads(duplicate.recv(1024)), {"error": "tool_request_repeated"})

    def test_idle_restart_already_fails_closed_and_marker_is_private(self):
        restarted = Mailbox(self.temp.name, self.mailbox.run_id, self.mailbox.relay_key)
        self.assertEqual(restarted.take()[0], 409)
        self.assertNotEqual(restarted.instance_id, self.mailbox.instance_id)
        self.assertEqual(self.mailbox.path.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(self.mailbox.relay_key, self.mailbox.path.read_text())

    def test_reserved_fields_and_wrong_uid_cannot_create_operation(self):
        for payload in ({**PAYLOAD, "run_id": str(uuid4())}, {**PAYLOAD, "repository_id": True}):
            with self.subTest(payload=payload):
                conn = self.connect(payload)
                self.assertEqual(json.loads(conn.recv(1024)), {"error": "tool_request_invalid"})
                self.assertIsNone(self.mailbox.take()[1]["pending"])
        wrong = local_server(
            self.mailbox, self.temp.name + "/wrong.sock", terminal_uid=os.getuid() + 1
        )
        threading.Thread(target=wrong.serve_forever, daemon=True).start()
        self.addCleanup(wrong.server_close)
        self.addCleanup(wrong.shutdown)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(1)
            conn.connect(self.temp.name + "/wrong.sock")
            self.assertEqual(json.loads(conn.recv(1024)), {"error": "tool_identity_denied"})
        self.assertIsNone(self.mailbox.take()[1]["pending"])

    def test_lost_local_ack_blocks_channel_and_wipes_response(self):
        conn = self.connect()
        pending = self.pending()
        self.assertEqual(self.mailbox.deliver(self.response(pending))[0], 200)
        self.assertIn(b"result", conn.recv(4096))
        conn.close()
        deadline = time.monotonic() + 1
        while self.mailbox.take()[0] == 200 and time.monotonic() < deadline:
            time.sleep(0.005)
        self.assertEqual(self.mailbox.take()[0], 409)
        self.assertIsNone(self.mailbox.result)
        self.assertIsNone(self.mailbox.receipt)
        self.assertNotIn("example/project", self.mailbox.path.read_text())

    def test_identity_immutable_and_close_wakes_waiting_terminal(self):
        for field, value in (
            ("generation", 2),
            ("run_id", str(uuid4())),
            ("instance_id", str(uuid4())),
        ):
            with self.subTest(field=field):
                self.assertEqual(self.mailbox.bind({**self.binding, field: value})[0], 409)
        conn = self.connect()
        self.pending()
        self.assertEqual(self.client.post("/close", json=self.binding).json(), {"closed": True})
        self.assertEqual(json.loads(conn.recv(1024)), {"error": "tool_mailbox_closed"})

    def test_http_rejects_duplicate_keys_nonfinite_and_ambient_authority(self):
        for raw in (b'{"generation":1,"generation":2}', b'{"result":NaN}', b"[]"):
            with self.subTest(raw=raw):
                self.assertEqual(
                    self.client.post(
                        "/bind", content=raw, headers={"Content-Type": "application/json"}
                    ).status_code,
                    422,
                )
        for headers in (
            {"Origin": "https://example.test"},
            {"Cookie": "session=fixture"},
            {"Content-Encoding": "gzip"},
        ):
            self.assertEqual(self.client.get("/mailbox", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/mailbox?key=fixture").status_code, 403)
        self.assertEqual(
            self.client.get("/mailbox", headers={"X-Session-API-Key": "mp1_fixture"}).status_code,
            401,
        )

    def test_only_one_request_is_pending_and_timeout_permanently_closes(self):
        self.mailbox.timeout = 0.2
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = self.connect()
            self.pending()
            second = self.connect(
                {"operation": "github.issue.get", "repository_id": 123, "issue_number": 1}
            )
            self.assertEqual(json.loads(second.recv(1024)), {"error": "tool_mailbox_busy"})
            answer = pool.submit(first.recv, 1024).result(timeout=1)
        self.assertEqual(json.loads(answer), {"error": "tool_mailbox_closed"})
        self.assertEqual(self.mailbox.take()[0], 409)

    def test_persistence_failure_withholds_result_and_permanently_closes(self):
        conn = self.connect()
        pending = self.pending()
        with patch("agent_platform.guest_tool.os.replace", side_effect=OSError("fixture fault")):
            self.assertEqual(
                self.client.post("/response", json=self.response(pending)).status_code, 422
            )
        self.assertTrue(self.mailbox.blocked)
        self.assertIsNone(self.mailbox.result)
        self.assertIsNone(self.mailbox.receipt)
        self.assertEqual(json.loads(conn.recv(1024)), {"error": "tool_mailbox_closed"})

    def test_duplicate_delivery_and_cross_generation_do_not_release_another_result(self):
        conn = self.connect()
        pending = self.pending()
        response = self.response(pending)
        for key, value in (
            ("generation", 2),
            ("binding_id", str(uuid4())),
            ("instance_id", str(uuid4())),
        ):
            self.assertEqual(
                self.client.post("/response", json={**response, key: value}).status_code, 409
            )
            self.assertIsNone(self.mailbox.result)
        self.assertEqual(self.client.post("/response", json=response).status_code, 200)
        self.assertEqual(self.client.post("/response", json=response).status_code, 409)
        conn.close()

    def test_local_parser_and_maximum_size_reject_without_admission(self):
        values = [
            b'{"operation":"github.repository.get","repository_id":123,"repository_id":1}\n',
            b'{"operation":NaN}\n',
            b"x" * 32769 + b"\n",
        ]
        for raw in values:
            with (
                self.subTest(size=len(raw)),
                socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn,
            ):
                conn.settimeout(1)
                conn.connect(self.path)
                conn.sendall(raw)
                self.assertEqual(json.loads(conn.recv(1024)), {"error": "tool_request_invalid"})
                self.assertIsNone(self.mailbox.take()[1]["pending"])

    def test_four_stalled_connections_bound_local_handlers_without_queue(self):
        entered = threading.Event()
        count = 0
        lock = threading.Lock()

        def observed_receive(*args):
            nonlocal count
            with lock:
                count += 1
                if count == 4:
                    entered.set()
            return receive(*args)

        connections = []
        with patch("agent_platform.guest_tool.receive", side_effect=observed_receive):
            for _ in range(4):
                conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                conn.settimeout(1)
                conn.connect(self.path)
                connections.append(conn)
                self.addCleanup(conn.close)
            self.assertTrue(entered.wait(1))
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as excess:
                excess.settimeout(1)
                excess.connect(self.path)
                self.assertEqual(excess.recv(1024), b"")
            self.assertIsNone(self.mailbox.take()[1]["pending"])
            for conn in connections:
                conn.close()

    def test_partial_socket_frame_has_absolute_deadline_without_admission(self):
        self.mailbox.timeout = 0.1
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(1)
            conn.connect(self.path)
            conn.sendall(b'{"operation":')
            self.assertEqual(json.loads(conn.recv(1024)), {"error": "tool_request_invalid"})
        self.assertIsNone(self.mailbox.take()[1]["pending"])

    def test_marker_survives_abrupt_helper_process_exit(self):
        root = Path(self.temp.name) / "process"
        root.mkdir()
        source = str(Path(__file__).resolve().parents[1] / "src")
        code = """
import os, sys
sys.path.insert(0, sys.argv[1])
from agent_platform.guest_tool import Mailbox
Mailbox(sys.argv[2], sys.argv[3], sys.argv[4])
os._exit(17)
"""
        child = subprocess.run(
            [
                sys.executable,
                "-I",
                "-c",
                code,
                source,
                str(root),
                self.mailbox.run_id,
                "fixture-process-relay-key" * 2,
            ],
            capture_output=True,
            timeout=3,
        )
        self.assertEqual(child.returncode, 17)
        restarted = Mailbox(root, self.mailbox.run_id, "fixture-process-relay-key" * 2)
        self.assertEqual(restarted.take(), (409, {"error": "tool_mailbox_closed"}))
        self.assertEqual(child.stdout, b"")
        self.assertEqual(child.stderr, b"")

    def test_unsupported_http_method_returns_fixed_json_without_reflection(self):
        response = self.client.request("FIXTURE_PRIVATE_METHOD", "/mailbox")
        self.assertEqual(response.status_code, 501)
        self.assertEqual(response.json(), {"error": "tool_input_invalid"})

    def test_truncated_http_body_cannot_bind_or_mutate(self):
        payload = json.dumps(self.binding).encode()
        with socket.create_connection(self.http.server_address, timeout=1) as conn:
            conn.sendall(
                (
                    "POST /bind HTTP/1.0\r\nContent-Type: application/json\r\n"
                    + "X-Session-API-Key: "
                    + self.mailbox.relay_key
                    + "\r\nContent-Length: "
                    + str(len(payload) + 1)
                    + "\r\n\r\n"
                ).encode()
                + payload
            )
            conn.shutdown(socket.SHUT_WR)
            raw = bytearray()
            while chunk := conn.recv(4096):
                raw.extend(chunk)
        self.assertIn(b"422", raw.split(b"\r\n")[0])
        self.assertEqual(json.loads(raw.split(b"\r\n\r\n", 1)[1]), {"error": "tool_input_invalid"})
