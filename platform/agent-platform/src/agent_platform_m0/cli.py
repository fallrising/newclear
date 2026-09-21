"""M0 diagnostics only: no production service or deployment commands."""

import argparse
import json
import os
from pathlib import Path

from .docker_smoke import run
from .preflight import inspect_host as preflight
from .transport import ProbeError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("preflight", help="Report prerequisites; exit 2 without accessible KVM")
    smoke = commands.add_parser("docker-smoke", help="Probe a pinned, locally pulled amd64 image")
    smoke.add_argument("--output", type=Path, required=True, help="Fresh private report directory")
    guest = commands.add_parser(
        "guest-image-smoke", help="Test a locally built VM guest rootfs in Docker"
    )
    guest.add_argument("--image", required=True)
    guest.add_argument("--output", type=Path, required=True)
    sandbox = commands.add_parser(
        "sandbox-smoke", help="Probe an operator-provided single sandboxd node"
    )
    sandbox.add_argument("--origin", required=True)
    sandbox.add_argument("--template", required=True, help="OCI reference with sha256 digest")
    sandbox.add_argument("--token-env", default="SANDBOX_API_TOKEN")
    sandbox.add_argument("--ttl-seconds", type=int, default=900)
    sandbox.add_argument("--size", choices=("medium", "large"), default="large")
    sandbox.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "preflight":
            report = preflight()
            code = 0 if report["kvm_ready"] else 2
        elif args.command == "sandbox-smoke":
            from .sandbox_smoke import Config
            from .sandbox_smoke import run as run_sandbox

            token = os.environ.get(args.token_env)
            if not token:
                raise ProbeError("sandbox_token_environment_missing")
            report = run_sandbox(
                Config(args.origin, args.template, args.ttl_seconds, args.size), token, args.output
            )
            code = 0 if report["sandbox_contract_passed"] else 1
        else:
            report = run(
                args.output, guest_image=args.image if args.command == "guest-image-smoke" else None
            )
            code = 0 if report["docker_contract_passed"] else 1
        print(json.dumps(report, indent=2))
        return code
    except (ProbeError, OSError, ImportError) as exc:
        print(
            json.dumps({"error": str(exc) if isinstance(exc, ProbeError) else type(exc).__name__})
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
