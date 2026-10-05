#!/usr/bin/env python3
"""Run the real ClickHouse write acceptance against an owned local fixture.

PRISM_CLICKHOUSE_TEST_DSN may point at a separately managed loopback fixture.
Otherwise this script creates and removes one labelled disposable container.
"""

import os
from pathlib import Path
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


def run(argv, *, env=None, timeout=TIMEOUT, capture=True):
    return subprocess.run(
        argv, env=env, timeout=timeout, check=True,
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


def wait_ready(name, port, env, test_env):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=2):
                pass
            # A listening socket alone can precede server query readiness.
            run(docker_argv("exec", name, "clickhouse-client", "--user", USER,
                            "--password", PASSWORD, "--query", "SELECT version()"),
                env=env, timeout=10)
            # Docker's published socket can accept TCP before forwarding a
            # complete native handshake. Probe the exact endpoint Go will use.
            run(["go", "test", "-tags=integration", "-count=1", "-run",
                 "^TestClickHouseFixtureReady$", "./drivers/clickhouse"],
                env=test_env, timeout=25)
            return
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            time.sleep(1)
    raise TimeoutError("disposable ClickHouse did not become query-ready")


def main():
    module = Path(__file__).resolve().parents[2]
    test_env = os.environ.copy()
    supplied = test_env.get("PRISM_CLICKHOUSE_TEST_DSN")
    if supplied:
        assert_loopback(supplied)
        run(["go", "test", "-tags=integration", "-race", "-count=1", "-v",
             "-run", "TestClickHouse", "./drivers/clickhouse"],
            env={**test_env, "GOTOOLCHAIN": "go1.27.1", "GOFLAGS": "-mod=readonly"},
            timeout=300, capture=False)
        return

    docker = docker_env()
    name = "prism-ch-integration-" + secrets.token_hex(8)
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
            run(docker_argv("run", "-d", "--name", name, "--label", f"{LABEL}=true",
                 "--cpus", "2", "--memory", "2g", "--pids-limit", "1024",
                 "--publish", "127.0.0.1::9000", "--env", f"CLICKHOUSE_USER={USER}",
                 "--env", f"CLICKHOUSE_PASSWORD={PASSWORD}",
                 "--env", "CLICKHOUSE_DB=prism",
                 "--mount", f"type=bind,src={config},dst=/etc/clickhouse-server/config.d/prism-bounds.xml,readonly",
                 "--mount", f"type=bind,src={query_config},dst=/etc/clickhouse-server/users.d/prism-query-bounds.xml,readonly",
                 IMAGE), env=docker, timeout=120)
            address = run(docker_argv("port", name, "9000/tcp"), env=docker, timeout=10).stdout.strip()
            host, port_text = address.rsplit(":", 1)
            if host not in ("127.0.0.1", "::1"):
                raise RuntimeError("Docker published fixture outside loopback")
            port = int(port_text)
            test_env["PRISM_CLICKHOUSE_TEST_DSN"] = f"clickhouse://{USER}:{PASSWORD}@127.0.0.1:{port}/prism"
            test_env["GOTOOLCHAIN"] = "go1.27.1"
            test_env["GOFLAGS"] = "-mod=readonly"
            wait_ready(name, port, docker, test_env)
            run(["go", "test", "-tags=integration", "-race", "-count=1", "-v",
                 "-run", "TestClickHouse", "./drivers/clickhouse"],
                env=test_env, timeout=300, capture=False)
        finally:
            # `docker run` may create the container before its response times
            # out. Inspect the exact random name and label before removal.
            try:
                owned = run(docker_argv("inspect", "--format", f"{{{{index .Config.Labels \"{LABEL}\"}}}}", name),
                            env=docker, timeout=10).stdout.strip()
                if owned == "true":
                    run(docker_argv("rm", "-f", name), env=docker, timeout=30)
            except subprocess.CalledProcessError:
                pass  # No container was created under our generated name.
            except subprocess.TimeoutExpired:
                print("warning: owned fixture cleanup timed out", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, TimeoutError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        # Never print an exception carrying a DSN or command arguments.
        print(f"ClickHouse integration runner failed ({type(exc).__name__})", file=sys.stderr)
        sys.exit(1)
