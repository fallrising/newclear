"""M0 diagnostics only: no production service or deployment commands."""

import argparse
import json
import os
import platform
import shutil
from pathlib import Path

from .contracts import OPENHANDS_IMAGE, PENDING_KVM_GATES
from .docker_smoke import run
from .transport import ProbeError


def preflight():
    return {
        "platform": platform.system(),
        "architecture": platform.machine(),
        "kvm_present": Path("/dev/kvm").exists(),
        "kvm_accessible": os.access("/dev/kvm", os.R_OK | os.W_OK),
        "docker_cli_present": shutil.which("docker") is not None,
        "cocoon_cli_present": shutil.which("cocoon") is not None,
        "sandboxd_present": shutil.which("sandboxd") is not None,
        "openhands_image": OPENHANDS_IMAGE,
        "pending_kvm_gates": PENDING_KVM_GATES,
        "full_m0_complete": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("preflight", help="Report prerequisites; exit 2 without accessible KVM")
    smoke = commands.add_parser("docker-smoke", help="Probe a pinned, locally pulled amd64 image")
    smoke.add_argument("--output", type=Path, required=True, help="Fresh private report directory")
    args = parser.parse_args()
    try:
        if args.command == "preflight":
            report = preflight()
            code = 0 if report["kvm_accessible"] else 2
        else:
            report = run(args.output)
            code = 0 if report["docker_contract_passed"] else 1
        print(json.dumps(report, indent=2))
        return code
    except (ProbeError, OSError) as exc:
        print(
            json.dumps({"error": str(exc) if isinstance(exc, ProbeError) else type(exc).__name__})
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
