#!/usr/bin/env python3
"""Verify isolated Antigravity existing-HTTP accounting using a pinned test binary."""

import argparse
import importlib.util
import json
import math
from pathlib import Path
import signal
import tempfile

# Give the shared launcher its own module instance: prior entry semantics and
# imports remain unchanged, including in a process importing both checkers.
_spec = importlib.util.spec_from_file_location(
    "_antigravity_settlement_native", Path(__file__).with_name("antigravity_http_check.py")
)
_native = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_native)
HTTP_TEST = "proxy::agy_http_tests::as_http_settlement_acceptance"
_native.HTTP_TEST = HTTP_TEST
_native.REPORT_PREFIX = "ANTIGRAVITY_SETTLEMENT_REPORT="
_parse_http = _native.parse_http_report
CheckFailure = _native.CheckFailure


def parse_settlement_report(output):
    value = _parse_http(output)
    flags = value.get("accounting", {})
    required = ("dispatch_rows_match", "unique_attempts", "no_pending_after_recovery",
                "surfaces_match", "no_extra_dispatch", "opaque_semantics_verified",
                "restart_recovery_verified", "reservation_failure_no_dispatch")
    if not isinstance(flags, dict) or any(flags.get(key) is not True for key in required):
        raise CheckFailure("settlement_accounting_not_verified")
    rows = value.get("attempts")
    if (not isinstance(rows, list) or len(rows) != value["counts"]["inference"]
            or len(value["stages"]) < 7):
        raise CheckFailure("settlement_rows_do_not_reconcile")
    ids, outcomes = set(), set()
    for row in rows:
        if not isinstance(row, dict):
            raise CheckFailure("settlement_row_invalid")
        identity = row.get("attempt_id")
        if (not isinstance(identity, str) or not identity or identity in ids
                or not isinstance(row.get("request_id"), str) or not row["request_id"]
                or not isinstance(row.get("finalized_at"), str) or not row["finalized_at"]):
            raise CheckFailure("settlement_identity_or_finalization_invalid")
        ids.add(identity)
        outcome, quality, source = (row.get(key) for key in ("outcome", "usage_status", "usage_source"))
        if (outcome not in ("succeeded", "incomplete", "failed", "cancelled", "timeout", "interrupted", "unknown")
                or quality not in ("complete", "partial", "missing", "invalid", "unknown")
                or source not in ("antigravity_generate_content_v1", "antigravity_opaque_v1")):
            raise CheckFailure("settlement_disposition_invalid")
        outcomes.add(outcome)
        for key in ("prompt_tokens", "completion_tokens", "headers_ms", "first_output_ms", "total_observed_ms"):
            number = row.get(key)
            if number is not None and (type(number) is not int or not 0 <= number <= 2**63 - 1):
                raise CheckFailure("settlement_count_or_time_invalid")
        cost = row.get("estimated_cost_usd")
        if cost is not None and (type(cost) not in (float, int) or not math.isfinite(cost) or cost < 0):
            raise CheckFailure("settlement_cost_invalid")
        if source == "antigravity_opaque_v1":
            if (outcome in ("succeeded", "incomplete") or quality != "unknown"
                    or any(row.get(key) is not None for key in
                           ("prompt_tokens", "completion_tokens", "estimated_cost_usd", "first_output_ms"))):
                raise CheckFailure("opaque_stream_claims_unsupported_evidence")
    if not {"succeeded", "incomplete", "failed", "cancelled", "timeout", "unknown"} <= outcomes:
        raise CheckFailure("settlement_outcome_coverage_incomplete")
    return value


_native.parse_http_report = parse_settlement_report


def check(binary, expected_digest, report_dir):
    report = _native.check(binary, expected_digest, report_dir)
    report["kind"] = "antigravity_existing_http_settlement"
    report["native_antigravity_stream_conversion_verified"] = False
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
    report_dir = Path(tempfile.mkdtemp(prefix="antigravity-settlement-", dir=args.output_dir))
    report = check(args.test_binary, args.expected_test_sha256, report_dir)
    print(f"Antigravity isolated settlement check: {report['status']} ({report['stage']})")
    print(f"Report: {report_dir / 'report.json'}")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
