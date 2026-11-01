#!/usr/bin/env python3
"""Run the ClickHouse driver, PromQL corpus, and daemon query acceptance.

PRISM_CLICKHOUSE_TEST_DSN may point at a separately managed loopback fixture.
Otherwise this script creates and removes one labelled disposable container.
Every Go test creates and drops only its own isolated database. The daemon
binary is built into a temporary directory for the core-chain test.
"""

import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit


IMAGE = "clickhouse/clickhouse-server@sha256:b002e56ed5c16e224c312527f6fcba7e77216fec5d7a88a7828f59efc614feb5"
USER = "prism"
PASSWORD = "local-public-fixture"  # Public, disposable test credential.
LABEL = "dev.prism.integration-fixture"
TIMEOUT = 180


def docker_argv(*args):
    # Ignore a saved remote Docker context as well as environment selectors.
    return ["docker", "--host=unix:///var/run/docker.sock", *args]


def run(argv, *, env=None, timeout=TIMEOUT, capture=True, cwd=None):
    return subprocess.run(
        argv, env=env, timeout=timeout, check=True, cwd=cwd,
        text=True, stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )


def docker_env():
    env = os.environ.copy()
    for key in (
        "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY",
        "DOCKER_CERT_PATH", "DOCKER_API_VERSION", "DOCKER_TLS",
    ):
        # The registry's Docker config remains available. Only connection
        # selectors are removed; registry auth/proxy settings are retained.
        env.pop(key, None)
    return env


def assert_loopback(dsn):
    parsed = urlsplit(dsn)
    if parsed.scheme != "clickhouse" or parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("fixture DSN must use a native ClickHouse loopback endpoint")
    if not parsed.port or not parsed.path or parsed.path == "/":
        raise ValueError("fixture DSN needs a port and database")


def wait_ready(name, port, env, test_env, module):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=2):
                pass
            # A listening socket alone can precede server query readiness.
            version = run(docker_argv("exec", name, "clickhouse-client", "--user", USER,
                                      "--password", PASSWORD, "--query", "SELECT version()"),
                          env=env, timeout=10).stdout.strip()
            # Docker's published socket can accept TCP before forwarding a
            # complete native handshake. Probe the exact endpoint Go will use.
            run(["go", "test", "-tags=integration", "-count=1", "-run",
                 "^TestClickHouseFixtureReady$", "./drivers/clickhouse"],
                env=test_env, timeout=25, cwd=module)
            return version
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            time.sleep(1)
    raise TimeoutError("disposable ClickHouse did not become query-ready")


def inspect_owned(name, env):
    try:
        result = run(docker_argv("inspect", "--format",
                                 f'{{{{.Id}}}}|{{{{index .Config.Labels "{LABEL}"}}}}', name),
                     env=env, timeout=10).stdout.strip()
    except subprocess.CalledProcessError as exc:
        expected = {f"error: no such {kind}: {name}".casefold()
                    for kind in ("object", "container")}
        if (exc.returncode == 1 and isinstance(exc.stdout, str)
                and not exc.stdout.strip() and isinstance(exc.stderr, str)
                and exc.stderr.strip().casefold() in expected):
            return None
        raise
    identifier, sep, label = result.partition("|")
    if not sep or not re.fullmatch(r"[0-9a-f]{64}", identifier):
        raise RuntimeError("owned fixture inspection returned an invalid identity")
    return identifier, label


def remove_owned(name, env, captured_id):
    observed = inspect_owned(name, env)
    if observed is None:
        if captured_id is not None and inspect_owned(captured_id, env) is not None:
            raise RuntimeError("captured fixture ID remains after name disappeared")
        return captured_id or "none"
    identifier, label = observed
    if label != "true" or captured_id is not None and identifier != captured_id:
        raise RuntimeError("fixture identity or ownership label changed before cleanup")
    run(docker_argv("rm", "-f", identifier), env=env, timeout=30)
    if inspect_owned(name, env) is not None or inspect_owned(identifier, env) is not None:
        raise RuntimeError("owned fixture remains after cleanup")
    return identifier


def run_suite(test_env, module):
    test_env = {**test_env, "GOTOOLCHAIN": "go1.27.1", "GOFLAGS": "-mod=readonly"}
    run(["go", "test", "-tags=integration", "-count=1", "-run",
         "^TestClickHouseFixtureReady$", "./drivers/clickhouse"],
        env=test_env, timeout=30, cwd=module, capture=False)
    run(["go", "test", "-tags=integration", "-race", "-count=1", "-v",
         "-run", "^TestClickHouse", "./drivers/clickhouse"],
        env=test_env, timeout=600, cwd=module, capture=False)
    run(["go", "test", "-tags=integration", "-race", "-count=1", "-v",
         "-timeout=20m",
         "./test/promqltest", "-driver=clickhouse"],
        env=test_env, timeout=1500, cwd=module, capture=False)
    with tempfile.TemporaryDirectory(prefix="prism-ch-daemon-") as tmp:
        binary = str(Path(tmp) / "prismd")
        run(["go", "build", "-o", binary, "./cmd/prismd"],
            env=test_env, timeout=180, cwd=module, capture=False)
        run(["go", "test", "-tags=integration", "-race", "-count=1", "-v",
             "-run", "^TestClickHouseDaemonCoreChain$", "./test/e2e"],
            env={**test_env, "PRISMD_BINARY": binary}, timeout=180,
            cwd=module, capture=False)


def main():
    module = Path(__file__).resolve().parents[2]
    test_env = os.environ.copy()
    supplied = test_env.get("PRISM_CLICKHOUSE_TEST_DSN")
    if supplied:
        assert_loopback(supplied)
        run_suite(test_env, module)
        print("fixture=caller-owned version=native-readiness-passed cleanup=caller-owned")
        return

    docker = docker_env()
    name = "prism-ch-integration-" + secrets.token_hex(8)
    captured_id = None
    version = "unknown"
    with tempfile.TemporaryDirectory(prefix="prism-ch-integration-") as tmp:
        config = Path(tmp) / "bounds.xml"
        config.write_text("<clickhouse><background_schedule_pool_size>16</background_schedule_pool_size>"
                          "<background_pool_size>16</background_pool_size>"
                          "<background_message_broker_schedule_pool_size>4</background_message_broker_schedule_pool_size>"
                          "<background_distributed_schedule_pool_size>4</background_distributed_schedule_pool_size>"
                          "<max_thread_pool_size>512</max_thread_pool_size></clickhouse>\n", encoding="utf-8")
        query_config = Path(tmp) / "query-bounds.xml"
        query_config.write_text("<clickhouse><profiles><default><max_threads>2</max_threads>"
                                "<log_query_settings>1</log_query_settings></default></profiles></clickhouse>\n",
                                encoding="utf-8")
        try:
            created = run(docker_argv("run", "-d", "--name", name, "--label", f"{LABEL}=true",
                 "--cpus", "2", "--memory", "2g", "--pids-limit", "1024",
                 "--publish", "127.0.0.1::9000", "--env", f"CLICKHOUSE_USER={USER}",
                 "--env", f"CLICKHOUSE_PASSWORD={PASSWORD}",
                 "--env", "CLICKHOUSE_DB=prism",
                 "--mount", f"type=bind,src={config},dst=/etc/clickhouse-server/config.d/prism-bounds.xml,readonly",
                 "--mount", f"type=bind,src={query_config},dst=/etc/clickhouse-server/users.d/prism-query-bounds.xml,readonly",
                 IMAGE), env=docker, timeout=120).stdout.strip()
            if not re.fullmatch(r"[0-9a-f]{64}", created):
                raise RuntimeError("Docker did not return a fixture container ID")
            captured_id = created
            address = run(docker_argv("port", name, "9000/tcp"), env=docker, timeout=10).stdout.strip()
            host, port_text = address.rsplit(":", 1)
            if host not in ("127.0.0.1", "::1"):
                raise RuntimeError("Docker published fixture outside loopback")
            port = int(port_text)
            test_env["PRISM_CLICKHOUSE_TEST_DSN"] = f"clickhouse://{USER}:{PASSWORD}@127.0.0.1:{port}/prism"
            test_env["GOTOOLCHAIN"] = "go1.27.1"
            test_env["GOFLAGS"] = "-mod=readonly"
            version = wait_ready(name, port, docker, test_env, module)
            run_suite(test_env, module)
        finally:
            # A timed-out `docker run` may have created the container. Resolve
            # only our random name, verify label and captured ID, then remove
            # that exact ID and prove both name and ID are absent.
            cleaned_id = remove_owned(name, docker, captured_id)
            print(f"fixture=runner-owned id={cleaned_id} name={name} "
                  f"version={version} cleaned=true")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, TimeoutError,
            subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        # Never print an exception carrying a DSN or command arguments.
        print(f"ClickHouse integration runner failed ({type(exc).__name__})", file=sys.stderr)
        sys.exit(1)
