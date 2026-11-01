"""Immutable result persistence and authenticated downloads using real PostgreSQL."""

import hashlib
import json
import os
from contextlib import contextmanager
from unittest.mock import Mock, patch
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb
from test_control_plane import PlatformFixture
from worker_tools_fixture import Runtime

from agent_platform.api import create_app
from agent_platform.domain import Problem
from agent_platform.worker import Worker


class ResultArchiveTests(PlatformFixture):
    def setUp(self):
        super().setUp()
        self.enterContext(patch.dict(os.environ, {"MODEL_PROXY_CONFIG": ""}))
        self.value = self.create()
        self.run_id = self.value["run"]["id"]
        self.path = f"/api/v1/runs/{self.run_id}/artifacts"

    def result(self, diff="+hello🐈\r\n", **changes):
        raw = diff.encode()
        return {
            "execution_mode": "cocoon-fixture",
            "summary": "Preserve bytes, not markup <script>alert(1)</script>",
            "diff": diff,
            "diff_bytes": len(raw),
            "diff_sha256": hashlib.sha256(raw).hexdigest(),
            "base_sha": self.payload["base_sha"],
            "verification": {"status": "unknown", "reason": "verification_not_configured"},
            **changes,
        }

    def persist(self, result=None):
        from agent_platform.result_archive import persist_archive

        with self.db.transaction() as conn:
            run = conn.execute("SELECT * FROM runs WHERE id=%s", (self.run_id,)).fetchone()
            return persist_archive(conn, run, self.result() if result is None else result)

    def download(self):
        listing = self.client.get(self.path)
        self.assertEqual(listing.status_code, 200, listing.text)
        items = listing.json()["items"]
        self.assertEqual(len(items), 1)
        response = self.client.get(f"{self.path}/{items[0]['id']}")
        self.assertEqual(response.status_code, 200, response.text[:300])
        return items[0], response

    def real_worker(self, *, tools=False, model=False):
        # The first fake run is unrelated; leave it terminal so this worker claims real work.
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET state='cancelled' WHERE id=%s", (self.run_id,))
        runtime = Runtime(self.project["canonical_repo"], self.payload["base_sha"])
        runtime.result = self.result()
        runtime.client.register(self.db)
        self.addCleanup(runtime.close)
        profile = self.post(
            "/agent-profiles",
            {"name": "Archive fixture", "backend": "openhands", "mock_tools": tools},
        )
        self.assertEqual(profile.status_code, 201, profile.text)
        self.payload["profile_revision"] = profile.json()["id"]
        self.value = self.create()
        self.run_id = self.value["run"]["id"]
        self.path = f"/api/v1/runs/{self.run_id}/artifacts"
        worker = Worker(self.db, runtime.client)
        if model:
            worker.model_proxy = Mock()
            # HTTPFixture captures its constructor callback, so intercept the client boundary.
            original_operation = runtime.client.operation

            def operation(run, action):
                value = original_operation(run, action)
                if action == "prepare":
                    value["model_transport"] = True
                return value

            runtime.client.operation = operation
            self.enterContext(patch("agent_platform.runtime_worker.ModelSession"))
        if tools:
            runtime.on_events = lambda: {"state": "finished", "caught_up": True, "events": []}
            lifecycle = self.enterContext(patch("agent_platform.tool_worker.ToolLifecycle"))
            lifecycle.return_value.start.side_effect = lambda run: setattr(
                runtime, "enabled", False
            )
        return worker, runtime

    def test_worker_fake_archive_survives_cleanup_and_new_api(self):
        Worker(self.db).run_once()
        self.assertEqual(self.scalar("SELECT cleanup_state FROM runs"), "confirmed")
        item, response = self.download()
        value = response.json()
        self.assertEqual(value["schema_version"], "result-archive-v1")
        self.assertEqual(value["run_id"], self.run_id)
        self.assertEqual(value["result"]["verification"]["status"], "not_run")
        self.assertNotIn("diff", value["result"])
        fresh = TestClient(create_app(self.settings, self.db), base_url=self.settings.origin)
        self.addCleanup(fresh.close)
        fresh.cookies.update(self.client.cookies)
        self.assertEqual(fresh.get(f"{self.path}/{item['id']}").content, response.content)

    def test_local_mock_archives_exact_diff_and_base(self):
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET goal=%s", ("FILE note.txt\nTEXT hello",))
        Worker(self.db).run_once()
        _, response = self.download()
        result = response.json()["result"]
        raw = result["diff"].encode()
        self.assertEqual(result["diff_bytes"], len(raw))
        self.assertEqual(result["diff_sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(result["base_sha"], self.payload["base_sha"])
        self.assertEqual(result["verification"]["status"], "passed")

    def test_exact_attachment_headers_allowlist_and_stable_bytes(self):
        result = self.result(secret="must-not-copy", config={"token": "must-not-copy"})
        result["verification"]["credential"] = "must-not-copy"
        self.persist(result)
        item, response = self.download()
        self.assertEqual(item["kind"], "result")
        self.assertEqual(item["size"], len(response.content))
        self.assertEqual(item["sha256"], hashlib.sha256(response.content).hexdigest())
        self.assertEqual(response.headers["content-type"], "application/json")
        self.assertEqual(
            response.headers["content-disposition"],
            f'attachment; filename="run-{self.run_id}-result.json"',
        )
        self.assertEqual(response.headers["content-security-policy"], "sandbox; default-src 'none'")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn(b"must-not-copy", response.content)
        self.assertEqual(response.json()["result"]["diff"], result["diff"])
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE runs SET result=%s WHERE id=%s",
                (Jsonb({"summary": "changed"}), self.run_id),
            )
        self.assertEqual(self.download()[1].content, response.content)

    def test_idempotent_and_immutable_at_database_boundary(self):
        first = self.persist()
        self.assertEqual(self.persist(dict(reversed(list(self.result().items())))), first)
        with self.assertRaisesRegex(Problem, "artifact_immutable"):
            self.persist(self.result("+changed\n"))
        for sql in ("UPDATE result_archives SET mime='text/html'", "DELETE FROM result_archives"):
            with self.assertRaises(psycopg.Error), self.db.transaction() as conn:
                conn.execute(sql)
        self.assertEqual(self.scalar("SELECT count(*) FROM result_archives"), 1)

    def test_empty_and_maximum_diff_are_valid(self):
        from agent_platform.result_archive import serialize

        with self.db.transaction() as conn:
            run = conn.execute("SELECT * FROM runs WHERE id=%s", (self.run_id,)).fetchone()
        for diff in ("", "🐈" * 65536):
            with self.subTest(length=len(diff)):
                value = json.loads(serialize(run, self.result(diff)))
                self.assertEqual(value["result"]["diff"], diff)
                self.assertEqual(value["result"]["diff_bytes"], len(diff.encode()))

    def test_sessions_run_association_and_missing_objects(self):
        self.assertEqual(self.client.get(self.path).json(), {"items": []})
        self.assertEqual(self.client.get(f"/api/v1/runs/{uuid4()}/artifacts").status_code, 404)
        self.persist()
        item, _ = self.download()
        wrong = self.create()["run"]["id"]
        for path in (f"/api/v1/runs/{wrong}/artifacts/{item['id']}", f"{self.path}/{uuid4()}"):
            self.assertEqual(self.client.get(path).status_code, 404)
        outsider = TestClient(create_app(self.settings, self.db), base_url=self.settings.origin)
        self.addCleanup(outsider.close)
        for path in (self.path, f"{self.path}/{item['id']}"):
            self.assertEqual(outsider.get(path).status_code, 401)
        with self.db.transaction() as conn:
            conn.execute("UPDATE sessions SET expires_at=now()-interval '1 second'")
        for path in (self.path, f"{self.path}/{item['id']}"):
            self.assertEqual(self.client.get(path).status_code, 401)

    def test_legacy_results_are_not_backfilled(self):
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET result=%s,state='succeeded'", (Jsonb(self.result()),))
        self.assertEqual(self.client.get(self.path).json(), {"items": []})
        self.assertEqual(self.scalar("SELECT count(*) FROM result_archives"), 0)

    def test_invalid_bounded_serialization_rolls_back(self):
        values = [
            None,
            [],
            {"verification": []},
            self.result(diff_bytes=True),
            self.result(diff_sha256="f" * 64),
            self.result(base_sha="a" * 40),
            {**self.result(), "diff": "\ud800"},
            self.result(summary="x" * (1024 * 1024)),
            self.result(diff="x" * 262145),
            self.result(verification={"status": "invented"}),
            self.result(verification={"status": "unknown", "checks": [{}] * 9}),
            self.result(verification={"status": "unknown", "exit_code": True}),
            {"verification": {"status": "passed"}, "diff_sha256": "f" * 64},
        ]
        from agent_platform.result_archive import persist_archive

        for result in values:
            with self.subTest(result=str(result)[:100]):
                with self.assertRaises(Problem), self.db.transaction() as conn:
                    run = conn.execute("SELECT * FROM runs WHERE id=%s", (self.run_id,)).fetchone()
                    persist_archive(conn, run, result)
                self.assertEqual(self.scalar("SELECT count(*) FROM result_archives"), 0)

    def test_corrupt_bytes_metadata_and_embedded_identity_rejected(self):
        self.persist()
        item, response = self.download()
        original = response.content
        changed = {**response.json(), "run_id": str(uuid4())}
        other = json.dumps(changed).encode()
        cases = [
            (b"{bad json", "0" * 64, 9),
            (original, "0" * 64, len(original)),
            (original, item["sha256"], len(original) + 1),
            (other, hashlib.sha256(other).hexdigest(), len(other)),
            (b"[" * 2000, hashlib.sha256(b"[" * 2000).hexdigest(), 2000),
        ]
        for payload, sha256, size in cases:
            with self.db.transaction() as conn:
                conn.execute("ALTER TABLE result_archives DISABLE TRIGGER result_archive_immutable")
                conn.execute(
                    "UPDATE result_archives SET payload=%s,sha256=%s,size=%s",
                    (payload, sha256, size),
                )
                conn.execute("ALTER TABLE result_archives ENABLE TRIGGER result_archive_immutable")
            response = self.client.get(f"{self.path}/{item['id']}")
            self.assertEqual(response.status_code, 409, response.text[:200])
            self.assertNotIn("content-disposition", response.headers)

    def test_real_worker_preserves_failed_and_unknown_verification(self):
        for status, reason in (
            ("failed", "verification_failed"),
            ("unknown", "verification_unverified"),
        ):
            with self.subTest(status=status):
                worker, runtime = self.real_worker()
                runtime.result = self.result(verification={"status": status})
                worker.run_once()
                run = self.client.get(f"/api/v1/runs/{self.run_id}").json()
                self.assertEqual(run["state"], "failed", run)
                self.assertEqual(run["reason"], reason)
                self.assertEqual(run["cleanup_state"], "confirmed")
                self.assertEqual(
                    self.download()[1].json()["result"]["verification"]["status"], status
                )

    def test_real_worker_archive_failure_quarantines_before_tool_and_model_cleanup(self):
        worker, runtime = self.real_worker(tools=True, model=True)
        runtime.result = self.result(verification={"status": "passed"})
        with patch(
            "agent_platform.runtime_worker.persist_archive",
            side_effect=RuntimeError("secret db failure"),
        ):
            worker.run_once()
        run = self.client.get(f"/api/v1/runs/{self.run_id}").json()
        self.assertEqual(run["state"], "interrupted", run)
        self.assertEqual(run["reason"], "artifact_persist_failed")
        self.assertIsNone(run["result"])
        self.assertEqual(self.scalar("SELECT count(*) FROM result_archives"), 0)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 1
        )
        self.assertNotIn("release", runtime.actions("/operations"))
        self.assertFalse(any(path.endswith("/cancel") for _, path, _ in runtime.calls))
        worker.model_proxy.cutoff.assert_not_called()

    def test_real_persist_failure_recovery_reuses_result_without_prompt(self):
        worker, runtime = self.real_worker()
        runtime.result = self.result(verification={"status": "passed"})
        with self.db.transaction() as conn:
            conn.execute("ALTER TABLE result_archives ADD CONSTRAINT reject_test CHECK (false)")
        try:
            worker.run_once()
            self.assertEqual(
                self.scalar("SELECT result FROM runs WHERE id=%s", (self.run_id,)), None
            )
            self.assertEqual(self.scalar("SELECT count(*) FROM result_archives"), 0)
            self.assertEqual(
                self.scalar("SELECT reason FROM runs WHERE id=%s", (self.run_id,)),
                "artifact_persist_failed",
            )
        finally:
            with self.db.transaction() as conn:
                conn.execute("ALTER TABLE result_archives DROP CONSTRAINT reject_test")
                conn.execute(
                    "UPDATE jobs SET available_at=clock_timestamp() WHERE run_id=%s", (self.run_id,)
                )
                conn.execute(
                    "UPDATE runs SET deadline=now()-interval '1 second' WHERE id=%s", (self.run_id,)
                )
        with patch(
            "agent_platform.runtime_worker.cutoff_reason", return_value="model_budget_exhausted"
        ):
            Worker(self.db, runtime.client).run_once()
        self.assertEqual(
            self.scalar("SELECT state FROM runs WHERE id=%s", (self.run_id,)), "succeeded"
        )
        self.assertEqual(runtime.actions("/operations").count("prompt"), 1)
        self.download()

    def test_uncertain_archive_recovery_does_not_cancel_unarchived_vm(self):
        worker, runtime = self.real_worker(tools=True, model=True)
        runtime.result = self.result(verification={"status": "passed"})
        with patch("agent_platform.runtime_worker.persist_archive", side_effect=RuntimeError("db")):
            worker.run_once()
        self.assertEqual(
            self.scalar("SELECT reason FROM runs WHERE id=%s", (self.run_id,)),
            "artifact_persist_failed",
        )
        runtime.phase = "running"
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE jobs SET available_at=clock_timestamp() WHERE run_id=%s", (self.run_id,)
            )
        with patch(
            "agent_platform.runtime_worker.cutoff_reason", return_value="model_budget_exhausted"
        ):
            worker.run_once()
        self.assertEqual(
            self.scalar("SELECT reason FROM runs WHERE id=%s", (self.run_id,)),
            "artifact_persist_failed",
        )
        self.assertEqual(runtime.actions("/operations").count("prompt"), 1)
        self.assertNotIn("release", runtime.actions("/operations"))
        self.assertFalse(any(path.endswith("/cancel") for _, path, _ in runtime.calls))
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 1
        )

    def test_commit_failure_rolls_back_result_archive_and_success_together(self):
        worker, runtime = self.real_worker()
        runtime.result = self.result(verification={"status": "passed"})
        owned = worker.owned
        failed = False

        @contextmanager
        def fail_commit(claim):
            nonlocal failed
            with owned(claim) as (conn, run):
                yield conn, run
                if (
                    not failed
                    and conn.execute("SELECT count(*) AS n FROM result_archives").fetchone()["n"]
                ):
                    failed = True
                    raise psycopg.OperationalError("simulated commit failure")

        worker.owned = fail_commit
        worker.run_once()
        self.assertTrue(failed)
        self.assertEqual(
            self.scalar("SELECT state FROM runs WHERE id=%s", (self.run_id,)), "interrupted"
        )
        self.assertEqual(
            self.scalar("SELECT reason FROM runs WHERE id=%s", (self.run_id,)),
            "artifact_persist_failed",
        )
        self.assertIsNone(self.scalar("SELECT result FROM runs WHERE id=%s", (self.run_id,)))
        self.assertEqual(self.scalar("SELECT count(*) FROM result_archives"), 0)
        self.assertNotIn("release", runtime.actions("/operations"))

    def test_database_outage_recovers_archive_without_quarantine_reason(self):
        worker, runtime = self.real_worker()
        runtime.result = self.result(verification={"status": "passed"})
        with (
            patch(
                "agent_platform.runtime_worker.persist_archive",
                side_effect=psycopg.OperationalError("db unavailable"),
            ),
            patch(
                "agent_platform.runtime_worker.quarantine",
                side_effect=psycopg.OperationalError("db unavailable"),
            ),
        ):
            worker.run_once()
        run = self.client.get(f"/api/v1/runs/{self.run_id}").json()
        self.assertEqual(run["state"], "finalizing")
        self.assertIsNone(run["reason"])
        self.assertIsNone(run["result"])
        self.assertEqual(runtime.phase, "result")
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=%s",
                (self.run_id,),
            )
            conn.execute(
                "UPDATE runs SET deadline=now()-interval '1 second' WHERE id=%s", (self.run_id,)
            )
        with patch(
            "agent_platform.runtime_worker.cutoff_reason", return_value="model_budget_exhausted"
        ):
            Worker(self.db, runtime.client).run_once()
        run = self.client.get(f"/api/v1/runs/{self.run_id}").json()
        self.assertEqual(run["state"], "succeeded", run)
        self.assertEqual(runtime.actions("/operations").count("prompt"), 1)
        self.assertFalse(any(path.endswith("/cancel") for _, path, _ in runtime.calls))
        self.download()

    def interrupted_before_result(self):
        worker, runtime = self.real_worker(tools=True, model=True)
        runtime.result = self.result(verification={"status": "passed"})
        operation = runtime.client.operation

        def stop_before_result(run, action):
            if action == "result":
                raise SystemExit("simulate process death before result request")
            return operation(run, action)

        with patch.object(runtime.client, "operation", side_effect=stop_before_result):
            with self.assertRaises(SystemExit):
                worker.run_once()
        run = self.client.get(f"/api/v1/runs/{self.run_id}").json()
        self.assertEqual(run["state"], "finalizing")
        self.assertEqual(runtime.phase, "running")
        self.assertIsNone(run["result"])
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=%s",
                (self.run_id,),
            )
        return worker, runtime

    def test_before_result_recovery_fetches_without_new_model_or_tool_work(self):
        worker, runtime = self.interrupted_before_result()
        before = len(runtime.calls)
        with (
            patch("agent_platform.runtime_worker.ModelSession") as model,
            patch("agent_platform.tool_worker.ToolLifecycle") as tools,
        ):
            worker.run_once()
        self.assertEqual(
            self.scalar("SELECT state FROM runs WHERE id=%s", (self.run_id,)), "succeeded"
        )
        self.assertEqual(runtime.actions("/operations"), ["prepare", "prompt", "result", "release"])
        self.assertEqual(len(runtime.allocations), 1)
        self.assertFalse(any("/events?" in path for _, path, _ in runtime.calls[before:]))
        model.return_value.step.assert_not_called()
        tools.return_value.configure.assert_not_called()
        tools.return_value.start.assert_not_called()
        tools.return_value.step.assert_not_called()
        tools.return_value.recovered_result.assert_called_once()
        self.download()

    def test_before_result_recovery_requires_tool_drain_before_fetch(self):
        worker, runtime = self.interrupted_before_result()
        with patch("agent_platform.tool_worker.ToolLifecycle") as tools:
            tools.return_value.recovered_result.side_effect = Problem(
                409, "tool_recovery_unconfirmed"
            )
            worker.run_once()
        tools.return_value.recovered_result.assert_called_once()
        self.assertEqual(runtime.actions("/operations"), ["prepare", "prompt"])
        self.assertEqual(
            self.scalar("SELECT reason FROM runs WHERE id=%s", (self.run_id,)),
            "artifact_persist_failed",
        )
        self.assertFalse(any(path.endswith("/cancel") for _, path, _ in runtime.calls))
        self.assertEqual(self.scalar("SELECT count(*) FROM result_archives"), 0)

    def test_before_result_recovery_quarantines_uncertain_fetch(self):
        worker, runtime = self.interrupted_before_result()
        with patch.object(
            runtime.client, "operation", side_effect=Problem(409, "backend_not_finished")
        ) as operation:
            worker.run_once()
        self.assertEqual([call.args[1] for call in operation.call_args_list], ["result"])
        self.assertEqual(
            self.scalar("SELECT reason FROM runs WHERE id=%s", (self.run_id,)),
            "artifact_persist_failed",
        )
        self.assertFalse(any(path.endswith("/cancel") for _, path, _ in runtime.calls))
        self.assertEqual(self.scalar("SELECT count(*) FROM result_archives"), 0)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 1
        )

    def test_before_result_recovery_requires_matching_existing_binding(self):
        worker, runtime = self.interrupted_before_result()
        runtime.allocation["handle"] = "swapped-existing-handle"
        worker.run_once()
        self.assertEqual(runtime.actions("/operations"), ["prepare", "prompt"])
        self.assertEqual(
            self.scalar("SELECT reason FROM runs WHERE id=%s", (self.run_id,)),
            "artifact_persist_failed",
        )
        self.assertFalse(any(path.endswith("/cancel") for _, path, _ in runtime.calls))

    def test_success_without_stop_proof_keeps_archive_and_reserved_capacity(self):
        worker, runtime = self.real_worker()
        runtime.result = self.result(verification={"status": "passed"})
        runtime.complete_stop = False
        worker.run_once()
        self.assertEqual(
            self.scalar("SELECT state FROM runs WHERE id=%s", (self.run_id,)), "succeeded"
        )
        self.assertEqual(
            self.scalar("SELECT cleanup_state FROM runs WHERE id=%s", (self.run_id,)), "unknown"
        )
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 1
        )
        self.download()

    def test_local_mock_failure_rolls_back_result_and_archive(self):
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET goal=%s", ("FILE note.txt\nTEXT hello",))
            conn.execute("ALTER TABLE result_archives ADD CONSTRAINT reject_test CHECK (false)")
        try:
            with self.assertRaises(psycopg.errors.CheckViolation):
                Worker(self.db).run_once()
            self.assertEqual(self.scalar("SELECT state FROM runs"), "running")
            self.assertIsNone(self.scalar("SELECT result FROM runs"))
            self.assertEqual(self.scalar("SELECT count(*) FROM result_archives"), 0)
        finally:
            with self.db.transaction() as conn:
                conn.execute("ALTER TABLE result_archives DROP CONSTRAINT reject_test")

    def test_fake_database_failure_never_commits_success_or_partial_archive(self):
        with self.db.transaction() as conn:
            conn.execute("ALTER TABLE result_archives ADD CONSTRAINT reject_test CHECK (false)")
        try:
            with self.assertRaises(psycopg.errors.CheckViolation):
                Worker(self.db).run_once()
            self.assertEqual(self.scalar("SELECT state FROM runs"), "finalizing")
            self.assertIsNone(self.scalar("SELECT result FROM runs"))
            self.assertEqual(self.scalar("SELECT count(*) FROM result_archives"), 0)
        finally:
            with self.db.transaction() as conn:
                conn.execute("ALTER TABLE result_archives DROP CONSTRAINT reject_test")

    def test_retry_does_not_change_prior_archive(self):
        Worker(self.db).run_once()
        item, first = self.download()
        oldpath = f"{self.path}/{item['id']}"
        run = self.client.get(f"/api/v1/runs/{self.run_id}").json()
        response = self.post(
            f"/tasks/{run['task_id']}/runs",
            {
                **{k: self.payload[k] for k in ("base_sha", "profile_revision")},
                "goal": "changed goal",
                "expected_state_version": run["state_version"],
            },
        )
        self.assertEqual(response.status_code, 202, response.text)
        Worker(self.db).run_once()
        self.assertEqual(self.client.get(oldpath).content, first.content)
        self.assertEqual(self.scalar("SELECT count(*) FROM result_archives"), 2)
