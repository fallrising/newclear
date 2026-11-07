"""Native dump/restore after manual cleanup; private authority stays separate."""

import hashlib
import json
from unittest import mock
from uuid import uuid4

import psycopg
from backup_fixture import NativeClient
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from test_control_plane import URL
from test_stale_cleanup import StaleCleanupFixture

from agent_platform import backup, stale_cleanup
from agent_platform.db import Database
from agent_platform.domain import Problem
from agent_platform.store import Store


class StaleNativeTests(StaleCleanupFixture):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.native = NativeClient(URL)
        cls.addClassCleanup(cls.native.close)

    def setUp(self):
        super().setUp()
        self.bundle = self.root / "backup"
        self.target_name = "ap_stale_restore_" + uuid4().hex[:12]
        config = conninfo_to_dict(URL)
        config["dbname"] = self.target_name
        self.target_url = make_conninfo(**config)
        with psycopg.connect(URL, autocommit=True) as conn:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(self.target_name)))
        self.addCleanup(self.drop_target)
        self.enterContext(mock.patch.object(backup, "_run_native", side_effect=self.native.run))

    def drop_target(self):
        with psycopg.connect(URL, autocommit=True) as conn:
            conn.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(self.target_name))
            )

    def test_native_roundtrip_keeps_private_attempt_and_invalidates_old_approval(self):
        run_id = self.stalled()
        with self.db.transaction() as conn:
            conn.execute("UPDATE runtime_capacity SET draining=true")
        with self.assertRaisesRegex(ValueError, "backup_source_active"):
            backup.create_backup(URL, self.bundle, offline=True)
        plan = self.preview_cleanup(run_id)
        self.apply_cleanup(plan)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertEqual(self.scalar("SELECT status FROM jobs"), "interrupted")
        with self.assertRaisesRegex(ValueError, "backup_source_active"):
            backup.create_backup(URL, self.bundle, offline=True)
        self.reconcile_cleanup(run_id)
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertEqual(self.scalar("SELECT cleanup_state FROM runs"), "confirmed")
        row = self.server.service.journal.read(run_id)
        self.assertEqual(row["operations"]["release"]["state"], "started")
        self.assertTrue(row["stale_cleanup"]["tombstone"])
        self.assertTrue(row["stale_cleanup"]["attempts"])
        private_hash = hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()
        before = {}
        tables = (
            "runs",
            "jobs",
            "sandbox_bindings",
            "resource_reservations",
            "result_archives",
            "audit_events",
            "commands",
            "run_events",
            "run_event_identities",
            "adapter_operations",
        )
        with self.db.transaction() as conn:
            for table in tables:
                rows = conn.execute(
                    sql.SQL("SELECT to_jsonb(t) AS value FROM {} t").format(sql.Identifier(table))
                ).fetchall()
                before[table] = sorted(json.dumps(r["value"], sort_keys=True) for r in rows)
            old_identity = conn.execute("SELECT id FROM maintenance_identity").fetchone()["id"]
        backup.create_backup(URL, self.bundle, offline=True)
        backup.restore_backup(
            self.target_url, self.bundle, offline=True, confirm_database=self.target_name
        )
        restored = Database(self.target_url)
        restored.open()
        self.addCleanup(restored.close)
        with restored.transaction() as conn:
            for table in tables:
                rows = conn.execute(
                    sql.SQL("SELECT to_jsonb(t) AS value FROM {} t").format(sql.Identifier(table))
                ).fetchall()
                self.assertEqual(
                    before[table],
                    sorted(json.dumps(r["value"], sort_keys=True) for r in rows),
                    table,
                )
            self.assertNotEqual(
                old_identity, conn.execute("SELECT id FROM maintenance_identity").fetchone()["id"]
            )
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) AS n FROM runtime_capacity WHERE NOT draining"
                ).fetchone()["n"],
                0,
            )
        calls = dict(self.node.calls)
        with self.assertRaisesRegex(Problem, "stale_cleanup_identity_changed"):
            stale_cleanup.apply(
                restored, self.connector, plan, approval_digest=plan["approval_digest"]
            )
        self.assertEqual(self.node.calls, calls)
        self.assertEqual(
            hashlib.sha256(
                json.dumps(self.server.service.journal.read(run_id), sort_keys=True).encode()
            ).hexdigest(),
            private_hash,
        )
