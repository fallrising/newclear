"""Actual TCP/HTTP delivery across API, PostgreSQL and a separate worker process."""

import json
import os
import socket
import subprocess
import sys
import threading
import time

import httpx
import test_control_plane as base
import uvicorn

from agent_platform.api import create_app
from agent_platform.config import Settings


class HttpStreamTests(base.PlatformFixture):
    def test_live_commit_reconnect_and_session_revocation(self):
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        origin = f"http://127.0.0.1:{listener.getsockname()[1]}"
        settings = Settings(base.URL, origin=origin, insecure_local=True, stream_seconds=10)
        server = uvicorn.Server(
            uvicorn.Config(create_app(settings, self.db), log_level="error", lifespan="on")
        )
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        try:
            deadline = time.monotonic() + 5
            while not server.started:
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.01)
            with httpx.Client(base_url=origin, timeout=5) as client:
                csrf = client.get("/api/v1/session").json()["csrf_token"]
                login = client.post(
                    "/api/v1/session",
                    json={"username": "operator", "password": self.password},
                    headers={"Origin": origin, "X-CSRF-Token": csrf},
                )
                self.assertEqual(login.status_code, 200)
                headers = {"Origin": origin, "X-CSRF-Token": login.json()["csrf_token"]}
                created = client.post(
                    "/api/v1/tasks",
                    json=self.payload,
                    headers={**headers, "Idempotency-Key": "http-task"},
                )
                self.assertEqual(created.status_code, 202)
                run_id = created.json()["run"]["id"]
                with client.stream("GET", f"/api/v1/runs/{run_id}/events") as stream:
                    self.assertEqual(stream.status_code, 200)
                    lines = stream.iter_lines()
                    initial = []
                    while len(initial) < 2:
                        line = next(lines)
                        if line.startswith("data: "):
                            initial.append(json.loads(line[6:]))
                    self.assertEqual([row["seq"] for row in initial], [1, 2])
                    env = dict(
                        os.environ, DATABASE_URL=base.URL, APP_ORIGIN=origin, APP_INSECURE_LOCAL="1"
                    )
                    process = subprocess.run(
                        [sys.executable, "-m", "agent_platform.cli", "worker", "--once"],
                        env=env,
                        capture_output=True,
                        timeout=15,
                    )
                    self.assertEqual(process.returncode, 0, process.stderr.decode())
                    live = None
                    while live is None:
                        line = next(lines)
                        if line.startswith("data: "):
                            live = json.loads(line[6:])
                    self.assertEqual(live["seq"], 3)
                replay = client.get(
                    f"/api/v1/runs/{run_id}/events?follow=false", headers={"Last-Event-ID": "3"}
                )
                rows = [
                    json.loads(line[6:])
                    for line in replay.text.splitlines()
                    if line.startswith("data: ")
                ]
                self.assertEqual(rows[0]["seq"], 4)
                self.assertEqual(rows[-1]["type"], "runtime.cleaned")
                count = self.scalar(
                    "SELECT count(*) FROM adapter_operations WHERE kind='agent.prompt'"
                )
                self.assertEqual(count, 1)
                with client.stream(
                    "GET", f"/api/v1/runs/{run_id}/events?after_seq={rows[-1]['seq']}"
                ) as stream:
                    lines = stream.iter_lines()
                    self.assertEqual(next(lines), ": keepalive")
                    self.assertEqual(
                        client.delete("/api/v1/session", headers=headers).status_code, 204
                    )
                    self.assertIn("event: session_expired", list(lines))
                self.assertEqual(client.get(f"/api/v1/runs/{run_id}").status_code, 401)
        finally:
            server.should_exit = True
            thread.join(timeout=5)
            listener.close()
            self.assertFalse(thread.is_alive(), "HTTP test server failed to stop")
