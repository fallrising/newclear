"""TB-2a host orchestration against real SQL authority, with a mock guest relay."""

import copy
import json
import threading
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import test_tool_broker
from test_control_plane import PlatformFixture

from agent_platform.tool_broker.broker import Broker
from agent_platform.tool_broker.policy import Policy
from agent_platform.tool_session import ToolSession


class Relay:
    def __init__(self, run, binding):
        self.identity = {
            "instance_id": str(uuid4()),
            "run_id": str(run),
            "binding_id": str(binding),
            "generation": 1,
        }
        self.pending = None
        self.ack = None
        self.calls = []
        self.fail = None
        self.delivered = None
        self.on_poll = None

    def submit(self, payload):
        self.pending = {**self.identity, "operation_id": str(uuid4()), "payload": payload}
        return self.pending["operation_id"]

    def consume(self):
        self.ack = {
            **self.identity,
            "operation_id": self.delivered["operation_id"],
            "receipt": self.delivered["receipt"],
        }
        self.pending = None

    def tool(self, run, action, **data):
        self.calls.append((action, copy.deepcopy(data)))
        if action == self.fail:
            raise RuntimeError("private provider message and fixture secret")
        if action == "bind":
            return self.identity.copy()
        if action == "poll":
            if self.on_poll is not None:
                self.on_poll()
            return copy.deepcopy(
                {
                    "instance_id": self.identity["instance_id"],
                    "pending": self.pending,
                    "ack": self.ack,
                }
            )
        if action == "deliver":
            self.delivered = data
            return {"accepted": True}
        if action == "ack":
            self.ack = None
            return {"accepted": True}
        if action == "close":
            return {"closed": True}
        raise AssertionError(action)


class ToolSessionTests(PlatformFixture):
    running = test_tool_broker.ToolBrokerTests.running
    success_adapter = test_tool_broker.ToolBrokerTests.success_adapter

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
        profile = self.post("/agent-profiles", {"name": "Tool session", "backend": "openhands"})
        self.payload["profile_revision"] = profile.json()["id"]
        self.run, self.worker, self.binding = self.running()
        self.policy = Policy(
            service_id=uuid4(),
            credential_revision=uuid4(),
            origin="http://127.0.0.1:12345",
            credential_origin="http://127.0.0.1:12345",
            credential_path_prefix="/repos/example/project/",
            secret="tb2a-fixture-canary",
            repository_id=123,
            owner="example",
            repository="project",
            commit="a" * 40,
            paths=("README.md",),
            issues=(1,),
        )
        self.broker = Broker(self.db, self.policy)
        self.broker.provision(
            self.run,
            1,
            self.worker.owner,
            self.binding,
            expires_at=datetime.now(UTC) + timedelta(minutes=2),
        )
        self.payload_tool = {"operation": "github.repository.get", "repository_id": 123}
        self.relay = Relay(self.run, self.binding)
        self.calls = self.success_adapter()
        self.session = self.new_session()
        self.addCleanup(self.session.close)

    def new_session(self):
        return ToolSession(
            self.broker,
            self.relay,
            run_id=self.run,
            generation=1,
            owner=self.worker.owner,
            binding_id=self.binding,
        )

    def until(self, predicate):
        deadline = time.monotonic() + 3
        while not predicate():
            if time.monotonic() > deadline:
                self.fail("host session did not reach the expected observable state")
            self.session.step()
            time.sleep(0.005)

    def test_success_delivers_once_then_acknowledges_sql_before_guest(self):
        operation = self.relay.submit(self.payload_tool)
        self.until(lambda: self.relay.delivered is not None)
        self.assertEqual(self.scalar("SELECT delivery FROM tool_broker_operations"), "pending")
        for _ in range(3):
            self.session.step()
        self.assertEqual(sum(action == "deliver" for action, _ in self.relay.calls), 1)
        self.relay.consume()
        self.session.step()
        self.assertEqual(self.scalar("SELECT delivery FROM tool_broker_operations"), "acknowledged")
        self.assertEqual(self.relay.calls[-1], ("ack", {"operation_id": operation}))
        self.assertEqual(len(self.calls), 1)
        wire = str(self.relay.calls)
        self.assertNotIn("tb1_", wire)
        self.assertNotIn(self.policy.secret, wire)

    def assert_identity_rejected(self, field, value):
        self.relay.submit(self.payload_tool)
        self.relay.pending[field] = value
        self.session.step()
        self.assertTrue(self.session.closed)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_operations"), 0)

    def test_cross_run_pending_has_zero_admission(self):
        self.assert_identity_rejected("run_id", str(uuid4()))

    def test_cross_binding_pending_has_zero_admission(self):
        self.assert_identity_rejected("binding_id", str(uuid4()))

    def test_stale_generation_pending_has_zero_admission(self):
        self.assert_identity_rejected("generation", 2)

    def test_noncanonical_operation_uuid_has_zero_admission(self):
        self.assert_identity_rejected("operation_id", "not-a-uuid")

    def test_reserved_payload_identity_has_zero_admission(self):
        self.relay.submit({**self.payload_tool, "run_id": str(self.run)})
        self.until(lambda: self.session.closed)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_operations"), 0)

    def test_bind_identity_rejected_before_any_dispatch(self):
        self.relay.identity["generation"] = True
        self.relay.submit(self.payload_tool)
        self.session.step()
        self.assertTrue(self.session.closed)
        self.assertEqual(self.calls, [])

    def test_helper_restart_stops_channel_without_redelivery(self):
        self.relay.submit(self.payload_tool)
        self.until(lambda: self.relay.delivered is not None)
        self.relay.identity["instance_id"] = str(uuid4())
        self.session.step()
        self.assertTrue(self.session.closed)
        self.assertEqual(sum(action == "deliver" for action, _ in self.relay.calls), 1)

    def test_lost_delivery_reply_never_retries_or_acknowledges(self):
        self.relay.fail = "deliver"
        self.relay.submit(self.payload_tool)
        self.until(lambda: self.session.closed)
        for _ in range(3):
            self.session.step()
        self.assertEqual(sum(action == "deliver" for action, _ in self.relay.calls), 1)
        self.assertEqual(self.scalar("SELECT delivery FROM tool_broker_operations"), "pending")
        self.assertFalse(any(action == "ack" for action, _ in self.relay.calls))

    def test_lost_ack_reply_closes_with_one_committed_ack(self):
        self.relay.submit(self.payload_tool)
        self.until(lambda: self.relay.delivered is not None)
        self.relay.consume()
        self.relay.fail = "ack"
        self.session.step()
        self.session.step()
        self.assertTrue(self.session.closed)
        self.assertEqual(sum(action == "ack" for action, _ in self.relay.calls), 1)
        self.assertEqual(self.scalar("SELECT delivery FROM tool_broker_operations"), "acknowledged")

    def test_wrong_receipt_never_acknowledges(self):
        self.relay.submit(self.payload_tool)
        self.until(lambda: self.relay.delivered is not None)
        self.relay.consume()
        self.relay.ack["receipt"] = "a" * 43
        self.session.step()
        self.assertTrue(self.session.closed)
        self.assertEqual(self.scalar("SELECT delivery FROM tool_broker_operations"), "pending")

    def test_cancel_is_prompt_while_upstream_is_blocked(self):
        entered, release = threading.Event(), threading.Event()
        calls = self.success_adapter(entered=entered, release=release)
        self.relay.submit(self.payload_tool)
        self.session.step()
        self.assertTrue(entered.wait(3))
        started = time.monotonic()
        self.session.step()
        future = self.session._future
        self.session.close()
        self.assertLess(time.monotonic() - started, 1)
        self.assertTrue(self.session.closed)
        release.set()
        try:
            future.result(timeout=3)
        except Exception:
            pass
        self.session.step()
        self.assertEqual(len(calls), 1)
        self.assertIsNone(self.relay.delivered)

    def test_fresh_authority_gate_blocks_completed_result_after_pause(self):
        self.relay.submit(self.payload_tool)
        self.session.step()
        self.session._future.result(timeout=3)

        def pause_after_poll():
            with self.db.transaction() as conn:
                conn.execute("UPDATE runs SET state='pausing' WHERE id=%s", (self.run,))

        self.relay.on_poll = pause_after_poll
        self.session.step()
        self.assertTrue(self.session.closed)
        self.assertIsNone(self.relay.delivered)

    def test_process_restart_cannot_replay_a_completed_broker_operation(self):
        self.relay.submit(self.payload_tool)
        self.session.step()
        self.session._future.result(timeout=3)
        # Lost volatile host result: another session sees only the existing SQL operation.
        replacement = self.new_session()
        self.addCleanup(replacement.close)
        self.session = replacement
        self.until(lambda: replacement.closed)
        self.assertIsNone(self.relay.delivered)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.scalar("SELECT delivery FROM tool_broker_operations"), "unknown")

    def test_four_global_slots_reject_fifth_without_queue_or_admission(self):
        release = threading.Event()
        entered = threading.Condition()
        dispatched = []

        class BlockingAdapter:
            def execute(inner, payload, *, before_hop):
                before_hop()
                with entered:
                    dispatched.append(payload)
                    entered.notify_all()
                if not release.wait(5):
                    raise TimeoutError()
                return SimpleNamespace(value={"id": 123}, response_bytes=10)

        self.broker.adapter = BlockingAdapter()
        sessions = [self.session]
        relays = [self.relay]
        for _ in range(3):
            run, worker, binding = self.running()
            self.broker.provision(
                run, 1, worker.owner, binding, expires_at=datetime.now(UTC) + timedelta(minutes=2)
            )
            relay = Relay(run, binding)
            session = ToolSession(
                self.broker, relay, run_id=run, generation=1, owner=worker.owner, binding_id=binding
            )
            sessions.append(session)
            relays.append(relay)
            self.addCleanup(session.close)
        # The platform itself caps live VMs at four. A concurrent host session
        # for the first run exercises fifth global submission without fabricating
        # an impossible fifth VM. Its rejection revokes that run's blocked call.
        extra_relay = Relay(self.run, self.binding)
        extra = ToolSession(
            self.broker,
            extra_relay,
            run_id=self.run,
            generation=1,
            owner=self.worker.owner,
            binding_id=self.binding,
        )
        sessions.append(extra)
        relays.append(extra_relay)
        self.addCleanup(extra.close)
        futures = []
        try:
            for session, relay in zip(sessions[:4], relays[:4], strict=True):
                relay.submit(self.payload_tool)
                session.step()
                self.assertIsNotNone(session._future)
                futures.append(session._future)
            with entered:
                self.assertTrue(entered.wait_for(lambda: len(dispatched) == 4, timeout=3))
            relays[4].submit(self.payload_tool)
            started = time.monotonic()
            sessions[4].step()
            self.assertLess(time.monotonic() - started, 1)
            self.assertTrue(sessions[4].closed)
            self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_operations"), 4)
            self.assertEqual(len(dispatched), 4)
        finally:
            release.set()
            for index, future in enumerate(futures):
                if index == 0:
                    with self.assertRaisesRegex(Exception, "tool_completion_revoked"):
                        future.result(timeout=3)
                else:
                    future.result(timeout=3)
            for session in sessions:
                session.close()

    def test_mutated_pending_payload_closes_without_second_dispatch(self):
        self.relay.submit(self.payload_tool)
        self.session.step()
        self.session._future.result(timeout=3)
        self.relay.pending["payload"]["repository_id"] = 456
        self.session.step()
        self.assertTrue(self.session.closed)
        self.assertIsNone(self.relay.delivered)
        self.assertEqual(len(self.calls), 1)

    def test_unexpected_ack_before_delivery_is_rejected(self):
        self.relay.ack = {**self.relay.identity, "operation_id": str(uuid4()), "receipt": "a" * 43}
        self.session.step()
        self.assertTrue(self.session.closed)
        self.assertEqual(self.calls, [])

    def test_revoke_before_upstream_finishes_withholds_result(self):
        entered, release = threading.Event(), threading.Event()
        self.success_adapter(entered=entered, release=release)
        self.relay.submit(self.payload_tool)
        self.session.step()
        future = self.session._future
        try:
            self.assertTrue(entered.wait(3))
            self.broker.revoke(self.run)
        finally:
            release.set()
        with self.assertRaisesRegex(Exception, "tool_completion_revoked"):
            future.result(timeout=3)
        self.session.step()
        self.assertTrue(self.session.closed)
        self.assertIsNone(self.relay.delivered)
        self.assertEqual(self.scalar("SELECT delivery FROM tool_broker_operations"), "withheld")

    def assert_close_interrupts_connector(self, blocked_action):
        entered, release = threading.Event(), threading.Event()
        original = self.relay.tool
        self.relay.submit(self.payload_tool)
        if blocked_action == "poll":
            self.session.step()
            self.session._future.result(timeout=3)

        def tool(run, action, **data):
            if action == blocked_action:
                entered.set()
                if not release.wait(3):
                    raise TimeoutError()
            return original(run, action, **data)

        self.relay.tool = tool
        control = threading.Thread(target=self.session.step)
        control.start()
        try:
            self.assertTrue(entered.wait(2))
            started = time.monotonic()
            self.session.close()
            self.assertLess(time.monotonic() - started, 1)
            self.assertTrue(
                self.scalar(
                    "SELECT revoked_at IS NOT NULL FROM tool_broker_runs WHERE run_id=%s",
                    (self.run,),
                )
            )
        finally:
            release.set()
            control.join(timeout=3)
        self.assertFalse(control.is_alive())
        self.assertTrue(self.session.closed)
        self.assertIsNone(self.relay.delivered)
        self.assertFalse(any(action == "deliver" for action, _ in self.relay.calls))

    def test_close_revokes_without_waiting_for_blocked_bind(self):
        self.assert_close_interrupts_connector("bind")
        self.assertEqual(self.calls, [])

    def test_close_revokes_during_poll_and_suppresses_completed_result(self):
        self.assert_close_interrupts_connector("poll")
        self.assertEqual(len(self.calls), 1)
