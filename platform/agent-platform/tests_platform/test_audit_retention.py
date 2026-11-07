"""Approved audit expiry on real PostgreSQL, retaining operational authority."""

import concurrent.futures
import copy
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb
from test_control_plane import URL, PlatformFixture

from agent_platform import audit_retention as gc
from agent_platform import backup
from agent_platform.auth import audit
from agent_platform.domain import Problem
from agent_platform.store import Store
from agent_platform.worker import Worker


class AuditRetentionTests(PlatformFixture):
    def seed(
        self, *, days=91, action="fixture.recorded", target=None, decision="allow", actor=None
    ):
        audit_id = uuid4()
        created = datetime.now(UTC) - timedelta(days=days)
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO audit_events(id,actor,action,target,decision,created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (audit_id, actor, action, target, decision, created),
            )
        return str(audit_id)

    def apply(self, plan=None):
        plan = gc.preview(self.db) if plan is None else plan
        return gc.apply(self.db, plan, approval_digest=plan["approval_digest"])

    def snapshot(self, tables=None):
        if tables is None:
            tables = backup._schema_contract()[0]
        with self.db.transaction() as conn:
            return {
                table: conn.execute(
                    "SELECT to_jsonb(t) AS value FROM " + table + " t ORDER BY to_jsonb(t)::text"
                ).fetchall()
                for table in tables
            }

    def authority_snapshot(self):
        return self.snapshot(
            table
            for table in backup._schema_contract()[0]
            if table
            not in {"audit_events", "audit_gc_plans", "audit_gc_receipts", "audit_gc_tombstones"}
        )

    def resign(self, plan):
        plan["approval_digest"] = gc.digest(
            {k: v for k, v in plan.items() if k != "approval_digest"}
        )

    def test_real_retention_expires_old_audit_with_durable_minimal_receipt(self):
        audit_id = self.seed()
        plan = gc.preview(self.db)
        self.assertEqual([item["id"] for item in plan["candidates"]], [audit_id])
        receipt = self.apply(plan)
        self.assertEqual(receipt["count"], 1)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE id=%s", (audit_id,)), 0
        )
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_gc_tombstones WHERE id=%s", (audit_id,)), 1
        )
        self.assertEqual(self.apply(plan), receipt)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='audit_gc.apply'"), 1
        )
        with self.db.transaction() as conn:
            tombstone = conn.execute(
                "SELECT * FROM audit_gc_tombstones WHERE id=%s", (audit_id,)
            ).fetchone()
            self.assertEqual(
                set(tombstone),
                {
                    "id",
                    "approval_digest",
                    "created_at",
                    "record_sha256",
                    "encoded_bytes",
                    "pruned_at",
                },
            )
        self.assertEqual(set(plan["candidates"][0]), gc.CANDIDATE_FIELDS)

    def test_strict_cutoff_bounds_nullable_and_full_canonical_unicode_hash(self):
        old = self.seed(action='界"\\', target=None, decision="🙂\n", actor=self.operator)
        self.seed(days=89)
        with self.db.transaction() as conn:
            row = conn.execute("SELECT * FROM audit_events WHERE id=%s", (old,)).fetchone()
            cutoff = row["created_at"]
            self.assertEqual(gc.candidates(conn, cutoff, 100), [])
            record = {
                **row,
                "id": str(row["id"]),
                "actor": str(row["actor"]),
                "created_at": gc.timestamp(row["created_at"]),
            }
        plan = gc.preview(self.db)
        item = plan["candidates"][0]
        self.assertEqual(item["record_sha256"], gc.digest(record))
        self.assertEqual(item["encoded_bytes"], len(gc.canonical(record)))
        self.apply(plan)
        empty_target = self.seed(target="")
        self.assertEqual(gc.preview(self.db)["candidates"][0]["id"], empty_target)
        for kwargs in (
            {"retention_days": 89},
            {"retention_days": True},
            {"limit": 0},
            {"limit": 101},
            {"limit": 1.0},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                gc.preview(self.db, **kwargs)

    def test_fixed_inspected_list_skips_oversize_without_refill_or_raw_copy(self):
        huge = self.seed(days=100, action="x" * 1500000)
        small = self.seed(days=99)
        last = self.seed(days=98)
        self.assertEqual(gc.preview(self.db, limit=1)["candidates"], [])
        with mock.patch.object(gc, "_record", wraps=gc._record) as fetched:
            plan = gc.preview(self.db, limit=2)
            self.assertEqual(fetched.call_count, 1)
        self.assertEqual([item["id"] for item in plan["candidates"]], [small])
        receipt = self.apply(plan)
        self.assertEqual(self.apply(plan), receipt)
        self.assertEqual(
            self.scalar(
                "SELECT count(*) FROM audit_events WHERE id=ANY(%s::uuid[])", ([huge, last],)
            ),
            2,
        )
        self.assertNotIn("x" * 100, json.dumps(plan))

    def test_near_cap_multirow_plan_apply_and_replay(self):
        text = "".join(hashlib.sha256(str(i).encode()).hexdigest() for i in range(2000))
        ids = [self.seed(days=100 - i, action=text) for i in range(10)]
        with self.db.transaction() as conn:
            upper = sum(
                gc._upper(row)
                for row in gc._lengths(conn, datetime.now(UTC) - timedelta(days=90), 10)
            )
        self.assertGreater(upper, gc.BYTE_LIMIT * 0.9)
        self.assertLess(upper, gc.BYTE_LIMIT)
        plan = gc.preview(self.db, limit=10)
        self.assertEqual([item["id"] for item in plan["candidates"]], ids)
        receipt = self.apply(plan)
        self.assertEqual(receipt["count"], 10)
        self.assertEqual(self.apply(plan), receipt)

    def test_new_candidates_never_added_and_competing_plan_fails_atomically(self):
        first = self.seed()
        plan = gc.preview(self.db)
        competing = gc.preview(self.db)
        later = self.seed(days=120)
        self.apply(plan)
        self.assertEqual(self.scalar("SELECT count(*) FROM audit_events WHERE id=%s", (later,)), 1)
        self.assertEqual(self.scalar("SELECT count(*) FROM audit_events WHERE id=%s", (first,)), 0)
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, "candidates_changed"):
            self.apply(competing)
        self.assertEqual(self.snapshot(), before)

    def test_plan_hash_issuance_identity_expiry_and_structure_fail_closed(self):
        self.seed()
        plan = gc.preview(self.db)
        with self.assertRaisesRegex(ValueError, "approval_invalid"):
            gc.apply(self.db, plan, approval_digest="0" * 64)
        for key, value in (("limit", 99), ("maintenance_id", str(uuid4()))):
            changed = copy.deepcopy(plan)
            changed[key] = value
            self.resign(changed)
            with self.assertRaises(ValueError):
                self.apply(changed)
        for delta in ({"limit": True}, {"extra": 0}, {"candidates": [{}]}, {"byte_limit": 0}):
            with self.assertRaises(ValueError):
                self.apply({**plan, **delta})
        expired = copy.deepcopy(plan)
        for key in ("created_at", "expires_at", "cutoff"):
            expired[key] = gc.timestamp(gc.parsed_time(expired[key]) - timedelta(hours=2))
        self.resign(expired)
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO audit_gc_plans(approval_digest,plan) VALUES (%s,%s)",
                (expired["approval_digest"], Jsonb(expired)),
            )
        with self.assertRaisesRegex(ValueError, "plan_expired"):
            self.apply(expired)

    def test_strict_receipt_replay_rejects_wrong_total_extra_keys_and_missing_tombstone(self):
        self.seed()
        plan = gc.preview(self.db)
        receipt = self.apply(plan)
        for delta in (
            {"total_encoded_bytes": receipt["total_encoded_bytes"] + 1},
            {"extra": 0},
            {"count": True},
            {"candidates": [{}]},
            {"pruned_at": "invalid"},
        ):
            with self.db.transaction() as conn:
                with self.assertRaisesRegex(ValueError, "receipt_invalid"):
                    gc._replay(conn, plan, {"plan": plan, "receipt": {**receipt, **delta}})
        for missing in receipt:
            malformed = {key: value for key, value in receipt.items() if key != missing}
            with self.db.transaction() as conn:
                with self.assertRaisesRegex(ValueError, "receipt_invalid"):
                    gc._replay(conn, plan, {"plan": plan, "receipt": malformed})
        real_transaction = self.db.transaction

        @contextmanager
        def missing_tombstone():
            with real_transaction() as conn:

                class Missing:
                    def execute(self, statement, parameters=None):
                        cursor = conn.execute(statement, parameters)
                        if "FROM audit_gc_tombstones" in statement:

                            class Rows:
                                def fetchall(self):
                                    return []

                            return Rows()
                        return cursor

                yield Missing()

        with mock.patch.object(self.db, "transaction", missing_tombstone):
            with self.assertRaisesRegex(ValueError, "receipt_invalid"):
                self.apply(plan)
        self.assertEqual(self.apply(plan), receipt)

    def test_issued_candidate_time_hash_and_size_mismatch_fail_atomically(self):
        self.seed()
        original = gc.preview(self.db)
        item = original["candidates"][0]
        for field, value in (
            ("created_at", gc.timestamp(gc.parsed_time(item["created_at"]) - timedelta(seconds=1))),
            ("record_sha256", "0" * 64),
            ("encoded_bytes", item["encoded_bytes"] + 1),
        ):
            plan = copy.deepcopy(original)
            plan["candidates"][0][field] = value
            self.resign(plan)
            with self.db.transaction() as conn:
                conn.execute(
                    "INSERT INTO audit_gc_plans(approval_digest,plan) VALUES (%s,%s)",
                    (plan["approval_digest"], Jsonb(plan)),
                )
            before = self.snapshot()
            with (
                self.subTest(field=field),
                self.assertRaisesRegex(ValueError, "candidates_changed"),
            ):
                self.apply(plan)
            self.assertEqual(self.snapshot(), before)

    def test_sql_candidate_wrong_time_refuses_tombstone_and_delete(self):
        audit_id = self.seed()
        original = gc.preview(self.db)
        plan = copy.deepcopy(original)
        plan["candidates"][0]["created_at"] = gc.timestamp(
            gc.parsed_time(plan["candidates"][0]["created_at"]) - timedelta(seconds=1)
        )
        self.resign(plan)
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO audit_gc_plans(approval_digest,plan) VALUES (%s,%s)",
                (plan["approval_digest"], Jsonb(plan)),
            )
        before = self.snapshot()
        # Tombstones must match the issued candidate's timestamp. SQL does not
        # compare them to raw rows until DELETE; application validation does.
        with self.assertRaises(psycopg.Error):
            with self.db.transaction() as conn:
                self.manual_receipt(conn, original, tombstones=plan["candidates"])
        self.assertEqual(self.snapshot(), before)
        with self.assertRaises(psycopg.Error):
            with self.db.transaction() as conn:
                # Correctly matching receipt/tombstone for a wrongly timed
                # issued candidate cannot authorize deletion of the raw row.
                self.manual_receipt(conn, plan)
                conn.execute("DELETE FROM audit_events WHERE id=%s", (audit_id,))
        self.assertEqual(self.snapshot(), before)

    def test_successful_apply_replay_expires_by_real_database_clock(self):
        self.seed()
        plan = gc.preview(self.db)
        with self.db.transaction() as conn:
            now = conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
            expires = now + timedelta(seconds=2)
            created = expires - timedelta(hours=1)
            plan.update(
                created_at=gc.timestamp(created),
                expires_at=gc.timestamp(expires),
                cutoff=gc.timestamp(created - timedelta(days=90)),
            )
            self.resign(plan)
            conn.execute(
                "INSERT INTO audit_gc_plans(approval_digest,plan) VALUES (%s,%s)",
                (plan["approval_digest"], Jsonb(plan)),
            )
        receipt = self.apply(plan)
        self.assertEqual(self.apply(plan), receipt)
        before = self.snapshot()
        with self.db.transaction() as conn:
            conn.execute(
                "SELECT pg_sleep(greatest(0,extract(epoch FROM %s::timestamptz "
                "- clock_timestamp())) + 0.02)",
                (expires,),
            )
        with self.assertRaisesRegex(ValueError, "plan_expired"):
            self.apply(plan)
        self.assertEqual(self.snapshot(), before)

    def manual_receipt(self, conn, plan, when=None, tombstones=None):
        when = when or conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
        receipt = gc._receipt(plan, when)
        conn.execute(
            "INSERT INTO audit_gc_receipts(approval_digest,plan,receipt,created_at) "
            "VALUES (%s,%s,%s,%s)",
            (plan["approval_digest"], Jsonb(plan), Jsonb(receipt), when),
        )
        conn.execute(
            "SELECT set_config('agent_platform.audit_gc_approval',%s,true)",
            (plan["approval_digest"],),
        )
        for item in plan["candidates"] if tombstones is None else tombstones:
            conn.execute(
                "INSERT INTO audit_gc_tombstones VALUES (%s,%s,%s,%s,%s,%s)",
                (
                    item["id"],
                    plan["approval_digest"],
                    gc.parsed_time(item["created_at"]),
                    item["record_sha256"],
                    item["encoded_bytes"],
                    when,
                ),
            )

    def test_guard_correct_current_receipt_wrong_id_and_uuid_resurrection(self):
        first, second = self.seed(days=100), self.seed(days=99)
        plan = gc.preview(self.db, limit=1)
        before = self.snapshot()
        with self.db.transaction() as conn:
            with conn.transaction(force_rollback=True):
                self.manual_receipt(conn, plan)
                with self.assertRaises(psycopg.Error):
                    with conn.transaction():
                        conn.execute("DELETE FROM audit_events WHERE id=%s", (second,))
                self.assertEqual(
                    conn.execute("DELETE FROM audit_events WHERE id=%s", (first,)).rowcount, 1
                )
        self.assertEqual(self.snapshot(), before)
        self.apply(plan)
        with self.assertRaises(psycopg.Error):
            with self.db.transaction() as conn:
                conn.execute(
                    "INSERT INTO audit_events(id,action,decision) VALUES (%s,'reuse','allow')",
                    (first,),
                )

    def test_guard_prior_transaction_and_expired_approval_cannot_delete(self):
        audit_id = self.seed(days=100)
        plan = gc.preview(self.db)
        with self.db.transaction() as conn:
            self.manual_receipt(conn, plan)
        before = self.snapshot()
        with self.assertRaises(psycopg.Error):
            with self.db.transaction() as conn:
                conn.execute(
                    "SELECT set_config('agent_platform.audit_gc_approval',%s,true)",
                    (plan["approval_digest"],),
                )
                conn.execute("DELETE FROM audit_events WHERE id=%s", (audit_id,))
        self.assertEqual(self.snapshot(), before)
        with self.assertRaisesRegex(ValueError, "receipt_invalid"):
            self.apply(plan)
        expired = copy.deepcopy(plan)
        fresh = self.seed(days=100)
        with self.db.transaction() as conn:
            expired["candidates"] = gc.candidates(
                conn, gc.parsed_time(expired["cutoff"]), 1, [fresh]
            )
        for key in ("created_at", "expires_at", "cutoff"):
            expired[key] = gc.timestamp(gc.parsed_time(expired[key]) - timedelta(hours=2))
        self.resign(expired)
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO audit_gc_plans(approval_digest,plan) VALUES (%s,%s)",
                (expired["approval_digest"], Jsonb(expired)),
            )
        with self.assertRaises(psycopg.Error):
            with self.db.transaction() as conn:
                self.manual_receipt(
                    conn, expired, gc.parsed_time(expired["created_at"]) + timedelta(minutes=1)
                )
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE id=%s", (audit_id,)), 1
        )

    def test_raw_update_unapproved_delete_and_evidence_mutation_are_refused(self):
        audit_id = self.seed()
        for statement in (
            "UPDATE audit_events SET decision='changed' WHERE id=%s",
            "DELETE FROM audit_events WHERE id=%s",
        ):
            with self.assertRaises(psycopg.Error):
                with self.db.transaction() as conn:
                    conn.execute(statement, (audit_id,))
        plan = gc.preview(self.db)
        self.apply(plan)
        for table in ("audit_gc_plans", "audit_gc_receipts", "audit_gc_tombstones"):
            with self.subTest(table=table), self.assertRaises(psycopg.Error):
                with self.db.transaction() as conn:
                    conn.execute("DELETE FROM " + table)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='audit_gc.apply'"), 1
        )

    def test_atomic_failure_after_receipt_tombstone_delete_or_audit_rolls_back(self):
        self.seed()
        plan = gc.preview(self.db)
        before = self.snapshot()
        real_transaction = self.db.transaction
        for point in (
            "INSERT INTO audit_gc_receipts",
            "INSERT INTO audit_gc_tombstones",
            "DELETE FROM audit_events",
            "INSERT INTO audit_events",
        ):

            @contextmanager
            def faulty(fault_point=point):
                with real_transaction() as conn:

                    class Fault:
                        def execute(self, statement, parameters=None):
                            result = conn.execute(statement, parameters)
                            if fault_point in statement:
                                raise RuntimeError("after " + fault_point)
                            return result

                    yield Fault()

            with self.subTest(point=point), mock.patch.object(self.db, "transaction", faulty):
                with self.assertRaises(RuntimeError):
                    self.apply(plan)
            self.assertEqual(self.snapshot(), before)

    def test_audit_writer_first_refuses_gc_and_gc_first_writer_resumes(self):
        audit_id = self.seed()
        plan = gc.preview(self.db)
        before = self.snapshot()
        with self.db.transaction() as holder:
            holder.execute("SELECT id FROM audit_events WHERE id=%s FOR UPDATE", (audit_id,))
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                with self.assertRaisesRegex(ValueError, "database_unavailable"):
                    pool.submit(self.apply, plan).result(timeout=2)
        self.assertEqual(self.snapshot(), before)
        locked, release, started = threading.Event(), threading.Event(), threading.Event()
        real_lock = gc.lock

        def paused(conn):
            real_lock(conn)
            locked.set()
            if not release.wait(4):
                raise RuntimeError("missing lock release")

        def writer():
            started.set()
            with self.db.transaction() as conn:
                audit(conn, None, "fixture.concurrent")

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            with mock.patch.object(gc, "lock", paused):
                pruning = pool.submit(self.apply, plan)
                try:
                    self.assertTrue(locked.wait(2))
                    appending = pool.submit(writer)
                    self.assertTrue(started.wait(2))
                    self.assertFalse(appending.done())
                finally:
                    release.set()
                self.assertEqual(pruning.result(timeout=3)["count"], 1)
                appending.result(timeout=3)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='fixture.concurrent'"), 1
        )

    def test_age_only_all_writer_families_preserves_full_authority_and_auth_command_dispatch(self):
        completed = self.create("persist-audit-command")
        self.assertTrue(Worker(self.db).run_once())
        active = self.create()
        actions = (
            "operator.bootstrapped",
            "session.created",
            "session.revoked",
            "tasks.create",
            "approval.decided",
            "approval.applied",
            "run.cancel_completed",
            "run.pause_completed",
            "run.resume_completed",
            "run.deadline_cleanup",
            "runtime.reconcile",
            "model.token_issued",
            "model.token_revoked",
            "model.request_reserved",
            "model.request_settled",
            "model.cutoff",
            "tool.grant_pinned",
            "tool.token_issued",
            "tool.grant_revoked",
            "tool.service_revoked",
            "tool.grant_rebound",
            "tool.operation_admitted",
            "tool.operation_settled",
            "archive_gc.apply",
            "event_gc.apply",
            "audit_gc.apply",
            "unknown.future.action",
        )
        for action in actions:
            self.seed(action=action, target=active["run"]["id"])
        before = self.authority_snapshot()
        receipt = self.apply()
        self.assertEqual(receipt["count"], len(actions))
        self.assertEqual(self.authority_snapshot(), before)
        # These are full row JSON values (including results/policy/accounting),
        # followed by real authority operations, not schema/metadata comparisons.
        duplicate = self.post("/tasks", self.payload, "persist-audit-command")
        self.assertEqual(duplicate.json(), completed)
        self.assertTrue(self.client.get("/api/v1/session").json()["authenticated"])
        self.assertEqual(Store(self.db).run(active["run"]["id"])["state"], "queued")
        self.assertTrue(Worker(self.db).run_once())
        self.assertEqual(Store(self.db).run(active["run"]["id"])["state"], "succeeded")
        revoked = self.client.delete("/api/v1/session", headers=self.headers)
        self.assertEqual(revoked.status_code, 204)
        self.assertFalse(self.client.get("/api/v1/session").json()["authenticated"])

    def test_real_cli_private_plan_strict_json_and_sanitized_errors(self):
        self.seed()
        env = dict(os.environ, DATABASE_URL=URL)
        command = [sys.executable, "-m", "agent_platform.cli", "audit-gc-preview"]
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        with tempfile.TemporaryDirectory() as parent:
            root = Path(parent)
            root.chmod(0o700)
            path = root / "plan.json"
            path.write_text(json.dumps(plan))
            path.chmod(0o600)
            apply = [
                sys.executable,
                "-m",
                "agent_platform.cli",
                "audit-gc-apply",
                "--plan",
                str(path),
                "--approve",
                plan["approval_digest"],
            ]
            result = subprocess.run(apply, env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["count"], 1)
            for malformed in ('{"x":1,"x":2}', '{"x":NaN}', "x" * 65537):
                path.write_text(malformed)
                result = subprocess.run(apply, env=env, capture_output=True, text=True, timeout=15)
                self.assertEqual(
                    (result.returncode, result.stderr.strip()), (1, "audit_gc_plan_invalid")
                )
                self.assertNotIn(URL, result.stderr)

    def scenario(self, fixture_type):
        # Reuse only setup/helper objects, never invoke existing test methods or
        # rediscover old suites. Each scenario stays inside the fresh owned DB.
        case = fixture_type()
        for field in ("db", "operator", "password", "settings"):
            setattr(case, field, getattr(self, field))
        self.addCleanup(case.doCleanups)
        case.setUp()
        return case

    def expire_referenced_history(self, action, target, tables):
        self.seed(action=action, target=str(target))
        before = self.snapshot(tables)
        receipt = self.apply()
        self.assertEqual(receipt["count"], 1)
        self.assertEqual(self.snapshot(tables), before)

    def test_pending_approval_applies_and_command_replays_after_audit_expiry(self):
        import test_approvals as fixtures

        case = self.scenario(fixtures.ApprovalTests)
        thread = case.waiting()
        self.expire_referenced_history(
            "approval.decided",
            case.approval["id"],
            ("approvals", "commands", "run_messages", "agent_profile_revisions"),
        )
        version = Store(self.db).run(case.run["id"])["state_version"]
        first = case.decision(key="after-audit-gc", expected_state_version=version)
        self.assertEqual(first.status_code, 202, first.text)
        thread.join(timeout=8)
        self.assertFalse(thread.is_alive())
        self.assertEqual(case.scalar("SELECT status FROM approvals"), "applied")
        self.assertEqual(case.server.service.accepts, 1)
        replay = case.decision(key="after-audit-gc", expected_state_version=version)
        self.assertEqual(replay.json(), first.json())
        self.assertEqual(case.server.service.accepts, 1)

    def test_unknown_recovery_keeps_capacity_and_does_not_resend_after_audit_expiry(self):
        import test_recovery as fixtures

        case = self.scenario(fixtures.RecoveryTests)
        run_id = case.create()["run"]["id"]
        case.server.node.lose = "prompt"
        Worker(self.db, case.connector).run_once()
        case.server.node.lose = None
        self.assertEqual(case.scalar("SELECT state FROM runs"), "interrupted")
        generation = case.scalar("SELECT generation FROM runs")
        self.expire_referenced_history(
            "runtime.reconcile",
            run_id,
            ("runs", "jobs", "sandbox_bindings", "resource_reservations", "adapter_operations"),
        )
        case.recovery_worker().run_once()
        self.assertGreater(case.scalar("SELECT generation FROM runs"), generation)
        self.assertEqual(case.server.node.calls["prompt"], 1)
        self.assertEqual(case.scalar("SELECT state FROM runs"), "interrupted")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

    def test_unknown_model_request_is_not_replayed_or_refunded_after_audit_expiry(self):
        import test_model_proxy as fixtures

        case = self.scenario(fixtures.ModelProxyTests)
        case.upstream.status = 429
        key = uuid4()
        self.assertEqual(case.request(request_id=key).status_code, 429)
        self.expire_referenced_history(
            "model.request_settled",
            case.run,
            (
                "model_proxy_runs",
                "model_proxy_tokens",
                "model_proxy_requests",
                "resource_reservations",
            ),
        )
        self.assertEqual(case.request(request_id=key).status_code, 409)
        self.assertEqual(len(case.upstream.calls), 1)
        usage = case.usage()
        self.assertEqual(usage["uncertain_requests"], 1)
        self.assertEqual(usage["entries"][0]["status"], "unknown")
        self.assertIsNone(usage["entries"][0]["amount_decimal"])

    def test_unknown_tool_delivery_and_revocation_survive_audit_expiry(self):
        import test_tool_broker as fixtures

        case = self.scenario(fixtures.ToolBrokerTests)
        calls = case.success_adapter(fail=True)
        operation = uuid4()
        with self.assertRaisesRegex(Problem, "tool_outcome_unknown"):
            case.execute(operation_id=operation)
        self.expire_referenced_history(
            "tool.operation_settled",
            case.run,
            (
                "tool_broker_services",
                "tool_broker_runs",
                "tool_broker_tokens",
                "tool_broker_operations",
                "resource_reservations",
            ),
        )
        self.assertEqual(case.execute(operation_id=operation)["status"], "unknown")
        self.assertEqual(len(calls), 1)
        case.broker.revoke(case.run)
        with self.assertRaises(Problem):
            case.execute(operation_id=uuid4())
        self.assertEqual(len(calls), 1)

    def test_export_approval_replay_preserves_one_remote_intent_after_audit_expiry(self):
        import test_github_export as fixtures

        case = self.scenario(fixtures.ExportFixture)
        body = case.approval()
        first = case.post(case.path, body, "persistent-export")
        self.assertEqual(first.status_code, 202, first.text)
        self.expire_referenced_history(
            "exports.create",
            case.run_id,
            ("github_exports", "commands", "result_archives", "runs", "jobs"),
        )
        self.assertEqual(case.post(case.path, body, "persistent-export").json(), first.json())
        self.assertEqual(case.post(case.path, body, "same-intent-new-command").json(), first.json())
        self.assertEqual(case.scalar("SELECT count(*) FROM github_exports"), 1)
        self.assertEqual(case.scalar("SELECT state FROM github_exports"), "queued")
