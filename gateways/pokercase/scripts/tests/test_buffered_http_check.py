import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    'buffered_http_check', Path(__file__).parents[1] / 'buffered_http_check.py')
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


def proof():
    return {'status': 'passed', 'exact_loopback': True, 'mandatory_nonforwarding_proxy': True,
            'redirect_refused': True, 'unknown_refused': True, 'connect_refused': True,
            'inference': 0, 'refresh': 0, 'discovery': 0, 'sentinel_connections': 0,
            'cleanup': {key: True for key in ('gateway_task_joined', 'fixture_task_joined',
                                            'listeners_rebound', 'temporary_data_removed')}}


def report():
    rows, records, cases = [], [], []
    outcome_by_name = {'body_cancelled': 'cancelled', 'body_timeout': 'timeout',
                       'chat_error': 'failed', 'chat_incomplete': 'incomplete',
                       'chat_unknown': 'unknown', 'finalization_failure': 'interrupted'}
    for name in sorted(check.CASE_NAMES):
        count = (0 if name in ('reservation_failure', 'reopen_history', 'cross_surface') else
                 2 if name in ('fallback', 'siwc_401', 'grok_401', 'borrowed_changed') else 1)
        selected = []
        for _ in range(count):
            identity = f'synthetic-attempt-{len(rows)}'
            quality = {'usage_partial': 'partial', 'usage_missing': 'missing',
                       'usage_invalid_sibling': 'invalid', 'usage_invalid_object': 'invalid',
                       'finalization_failure': 'unknown'}.get(name, 'complete')
            prompt, completion = ((0, 0) if name == 'usage_zero' else (11, 7))
            if quality in ('partial', 'missing', 'unknown'):
                completion = None
            if quality in ('invalid', 'missing', 'unknown'):
                prompt = None
            row = {'attempt_id': identity, 'request_id': 'synthetic-parent-'+name,
                   'public_model': name, 'status': 200, 'outcome': outcome_by_name.get(name, 'succeeded'),
                   'usage_status': quality, 'usage_source': 'openai_chat_v1',
                   'prompt_tokens': prompt, 'completion_tokens': completion,
                   'estimated_cost_usd': ((prompt*2+completion*3)/1_000_000 if quality == 'complete' else None),
                   'headers_ms': 1, 'latency_ms': 1, 'first_output_ms': None, 'cli_ready_ms': None,
                   'total_observed_ms': None if name == 'finalization_failure' else 2,
                   'finalized_at': '2026-10-29T00:00:00Z', 'error': None}
            rows.append(row)
            selected.append(copy.deepcopy(row))
            if name == 'finalization_failure':
                selected[-1].update(finalized_at=None, outcome='unknown')
            records.append({'sequence': len(records)+1, 'operation': 'inference', 'method': 'POST',
                            'destination': 'http://127.0.0.1:12345/v1/chat/completions',
                            'path': '/v1/chat/completions', 'stream': False, 'auth_valid': True,
                            'reserved_before_send': True, 'pending_count': 1,
                            'attempt_id': identity, 'request_id': row['request_id']})
        cases.append({'case': name, 'provider': 'generic', 'client': 'chat', 'status': 'passed',
                      'body_contract': 'synthetic validator fixture', 'body_contract_passed': True,
                      'expected_dispatch_count': count, 'expected_row_count': count,
                      'observed_row_count': count, 'attempts': selected})
    for _ in range(4):
        records.append({'sequence': len(records)+1, 'operation': 'refresh', 'method': 'POST',
                        'destination': 'http://127.0.0.1:12345/oauth2/token', 'path': '/oauth2/token',
                        'auth_valid': True, 'pending_count': 0, 'attempt_id': None, 'request_id': None})
    stages = [{'stage': name, 'status': 'passed', 'cases': 0, 'inference': 0,
               'refresh': 0, 'discovery': 0} for name in check.STAGES]
    stages[0].update(cases=len(cases), inference=len(rows), refresh=4)
    summaries = {}
    for metric in check.METRICS:
        values = [r[metric] for r in rows if r[metric] is not None]
        known, total = len(values), len(rows)
        summaries[metric] = {'known_sum': sum(values) if known else None, 'known_count': known,
            'unknown_count': total-known, 'total_count': total, 'coverage': known/total,
            'known_mean': sum(values)/known if metric.endswith('_ms') and known else None,
            'status': 'unknown' if not known else 'complete' if known == total else 'partial',
            'basis': 'stored_legacy_latency_ms' if metric == 'latency_ms' else 'stored_'+metric}
    surfaces = {'rows': len(rows), 'events_json_rows': len(rows), 'csv_rows': len(rows),
                'matching_summary_rows': len(rows), 'web_recent_rows': 50, 'web_recent_limit': 50,
                'daily_api_limit': 30, 'web_day_limit': 14, 'selected_date_buckets': 1,
                'sql_json_csv_web_reconciled': True, 'measurement_summary': summaries}
    return {'schema_version': 1, 'kind': 'buffered_http_settlement', 'status': 'passed',
            'synthetic': True, 'actual_gateway_http': True, 'live_client_version_provider_verified': False,
            'whole_round_metrics': None, 'preflight': {key: True for key in
                ('exact_loopback', 'mandatory_nonforwarding_proxy', 'refresh_test_transport', 'no_environment_mutation')},
            'counts': dict(check.EXPECTED_COUNTS, admin_http_requests=123),
            'reservations': records, 'attempts': rows, 'surfaces': surfaces, 'stage_inventory': list(check.STAGES),
            'stages': stages, 'case_inventory': sorted(check.CASE_NAMES), 'case_results': cases,
            'accounting': {key: True for key in ('inference_matches_rows', 'distinct_attempt_ids',
                'no_refresh_rows', 'sql_json_csv_web_reconciled', 'history_preserved', 'recovery_once')},
            'cleanup': dict(proof()['cleanup'], active_streams=0, dropped_streams=1)}


def encoded(value, prefix=check.REPORT_PREFIX):
    return (prefix+json.dumps(value)).encode()


class BufferedCheckTests(unittest.TestCase):
    def reject_mutations(self, mutations):
        for mutate in mutations:
            value = report()
            mutate(value)
            with self.subTest(mutation=mutate):
                with self.assertRaises(check.CheckFailure):
                    check.parse_http_report(encoded(value))

    def test_full_contract_and_explicit_zero_pass(self):
        value = report()
        self.assertEqual(check.parse_http_report(encoded(value)), value)
        zero = next(r for r in value['attempts'] if r['public_model'] == 'usage_zero')
        self.assertEqual(zero['estimated_cost_usd'], 0)

    def test_missing_duplicate_or_wrong_case_is_rejected(self):
        self.reject_mutations((lambda v: v['case_results'].pop(),
            lambda v: v['case_results'].__setitem__(1, copy.deepcopy(v['case_results'][0])),
            lambda v: v['case_inventory'].pop(),
            lambda v: v['case_results'][0].update(body_contract_passed=False)))

    def test_changed_stage_or_dispatch_totals_are_rejected(self):
        self.reject_mutations((lambda v: v['stages'].pop(),
            lambda v: v['stage_inventory'].reverse(),
            lambda v: v['stages'][0].update(inference=55),
            lambda v: v['counts'].update(inference=55),
            lambda v: v['counts'].update(unexpected_destinations=1)))

    def test_missing_reservation_or_duplicate_identity_is_rejected(self):
        self.reject_mutations((lambda v: v['reservations'][0].update(reserved_before_send=False),
            lambda v: v['reservations'][0].update(pending_count=0),
            lambda v: v['attempts'][1].update(attempt_id=v['attempts'][0]['attempt_id']),
            lambda v: v['attempts'][0].update(finalized_at=None),
            lambda v: v['reservations'][-1].update(attempt_id='false-refresh-row')))

    def test_external_destination_and_connect_are_rejected(self):
        self.reject_mutations((lambda v: v['reservations'][0].update(destination='https://api.example.invalid/v1/chat/completions'),
            lambda v: v['reservations'][0].update(method='CONNECT'),
            lambda v: v['reservations'][0].update(destination='http://127.0.0.1:12345/v1/chat/completions?q=1'),
            lambda v: v['reservations'][0].update(auth_valid=False),
            lambda v: v['reservations'][0].update(operation=[])))

    def test_boolean_counts_nonfinite_and_false_json_clock_are_rejected(self):
        self.reject_mutations((lambda v: v.update(schema_version=True),
            lambda v: v['counts'].update(discovery=False),
            lambda v: v['reservations'][0].update(sequence=True),
            lambda v: v['attempts'][0].update(prompt_tokens=True),
            lambda v: v['attempts'][0].update(estimated_cost_usd=float('nan')),
            lambda v: v['attempts'][0].update(first_output_ms=1)))

    def test_incomplete_usage_cannot_claim_complete_or_cost(self):
        self.reject_mutations((lambda v: next(r for r in v['attempts'] if r['usage_status']=='partial').update(usage_status='complete'),
            lambda v: next(r for r in v['attempts'] if r['usage_status']=='partial').update(estimated_cost_usd=0),
            lambda v: v['attempts'][0].update(usage_status=[]),
            lambda v: v['attempts'][0].update(outcome=[])))

    def test_recovery_and_cross_surface_claims_need_evidence(self):
        self.reject_mutations((lambda v: v['accounting'].update(sql_json_csv_web_reconciled=False),
            lambda v: v['accounting'].update(recovery_once=False),
            lambda v: v['cleanup'].update(active_streams=1),
            lambda v: v['case_results'][0]['attempts'][0].update(request_id='changed-parent'),
            lambda v: next(r for r in v['attempts'] if r['public_model']=='finalization_failure').update(outcome='succeeded')))

    def test_duplicate_or_non_object_report_is_rejected(self):
        for output in (encoded(report())+b'\n'+encoded(report()), encoded([]), b'no marker',
                       (check.REPORT_PREFIX+'{').encode()):
            with self.assertRaises(check.CheckFailure):
                check.parse_http_report(output)

    def test_proof_rejects_dispatch_escape_and_cleanup_failure(self):
        good = proof()
        self.assertEqual(check.parse_proof(encoded(good, check.PROOF_PREFIX)), good)
        for field, value in (('inference', 1), ('refresh', True), ('sentinel_connections', 1),
                             ('connect_refused', False), ('mandatory_nonforwarding_proxy', False)):
            bad = proof()
            bad[field] = value
            with self.assertRaises(check.CheckFailure):
                check.parse_proof(encoded(bad, check.PROOF_PREFIX))

    def test_native_summary_must_execute_exact_case(self):
        good = f'test {check.HTTP_TEST} ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored;'.encode()
        check.verify_results(good, check.HTTP_TEST)
        for output in (good.replace(b'1 passed', b'0 passed'), good.replace(b'0 ignored', b'1 ignored'),
                       good.replace(check.HTTP_TEST.encode(), b'another-test')):
            with self.assertRaises(check.CheckFailure):
                check.verify_results(output, check.HTTP_TEST)

    def test_digest_failure_never_launches_native(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root/'synthetic-binary'
            binary.write_bytes(b'synthetic')
            with patch.object(check, 'run_native') as launch:
                result = check.check(binary, '0'*64, root)
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['stage'], 'binary_guard')
            launch.assert_not_called()

    def test_failed_proof_prevents_http_dispatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root/'synthetic-binary'
            binary.write_bytes(b'synthetic')
            inventory = f'{check.PROOF_TEST}: test\n{check.HTTP_TEST}: test\n'.encode()
            with patch.object(check, 'run_native', side_effect=[(0, inventory, 0), (101, b'failed', 0)]) as launch:
                result = check.check(binary, check.sha256(binary), root)
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['stage'], 'isolation_proof')
            self.assertEqual(launch.call_count, 2)
            self.assertNotIn(check.HTTP_TEST, launch.call_args.args[1])

    def test_surface_denominators_null_and_means_are_independent(self):
        self.reject_mutations((lambda v: v['surfaces'].update(web_recent_rows=54),
            lambda v: v['surfaces'].update(matching_summary_rows=50),
            lambda v: v['surfaces']['measurement_summary']['cli_ready_ms'].update(known_sum=0),
            lambda v: v['surfaces']['measurement_summary']['prompt_tokens'].update(status='complete'),
            lambda v: v['surfaces']['measurement_summary']['headers_ms'].update(known_mean=0),
            lambda v: v['surfaces']['measurement_summary']['headers_ms'].update(basis='stored_total_observed_ms')))
        value = report()
        summary = value['surfaces']['measurement_summary']['prompt_tokens']
        summary['coverage'] = __import__('math').nextafter(summary['coverage'], 0)
        self.assertEqual(check.parse_http_report(encoded(value)), value)

    def test_digest_change_after_inventory_prevents_proof_and_http(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root/'synthetic-binary'
            binary.write_bytes(b'synthetic')
            digest = check.sha256(binary)
            def inventory(*_args, **_kwargs):
                binary.write_bytes(b'replaced')
                return 0, f'{check.PROOF_TEST}: test\n{check.HTTP_TEST}: test\n'.encode(), 0
            with patch.object(check, 'run_native', side_effect=inventory) as launch:
                result = check.check(binary, digest, root)
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['error'], 'binary_digest_mismatch')
            self.assertEqual(launch.call_count, 1)


if __name__ == '__main__':
    unittest.main()
