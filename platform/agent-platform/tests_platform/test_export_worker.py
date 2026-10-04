"""Durable GitHub mutation intent, concurrency, crash and read-only recovery."""

import concurrent.futures
import copy
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import psycopg
from github_export_fixture import FakeGitHub
from test_github_export import TARGETS, ExportFixture

from agent_platform import cli
from agent_platform.export_worker import ExportWorker, from_private_config
from agent_platform.github_client import GitHubClient


class ExportWorkerTests(ExportFixture):
    def setUp(self):
        self.remote = self.enterContext(FakeGitHub())
        super().setUp()
        self.client_remote = GitHubClient(self.remote.token, opener=self.remote.opener)
        self.worker = ExportWorker(self.db, TARGETS, self.client_remote)

    def archive(self, *args, **kwargs):
        self.payload["base_sha"] = self.remote.base_sha
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE runs SET base_sha=%s WHERE id=%s", (self.remote.base_sha, self.run_id)
            )
        return super().archive(*args, **kwargs)

    def operation(self):
        return self.client.get("/api/v1" + self.path).json()["items"][0]

    def mutations(self):
        return [r for r in self.remote.requests if r["method"] != "GET"]

    def reconcile_request(self):
        response = self.post(self.path + f"/{self.operation()['id']}/reconcile", {})
        self.assertEqual(response.status_code, 202, response.text)
        before = len(self.remote.requests)
        self.assertTrue(self.worker.run_once())
        self.assertTrue(all(r["method"] == "GET" for r in self.remote.requests[before:]))
        return self.operation()

    def lost(self, endpoint):
        self.approve()
        self.remote.fail_next("POST", "/repos/example/repo" + endpoint, after=True, disconnect=True)
        self.assertTrue(self.worker.run_once())
        self.assertEqual(self.operation()["state"], "uncertain", self.operation())

    def new_result(self, verification="failed", diff=None):
        self.run_id = self.create()["run"]["id"]
        self.path = f"/runs/{self.run_id}/exports"
        self.artifact = self.archive(verification=verification, **({"diff": diff} if diff else {}))
        self.preview_input.update(
            artifact_id=str(self.artifact["id"]), artifact_sha256=self.artifact["sha256"]
        )

    def test_failed_verification_is_not_relabelled_passed(self):
        self.new_result()
        self.assertEqual(self.preview()["verification_status"], "failed")
        self.approve()
        self.worker.run_once()
        self.assertEqual(self.operation()["state"], "succeeded")
        self.assertIn("Verification: failed.", self.remote.pulls[0]["body"])
        self.assertNotIn("passed", self.remote.pulls[0]["body"])

    def test_source_blob_hash_verified_before_any_mutation(self):
        self.remote = self.enterContext(FakeGitHub({"note.txt": "old\n"}))
        self.client_remote = GitHubClient(self.remote.token, opener=self.remote.opener)
        self.worker = ExportWorker(self.db, TARGETS, self.client_remote)
        self.new_result(
            diff=(
                "diff --git a/note.txt b/note.txt\n--- a/note.txt\n+++ b/note.txt\n"
                "@@ -1 +1 @@\n-old\n+new\n"
            )
        )
        self.approve()
        original = self.client_remote.request

        def wrong_blob(method, path, payload=None):
            result = original(method, path, payload)
            if "/git/blobs/" in path:
                result["content"] = "bm90LW9sZAo="
            return result

        with patch.object(self.client_remote, "request", side_effect=wrong_blob):
            self.worker.run_once()
        self.assertEqual(self.operation()["state"], "failed")
        self.assertEqual(self.operation()["reason"], "export_remote_invalid")
        self.assertEqual(self.mutations(), [])

    def test_http_500_mutation_does_not_escape_error_recording_or_retry(self):
        self.approve()
        self.remote.fail_next("POST", "/repos/example/repo/git/trees", status=500)
        self.worker.run_once()
        self.assertEqual(self.operation()["state"], "uncertain")
        self.assertEqual(self.operation()["reason"], "github_http_500")
        self.assertFalse(self.worker.run_once())
        self.assertEqual(len(self.mutations()), 1)

    def test_malformed_tree_field_containers_fail_before_mutation(self):
        for field in ("type", "mode"):
            for malformed in ([], {}):
                with self.subTest(field=field, value=malformed):
                    self.new_result()
                    self.approve()
                    entry = {
                        "path": "existing.txt",
                        "mode": "100644",
                        "type": "blob",
                        "sha": "a" * 40,
                    }
                    entry[field] = malformed
                    self.remote.fail_next(
                        "GET",
                        f"/repos/example/repo/git/trees/{self.remote.base_tree}?recursive=1",
                        response={
                            "sha": self.remote.base_tree,
                            "truncated": False,
                            "tree": [entry],
                        },
                    )
                    self.assertTrue(self.worker.run_once())
                    self.assertEqual(self.operation()["state"], "failed")
                    self.assertEqual(self.operation()["reason"], "export_remote_invalid")
                    self.assertIsNone(self.operation()["pr_url"])
        self.assertEqual(self.mutations(), [])

    def test_malformed_created_tree_stays_uncertain_after_intent(self):
        self.approve()
        request = self.client_remote.request

        def corrupt_tree(method, path, payload=None):
            result = request(method, path, payload)
            if method == "POST" and path.endswith("/git/trees"):
                malformed = copy.deepcopy(result)
                malformed["tree"][0]["mode"] = {}
                self.remote.fail_next(
                    "GET",
                    f"/repos/example/repo/git/trees/{result['sha']}?recursive=1",
                    response=malformed,
                )
            return result

        with patch.object(self.client_remote, "request", side_effect=corrupt_tree):
            self.assertTrue(self.worker.run_once())
        self.assertEqual(self.operation()["state"], "uncertain")
        self.assertEqual(self.operation()["reason"], "export_remote_invalid")
        self.assertIsNone(self.operation()["pr_url"])
        self.assertEqual(len(self.mutations()), 1)
        self.assertEqual(self.reconcile_request()["state"], "uncertain")
        self.assertEqual(len(self.mutations()), 1)

    def test_malformed_pr_state_container_stays_uncertain_after_intent(self):
        self.approve()
        request = self.client_remote.request

        def corrupt_pr(method, path, payload=None):
            result = request(method, path, payload)
            if method == "POST" and path.endswith("/pulls"):
                malformed = copy.deepcopy(result)
                malformed["state"] = []
                self.remote.fail_next(
                    "GET",
                    f"/repos/example/repo/pulls/{result['number']}",
                    response=malformed,
                )
            return result

        with patch.object(self.client_remote, "request", side_effect=corrupt_pr):
            self.assertTrue(self.worker.run_once())
        self.assertEqual(self.operation()["state"], "uncertain")
        self.assertEqual(self.operation()["reason"], "export_remote_invalid")
        self.assertIsNone(self.operation()["pr_url"])
        self.assertEqual(len(self.mutations()), 4)

    def test_malformed_pr_state_containers_cannot_reconcile_success(self):
        self.lost("/pulls")
        for malformed in ([], {}):
            with self.subTest(value=malformed):
                self.remote.pulls[0]["state"] = malformed
                result = self.reconcile_request()
                self.assertEqual(result["state"], "uncertain")
                self.assertEqual(result["reason"], "export_remote_invalid")
                self.assertIsNone(result["pr_url"])
        self.assertEqual(len(self.mutations()), 4)

    def test_no_approval_means_no_remote_access(self):
        self.assertFalse(self.worker.run_once())
        self.assertEqual(self.remote.requests, [])

    def test_exact_success_preserves_verification_and_commits_each_intent(self):
        self.approve()
        original = self.client_remote.request
        stages = []

        def request(method, path, payload=None):
            if method == "POST":
                stages.append(self.scalar("SELECT stage FROM github_exports"))
            return original(method, path, payload)

        with patch.object(self.client_remote, "request", side_effect=request):
            self.assertTrue(self.worker.run_once())
        operation = self.operation()
        self.assertEqual(operation["state"], "succeeded", operation)
        self.assertEqual(operation["pr_url"], "https://github.com/example/repo/pull/1")
        self.assertEqual(stages, ["tree_intent", "commit_intent", "branch_intent", "pr_intent"])
        self.assertEqual(len(self.mutations()), 4)
        self.assertTrue(self.remote.pulls[0]["draft"])
        self.assertIn("Verification: unknown.", self.remote.pulls[0]["body"])
        self.assertEqual(self.remote.pulls[0]["base"]["sha"], self.remote.base_sha)
        commit = self.remote.commits[self.remote.pulls[0]["head"]["sha"]]
        self.assertEqual(commit["parents"], [{"sha": self.remote.base_sha}])
        self.assertFalse(self.worker.run_once())
        self.assertEqual(len(self.mutations()), 4)
        self.assertIsNone(self.scalar("SELECT result FROM runs WHERE id=%s", (self.run_id,)))

    def test_parallel_workers_never_dispatch_same_operation(self):
        self.approve()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            values = list(
                pool.map(
                    lambda _: ExportWorker(self.db, TARGETS, self.client_remote).run_once(),
                    range(6),
                )
            )
        self.assertEqual(sum(values), 1)
        self.assertEqual(len(self.mutations()), 4)
        self.assertEqual(len(self.remote.pulls), 1)
        self.assertEqual(self.operation()["state"], "succeeded")

    def test_other_worker_cannot_take_active_network_dispatch(self):
        self.approve()
        entered, release = threading.Event(), threading.Event()
        request = self.client_remote.request

        def pause(method, path, payload=None):
            if method == "POST" and path.endswith("/git/trees"):
                entered.set()
                self.assertTrue(release.wait(10))
            return request(method, path, payload)

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            with patch.object(self.client_remote, "request", side_effect=pause):
                future = pool.submit(self.worker.run_once)
                self.assertTrue(entered.wait(10))
                try:
                    self.assertFalse(ExportWorker(self.db, TARGETS, self.client_remote).run_once())
                finally:
                    release.set()
                self.assertTrue(future.result(timeout=10))
        self.assertEqual(len(self.remote.pulls), 1)

    def test_wrong_worker_allowlist_rejects_without_remote_requests(self):
        self.approve()
        self.assertTrue(ExportWorker(self.db, (), self.client_remote).run_once())
        self.assertEqual(self.operation()["reason"], "export_target_disabled")
        self.assertEqual(self.operation()["state"], "failed")
        self.assertEqual(self.remote.requests, [])

    def test_base_drift_rejects_without_mutations(self):
        self.approve()
        self.remote.refs["main"] = "a" * 40
        self.worker.run_once()
        self.assertEqual(self.operation()["reason"], "export_base_changed")
        self.assertEqual(self.operation()["state"], "failed")
        self.assertEqual(self.mutations(), [])

    def test_base_rechecked_before_branch_and_no_pr_after_drift(self):
        self.approve()
        original = self.client_remote.request

        def drift(method, path, payload=None):
            result = original(method, path, payload)
            if method == "POST" and path.endswith("/git/commits"):
                self.remote.refs["main"] = "a" * 40
            return result

        with patch.object(self.client_remote, "request", side_effect=drift):
            self.worker.run_once()
        self.assertEqual(self.operation()["reason"], "export_base_changed")
        self.assertEqual(
            [r["path"].rsplit("/", 1)[-1] for r in self.mutations()], ["trees", "commits"]
        )
        self.assertEqual(self.remote.pulls, [])

    def test_existing_branch_never_updated(self):
        operation = self.approve()
        self.remote.refs[operation["branch"]] = self.remote.base_sha
        self.worker.run_once()
        self.assertEqual(self.operation()["reason"], "export_branch_exists")
        self.assertEqual(self.mutations(), [])
        self.assertEqual(self.remote.refs[operation["branch"]], self.remote.base_sha)

    def test_remote_success_pr_disconnect_recovers_closed_original_without_mutation(self):
        self.lost("/pulls")
        self.assertEqual(len(self.remote.pulls), 1)
        self.remote.pulls[0]["state"] = "closed"
        self.remote.pulls[0]["draft"] = False
        self.remote.pulls[0]["html_url"] = "https://attacker.invalid/credential"
        self.assertFalse(self.worker.run_once())
        result = self.reconcile_request()
        self.assertEqual(result["state"], "succeeded", result)
        self.assertEqual(result["pr_url"], "https://github.com/example/repo/pull/1")
        self.assertEqual(len(self.mutations()), 4)

    def test_branch_success_disconnect_stays_uncertain_and_never_creates_pr(self):
        self.lost("/git/refs")
        self.assertEqual(self.reconcile_request()["state"], "uncertain")
        self.assertEqual(len(self.mutations()), 3)
        self.assertEqual(self.remote.pulls, [])

    def test_unknown_tree_never_blindly_retried(self):
        self.lost("/git/trees")
        self.assertEqual(self.reconcile_request()["state"], "uncertain")
        self.assertEqual(len(self.mutations()), 1)

    def test_unknown_commit_never_blindly_retried(self):
        self.lost("/git/commits")
        self.assertEqual(self.reconcile_request()["state"], "uncertain")
        self.assertEqual(len(self.mutations()), 2)

    def test_crash_after_intent_before_dispatch_is_read_only_on_restart(self):
        self.approve()
        original = self.client_remote.request

        def crash(method, path, payload=None):
            if method == "POST":
                raise SystemExit("simulated process death")
            return original(method, path, payload)

        with patch.object(self.client_remote, "request", side_effect=crash):
            with self.assertRaises(SystemExit):
                self.worker.run_once()
        self.assertEqual(self.scalar("SELECT stage FROM github_exports"), "tree_intent")
        self.assertEqual(self.operation()["state"], "exporting")
        self.assertTrue(ExportWorker(self.db, TARGETS, self.client_remote).run_once())
        self.assertEqual(self.operation()["state"], "uncertain")
        self.assertEqual(self.mutations(), [])

    def test_db_failure_before_intent_prevents_send(self):
        self.approve()
        update = self.worker.update

        def unavailable(op, **changes):
            if changes.get("stage") == "tree_intent":
                raise psycopg.OperationalError("synthetic database outage")
            return update(op, **changes)

        with patch.object(self.worker, "update", side_effect=unavailable):
            with self.assertRaises(psycopg.OperationalError):
                self.worker.run_once()
        self.assertEqual(self.mutations(), [])
        self.assertTrue(self.worker.run_once())
        self.assertEqual(self.operation()["state"], "uncertain")
        self.assertEqual(self.mutations(), [])

    def test_db_failure_after_remote_success_recovers_known_pr_readonly(self):
        self.approve()
        with patch.object(self.worker, "success", side_effect=psycopg.OperationalError("outage")):
            with self.assertRaises(psycopg.OperationalError):
                self.worker.run_once()
        self.assertEqual(self.operation()["state"], "exporting")
        before = len(self.remote.requests)
        self.assertTrue(self.worker.run_once())
        self.assertEqual(self.operation()["state"], "succeeded")
        self.assertTrue(all(r["method"] == "GET" for r in self.remote.requests[before:]))
        self.assertEqual(len(self.remote.pulls), 1)

    def test_rate_limited_mutation_stays_uncertain_without_retry(self):
        self.approve()
        self.remote.fail_next("POST", "/repos/example/repo/git/trees", status=429)
        self.worker.run_once()
        self.assertEqual(self.operation()["state"], "uncertain")
        self.assertFalse(self.worker.run_once())
        self.assertEqual(len(self.mutations()), 1)

    def test_remote_read_failure_has_no_mutation(self):
        self.approve()
        self.remote.fail_next("GET", "/repos/example/repo/git/ref/heads/main", status=503)
        self.worker.run_once()
        self.assertEqual(self.operation()["state"], "failed")
        self.assertEqual(self.mutations(), [])

    def test_spoofed_pr_marker_ref_repo_and_commit_never_accepted(self):
        self.lost("/pulls")
        original = copy.deepcopy(self.remote.pulls[0])
        variants = []
        wrong = copy.deepcopy(original)
        wrong["body"] = "unrelated"
        variants.append(wrong)
        for ref in ("base", "head"):
            for field, value in (("sha", "a" * 40), ("repo", {"full_name": "attacker/repo"})):
                wrong = copy.deepcopy(original)
                wrong[ref][field] = value
                variants.append(wrong)
        for wrong in variants:
            with self.subTest(value=wrong):
                self.remote.pulls[:] = [wrong]
                self.assertEqual(self.reconcile_request()["state"], "uncertain")
        self.assertEqual(len(self.mutations()), 4)

    def test_wrong_branch_commit_or_commit_parent_prevents_reconcile_success(self):
        self.lost("/pulls")
        operation = self.operation()
        commit_sha = self.remote.refs[operation["branch"]]
        self.remote.refs[operation["branch"]] = self.remote.base_sha
        self.assertEqual(self.reconcile_request()["state"], "uncertain")
        self.remote.refs[operation["branch"]] = commit_sha
        self.remote.commits[commit_sha]["parents"] = [{"sha": "a" * 40}]
        self.assertEqual(self.reconcile_request()["state"], "uncertain")
        self.assertEqual(len(self.mutations()), 4)

    def test_mutation_invalid_response_not_success_and_only_get_recovery(self):
        self.approve()
        self.remote.fail_next(
            "POST", "/repos/example/repo/git/trees", after=True, response={"sha": "bad"}
        )
        self.worker.run_once()
        self.assertEqual(self.operation()["state"], "uncertain")
        self.assertEqual(self.reconcile_request()["state"], "uncertain")
        self.assertEqual(len(self.mutations()), 1)

    def test_readback_pr_number_must_match_requested_identity(self):
        self.approve()
        original = self.client_remote.request

        def wrong_number(method, path, payload=None):
            value = original(method, path, payload)
            if method == "GET" and path.endswith("/pulls/1"):
                value["number"] = 2
            return value

        with patch.object(self.client_remote, "request", side_effect=wrong_number):
            self.worker.run_once()
        self.assertEqual(self.operation()["state"], "uncertain")
        self.assertIsNone(self.operation()["pr_url"])

    def test_terminated_lock_session_cannot_continue_dispatch(self):
        self.approve()
        original = self.client_remote.request
        captured = {}
        update = self.worker.update

        def remember(op, **changes):
            captured["pid"] = op["_lock"].info.backend_pid
            return update(op, **changes)

        def disconnect_owner(method, path, payload=None):
            result = original(method, path, payload)
            if method == "POST" and path.endswith("/git/trees"):
                with self.db.transaction() as conn:
                    conn.execute("SELECT pg_terminate_backend(%s)", (captured["pid"],))
                # Lost owner no longer holds its session lock. A fresh worker
                # records uncertainty; the former worker must not revive authority.
                self.assertTrue(ExportWorker(self.db, TARGETS, self.client_remote).run_once())
            return result

        with (
            patch.object(self.worker, "update", side_effect=remember),
            patch.object(self.client_remote, "request", side_effect=disconnect_owner),
        ):
            with self.assertRaises(psycopg.Error):
                self.worker.run_once()
        self.assertEqual(self.operation()["state"], "uncertain")
        self.assertEqual(len(self.mutations()), 1)
        self.assertEqual(self.remote.pulls, [])

    def test_changed_operation_state_revokes_old_worker_authority(self):
        self.approve()
        original = self.client_remote.request

        def revoke(method, path, payload=None):
            result = original(method, path, payload)
            if method == "POST" and path.endswith("/git/trees"):
                with self.db.transaction() as conn:
                    conn.execute("UPDATE github_exports SET state='uncertain'")
            return result

        with patch.object(self.client_remote, "request", side_effect=revoke):
            with self.assertRaisesRegex(RuntimeError, "export_ownership_lost"):
                self.worker.run_once()
        self.assertEqual(self.operation()["state"], "uncertain")
        self.assertEqual(len(self.mutations()), 1)

    def test_cli_once_uses_explicit_private_config_and_no_ambient_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            credential = root / "token"
            credential.write_text("synthetic-export-token\n")
            credential.chmod(0o600)
            config = root / "config.json"
            config.write_text(
                json.dumps({"targets": list(TARGETS), "credential_file": str(credential)})
            )
            config.chmod(0o600)
            with (
                patch.dict(
                    os.environ, {"DATABASE_URL": self.settings.database_url, "GH_TOKEN": "ignored"}
                ),
                patch(
                    "sys.argv",
                    ["agent-platform", "export-worker", "--config", str(config), "--once"],
                ),
            ):
                self.assertEqual(cli.main(), 0)
        self.assertEqual(self.remote.requests, [])


class ExportPrivateConfigTests(unittest.TestCase):
    def test_explicit_bounded_reader_and_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            credential = root / "token"
            credential.write_text("synthetic-token\n")
            credential.chmod(0o600)
            config = root / "config.json"
            config.write_text(
                json.dumps({"targets": list(TARGETS), "credential_file": str(credential)})
            )
            config.chmod(0o600)
            runner = from_private_config(object(), config)
            self.assertEqual(runner.targets, TARGETS)
            credential.chmod(0o644)
            with self.assertRaisesRegex(ValueError, "^export_config_invalid$"):
                from_private_config(object(), config)
            credential.chmod(0o600)
            config.write_text(json.dumps({"targets": list(TARGETS), "token": "forbidden"}))
            with self.assertRaisesRegex(ValueError, "^export_config_invalid$"):
                from_private_config(object(), config)
