#!/usr/bin/env python3
"""Pure, fail-stop evidence gate for the existing buffered CLI journey.

This module never starts a process or listener. The pinned terminal launcher owns
verify_artifacts -> journey -> validate_report, in that order.
"""
import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
from html.parser import HTMLParser
import re
from urllib.parse import urlsplit

CASE_NAMES = ('claude_chat', 'claude_messages', 'claude_responses', 'claude_partial', 'claude_missing', 'claude_zero', 'claude_invalid', 'claude_error', 'claude_eof', 'claude_incomplete', 'claude_unknown', 'claude_cancel_before', 'claude_cancel_after', 'claude_limit', 'claude_fallback', 'cursor_chat', 'cursor_messages', 'cursor_responses', 'cursor_partial', 'cursor_missing', 'cursor_zero', 'cursor_invalid', 'cursor_error', 'cursor_eof', 'cursor_cancel_before', 'cursor_cancel_after', 'cursor_limit', 'cursor_fallback', 'claude_tool_chat', 'claude_tool_messages', 'claude_tool_responses', 'claude_live_saved_resume', 'claude_resume_retry', 'claude_reserve_fresh', 'claude_finalization_restart', 'cursor_reserve_fresh', 'cursor_finalization_restart', 'claude_reserve_live', 'claude_reserve_tool', 'claude_reserve_saved', 'cursor_tool_refusal_chat', 'cursor_tool_refusal_messages', 'cursor_tool_refusal_responses', 'cursor_image_refusal', 'cursor_disabled_refusal')
STAGES = ('protocols', 'raw_quality', 'cancellation', 'collection_limit', 'fallback', 'tool_sessions', 'storage_restart', 'admission', 'surfaces')
SOURCE_FILES = ("buffered_cli_walkthrough.py", "buffered_cli_fixture.py", "buffered_cli_check.py",
                "claude_walkthrough.py", "claude_fixture.py", "offline_walkthrough.py", "offline_fixture.py")
I64_MAX = 2**63 - 1
METRICS = ("prompt_tokens", "completion_tokens", "headers_ms", "cli_ready_ms",
           "first_output_ms", "total_observed_ms", "latency_ms")
RAW_FIELDS = ("input_tokens", "output_tokens", "cache_read_input_tokens",
              "cache_creation_input_tokens")
SOURCES = {"claude": "claude_code_stream_event_v1", "cursor": "cursor_cli_result_v1"}
OUTCOMES = {"succeeded", "incomplete", "failed", "cancelled", "timeout", "interrupted", "unknown"}
QUALITY = {"complete", "partial", "missing", "invalid", "unknown"}


class CheckFailure(Exception):
    """Fixed diagnostic; do not expose raw credentials or model text."""


def require(value, diagnostic):
    if not value:
        raise CheckFailure(diagnostic)


def integer(value):
    return type(value) is int and 0 <= value <= I64_MAX


def digest_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def exact(actual, expected):
    """JSON scalar equality that cannot mistake false for measured zero."""
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(exact(actual[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(exact(a, b) for a, b in zip(actual, expected))
    return actual == expected


def numeric_equal(actual, expected):
    if expected is None:
        return actual is None
    return (type(actual) in (int, float) and math.isfinite(actual)
            and abs(actual - expected) <= 4 * 2**-52 * max(abs(expected), 1))


def expected_measurements(rows):
    require(isinstance(rows, list), "raw_rows_missing")
    result = {}
    for metric in METRICS:
        require(all(isinstance(r, dict) and metric in r for r in rows), "raw_metric_missing")
        known = [r[metric] for r in rows if r[metric] is not None]
        require(all(integer(n) for n in known), "raw_metric_invalid")
        total, count = len(rows), len(known)
        raw_sum = sum(known) if known else None
        measured_sum = raw_sum if raw_sum is None or raw_sum <= I64_MAX else None
        result[metric] = {
            "known_sum": measured_sum,
            "known_mean": raw_sum / count if metric.endswith("_ms") and count else None,
            "known_count": count, "unknown_count": total-count, "total_count": total,
            "coverage": count / total if total else None,
            "status": ("no_data" if not total else "unknown" if not count else
                       "unavailable" if measured_sum is None else
                       "complete" if count == total else "partial"),
            "basis": "stored_legacy_latency_ms" if metric == "latency_ms" else "stored_"+metric,
        }
    return result


def validate_summary(actual, rows):
    expected = expected_measurements(rows)
    require(isinstance(actual, dict) and actual.keys() == expected.keys(), "metric_inventory")
    for metric, want in expected.items():
        got = actual[metric]
        require(isinstance(got, dict) and got.keys() == want.keys(), "metric_fields")
        for field, value in want.items():
            if field in ("coverage", "known_mean"):
                require(numeric_equal(got[field], value), "metric_numeric_value")
            else:
                require(exact(got[field], value), "metric_exact_value")
        require(got["coverage"] is None or 0 <= got["coverage"] <= 1, "metric_coverage_range")
    return expected


def validate_cli_row(row):
    require(isinstance(row, dict), "attempt_shape")
    required = set(METRICS) | {"id", "ts", "attempt_id", "request_id", "finalized_at", "status",
        "usage_source", "outcome", "usage_status", "estimated_cost_usd", "reported_usage"}
    require(required <= row.keys(), "attempt_fields_missing")
    require(integer(row["id"]) and row["id"] > 0 and all(isinstance(row[k], str) and row[k]
            for k in ("ts", "attempt_id", "request_id", "finalized_at")), "attempt_identity")
    require(all(isinstance(row[k],str) for k in ("usage_source","outcome","usage_status"))
            and row["usage_source"] in SOURCES.values() and row["outcome"] in OUTCOMES
            and row["usage_status"] in QUALITY, "attempt_attribution")
    require(row["status"] is None and row["headers_ms"] is None
            and row["estimated_cost_usd"] is None, "cli_http_or_cost_fabrication")
    require(all(row[k] is None or integer(row[k]) for k in METRICS), "attempt_measurement")
    ready, first, total = (row[k] for k in ("cli_ready_ms", "first_output_ms", "total_observed_ms"))
    require(row["latency_ms"] == ready, "legacy_ready_mismatch")
    require(ready is None or total is None or ready <= total, "ready_time_order")
    require(first is None or (ready is not None and total is not None and ready <= first <= total),
            "first_output_time_order")
    raw = row["reported_usage"]
    require(raw is None or (isinstance(raw, dict) and set(raw) == set(RAW_FIELDS)
            and all(v is None or integer(v) for v in raw.values())
            and any(v is not None for v in raw.values())), "raw_usage_shape")
    raw = raw or dict.fromkeys(RAW_FIELDS)
    require(row["completion_tokens"] == raw["output_tokens"], "raw_completion_mismatch")
    if row["usage_source"] == SOURCES["cursor"]:
        require(row["prompt_tokens"] is None and row["usage_status"] != "complete",
                "cursor_unknown_prompt_basis")
    else:
        inputs = [raw[k] for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")]
        prompt = sum(inputs) if all(v is not None for v in inputs) else None
        if prompt is not None and prompt > I64_MAX:
            prompt = None
        require(row["prompt_tokens"] == prompt, "claude_input_buckets")
        require(row["usage_status"] != "complete" or (prompt is not None and raw["output_tokens"] is not None),
                "claude_false_complete")
    require(row["usage_status"] != "missing" or all(v is None for v in raw.values()), "missing_has_raw_usage")
    require(row["usage_status"] not in ("complete", "partial") or any(v is not None for v in raw.values()),
            "known_quality_without_usage")
    return row


def verify_artifacts(manifest):
    """Read-only pin check; caller must independently pin the manifest itself."""
    require(isinstance(manifest, dict) and type(manifest.get("schema_version")) is int
            and manifest["schema_version"] == 1, "artifact_manifest_schema")
    records = manifest.get("artifacts")
    require(isinstance(records, list) and records, "artifact_manifest_missing")
    roles, paths = set(), set()
    for item in records:
        require(isinstance(item, dict) and isinstance(item.get("role"), str)
                and isinstance(item.get("path"), str)
                and isinstance(item.get("sha256"), str)
                and re.fullmatch(r"[0-9a-f]{64}", item["sha256"]), "artifact_record_invalid")
        path = Path(item["path"])
        require(path.is_absolute() and path.is_file() and not path.is_symlink(), "artifact_path_unsafe")
        resolved = str(path.resolve())
        require(resolved not in paths, "artifact_duplicate")
        paths.add(resolved); roles.add(item["role"])
        require(digest(path) == item["sha256"], "artifact_digest_mismatch")
    require({"binary", "fixture", "runtime", "walkthrough", "checker"} <= roles, "artifact_source_missing")
    require(set(SOURCE_FILES) <= {Path(item["path"]).name for item in records}, "artifact_helper_missing")
    runtime = [item for item in records if item["role"] == "runtime"]
    fixture = [item for item in records if item["role"] == "fixture"]
    require(len(runtime) == len(fixture) == 1, "runtime_source_ambiguous")
    invocation = manifest.get("python_invocation")
    require(isinstance(invocation, str) and Path(invocation).is_absolute()
            and Path(invocation).resolve(strict=True) == Path(runtime[0]["path"]).resolve(strict=True),
            "runtime_invocation_mismatch")
    source = Path(fixture[0]["path"]).read_text()
    require("\n" in source, "fixture_source_invalid")
    generated = "#!" + invocation + "\n" + source.split("\n", 1)[1]
    require(digest_bytes(generated.encode()) == manifest.get("generated_fixture_sha256"),
            "generated_fixture_digest_mismatch")
    return {item["path"]: item["sha256"] for item in records}


def flatten_row(row):
    raw = row.get("reported_usage") or dict.fromkeys(RAW_FIELDS)
    result = {k: v for k, v in row.items() if k != "reported_usage"}
    result.update({"reported_"+key: raw[key] for key in RAW_FIELDS})
    return result


def selected_rows(rows, limit):
    days = sorted({r["ts"][:10] for r in rows}, reverse=True)[:limit]
    return days, [r for r in rows if r["ts"][:10] in days]


def validate_daily(payload, rows):
    days, selected = selected_rows(rows, 30)
    require(isinstance(payload, dict) and payload.get("schema_revision") == 2, "daily_schema")
    require(payload.get("scope") == {"day_bucket_limit":30,
            "selection":"latest_populated_date_prefix_buckets",
            "denominator":"stored_event_attempt_rows"}, "daily_scope")
    require(payload.get("basis") == {"tokens":"stored_counters_not_subscription_consumption",
            "timing_mean":"known_saved_observations",
            "latency_ms":"mixed_legacy_and_headers_or_cli_ready_compatibility"}, "daily_basis")
    validate_summary(payload.get("measurement_summary"), selected)
    data = payload.get("data")
    require(isinstance(data, list) and [x.get("day") for x in data] == days, "daily_bucket_scope")
    for got in data:
        group = [r for r in selected if r["ts"][:10] == got["day"]]
        want = validate_summary(got.get("measurement_summary"), group)
        for key in ("prompt_tokens", "completion_tokens"):
            expected = want[key]["known_sum"] if want[key]["status"] == "complete" else None
            require(exact(got.get(key), expected), "daily_partial_as_total")
        require(numeric_equal(got.get("avg_latency_ms"), want["latency_ms"]["known_mean"]), "daily_mean")
        expected_counts = {"requests":len(group), "ok":sum(r["outcome"] == "succeeded" for r in group),
            "errors":sum(r["outcome"] in ("failed", "cancelled", "timeout", "interrupted") for r in group),
            "incomplete":sum(r["outcome"] == "incomplete" for r in group),
            "unknown":sum(r["outcome"] == "unknown" for r in group), "pending":0, "headers_200":0}
        require(all(exact(got.get(k), v) for k, v in expected_counts.items()), "daily_denominator")
        cost = {"known_sum":None, "known_count":0, "unknown_count":len(group),
                "total_count":len(group), "coverage":0.0, "status":"unknown", "basis":"stored_estimate_usd"}
        require(got.get("estimated_cost_usd") is None and got.get("cost_summary") == cost,
                "cli_cost_summary")


class UsageHTML(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.metrics, self.visible, self.recent_rows = [], {}, [], []
        self.current_row = self.current_cell = None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        scope = attrs.get("data-measurement-scope", self.stack[-1][1] if self.stack else None)
        recent = attrs.get("aria-label") == "Recent usage table" or bool(self.stack and self.stack[-1][3])
        key = (scope, attrs["data-metric"]) if "data-metric" in attrs else None
        if key:
            require(scope is not None and key not in self.metrics, "html_duplicate_metric")
            self.metrics[key] = {"attributes":attrs, "text":""}
        if recent and tag == "tr": self.current_row = []
        if recent and tag == "td": self.current_cell = []
        if tag not in self.VOID: self.stack.append((tag, scope, key, recent))

    def handle_endtag(self, tag):
        if tag == "td" and self.current_cell is not None:
            self.current_row.append(" ".join("".join(self.current_cell).split())); self.current_cell = None
        if tag == "tr" and self.current_row is not None:
            if self.current_row: self.recent_rows.append(self.current_row)
            self.current_row = None
        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]; break

    def handle_data(self, text):
        self.visible.append(text)
        if self.current_cell is not None: self.current_cell.append(text)
        for _, _, key, _ in self.stack:
            if key: self.metrics[key]["text"] += text


def validate_html(raw, rows):
    require(isinstance(raw, str), "html_raw_missing")
    parser = UsageHTML(); parser.feed(raw)
    days, selected = selected_rows(rows, 14)
    scopes = {"selected":selected, **{day:[r for r in selected if r["ts"][:10] == day] for day in days}}
    require(set(parser.metrics) == {(scope, metric) for scope in scopes for metric in METRICS}, "html_scope")
    for scope, group in scopes.items():
        for metric, want in expected_measurements(group).items():
            observed = parser.metrics[(scope, metric)]
            attrs, visible = observed["attributes"], " ".join(observed["text"].lower().split())
            got = {}
            for field, expected in want.items():
                text = attrs.get("data-"+field.replace("_", "-"))
                require(text is not None, "html_metric_field")
                if expected is None:
                    require(text == "", "html_false_zero"); got[field] = None
                elif type(expected) in (int, float):
                    try: got[field] = int(text) if type(expected) is int else float(text)
                    except ValueError as error: raise CheckFailure("html_numeric") from error
                else: got[field] = text
            validate_summary({**expected_measurements(group), metric:got}, group)
            require(metric in visible, "html_metric_label")
            require(want["status"] not in ("unknown", "no_data") or want["status"].replace("_", " ") in visible,
                    "html_unknown_label")
            subtotal = re.search(r"known subtotal ([+-]?\d+)(?=\s|$)", visible)
            require((subtotal is None and "known subtotal" not in visible) if want["known_sum"] is None else
                    subtotal is not None and int(subtotal.group(1)) == want["known_sum"], "html_visible_subtotal")
            mean = re.search(r"mean of known observations ([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?) ms", visible)
            require((mean is None and "mean of known observations" not in visible) if want["known_mean"] is None else
                    mean is not None and numeric_equal(float(mean.group(1)), want["known_mean"]), "html_visible_mean")
            require(f"coverage {want['known_count']}/{want['total_count']} rows" in visible
                    and re.search(r"\bunknown "+str(want["unknown_count"])+r"\b", visible), "html_visible_coverage")
    def shown(value): return "—" if value is None else str(value)
    expected_rows = []
    for r in sorted(rows, key=lambda r:r["id"], reverse=True)[:50]:
        reported = r["reported_usage"]
        expected_rows.append([r["ts"], r.get("public_model") or "—", r.get("connection_id") or "—", "—",
            " / ".join("—" if r[k] is None else str(r[k])+" ms" for k in
                         ("headers_ms", "cli_ready_ms", "first_output_ms", "total_observed_ms")),
            shown(r["prompt_tokens"])+"/"+shown(r["completion_tokens"]), "—", r.get("error") or "",
            r["outcome"], r["usage_status"]+" / "+r["usage_source"],
            " / ".join(shown(reported[k]) for k in RAW_FIELDS) if reported else "—"])
    require(parser.recent_rows == expected_rows, "html_recent_scope_or_values")
    visible = " ".join(parser.visible).lower()
    require("14" in visible and "populated" in visible and "legacy" in visible, "html_limit_labels")


def validate_surfaces(surfaces, rows, original_rows):
    require(isinstance(surfaces, dict) and isinstance(original_rows, list), "surface_missing")
    expected_flat = sorted([flatten_row(r) for r in rows], key=lambda r:r["id"])
    require(exact(sorted(original_rows, key=lambda r:r["id"]), expected_flat), "sqlite_normalization")
    expected = sorted(rows, key=lambda r:r["id"], reverse=True)
    require(exact(surfaces.get("events_rows"), expected[:100]), "events_scope_or_values")
    raw = surfaces.get("csv_raw")
    require(isinstance(raw, str), "csv_missing")
    reader = csv.DictReader(io.StringIO(raw))
    require(reader.fieldnames is not None and len(reader.fieldnames) == len(set(reader.fieldnames)), "csv_columns")
    observed = list(reader)
    require(len(observed) == min(len(expected),1000), "csv_scope")
    for got, row in zip(observed, expected[:1000]):
        want = flatten_row(row)
        require(set(got) == set(want), "csv_fields")
        require(all(got[k] == ("" if v is None else str(v)) for k,v in want.items()), "csv_value_or_false_zero")
    validate_daily(surfaces.get("daily_api"), rows)
    validate_html(surfaces.get("html_raw"), rows)


def safe_relative(value):
    return (isinstance(value, str) and value and not Path(value).is_absolute()
            and all(part not in ("..", ".") for part in Path(value).parts))


def evidence_jsonl(record, evidence):
    require(isinstance(record, dict) and safe_relative(record.get("path"))
            and isinstance(record.get("sha256"), str), "raw_log_reference")
    raw = evidence.get(record["path"])
    require(isinstance(raw, bytes) and digest_bytes(raw) == record["sha256"], "raw_log_missing_or_hash")
    try:
        return [json.loads(line) for line in raw.decode("utf-8", "strict").splitlines() if line]
    except (ValueError, UnicodeError) as error:
        raise CheckFailure("raw_log_invalid") from error


def validate_recovery(recovery, case_rows):
    require(isinstance(recovery, dict), "recovery_missing")
    before, first, second = (recovery.get(k) for k in ("before_rows", "after_first_rows", "after_second_rows"))
    require(all(isinstance(x, list) for x in (before, first, second)) and exact(first, second), "recovery_repeat_or_rewrite")
    require([r.get("id") for r in before] == [r.get("id") for r in first], "recovery_rows_changed")
    pending = [r for r in before if r.get("finalized_at") is None]
    require(len(pending) == 1 and len(case_rows) == 1 and pending[0]["attempt_id"] == case_rows[0]["attempt_id"],
            "recovery_pending_identity")
    for old, new in zip(before, first):
        if old["finalized_at"] is not None:
            require(exact(old, new), "recovery_finalized_history_rewritten")
        else:
            require(exact(new, case_rows[0]) and new["outcome"] == "interrupted"
                    and new["usage_status"] == "missing" and new["reported_usage"] is None
                    and all(new[k] is None for k in ("prompt_tokens", "completion_tokens", "first_output_ms", "total_observed_ms")),
                    "recovery_fabricated_usage")
    counts = [recovery.get(k) for k in ("dispatch_counts_before", "dispatch_counts_after_first", "dispatch_counts_after_second")]
    require(isinstance(counts[0], dict) and exact(counts[0], counts[1]) and exact(counts[1], counts[2])
            and set(counts[0]) == {"actual_spawns", "actual_user_inputs", "actual_tool_dispatches"}
            and all(integer(v) for v in counts[0].values()), "recovery_replayed_dispatch")


def _answer(protocol, body):
    if protocol == "chat": return body["choices"][0]["message"].get("content")
    if protocol == "messages": return "".join(x.get("text", "") for x in body["content"])
    return "".join(c.get("text", "") for x in body["output"] for c in x.get("content", []))


def validate_wire(case, oracle):
    wire = case.get("wire")
    require(isinstance(wire, list) and exact([x.get("status") for x in wire], oracle["wire_statuses"]), "wire_status")
    protocol = next((p for p in ("chat", "messages", "responses") if case["name"].endswith("_"+p)), "chat")
    if wire and wire[-1]["status"] == 200:
        require(_answer(protocol, wire[-1]["body"]) == oracle["wire_text"], "wire_text")
    for item in wire:
        if item["status"] is None:
            require(item.get("caller_cancelled") is True and item.get("body") is None, "wire_cancellation")
        else: require(isinstance(item.get("body"), dict), "wire_body_missing")
    if oracle.get("fixture_model") == "tool":
        first = wire[0]["body"]
        if protocol == "chat":
            tools = first["choices"][0]["message"]["tool_calls"]
            tool = tools[0]; identifier = tool["id"]; name=tool["function"]["name"]
            arguments = json.loads(tool["function"]["arguments"])
        elif protocol == "messages":
            tools = [x for x in first["content"] if x.get("type") == "tool_use"]
            tool=tools[0]; identifier=tool["id"]; name=tool["name"]; arguments=tool["input"]
        else:
            tools=[x for x in first["output"] if x.get("type") == "function_call"]
            tool=tools[0]; identifier=tool["call_id"]; name=tool["name"]; arguments=json.loads(tool["arguments"])
        require(len(tools)==1 and isinstance(identifier,str) and identifier and name=="add"
                and exact(arguments,{"a":2,"b":3}), "wire_tool_contract")


def validate_report(report, contract, manifest, evidence):
    """Validate only supplied bytes/data; caller independently pins both inputs."""
    try:
        return _validate_report(report, contract, manifest, evidence)
    except CheckFailure:
        raise
    except (KeyError, TypeError, ValueError, IndexError, AttributeError) as error:
        raise CheckFailure("report_shape_invalid") from error


def _validate_report(report, contract, manifest, evidence):
    require(isinstance(report, dict) and report.get("schema_version") == 1
            and report.get("synthetic") is True and report.get("mode") == "check"
            and report.get("journey_status") == "passed", "report_not_checked")
    for key in ("owner_personal_run_claimed", "live_client_version_provider_verified", "full_product_verified"):
        require(report.get(key, False) is False, "acceptance_overclaim")
    require(report.get("real_cli_version") is None and report.get("actual_cost_usd") is None
            and report.get("whole_round_metrics") is None and report.get("mainline", "incomplete") == "incomplete"
            and report.get("usable_tag") is None, "measurement_or_product_overclaim")
    require(contract.get("schema_version") == 1 and contract.get("status") == "fixed-before-full-runtime",
            "contract_not_fixed")
    require(report.get("contract_sha256") == manifest.get("contract_sha256")
            and isinstance(report.get("contract_sha256"),str)
            and re.fullmatch(r"[0-9a-f]{64}",report["contract_sha256"]), "contract_attribution")
    artifacts=manifest["artifacts"]
    binary=[x for x in artifacts if x["role"] == "binary"]
    require(len(binary)==1 and report.get("binary_sha256")==binary[0]["sha256"], "binary_attribution")
    expected_sources={Path(x["path"]).name:x["sha256"] for x in artifacts if x["path"].endswith(".py")}
    require(expected_sources and exact(report.get("source_sha256"),expected_sources), "source_attribution")
    cleanup=report.get("cleanup")
    require(isinstance(cleanup,dict) and all(cleanup.get(k) is True for k in
            ("gateway_stopped","owned_children_stopped","fixture_closed","temporary_data_removed","listeners_rebound"))
            and all(type(cleanup.get(k)) is int and cleanup[k]==0 for k in ("active_children","active_listeners")),
            "cleanup_unverified")
    isolation=report.get("isolation",{})
    require(isolation.get("status")=="passed" and isolation.get("no_provider_configuration_before_launch") is True
            and exact(isolation.get("proof_denied_requests"),3)
            and exact(isolation.get("probes"),[{"method":"GET","status":403},{"method":"CONNECT","status":403},{"method":"GET","status":403}]),
            "isolation_proof")
    owned=Path(isolation["owned_home"])
    require(owned.is_absolute() and ".." not in owned.parts, "owned_home_unsafe")
    for key,hash_key in (("fake_executable","fake_sha256"),("runtime","runtime_sha256"),("cursor","cursor_sha256")):
        path=Path(isolation[key]);require(path.is_absolute() and path.is_relative_to(owned)
            and ".." not in path.parts and isolation[hash_key]==manifest["generated_fixture_sha256"], "unsafe_executable")
    require(isolation.get("python")==manifest.get("python_invocation")
            and isolation.get("helper_binary")==binary[0]["path"]
            and isolation.get("helper_sha256")==binary[0]["sha256"], "helper_attribution")
    proxy=urlsplit(isolation["proxy"])
    require(proxy.scheme=="http" and proxy.hostname=="127.0.0.1" and proxy.port
            and not any((proxy.username,proxy.password,proxy.query,proxy.fragment)) and proxy.path in ("","/"), "unsafe_proxy")
    names=contract["case_inventory"]; stages=contract["stage_inventory"]
    require(names==list(CASE_NAMES) and stages==list(STAGES), "fixed_inventory_changed")
    require(len(names)==len(set(names)) and [x["name"] for x in contract["cases"]]==names, "contract_inventory")
    require(report.get("case_inventory")==names and report.get("stage_inventory")==stages, "inventory_mismatch")
    actual_stages=report.get("stages")
    require(isinstance(actual_stages,list) and [x.get("stage") for x in actual_stages]==stages
            and all(x.get("status")=="passed" and x.get("case_names")==
                    [c["name"] for c in contract["cases"] if c["stage"]==x["stage"]] for x in actual_stages), "stage_inventory")
    cases=report.get("cases");rows=report.get("sqlite_rows");trace=report.get("phase_trace")
    require(isinstance(cases,list) and len(cases)==len(names) and {x.get("name") for x in cases}==set(names), "case_inventory")
    require(isinstance(rows,list) and len({r["id"] for r in rows})==len(rows)
            and len({r["attempt_id"] for r in rows})==len(rows), "duplicate_attempt")
    by_id={r["attempt_id"]:validate_cli_row(r) for r in rows}
    require(isinstance(trace,list), "phase_trace_missing")
    diagnostics=report.get("diagnostic_artifacts",{})
    require(isinstance(diagnostics,dict) and {"gateway.log","fake/trace.jsonl"} <= diagnostics.keys(),
            "diagnostic_log_missing")
    for record in diagnostics.values():
        require(isinstance(record,dict) and safe_relative(record.get("path"))
                and isinstance(evidence.get(record["path"]),bytes)
                and digest_bytes(evidence[record["path"]])==record.get("sha256"), "diagnostic_log_hash")
    require(exact(evidence_jsonl(diagnostics.get("fake/trace.jsonl"),evidence),trace), "phase_raw_log_mismatch")
    raw=evidence_jsonl(report.get("raw_log"),evidence)
    require(raw and all(isinstance(e,dict) and e.get("case") in names and e.get("provider") in SOURCES
            and isinstance(e.get("event"),dict) for e in raw), "raw_source_events")
    phase_kinds={"spawn","user_input","tool_dispatch","output","terminal","waiting","helper","resume",
                 "resume_rejected","exit","cursor_start","runtime_cleanup","helper_rpc"}
    dispatch_kinds={"spawn":"actual_spawns","user_input":"actual_user_inputs","tool_dispatch":"actual_tool_dispatches"}
    dispatch_seen=set()
    for sequence,event in enumerate(trace,1):
        require(exact(event.get("sequence"),sequence) and event.get("case") in names
                and event.get("kind") in phase_kinds and integer(event.get("pid"))
                and isinstance(event.get("birth"),str) and event["birth"], "phase_trace_identity")
        if event["kind"] in dispatch_kinds:
            dispatch_identity=(event["kind"],event.get("attempt_id"))
            require(dispatch_identity not in dispatch_seen,"duplicate_phase_dispatch")
            dispatch_seen.add(dispatch_identity)
            pending=event.get("pending");require(exact(event.get("pending_count"),1)
                and isinstance(pending,list) and len(pending)==1, "dispatch_without_reservation")
            witness=pending[0];row=by_id.get(witness.get("attempt_id"))
            require(row is not None and all(exact(witness.get(k),row.get(k)) for k in
                    ("request_id","attempt_id","public_model","upstream_model","usage_source"))
                    and event.get("attempt_id")==row["attempt_id"] and event.get("request_id")==row["request_id"]
                    and event.get("model")==row.get("upstream_model"), "dispatch_witness_identity")
    observed_processes={(e["pid"],e["birth"]) for e in trace}
    observed_processes.update((e["helper_pid"],e.get("helper_birth")) for e in trace if "helper_pid" in e)
    identities=report.get("owned_process_identities")
    require(isinstance(identities,list) and all(isinstance(pair,list) and len(pair)==2 for pair in identities)
            and len({tuple(pair) for pair in identities})==len(identities)
            and {tuple(pair) for pair in identities}==observed_processes, "cleanup_process_inventory")
    selected=set();sum_counts={k:0 for k in ("client_requests","actual_spawns","actual_user_inputs","actual_tool_dispatches","preflight_refusals")}
    for case in cases:
        oracle=next(c for c in contract["cases"] if c["name"]==case["name"])
        require(case.get("status")=="passed" and case.get("stage")==oracle["stage"], "case_not_passed")
        actual=case.get("rows");require(isinstance(actual,list) and len(actual)==len(oracle["rows"]), "case_attempt_count")
        for row,want in zip(actual,oracle["rows"]):
            identifier=row["attempt_id"]
            require(identifier in by_id and identifier not in selected and exact(row,by_id[identifier]), "case_duplicate_or_missing_attempt")
            selected.add(identifier)
            for key,value in want.items():
                if key.endswith("_present"):
                    require((row[key[:-8]+"_ms"] is not None) is value, "case_timing_presence")
                else: require(key in row and exact(row[key],value), "case_raw_or_outcome")
        if case["name"].endswith("_fallback"):
            require(len({r["request_id"] for r in actual})==1, "fallback_parent")
        if case["name"]=="claude_resume_retry":
            require(actual[1]["request_id"]==actual[2]["request_id"]!=actual[0]["request_id"], "resume_retry_parent")
        own_trace=[e for e in trace if e["case"]==case["name"]]
        captured=case.get("phase_trace")
        require(isinstance(captured,list) and exact(captured,own_trace[:len(captured)])
                and [e for e in captured if e["kind"] in dispatch_kinds]==[e for e in own_trace if e["kind"] in dispatch_kinds], "case_phase_trace")
        require({e["attempt_id"] for e in own_trace if e["kind"] in dispatch_kinds} ==
                {r["attempt_id"] for r in actual}, "case_missing_dispatch_witness")
        require(exact(case.get("raw_events"),[e for e in raw if e["case"]==case["name"]])
                and all(e["provider"]==oracle["provider"] for e in case["raw_events"]), "case_raw_log_or_source")
        require(exact(case.get("counts"),oracle["counts"]), "case_counts")
        for kind,key in dispatch_kinds.items():
            require(sum(e["kind"]==kind for e in own_trace)==oracle["counts"][key], "case_dispatch_count")
        for key in sum_counts: sum_counts[key]+=oracle["counts"][key]
        validate_wire(case,oracle)
        if case["name"].endswith("_finalization_restart"):validate_recovery(case.get("recovery"),actual)
    require(selected==set(by_id), "missing_or_extra_attempt")
    counts=report.get("counts",{})
    require(all(integer(counts.get(k)) and counts[k]==v for k,v in sum_counts.items())
            and exact(counts.get("selected_reservations"),len(rows))
            and all(exact(counts.get(k),0) for k in ("http_inference","refresh","discovery","unexpected_destinations")), "total_counts")
    requests=report.get("request_trace");require(isinstance(requests,list) and requests, "request_trace_missing")
    ports=report.get("owned_listener_ports",[])
    for n,request in enumerate(requests,1):
        url=urlsplit(request["destination"]);admin=request["path"].startswith("/admin")
        require(exact(request.get("sequence"),n) and request.get("method") in ("GET","POST","PUT","PATCH","DELETE")
                and request.get("kind")==("admin" if admin else "client")
                and url.scheme=="http" and url.hostname=="127.0.0.1" and url.port in ports
                and not any((url.username,url.password,url.fragment))
                and url.path in ("", "/") and not url.query
                and request["path"].startswith("/") and not request["path"].startswith("//")
                and (admin or request["path"] in ("/v1/chat/completions","/v1/messages","/v1/responses")), "unsafe_request_destination")
    for key,kind in (("client_requests","client"),("admin_requests","admin")):
        require(integer(counts.get(key)) and counts[key]==sum(e["kind"]==kind for e in requests), "request_counts")
    for oracle in contract["cases"]:
        require(sum(e["kind"]=="client" and e.get("case")==oracle["name"] for e in requests)
                ==oracle["counts"]["client_requests"], "case_client_request_count")
    require(counts["admin_requests"]>0, "admin_evidence_missing")
    require(exact(counts.get("helper_stdio_rpc_requests"),sum(e["kind"]=="helper_rpc" for e in trace))
            and counts.get("helper_callback_http_requests") is None, "helper_counts")
    surfaces=report.get("surfaces",{})
    require(surfaces.get("filter") is None and surfaces.get("limits")==contract["scope"]
            and surfaces.get("selected_ids")==[r["id"] for r in rows], "surface_selected_scope")
    validate_surfaces(surfaces,rows,report.get("sqlite_original_rows"))
    return {"status":"passed","case_count":len(cases),"stage_count":len(stages),"selected_reservations":len(rows),
            "counts":counts,"synthetic":True,"live_client_version_provider_verified":False,"whole_round_metrics":None}


def load_pinned_json(path, expected):
    require(isinstance(expected,str) and re.fullmatch(r"[0-9a-f]{64}",expected), "expected_digest_invalid")
    raw=Path(path).read_bytes()
    require(digest_bytes(raw)==expected, "input_digest_mismatch")
    return json.loads(raw)


def load_evidence(report, directory):
    """Read only owned report-relative diagnostics; never follow a symlink."""
    result={}
    records=list(report.get("diagnostic_artifacts",{}).values())+[report.get("raw_log")]
    for record in records:
        require(isinstance(record,dict) and safe_relative(record.get("path")), "evidence_path_unsafe")
        path=directory/record["path"]
        require(not path.is_symlink() and path.resolve().is_relative_to(directory.resolve()), "evidence_path_unsafe")
        raw=path.read_bytes()
        require(digest_bytes(raw)==record.get("sha256"), "evidence_digest_mismatch")
        result[record["path"]]=raw
    require("gateway.log" in report.get("diagnostic_artifacts",{}), "gateway_log_missing")
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check",action="store_true",help="default and only mode: validate saved evidence")
    parser.add_argument("--report",required=True,type=Path)
    parser.add_argument("--contract",required=True,type=Path)
    parser.add_argument("--expected-contract-sha256",required=True)
    parser.add_argument("--manifest",required=True,type=Path)
    parser.add_argument("--expected-manifest-sha256",required=True)
    parser.add_argument("--output-dir",required=True,type=Path)
    args=parser.parse_args(argv)
    result={"status":"failed","kind":"buffered_cli_report_validation","synthetic":True,"whole_round_metrics":None}
    try:
        manifest=load_pinned_json(args.manifest,args.expected_manifest_sha256)
        verify_artifacts(manifest)
        contract=load_pinned_json(args.contract,args.expected_contract_sha256)
        require(manifest.get("contract_sha256")==args.expected_contract_sha256,"manifest_contract_mismatch")
        raw=args.report.read_bytes();report=json.loads(raw)
        result.update(validate_report(report,contract,manifest,load_evidence(report,args.report.parent)))
        result["report_sha256"]=digest_bytes(raw)
    except (CheckFailure,OSError,ValueError,UnicodeError) as error:
        result["error_code"]=str(error) if isinstance(error,CheckFailure) else type(error).__name__
    args.output_dir.mkdir(parents=True,exist_ok=True)
    (args.output_dir/"buffered-cli-validation.json").write_text(json.dumps(result,indent=2)+"\n")
    print("Buffered CLI report validation: "+result["status"])
    return 0 if result["status"]=="passed" else 1


if __name__=="__main__":
    raise SystemExit(main())
