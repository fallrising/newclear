#!/usr/bin/env python3
"""Exercise a real Linux Tauri window and frontend IPC under an X server.

This is a functional smoke test, not the controlled macOS launch benchmark.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


def main():
    target = Path(os.environ.get("CARGO_TARGET_DIR", "target"))
    if os.environ.get("CARGO_BUILD_TARGET"):
        target /= os.environ["CARGO_BUILD_TARGET"]
    binary = target / "debug" / "flowshot-tauri"
    evidence = Path(os.environ.get("AGENT_EVIDENCE_DIR", ".")) / "linux-native"
    evidence.mkdir(parents=True, exist_ok=True)
    evidence = Path(tempfile.mkdtemp(prefix="run-", dir=evidence))
    result = {"platform": "linux", "macosAcceptance": False, "passed": False}
    (evidence / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    with (evidence / "stdout.jsonl").open("w+") as stdout, (evidence / "stderr.log").open("w") as stderr:
        process = subprocess.Popen([str(binary.resolve())], stdout=stdout, stderr=stderr)
        try:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f"application exited early: {process.returncode}")
                probe = subprocess.run(
                    ["xdotool", "search", "--onlyvisible", "--pid", str(process.pid)],
                    capture_output=True, text=True, timeout=2, check=False,
                )
                windows = []
                for window in probe.stdout.splitlines():
                    info = subprocess.run(["xwininfo", "-id", window], capture_output=True, text=True, timeout=2, check=True)
                    if "Map State: IsViewable" in info.stdout and '"Flowshot"' in info.stdout:
                        windows.append({"id": window, "info": info.stdout})
                stdout.seek(0)
                records = []
                for line in stdout.read().splitlines():
                    try:
                        records.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
                commands = [r for r in records if r.get("event") == "command_complete"
                            and r.get("command") == "get_build_info" and r.get("resultCode") == "OK"
                            and r.get("correlationId", "").startswith(f"flowshot-{process.pid}-")]
                if windows and commands and process.poll() is None:
                    result.update(pid=process.pid, windows=windows, commands=commands, passed=True)
                    (evidence / "result.json").write_text(json.dumps(result, indent=2) + "\n")
                    print("Linux native visible window and real frontend IPC passed")
                    return
                time.sleep(0.1)
            raise RuntimeError("visible PID-owned Flowshot window and successful frontend IPC not both observed within 30s")
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    main()
