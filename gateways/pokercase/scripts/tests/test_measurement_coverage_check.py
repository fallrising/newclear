"""Pure/mocked checks: these tests never launch HTTP, listeners or a gateway."""

from contextlib import ExitStack, redirect_stdout
import copy
import csv
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import measurement_coverage_check as check


def daily_payload(rows, revision=2):
    days, selected = check.selected_rows(rows, 30)
    result = {"schema_revision": revision, "data": []}
    if revision == 2:
        result.update(measurement_summary=check.expected_measurements(selected),
                      scope={"day_bucket_limit": 30, "selection": "latest_populated_date_prefix_buckets",
                             "denominator": "stored_event_attempt_rows"},
                      basis={"tokens": "stored_counters_not_subscription_consumption",
                             "timing_mean": "known_saved_observations",
                             "latency_ms": "mixed_legacy_and_headers_or_cli_ready_compatibility"})
    else:
        result["compatibility"] = {"status": "legacy_numeric", "message": "missing values require schema=2",
                                   "canonical_url": "/admin/api/usage/daily?schema=2"}
    for day in days:
        group = [row for row in selected if row["ts"][:10] == day]
        metrics, cost = check.expected_measurements(group), check.expected_cost(group)
        data = {"day": day, "measurement_summary": metrics, "cost_summary": cost,
                "estimated_cost_usd": check.complete_value(cost), "requests": len(group),
                "ok": sum(row["outcome"] == "succeeded" for row in group),
                "errors": sum(row["outcome"] in ("failed", "cancelled", "timeout", "interrupted") for row in group),
                "incomplete": sum(row["outcome"] == "incomplete" for row in group),
                "unknown": sum(row["outcome"] == "unknown" for row in group),
                "pending": sum(row["attempt_id"] is not None and row["finalized_at"] is None for row in group),
                "headers_200": sum(row["status"] == 200 for row in group)}
        for metric in ("prompt_tokens", "completion_tokens"):
            data[metric] = check.complete_value(metrics[metric]) if revision == 2 else metrics[metric]["known_sum"] or 0
        mean = metrics["latency_ms"]["known_mean"]
        data["avg_latency_ms"] = mean if revision == 2 else mean or 0.0
        result["data"].append(data)
    return result


def html_payload(rows):
    days, selected = check.selected_rows(rows, 14)
    scopes = {"selected": selected, **{day: [row for row in selected if row["ts"][:10] == day] for day in days}}
    result = ["<html><body><h2>14 populated buckets, legacy latency</h2>"]
    for scope, group in scopes.items():
        result.append(f'<section data-measurement-scope="{scope}">')
        for metric, summary in check.expected_measurements(group).items():
            attrs = " ".join(f'data-{key.replace("_", "-")}="{value if value is not None else ""}"'
                             for key, value in summary.items())
            label = summary["status"].replace("_", " ")
            if summary["known_sum"] is not None:
                label += f" · Known subtotal {summary['known_sum']}"
            if summary["known_mean"] is not None:
                label += f" · Mean of known observations {summary['known_mean']} ms"
            label += f" · Coverage {summary['known_count']}/{summary['total_count']} rows · Unknown {summary['unknown_count']}"
            result.append(f'<div data-metric="{metric}" {attrs}><strong>{metric}</strong> {label}</div>')
        result.append("</section>")
    result.extend(row["public_model"] for row in sorted(rows, key=lambda row: row["id"], reverse=True)[:50])
    return ("".join(result) + "</body></html>").encode()


def event_payload(rows):
    result = []
    for row in sorted(rows, key=lambda row: row["id"], reverse=True)[:100]:
        data = {key: value for key, value in row.items() if key not in check.RAW_FIELDS}
        reported = {key.removeprefix("reported_"): row[key] for key in check.RAW_FIELDS}
        data["reported_usage"] = reported if any(value is not None for value in reported.values()) else None
        result.append(data)
    return {"data": result}


def csv_payload(rows):
    target = io.StringIO()
    writer = csv.DictWriter(target, fieldnames=check.FIELDS)
    writer.writeheader()
    writer.writerows(sorted(rows, key=lambda row: row["id"], reverse=True)[:1000])
    return target.getvalue().encode()


class CoverageCheckerTests(unittest.TestCase):
    def setUp(self):
        self.rows = [check.fixture_row(1, [9, None, 5, None, 11, 23, 101],
                                       outcome="failed", request_id="same", attempt_id="first"),
                     check.fixture_row(2, [0, 3, None, 7, None, None, None],
                                       outcome="interrupted", request_id="same", attempt_id="second"),
                     check.fixture_row(3)]

    def test_independent_expected_states_counts_zero_and_known_only_mean(self):
        empty = check.expected_measurements([])["prompt_tokens"]
        self.assertEqual((empty["known_sum"], empty["coverage"], empty["status"]), (None, None, "no_data"))
        unknown = check.expected_measurements([check.fixture_row(1)])["prompt_tokens"]
        self.assertEqual((unknown["known_sum"], unknown["coverage"], unknown["status"]), (None, 0, "unknown"))
        zero = check.expected_measurements([check.fixture_row(1, [0] * 7)])["prompt_tokens"]
        self.assertEqual((zero["known_sum"], zero["coverage"], zero["status"]), (0, 1, "complete"))
        partial = check.expected_measurements(self.rows)
        self.assertEqual(partial["prompt_tokens"], {"known_sum": 9, "known_mean": None,
                         "known_count": 2, "unknown_count": 1, "total_count": 3,
                         "coverage": 2 / 3, "status": "partial", "basis": "stored_prompt_tokens"})
        self.assertEqual(partial["headers_ms"]["known_mean"], 5)
        self.assertEqual(partial["latency_ms"]["known_mean"], 101)
        self.assertEqual(partial["first_output_ms"]["known_mean"], 11)

    def test_saved_usage_quality_does_not_replace_per_field_coverage(self):
        rows = [check.fixture_row(1, [1] * 7, usage_status="missing", outcome="failed")]
        self.assertTrue(all(value["status"] == "complete" for value in check.expected_measurements(rows).values()))
        self.assertEqual(check.validate_daily(daily_payload(rows), rows, 2)["selected_rows"], 1)

    def test_daily_rejects_missing_summary_false_zero_and_wrong_denominator(self):
        original = daily_payload(self.rows)
        check.validate_daily(original, self.rows, 2)
        mutations = [lambda value: value.pop("measurement_summary"),
                     lambda value: value["data"][0]["measurement_summary"]["cli_ready_ms"].update(unknown_count=0),
                     lambda value: value["measurement_summary"]["prompt_tokens"].update(total_count=1),
                     lambda value: value["measurement_summary"]["completion_tokens"].update(known_count=3),
                     lambda value: value["data"][0].update(requests=1)]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                changed = copy.deepcopy(original)
                mutate(changed)
                with self.assertRaises(check.CheckFailure):
                    check.validate_daily(changed, self.rows, 2)
        rows = [check.fixture_row(1)]
        bad = daily_payload(rows)
        bad["measurement_summary"]["prompt_tokens"]["known_sum"] = 0
        with self.assertRaisesRegex(check.CheckFailure, "selected_measurement_summary"):
            check.validate_daily(bad, rows, 2)

    def test_daily_rejects_partial_as_total_and_wrong_mean(self):
        for field, wrong, reason in (("prompt_tokens", 9, "daily_partial_as_total"),
                                     ("avg_latency_ms", 101 / 3, "daily_known_mean")):
            with self.subTest(field=field):
                bad = daily_payload(self.rows)
                bad["data"][0][field] = wrong
                with self.assertRaisesRegex(check.CheckFailure, reason):
                    check.validate_daily(bad, self.rows, 2)

    def test_schema_one_keeps_numeric_compatibility_and_requires_disclosure(self):
        rows = [check.fixture_row(1)]
        payload = daily_payload(rows, 1)
        check.validate_daily(payload, rows, 1)
        self.assertEqual(payload["data"][0]["prompt_tokens"], 0)
        payload.pop("compatibility")
        with self.assertRaisesRegex(check.CheckFailure, "legacy_compatibility_metadata"):
            check.validate_daily(payload, rows, 1)

    def test_html_rejects_false_zero_partial_total_wrong_mean_and_scope(self):
        check.validate_html(html_payload(self.rows), self.rows)
        bad_html = [html_payload(self.rows).replace(b'data-known-mean=""', b'data-known-mean="0"', 1),
                    html_payload(self.rows).replace(b'data-known-mean="101.0"', b'data-known-mean="33.666666666666664"', 1),
                    html_payload(self.rows).replace(b'Known subtotal 9', b'Complete total 9', 1),
                    html_payload(self.rows).replace(b'data-measurement-scope="selected"', b'data-measurement-scope="all-time"')]
        for raw in bad_html:
            with self.subTest(raw=raw[:80]), self.assertRaises(check.CheckFailure):
                check.validate_html(raw, self.rows)

    def test_html_rejects_visible_numbers_when_attributes_are_unchanged(self):
        good = html_payload(self.rows)
        for before, after in ((b'Known subtotal 9', b'Known subtotal 999'),
                              (b'Mean of known observations 101.0 ms', b'Mean of known observations 33.0 ms'),
                              (b'Coverage 2/3 rows', b'Coverage 3/3 rows'),
                              (b'Unknown 1', b'Unknown 0')):
            with self.subTest(before=before):
                changed = good.replace(before, after, 1)
                self.assertNotEqual(changed, good)
                with self.assertRaises(check.CheckFailure):
                    check.validate_html(changed, self.rows)

    def test_event_json_and_csv_preserve_raw_null_and_zero(self):
        rows = [check.fixture_row(1, reported_input_tokens=0, reported_output_tokens=7),
                check.fixture_row(2, [0] * 7)]
        self.assertEqual(check.validate_event_json(event_payload(rows), rows), 2)
        self.assertEqual(check.validate_csv(csv_payload(rows), rows), 2)
        bad = event_payload(rows)
        bad["data"][1]["reported_usage"]["cache_read_input_tokens"] = 0
        with self.assertRaisesRegex(check.CheckFailure, "event_json_raw_cli_value"):
            check.validate_event_json(bad, rows)
        changed = copy.deepcopy(rows)
        changed[0]["latency_ms"] = 0
        with self.assertRaisesRegex(check.CheckFailure, "csv_missing_false_zero"):
            check.validate_csv(csv_payload(changed), rows)

    def test_large_sparse_fixture_checks_different_limits_without_conflating_scopes(self):
        rows = check.scenarios()[-1][1]
        self.assertEqual(len(rows), 1032)
        self.assertEqual(len({row["ts"][:10] for row in rows}), 35)
        api = check.validate_daily(daily_payload(rows), rows, 2)
        web = check.validate_html(html_payload(rows), rows)
        self.assertEqual((api["selected_days"], web["selected_days"]), (30, 14))
        self.assertGreater(api["selected_rows"], web["selected_rows"])
        self.assertEqual(check.validate_event_json(event_payload(rows), rows), 100)
        self.assertEqual(check.validate_csv(csv_payload(rows), rows), 1000)
        self.assertEqual(web["recent_events"], 50)

    def test_request_guard_rejects_inference_before_opening_client(self):
        gateway = object.__new__(check.MeasurementGateway)
        gateway.admin_request_attempts = 0
        with patch.object(check.Gateway, "request") as parent:
            with self.assertRaisesRegex(check.CheckFailure, "checker_non_admin_request"):
                gateway.request("POST", "/v1/chat/completions")
            parent.assert_not_called()
            self.assertEqual(gateway.admin_request_attempts, 0)


class LifecycleTests(unittest.TestCase):
    def invoke(self, output, expected=None):
        binary = Path(sys.executable).resolve()
        args = ["--binary", str(binary), "--expected-binary-sha256", expected or check.digest(binary),
                "--output-dir", str(output)]
        with redirect_stdout(io.StringIO()):
            result = check.main(args)
        report = json.loads(next(output.glob("measurement-*/report.json")).read_text())
        return result, report

    def test_digest_mismatch_fails_before_every_process_or_listener(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(check, "Fixture") as fixture, \
                patch.object(check, "MeasurementGateway") as gateway, patch.object(check.subprocess, "run") as process:
            result, report = self.invoke(Path(directory), "0" * 64)
            self.assertEqual(result, 1)
            self.assertEqual(report["error_code"], "binary_digest_mismatch")
            fixture.assert_not_called()
            gateway.assert_not_called()
            process.assert_not_called()

    def mocked_run(self, failure=None, cleanup_failure=False, denied_count=0):
        fixture = Mock()
        fixture._servers = []
        fixture.snapshot.return_value = []
        fixture.denied_count = denied_count
        context = Mock()
        context.__enter__ = Mock(return_value=fixture)
        context.__exit__ = Mock(return_value=False)
        if cleanup_failure:
            context.__exit__.side_effect = RuntimeError("sensitive cleanup details")
        instances = []

        def new_gateway(binary, fixture, directory):
            instance = SimpleNamespace(directory=directory, port=None, admin_request_attempts=4,
                                       admin_responses=3, stop=Mock())
            instances.append(instance)
            return instance

        with tempfile.TemporaryDirectory() as directory, ExitStack() as mocks:
            mocks.enter_context(patch.object(check, "Fixture", return_value=context))
            mocks.enter_context(patch.object(check, "MeasurementGateway", side_effect=new_gateway))
            mocks.enter_context(patch.object(check, "prove_preflight", return_value={"mocked": True}))
            mocks.enter_context(patch.object(check, "rebind_ports"))
            mocks.enter_context(patch.object(check.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="synthetic-commit\n")))
            runner = mocks.enter_context(patch.object(check, "run_checks", return_value=[]))
            runner.side_effect = failure
            result, report = self.invoke(Path(directory))
            self.assertEqual(len(instances), 1)
            instances[0].stop.assert_called_once()
            self.assertFalse(instances[0].directory.exists())
            context.__exit__.assert_called_once()
            return result, report

    def test_assertion_failure_exits_nonzero_and_cleans_owned_resources(self):
        result, report = self.mocked_run(check.CheckFailure("synthetic_check_failed"))
        self.assertEqual(result, 1)
        self.assertEqual(report["error_code"], "synthetic_check_failed")
        self.assertEqual(report["cleanup"]["status"], "passed")
        self.assertEqual((report["admin_request_attempts"], report["admin_responses"]), (4, 3))

    def test_unexpected_failure_does_not_persist_raw_error_details(self):
        result, report = self.mocked_run(RuntimeError("sensitive error details"))
        self.assertEqual(result, 1)
        self.assertEqual(report["error_code"], "unexpected_RuntimeError")
        self.assertNotIn("sensitive", json.dumps(report))
        self.assertEqual(report["cleanup"]["status"], "passed")

    def test_cleanup_failure_overrides_apparent_success(self):
        result, report = self.mocked_run(cleanup_failure=True)
        self.assertEqual(result, 1)
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["error_code"], "cleanup_failed")
        self.assertNotIn("sensitive", json.dumps(report))

    def test_denied_proxy_request_cannot_report_zero_unexpected_destinations(self):
        result, report = self.mocked_run(denied_count=1)
        self.assertEqual(result, 1)
        self.assertEqual(report["error_code"], "unexpected_provider_dispatch")
        self.assertEqual(report["proxy_denied_requests"], 1)
        self.assertEqual(report["fixture_request_events"], 0)
        self.assertEqual(report["unexpected_destinations"], 1)


if __name__ == "__main__":
    unittest.main()
