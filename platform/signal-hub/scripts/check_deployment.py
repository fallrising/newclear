"""Offline worksheet validation; never verifies live history or authorizes operations."""
import argparse
from datetime import datetime, timedelta
import json
from pathlib import Path, PurePosixPath
import re
import sys

HOST = {"non_root", "path_mounts", "tailnet_ingress", "independent_monitor"}
M6 = {"seven_days", "producer_silence", "hub_outage", "yesterday_restore"}
TARGET_REFS = {"node_ref", "workload_ref", "tailnet_acl_ref", "archive_ref", "backup_ref", "rollback_ref"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def keys(value, expected, name):
    require(isinstance(value, dict), name + " must be an object")
    require(set(value) == set(expected), name + " fields differ: " + ",".join(sorted(set(value) ^ set(expected))))


def text(value, name):
    require(isinstance(value, str) and bool(value.strip()) and len(value) <= 4096 and all(ord(c) >= 32 for c in value), name + " must be nonblank text")


def integer(value, lower, upper, name):
    require(type(value) is int and lower <= value <= upper, name + " out of range")


def path(value, name):
    text(value, name)
    require(value.startswith("/") and ".." not in value.split("/") and "//" not in value and value != "/", name + " must be an explicit absolute path without traversal")
    require(str(PurePosixPath(value)) == value, name + " must be a normalized path")


def token_ref(value, name):
    require(isinstance(value, str) and value.startswith("file:/"), name + " must be a file reference")
    path(value[5:], name)


def timestamp(value, name):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z", value) is not None, name + " must be a UTC timestamp")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as e:
        raise ValueError(name + " must be a valid UTC timestamp") from e


def evidence(group, e):
    fields = {
        "seven_days": {"started_at", "ended_at", "sources", "continuous_observation", "unexpected_409", "artifact_ref"},
        "producer_silence": {"source", "expected_interval_seconds", "last_received_at", "stopped_at", "silent_at", "phone_received_at", "artifact_ref"},
        "hub_outage": {"stopped_at", "phone_received_at", "independent_path", "artifact_ref"},
        "yesterday_restore": {"snapshot_at", "restored_at", "isolated", "fresh_destination", "integrity_verified", "queue_verified", "artifact_ref"},
    }
    keys(e, fields.get(group, {"artifact_ref"}), group + " evidence")
    text(e["artifact_ref"], group + " artifact_ref")
    require(not e["artifact_ref"].startswith("example:"), group + " requires a real artifact reference")
    if group == "seven_days":
        start = timestamp(e["started_at"], "started_at")
        end = timestamp(e["ended_at"], "ended_at")
        require(end - start >= timedelta(days=7), "seven elapsed days required")
        require(type(e["sources"]) is list and len(e["sources"]) == 3 and all(isinstance(s, str) for s in e["sources"]) and sorted(e["sources"]) == ["alertmanager", "inspection", "release"], "all three configured sources required")
        require(e["continuous_observation"] is True, "continuous observation required")
        integer(e["unexpected_409"], 0, 0, "unexpected_409")
    elif group == "producer_silence":
        require(isinstance(e["source"], str) and e["source"] in {"release", "inspection", "alertmanager"}, "unknown source")
        integer(e["expected_interval_seconds"], 1, 315360000, "expected_interval_seconds")
        last = timestamp(e["last_received_at"], "last_received_at")
        stop = timestamp(e["stopped_at"], "stopped_at")
        silent = timestamp(e["silent_at"], "silent_at")
        phone = timestamp(e["phone_received_at"], "phone_received_at")
        require(last <= stop <= silent <= phone, "silence timestamps out of order")
        require((silent - last).total_seconds() > 2 * e["expected_interval_seconds"], "silent age must be strictly greater than twice interval")
    elif group == "hub_outage":
        stop = timestamp(e["stopped_at"], "stopped_at")
        phone = timestamp(e["phone_received_at"], "phone_received_at")
        require(0 <= (phone - stop).total_seconds() <= 300, "hub notification must arrive within 300 seconds")
        require(e["independent_path"] is True, "independent notification path required")
    elif group == "yesterday_restore":
        snap = timestamp(e["snapshot_at"], "snapshot_at")
        restore = timestamp(e["restored_at"], "restored_at")
        require(snap.date() == restore.date() - timedelta(days=1), "snapshot must be from previous UTC day")
        for field in ("isolated", "fresh_destination", "integrity_verified", "queue_verified"):
            require(e[field] is True, field + " required")


def validate(packet, acceptance=False):
    keys(packet, {"version", "evidence_kind", "authorization_ref", "target", "launch", "monitor", "host_gates", "m6"}, "worksheet")
    integer(packet["version"], 1, 1, "version")
    require(isinstance(packet["evidence_kind"], str) and packet["evidence_kind"] in {"synthetic", "real"}, "invalid evidence_kind")
    real = packet["evidence_kind"] == "real"
    require(not acceptance or real, "acceptance requires real evidence")
    if packet["authorization_ref"] is not None:
        text(packet["authorization_ref"], "authorization_ref")
    t = packet["target"]
    keys(t, TARGET_REFS | {"binary_sha256", "config_sha256", "schema_version"}, "target")
    for field in TARGET_REFS:
        text(t[field], field)
        require(not real or not t[field].startswith("example:"), field + " needs a private actual target reference")
    for field in ("binary_sha256", "config_sha256"):
        require(isinstance(t[field], str) and re.fullmatch("[0-9a-f]{64}", t[field]) is not None, field + " must be SHA-256")
        require(not real or t[field] != "0" * 64, field + " must pin actual bytes")
    integer(t["schema_version"], 1, 2147483647, "schema_version")
    l = packet["launch"]
    keys(l, {"service_uid", "binary", "config", "db", "owner_token_ref", "readonly_token_ref", "port"}, "launch")
    integer(l["service_uid"], 1, 2147483647, "service_uid")
    integer(l["port"], 1024, 65535, "port")
    for field in ("binary", "config", "db"):
        path(l[field], field)
    token_ref(l["owner_token_ref"], "owner_token_ref")
    if l["readonly_token_ref"] is not None:
        token_ref(l["readonly_token_ref"], "readonly_token_ref")
        require(l["readonly_token_ref"] != l["owner_token_ref"], "credential references must be distinct")
    m = packet["monitor"]
    fixed = {"outside_process": True, "outside_host": True, "independent_notify": True, "cadence_seconds": 60, "deadline_seconds": 10, "failure_threshold": 2, "send_budget_seconds": 60}
    keys(m, fixed, "monitor")
    for field, value in fixed.items():
        require(type(m[field]) is type(value) and m[field] == value, "monitor " + field + " differs from frozen budget")
    passed = False
    for section, expected in (("host_gates", HOST), ("m6", M6)):
        keys(packet[section], expected, section)
        for group, gate in packet[section].items():
            keys(gate, {"status", "evidence"}, group)
            require(isinstance(gate["status"], str) and gate["status"] in {"pending", "passed"}, group + " invalid status")
            if gate["status"] == "pending":
                require(gate["evidence"] is None, group + " pending evidence must be null")
                require(not acceptance, group + " is pending")
            else:
                passed = True
                require(real, "synthetic preparation cannot claim passed gates")
                evidence(group, gate["evidence"])
    if acceptance or passed:
        text(packet["authorization_ref"], "authorization_ref")
        require(not packet["authorization_ref"].startswith("example:"), "actual authorization reference required")


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result


def load(pathname):
    def invalid_constant(_):
        raise ValueError("nonfinite JSON constant")
    return json.loads(Path(pathname).read_text(), object_pairs_hook=strict_object, parse_constant=invalid_constant)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("worksheet", nargs="?", default=Path(__file__).resolve().parents[1] / "deployment/intent.example.json")
    parser.add_argument("--acceptance", action="store_true", help="check submitted real evidence structure only")
    args = parser.parse_args()
    try:
        p = load(args.worksheet)
        validate(p, args.acceptance)
    except (OSError, ValueError, TypeError, OverflowError, RecursionError):
        print("deployment worksheet invalid; inspect locally using validate() for field diagnostics", file=sys.stderr)
        return 1
    pending = sorted(name for section in ("host_gates", "m6") for name, gate in p[section].items() if gate["status"] == "pending")
    print("Submitted evidence structure valid; original artifacts and owner acceptance require review." if args.acceptance else "Preparation structure valid; no deployment or live acceptance established.")
    print("Pending gates: " + (", ".join(pending) or "none submitted; authenticity unverified"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
