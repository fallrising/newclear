#!/usr/bin/env python3
"""Own a fresh loopback PostgreSQL/browser namespace for one review attempt."""

import argparse
import datetime
import hashlib
import json
import os
import re
import secrets
import signal
import stat
import subprocess
import tempfile
import time
from pathlib import Path

PG_IMAGE = "postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873"


def private_parent(value, checkout):
    path = Path(value).absolute()
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError("STATE_SYMLINK_REJECTED")
    resolved = path.resolve()
    if resolved == checkout or checkout in resolved.parents:
        raise ValueError("STATE_INSIDE_CHECKOUT_REJECTED")
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise ValueError("STATE_OWNER_REJECTED")
    if stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError("STATE_MODE_REJECTED")
    return path


def confirm_absent(names, inventory):
    if inventory.returncode != 0:
        raise RuntimeError("CLEANUP_INVENTORY_UNKNOWN")
    if set(names).intersection(inventory.stdout.splitlines()):
        raise RuntimeError("OWNED_CONTAINER_REMAINS")


def scrub_log(text, secret_values):
    found = False
    for value in secret_values:
        if value and value in text:
            found = True
            text = text.replace(value, "[REDACTED]")
    return text, found


def cleanup_owned(names, invoke):
    errors = []
    for name in reversed(names):
        for action, command in (
            ("stop", ["docker", "stop", "--time", "10", name]),
            ("remove", ["docker", "rm", "-f", "-v", name]),
        ):
            try:
                invoke(command, timeout=15, check=False)
            except (OSError, subprocess.TimeoutExpired):
                errors.append(action + "_unknown")
    try:
        inventory = invoke(["docker", "ps", "-a", "--format", "{{.Names}}"], check=False)
        confirm_absent(names, inventory)
        return True, errors
    except (OSError, subprocess.TimeoutExpired, RuntimeError):
        return False, errors + ["inventory_unconfirmed"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-root", required=True)
    parser.add_argument("--browser-cache", required=True)
    parser.add_argument("--image", default="fe-review-agent-platform:20261024")
    parser.add_argument("--mode", choices=("probe", "capture"), default="capture")
    args = parser.parse_args()
    os.umask(0o077)
    component = Path(__file__).resolve().parents[1]
    checkout = component.parents[1]
    parent = private_parent(args.state_root, checkout)
    browser_cache = Path(args.browser_cache).resolve(strict=True)
    run_id = (
        datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(4)
    )
    assert re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}", run_id)
    private = Path(tempfile.mkdtemp(prefix=run_id + "-", dir=parent))
    fixture = private / "fixture"
    fixture.mkdir(mode=0o700)
    mount_point = component / ".artifacts"
    if mount_point.is_symlink():
        raise ValueError("FIXTURE_MOUNT_SYMLINK_REJECTED")
    mount_point.mkdir(exist_ok=True)
    output = component / "fe-review" / "runs" / run_id
    output.mkdir(parents=True, mode=0o700)
    pg_name, browser_name = "fe2-ap-pg-" + run_id, "fe2-ap-browser-" + run_id
    names = [pg_name, browser_name]
    password = secrets.token_hex(32)
    environment = os.environ.copy()
    environment.update(
        POSTGRES_USER="agent_platform",
        POSTGRES_DB="agent_platform_test",
        POSTGRES_PASSWORD=password,
        TEST_DATABASE_URL="postgresql://agent_platform:"
        + password
        + "@127.0.0.1:5432/agent_platform_test",
    )
    receipt = {
        "runId": run_id,
        "mode": args.mode,
        "postgresImage": PG_IMAGE,
        "status": "failed",
        "ownedContainersRemoved": False,
        "runnerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "privateArtifactsRetained": True,
        "source": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=checkout, text=True
        ).strip(),
    }
    started = time.monotonic()
    code = 1

    def call(command, timeout=30, check=True):
        result = subprocess.run(
            command, env=environment, capture_output=True, text=True, timeout=timeout
        )
        if check and result.returncode:
            text, _ = scrub_log(result.stdout + result.stderr, [password])
            (private / "setup.log").write_text(text)
            raise RuntimeError("COMMAND_FAILED")
        return result

    def interrupted(_signum, _frame):
        raise InterruptedError("OWNED_RUN_INTERRUPTED")

    previous = signal.signal(signal.SIGTERM, interrupted)
    try:
        pg_uid = call(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--entrypoint",
                "id",
                PG_IMAGE,
                "-u",
                "postgres",
            ]
        ).stdout.strip()
        pg_gid = call(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--entrypoint",
                "id",
                PG_IMAGE,
                "-g",
                "postgres",
            ]
        ).stdout.strip()
        assert pg_uid.isdecimal() and pg_gid.isdecimal()
        receipt["phase"] = "postgres_start"
        call(
            [
                "docker",
                "run",
                "-d",
                "--name",
                pg_name,
                "--network",
                "none",
                "--cap-drop",
                "ALL",
                "--security-opt",
                "no-new-privileges",
                "--user",
                pg_uid + ":" + pg_gid,
                "--tmpfs",
                "/var/lib/postgresql:rw,nosuid,uid="
                + pg_uid
                + ",gid="
                + pg_gid
                + ",mode=0700,size=512m",
                "-e",
                "POSTGRES_USER",
                "-e",
                "POSTGRES_DB",
                "-e",
                "POSTGRES_PASSWORD",
                PG_IMAGE,
                "postgres",
                "-c",
                "listen_addresses=127.0.0.1",
            ]
        )
        receipt["phase"] = "postgres_readiness"
        for _ in range(80):
            ready = call(
                [
                    "docker",
                    "exec",
                    pg_name,
                    "pg_isready",
                    "-h",
                    "127.0.0.1",
                    "-U",
                    "agent_platform",
                    "-d",
                    "agent_platform_test",
                ],
                check=False,
            )
            if ready.returncode == 0:
                break
            time.sleep(0.25)
        else:
            raise RuntimeError("POSTGRES_NOT_READY")
        listen = call(
            [
                "docker",
                "exec",
                pg_name,
                "psql",
                "-U",
                "agent_platform",
                "-d",
                "agent_platform_test",
                "-Atc",
                "show listen_addresses",
            ]
        ).stdout.strip()
        assert listen == "127.0.0.1", "POSTGRES_BIND_REJECTED"
        assert call(["docker", "port", pg_name]).stdout == "", "PUBLISHED_PORT_REJECTED"
        receipt["postgresLoopbackVerified"] = True
        command = {
            "probe": [
                str(component / ".venv/bin/python"),
                "-c",
                "import os,psycopg; "
                "c=psycopg.connect(os.environ['TEST_DATABASE_URL']); "
                "print(c.execute('show server_version').fetchone()[0]); c.close()",
            ],
            "capture": [
                "node",
                "web/node_modules/@playwright/test/cli.js",
                "test",
                "--config",
                "fe-review/playwright.config.ts",
            ],
        }[args.mode]
        runtime = [
            "docker",
            "run",
            "--init",
            "--name",
            browser_name,
            "--network",
            "container:" + pg_name,
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--user",
            f"{os.getuid()}:{os.getgid()}",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,exec,nosuid,size=1g",
            "--tmpfs",
            f"/home/ubuntu:rw,nosuid,uid={os.getuid()},gid={os.getgid()},mode=0700,size=128m",
            "--mount",
            f"type=bind,src={checkout},dst={checkout},readonly",
            "--mount",
            f"type=bind,src={fixture},dst={mount_point}",
            "--mount",
            f"type=bind,src={component / 'fe-review/runs'},dst={component / 'fe-review/runs'}",
            "--mount",
            f"type=bind,src={browser_cache},dst=/ms-playwright,readonly",
            "--workdir",
            str(component),
            "-e",
            "TEST_DATABASE_URL",
            "-e",
            "PYTHON=" + str(component / ".venv/bin/python"),
            "-e",
            "PYTHONDONTWRITEBYTECODE=1",
            "-e",
            "RUFF_CACHE_DIR=/tmp/ruff-cache",
            "-e",
            "FE_REVIEW_RUN_ID=" + run_id,
            args.image,
            *command,
        ]
        receipt["phase"] = "runtime"
        result = call(runtime, timeout=600, check=False)
        secret_values = [password]
        fixture_file = fixture / "browser-fixture.json"
        if fixture_file.exists():
            secret_values.append(json.loads(fixture_file.read_text()).get("password", ""))
        log, leaked = scrub_log(result.stdout + result.stderr, secret_values)
        (private / "runtime.log").write_text(log)
        receipt.update(
            processExit=result.returncode,
            logSha256=hashlib.sha256(log.encode()).hexdigest(),
            logSecretRedactionRequired=leaked,
        )
        code = result.returncode if not leaked else 1
        receipt["status"] = "passed" if code == 0 else "failed"
    except (OSError, ValueError, AssertionError, RuntimeError, subprocess.TimeoutExpired) as error:
        receipt["errorType"] = type(error).__name__
    finally:
        signal.signal(signal.SIGTERM, previous)
        try:
            result = call(["docker", "logs", pg_name], check=False)
            pg_log, redacted = scrub_log(result.stdout + result.stderr, [password])
            (private / "postgres.log").write_text(pg_log)
            receipt["postgresLogSecretRedactionRequired"] = redacted
        except (OSError, subprocess.TimeoutExpired):
            receipt["postgresLogUnavailable"] = True
        removed, errors = cleanup_owned(names, call)
        receipt["ownedContainersRemoved"] = removed
        receipt["cleanupObservations"] = errors
        if not removed:
            receipt["status"] = "failed"
            code = 1
        receipt["elapsedSeconds"] = round(time.monotonic() - started, 3)
        (output / "isolation.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(
            json.dumps(
                {
                    "runId": run_id,
                    "status": receipt["status"],
                    "ownedContainersRemoved": receipt["ownedContainersRemoved"],
                }
            )
        )
    return code


if __name__ == "__main__":
    raise SystemExit(main())
