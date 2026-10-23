#!/usr/bin/env python3
"""Read-only working-tree preflight using the same index validators as CI."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args(argv)
    root = args.root.resolve()
    source = Path(__file__).resolve().parents[1]
    checks = (
        ("project success / inventory / PROJECTS", source / "scripts/check_project_success.py", ["--root", str(root)]),
        ("llms.txt navigation", source / ".github/scripts/validate_llms_txt.py", []),
    )
    failed = False
    for label, script, options in checks:
        print(f"CHECK: {label}", flush=True)
        try:
            result = subprocess.run([sys.executable, str(script), *options], cwd=root)
        except OSError as exc:
            print(f"ERROR: {label}: {exc}", file=sys.stderr)
            failed = True
        else:
            failed |= result.returncode != 0
    if failed:
        print("Repair the reported inventory, SUCCESS, index or navigation entries; see docs/project-success.md.")
        return 1
    print("PASS: index preflight (working-tree content; llms.txt paths from Git index)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
