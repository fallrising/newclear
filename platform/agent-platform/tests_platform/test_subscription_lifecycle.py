"""Real DB leases: an uncertain subscription launch is never repeated on recovery."""

from unittest.mock import Mock

from test_subscription import SubscriptionFixture

from agent_platform.connector_recovery import STOP_KEYS
from agent_platform.domain import Problem
from agent_platform.store import Store
from agent_platform.worker import Worker


class LifecycleTests(SubscriptionFixture):
    backend = "claude-subscription"
    driver_argument = "subscription"
    other_driver_argument = "codex_subscription"

    def test_ex01_uncertain_subscription_is_not_restarted(self):
        self.uncertain("subscription_result_unconfirmed")

    def test_fn06_deadline_keeps_reason_and_never_restarts(self):
        self.uncertain("subscription_deadline_expired")

    def test_cancel_uncertain_subscription_without_any_driver(self):
        run_id = self.uncertain("subscription_result_unconfirmed")
        run = Store(self.db).run(run_id)
        reply = self.post(
            f"/runs/{run_id}/actions",
            {"action": "cancel", "expected_state_version": run["state_version"]},
        )
        self.assertEqual(reply.status_code, 202, reply.text)
        connector = Mock()
        connector.cancel.return_value = {
            "observed_state": "stopped",
            "proof": {key: True for key in STOP_KEYS},
        }
        worker = Worker(self.db, connector)
        claim = worker.claim_cancel()
        self.assertEqual(claim["backend"], self.backend)
        worker.execute(claim)
        connector.cancel.assert_called_once()
        connector.allocate.assert_not_called()
        row = Store(self.db).run(run_id)
        self.assertEqual(row["state"], "cancelled")
        self.assertEqual(row["cleanup_state"], "confirmed")
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)

    def uncertain(self, reason):
        self.real_profile()
        response = self.post(
            "/agent-profiles",
            {
                "name": "Claude",
                "backend": self.backend,
                "deadline_seconds": 600,
                "verification": {
                    "mode": "commands",
                    "revision": "test-v1",
                    "checks": [{"id": "test", "argv": ["true"], "timeout_seconds": 1}],
                },
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.payload["profile_revision"] = response.json()["id"]
        created = self.create()
        connector = Mock()
        connector.allocate.return_value = {
            "handle": "owned-handle",
            "lease_deadline": "2099-01-01T00:00:00Z",
            "vm_id": "owned-vm",
        }
        connector.operation.return_value = {"ref": created["run"]["id"], "model_transport": False}
        driver = Mock()
        driver.execute.side_effect = Problem(409, reason)
        other_driver = Mock()
        worker = Worker(
            self.db,
            connector,
            **{self.driver_argument: driver, self.other_driver_argument: other_driver},
        )
        worker.execute(worker.claim())
        self.assertEqual(driver.execute.call_count, 1)
        other_driver.execute.assert_not_called()
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT state,reason,cleanup_state FROM runs WHERE id=%s", (created["run"]["id"],)
            ).fetchone()
            self.assertEqual(row["state"], "interrupted")
            self.assertEqual(row["reason"], reason)
            self.assertEqual(row["cleanup_state"], "unknown")
            conn.execute(
                "UPDATE jobs SET available_at=clock_timestamp() WHERE run_id=%s",
                (created["run"]["id"],),
            )
        connector.inspect.return_value = {
            "phase": "prepared",
            "allocation": connector.allocate.return_value,
            "prepared": connector.operation.return_value,
        }
        worker.execute(worker.claim())
        self.assertEqual(driver.execute.call_count, 1)
        other_driver.execute.assert_not_called()
        self.assertEqual(connector.allocate.call_count, 1)
        self.assertFalse(
            any(call.args[1] == "release" for call in connector.operation.call_args_list)
        )
        return created["run"]["id"]


class CodexLifecycleTests(LifecycleTests):
    backend = "codex-subscription"
    driver_argument = "codex_subscription"
    other_driver_argument = "subscription"
