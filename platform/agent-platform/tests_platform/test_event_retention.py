"""Manual event GC safety against real PostgreSQL/API, including replay and locks."""

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
from importlib.resources import files
from pathlib import Path
from unittest import mock
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
from test_control_plane import URL, PlatformFixture

from agent_platform import event_retention as gc
from agent_platform.domain import Problem
from agent_platform.store import Store, event


class EventRetentionTests(PlatformFixture):
    def seed(
        self, ages=(31, 31, 1), *, state="succeeded", kind="fixture.event", text="safe", omit=()
    ):
        value = self.create()
        template = value["run"]["id"]
        run_id = uuid4()
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET state='succeeded' WHERE id=%s", (template,))
            conn.execute("UPDATE jobs SET status='done' WHERE run_id=%s", (template,))
            conn.execute(
                "INSERT INTO runs(id,task_id,attempt_no,base_sha,profile_revision,goal,"
                "state,deadline,last_event_seq) SELECT %s,task_id,2,base_sha,profile_revision,"
                "goal,%s,deadline,%s FROM runs WHERE id=%s",
                (run_id, state, len(ages), template),
            )
            now = datetime.now(UTC)
            for seq, age in enumerate(ages, 1):
                if seq not in omit:
                    self.insert(conn, run_id, seq, now - timedelta(days=age), kind=kind, text=text)
        return str(run_id)

    def insert(self, conn, run_id, seq, created, *, kind="fixture.event", text="safe"):
        metadata = (run_id, seq, uuid4(), "fixture", f"source-{seq}", kind, created)
        conn.execute(
            "INSERT INTO run_event_identities(run_id,seq,event_id,source,source_event_id,"
            "type,created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s)",
            metadata,
        )
        conn.execute(
            "INSERT INTO run_events(run_id,seq,event_id,source,source_event_id,type,"
            "created_at,payload) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (*metadata, Jsonb({"text": text})),
        )

    def apply(self, plan=None):
        plan = plan if plan is not None else gc.preview(self.db)
        return gc.apply(self.db, plan, approval_digest=plan["approval_digest"])

    def run_row(self, run_id):
        return Store(self.db).run(run_id)

    def snapshot(self):
        with self.db.transaction() as conn:
            return {
                table: conn.execute(
                    "SELECT to_jsonb(t) AS row FROM " + table + " t ORDER BY to_jsonb(t)::text"
                ).fetchall()
                for table in (
                    "runs",
                    "run_events",
                    "run_event_identities",
                    "event_gc_receipts",
                    "audit_events",
                )
            }

    def resign(self, plan):
        plan["approval_digest"] = gc.digest(
            {k: v for k, v in plan.items() if k != "approval_digest"}
        )

    def test_real_retention_expires_history_and_preserves_sequence(self):
        run_id = self.seed()
        with self.db.transaction() as conn:
            original = conn.execute(
                "SELECT * FROM run_events WHERE run_id=%s AND seq=1", (run_id,)
            ).fetchone()
            protected = {
                table: conn.execute(
                    "SELECT to_jsonb(t) AS row FROM " + table + " t ORDER BY to_jsonb(t)::text"
                ).fetchall()
                for table in (
                    "tasks",
                    "jobs",
                    "run_messages",
                    "commands",
                    "sandbox_bindings",
                    "resource_reservations",
                    "github_exports",
                    "result_archives",
                )
            }
        plan = gc.preview(self.db)
        self.assertEqual(plan["candidates"][0]["event_count"], 2)
        receipt = self.apply(plan)
        self.assertEqual(receipt["total_count"], 2)
        row = self.run_row(run_id)
        self.assertEqual((row["event_floor"], row["last_event_seq"]), (3, 3))
        path = f"/api/v1/runs/{run_id}/events?follow=false"
        self.assertEqual(self.client.get(path).status_code, 410)
        self.assertEqual(self.client.get(path + "&after_seq=2").status_code, 200)
        self.assertEqual(self.client.get(path + "&after_seq=4").status_code, 422)
        with self.db.transaction() as conn:
            duplicate = event(
                conn,
                run_id,
                "different kind",
                {"different": True},
                source="fixture",
                source_id="source-1",
            )
            self.assertEqual((duplicate["event_id"], duplicate["seq"]), (original["event_id"], 1))
            self.assertIsNone(duplicate["payload"])
            new = event(conn, run_id, "fixture.new", {}, source="fixture", source_id="new-source")
            self.assertEqual(new["seq"], 4)
            for table, before in protected.items():
                after = conn.execute(
                    "SELECT to_jsonb(t) AS row FROM " + table + " t ORDER BY to_jsonb(t)::text"
                ).fetchall()
                self.assertEqual(before, after, table)
        self.assertEqual(self.apply(plan), receipt)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='event_gc.apply'"), 1
        )

    def test_all_events_partial_batches_and_later_floor_receipt_replay(self):
        run_id = self.seed((31, 31, 31))
        first = gc.preview(self.db, event_limit=1)
        first_receipt = self.apply(first)
        self.assertEqual(self.run_row(run_id)["event_floor"], 2)
        second = gc.preview(self.db)
        self.apply(second)
        self.assertEqual(self.run_row(run_id)["event_floor"], 4)
        self.assertEqual(self.run_row(run_id)["last_event_seq"], 3)
        self.assertEqual(self.apply(first), first_receipt)
        self.assertEqual(Store(self.db).events(run_id, 3), [])

    def test_strict_cutoff_recent_hole_and_inspected_limits(self):
        run_id = self.seed((31, 29, 40))
        cutoff = datetime.now(UTC) - timedelta(days=30)
        with self.db.transaction() as conn:
            selected = gc.candidates(conn, cutoff, 100, 1000)
        self.assertEqual(selected[0]["through_seq"], 1)
        with self.db.transaction() as conn:
            exact = conn.execute(
                "SELECT created_at FROM run_events WHERE run_id=%s AND seq=1", (run_id,)
            ).fetchone()["created_at"]
            self.assertEqual(gc.candidates(conn, exact, 100, 1000), [])
        self.seed((32,))
        self.assertEqual(len(gc.preview(self.db, limit=1)["candidates"]), 1)
        for kwargs in (
            {"retention_days": 29},
            {"retention_days": True},
            {"limit": 101},
            {"event_limit": 0},
            {"event_limit": False},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                gc.preview(self.db, **kwargs)

    def test_oversize_first_run_is_not_refilled_and_unicode_is_byte_accounted(self):
        old = self.seed((40,), kind='界\\"' * 600000)
        new = self.seed((35,), kind='界\\"', text='🙂\n\\"')
        self.assertEqual(gc.preview(self.db, limit=1)["candidates"], [])
        plan = gc.preview(self.db, limit=2)
        self.assertEqual([item["run_id"] for item in plan["candidates"]], [new])
        with self.db.transaction() as conn:
            raw = conn.execute(
                "SELECT payload::text AS value FROM run_events WHERE run_id=%s", (new,)
            ).fetchone()["value"]
        self.assertEqual(plan["candidates"][0]["payload_bytes"], len(raw.encode()))
        self.apply(plan)
        self.assertEqual(self.run_row(old)["event_floor"], 1)

    def test_active_unknown_and_allocation_attempts_are_protected(self):
        for state in (
            "queued",
            "provisioning",
            "running",
            "paused",
            "awaiting_approval",
            "finalizing",
            "cancelling",
            "interrupted",
        ):
            self.seed((31,), state=state)
        for mutation in (
            "cleanup_state='unknown'",
            "cleanup_state='pending'",
            "cleanup_state='confirmed'",
            "generation=1",
            "backend_ref='unknown'",
        ):
            run_id = self.seed((31,))
            with self.db.transaction() as conn:
                conn.execute("UPDATE runs SET " + mutation + " WHERE id=%s", (run_id,))
        self.assertEqual(gc.preview(self.db)["candidates"], [])

    def binding(self, run_id):
        binding = uuid4()
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO sandbox_bindings(id,run_id,node_id,provider_handle,generation,"
                "desired_state,observed_state,lease_deadline,cleanup_state) "
                "VALUES (%s,%s,'fake-local',%s,1,'stopped','stopped',now(),'confirmed')",
                (binding, run_id, f"pending:{run_id}"),
            )
            conn.execute(
                "INSERT INTO resource_reservations(sandbox_id,cpu,memory_bytes,disk_bytes,"
                "released_at) VALUES (%s,1,1024,1024,now())",
                (binding,),
            )
            conn.execute(
                "UPDATE runs SET sandbox_id=%s,generation=1,cleanup_state='confirmed' WHERE id=%s",
                (binding, run_id),
            )
        return binding

    def test_confirmed_fake_binding_and_every_ownership_mismatch(self):
        safe = self.seed((31,))
        self.binding(safe)
        for mutation in (
            "UPDATE sandbox_bindings SET generation=2 WHERE id=%s",
            "UPDATE sandbox_bindings SET cleanup_state='unknown' WHERE id=%s",
            "UPDATE sandbox_bindings SET desired_state='running' WHERE id=%s",
            "UPDATE sandbox_bindings SET observed_state='unknown' WHERE id=%s",
            "UPDATE sandbox_bindings SET provider_handle='pending:other' WHERE id=%s",
            "UPDATE resource_reservations SET released_at=NULL WHERE sandbox_id=%s",
            "DELETE FROM resource_reservations WHERE sandbox_id=%s",
            "UPDATE runs SET sandbox_id=NULL WHERE sandbox_id=%s",
        ):
            run_id = self.seed((31,))
            binding = self.binding(run_id)
            with self.db.transaction() as conn:
                conn.execute(mutation, (binding,))
        self.assertEqual([item["run_id"] for item in gc.preview(self.db)["candidates"]], [safe])

    def test_plan_approval_identity_expiry_mutation_and_empty_replay(self):
        empty = gc.preview(self.db)
        self.assertEqual(self.apply(empty)["total_count"], 0)
        self.assertEqual(self.apply(empty)["total_count"], 0)
        self.seed((31,))
        plan = gc.preview(self.db)
        for key, value in (("limit", 99), ("maintenance_id", str(uuid4()))):
            changed = copy.deepcopy(plan)
            changed[key] = value
            self.resign(changed)
            with self.assertRaises(ValueError):
                self.apply(changed)
        with self.assertRaisesRegex(ValueError, "approval_invalid"):
            gc.apply(self.db, plan, approval_digest="0" * 64)
        for change in (
            {"event_limit": True},
            {"extra": 1},
            {"byte_limit": 1},
            {"candidates": [{}]},
        ):
            with self.assertRaises(ValueError):
                self.apply({**plan, **change})
        with mock.patch.object(gc, "parsed_time", wraps=gc.parsed_time) as clock:
            # Real expiry is tested with an issued historical plan below, not a wall-clock sleep.
            self.assertEqual(gc.validate_plan(plan, plan["approval_digest"]), plan)
            self.assertTrue(clock.called)
        old = copy.deepcopy(plan)
        for field in ("created_at", "expires_at", "cutoff"):
            old[field] = gc.timestamp(gc.parsed_time(old[field]) - timedelta(hours=2))
        self.resign(old)
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO event_gc_plans(approval_digest,plan) VALUES (%s,%s)",
                (old["approval_digest"], Jsonb(old)),
            )
        with self.assertRaisesRegex(ValueError, "plan_expired"):
            self.apply(old)

    def test_changed_content_sequence_and_eligibility_abort_exact_batch(self):
        first, second = self.seed((31,)), self.seed((31,))
        plan = gc.preview(self.db)
        with self.db.transaction() as conn:
            conn.execute("UPDATE run_events SET payload='{}'::jsonb WHERE run_id=%s", (second,))
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, "candidates_changed"):
            self.apply(plan)
        self.assertEqual(self.snapshot(), before)
        plan = gc.preview(self.db)
        with self.db.transaction() as conn:
            event(conn, first, "new", {}, source_id="after-preview")
        with self.assertRaisesRegex(ValueError, "candidates_changed"):
            self.apply(plan)
        plan = gc.preview(self.db)
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET cleanup_state='unknown' WHERE id=%s", (second,))
        with self.assertRaisesRegex(ValueError, "candidates_changed"):
            self.apply(plan)

    def test_direct_delete_metadata_and_identity_mutation_are_refused(self):
        run_id = self.seed((31,))
        for statement in (
            "DELETE FROM run_events WHERE run_id=%s",
            "UPDATE run_events SET type='changed' WHERE run_id=%s",
            "UPDATE run_events SET created_at=now() WHERE run_id=%s",
            "UPDATE run_event_identities SET type='changed' WHERE run_id=%s",
            "DELETE FROM run_event_identities WHERE run_id=%s",
        ):
            with self.subTest(statement=statement), self.assertRaises(psycopg.Error):
                with self.db.transaction() as conn:
                    conn.execute(statement, (run_id,))
        plan = gc.preview(self.db)
        receipt = self.apply(plan)
        for table in ("event_gc_plans", "event_gc_receipts"):
            with self.assertRaises(psycopg.Error):
                with self.db.transaction() as conn:
                    conn.execute(
                        "DELETE FROM " + table + " WHERE approval_digest=%s",
                        (plan["approval_digest"],),
                    )
        self.assertEqual(self.apply(plan), receipt)

    def test_receipt_replay_checks_retained_identity_and_structure(self):
        self.seed((31,))
        plan = gc.preview(self.db)
        self.apply(plan)
        real_lengths = gc._lengths

        def missing(*args, **kwargs):
            return [] if kwargs.get("identities") else real_lengths(*args, **kwargs)

        with mock.patch.object(gc, "_lengths", side_effect=missing):
            with self.assertRaisesRegex(ValueError, "receipt_invalid"):
                self.apply(plan)
        with mock.patch.object(gc, "_record", return_value={"wrong": "identity"}):
            with self.assertRaisesRegex(ValueError, "receipt_invalid"):
                self.apply(plan)
        with mock.patch.object(gc, "_receipt", return_value={}):
            with self.assertRaisesRegex(ValueError, "receipt_invalid"):
                self.apply(plan)

    def test_failure_after_floor_update_rolls_back_everything(self):
        self.seed((31,))
        plan = gc.preview(self.db)
        before = self.snapshot()
        real_transaction = self.db.transaction

        @contextmanager
        def broken_transaction():
            with real_transaction() as conn:

                class Fault:
                    def execute(self, statement, parameters=None):
                        if "INSERT INTO audit_events" in statement:
                            raise RuntimeError("injected after floor")
                        return conn.execute(statement, parameters)

                yield Fault()

        with mock.patch.object(self.db, "transaction", broken_transaction):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                self.apply(plan)
        self.assertEqual(self.snapshot(), before)

    def test_producer_holding_run_or_job_lock_makes_gc_fail_nowait(self):
        run_id = self.seed((31,))
        plan = gc.preview(self.db)
        before = self.snapshot()
        for relation, column, value in (("runs", "id", run_id), ("jobs", "run_id", run_id)):
            with self.db.transaction() as holder:
                # The job-less synthetic run still acquires ROW SHARE on jobs.
                holder.execute(
                    "SELECT * FROM " + relation + " WHERE " + column + "=%s FOR UPDATE", (value,)
                )
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(self.apply, plan)
                    with self.assertRaisesRegex(ValueError, "database_unavailable"):
                        future.result(timeout=2)
        self.assertEqual(self.snapshot(), before)

    def test_gc_first_producer_waits_then_dedupes_after_commit(self):
        run_id = self.seed((31,))
        plan = gc.preview(self.db)
        locked, release, producer_started = threading.Event(), threading.Event(), threading.Event()
        real_lock = gc.lock

        def paused(conn):
            real_lock(conn)
            locked.set()
            if not release.wait(3):
                raise RuntimeError("test release missing")

        def append():
            producer_started.set()
            with self.db.transaction() as conn:
                return event(conn, run_id, "replay", {}, source="fixture", source_id="source-1")

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            with mock.patch.object(gc, "lock", side_effect=paused):
                apply_future = pool.submit(self.apply, plan)
                self.assertTrue(locked.wait(2))
                producer = pool.submit(append)
                self.assertTrue(producer_started.wait(2))
                self.assertFalse(producer.done())
                release.set()
                self.assertEqual(apply_future.result(timeout=3)["total_count"], 1)
                replay = producer.result(timeout=3)
        self.assertIsNone(replay["payload"])
        self.assertEqual(self.run_row(run_id)["last_event_seq"], 1)

    def test_reader_snapshot_remains_complete_across_gc_and_pool_default_restores(self):
        run_id = self.seed((31, 31))
        plan = gc.preview(self.db)
        with self.db.transaction() as reader:
            reader.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            self.assertEqual(
                reader.execute("SELECT event_floor FROM runs WHERE id=%s", (run_id,)).fetchone()[
                    "event_floor"
                ],
                1,
            )
            self.apply(plan)
            self.assertEqual(
                reader.execute(
                    "SELECT count(*) AS n FROM run_events WHERE run_id=%s", (run_id,)
                ).fetchone()["n"],
                2,
            )
        with self.assertRaises(Problem) as error:
            Store(self.db).events(run_id, 0)
        self.assertEqual(error.exception.status, 410)
        with self.db.transaction() as conn:
            self.assertEqual(
                conn.execute("SHOW transaction_isolation").fetchone()["transaction_isolation"],
                "read committed",
            )

    def test_real_cli_private_plan_roundtrip_and_duplicate_key_refusal(self):
        self.seed((31,))
        env = dict(os.environ, DATABASE_URL=URL)
        command = [
            sys.executable,
            "-m",
            "agent_platform.cli",
            "event-gc-preview",
            "--event-limit",
            "1",
        ]
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
                "event-gc-apply",
                "--plan",
                str(path),
                "--approve",
                plan["approval_digest"],
            ]
            result = subprocess.run(apply, env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["total_count"], 1)
            path.write_text('{"duplicate":1,"duplicate":2}')
            result = subprocess.run(apply, env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stderr.strip(), "event_gc_plan_invalid")
            self.assertNotIn(URL, result.stderr)

    def test_old_valid_long_type_backfills_and_new_helper_insert_preserves_it(self):
        schema = "event_migration_" + uuid4().hex[:12]
        # Isolated disposable schema inside the fresh owned test database only.
        with psycopg.connect(URL) as conn:
            conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            conn.execute(sql.SQL("SET LOCAL search_path TO {}").format(sql.Identifier(schema)))
            conn.execute(
                "CREATE TABLE runs(id uuid PRIMARY KEY,last_event_seq bigint NOT NULL DEFAULT 1)"
            )
            original = (
                files("agent_platform").joinpath("migrations/001_control_plane.sql").read_text()
            )
            ddl = original[
                original.index("CREATE TABLE run_events (") : original.index(
                    "CREATE TABLE run_messages ("
                )
            ]
            conn.execute(ddl)
            run_id = uuid4()
            kind = "".join(hashlib.sha256(str(i).encode()).hexdigest() for i in range(512))
            conn.execute("INSERT INTO runs(id) VALUES (%s)", (run_id,))
            conn.execute(
                "INSERT INTO run_events(run_id,seq,event_id,source,source_event_id,type,payload) "
                "VALUES (%s,1,%s,'fixture','old',%s,'{}')",
                (run_id, uuid4(), kind),
            )
            conn.execute(
                files("agent_platform").joinpath("migrations/017_event_retention.sql").read_text()
            )
            self.assertEqual(
                conn.execute("SELECT type FROM run_event_identities").fetchone()[0], kind
            )
            from psycopg.rows import dict_row

            conn.row_factory = dict_row
            added = event(conn, run_id, kind, {}, source="fixture", source_id="new")
            self.assertEqual((added["type"], added["seq"]), (kind, 2))
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))

    def manual_receipt(self, conn, plan, when=None):
        when = when or conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"]
        receipt = gc._receipt(plan, when)
        conn.execute(
            "INSERT INTO event_gc_receipts(approval_digest,plan,receipt,created_at) "
            "VALUES (%s,%s,%s,%s)",
            (plan["approval_digest"], Jsonb(plan), Jsonb(receipt), when),
        )
        conn.execute(
            "SELECT set_config('agent_platform.event_gc_approval',%s,true)",
            (plan["approval_digest"],),
        )
        return receipt

    def test_delete_guard_rejects_wrong_run_and_range_with_valid_current_receipt(self):
        first, second = self.seed((40, 40)), self.seed((35,))
        plan = gc.preview(self.db, limit=1, event_limit=1)
        self.assertEqual(plan["candidates"][0]["run_id"], first)
        before = self.snapshot()
        with self.db.transaction() as conn:
            # Roll back this positive authority probe too: application apply alone
            # may commit deletion together with floor/audit, not this test helper.
            with conn.transaction(force_rollback=True):
                self.manual_receipt(conn, plan)
                for run_id, seq in ((second, 1), (first, 2)):
                    with self.subTest(run_id=run_id, seq=seq), self.assertRaises(psycopg.Error):
                        with conn.transaction():
                            conn.execute(
                                "DELETE FROM run_events WHERE run_id=%s AND seq=%s", (run_id, seq)
                            )
                self.assertEqual(
                    conn.execute(
                        "DELETE FROM run_events WHERE run_id=%s AND seq=1", (first,)
                    ).rowcount,
                    1,
                )
        self.assertEqual(self.snapshot(), before)

    def test_delete_guard_rejects_previous_transaction_unconsumed_receipt(self):
        run_id = self.seed((31,))
        plan = gc.preview(self.db)
        with self.db.transaction() as conn:
            self.manual_receipt(conn, plan)
            prior = conn.execute("SELECT txid_current() AS id").fetchone()["id"]
        before = self.snapshot()
        with self.assertRaises(psycopg.Error):
            with self.db.transaction() as conn:
                self.assertNotEqual(
                    conn.execute("SELECT txid_current() AS id").fetchone()["id"], prior
                )
                conn.execute(
                    "SELECT set_config('agent_platform.event_gc_approval',%s,true)",
                    (plan["approval_digest"],),
                )
                conn.execute("DELETE FROM run_events WHERE run_id=%s AND seq=1", (run_id,))
        self.assertEqual(self.snapshot(), before)
        with self.assertRaisesRegex(ValueError, "receipt_invalid"):
            self.apply(plan)
        self.assertEqual(self.snapshot(), before)

    def test_delete_guard_rejects_expired_current_transaction_approval(self):
        run_id = self.seed((40,))
        plan = gc.preview(self.db)
        for field in ("created_at", "expires_at", "cutoff"):
            plan[field] = gc.timestamp(gc.parsed_time(plan[field]) - timedelta(hours=2))
        self.resign(plan)
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO event_gc_plans(approval_digest,plan) VALUES (%s,%s)",
                (plan["approval_digest"], Jsonb(plan)),
            )
        before = self.snapshot()
        with self.assertRaises(psycopg.Error):
            with self.db.transaction() as conn:
                self.manual_receipt(
                    conn, plan, gc.parsed_time(plan["created_at"]) + timedelta(minutes=1)
                )
                conn.execute("DELETE FROM run_events WHERE run_id=%s AND seq=1", (run_id,))
        self.assertEqual(self.snapshot(), before)

    def test_missing_identity_and_each_insert_update_metadata_mismatch_are_rejected(self):
        run_id = self.seed((31,))
        created = datetime.now(UTC)
        metadata = (run_id, 2, uuid4(), "fixture", "next-source", "fixture.next", created)
        insert = (
            "INSERT INTO run_events(run_id,seq,event_id,source,source_event_id,type,"
            "created_at,payload) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,'{}')"
        )
        with self.assertRaises(psycopg.Error):
            with self.db.transaction() as conn:
                conn.execute(insert, metadata)
        with self.db.transaction() as conn:
            conn.execute("INSERT INTO run_event_identities VALUES (%s,%s,%s,%s,%s,%s,%s)", metadata)
        changes = {
            "run_id": str(uuid4()),
            "seq": 3,
            "event_id": uuid4(),
            "source": "other",
            "source_event_id": "other",
            "type": "other",
            "created_at": created + timedelta(seconds=1),
        }
        fields = ("run_id", "seq", "event_id", "source", "source_event_id", "type", "created_at")
        for index, field in enumerate(fields):
            altered = list(metadata)
            altered[index] = changes[field]
            with self.subTest(operation="insert", field=field), self.assertRaises(psycopg.Error):
                with self.db.transaction() as conn:
                    conn.execute(insert, altered)
            with self.subTest(operation="update", field=field), self.assertRaises(psycopg.Error):
                with self.db.transaction() as conn:
                    conn.execute(
                        "UPDATE run_events SET " + field + "=%s WHERE run_id=%s AND seq=1",
                        (changes[field], run_id),
                    )
        with self.db.transaction() as conn:
            conn.execute(insert, metadata)
            conn.execute("UPDATE runs SET last_event_seq=2 WHERE id=%s", (run_id,))
        self.assertEqual(
            self.scalar("SELECT count(*) FROM run_events WHERE run_id=%s", (run_id,)), 2
        )

    def test_mixed_recent_gap_oversize_batches_obey_inspection_budget_and_replay(self):
        recent = self.seed((50, 1, 60))
        gap = self.seed((49, 49, 49), omit=(2,))
        oversized = self.seed((48,), kind="x" * 1000000)
        ordinary = self.seed((47, 47))
        inspected = []
        lengths = gc._lengths

        def observed(*args, **kwargs):
            rows = lengths(*args, **kwargs)
            inspected.append((str(args[1]), len(rows)))
            return rows

        with mock.patch.object(gc, "_lengths", side_effect=observed):
            plan = gc.preview(self.db, limit=4, event_limit=5)
        self.assertEqual(inspected, [(recent, 3), (gap, 2), (oversized, 1)])
        self.assertEqual(
            [(item["run_id"], item["through_seq"]) for item in plan["candidates"]], [(recent, 1)]
        )
        receipt = self.apply(plan)
        self.assertEqual(self.apply(plan), receipt)
        # The gap and oversized first run consume the fixed inspected-run list;
        # the ordinary fourth run cannot refill a limit=2 preview.
        limited = gc.preview(self.db, limit=2, event_limit=10)
        self.assertEqual(limited["candidates"], [])
        self.assertEqual(self.apply(limited), self.apply(limited))
        next_plan = gc.preview(self.db, limit=3, event_limit=10)
        self.assertEqual([item["run_id"] for item in next_plan["candidates"]], [ordinary])
        next_receipt = self.apply(next_plan)
        self.assertEqual(self.apply(next_plan), next_receipt)
        self.assertEqual(self.apply(plan), receipt)
        self.assertEqual(self.run_row(gap)["event_floor"], 1)
        self.assertEqual(self.run_row(oversized)["event_floor"], 1)

    def test_near_cap_multirun_metadata_plan_applies_and_replays_exact_hashes(self):
        kind = "".join(hashlib.sha256(str(i).encode()).hexdigest() for i in range(1000))
        first = self.seed((40,) * 5, kind=kind)
        second = self.seed((39,) * 5, kind=kind)
        with self.db.transaction() as conn:
            upper = sum(
                gc._upper(row)
                for run_id in (first, second)
                for row in gc._lengths(conn, run_id, 1, 5)
            )
        self.assertGreater(upper, gc.BYTE_LIMIT * 0.9)
        self.assertLess(upper + 32, gc.BYTE_LIMIT)
        plan = gc.preview(self.db, limit=2, event_limit=10)
        self.assertEqual([item["event_count"] for item in plan["candidates"]], [5, 5])
        receipt = self.apply(plan)
        self.assertEqual(receipt["total_count"], 10)
        self.assertEqual(
            receipt["ranges"], [{**item, "new_floor": 6} for item in plan["candidates"]]
        )
        self.assertEqual(self.apply(plan), receipt)
        for run_id in (first, second):
            self.assertEqual(self.run_row(run_id)["event_floor"], 6)

    def test_actual_store_events_floor_payload_barrier_returns_complete_old_window(self):
        run_id = self.seed((31, 31))
        plan = gc.preview(self.db)
        floor_read, release = threading.Event(), threading.Event()
        real_transaction = self.db.transaction

        @contextmanager
        def instrumented():
            with real_transaction() as conn:

                class Connection:
                    def execute(self, statement, parameters=None):
                        cursor = conn.execute(statement, parameters)
                        if "SELECT event_floor,last_event_seq FROM runs" not in statement:
                            return cursor

                        class FloorCursor:
                            def fetchone(self):
                                row = cursor.fetchone()
                                floor_read.set()
                                if not release.wait(4):
                                    raise RuntimeError("floor barrier not released")
                                return row

                        return FloorCursor()

                yield Connection()

        with mock.patch.object(self.db, "transaction", instrumented):
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(Store(self.db).events, run_id, 0)
                try:
                    self.assertTrue(floor_read.wait(2))
                    self.apply(plan)
                finally:
                    release.set()
                rows = pending.result(timeout=3)
        self.assertEqual([row["seq"] for row in rows], [1, 2])
        with self.assertRaises(Problem) as error:
            Store(self.db).events(run_id, 0)
        self.assertEqual(error.exception.code, "events_archived")
        with self.db.transaction() as conn:
            self.assertEqual(
                conn.execute("SHOW transaction_isolation").fetchone()["transaction_isolation"],
                "read committed",
            )

    def test_follow_sse_pruned_after_first_200_events_emits_stream_error(self):
        run_id = self.seed((31,) * 201)
        result = {"summary": "Stream result remains", "verification": {"status": "not_run"}}
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET result=%s WHERE id=%s", (Jsonb(result), run_id))
        plan = gc.preview(self.db)
        original = Store.events
        cursors, receipts = [], []

        def boundary(store, current_run, after):
            if str(current_run) == run_id:
                cursors.append(after)
                if after == 200:
                    receipts.append(self.apply(plan))
            return original(store, current_run, after)

        with mock.patch.object(Store, "events", boundary):
            response = self.client.get(f"/api/v1/runs/{run_id}/events?follow=true&after_seq=0")
        self.assertEqual(response.status_code, 200)
        delivered = [
            int(line[4:]) for line in response.text.splitlines() if line.startswith("id: ")
        ]
        self.assertEqual(delivered, list(range(1, 201)))
        self.assertEqual(cursors, [0, 200])
        self.assertEqual(receipts[0]["total_count"], 201)
        self.assertIn('event: stream_error\ndata: {"error": "events_archived"}', response.text)
        snapshot = self.client.get(f"/api/v1/runs/{run_id}").json()
        self.assertEqual((snapshot["event_floor"], snapshot["last_event_seq"]), (202, 201))
        self.assertEqual(snapshot["result"], result)
