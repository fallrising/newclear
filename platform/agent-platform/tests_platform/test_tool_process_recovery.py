"""Real SIGKILL broker/SQL boundaries, not natural lease or KVM recovery proof."""

import json
import multiprocessing
import os
import signal
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import test_tool_broker
from test_control_plane import PlatformFixture

from agent_platform.db import Database
from agent_platform.domain import Problem
from agent_platform.tool_broker.broker import Broker
from agent_platform.tool_broker.policy import Policy
from agent_platform.worker import Worker


def execute_until_barrier(connection, policy, run, token, operation, payload, stage):
    """Spawn imports this module afresh; it never receives a parent connection pool."""
    db = Database(os.environ["TEST_DATABASE_URL"])
    db.open()

    def barrier(name):
        connection.send({"stage": name, "pid": os.getpid()})
        # Parent kills this exact child while it waits, without an exception path.
        connection.recv()
        raise AssertionError("crash barrier unexpectedly released")

    class Adapter:
        def execute(self, payload, *, before_hop):
            if stage == "admitted":
                barrier(stage)
            before_hop()
            if stage == "attempted":
                barrier(stage)
            return SimpleNamespace(value={"id": 123}, http_calls=1, response_bytes=10)

    try:
        response = Broker(db, policy, adapter=Adapter()).execute(run, token, operation, payload)
        if response["status"] != "succeeded" or "receipt" not in response:
            raise AssertionError("settlement did not produce an ephemeral completion")
        # Neither result nor receipt crosses the IPC boundary or survives this process.
        barrier("settled")
    finally:
        db.close()
        connection.close()


class ToolProcessRecoveryTests(PlatformFixture):
    # Borrow only the fixture helper, not ToolBrokerTests' collected test methods.
    running = test_tool_broker.ToolBrokerTests.running

    def setUp(self):
        super().setUp()
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
        profile = self.post("/agent-profiles", {"name": "Crash fixture", "backend": "openhands"})
        self.payload["profile_revision"] = profile.json()["id"]
        self.run, self.worker, self.binding = self.running()
        self.policy = Policy(
            service_id=uuid4(),
            credential_revision=uuid4(),
            origin="http://127.0.0.1:12345",
            credential_origin="http://127.0.0.1:12345",
            credential_path_prefix="/repos/example/project/",
            secret="process-fixture-canary",
            repository_id=123,
            owner="example",
            repository="project",
            commit="a" * 40,
            paths=("README.md",),
            issues=(1,),
            request_limit=2,
            in_flight_limit=1,
        )
        self.upstream = test_tool_broker.NeverUpstream()
        self.broker = Broker(self.db, self.policy, adapter=self.upstream)
        self.expiry = datetime.now(UTC) + timedelta(minutes=2)
        self.broker.provision(self.run, 1, self.worker.owner, self.binding, expires_at=self.expiry)
        self.token = self.broker.issue(self.run, 1, self.worker.owner, self.binding)
        self.operation = uuid4()
        self.tool_payload = {"operation": "github.repository.get", "repository_id": 123}

    def row(self):
        with self.db.transaction() as conn:
            return conn.execute(
                "SELECT * FROM tool_broker_operations WHERE run_id=%s AND operation_id=%s",
                (self.run, self.operation),
            ).fetchone()

    def crash_at(self, stage):
        context = multiprocessing.get_context("spawn")
        parent, child = context.Pipe()
        process = context.Process(
            target=execute_until_barrier,
            args=(
                child,
                self.policy,
                self.run,
                self.token,
                self.operation,
                self.tool_payload,
                stage,
            ),
        )
        process.start()
        child.close()

        def cleanup():
            try:
                if process.is_alive():
                    process.kill()
                process.join(10)
                self.assertFalse(process.is_alive(), "owned child was not reaped")
            finally:
                parent.close()
                process.close()

        self.addCleanup(cleanup)
        self.assertTrue(parent.poll(15), "child did not reach the durable crash barrier")
        self.assertEqual(parent.recv(), {"stage": stage, "pid": process.pid})
        before = self.row()
        self.assertIsNotNone(before)
        process.kill()
        process.join(10)
        self.assertEqual(process.exitcode, -signal.SIGKILL)
        self.assertEqual(self.row(), before, "SIGKILL must not run broker exception settlement")
        return before

    def recover(self):
        replacement = Worker(self.db)
        self.assertNotEqual(replacement.owner, self.worker.owner)
        # Narrow authority fixture only: keep the same running binding and advance owner.
        # Natural lease loss/reconciliation is covered separately by the KVM acceptance.
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET generation=2 WHERE id=%s", (self.run,))
            conn.execute(
                "UPDATE jobs SET generation=2,lease_owner=%s WHERE run_id=%s",
                (replacement.owner, self.run),
            )
            conn.execute("UPDATE sandbox_bindings SET generation=2 WHERE id=%s", (self.binding,))
        broker = Broker(self.db, self.policy, adapter=self.upstream)
        with self.assertRaisesRegex(Problem, "tool_rebind_required"):
            broker.issue(self.run, 2, replacement.owner, self.binding)
        broker.rebind(self.run, 2, replacement.owner, self.binding)
        token = broker.issue(self.run, 2, replacement.owner, self.binding)
        with self.assertRaises(Problem):
            broker.execute(self.run, self.token, self.operation, self.tool_payload)
        with self.assertRaises(Problem):
            broker.acknowledge(self.run, self.token, self.operation, "a" * 43)
        return broker, token

    def assert_recovery(self, stage, status, delivery, calls):
        before = self.crash_at(stage)
        self.assertEqual(before["status"], "succeeded" if stage == "settled" else "admitted")
        self.assertEqual(before["delivery"], "pending" if stage == "settled" else "none")
        self.assertEqual(before["http_calls"], calls)
        self.assertEqual(bool(before["receipt_hash"]), stage == "settled")
        broker, token = self.recover()
        recovered = self.row()
        self.assertEqual((recovered["status"], recovered["delivery"]), (status, delivery))
        for _ in range(3):
            response = broker.execute(self.run, token, self.operation, self.tool_payload)
            self.assertEqual((response["status"], response["delivery"]), (status, delivery))
            self.assertNotIn("result", response)
            self.assertNotIn("receipt", response)
        with self.assertRaisesRegex(Problem, "tool_receipt_invalid"):
            broker.acknowledge(self.run, token, self.operation, "a" * 43)
        denied = "tool_delivery_unconfirmed" if stage == "settled" else "tool_in_flight_limit"
        with self.assertRaisesRegex(Problem, denied):
            broker.execute(self.run, token, uuid4(), self.tool_payload)
        self.assertEqual(self.upstream.calls, 0, "recovery redispatched an operation")
        after = self.row()
        for field in ("http_calls", "response_bytes", "generation", "binding_id", "deadline_at"):
            self.assertEqual(after[field], before[field], field)
        self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_operations"), 1)
        self.assertEqual(
            self.scalar(
                "SELECT count(*) FROM tool_broker_operations WHERE delivery='acknowledged'"
            ),
            0,
        )
        with self.db.transaction() as conn:
            grant = conn.execute(
                "SELECT * FROM tool_broker_runs WHERE run_id=%s", (self.run,)
            ).fetchone()
        self.assertEqual(grant["expires_at"], self.expiry)
        self.assertEqual((grant["request_limit"], grant["in_flight_limit"]), (2, 1))

    def test_sigkill_after_admission_is_unknown_without_a_dispatch(self):
        self.assert_recovery("admitted", "unknown", "none", 0)

    def test_sigkill_after_before_hop_retains_conservative_attempt_count(self):
        self.assert_recovery("attempted", "unknown", "none", 1)

    def test_sigkill_after_settlement_loses_delivery_without_replaying_result(self):
        self.assert_recovery("settled", "succeeded", "unknown", 1)


class ProcessHarnessCleanupTests(unittest.TestCase):
    def setUp(self):
        import importlib.util
        import sys
        from pathlib import Path
        from unittest.mock import patch

        scripts = Path(__file__).resolve().parents[1] / "scripts"
        spec = importlib.util.spec_from_file_location(
            "tool_process_cleanup_test", scripts / "tool-process-recovery-kvm.py"
        )
        self.module = importlib.util.module_from_spec(spec)
        with patch.object(sys, "path", [str(scripts), *sys.path]):
            spec.loader.exec_module(self.module)

    def test_owned_connector_stops_even_when_node_cleanup_query_fails(self):
        from unittest.mock import patch

        harness = object.__new__(self.module.ProcessHarness)
        harness.actors = []
        with patch.object(
            self.module.base.Harness, "cleanup", side_effect=RuntimeError("node_unknown")
        ):
            with patch.object(harness, "stop_connector") as stop:
                with self.assertRaisesRegex(RuntimeError, "node_unknown"):
                    harness.cleanup()
                stop.assert_called_once_with()

    def test_dead_connector_is_restarted_before_native_cancel(self):
        from unittest.mock import Mock, patch

        harness = object.__new__(self.module.ProcessHarness)
        harness.actors = []
        harness.connector = Mock()
        harness.connector.poll.return_value = -signal.SIGKILL
        harness.connectors = [harness.connector]
        order = []
        with patch.object(harness, "start_connector", side_effect=lambda: order.append("restart")):
            with patch.object(harness, "stop_connector", side_effect=lambda: order.append("stop")):

                def cancel(_):
                    order.append("cancel")
                    return {"cleanup_failures": 0}

                with patch.object(self.module.base.Harness, "cleanup", cancel):
                    result = harness.cleanup()
        self.assertEqual(order, ["restart", "cancel", "stop"])
        self.assertEqual(result["cleanup_failures"], 0)

    def test_port_probe_accepts_time_wait_but_never_an_active_listener(self):
        import socket

        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", 0))
            address = listener.getsockname()
            origin = "http://127.0.0.1:" + str(address[1])
            listener.listen()
            with self.assertRaises(OSError):
                self.module.connector_address(origin)
            with socket.create_connection(address) as peer:
                connection, _ = listener.accept()
                connection.close()  # Server actively closes; its address enters TIME_WAIT.
                self.assertEqual(peer.recv(1), b"")
        with socket.socket() as old_probe:
            with self.assertRaises(OSError):
                old_probe.bind(address)
        self.assertEqual(self.module.connector_address(origin).port, address[1])
