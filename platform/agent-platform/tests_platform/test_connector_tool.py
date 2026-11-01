"""TB-2a host relay contracts; no VM or production admission evidence."""

import json
import secrets
import tempfile
import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from test_control_plane import PlatformFixture

from agent_platform.connector import Allocate, Connector, create_connector
from agent_platform.connector_journal import Journal
from agent_platform.connector_output import OutputPolicy
from agent_platform.connector_tool import ToolExchange, exchange
from agent_platform.domain import Problem


class ConnectorToolTests(unittest.TestCase):
    def setUp(self):
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        journal = Journal(root.name)
        self.addCleanup(journal.close)
        self.run, self.binding, self.instance = uuid4(), uuid4(), str(uuid4())
        self.row = {
            "run_id": str(self.run),
            "generation": 1,
            "input": {"tool_transport": True},
            "operations": {},
            "tool_relay_key": secrets.token_urlsafe(32),
        }
        journal.write(self.row)
        self.service = SimpleNamespace(
            journal=journal,
            require=lambda run, generation: journal.read(run),
            guard=Mock(),
            isolation=Mock(),
            tool_epoch=str(uuid4()),
            token="connector-canary",
            client=SimpleNamespace(api_token="node-canary"),
        )
        self.identity = {
            "run_id": str(self.run),
            "binding_id": str(self.binding),
            "generation": 1,
            "instance_id": self.instance,
        }
        self.pending = None
        self.ack = None
        self.calls = []

        class HTTP:
            def expect(_, method, path, data=None):
                self.calls.append((method, path, data))
                if path == "/mailbox":
                    return {"instance_id": self.instance, "pending": self.pending, "ack": self.ack}
                if path == "/bind":
                    return self.identity
                if path == "/close":
                    return {"closed": True}
                return {"accepted": True}

        @contextmanager
        def relay(service, row):
            yield HTTP()

        patcher = patch("agent_platform.connector_tool.relay", relay)
        patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, action, **data):
        return exchange(
            self.service,
            self.run,
            ToolExchange(generation=1, binding_id=self.binding, action=action, **data),
        )

    def test_default_transport_preserves_existing_allocation_fingerprint(self):
        import threading

        from agent_platform.connector import fingerprint

        request = Allocate(
            egress_policy_sha256="a" * 64,
            generation=1,
            template="fixture",
            canonical_repo="repo",
            base_sha="b" * 40,
            deadline="2099-01-01T00:00:00Z",
        )
        legacy = request.model_dump(mode="json", exclude={"tool_transport"})
        row = {
            "run_id": str(self.run),
            "generation": 1,
            "input": legacy,
            "operations": {
                "allocate": {
                    "state": "completed",
                    "payload_hash": fingerprint(legacy),
                    "result": {"handle": "existing-handle"},
                },
            },
        }
        self.service.journal.write(row)
        service = Connector.__new__(Connector)
        service.config = {"template": "fixture", "tool_transport_fixture": True}
        service.network = Mock(return_value={"policy_sha256": "a" * 64})
        service.entries = {("repo", "b" * 40): {"fixture": True}}
        service.journal = self.service.journal
        service.admission = threading.Lock()
        service.fences = SimpleNamespace(require=Mock())
        service.require = Mock(return_value=row)
        service.guard = Mock()
        self.assertEqual(service.allocate(self.run, request), {"handle": "existing-handle"})
        with self.assertRaisesRegex(Problem, "connector_operation_conflict"):
            service.allocate(self.run, request.model_copy(update={"tool_transport": True}))

    def test_default_allocation_cannot_activate_tool_transport(self):
        service = Connector.__new__(Connector)
        service.config = {}
        service.network = Mock(side_effect=AssertionError("must reject before node access"))
        request = Allocate(
            egress_policy_sha256="a" * 64,
            generation=1,
            template="fixture",
            canonical_repo="repo",
            base_sha="b" * 40,
            deadline="2099-01-01T00:00:00Z",
            tool_transport=True,
        )
        with self.assertRaisesRegex(Problem, "tool_fixture_not_enabled"):
            service.allocate(uuid4(), request)

    def test_host_pins_identity_and_rejects_guest_forgery(self):
        self.assertEqual(self.call("bind"), self.identity)
        self.pending = {
            **self.identity,
            "operation_id": str(uuid4()),
            "payload": {"operation": "github.repository.get", "repository_id": 123},
        }
        self.assertEqual(self.call("poll")["pending"], self.pending)
        self.pending["binding_id"] = str(uuid4())
        with self.assertRaisesRegex(Problem, "tool_mailbox_identity_mismatch"):
            self.call("poll")

    def test_restart_and_new_binding_cannot_resume_channel(self):
        self.call("bind")
        with self.assertRaises(Problem):
            self.call("bind")
        self.service.tool_epoch = str(uuid4())
        with self.assertRaisesRegex(Problem, "tool_channel_unavailable"):
            self.call("poll")

    def test_unconfigured_channel_never_contacts_helper(self):
        self.row["input"]["tool_transport"] = False
        self.service.journal.write(self.row)
        with self.assertRaisesRegex(Problem, "tool_transport_not_configured"):
            self.call("bind")
        self.assertEqual(self.calls, [])

    def test_delivery_is_once_only_and_journal_contains_no_result_or_receipt(self):
        self.call("bind")
        operation = str(uuid4())
        self.pending = {
            **self.identity,
            "operation_id": operation,
            "payload": {"operation": "github.repository.get", "repository_id": 123},
        }
        self.call("poll")
        receipt = secrets.token_urlsafe(32)
        self.call(
            "deliver", operation_id=operation, result={"name": "result-canary"}, receipt=receipt
        )
        with self.assertRaises(Problem):
            self.call(
                "deliver", operation_id=operation, result={"name": "result-canary"}, receipt=receipt
            )
        self.assertEqual(sum(path == "/response" for _, path, _ in self.calls), 1)
        raw = json.dumps(self.service.journal.read(self.run))
        self.assertNotIn(receipt, raw)
        self.assertNotIn("result-canary", raw)

    def test_tool_relay_key_is_filtered_from_general_output(self):
        policy = OutputPolicy(self.service, self.row)
        self.assertTrue(policy.sensitive({"text": self.row["tool_relay_key"]}))
        self.assertNotIn(
            self.row["tool_relay_key"], json.dumps(policy.redact(self.row["tool_relay_key"]))
        )

    def test_control_route_rejects_ambiguous_body_and_session_audience(self):
        client = TestClient(create_connector({}, self.service))
        self.addCleanup(client.close)
        path = f"/v1/runs/{self.run}/tool"
        body = {"generation": 1, "binding_id": str(self.binding), "action": "bind"}
        headers = {"X-Session-API-Key": self.service.token, "Content-Type": "application/json"}
        for raw in (
            json.dumps(body).replace('"generation": 1', '"generation": 1, "generation": 2'),
            json.dumps({**body, "result": float("nan")}),
        ):
            self.assertEqual(client.post(path, content=raw, headers=headers).status_code, 422)
        self.assertEqual(
            client.post(
                path, json=body, headers={**headers, "X-Session-API-Key": "mp1_" + "x" * 43}
            ).status_code,
            401,
        )
        for extra in ({"Origin": ""}, {"Cookie": "fixture"}, {"Content-Encoding": "gzip"}):
            self.assertEqual(
                client.post(path, json=body, headers={**headers, **extra}).status_code, 422
            )
        self.assertEqual(
            client.post(path + "?ignored=1", json=body, headers=headers).status_code, 422
        )
        self.assertEqual(self.calls, [])
        self.assertEqual(client.post(path, json=body, headers=headers).json(), self.identity)

    def test_uncertain_guest_delivery_is_not_retried_after_connector_restart(self):
        self.call("bind")
        operation = str(uuid4())
        self.pending = {
            **self.identity,
            "operation_id": operation,
            "payload": {"operation": "github.repository.get", "repository_id": 123},
        }
        self.call("poll")

        @contextmanager
        def broken(service, row):
            yield SimpleNamespace(expect=Mock(side_effect=OSError("sensitive failure")))

        with patch("agent_platform.connector_tool.relay", broken):
            with self.assertRaisesRegex(Problem, "tool_exchange_uncertain"):
                self.call("deliver", operation_id=operation, result={}, receipt="x" * 43)
        current = self.service.journal.read(self.run)["tool_channel"]
        self.assertEqual(current["state"], "closed")
        self.service.tool_epoch = str(uuid4())
        with self.assertRaisesRegex(Problem, "tool_channel_unavailable"):
            self.call("poll")

    def test_runtime_tool_rpc_uses_short_control_transport(self):
        from agent_platform.runtime_client import RuntimeClient

        runtime = RuntimeClient("http://127.0.0.1:12345", "fixture-connector-key")
        self.assertEqual(runtime.lease_http.timeout, 5)
        runtime.http.request = Mock(side_effect=AssertionError("long transport forbidden"))
        runtime.lease_http.request = Mock(return_value=(200, {"closed": True}))
        self.assertEqual(
            runtime.tool({"id": self.run, "generation": 1, "sandbox_id": self.binding}, "close"),
            {"closed": True},
        )
        runtime.lease_http.request.assert_called_once()

    def test_prepare_stages_tool_helpers_only_for_explicit_fixture_allocation(self):
        from agent_platform.connector_isolation import CODE, CONTROL, TOOL_HELPERS
        from agent_platform_m0.contracts import (
            OPENHANDS_BINARY_SHA256,
            OPENHANDS_SHA,
            OPENHANDS_VERSION,
        )

        service = Connector.__new__(Connector)
        guest = Mock()
        guest.exec.side_effect = lambda *args, **kwargs: (
            OPENHANDS_BINARY_SHA256
            if args[0] == "sha256sum"
            else json.dumps({"base_sha": "a" * 40})
        )
        service.handle = Mock(return_value=guest)
        service.guard = Mock()
        service.journal = SimpleNamespace(write=Mock())
        service.isolation = Mock()
        service.entries = {("repo", "a" * 40): {}}
        service.bundle = Mock(return_value=b"fixture")
        service.launcher = Mock(return_value=b"test-launcher")
        row = {
            "run_id": str(self.run),
            "input": {
                "canonical_repo": "repo",
                "base_sha": "a" * 40,
                "tool_transport": True,
                "model_transport": True,
            },
        }

        @contextmanager
        def sdk_relay(row):
            class SDK:
                def expect(self, method, path, data=None, **kwargs):
                    if path == "/server_info":
                        return {"build_git_sha": OPENHANDS_SHA, "version": OPENHANDS_VERSION}
                    return {"id": row["run_id"]}

            yield SDK()

        service.relay = sdk_relay
        with patch("agent_platform.connector.wait_ready"):
            service.prepare(row)
        staged = {call.args[0] for call in guest.write_file.call_args_list}
        self.assertTrue({CODE + "/" + name for name in TOOL_HELPERS} <= staged)
        tool = next(
            call for call in guest.spawn.call_args_list if call.args[2] == CODE + "/guest_tool.py"
        )
        self.assertEqual(tool.kwargs["user"], "agentcontrol")
        self.assertEqual(tool.kwargs["cwd"], CONTROL)
        self.assertEqual(
            tool.kwargs["env"],
            {
                "TOOL_RUN_ID": str(self.run),
                "TOOL_RELAY_KEY": row["tool_relay_key"],
            },
        )
        self.assertNotEqual(row["tool_relay_key"], row["session_key"])
        self.assertNotEqual(row["tool_relay_key"], row["model_local_key"])
        self.assertEqual(row["tool_isolation_revision"], "tool-mailbox-v1")


# Separate real-DB fixture: only the VM port-forward and SDK terminal process are
# mocked. Unix framing, guest HTTP, connector ASGI, broker ledger and GitHub HTTP
# all execute their actual implementations.


class ToolRoundTripTests(PlatformFixture):
    def setUp(self):
        super().setUp()
        import os
        import threading
        from datetime import UTC, datetime, timedelta
        from pathlib import Path

        import test_tool_broker
        from test_tool_transport import MockGitHub

        from agent_platform.guest_tool import Mailbox, local_server, server
        from agent_platform.runtime_client import RuntimeClient
        from agent_platform.tool_broker.broker import Broker
        from agent_platform.tool_broker.policy import Policy
        from agent_platform.tool_session import ToolSession
        from agent_platform_m0.transport import HTTP

        with self.db.transaction() as conn:
            conn.execute("TRUNCATE tool_broker_services CASCADE")
            conn.execute(
                "INSERT INTO runtime_catalog(node_id,template_digest,repositories,"
                "egress_policy_sha256) VALUES ('cocoon-local',%s,%s,%s) ON CONFLICT(node_id) "
                "DO UPDATE SET repositories=excluded.repositories",
                (
                    "fixture@sha256:" + "a" * 64,
                    json.dumps(
                        [
                            {
                                "canonical_repo": self.project["canonical_repo"],
                                "base_sha": self.payload["base_sha"],
                            }
                        ]
                    ),
                    "b" * 64,
                ),
            )
        self.payload["profile_revision"] = self.post(
            "/agent-profiles", {"name": "Tool roundtrip", "backend": "openhands"}
        ).json()["id"]
        self.run, self.worker, self.binding = test_tool_broker.ToolBrokerTests.running(self)
        mock = MockGitHub()
        self.mock = mock
        self.addCleanup(mock.close)
        policy = Policy(
            service_id=uuid4(),
            credential_revision=uuid4(),
            origin=mock.origin,
            credential_origin=mock.origin,
            credential_path_prefix="/repos/example/project/",
            secret="roundtrip-service-canary",
            repository_id=123,
            owner="example",
            repository="project",
            commit="a" * 40,
            paths=("readme.txt",),
            issues=(7,),
        )
        self.broker = Broker(self.db, policy)
        self.broker.provision(
            self.run,
            1,
            self.worker.owner,
            self.binding,
            expires_at=datetime.now(UTC) + timedelta(minutes=2),
        )
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        journal = Journal(root / "connector")
        self.journal = journal
        self.addCleanup(journal.close)
        (root / "guest").mkdir(mode=0o700)
        self.mailbox = Mailbox(root / "guest", str(self.run), secrets.token_urlsafe(32), timeout=5)
        self.socket_path = str(root / "request.sock")
        self.http_server = server(self.mailbox, 0)
        self.unix_server = local_server(self.mailbox, self.socket_path, terminal_uid=os.getuid())
        for endpoint in (self.http_server, self.unix_server):
            thread = threading.Thread(target=endpoint.serve_forever, daemon=True)
            thread.start()

            def shutdown(endpoint=endpoint, thread=thread):
                endpoint.shutdown()
                endpoint.server_close()
                thread.join(3)

            self.addCleanup(shutdown)
        row = {
            "run_id": str(self.run),
            "generation": 1,
            "input": {"tool_transport": True},
            "operations": {},
            "tool_relay_key": self.mailbox.relay_key,
        }
        journal.write(row)
        service = SimpleNamespace(
            journal=journal,
            require=lambda run, generation: journal.read(run),
            guard=Mock(),
            isolation=Mock(),
            tool_epoch=str(uuid4()),
            token="roundtrip-connector-canary",
            client=SimpleNamespace(api_token="roundtrip-node-canary"),
        )
        self.service = service

        @contextmanager
        def relay(service, row):
            yield HTTP(
                f"http://127.0.0.1:{self.http_server.server_port}", row["tool_relay_key"], timeout=2
            )

        patcher = patch("agent_platform.connector_tool.relay", relay)
        patcher.start()
        self.addCleanup(patcher.stop)
        client = TestClient(create_connector({}, service))
        self.addCleanup(client.close)

        class Wire:
            def request(_, method, path, data=None):
                response = client.request(
                    method, path, json=data, headers={"X-Session-API-Key": service.token}
                )
                return response.status_code, response.json()

        runtime = RuntimeClient.__new__(RuntimeClient)
        runtime.lease_http = Wire()
        self.session = ToolSession(
            self.broker,
            runtime,
            run_id=self.run,
            generation=1,
            owner=self.worker.owner,
            binding_id=self.binding,
        )
        self.addCleanup(self.session.close)
        self.session.step()
        self.assertFalse(self.session.closed)

    def pump(self, until):
        import time

        deadline = time.monotonic() + 5
        while not until():
            self.assertLess(time.monotonic(), deadline, "tool roundtrip deadline")
            self.session.step()
            self.assertFalse(self.session.closed, self.session.error)
            time.sleep(0.005)

    def test_sdk_client_mailbox_connector_broker_http_and_ack(self):
        from concurrent.futures import ThreadPoolExecutor

        from agent_platform.guest_tool_client import call

        inputs = [
            {"operation": "github.repository.get", "repository_id": 123},
            {"operation": "github.issue.get", "repository_id": 123, "issue_number": 7},
            {
                "operation": "github.file.get",
                "repository_id": 123,
                "commit": "a" * 40,
                "path": "readme.txt",
            },
        ]
        with ThreadPoolExecutor(max_workers=1) as pool:
            for number, payload in enumerate(inputs, 1):
                future = pool.submit(call, payload, path=self.socket_path, timeout=5)
                self.pump(future.done)
                value = future.result()
                self.assertIsInstance(value, dict)
                self.assertNotIn("roundtrip-service-canary", json.dumps(value))
                self.pump(
                    lambda number=number: (
                        self.scalar(
                            "SELECT count(*) FROM tool_broker_operations "
                            "WHERE delivery='acknowledged'"
                        )
                        == number
                    )
                )
        self.assertEqual(len(self.mock.calls), 7)
        self.assertTrue(
            all(
                headers["Authorization"] == "Bearer roundtrip-service-canary"
                for _, headers in self.mock.calls
            )
        )
        raw = self.mailbox.path.read_text() + json.dumps(self.journal.read(self.run))
        self.assertNotIn("roundtrip-service-canary", raw)
        self.assertNotIn("tb1_", raw)

    def test_revoked_host_grant_cannot_dispatch_guest_request(self):
        from concurrent.futures import ThreadPoolExecutor

        from agent_platform.guest_tool_client import ToolError, call

        self.broker.revoke(self.run)
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(
                call,
                {"operation": "github.repository.get", "repository_id": 123},
                path=self.socket_path,
                timeout=5,
            )
            self.session.step()
            self.assertTrue(self.session.closed)
            with self.assertRaises(ToolError):
                future.result(timeout=6)
        self.assertEqual(self.mock.calls, [])
        self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_operations"), 0)
