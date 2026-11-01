#!/usr/bin/env python3
"""Import a staged project in the headless editor; this is NOT desktop acceptance."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("source", "binaries", "godot", "dotnet-root"):
        parser.add_argument(f"--{flag}", type=Path, required=True)
    args = parser.parse_args()
    build = Path(os.environ["AGENT_BUILD_DIR"])
    evidence = Path(os.environ["AGENT_EVIDENCE_DIR"])
    stage = build / "GodotClient"
    if stage.exists():
        parser.error("use a fresh workspace task ID; do not reuse editor state")
    shutil.copytree(args.source / "GodotClient", stage,
                    ignore=shutil.ignore_patterns(".godot", "bin", "obj"))
    shutil.copytree(args.source / "ClientData", build / "ClientData")
    shutil.copytree(args.binaries, stage / ".godot/mono/temp/bin/Debug")
    env = dict(os.environ, DOTNET_ROOT=str(args.dotnet_root.resolve()),
               PATH=str(args.dotnet_root.resolve()) + os.pathsep + os.environ["PATH"])
    # New editor settings belong to this task, not the operator's profile.
    for name in ("CONFIG", "DATA", "CACHE"):
        directory = build / ("editor-" + name.lower())
        directory.mkdir()
        env[f"XDG_{name}_HOME"] = str(directory)
    command = [str(args.godot.resolve()), "--headless", "--editor", "--path", str(stage),
               "--import", "--quit"]
    with (evidence / "editor.log").open("w") as log:
        try:
            code = subprocess.run(command, env=env, stdout=log, stderr=subprocess.STDOUT,
                                  timeout=120).returncode
        except subprocess.TimeoutExpired:
            code = 124
    errors = [line for line in (evidence / "editor.log").read_text().splitlines()
              if "ERROR:" in line or "SCRIPT ERROR:" in line]
    report = {"command": command, "exit_code": code, "errors": errors,
              "desktop_acceptance": False, "gameplay_acceptance": False}
    (evidence / "editor-result.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return int(bool(code or errors))


if __name__ == "__main__":
    sys.exit(main())
