"""Retention safety against real PostgreSQL and authenticated archive downloads."""

import concurrent.futures
import copy
import hashlib
import json
import threading
import time
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb
from test_control_plane import PlatformFixture

from agent_platform import archive_retention, export_service
from agent_platform.api import create_app
from agent_platform.domain import Problem
from agent_platform.result_archive import archive_id, persist_archive, serialize
from agent_platform.worker import Worker


class ArchiveRetentionTests(PlatformFixture):
    def seed(self, *, days=31, diff=False, corruption=None):
        value = self.create()
        run_id = value["run"]["id"]
        result = {"summary": "Keep immutable metadata", "verification": {"status": "not_run"}}
        if diff:
            value_diff = (
                "diff --git a/a.txt b/a.txt\nnew file mode 100644\n"
                "--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+hello\n"
            )
            result.update(
                diff=value_diff,
                diff_bytes=len(value_diff.encode()),
                diff_sha256=hashlib.sha256(value_diff.encode()).hexdigest(),
                base_sha=self.payload["base_sha"],
            )
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET state='succeeded' WHERE id=%s", (run_id,))
            conn.execute("UPDATE jobs SET status='done' WHERE run_id=%s", (run_id,))
            run = conn.execute("SELECT * FROM runs WHERE id=%s", (run_id,)).fetchone()
            payload = serialize(run, result)
            conn.execute(
                "INSERT INTO result_archives(id,run_id,payload,sha256,size,created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (
                    archive_id(run_id),
                    run_id,
                    payload,
                    "0" * 64 if corruption == "hash" else hashlib.sha256(payload).hexdigest(),
                    len(payload) + (corruption == "size"),
                    datetime.now(UTC) - timedelta(days=days),
                ),
            )
        return run_id

    def test_eligible_preview_contains_exact_old_archive_without_pruning(self):
        run_id = self.seed()
        plan = archive_retention.preview(self.db)
        self.assertEqual(len(plan["candidates"]), 1)
        self.assertEqual(plan["candidates"][0]["run_id"], run_id)
        self.assertIsNotNone(self.scalar("SELECT payload FROM result_archives"))

    def test_archive_listing_exposes_available_payload_state(self):
        run_id = self.seed()
        items = self.client.get(f"/api/v1/runs/{run_id}/artifacts").json()["items"]
        self.assertIn("pruned_at", items[0])
        self.assertIsNone(items[0]["pruned_at"])

    def apply(self, plan=None):
        plan = plan or archive_retention.preview(self.db)
        return archive_retention.apply(self.db, plan, approval_digest=plan["approval_digest"])

    def binding(self, run_id):
        binding_id = uuid4()
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO sandbox_bindings(id,run_id,node_id,provider_handle,generation,"
                "desired_state,observed_state,lease_deadline,cleanup_state) "
                "VALUES (%s,%s,'fake-local',%s,1,'stopped','stopped',now(),'confirmed')",
                (binding_id, run_id, f"fixture:{run_id}"),
            )
            conn.execute(
                "INSERT INTO resource_reservations(sandbox_id,cpu,memory_bytes,"
                "disk_bytes,released_at) "
                "VALUES (%s,1,1024,1024,now())",
                (binding_id,),
            )
            conn.execute(
                "UPDATE runs SET sandbox_id=%s,generation=1,cleanup_state='confirmed' WHERE id=%s",
                (binding_id, run_id),
            )
        return binding_id

    def export(self, conn, run_id, *, state="failed"):
        row = conn.execute("SELECT * FROM result_archives WHERE run_id=%s", (run_id,)).fetchone()
        nonce = hashlib.sha256(str(uuid4()).encode()).hexdigest()
        conn.execute(
            "INSERT INTO github_exports(id,run_id,artifact_id,artifact_sha256,target_repo,"
            "base_branch,"
            "base_sha,branch,approval_digest,created_by,state,stage,tree_sha,"
            "commit_sha,pr_number,pr_url) "
            "VALUES (%s,%s,%s,%s,'example/repo','main',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                uuid4(),
                run_id,
                row["id"],
                row["sha256"],
                self.payload["base_sha"],
                "agent-platform/export-" + nonce,
                nonce,
                self.operator,
                state,
                "complete" if state == "succeeded" else "approved",
                "a" * 40 if state == "succeeded" else None,
                "b" * 40 if state == "succeeded" else None,
                123 if state == "succeeded" else None,
                "https://github.com/example/repo/pull/123" if state == "succeeded" else None,
            ),
        )

    def snapshot(self, tables):
        with self.db.transaction() as conn:
            return {
                table: conn.execute("SELECT to_jsonb(t) AS row FROM " + table + " t").fetchall()
                for table in tables
            }

    def test_apply_retains_identity_and_all_other_records_and_download_is_gone(self):
        run_id = self.seed()
        self.binding(run_id)
        tables = (
            "runs",
            "jobs",
            "sandbox_bindings",
            "resource_reservations",
            "commands",
            "run_events",
            "run_messages",
            "github_exports",
        )
        before = self.snapshot(tables)
        listing_path = f"/api/v1/runs/{run_id}/artifacts"
        metadata = self.client.get(listing_path).json()["items"][0]
        plan = archive_retention.preview(self.db)
        receipt = self.apply(plan)
        after = self.client.get(listing_path).json()["items"][0]
        self.assertEqual(
            {k: v for k, v in after.items() if k != "pruned_at"},
            {k: v for k, v in metadata.items() if k != "pruned_at"},
        )
        self.assertIsNotNone(after["pruned_at"])
        response = self.client.get(listing_path + "/" + metadata["id"])
        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json(), {"error": "artifact_expired"})
        self.assertIsNone(self.scalar("SELECT payload FROM result_archives"))
        self.assertEqual(self.snapshot(tables), before)
        self.assertEqual(receipt["artifact_ids"], [metadata["id"]])
        self.assertEqual(receipt["total_bytes"], metadata["size"])
        self.assertEqual(
            self.scalar(
                "SELECT count(*) FROM archive_gc_receipts WHERE approval_digest=%s",
                (plan["approval_digest"],),
            ),
            1,
        )
        self.assertEqual(
            self.scalar(
                "SELECT count(*) FROM audit_events WHERE action='archive_gc.apply' AND target=%s",
                (plan["approval_digest"],),
            ),
            1,
        )

    def test_retention_bounds_and_strict_types(self):
        for kwargs in (
            {"retention_days": 29},
            {"retention_days": 36501},
            {"retention_days": True},
            {"retention_days": 30.0},
            {"limit": 0},
            {"limit": 101},
            {"limit": False},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                archive_retention.preview(self.db, **kwargs)
        run_id = self.seed(days=29)
        self.assertEqual(archive_retention.preview(self.db)["candidates"], [])
        self.assertIsNotNone(
            self.scalar("SELECT payload FROM result_archives WHERE run_id=%s", (run_id,))
        )

    def test_order_limit_and_new_candidates_are_never_silently_added(self):
        oldest = self.seed(days=50)
        self.seed(days=40)
        plan = archive_retention.preview(self.db, limit=1)
        self.assertEqual([v["run_id"] for v in plan["candidates"]], [oldest])
        self.seed(days=60)
        receipt = self.apply(plan)
        self.assertEqual(receipt["count"], 1)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM result_archives WHERE payload IS NOT NULL"), 2
        )

    def test_terminal_states_without_allocation_are_eligible(self):
        for state in ("succeeded", "failed", "cancelled"):
            run_id = self.seed()
            with self.db.transaction() as conn:
                conn.execute("UPDATE runs SET state=%s WHERE id=%s", (state, run_id))
        self.assertEqual(len(archive_retention.preview(self.db)["candidates"]), 3)

    def test_active_interrupted_and_unfinished_jobs_are_protected(self):
        for state in ("queued", "running", "finalizing", "cancelling", "interrupted", "paused"):
            run_id = self.seed()
            with self.db.transaction() as conn:
                conn.execute("UPDATE runs SET state=%s WHERE id=%s", (state, run_id))
        for state in ("queued", "leased", "interrupted"):
            run_id = self.seed()
            with self.db.transaction() as conn:
                conn.execute("UPDATE jobs SET status=%s WHERE run_id=%s", (state, run_id))
        self.assertEqual(archive_retention.preview(self.db)["candidates"], [])

    def test_every_export_state_protects_payload(self):
        for state in ("queued", "exporting", "failed", "succeeded", "uncertain"):
            run_id = self.seed()
            with self.db.transaction() as conn:
                self.export(conn, run_id, state=state)
        self.assertEqual(archive_retention.preview(self.db)["candidates"], [])

    def test_unknown_pending_and_mismatched_binding_or_reservation_are_protected(self):
        mutations = (
            "UPDATE sandbox_bindings SET cleanup_state='unknown' WHERE id=%s",
            "UPDATE sandbox_bindings SET cleanup_state='pending' WHERE id=%s",
            "UPDATE sandbox_bindings SET desired_state='running' WHERE id=%s",
            "UPDATE sandbox_bindings SET observed_state='unknown' WHERE id=%s",
            "UPDATE sandbox_bindings SET generation=2 WHERE id=%s",
            "UPDATE sandbox_bindings SET provider_handle='pending:unconfirmed' WHERE id=%s",
            "UPDATE resource_reservations SET released_at=NULL WHERE sandbox_id=%s",
            "DELETE FROM resource_reservations WHERE sandbox_id=%s",
            "UPDATE runs SET sandbox_id=NULL WHERE sandbox_id=%s",
        )
        for mutation in mutations:
            run_id = self.seed()
            binding_id = self.binding(run_id)
            with self.db.transaction() as conn:
                conn.execute(mutation, (binding_id,))
        self.assertEqual(archive_retention.preview(self.db)["candidates"], [])

    def test_mismatched_run_binding_does_not_qualify_either_run(self):
        first, second = self.seed(), self.seed()
        first_binding, second_binding = self.binding(first), self.binding(second)
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET sandbox_id=%s WHERE id=%s", (second_binding, first))
            conn.execute("UPDATE runs SET sandbox_id=%s WHERE id=%s", (first_binding, second))
        self.assertEqual(archive_retention.preview(self.db)["candidates"], [])

    def test_never_allocated_requires_no_attempt_or_remote_handle(self):
        mutations = (
            "UPDATE runs SET generation=1 WHERE id=%s",
            "UPDATE runs SET backend_ref='uncertain' WHERE id=%s",
            "UPDATE runs SET cleanup_state='confirmed' WHERE id=%s",
            "UPDATE runs SET cleanup_state='unknown' WHERE id=%s",
            "UPDATE runs SET cleanup_state='pending' WHERE id=%s",
        )
        for mutation in mutations:
            run_id = self.seed()
            with self.db.transaction() as conn:
                conn.execute(mutation, (run_id,))
        self.assertEqual(archive_retention.preview(self.db)["candidates"], [])

    def test_wrong_approval_identity_and_unknown_plan_fail_closed(self):
        self.seed()
        plan = archive_retention.preview(self.db)
        with self.assertRaisesRegex(ValueError, "approval_invalid"):
            archive_retention.apply(self.db, plan, approval_digest="0" * 64)
        altered = copy.deepcopy(plan)
        altered["maintenance_id"] = str(uuid4())
        self.resign(altered)
        with self.assertRaisesRegex(ValueError, "identity_changed"):
            self.apply(altered)
        altered = copy.deepcopy(plan)
        altered["limit"] = 99
        self.resign(altered)
        with self.assertRaisesRegex(ValueError, "plan_unrecognized"):
            self.apply(altered)
        self.assertIsNotNone(self.scalar("SELECT payload FROM result_archives"))

    def resign(self, plan):
        plan["approval_digest"] = archive_retention.digest(
            {key: value for key, value in plan.items() if key != "approval_digest"}
        )

    def test_untrusted_plan_structure_is_bounded_and_strict(self):
        self.seed()
        plan = archive_retention.preview(self.db)
        changes = (
            ("extra", "field"),
            ("limit", True),
            ("retention_days", float("nan")),
            ("schema_version", []),
            ("created_at", "2026-01-01"),
            ("maintenance_id", "x" * 100000),
            ("candidates", [None]),
            ("approval_digest", []),
        )
        for key, value in changes:
            invalid = copy.deepcopy(plan)
            invalid[key] = value
            with self.subTest(field=key), self.assertRaises(ValueError):
                archive_retention.apply(self.db, invalid, approval_digest=plan["approval_digest"])
        for key, value in (
            ("size", True),
            ("size", 1048577),
            ("id", str(uuid4()).upper()),
            ("sha256", "../unsafe"),
            ("created_at", plan["created_at"]),
        ):
            invalid = copy.deepcopy(plan)
            invalid["candidates"][0][key] = value
            with self.subTest(candidate_field=key), self.assertRaises(ValueError):
                self.apply(invalid)
        invalid = copy.deepcopy(plan)
        invalid["candidates"] *= 2
        self.resign(invalid)
        with self.assertRaisesRegex(ValueError, "plan_invalid"):
            self.apply(invalid)

    def test_expired_plan_fails_before_replay(self):
        self.seed()
        plan = archive_retention.preview(self.db)
        self.apply(plan)
        old = copy.deepcopy(plan)
        for key in ("created_at", "expires_at", "cutoff"):
            old[key] = archive_retention.timestamp(
                archive_retention.parsed_time(old[key]) - timedelta(hours=2)
            )
        self.resign(old)
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO archive_gc_plans(approval_digest,plan) VALUES (%s,%s)",
                (old["approval_digest"], Jsonb(old)),
            )
            receipt = {
                "schema_version": archive_retention.SCHEMA_VERSION,
                "approval_digest": old["approval_digest"],
                "maintenance_id": old["maintenance_id"],
                "pruned_at": old["created_at"],
                "artifact_ids": [v["id"] for v in old["candidates"]],
                "count": 1,
                "total_bytes": old["candidates"][0]["size"],
            }
            conn.execute(
                "INSERT INTO archive_gc_receipts(approval_digest,plan,receipt) VALUES (%s,%s,%s)",
                (old["approval_digest"], Jsonb(old), Jsonb(receipt)),
            )
        with self.assertRaisesRegex(ValueError, "plan_expired"):
            self.apply(old)

    def test_completed_plan_replay_is_exact_and_has_no_second_audit(self):
        self.seed()
        plan = archive_retention.preview(self.db)
        first = self.apply(plan)
        self.assertEqual(self.apply(plan), first)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='archive_gc.apply'"), 1
        )

    def test_identity_rotation_or_missing_identity_disables_old_plans(self):
        self.seed()
        plan = archive_retention.preview(self.db)
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM maintenance_identity")
        try:
            with self.assertRaisesRegex(ValueError, "identity_missing"):
                self.apply(plan)
            with self.assertRaisesRegex(ValueError, "identity_missing"):
                archive_retention.preview(self.db)
        finally:
            with self.db.transaction() as conn:
                conn.execute("INSERT INTO maintenance_identity DEFAULT VALUES")
        with self.assertRaisesRegex(ValueError, "identity_changed"):
            self.apply(plan)

    def test_any_changed_candidate_aborts_entire_batch(self):
        first, second = self.seed(), self.seed()
        plan = archive_retention.preview(self.db)
        with self.db.transaction() as conn:
            conn.execute("UPDATE jobs SET status='interrupted' WHERE run_id=%s", (second,))
        with self.assertRaisesRegex(ValueError, "candidates_changed"):
            self.apply(plan)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM result_archives WHERE payload IS NOT NULL"), 2
        )
        self.assertEqual(
            self.scalar(
                "SELECT count(*) FROM archive_gc_receipts WHERE approval_digest=%s",
                (plan["approval_digest"],),
            ),
            0,
        )
        self.assertIsNotNone(
            self.scalar("SELECT payload FROM result_archives WHERE run_id=%s", (first,))
        )

    def test_audit_failure_rolls_back_receipt_and_tombstone(self):
        self.seed()
        plan = archive_retention.preview(self.db)
        with self.db.transaction() as conn:
            conn.execute(
                "ALTER TABLE audit_events ADD CONSTRAINT test_reject_gc "
                "CHECK(action<>'archive_gc.apply')"
            )
        try:
            with self.assertRaisesRegex(ValueError, "database_unavailable"):
                self.apply(plan)
        finally:
            with self.db.transaction() as conn:
                conn.execute("ALTER TABLE audit_events DROP CONSTRAINT test_reject_gc")
        self.assertIsNotNone(self.scalar("SELECT payload FROM result_archives"))
        self.assertIsNone(self.scalar("SELECT pruned_at FROM result_archives"))
        self.assertEqual(
            self.scalar(
                "SELECT count(*) FROM archive_gc_receipts WHERE approval_digest=%s",
                (plan["approval_digest"],),
            ),
            0,
        )
        self.assertEqual(self.apply(plan)["count"], 1)

    def test_tombstone_never_resurrects_and_receipt_cannot_authorize_later_changes(self):
        run_id = self.seed()
        with self.db.transaction() as conn:
            run = conn.execute("SELECT * FROM runs WHERE id=%s", (run_id,)).fetchone()
            payload = conn.execute("SELECT payload FROM result_archives").fetchone()["payload"]
        result = json.loads(payload)["result"]
        plan = archive_retention.preview(self.db)
        self.apply(plan)
        with self.assertRaisesRegex(Problem, "artifact_immutable"), self.db.transaction() as conn:
            persist_archive(conn, run, result)
        for sql, params in (
            ("UPDATE result_archives SET payload=%s,pruned_at=NULL", (payload,)),
            ("UPDATE result_archives SET pruned_at=clock_timestamp()", ()),
            ("UPDATE result_archives SET sha256=%s", ("0" * 64,)),
            ("DELETE FROM result_archives", ()),
        ):
            with (
                self.subTest(sql=sql),
                self.assertRaises(psycopg.Error),
                self.db.transaction() as conn,
            ):
                conn.execute(
                    "SELECT set_config('agent_platform.gc_approval',%s,true)",
                    (plan["approval_digest"],),
                )
                conn.execute(sql, params)
        self.assertIsNone(self.scalar("SELECT payload FROM result_archives"))

    def test_direct_payload_prune_or_rewrite_is_forbidden_without_transaction_receipt(self):
        self.seed()
        for sql in (
            "UPDATE result_archives SET payload=NULL,pruned_at=now()",
            "UPDATE result_archives SET payload=convert_to('replacement','UTF8')",
            "UPDATE result_archives SET size=size+1",
            "DELETE FROM result_archives",
        ):
            with (
                self.subTest(sql=sql),
                self.assertRaises(psycopg.Error),
                self.db.transaction() as conn,
            ):
                conn.execute(sql)

    def test_issued_plans_and_receipts_are_immutable(self):
        self.seed()
        plan = archive_retention.preview(self.db)
        self.apply(plan)
        for table in ("archive_gc_plans", "archive_gc_receipts"):
            for action in (f"DELETE FROM {table}", f"UPDATE {table} SET plan='{{}}'::jsonb"):
                with (
                    self.subTest(action=action),
                    self.assertRaises(psycopg.Error),
                    self.db.transaction() as conn,
                ):
                    conn.execute(action)

    def test_two_concurrent_applies_produce_one_receipt_and_one_audit(self):
        self.seed()
        plan = archive_retention.preview(self.db)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.apply(plan), range(2)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='archive_gc.apply'"), 1
        )

    def test_concurrent_export_before_apply_protects_entire_plan(self):
        run_id = self.seed()
        plan = archive_retention.preview(self.db)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            with self.db.transaction() as conn:
                self.export(conn, run_id)
                future = pool.submit(self.apply, plan)
                self.wait_for_lock()
                self.assertFalse(future.done())
            with self.assertRaisesRegex(ValueError, "candidates_changed"):
                future.result(timeout=10)
        self.assertIsNotNone(self.scalar("SELECT payload FROM result_archives"))

    def test_concurrent_job_change_is_rechecked_after_lock(self):
        run_id = self.seed()
        plan = archive_retention.preview(self.db)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            with self.db.transaction() as conn:
                conn.execute("UPDATE jobs SET status='interrupted' WHERE run_id=%s", (run_id,))
                future = pool.submit(self.apply, plan)
                self.wait_for_lock()
                self.assertFalse(future.done())
            with self.assertRaisesRegex(ValueError, "candidates_changed"):
                future.result(timeout=10)
        self.assertIsNotNone(self.scalar("SELECT payload FROM result_archives"))

    def wait_for_lock(self):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if self.scalar(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() "
                "AND wait_event_type='Lock'"
            ):
                return
            time.sleep(0.01)
        self.fail("Expected a real database lock wait")

    def test_export_insert_after_prune_cannot_reference_unavailable_bytes(self):
        run_id = self.seed()
        self.apply()
        with (
            self.assertRaises(psycopg.errors.CheckViolation) as raised,
            self.db.transaction() as conn,
        ):
            self.export(conn, run_id)
        self.assertEqual(raised.exception.diag.constraint_name, "github_export_archive_available")
        self.assertEqual(self.scalar("SELECT count(*) FROM github_exports"), 0)

    def test_export_waiting_behind_gc_rechecks_available_bytes(self):
        run_id = self.seed()
        plan = archive_retention.preview(self.db)

        # Hold the real GC transaction after UPDATE until a concurrent INSERT waits.
        class HeldDatabase:
            @contextmanager
            def transaction(held):
                with self.db.transaction() as conn:
                    yield conn
                    ready.set()
                    self.assertTrue(release.wait(timeout=5))

        ready, release = threading.Event(), threading.Event()

        def approve():
            with self.db.transaction() as conn:
                self.export(conn, run_id)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            gc = pool.submit(
                archive_retention.apply,
                HeldDatabase(),
                plan,
                approval_digest=plan["approval_digest"],
            )
            self.assertTrue(ready.wait(timeout=5))
            exporting = pool.submit(approve)
            try:
                self.wait_for_lock()
                self.assertFalse(exporting.done())
            finally:
                release.set()
            self.assertEqual(gc.result(timeout=10)["count"], 1)
            with self.assertRaises(psycopg.errors.CheckViolation):
                exporting.result(timeout=10)
        self.assertEqual(self.scalar("SELECT count(*) FROM github_exports"), 0)

    def test_normal_fake_worker_archive_is_eligible_after_ageing(self):
        run_id = self.create()["run"]["id"]
        # Only this owned fixture changes the INSERT default; no immutable row is rewritten.
        with self.db.transaction() as conn:
            conn.execute(
                "ALTER TABLE result_archives ALTER COLUMN created_at "
                "SET DEFAULT (now()-interval '40 days')"
            )
        try:
            Worker(self.db).run_once()
        finally:
            with self.db.transaction() as conn:
                conn.execute(
                    "ALTER TABLE result_archives ALTER COLUMN created_at SET DEFAULT now()"
                )
        self.assertEqual(
            self.scalar("SELECT cleanup_state FROM runs WHERE id=%s", (run_id,)), "confirmed"
        )
        self.assertEqual(
            self.scalar("SELECT provider_handle FROM sandbox_bindings WHERE run_id=%s", (run_id,)),
            "pending:" + run_id,
        )
        plan = archive_retention.preview(self.db)
        self.assertEqual([v["run_id"] for v in plan["candidates"]], [run_id])
        self.assertEqual(self.apply(plan)["count"], 1)

    def test_api_export_approval_read_before_gc_returns_bounded_expired_error(self):
        run_id = self.seed(diff=True)
        settings = replace(
            self.settings, export_targets=({"repo": "example/repo", "base_branch": "main"},)
        )
        client = TestClient(create_app(settings, self.db), base_url=settings.origin)
        self.addCleanup(client.close)
        client.cookies.update(self.client.cookies)
        self.client = client
        artifact = self.client.get(f"/api/v1/runs/{run_id}/artifacts").json()["items"][0]
        path = f"/runs/{run_id}/exports"
        previewed = self.post(
            path + "/preview",
            {
                "artifact_id": artifact["id"],
                "artifact_sha256": artifact["sha256"],
                "target_repo": "example/repo",
                "base_branch": "main",
            },
        )
        self.assertEqual(previewed.status_code, 200, previewed.text)
        approval = {
            key: val
            for key, val in previewed.json().items()
            if key not in {"run_id", "verification_status", "files", "diff"}
        } | {"approved": True}
        plan = archive_retention.preview(self.db)
        # API has read exact bytes but has not yet inserted its approval; GC commits first.
        read, resume = threading.Event(), threading.Event()
        original = export_service.preview

        def pause_preview(*args, **kwargs):
            value = original(*args, **kwargs)
            read.set()
            self.assertTrue(resume.wait(timeout=5))
            return value

        with (
            patch.object(export_service, "preview", side_effect=pause_preview),
            concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool,
        ):
            request = pool.submit(self.post, path, approval)
            try:
                self.assertTrue(read.wait(timeout=5))
                self.assertEqual(self.apply(plan)["count"], 1)
            finally:
                resume.set()
            response = request.result(timeout=10)
        self.assertEqual(response.status_code, 410, response.text)
        self.assertEqual(response.json(), {"error": "artifact_expired"})
        self.assertEqual(self.scalar("SELECT count(*) FROM github_exports"), 0)
        self.assertEqual(
            self.scalar(
                "SELECT count(*) FROM commands WHERE route=%s", (f"runs/{run_id}/exports.create",)
            ),
            0,
        )

    def test_timestamp_overflow_and_noncanonical_offsets_are_sanitized(self):
        plan = archive_retention.preview(self.db)
        for key, value in (
            ("created_at", "0001-01-01T00:00:00.000000+00:00"),
            ("created_at", "9999-12-31T23:59:59.000000+00:00"),
            ("expires_at", "2026-01-01T01:00:00.000000+01:00"),
        ):
            invalid = copy.deepcopy(plan)
            invalid[key] = value
            with (
                self.subTest(key=key, value=value),
                self.assertRaisesRegex(ValueError, "plan_invalid"),
            ):
                self.apply(invalid)

    def test_replay_rejects_receipt_without_matching_tombstones(self):
        self.seed()
        plan = archive_retention.preview(self.db)
        receipt = {
            "schema_version": archive_retention.SCHEMA_VERSION,
            "approval_digest": plan["approval_digest"],
            "maintenance_id": plan["maintenance_id"],
            "pruned_at": plan["created_at"],
            "artifact_ids": [v["id"] for v in plan["candidates"]],
            "count": 1,
            "total_bytes": plan["candidates"][0]["size"],
        }
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO archive_gc_receipts(approval_digest,plan,receipt) VALUES (%s,%s,%s)",
                (plan["approval_digest"], Jsonb(plan), Jsonb(receipt)),
            )
        with self.assertRaisesRegex(ValueError, "receipt_invalid"):
            self.apply(plan)
        self.assertIsNotNone(self.scalar("SELECT payload FROM result_archives"))

    def test_wrong_backend_node_and_shared_binding_ownership_are_protected(self):
        first, second, third = self.seed(), self.seed(), self.seed()
        shared = self.binding(first)
        self.binding(third)
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET sandbox_id=%s WHERE id=%s", (shared, second))
            conn.execute(
                "UPDATE sandbox_bindings SET node_id='cocoon-local' WHERE run_id=%s", (third,)
            )
        self.assertEqual(archive_retention.preview(self.db)["candidates"], [])

    def test_real_pending_handles_stay_protected_even_after_claimed_cleanup(self):
        run_id = self.seed()
        self.binding(run_id)
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET backend='openhands' WHERE id=%s", (run_id,))
            conn.execute(
                "UPDATE sandbox_bindings SET node_id='cocoon-local',provider_handle=%s "
                "WHERE run_id=%s",
                ("pending:" + run_id, run_id),
            )
        self.assertEqual(archive_retention.preview(self.db)["candidates"], [])

    def test_empty_plan_has_a_replayable_zero_count_receipt(self):
        plan = archive_retention.preview(self.db)
        receipt = self.apply(plan)
        self.assertEqual(receipt["count"], 0)
        self.assertEqual(receipt["total_bytes"], 0)
        self.assertEqual(self.apply(plan), receipt)

    def test_altered_candidate_hash_and_order_never_gain_approval(self):
        self.seed(days=40)
        self.seed(days=50)
        plan = archive_retention.preview(self.db)
        invalid = copy.deepcopy(plan)
        invalid["candidates"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "approval_invalid"):
            self.apply(invalid)
        self.resign(invalid)
        with self.assertRaisesRegex(ValueError, "plan_unrecognized"):
            self.apply(invalid)
        invalid = copy.deepcopy(plan)
        invalid["candidates"].reverse()
        self.resign(invalid)
        with self.assertRaisesRegex(ValueError, "plan_invalid"):
            self.apply(invalid)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM result_archives WHERE payload IS NOT NULL"), 2
        )

    def test_export_mapping_never_swallows_unrelated_check_violations(self):
        run_id = self.seed(diff=True)
        targets = ({"repo": "example/repo", "base_branch": "main"},)
        service = export_service.ExportService(self.db, targets)
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM result_archives WHERE run_id=%s", (run_id,)
            ).fetchone()
        previewed = service.preview(
            run_id,
            export_service.PreviewInput(
                artifact_id=row["id"],
                artifact_sha256=row["sha256"],
                target_repo="example/repo",
                base_branch="main",
            ),
        )
        approved = export_service.ApprovalInput(
            **{
                key: value
                for key, value in previewed.items()
                if key not in {"run_id", "verification_status", "files", "diff"}
            },
            approved=True,
        )
        with self.db.transaction() as conn:
            conn.execute(
                "ALTER TABLE github_exports ADD CONSTRAINT test_export_reject "
                "CHECK(target_repo<>'example/repo')"
            )
        try:
            with (
                self.assertRaises(psycopg.errors.CheckViolation) as raised,
                self.db.transaction() as conn,
            ):
                service.approve(conn, self.operator, run_id, approved)
            self.assertEqual(raised.exception.diag.constraint_name, "test_export_reject")
        finally:
            with self.db.transaction() as conn:
                conn.execute("ALTER TABLE github_exports DROP CONSTRAINT test_export_reject")

    def test_adapter_history_blocks_a_claim_of_never_allocated(self):
        run_id = self.seed()
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO adapter_operations(operation_id,run_id,kind,result) "
                "VALUES (%s,%s,'sandbox.allocate','{}'::jsonb)",
                (str(uuid4()), run_id),
            )
        self.assertEqual(archive_retention.preview(self.db)["candidates"], [])

    def test_concurrent_adapter_record_invalidates_never_allocated_evidence(self):
        run_id = self.seed()
        plan = archive_retention.preview(self.db)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            with self.db.transaction() as conn:
                conn.execute(
                    "INSERT INTO adapter_operations(operation_id,run_id,kind,result) "
                    "VALUES (%s,%s,'sandbox.allocate','{}'::jsonb)",
                    (str(uuid4()), run_id),
                )
                future = pool.submit(self.apply, plan)
                self.wait_for_lock()
                self.assertFalse(future.done())
            with self.assertRaisesRegex(ValueError, "candidates_changed"):
                future.result(timeout=10)
        self.assertIsNotNone(self.scalar("SELECT payload FROM result_archives"))

    def test_corrupt_payload_hash_aborts_complete_approved_batch(self):
        self.seed(days=50)
        self.seed(days=40, corruption="hash")
        plan = archive_retention.preview(self.db)
        self.assertEqual(len(plan["candidates"]), 2)
        with self.assertRaisesRegex(ValueError, "payload_invalid"):
            self.apply(plan)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM result_archives WHERE payload IS NOT NULL"), 2
        )
        self.assertEqual(
            self.scalar(
                "SELECT count(*) FROM archive_gc_receipts WHERE approval_digest=%s",
                (plan["approval_digest"],),
            ),
            0,
        )

    def test_corrupt_payload_size_is_preserved_for_investigation(self):
        self.seed(corruption="size")
        plan = archive_retention.preview(self.db)
        with self.assertRaisesRegex(ValueError, "payload_invalid"):
            self.apply(plan)
        self.assertIsNotNone(self.scalar("SELECT payload FROM result_archives"))
