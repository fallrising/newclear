"""Focused core store tests: records, inbox/outbox, command identity, usage."""
import hashlib
import json
import os
import tempfile
import unittest

from agent_workforce.store import ConflictError, StaleFenceError, Store, StoreError


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def nest(levels):
    value = "x"
    for _ in range(levels):
        value = [value]
    return value


class StoreCoreTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.path = os.path.join(self._tmp.name, "nested", "core.sqlite")

    def open(self, fault=None, path=None):
        return Store(path if path is not None else self.path, fault=fault)

    def record(self, revision, **fields):
        body = {"revision": revision}
        body.update(fields)
        return body

    def envelope(self, **overrides):
        body = {
            "message_id": "msg-1",
            "sender": "alice",
            "recipients": ["bob", "carol"],
            "body": {"text": "hello", "n": 1},
            "expires_at": 0,
            "job_id": "job-1",
            "kind": "note",
            "reply_to": "msg-0",
        }
        body.update(overrides)
        return body

    def accept(self, store, grant_id="grant-1", job_id="job-1", step_id="step-1", payload=None, worker_id="worker-1", route=None):
        return store.accept_command(
            job_id,
            step_id,
            {"op": "run"} if payload is None else payload,
            worker_id=worker_id,
            route_policy={"routes": ["local"], "revision": 3} if route is None else route,
            grant_id=grant_id,
        )

    def test_exports_store_errors(self):
        self.assertTrue(issubclass(StoreError, ValueError))
        self.assertTrue(issubclass(ConflictError, StoreError))
        self.assertTrue(issubclass(StaleFenceError, StoreError))

    def test_revision_conflict_and_reopen(self):
        with self.open() as store:
            stored = self.record(1, name="alpha", tags=["b", "a"])
            store.put_record("registry", "alpha", stored)
            self.assertEqual(store.get_record("registry", "alpha"), stored)
            again = {"tags": ["b", "a"], "name": "alpha", "revision": 1}
            store.put_record("registry", "alpha", again)
            self.assertEqual(len(store.audit_rows()), 1)
            audit = store.audit_rows()[0]
            self.assertEqual(audit["kind"], "record.put")
            self.assertEqual(audit["action"], "record.put")
            self.assertEqual(audit["payload"]["kind"], "registry")
            self.assertEqual(audit["payload"]["key"], "alpha")
            self.assertEqual(audit["payload"]["revision"], 1)
            with self.assertRaises(ConflictError):
                store.put_record("registry", "alpha", self.record(1, name="beta"))
            older = self.record(1, name="alpha", tags=["b", "a"])
            older["note"] = "changed"
            # older revision than a later write conflicts; same revision already covered
            store.put_record("registry", "alpha", self.record(2, name="alpha", tags=["b", "a"]))
            with self.assertRaises(ConflictError):
                store.put_record("registry", "alpha", older)
            self.assertEqual(store.get_record("registry", "alpha")["revision"], 2)
            self.assertEqual(len(store.audit_rows()), 2)
            fetched = store.get_record("registry", "alpha")
            fetched["name"] = "mutated"
            self.assertEqual(store.get_record("registry", "alpha")["name"], "alpha")
            listed = store.records("registry")
            self.assertEqual(set(listed), {"alpha"})
            listed["alpha"]["name"] = "mutated"
            self.assertEqual(store.records("registry")["alpha"]["name"], "alpha")
            self.assertIsNone(store.get_record("registry", "missing"))
            self.assertEqual(store.records("empty"), {})
            self.assertEqual(store.records("reg' OR kind!='registry"), {})
            store.put_record("reg' OR kind!='registry", "k'ey", self.record(1, name="bound"))
            self.assertEqual(store.get_record("registry", "alpha")["name"], "alpha")
            self.assertEqual(store.get_record("reg' OR kind!='registry", "k'ey")["name"], "bound")
            epoch = store.controller_epoch
        reopened = self.open()
        self.addCleanup(reopened.close)
        self.assertGreater(reopened.controller_epoch, epoch)
        self.assertEqual(reopened.get_record("registry", "alpha"), self.record(2, name="alpha", tags=["b", "a"]))
        self.assertEqual(reopened.get_record("reg' OR kind!='registry", "k'ey")["name"], "bound")
        with self.assertRaises(ConflictError):
            reopened.put_record("registry", "alpha", self.record(2, name="diverged"))
        reopened.put_record("registry", "alpha", self.record(2, name="alpha", tags=["b", "a"]))
        self.assertEqual(len(reopened.audit_rows()), 3)
        reopened.close()
        held = self.open()
        self.addCleanup(held.close)
        with self.assertRaises(ConflictError):
            self.open()
        memory_a = self.open(path=":memory:")
        memory_b = self.open(path=":memory:")
        self.addCleanup(memory_a.close)
        self.addCleanup(memory_b.close)
        memory_a.put_record("registry", "alpha", self.record(1, name="mem"))
        self.assertIsNone(memory_b.get_record("registry", "alpha"))

    def test_record_validation(self):
        store = self.open()
        self.addCleanup(store.close)
        with self.assertRaises(StoreError):
            store.put_record("", "alpha", self.record(1))
        with self.assertRaises(StoreError):
            store.put_record("registry", "", self.record(1))
        with self.assertRaises(StoreError):
            store.put_record("registry", "alpha", ["nope"])
        with self.assertRaises(StoreError):
            store.put_record("registry", "alpha", {"name": "alpha"})
        with self.assertRaises(StoreError):
            store.put_record("registry", "alpha", {"revision": True, "name": "alpha"})
        with self.assertRaises(StoreError):
            store.put_record("registry", "alpha", {"revision": 0, "name": "alpha"})
        with self.assertRaises(StoreError):
            store.put_record("registry", "a\x00b", self.record(1))
        self.assertIsNone(store.get_record("registry", "alpha"))
        self.assertEqual(store.audit_rows(), [])

    def test_envelope_digest_trusted_sender_and_recipient(self):
        store = self.open()
        self.addCleanup(store.close)
        original = self.envelope()
        reordered = {
            "reply_to": "msg-0",
            "kind": "note",
            "job_id": "job-1",
            "expires_at": 0,
            "body": {"n": 1, "text": "hello"},
            "recipients": ["bob", "carol"],
            "sender": "alice",
            "message_id": "msg-1",
        }
        first = store.receive_message("alice", original, "bob")
        second = store.receive_message("alice", reordered, "bob")
        self.assertEqual(second, first)
        self.assertEqual(
            set(first),
            {"receipt_id", "state", "sender", "message_id", "recipient", "payload_digest"},
        )
        self.assertEqual(first["state"], "stored")
        self.assertEqual(first["sender"], "alice")
        self.assertEqual(first["message_id"], "msg-1")
        self.assertEqual(first["recipient"], "bob")
        self.assertEqual(first["payload_digest"], digest(original))
        self.assertEqual(len(store.audit_rows()), 1)
        self.assertEqual(store.audit_rows()[0]["kind"], "inbox.receive")
        self.assertEqual(store.audit_rows()[0]["action"], "inbox.receive")
        carol = store.receive_message("alice", original, "carol")
        self.assertEqual(carol["payload_digest"], first["payload_digest"])
        self.assertNotEqual(carol["receipt_id"], first["receipt_id"])
        changed = self.envelope(expires_at=5)
        with self.assertRaises(ConflictError):
            store.receive_message("alice", changed, "bob")
        self.assertEqual(store.inbox_rows()[0]["payload_digest"], digest(original))
        swapped = self.envelope()
        swapped["recipients"] = ["carol", "bob"]
        with self.assertRaises(ConflictError):
            store.receive_message("alice", swapped, "bob")
        with self.assertRaises(StoreError):
            store.receive_message("mallory", original, "bob")
        with self.assertRaises(StoreError):
            store.receive_message("alice", original, "dave")
        with self.assertRaises(StoreError):
            store.receive_message("alice", self.envelope(recipients=["bob", "bob"]), "bob")
        with self.assertRaises(StoreError):
            store.receive_message("alice", self.envelope(expires_at=True), "bob")
        with self.assertRaises(StoreError):
            naked = self.envelope()
            del naked["body"]
            store.receive_message("alice", naked, "bob")
        with self.assertRaises(StoreError):
            extra = self.envelope(hop=1)
            store.receive_message("alice", extra, "bob")
        rows = store.inbox_rows()
        self.assertEqual([row["recipient"] for row in rows], ["bob", "carol"])
        self.assertEqual(rows[0]["state"], "stored")
        self.assertEqual(rows[0]["envelope"]["body"], {"text": "hello", "n": 1})
        rows[0]["envelope"]["body"]["text"] = "mutated"
        self.assertEqual(store.inbox_rows()[0]["envelope"]["body"]["text"], "hello")
        self.assertEqual(len(store.inbox_rows()), 2)
        minimal = {
            "message_id": "msg-2",
            "sender": "alice",
            "recipients": ["bob"],
            "body": "plain",
            "expires_at": 1.5,
        }
        plain = store.receive_message("alice", minimal, "bob")
        self.assertEqual(plain["payload_digest"], digest(minimal))
        self.assertEqual(store.inbox_rows()[-1]["envelope"], minimal)

    def test_deterministic_durable_receipts(self):
        seen = []

        def fault(point):
            seen.append(point)

        with self.open(fault=fault) as store:
            receipt = store.receive_message("alice", self.envelope(), "bob")
            command = self.accept(store)
            outbox = store.enqueue_outbox("note-1", "alice", "bob", {"b": 1, "a": "ok"})
        seen.clear()
        with self.open(fault=fault) as store:
            self.assertEqual(store.receive_message("alice", self.envelope(), "bob"), receipt)
            renewed = self.accept(store, grant_id="grant-2")
            self.assertEqual(renewed, command)
            again = store.enqueue_outbox("note-1", "alice", "bob", {"a": "ok", "b": 1})
            self.assertEqual(again, outbox)
            self.assertEqual(seen, [])
            self.assertEqual(store.inbox_rows()[0]["receipt_id"], receipt["receipt_id"])
            self.assertEqual(len(store.outbox_rows()), 2)
        other = self.open(path=os.path.join(self._tmp.name, "other.sqlite"))
        self.addCleanup(other.close)
        self.assertEqual(other.receive_message("alice", self.envelope(), "bob")["receipt_id"], receipt["receipt_id"])
        self.assertEqual(self.accept(other)["command_id"], command["command_id"])
        self.assertEqual(self.accept(other)["input_digest"], command["input_digest"])
        self.assertEqual(
            other.enqueue_outbox("note-1", "alice", "bob", {"a": "ok", "b": 1})["outbox_id"],
            outbox["outbox_id"],
        )

    def test_input_limits(self):
        store = self.open()
        self.addCleanup(store.close)
        store.enqueue_outbox("edge", "alice", "bob", "a" * 65534)
        with self.assertRaises(StoreError):
            store.enqueue_outbox("over", "alice", "bob", "a" * 65535)
        with self.assertRaises(StoreError):
            store.enqueue_outbox("deep", "alice", "bob", nest(41))
        store.enqueue_outbox("shallow", "alice", "bob", nest(40))
        with self.assertRaises(StoreError):
            store.enqueue_outbox("nan", "alice", "bob", {"value": float("nan")})
        with self.assertRaises(StoreError):
            store.enqueue_outbox("bad-key", "alice", "bob", {1: "x"})
        with self.assertRaises(StoreError):
            store.enqueue_outbox("m\x00", "alice", "bob", {"ok": True})
        with self.assertRaises(StoreError):
            store.put_record("registry", "big", {"revision": 1, "blob": "a" * 70000})
        huge = self.envelope(body={"blob": "a" * 70000})
        with self.assertRaises(StoreError):
            store.receive_message("alice", huge, "bob")
        with self.assertRaises(StoreError):
            self.accept(store, payload={"blob": "b" * 70000})
        self.assertEqual([row["message_id"] for row in store.outbox_rows()], ["edge", "shallow"])
        self.assertEqual(store.inbox_rows(), [])
        self.assertEqual(store.commands(), [])
        self.assertEqual(store.audit_rows()[0]["kind"], "outbox.enqueue")
        self.assertEqual(len(store.audit_rows()), 2)

    def test_outbox_stable_acknowledgement(self):
        store = self.open()
        self.addCleanup(store.close)
        first = store.enqueue_outbox("note-1", "alice", "bob", {"text": "hello"})
        second = store.enqueue_outbox("note-2", "alice", "bob", {"text": "next"})
        self.assertEqual(first["payload_digest"], digest({"text": "hello"}))
        self.assertIsNone(first["receipt_id"])
        self.assertEqual(
            set(first),
            {"outbox_id", "message_id", "sender", "recipient", "payload_digest", "payload", "receipt_id"},
        )
        self.assertEqual([row["message_id"] for row in store.pending_outbox()], ["note-1", "note-2"])
        with self.assertRaises(ConflictError):
            store.enqueue_outbox("note-1", "alice", "bob", {"text": "changed"})
        self.assertEqual(store.outbox_rows()[0]["payload"], {"text": "hello"})
        acked = store.ack_outbox(first["outbox_id"], "receipt-9")
        self.assertEqual(acked["receipt_id"], "receipt-9")
        self.assertEqual(acked["message_id"], "note-1")
        replay = store.ack_outbox(first["outbox_id"], "receipt-9")
        self.assertEqual(replay, acked)
        ids = [row["message_id"] for row in store.outbox_rows()]
        self.assertEqual(ids, ["note-1", "note-2"])
        self.assertEqual([row["message_id"] for row in store.pending_outbox()], ["note-2"])
        with self.assertRaises(ConflictError):
            store.ack_outbox(first["outbox_id"], "receipt-other")
        with self.assertRaises(StoreError):
            store.ack_outbox("missing-outbox", "receipt-9")
        self.assertEqual(store.outbox_rows()[0]["receipt_id"], "receipt-9")
        ack_events = [row for row in store.audit_rows() if row["kind"] == "outbox.ack"]
        self.assertEqual(len(ack_events), 1)
        self.assertEqual(ack_events[0]["action"], "outbox.ack")
        self.assertEqual(ack_events[0]["payload"]["receipt_id"], "receipt-9")
        mutated = store.pending_outbox()
        mutated[0]["payload"]["text"] = "mutated"
        self.assertEqual(store.pending_outbox()[0]["payload"]["text"], "next")
        store.close()
        store = self.open()
        self.addCleanup(store.close)
        self.assertEqual(store.outbox_rows()[0]["receipt_id"], "receipt-9")
        self.assertEqual([row["message_id"] for row in store.pending_outbox()], ["note-2"])
        store.ack_outbox(first["outbox_id"], "receipt-9")
        self.assertEqual(len([row for row in store.audit_rows() if row["kind"] == "outbox.ack"]), 1)

    def test_grant_renewal_preserves_command_identity(self):
        seen = []
        store = self.open(fault=lambda point: seen.append(point))
        self.addCleanup(store.close)
        payload = {"step": 1, "flags": ["b", "a"]}
        route = {"revision": 2, "routes": ["local", "remote"]}
        first = store.accept_command(
            "job:extra",
            "step:1",
            payload,
            worker_id="worker-1",
            route_policy=route,
            grant_id="grant-1",
        )
        self.assertEqual(
            set(first),
            {
                "command_id",
                "job_id",
                "step_id",
                "input_digest",
                "input_payload",
                "worker_id",
                "route_policy",
                "grant_id",
                "state",
            },
        )
        self.assertEqual(first["state"], "queued")
        self.assertEqual(first["grant_id"], "grant-1")
        self.assertEqual(first["job_id"], "job:extra")
        self.assertEqual(first["step_id"], "step:1")
        self.assertEqual(
            first["input_digest"],
            digest({"input_payload": payload, "worker_id": "worker-1", "route_policy": route}),
        )
        self.assertNotIn("grant-1", first["input_digest"])
        seen.clear()
        renewed = store.accept_command(
            "job:extra",
            "step:1",
            {"flags": ["b", "a"], "step": 1},
            worker_id="worker-1",
            route_policy={"routes": ["local", "remote"], "revision": 2},
            grant_id="grant-2",
        )
        self.assertEqual(renewed, first)
        self.assertEqual(store.command(first["command_id"]), first)
        self.assertEqual(seen, [])
        self.assertEqual(len(store.commands()), 1)
        rows = store.outbox_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["message_id"], "command:job%3Aextra:step%3A1")
        self.assertEqual(rows[0]["sender"], "worker-1")
        self.assertEqual(rows[0]["recipient"], "worker-1")
        self.assertEqual(rows[0]["payload"]["command_id"], first["command_id"])
        self.assertEqual(rows[0]["payload"]["grant_id"], "grant-1")
        self.assertEqual(rows[0]["payload_digest"], digest(rows[0]["payload"]))
        self.assertIsNone(rows[0]["receipt_id"])
        self.assertEqual(store.pending_outbox()[0]["message_id"], rows[0]["message_id"])
        with self.assertRaises(ConflictError):
            store.accept_command(
                "job:extra",
                "step:1",
                payload,
                worker_id="worker-2",
                route_policy=route,
                grant_id="grant-1",
            )
        with self.assertRaises(ConflictError):
            store.accept_command(
                "job:extra",
                "step:1",
                {"step": 2},
                worker_id="worker-1",
                route_policy=route,
                grant_id="grant-9",
            )
        with self.assertRaises(ConflictError):
            store.accept_command(
                "job:extra",
                "step:1",
                payload,
                worker_id="worker-1",
                route_policy={"routes": ["local"], "revision": 2},
                grant_id="grant-1",
            )
        self.assertEqual(store.command(first["command_id"]), first)
        self.assertEqual(len(store.outbox_rows()), 1)
        payload["flags"].append("mutated")
        route["routes"].append("mutated")
        self.assertEqual(store.command(first["command_id"])["input_payload"], {"step": 1, "flags": ["b", "a"]})
        self.assertEqual(store.command(first["command_id"])["route_policy"]["routes"], ["local", "remote"])
        self.assertIsNone(store.command("missing-command"))
        other = self.accept(store, job_id="job:extra", step_id="step:2")
        self.assertNotEqual(other["command_id"], first["command_id"])
        self.assertEqual([row["step_id"] for row in store.commands()], ["step:1", "step:2"])
        listed = store.commands()
        listed[0]["state"] = "running"
        self.assertEqual(store.commands()[0]["state"], "queued")

    def test_usage_counts_commands_and_prepared_attempts_only(self):
        store = self.open()
        self.addCleanup(store.close)
        first = self.accept(store, job_id="job-1", step_id="step-1")
        self.accept(store, job_id="job-1", step_id="step-2")
        self.accept(store, job_id="job-2", step_id="step-1")
        for index, state in enumerate(("dispatch_prepared", "cancelled", "outcome_unknown")):
            store._db.execute(
                """INSERT INTO attempts(attempt_id,command_id,operation_id,state,route,grant_snapshot,
                   controller_epoch,fence,lease_until,stop_proven,effects_resolved,result)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    "attempt-%d" % index,
                    first["command_id"],
                    "operation-%d" % index,
                    state,
                    "{}",
                    "{}",
                    store.controller_epoch,
                    index + 1,
                    10.0,
                    0,
                    0,
                    None,
                ),
            )
        store.receive_message("alice", self.envelope(), "bob")
        store.receive_message("alice", self.envelope(), "bob")
        usage = store.usage("job-1")
        self.assertEqual(usage, {"turns": 3, "messages": 2, "provider_tokens": None, "provider_cost": None})
        self.assertEqual(store.usage("job-2"), {"turns": 0, "messages": 1, "provider_tokens": None, "provider_cost": None})
        self.assertEqual(store.usage("job-none"), {"turns": 0, "messages": 0, "provider_tokens": None, "provider_cost": None})
        with self.assertRaises(StoreError):
            store.usage("")

    def test_command_and_outbox_faults_roll_back(self):
        def fail(point_name):
            def fault(point):
                if point == point_name:
                    raise RuntimeError(point_name)
            return fault

        cases = (
            ("inbox_before_commit", "inbox"),
            ("outbox_before_commit", "outbox"),
            ("command_before_outbox", "command"),
            ("audit_before_write", "audit-record"),
            ("audit_before_write", "audit-command"),
            ("audit_before_write", "audit-outbox"),
        )
        for point_name, label in cases:
            path = os.path.join(self._tmp.name, label + ".sqlite")
            store = self.open(fault=fail(point_name), path=path)
            try:
                with self.assertRaises(RuntimeError):
                    if label == "inbox":
                        store.receive_message("alice", self.envelope(), "bob")
                    elif label == "outbox" or label == "audit-outbox":
                        store.enqueue_outbox("note-1", "alice", "bob", {"text": "hello"})
                    elif label == "audit-record":
                        store.put_record("registry", "alpha", self.record(1, name="alpha"))
                    else:
                        self.accept(store)
                self.assertEqual(store.inbox_rows(), [])
                self.assertEqual(store.outbox_rows(), [])
                self.assertEqual(store.commands(), [])
                self.assertEqual(store.records("registry"), {})
                self.assertEqual(store.audit_rows(), [])
            finally:
                store.close()
            fresh = self.open(path=path)
            self.addCleanup(fresh.close)
            self.assertEqual(fresh.inbox_rows(), [])
            self.assertEqual(fresh.outbox_rows(), [])
            self.assertEqual(fresh.commands(), [])
            self.assertEqual(fresh.audit_rows(), [])

        armed = {"fire": True}

        def once(point):
            if point == "command_before_outbox" and armed["fire"]:
                armed["fire"] = False
                raise RuntimeError("command_before_outbox")

        store = self.open(fault=once)
        self.addCleanup(store.close)
        with self.assertRaises(RuntimeError):
            self.accept(store)
        self.assertEqual(store.commands(), [])
        command = self.accept(store)
        self.assertEqual(store.command(command["command_id"])["state"], "queued")
        self.assertEqual(len(store.outbox_rows()), 1)
        self.assertEqual(store.audit_rows()[0]["kind"], "command.accept")
        self.assertEqual(store.audit_rows()[0]["payload"]["command_id"], command["command_id"])

    def test_nested_transaction_rollback(self):
        store = self.open()
        self.addCleanup(store.close)
        with store.transaction():
            store.put_record("registry", "outer", self.record(1, name="outer"))
            try:
                with store.transaction():
                    store.put_record("registry", "inner", self.record(1, name="inner"))
                    self.accept(store)
                    raise RuntimeError("inner")
            except RuntimeError:
                pass
        self.assertEqual(store.get_record("registry", "outer"), self.record(1, name="outer"))
        self.assertIsNone(store.get_record("registry", "inner"))
        self.assertEqual(store.commands(), [])
        self.assertEqual(store.outbox_rows(), [])
        self.assertEqual([row["payload"]["key"] for row in store.audit_rows()], ["outer"])
        try:
            with store.transaction():
                store.receive_message("alice", self.envelope(), "bob")
                store.enqueue_outbox("note-1", "alice", "bob", {"text": "hello"})
                self.accept(store, job_id="job-9", step_id="step-9")
                raise RuntimeError("outer")
        except RuntimeError:
            pass
        self.assertEqual(store.inbox_rows(), [])
        self.assertEqual([row["message_id"] for row in store.outbox_rows()], [])
        self.assertEqual(store.commands(), [])
        self.assertEqual(store.get_record("registry", "outer")["name"], "outer")
        self.assertEqual(len(store.audit_rows()), 1)


if __name__ == "__main__":
    unittest.main()
