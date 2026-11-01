"""Focused controller and fake-backend checks. Root owns the broad integration suite."""
import sqlite3
import tempfile
import unittest
from pathlib import Path

from agent_workforce.admission import AdmissionError
from agent_workforce.controller import Controller
from agent_workforce.fake import FakeBackend
from agent_workforce.store import ConflictError, Store
from support import NOW, grant, records, request


class ControllerFocus(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "state.sqlite"
        self.now = NOW
        self.store = Store(self.path)
        self.addCleanup(self.store.close)
        self.backend = FakeBackend()
        self.controller = Controller(
            self.store,
            self.backend,
            clock=lambda: self.now,
            trusted_issuers=("operator-example",),
        )
        for kind, rows in records().items():
            for key, value in rows.items():
                self.controller.register(kind, key, value)
        self.controller.put_grant(grant(), authenticated_operator="operator-example")

    def accept(self, body=None):
        return self.controller.accept(body or request(), authenticated_caller="operator-example")

    def test_duplicate_accept_is_budget_free_and_changed_envelope_conflicts(self):
        self.controller.put_grant(
            grant(revision=2, max_messages=1, max_turns=1),
            authenticated_operator="operator-example",
        )
        first = self.accept()
        payload = self.store.command(first["command_id"])["input_payload"]
        self.assertNotIn("grant_id", payload)
        self.assertEqual(payload["operation"], "execute")
        self.assertEqual(payload["resource_scopes"]["workspace-a"]["write"], ["src"])
        duplicate = self.accept()
        self.assertEqual(duplicate["command_id"], first["command_id"])
        self.assertEqual(len(self.store.commands()), 1)
        self.assertEqual(len(self.store.outbox_rows()), 1)
        with self.assertRaises(ConflictError):
            self.accept(request(operation="rework"))
        with self.assertRaises(AdmissionError):
            self.accept(request(step_id="write-1"))
        self.assertEqual(self.store.usage("job-example")["messages"], 1)
        self.assertEqual(self.store.usage("job-example")["turns"], 0)
        self.assertEqual(self.backend.starts, [])

    def test_prepared_intent_commits_before_one_backend_start(self):
        command = self.accept()
        observed = {}

        def observe(operation_id):
            with sqlite3.connect(self.path) as reader:
                observed["rows"] = reader.execute(
                    "SELECT state FROM attempts WHERE operation_id=?",
                    (operation_id,),
                ).fetchall()

        self.backend.before_start = observe
        attempt = self.controller.dispatch(command["command_id"])
        self.assertEqual(observed["rows"], [("dispatch_prepared",)])
        self.assertEqual(attempt["state"], "running")
        self.assertEqual(len(self.backend.starts), 1)
        again = self.controller.dispatch(command["command_id"])
        self.assertEqual(again["operation_id"], attempt["operation_id"])
        self.assertEqual(len(self.backend.starts), 1)
        self.assertEqual(len(self.store.attempts()), 1)

    def test_lost_acknowledgement_keeps_the_original_operation(self):
        self.backend.mode = "accept_then_raise"
        command = self.accept()
        attempt = self.controller.dispatch(command["command_id"])
        self.assertEqual(attempt["state"], "outcome_unknown")
        again = self.controller.dispatch(command["command_id"])
        self.assertEqual(again["operation_id"], attempt["operation_id"])
        self.assertEqual(len(self.backend.starts), 1)
        self.assertEqual(len(self.store.attempts()), 1)
        self.assertTrue(any(not row["released"] for row in self.store.reservations()))

    def test_revocation_after_prepare_cancels_without_start(self):
        command = self.accept()
        revoked = []

        def clock():
            if not revoked and self.store.attempts():
                revoked.append(True)
                self.controller.put_grant(
                    grant(revision=2, revoked=True),
                    authenticated_operator="operator-example",
                )
            return self.now

        self.controller.clock = clock
        with self.assertRaises(AdmissionError):
            self.controller.dispatch(command["command_id"])
        self.assertTrue(revoked)
        self.assertEqual(self.backend.starts, [])
        attempt = self.store.attempts()[0]
        self.assertEqual(attempt["state"], "cancelled")
        self.assertTrue(attempt["stop_proven"])
        self.assertTrue(attempt["effects_resolved"])
        self.assertEqual([row for row in self.store.reservations() if not row["released"]], [])

    def test_reconcile_finishes_the_original_operation_only(self):
        self.backend.mode = "accept_then_raise"
        command = self.accept()
        attempt = self.controller.dispatch(command["command_id"])
        self.backend.finish(attempt["operation_id"], {"candidate": "synthetic"})
        self.now = attempt["lease_until"] + 1
        self.store.expire_leases(self.now)
        found = self.controller.reconcile(attempt["attempt_id"])
        self.assertEqual(found["operation_id"], attempt["operation_id"])
        self.assertEqual(found["state"], "awaiting_review")
        self.assertEqual(found["result"], {"candidate": "synthetic"})
        self.assertEqual(len(self.backend.starts), 1)
        self.assertEqual(len(self.backend.inspections), 1)
        self.assertEqual(self.backend.inspections[0], attempt["operation_id"])
        self.assertEqual([row for row in self.store.reservations() if not row["released"]], [])
        self.assertNotEqual(self.store.command(command["command_id"])["state"], "done")


if __name__ == "__main__":
    unittest.main()
