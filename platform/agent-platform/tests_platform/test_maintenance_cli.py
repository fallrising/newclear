"""Operator maintenance CLI acknowledgement, private-plan and dispatch boundaries."""

import io
import json
import logging
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from psycopg import OperationalError
from psycopg_pool import ConnectionPool
from test_control_plane import PlatformFixture

from agent_platform.cli import main
from agent_platform.worker import Worker


class MaintenanceCliTests(unittest.TestCase):
    def call(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with (
            patch.object(sys, "argv", ["agent-platform", *args]),
            patch("sys.stdout", out),
            patch("sys.stderr", err),
        ):
            result = main()
        return result, out.getvalue(), err.getvalue()

    def check_private_database_failure(self, url, connection_error=None):
        logs = io.StringIO()
        logger = logging.getLogger("psycopg.pool")
        handler = logging.StreamHandler(logs)
        previous_filters = list(logger.filters)
        wait = ConnectionPool.wait
        with (
            patch.dict(os.environ, {"DATABASE_URL": url}),
            patch.object(logger, "handlers", [handler]),
            patch.object(logger, "propagate", False),
            patch.object(ConnectionPool, "wait", lambda pool, **_: wait(pool, timeout=0.1)),
        ):
            if connection_error is None:
                response = self.call("archive-gc-preview")
            else:
                with patch("psycopg.Connection.connect", side_effect=connection_error):
                    response = self.call("archive-gc-preview")
        self.assertEqual(response, (1, "", "maintenance_database_unavailable\n"))
        self.assertEqual(logs.getvalue(), "")
        self.assertEqual(logger.filters, previous_filters)

    def test_malformed_database_url_never_exposes_password_in_pool_logs(self):
        self.check_private_database_failure(
            "postgresql://review:synthetic-private-sentinel%ZZ@127.0.0.1/review"
        )

    def test_background_connection_error_is_bounded_and_restores_logging(self):
        self.check_private_database_failure(
            "postgresql://review:synthetic-private-sentinel@127.0.0.1/review",
            OperationalError("synthetic upstream error contains synthetic-private-sentinel"),
        )

    def test_backup_verify_does_not_require_database_configuration(self):
        backup = SimpleNamespace(verify_backup=MagicMock(return_value={"verified": True}))
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.dict(sys.modules, {"agent_platform.backup": backup}),
        ):
            code, out, err = self.call("backup-verify", "--directory", "/private/backup")
        self.assertEqual((code, json.loads(out), err), (0, {"verified": True}, ""))
        backup.verify_backup.assert_called_once_with(Path("/private/backup"))

    def test_backup_without_offline_acknowledgement_does_not_dispatch(self):
        backup = SimpleNamespace(create_backup=MagicMock())
        with patch.dict(sys.modules, {"agent_platform.backup": backup}):
            with self.assertRaises(SystemExit) as caught:
                self.call("backup-create", "--directory", "/private/new")
        self.assertEqual(caught.exception.code, 2)
        backup.create_backup.assert_not_called()

    def test_restore_requires_exact_named_target_acknowledgement(self):
        backup = SimpleNamespace(restore_backup=MagicMock())
        with patch.dict(sys.modules, {"agent_platform.backup": backup}):
            with self.assertRaises(SystemExit) as caught:
                self.call("backup-restore", "--directory", "/private/backup", "--offline")
        self.assertEqual(caught.exception.code, 2)
        backup.restore_backup.assert_not_called()

    def test_explicit_restore_dispatches_only_selected_target(self):
        backup = SimpleNamespace(restore_backup=MagicMock(return_value={"restored": True}))
        with (
            patch.dict(os.environ, {"DATABASE_URL": "postgresql://test/empty_target"}),
            patch.dict(sys.modules, {"agent_platform.backup": backup}),
        ):
            code, out, err = self.call(
                "backup-restore",
                "--directory",
                "/private/backup",
                "--offline",
                "--confirm-database",
                "empty_target",
            )
        self.assertEqual((code, json.loads(out), err), (0, {"restored": True}, ""))
        backup.restore_backup.assert_called_once_with(
            "postgresql://test/empty_target",
            Path("/private/backup"),
            offline=True,
            confirm_database="empty_target",
        )

    def test_apply_rejects_duplicate_keys_and_nonfinite_values_before_database_open(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "plan.json"
            for body in ('{"limit":1,"limit":2}', '{"limit":NaN}', "[1]", "x" * 65537):
                path.write_text(body)
                path.chmod(0o600)
                with patch("agent_platform.cli.Database") as database:
                    code, out, err = self.call(
                        "archive-gc-apply", "--plan", str(path), "--approve", "a" * 64
                    )
                self.assertEqual(code, 1)
                self.assertEqual(out, "")
                self.assertEqual(err, "archive_gc_plan_invalid\n")
                database.assert_not_called()

    def test_apply_requires_private_plan_and_preserves_original_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "plan.json"
            body = '{"approval_digest":"' + "a" * 64 + '"}'
            path.write_text(body)
            path.chmod(0o644)
            with patch("agent_platform.cli.Database") as database:
                code, out, err = self.call(
                    "archive-gc-apply", "--plan", str(path), "--approve", "a" * 64
                )
            self.assertEqual((code, out, err), (1, "", "archive_gc_plan_invalid\n"))
            self.assertEqual(path.read_text(), body)
            database.assert_not_called()

    def test_gc_cannot_apply_without_explicit_digest(self):
        with patch("agent_platform.cli.Database") as database:
            with self.assertRaises(SystemExit) as caught:
                self.call("archive-gc-apply", "--plan", "/private/plan")
        self.assertEqual(caught.exception.code, 2)
        database.assert_not_called()


class MaintenanceCliPostgresTests(PlatformFixture):
    call = MaintenanceCliTests.call

    def test_reviewed_private_plan_prunes_real_worker_archive_through_cli(self):
        created = self.create()
        run_id = created["run"]["id"]
        with self.db.transaction() as conn:
            conn.execute(
                "ALTER TABLE result_archives ALTER COLUMN created_at "
                "SET DEFAULT (now()-interval '31 days')"
            )
        try:
            with patch.dict(os.environ, {"MODEL_PROXY_CONFIG": ""}):
                Worker(self.db).run_once()
        finally:
            with self.db.transaction() as conn:
                conn.execute(
                    "ALTER TABLE result_archives ALTER COLUMN created_at SET DEFAULT now()"
                )
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(os.environ, {"DATABASE_URL": self.settings.database_url}),
        ):
            code, text, errors = self.call("archive-gc-preview", "--limit", "1")
            self.assertEqual((code, errors), (0, ""))
            plan = json.loads(text)
            self.assertEqual([item["run_id"] for item in plan["candidates"]], [run_id])
            path = Path(directory) / "plan.json"
            path.write_text(text)
            path.chmod(0o600)
            code, output, errors = self.call(
                "archive-gc-apply", "--plan", str(path), "--approve", plan["approval_digest"]
            )
            self.assertEqual((code, errors), (0, ""))
            self.assertEqual(json.loads(output)["count"], 1)
            again = self.call(
                "archive-gc-apply", "--plan", str(path), "--approve", plan["approval_digest"]
            )
            self.assertEqual(again, (code, output, errors))
        artifact_id = plan["candidates"][0]["id"]
        response = self.client.get(f"/api/v1/runs/{run_id}/artifacts/{artifact_id}")
        self.assertEqual(response.status_code, 410)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM audit_events WHERE action='archive_gc.apply'"), 1
        )
        self.assertEqual(self.scalar("SELECT state FROM runs WHERE id=%s", (run_id,)), "succeeded")
