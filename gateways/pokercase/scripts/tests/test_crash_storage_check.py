import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from crash_storage_check import InvalidStorageReport, validate_storage_report


def fixture():
    cases = []
    for family in ('http', 'claude', 'cursor'):
        for phase in ('reserved', 'pre_finalize', 'post_finalize'):
            name = family + '_' + phase
            history = dict(id=1, request_id='synthetic-' + family + '-' + phase, attempt_id=name + '-history',
                           usage_source='openai_chat_v1', public_model='history', connection_id='synthetic-history',
                           upstream_model='synthetic', finalized_at='2026-10-31T00:00:00Z', outcome='succeeded',
                           usage_status='complete', error=None, prompt_tokens=0, completion_tokens=7,
                           estimated_cost_usd=1.25, status=200, latency_ms=5, headers_ms=5, cli_ready_ms=None,
                           first_output_ms=0, total_observed_ms=29, reported_input_tokens=None,
                           reported_output_tokens=None, reported_cache_read_input_tokens=None,
                           reported_cache_creation_input_tokens=None)
            target = copy.deepcopy(history)
            target.update(id=2, attempt_id=name + '-target', public_model='target',
                          connection_id='synthetic-target', upstream_model='synthetic-upstream',
                          usage_source={'http': 'openai_chat_v1', 'claude': 'claude_code_stream_event_v1',
                                        'cursor': 'cursor_cli_result_v1'}[family],
                          finalized_at=None, outcome='unknown', usage_status='missing', prompt_tokens=None,
                          completion_tokens=None, estimated_cost_usd=None, first_output_ms=None, total_observed_ms=None,
                          status=None, latency_ms=None, headers_ms=None, cli_ready_ms=None)
            if phase != 'reserved':
                target.update(status=200 if family == 'http' else None, headers_ms=8 if family == 'http' else None,
                              cli_ready_ms=None if family == 'http' else 7, latency_ms=8 if family == 'http' else 7)
            if phase == 'post_finalize':
                target.update(finalized_at='2026-10-31T00:00:01Z', outcome='succeeded',
                              usage_status='partial' if family == 'cursor' else 'complete',
                              prompt_tokens={'http': 11, 'claude': 7, 'cursor': None}[family], completion_tokens=0,
                              estimated_cost_usd=0.0 if family == 'http' else None,
                              first_output_ms=0, total_observed_ms=31)
                if family != 'http':
                    target.update(reported_input_tokens=5, reported_output_tokens=0,
                                  reported_cache_read_input_tokens=0, reported_cache_creation_input_tokens=2)
            before = [history, target]
            after = copy.deepcopy(before)
            if phase != 'post_finalize':
                after[1].update(finalized_at='2026-10-31T00:00:02Z', outcome='interrupted', error='stream_interrupted')
            cases.append(dict(name=name, family=family, phase=phase,
                              ack=dict(family=family, phase=phase, pid=100 + len(cases),
                                       request_id=target['request_id'], attempt_id=target['attempt_id']),
                              signal=9, lock_denied_while_child_alive=True, owned_child_reaped=True,
                              history_unchanged=True, temporary_state_removed=True,
                              before_rows=before, after_kill_rows=copy.deepcopy(before), after_rows=after,
                              second_rows=copy.deepcopy(after), recovery_counts=[int(phase != 'post_finalize'), 0]))
    return dict(schema_version=1, kind='storage_process', status='passed', no_http_inference=True,
                dispatch_basis='production_store_calls_only_no_dispatch', live_client_version_provider_verified=False,
                whole_round_metrics=None, compiled_manifest_dir='/synthetic/source',
                compiled_source_file='src/store_crash_tests.rs', cases=cases)


class StorageEvidenceTests(unittest.TestCase):
    def test_complete_matrix_and_explicit_zero(self):
        self.assertEqual(validate_storage_report(fixture(), '/synthetic/source')['storage_process_cases'], 9)

    def test_rejects_wrong_compiled_source(self):
        with self.assertRaises(InvalidStorageReport):
            validate_storage_report(fixture(), '/synthetic/different')

    def test_rejects_incomplete_inventory(self):
        report = fixture(); report['cases'].pop()
        with self.assertRaises(InvalidStorageReport): validate_storage_report(report)

    def test_rejects_unobserved_kill_or_cleanup(self):
        for key, value in [('signal', 15), ('owned_child_reaped', False),
                           ('lock_denied_while_child_alive', False), ('temporary_state_removed', False)]:
            with self.subTest(key=key):
                report = fixture(); report['cases'][0][key] = value
                with self.assertRaises(InvalidStorageReport): validate_storage_report(report)

    def test_rejects_wrong_boundary_ack(self):
        report = fixture(); report['cases'][0]['ack']['phase'] = 'post_finalize'
        with self.assertRaises(InvalidStorageReport): validate_storage_report(report)

    def test_rejects_invented_pending_observation(self):
        report = fixture(); report['cases'][0]['before_rows'][1]['prompt_tokens'] = 0
        with self.assertRaises(InvalidStorageReport): validate_storage_report(report)

    def test_rejects_history_change(self):
        report = fixture(); report['cases'][0]['after_rows'][0]['estimated_cost_usd'] = 0
        with self.assertRaises(InvalidStorageReport): validate_storage_report(report)

    def test_rejects_replay_or_second_recovery(self):
        for field in ('after_rows', 'second_rows'):
            report = fixture(); report['cases'][0][field].append(copy.deepcopy(report['cases'][0][field][1]))
            with self.assertRaises(InvalidStorageReport): validate_storage_report(report)

    def test_rejects_recovery_identity_change(self):
        report = fixture(); report['cases'][0]['after_rows'][1]['attempt_id'] = 'other'
        with self.assertRaises(InvalidStorageReport): validate_storage_report(report)

    def test_rejects_boolean_measurement(self):
        report = fixture(); report['cases'][2]['before_rows'][1]['completion_tokens'] = False
        with self.assertRaises(InvalidStorageReport): validate_storage_report(report)

    def test_rejects_fabricated_cli_cost_or_prompt(self):
        for index, key in [(5, 'estimated_cost_usd'), (8, 'prompt_tokens')]:
            report = fixture(); report['cases'][index]['before_rows'][1][key] = 0
            with self.assertRaises(InvalidStorageReport): validate_storage_report(report)

    def test_rejects_missing_field_or_http_claim(self):
        report = fixture(); del report['cases'][0]['before_rows'][1]['headers_ms']
        with self.assertRaises(InvalidStorageReport): validate_storage_report(report)
        report = fixture(); report['dispatch_basis'] = 'actual_http'
        with self.assertRaises(InvalidStorageReport): validate_storage_report(report)


if __name__ == '__main__':
    unittest.main()
