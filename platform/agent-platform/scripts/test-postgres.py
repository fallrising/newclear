#!/usr/bin/env python3
"""Run platform acceptance on a fresh, task-owned PostgreSQL container; always remove it."""

import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

IMAGE = "postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873"


def main():
    name = "agent-platform-m1-test-" + uuid.uuid4().hex[:12]
    with tempfile.TemporaryDirectory(prefix="agent-platform-pg-") as temporary:
        root = Path(temporary)
        password = secrets.token_urlsafe(32)
        envfile = root / "postgres.env"
        envfile.write_text(
            f"POSTGRES_USER=agent_platform\nPOSTGRES_DB=agent_platform_test\nPOSTGRES_PASSWORD={password}\n"
        )
        envfile.chmod(0o600)
        created = False
        try:
            subprocess.run(
                [
                    "docker",
                    "run",
                    "--detach",
                    "--name",
                    name,
                    "--label",
                    "newclear.agent-platform=m1-integration",
                    "--memory=1g",
                    "--cpus=2",
                    "--pids-limit=256",
                    "--tmpfs",
                    "/var/lib/postgresql:rw,size=512m",
                    "--env-file",
                    str(envfile),
                    "--publish",
                    "127.0.0.1::5432",
                    IMAGE,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
            )
            created = True
            config = json.loads(subprocess.check_output(["docker", "inspect", name]))[0]
            port = config["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostPort"]
            deadline = time.monotonic() + 45
            while subprocess.run(
                [
                    "docker",
                    "exec",
                    name,
                    "pg_isready",
                    "-U",
                    "agent_platform",
                    "-d",
                    "agent_platform_test",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            ).returncode:
                if time.monotonic() >= deadline:
                    raise RuntimeError("Test PostgreSQL did not become ready")
                time.sleep(0.5)
            env = dict(
                os.environ,
                TEST_DATABASE_URL=f"postgresql://agent_platform:{password}@127.0.0.1:{port}/agent_platform_test",
            )
            return subprocess.run(
                sys.argv[1:]
                or [sys.executable, "-m", "unittest", "discover", "-s", "tests_platform", "-v"],
                env=env,
            ).returncode
        finally:
            if created:
                label = subprocess.check_output(
                    [
                        "docker",
                        "inspect",
                        "--format",
                        '{{index .Config.Labels "newclear.agent-platform"}}',
                        name,
                    ],
                    text=True,
                ).strip()
                if label != "m1-integration":
                    raise RuntimeError("Test container ownership changed; refusing removal")
                subprocess.run(
                    ["docker", "rm", "--force", "--volumes", name],
                    check=True,
                    stdout=subprocess.DEVNULL,
                )
                print("Owned PostgreSQL test container removed", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
