#!/usr/bin/env python3
"""Check existing buffered HTTP settlement using a preserved native test binary."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
from urllib.parse import urlsplit

PROOF_TEST = 'proxy::buffered_http_tests::bh_confinement_preflight'
HTTP_TEST = 'proxy::buffered_http_tests::bh_http_settlement_acceptance'
PROOF_PREFIX = 'BUFFERED_HTTP_CONFINEMENT_REPORT='
REPORT_PREFIX = 'BUFFERED_HTTP_SETTLEMENT_REPORT='
OUTCOMES = {'succeeded', 'incomplete', 'failed', 'cancelled', 'timeout', 'interrupted', 'unknown'}
QUALITY = {'complete', 'partial', 'missing', 'invalid', 'unknown'}
CASE_NAMES = set('''body_cancelled body_cap body_read_error body_timeout borrowed_changed
borrowed_unchanged chat_error chat_incomplete chat_unknown cross_surface fallback finalization_failure
grok_401 grok_background grok_failed grok_malformed grok_proactive grok_quota grok_unknown
malformed_chat malformed_messages malformed_responses preheaders_cancelled preheaders_timeout
reopen_history reservation_failure siwc_401 siwc_conflicting_terminal siwc_first_completed
siwc_first_failed siwc_missing_terminal siwc_proactive siwc_reconstruct
success_generic_chat success_generic_messages success_generic_responses success_grok_chat
success_grok_messages success_grok_responses success_opencode_chat success_opencode_messages
success_opencode_responses success_siwc_chat success_siwc_messages success_siwc_responses
tools_generic_messages tools_grok_responses tools_siwc_chat usage_invalid_object
usage_invalid_sibling usage_missing usage_partial usage_zero'''.split())
STAGES = ('twelve_family_client_success', 'representative_tools', 'raw_usage_and_json_outcomes',
          'forced_sse_terminal_contract', 'fallback_refresh_borrowed',
          'buffered_body_and_preheaders_lifecycle', 'storage_failure_without_replay',
          'reopen_preserved_history', 'sqlite_json_csv_web_reconciliation')
EXPECTED_COUNTS = {'inference': 54, 'refresh': 4, 'discovery': 0,
                   'client_inference_requests': 51, 'unexpected_destinations': 0}
METRICS = ('prompt_tokens', 'completion_tokens', 'headers_ms', 'cli_ready_ms',
           'first_output_ms', 'total_observed_ms', 'latency_ms')


class CheckFailure(Exception):
    """A fixed diagnostic without upstream or credential contents."""


def require(condition, message):
    if not condition:
        raise CheckFailure(message)


def sha256(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def numeric_equal(actual, expected):
    if expected is None:
        return actual is None
    return (type(actual) in (int, float) and math.isfinite(actual)
            and abs(actual-expected) <= 4*2**-52*max(abs(expected), 1))


def verify_surfaces(surfaces, rows):
    require(isinstance(surfaces, dict), 'surface_report_missing')
    for field in ('rows', 'events_json_rows', 'csv_rows', 'matching_summary_rows'):
        require(type(surfaces.get(field)) is int and surfaces[field] == len(rows),
                'surface_row_scope_mismatch')
    require(surfaces.get('web_recent_rows') == min(len(rows), 50)
            and surfaces.get('web_recent_limit') == 50 and surfaces.get('daily_api_limit') == 30
            and surfaces.get('web_day_limit') == 14
            and type(surfaces.get('selected_date_buckets')) is int
            and 1 <= surfaces['selected_date_buckets'] <= 14
            and surfaces.get('sql_json_csv_web_reconciled') is True, 'surface_filter_mismatch')
    summary = surfaces.get('measurement_summary')
    require(isinstance(summary, dict) and set(summary) == set(METRICS), 'metric_inventory_invalid')
    for metric in METRICS:
        values = [row.get(metric) for row in rows if row.get(metric) is not None]
        require(all(type(number) is int and 0 <= number <= 2**63-1 for number in values),
                'raw_metric_invalid')
        count, total = len(values), len(rows)
        raw_sum = sum(values)
        known_sum = raw_sum if count and raw_sum <= 2**63-1 else None
        status = ('unknown' if not count else 'unavailable' if known_sum is None else
                  'complete' if count == total else 'partial')
        expected = {'known_sum': known_sum, 'known_count': count, 'unknown_count': total-count,
                    'total_count': total, 'status': status,
                    'basis': 'stored_legacy_latency_ms' if metric == 'latency_ms' else 'stored_'+metric}
        observed = summary[metric]
        require(isinstance(observed, dict), 'metric_summary_invalid')
        for field, number in expected.items():
            require(type(observed.get(field)) is type(number) and observed[field] == number,
                    'metric_summary_mismatch')
        require(numeric_equal(observed.get('coverage'), count/total)
                and 0 <= observed['coverage'] <= 1, 'metric_coverage_mismatch')
        mean = raw_sum/count if metric.endswith('_ms') and count else None
        require(numeric_equal(observed.get('known_mean'), mean), 'metric_mean_mismatch')


def parse_marker(output, prefix):
    lines = [line[len(prefix):] for line in output.decode('utf-8', 'strict').splitlines()
             if line.startswith(prefix)]
    require(len(lines) == 1, 'report_missing_or_duplicate')
    try:
        value = json.loads(lines[0])
    except (ValueError, TypeError) as error:
        raise CheckFailure('report_invalid_json') from error
    require(isinstance(value, dict), 'report_invalid_shape')
    return value


def cleanup_verified(value, streams=False):
    require(isinstance(value, dict) and all(value.get(key) is True for key in
            ('gateway_task_joined', 'fixture_task_joined', 'listeners_rebound',
             'temporary_data_removed')), 'cleanup_not_verified')
    if streams:
        require(type(value.get('active_streams')) is int and value['active_streams'] == 0,
                'active_streams_remain')


def parse_proof(output):
    value = parse_marker(output, PROOF_PREFIX)
    require(value.get('status') == 'passed' and all(value.get(key) is True for key in
            ('exact_loopback', 'mandatory_nonforwarding_proxy', 'redirect_refused',
             'unknown_refused', 'connect_refused')), 'confinement_not_verified')
    require(all(type(value.get(key)) is int and value[key] == 0 for key in
            ('inference', 'refresh', 'discovery', 'sentinel_connections')),
            'proof_dispatched_or_escaped')
    cleanup_verified(value.get('cleanup'))
    return value


def parse_http_report(output):
    value = parse_marker(output, REPORT_PREFIX)
    require(type(value.get('schema_version')) is int and value['schema_version'] == 1
            and value.get('kind') == 'buffered_http_settlement'
            and value.get('status') == 'passed' and value.get('synthetic') is True
            and value.get('actual_gateway_http') is True
            and value.get('live_client_version_provider_verified') is False
            and value.get('whole_round_metrics') is None, 'http_report_not_verified')
    cleanup_verified(value.get('cleanup'), streams=True)
    proof = value.get('preflight', {})
    require(isinstance(proof, dict) and all(proof.get(key) is True for key in
            ('exact_loopback', 'mandatory_nonforwarding_proxy', 'refresh_test_transport',
             'no_environment_mutation')), 'http_preflight_not_verified')
    counts = value.get('counts', {})
    names = ('inference', 'refresh', 'discovery', 'client_inference_requests',
             'admin_http_requests', 'unexpected_destinations')
    require(isinstance(counts, dict) and all(type(counts.get(key)) is int and counts[key] >= 0
            for key in names) and counts['unexpected_destinations'] == 0,
            'http_counts_invalid')
    require(all(counts[key] == expected for key, expected in EXPECTED_COUNTS.items())
            and counts['admin_http_requests'] > 0, 'fixed_matrix_counts_mismatch')
    records, rows = value.get('reservations'), value.get('attempts')
    require(isinstance(records, list) and records and isinstance(rows, list)
            and len(rows) == counts['inference'], 'attempt_count_mismatch')
    operations = {key: 0 for key in ('inference', 'refresh', 'discovery')}
    paths = {'inference': {'/v1/chat/completions', '/v1/responses'},
             'refresh': {'/api/accounts/oauth/token', '/oauth2/token'}, 'discovery': {'/v1/models'}}
    seen, origins = {}, set()
    for sequence, record in enumerate(records, 1):
        require(isinstance(record, dict) and isinstance(record.get('operation'), str)
                and record['operation'] in operations,
                'unexpected_operation')
        operation = record['operation']
        try:
            url = urlsplit(record.get('destination', ''))
            valid = (url.scheme == 'http' and url.hostname == '127.0.0.1' and url.port
                     and not any((url.username, url.password, url.query, url.fragment))
                     and url.path in paths[operation] and record.get('path') == url.path)
        except (ValueError, TypeError):
            valid = False
        require(valid and record.get('method') == 'POST' and type(record.get('sequence')) is int
                and record['sequence'] == sequence
                and record.get('auth_valid') is True, 'destination_or_auth_not_verified')
        origins.add(url.netloc)
        operations[operation] += 1
        if operation == 'inference':
            identity, parent = record.get('attempt_id'), record.get('request_id')
            require(isinstance(identity, str) and identity and identity not in seen
                    and isinstance(parent, str) and parent
                    and record.get('reserved_before_send') is True
                    and type(record.get('pending_count')) is int and record['pending_count'] == 1
                    and type(record.get('stream')) is bool, 'reservation_not_verified')
            seen[identity] = record
        else:
            require(type(record.get('pending_count')) is int and record['pending_count'] == 0
                    and record.get('attempt_id') is None
                    and record.get('request_id') is None, 'non_inference_reserved')
    require(len(origins) == 1 and all(counts[key] == count for key, count in operations.items()),
            'operation_counts_mismatch')
    identities, outcomes, qualities = set(), set(), set()
    for row in rows:
        require(isinstance(row, dict), 'attempt_invalid_shape')
        identity = row.get('attempt_id')
        require(isinstance(identity, str) and identity in seen and identity not in identities
                and row.get('request_id') == seen[identity]['request_id']
                and isinstance(row.get('finalized_at'), str) and row['finalized_at'],
                'attempt_identity_or_finalization_invalid')
        identities.add(identity)
        outcome, quality = row.get('outcome'), row.get('usage_status')
        require(isinstance(outcome, str) and outcome in OUTCOMES
                and isinstance(quality, str) and quality in QUALITY
                and row.get('usage_source') in ('openai_chat_v1', 'openai_responses_v1'),
                'attempt_disposition_invalid')
        outcomes.add(outcome)
        qualities.add(quality)
        for field in ('prompt_tokens', 'completion_tokens', 'headers_ms', 'first_output_ms',
                      'total_observed_ms'):
            number = row.get(field)
            require(number is None or (type(number) is int and 0 <= number <= 2**63-1),
                    'attempt_count_or_time_invalid')
        require(row.get('cli_ready_ms') is None, 'http_claims_cli_timing')
        require(seen[identity]['stream'] or row.get('first_output_ms') is None,
                'json_claims_first_delta')
        header, first, total = (row.get(k) for k in ('headers_ms', 'first_output_ms', 'total_observed_ms'))
        require(header is None or total is None or header <= total, 'time_order_invalid')
        require(first is None or (header is not None and total is not None and header <= first <= total),
                'first_delta_time_invalid')
        cost = row.get('estimated_cost_usd')
        require(cost is None or (type(cost) in (int, float) and math.isfinite(cost) and cost >= 0
                and quality == 'complete' and row.get('prompt_tokens') is not None
                and row.get('completion_tokens') is not None), 'estimate_basis_invalid')
        require(quality != 'complete' or all(row.get(k) is not None for k in
                ('prompt_tokens', 'completion_tokens')), 'usage_completeness_invalid')
    require(identities == set(seen), 'dispatch_rows_do_not_reconcile')
    require(OUTCOMES <= outcomes and {'complete', 'partial', 'missing', 'invalid'} <= qualities,
            'disposition_coverage_incomplete')
    accounting = value.get('accounting', {})
    require(isinstance(accounting, dict) and all(accounting.get(key) is True for key in
            ('inference_matches_rows', 'distinct_attempt_ids', 'no_refresh_rows',
             'sql_json_csv_web_reconciled', 'history_preserved', 'recovery_once')),
            'accounting_not_verified')
    stages, cases = value.get('stages'), value.get('case_results')
    require(isinstance(stages, list) and len(stages) == len(STAGES)
            and all(isinstance(s, dict) and s.get('status') == 'passed' for s in stages)
            and [s.get('stage') for s in stages] == list(STAGES)
            and value.get('stage_inventory') == list(STAGES), 'stages_not_verified')
    for name in ('inference', 'refresh', 'discovery', 'cases'):
        require(all(type(s.get(name)) is int and s[name] >= 0 for s in stages),
                'stage_count_invalid')
        require(sum(s[name] for s in stages) == (len(CASE_NAMES) if name == 'cases' else counts[name]),
                'stage_count_mismatch')
    require(isinstance(cases, list) and len(cases) == len(CASE_NAMES)
            and value.get('case_inventory') == sorted(CASE_NAMES), 'case_inventory_invalid')
    case_names, case_attempts = set(), set()
    for case in cases:
        require(isinstance(case, dict) and isinstance(case.get('case'), str)
                and case['case'] in CASE_NAMES and case['case'] not in case_names,
                'case_missing_or_duplicate')
        name = case['case']
        case_names.add(name)
        expected = (0 if name in ('reservation_failure', 'reopen_history', 'cross_surface') else
                    2 if name in ('fallback', 'siwc_401', 'grok_401', 'borrowed_changed') else 1)
        require(case.get('status') == 'passed' and case.get('body_contract_passed') is True
                and isinstance(case.get('body_contract'), str) and case['body_contract']
                and case.get('client') in ('chat', 'messages', 'responses')
                and case.get('provider') in ('generic', 'siwc', 'grok', 'opencode', 'all')
                and all(type(case.get(k)) is int and case[k] == expected for k in
                        ('expected_dispatch_count', 'observed_row_count', 'expected_row_count')),
                'case_contract_not_verified')
        case_rows = case.get('attempts')
        require(isinstance(case_rows, list) and len(case_rows) == expected, 'case_rows_missing')
        parents = set()
        for row in case_rows:
            require(isinstance(row, dict) and isinstance(row.get('attempt_id'), str)
                    and row['attempt_id'] in identities and row['attempt_id'] not in case_attempts,
                    'case_attempt_identity_invalid')
            identity = row['attempt_id']
            case_attempts.add(identity)
            require(row.get('request_id') == seen[identity]['request_id']
                    and row.get('public_model') == name, 'case_request_identity_invalid')
            parents.add(row['request_id'])
            if name == 'finalization_failure':
                require(row.get('finalized_at') is None, 'failed_finalization_not_pending')
                final = next(r for r in rows if r['attempt_id'] == identity)
                require(final['outcome'] == 'interrupted', 'pending_attempt_not_recovered')
            else:
                require(row == next(r for r in rows if r['attempt_id'] == identity),
                        'case_ledger_snapshot_mismatch')
        require(len(parents) <= 1, 'retry_parent_mismatch')
    require(case_names == CASE_NAMES and case_attempts == identities, 'case_coverage_incomplete')
    verify_surfaces(value.get('surfaces'), rows)
    return value


def verify_results(output, test):
    text = output.decode('utf-8', 'strict')
    summaries = re.findall(r'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;', text)
    require(summaries == [('1', '0', '0')] and re.search(r'^test '+re.escape(test)+r' \.\.\.', text, re.M),
            'native_test_not_executed')


def run_native(binary, arguments, timeout=120):
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='buffered-check-home-') as home:
        env = {'PATH': os.defpath, 'LANG': 'C.UTF-8', 'HOME': home, 'TMPDIR': home,
               'RUST_BACKTRACE': '0'}
        child = subprocess.Popen([str(binary), *arguments], env=env, cwd=home,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            output, _ = child.communicate(timeout=timeout)
            code = child.returncode
        except BaseException as error:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                output, _ = child.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                output, _ = child.communicate(timeout=5)
            code = 124 if isinstance(error, subprocess.TimeoutExpired) else 130
    return code, output, round(time.monotonic()-started, 6)


def check(binary, expected_digest, report_dir):
    report = {'schema': 1, 'kind': 'buffered_http_settlement_check', 'status': 'failed',
              'stage': 'binary_guard', 'synthetic': True, 'live_client_version_provider_verified': False,
              'whole_round_metrics': None, 'commands': [], 'proof': None, 'http': None}
    try:
        require(re.fullmatch(r'[0-9a-f]{64}', expected_digest), 'invalid_expected_digest')
        binary = binary.resolve(strict=True)
        report['test_binary_sha256'] = sha256(binary)
        require(report['test_binary_sha256'] == expected_digest, 'binary_digest_mismatch')
        for stage, args, test, parse in (
                ('inventory', ['--list'], None, None),
                ('isolation_proof', [PROOF_TEST, '--exact', '--nocapture', '--test-threads=1'], PROOF_TEST, parse_proof),
                ('actual_http', [HTTP_TEST, '--exact', '--nocapture', '--test-threads=1'], HTTP_TEST, parse_http_report)):
            report['stage'] = stage
            require(sha256(binary) == expected_digest, 'binary_digest_mismatch')
            code, output, elapsed = run_native(binary, args, timeout=15 if stage == 'inventory' else 120)
            (report_dir/(stage+'.log')).write_bytes(output)
            report['commands'].append({'stage': stage, 'argv': args, 'exit': code,
                                       'command_seconds': elapsed, 'output_sha256': hashlib.sha256(output).hexdigest()})
            require(code == 0, 'native_command_failed')
            if stage == 'inventory':
                names = output.decode('utf-8', 'strict').splitlines()
                require(all(names.count(name+': test') == 1 for name in (PROOF_TEST, HTTP_TEST)),
                        'required_native_tests_missing')
            else:
                verify_results(output, test)
                report['proof' if stage == 'isolation_proof' else 'http'] = parse(output)
        report['status'], report['stage'] = 'passed', 'verified'
    except (CheckFailure, OSError, UnicodeError) as error:
        report['error'] = str(error) if isinstance(error, CheckFailure) else type(error).__name__
    except KeyboardInterrupt:
        report['error'] = 'interrupted'
    finally:
        (report_dir/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


def main():
    def stop(_signal, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='default and only mode')
    parser.add_argument('--test-binary', required=True, type=Path)
    parser.add_argument('--expected-test-sha256', required=True)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix='buffered-http-', dir=args.output_dir))
    report = check(args.test_binary, args.expected_test_sha256, directory)
    print(f"Buffered HTTP settlement check: {report['status']} ({report['stage']})")
    print(f"Report: {directory/'report.json'}")
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
