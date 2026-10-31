"""Real DB leases: an uncertain subscription launch is never repeated on recovery."""

from unittest.mock import Mock

from test_subscription import SubscriptionFixture

from agent_platform.domain import Problem
from agent_platform.worker import Worker


class LifecycleTests(SubscriptionFixture):
    def test_ex01_uncertain_subscription_is_not_restarted(self):
        self.real_profile()
        response = self.post(
            "/agent-profiles",
            {
                "name": "Claude",
                "backend": "claude-subscription",
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
        driver.execute.side_effect = Problem(409, "subscription_result_unconfirmed")
        worker = Worker(self.db, connector, subscription=driver)
        worker.execute(worker.claim())
        self.assertEqual(driver.execute.call_count, 1)
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT state,reason,cleanup_state FROM runs WHERE id=%s", (created["run"]["id"],)
            ).fetchone()
            self.assertEqual(row["state"], "interrupted")
            self.assertEqual(row["reason"], "subscription_result_unconfirmed")
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
        self.assertEqual(connector.allocate.call_count, 1)
        self.assertFalse(
            any(call.args[1] == "release" for call in connector.operation.call_args_list)
        )
