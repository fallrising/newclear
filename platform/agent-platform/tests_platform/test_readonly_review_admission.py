"""Real PostgreSQL/API admission; synthetic succeeded writers are explicitly fixtures."""

import concurrent.futures
import hashlib
import json
from uuid import uuid4

from psycopg.types.json import Jsonb
from test_subscription import SubscriptionFixture

from agent_platform.result_archive import persist_archive
from agent_platform.store import Store


class ReviewAdmissionTests(SubscriptionFixture):
    def setUp(self):
        super().setUp()
        self.real_profile()
        self.profiles = {}
        for backend in ("claude-subscription", "codex-subscription"):
            reply = self.post(
                "/agent-profiles",
                {
                    "name": backend,
                    "backend": backend,
                    "deadline_seconds": 600,
                    "verification": {
                        "mode": "commands",
                        "revision": "review-test-v1",
                        "checks": [{"id": "test", "argv": ["true"], "timeout_seconds": 1}],
                    },
                },
            )
            self.assertEqual(reply.status_code, 201, reply.text)
            self.profiles[backend] = reply.json()["id"]
        self.payload["profile_revision"] = self.profiles["claude-subscription"]
        self.writer = self.create()["run"]
        self.candidate = self.complete_writer(self.writer["id"])

    def complete_writer(self, run_id, summary="Synthetic candidate"):
        result = {
            "execution_mode": "cocoon-external",
            "summary": summary,
            "verification": {"status": "passed"},
        }
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE runs SET state='succeeded',result=%s WHERE id=%s", (Jsonb(result), run_id)
            )
            run = conn.execute("SELECT * FROM runs WHERE id=%s", (run_id,)).fetchone()
            artifact = persist_archive(conn, run, result)
        return {
            "artifact_id": str(artifact["id"]),
            "candidate_sha256": artifact["sha256"],
            "profile_revision": self.profiles["codex-subscription"],
        }

    def review(self, key=None, writer=None, data=None):
        return self.post(
            f"/runs/{writer or self.writer['id']}/reviews", data or self.candidate, key
        )

    def complete_review(self, run, verdict="request_changes", reasons=None):
        from agent_platform.review import result_review

        output = {
            "candidate_sha256": run["review_context"]["candidate_sha256"],
            "verdict": verdict,
            "reasons": reasons or ["Fix the total."],
        }
        result = {
            "execution_mode": "cocoon-external",
            "verification": {"status": "passed", "name": "candidate_integrity"},
            "review": result_review(run, output),
        }
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE runs SET state='succeeded',result=%s WHERE id=%s",
                (Jsonb(result), run["id"]),
            )
            persist_archive(conn, run, result)
        return result

    def test_valid_unicode_verdict_admits_rework_without_ascii_expansion(self):
        first = self.review().json()["run"]
        self.complete_review(first, reasons=["修" * 2000] * 3)
        reply = self.post(f"/runs/{first['id']}/rework", {})
        self.assertEqual(reply.status_code, 202, reply.text)
        self.assertIn("修" * 2000, reply.json()["run"]["goal"])

    def test_review_exact_replay_conflict_and_frozen_candidate(self):
        first = self.review("same")
        self.assertEqual(first.status_code, 202, first.text)
        self.assertEqual(first.json(), self.review("same").json())
        changed = {**self.candidate, "candidate_sha256": "0" * 64}
        self.assertEqual(self.review("same", data=changed).status_code, 409)
        run = first.json()["run"]
        self.assertEqual(run["purpose"], "review")
        self.assertEqual(run["review_context"]["review_round"], 1)
        self.assertNotIn("review_candidate", run)
        self.assertNotIn("review_output", run)
        with self.db.transaction() as conn:
            raw = conn.execute(
                "SELECT review_candidate FROM runs WHERE id=%s", (run["id"],)
            ).fetchone()["review_candidate"]
        self.assertEqual(hashlib.sha256(raw).hexdigest(), self.candidate["candidate_sha256"])
        self.assertEqual(json.loads(raw)["run_id"], self.writer["id"])

    def test_distinct_keys_compete_for_one_review_slot(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            replies = list(pool.map(lambda _: self.review(), range(4)))
        self.assertEqual(sorted(r.status_code for r in replies), [202, 409, 409, 409])
        self.assertEqual(self.scalar("SELECT count(*) FROM runs WHERE purpose='review'"), 1)

    def test_invalid_archive_vendor_and_auth_create_nothing(self):
        for changes in (
            {"profile_revision": self.profiles["claude-subscription"]},
            {"candidate_sha256": "0" * 64},
            {"artifact_id": str(uuid4())},
        ):
            reply = self.review(data={**self.candidate, **changes})
            self.assertIn(reply.status_code, (404, 409), reply.text)
        self.assertEqual(self.scalar("SELECT count(*) FROM runs WHERE purpose='review'"), 0)
        response = self.client.post(
            f"/api/v1/runs/{self.writer['id']}/reviews", json=self.candidate
        )
        self.assertEqual(response.status_code, 403)

    def test_one_rework_second_review_then_no_third_or_retry(self):
        first = self.review().json()["run"]
        self.complete_review(first)
        route = f"/runs/{first['id']}/rework"
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            replies = list(pool.map(lambda _: self.post(route, {}), range(3)))
        self.assertEqual(sorted(r.status_code for r in replies), [202, 409, 409])
        rework = next(r.json()["run"] for r in replies if r.status_code == 202)
        candidate = self.complete_writer(rework["id"])
        second = self.review(writer=rework["id"], data=candidate)
        self.assertEqual(second.status_code, 202, second.text)
        second = second.json()["run"]
        self.assertEqual(second["review_context"]["review_round"], 2)
        self.complete_review(second)
        self.assertEqual(self.post(f"/runs/{second['id']}/rework", {}).status_code, 409)
        self.assertEqual(self.review(writer=rework["id"], data=candidate).status_code, 409)
        for run in (self.writer, first, rework, second):
            latest = Store(self.db).run(run["id"])
            reply = self.post(
                f"/tasks/{run['task_id']}/runs",
                {
                    "goal": "bypass",
                    "base_sha": run["base_sha"],
                    "profile_revision": run["profile_revision"],
                    "expected_state_version": latest["state_version"],
                },
            )
            self.assertEqual(reply.status_code, 409, reply.text)
            self.assertEqual(reply.json()["error"], "review_lineage_retry_forbidden")

    def test_unknown_or_failed_review_keeps_first_slot_and_rework_closed(self):
        first = self.review().json()["run"]
        for state in ("interrupted", "failed", "cancelled"):
            with self.db.transaction() as conn:
                conn.execute("UPDATE runs SET state=%s WHERE id=%s", (state, first["id"]))
            self.assertEqual(self.review().status_code, 409)
            self.assertEqual(self.post(f"/runs/{first['id']}/rework", {}).status_code, 409)

    def test_archive_download_reopens_exact_review(self):
        run = self.review().json()["run"]
        result = self.complete_review(run, "accept")
        listing = self.client.get(f"/api/v1/runs/{run['id']}/artifacts").json()["items"]
        path = f"/api/v1/runs/{run['id']}/artifacts/{listing[0]['id']}"
        first = self.client.get(path)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["result"]["review"], result["review"])
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET result=NULL WHERE id=%s", (run["id"],))
        self.assertEqual(first.content, self.client.get(path).content)

    def test_oversize_candidate_rejected_before_run_admission(self):
        other = self.create()["run"]
        data = self.complete_writer(other["id"], "x" * 32768)
        self.assertEqual(self.review(writer=other["id"], data=data).status_code, 409)
        self.assertEqual(self.scalar("SELECT count(*) FROM runs WHERE purpose='review'"), 0)

    def test_writer_profile_identity_is_resolved_not_inferred_from_run_label(self):
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE runs SET backend='codex-subscription' WHERE id=%s", (self.writer["id"],)
            )
        reply = self.review(
            data={**self.candidate, "profile_revision": self.profiles["claude-subscription"]}
        )
        self.assertEqual(reply.status_code, 409)
        self.assertEqual(reply.json()["error"], "review_writer_profile_mismatch")
        self.assertEqual(self.scalar("SELECT count(*) FROM runs WHERE purpose='review'"), 0)

    def review_worker(self, run):
        from unittest.mock import Mock

        from agent_platform.connector_recovery import STOP_KEYS
        from agent_platform.worker import Worker

        connector = Mock()
        connector.allocate.return_value = {
            "handle": "owned-handle",
            "lease_deadline": "2099-01-01T00:00:00Z",
            "vm_id": "owned-vm",
        }
        stop = {"observed_state": "stopped", "proof": {key: True for key in STOP_KEYS}}

        def operation(current, action):
            if action == "prepare":
                return {"ref": run["id"], "model_transport": False}
            if action == "result":
                return {
                    "execution_mode": "cocoon-external",
                    "verification": {"status": "passed", "name": "candidate_integrity"},
                }
            if action == "release":
                return stop
            self.fail("Unexpected operation: " + action)

        connector.operation.side_effect = operation
        connector.cancel.return_value = stop
        driver = Mock()
        driver.execute.return_value = {
            "candidate_sha256": run["review_context"]["candidate_sha256"],
            "verdict": "request_changes",
            "reasons": ["Fix totals."],
        }
        return Worker(self.db, connector, codex_subscription=driver), connector, driver

    def test_review_worker_persists_typed_result_archive_and_releases_capacity(self):
        run = self.review().json()["run"]
        worker, connector, driver = self.review_worker(run)
        claim = worker.claim()
        self.assertEqual(str(claim["run_id"]), run["id"])
        worker.execute(claim)
        observed = Store(self.db).run(run["id"])
        self.assertEqual(observed["state"], "succeeded")
        self.assertEqual(observed["result"]["review"]["verdict"], "request_changes")
        self.assertEqual(observed["result"]["review"]["reviewer_run_id"], run["id"])
        self.assertEqual(observed["cleanup_state"], "confirmed")
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertEqual(Store(self.db).run(self.writer["id"])["state"], "succeeded")
        self.assertEqual(driver.execute.call_count, 1)
        self.assertEqual(
            connector.allocate.call_args.args[0]["review_context"], run["review_context"]
        )
        self.assertEqual(
            self.scalar("SELECT count(*) FROM result_archives WHERE run_id=%s", (run["id"],)), 1
        )

    def test_invalid_review_output_fails_and_releases_without_acceptance(self):
        from agent_platform.domain import Problem

        run = self.review().json()["run"]
        worker, connector, driver = self.review_worker(run)
        driver.execute.side_effect = Problem(409, "review_verdict_invalid")
        worker.execute(worker.claim())
        observed = Store(self.db).run(run["id"])
        self.assertEqual(observed["state"], "failed")
        self.assertEqual(observed["reason"], "review_verdict_invalid")
        self.assertIsNone(observed["result"])
        self.assertEqual(observed["cleanup_state"], "confirmed")
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertEqual(self.review().status_code, 409)

    def test_durable_verdict_recovers_archive_without_relaunching_cli(self):
        from agent_platform.recovery import quarantine

        run = self.review().json()["run"]
        worker, connector, driver = self.review_worker(run)
        operation = connector.operation.side_effect

        def crash_before_result(current, action):
            if action == "result":
                raise KeyboardInterrupt("synthetic worker crash before Connector result")
            return operation(current, action)

        connector.operation.side_effect = crash_before_result
        claim = worker.claim()
        with self.assertRaises(KeyboardInterrupt):
            worker.execute(claim)
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT state,review_output FROM runs WHERE id=%s", (run["id"],)
            ).fetchone()
        self.assertEqual(row["state"], "finalizing")
        self.assertEqual(row["review_output"]["verdict"], "request_changes")
        quarantine(worker, claim, "synthetic_worker_crash")
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE jobs SET available_at=clock_timestamp() WHERE run_id=%s", (run["id"],)
            )
        connector.inspect.return_value = {
            "phase": "prepared",
            "allocation": connector.allocate.return_value,
            "prepared": {"ref": run["id"], "model_transport": False},
        }
        connector.operation.side_effect = operation
        recovered = worker.claim()
        self.assertTrue(recovered["recovery"])
        worker.execute(recovered)
        self.assertEqual(driver.execute.call_count, 1)
        observed = Store(self.db).run(run["id"])
        self.assertEqual(observed["state"], "succeeded")
        self.assertEqual(observed["result"]["review"]["verdict"], "request_changes")
        self.assertEqual(observed["cleanup_state"], "confirmed")
