"""AT-01 and M1 boundaries against real PostgreSQL, never SQLite or mocked SQL."""

import concurrent.futures
import json
import os
import secrets
import subprocess
import sys
import unittest
from dataclasses import replace
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient

from agent_platform.api import create_app
from agent_platform.auth import bootstrap, digest
from agent_platform.config import Settings
from agent_platform.db import Database, migrate
from agent_platform.domain import Problem
from agent_platform.store import Store, event
from agent_platform.worker import Worker

URL = os.environ.get("TEST_DATABASE_URL")


@unittest.skipUnless(URL, "Use make platform-test for an isolated PostgreSQL")
class PlatformFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Verify the target before migrations or any destructive fixture reset.
        with psycopg.connect(URL) as preflight:
            if preflight.info.dbname != "agent_platform_test":
                raise ValueError("Integration tests require the dedicated test database")
        migrate(URL)
        cls.db = Database(URL)
        cls.db.open()
        cls.addClassCleanup(cls.db.close)
        with cls.db.transaction() as conn:
            conn.execute("TRUNCATE operators CASCADE")
        cls.password = secrets.token_urlsafe(24)
        cls.operator = bootstrap(cls.db, "operator", cls.password)
        cls.settings = Settings(URL, origin="https://testserver", stream_seconds=1)

    def setUp(self):
        with self.db.transaction() as conn:
            conn.execute(
                "TRUNCATE projects,agent_profile_revisions,commands,audit_events,l"
                "ogin_limits,sessions CASCADE"
            )
            conn.execute("UPDATE runtime_capacity SET slots=4,draining=false")
        self.client = TestClient(create_app(self.settings, self.db), base_url=self.settings.origin)
        self.addCleanup(self.client.close)
        csrf = self.client.get("/api/v1/session").json()["csrf_token"]
        response = self.client.post(
            "/api/v1/session",
            json={"username": "operator", "password": self.password},
            headers={"Origin": self.settings.origin, "X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.headers = {
            "Origin": self.settings.origin,
            "X-CSRF-Token": response.json()["csrf_token"],
        }
        self.project = self.post(
            "/projects",
            {"name": "Test repository", "canonical_repo": "https://github.com/fallrising/newclear"},
        ).json()
        self.profile = self.post("/agent-profiles", {"name": "Deterministic M1"}).json()
        self.assertEqual(self.profile["limits"]["verification"]["mode"], "none")
        self.payload = {
            "title": "Persistent work",
            "goal": "Verify the queued task",
            "project_id": self.project["id"],
            "profile_revision": self.profile["id"],
            "base_sha": "7bb80d00d03d93a2d392185adba65588c5fe2462",
        }

    def post(self, path, data, key=None, client=None):
        return (client or self.client).post(
            "/api/v1" + path,
            json=data,
            headers={**self.headers, "Idempotency-Key": key or uuid4().hex},
        )

    def create(self, key=None):
        response = self.post("/tasks", self.payload, key)
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()

    def scalar(self, sql, params=()):
        with self.db.transaction() as conn:
            return next(iter(conn.execute(sql, params).fetchone().values()))


class PlatformTests(PlatformFixture):
    def test_at01_duplicate_create_is_one_atomic_admission(self):
        first = self.post("/tasks", self.payload, "same-create")
        second = self.post("/tasks", self.payload, "same-create")
        self.assertEqual(first.status_code, 202)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(first.headers["location"], second.headers["location"])
        for table in ("tasks", "runs", "jobs", "run_messages"):
            self.assertEqual(self.scalar(f"SELECT count(*) FROM {table}"), 1)
        self.assertEqual(self.scalar("SELECT count(*) FROM run_events"), 2)
        self.assertEqual(self.scalar("SELECT count(*) FROM commands WHERE route='tasks.create'"), 1)

    def test_at01_same_key_different_payload_conflicts(self):
        original = self.create("same")
        response = self.post("/tasks", {**self.payload, "goal": "different"}, "same")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "idempotency_conflict")
        self.assertEqual(
            self.client.get(f"/api/v1/runs/{original['run']['id']}").json()["goal"],
            self.payload["goal"],
        )

    def test_at01_concurrent_duplicate_create(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(
                pool.map(lambda _: self.post("/tasks", self.payload, "parallel"), range(8))
            )
        self.assertEqual({r.status_code for r in responses}, {202})
        self.assertEqual(len({r.json()["run"]["id"] for r in responses}), 1)
        self.assertEqual(self.scalar("SELECT count(*) FROM tasks"), 1)
        self.assertEqual(self.scalar("SELECT count(*) FROM jobs"), 1)

    def test_at01_concurrent_unique_create_and_atomic_rollback(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            responses = list(pool.map(lambda _: self.post("/tasks", self.payload), range(6)))
        self.assertEqual({r.status_code for r in responses}, {202})
        self.assertEqual(self.scalar("SELECT count(*) FROM tasks"), 6)
        invalid = self.post(
            "/tasks", {**self.payload, "profile_revision": str(uuid4())}, "rollback"
        )
        self.assertEqual(invalid.status_code, 404)
        self.assertEqual(self.scalar("SELECT count(*) FROM tasks"), 6)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM commands WHERE idempotency_key='rollback'"), 0
        )

    def test_at01_one_active_run_and_versioned_retry(self):
        value = self.create()
        retry = {k: self.payload[k] for k in ("goal", "base_sha", "profile_revision")}
        retry["expected_state_version"] = 1
        path = f"/tasks/{value['task']['id']}/runs"
        self.assertEqual(self.post(path, retry).json()["error"], "active_run_exists")
        Worker(self.db).run_once()
        run = self.client.get(f"/api/v1/runs/{value['run']['id']}").json()
        self.assertEqual(self.post(path, retry).json()["error"], "state_conflict")
        retry["expected_state_version"] = run["state_version"]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: self.post(path, retry), range(4)))
        self.assertEqual(sum(r.status_code == 202 for r in responses), 1)
        self.assertEqual(sum(r.status_code == 409 for r in responses), 3)
        self.assertEqual(self.scalar("SELECT count(*) FROM runs"), 2)
        self.assertEqual(
            self.scalar(
                "SELECT count(*) FROM runs WHERE state NOT IN ('succeeded','failed','cancelled')"
            ),
            1,
        )

    def test_database_constraint_rejects_second_active_run(self):
        value = self.create()
        with self.assertRaises(psycopg.errors.UniqueViolation), self.db.transaction() as conn:
            conn.execute(
                (
                    "INSERT INTO runs(id,task_id,attempt_no,base_sha,profile_revision,"
                    "goal,state,deadline) VALUES "
                    "(%s,%s,2,%s,%s,'duplicate','queued',now()+interval '1 hour')"
                ),
                (uuid4(), value["task"]["id"], self.payload["base_sha"], self.profile["id"]),
            )

    def test_auth_csrf_session_rotation_and_revocation(self):
        token = self.client.cookies.get(self.settings.session_cookie)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM sessions WHERE token_hash=%s", (digest(token),)), 1
        )
        self.assertEqual(
            self.scalar("SELECT count(*) FROM sessions WHERE token_hash=%s", (token,)), 0
        )
        for headers in (
            {},
            {**self.headers, "Origin": "https://attacker.invalid"},
            {**self.headers, "X-CSRF-Token": "x" * 43},
        ):
            response = self.client.post(
                "/api/v1/tasks",
                json=self.payload,
                headers={**headers, "Idempotency-Key": uuid4().hex},
            )
            self.assertEqual(response.status_code, 403)
        outsider = TestClient(create_app(self.settings, self.db), base_url=self.settings.origin)
        self.addCleanup(outsider.close)
        self.assertEqual(outsider.get("/api/v1/tasks").status_code, 401)
        response = self.client.delete("/api/v1/session", headers=self.headers)
        self.assertEqual(response.status_code, 204)
        outsider.cookies.set(self.settings.session_cookie, token)
        self.assertEqual(outsider.get("/api/v1/tasks").status_code, 401)

    def test_login_csrf_cookie_flags_and_rate_limit(self):
        client = TestClient(create_app(self.settings, self.db), base_url=self.settings.origin)
        self.addCleanup(client.close)
        response = client.get("/api/v1/session")
        cookie = response.headers["set-cookie"].lower()
        self.assertIn("httponly", cookie)
        self.assertIn("secure", cookie)
        self.assertIn("samesite=strict", cookie)
        data = {"username": "operator", "password": self.password}
        self.assertEqual(client.post("/api/v1/session", json=data).status_code, 403)
        csrf = response.json()["csrf_token"]
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO login_limits(bucket,attempts,window_start) VALUES (%s,10,now())",
                (digest("testclient"),),
            )
        denied = client.post(
            "/api/v1/session",
            json=data,
            headers={"Origin": self.settings.origin, "X-CSRF-Token": csrf},
        )
        self.assertEqual(denied.status_code, 429)
        self.assertEqual(denied.headers["retry-after"], "300")

    def test_expired_session_denied_and_input_errors_redact_password(self):
        with self.db.transaction() as conn:
            conn.execute("UPDATE sessions SET expires_at=now()-interval '1 second'")
        self.assertEqual(self.client.get("/api/v1/tasks").status_code, 401)
        sentinel = "SECRET_" * 200
        response = self.client.post(
            "/api/v1/session",
            json={"username": "operator", "password": sentinel},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(sentinel, response.text)

    def test_bootstrap_is_one_time_and_profiles_immutable(self):
        with self.assertRaises(ValueError):
            bootstrap(self.db, "second", self.password)
        configured = self.post(
            "/agent-profiles",
            {
                "name": "Pinned repository checks",
                "verification": {
                    "mode": "commands",
                    "revision": "unit-checks-v1",
                    "checks": [
                        {
                            "id": "smoke",
                            "argv": ["python3", "-c", "pass"],
                            "timeout_seconds": 5,
                        }
                    ],
                },
            },
        ).json()
        self.assertEqual(configured["limits"]["verification"]["revision"], "unit-checks-v1")
        self.assertEqual(configured["limits"]["verification"]["checks"][0]["id"], "smoke")
        self.assertEqual(
            self.post(
                "/agent-profiles",
                {
                    "name": "Duplicate check IDs",
                    "verification": {
                        "mode": "commands",
                        "checks": [
                            {"id": "same", "argv": ["true"], "timeout_seconds": 1},
                            {"id": "same", "argv": ["true"], "timeout_seconds": 1},
                        ],
                    },
                },
            ).status_code,
            422,
        )
        newer = self.post(
            "/agent-profiles", {"name": "New revision", "profile_id": self.profile["profile_id"]}
        ).json()
        self.assertEqual(newer["revision"], 2)
        with self.assertRaises(psycopg.errors.RaiseException), self.db.transaction() as conn:
            conn.execute(
                "UPDATE agent_profile_revisions SET name='mutated' WHERE id=%s",
                (self.profile["id"],),
            )
        self.assertEqual(
            self.post("/agent-profiles", {"name": "Wrong", "backend": "host-shell"}).status_code,
            422,
        )

    def test_worker_persists_result_replay_never_reexecutes(self):
        value = self.create()
        worker = Worker(self.db)
        self.assertTrue(worker.run_once())
        self.assertFalse(worker.run_once())
        run_id = value["run"]["id"]
        run = self.client.get(f"/api/v1/runs/{run_id}").json()
        self.assertEqual(run["state"], "succeeded")
        self.assertEqual(run["cleanup_state"], "confirmed")
        self.assertEqual(run["result"]["verification"]["status"], "not_run")
        count = self.scalar("SELECT count(*) FROM adapter_operations")
        first = self.client.get(f"/api/v1/runs/{run_id}/events?follow=false")
        self.assertEqual(first.status_code, 200)
        events = [
            json.loads(line[6:]) for line in first.text.splitlines() if line.startswith("data: ")
        ]
        self.assertEqual([e["seq"] for e in events], list(range(1, len(events) + 1)))
        replay = self.client.get(
            f"/api/v1/runs/{run_id}/events?follow=false", headers={"Last-Event-ID": "3"}
        )
        self.assertEqual(
            [
                json.loads(line[6:])["seq"]
                for line in replay.text.splitlines()
                if line.startswith("data: ")
            ],
            list(range(4, len(events) + 1)),
        )
        self.assertEqual(self.scalar("SELECT count(*) FROM adapter_operations"), count)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM adapter_operations WHERE kind='agent.prompt'"), 1
        )
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 0
        )

    def test_events_dedupe_concurrent_producers_and_retention_cursor(self):
        value = self.create()
        run_id = value["run"]["id"]

        def append(_):
            with self.db.transaction() as conn:
                return event(
                    conn,
                    run_id,
                    "fixture.event",
                    {"text": "safe"},
                    source="fixture",
                    source_id="same",
                )

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(append, range(6)))
        self.assertEqual({r["seq"] for r in results}, {3})
        self.assertEqual(
            self.client.get(f"/api/v1/runs/{run_id}/events?follow=false&after_seq=999").status_code,
            422,
        )
        self.assertEqual(
            self.client.get(
                f"/api/v1/runs/{run_id}/events?follow=false", headers={"Last-Event-ID": "bad"}
            ).status_code,
            422,
        )
        with self.db.transaction() as conn:
            conn.execute("DELETE FROM run_events WHERE run_id=%s AND seq<3", (run_id,))
            conn.execute("UPDATE runs SET event_floor=3 WHERE id=%s", (run_id,))
        self.assertEqual(
            self.client.get(f"/api/v1/runs/{run_id}/events?follow=false").status_code, 410
        )
        self.assertEqual(
            self.client.get(f"/api/v1/runs/{run_id}/events?follow=false&after_seq=2").status_code,
            200,
        )

    def test_fake_adapter_replay_cursor_and_observed_release(self):
        value = self.create()
        worker = Worker(self.db)
        worker.run_once()
        with self.db.transaction() as conn:
            run = conn.execute("SELECT * FROM runs WHERE id=%s", (value["run"]["id"],)).fetchone()
            observed = worker.agent.inspect(conn, run)
            self.assertEqual(observed["observed_state"], "completed")
            self.assertEqual(observed["cursor"], run["backend_cursor"])
            self.assertEqual(worker.agent.events(conn, run, run["backend_cursor"]), [])
            self.assertEqual(len(worker.agent.events(conn, run)), 1)
            self.assertEqual(worker.sandbox.inspect(conn, run)["observed_state"], "stopped")
            with self.assertRaises(Problem):
                worker.agent.events(conn, run, "unrecognized-source-cursor")
        self.assertFalse(worker.agent.capabilities()["durable_resume"])
        with self.assertRaises(Problem):
            worker.agent.unsupported("pause")

    def test_queue_survives_new_api_and_separate_worker_process(self):
        value = self.create("restart")
        env = dict(os.environ, DATABASE_URL=URL, APP_ORIGIN=self.settings.origin)
        result = subprocess.run(
            [sys.executable, "-m", "agent_platform.cli", "worker", "--once"],
            env=env,
            capture_output=True,
            text=True,
            timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        fresh = TestClient(create_app(self.settings), base_url=self.settings.origin)
        fresh.cookies.update(self.client.cookies)
        with fresh:
            run = fresh.get(f"/api/v1/runs/{value['run']['id']}").json()
            self.assertEqual(run["state"], "succeeded")
            self.assertEqual(
                fresh.get(f"/api/v1/runs/{run['id']}/events?follow=false").status_code, 200
            )
        self.assertEqual(
            self.scalar("SELECT count(*) FROM adapter_operations WHERE kind='agent.prompt'"), 1
        )

    def test_capacity_four_fifth_queued_and_only_cleanup_returns_slot(self):
        for _ in range(5):
            self.create()
        workers = [Worker(self.db) for _ in range(5)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            claims = list(pool.map(lambda w: w.claim(), workers))
        self.assertEqual(sum(c is not None for c in claims), 4)
        self.assertEqual(self.scalar("SELECT count(*) FROM runs WHERE state='queued'"), 1)
        runtime = Store(self.db).runtime()
        self.assertEqual(runtime["occupied"], 4)
        index = next(i for i, c in enumerate(claims) if c)
        workers[index].execute(claims[index])
        self.assertEqual(Store(self.db).runtime()["occupied"], 3)
        self.assertIsNotNone(Worker(self.db).claim())

    def test_expired_lease_preserves_capacity_and_fences_old_worker(self):
        self.create()
        worker = Worker(self.db)
        claim = worker.claim()
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=%s",
                (claim["job_id"],),
            )
        replacement = Worker(self.db)
        self.assertEqual(replacement.reconcile_expired(), 1)
        self.assertIsNone(replacement.claim())
        with self.assertRaises(Problem) as error:
            worker.execute(claim)
        self.assertEqual(error.exception.code, "worker_lease_lost")
        self.assertEqual(self.scalar("SELECT state FROM runs"), "interrupted")
        self.assertEqual(
            self.scalar("SELECT count(*) FROM resource_reservations WHERE released_at IS NULL"), 1
        )
        self.assertEqual(self.scalar("SELECT count(*) FROM adapter_operations"), 0)

    def test_queued_deadline_and_drain_do_not_allocate(self):
        self.create()
        with self.db.transaction() as conn:
            conn.execute("UPDATE runtime_capacity SET draining=true")
        self.assertIsNone(Worker(self.db).claim())
        with self.db.transaction() as conn:
            conn.execute("UPDATE runtime_capacity SET draining=false")
            conn.execute("UPDATE runs SET deadline=now()-interval '1 second'")
        self.assertTrue(Worker(self.db).run_once())
        self.assertEqual(self.scalar("SELECT state FROM runs"), "failed")
        self.assertEqual(self.scalar("SELECT count(*) FROM sandbox_bindings"), 0)

    def test_pagination_and_authenticated_openapi(self):
        for _ in range(3):
            self.create()
        first = self.client.get("/api/v1/tasks?limit=2").json()
        second = self.client.get(
            "/api/v1/tasks", params={"cursor": first["next_cursor"], "limit": 2}
        ).json()
        self.assertEqual(len({r["id"] for r in first["items"] + second["items"]}), 3)
        self.assertIsNone(second["next_cursor"])
        self.assertEqual(self.client.get("/api/v1/tasks?cursor=bogus").status_code, 422)
        response = self.client.get("/api/v1/openapi.json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("/api/v1/tasks", response.json()["paths"])
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(
            self.client.post(
                "/api/v1/tasks", content=b"x" * 65537, headers=self.headers
            ).status_code,
            413,
        )

    def test_migrations_are_repeatable_and_checksum_guarded(self):
        migrate(URL)
        with self.db.transaction() as conn:
            saved = conn.execute(
                "SELECT sha256 FROM schema_migrations WHERE version='001_control_plane.sql'"
            ).fetchone()["sha256"]
            conn.execute(
                "UPDATE schema_migrations SET sha256='changed' WHERE "
                "version='001_control_plane.sql'"
            )
        try:
            with self.assertRaises(ValueError):
                migrate(URL)
        finally:
            with self.db.transaction() as conn:
                conn.execute(
                    (
                        "UPDATE schema_migrations SET sha256=%s WHERE "
                        "version='001_control_plane.sql'"
                    ),
                    (saved,),
                )


class ConfigurationTests(unittest.TestCase):
    def test_secure_defaults_and_explicit_loopback_http(self):
        settings = Settings("postgresql://example")
        self.assertTrue(settings.secure)
        self.assertTrue(settings.session_cookie.startswith("__Host-"))
        with self.assertRaises(ValueError):
            replace(settings, origin="http://localhost:8000")
        self.assertFalse(
            replace(settings, origin="http://localhost:8000", insecure_local=True).secure
        )
        with self.assertRaises(ValueError):
            replace(settings, origin="http://public.example", insecure_local=True)
        with self.assertRaises(ValueError):
            replace(settings, origin="https://localhost/path")
