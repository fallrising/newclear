#!/usr/bin/env python3
"""Independently check the nine storage-process M-10 boundary observations."""
import copy
import math


class InvalidStorageReport(ValueError):
    pass


def require(value, code):
    if not value:
        raise InvalidStorageReport(code)


FAMILIES = ('http', 'claude', 'cursor')
PHASES = ('reserved', 'pre_finalize', 'post_finalize')
SOURCES = {'http': 'openai_chat_v1', 'claude': 'claude_code_stream_event_v1', 'cursor': 'cursor_cli_result_v1'}
TERMINAL_VALUES = ('prompt_tokens', 'completion_tokens', 'estimated_cost_usd', 'first_output_ms',
                   'total_observed_ms', 'reported_input_tokens', 'reported_output_tokens',
                   'reported_cache_read_input_tokens', 'reported_cache_creation_input_tokens')


def check_row(row):
    require(isinstance(row, dict), 'row_object')
    for key in ('id', 'status', 'latency_ms', 'headers_ms', 'cli_ready_ms', *TERMINAL_VALUES):
        require(key in row, 'row_field_missing')
        value = row[key]
        if value is None:
            continue
        if key == 'estimated_cost_usd':
            require(type(value) in (int, float) and math.isfinite(value) and value >= 0, 'cost_number')
        else:
            require(type(value) is int and value >= 0, 'measurement_integer')
    for key in ('request_id', 'attempt_id', 'usage_source', 'public_model', 'connection_id', 'upstream_model'):
        require(isinstance(row.get(key), str) and row[key], 'row_identity')
    for key in ('finalized_at', 'outcome', 'usage_status', 'error'):
        require(key in row, 'row_field_missing')


def validate_storage_report(report, expected_manifest_dir=None):
    require(isinstance(report, dict) and report.get('schema_version') == 1, 'schema')
    require(report.get('kind') == 'storage_process' and report.get('status') == 'passed', 'status')
    require(report.get('no_http_inference') is True and
            report.get('dispatch_basis') == 'production_store_calls_only_no_dispatch', 'evidence_layer')
    require(report.get('live_client_version_provider_verified') is False, 'live_claim')
    require('whole_round_metrics' in report and report['whole_round_metrics'] is None, 'round_metrics')
    require(isinstance(report.get('compiled_manifest_dir'), str) and report['compiled_manifest_dir'], 'compiled_source')
    require(report.get('compiled_source_file') == 'src/store_crash_tests.rs', 'compiled_file')
    if expected_manifest_dir is not None:
        require(report['compiled_manifest_dir'] == expected_manifest_dir, 'compiled_source_mismatch')
    cases = report.get('cases')
    names = [f'{family}_{phase}' for family in FAMILIES for phase in PHASES]
    require(isinstance(cases, list) and len(cases) == 9, 'case_count')
    require([c.get('name') for c in cases] == names, 'case_inventory')
    for case, name in zip(cases, names):
        family, phase = name.split('_', 1)
        require(case.get('family') == family and case.get('phase') == phase, 'case_boundary')
        ack = case.get('ack', {})
        require(ack.get('family') == family and ack.get('phase') == phase and
                type(ack.get('pid')) is int and ack['pid'] > 0, 'phase_ack')
        require(type(case.get('signal')) is int and case['signal'] == 9, 'observed_sigkill')
        for flag in ('lock_denied_while_child_alive', 'owned_child_reaped', 'history_unchanged', 'temporary_state_removed'):
            require(case.get(flag) is True, flag)
        before = case.get('before_rows')
        require(isinstance(before, list) and len(before) == 2, 'before_rows')
        for row in before:
            check_row(row)
        history, target = before
        require(history['id'] != target['id'] and history['attempt_id'] != target['attempt_id'], 'distinct_attempts')
        require(history['request_id'] == target['request_id'] == ack.get('request_id') == f'synthetic-{family}-{phase}', 'parent_identity')
        require(target['attempt_id'] == ack.get('attempt_id'), 'attempt_identity')
        require(history['public_model'] == 'history' and history['outcome'] == 'succeeded' and
                history['usage_status'] == 'complete' and isinstance(history['finalized_at'], str) and
                history['prompt_tokens'] == 0 and history['completion_tokens'] == 7 and
                history['estimated_cost_usd'] == 1.25, 'known_history_control')
        require(target['public_model'] == 'target' and target['connection_id'] == 'synthetic-target' and
                target['upstream_model'] == 'synthetic-upstream' and target['usage_source'] == SOURCES[family], 'target_source')
        observed = phase != 'reserved'
        expected_clocks = {'status': 200 if observed and family == 'http' else None,
                           'headers_ms': 8 if observed and family == 'http' else None,
                           'cli_ready_ms': 7 if observed and family != 'http' else None,
                           'latency_ms': (8 if family == 'http' else 7) if observed else None}
        require(all(target[k] == v for k, v in expected_clocks.items()), 'saved_clock_basis')
        require(target['error'] is None, 'before_error')
        finalized = phase == 'post_finalize'
        if finalized:
            require(isinstance(target['finalized_at'], str) and target['finalized_at'], 'committed_finalizer')
            require(target['outcome'] == 'succeeded' and target['usage_status'] ==
                    ('partial' if family == 'cursor' else 'complete'), 'final_outcome')
            expected = {'prompt_tokens': {'http': 11, 'claude': 7, 'cursor': None}[family],
                        'completion_tokens': 0, 'estimated_cost_usd': 0 if family == 'http' else None,
                        'first_output_ms': 0, 'total_observed_ms': 31,
                        'reported_input_tokens': None if family == 'http' else 5,
                        'reported_output_tokens': None if family == 'http' else 0,
                        'reported_cache_read_input_tokens': None if family == 'http' else 0,
                        'reported_cache_creation_input_tokens': None if family == 'http' else 2}
            require(all(target[k] == v for k, v in expected.items()), 'final_values')
        else:
            require(target['finalized_at'] is None and target['outcome'] == 'unknown' and
                    target['usage_status'] == 'missing', 'pending_state')
            require(all(target[k] is None for k in TERMINAL_VALUES), 'pending_observations_unknown')
        require(case.get('after_kill_rows') == before, 'kill_did_not_invent_observations')
        after = case.get('after_rows')
        require(isinstance(after, list) and len(after) == 2, 'recovered_rows')
        for row in after:
            check_row(row)
        require(after[0] == history, 'finalized_history_rewritten')
        expected = copy.deepcopy(target)
        if not finalized:
            require(isinstance(after[1]['finalized_at'], str) and after[1]['finalized_at'], 'recovery_timestamp')
            expected.update(finalized_at=after[1]['finalized_at'], outcome='interrupted',
                            usage_status='missing', error='stream_interrupted')
        require(after[1] == expected, 'recovery_changed_wrong_fields')
        require(case.get('recovery_counts') == [0 if finalized else 1, 0], 'recovery_counts')
        require(case.get('second_rows') == after, 'second_recovery_changed_history')
    return {'status': 'passed', 'storage_process_cases': 9, 'actual_http_cases': 0}
