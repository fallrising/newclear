"""Behavioral tests for the SQLite durable store. No domain or controller imports."""

import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path

from agent_workforce.store import ConflictError, StaleFenceError, Store, StoreError


def _record(revision, **extra):
    record = {"revision": revision, "owner": "owner-1", "name": "synthetic"}
    record.update(extra)
    return record


class StoreTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self._tmp.name) / "workforce.sqlite")
        self.store = Store(self.path)

    def tearDown(self):
        self.store.close()
        self._tmp.cleanup()

    def _reopen(self, fault=None):
        self.store.close()
        self.store = Store(self.path, fault=fault)
        return self.store

    def _external_count(self, table):
        connection = sqlite3.connect(self.path)
        try:
            return connection.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
        finally:
            connection.close()

    def _envelope(self, **overrides):
        envelope = {
            "message_id": "msg-1",
            "sender": "worker-a",
            "recipients": ["worker-b", "worker-a"],
            "body": {"hello": "world"},
            "expires_at": 5000,
            "kind": "question",
        }
        envelope.update(overrides)
        return envelope

    def _receive(self, store=None, envelope=None, recipient="worker-b", sender="worker-a"):
        store = self.store if store is None else store
        envelope = self._envelope() if envelope is None else envelope
        return store.receive_message(sender, envelope, recipient)

    def _accept(self, store=None, step="step-1", payload=None, grant="grant-1",
                worker="worker-a", job="job-1", route=None):
        store = self.store if store is None else store
        return store.accept_command(
            job,
            step,
            {"value": 1} if payload is None else payload,
            worker_id=worker,
            route_policy={"route_id": "route-1", "limits": {"turns": 2}} if route is None else route,
            grant_id=grant,
        )

    def _resources(self, **overrides):
        values = {
            "job": ("job-1", 8),
            "account": ("acct-1", 8),
            "quota_pool": ("pool-1", 8),
            "session": ("sess-1", 1),
            "workspace": ("ws-1", 1),
        }
        values.update(overrides)
        return [{"kind": kind, "key": key, "capacity": capacity} for kind, (key, capacity) in values.items()]

    def _prepare(self, command_id, store=None, resources=None, now=100, lease_until=200,
                 route=None, grant=None):
        store = self.store if store is None else store
        return store.prepare_attempt(
            command_id,
            route={"route_id": "route-1", "model": "synthetic"} if route is None else route,
            grant={"grant_id": "grant-1", "revision": 1} if grant is None else grant,
            resources=self._resources() if resources is None else resources,
            now=now,
            lease_until=lease_until,
        )

    def _active(self, store=None, kind=None, key=None):
        store = self.store if store is None else store
        rows = [row for row in store.reservations() if not row["released"]]
        if kind is not None:
            rows = [row for row in rows if row["kind"] == kind]
        if key is not None:
            rows = [row for row in rows if row["key"] == key]
        return rows

    def test_record_revision_idempotency_conflict_and_reopen(self):
        stored = self.store.put_record("workers", "worker-a", _record(1, role="writer"))
        self.assertEqual(stored["role"], "writer")
        again = self.store.put_record("workers", "worker-a", {"role": "writer", "owner": "owner-1",
                                                               "name": "synthetic", "revision": 1})
        self.assertEqual(again, stored)
        self.assertEqual(len(self.store.audit_rows()), 1)

        with self.assertRaises(ConflictError):
            self.store.put_record("workers", "worker-a", _record(1, role="reviewer"))
        with self.assertRaises(ConflictError):
            self.store.put_record("workers", "worker-a", _record(1, role="writer", extra=True))
        self.assertEqual(self.store.get_record("workers", "worker-a")["role"], "writer")

        updated = self.store.put_record("workers", "worker-a", _record(2, role="reviewer"))
        self.assertEqual(updated["revision"], 2)
        self.assertEqual(self.store.records("workers")["worker-a"]["role"], "reviewer")
        self.assertIsNone(self.store.get_record("workers", "missing"))
        self.assertEqual(self.store.records("jobs"), {})

        fetched = self.store.get_record("workers", "worker-a")
        fetched["role"] = "mutated"
        self.assertEqual(self.store.get_record("workers", "worker-a")["role"], "reviewer")

        with self.assertRaises(StoreError):
            self.store.put_record("workers", "worker-b", _record(True))
        with self.assertRaises(StoreError):
            self.store.put_record("workers", "worker-b", {"revision": 0, "owner": "owner-1"})

        self._reopen()
        self.assertEqual(self.store.get_record("workers", "worker-a")["revision"], 2)
        self.assertEqual(self.store.get_record("workers", "worker-a")["role"], "reviewer")

    def test_inbox_digest_conflict_durability_and_no_expiry_collection(self):
        first = self._receive()
        self.assertEqual(first["state"], "stored")
        self.assertEqual(first["sender"], "worker-a")
        self.assertEqual(first["message_id"], "msg-1")
        self.assertEqual(first["recipient"], "worker-b")
        self.assertEqual(len(first["payload_digest"]), 64)
        self.assertEqual(self._external_count("inbox"), 1)

        reordered = self._envelope()
        reordered = {
            "expires_at": reordered["expires_at"],
            "kind": reordered["kind"],
            "body": {"hello": "world"},
            "recipients": ["worker-b", "worker-a"],
            "sender": "worker-a",
            "message_id": "msg-1",
        }
        second = self._receive(envelope=reordered)
        self.assertEqual(second, first)
        self.assertEqual(len(self.store.inbox_rows()), 1)

        changed = self._envelope(body={"hello": "changed"})
        with self.assertRaises(ConflictError):
            self._receive(envelope=changed)
        changed_step = self._envelope(reply_to="msg-0")
        with self.assertRaises(ConflictError):
            self._receive(envelope=changed_step)
        self.assertEqual(self.store.inbox_rows()[0]["receipt_id"], first["receipt_id"])
        self.assertEqual(self.store.inbox_rows()[0]["envelope"]["body"], {"hello": "world"})

        other = self._receive(envelope=self._envelope(message_id="msg-2"), recipient="worker-a")
        self.assertNotEqual(other["receipt_id"], first["receipt_id"])
        expired = self._receive(envelope=self._envelope(message_id="msg-old", expires_at=1))
        self.assertEqual(expired["state"], "stored")
        self.assertEqual(len(self.store.inbox_rows()), 3)

        observed = self.store.inbox_rows()
        observed[0]["envelope"]["body"] = {"tamper": True}
        self.assertEqual(self.store.inbox_rows()[0]["envelope"]["body"], {"hello": "world"})

        self._reopen()
        reopened = self.store.inbox_rows()
        self.assertEqual([row["receipt_id"] for row in reopened],
                         [first["receipt_id"], other["receipt_id"], expired["receipt_id"]])
        self.assertEqual(self.store.usage("job-1"),
                         {"turns": 0, "messages": 0, "provider_tokens": None, "provider_cost": None})

    def test_inbox_rejects_malformed_sender_recipient_and_oversize(self):
        with self.assertRaises(StoreError):
            self._receive(sender="worker-z")
        missing = self._envelope()
        del missing["expires_at"]
        with self.assertRaises(StoreError):
            self._receive(envelope=missing)
        with self.assertRaises(StoreError):
            self._receive(envelope=self._envelope(recipients="worker-b"))
        with self.assertRaises(StoreError):
            self._receive(recipient="worker-z")
        with self.assertRaises(StoreError):
            self._receive(envelope=self._envelope(expires_at=float("nan")))
        with self.assertRaises(StoreError):
            self._receive(envelope=self._envelope(body="x" * 70000))
        self.assertEqual(self.store.inbox_rows(), [])
        self.assertEqual(self.store.audit_rows(), [])

    def test_named_faults_roll_back_and_survive_reopen(self):
        prior = _record(1)
        self.store.put_record("workers", "worker-a", prior)
        self.store.close()

        def run(name, action):
            def fault(point, expected=name):
                if point == expected:
                    self.assertEqual(self._external_count("inbox") + self._external_count("commands")
                                     + self._external_count("outbox") + self._external_count("attempts"),
                                     0 if expected != "audit_before_write" else 0)
                    raise RuntimeError("injected " + expected)

            store = Store(self.path, fault=fault)
            try:
                with self.assertRaises(RuntimeError):
                    action(store)
            finally:
                store.close()
            reopened = Store(self.path)
            try:
                self.assertEqual(reopened.get_record("workers", "worker-a"), prior)
                self.assertEqual(reopened.inbox_rows(), [])
                self.assertEqual(reopened.commands(), [])
                self.assertEqual(reopened.outbox_rows(), [])
                self.assertEqual(reopened.attempts(), [])
                self.assertEqual(reopened.reservations(), [])
                self.assertEqual([row["action"] for row in reopened.audit_rows()], ["record.put"])
            finally:
                reopened.close()

        run("audit_before_write", lambda store: store.receive_message(
            "worker-a", self._envelope(), "worker-b"))
        run("inbox_before_commit", lambda store: store.receive_message(
            "worker-a", self._envelope(), "worker-b"))
        run("command_before_outbox", lambda store: store.accept_command(
            "job-1", "step-1", {"value": 1}, worker_id="worker-a",
            route_policy={"route_id": "route-1"}, grant_id="grant-1"))
        run("outbox_before_commit", lambda store: store.enqueue_outbox(
            "msg-out", "worker-a", "worker-b", {"body": "pending"}))

        def prepare(store):
            command = store.accept_command(
                "job-1", "step-1", {"value": 1}, worker_id="worker-a",
                route_policy={"route_id": "route-1"}, grant_id="grant-1")
            store.prepare_attempt(
                command["command_id"],
                route={"route_id": "route-1"},
                grant={"grant_id": "grant-1"},
                resources=self._resources(),
                now=10,
                lease_until=20,
            )

        # The command inserted by prepare's setup must remain only if it committed
        # before the attempt fault. prepare() commits the command, then the attempt
        # fault rolls the attempt back. Assert that split on its own below.
        def fault(point):
            if point == "attempt_before_commit":
                self.assertEqual(self._external_count("attempts"), 0)
                raise RuntimeError("injected attempt_before_commit")

        store = Store(self.path, fault=fault)
        try:
            with self.assertRaises(RuntimeError):
                prepare(store)
        finally:
            store.close()
        reopened = Store(self.path)
        try:
            self.assertEqual(len(reopened.commands()), 1)
            self.assertEqual(reopened.commands()[0]["state"], "queued")
            self.assertEqual(reopened.attempts(), [])
            self.assertEqual(reopened.reservations(), [])
            self.assertEqual(reopened.get_record("workers", "worker-a"), prior)
        finally:
            reopened.close()
        self.store = Store(self.path)

    def test_command_grant_renewal_step_conflict_and_stable_outbox(self):
        original = self._accept()
        self.assertEqual(original["state"], "queued")
        self.assertEqual(original["job_id"], "job-1")
        self.assertEqual(original["step_id"], "step-1")
        self.assertEqual(original["worker_id"], "worker-a")
        self.assertEqual(original["grant_id"], "grant-1")
        self.assertEqual(original["input_payload"], {"value": 1})
        self.assertEqual(len(original["input_digest"]), 64)
        renewed = self._accept(grant="grant-2", route={"limits": {"turns": 2}, "route_id": "route-1"})
        self.assertEqual(renewed, original)
        self.assertEqual(renewed["grant_id"], "grant-1")
        rows = self.store.outbox_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["message_id"], "command:job-1:step-1")
        self.assertIsNone(rows[0]["receipt_id"])
        self.assertEqual(rows[0]["payload"]["command_id"], original["command_id"])

        with self.assertRaises(ConflictError):
            self._accept(payload={"value": 2})
        with self.assertRaises(ConflictError):
            self._accept(worker="worker-b")
        with self.assertRaises(ConflictError):
            self._accept(route={"route_id": "route-2"})
        self.assertEqual(self.store.command(original["command_id"]), original)
        self.assertEqual(len(self.store.commands()), 1)
        self.assertEqual(len(self.store.outbox_rows()), 1)

        other = self._accept(step="step-2")
        self.assertNotEqual(other["command_id"], original["command_id"])
        self.assertEqual(self.store.outbox_rows()[1]["message_id"], "command:job-1:step-2")
        self.assertIsNone(self.store.command("missing"))
        self.assertEqual(self.store.usage("job-1")["messages"], 2)
        self.assertEqual(self.store.usage("job-1")["turns"], 0)
        self.assertIsNone(self.store.usage("job-1")["provider_tokens"])
        self.assertIsNone(self.store.usage("job-1")["provider_cost"])

        self._reopen()
        self.assertEqual(self.store.command(original["command_id"])["input_digest"], original["input_digest"])
        self.assertEqual(len(self.store.outbox_rows()), 2)

    def test_outbox_idempotent_ack_does_not_mint_message_ids(self):
        first = self.store.enqueue_outbox("msg-9", "worker-a", "worker-b", {"n": 1, "z": 2})
        second = self.store.enqueue_outbox("msg-9", "worker-a", "worker-b", {"z": 2, "n": 1})
        self.assertEqual(second, first)
        with self.assertRaises(ConflictError):
            self.store.enqueue_outbox("msg-9", "worker-a", "worker-b", {"n": 2})
        self.assertEqual(len(self.store.pending_outbox()), 1)
        self.store.ack_outbox(first["outbox_id"], "receipt-9")
        self.assertEqual(self.store.pending_outbox(), [])
        self.store.ack_outbox(first["outbox_id"], "receipt-9")
        rows = self.store.outbox_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["message_id"], "msg-9")
        self.assertEqual(rows[0]["receipt_id"], "receipt-9")
        with self.assertRaises(ConflictError):
            self.store.ack_outbox(first["outbox_id"], "receipt-other")
        self.assertEqual(len(self.store.inbox_rows()), 0)
        self.assertEqual(self.store.commands(), [])

    def test_usage_counts_attempts_including_unknown_and_cancelled_not_receipts(self):
        self._receive()
        command = self._accept()
        self.store.enqueue_outbox("replay-1", "worker-a", "worker-b", {"kind": "replay"})
        self.assertEqual(self.store.usage("job-1")["messages"], 1)
        self.assertEqual(self.store.usage("job-1")["turns"], 0)

        first = self._prepare(command["command_id"])
        with self.assertRaises(StoreError):
            self.store.publish_attempt(first["attempt_id"], first["fence"], "cancelled", now=110)
        self.assertEqual(self.store.usage("job-1")["turns"], 1)
        self.store.confirm_stop(
            first["attempt_id"],
            evidence={"operation_id": first["operation_id"], "stopped": True, "effects_resolved": True},
            effects_resolved=True,
            now=120,
        )
        self.store.publish_attempt(first["attempt_id"], first["fence"], "cancelled", now=121)
        second = self._prepare(command["command_id"], now=130, lease_until=240)
        self.store.publish_attempt(second["attempt_id"], second["fence"], "outcome_unknown", now=140)
        usage = self.store.usage("job-1")
        self.assertEqual(usage, {"turns": 2, "messages": 1, "provider_tokens": None, "provider_cost": None})
        self.assertEqual(len(self.store.inbox_rows()), 1)

    def test_prepare_snapshots_identity_and_blocks_unresolved_replacement(self):
        command = self._accept()
        route = {"route_id": "route-1", "model": "synthetic"}
        grant = {"grant_id": "grant-1", "revision": 1, "scope": ["workspace"]}
        prepared = self._prepare(command["command_id"], route=route, grant=grant)
        route["model"] = "tampered"
        grant["scope"].append("other")
        stored = self.store.attempt(prepared["attempt_id"])
        self.assertEqual(stored["state"], "dispatch_prepared")
        self.assertEqual(stored["route"], {"route_id": "route-1", "model": "synthetic"})
        self.assertEqual(stored["grant"]["scope"], ["workspace"])
        self.assertIsNone(stored["result"])
        self.assertFalse(stored["stop_proven"])
        self.assertFalse(stored["effects_resolved"])
        self.assertEqual(stored["command_id"], command["command_id"])
        self.assertNotEqual(stored["attempt_id"], stored["operation_id"])
        self.assertEqual(stored["fence"], 1)
        self.assertEqual(stored["lease_until"], 200)
        self.assertEqual(self.store.command(command["command_id"])["state"], "dispatch_prepared")
        self.assertEqual(len(self._active()), 5)

        with self.assertRaises(ConflictError) as caught:
            self._prepare(command["command_id"], now=150, lease_until=250)
        self.assertIn("unresolved", str(caught.exception))
        self.assertEqual(len(self.store.attempts()), 1)
        self.assertEqual(self.store.attempts()[0]["operation_id"], prepared["operation_id"])

        returned = self.store.attempt(prepared["attempt_id"])
        returned["state"] = "running"
        self.assertEqual(self.store.attempt(prepared["attempt_id"])["state"], "dispatch_prepared")
        self.assertIsNone(self.store.attempt("missing"))

    def test_capacity_session_workspace_quota_and_atomic_reservation(self):
        held = self._accept(step="held")
        self._prepare(held["command_id"], resources=self._resources(
            session=("sess-shared", 1), workspace=("ws-shared", 1), quota_pool=("pool-shared", 1)))

        blocked = self._accept(step="blocked")
        with self.assertRaises(ConflictError) as caught:
            self._prepare(blocked["command_id"], resources=self._resources(
                session=("sess-other", 1), workspace=("ws-new", 1), quota_pool=("pool-shared", 1)))
        self.assertIn("quota_pool", str(caught.exception))
        self.assertEqual(self._active(key="ws-new"), [])
        self.assertEqual(self.store.command(blocked["command_id"])["state"], "queued")

        overlap = self._accept(step="overlap")
        with self.assertRaises(ConflictError):
            self._prepare(overlap["command_id"], resources=self._resources(
                session=("sess-free", 1), workspace=("ws-shared", 1), quota_pool=("pool-free", 1)))
        session_block = self._accept(step="session-block")
        with self.assertRaises(ConflictError):
            self._prepare(session_block["command_id"], resources=self._resources(
                session=("sess-shared", 1), workspace=("ws-free", 1), quota_pool=("pool-free-2", 1)))
        self.assertEqual(self._active(key="ws-free"), [])

        independent = self._accept(step="independent")
        prepared = self._prepare(independent["command_id"], resources=self._resources(
            session=("sess-independent", 1), workspace=("ws-independent", 1), quota_pool=("pool-other", 1)))
        self.assertEqual(prepared["state"], "dispatch_prepared")

        with self.assertRaises(StoreError):
            self._prepare(self._accept(step="bad-ws")["command_id"], resources=self._resources(
                workspace=("ws-bad", 2)))
        with self.assertRaises(StoreError):
            self._prepare(self._accept(step="bad-session")["command_id"], resources=self._resources(
                session=("sess-bad", 2)))
        with self.assertRaises(StoreError):
            self._prepare(self._accept(step="bad-cap")["command_id"], resources=self._resources(
                account=("acct-bool", True)))
        self.assertEqual(self._active(key="ws-bad"), [])

        third_resources_ok = []
        for index in (1, 2):
            command = self._accept(step="acct-%s" % index, job="job-acct")
            third_resources_ok.append(self._prepare(command["command_id"], resources=self._resources(
                job=("job-acct", 2), account=("acct-cap", 2), quota_pool=("pool-acct-%s" % index, 1),
                session=("sess-acct-%s" % index, 1), workspace=("ws-acct-%s" % index, 1))))
        extra = self._accept(step="acct-3", job="job-acct")
        with self.assertRaises(ConflictError) as caught:
            self._prepare(extra["command_id"], resources=self._resources(
                job=("job-acct", 2), account=("acct-cap", 2), quota_pool=("pool-acct-3", 1),
                session=("sess-acct-3", 1), workspace=("ws-acct-3", 1)))
        self.assertIn("capacity exceeded", str(caught.exception))
        self.assertEqual(len(third_resources_ok), 2)

    def test_concurrent_reservation_is_atomic(self):
        first = self._accept(step="c-1")
        second = self._accept(step="c-2")
        resources = self._resources(session=("sess-race", 1), workspace=("ws-race", 1))
        barrier = threading.Barrier(2)
        results = []

        def worker(command_id):
            try:
                barrier.wait(timeout=5)
                prepared = self.store.prepare_attempt(
                    command_id,
                    route={"route_id": "route-1"},
                    grant={"grant_id": "grant-1"},
                    resources=resources,
                    now=100,
                    lease_until=200,
                )
                results.append(("ok", prepared["attempt_id"]))
            except Exception as exc:
                results.append(("err", type(exc), str(exc)))

        threads = [threading.Thread(target=worker, args=(command["command_id"],))
                   for command in (first, second)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
            self.assertFalse(thread.is_alive())
        self.assertEqual(sorted(item[0] for item in results), ["err", "ok"])
        failure = next(item for item in results if item[0] == "err")
        self.assertIs(failure[1], ConflictError)
        self.assertEqual(len(self.store.attempts()), 1)
        self.assertEqual(len(self._active(key="ws-race")), 1)
        self.assertEqual(len(self._active(key="sess-race")), 1)
        winner = self.store.attempts()[0]["command_id"]
        loser = second["command_id"] if winner == first["command_id"] else first["command_id"]
        self.assertEqual(self.store.command(loser)["state"], "queued")
        self.assertEqual(len(self._active()), 5)

    def test_publish_transitions_reject_stale_fence_and_direct_success(self):
        command = self._accept()
        prepared = self._prepare(command["command_id"])
        with self.assertRaises(StoreError):
            self.store.publish_attempt(prepared["attempt_id"], prepared["fence"], "execution_completed", now=110)
        with self.assertRaises(StoreError):
            self.store.publish_attempt(prepared["attempt_id"], prepared["fence"], "awaiting_review", now=110)
        self.assertEqual(self.store.attempt(prepared["attempt_id"])["state"], "dispatch_prepared")
        self.assertEqual(len(self._active()), 5)

        with self.assertRaises(StaleFenceError):
            self.store.publish_attempt(prepared["attempt_id"], prepared["fence"] + 1, "running", now=110)
        self.assertEqual(self.store.attempt(prepared["attempt_id"])["state"], "dispatch_prepared")

        running = self.store.publish_attempt(prepared["attempt_id"], prepared["fence"], "running", now=110)
        self.assertEqual(running["state"], "running")
        self.assertEqual(self.store.command(command["command_id"])["state"], "running")
        reviewed = self.store.publish_attempt(
            prepared["attempt_id"], prepared["fence"], "awaiting_review", now=120,
            result={"candidate": "digest-1"},
        )
        self.assertEqual(reviewed["result"], {"candidate": "digest-1"})
        self.assertEqual(self.store.command(command["command_id"])["state"], "awaiting_review")
        completed = self.store.publish_attempt(
            prepared["attempt_id"], prepared["fence"], "execution_completed", now=130)
        self.assertEqual(completed["state"], "execution_completed")
        self.assertNotEqual(completed["state"], "done")
        self.assertEqual(len(self._active()), 5)

        unknown_command = self._accept(step="unknown")
        unknown = self._prepare(unknown_command["command_id"], resources=self._resources(
            session=("sess-u", 1), workspace=("ws-u", 1)))
        with self.assertRaises(StoreError):
            self.store.publish_attempt(unknown["attempt_id"], unknown["fence"], "execution_completed", now=110)
        self.store.publish_attempt(unknown["attempt_id"], unknown["fence"], "outcome_unknown", now=110)
        self.store.publish_attempt(
            unknown["attempt_id"], unknown["fence"], "awaiting_review", now=120, result={"candidate": "kept"})
        self.assertEqual(self.store.attempt(unknown["attempt_id"])["operation_id"], unknown["operation_id"])

        stopping = self._prepare(self._accept(step="stop")["command_id"], resources=self._resources(
            session=("sess-s", 1), workspace=("ws-s", 1)))
        self.store.publish_attempt(stopping["attempt_id"], stopping["fence"], "running", now=110)
        self.store.publish_attempt(stopping["attempt_id"], stopping["fence"], "stopping", now=120)
        with self.assertRaises(StoreError):
            self.store.publish_attempt(stopping["attempt_id"], stopping["fence"], "cancelled", now=130)
        self.assertEqual(len(self._active(key="ws-s")), 1)
        self.store.confirm_stop(stopping["attempt_id"], evidence={"operation_id":stopping["operation_id"],"stopped":True,"effects_resolved":True}, effects_resolved=True, now=131)
        self.store.publish_attempt(stopping["attempt_id"], stopping["fence"], "cancelled", now=132)
        self.assertEqual(self.store.attempt(stopping["attempt_id"])["state"], "cancelled")
        self.assertEqual(self._active(key="ws-s"), [])

    def test_expiry_stale_epoch_and_claim_keep_ids_and_reservations(self):
        command = self._accept()
        prepared = self._prepare(command["command_id"], now=100, lease_until=150)
        with self.assertRaises(ConflictError):
            self.store.claim_lease(prepared["attempt_id"], now=149, lease_until=180)
        self.store.publish_attempt(prepared["attempt_id"], prepared["fence"], "running", now=110)
        self.store.expire_leases(150)
        expired = self.store.attempt(prepared["attempt_id"])
        self.assertEqual(expired["state"], "outcome_unknown")
        self.assertEqual(expired["attempt_id"], prepared["attempt_id"])
        self.assertEqual(expired["operation_id"], prepared["operation_id"])
        self.assertEqual(len(self._active()), 5)
        with self.assertRaises(StaleFenceError):
            self.store.publish_attempt(prepared["attempt_id"], prepared["fence"], "running", now=160)
        claimed = self.store.claim_lease(prepared["attempt_id"], now=160, lease_until=220)
        self.assertEqual(claimed, prepared["fence"] + 1)
        after_claim = self.store.attempt(prepared["attempt_id"])
        self.assertEqual(after_claim["operation_id"], prepared["operation_id"])
        self.assertEqual(after_claim["state"], "outcome_unknown")
        self.assertEqual(len(self.store.attempts()), 1)
        self.store.publish_attempt(prepared["attempt_id"], claimed, "running", now=170)
        self.assertEqual(len(self._active()), 5)

        self._reopen()
        stale = self.store.attempt(prepared["attempt_id"])
        self.assertEqual(stale["operation_id"], prepared["operation_id"])
        with self.assertRaises(StaleFenceError):
            self.store.publish_attempt(prepared["attempt_id"], claimed, "failed", now=180)
        self.assertEqual(len(self._active()), 5)
        incarnated = self.store.claim_lease(prepared["attempt_id"], now=180, lease_until=260)
        self.assertGreater(incarnated, claimed)
        self.assertEqual(self.store.attempt(prepared["attempt_id"])["controller_epoch"],
                         stale["controller_epoch"] + 1)
        self.assertEqual(self.store.attempt(prepared["attempt_id"])["operation_id"], prepared["operation_id"])

    def test_only_exact_stop_and_effects_proof_releases(self):
        command = self._accept()
        prepared = self._prepare(command["command_id"])
        key, fence, op = prepared["attempt_id"], prepared["fence"], prepared["operation_id"]
        self.store.publish_attempt(key, fence, "running", now=110)
        self.store.publish_attempt(key, fence, "stopping", now=120)
        with self.assertRaises(StoreError):
            self.store.publish_attempt(key, fence, "cancelled", now=130)
        self.assertEqual(len(self._active()), 5)
        self.store.expire_leases(10000)
        self.assertEqual(self.store.attempt(key)["state"], "outcome_unknown")
        self.assertEqual(len(self._active()), 5)
        for proof in [{"operation_id":"other-op","stopped":True,"effects_resolved":True},
                      {"operation_id":op,"stopped":False,"effects_resolved":True},
                      {"operation_id":op,"stopped":True}]:
            with self.assertRaises(StoreError):
                self.store.confirm_stop(key,evidence=proof,effects_resolved=True,now=10001)
        self.assertFalse(self.store.attempt(key)["stop_proven"])
        held=self.store.confirm_stop(key,evidence={"operation_id":op,"stopped":True,"effects_resolved":False},effects_resolved=False,now=10002)
        self.assertTrue(held["stop_proven"])
        self.assertFalse(held["effects_resolved"])
        self.assertEqual(len(self._active()),5)
        released=self.store.confirm_stop(key,evidence={"operation_id":op,"stopped":True,"effects_resolved":True},effects_resolved=True,now=10003)
        self.assertTrue(released["effects_resolved"])
        self.assertEqual(self._active(),[])
        self.assertEqual(len(self.store.reservations()),5)
        renewed=self.store.claim_lease(key,now=10004,lease_until=10100)
        self.store.publish_attempt(key,renewed,"cancelled",now=10005)
        replacement=self._prepare(command["command_id"],now=10006,lease_until=10200)
        self.assertNotEqual(replacement["attempt_id"],key)
        self.assertNotEqual(replacement["operation_id"],op)
        self.assertEqual(self.store.attempt(key)["operation_id"],op)
        self.assertEqual(self.store.attempt(key)["state"],"cancelled")

    def test_recovered_review_releases_slots_without_overlapping_attempt(self):
        command = self._accept()
        prepared = self._prepare(command["command_id"])
        self.store.publish_attempt(prepared["attempt_id"], prepared["fence"], "outcome_unknown", now=110)
        with self.assertRaises(ConflictError):
            self._prepare(command["command_id"], now=120, lease_until=240)
        self.assertEqual(len(self.store.attempts()), 1)
        reviewed = self.store.publish_attempt(
            prepared["attempt_id"], prepared["fence"], "awaiting_review", now=130,
            result={"candidate": "digest-9"},
        )
        self.assertEqual(reviewed["operation_id"], prepared["operation_id"])
        self.store.confirm_stop(
            prepared["attempt_id"],
            evidence={"operation_id": prepared["operation_id"], "stopped": True, "effects_resolved": True},
            effects_resolved=True,
            now=140,
        )
        current = self.store.attempt(prepared["attempt_id"])
        self.assertEqual(current["state"], "awaiting_review")
        self.assertEqual(current["result"], {"candidate": "digest-9"})
        self.assertEqual(self._active(), [])
        with self.assertRaises(ConflictError) as caught:
            self._prepare(command["command_id"], now=150, lease_until=260)
        self.assertIn("unresolved", str(caught.exception))
        self.assertEqual(self.store.attempts()[0]["operation_id"], prepared["operation_id"])

    def test_reopen_recover_preserves_identity_and_terminal_results(self):
        self._receive()
        running_command = self._accept(step="running")
        running = self._prepare(running_command["command_id"])
        self.store.publish_attempt(running["attempt_id"], running["fence"], "running", now=110)

        review_command = self._accept(step="review")
        review = self._prepare(review_command["command_id"], resources=self._resources(
            session=("sess-review", 1), workspace=("ws-review", 1)))
        self.store.publish_attempt(review["attempt_id"], review["fence"], "running", now=110)
        self.store.publish_attempt(
            review["attempt_id"], review["fence"], "awaiting_review", now=120,
            result={"candidate": "digest-review"},
        )

        done_command = self._accept(step="done")
        done = self._prepare(done_command["command_id"], resources=self._resources(
            session=("sess-done", 1), workspace=("ws-done", 1)))
        self.store.publish_attempt(done["attempt_id"], done["fence"], "running", now=110)
        self.store.publish_attempt(
            done["attempt_id"], done["fence"], "awaiting_review", now=120, result={"candidate": "digest-done"})
        self.store.publish_attempt(done["attempt_id"], done["fence"], "execution_completed", now=130)

        prepared_command = self._accept(step="prepared")
        prepared = self._prepare(prepared_command["command_id"], resources=self._resources(
            session=("sess-prepared", 1), workspace=("ws-prepared", 1)))
        stopping_command = self._accept(step="stopping")
        stopping = self._prepare(stopping_command["command_id"], resources=self._resources(
            session=("sess-stopping", 1), workspace=("ws-stopping", 1)))
        self.store.publish_attempt(stopping["attempt_id"], stopping["fence"], "running", now=110)
        self.store.publish_attempt(stopping["attempt_id"], stopping["fence"], "stopping", now=120)

        receipt_ids = [row["receipt_id"] for row in self.store.inbox_rows()]
        self._reopen()
        self.assertEqual([row["receipt_id"] for row in self.store.inbox_rows()], receipt_ids)
        self.assertEqual(self.store.attempt(running["attempt_id"])["state"], "running")
        self.store.recover_attempts(300)
        self.assertEqual(self.store.attempt(running["attempt_id"])["state"], "outcome_unknown")
        self.assertEqual(self.store.attempt(running["attempt_id"])["operation_id"], running["operation_id"])
        self.assertEqual(self.store.attempt(prepared["attempt_id"])["state"], "outcome_unknown")
        self.assertEqual(self.store.attempt(prepared["attempt_id"])["attempt_id"], prepared["attempt_id"])
        self.assertEqual(self.store.attempt(stopping["attempt_id"])["state"], "outcome_unknown")
        self.assertEqual(self.store.attempt(review["attempt_id"])["state"], "awaiting_review")
        self.assertEqual(self.store.attempt(review["attempt_id"])["result"], {"candidate": "digest-review"})
        self.assertEqual(self.store.attempt(done["attempt_id"])["state"], "execution_completed")
        self.assertEqual(self.store.attempt(done["attempt_id"])["result"], {"candidate": "digest-done"})
        self.assertEqual(len(self.store.reservations()), 25)
        self.assertEqual(len(self._active()), 25)
        self.assertEqual([row["receipt_id"] for row in self.store.inbox_rows()], receipt_ids)
        with self.assertRaises(StaleFenceError):
            self.store.publish_attempt(running["attempt_id"], running["fence"], "running", now=310)
        with self.assertRaises(ConflictError):
            self._prepare(running_command["command_id"], now=320, lease_until=400)
        self.assertEqual(len([row for row in self.store.attempts()
                              if row["command_id"] == running_command["command_id"]]), 1)

    def test_new_attempt_after_terminal_stop_keeps_original_unknown_id(self):
        command = self._accept()
        original = self._prepare(command["command_id"])
        self.store.publish_attempt(original["attempt_id"], original["fence"], "outcome_unknown", now=110)
        self.assertEqual(self.store.attempts()[0]["operation_id"], original["operation_id"])
        with self.assertRaises(StoreError):
            self.store.publish_attempt(original["attempt_id"], original["fence"], "cancelled", now=120)
        with self.assertRaises(ConflictError):
            self._prepare(command["command_id"], now=130, lease_until=240)
        self.store.confirm_stop(
            original["attempt_id"],
            evidence={"operation_id": original["operation_id"], "stopped": True, "effects_resolved": True},
            effects_resolved=True,
            now=140,
        )
        self.store.publish_attempt(original["attempt_id"], original["fence"], "cancelled", now=141)
        replacement = self._prepare(command["command_id"], now=150, lease_until=260)
        self.assertNotEqual(replacement["attempt_id"], original["attempt_id"])
        self.assertNotEqual(replacement["operation_id"], original["operation_id"])
        stored = {row["attempt_id"]: row["operation_id"] for row in self.store.attempts()}
        self.assertEqual(stored[original["attempt_id"]], original["operation_id"])
        self.assertEqual(len(stored), 2)
        self.assertEqual(self.store.usage("job-1")["turns"], 2)

    def test_nested_transaction_and_outer_abort(self):
        with self.store.transaction():
            self.store.put_record("workers", "outer", _record(1))
            try:
                with self.store.transaction():
                    self.store.put_record("workers", "inner", _record(1, name="inner"))
                    raise StoreError("inner failed")
            except StoreError:
                pass
            self.assertIsNone(self.store.get_record("workers", "inner"))
            self.assertEqual(self.store.get_record("workers", "outer")["name"], "synthetic")
        self.assertEqual(self._external_count("records"), 1)

        with self.assertRaises(RuntimeError):
            with self.store.transaction():
                self.store.put_record("workers", "rolled", _record(1))
                raise RuntimeError("abort outer")
        self.assertIsNone(self.store.get_record("workers", "rolled"))
        self.assertEqual(self.store.get_record("workers", "outer")["name"], "synthetic")

        command = self._accept()
        with self.store.transaction():
            prepared = self._prepare(command["command_id"])
            self.assertEqual(self._external_count("attempts"), 0)
        self.assertEqual(self._external_count("attempts"), 1)
        self.assertEqual(self.store.attempt(prepared["attempt_id"])["state"], "dispatch_prepared")

    def test_one_controller_lock_and_release_on_error(self):
        with self.assertRaises(StoreError) as held:
            Store(self.path)
        self.assertIn("lock", str(held.exception))
        self.store.close()
        replacement = Store(self.path)
        replacement.put_record("workers", "worker-a", _record(1))
        replacement.close()
        self.store = Store(self.path)
        self.assertEqual(self.store.get_record("workers", "worker-a")["revision"], 1)

        with Store(":memory:") as left:
            with Store(":memory:") as right:
                left.put_record("workers", "worker-a", _record(1))
                self.assertIsNone(right.get_record("workers", "worker-a"))

        directory = Path(self._tmp.name) / "db-as-directory"
        directory.mkdir()
        with self.assertRaises(StoreError) as first:
            Store(str(directory))
        with self.assertRaises(StoreError) as second:
            Store(str(directory))
        self.assertNotIn("lock", str(first.exception).lower())
        self.assertNotIn("lock", str(second.exception).lower())

    def test_durability_is_invisible_until_commit(self):
        observed = {}

        def fault(point):
            if point == "inbox_before_commit":
                observed["during"] = self._external_count("inbox")
                raise RuntimeError("before commit")

        self.store.close()
        self.store = Store(self.path, fault=fault)
        with self.assertRaises(RuntimeError):
            self._receive()
        self.assertEqual(observed["during"], 0)
        self.assertEqual(self.store.inbox_rows(), [])

        self._reopen()
        receipt = self._receive()
        self.assertEqual(self._external_count("inbox"), 1)
        connection = sqlite3.connect(self.path)
        try:
            digest = connection.execute(
                "SELECT payload_digest FROM inbox WHERE receipt_id=?",
                (receipt["receipt_id"],),
            ).fetchone()[0]
        finally:
            connection.close()
        self.assertEqual(digest, receipt["payload_digest"])


if __name__ == "__main__":
    unittest.main()
