"""Standalone terminal adapter parsing and same-socket consumption ACK."""

import json
import socket
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from agent_platform.guest_tool import Mailbox, local_server
from agent_platform.guest_tool_client import ToolError, call, main

PAYLOAD = {"operation": "github.repository.get", "repository_id": 123}


class ToolClientTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = self.temp.name + "/request.sock"

    def fixture(self, response):
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(self.path)
        listener.listen(1)
        listener.settimeout(2)
        self.addCleanup(listener.close)
        seen = []

        def serve():
            with listener.accept()[0] as conn:
                conn.settimeout(1)
                seen.append(json.loads(conn.recv(32768)))
                try:
                    conn.sendall(response)
                    seen.append(conn.recv(1024))
                except OSError:
                    seen.append(b"")

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        self.addCleanup(lambda: thread.join(2))
        return seen, thread

    def test_success_returns_result_only_and_acknowledges_on_original_socket(self):
        identity = str(uuid4())
        result = {"id": 123, "full_name": "fixture/project", "private": True}
        seen, thread = self.fixture(
            json.dumps({"operation_id": identity, "result": result}).encode() + b"\n"
        )
        self.assertEqual(call(PAYLOAD, path=self.path), result)
        thread.join(1)
        self.assertEqual(
            seen, [PAYLOAD, json.dumps({"ack": identity}, separators=(",", ":")).encode() + b"\n"]
        )

    def test_invalid_results_never_send_ack_or_reflect_raw_error(self):
        invalid = [
            b'{"error":"fixture-secret-do-not-reflect"}\n',
            b'{"operation_id":"bad","result":{}}\n',
            ('{"operation_id":"' + str(uuid4()) + '","result":{},"receipt":"secret"}\n').encode(),
            ('{"operation_id":"' + str(uuid4()) + '","result":{"x":NaN}}\n').encode(),
            ('{"operation_id":"' + str(uuid4()) + '","result":{},"result":{}}\n').encode(),
            b"x" * (1048576 + 129),
        ]
        for raw in invalid:
            with self.subTest(length=len(raw)):
                seen, thread = self.fixture(raw)
                with self.assertRaisesRegex(ToolError, "^tool_transport_unavailable$"):
                    call(PAYLOAD, path=self.path)
                thread.join(2)
                self.assertEqual(seen[-1], b"")
                Path(self.path).unlink()

    def test_real_mailbox_client_hides_receipt_and_confirms_consumption(self):
        import os

        mailbox = Mailbox(self.temp.name, str(uuid4()), "fixture-relay-key" * 3)
        binding = {
            "instance_id": mailbox.instance_id,
            "run_id": mailbox.run_id,
            "binding_id": str(uuid4()),
            "generation": 1,
        }
        mailbox.bind(binding)
        listener = local_server(mailbox, self.path, terminal_uid=os.getuid())
        threading.Thread(target=listener.serve_forever, daemon=True).start()
        self.addCleanup(listener.server_close)
        self.addCleanup(listener.shutdown)
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(call, PAYLOAD, path=self.path)
            deadline = time.monotonic() + 1
            while mailbox.take()[1]["pending"] is None and time.monotonic() < deadline:
                time.sleep(0.005)
            pending = mailbox.take()[1]["pending"]
            self.assertIsNotNone(pending)
            result = {"id": 123}
            mailbox.deliver(
                {
                    **binding,
                    "operation_id": pending["operation_id"],
                    "result": result,
                    "receipt": "a" * 43,
                }
            )
            self.assertEqual(future.result(timeout=1), result)
            while mailbox.take()[1]["ack"] is None and time.monotonic() < deadline:
                time.sleep(0.005)
            self.assertEqual(mailbox.take()[1]["ack"]["receipt"], "a" * 43)

    def test_cli_has_no_path_override_and_prints_fixed_error(self):
        with (
            patch("sys.argv", ["client", json.dumps(PAYLOAD), "--path", self.path]),
            patch("builtins.print") as output,
        ):
            self.assertEqual(main(), 1)
        output.assert_called_once_with('{"error":"tool_transport_unavailable"}')
