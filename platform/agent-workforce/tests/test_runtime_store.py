"""Focused lifecycle tests for the RuntimeStore mixin."""
import os
import tempfile
import threading
import unittest

from agent_workforce.runtime_store import RuntimeStore
from agent_workforce.storage_base import ConflictError, StaleFenceError, StorageBase, StoreError


class TestStore(RuntimeStore, StorageBase):
    """Lifecycle mixin over the shared storage boundary, with no core Store."""


def resources_for(marker, *, quota_key="pool", quota_capacity=1, workspace_key=None, session_key=None, job_capacity=1):
    return [
        {"kind": "job", "key": "job-" + marker, "capacity": job_capacity},
        {"kind": "account", "key": "account-" + marker, "capacity": 1},
        {"kind": "quota_pool", "key": quota_key, "capacity": quota_capacity},
        {"kind": "session", "key": session_key or ("session-" + marker), "capacity": 1},
        {"kind": "workspace", "key": workspace_key or ("workspace-" + marker), "capacity": 1},
    ]


def command_state(store, command_id):
    with store._lock:
        row = store._db.execute(
            "SELECT state FROM commands WHERE command_id=?",
            (command_id,),
        ).fetchone()
    if row is None:
        return None
    return row["state"]


class RuntimeStoreTests(unittest.TestCase):
    def make(self, fault=None, path=":memory:"):
        store = TestStore(path, fault=fault)
        self.addCleanup(store.close)
        return store

    def path(self):
        handle = tempfile.NamedTemporaryFile(prefix="t015-runtime-", suffix=".db", delete=False)
        handle.close()
        self.addCleanup(lambda: os.remove(handle.name) if os.path.exists(handle.name) else None)
        return handle.name

    def add_command(self, store, command_id, job_id, step_id, state="queued"):
        store._db.execute(
            """INSERT INTO commands(
                command_id, job_id, step_id, input_digest, input_payload, worker_id, route_policy, grant_id, state
            ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (command_id, job_id, step_id, "digest", "{}", "worker", "{}", "grant", state),
        )

    def prepare(self, store, command_id, marker, *, now=10, lease_until=100, quota_key="pool", quota_capacity=1,
                workspace_key=None, session_key=None, route=None, grant=None, job_capacity=1):
        return store.prepare_attempt(
            command_id,
            route={"route_id": "route-1"} if route is None else route,
            grant={"grant_id": "grant-1"} if grant is None else grant,
            resources=resources_for(
                marker,
                quota_key=quota_key,
                quota_capacity=quota_capacity,
                workspace_key=workspace_key,
                session_key=session_key,
                job_capacity=job_capacity,
            ),
            now=now,
            lease_until=lease_until,
        )

    def test_prepare_commits_immutable_snapshots(self):
        path = self.path()
        store = self.make(path=path)
        self.add_command(store, "cmd-1", "job-1", "step-1")
        route = {"route_id": "route-1", "nested": {"revision": 1}}
        grant = {"grant_id": "grant-1", "scopes": ["read"]}
        prepared = self.prepare(store, "cmd-1", "a", route=route, grant=grant)
        route["nested"]["revision"] = 9
        grant["scopes"].append("admin")
        self.assertEqual(prepared["state"], "dispatch_prepared")
        self.assertIs(prepared["stop_proven"], False)
        self.assertIs(prepared["effects_resolved"], False)
        self.assertIsNone(prepared["result"])
        self.assertEqual(prepared["route"], {"route_id": "route-1", "nested": {"revision": 1}})
        self.assertEqual(prepared["grant"], {"grant_id": "grant-1", "scopes": ["read"]})
        self.assertEqual(prepared["fence"], 1)
        self.assertEqual(prepared["controller_epoch"], store.controller_epoch)
        self.assertEqual(command_state(store, "cmd-1"), "dispatch_prepared")
        self.assertEqual(len(store.reservations()), 5)
        self.assertTrue(all(row["released"] is False for row in store.reservations()))
        self.assertIs(store.reservations()[0]["released"], False)
        prepared["route"]["nested"]["revision"] = 3
        reloaded = store.attempt(prepared["attempt_id"])
        self.assertEqual(reloaded, store.attempts()[0])
        self.assertEqual(reloaded["route"]["nested"]["revision"], 1)
        self.assertIs(reloaded["stop_proven"], False)
        with self.assertRaises(ConflictError):
            self.prepare(store, "cmd-1", "b", quota_key="other-pool", workspace_key="other-workspace")
        self.assertEqual(len(store.attempts()), 1)
        self.assertEqual(store.audit_rows()[0]["kind"], "attempt_prepared")
        self.assertEqual(store.audit_rows()[0]["action"], "attempt_prepared")
        store.close()
        reopened = self.make(path=path)
        durable = reopened.attempt(prepared["attempt_id"])
        self.assertEqual(durable["operation_id"], prepared["operation_id"])
        self.assertEqual(durable["route"], {"route_id": "route-1", "nested": {"revision": 1}})
        self.assertEqual(durable["grant"], {"grant_id": "grant-1", "scopes": ["read"]})
        self.assertEqual(durable["state"], "dispatch_prepared")
        self.assertEqual(len(reopened.reservations()), 5)
        self.assertIsNone(reopened.attempt("missing"))
        with self.assertRaises(StoreError):
            self.prepare(reopened, "missing-command", "z")

    def test_minimum_shared_capacity_and_duplicate_resources(self):
        store = self.make()
        for index in range(1, 6):
            self.add_command(store, "cmd-%s" % index, "job-%s" % index, "step-%s" % index)
        self.prepare(store, "cmd-1", "a", quota_capacity=2)
        self.prepare(store, "cmd-2", "b", quota_capacity=5)
        with self.assertRaises(ConflictError):
            self.prepare(store, "cmd-3", "c", quota_capacity=9)
        with self.assertRaises(ConflictError):
            self.prepare(store, "cmd-4", "d", quota_capacity=1)
        self.assertEqual(len(store.attempts()), 2)
        duplicate = resources_for("dup")
        duplicate[1] = {"kind": "job", "key": "job-other", "capacity": 1}
        with self.assertRaises(StoreError):
            store.prepare_attempt(
                "cmd-5",
                route={"route_id": "route-1"},
                grant={"grant_id": "grant-1"},
                resources=duplicate,
                now=10,
                lease_until=40,
            )
        workspace = resources_for("cap")
        workspace[4] = {"kind": "workspace", "key": "workspace-cap", "capacity": 2}
        with self.assertRaises(StoreError):
            store.prepare_attempt(
                "cmd-5",
                route={"route_id": "route-1"},
                grant={"grant_id": "grant-1"},
                resources=workspace,
                now=10,
                lease_until=40,
            )
        with self.assertRaises(StoreError):
            self.prepare(store, "cmd-5", "time", now=10, lease_until=10)
        self.assertEqual(len(store.attempts()), 2)

    def test_threaded_workspace_contention(self):
        store = self.make()
        self.add_command(store, "cmd-1", "job-1", "step-1")
        self.add_command(store, "cmd-2", "job-2", "step-2")
        barrier = threading.Barrier(2)
        outcome = []
        outcome_lock = threading.Lock()

        def run(command_id, marker):
            barrier.wait()
            try:
                prepared = self.prepare(store, command_id, marker, workspace_key="shared-workspace")
            except ConflictError as exc:
                with outcome_lock:
                    outcome.append(("conflict", type(exc).__name__))
            else:
                with outcome_lock:
                    outcome.append(("ok", prepared["attempt_id"]))

        threads = [
            threading.Thread(target=run, args=("cmd-1", "t1")),
            threading.Thread(target=run, args=("cmd-2", "t2")),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(30)
            self.assertFalse(thread.is_alive())
        self.assertEqual(sorted(item[0] for item in outcome), ["conflict", "ok"])
        active = [
            row for row in store.reservations()
            if row["kind"] == "workspace" and row["released"] is False
        ]
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]["key"], "shared-workspace")
        self.assertEqual(len(store.attempts()), 1)

    def test_expiry_holds_original_ids_and_claim_is_monotonic(self):
        store = self.make()
        self.add_command(store, "cmd-run", "job-run", "step-run")
        self.add_command(store, "cmd-stop", "job-stop", "step-stop")
        self.add_command(store, "cmd-review", "job-review", "step-review")
        self.add_command(store, "cmd-fresh", "job-fresh", "step-fresh")
        running = self.prepare(store, "cmd-run", "run", lease_until=30)
        store.publish_attempt(running["attempt_id"], running["fence"], "running", now=11, result={"kept": 1})
        stopping = self.prepare(store, "cmd-stop", "stop", quota_key="pool-stop", lease_until=30)
        store.publish_attempt(stopping["attempt_id"], stopping["fence"], "running", now=12)
        store.publish_attempt(stopping["attempt_id"], stopping["fence"], "stopping", now=13)
        review = self.prepare(store, "cmd-review", "review", quota_key="pool-review", lease_until=80)
        store.publish_attempt(review["attempt_id"], review["fence"], "running", now=14)
        store.publish_attempt(
            review["attempt_id"], review["fence"], "awaiting_review", now=15, result={"review": True}
        )
        fresh = self.prepare(store, "cmd-fresh", "fresh", quota_key="pool-fresh", lease_until=80)
        with self.assertRaises(ConflictError):
            store.claim_lease(running["attempt_id"], now=16, lease_until=90)
        self.assertEqual(store.attempt(running["attempt_id"])["fence"], running["fence"])
        store.expire_leases(30)
        expired = store.attempt(running["attempt_id"])
        self.assertEqual(expired["state"], "outcome_unknown")
        self.assertEqual(expired["attempt_id"], running["attempt_id"])
        self.assertEqual(expired["operation_id"], running["operation_id"])
        self.assertEqual(expired["fence"], running["fence"])
        self.assertEqual(expired["result"], {"kept": 1})
        self.assertIs(expired["stop_proven"], False)
        self.assertTrue(all(
            row["released"] is False
            for row in store.reservations()
            if row["attempt_id"] == running["attempt_id"]
        ))
        self.assertEqual(command_state(store, "cmd-run"), "outcome_unknown")
        self.assertEqual(store.attempt(stopping["attempt_id"])["state"], "outcome_unknown")
        self.assertEqual(store.attempt(stopping["attempt_id"])["fence"], stopping["fence"])
        held_review = store.attempt(review["attempt_id"])
        self.assertEqual(held_review["state"], "awaiting_review")
        self.assertEqual(held_review["result"], {"review": True})
        self.assertEqual(store.attempt(fresh["attempt_id"])["state"], "dispatch_prepared")
        with self.assertRaises(StaleFenceError):
            store.publish_attempt(running["attempt_id"], running["fence"], "running", now=31)
        claimed = store.claim_lease(running["attempt_id"], now=31, lease_until=120)
        self.assertGreater(claimed, fresh["fence"])
        after_claim = store.attempt(running["attempt_id"])
        self.assertEqual(after_claim["fence"], claimed)
        self.assertEqual(after_claim["operation_id"], running["operation_id"])
        self.assertEqual(after_claim["state"], "outcome_unknown")
        self.assertEqual(after_claim["result"], {"kept": 1})
        store.publish_attempt(running["attempt_id"], claimed, "failed", now=32, result=None)
        failed = store.attempt(running["attempt_id"])
        self.assertEqual(failed["state"], "failed")
        self.assertEqual(failed["result"], {"kept": 1})
        self.assertTrue(all(
            row["released"] is False
            for row in store.reservations()
            if row["attempt_id"] == running["attempt_id"]
        ))

    def test_stale_fence_epoch_and_same_state_noop(self):
        path = self.path()
        store = self.make(path=path)
        self.add_command(store, "cmd-1", "job-1", "step-1")
        prepared = self.prepare(store, "cmd-1", "a", lease_until=50)
        with self.assertRaises(StaleFenceError):
            store.publish_attempt(prepared["attempt_id"], prepared["fence"] + 1, "running", now=11)
        with self.assertRaises(StaleFenceError):
            store.publish_attempt(prepared["attempt_id"], prepared["fence"], "running", now=50)
        self.assertEqual(store.attempt(prepared["attempt_id"])["state"], "dispatch_prepared")
        store.publish_attempt(prepared["attempt_id"], prepared["fence"], "running", now=12, result={"n": 1})
        store.publish_attempt(prepared["attempt_id"], prepared["fence"], "running", now=13, result=None)
        self.assertEqual(store.attempt(prepared["attempt_id"])["result"], {"n": 1})
        self.assertEqual(store.attempt(prepared["attempt_id"])["state"], "running")
        with self.assertRaises(StaleFenceError):
            store.publish_attempt(prepared["attempt_id"], prepared["fence"], "running", now=50)
        with self.assertRaises(StoreError):
            store.publish_attempt(prepared["attempt_id"], prepared["fence"], "execution_completed", now=14)
        with self.assertRaises(StoreError):
            store.publish_attempt(prepared["attempt_id"], prepared["fence"], "cancelled", now=14)
        self.assertEqual(store.attempt(prepared["attempt_id"])["state"], "running")
        self.assertTrue(all(row["released"] is False for row in store.reservations()))
        epoch = store.controller_epoch
        fence = prepared["fence"]
        store.close()
        reopened = self.make(path=path)
        self.assertNotEqual(reopened.controller_epoch, epoch)
        with self.assertRaises(StaleFenceError):
            reopened.publish_attempt(prepared["attempt_id"], fence, "running", now=15)
        self.assertEqual(reopened.attempt(prepared["attempt_id"])["state"], "running")
        self.assertEqual(reopened.attempt(prepared["attempt_id"])["result"], {"n": 1})

    def test_strict_stop_proof_gates_cancellation_and_replacement(self):
        store = self.make()
        self.add_command(store, "cmd-1", "job-1", "step-1")
        self.add_command(store, "cmd-2", "job-2", "step-2")
        self.add_command(store, "cmd-3", "job-3", "step-3")
        prepared = self.prepare(store, "cmd-1", "a", workspace_key="ws-a")
        operation_id = prepared["operation_id"]
        coerced = [1, "true", None]
        for stopped in coerced:
            with self.subTest(stopped=stopped):
                with self.assertRaises(StoreError):
                    store.confirm_stop(
                        prepared["attempt_id"],
                        evidence={
                            "operation_id": operation_id,
                            "stopped": stopped,
                            "effects_resolved": True,
                        },
                        effects_resolved=True,
                        now=12,
                    )
        with self.assertRaises(StoreError):
            store.confirm_stop(
                prepared["attempt_id"],
                evidence={"operation_id": operation_id, "stopped": True, "effects_resolved": True},
                effects_resolved=1,
                now=12,
            )
        with self.assertRaises(StoreError):
            store.confirm_stop(
                prepared["attempt_id"],
                evidence={"operation_id": operation_id, "stopped": True, "effects_resolved": False},
                effects_resolved=True,
                now=12,
            )
        with self.assertRaises(StoreError):
            store.confirm_stop(
                prepared["attempt_id"],
                evidence={"operation_id": "other-operation", "stopped": True, "effects_resolved": True},
                effects_resolved=True,
                now=12,
            )
        untouched = store.attempt(prepared["attempt_id"])
        self.assertIs(untouched["stop_proven"], False)
        self.assertIs(untouched["effects_resolved"], False)
        self.assertTrue(all(row["released"] is False for row in store.reservations()))
        store.confirm_stop(
            prepared["attempt_id"],
            evidence={"operation_id": operation_id, "stopped": True, "effects_resolved": False},
            effects_resolved=False,
            now=13,
        )
        partial = store.attempt(prepared["attempt_id"])
        self.assertIs(partial["stop_proven"], True)
        self.assertIs(partial["effects_resolved"], False)
        self.assertEqual(partial["state"], "dispatch_prepared")
        self.assertTrue(all(row["released"] is False for row in store.reservations()))
        with self.assertRaises(StoreError):
            store.publish_attempt(prepared["attempt_id"], prepared["fence"], "cancelled", now=14)
        self.assertEqual(store.attempt(prepared["attempt_id"])["state"], "dispatch_prepared")
        store.confirm_stop(
            prepared["attempt_id"],
            evidence={
                "operation_id": operation_id,
                "stopped": True,
                "effects_resolved": True,
                "not_started": True,
            },
            effects_resolved=True,
            now=15,
        )
        proven = store.attempt(prepared["attempt_id"])
        self.assertIs(proven["stop_proven"], True)
        self.assertIs(proven["effects_resolved"], True)
        self.assertEqual(proven["state"], "dispatch_prepared")
        self.assertTrue(all(
            row["released"] is True for row in store.reservations() if row["attempt_id"] == prepared["attempt_id"]
        ))
        store.publish_attempt(prepared["attempt_id"], prepared["fence"], "cancelled", now=16)
        self.assertEqual(store.attempt(prepared["attempt_id"])["state"], "cancelled")
        self.assertEqual(command_state(store, "cmd-1"), "cancelled")
        replacement = self.prepare(store, "cmd-1", "replacement", workspace_key="ws-a", quota_key="pool")
        self.assertNotEqual(replacement["attempt_id"], prepared["attempt_id"])
        self.assertNotEqual(replacement["operation_id"], operation_id)
        history = store.reservations()
        self.assertGreater(len(history), 5)
        self.assertTrue(any(row["released"] is True for row in history))
        self.assertTrue(any(
            row["released"] is False and row["attempt_id"] == replacement["attempt_id"] for row in history
        ))

        review = self.prepare(store, "cmd-2", "review", quota_key="pool-review", workspace_key="ws-review")
        store.publish_attempt(review["attempt_id"], review["fence"], "running", now=17)
        store.publish_attempt(
            review["attempt_id"], review["fence"], "awaiting_review", now=18, result={"kept": True}
        )
        store.confirm_stop(
            review["attempt_id"],
            evidence={
                "operation_id": review["operation_id"],
                "stopped": True,
                "effects_resolved": True,
            },
            effects_resolved=True,
            now=19,
        )
        self.assertEqual(store.attempt(review["attempt_id"])["state"], "awaiting_review")
        self.assertEqual(store.attempt(review["attempt_id"])["result"], {"kept": True})
        with self.assertRaises(ConflictError):
            self.prepare(store, "cmd-2", "blocked", quota_key="pool-other", workspace_key="ws-other")
        sibling = self.prepare(store, "cmd-3", "sibling", quota_key="pool-review", workspace_key="ws-review")
        self.assertEqual(sibling["state"], "dispatch_prepared")
        store.publish_attempt(review["attempt_id"], review["fence"], "execution_completed", now=20)
        completed = self.prepare(store, "cmd-2", "after-complete", quota_key="pool-free", workspace_key="ws-free")
        self.assertEqual(store.attempt(review["attempt_id"])["state"], "execution_completed")
        self.assertNotEqual(completed["attempt_id"], review["attempt_id"])
        self.assertNotEqual(completed["operation_id"], review["operation_id"])

    def test_not_started_proof_rejected_after_start_and_failed_replacement(self):
        store = self.make()
        self.add_command(store, "cmd-1", "job-1", "step-1")
        prepared = self.prepare(store, "cmd-1", "a", workspace_key="ws-failed")
        store.publish_attempt(prepared["attempt_id"], prepared["fence"], "running", now=11)
        with self.assertRaises(StoreError):
            store.confirm_stop(
                prepared["attempt_id"],
                evidence={
                    "operation_id": prepared["operation_id"],
                    "stopped": True,
                    "effects_resolved": True,
                    "not_started": True,
                },
                effects_resolved=True,
                now=12,
            )
        self.assertIs(store.attempt(prepared["attempt_id"])["stop_proven"], False)
        self.assertTrue(all(row["released"] is False for row in store.reservations()))
        store.publish_attempt(prepared["attempt_id"], prepared["fence"], "failed", now=13, result={"err": "x"})
        with self.assertRaises(ConflictError):
            self.prepare(store, "cmd-1", "early", workspace_key="ws-failed", quota_key="pool-2")
        store.confirm_stop(
            prepared["attempt_id"],
            evidence={
                "operation_id": prepared["operation_id"],
                "stopped": True,
                "effects_resolved": True,
            },
            effects_resolved=True,
            now=14,
        )
        self.assertEqual(store.attempt(prepared["attempt_id"])["state"], "failed")
        self.assertEqual(store.attempt(prepared["attempt_id"])["result"], {"err": "x"})
        replacement = self.prepare(store, "cmd-1", "again", workspace_key="ws-failed")
        self.assertNotEqual(replacement["operation_id"], prepared["operation_id"])
        released = [
            row for row in store.reservations()
            if row["attempt_id"] == prepared["attempt_id"]
        ]
        self.assertTrue(released)
        self.assertTrue(all(row["released"] is True for row in released))

    def test_released_snapshot_does_not_keep_shared_limit(self):
        store = self.make()
        self.add_command(store, "cmd-1", "job-1", "step-1")
        self.add_command(store, "cmd-2", "job-2", "step-2")
        self.add_command(store, "cmd-3", "job-3", "step-3")
        self.add_command(store, "cmd-4", "job-4", "step-4")
        low = self.prepare(store, "cmd-1", "low", quota_capacity=2, workspace_key="ws-low")
        self.prepare(store, "cmd-2", "high", quota_capacity=4, workspace_key="ws-high")
        with self.assertRaises(ConflictError):
            self.prepare(store, "cmd-3", "overflow", quota_capacity=4, workspace_key="ws-next")
        store.confirm_stop(
            low["attempt_id"],
            evidence={
                "operation_id": low["operation_id"],
                "stopped": True,
                "effects_resolved": True,
                "not_started": True,
            },
            effects_resolved=True,
            now=12,
        )
        store.publish_attempt(low["attempt_id"], low["fence"], "cancelled", now=13)
        allowed = self.prepare(store, "cmd-3", "after-release", quota_capacity=4, workspace_key="ws-next")
        also_allowed = self.prepare(store, "cmd-4", "after-release-2", quota_capacity=4, workspace_key="ws-later")
        self.assertEqual(allowed["state"], "dispatch_prepared")
        self.assertEqual(also_allowed["state"], "dispatch_prepared")

    def test_recovery_preserves_result_and_releases_nothing(self):
        path = self.path()
        store = self.make(path=path)
        self.add_command(store, "cmd-run", "job-run", "step-run")
        self.add_command(store, "cmd-review", "job-review", "step-review")
        self.add_command(store, "cmd-prep", "job-prep", "step-prep")
        self.add_command(store, "cmd-stop", "job-stop", "step-stop")
        running = self.prepare(store, "cmd-run", "run", quota_key="pool-run")
        store.publish_attempt(running["attempt_id"], running["fence"], "running", now=11, result={"kept": 1})
        review = self.prepare(store, "cmd-review", "review", quota_key="pool-review")
        store.publish_attempt(review["attempt_id"], review["fence"], "running", now=12)
        store.publish_attempt(
            review["attempt_id"], review["fence"], "awaiting_review", now=13, result={"review": True}
        )
        prepared = self.prepare(store, "cmd-prep", "prep", quota_key="pool-prep")
        stopping = self.prepare(store, "cmd-stop", "stop", quota_key="pool-stop")
        store.publish_attempt(stopping["attempt_id"], stopping["fence"], "running", now=14)
        store.publish_attempt(
            stopping["attempt_id"], stopping["fence"], "stopping", now=15, result={"partial": True}
        )
        store.close()
        reopened = self.make(path=path)
        with self.assertRaises(StaleFenceError):
            reopened.publish_attempt(running["attempt_id"], running["fence"], "failed", now=16)
        reopened.recover_attempts(16)
        recovered = reopened.attempt(running["attempt_id"])
        self.assertEqual(recovered["state"], "outcome_unknown")
        self.assertEqual(recovered["attempt_id"], running["attempt_id"])
        self.assertEqual(recovered["operation_id"], running["operation_id"])
        self.assertEqual(recovered["fence"], running["fence"])
        self.assertEqual(recovered["result"], {"kept": 1})
        self.assertEqual(recovered["route"], running["route"])
        self.assertEqual(recovered["grant"], running["grant"])
        self.assertTrue(all(
            row["released"] is False
            for row in reopened.reservations()
            if row["attempt_id"] == running["attempt_id"]
        ))
        self.assertEqual(command_state(reopened, "cmd-run"), "outcome_unknown")
        reviewed = reopened.attempt(review["attempt_id"])
        self.assertEqual(reviewed["state"], "awaiting_review")
        self.assertEqual(reviewed["result"], {"review": True})
        self.assertEqual(reviewed["fence"], review["fence"])
        self.assertTrue(all(
            row["released"] is False
            for row in reopened.reservations()
            if row["attempt_id"] == review["attempt_id"]
        ))
        self.assertEqual(reopened.attempt(prepared["attempt_id"])["state"], "outcome_unknown")
        self.assertEqual(reopened.attempt(prepared["attempt_id"])["operation_id"], prepared["operation_id"])
        stopped = reopened.attempt(stopping["attempt_id"])
        self.assertEqual(stopped["state"], "outcome_unknown")
        self.assertEqual(stopped["result"], {"partial": True})
        self.assertEqual(stopped["fence"], stopping["fence"])
        self.add_command(reopened, "cmd-new", "job-new", "step-new")
        current = self.prepare(reopened, "cmd-new", "current", quota_key="pool-current")
        reopened.recover_attempts(17)
        self.assertEqual(reopened.attempt(current["attempt_id"])["state"], "dispatch_prepared")
        self.assertEqual(reopened.attempt(running["attempt_id"])["result"], {"kept": 1})
        claimed = reopened.claim_lease(running["attempt_id"], now=18, lease_until=90)
        self.assertGreater(claimed, current["fence"])
        self.assertEqual(reopened.attempt(running["attempt_id"])["operation_id"], running["operation_id"])
        self.assertTrue(all(
            row["released"] is False
            for row in reopened.reservations()
            if row["attempt_id"] == running["attempt_id"]
        ))
        reopened.publish_attempt(running["attempt_id"], claimed, "running", now=19, result=None)
        self.assertEqual(reopened.attempt(running["attempt_id"])["result"], {"kept": 1})
        self.assertEqual(reopened.attempt(running["attempt_id"])["state"], "running")

    def test_fault_and_audit_rollback(self):
        self.assert_prepare_rolls_back("attempt_before_commit")
        self.assert_prepare_rolls_back("audit_before_write")

        audits = {"count": 0}

        def expire_fault(point):
            if point == "audit_before_write":
                audits["count"] += 1
                if audits["count"] >= 3:
                    raise StoreError("audit failed")

        store = self.make(fault=expire_fault)
        self.add_command(store, "cmd-1", "job-1", "step-1")
        prepared = self.prepare(store, "cmd-1", "a", lease_until=30)
        store.publish_attempt(prepared["attempt_id"], prepared["fence"], "running", now=11, result={"kept": 2})
        with self.assertRaises(StoreError):
            store.expire_leases(30)
        seen = store.attempt(prepared["attempt_id"])
        self.assertEqual(seen["state"], "running")
        self.assertEqual(seen["result"], {"kept": 2})
        self.assertEqual(seen["fence"], prepared["fence"])
        self.assertTrue(all(row["released"] is False for row in store.reservations()))
        self.assertEqual(command_state(store, "cmd-1"), "running")

        stop_audits = {"count": 0}

        def stop_fault(point):
            if point == "audit_before_write":
                stop_audits["count"] += 1
                if stop_audits["count"] >= 2:
                    raise StoreError("audit failed")

        proof_store = self.make(fault=stop_fault)
        self.add_command(proof_store, "cmd-1", "job-1", "step-1")
        started = self.prepare(proof_store, "cmd-1", "proof")
        with self.assertRaises(StoreError):
            proof_store.confirm_stop(
                started["attempt_id"],
                evidence={
                    "operation_id": started["operation_id"],
                    "stopped": True,
                    "effects_resolved": True,
                    "not_started": True,
                },
                effects_resolved=True,
                now=12,
            )
        untouched = proof_store.attempt(started["attempt_id"])
        self.assertIs(untouched["stop_proven"], False)
        self.assertIs(untouched["effects_resolved"], False)
        self.assertEqual(untouched["state"], "dispatch_prepared")
        self.assertTrue(all(row["released"] is False for row in proof_store.reservations()))
        self.assertEqual(len(proof_store.audit_rows()), 1)

    def assert_prepare_rolls_back(self, point_name):
        def fault(point):
            if point == point_name:
                raise StoreError("injected " + point_name)

        store = self.make(fault=fault)
        self.add_command(store, "cmd-1", "job-1", "step-1")
        with self.assertRaises(StoreError):
            self.prepare(store, "cmd-1", "a")
        self.assertEqual(store.attempts(), [])
        self.assertEqual(store.reservations(), [])
        self.assertEqual(store.audit_rows(), [])
        self.assertEqual(command_state(store, "cmd-1"), "queued")


if __name__ == "__main__":
    unittest.main()
