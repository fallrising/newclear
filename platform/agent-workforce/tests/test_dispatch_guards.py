"""Dispatch guards for outer transactions and a prepared execution lease."""
import os
import tempfile
import unittest
from pathlib import Path

from agent_workforce.admission import AdmissionError
from agent_workforce.controller import Controller
from agent_workforce.fake import FakeBackend
from agent_workforce.store import Store, StoreError
from support import NOW, grant, records, request


class _Rollback(Exception):
    """Forces the caller-owned Store transaction to roll back."""


class DispatchGuardTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=os.environ.get("AGENT_BUILD_DIR"))
        self.addCleanup(self.directory.cleanup)
        self.now = NOW
        self.store = Store(Path(self.directory.name) / "state.sqlite")
        self.addCleanup(self.store.close)
        self.backend = FakeBackend()
        self.controller = Controller(
            self.store,
            self.backend,
            clock=lambda: self.now,
            trusted_issuers=("operator-example",),
        )
        for kind, rows in records().items():
            for key, row in rows.items():
                self.controller.register(kind, key, row)
        self.controller.put_grant(grant(), authenticated_operator="operator-example")

    def _reject_and_roll_back(self, call):
        with self.assertRaises(_Rollback):
            with self.store.transaction():
                with self.assertRaises(StoreError) as caught:
                    call()
                self.assertEqual(str(caught.exception), "commit the outer Store transaction first")
                raise _Rollback()

    def test_nested_dispatch_rejects_before_start(self):
        command = self.controller.accept(request(), authenticated_caller="operator-example")
        self._reject_and_roll_back(lambda: self.controller.dispatch(command["command_id"]))
        self.assertEqual(self.backend.starts, [])
        self.assertEqual(self.store.attempts(), [])
        self.assertEqual(self.store.reservations(), [])

    def test_nested_reconcile_rejects_before_inspect(self):
        command = self.controller.accept(request(), authenticated_caller="operator-example")
        attempt = self.controller.dispatch(command["command_id"])
        before = self.store.attempt(attempt["attempt_id"])
        slots = self.store.reservations()
        self._reject_and_roll_back(lambda: self.controller.reconcile(attempt["attempt_id"]))
        self.assertEqual(self.backend.inspections, [])
        self.assertEqual(self.backend.stops, [])
        self.assertEqual(self.store.attempt(attempt["attempt_id"]), before)
        self.assertEqual(self.store.reservations(), slots)

    def test_nested_stop_rejects_before_stop(self):
        command = self.controller.accept(request(), authenticated_caller="operator-example")
        attempt = self.controller.dispatch(command["command_id"])
        before = self.store.attempt(attempt["attempt_id"])
        slots = self.store.reservations()
        self._reject_and_roll_back(lambda: self.controller.stop(attempt["attempt_id"]))
        self.assertEqual(self.backend.inspections, [])
        self.assertEqual(self.backend.stops, [])
        self.assertEqual(self.store.attempt(attempt["attempt_id"]), before)
        self.assertEqual(self.store.reservations(), slots)

    def test_profile_only_prepared_lease_expiry_cancels_without_start(self):
        command = self.controller.accept(request(), authenticated_caller="operator-example")
        self.controller.clock = lambda: 1120 if self.store.attempts() else 1000
        with self.assertRaises(AdmissionError) as caught:
            self.controller.dispatch(command["command_id"])
        self.assertEqual(caught.exception.reason, "prepared_lease_expired")
        self.assertEqual(self.backend.starts, [])
        self.assertEqual(self.backend.inspections, [])
        self.assertEqual(self.backend.stops, [])
        attempts = self.store.attempts()
        self.assertEqual(len(attempts), 1)
        attempt = attempts[0]
        self.assertEqual(attempt["state"], "cancelled")
        self.assertIs(attempt["stop_proven"], True)
        self.assertIs(attempt["effects_resolved"], True)
        confirmed = [
            row["payload"] for row in self.store.audit_rows() if row["kind"] == "stop_confirmed"
        ]
        self.assertEqual(confirmed, [{
            "attempt_id": attempt["attempt_id"],
            "operation_id": attempt["operation_id"],
            "stop_proven": True,
            "effects_resolved": True,
            "not_started": True,
        }])
        self.assertEqual([row for row in self.store.reservations() if not row["released"]], [])
