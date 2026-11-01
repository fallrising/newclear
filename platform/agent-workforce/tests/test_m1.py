"""Independent integration oracles inspect SQLite state and fake call counts."""
import tempfile
import unittest
import sqlite3
import threading
from pathlib import Path

from agent_workforce.admission import AdmissionError
from agent_workforce.controller import Controller
from agent_workforce.fake import FakeBackend
from agent_workforce.store import Store, ConflictError, StaleFenceError
from support import NOW, records, grant, request

class M1Integration(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "state.sqlite"
        self.now = NOW
        self.store = Store(self.path)
        self.addCleanup(lambda: self.store.close())
        self.backend = FakeBackend(mode="running")
        self.controller = Controller(self.store, self.backend,
            clock=lambda: self.now, trusted_issuers=("operator-example",))
        for kind, rows in records().items():
            for key, value in rows.items():
                self.controller.register(kind, key, value)
        self.controller.put_grant(grant(), authenticated_operator="operator-example")

    def active_reservations(self):
        return [row for row in self.store.reservations() if not row["released"]]

    def accept(self, req=None):
        return self.controller.accept(req or request(), authenticated_caller="operator-example")

    def test_fake_03_renewal_and_changed_input_have_one_command_and_outbox(self):
        first = self.accept()
        self.controller.put_grant(grant(revision=2, expires_at=1850.0), authenticated_operator="operator-example")
        duplicate = self.accept()
        self.assertEqual(first["command_id"], duplicate["command_id"])
        self.assertEqual(len(self.store.commands()), 1)
        self.assertEqual(len(self.store.outbox_rows()), 1)
        with self.assertRaises(ConflictError):
            self.accept(request(input={"goal": "different"}))
        self.assertEqual(len(self.backend.starts), 0)

    def test_fake_04_forged_sender_and_grant_cannot_admit(self):
        for req in [request(sender="forged"), request(grant_id="forged"),
                    request(origin="agent", sender="worker-b"),
                    request(resource_scopes={"workspace-a": {"read": [], "write": ["../secret"]}})]:
            with self.subTest(req=req), self.assertRaises((AdmissionError, ValueError)):
                self.accept(req)
        self.assertEqual(self.store.commands(), [])
        self.assertEqual(self.backend.starts, [])

    def test_fake_02_stale_route_evidence_blocks_dispatch(self):
        cmd = self.accept()
        route = records()["routes"]["route-a"]
        route["revision"] = 2
        self.controller.register("routes", "route-a", route)
        with self.assertRaises((AdmissionError, ValueError)):
            self.controller.dispatch(cmd["command_id"])
        self.assertEqual(self.store.attempts(), [])
        self.assertEqual(self.backend.starts, [])

    def test_fake_10_revocation_after_queue_prevents_start(self):
        cmd = self.accept()
        self.controller.put_grant(grant(revision=2, revoked=True), authenticated_operator="operator-example")
        with self.assertRaises((AdmissionError, ValueError)):
            self.controller.dispatch(cmd["command_id"])
        self.assertEqual(self.store.attempts(), [])
        self.assertEqual(self.backend.starts, [])

    def test_fake_10_expired_grant_before_dispatch_prevents_start(self):
        cmd = self.accept()
        self.now = 1800.0
        with self.assertRaises((AdmissionError, ValueError)):
            self.controller.dispatch(cmd["command_id"])
        self.assertEqual(self.store.attempts(), [])
        self.assertEqual(self.backend.starts, [])

    def test_intent_is_committed_before_fake_start(self):
        cmd = self.accept()
        seen = []
        committed = []
        def observe(operation_id):
            seen.append([a for a in self.store.attempts() if a["operation_id"] == operation_id])
            # A separate reader cannot see an uncommitted prepare on the writer.
            with sqlite3.connect(self.path) as reader:
                committed.append(reader.execute("SELECT operation_id FROM attempts WHERE operation_id=?", (operation_id,)).fetchall())
        self.backend.before_start = observe
        attempt = self.controller.dispatch(cmd["command_id"])
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0][0]["state"], "dispatch_prepared")
        self.assertEqual(committed, [[(attempt["operation_id"],)]])
        self.assertEqual(attempt["state"], "running")
        self.assertEqual(len(self.backend.starts), 1)
        self.assertTrue(self.store.reservations())

    def test_fake_05_acceptance_lost_ack_never_replaces_operation(self):
        self.backend.mode = "accept_then_raise"
        cmd = self.accept()
        attempt = self.controller.dispatch(cmd["command_id"])
        self.assertEqual(attempt["state"], "outcome_unknown")
        self.controller.dispatch(cmd["command_id"])
        self.assertEqual(len(self.backend.starts), 1)
        self.assertEqual(len(self.store.attempts()), 1)
        self.assertEqual(self.store.attempts()[0]["operation_id"], attempt["operation_id"])
        self.assertTrue(self.store.reservations())

    def test_fake_07_expiry_invalidates_fence_and_retains_all_slots(self):
        cmd = self.accept()
        attempt = self.controller.dispatch(cmd["command_id"])
        slots = self.store.reservations()
        self.now = attempt["lease_until"] + 1
        self.store.expire_leases(self.now)
        with self.assertRaises(StaleFenceError):
            self.store.publish_attempt(attempt["attempt_id"], attempt["fence"], "awaiting_review", now=self.now, result={"fake": True})
        self.assertEqual(self.store.reservations(), slots)
        self.controller.dispatch(cmd["command_id"])
        self.assertEqual(len(self.backend.starts), 1)

    def test_fake_07_08_account_session_workspace_claims_block_second_start(self):
        first = self.accept()
        self.controller.dispatch(first["command_id"])
        second = self.accept(request(step_id="write-1"))
        with self.assertRaises((ConflictError, ValueError)):
            self.controller.dispatch(second["command_id"])
        self.assertEqual(len(self.backend.starts), 1)
        self.assertEqual(len(self.store.attempts()), 1)

    def test_unknown_stop_receipt_holds_reservations(self):
        cmd = self.accept()
        attempt = self.controller.dispatch(cmd["command_id"])
        self.backend.stop_proven = False
        self.controller.stop(attempt["attempt_id"])
        self.assertTrue(self.store.reservations())
        self.assertFalse(self.store.attempt(attempt["attempt_id"])["stop_proven"])
        self.assertEqual(len(self.backend.starts), 1)

    def test_complete_stop_proof_releases_physical_slots_without_external_done(self):
        self.backend.mode = "complete"
        cmd = self.accept()
        attempt = self.controller.dispatch(cmd["command_id"])
        self.assertEqual(attempt["state"], "awaiting_review")
        self.assertTrue(attempt["stop_proven"])
        self.assertEqual(self.active_reservations(), [])
        self.assertNotEqual(self.store.command(cmd["command_id"])["state"], "done")

    def test_fake_12_receipts_replay_and_idle_start_zero_models(self):
        envelope = {"message_id": "message-example", "sender": "worker-b",
                    "recipients": ["worker-a"], "body": {"grant_id": "forged", "execute": True},
                    "expires_at": 2000.0}
        a = self.controller.receive(envelope, authenticated_sender="worker-b", recipient="worker-a")
        b = self.controller.receive(envelope, authenticated_sender="worker-b", recipient="worker-a", replay=True)
        self.controller.recover()
        self.assertEqual(a["receipt_id"], b["receipt_id"])
        self.assertEqual(len(self.store.inbox_rows()), 1)
        self.assertEqual(self.store.commands(), [])
        self.assertEqual(self.backend.starts, [])

    def test_fake_13_finite_turn_budget_unknown_cost_preserved(self):
        self.backend.mode = "complete"
        for step in ["write-0", "write-1"]:
            cmd = self.accept(request(step_id=step, session_binding_id="session-"+step))
            self.controller.dispatch(cmd["command_id"])
        with self.assertRaises((AdmissionError, ValueError)):
            self.accept(request(step_id="write-2"))
        usage = self.store.usage("job-example")
        self.assertEqual(usage["turns"], 2)
        self.assertIsNone(usage["provider_cost"])
        self.assertIsNone(usage["provider_tokens"])
        self.assertEqual(len(self.backend.starts), 2)

    def test_fake_16_restart_preserves_unknown_operation_and_stale_epoch(self):
        self.backend.mode = "accept_then_raise"
        cmd = self.accept()
        attempt = self.controller.dispatch(cmd["command_id"])
        self.store.close()
        self.store = Store(self.path)
        self.controller = Controller(self.store, self.backend, clock=lambda: self.now,
                                     trusted_issuers=("operator-example",))
        self.assertEqual(len(self.backend.starts), 1)
        found = self.store.attempt(attempt["attempt_id"])
        self.assertEqual(found["operation_id"], attempt["operation_id"])
        self.assertEqual(found["state"], "outcome_unknown")
        with self.assertRaises(StaleFenceError):
            self.store.publish_attempt(found["attempt_id"], attempt["fence"], "running", now=self.now)
        self.controller.dispatch(cmd["command_id"])
        self.assertEqual(len(self.backend.starts), 1)
        self.assertTrue(self.store.reservations())

    def test_final_allowed_message_and_turn_dispatch_once_and_duplicate_is_free(self):
        self.controller.put_grant(grant(revision=2, max_messages=1, max_turns=1), authenticated_operator="operator-example")
        self.backend.mode = "complete"
        first = self.accept()
        attempt = self.controller.dispatch(first["command_id"])
        self.assertEqual(attempt["state"], "awaiting_review")
        self.assertEqual(first["command_id"], self.accept()["command_id"])
        with self.assertRaises((AdmissionError, ValueError)):
            self.accept(request(step_id="write-1"))
        self.assertEqual(self.store.usage("job-example")["messages"], 1)
        self.assertEqual(self.store.usage("job-example")["turns"], 1)
        self.assertEqual(len(self.backend.starts), 1)

    def test_changed_command_envelope_is_not_hidden_by_same_input_text(self):
        self.accept()
        changes = [dict(ac_revision=2), dict(operation="rework"),
                   dict(resource_scopes={"workspace-a": {"read": ["tests"], "write": ["src"]}}),
                   dict(session_binding_id="session-write-0")]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ConflictError):
                self.accept(request(**change))
        self.assertEqual(len(self.store.commands()), 1)
        self.assertEqual(len(self.store.outbox_rows()), 1)
        self.assertEqual(self.backend.starts, [])

    def test_wider_renewed_grant_does_not_widen_stored_request(self):
        cmd = self.accept()
        broad = grant(revision=2, route_ids=["route-a", "route-b"],
                      resource_scopes={"workspace-a": {"read": ["."], "write": ["."]}})
        self.controller.put_grant(broad, authenticated_operator="operator-example")
        self.controller.dispatch(cmd["command_id"])
        self.assertEqual(self.store.attempts()[0]["route"]["worker_id"], "worker-a")
        self.assertEqual(len(self.backend.starts), 1)
        envelope = self.store.command(cmd["command_id"])["input_payload"]
        self.assertEqual(envelope["resource_scopes"]["workspace-a"]["write"], ["src"])

    def test_trusted_session_binding_mismatch_blocks_admission(self):
        for index, (key, value) in enumerate([("job_id", "other-job"), ("worker_id", "worker-b"), ("account_ref", "account-b")]):
            row = records()["sessions"]["session-a"]
            row["revision"] = 2 + index * 2
            row[key] = value
            self.controller.register("sessions", "session-a", row)
            with self.subTest(key=key), self.assertRaises((AdmissionError, ValueError)):
                self.accept()
            row = records()["sessions"]["session-a"]
            row["revision"] = 3 + index * 2
            self.controller.register("sessions", "session-a", row)
        self.assertEqual(self.store.commands(), [])
        self.assertEqual(self.backend.starts, [])

    def test_unknown_cancellation_without_stop_proof_is_rejected(self):
        self.backend.mode = "accept_then_raise"
        cmd = self.accept()
        attempt = self.controller.dispatch(cmd["command_id"])
        with self.assertRaises((ConflictError, ValueError)):
            self.store.publish_attempt(attempt["attempt_id"], attempt["fence"], "cancelled", now=self.now)
        self.assertEqual(self.store.attempt(attempt["attempt_id"])["state"], "outcome_unknown")
        self.assertTrue(self.store.reservations())

    def test_stop_proof_is_exact_operation_and_strict_boolean(self):
        cmd = self.accept()
        attempt = self.controller.dispatch(cmd["command_id"])
        proofs = [{"operation_id": "wrong", "stopped": True, "effects_resolved": True},
                  {"operation_id": attempt["operation_id"], "stopped": "true", "effects_resolved": True},
                  {"operation_id": attempt["operation_id"], "stopped": True},
                  {"operation_id": attempt["operation_id"], "stopped": True, "effects_resolved": "true"}]
        for proof in proofs:
            with self.subTest(proof=proof), self.assertRaises((ConflictError, ValueError)):
                self.store.confirm_stop(attempt["attempt_id"], evidence=proof, effects_resolved=True, now=self.now)
            self.assertTrue(self.store.reservations())
        proof = {"operation_id": attempt["operation_id"], "stopped": True, "effects_resolved": False}
        self.store.confirm_stop(attempt["attempt_id"], evidence=proof, effects_resolved=False, now=self.now)
        self.assertTrue(self.store.reservations())

    def test_audit_failure_leaves_no_intent_reservation_or_start(self):
        cmd = self.accept()
        def fail(point):
            if point == "audit_before_write":
                raise RuntimeError("synthetic audit failure")
        self.store.fault = fail
        with self.assertRaises(RuntimeError):
            self.controller.dispatch(cmd["command_id"])
        self.store.fault = None
        self.assertEqual(self.store.attempts(), [])
        self.assertEqual(self.active_reservations(), [])
        self.assertEqual(self.backend.starts, [])

    def test_reconcile_uses_original_operation_without_start(self):
        self.backend.mode = "accept_then_raise"
        cmd = self.accept()
        attempt = self.controller.dispatch(cmd["command_id"])
        self.backend.finish(attempt["operation_id"], {"candidate": "synthetic"})
        self.now = attempt["lease_until"] + 1
        self.store.expire_leases(self.now)
        result = self.controller.reconcile(attempt["attempt_id"])
        self.assertEqual(result["state"], "awaiting_review")
        self.assertEqual(result["operation_id"], attempt["operation_id"])
        self.assertEqual(len(self.backend.starts), 1)
        self.assertEqual(self.active_reservations(), [])

    def test_missing_inspection_after_restart_holds_unknown(self):
        self.backend.mode = "accept_then_raise"
        cmd = self.accept()
        attempt = self.controller.dispatch(cmd["command_id"])
        self.backend.inspect_available = False
        result = self.controller.reconcile(attempt["attempt_id"])
        self.assertEqual(result["state"], "outcome_unknown")
        self.assertTrue(self.store.reservations())
        self.assertEqual(len(self.backend.starts), 1)

    def test_api_workflow_hop_cannot_be_reset_in_agent_body(self):
        review_grant = grant(revision=2, worker_id="worker-b", route_ids=["route-b"],
            resource_scopes={"workspace-b": {"read": ["snapshot"], "write": []}},
            operations=["review"], allowed_steps=["review-0"], allow_agent_trigger=True,
            allowed_callers=["worker-a"], max_hops=1)
        self.controller.put_grant(review_grant, authenticated_operator="operator-example")
        req = request(sender="worker-a", origin="agent", worker_id="worker-b", route_id="route-b",
            step_id="review-0", operation="review", session_binding_id="session-b", hop=0,
            resource_scopes={"workspace-b": {"read": ["snapshot"], "write": []}})
        with self.assertRaises((AdmissionError, ValueError)):
            self.controller.accept(req, authenticated_caller="worker-a")
        self.assertEqual(self.backend.starts, [])
        req["hop"] = 1
        cmd = self.controller.accept(req, authenticated_caller="worker-a")
        self.controller.dispatch(cmd["command_id"])
        self.assertEqual(len(self.backend.starts), 1)
        self.assertEqual(len(self.store.commands()), 1)

    def review_request(self, **updates):
        return request(worker_id="worker-b", route_id="route-b", step_id="review-0",
            operation="review", session_binding_id="session-b", hop=1,
            resource_scopes={"workspace-b": {"read": ["snapshot"], "write": []}},
            **updates)

    def install_review_grant(self):
        self.controller.put_grant(grant(grant_id="grant-review", worker_id="worker-b", route_ids=["route-b"],
            operations=["review"], allowed_steps=["review-0"],
            resource_scopes={"workspace-b": {"read": ["snapshot"], "write": []}}),
            authenticated_operator="operator-example")

    def test_fake_01_shared_pool_minimum_is_shared_across_distinct_accounts(self):
        entitlement = records()["entitlements"]["entitlement-a"]
        entitlement.update(revision=2, concurrency_limit=1)
        self.controller.register("entitlements", "entitlement-a", entitlement)
        other = records()["entitlements"]["entitlement-b"]
        other.update(revision=2, concurrency_limit=5)
        self.controller.register("entitlements", "entitlement-b", other)
        for key in ["route-a", "route-b"]:
            route = records()["routes"][key]
            route["revision"] = 2
            route["evidence"]["route_revision"] = 2
            route["evidence"]["entitlement_revision"] = 2
            self.controller.register("routes", key, route)
        first = self.accept(request(route_revision=2, entitlement_revision=2))
        self.controller.dispatch(first["command_id"])
        self.install_review_grant()
        second = self.accept(self.review_request(grant_id="grant-review", route_revision=2, entitlement_revision=2))
        with self.assertRaises((ConflictError, ValueError)):
            self.controller.dispatch(second["command_id"])
        self.assertEqual(len(self.backend.starts), 1)
        self.assertEqual(len(self.store.attempts()), 1)
        self.assertTrue(self.store.reservations())

    def test_fake_08_workspace_aliases_cannot_make_a_second_physical_slot(self):
        other = records()["resources"]["workspace-b"]
        other.update(revision=2, binding_key="workspace-physical-a")
        self.controller.register("resources", "workspace-b", other)
        first = self.accept()
        self.controller.dispatch(first["command_id"])
        self.install_review_grant()
        second = self.accept(self.review_request(grant_id="grant-review"))
        with self.assertRaises((ConflictError, ValueError)):
            self.controller.dispatch(second["command_id"])
        self.assertEqual(len(self.backend.starts), 1)
        self.assertEqual(len(self.store.attempts()), 1)

    def test_pre_start_revocation_records_never_started_proof(self):
        cmd=self.accept()
        revoked=[]
        def clock():
            if not revoked and self.store.attempts():
                revoked.append(True)
                self.controller.put_grant(grant(revision=2,revoked=True),authenticated_operator='operator-example')
            return self.now
        self.controller.clock=clock
        try:
            self.controller.dispatch(cmd['command_id'])
        except AdmissionError:
            pass
        self.assertTrue(revoked)
        self.assertEqual(self.backend.starts, [])
        self.assertEqual(len(self.store.attempts()),1)
        attempt=self.store.attempts()[0]
        self.assertEqual(attempt['state'],'cancelled')
        self.assertTrue(attempt['stop_proven'])
        self.assertTrue(attempt['effects_resolved'])
        self.assertEqual(self.active_reservations(), [])

    def test_concurrent_same_command_dispatch_has_one_start(self):
        cmd=self.accept()
        barrier=threading.Barrier(2)
        results=[]
        errors=[]
        def dispatch():
            try:
                barrier.wait(timeout=5)
                results.append(self.controller.dispatch(cmd['command_id']))
            except Exception as exc:
                errors.append(exc)
        threads=[threading.Thread(target=dispatch) for _ in range(2)]
        for thread in threads: thread.start()
        for thread in threads:
            thread.join(5)
            self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(len(self.backend.starts),1)
        self.assertEqual(len(self.store.attempts()),1)
        self.assertEqual(len({row['operation_id'] for row in results}),1)

if __name__ == "__main__":
    unittest.main()
