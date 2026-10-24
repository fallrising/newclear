#!/usr/bin/env python3
"""Private-state CLI for the root-owned Docker launcher. Never starts services.

prepare --state DIR --source SHA
check-config --state DIR --base FILE --model FILE
record --state DIR --inventory FILE
cleanup-plan --state DIR --inventory FILE
absent --state DIR --inventory FILE

All FILE arguments must reside inside the owned state directory. Docker inspect
normalization/invocation is owned by the outer launcher; failed inspection must
never be represented by an empty list. stdout contains only safe summaries/IDs.
"""
import argparse
import json
import os
from pathlib import Path
import secrets

from ownership import checked_config, checked_resources, cleanup_plan, identity, private_root, require, require_fresh_inventory


def write_private(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(value, output, indent=2)
        output.write("\n")


def private_file(state, name):
    p = Path(name)
    require(p.is_absolute() and p.resolve() == p and not p.is_symlink(), "FILE_PATH")
    require(p.is_relative_to(state), "FILE_OUTSIDE_STATE")
    st = p.stat()
    require(p.is_file() and st.st_uid == os.getuid() and st.st_mode & 0o077 == 0, "FILE_MODE")
    return json.loads(p.read_text())


def prepare(state, source):
    private_root(state, os.getuid())
    run = "fe-ojb-" + secrets.token_hex(8)
    identity(run, source)
    env = {"FE_REVIEW_RUN_ID": run, "FE_REVIEW_SOURCE": source}
    for role in ("DB", "ADMIN", "GRAFANA"):
        env[f"FE_REVIEW_{role}_USER"] = "review_" + secrets.token_hex(8)
        env[f"FE_REVIEW_{role}_PASSWORD"] = secrets.token_urlsafe(32)
    write_private(state / "environment.json", env)
    write_private(state / "owner.json", {"run": run, "source": source, "uid": os.getuid()})
    return {"prepared": True, "run": run, "source": source}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "check-config", "record", "cleanup-plan", "absent"))
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--source")
    parser.add_argument("--base")
    parser.add_argument("--model")
    parser.add_argument("--inventory")
    args = parser.parse_args()
    state = args.state
    if args.mode == "prepare":
        return prepare(state, args.source or "")
    require(state.is_absolute() and state.resolve() == state and not state.is_symlink(), "STATE_PATH")
    st = state.stat()
    require(state.is_dir() and st.st_uid == os.getuid() and st.st_mode & 0o777 == 0o700, "STATE_MODE")
    owner = private_file(state, str(state / "owner.json"))
    run, source = owner["run"], owner["source"]
    identity(run, source)
    require(owner["uid"] == os.getuid(), "STATE_OWNER")
    if args.mode == "check-config":
        env = private_file(state, str(state / "environment.json"))
        summary = checked_config(private_file(state, args.base), private_file(state, args.model), run, source, env)
        write_private(state / "config-checked.json", summary)
        return summary
    inventory = private_file(state, args.inventory)
    # Explicitly require a successful inspect receipt, not an untrusted [] on error.
    require(inventory.get("inspectionSucceeded") is True, "INVENTORY_UNKNOWN")
    records = inventory.get("resources")
    if args.mode == "absent":
        require_fresh_inventory(records)
        return {"absenceConfirmed": True, "run": run}
    if args.mode == "record":
        private_file(state, str(state / "config-checked.json"))
        checked_resources(records, run, source)
        write_private(state / "owned-resources.json", records)
        return {"recorded": len(records), "run": run}
    owned = private_file(state, str(state / "owned-resources.json"))
    return {"run": run, "removeOnly": cleanup_plan(owned, records, run, source)}


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except (ValueError, KeyError, OSError, TypeError) as error:
        # Avoid secrets and private filenames from parser/IO exceptions.
        code = str(error) if isinstance(error, ValueError) and str(error).startswith("REVIEW_") else "REVIEW_PRIVATE_INPUT"
        print(json.dumps({"passed": False, "error": code}))
        raise SystemExit(1) from None
