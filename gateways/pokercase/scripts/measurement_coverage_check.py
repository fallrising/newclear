#!/usr/bin/env python3
"""Check saved measurement coverage through an isolated real admin HTTP server."""

import argparse
from contextlib import ExitStack, closing
import csv
from datetime import date, timedelta
import hashlib
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import re
import signal
import socket
import sqlite3
import subprocess
import tempfile
from urllib.parse import urlsplit

from offline_fixture import Fixture
from offline_walkthrough import Gateway, JourneyFailure, digest

METRICS = ("prompt_tokens", "completion_tokens", "headers_ms", "cli_ready_ms",
           "first_output_ms", "total_observed_ms", "latency_ms")
RAW_FIELDS = ("reported_input_tokens", "reported_output_tokens",
              "reported_cache_read_input_tokens", "reported_cache_creation_input_tokens")
FIELDS = ("id", "ts", "public_model", "connection_id", "status", "latency_ms",
          "error", "prompt_tokens", "completion_tokens", "estimated_cost_usd",
          "request_id", "attempt_id", "upstream_model", "finalized_at", "headers_ms",
          "first_output_ms", "total_observed_ms", "outcome", "usage_status",
          "usage_source", "cli_ready_ms", *RAW_FIELDS)
I64_MAX = 2**63 - 1


class CheckFailure(Exception):
    """Only fixed diagnostic codes are persisted."""


def require(condition, code):
    if not condition:
        raise CheckFailure(code)


def expected_measurements(rows):
    """Independent fixture arithmetic: no product or Store helper is used."""
    result = {}
    for metric in METRICS:
        known = [row[metric] for row in rows if row[metric] is not None]
        require(all(type(value) is int for value in known), "fixture_noninteger")
        exact = sum(known) if known else None
        measured_sum = exact if exact is None or -2**63 <= exact <= I64_MAX else None
        status = ("no_data" if not rows else "unknown" if not known else
                  "unavailable" if measured_sum is None else
                  "complete" if len(known) == len(rows) else "partial")
        result[metric] = {
            "known_sum": measured_sum,
            "known_mean": float(exact) / len(known) if metric.endswith("_ms") and known else None,
            "known_count": len(known), "unknown_count": len(rows) - len(known),
            "total_count": len(rows), "coverage": len(known) / len(rows) if rows else None,
            "status": status,
            "basis": "stored_legacy_latency_ms" if metric == "latency_ms" else "stored_" + metric,
        }
    return result


def expected_cost(rows):
    values = [row["estimated_cost_usd"] for row in rows if row["estimated_cost_usd"] is not None]
    return {"known_sum": sum(values) if values else None, "known_count": len(values),
            "unknown_count": len(rows) - len(values), "total_count": len(rows),
            "coverage": len(values) / len(rows) if rows else None,
            "status": "no_data" if not rows else "unknown" if not values else
                      "complete" if len(values) == len(rows) else "partial",
            "basis": "stored_estimate_usd"}


def selected_rows(rows, limit):
    days = sorted({row["ts"][:10] for row in rows}, reverse=True)[:limit]
    return days, [row for row in rows if row["ts"][:10] in days]


def complete_value(summary):
    return summary["known_sum"] if summary["status"] == "complete" else None


def validate_daily(payload, rows, revision):
    days, selected = selected_rows(rows, 30)
    require(payload.get("schema_revision") == revision, "daily_schema_revision")
    if revision == 2:
        require(payload.get("scope") == {"day_bucket_limit": 30,
                "selection": "latest_populated_date_prefix_buckets",
                "denominator": "stored_event_attempt_rows"}, "daily_scope_missing")
        require(payload.get("basis") == {
            "tokens": "stored_counters_not_subscription_consumption",
            "timing_mean": "known_saved_observations",
            "latency_ms": "mixed_legacy_and_headers_or_cli_ready_compatibility"}, "daily_basis")
    else:
        compatibility = payload.get("compatibility", {})
        require(compatibility.get("status") == "legacy_numeric"
                and compatibility.get("canonical_url") == "/admin/api/usage/daily?schema=2"
                and "missing" in compatibility.get("message", ""), "legacy_compatibility_metadata")
    actual = payload.get("data")
    require(isinstance(actual, list) and [row.get("day") for row in actual] == days, "daily_day_scope")
    if revision == 2:
        require(payload.get("measurement_summary") == expected_measurements(selected), "selected_measurement_summary")
    for day in actual:
        group = [row for row in selected if row["ts"][:10] == day["day"]]
        expected = expected_measurements(group)
        require(day.get("measurement_summary") == expected, "daily_measurement_summary")
        for metric in ("prompt_tokens", "completion_tokens"):
            value = complete_value(expected[metric]) if revision == 2 else (expected[metric]["known_sum"] or 0)
            require(day.get(metric) == value, "daily_partial_as_total")
        mean = expected["latency_ms"]["known_mean"]
        require(day.get("avg_latency_ms") == (mean if revision == 2 else mean or 0.0), "daily_known_mean")
        require(day.get("requests") == len(group), "daily_attempt_denominator")
        require(day.get("ok") == sum(row["outcome"] == "succeeded" for row in group), "daily_success_count")
        require(day.get("errors") == sum(row["outcome"] in ("failed", "cancelled", "timeout", "interrupted") for row in group), "daily_failure_count")
        require(day.get("incomplete") == sum(row["outcome"] == "incomplete" for row in group), "daily_incomplete_count")
        require(day.get("unknown") == sum(row["outcome"] == "unknown" for row in group), "daily_unknown_count")
        require(day.get("pending") == sum(row["attempt_id"] is not None and row["finalized_at"] is None for row in group), "daily_pending_count")
        require(day.get("headers_200") == sum(row["status"] == 200 for row in group), "daily_headers_count")
        cost = expected_cost(group)
        require(day.get("cost_summary") == cost and day.get("estimated_cost_usd") == complete_value(cost), "daily_cost_preservation")
    return {"selected_days": len(days), "selected_rows": len(selected)}


class MeasurementHTML(HTMLParser):
    """Read exact rendered measurements and their visible text, not source HTML."""
    VOID = frozenset(("area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"))

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.metrics = {}
        self.visible = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        scope = attrs.get("data-measurement-scope")
        if scope is None and self.stack:
            scope = self.stack[-1][1]
        metric = attrs.get("data-metric")
        key = (scope, metric) if metric is not None else None
        if key:
            require(scope is not None and key not in self.metrics, "html_duplicate_or_unscoped_metric")
            self.metrics[key] = {"attributes": attrs, "text": ""}
        if tag not in self.VOID:
            self.stack.append((tag, scope, key))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def handle_data(self, text):
        self.visible.append(text)
        for _, _, key in self.stack:
            if key:
                self.metrics[key]["text"] += text


def validate_html(raw, rows):
    parser = MeasurementHTML()
    parser.feed(raw.decode("utf-8", "strict"))
    days, selected = selected_rows(rows, 14)
    scopes = {"selected": selected, **{day: [row for row in selected if row["ts"][:10] == day] for day in days}}
    require(set(parser.metrics) == {(scope, metric) for scope in scopes for metric in METRICS}, "html_measurement_scope")
    for scope, group in scopes.items():
        for metric, want in expected_measurements(group).items():
            observed = parser.metrics[(scope, metric)]
            attrs, text = observed["attributes"], observed["text"].lower()
            visible = " ".join(text.split())
            for field, expected in want.items():
                value = attrs.get("data-" + field.replace("_", "-"))
                require(value is not None, "html_measurement_attribute_missing")
                if expected is None:
                    require(value == "", "html_missing_measurement_false_zero")
                elif type(expected) in (int, float):
                    parsed = int(value) if type(expected) is int else float(value)
                    require(parsed == expected, "html_measurement_value")
                else:
                    require(value == expected, "html_measurement_semantics")
            if want["status"] == "unknown":
                require("unknown" in text, "html_unknown_label")
            elif want["status"] == "no_data":
                require("no data" in text, "html_no_data_label")
            elif want["status"] == "partial" and not metric.endswith("_ms"):
                require("subtotal" in text, "html_partial_total_label")
            if metric.endswith("_ms") and want["known_count"]:
                require("mean" in text, "html_known_mean_label")
            require(metric in visible, "html_metric_label")
            subtotal = re.search(r"known subtotal ([+-]?\d+)(?=\s|$)", visible)
            require((subtotal is None and "known subtotal" not in visible) if want["known_sum"] is None
                    else subtotal is not None and int(subtotal.group(1)) == want["known_sum"],
                    "html_visible_subtotal")
            mean = re.search(r"mean of known observations ([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?) ms", visible)
            require((mean is None and "mean of known observations" not in visible) if want["known_mean"] is None
                    else mean is not None and float(mean.group(1)) == want["known_mean"],
                    "html_visible_mean")
            require(f"coverage {want['known_count']}/{want['total_count']} rows" in visible
                    and re.search(r"\bunknown " + str(want["unknown_count"]) + r"\b", visible) is not None,
                    "html_visible_coverage")
    visible = " ".join(parser.visible)
    require("14" in visible and "populated" in visible.lower(), "html_populated_scope_label")
    require("legacy" in visible.lower(), "html_legacy_time_label")
    recent = sorted(rows, key=lambda row: row["id"], reverse=True)[:50]
    for row in recent:
        require(row["public_model"] in visible, "html_recent_event_scope")
    # Unique, delimiter-separated fixture labels prevent substring false matches.
    if len(rows) > 50:
        excluded = sorted(rows, key=lambda row: row["id"], reverse=True)[50]
        require(excluded["public_model"] not in visible, "html_recent_event_limit")
    return {"selected_days": len(days), "selected_rows": len(selected), "recent_events": len(recent)}


def validate_event_json(payload, rows):
    expected = sorted(rows, key=lambda row: row["id"], reverse=True)[:100]
    actual = payload.get("data")
    require(isinstance(actual, list) and [row.get("id") for row in actual] == [row["id"] for row in expected], "event_json_scope")
    for got, want in zip(actual, expected):
        for field in FIELDS:
            if field not in RAW_FIELDS:
                require(field in got and got[field] == want[field], "event_json_saved_value")
        reported = {field.removeprefix("reported_"): want[field] for field in RAW_FIELDS}
        expected_reported = reported if any(value is not None for value in reported.values()) else None
        require(got.get("reported_usage") == expected_reported, "event_json_raw_cli_value")
    return len(actual)


def validate_csv(raw, rows):
    actual = list(csv.DictReader(io.StringIO(raw.decode("utf-8", "strict"))))
    expected = sorted(rows, key=lambda row: row["id"], reverse=True)[:1000]
    require([row.get("id") for row in actual] == [str(row["id"]) for row in expected], "csv_row_scope")
    for got, want in zip(actual, expected):
        for field in FIELDS:
            value = got.get(field)
            require(value is not None, "csv_field_missing")
            if want[field] is None:
                require(value == "", "csv_missing_false_zero")
            elif field == "estimated_cost_usd":
                require(float(value) == want[field], "csv_cost_value")
            else:
                require(value == str(want[field]), "csv_saved_value")
    return len(actual)


def fixture_row(identifier, values=None, day="2026-10-29", **overrides):
    row = dict.fromkeys(FIELDS)
    row.update(id=identifier, ts=day + "T12:00:00Z", public_model=f"fixture-row-{identifier:05d}-end",
               status=200, outcome="unknown", usage_status="unknown", usage_source="unknown")
    row.update(zip(METRICS, [None] * 7 if values is None else values))
    row.update(overrides)
    return row


def scenarios():
    null = [fixture_row(1, outcome="failed", status=502, request_id="fallback", attempt_id="fallback-first", finalized_at="2026-10-29T12:00:01Z"),
            fixture_row(2, outcome="interrupted", request_id="fallback", attempt_id="fallback-second", finalized_at="2026-10-29T12:00:01Z")]
    partial = [fixture_row(1, [5, None, 2, None, None, 12, 101], outcome="failed", status=429, usage_status="partial", usage_source="openai_chat_v1", request_id="retry", attempt_id="retry-first", finalized_at="2026-10-29T12:00:01Z"),
               fixture_row(2, [None, 7, None, 3, 8, 30, 103], outcome="succeeded", usage_status="partial", usage_source="cursor_cli_result_v1", request_id="retry", attempt_id="retry-second", finalized_at="2026-10-29T12:00:01Z", reported_input_tokens=9, reported_output_tokens=7, reported_cache_read_input_tokens=0),
               fixture_row(3, [0] * 7, outcome="succeeded", usage_status="complete", estimated_cost_usd=0.0)]
    complete = [fixture_row(1, [2, 3, 5, 7, 11, 17, 101], outcome="succeeded", usage_status="complete", estimated_cost_usd=1.25),
                fixture_row(2, [4, 6, 10, 14, 22, 34, 202], outcome="failed", usage_status="partial", estimated_cost_usd=2.75)]
    mixed = partial + [fixture_row(4, [None, 0, None, None, None, None, 90], day="2024-01-01", estimated_cost_usd=1.25),
                       fixture_row(5, request_id="pending", attempt_id="pending-attempt", usage_status="missing", usage_source="antigravity_opaque_v1"),
                       fixture_row(6, outcome="interrupted", request_id="interrupted", attempt_id="interrupted-attempt", finalized_at="2026-10-29T12:00:01Z", usage_status="missing")]
    many = []
    for identifier in range(1, 1033):
        day = (date(2020, 1, 1) + timedelta(days=((identifier - 1) % 35) * 30)).isoformat()
        values = [None if (identifier + index) % 5 == 0 else (identifier % 11) * (index + 1) for index in range(7)]
        many.append(fixture_row(identifier, values, day=day, outcome="failed" if identifier % 7 == 0 else "succeeded",
                                usage_status="partial" if identifier % 3 else "unknown", estimated_cost_usd=1.25 if identifier % 4 == 0 else None,
                                request_id=f"pair-{(identifier - 1) // 2}", attempt_id=f"attempt-{identifier}", finalized_at=day + "T12:00:01Z"))
    return [("empty", []), ("all_null_failed_interrupted", null), ("partial_retry", partial),
            ("explicit_zero", [fixture_row(1, [0] * 7, estimated_cost_usd=0.0)]),
            ("complete_fields_partial_usage", complete), ("mixed_legacy_pending", mixed),
            ("populated_day_and_event_limits", many)]


def seed(db, rows):
    with db:
        db.execute("DELETE FROM usage_events")
        db.executemany("INSERT INTO usage_events (" + ",".join(FIELDS) + ") VALUES (" + ",".join("?" for _ in FIELDS) + ")",
                       [[row[field] for field in FIELDS] for row in rows])


def snapshot(db):
    return db.execute("SELECT " + ",".join(FIELDS) + " FROM usage_events ORDER BY id").fetchall()


class MeasurementGateway(Gateway):
    def __init__(self, *args):
        self.admin_request_attempts = 0
        self.admin_responses = 0
        super().__init__(*args)

    def request(self, method, path, *args, **kwargs):
        require(method == "GET" and (path == "/admin/usage" or path.startswith("/admin/api/")), "checker_non_admin_request")
        self.admin_request_attempts += 1
        result = super().request(method, path, *args, **kwargs)
        self.admin_responses += 1
        return result


def prove_preflight(fixture, directory):
    require(not list(directory.iterdir()), "data_directory_not_fresh")
    urls = [(fixture.base_url, "/v1"), (fixture.proxy_url, "")]
    for value, path in urls:
        parsed = urlsplit(value)
        require(parsed.scheme == "http" and parsed.hostname == "127.0.0.1" and parsed.port is not None
                and parsed.path == path and not parsed.query and not parsed.fragment
                and parsed.username is None and parsed.password is None, "fixture_not_owned_loopback")
    require(len(fixture._servers) == 2 and all(server.server_address[0] == "127.0.0.1" for server in fixture._servers), "fixture_listener_binding")
    require({server.server_port for server in fixture._servers} == {urlsplit(value).port for value, _ in urls}, "fixture_listener_ownership")
    require(fixture.snapshot() == [] and fixture.denied_count == 0, "preflight_proxy_activity")
    return {"fresh_owned_data_directory": True, "exact_owned_loopback_listeners": True,
            "nonforwarding_fixture_source": True, "no_provider_configuration": True,
            "gateway_environment": "existing_helper_cleared_environment_and_owned_proxy",
            "admin_client": "direct_loopback_no_redirect_following", "before_first_admin_http": True}


def check_doctor(gateway, rows):
    result = subprocess.run([str(gateway.binary), "doctor", "--data-dir", str(gateway.directory)],
                            env={"PATH": "/usr/bin:/bin", "HOME": str(gateway.directory),
                                 "HTTP_PROXY": gateway.fixture.proxy_url, "HTTPS_PROXY": gateway.fixture.proxy_url,
                                 "ALL_PROXY": gateway.fixture.proxy_url},
                            cwd=gateway.directory, stdin=subprocess.DEVNULL, capture_output=True, timeout=15)
    require(result.returncode == 0 and len(result.stdout) < 65536, "doctor_failed")
    text = result.stdout.decode("utf-8", "strict")
    cost = expected_cost(rows)
    value, known, total = cost["known_sum"], cost["known_count"], cost["total_count"]
    expected = ("no data (0 rows)" if not total else f"unknown (0/{total} rows)" if not known else
                f"total ${value:.6f} ({known}/{total} rows)" if known == total else
                f"partial est. ${value:.6f} ({known}/{total} rows)")
    require(expected in text and "all-time" in text, "doctor_cost_preservation")
    require("measurement_summary" not in text and "first_output_ms" not in text, "doctor_scope_changed")


def inspect_surfaces(gateway, rows):
    v2 = gateway.api("GET", "usage/daily?schema=2")
    scope = validate_daily(v2, rows, 2)
    default = gateway.api("GET", "usage/daily")
    explicit = gateway.api("GET", "usage/daily?schema=1")
    validate_daily(default, rows, 1)
    validate_daily(explicit, rows, 1)
    require(default == explicit, "legacy_default_schema_mismatch")
    stats = gateway.api("GET", "stats")
    cost = expected_cost(rows)
    require(stats.get("usage_events") == len(rows) and stats.get("cost_summary") == cost
            and stats.get("estimated_cost_usd") == complete_value(cost), "stats_cost_preservation")
    require(all(stats.get(field) == 0 for field in ("connections", "routes", "api_keys")), "provider_configuration_changed")
    events = validate_event_json(gateway.api("GET", "usage"), rows)
    code, csv_raw = gateway.request("GET", "/admin/api/usage/export.csv", admin=True)
    require(code == 200, "csv_http_status")
    exported = validate_csv(csv_raw, rows)
    code, html = gateway.request("GET", "/admin/usage", admin=True)
    require(code == 200, "web_http_status")
    web = validate_html(html, rows)
    check_doctor(gateway, rows)
    return {"daily_api": scope, "web": web, "event_json_rows": events, "csv_rows": exported,
            "all_time_rows": len(rows), "matching_subsets_verified": True, "cost_and_doctor_preserved": True}


def run_checks(gateway, fixture, report, update):
    gateway.start()
    require(gateway.request("GET", "/admin/api/usage/daily?schema=2", auth=False)[0] == 401, "admin_auth_denial")
    require(gateway.request("GET", "/admin/api/usage/daily?schema=99", admin=True)[0] == 400, "unknown_schema_not_rejected")
    require(gateway.request("GET", "/admin/api/usage/daily?schema=invalid", admin=True)[0] == 400, "malformed_schema_not_rejected")
    stats = gateway.api("GET", "stats")
    require(all(stats.get(field) == 0 for field in ("connections", "routes", "api_keys", "usage_events")), "fresh_store_readiness")
    ports = [gateway.port]
    with closing(sqlite3.connect(gateway.directory / "thinrouter.db")) as db:
        for name, rows in scenarios():
            report["stage"] = name
            update()
            seed(db, rows)
            before = snapshot(db)
            require(before == [tuple(row[field] for field in FIELDS) for row in rows], "fixture_seed_mismatch")
            result = inspect_surfaces(gateway, rows)
            require(snapshot(db) == before, "reads_mutated_history")
            require(fixture.snapshot() == [] and fixture.denied_count == 0, "unexpected_provider_dispatch")
            result.update(name=name, status="passed", seeded_rows=len(rows),
                          raw_snapshot_sha256=hashlib.sha256(repr(before).encode()).hexdigest())
            report["scenarios"].append(result)
            update()
        report["stage"] = "reopen_preserves_history"
        update()
        require(all(row["attempt_id"] is None or row["finalized_at"] is not None for row in rows), "pending_rows_in_reopen_fixture")
        gateway.stop()
        gateway.start()
        ports.append(gateway.port)
        require(snapshot(db) == before, "reopen_mutated_history")
        result = inspect_surfaces(gateway, rows)
        require(snapshot(db) == before, "reopen_reads_mutated_history")
        require(fixture.snapshot() == [] and fixture.denied_count == 0, "reopen_replayed_inference")
        report["restart"] = {"status": "passed", "history_preserved": True, "surfaces": result,
                             "inference_replay": 0, "pending_recovery_exercised": False}
    return ports


def rebind_ports(ports):
    for port in set(ports):
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", port))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="default mode; verify and clean up")
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--expected-binary-sha256", required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("measurement-results"))
    args = parser.parse_args(argv)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="measurement-", dir=args.output_dir.resolve()))
    report_path = output / "report.json"
    report = {"schema": 1, "kind": "existing_saved_measurement_coverage", "synthetic": True,
              "status": "running", "stage": "binary", "scenarios": [], "cleanup": "not_started",
              "inference": 0, "refresh": 0, "discovery": 0, "unexpected_destinations": 0,
              "live_client_version_provider_verified": False, "billing_verified": False,
              "whole_round_metrics": None}

    def update():
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    resources, gateway, fixture, directory = ExitStack(), None, None, None
    previous = {}
    ports = []
    exit_code = 1
    try:
        update()
        binary = args.binary.resolve(strict=True)
        require(binary.is_file() and os.access(binary, os.X_OK), "binary_not_executable")
        require(re.fullmatch("[0-9a-f]{64}", args.expected_binary_sha256) is not None, "expected_digest_invalid")
        observed = digest(binary)
        require(observed == args.expected_binary_sha256, "binary_digest_mismatch")
        report["binary_sha256"] = observed
        scripts = Path(__file__).resolve().parent
        report["helper_sha256"] = {name: digest(scripts / name) for name in
                                   ("measurement_coverage_check.py", "offline_walkthrough.py", "offline_fixture.py")}
        revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=scripts, capture_output=True, text=True, timeout=5, check=False)
        report["source_checkout"] = revision.stdout.strip() if revision.returncode == 0 else None
        report["source_checkout_is_binary_build_attestation"] = False

        def interrupted(_signal, _frame):
            raise CheckFailure("interrupted")

        for sig in (signal.SIGINT, signal.SIGTERM):
            previous[sig] = signal.signal(sig, interrupted)
        directory = Path(resources.enter_context(tempfile.TemporaryDirectory(prefix="thinrouter-measurements-")))
        fixture = resources.enter_context(Fixture())
        ports = [server.server_port for server in fixture._servers]
        report["preflight"] = prove_preflight(fixture, directory)
        report["stage"] = "admin_readiness"
        update()
        gateway = MeasurementGateway(binary, fixture, directory)
        resources.callback(gateway.stop)
        ports.extend(run_checks(gateway, fixture, report, update))
        require(fixture.snapshot() == [] and fixture.denied_count == 0, "unexpected_provider_dispatch")
        report["stage"] = "verified"
        report["status"] = "passed"
        exit_code = 0
    except (CheckFailure, JourneyFailure) as error:
        report["status"] = "failed"
        report["error_code"] = str(error)
    except Exception as error:
        report["status"] = "failed"
        report["error_code"] = "unexpected_" + type(error).__name__
    finally:
        if gateway is not None:
            report["admin_request_attempts"] = gateway.admin_request_attempts
            report["admin_responses"] = gateway.admin_responses
            if gateway.port is not None:
                ports.append(gateway.port)
        if fixture is not None:
            report["fixture_request_events"] = len(fixture.snapshot())
            report["proxy_denied_requests"] = fixture.denied_count
            report["unexpected_destinations"] = len(fixture.snapshot()) + fixture.denied_count
        try:
            resources.close()
            if directory is not None:
                require(not directory.exists(), "temporary_data_not_removed")
                rebind_ports(ports)
                report["cleanup"] = {"status": "passed", "temporary_data_removed": True,
                                     "listeners_rebound": True, "owned_gateway_stopped": True,
                                     "owned_fixture_closed": True}
        except Exception:
            report["cleanup"] = "failed"
            report["status"] = "failed"
            report["error_code"] = "cleanup_failed"
            exit_code = 1
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        update()
    print(f"Measurement coverage check: {report['status']} ({report['stage']}); report={report_path}")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
