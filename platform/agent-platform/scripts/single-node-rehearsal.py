#!/usr/bin/env python3
"""A fresh local-only PostgreSQL rehearsal; never adopt ambient application databases."""

import argparse
import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

COMPONENT = Path(__file__).resolve().parents[1]


def scoped_environment(values):
    """Only host execution prerequisites survive; application/provider secrets do not."""
    env = {
        key: values[key]
        for key in (
            "PATH",
            "HOME",
            "LANG",
            "LC_ALL",
            "TZ",
            "TMPDIR",
            "LD_LIBRARY_PATH",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "DOCKER_CONFIG",
        )
        if key in values
    }
    env.update(
        DOCKER_HOST="unix:///var/run/docker.sock",
        PYTHONDONTWRITEBYTECODE="1",
        PYTHONPATH=os.pathsep.join((str(COMPONENT / "src"), str(COMPONENT / "tests_platform"))),
    )
    return env


def stop_runner(process):
    if process.poll() is None:
        # SIGINT lets the existing PostgreSQL runner execute its ownership-checked finally.
        os.killpg(process.pid, signal.SIGINT)
        try:
            process.wait(timeout=45)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
            raise RuntimeError("rehearsal_cleanup_incomplete") from None


@contextmanager
def termination_guard():
    def interrupted(signum, frame):
        raise KeyboardInterrupt()

    previous = signal.signal(signal.SIGTERM, interrupted)
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, previous)


def run(directory, web_dist):
    env = scoped_environment(os.environ)
    env["AP_REHEARSAL_OUTPUT"] = str(directory)
    env["TMPDIR"] = str(directory / "scratch")
    (directory / "scratch").mkdir(mode=0o700)
    if web_dist is not None:
        if not (web_dist / "index.html").is_file():
            raise ValueError("rehearsal_web_dist_invalid")
        env["AP_REHEARSAL_WEB_DIST"] = str(web_dist)
    spec = importlib.util.spec_from_file_location(
        "owned_postgres_runner", COMPONENT / "scripts/test-postgres.py"
    )
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    # Local image inspection never pulls or authenticates to a registry.
    subprocess.run(
        ["docker", "image", "inspect", runner.IMAGE],
        env=env,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=15,
    )
    with (directory / "rehearsal.log").open("xb") as log:
        os.chmod(log.name, 0o600)
        process = subprocess.Popen(
            [
                sys.executable,
                str(COMPONENT / "scripts/test-postgres.py"),
                sys.executable,
                "-m",
                "unittest",
                "test_single_node_deployment",
                "-v",
            ],
            cwd=COMPONENT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            if process.wait(timeout=600):
                raise RuntimeError("single_node_rehearsal_failed")
        finally:
            stop_runner(process)
    evidence_path = directory / "evidence.json"
    if evidence_path.stat().st_size > 65536:
        raise ValueError("rehearsal_evidence_invalid")
    evidence = json.loads(evidence_path.read_text())
    if evidence.get("status") != "passed":
        raise ValueError("rehearsal_evidence_invalid")
    print(json.dumps(evidence, sort_keys=True))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, help="new private evidence directory")
    parser.add_argument("--web-dist", type=Path, default=os.environ.get("AP_REHEARSAL_WEB_DIST"))
    args = parser.parse_args()
    web_dist = args.web_dist.absolute() if args.web_dist else None
    try:
        with termination_guard():
            return execute(args, web_dist)
    except KeyboardInterrupt:
        print("single_node_rehearsal_interrupted", file=sys.stderr)
        return 130
    except Exception as error:
        code = (
            "rehearsal_cleanup_incomplete"
            if str(error) == "rehearsal_cleanup_incomplete"
            else "single_node_rehearsal_failed"
        )
        print(code, file=sys.stderr)
        return 1


def execute(args, web_dist):
    if args.directory:
        directory = args.directory.absolute()
        directory.mkdir(mode=0o700)
        return run(directory, web_dist)
    with tempfile.TemporaryDirectory(prefix="agent-platform-rehearsal-") as temporary:
        return run(Path(temporary), web_dist)


if __name__ == "__main__":
    raise SystemExit(main())
