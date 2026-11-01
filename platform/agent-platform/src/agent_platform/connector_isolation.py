"""Fixed guest control layout and read-only attestation, never repair a live guest."""

import hashlib
import json
from pathlib import Path

from .domain import Problem

REVISION = "guest-control-v1"
CODE = "/opt/agent-platform"
CONTROL = "/var/lib/agent-platform/control"
HELPERS = (
    "guest_control.py",
    "guest_quiescence.py",
    "guest_workspace.py",
    "guest_fixture.py",
    "guest_model.py",
)
ATTESTED = HELPERS
TOOL_HELPERS = ("guest_tool.py", "guest_tool_client.py")


def attest(service, row, *, terminal=False):
    if row.get("isolation_revision") != REVISION:
        raise Problem(409, "guest_isolation_upgrade_required")
    sb = service.handle(row)
    tool_transport = row.get("input", {}).get("tool_transport", False)
    if tool_transport and row.get("tool_isolation_revision") != "tool-mailbox-v1":
        raise Problem(409, "tool_isolation_upgrade_required")
    files = {
        name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
        for name in ATTESTED + (TOOL_HELPERS if tool_transport else ())
    }
    files["terminal"] = hashlib.sha256(service.launcher()).hexdigest()
    # Verify the probe before asking it to attest other files and live credentials.
    if (
        sb.exec("sha256sum", CODE + "/guest_control.py", timeout=5).split()[0]
        != files["guest_control.py"]
    ):
        raise Problem(409, "guest_isolation_probe_changed")
    proof = json.loads(
        sb.exec(
            "python3",
            "-I",
            CODE + "/guest_control.py",
            json.dumps(
                {
                    "action": "check",
                    "files": files,
                    "terminal": terminal,
                    "tool_transport": tool_transport,
                }
            ),
            timeout=5,
        )
    )
    if proof != {
        "revision": REVISION,
        "control_uid": 2001,
        "terminal_uid": 2000,
        "no_new_privileges": True,
        "private_workspace": True,
    }:
        raise Problem(409, "guest_isolation_unconfirmed")
    return proof
