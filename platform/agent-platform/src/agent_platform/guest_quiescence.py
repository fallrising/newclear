"""Root-owned, read-only guest process attestation. Never execute user commands."""

import hashlib
import json
import os
import sys
import time
from pathlib import Path

UID = 2000


def snapshot():
    processes, stable = {}, True
    for path in Path("/proc").iterdir():
        if not path.name.isdecimal():
            continue
        try:
            status = dict(line.split(":", 1) for line in (path / "status").read_text().splitlines())
            # A non-dumpable process may have root-owned proc entries. Use credentials.
            uid = int(status["Uid"].split()[0])
            arguments = (path / "cmdline").read_bytes().split(bytes([0]))
            control = uid == 2001 and (
                b"/usr/local/bin/openhands-agent-server" in arguments
                or any(
                    a.startswith(b"/opt/agent-platform/") and a.endswith(b"fixture.py")
                    for a in arguments
                )
            )
            if uid != UID and not control:
                continue
            fields = (path / "stat").read_text().rsplit(")", 1)[1].split()
            # Zombies cannot execute or fork; disappearing live processes make this scan uncertain.
            if fields[0] == "Z":
                continue
            processes[path.name] = {
                "uid": uid,
                "start_ticks": int(fields[19]),
                "exe": os.readlink(path / "exe"),
                "command_hash": hashlib.sha256((path / "cmdline").read_bytes()).hexdigest(),
            }
        except FileNotFoundError:
            stable = False
            continue
    if not processes or len(processes) > 128:
        raise RuntimeError("guest_process_baseline_invalid")
    return {
        "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
        "processes": processes,
        "stable": stable,
    }


def main():
    request = json.loads(sys.argv[1])
    current = snapshot()
    if request["action"] == "baseline":
        for _ in range(10):
            time.sleep(0.1)
            after = snapshot()
            if current["stable"] and after["stable"] and current == after:
                print(json.dumps(current))
                return
            current = after
        raise RuntimeError("guest_process_baseline_unstable")
    expected = request["baseline"]
    time.sleep(0.1)
    after = snapshot()
    print(
        json.dumps(
            {
                "same_boot": current["boot_id"] == after["boot_id"] == expected["boot_id"],
                "same_processes": current["stable"]
                and after["stable"]
                and current["processes"] == after["processes"] == expected["processes"],
            }
        )
    )


if __name__ == "__main__":
    main()
