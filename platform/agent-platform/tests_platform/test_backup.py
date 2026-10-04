"""Recover real PostgreSQL dumps into separate empty databases; no fake-dump acceptance."""

import hashlib
import json
import os
import subprocess
import tempfile
import threading
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock
from uuid import uuid4

import psycopg
from backup_fixture import NativeClient
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from test_control_plane import URL, PlatformFixture

from agent_platform import archive_retention, backup
from agent_platform.api import create_app
from agent_platform.db import Database
from agent_platform.domain import Problem
from agent_platform.result_archive import read_archive
from agent_platform.worker import Worker


class BackupTests(PlatformFixture):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.native = NativeClient(URL)
        cls.addClassCleanup(cls.native.close)

    def setUp(self):
        super().setUp()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.bundle = Path(self.temporary.name) / "bundle"
        self.target_name = "ap_backup_restore_" + uuid4().hex[:12]
        config = conninfo_to_dict(URL)
        config["dbname"] = self.target_name
        self.target_url = make_conninfo(**config)
        with psycopg.connect(URL, autocommit=True) as conn:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(self.target_name)))
        self.addCleanup(self.drop_target)
        self.patch = mock.patch.object(backup, "_run_native", side_effect=self.native.run)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def drop_target(self):
        with psycopg.connect(URL, autocommit=True) as conn:
            conn.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(self.target_name))
            )

    def completed(self):
        self.payload["goal"] = "FILE backup.txt\nTEXT immutable roundtrip"
        value = self.create()
        self.assertTrue(Worker(self.db).run_once())
        with self.db.transaction() as conn:
            conn.execute("UPDATE runtime_capacity SET draining=true")
        return value["run"]["id"]

    def make_backup(self):
        return backup.create_backup(URL, self.bundle, offline=True)

    def restore(self):
        return backup.restore_backup(
            self.target_url, self.bundle, offline=True, confirm_database=self.target_name
        )

    def test_real_native_roundtrip_preserves_archive_and_all_history(self):
        run_id = self.completed()
        with self.db.transaction() as conn:
            archived = conn.execute(
                "SELECT * FROM result_archives WHERE run_id=%s", (run_id,)
            ).fetchone()
            original_identity = conn.execute("SELECT id FROM maintenance_identity").fetchone()["id"]
            conn.execute("INSERT INTO login_limits VALUES ('fixture-limit',2,now())")
            conn.execute(
                "INSERT INTO model_proxy_runs(run_id,policy_sha256,request_limit) VALUES (%s,%s,5)",
                (run_id, "a" * 64),
            )
            conn.execute(
                "INSERT INTO "
                "model_proxy_tokens(token_hash,run_id,generation,lease_owner,expires_at)"
                " VALUES (%s,%s,1,%s,now()+interval '1 hour')",
                ("b" * 64, run_id, uuid4()),
            )
            conn.execute(
                "INSERT INTO "
                "model_proxy_requests(run_id,request_id,generation,payload_sha256,status,reason)"
                " VALUES (%s,%s,1,%s,'unknown','fixture_unknown')",
                (run_id, uuid4(), "c" * 64),
            )
            binding = conn.execute(
                "SELECT id FROM sandbox_bindings WHERE run_id=%s", (run_id,)
            ).fetchone()["id"]
            service_id, lease_owner = uuid4(), uuid4()
            conn.execute(
                "INSERT INTO tool_broker_services(service_id,config_sha256,credential_revision) "
                "VALUES (%s,%s,%s)",
                (service_id, "1" * 64, uuid4()),
            )
            conn.execute(
                "INSERT INTO tool_broker_runs(run_id,service_id,policy_sha256,binding_id,"
                "generation,lease_owner,expires_at,request_limit,in_flight_limit) "
                "VALUES (%s,%s,%s,%s,1,%s,now()+interval '1 hour',5,1)",
                (run_id, service_id, "2" * 64, binding, lease_owner),
            )
            conn.execute(
                "INSERT INTO tool_broker_tokens(token_hash,run_id,generation,binding_id,"
                "lease_owner,expires_at) VALUES (%s,%s,1,%s,%s,now()+interval '1 hour')",
                ("3" * 64, run_id, binding, lease_owner),
            )
            conn.execute(
                "INSERT INTO "
                "github_exports(id,run_id,artifact_id,artifact_sha256,target_repo,base_branch,base_sha,branch,approval_digest,created_by,state,reason)"
                " VALUES "
                "(%s,%s,%s,%s,'example/repo','main',%s,%s,%s,%s,'uncertain','fixture_lost_reply')",
                (
                    uuid4(),
                    run_id,
                    archived["id"],
                    archived["sha256"],
                    "d" * 40,
                    "agent-platform/export-" + "e" * 64,
                    "f" * 64,
                    self.operator,
                ),
            )
        before = self.snapshot(URL)
        created = self.make_backup()
        self.assertEqual(created["status"], "created")
        self.assertEqual(backup.verify_backup(self.bundle)["status"], "verified")
        restored = self.restore()
        self.assertEqual(restored["status"], "restored")
        target = Database(self.target_url)
        target.open()
        self.addCleanup(target.close)
        self.assertEqual(read_archive(target, run_id, archived["id"]), archived["payload"])
        self.assertEqual(hashlib.sha256(archived["payload"]).hexdigest(), archived["sha256"])
        self.assertEqual(self.snapshot(self.target_url), before)
        self.assertEqual(self.snapshot(URL), before)
        with target.transaction() as conn:
            self.assertNotEqual(
                conn.execute("SELECT id FROM maintenance_identity").fetchone()["id"],
                original_identity,
            )
            for table in backup.EPHEMERAL:
                self.assertEqual(
                    conn.execute(
                        sql.SQL("SELECT count(*) AS n FROM {}").format(sql.Identifier(table))
                    ).fetchone()["n"],
                    0,
                )
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) AS n FROM runtime_capacity WHERE NOT draining"
                ).fetchone()["n"],
                0,
            )
        self.assertGreater(self.scalar("SELECT count(*) FROM sessions"), 0)
        self.assertEqual(self.scalar("SELECT count(*) FROM model_proxy_tokens"), 1)
        self.assertEqual(self.scalar("SELECT count(*) FROM tool_broker_tokens"), 1)
        client = self.restored_client(target, run_id)
        listing = client.get(f"/api/v1/runs/{run_id}/artifacts")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()["items"][0]["sha256"], archived["sha256"])
        downloaded = client.get(f"/api/v1/runs/{run_id}/artifacts/{archived['id']}")
        self.assertEqual(downloaded.status_code, 200)
        self.assertEqual(downloaded.content, archived["payload"])
        self.assertEqual(hashlib.sha256(downloaded.content).hexdigest(), archived["sha256"])

    def restored_client(self, target, run_id):
        settings = replace(self.settings, database_url=self.target_url)
        client = TestClient(create_app(settings, target), base_url=settings.origin)
        self.addCleanup(client.close)
        client.cookies.update(self.client.cookies)
        self.assertEqual(client.get(f"/api/v1/runs/{run_id}").status_code, 401)
        csrf = client.get("/api/v1/session").json()["csrf_token"]
        login = client.post(
            "/api/v1/session",
            json={"username": "operator", "password": self.password},
            headers={"Origin": settings.origin, "X-CSRF-Token": csrf},
        )
        self.assertEqual(login.status_code, 200, login.text)
        self.assertEqual(client.get(f"/api/v1/runs/{run_id}").status_code, 200)
        return client

    def snapshot(self, url):
        with psycopg.connect(url) as conn:
            tables = conn.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
            ).fetchall()
            return {
                table: conn.execute(
                    sql.SQL(
                        "SELECT row_to_json(t)::text FROM {} t ORDER BY row_to_json(t)::text"
                    ).format(sql.Identifier(table))
                ).fetchall()
                for (table,) in tables
                if table not in {*backup.EPHEMERAL, "maintenance_identity"}
            }

    def test_offline_acknowledgement_and_exact_target_name_required(self):
        self.completed()
        with self.assertRaisesRegex(ValueError, "backup_offline_required"):
            backup.create_backup(URL, self.bundle, offline=False)
        self.assertFalse(self.bundle.exists())
        self.make_backup()
        for offline, confirmation in ((False, self.target_name), (True, "another")):
            with self.assertRaisesRegex(ValueError, "backup_(offline_required|target_mismatch)"):
                backup.restore_backup(
                    self.target_url, self.bundle, offline=offline, confirm_database=confirmation
                )
        self.assert_target_empty()

    def test_populated_target_and_source_are_never_overwritten(self):
        self.completed()
        self.make_backup()
        with psycopg.connect(self.target_url) as conn:
            conn.execute("CREATE TABLE sentinel(value text)")
            conn.execute("INSERT INTO sentinel VALUES ('untouched')")
        with self.assertRaisesRegex(ValueError, "backup_target_not_empty"):
            self.restore()
        with self.assertRaisesRegex(ValueError, "backup_target_not_empty"):
            backup.restore_backup(
                URL, self.bundle, offline=True, confirm_database="agent_platform_test"
            )
        with psycopg.connect(self.target_url) as conn:
            self.assertEqual(conn.execute("SELECT value FROM sentinel").fetchone()[0], "untouched")

    def test_active_source_and_undrained_nodes_rejected_without_mutation(self):
        self.create()
        with self.db.transaction() as conn:
            conn.execute("UPDATE runtime_capacity SET draining=true")
        original = self.snapshot(URL)
        with self.assertRaisesRegex(ValueError, "backup_source_active"):
            self.make_backup()
        self.assertEqual(self.snapshot(URL), original)
        Worker(self.db).run_once()  # Draining prevents claiming work.
        with self.db.transaction() as conn:
            conn.execute("UPDATE runtime_capacity SET draining=false")
        with self.assertRaisesRegex(ValueError, "backup_source_active"):
            self.make_backup()

    def test_unknown_cleanup_and_unfinished_export_rejected(self):
        self.completed()
        changes = (
            (
                "UPDATE runs SET cleanup_state='unknown'",
                "UPDATE runs SET cleanup_state='confirmed'",
            ),
            ("UPDATE jobs SET status='interrupted'", "UPDATE jobs SET status='done'"),
            (
                "UPDATE sandbox_bindings SET cleanup_state='unknown'",
                "UPDATE sandbox_bindings SET cleanup_state='confirmed'",
            ),
            (
                "UPDATE resource_reservations SET released_at=NULL",
                "UPDATE resource_reservations SET released_at=now()",
            ),
            (
                "UPDATE runtime_capacity SET draining=false",
                "UPDATE runtime_capacity SET draining=true",
            ),
        )
        for statement, reset in changes:
            with self.subTest(statement=statement):
                with self.db.transaction() as conn:
                    conn.execute(statement)
                try:
                    with self.assertRaisesRegex(ValueError, "backup_source_active"):
                        self.make_backup()
                finally:
                    with self.db.transaction() as conn:
                        conn.execute(reset)

    def test_never_allocated_proof_and_missing_reservation_fail_closed(self):
        run_id = self.create()["run"]["id"]
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET state='cancelled',cleanup_state='not_allocated'")
            conn.execute("UPDATE jobs SET status='done'")
            conn.execute("UPDATE runtime_capacity SET draining=true")
        for change, reset in (
            ("UPDATE runs SET generation=1", "UPDATE runs SET generation=0"),
            ("UPDATE runs SET backend_ref='unknown'", "UPDATE runs SET backend_ref=NULL"),
            ("UPDATE jobs SET attempts=1", "UPDATE jobs SET attempts=0"),
        ):
            with self.db.transaction() as conn:
                conn.execute(change)
            try:
                with self.assertRaisesRegex(ValueError, "backup_source_active"):
                    self.make_backup()
            finally:
                with self.db.transaction() as conn:
                    conn.execute(reset)
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO adapter_operations(operation_id,run_id,kind,result) "
                "VALUES ('unknown-allocation',%s,'allocate','{}'::jsonb)",
                (run_id,),
            )
        with self.assertRaisesRegex(ValueError, "backup_source_active"):
            self.make_backup()
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM adapter_operations WHERE operation_id='unknown-allocation'")
        self.make_backup()
        self.restore()
        self.assertEqual(self.snapshot(self.target_url), self.snapshot(URL))

    def test_confirmed_binding_requires_a_released_reservation_record(self):
        self.completed()
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM resource_reservations")
        with self.assertRaisesRegex(ValueError, "backup_source_active"):
            self.make_backup()

    def test_temp_namespace_lookalike_rejects_source_and_target(self):
        self.assert_namespace_rejected("pgxtemp_review")

    def test_toast_namespace_lookalike_rejects_source_and_target(self):
        self.assert_namespace_rejected("pgxtoast_review")

    def assert_namespace_rejected(self, name):
        self.completed()
        self.make_backup()
        for url, operation, code in (
            (URL, self.make_backup, "backup_schema_mismatch"),
            (self.target_url, self.restore, "backup_target_not_empty"),
        ):
            with self.subTest(namespace=name, target=url == self.target_url):
                with psycopg.connect(url) as conn:
                    conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(name)))
                    conn.execute(
                        sql.SQL("CREATE TABLE {}.sentinel(value text)").format(sql.Identifier(name))
                    )
                    conn.execute(
                        sql.SQL("INSERT INTO {}.sentinel VALUES ('untouched')").format(
                            sql.Identifier(name)
                        )
                    )
                try:
                    # Each source assertion uses a fresh destination so a previous bundle
                    # cannot mask an incorrectly accepted extra schema.
                    original_bundle = self.bundle
                    if url == URL:
                        self.bundle = Path(self.temporary.name) / ("source-" + name)
                    try:
                        with self.assertRaisesRegex(ValueError, code):
                            operation()
                    finally:
                        self.bundle = original_bundle
                    with psycopg.connect(url) as conn:
                        self.assertEqual(
                            conn.execute(
                                sql.SQL("SELECT value FROM {}.sentinel").format(
                                    sql.Identifier(name)
                                )
                            ).fetchone()[0],
                            "untouched",
                        )
                    if url == self.target_url:
                        self.assert_target_empty()
                finally:
                    with psycopg.connect(url) as conn:
                        conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(name)))

    def test_standalone_type_rejects_populated_target(self):
        self.completed()
        self.make_backup()
        with psycopg.connect(self.target_url) as conn:
            conn.execute("CREATE TYPE public.fixture_sentinel AS ENUM ('untouched')")
        with self.assertRaisesRegex(ValueError, "backup_target_not_empty"):
            self.restore()
        with psycopg.connect(self.target_url) as conn:
            self.assertEqual(
                conn.execute("SELECT 'untouched'::fixture_sentinel::text").fetchone()[0],
                "untouched",
            )
            self.assertEqual(
                conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'").fetchone()[
                    0
                ],
                0,
            )

    def test_standalone_type_rejects_undeclared_source_schema(self):
        self.completed()
        with self.db.transaction() as conn:
            conn.execute("CREATE TYPE public.fixture_sentinel AS ENUM ('untouched')")
        try:
            with self.assertRaisesRegex(ValueError, "backup_schema_mismatch"):
                self.make_backup()
        finally:
            with self.db.transaction() as conn:
                conn.execute("DROP TYPE fixture_sentinel")
        self.assertFalse(self.bundle.exists())

    def test_physical_constraint_default_and_trigger_drift_rejected(self):
        self.completed()
        with self.db.transaction() as conn:
            constraint = conn.execute(
                "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint "
                "WHERE conname='archive_payload_lifecycle'"
            ).fetchone()["definition"]
            trigger = conn.execute(
                "SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger "
                "WHERE tgname='result_archive_immutable'"
            ).fetchone()["definition"]
        changes = (
            (
                "ALTER TABLE result_archives DROP CONSTRAINT archive_payload_lifecycle",
                "ALTER TABLE result_archives ADD CONSTRAINT archive_payload_lifecycle "
                + constraint,
            ),
            (
                "ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'done'",
                "ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'queued'",
            ),
            (
                "ALTER TABLE result_archives ALTER COLUMN mime DROP NOT NULL",
                "ALTER TABLE result_archives ALTER COLUMN mime SET NOT NULL",
            ),
            (
                "DROP TRIGGER result_archive_immutable ON result_archives; "
                "CREATE TRIGGER result_archive_immutable BEFORE INSERT ON result_archives "
                "FOR EACH ROW EXECUTE FUNCTION immutable_result_archive()",
                "DROP TRIGGER result_archive_immutable ON result_archives; " + trigger,
            ),
        )
        for index, (change, reset) in enumerate(changes):
            with self.subTest(change=change):
                self.bundle = Path(self.temporary.name) / ("drift-" + str(index))
                with self.db.transaction() as conn:
                    conn.execute(change)
                try:
                    with self.assertRaisesRegex(ValueError, "backup_schema_mismatch"):
                        self.make_backup()
                    self.assertFalse(self.bundle.exists())
                finally:
                    with self.db.transaction() as conn:
                        conn.execute(reset)

    def test_other_non_table_objects_reject_dedicated_schema_and_empty_target(self):
        self.completed()
        self.make_backup()
        objects = (
            (
                "CREATE DOMAIN public.fixture_extra AS integer CHECK (VALUE>0)",
                "DROP DOMAIN public.fixture_extra",
            ),
            (
                'CREATE COLLATION public.fixture_extra FROM "C"',
                "DROP COLLATION public.fixture_extra",
            ),
            (
                "CREATE OPERATOR public.@@ "
                "(FUNCTION=pg_catalog.int4pl,LEFTARG=integer,RIGHTARG=integer)",
                "DROP OPERATOR public.@@ (integer,integer)",
            ),
        )
        for create, drop in objects:
            with self.subTest(create=create):
                for url, function, code in (
                    (URL, self.make_backup, "backup_schema_mismatch"),
                    (self.target_url, self.restore, "backup_target_not_empty"),
                ):
                    with psycopg.connect(url) as conn:
                        conn.execute(create)
                    try:
                        with self.assertRaisesRegex(ValueError, code):
                            function()
                    finally:
                        with psycopg.connect(url) as conn:
                            conn.execute(drop)

    def test_schema_and_migration_drift_rejected(self):
        self.completed()
        with self.db.transaction() as conn:
            conn.execute("CREATE TABLE unexpected(value text)")
        try:
            with self.assertRaisesRegex(ValueError, "backup_schema_mismatch"):
                self.make_backup()
        finally:
            with self.db.transaction() as conn:
                conn.execute("DROP TABLE unexpected")
        with self.db.transaction() as conn:
            original = conn.execute(
                "SELECT sha256 FROM schema_migrations ORDER BY version LIMIT 1"
            ).fetchone()["sha256"]
            conn.execute(
                "UPDATE schema_migrations SET sha256='changed' WHERE "
                "version='001_control_plane.sql'"
            )
        try:
            with self.assertRaisesRegex(ValueError, "backup_schema_mismatch"):
                self.make_backup()
        finally:
            with self.db.transaction() as conn:
                conn.execute(
                    "UPDATE schema_migrations SET sha256=%s WHERE version='001_control_plane.sql'",
                    (original,),
                )

    def test_manifest_version_migration_major_and_corruption_fail_before_restore(self):
        self.completed()
        self.make_backup()
        manifest = self.bundle / "manifest.json"
        original = json.loads(manifest.read_text())
        for key, value in (("version", "future"), ("migrations", {}), ("postgres_major", 999)):
            manifest.write_text(json.dumps({**original, key: value}))
            with self.assertRaises(ValueError):
                self.restore()
            self.assert_target_empty()
        manifest.write_text(json.dumps(original))
        with (self.bundle / "database.dump").open("ab") as dump:
            dump.write(b"corrupt")
        with self.assertRaisesRegex(ValueError, "backup_corrupt"):
            self.restore()
        self.assert_target_empty()

    def test_native_errors_are_sanitized_and_dump_failure_has_no_manifest(self):
        self.completed()
        real = self.native.run

        def broken(program, arguments, **kwargs):
            if "--version" in arguments:
                return real(program, arguments, **kwargs)
            if program == "pg_dump":
                kwargs["stdout"].write(b"PGDMPpartial")
            raise RuntimeError("postgresql://secret-user:sentinel-password@private-host/db")

        with mock.patch.object(backup, "_run_native", side_effect=broken):
            with self.assertRaisesRegex(ValueError, "^backup_native_failed$"):
                self.make_backup()
        self.assertFalse((self.bundle / "manifest.json").exists())
        with self.assertRaises(ValueError):
            backup.verify_backup(self.bundle)

    def test_finalization_failure_leaves_no_maintenance_identity(self):
        self.completed()
        self.make_backup()
        with mock.patch.object(backup, "_finalize", side_effect=RuntimeError("private secret")):
            with self.assertRaisesRegex(ValueError, "^backup_restore_failed$"):
                self.restore()
        with psycopg.connect(self.target_url) as conn:
            self.assertEqual(
                conn.execute("SELECT count(*) FROM maintenance_identity").fetchone()[0], 0
            )
            self.assertEqual(conn.execute("SELECT count(*) FROM sessions").fetchone()[0], 0)
        with self.assertRaisesRegex(ValueError, "backup_target_not_empty"):
            self.restore()

    def test_tombstone_and_gc_history_roundtrip_invalidates_original_plan(self):
        run_id = self.completed()
        with self.db.transaction() as conn:
            # Fixture-only clock aging; restore the production trigger before creating a bundle.
            conn.execute("ALTER TABLE result_archives DISABLE TRIGGER result_archive_immutable")
            conn.execute("UPDATE result_archives SET created_at=now()-interval '45 days'")
            conn.execute("ALTER TABLE result_archives ENABLE TRIGGER result_archive_immutable")
            artifact_id = conn.execute(
                "SELECT id FROM result_archives WHERE run_id=%s", (run_id,)
            ).fetchone()["id"]
        plan = archive_retention.preview(self.db)
        self.assertEqual(len(plan["candidates"]), 1)
        archive_retention.apply(self.db, plan, approval_digest=plan["approval_digest"])
        before = self.snapshot(URL)
        self.make_backup()
        self.restore()
        target = Database(self.target_url)
        target.open()
        self.addCleanup(target.close)
        self.assertEqual(self.snapshot(self.target_url), before)
        with self.assertRaises(Problem) as raised:
            read_archive(target, run_id, artifact_id)
        self.assertEqual(
            (raised.exception.status, raised.exception.code), (410, "artifact_expired")
        )
        client = self.restored_client(target, run_id)
        listing = client.get(f"/api/v1/runs/{run_id}/artifacts")
        self.assertEqual(listing.status_code, 200)
        self.assertIsNotNone(listing.json()["items"][0]["pruned_at"])
        expired = client.get(f"/api/v1/runs/{run_id}/artifacts/{artifact_id}")
        self.assertEqual((expired.status_code, expired.json()["error"]), (410, "artifact_expired"))
        with self.assertRaisesRegex(ValueError, "archive_gc_identity_changed"):
            archive_retention.apply(target, plan, approval_digest=plan["approval_digest"])
        with self.assertRaises(psycopg.errors.RaiseException):
            with target.transaction() as conn:
                conn.execute("UPDATE result_archives SET payload='rewritten'::bytea,pruned_at=NULL")

    def test_native_restore_transaction_failure_leaves_target_empty(self):
        self.completed()
        self.make_backup()
        path = self.bundle / "database.dump"
        payload = path.read_bytes()
        path.write_bytes(payload[: len(payload) // 2])
        manifest_path = self.bundle / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest.update(
            dump_bytes=path.stat().st_size,
            dump_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        )
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "backup_native_failed"):
            self.restore()
        self.assert_target_empty()

    def test_snapshot_share_locks_block_writer_until_dump_completed(self):
        self.completed()
        started = threading.Event()
        blocked = threading.Event()
        errors = []
        writer = None
        original = self.native.run

        def write():
            try:
                with psycopg.connect(URL) as conn:
                    conn.execute("SET lock_timeout='150ms'")
                    started.set()
                    try:
                        conn.execute("UPDATE tasks SET title='must remain outside backup'")
                    except psycopg.errors.LockNotAvailable:
                        blocked.set()
            except Exception as exc:
                errors.append(type(exc).__name__)

        def during_dump(program, arguments, **kwargs):
            nonlocal writer
            if program == "pg_dump" and "--version" not in arguments:
                writer = threading.Thread(target=write)
                writer.start()
                self.assertTrue(started.wait(2))
                writer.join(timeout=3)
                self.assertTrue(blocked.is_set())
            return original(program, arguments, **kwargs)

        with mock.patch.object(backup, "_run_native", side_effect=during_dump):
            self.make_backup()
        self.assertEqual(errors, [])
        self.assertFalse(writer.is_alive())
        self.restore()
        self.assertEqual(self.snapshot(self.target_url), self.snapshot(URL))

    def test_native_major_mismatch_refuses_before_dump(self):
        self.completed()
        with mock.patch.object(backup, "_run_native", return_value=b"pg_dump (PostgreSQL) 13.9\n"):
            with self.assertRaisesRegex(ValueError, "backup_postgres_mismatch"):
                self.make_backup()
        self.assertFalse(self.bundle.exists())

    def test_pending_exports_and_requested_reconciliation_block_backup(self):
        run_id = self.completed()
        with self.db.transaction() as conn:
            archive = conn.execute(
                "SELECT id,sha256 FROM result_archives WHERE run_id=%s", (run_id,)
            ).fetchone()
            conn.execute(
                "INSERT INTO github_exports(id,run_id,artifact_id,artifact_sha256,target_repo,"
                "base_branch,base_sha,branch,approval_digest,created_by) "
                "VALUES (%s,%s,%s,%s,'example/repo','main',%s,%s,%s,%s)",
                (
                    uuid4(),
                    run_id,
                    archive["id"],
                    archive["sha256"],
                    "a" * 40,
                    "agent-platform/export-" + "b" * 64,
                    "c" * 64,
                    self.operator,
                ),
            )
        for state, reconcile in (("queued", False), ("exporting", False), ("uncertain", True)):
            with self.db.transaction() as conn:
                conn.execute(
                    "UPDATE github_exports SET state=%s,reconcile_requested=%s", (state, reconcile)
                )
            with self.assertRaisesRegex(ValueError, "backup_source_active"):
                self.make_backup()
        self.assertFalse(self.bundle.exists())

    def test_mismatched_or_real_unconfirmed_binding_refused(self):
        self.completed()
        changes = (
            (
                "UPDATE sandbox_bindings SET generation=generation+1",
                "UPDATE sandbox_bindings SET generation=generation-1",
            ),
            (
                "UPDATE sandbox_bindings SET node_id='cocoon-local'",
                "UPDATE sandbox_bindings SET node_id='fake-local'",
            ),
            (
                "UPDATE sandbox_bindings SET desired_state='running'",
                "UPDATE sandbox_bindings SET desired_state='stopped'",
            ),
            (
                "UPDATE sandbox_bindings SET provider_handle='pending:other'",
                "UPDATE sandbox_bindings SET provider_handle='pending:' || run_id::text",
            ),
        )
        for statement, reset in changes:
            with self.db.transaction() as conn:
                conn.execute(statement)
            try:
                with self.assertRaisesRegex(ValueError, "backup_source_active"):
                    self.make_backup()
            finally:
                with self.db.transaction() as conn:
                    conn.execute(reset)

    def assert_target_empty(self):
        with psycopg.connect(self.target_url) as conn:
            self.assertEqual(
                conn.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'").fetchone()[
                    0
                ],
                0,
            )


class NativeRunnerTests(unittest.TestCase):
    def test_connection_secrets_are_environment_only_and_ambient_pg_ignored(self):
        connection = "postgresql://fixture_user:sentinel_password@127.0.0.1:5432/fixture_db"
        with mock.patch.dict(os.environ, {"PGOPTIONS": "unsafe", "PGSERVICE": "ambient"}):
            with mock.patch.object(backup.subprocess, "run") as invoked:
                backup._run_native("pg_dump", ["--version"], connection=connection)
        args, kwargs = invoked.call_args
        self.assertEqual(args[0], ["pg_dump", "--version"])
        self.assertNotIn("sentinel_password", repr(args))
        self.assertEqual(kwargs["env"]["PGPASSWORD"], "sentinel_password")
        self.assertEqual(kwargs["env"]["PGPASSFILE"], os.devnull)
        self.assertNotIn("PGSERVICE", kwargs["env"])
        self.assertNotEqual(kwargs["env"]["PGOPTIONS"], "unsafe")
        self.assertEqual(kwargs["timeout"], 300)
        self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)
        self.assertTrue(kwargs["check"])

    def test_native_timeout_and_invalid_connection_are_sanitized(self):
        with mock.patch.object(
            backup.subprocess, "run", side_effect=subprocess.TimeoutExpired("secret", 300)
        ):
            with self.assertRaisesRegex(ValueError, "^backup_native_failed$"):
                backup._run_native("pg_dump", [], connection="postgresql://example/db")
        with self.assertRaisesRegex(ValueError, "^backup_connection_invalid$"):
            backup._run_native("pg_dump", [], connection="dbname=example service=private")
