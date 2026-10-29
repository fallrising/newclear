import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    'antigravity_settlement_check', Path(__file__).parents[1] / 'antigravity_settlement_check.py'
)
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


def report():
    operations = ['inference'] * 6 + ['discovery', 'refresh']
    paths = {'inference': '/v1internal:generateContent', 'discovery': '/v1internal:loadCodeAssist',
             'refresh': '/token'}
    outcomes = ['succeeded', 'incomplete', 'failed', 'cancelled', 'timeout', 'unknown']
    return {
        'schema_version': 1, 'test': check.HTTP_TEST, 'status': 'passed', 'actual_gateway_http': True,
        'cleanup': {'gateway_task_joined': True, 'fake_task_joined': True, 'listeners_rebound': True,
                    'temporary_data_removed': True, 'active_streams': 0},
        'stages': [{'stage': f'stage-{i}', 'status': 'passed'} for i in range(7)],
        'counts': {'inference': 6, 'discovery': 1, 'refresh': 1, 'unexpected_destinations': 0},
        'destinations': [{'sequence': i, 'operation': operation, 'method': 'POST',
                          'destination': 'http://127.0.0.1:12345' + paths[operation],
                          'synthetic_auth_validated': True, 'synthetic_body_validated': True}
                         for i, operation in enumerate(operations, 1)],
        'accounting': {key: True for key in ('dispatch_rows_match', 'unique_attempts',
            'no_pending_after_recovery', 'surfaces_match', 'no_extra_dispatch',
            'opaque_semantics_verified', 'restart_recovery_verified', 'reservation_failure_no_dispatch')},
        'attempts': [{'attempt_id': f'fixture-attempt-{i}', 'request_id': f'fixture-request-{i}',
                      'status': 200, 'outcome': outcome, 'usage_status': 'unknown',
                      'usage_source': 'antigravity_opaque_v1' if i >= 3 else 'antigravity_generate_content_v1',
                      'finalized_at': '2026-10-29T00:00:00Z', 'headers_ms': 1,
                      'total_observed_ms': 2, 'first_output_ms': None, 'prompt_tokens': None,
                      'completion_tokens': None, 'estimated_cost_usd': None, 'error': None}
                     for i, outcome in enumerate(outcomes)],
    }


def encoded(value):
    return ('ANTIGRAVITY_SETTLEMENT_REPORT=' + json.dumps(value)).encode()


class SettlementCheckTests(unittest.TestCase):
    def test_complete_report_and_known_zero_are_accepted(self):
        value = report()
        value['attempts'][0].update(prompt_tokens=0, completion_tokens=0, usage_status='complete',
                                    estimated_cost_usd=0)
        self.assertEqual(check.parse_settlement_report(encoded(value)), value)

    def test_missing_row_duplicate_identity_and_pending_are_rejected(self):
        for mutate in (lambda v: v['attempts'].pop(),
                       lambda v: v['attempts'][1].update(attempt_id='fixture-attempt-0'),
                       lambda v: v['attempts'][0].update(finalized_at=None),
                       lambda v: v['attempts'][0].update(request_id='')):
            value = report()
            mutate(value)
            with self.assertRaises(check.CheckFailure):
                check.parse_settlement_report(encoded(value))

    def test_unknown_cannot_be_promoted_to_opaque_success_or_usage(self):
        for fields in ({'outcome': 'succeeded'}, {'prompt_tokens': 0}, {'estimated_cost_usd': 0},
                       {'first_output_ms': 1}, {'usage_status': 'complete'}):
            value = report()
            value['attempts'][-1].update(fields)
            with self.assertRaises(check.CheckFailure):
                check.parse_settlement_report(encoded(value))

    def test_failed_checks_and_nonloopback_destinations_are_rejected(self):
        for mutate in (lambda v: v['accounting'].update(surfaces_match=False),
                       lambda v: v['cleanup'].update(active_streams=1),
                       lambda v: v['destinations'][0].update(destination='https://invalid.example/token'),
                       lambda v: v['stages'].pop(),
                       lambda v: v['attempts'][0].update(prompt_tokens=True),
                       lambda v: v['attempts'][0].update(estimated_cost_usd=float('nan'))):
            value = report()
            mutate(value)
            with self.assertRaises(check.CheckFailure):
                check.parse_settlement_report(encoded(value))

    def test_prior_checker_constants_remain_unchanged(self):
        old_spec = importlib.util.spec_from_file_location('prior_entry',
            Path(__file__).parents[1] / 'antigravity_http_check.py')
        old = importlib.util.module_from_spec(old_spec)
        old_spec.loader.exec_module(old)
        self.assertEqual(old.HTTP_TEST, 'proxy::agy_http_tests::ai_http_acceptance')
        self.assertEqual(old.REPORT_PREFIX, 'ANTIGRAVITY_HTTP_REPORT=')

    def test_digest_mismatch_prevents_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = root / 'fixture-binary'
            binary.write_bytes(b'synthetic')
            with patch.object(check._native, 'run_native') as execute:
                result = check.check(binary, '0' * 64, root)
            execute.assert_not_called()
            self.assertEqual(result['error'], 'test_binary_digest_mismatch')
            self.assertFalse(result['native_antigravity_stream_conversion_verified'])
            self.assertEqual(json.loads((root / 'report.json').read_text()), result)

    def test_isolation_failure_never_runs_http(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = root / 'fixture-binary'
            binary.write_bytes(b'synthetic')
            listing = (f'{check._native.TRANSPORT_PREFIX}proof: test\n{check.HTTP_TEST}: test\n').encode()
            with patch.object(check._native, 'run_native', side_effect=[(0, listing, 0),
                    (101, b'failed proof', 0)]) as execute:
                result = check.check(binary, check._native.sha256(binary), root)
            self.assertEqual(execute.call_count, 2)
            self.assertEqual(result['stage'], 'isolation_proof')
            self.assertEqual(result['status'], 'failed')
            self.assertIsNone(result['http'])


if __name__ == '__main__':
    unittest.main()
