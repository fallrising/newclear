"""EX-01 subscription admission uses real PostgreSQL jobs."""

import test_runtime
from test_control_plane import PlatformFixture

from agent_platform.worker import Worker


class SubscriptionFixture(PlatformFixture):
    real_profile = test_runtime.RuntimeTests.real_profile
    clear_catalog = test_runtime.RuntimeTests.clear_catalog

    def setUp(self):
        super().setUp()
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM runtime_catalog")
        self.addCleanup(self.clear_catalog)


class SubscriptionTests(SubscriptionFixture):
    def test_ex01_subscription_profile_and_claim(self):
        self.real_profile()
        response = self.post(
            "/agent-profiles",
            {
                "name": "Claude subscription",
                "backend": "claude-subscription",
                "deadline_seconds": 600,
                "verification": {
                    "mode": "commands",
                    "revision": "repair-v1",
                    "checks": [
                        {
                            "id": "tests",
                            "argv": ["python3", "-m", "unittest"],
                            "timeout_seconds": 10,
                        }
                    ],
                },
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        profile = response.json()
        self.assertEqual(profile["model_ref"], "claude-subscription:claude-opus-5-5")
        self.assertTrue(profile["capabilities"]["cancel"])
        self.assertFalse(profile["capabilities"]["pause"])
        self.payload["profile_revision"] = profile["id"]
        run = self.create()["run"]
        self.assertEqual(run["execution_mode"], "cocoon-external")
        self.assertIsNone(Worker(self.db).claim())
        self.assertIsNone(Worker(self.db, connector=object()).claim())
        worker = Worker(self.db, connector=object(), subscription=object())
        claim = worker.claim()
        self.assertEqual(str(claim["run_id"]), run["id"])
        self.assertEqual(claim["backend"], "claude-subscription")
        with worker.owned(claim) as (_, owned):
            self.assertEqual(owned["generation"], claim["generation"])
            self.assertIsNotNone(owned["lease_until"])

    def test_ex01_subscription_rejects_unbounded_and_mock(self):
        self.real_profile()
        for fields in (
            {"deadline_seconds": 601},
            {"mock_tools": True},
            {"require_approval": True},
            {"verification": {"mode": "fixture-m2"}},
        ):
            with self.subTest(fields=fields):
                reply = self.post(
                    "/agent-profiles",
                    {
                        "name": "invalid",
                        "backend": "claude-subscription",
                        "deadline_seconds": 600,
                        **fields,
                    },
                )
                self.assertIn(reply.status_code, (409, 422))
