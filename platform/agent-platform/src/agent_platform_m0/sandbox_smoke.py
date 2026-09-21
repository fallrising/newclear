"""Remote Cocoon contract probe. Release acknowledgement isn't VM removal proof."""

import json
import os
import re
import secrets
import socket
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from .contracts import (
    OPENHANDS_BINARY_SHA256,
    OPENHANDS_SHA,
    PENDING_KVM_GATES,
    SANDBOX_SDK_VERSION,
)
from .events import Journal
from .probe import Probe
from .transport import HTTP, ProbeError, validate_origin


@dataclass(frozen=True)
class Config:
    origin: str
    template: str
    ttl_seconds: int = 900
    size: str = "large"

    def validate(self):
        validate_origin(self.origin)
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/:\-]*@sha256:[a-f0-9]{64}", self.template):
            raise ProbeError("template_requires_oci_digest")
        if not 600 <= self.ttl_seconds <= 86400:
            raise ProbeError("ttl_outside_600_86400_seconds")
        if self.size not in {"medium", "large"}:
            raise ProbeError("unsupported_probe_size")


def wait_stopped(sandbox, pid):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        processes = sandbox.ps()
        matches = [p for p in processes if p["pid"] == pid]
        if not matches or all(p.get("state") == "exited" for p in matches):
            return
        if any(p.get("state") != "running" for p in matches):
            raise ProbeError("guest_process_state_unknown")
        time.sleep(0.1)
    raise ProbeError("guest_process_stop_unconfirmed")


def run(config: Config, token: str, output: Path, *, client_factory=None, probe_factory=Probe):
    config.validate()
    if client_factory is None:
        from .sandbox_client import SingleNodeClient

        client_factory = SingleNodeClient
    client = client_factory(config.origin, token)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    claim_ref = "agent-platform-m0-" + uuid.uuid4().hex
    report = {
        "schema_version": 1,
        "transport": "cocoon",
        "started_at": datetime.now(UTC).isoformat(),
        "template": config.template,
        "sandbox_sdk_version": SANDBOX_SDK_VERSION,
        "claim_ref": claim_ref,
        "ttl_seconds": config.ttl_seconds,
        "checks": {},
        "pending_kvm_gates": list(PENDING_KVM_GATES),
        "full_m0_complete": False,
        "vm_removal_confirmed": False,
    }
    sandbox = listener = None
    journal = Journal(output / "events.sqlite3")
    try:
        sandbox = client.new(
            config.template,
            net="none",
            size=config.size,
            ttl_seconds=config.ttl_seconds,
            claim_ref=claim_ref,
            deadline=time.monotonic() + 120,
        )
        report["sandbox_id"] = sandbox.id
        report["checks"]["single_allocation"] = "passed"
        # template_digest is a promoted snapshot export digest, NOT an OCI manifest.
        # This probe uses configured pools/cold OCI boots only; check the claim key.
        if sandbox.template_digest:
            raise ProbeError("promoted_template_not_supported")
        claimed = [s for s in client.sandboxes() if s.get("id") == sandbox.id]
        expected_key = {"template": config.template, "net": "none", "size": config.size}
        if (
            len(claimed) != 1
            or claimed[0].get("key") != expected_key
            or claimed[0].get("claim_ref") != claim_ref
        ):
            raise ProbeError("claimed_template_key_mismatch")
        expires = datetime.fromisoformat(sandbox.deadline.replace("Z", "+00:00"))
        if expires.tzinfo is None or (expires - datetime.now(UTC)).total_seconds() < 300:
            raise ProbeError("claim_remaining_ttl_too_short")
        report["checks"]["pinned_claim_key_and_lease"] = "passed"
        checksum = sandbox.exec("sha256sum", "/usr/local/bin/openhands-agent-server", timeout=15)
        if checksum.split()[0] != OPENHANDS_BINARY_SHA256:
            raise ProbeError("guest_server_binary_mismatch")
        report["checks"]["guest_server_binary"] = "passed"
        # The prepared guest provides the server and Python. No installer runs in a claim.
        sandbox.write_file(
            "/tmp/m0_fake_model.py",
            Path(__file__).with_name("fake_model.py").read_bytes(),
            mode=0o644,
        )
        sandbox.spawn("python3", "/tmp/m0_fake_model.py", user="agentprobe")
        session_key = secrets.token_urlsafe(32)

        def start_server():
            return sandbox.spawn(
                "/usr/local/bin/openhands-agent-server",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
                user="agentprobe",
                cwd="/home/agentprobe",
                env={
                    "SESSION_API_KEY": session_key,
                    "HOME": "/home/agentprobe",
                    "OPENHANDS_BUILD_GIT_SHA": OPENHANDS_SHA,
                },
            )

        pid = start_server()
        listener = sandbox.proxy_port("127.0.0.1:0", 8000)
        http = HTTP(f"http://127.0.0.1:{listener.getsockname()[1]}", session_key)
        probe = probe_factory(http, journal, report)
        probe.check_server()
        probe.create()
        events = probe.lifecycle()
        sandbox.kill(pid, signal=15)
        wait_stopped(sandbox, pid)
        start_server()
        probe.after_restart(events, restart_scope="guest_process")
        report["checks"]["sandbox_rest_and_websocket_relay"] = "passed"
        report["pending_kvm_gates"].remove("sandbox_rest_and_websocket_relay")
    except (Exception, KeyboardInterrupt) as exc:
        report["error"] = str(exc) if isinstance(exc, ProbeError) else type(exc).__name__
    finally:
        cleanup_ok = True
        if listener is not None:
            try:
                # 0.1.12's accept thread otherwise may remain blocked after close().
                listener.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                listener.close()
            except OSError:
                cleanup_ok = False
                report["checks"]["local_listener_closed"] = "failed"
        if sandbox is not None:
            cleanup_stage = "release_acknowledged_twice"
            try:
                sandbox.close()
                sandbox.close()  # The second release must be idempotent, including 404.
                report["checks"]["release_acknowledged_twice"] = "passed"
                cleanup_stage = "claim_no_longer_listed"
                listed = client.sandboxes()
                if any(
                    s.get("id") == sandbox.id or s.get("claim_ref") == claim_ref for s in listed
                ):
                    raise ProbeError("claim_still_listed_after_release")
                report["checks"]["claim_no_longer_listed"] = "passed"
            except (Exception, KeyboardInterrupt):
                cleanup_ok = False
                report["checks"][cleanup_stage] = "failed"
        else:
            # Never allocate a replacement after an ambiguous POST; the daemon may own a VM.
            cleanup_ok = False
            report["checks"]["allocation_reconciliation"] = "operator_required"
            try:
                report["matching_claims"] = [
                    {"id": s.get("id"), "deadline": s.get("deadline")}
                    for s in client.sandboxes()
                    if s.get("claim_ref") == claim_ref
                ]
            except Exception:
                report["matching_claims"] = "lookup_failed"
        journal.close()
        report["sandbox_contract_passed"] = not report.get("error") and cleanup_ok
        report["finished_at"] = datetime.now(UTC).isoformat()
        fd = os.open(output / "report.json", os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(report, stream, indent=2)
            stream.write("\n")
    return report
