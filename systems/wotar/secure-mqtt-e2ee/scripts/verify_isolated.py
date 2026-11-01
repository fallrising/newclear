#!/usr/bin/env python3
"""Run existing gates with fresh synthetic credentials, never in the source checkout."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--integration", action="store_true")
    parser.add_argument("--public-smoke", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    python = ROOT / ".venv/bin/python"
    if not python.is_file():
        parser.error("run make install in the source checkout first")
    records: list[dict] = []
    env = {k: v for k, v in os.environ.items() if not k.startswith("SECURE_MQTT_")}
    container = "wotar-test-" + uuid.uuid4().hex
    container_id: str | None = None
    network = container + "-net"
    network_created = False
    with tempfile.TemporaryDirectory(prefix="wotar-isolated-") as temp:
        fixture = Path(temp) / "source"
        cidfile = Path(temp) / "container-id"
        # Copy only tracked source. Exclude even tracked historical certificate CSRs/config:
        # generate_dev_certs rewrites them; never run it against an operator's directory.
        names = subprocess.check_output(
            ["git", "ls-files", "-z", "--", "."], cwd=ROOT
        ).decode().split("\0")
        hashes = {}
        for name in filter(None, names):
            source = ROOT / name
            if name.startswith(("certs/", ".secure_mqtt/")) or name == "config/public-keys.local.json":
                continue
            if source.is_symlink():
                raise RuntimeError("refusing source symlink: " + name)
            dest = fixture / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, dest)
            hashes[name] = hashlib.sha256(dest.read_bytes()).hexdigest()
        (output / "source-hashes.json").write_text(json.dumps(hashes, indent=2) + "\n")
        env["PYTHONPATH"] = str(fixture / "src")
        env["PYTHONDONTWRITEBYTECODE"] = "1"

        def run(label, command, timeout=240, extra_env=None):
            started = time.monotonic()
            timed_out = False
            with (output / (label + ".log")).open("w") as log:
                try:
                    result = subprocess.run(command, cwd=fixture, env={**env, **(extra_env or {})},
                                            stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
                    code = result.returncode
                except subprocess.TimeoutExpired:
                    code, timed_out = 124, True
                    log.write("\ncommand exceeded its bounded timeout\n")
                except OSError as exc:
                    code = 127
                    log.write("\ncommand launch error: " + str(exc) + "\n")
            records.append({"label": label, "argv": command, "exit_code": code, "timed_out": timed_out,
                            "duration_seconds": round(time.monotonic() - started, 3)})
            (output / "commands.json").write_text(json.dumps(records, indent=2) + "\n")
            print(label + ": exit " + str(code), flush=True)
            return code

        try:
            if run("certificates", ["bash", "scripts/generate_dev_certs.sh"]):
                return 1
            if run("bootstrap", [str(python), "scripts/bootstrap_local_keys.py"]):
                return 1
            if run("native", ["make", "VENV=" + str(ROOT / ".venv"), "lint", "typecheck", "doctor", "test", "coverage"]):
                return 1
            if args.integration:
                # The unchanged integration contract uses localhost:8883. Refuse any
                # existing listener instead of adopting or stopping another service.
                with socket.socket() as probe:
                    probe.bind(("127.0.0.1", 8883))
                subprocess.run(["docker", "network", "create", network], check=True,
                               stdout=subprocess.DEVNULL)
                network_created = True
                settings = {
                    "EMQX_LISTENERS__TCP__DEFAULT__ENABLE": "false",
                    "EMQX_LISTENERS__WS__DEFAULT__ENABLE": "false",
                    "EMQX_LISTENERS__WSS__DEFAULT__ENABLE": "false",
                    "EMQX_LISTENERS__SSL__DEFAULT__BIND": "8883",
                    "EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__CACERTFILE": "/opt/emqx/etc/certs/ca.pem",
                    "EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__CERTFILE": "/opt/emqx/etc/certs/server.pem",
                    "EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__KEYFILE": "/opt/emqx/etc/certs/server.key",
                    "EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__VERIFY": "verify_peer",
                    "EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__FAIL_IF_NO_PEER_CERT": "true",
                    "EMQX_AUTHORIZATION__NO_MATCH": "deny",
                    "EMQX_AUTHORIZATION__SOURCES__1__TYPE": "file",
                    "EMQX_AUTHORIZATION__SOURCES__1__ENABLE": "true",
                    "EMQX_AUTHORIZATION__SOURCES__1__PATH": "/opt/emqx/etc/acl.conf",
                    "EMQX_ALLOW_ANONYMOUS": "true",
                }
                command = ["docker", "run", "-d", "--cidfile", str(cidfile), "--name", container, "--network", network,
                           "-p", "127.0.0.1:8883:8883",
                           "-v", str(fixture / "certs") + ":/opt/emqx/etc/certs:ro",
                           "-v", str(fixture / "config/emqx/acl.conf") + ":/opt/emqx/etc/acl.conf:ro"]
                for key, value in settings.items():
                    command += ["-e", key + "=" + value]
                command += ["emqx/emqx@sha256:2bb94239a3812cd3443695d29d196cff510660b3fbf1bc56bbd8747fa94c4bd8"]
                if run("broker-start", command):
                    return 1
                container_id = cidfile.read_text().strip()
                if run("integration", ["make", "VENV=" + str(ROOT / ".venv"), "test-integration"]):
                    return 1
            if args.public_smoke:
                # Only the original opt-in smoke: synthetic ciphertext, fresh random namespace.
                if run("public-smoke", [str(python), "-m", "pytest", "tests/integration/test_public_smoke.py",
                                         "-m", "public_smoke", "-v"],
                       extra_env={"SECURE_MQTT_RUN_PUBLIC_SMOKE": "1"}):
                    return 1
            # Skips never establish qualification. All requested fixture-dependent gates must execute.
            for label in ("native", "integration", "public-smoke"):
                log = output / (label + ".log")
                if log.exists() and " skipped" in log.read_text():
                    raise RuntimeError("requested gate skipped tests: " + label)
            return 0
        finally:
            cleanup_errors = []
            # Docker can create a container then fail to start it. The cidfile is
            # proof this invocation owns it; never clean an arbitrary existing name.
            if cidfile.exists():
                container_id = cidfile.read_text().strip()
                if len(container_id) != 64 or any(c not in "0123456789abcdef" for c in container_id):
                    cleanup_errors.append("invalid owned container ID")
                else:
                    for label, command, timeout in (
                        ("broker-log", ["docker", "logs", container_id], 20),
                        ("broker-stop", ["docker", "stop", "--time", "15", container_id], 25),
                        ("broker-remove", ["docker", "rm", container_id], 20),
                    ):
                        if run(label, command, timeout=timeout):
                            cleanup_errors.append(label)
            if network_created:
                if run("network-remove", ["docker", "network", "rm", network], timeout=20):
                    cleanup_errors.append("network-remove")
            unchanged = all(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest
                            for name, digest in hashes.items())
            (output / "isolation.json").write_text(json.dumps({
                "tracked_source_unchanged": unchanged, "credential_location": "fresh temporary fixture only",
                "broker_container": container_id,
                "cleanup_errors": cleanup_errors,
                "broker_network": "dedicated bridge; host listener loopback only", "published_listener": "127.0.0.1:8883",
                "existing_certificates_or_settings_written": False,
            }, indent=2) + "\n")
            if cleanup_errors:
                raise RuntimeError("owned resource cleanup incomplete: " + ", ".join(cleanup_errors))
            if not unchanged:
                raise RuntimeError("source changed during isolated verification")


if __name__ == "__main__":
    raise SystemExit(main())
