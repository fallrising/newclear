#!/usr/bin/env python3
"""Pure fixed-contract verifier for fixture-startup evidence; never launches code."""
import argparse
import hashlib
import json
from pathlib import Path
import re

SCENARIOS = (
    ("fs_actual_port_zero_owned_admin", "actual_gateway_http", dict(owned_children_reaped=True, listener_ports_released=True, children=2, health_request_attempts=2, admin_request_attempts=2)),
    ("fs_actual_occupied_port_preserves_foreign_health", "actual_gateway_process", dict(owned_children_reaped=True, foreign_listener_preserved=True, foreign_requests=0, announcements=0, children=1)),
    ("fs_controlled_early_exit_and_silent_deadline", "controlled_child", dict(owned_children_reaped=True, children=2, exit_code=7, timeout_classified=True, canary_redacted=True, health_request_attempts=0, admin_request_attempts=0)),
    ("fs_controlled_oversize_then_ready_keeps_draining", "controlled_child_http", dict(owned_children_reaped=True, children=1, continuous_drain=True, canary_redacted=True, max_line_bytes=4096, oversized_lines=1, health_request_attempts=1, admin_request_attempts=1)),
    ("fs_controlled_malformed_and_wrong_host_announcements", "controlled_child", dict(owned_children_reaped=True, children=5, rejected_announcements=5, health_request_attempts=0, admin_request_attempts=0, canary_redacted=True)),
    ("fs_controlled_auth_and_redirect_fail_closed", "controlled_child_http", dict(owned_children_reaped=True, children=2, foreign_listener_preserved=True, foreign_requests=0, auth_status=401, redirect_status=302, health_request_attempts=2, admin_request_attempts=1, canary_redacted=True)),
    ("fs_actual_serial_and_concurrent_ownership_cleanup", "actual_gateway_http", dict(owned_children_reaped=True, children=4, distinct_concurrent_ports=True, listener_ports_released=True, health_request_attempts=4, admin_request_attempts=4, cross_admin_requests=2, cross_admin_rejected=True)),
    ("fs_actual_drop_releases_owned_listener", "actual_gateway_http", dict(owned_children_reaped=True, children=1, listener_ports_released=True, health_request_attempts=1, admin_request_attempts=1)),
    ("fs_controlled_start_future_cancellation_reaps", "controlled_child", dict(owned_children_reaped=True, children=1, startup_cancelled=True)),
    ("fs_parser_exact_boundaries", "pure_parser", dict(accepted_variants=2, rejected_variants=6)),
)
CONTRACT = {name: dict(scenario=name, layer=layer, passed=True, **fields) for name, layer, fields in SCENARIOS}
NAMES = tuple(sorted(CONTRACT))
HELPERS = ("fixture_startup_check.py", "fixture_startup_walkthrough.py")
REQUIRED_INPUTS = ("gateways/pokercase/src/server.rs", "gateways/pokercase/tests/support/owned_gateway.rs", "gateways/pokercase/tests/fixture_startup.rs", "gateways/pokercase/Cargo.toml", "gateways/pokercase/Cargo.lock")
PROBE_SHA256 = "d6883fada109f3327e9b5935c64791c079fe65eaaae4b57f01d00418d5850b22"
MAX_OUTPUT = 2 * 1024 * 1024
MAX_LINE = 16384
MAX_SECONDS = 600
ISOLATION = dict(environment_cleared=True, synthetic_home_data=True, stdin_null=True,
                 pinned_normal_override=True, source_closed_native_fixtures=True,
                 no_provider_configuration=True, provider_requests=0,
                 provider_requests_basis="source_closed_no_provider_paths")


class CheckFailure(Exception):
    """Only fixed diagnostic codes may escape to the public report."""


def require(ok, code):
    if not ok:
        raise CheckFailure(code)


def exact(a, b):
    if type(a) is not type(b):
        return False
    if isinstance(b, dict):
        return a.keys() == b.keys() and all(exact(a[k], v) for k, v in b.items())
    if isinstance(b, list):
        return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
    return a == b


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


def loads(raw):
    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(CheckFailure("nonfinite_json")))
    except (ValueError, UnicodeError, RecursionError):
        raise CheckFailure("invalid_json") from None


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def valid_sha(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def pinned(record):
    require(isinstance(record, dict) and set(record) == {"path", "sha256"}, "pin_shape")
    require(isinstance(record["path"], str) and Path(record["path"]).is_absolute()
            and Path(record["path"]).is_file() and valid_sha(record["sha256"]), "pin_path")
    require(digest(record["path"]) == record["sha256"], "pin_mismatch")
    return Path(record["path"])


def validate_event(event):
    require(isinstance(event, dict) and isinstance(event.get("scenario"), str)
            and event["scenario"] in CONTRACT, "event_scenario")
    require(exact(event, CONTRACT[event["scenario"]]), "event_contract")
    return event


def validate_probe(probe, phase, normal_sha):
    require(isinstance(probe, dict) and set(probe) == {"schema", "status", "binary_sha256", "probe_sha256", "isolation_before_launch", "cases", "historical_root_cause"}, "probe_shape")
    require(type(probe["schema"]) is int and probe["schema"] == 1
            and probe["status"] == ("failed" if phase == "red" else "passed")
            and probe["historical_root_cause"] == "unknown"
            and probe["probe_sha256"] == PROBE_SHA256 and valid_sha(probe["binary_sha256"]), "probe_identity")
    if phase == "green":
        require(probe["binary_sha256"] == normal_sha, "probe_normal_binary")
    require(exact(probe["isolation_before_launch"], dict(synthetic_home_data=True, environment_cleared=True, no_connections_configured=True, no_inference_refresh_discovery=True, no_http_clients=True, only_loopback_bind=True)), "probe_isolation")
    require(isinstance(probe["cases"], list) and len(probe["cases"]) == 2, "probe_cases")
    for case, name in zip(probe["cases"], ("port_zero", "occupied_port")):
        want = dict(scenario=name, layer="actual_gateway_process", http_requests=0, provider_requests=0,
                    announcements=1 if name == "port_zero" or phase == "red" else 0,
                    announced_nonzero=phase == "green" if name == "port_zero" else phase == "red",
                    endpoint_count=4 if name == "port_zero" or phase == "red" else 0,
                    endpoints_match_bound=name == "port_zero" or phase == "red",
                    exit_before_cleanup=None if name == "port_zero" else 1,
                    capture_overflow=False, passed=phase == "green", owned_child_reaped=True,
                    temporary_state_removed=True)
        if name == "occupied_port":
            want.update(foreign_connections=0, foreign_listener_preserved=True)
        require(isinstance(case, dict) and type(case.get("stderr_bytes")) is int
                and 0 < case["stderr_bytes"] <= MAX_OUTPUT, "probe_bytes")
        require(exact({k: v for k, v in case.items() if k != "stderr_bytes"}, want), "probe_case_contract")
    return dict(sha256=None, binary_sha256=probe["binary_sha256"], probe_sha256=probe["probe_sha256"], status=probe["status"])


def verify_manifest(manifest):
    require(isinstance(manifest, dict) and set(manifest) == {"schema_version", "normal_binary", "native_binary", "helpers", "source_inputs", "source_provenance", "native_inventory", "inventory_sha256", "case_contract", "listening_probes"}, "manifest_shape")
    require(type(manifest["schema_version"]) is int and manifest["schema_version"] == 1, "manifest_schema")
    require(exact(manifest["native_inventory"], list(NAMES)) and valid_sha(manifest["inventory_sha256"]), "manifest_inventory")
    require(exact(manifest["case_contract"], CONTRACT), "manifest_contract")
    for key in ("normal_binary", "native_binary"):
        pinned(manifest[key])
    require(isinstance(manifest["helpers"], dict) and set(manifest["helpers"]) == set(HELPERS), "helper_inventory")
    for name in HELPERS:
        path = pinned(manifest["helpers"][name])
        require(path.name == name and digest(Path(__file__).with_name(name)) == manifest["helpers"][name]["sha256"], "active_helper_mismatch")
    inputs = manifest["source_inputs"]
    require(isinstance(inputs, list) and inputs, "source_inputs")
    paths = [str(pinned(item)) for item in inputs]
    require(len(paths) == len(set(paths)) and all(any(p.endswith('/'+suffix) for p in paths) for suffix in REQUIRED_INPUTS), "source_inventory")
    provenance = manifest["source_provenance"]
    require(isinstance(provenance, dict) and set(provenance) == {"source_commit", "dirty"}
            and isinstance(provenance["source_commit"], str)
            and re.fullmatch(r"[a-f0-9]{40}", provenance["source_commit"]) and type(provenance["dirty"]) is bool, "source_provenance")
    require(isinstance(manifest["listening_probes"], dict) and set(manifest["listening_probes"]) == {"red", "green"}, "probe_inventory")
    probes = {}
    for phase, record in manifest["listening_probes"].items():
        path = pinned(record)
        require(path.stat().st_size <= 65536, "probe_size")
        probes[phase] = validate_probe(loads(path.read_bytes()), phase, manifest["normal_binary"]["sha256"])
        probes[phase]["sha256"] = record["sha256"]
    return probes


class EvidenceStream:
    """Bounded incremental collector. Arbitrary output is discarded, never reported."""
    def __init__(self):
        self.buffers = {"stdout": bytearray(), "stderr": bytearray()}
        self.dropping = {key: False for key in self.buffers}
        self.bytes = 0
        self.overflow = False
        self.invalid = False
        self.panic = False
        self.events = []
        self.summary_count = 0
        self.summary_ok = False
        self.hash = hashlib.sha256()

    def feed(self, channel, chunk):
        self.bytes += len(chunk)
        self.overflow |= self.bytes > MAX_OUTPUT
        self.hash.update(chunk)
        for part in chunk.splitlines(keepends=True):
            ending = part.endswith(b'\n')
            if not self.dropping[channel]:
                if len(self.buffers[channel]) + len(part) > MAX_LINE:
                    self.overflow = True
                    self.buffers[channel].clear()
                    self.dropping[channel] = True
                else:
                    self.buffers[channel].extend(part)
            if ending:
                if not self.dropping[channel]:
                    self.line(bytes(self.buffers[channel]))
                self.buffers[channel].clear()
                self.dropping[channel] = False

    def finish(self):
        for channel, value in self.buffers.items():
            if value and not self.dropping[channel]:
                self.line(bytes(value))
            value.clear()

    def line(self, raw):
        self.panic |= b"panicked" in raw or b"test result: FAILED" in raw
        if b"FS_EVIDENCE" in raw:
            prefix, marker, payload = raw.partition(b"FS_EVIDENCE ")
            permitted = not prefix or any(prefix == ("test "+name+" ... ").encode() for name in NAMES)
            try:
                require(marker and permitted and len(self.events) < len(NAMES), "evidence_line")
                event = validate_event(loads(payload))
                require(event["scenario"] not in {e["scenario"] for e in self.events}, "duplicate_event")
                self.events.append(event)
            except CheckFailure:
                self.invalid = True
        if raw.startswith(b"test result:"):
            self.summary_count += 1
            self.summary_ok = re.fullmatch(rb"test result: ok\. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in [0-9.]+s\s*", raw) is not None

    def result(self):
        self.finish()
        return dict(bytes=self.bytes, sha256=self.hash.hexdigest(), overflow=self.overflow,
                    invalid_evidence=self.invalid, panic=self.panic, summary_count=self.summary_count,
                    summary_ok=self.summary_ok, events=sorted(self.events, key=lambda e: e["scenario"]))


def parse_inventory(raw):
    require(isinstance(raw, bytes) and len(raw) <= MAX_OUTPUT, "inventory_size")
    try:
        lines = raw.decode("ascii").splitlines()
    except UnicodeError:
        raise CheckFailure("inventory_encoding") from None
    names = [line[:-6] for line in lines if line.endswith(": test")]
    require(tuple(sorted(names)) == NAMES and len(names) == len(set(names))
            and all(not line or line.endswith(": test") or line == "10 tests, 0 benchmarks" for line in lines)
            and lines.count("10 tests, 0 benchmarks") == 1, "native_inventory")
    return names


def fingerprints(manifest):
    return dict(normal_binary=manifest["normal_binary"]["sha256"], native_binary=manifest["native_binary"]["sha256"],
                helpers={name: manifest["helpers"][name]["sha256"] for name in HELPERS},
                inventory=manifest["inventory_sha256"],
                source_inputs=hashlib.sha256(json.dumps(manifest["source_inputs"], sort_keys=True, separators=(',', ':')).encode()).hexdigest())


def validate_report(report, manifest, probes):
    keys = {"schema_version", "status", "historical_root_cause", "whole_round_metrics", "live_client_version_provider_verified", "owner_personal_run_claimed", "fingerprints", "source_provenance", "listening_probes", "isolation", "inventory", "native", "temporary_state_removed", "failure_code"}
    require(isinstance(report, dict) and set(report) == keys, "report_shape")
    require(type(report["schema_version"]) is int and report["schema_version"] == 1
            and report["status"] == "passed" and report["failure_code"] is None, "report_status")
    require(report["historical_root_cause"] == "unknown" and report["whole_round_metrics"] is None
            and report["live_client_version_provider_verified"] is False
            and report["owner_personal_run_claimed"] is False, "false_acceptance_claim")
    require(exact(report["fingerprints"], fingerprints(manifest)) and exact(report["source_provenance"], manifest["source_provenance"]), "report_attribution")
    require(exact(report["listening_probes"], probes) and exact(report["isolation"], ISOLATION), "report_isolation_or_probe")
    require(report["temporary_state_removed"] is True, "temporary_cleanup")
    for key in ("inventory", "native"):
        run = report[key]
        require(isinstance(run, dict) and set(run) == {"exit_code", "timed_out", "elapsed_ms", "owned_process_reaped", "descendant_cleanup", "output"}, "command_shape")
        require(type(run["exit_code"]) is int and run["exit_code"] == 0 and run["timed_out"] is False
                and run["owned_process_reaped"] is True and run["descendant_cleanup"] is None, "command_failed")
        require(type(run["elapsed_ms"]) is int and 0 <= run["elapsed_ms"] <= 605000, "command_elapsed")
    inv = report["inventory"]["output"]
    require(isinstance(inv, dict) and set(inv) == {"bytes", "sha256", "overflow", "names"}
            and type(inv["bytes"]) is int and 0 < inv["bytes"] <= MAX_OUTPUT
            and inv["overflow"] is False and inv["sha256"] == manifest["inventory_sha256"]
            and exact(inv["names"], list(NAMES)), "report_inventory")
    out = report["native"]["output"]
    require(isinstance(out, dict) and set(out) == {"bytes", "sha256", "overflow", "invalid_evidence", "panic", "summary_count", "summary_ok", "events"}, "native_output_shape")
    require(type(out["bytes"]) is int and 0 < out["bytes"] <= MAX_OUTPUT and valid_sha(out["sha256"])
            and out["overflow"] is False and out["invalid_evidence"] is False and out["panic"] is False
            and type(out["summary_count"]) is int and out["summary_count"] == 1 and out["summary_ok"] is True, "native_output_failed")
    require(exact(out["events"], [CONTRACT[name] for name in NAMES]), "event_inventory_or_values")
    return {"status": "passed", "scenarios": len(NAMES), "historical_root_cause": "unknown"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    try:
        require(args.manifest.stat().st_size <= MAX_OUTPUT, "manifest_size")
        manifest = loads(args.manifest.read_bytes())
        probes = verify_manifest(manifest)
        require(args.report.stat().st_size <= MAX_OUTPUT, "report_size")
        print(json.dumps(validate_report(loads(args.report.read_bytes()), manifest, probes), sort_keys=True))
        return 0
    except (CheckFailure, OSError):
        print('{"status":"failed","failure_code":"verification_failed"}')
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
