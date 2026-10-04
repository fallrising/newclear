"""Actual model cutoff crosses the broker boundary; dedicated PostgreSQL only."""

import concurrent.futures
import threading
import unittest
from uuid import uuid4

import test_tool_broker as broker_fixture
from test_control_plane import URL

from agent_platform.domain import Problem
from agent_platform.model_policy import Policy
from agent_platform.model_proxy import ModelProxy


@unittest.skipUnless(URL, "Use make platform-test for an isolated PostgreSQL")
class IntegratedCutoffTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Compose the existing fixture without inheriting/rerunning its test suite.
        broker_fixture.ToolBrokerTests.setUpClass()
        cls.addClassCleanup(broker_fixture.ToolBrokerTests.doClassCleanups)

    def setUp(self):
        self.fixture = broker_fixture.ToolBrokerTests()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.setUp()
        self.proxy = ModelProxy(
            self.fixture.db,
            Policy(
                "http://127.0.0.1:12345", "integrated-synthetic-model-token-0001", request_limit=2
            ),
            upstream=object(),
        )
        self.model_token = self.proxy.issue(self.fixture.run, 1, self.fixture.worker.owner)

    def cutoff(self):
        self.proxy.cutoff(
            self.fixture.run, 1, self.fixture.worker.owner, "model_request_limit_reached"
        )

    def assert_cutoff_retains_capacity(self):
        f = self.fixture
        with f.db.transaction() as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) AS n FROM model_proxy_tokens "
                    "WHERE run_id=%s AND revoked_at IS NULL",
                    (f.run,),
                ).fetchone()["n"],
                0,
            )
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) AS n FROM run_events WHERE run_id=%s AND type='model.cutoff'",
                    (f.run,),
                ).fetchone()["n"],
                1,
            )
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) AS n FROM resource_reservations "
                    "WHERE sandbox_id=%s AND released_at IS NULL",
                    (f.binding,),
                ).fetchone()["n"],
                1,
            )

    def test_real_cutoff_is_idempotent_and_denies_new_broker_admission(self):
        f = self.fixture
        self.cutoff()
        self.cutoff()
        self.assert_cutoff_retains_capacity()
        with self.assertRaisesRegex(Problem, "tool_run_not_live"):
            f.execute()
        self.assertEqual(f.upstream.calls, 0)
        self.assertEqual(f.scalar("SELECT count(*) FROM tool_broker_operations"), 0)

    def test_inflight_cutoff_withholds_late_result_without_wait_replay_or_ack(self):
        f = self.fixture
        entered, release = threading.Event(), threading.Event()
        calls = f.success_adapter(entered=entered, release=release)
        operation = uuid4()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            work = pool.submit(f.execute, operation_id=operation)
            try:
                self.assertTrue(entered.wait(3), "authenticated hop never started")
                # A separate future makes a blocking cutoff fail deterministically.
                stopped = pool.submit(self.cutoff)
                stopped.result(timeout=2)
                self.assertFalse(release.is_set())
                self.assertFalse(work.done())
                self.assert_cutoff_retains_capacity()
                with self.assertRaisesRegex(Problem, "tool_run_not_live"):
                    f.execute()
            finally:
                release.set()
            with self.assertRaisesRegex(Problem, "tool_completion_revoked"):
                work.result(timeout=3)
        with f.db.transaction() as conn:
            row = conn.execute(
                "SELECT status,delivery,http_calls,receipt_hash "
                "FROM tool_broker_operations WHERE operation_id=%s",
                (operation,),
            ).fetchone()
        self.assertEqual(
            (row["status"], row["delivery"], row["http_calls"]), ("succeeded", "withheld", 1)
        )
        self.assertIsNone(row["receipt_hash"])
        with self.assertRaisesRegex(Problem, "tool_run_not_live"):
            f.execute(operation_id=operation)
        with self.assertRaisesRegex(Problem, "tool_run_not_live"):
            f.broker.acknowledge(f.run, f.token, operation, "A" * 43)
        self.assertEqual(len(calls), 1)
        self.assert_cutoff_retains_capacity()

    def test_cutoff_after_delivery_revokes_receipt_ack_without_replay(self):
        f = self.fixture
        calls = f.success_adapter()
        operation = uuid4()
        delivered = f.execute(operation_id=operation)
        self.assertIn("receipt", delivered)
        self.cutoff()
        with self.assertRaisesRegex(Problem, "tool_run_not_live"):
            f.ack(operation, delivered)
        with self.assertRaisesRegex(Problem, "tool_run_not_live"):
            f.execute(operation_id=operation)
        self.assertEqual(len(calls), 1)
        self.assertEqual(
            f.scalar("SELECT count(*) FROM tool_broker_operations WHERE delivery='acknowledged'"), 0
        )
        self.assert_cutoff_retains_capacity()
