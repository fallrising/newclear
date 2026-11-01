#!/usr/bin/env python3
"""Run the isolated Antigravity native HTTP harness, never a live provider demo."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
from urllib.parse import urlsplit


TRANSPORT_PREFIX = "antigravity_test_transport::tests::"
HTTP_TEST = "proxy::agy_http_tests::ai_http_acceptance"
REPORT_PREFIX = "ANTIGRAVITY_HTTP_REPORT="


class CheckFailure(Exception):
    """A fixed, content-free diagnostic safe for the operator report."""


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run_native(binary, args, timeout=120):
    # No inherited credentials, proxy settings, provider configuration or CLI paths.
    env = {"PATH": os.defpath, "LANG": "C.UTF-8", "RUST_BACKTRACE": "0"}
    start = time.monotonic()
    process = subprocess.Popen(
        [str(binary), *args], env=env, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, start_new_session=True,
    )
    try:
        output, _ = process.communicate(timeout=timeout)
    except BaseException:
        # This process group is created and owned by this invocation only.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()
        raise
    return process.returncode, output, round(time.monotonic() - start, 6)


def discover_tests(output):
    names = [line[:-6] for line in output.decode("utf-8", "strict").splitlines()
             if line.endswith(": test")]
    transport = sorted(name for name in names if name.startswith(TRANSPORT_PREFIX))
    if not transport or names.count(HTTP_TEST) != 1:
        raise CheckFailure("required_native_tests_missing")
    if len(transport) != len(set(transport)):
        raise CheckFailure("duplicate_native_test_names")
    return transport


def verify_results(output, expected):
    text = output.decode("utf-8", "strict")
    results = re.findall(r"^test ([^\s]+) \.\.\. ok$", text, re.MULTILINE)
    # nocapture tests may emit output between the test name and its final `ok`.
    summary = re.findall(
        r"test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;", text
    )
    if len(summary) != 1 or tuple(map(int, summary[0])) != (len(expected), 0, 0):
        raise CheckFailure("native_test_result_incomplete")
    for name in expected:
        if not re.search(r"^test " + re.escape(name) + r" \.\.\.", text, re.MULTILINE):
            raise CheckFailure("native_test_not_executed")
    if any(name not in expected for name in results):
        raise CheckFailure("unexpected_native_test_executed")


def parse_http_report(output):
    lines = [line[len(REPORT_PREFIX):] for line in output.decode("utf-8", "strict").splitlines()
             if line.startswith(REPORT_PREFIX)]
    if len(lines) != 1:
        raise CheckFailure("http_report_missing_or_duplicate")
    try:
        value = json.loads(lines[0])
    except (ValueError, TypeError) as error:
        raise CheckFailure("http_report_invalid_json") from error
    if not isinstance(value, dict):
        raise CheckFailure("http_report_invalid_shape")
    if (value.get("schema_version") != 1 or value.get("test") != HTTP_TEST
            or value.get("status") != "passed" or value.get("actual_gateway_http") is not True):
        raise CheckFailure("http_report_not_verified")
    cleanup = value.get("cleanup", {})
    if (not isinstance(cleanup, dict)
            or any(cleanup.get(key) is not True for key in (
                "gateway_task_joined", "fake_task_joined", "listeners_rebound", "temporary_data_removed"))
            or cleanup.get("active_streams") != 0):
        raise CheckFailure("http_cleanup_not_verified")
    stages = value.get("stages")
    if not isinstance(stages, list) or not stages or any(
        not isinstance(stage, dict) or stage.get("status") != "passed" for stage in stages
    ):
        raise CheckFailure("http_stages_not_verified")
    counts, records = value.get("counts", {}), value.get("destinations")
    if (not isinstance(counts, dict) or counts.get("unexpected_destinations") != 0
            or not isinstance(records, list) or not records):
        raise CheckFailure("http_destinations_not_verified")
    observed = {name: 0 for name in ("inference", "discovery", "refresh")}
    paths = {"inference": "/v1internal:generateContent",
             "discovery": "/v1internal:loadCodeAssist", "refresh": "/token"}
    origins = set()
    for sequence, record in enumerate(records, 1):
        if not isinstance(record, dict) or record.get("operation") not in observed:
            raise CheckFailure("http_unknown_operation")
        operation = record["operation"]
        url = urlsplit(record.get("destination", ""))
        if (url.scheme != "http" or url.hostname != "127.0.0.1" or not url.port
                or url.username or url.password or url.query or url.fragment
                or url.path != paths[operation] or record.get("method") != "POST"
                or record.get("sequence") != sequence
                or record.get("synthetic_auth_validated") is not True
                or record.get("synthetic_body_validated") is not True):
            raise CheckFailure("http_destination_or_request_not_verified")
        origins.add(url.netloc)
        observed[operation] += 1
    if len(origins) != 1 or any(counts.get(name) != count or count == 0 for name, count in observed.items()):
        raise CheckFailure("http_counts_do_not_reconcile")
    return value


def check(binary, expected_digest, report_dir):
    report = {
        "schema": 1, "kind": "antigravity_native_http_acceptance",
        "synthetic": True, "live_client_version_provider_verified": False,
        "production_demo_mode": False, "status": "failed", "stage": "binary_guard",
        "test_binary_sha256": None, "commands": [], "http": None,
        "whole_round_metrics": None,
    }
    try:
        if not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
            raise CheckFailure("invalid_expected_digest")
        binary = binary.resolve(strict=True)
        report["test_binary_sha256"] = sha256(binary)
        if report["test_binary_sha256"] != expected_digest:
            raise CheckFailure("test_binary_digest_mismatch")
        report["stage"] = "discover_native_tests"
        code, output, elapsed = run_native(binary, ["--list"], timeout=15)
        report["commands"].append({"stage": report["stage"], "exit": code,
                                   "seconds": elapsed, "output_sha256": hashlib.sha256(output).hexdigest()})
        if code:
            raise CheckFailure("test_discovery_failed")
        transport = discover_tests(output)
        for stage, args, names in (
            ("isolation_proof", [TRANSPORT_PREFIX, "--nocapture", "--test-threads=1"], transport),
            ("actual_http_acceptance", [HTTP_TEST, "--exact", "--nocapture", "--test-threads=1"], [HTTP_TEST]),
        ):
            report["stage"] = stage
            # Shared build output is never trusted; check the preserved file before each launch.
            if sha256(binary) != expected_digest:
                raise CheckFailure("test_binary_digest_mismatch")
            code, output, elapsed = run_native(binary, args)
            report["commands"].append({"stage": stage, "tests": names, "exit": code,
                                       "seconds": elapsed, "output_sha256": hashlib.sha256(output).hexdigest()})
            if code:
                raise CheckFailure("native_test_failed")
            verify_results(output, names)
            if stage == "actual_http_acceptance":
                report["http"] = parse_http_report(output)
        report["status"] = "passed"
        report["stage"] = "verified"
    except KeyboardInterrupt:
        report["error"] = "interrupted"
    except (CheckFailure, OSError, UnicodeError, subprocess.TimeoutExpired) as error:
        report["error"] = str(error) if isinstance(error, CheckFailure) else type(error).__name__
    finally:
        (report_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main():
    def stop(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="default and only mode")
    parser.add_argument("--test-binary", required=True, type=Path)
    parser.add_argument("--expected-test-sha256", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report_dir = Path(tempfile.mkdtemp(prefix="antigravity-http-", dir=args.output_dir))
    report = check(args.test_binary, args.expected_test_sha256, report_dir)
    print(f"Antigravity isolated HTTP check: {report['status']} ({report['stage']})")
    print(f"Report: {report_dir / 'report.json'}")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
