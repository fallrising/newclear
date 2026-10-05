"""Single-node operator rehearsal through real CLI processes and loopback HTTP."""

import hashlib
import importlib.util
import json
import os
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import ExitStack, contextmanager
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock
from uuid import uuid4

import httpx
import psycopg
from backup_fixture import NativeClient
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from agent_platform import backup

COMPONENT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "single_node_rehearsal", COMPONENT / "scripts/single-node-rehearsal.py"
)
WRAPPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WRAPPER)


class RehearsalBoundaryTests(unittest.TestCase):
    def test_hostile_ambient_database_provider_and_remote_docker_are_discarded(self):
        env = WRAPPER.scoped_environment(
            {
                "PATH": os.environ["PATH"],
                "HOME": "/fixture-home",
                "DOCKER_CONFIG": "/fixture-config",
                "DATABASE_URL": "postgresql://must-not-connect/real",
                "TEST_DATABASE_URL": "foreign",
                "CONNECTOR_ORIGIN": "https://external.invalid",
                "CONNECTOR_TOKEN": "sentinel",
                "MODEL_PROXY_CONFIG": "/must-not-read",
                "TOOL_BROKER_CONFIG": "/must-not-read",
                "APP_EXPORT_TARGETS": '[{"repo":"live/repo","base_branch":"main"}]',
                "OPENAI_API_KEY": "sentinel",
                "HTTP_PROXY": "https://external.invalid",
                "DOCKER_HOST": "tcp://external.invalid:2376",
                "DOCKER_CONTEXT": "remote",
                "DOCKER_TLS_VERIFY": "1",
                "DOCKER_CERT_PATH": "/must-not-read",
            }
        )
        for name in (
            "DATABASE_URL",
            "TEST_DATABASE_URL",
            "CONNECTOR_ORIGIN",
            "CONNECTOR_TOKEN",
            "MODEL_PROXY_CONFIG",
            "TOOL_BROKER_CONFIG",
            "APP_EXPORT_TARGETS",
            "OPENAI_API_KEY",
            "HTTP_PROXY",
            "DOCKER_CONTEXT",
            "DOCKER_TLS_VERIFY",
            "DOCKER_CERT_PATH",
        ):
            self.assertNotIn(name, env)
        self.assertEqual(env["DOCKER_HOST"], "unix:///var/run/docker.sock")
        self.assertEqual(env["DOCKER_CONFIG"], "/fixture-config")

    def test_non_dedicated_or_overridden_database_refused_before_connection(self):
        with mock.patch.object(psycopg, "connect") as connect:
            for url in (
                None,
                "postgresql://127.0.0.1/production",
                "postgresql://external.invalid/agent_platform_test",
                "host=127.0.0.1 dbname=agent_platform_test hostaddr=203.0.113.1",
            ):
                with self.assertRaisesRegex(ValueError, "^dedicated_test_database_required$"):
                    OwnedDatabases(url)
            connect.assert_not_called()

    def test_existing_output_directory_is_preserved(self):
        with tempfile.TemporaryDirectory(prefix="rehearsal-boundary-") as temporary:
            existing = Path(temporary)
            sentinel = existing / "sentinel"
            sentinel.write_bytes(b"keep original evidence")
            result = subprocess.run(
                [
                    sys.executable,
                    str(COMPONENT / "scripts/single-node-rehearsal.py"),
                    "--directory",
                    str(existing),
                ],
                env=WRAPPER.scoped_environment(os.environ),
                capture_output=True,
                timeout=5,
            )
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stderr, b"single_node_rehearsal_failed\n")
            self.assertEqual(sentinel.read_bytes(), b"keep original evidence")
            self.assertEqual(list(existing.iterdir()), [sentinel])

    def test_readiness_failure_stops_owned_process(self):
        with tempfile.TemporaryDirectory(prefix="rehearsal-boundary-") as temporary:
            with socket.socket() as port:
                port.bind(("127.0.0.1", 0))
                origin = f"http://127.0.0.1:{port.getsockname()[1]}"
                with httpx.Client(base_url=origin, timeout=0.1, trust_env=False) as client:
                    with self.assertRaisesRegex(RuntimeError, "rehearsal_api_not_ready"):
                        with process(
                            [sys.executable, "-c", "import time; time.sleep(60)"],
                            env=WRAPPER.scoped_environment(os.environ),
                            log=Path(temporary) / "child.log",
                        ) as child:
                            wait_api(child, client, timeout=0.15)
                self.assertIsNotNone(child.poll())

    def test_wrapper_sigterm_runs_finally_before_bounded_exit(self):
        with tempfile.TemporaryDirectory(prefix="rehearsal-signal-") as temporary:
            root = Path(temporary)
            fixture = root / "blocked.py"
            fixture.write_text(
                "import importlib.util, pathlib, sys, time\n"
                "root = pathlib.Path(sys.argv[2])\n"
                "spec = importlib.util.spec_from_file_location('rehearsal', sys.argv[1])\n"
                "module = importlib.util.module_from_spec(spec)\n"
                "spec.loader.exec_module(module)\n"
                "def blocked(*args):\n"
                "    try:\n"
                "        (root / 'ready').write_text('ready')\n"
                "        time.sleep(60)\n"
                "    finally:\n"
                "        (root / 'closed').write_text('closed')\n"
                "module.run = blocked\n"
                "sys.argv = ['rehearsal', '--directory', str(root / 'output')]\n"
                "raise SystemExit(module.main())\n"
            )
            with process(
                [
                    sys.executable,
                    str(fixture),
                    str(COMPONENT / "scripts/single-node-rehearsal.py"),
                    str(root),
                ],
                env=WRAPPER.scoped_environment(os.environ),
                log=root / "wrapper.log",
            ) as child:
                deadline = time.monotonic() + 5
                while not (root / "ready").exists() and time.monotonic() < deadline:
                    self.assertIsNone(child.poll())
                    time.sleep(0.02)
                self.assertTrue((root / "ready").exists())
                os.killpg(child.pid, signal.SIGTERM)
                self.assertEqual(child.wait(timeout=5), 130)
            self.assertEqual((root / "closed").read_text(), "closed")

    def test_runner_interrupt_preserves_python_cleanup(self):
        with tempfile.TemporaryDirectory(prefix="rehearsal-signal-") as temporary:
            root = Path(temporary)
            fixture = root / "runner.py"
            fixture.write_text(
                "import pathlib, sys, time\n"
                "root = pathlib.Path(sys.argv[1])\n"
                "try:\n"
                "    (root / 'ready').write_text('ready')\n"
                "    time.sleep(60)\n"
                "finally:\n"
                "    (root / 'closed').write_text('closed')\n"
            )
            with process(
                [sys.executable, str(fixture), str(root)],
                env=WRAPPER.scoped_environment(os.environ),
                log=root / "runner.log",
            ) as child:
                deadline = time.monotonic() + 5
                while not (root / "ready").exists() and time.monotonic() < deadline:
                    self.assertIsNone(child.poll())
                    time.sleep(0.02)
                self.assertTrue((root / "ready").exists())
                WRAPPER.stop_runner(child)
                self.assertIsNotNone(child.poll())
            self.assertEqual((root / "closed").read_text(), "closed")


def dedicated_admin_url(value):
    try:
        settings = conninfo_to_dict(value or "")
        allowed = {
            "host",
            "port",
            "user",
            "password",
            "dbname",
            "sslmode",
            "connect_timeout",
            "application_name",
        }
        if (
            set(settings) - allowed
            or settings.get("dbname") != "agent_platform_test"
            or settings.get("host") not in {"127.0.0.1", "localhost"}
        ):
            raise ValueError()
        return value
    except (ValueError, psycopg.Error):
        raise ValueError("dedicated_test_database_required") from None


class OwnedDatabases:
    def __init__(self, url):
        self.url = dedicated_admin_url(url)
        self.owned = {}

    def create(self, kind):
        name = "ap_rehearsal_" + kind + "_" + uuid4().hex[:12]
        with psycopg.connect(self.url, autocommit=True) as conn:
            if conn.info.dbname != "agent_platform_test":
                raise ValueError("dedicated_test_database_required")
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
            identity = conn.execute(
                "SELECT oid,datdba FROM pg_database WHERE datname=%s "
                "AND datdba=current_user::regrole",
                (name,),
            ).fetchone()
            if identity is None:
                raise ValueError("rehearsal_database_ownership_changed")
            self.owned[name] = identity
        return make_conninfo(**{**conninfo_to_dict(self.url), "dbname": name})

    def close(self):
        with psycopg.connect(self.url, autocommit=True) as conn:
            for name, identity in list(self.owned.items()):
                observed = conn.execute(
                    "SELECT oid,datdba FROM pg_database WHERE datname=%s "
                    "AND datdba=current_user::regrole",
                    (name,),
                ).fetchone()
                if observed != identity:
                    raise ValueError("rehearsal_database_ownership_changed")
                conn.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
                del self.owned[name]


@contextmanager
def process(command, *, env, log):
    with log.open("xb") as output:
        log.chmod(0o600)
        child = subprocess.Popen(
            command,
            cwd=COMPONENT,
            env=env,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            yield child
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=5)


def wait_api(child, client, *, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError("rehearsal_api_exited")
        try:
            if client.get("/api/v1/session", timeout=0.3).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.05)
    raise RuntimeError("rehearsal_api_not_ready")


def close_native(native):
    with mock.patch.dict(os.environ, WRAPPER.scoped_environment(os.environ), clear=True):
        native.close()


class EntryAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attributes):
        values = dict(attributes)
        if tag == "script" and "src" in values:
            self.paths.append(values["src"])
        elif tag == "link" and values.get("rel") == "stylesheet":
            self.paths.append(values["href"])


class SingleNodeDeploymentTests(unittest.TestCase):
    def setUp(self):
        # Absence is an error, including when explicitly selected by the wrapper.
        self.admin_url = dedicated_admin_url(os.environ.get("TEST_DATABASE_URL"))
        output = os.environ.get("AP_REHEARSAL_OUTPUT")
        if output:
            self.root = Path(output)
        else:
            temporary = tempfile.TemporaryDirectory(prefix="single-node-test-")
            self.addCleanup(temporary.cleanup)
            self.root = Path(temporary.name)
        self.work = self.root / ("case-" + uuid4().hex[:12])
        self.work.mkdir(mode=0o700)
        self.sequence = 0
        self.password = secrets.token_urlsafe(32)
        self.password_file = self.work / "bootstrap-password"
        self.password_file.write_text(self.password + "\n")
        self.password_file.chmod(0o600)
        self.databases = OwnedDatabases(self.admin_url)
        self.addCleanup(self.databases.close)
        self.source = self.databases.create("source")
        self.target = self.databases.create("restore")
        self.target_name = conninfo_to_dict(self.target)["dbname"]
        with socket.socket() as port:
            port.bind(("127.0.0.1", 0))
            self.port = port.getsockname()[1]
        self.origin = f"http://127.0.0.1:{self.port}"
        self.client = httpx.Client(base_url=self.origin, timeout=5, trust_env=False)
        self.addCleanup(self.client.close)
        web_dist = os.environ.get("AP_REHEARSAL_WEB_DIST")
        self.web_mode = "built-dist" if web_dist else "minimal-static-fixture"
        self.web_dist = Path(web_dist) if web_dist else self.work / "web"
        if not web_dist:
            (self.web_dist / "assets").mkdir(parents=True)
            (self.web_dist / "index.html").write_text(
                "<!doctype html><title>Single-node rehearsal</title>"
                '<script type="module" src="/assets/fixture.js"></script>'
            )
            (self.web_dist / "assets/fixture.js").write_text('document.title="Rehearsal";')
        self.assertTrue((self.web_dist / "index.html").is_file())

    def log(self, name):
        self.sequence += 1
        return self.work / f"{self.sequence:02}-{name}.log"

    def env(self, url):
        env = WRAPPER.scoped_environment(os.environ)
        env.update(APP_ORIGIN=self.origin, APP_INSECURE_LOCAL="1")
        if url:
            env["DATABASE_URL"] = url
        return env

    def cli(self, *arguments, url=None):
        with process(
            [sys.executable, "-m", "agent_platform.cli", *arguments],
            env=self.env(url),
            log=self.log(arguments[0]),
        ) as child:
            try:
                result = child.wait(timeout=45)
            except subprocess.TimeoutExpired:
                raise RuntimeError("rehearsal_cli_timeout") from None
            self.assertEqual(result, 0, "CLI process failed; inspect private fixture log")

    @contextmanager
    def api(self, url):
        with process(
            [
                sys.executable,
                "-m",
                "agent_platform.cli",
                "api",
                "--host",
                "127.0.0.1",
                "--port",
                str(self.port),
                "--web-dist",
                str(self.web_dist),
            ],
            env=self.env(url),
            log=self.log("api"),
        ) as child:
            wait_api(child, self.client)
            yield child

    def login(self):
        csrf = self.client.get("/api/v1/session").json()["csrf_token"]
        response = self.client.post(
            "/api/v1/session",
            json={
                "username": "rehearsal-operator",
                "password": self.password,
            },
            headers={"Origin": self.origin, "X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 200)
        self.csrf = response.json()["csrf_token"]

    def post(self, route, value, status, *, key=None):
        response = self.client.post(
            "/api/v1" + route,
            json=value,
            headers={
                "Origin": self.origin,
                "X-CSRF-Token": self.csrf,
                "Idempotency-Key": key or uuid4().hex,
            },
        )
        self.assertEqual(response.status_code, status)
        return response.json()

    def get(self, route):
        response = self.client.get("/api/v1" + route)
        self.assertEqual(response.status_code, 200)
        return response

    def snapshot(self, url):
        digest = hashlib.sha256()
        with psycopg.connect(url) as conn:
            tables = conn.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
            ).fetchall()
            for (name,) in tables:
                if name in {*backup.EPHEMERAL, "maintenance_identity"}:
                    continue
                digest.update(name.encode())
                for (row,) in conn.execute(
                    sql.SQL(
                        "SELECT row_to_json(t)::text FROM {} t ORDER BY row_to_json(t)::text"
                    ).format(sql.Identifier(name))
                ):
                    digest.update(row.encode())
                    digest.update(b"\n")
        return digest.hexdigest()

    def counts(self, url):
        with psycopg.connect(url) as conn:
            return dict(
                conn.execute(
                    "SELECT 'runs',count(*) FROM runs UNION ALL "
                    "SELECT 'provider_prompts',count(*) FROM adapter_operations "
                    "WHERE kind='agent.prompt' UNION ALL "
                    "SELECT 'conversations',count(*) FROM adapter_operations "
                    "WHERE kind='agent.create' UNION ALL "
                    "SELECT 'local_mock_messages',count(*) FROM run_events "
                    "WHERE source='local-mock' AND type='message.created' UNION ALL "
                    "SELECT 'job_attempts',coalesce(sum(attempts),0) FROM jobs UNION ALL "
                    "SELECT 'events',count(*) FROM run_events"
                ).fetchall()
            )

    def test_real_process_restart_and_native_restore(self):
        with ExitStack() as resources:
            self.cli("migrate", url=self.source)
            self.cli(
                "bootstrap",
                "--username",
                "rehearsal-operator",
                "--password-file",
                str(self.password_file),
                url=self.source,
            )
            with self.api(self.source):
                home = self.client.get("/")
                self.assertEqual(home.status_code, 200)
                self.assertEqual(home.content, (self.web_dist / "index.html").read_bytes())
                assets = EntryAssets()
                assets.feed(home.text)
                self.assertGreater(len(assets.paths), 0)
                for asset in assets.paths:
                    self.assertTrue(asset.startswith("/assets/") and ".." not in asset)
                    response = self.client.get(asset)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(
                        response.content, (self.web_dist / asset.lstrip("/")).read_bytes()
                    )
                self.login()
                self.assertEqual(self.client.post("/api/v1/projects", json={}).status_code, 403)
                project = self.post(
                    "/projects",
                    {
                        "name": "Rehearsal",
                        "canonical_repo": "https://example.invalid/rehearsal/fixture",
                    },
                    201,
                )
                profile = self.post("/agent-profiles", {"name": "Local deterministic fixture"}, 201)
                payload = {
                    "title": "Persist across restart",
                    "goal": "FILE note.txt\nTEXT durable rehearsal",
                    "project_id": project["id"],
                    "profile_revision": profile["id"],
                    "base_sha": "a" * 40,
                }
                key = uuid4().hex
                created = self.post("/tasks", payload, 202, key=key)
                run_id = created["run"]["id"]
                self.cli("worker", "--once", url=self.source)
                run = self.get(f"/runs/{run_id}").json()
                self.assertEqual(run["state"], "succeeded")
                self.assertEqual(run["cleanup_state"], "confirmed")
                self.assertEqual(run["result"]["execution_mode"], "local-mock")
                self.assertEqual(run["result"]["verification"]["status"], "passed")
                archive = self.get(f"/runs/{run_id}/artifacts").json()["items"][0]
                path = f"/runs/{run_id}/artifacts/{archive['id']}"
                original = self.get(path).content
                self.assertEqual(hashlib.sha256(original).hexdigest(), archive["sha256"])
                events = self.get(f"/runs/{run_id}/events?follow=false").content
                task = self.get(f"/tasks/{created['task']['id']}").json()
                counts = self.counts(self.source)
                for name in ("runs", "conversations", "local_mock_messages", "job_attempts"):
                    self.assertEqual(counts[name], 1, name)
                self.assertEqual(counts["provider_prompts"], 0)
                self.assertGreater(counts["events"], 0)
            # Independent fresh API and worker processes use the same durable source database.
            with self.api(self.source):
                self.assertEqual(self.get(f"/runs/{run_id}").json(), run)
                self.assertEqual(self.get(f"/tasks/{created['task']['id']}").json(), task)
                self.assertEqual(self.get(path).content, original)
                self.assertEqual(self.get(f"/runs/{run_id}/events?follow=false").content, events)
                self.assertEqual(self.post("/tasks", payload, 202, key=key), created)
                self.cli("worker", "--once", url=self.source)
                self.assertEqual(self.counts(self.source), counts)
                old_session = self.client.cookies.get("ap-session-local")
                self.assertIsNotNone(old_session)
            # No API or worker is alive here; only the documented administrative drain changes.
            with psycopg.connect(self.source) as conn:
                conn.execute("UPDATE runtime_capacity SET draining=true")
                identity = conn.execute("SELECT id FROM maintenance_identity").fetchone()[0]
            before = self.snapshot(self.source)
            bundle = self.work / "backup"
            with mock.patch.dict(os.environ, WRAPPER.scoped_environment(os.environ), clear=True):
                native = NativeClient(self.source)
                resources.callback(close_native, native)
                with mock.patch.object(backup, "_run_native", side_effect=native.run):
                    saved = backup.create_backup(self.source, bundle, offline=True)
                    verified = backup.verify_backup(bundle)
                    self.assertEqual(verified["dump_sha256"], saved["dump_sha256"])
                    restored = backup.restore_backup(
                        self.target, bundle, offline=True, confirm_database=self.target_name
                    )
                    self.assertEqual(restored["status"], "restored")
                native.close()
            self.cli("backup-verify", "--directory", str(bundle))
            self.assertEqual(self.snapshot(self.source), before)
            self.assertEqual(self.snapshot(self.target), before)
            self.assertEqual(self.counts(self.target), counts)
            with psycopg.connect(self.target) as conn:
                self.assertNotEqual(
                    conn.execute("SELECT id FROM maintenance_identity").fetchone()[0], identity
                )
                drained = conn.execute(
                    "SELECT count(*) FROM runtime_capacity WHERE draining"
                ).fetchone()[0]
                self.assertEqual(
                    drained, conn.execute("SELECT count(*) FROM runtime_capacity").fetchone()[0]
                )
                for name in backup.EPHEMERAL:
                    self.assertEqual(
                        conn.execute(
                            sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(name))
                        ).fetchone()[0],
                        0,
                    )
            with self.api(self.target):
                stale = self.client.get(
                    "/api/v1/tasks",
                    headers={
                        "Cookie": "ap-session-local=" + old_session,
                    },
                )
                self.assertEqual(stale.status_code, 401)
                self.login()
                self.assertNotEqual(self.client.cookies.get("ap-session-local"), old_session)
                self.assertEqual(self.get(f"/runs/{run_id}").json(), run)
                self.assertEqual(self.get(f"/tasks/{created['task']['id']}").json(), task)
                self.assertEqual(self.get(path).content, original)
                self.assertEqual(self.get(f"/runs/{run_id}/events?follow=false").content, events)
            self.databases.close()
            self.assertEqual(self.databases.owned, {})
            evidence = {
                "schema_version": "single-node-rehearsal-v1",
                "status": "passed",
                "checks": [
                    "cli_migrate",
                    "cli_bootstrap",
                    "tcp_static_and_api",
                    "session_csrf",
                    "independent_worker",
                    "mock_result_archive",
                    "api_worker_restart",
                    "no_duplicate_dispatch",
                    "offline_native_backup_restore",
                    "cli_backup_verify",
                    "source_unchanged",
                    "durable_history_identical",
                    "old_session_rejected",
                    "fresh_login",
                    "fresh_maintenance_identity",
                    "runtime_drained",
                    "owned_databases_removed",
                    "owned_client_removed",
                    "owned_processes_stopped",
                ],
                "web_mode": self.web_mode,
                "web_entry_sha256": hashlib.sha256(home.content).hexdigest(),
                "web_asset_count": len(assets.paths),
                "archive_sha256": archive["sha256"],
                "archive_bytes": len(original),
                "dump_sha256": saved["dump_sha256"],
                "counts": counts,
                "drained_nodes": drained,
                "native_transport": "real pg_dump/pg_restore in owned PostgreSQL18 "
                "client container; "
                "test-only backup runner injection, not installed-host backup CLI acceptance",
                "limits": [
                    "loopback HTTP only",
                    "fake backend",
                    "no external provider/export",
                    "no VM/KVM or deployed database",
                    "no TLS or service-manager acceptance",
                ],
            }
            output = self.root / "evidence.json"
            with output.open("x") as stream:
                output.chmod(0o600)
                json.dump(evidence, stream, indent=2)
                stream.write("\n")


if __name__ == "__main__":
    unittest.main()
