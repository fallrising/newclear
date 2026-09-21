"""Own and clean up a disposable, egress-blocked real Agent Server container."""

import json
import os
import secrets
import subprocess
import uuid
from datetime import UTC, datetime
from pathlib import Path

from .contracts import OPENHANDS_IMAGE, PENDING_KVM_GATES
from .events import Journal
from .probe import Probe
from .relay import Relay
from .transport import HTTP, ProbeError


def docker(*args, env=None, timeout=120):
    try:
        result = subprocess.run(
            ["docker", *args],
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProbeError("docker_command_unavailable_or_timeout") from exc
    if result.returncode:
        # Docker error output may contain environment/configuration: don't publish it.
        raise ProbeError(f"docker_{args[0]}_failed")
    return result.stdout.strip()


def start_model(name):
    fixture = Path(__file__).with_name("fake_model.py")
    docker("cp", str(fixture), f"{name}:/tmp/m0_fake_model.py")
    docker("exec", "-d", name, "python3", "/tmp/m0_fake_model.py")


def run(output: Path, guest_image: str | None = None) -> dict:
    image = guest_image or OPENHANDS_IMAGE
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    name = "agent-platform-m0-" + uuid.uuid4().hex
    network = name + "-net"
    token = secrets.token_urlsafe(32)
    report = {
        "schema_version": 1,
        "started_at": datetime.now(UTC).isoformat(),
        "transport": "docker",
        "image": image,
        "checks": {},
        "pending_kvm_gates": PENDING_KVM_GATES,
        "full_m0_complete": False,
    }
    journal = Journal(output / "events.sqlite3")
    # Mark ownership before create: a timed-out CLI call may still have created a resource.
    network_attempted = container_attempted = False
    relay = None
    try:
        observed = json.loads(docker("image", "inspect", image))
        report["local_image_id"] = observed[0]["Id"]
        network_attempted = True
        docker("network", "create", "--internal", "--label", "newclear.agent-platform=m0", network)
        container_attempted = True
        docker(
            "run",
            "-d",
            "--pull=never",
            "--name",
            name,
            "--network",
            network,
            "--label",
            "newclear.agent-platform=m0",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--memory=2g",
            "--cpus=2",
            "--pids-limit=256",
            "-e",
            "SESSION_API_KEY",
            *(
                ["--entrypoint=/usr/local/bin/openhands-agent-server", "--user=2000"]
                if guest_image
                else []
            ),
            image,
            "--host",
            "0.0.0.0",
            "--port",
            "8000",
            env={**os.environ, "SESSION_API_KEY": token},
        )
        networks = json.loads(
            docker(
                "inspect",
                "--format",
                "{{json .NetworkSettings.Networks}}",
                name,
            )
        )
        relay = Relay((networks[network]["IPAddress"], 8000))
        http = HTTP(relay.origin, token)
        start_model(name)
        probe = Probe(http, journal, report)
        probe.check_server()
        probe.create()
        events = probe.lifecycle()
        docker("restart", "--time=10", name)
        start_model(name)
        probe.after_restart(events)
    except (Exception, KeyboardInterrupt) as exc:
        report["error"] = str(exc) if isinstance(exc, ProbeError) else type(exc).__name__
    finally:
        cleanup_errors = []
        if relay is not None:
            try:
                relay.close()
            except Exception:
                cleanup_errors.append("relay")
        for attempted, args in (
            (container_attempted, ("rm", "-f", "-v", name)),
            (network_attempted, ("network", "rm", network)),
        ):
            if attempted:
                try:
                    docker(*args, timeout=30)
                except ProbeError:
                    cleanup_errors.append(args[0])
        report["checks"]["owned_docker_resources_removed"] = (
            "failed" if cleanup_errors else "passed"
        )
        if cleanup_errors:
            report["cleanup_resource_names"] = {"container": name, "network": network}
        journal.close()
        report["docker_contract_passed"] = not report.get("error") and not cleanup_errors
        report["finished_at"] = datetime.now(UTC).isoformat()
        path = output / "report.json"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(report, stream, indent=2)
            stream.write("\n")
    return report
