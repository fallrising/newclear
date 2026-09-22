"""M2 capability gates, worker uncertainty and private connector journal contracts."""

import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb
from test_control_plane import PlatformFixture

from agent_platform.connector import create_connector
from agent_platform.connector_journal import Journal
from agent_platform.domain import Problem
from agent_platform.store import Store
from agent_platform.worker import Worker


class RuntimeTests(PlatformFixture):
    def setUp(self):
        super().setUp()
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM runtime_catalog")
        self.addCleanup(self.clear_catalog)

    def clear_catalog(self):
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM runtime_catalog")

    def real_profile(self):
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO runtime_catalog(node_id,template_digest,repositories) "
                "VALUES ('cocoon-local',%s,%s)",
                (
                    "localhost:15000/guest@sha256:" + "a" * 64,
                    Jsonb(
                        [
                            {
                                "canonical_repo": self.project["canonical_repo"],
                                "base_sha": self.payload["base_sha"],
                            }
                        ]
                    ),
                ),
            )
        response = self.post("/agent-profiles", {"name": "Real VM fixture", "backend": "openhands"})
        self.assertEqual(response.status_code, 201, response.text)
        self.payload["profile_revision"] = response.json()["id"]
        return response.json()

    def test_registration_is_required_and_profile_pins_template(self):
        self.assertEqual(
            self.post("/agent-profiles", {"name": "Real", "backend": "openhands"}).status_code, 503
        )
        profile = self.real_profile()
        self.assertEqual(profile["model_ref"], "fixture:m2")
        self.assertTrue(profile["capabilities"]["event_replay"])
        self.assertFalse(profile["capabilities"]["pause"])
        self.assertEqual(
            self.post("/tasks", {**self.payload, "base_sha": "b" * 40}).json()["error"],
            "repository_revision_not_registered",
        )
        value = self.create()
        self.assertEqual(value["run"]["execution_mode"], "cocoon-fixture")
        self.assertIsNone(Worker(self.db).claim())

    def test_at10_api_unsupported_no_side_effects(self):
        self.real_profile()
        value = self.create()
        for action in ["pause", "resume", "cancel", "approval"]:
            response = self.post(
                f"/runs/{value['run']['id']}/actions",
                {"action": action, "expected_state_version": 1},
            )
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()["error"], "unsupported_capability:" + action)
        self.assertEqual(self.scalar("SELECT count(*) FROM adapter_operations"), 0)
        self.assertEqual(self.scalar("SELECT count(*) FROM sandbox_bindings"), 0)
        stale = self.post(
            f"/runs/{value['run']['id']}/actions", {"action": "pause", "expected_state_version": 2}
        )
        self.assertEqual(stale.json()["error"], "state_conflict")

    def test_uncertain_allocation_retains_slot_and_never_retries(self):
        self.real_profile()
        self.create()

        class Uncertain:
            calls = 0

            def allocate(self, run):
                self.calls += 1
                raise TimeoutError("do not expose this upstream body")

        client = Uncertain()
        worker = Worker(self.db, client)
        worker.run_once()
        self.assertFalse(worker.run_once())
        self.assertEqual(client.calls, 1)
        self.assertEqual(self.scalar("SELECT state FROM runs"), "interrupted")
        self.assertEqual(self.scalar("SELECT cleanup_state FROM runs"), "unknown")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertNotIn(
            "expose", str(self.scalar("SELECT payload FROM run_events ORDER BY seq DESC LIMIT 1"))
        )

    def test_memory_reservation_limits_admission(self):
        self.real_profile()
        for _ in range(3):
            self.create()
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE runtime_capacity SET memory_bytes=%s WHERE node_id='cocoon-local'",
                (8 * 1024**3,),
            )
        try:
            worker = Worker(self.db, object())
            self.assertIsNotNone(worker.claim())
            self.assertIsNotNone(worker.claim())
            self.assertIsNone(worker.claim())
        finally:
            with self.db.transaction() as conn:
                conn.execute(
                    "UPDATE runtime_capacity SET memory_bytes=%s WHERE node_id='cocoon-local'",
                    (16 * 1024**3,),
                )

    def test_cleanup_ack_without_full_stop_proof_retains_capacity(self):
        self.real_profile()
        self.create()

        class IncompleteStop:
            def allocate(self, run):
                return {
                    "handle": "real-handle",
                    "lease_deadline": run["deadline"],
                    "vm_id": "vm-one",
                }

            def operation(self, run, action):
                return {
                    "prepare": {"ref": "conversation"},
                    "prompt": {"accepted": True},
                    "result": {
                        "execution_mode": "cocoon-fixture",
                        "diff_sha256": "a" * 64,
                        "verification": {"status": "passed"},
                    },
                    "release": {"observed_state": "stopped", "proof": {"claim_absent": True}},
                }[action]

            def events(self, run):
                return {"events": [], "state": "finished", "caught_up": True}

        worker = Worker(self.db, IncompleteStop())
        worker.run_once()
        self.assertEqual(self.scalar("SELECT state FROM runs"), "succeeded")
        self.assertEqual(self.scalar("SELECT cleanup_state FROM runs"), "unknown")
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertFalse(worker.run_once())

    def test_mixed_adapters_share_platform_four_slot_limit(self):
        for _ in range(3):
            self.create()
        self.real_profile()
        for _ in range(2):
            self.create()
        worker = Worker(self.db, object())
        self.assertTrue(all(worker.claim() for _ in range(4)))
        self.assertIsNone(worker.claim())
        self.assertEqual(Store(self.db).runtime()["slots"], 4)
        self.assertEqual(Store(self.db).runtime()["occupied"], 4)


class ConnectorTests(unittest.TestCase):
    def test_journal_survives_restart_and_does_not_repeat_unknown_mutation(self):
        with tempfile.TemporaryDirectory() as root:
            identifier = str(uuid4())
            journal = Journal(root)
            row = {"run_id": identifier, "operations": {}}
            calls = []

            def fail_after_effect():
                calls.append(1)
                raise TimeoutError()

            with self.assertRaises(TimeoutError):
                journal.operation(row, "allocate", "fingerprint", fail_after_effect)
            journal.close()
            journal = Journal(root)
            try:
                with self.assertRaises(Problem) as error:
                    journal.operation(
                        journal.read(identifier), "allocate", "fingerprint", fail_after_effect
                    )
                self.assertEqual(error.exception.code, "connector_operation_uncertain")
                self.assertEqual(calls, [1])
                self.assertEqual(
                    (Path(root) / (identifier + ".json")).stat().st_mode & 0o777, 0o600
                )
                with self.assertRaises(BlockingIOError):
                    Journal(root)
            finally:
                journal.close()

    def test_completed_operation_is_idempotent_and_payload_is_bound(self):
        with tempfile.TemporaryDirectory() as root:
            journal = Journal(root)
            try:
                row = {"run_id": str(uuid4()), "operations": {}}
                calls = []

                def effect():
                    calls.append(1)
                    return {"ref": "fixed"}

                first = journal.operation(row, "prompt", "same", effect)
                self.assertEqual(journal.operation(row, "prompt", "same", effect), first)
                with self.assertRaises(Problem):
                    journal.operation(row, "prompt", "different", effect)
                self.assertEqual(calls, [1])
            finally:
                journal.close()

    def test_connector_auth_origin_validation_and_secret_error_redaction(self):
        class Service:
            token = "x" * 48

            def close(self):
                pass

            def catalog(self):
                return {"templates": ["pinned"]}

            def mutate(self, *args):
                raise RuntimeError("SYNTHETIC_PRIVATE_UPSTREAM_VALUE")

        with TestClient(create_connector({}, Service())) as client:
            self.assertEqual(client.get("/v1/catalog").status_code, 401)
            headers = {"X-Session-API-Key": Service.token}
            self.assertEqual(client.get("/v1/catalog", headers=headers).status_code, 200)
            self.assertEqual(
                client.get(
                    "/v1/catalog", headers={**headers, "Origin": "http://evil.invalid"}
                ).status_code,
                403,
            )
            response = client.post(
                f"/v1/runs/{uuid4()}/operations",
                json={"action": "prompt", "generation": 1},
                headers=headers,
            )
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("SYNTHETIC", response.text)
            self.assertEqual(
                client.post(
                    f"/v1/runs/{uuid4()}/operations", content=b"x" * 65537, headers=headers
                ).status_code,
                413,
            )
