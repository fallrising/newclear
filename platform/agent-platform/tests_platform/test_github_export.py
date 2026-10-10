"""Explicit immutable-artifact export approval against real PostgreSQL and API."""

import concurrent.futures
import hashlib
import json
import os
import unittest
from dataclasses import replace
from unittest.mock import patch
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb
from test_control_plane import PlatformFixture

from agent_platform.api import create_app
from agent_platform.config import Settings
from agent_platform.db import Database
from agent_platform.result_archive import persist_archive
from agent_platform.worker import Worker

DIFF = (
    "diff --git a/note.txt b/note.txt\nnew file mode 100644\n"
    "--- /dev/null\n+++ b/note.txt\n@@ -0,0 +1 @@\n+hello\n"
)
TARGETS = ({"repo": "example/repo", "base_branch": "main"},)


class ExportFixture(PlatformFixture):
    def setUp(self):
        super().setUp()
        self.settings = replace(self.settings, export_targets=TARGETS)
        client = TestClient(create_app(self.settings, self.db), base_url=self.settings.origin)
        self.addCleanup(client.close)
        client.cookies.update(self.client.cookies)
        self.client = client
        self.run_id = self.create()["run"]["id"]
        self.path = f"/runs/{self.run_id}/exports"
        self.artifact = self.archive()
        self.preview_input = {
            "artifact_id": str(self.artifact["id"]),
            "artifact_sha256": self.artifact["sha256"],
            "target_repo": "example/repo",
            "base_branch": "main",
        }

    def archive(self, verification="unknown", diff=DIFF):
        with self.db.transaction() as conn:
            run = conn.execute("SELECT * FROM runs WHERE id=%s", (self.run_id,)).fetchone()
            value = {
                "execution_mode": "local-mock",
                "diff": diff,
                "diff_bytes": len(diff.encode()),
                "diff_sha256": hashlib.sha256(diff.encode()).hexdigest(),
                "base_sha": run["base_sha"],
                "verification": {"status": verification},
            }
            return persist_archive(conn, run, value)

    def preview(self, **changes):
        response = self.post(self.path + "/preview", {**self.preview_input, **changes})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def approval(self):
        value = self.preview()
        return {
            key: val
            for key, val in value.items()
            if key not in {"run_id", "verification_status", "files", "diff"}
        } | {"approved": True}

    def approve(self):
        response = self.post(self.path, self.approval())
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()


class ExportApprovalTests(ExportFixture):
    def test_preview_does_not_enqueue_and_preserves_unverified_status(self):
        result = self.preview()
        self.assertEqual(result["files"], ["note.txt"])
        self.assertEqual(result["verification_status"], "unknown")
        self.assertEqual(result["base_sha"], self.payload["base_sha"])
        self.assertTrue(result["branch"].startswith("agent-platform/export-"))
        self.assertEqual(result, self.preview())
        self.assertEqual(self.scalar("SELECT count(*) FROM github_exports"), 0)
        self.assertEqual(self.client.get("/api/v1/export-targets").json(), {"items": list(TARGETS)})

    def test_authentication_csrf_and_explicit_approval_required(self):
        approval = self.approval()
        outsider = TestClient(create_app(self.settings, self.db), base_url=self.settings.origin)
        self.addCleanup(outsider.close)
        for path in ("/api/v1/export-targets", "/api/v1" + self.path):
            self.assertEqual(outsider.get(path).status_code, 401)
        for suffix, body in (("/preview", self.preview_input), ("", approval)):
            path = "/api/v1" + self.path + suffix
            self.assertEqual(outsider.post(path, json=body).status_code, 401)
            self.assertEqual(self.client.post(path, json=body).status_code, 403)
        for value in (False, None, "true", 1):
            response = self.post(self.path, {**approval, "approved": value})
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.scalar("SELECT count(*) FROM github_exports"), 0)

    def test_default_disabled_and_worker_never_auto_exports(self):
        disabled = TestClient(
            create_app(replace(self.settings, export_targets=()), self.db),
            base_url=self.settings.origin,
        )
        self.addCleanup(disabled.close)
        disabled.cookies.update(self.client.cookies)
        self.assertEqual(disabled.get("/api/v1/export-targets").json(), {"items": []})
        response = self.post(self.path + "/preview", self.preview_input, client=disabled)
        self.assertEqual(response.status_code, 409)
        # Separate unarchived run can complete normally without approval or export work.
        self.create()
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM jobs WHERE run_id=%s", (self.run_id,))
            conn.execute("UPDATE runs SET state='succeeded' WHERE id=%s", (self.run_id,))
        Worker(self.db).run_once()
        self.assertEqual(self.scalar("SELECT count(*) FROM github_exports"), 0)

    def test_altered_approval_fields_rejected_before_enqueue(self):
        approval = self.approval()
        for key, value in {
            "artifact_id": str(uuid4()),
            "artifact_sha256": "a" * 64,
            "target_repo": "other/repo",
            "base_branch": "other",
            "base_sha": "a" * 40,
            "branch": "agent-platform/export-forged",
            "approval_digest": "a" * 64,
        }.items():
            response = self.post(self.path, {**approval, key: value})
            self.assertIn(response.status_code, (404, 409), (key, response.text))
        self.assertEqual(self.scalar("SELECT count(*) FROM github_exports"), 0)

    def test_duplicate_commands_and_fresh_keys_have_one_operation(self):
        approval = self.approval()
        first = self.post(self.path, approval, "same")
        self.assertEqual(first.status_code, 202, first.text)
        self.assertEqual(first.json(), self.post(self.path, approval, "same").json())
        self.assertEqual(first.json()["id"], self.post(self.path, approval, "new").json()["id"])
        self.assertEqual(self.scalar("SELECT count(*) FROM github_exports"), 1)
        self.assertEqual(first.json()["state"], "queued")
        self.assertIsNone(first.json()["pr_url"])
        changed = self.post(self.path, {**approval, "approval_digest": "a" * 64}, "same")
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(changed.json()["error"], "idempotency_conflict")
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action LIKE '%%exports.create'"), 2
        )

    def test_approval_uses_one_database_connection_without_nested_borrow(self):
        approval = self.approval()
        db = Database(self.settings.database_url)
        db.pool.resize(1, 1)
        db.open()
        self.addCleanup(db.close)
        client = TestClient(create_app(self.settings, db), base_url=self.settings.origin)
        self.addCleanup(client.close)
        client.cookies.update(self.client.cookies)
        response = self.post(self.path, approval, client=client)
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual(self.scalar("SELECT count(*) FROM github_exports"), 1)

    def test_parallel_approvals_have_one_tuple(self):
        approval = self.approval()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            responses = list(pool.map(lambda _: self.post(self.path, approval), range(6)))
        self.assertEqual({r.status_code for r in responses}, {202})
        self.assertEqual(len({r.json()["id"] for r in responses}), 1)
        self.assertEqual(self.scalar("SELECT count(*) FROM github_exports"), 1)

    def test_missing_command_key_extra_fields_and_cross_run_rejected(self):
        approval = self.approval()
        response = self.client.post("/api/v1" + self.path, json=approval, headers=self.headers)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            self.post(self.path, {**approval, "credential": "secret"}).status_code, 422
        )
        other_run = self.create()["run"]["id"]
        self.assertEqual(self.post(f"/runs/{other_run}/exports", approval).status_code, 404)
        self.assertEqual(self.scalar("SELECT count(*) FROM github_exports"), 0)

    def test_historical_archive_not_mutable_result_controls_approval(self):
        first = self.preview()
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE runs SET result=%s,state='failed' WHERE id=%s",
                (
                    Jsonb({"diff": "attacker", "verification": {"status": "passed"}}),
                    self.run_id,
                ),
            )
        self.assertEqual(first, self.preview())
        operation = self.approve()
        self.assertEqual(operation["run_id"], self.run_id)
        self.assertEqual(self.client.get("/api/v1" + self.path).json()["items"], [operation])

    def test_corrupted_archive_rejected_without_command(self):
        with self.db.transaction() as conn:
            conn.execute("ALTER TABLE result_archives DISABLE TRIGGER result_archive_immutable")
            conn.execute("UPDATE result_archives SET sha256=%s", ("f" * 64,))
            conn.execute("ALTER TABLE result_archives ENABLE TRIGGER result_archive_immutable")
        self.assertEqual(self.post(self.path + "/preview", self.preview_input).status_code, 409)
        self.assertEqual(self.scalar("SELECT count(*) FROM github_exports"), 0)

    def test_approval_identity_is_database_immutable(self):
        self.approve()
        with self.assertRaises(psycopg.Error), self.db.transaction() as conn:
            conn.execute("UPDATE github_exports SET base_sha=%s", ("a" * 40,))
        with self.assertRaises(psycopg.Error), self.db.transaction() as conn:
            conn.execute("UPDATE github_exports SET state='made_up'")

    def test_reconcile_only_existing_uncertain_operation_and_audit(self):
        operation = self.approve()
        path = self.path + f"/{operation['id']}/reconcile"
        self.assertEqual(self.post(path, {}).status_code, 409)
        with self.db.transaction() as conn:
            conn.execute("UPDATE github_exports SET state='uncertain',reason='github_unavailable'")
        response = self.post(path, {}, "reconcile")
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual(response.json(), self.post(path, {}, "reconcile").json())
        self.assertEqual(self.scalar("SELECT reconcile_requested FROM github_exports"), True)
        other = self.create()["run"]["id"]
        self.assertEqual(
            self.post(f"/runs/{other}/exports/{operation['id']}/reconcile", {}).status_code, 404
        )
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action LIKE '%%/reconcile'"), 1
        )


class ExportSettingsTests(unittest.TestCase):
    def test_explicit_public_targets_and_strict_validation(self):
        self.assertEqual(Settings("unused").export_targets, ())
        with patch.dict(
            os.environ, {"DATABASE_URL": "unused", "APP_EXPORT_TARGETS": json.dumps(TARGETS)}
        ):
            self.assertEqual(Settings.from_env().export_targets, TARGETS)
        for targets in (
            {},
            ["example/repo"],
            [{"repo": "../repo", "base_branch": "main"}],
            [{"repo": "example/repo", "base_branch": "../evil"}],
            [{"repo": "example/repo", "base_branch": "main#fragment"}],
            [{"repo": "example/repo", "base_branch": "main%25"}],
            [{"repo": "example/repo", "base_branch": "main", "token": "secret"}],
            [*TARGETS, *TARGETS],
        ):
            with self.subTest(targets=targets), self.assertRaises(ValueError):
                Settings("unused", export_targets=targets)
