"""COMP01/02: one DB across real recovery, synthetic HTTP export and native restore.

VM/model/GitHub are synthetic. Workers, connector HTTP, authenticated API,
private journals, PostgreSQL and native dump/restore are production boundaries.
No browser, live provider or whole-M4 acceptance is implied.
"""

import hashlib
import json
import tempfile
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from unittest import mock
from uuid import uuid4

import psycopg
from backup_fixture import NativeClient
from fastapi.testclient import TestClient
from github_export_fixture import FakeGitHub
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from recovery_fixture import FixtureConnector, Server
from test_control_plane import URL, PlatformFixture
from test_github_export import DIFF, TARGETS
from test_stale_cleanup import PreEffectNode, StaleCleanupFixture

from agent_platform import backup, stale_cleanup
from agent_platform.api import create_app
from agent_platform.db import Database
from agent_platform.domain import Problem
from agent_platform.export_worker import ExportWorker
from agent_platform.github_client import GitHubClient
from agent_platform.result_archive import read_archive
from agent_platform.store import Store
from agent_platform.worker import Worker


class PatchConnector(FixtureConnector):
    def result(self, row):
        # Emit supported bytes BEFORE the real worker's immutable persistence.
        result = super().result(row)
        result.update(
            diff=DIFF,
            diff_bytes=len(DIFF.encode()),
            diff_sha256=hashlib.sha256(DIFF.encode()).hexdigest(),
        )
        return result


def private_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


class CompositeTests(StaleCleanupFixture):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.native = NativeClient(URL)
        cls.addClassCleanup(cls.native.close)

    def setUp(self):
        # Exactly one reset/login: compose helpers, never another test's setUp.
        PlatformFixture.setUp(self)
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.remote = self.enterContext(FakeGitHub())
        self.payload["base_sha"] = self.remote.base_sha
        self.node = PreEffectNode(self.root)
        self.server = Server(
            self.root,
            self.project["canonical_repo"],
            self.payload["base_sha"],
            self.node,
            connector_type=PatchConnector,
        )
        self.addCleanup(self.server.close)
        self.connector = self.server.client
        self.connector.register(self.db)
        profile = self.post("/agent-profiles", {"name": "Composite", "backend": "openhands"})
        self.assertEqual(profile.status_code, 201, profile.text)
        self.payload["profile_revision"] = profile.json()["id"]
        self.settings = replace(self.settings, export_targets=TARGETS)
        client = TestClient(create_app(self.settings, self.db), base_url=self.settings.origin)
        self.addCleanup(client.close)
        client.cookies.update(self.client.cookies)
        self.client = client
        self.github = GitHubClient(self.remote.token, opener=self.remote.opener)
        self.exporter = ExportWorker(self.db, TARGETS, self.github)

    def durable_rows(self, db):
        # Only the documented ephemeral auth/token tables and fresh maintenance
        # identity are excluded. Quiescent leases/jobs and all retention metadata
        # are compared exactly, including empty tables; no lifecycle exclusions.
        with db.transaction() as conn:
            return {
                table: sorted(
                    json.dumps(row["value"], sort_keys=True)
                    for row in conn.execute(
                        sql.SQL("SELECT to_jsonb(t) AS value FROM {} t").format(
                            sql.Identifier(table)
                        )
                    ).fetchall()
                )
                for table in backup._schema_contract()[0]
                if table not in backup.EXCLUDED
            }

    def operation(self, path):
        response = self.client.get("/api/v1" + path)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["items"]), 1)
        return response.json()["items"][0]

    def mutations(self):
        return [r for r in self.remote.requests if r["method"] != "GET"]

    def make_target(self):
        name = "ap_composite_restore_" + uuid4().hex[:12]
        config = conninfo_to_dict(URL)
        config["dbname"] = name
        with psycopg.connect(URL, autocommit=True) as conn:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))

        def drop():
            with psycopg.connect(URL, autocommit=True) as conn:
                conn.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))

        self.addCleanup(drop)
        return name, make_conninfo(**config)

    def test_stale_recovery_export_disconnect_and_native_restore(self):
        run_id = self.stalled()
        original_operations = self.row(run_id)["operations"]
        result = self.scalar("SELECT result FROM runs WHERE id=%s", (run_id,))
        self.assertEqual(result["diff"], DIFF)
        self.assertEqual(result["base_sha"], self.remote.base_sha)
        self.assertEqual(result["diff_sha256"], hashlib.sha256(DIFF.encode()).hexdigest())
        self.assertEqual(result["verification"]["status"], "passed")
        with self.db.transaction() as conn:
            artifact = conn.execute(
                "SELECT id,sha256 FROM result_archives WHERE run_id=%s", (run_id,)
            ).fetchone()
        archived = read_archive(self.db, run_id, artifact["id"])
        self.assertEqual(hashlib.sha256(archived).hexdigest(), artifact["sha256"])
        self.assertEqual(json.loads(archived)["result"]["diff"], DIFF)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)

        # Only lease/fence clocks are synthetic; real persisted lifecycle remains.
        plan = self.preview_cleanup(run_id)
        receipt = self.apply_cleanup(plan)
        self.assertEqual(receipt["status"], "stop_observed; reconciliation_pending")
        self.assertEqual(self.node.calls["release"], 1)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertEqual(self.scalar("SELECT status FROM jobs"), "interrupted")
        self.assertEqual(self.apply_cleanup(plan), receipt)
        self.reconcile_cleanup(run_id)
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertEqual(self.apply_cleanup(plan), receipt)
        self.assertEqual(self.node.calls["release"], 1)
        private = self.row(run_id)
        self.assertEqual(private["operations"], original_operations)
        self.assertEqual(private["operations"]["release"]["state"], "started")
        self.assertTrue(private["stale_cleanup"]["tombstone"])
        self.assertEqual(len(private["stale_cleanup"]["attempts"]), 1)
        self.assertEqual(self.scalar("SELECT result FROM runs WHERE id=%s", (run_id,)), result)
        self.assertEqual(read_archive(self.db, run_id, artifact["id"]), archived)

        path = f"/runs/{run_id}/exports"
        response = self.post(
            path + "/preview",
            {
                "artifact_id": str(artifact["id"]),
                "artifact_sha256": artifact["sha256"],
                "target_repo": "example/repo",
                "base_branch": "main",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertEqual(preview["verification_status"], "passed")
        approval = {
            key: value
            for key, value in preview.items()
            if key not in {"run_id", "verification_status", "files", "diff"}
        } | {"approved": True}
        response = self.post(path, approval)
        self.assertEqual(response.status_code, 202, response.text)
        self.remote.fail_next("POST", "/repos/example/repo/pulls", after=True, disconnect=True)
        self.assertTrue(self.exporter.run_once())
        self.assertEqual(self.operation(path)["state"], "uncertain")
        self.assertEqual(len(self.remote.pulls), 1)
        self.assertEqual(set(self.remote.refs), {"main", preview["branch"]})
        mutations = self.mutations()
        self.assertEqual(
            [r["path"] for r in mutations],
            [
                "/repos/example/repo/" + suffix
                for suffix in ("git/trees", "git/commits", "git/refs", "pulls")
            ],
        )
        self.assertIn("Verification: passed.", self.remote.pulls[0]["body"])
        self.assertFalse(self.exporter.run_once())
        op = self.operation(path)
        response = self.post(path + f"/{op['id']}/reconcile", {})
        self.assertEqual(response.status_code, 202, response.text)
        before_requests = len(self.remote.requests)
        self.assertTrue(self.exporter.run_once())
        self.assertTrue(self.remote.requests[before_requests:])
        self.assertTrue(all(r["method"] == "GET" for r in self.remote.requests[before_requests:]))
        op = self.operation(path)
        self.assertEqual(op["state"], "succeeded")
        self.assertEqual(op["artifact_sha256"], artifact["sha256"])
        self.assertEqual(op["pr_url"], "https://github.com/example/repo/pull/1")
        self.assertEqual(self.mutations(), mutations)

        with self.db.transaction() as conn:
            conn.execute("UPDATE runtime_capacity SET draining=true")
            old_identity = conn.execute("SELECT id FROM maintenance_identity").fetchone()["id"]
            self.assertLess(
                conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"],
                datetime.fromisoformat(plan["expires_at"]),
            )
        self.assertFalse(Worker(self.db, self.connector).run_once())
        self.assertFalse(self.exporter.run_once())
        before = self.durable_rows(self.db)
        journal_hash = private_digest(self.row(run_id))
        fences = self.server.service.fences.journal
        fence_hash = private_digest(fences.read(run_id))
        calls = dict(self.node.calls)
        name, target_url = self.make_target()
        bundle = self.root / "backup"
        with mock.patch.object(backup, "_run_native", side_effect=self.native.run):
            backup.create_backup(URL, bundle, offline=True)
            backup.restore_backup(target_url, bundle, offline=True, confirm_database=name)
        restored = Database(target_url)
        restored.open()
        self.addCleanup(restored.close)
        self.assertEqual(self.durable_rows(restored), before)
        self.assertEqual(read_archive(restored, run_id, artifact["id"]), archived)
        with restored.transaction() as conn:
            self.assertNotEqual(
                conn.execute("SELECT id FROM maintenance_identity").fetchone()["id"], old_identity
            )
            self.assertLess(
                conn.execute("SELECT clock_timestamp() AS now").fetchone()["now"],
                datetime.fromisoformat(plan["expires_at"]),
            )
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) AS n FROM runtime_capacity WHERE NOT draining"
                ).fetchone()["n"],
                0,
            )
            for table in backup.EPHEMERAL:
                self.assertEqual(
                    conn.execute(
                        sql.SQL("SELECT count(*) AS n FROM {}").format(sql.Identifier(table))
                    ).fetchone()["n"],
                    0,
                )
        with self.assertRaisesRegex(Problem, "stale_cleanup_identity_changed"):
            stale_cleanup.apply(
                restored, self.connector, plan, approval_digest=plan["approval_digest"]
            )
        self.assertEqual(self.node.calls, calls)
        self.assertFalse(Worker(restored, self.connector).run_once())
        restored_exporter = ExportWorker(restored, TARGETS, self.github)
        before_requests = len(self.remote.requests)
        self.assertFalse(restored_exporter.run_once())
        self.assertEqual(len(self.remote.requests), before_requests)
        self.assertEqual(self.durable_rows(restored), before)
        self.assertEqual(self.mutations(), mutations)
        self.assertEqual(len(self.remote.pulls), 1)
        self.assertEqual(set(self.remote.refs), {"main", preview["branch"]})
        self.assertEqual(self.node.calls, calls)
        self.assertEqual(private_digest(self.row(run_id)), journal_hash)
        self.assertEqual(private_digest(fences.read(run_id)), fence_hash)
