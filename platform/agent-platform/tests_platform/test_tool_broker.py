"""TB-1: real PostgreSQL authority/ledger and dedicated HTTP ingress; no guest proof."""

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from test_control_plane import PlatformFixture

from agent_platform.domain import Problem
from agent_platform.tool_broker.broker import Broker
from agent_platform.tool_broker.policy import Policy
from agent_platform.worker import Worker


class NeverUpstream:
    def __init__(self):
        self.calls = 0

    def execute(self, payload, *, before_hop):
        self.calls += 1
        raise AssertionError("unauthorized upstream dispatch")


class ToolBrokerTests(PlatformFixture):
    def setUp(self):
        super().setUp()
        with self.db.transaction() as conn:
            conn.execute("TRUNCATE tool_broker_services CASCADE")
            conn.execute(
                "INSERT INTO runtime_catalog(node_id,template_digest,repositories,"
                "egress_policy_sha256) VALUES ('cocoon-local',%s,%s,%s) ON CONFLICT(node_id) "
                "DO UPDATE SET repositories=excluded.repositories",
                (
                    "fixture@sha256:" + "a" * 64,
                    json.dumps(
                        [
                            {
                                "canonical_repo": self.project["canonical_repo"],
                                "base_sha": self.payload["base_sha"],
                            }
                        ]
                    ),
                    "b" * 64,
                ),
            )
        profile = self.post("/agent-profiles", {"name": "Tool fixture", "backend": "openhands"})
        self.payload["profile_revision"] = profile.json()["id"]
        self.run, self.worker, self.binding = self.running()
        self.policy = Policy(
            service_id=uuid4(),
            credential_revision=uuid4(),
            origin="http://127.0.0.1:12345",
            credential_origin="http://127.0.0.1:12345",
            credential_path_prefix="/repos/example/project/",
            secret="tb1-fixture-canary",
            repository_id=123,
            owner="example",
            repository="project",
            commit="a" * 40,
            paths=("README.md",),
            issues=(1,),
            request_limit=2,
        )
        self.upstream = NeverUpstream()
        self.broker = Broker(self.db, self.policy, adapter=self.upstream)
        self.broker.provision(
            self.run,
            1,
            self.worker.owner,
            self.binding,
            expires_at=datetime.now(UTC) + timedelta(minutes=2),
        )
        self.token = self.broker.issue(self.run, 1, self.worker.owner, self.binding)
        self.payload_tool = {"operation": "github.repository.get", "repository_id": 123}

    def running(self):
        run = UUID(self.create()["run"]["id"])
        worker = Worker(self.db)
        claim = worker.claim_node("cocoon-local", "openhands")
        self.assertEqual(claim["run_id"], run)
        with worker.owned(claim) as (conn, row):
            worker.state(conn, row, "running")
            binding = conn.execute(
                "UPDATE sandbox_bindings SET observed_state='running' WHERE run_id=%s RETURNING id",
                (run,),
            ).fetchone()["id"]
        return run, worker, binding

    def execute(self, *, run=None, token=None, operation_id=None, payload=None):
        return self.broker.execute(
            run or self.run,
            token or self.token,
            operation_id or uuid4(),
            payload if payload is not None else self.payload_tool,
        )

    def test_reserved_identity_is_denied_before_dispatch(self):
        with self.assertRaises(Problem):
            self.execute(payload={**self.payload_tool, "run_id": str(self.run)})
        self.assertEqual(self.upstream.calls, 0)
        self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_operations"), 0)

    def test_model_audience_and_cross_run_token_are_denied(self):
        other, _, _ = self.running()
        for run, token in [(self.run, "mp1_" + "a" * 43), (other, self.token)]:
            with self.subTest(run=run), self.assertRaises(Problem):
                self.execute(run=run, token=token)
        self.assertEqual(self.upstream.calls, 0)

    def test_pause_blocks_new_admission(self):
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET state='pausing' WHERE id=%s", (self.run,))
        with self.assertRaises(Problem):
            self.execute()
        self.assertEqual(self.upstream.calls, 0)

    def success_adapter(self, *, entered=None, release=None, fail=False, crash=False):
        from types import SimpleNamespace

        calls = []

        class Adapter:
            def execute(inner, payload, *, before_hop):
                before_hop()
                calls.append(payload)
                if entered:
                    entered.set()
                if release and not release.wait(5):
                    raise TimeoutError
                if crash:
                    raise SystemExit("fixture process death")
                if fail:
                    raise RuntimeError("private upstream body tb1-fixture-canary")
                return SimpleNamespace(
                    value={"id": 123, "name": "project"}, http_calls=1, response_bytes=27
                )

        self.broker.adapter = Adapter()
        return calls

    def ack(self, operation_id, response):
        return self.broker.acknowledge(self.run, self.token, operation_id, response["receipt"])

    def test_success_is_single_delivery_and_requires_receipt(self):
        calls = self.success_adapter()
        operation_id = uuid4()
        response = self.execute(operation_id=operation_id)
        self.assertEqual(response["status"], "succeeded")
        self.assertEqual(response["http_calls"], 1)
        with self.assertRaisesRegex(Problem, "tool_delivery_unconfirmed"):
            self.execute()
        retry = self.execute(operation_id=operation_id)
        self.assertEqual(retry["delivery"], "unknown")
        self.assertNotIn("result", retry)
        self.assertNotIn("receipt", retry)
        with self.assertRaisesRegex(Problem, "tool_receipt_invalid"):
            self.broker.acknowledge(self.run, self.token, operation_id, "a" * 43)
        self.ack(operation_id, response)
        self.ack(operation_id, response)
        self.assertEqual(self.execute(operation_id=operation_id)["delivery"], "acknowledged")
        self.assertEqual(len(calls), 1)

    def test_same_id_conflict_and_durable_request_cap_across_token_rotation(self):
        from dataclasses import replace

        calls = self.success_adapter()
        first = uuid4()
        response = self.execute(operation_id=first)
        self.ack(first, response)
        with self.assertRaisesRegex(Problem, "tool_idempotency_conflict"):
            self.execute(
                operation_id=first,
                payload={"operation": "github.issue.get", "repository_id": 123, "issue_number": 1},
            )
        self.token = self.broker.issue(self.run, 1, self.worker.owner, self.binding)
        second = uuid4()
        self.ack(second, self.execute(operation_id=second))
        with self.assertRaisesRegex(Problem, "tool_request_limit"):
            self.execute()
        changed = Broker(
            self.db, replace(self.policy, request_limit=3), adapter=self.broker.adapter
        )
        with self.assertRaisesRegex(Problem, "tool_grant_invalid"):
            changed.execute(self.run, self.token, uuid4(), self.payload_tool)
        self.assertEqual(len(calls), 2)

    def test_concurrent_duplicate_has_one_dispatch_and_in_flight_is_bounded(self):
        import concurrent.futures
        import threading

        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        calls = self.success_adapter(entered=entered, release=release)
        operation_id = uuid4()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            first = pool.submit(self.execute, operation_id=operation_id)
            self.assertTrue(entered.wait(3))
            duplicates = list(pool.map(lambda _: self.execute(operation_id=operation_id), range(4)))
            self.assertEqual({x["status"] for x in duplicates}, {"admitted"})
            self.assertEqual(len(calls), 1)
            release.set()
            self.ack(operation_id, first.result(timeout=3))
        self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_operations"), 1)

    def test_request_limit_race_and_network_holds_no_lifecycle_lock(self):
        import concurrent.futures
        import threading

        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        calls = self.success_adapter(entered=entered, release=release)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            first = pool.submit(self.execute)
            self.assertTrue(entered.wait(3))
            second = pool.submit(self.execute)
            # Wait on observable SQL reservation, not arbitrary scheduling sleeps.
            import time

            deadline = time.monotonic() + 3
            while self.scalar("SELECT count(*) FROM tool_broker_operations") < 2:
                if time.monotonic() >= deadline:
                    self.fail("second operation not admitted")
                time.sleep(0.01)
            with self.assertRaisesRegex(Problem, "tool_request_limit"):
                self.execute()
            # This transaction would fail its short lock timeout if network held run lock.
            with self.db.transaction() as conn:
                conn.execute("SET LOCAL lock_timeout='500ms'")
                conn.execute("UPDATE runs SET state='pausing' WHERE id=%s", (self.run,))
            release.set()
            for future in (first, second):
                with self.assertRaisesRegex(Problem, "tool_completion_revoked"):
                    future.result(timeout=3)
        self.assertEqual(len(calls), 2)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM tool_broker_operations WHERE delivery='withheld'"), 2
        )

    def test_unknown_after_failure_or_crash_is_never_redispatched(self):
        calls = self.success_adapter(fail=True)
        operation_id = uuid4()
        with self.assertRaisesRegex(Problem, "tool_outcome_unknown"):
            self.execute(operation_id=operation_id)
        self.assertEqual(self.execute(operation_id=operation_id)["status"], "unknown")
        self.assertEqual(len(calls), 1)
        calls = self.success_adapter(crash=True)
        second = uuid4()
        with self.assertRaises(SystemExit):
            self.execute(operation_id=second)
        # Restart retains admission and counters; expiry reconciles to unknown, never retry.
        self.broker = Broker(self.db, self.policy, adapter=self.broker.adapter)
        self.assertEqual(self.execute(operation_id=second)["status"], "admitted")
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE tool_broker_operations SET deadline_at=clock_timestamp() "
                "WHERE operation_id=%s",
                (second,),
            )
        self.assertEqual(self.execute(operation_id=second)["status"], "unknown")
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.scalar("SELECT sum(http_calls) FROM tool_broker_operations"), 2)

    def test_failed_admission_commit_has_zero_dispatch(self):
        from contextlib import contextmanager
        from unittest.mock import patch

        import psycopg

        calls = self.success_adapter()
        transaction = self.db.transaction

        @contextmanager
        def fail_commit():
            with transaction() as conn:
                yield conn
                raise psycopg.OperationalError("fixture commit failure")

        with patch.object(self.db, "transaction", fail_commit), self.assertRaises(psycopg.Error):
            self.execute()
        self.assertEqual(calls, [])
        self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_operations"), 0)

    def test_revocation_before_next_hop_blocks_send_and_preserves_unknown(self):
        broker, run = self.broker, self.run
        calls = []

        class Adapter:
            def execute(inner, payload, *, before_hop):
                before_hop()
                calls.append("first")
                broker.revoke(run)
                before_hop()
                calls.append("forbidden second")

        self.broker.adapter = Adapter()
        with self.assertRaisesRegex(Problem, "tool_outcome_unknown"):
            self.execute()
        self.assertEqual(calls, ["first"])
        self.assertEqual(self.scalar("SELECT http_calls FROM tool_broker_operations"), 1)
        self.assertEqual(self.scalar("SELECT status FROM tool_broker_operations"), "unknown")

    def test_generation_rebind_preserves_unknown_and_cap(self):
        self.success_adapter(crash=True)
        operation_id = uuid4()
        with self.assertRaises(SystemExit):
            self.execute(operation_id=operation_id)
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET generation=2 WHERE id=%s", (self.run,))
            conn.execute("UPDATE jobs SET generation=2 WHERE run_id=%s", (self.run,))
            conn.execute("UPDATE sandbox_bindings SET generation=2 WHERE id=%s", (self.binding,))
        with self.assertRaises(Problem):
            self.execute()
        with self.assertRaisesRegex(Problem, "tool_rebind_required"):
            self.broker.issue(self.run, 2, self.worker.owner, self.binding)
        self.broker.rebind(self.run, 2, self.worker.owner, self.binding)
        self.token = self.broker.issue(self.run, 2, self.worker.owner, self.binding)
        self.assertEqual(self.execute(operation_id=operation_id)["status"], "unknown")
        self.success_adapter()
        second = uuid4()
        self.ack(second, self.execute(operation_id=second))
        with self.assertRaisesRegex(Problem, "tool_request_limit"):
            self.execute()

    def test_service_revocation_and_credential_revision_change_fail_closed(self):
        from dataclasses import replace

        for changed in [
            replace(self.policy, credential_revision=uuid4()),
            replace(self.policy, secret="other-fixture-secret"),
        ]:
            broker = Broker(self.db, changed, adapter=self.upstream)
            with self.assertRaises(Problem):
                broker.execute(self.run, self.token, uuid4(), self.payload_tool)
        self.broker.revoke_service()
        with self.assertRaisesRegex(Problem, "tool_service_unavailable"):
            self.execute()
        self.assertEqual(self.upstream.calls, 0)

    def test_lifecycle_expiry_and_binding_fail_closed(self):
        statements = [
            ("UPDATE jobs SET lease_until=clock_timestamp() WHERE run_id=%s", self.run),
            ("UPDATE runs SET deadline=clock_timestamp() WHERE id=%s", self.run),
            ("UPDATE sandbox_bindings SET observed_state='unknown' WHERE id=%s", self.binding),
            (
                "UPDATE tool_broker_tokens SET expires_at=clock_timestamp() WHERE run_id=%s",
                self.run,
            ),
        ]
        # Roll each fixture mutation back so scenarios are independent within the test.
        for statement, argument in statements:
            with self.subTest(statement=statement), self.db.transaction() as conn:
                conn.execute("SAVEPOINT scenario")
                conn.execute(statement, (argument,))
                with self.assertRaises(Problem):
                    self.broker._authorize(conn, self.run, self.token)
                conn.execute("ROLLBACK TO SAVEPOINT scenario")
        self.assertEqual(self.upstream.calls, 0)

    def test_http_contract_no_browser_or_control_authority_and_redacted_errors(self):
        from fastapi.testclient import TestClient

        from agent_platform.tool_broker.api import create_tool_app

        self.success_adapter(fail=True)
        with TestClient(
            create_tool_app(self.db, self.policy, adapter=self.broker.adapter)
        ) as client:
            path = f"/tb1/runs/{self.run}/operations/{uuid4()}"
            headers = {"Authorization": "Bearer " + self.token}
            for extra in [{"Origin": "https://untrusted.test"}, {"Cookie": "operator=x"}]:
                response = client.post(path, json=self.payload_tool, headers={**headers, **extra})
                self.assertEqual(response.status_code, 403)
            response = client.post(path, json=self.payload_tool, headers=headers)
            self.assertEqual(response.json(), {"error": "tool_outcome_unknown"})
            self.assertEqual(response.headers["cache-control"], "no-store")
            for value in [self.token, self.policy.secret, "private upstream"]:
                self.assertNotIn(value, response.text)
            duplicate = client.post(
                path,
                content='{"operation":1,"operation":2}',
                headers={**headers, "Content-Type": "application/json"},
            )
            self.assertEqual(duplicate.status_code, 422)
            oversized = client.post(
                path, content=" " * 32769, headers={**headers, "Content-Type": "application/json"}
            )
            self.assertEqual(oversized.status_code, 413)
            self.assertEqual(client.post("/tb1/grants", json={}).status_code, 404)
        with self.db.transaction() as conn:
            audit = str(conn.execute("SELECT * FROM audit_events").fetchall())
            ledger = str(conn.execute("SELECT * FROM tool_broker_operations").fetchall())
        for value in [self.token, self.policy.secret, "example/project", "private upstream"]:
            self.assertNotIn(value, audit + ledger)

    def test_service_lock_wait_rechecks_expiry_before_hop(self):
        import concurrent.futures
        import threading
        from unittest.mock import patch

        operation_id = uuid4()
        self.broker._reserve(self.run, self.token, operation_id, self.payload_tool)
        entering = threading.Event()
        original = self.broker._service

        def service(conn):
            entering.set()
            return original(conn)

        with patch.object(self.broker, "_service", service):
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                with self.db.transaction() as conn:
                    conn.execute(
                        "SELECT 1 FROM tool_broker_services WHERE service_id=%s FOR UPDATE",
                        (self.policy.service_id,),
                    )
                    waiting = pool.submit(
                        self.broker._before_hop, self.run, self.token, operation_id
                    )
                    self.assertTrue(entering.wait(3))
                    # Expire after the initial live clock, before releasing the last authority lock.
                    conn.execute(
                        "UPDATE tool_broker_tokens SET expires_at=clock_timestamp() "
                        "WHERE run_id=%s",
                        (self.run,),
                    )
                with self.assertRaisesRegex(Problem, "tool_token_invalid"):
                    waiting.result(timeout=3)
        self.assertEqual(self.scalar("SELECT http_calls FROM tool_broker_operations"), 0)

    def test_cutoff_grant_expiry_and_explicit_binding_mismatch(self):
        with self.assertRaisesRegex(Problem, "tool_binding_invalid"):
            self.broker.issue(self.run, 1, self.worker.owner, uuid4())
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO model_proxy_runs(run_id,policy_sha256,request_limit,"
                "cutoff_reason,cutoff_at) VALUES (%s,%s,10,'request_limit',clock_timestamp())",
                (self.run, "a" * 64),
            )
        with self.assertRaisesRegex(Problem, "tool_run_not_live"):
            self.execute()
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM model_proxy_runs WHERE run_id=%s", (self.run,))
            conn.execute(
                "UPDATE tool_broker_runs SET expires_at=clock_timestamp() WHERE run_id=%s",
                (self.run,),
            )
        with self.assertRaisesRegex(Problem, "tool_grant_invalid"):
            self.execute()
        self.assertEqual(self.upstream.calls, 0)

    def test_in_flight_limit_independent_of_request_cap_and_unknown_not_refunded(self):
        from dataclasses import replace

        run, worker, binding = self.running()
        policy = replace(self.policy, request_limit=100, in_flight_limit=1)
        broker = Broker(self.db, policy, adapter=self.upstream)
        broker.provision(
            run, 1, worker.owner, binding, expires_at=datetime.now(UTC) + timedelta(minutes=1)
        )
        token = broker.issue(run, 1, worker.owner, binding)
        first = uuid4()
        broker._reserve(run, token, first, self.payload_tool)
        with self.assertRaisesRegex(Problem, "tool_in_flight_limit"):
            broker.execute(run, token, uuid4(), self.payload_tool)
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE tool_broker_operations SET deadline_at=clock_timestamp() WHERE run_id=%s",
                (run,),
            )
        self.assertEqual(broker.execute(run, token, first, self.payload_tool)["status"], "unknown")
        with self.assertRaisesRegex(Problem, "tool_in_flight_limit"):
            broker.execute(run, token, uuid4(), self.payload_tool)
        self.assertEqual(self.upstream.calls, 0)

    def test_settlement_failure_retains_admission_and_blocks_redispatch(self):
        from unittest.mock import patch

        import psycopg

        calls = self.success_adapter()
        operation_id = uuid4()
        from agent_platform.tool_broker import broker as module

        audit = module.audit

        def fail_settlement(conn, actor, action, target):
            if action == "tool.operation_settled":
                raise psycopg.OperationalError("fixture settlement failure")
            audit(conn, actor, action, target)

        with patch.object(module, "audit", fail_settlement), self.assertRaises(psycopg.Error):
            self.execute(operation_id=operation_id)
        retry = self.execute(operation_id=operation_id)
        self.assertEqual(retry["status"], "admitted")
        self.assertNotIn("result", retry)
        self.assertEqual(len(calls), 1)

    def mock_http_broker(self):
        from dataclasses import replace

        from test_tool_transport import SECRET, MockGitHub

        mock = MockGitHub()
        self.addCleanup(mock.close)
        policy = replace(
            self.policy,
            service_id=uuid4(),
            origin=mock.origin,
            credential_origin=mock.origin,
            secret=SECRET,
            paths=("readme.txt",),
            issues=(7,),
            request_limit=10,
        )
        run, worker, binding = self.running()
        broker = Broker(self.db, policy)
        broker.provision(
            run, 1, worker.owner, binding, expires_at=datetime.now(UTC) + timedelta(minutes=1)
        )
        return mock, policy, run, broker, broker.issue(run, 1, worker.owner, binding)

    def test_real_http_adapter_wiring_keeps_service_secret_outside_caller(self):
        from fastapi.testclient import TestClient

        from agent_platform.tool_broker.api import create_tool_app

        mock, policy, run, _, token = self.mock_http_broker()
        with TestClient(create_tool_app(self.db, policy)) as client:
            for payload in [
                self.payload_tool,
                {"operation": "github.issue.get", "repository_id": 123, "issue_number": 7},
                {
                    "operation": "github.file.get",
                    "repository_id": 123,
                    "commit": "a" * 40,
                    "path": "readme.txt",
                },
            ]:
                path = f"/tb1/runs/{run}/operations/{uuid4()}"
                headers = {"Authorization": "Bearer " + token}
                response = client.post(path, headers=headers, json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["status"], "succeeded")
                self.assertNotIn(token, response.text)
                self.assertNotIn(policy.secret, response.text)
                receipt = response.json()["receipt"]
                ack = client.post(path + "/ack", headers=headers, json={"receipt": receipt})
                self.assertEqual(ack.status_code, 200, ack.text)
                repeat = client.post(path, headers=headers, json=payload)
                self.assertNotIn("result", repeat.json())
        self.assertEqual(len(mock.calls), 7)
        for _, headers in mock.calls:
            self.assertEqual(headers["Authorization"], "Bearer " + policy.secret)
            self.assertNotIn(token, str(headers))
        self.assertEqual(
            self.scalar(
                "SELECT sum(http_calls) FROM tool_broker_operations WHERE run_id=%s", (run,)
            ),
            7,
        )

    def test_real_process_death_before_send_and_after_upstream_response_never_replays(self):
        import subprocess
        import sys
        from dataclasses import asdict

        mock, policy, run, broker, token = self.mock_http_broker()
        code = """
import json, os, sys
from uuid import UUID
from agent_platform.db import Database
from agent_platform.tool_broker.broker import Broker
from agent_platform.tool_broker.adapter import Adapter
from agent_platform.tool_broker.policy import Policy
v = json.load(sys.stdin)
p = v["policy"]
for k in ("service_id", "credential_revision"):
    p[k] = UUID(p[k])
for k in ("paths", "issues", "operations"):
    p[k] = tuple(p[k])
p = Policy(**p)
class CrashAdapter:
    def execute(self, payload, *, before_hop):
        if v["stage"] == "after_response":
            Adapter(p).execute(payload, before_hop=before_hop)
        os._exit(73)
db = Database(os.environ["TEST_DATABASE_URL"])
db.open()
Broker(db, p, adapter=CrashAdapter()).execute(v["run"], v["token"], v["id"], v["payload"])
"""
        for stage in ("before_send", "after_response"):
            operation_id = uuid4()
            result = subprocess.run(
                [sys.executable, "-c", code],
                input=json.dumps(
                    {
                        "policy": asdict(policy),
                        "run": str(run),
                        "token": token,
                        "id": str(operation_id),
                        "payload": self.payload_tool,
                        "stage": stage,
                    },
                    default=str,
                ),
                text=True,
                capture_output=True,
                timeout=15,
            )
            self.assertEqual(result.returncode, 73, result.stderr)
            # A new Broker object observes only the durable prior state; no result replay.
            broker = Broker(self.db, policy)
            self.assertEqual(
                broker.execute(run, token, operation_id, self.payload_tool)["status"], "admitted"
            )
        self.assertEqual(len(mock.calls), 1)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM tool_broker_operations WHERE run_id=%s", (run,)), 2
        )
        self.assertEqual(
            self.scalar(
                "SELECT sum(http_calls) FROM tool_broker_operations WHERE run_id=%s", (run,)
            ),
            1,
        )

    def test_http_executor_rejects_excess_work_without_queueing(self):
        import concurrent.futures
        import threading
        import time

        from fastapi.testclient import TestClient

        from agent_platform.tool_broker.api import create_tool_app

        other, worker, binding = self.running()
        self.broker.provision(
            other, 1, worker.owner, binding, expires_at=datetime.now(UTC) + timedelta(minutes=1)
        )
        other_token = self.broker.issue(other, 1, worker.owner, binding)
        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        calls = self.success_adapter(entered=entered, release=release)
        with TestClient(
            create_tool_app(self.db, self.policy, adapter=self.broker.adapter)
        ) as client:

            def request(run, token):
                return client.post(
                    f"/tb1/runs/{run}/operations/{uuid4()}",
                    json=self.payload_tool,
                    headers={"Authorization": "Bearer " + token},
                )

            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                futures = [
                    pool.submit(request, run, token)
                    for run, token in [(self.run, self.token)] * 2 + [(other, other_token)] * 2
                ]
                try:
                    deadline = time.monotonic() + 3
                    while len(calls) < 4:
                        if time.monotonic() >= deadline:
                            self.fail("four HTTP requests did not enter upstream")
                        time.sleep(0.01)
                    busy = request(self.run, self.token)
                    self.assertEqual(busy.status_code, 503, busy.text)
                    self.assertEqual(busy.json(), {"error": "tool_busy"})
                    self.assertEqual(len(calls), 4)
                finally:
                    release.set()
                for future in futures:
                    response = future.result(timeout=3)
                    self.assertEqual(response.status_code, 200, response.text)
