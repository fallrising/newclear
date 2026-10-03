"""ERU-010 fresh partial cleanup and replacement recovery tests."""
import contextlib
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from app_desired import OWNER, spec_identity
import labctl
from worker_loss_executor import UncertainDissociation, _record_digest, plan_digest
from worker_loss_ops import (
    execute_fresh_cleanup,
    execute_replacement_plan,
    execute_saved_plan,
    prepare_execution_plan,
    prepare_fresh_cleanup,
    prepare_replacement_plan,
    recover_run,
    recover_replacement_run,
    save_review_plan,
)
from test_worker_loss_executor import FakeLossAPI, review_input, spec


class RecoveryAPI(FakeLossAPI):
    def __init__(self, state, **kwargs):
        super().__init__(state, **kwargs)
        self.deploy_calls = []
        self.probe_calls = []
        self.readiness_failure = None
        self.deploy_reply_loss_for = None
        self.query_failure = None
        self.snapshot_drift = None
        self.invalid_quota = False

    def snapshot(self):
        result = super().snapshot()
        if self.snapshot_drift == self.snapshot_calls:
            result['nodes'][0]['labels']['drift'] = str(self.snapshot_calls)
        if self.invalid_quota:
            next(row for row in result['nodes']
                 if row['name'] == 'worker-4')['resource_usage'] = 'not-json'
        return result

    def get_workload(self, workload_id):
        if workload_id == self.query_failure:
            raise RuntimeError('exact query unavailable')
        return super().get_workload(workload_id)

    def deploy(self, plan):
        normalized, digest, appname = spec_identity(plan['spec'])
        self.deploy_calls.append(plan['id'])
        for index in range(normalized['replicas']):
            self.live['workloads'].append({
                'id': appname + '_replacement_' + str(index + 1),
                'nodename': normalized['node'],
                'labels': {'owner': OWNER, 'logical_app': normalized['name'],
                           'spec_sha256': digest},
            })
        if normalized['name'] == self.deploy_reply_loss_for:
            raise TimeoutError('deploy reply lost after exact revision creation')

    def list_revision(self, appname):
        return [copy.deepcopy(row) for row in self.live['workloads']
                if row.get('id', '').startswith(appname + '_')]

    def probe(self, row, desired):
        self.probe_calls.append(row['id'])
        failed = desired['name'] == self.readiness_failure
        return {'status': 503 if failed else desired['service']['expected_status'],
                'body_match': not failed}


class WorkerLossRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        (self.project / 'private').mkdir()
        self.apps = [spec(), spec('metrics-api')]
        self.document = review_input(self.apps)
        self.input_path = self.project / 'private/loss.json'
        self.input_path.write_text(json.dumps(self.document))
        self.review, _ = save_review_plan(
            self.project, 'worker-4', self.input_path,
            '20260927T150000Z-loss-recovery')
        self.review_sequence = 0

    def prepared(self, api):
        self.review_sequence += 1
        review = self.review
        if self.review_sequence > 1:
            review, _ = save_review_plan(
                self.project, 'worker-4', self.input_path,
                '20260927T150000Z-loss-recovery-' + str(self.review_sequence))
        return prepare_execution_plan(
            self.project, review['id'], review['plan_sha256'],
            self.input_path, api)[0]

    def partial(self):
        api = RecoveryAPI(self.document['snapshot'])
        prepared = self.prepared(api)
        remaining = self.document['snapshot']['workloads'][1]['id']
        api.fail_before = remaining
        with self.assertRaises(UncertainDissociation):
            execute_saved_plan(
                self.project, prepared['id'], prepared['plan_sha256'], lambda: api)
        return api, prepared, remaining

    def complete_partial_cleanup(self):
        api, prepared, remaining = self.partial()
        fresh, _ = prepare_fresh_cleanup(
            self.project, prepared['id'], lambda: api,
            plan_id='20260927T150100Z-loss-fresh')
        api.fail_before = None
        result = execute_fresh_cleanup(
            self.project, fresh['id'], fresh['plan_sha256'], lambda: api)
        self.assertEqual(result['status'], 'complete')
        return api, prepared, fresh, remaining

    def invoke(self, api, argv):
        output = io.StringIO()
        errors = io.StringIO()
        with (patch.object(labctl, 'PROJECT', self.project),
              patch.object(labctl, 'Operator', return_value=object()),
              patch('worker_loss_adapter.WorkerLossCLIAdapter', return_value=api),
              patch.object(sys, 'argv', ['labctl.py', *argv]),
              contextlib.redirect_stdout(output),
              contextlib.redirect_stderr(errors)):
            labctl.main()
        return output.getvalue() + errors.getvalue(), json.loads(output.getvalue())

    def test_partial_recovery_creates_fresh_bound_subset_and_new_journal(self):
        api, prepared, remaining = self.partial()
        source_path = (self.project / 'private/operations/worker-loss/runs' /
                       (prepared['id'] + '.json'))
        source = json.loads(source_path.read_text())
        for field in ('review_plan_id', 'origin_run_id', 'fence'):
            source.pop(field, None)
        source_path.write_text(json.dumps(source))
        fresh, path = prepare_fresh_cleanup(
            self.project, prepared['id'], lambda: api,
            plan_id='20260927T150100Z-loss-fresh')

        self.assertEqual(path.parent.name, 'recovery-cleanup-plans')
        self.assertNotEqual(fresh['id'], prepared['id'])
        self.assertEqual([row['id'] for row in fresh['targets']], [remaining])
        self.assertEqual(fresh['source']['run_id'], prepared['id'])
        self.assertEqual(fresh['source']['plan_sha256'], prepared['plan_sha256'])
        self.assertRegex(fresh['source']['journal_sha256'], r'^[0-9a-f]{64}$')
        self.assertEqual(len(fresh['recovery']['stable_snapshot_sha256']), 2)
        self.assertEqual(len(set(fresh['recovery']['stable_snapshot_sha256'])), 1)
        self.assertEqual(fresh['baseline']['workloads'],
                         fresh['recovery']['workload_identities'])
        self.assertTrue(fresh['fence']['confirmed'])
        self.assertTrue(fresh['baseline']['target_resource_usage_nonzero'])
        with self.assertRaises(FileExistsError):
            prepare_fresh_cleanup(
                self.project, prepared['id'], lambda: api,
                plan_id=fresh['id'])

        api.fail_before = None
        api.fail_after = remaining
        result = execute_fresh_cleanup(
            self.project, fresh['id'], fresh['plan_sha256'], lambda: api)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['origin_run_id'], prepared['id'])
        self.assertEqual(api.dissociate_calls.count(remaining), 2)
        with self.assertRaisesRegex(ValueError, 'already has a journal'):
            execute_fresh_cleanup(
                self.project, fresh['id'], fresh['plan_sha256'], lambda: api)

    def test_fresh_cleanup_lost_reply_with_present_target_is_never_replayed(self):
        api, prepared, remaining = self.partial()
        fresh, _ = prepare_fresh_cleanup(
            self.project, prepared['id'], lambda: api,
            plan_id='20260927T150150Z-loss-fresh')
        before = api.dissociate_calls.count(remaining)
        with self.assertRaises(UncertainDissociation):
            execute_fresh_cleanup(
                self.project, fresh['id'], fresh['plan_sha256'], lambda: api)
        self.assertEqual(api.dissociate_calls.count(remaining), before + 1)
        with self.assertRaisesRegex(ValueError, 'already has a journal'):
            execute_fresh_cleanup(
                self.project, fresh['id'], fresh['plan_sha256'], lambda: api)
        calls = list(api.dissociate_calls)
        observation = recover_run(
            self.project, fresh['id'], lambda: api)['reconciliation']
        self.assertTrue(observation['read_only'])
        self.assertFalse(observation['dissociate_replayed'])
        self.assertEqual(api.dissociate_calls, calls)

    def test_fresh_cleanup_fails_closed_on_queries_identity_snapshots_fence_quota_and_health(self):
        mutations = {
            'query': lambda api, remaining: setattr(api, 'query_failure', remaining),
            'identity': lambda api, remaining: api.live['workloads'][0]['labels'].__setitem__(
                'owner', 'foreign'),
            'snapshot': lambda api, remaining: setattr(
                api, 'snapshot_drift', api.snapshot_calls + 2),
            'fence': lambda api, remaining: api.live['nodes'][2].__setitem__('bypass', False),
            'quota': lambda api, remaining: setattr(api, 'invalid_quota', True),
            'health': lambda api, remaining: setattr(
                api, 'preflight_result',
                {'health_ok': True, 'consistency_issues': ['healthy worker drift']}),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                api, prepared, remaining = self.partial()
                api.fail_before = None
                mutate(api, remaining)
                before = list(api.dissociate_calls)
                with self.assertRaises((RuntimeError, ValueError)):
                    prepare_fresh_cleanup(
                        self.project, prepared['id'], lambda: api,
                        plan_id='fresh-' + name)
                self.assertEqual(api.dissociate_calls, before)

    def test_rehashed_fresh_payload_tampering_cannot_bypass_source_binding(self):
        api, prepared, remaining = self.partial()
        fresh, path = prepare_fresh_cleanup(
            self.project, prepared['id'], lambda: api,
            plan_id='20260927T150200Z-loss-tamper')
        tampered = copy.deepcopy(fresh)
        tampered['source']['journal_sha256'] = '0' * 64
        tampered['plan_sha256'] = plan_digest(tampered)
        path.write_text(json.dumps(tampered))
        api.fail_before = None
        before = list(api.dissociate_calls)
        with self.assertRaises(ValueError):
            execute_fresh_cleanup(
                self.project, tampered['id'], tampered['plan_sha256'], lambda: api)
        self.assertEqual(api.dissociate_calls, before)

        subset, subset_path = prepare_fresh_cleanup(
            self.project, prepared['id'], lambda: api,
            plan_id='20260927T150201Z-loss-tamper')
        unauthorized = next(
            row for row in prepared['targets'] if row['id'] != remaining)
        subset['targets'].append(copy.deepcopy(unauthorized))
        subset['targets'].sort(key=lambda row: row['id'])
        subset['recovery']['remaining_exact_ids'] = sorted(
            row['id'] for row in subset['targets'])
        next(row for row in subset['recovery']['target_states']
             if row['workload_id'] == unauthorized['id'])['state'] = 'present_exact'
        subset['plan_sha256'] = plan_digest(subset)
        subset_path.write_text(json.dumps(subset))
        with self.assertRaises(ValueError):
            execute_fresh_cleanup(
                self.project, subset['id'], subset['plan_sha256'], lambda: api)
        self.assertEqual(api.dissociate_calls, before)

        source_plan_path = (
            self.project / 'private/operations/worker-loss/execution-plans' /
            (prepared['id'] + '.json'))
        source_journal_path = (
            self.project / 'private/operations/worker-loss/runs' /
            (prepared['id'] + '.json'))
        source_plan = json.loads(source_plan_path.read_text())
        source_journal = json.loads(source_journal_path.read_text())
        unauthorized = copy.deepcopy(prepared['targets'][0])
        unauthorized['id'] = unauthorized['appname'] + '_unauthorized'
        unauthorized_row = {
            'id': unauthorized['id'], 'nodename': unauthorized['node'],
            'labels': {'owner': OWNER,
                       'logical_app': unauthorized['logical_app'],
                       'spec_sha256': unauthorized['spec_sha256']},
        }
        api.live['workloads'].append(copy.deepcopy(unauthorized_row))
        source_plan['targets'].append(unauthorized)
        source_plan['targets'].sort(key=lambda row: row['id'])
        source_plan['baseline']['workloads'].append(unauthorized_row)
        source_plan['baseline']['workloads'].sort(key=lambda row: row['id'])
        source_plan['baseline']['snapshot']['workloads'] = copy.deepcopy(
            source_plan['baseline']['workloads'])
        source_plan['baseline']['snapshot_sha256'] = _record_digest(
            source_plan['baseline']['snapshot'])
        source_plan['plan_sha256'] = plan_digest(source_plan)
        source_journal['targets'] = copy.deepcopy(source_plan['targets'])
        source_journal['baseline'] = copy.deepcopy(source_plan['baseline'])
        source_journal['plan_sha256'] = source_plan['plan_sha256']
        source_plan_path.write_text(json.dumps(source_plan))
        source_journal_path.write_text(json.dumps(source_journal))
        with self.assertRaises(ValueError):
            prepare_fresh_cleanup(
                self.project, prepared['id'], lambda: api,
                plan_id='20260927T150202Z-loss-tamper')
        self.assertEqual(api.dissociate_calls, before)

    def test_replacement_gate_revalidates_private_specs_and_deploys_all_ready(self):
        api = RecoveryAPI(self.document['snapshot'])
        prepared = self.prepared(api)
        cleanup = execute_saved_plan(
            self.project, prepared['id'], prepared['plan_sha256'], lambda: api)
        self.assertTrue(cleanup['replacement_plan_allowed'])
        source_path = (self.project / 'private/operations/worker-loss/runs' /
                       (prepared['id'] + '.json'))
        source = json.loads(source_path.read_text())
        for field in ('review_plan_id', 'origin_run_id', 'fence'):
            source.pop(field, None)
        source_path.write_text(json.dumps(source))
        api.deploy_reply_loss_for = self.apps[0]['name']
        replacement, path = prepare_replacement_plan(
            self.project, prepared['id'], self.input_path, lambda: api,
            plan_id='20260927T150300Z-loss-replace')

        self.assertEqual(path.parent.name, 'replacement-plans')
        self.assertTrue(replacement['executable'])
        self.assertEqual(replacement['source']['cleanup_run_id'], prepared['id'])
        self.assertFalse(replacement['baseline']['target_resource_usage_nonzero'])
        self.assertEqual(len(replacement['moves']), 2)
        self.assertEqual(api.deploy_calls, [])
        for move in replacement['moves']:
            self.assertEqual(move['spec']['node'], move['replacement']['node'])
            self.assertEqual(move['spec_sha256'], move['replacement']['spec_sha256'])
            self.assertEqual(move['spec']['replicas'], move['replacement']['replicas'])

        result = execute_replacement_plan(
            self.project, replacement['id'], replacement['plan_sha256'],
            self.input_path, lambda: api)
        self.assertEqual(result['status'], 'complete')
        self.assertTrue(result['all_replacements_ready'])
        self.assertEqual(len(api.deploy_calls), 2)
        self.assertEqual(len(result['moves']), 2)
        self.assertTrue(all(move['replacement_state'] == 'ready'
                            for move in result['moves']))
        with self.assertRaisesRegex(ValueError, 'journal already exists'):
            execute_replacement_plan(
                self.project, replacement['id'], replacement['plan_sha256'],
                self.input_path, lambda: api)

    def test_replacement_is_blocked_until_all_stale_ids_absent_and_quota_zero(self):
        api, prepared, _ = self.partial()
        api.fail_before = None
        with self.assertRaises(ValueError):
            prepare_replacement_plan(
                self.project, prepared['id'], self.input_path, lambda: api,
                plan_id='blocked-present')

        api = RecoveryAPI(self.document['snapshot'], stale_quota=True)
        prepared = self.prepared(api)
        with self.assertRaises(RuntimeError):
            execute_saved_plan(
                self.project, prepared['id'], prepared['plan_sha256'], lambda: api)
        with self.assertRaises(ValueError):
            prepare_replacement_plan(
                self.project, prepared['id'], self.input_path, lambda: api,
                plan_id='blocked-quota')
        self.assertEqual(api.deploy_calls, [])

    def test_replacement_spec_drift_http_failure_and_duplicate_run_fail_closed(self):
        api, _, fresh, _ = self.complete_partial_cleanup()
        replacement, _ = prepare_replacement_plan(
            self.project, fresh['id'], self.input_path, lambda: api,
            plan_id='20260927T150400Z-loss-replace')

        drifted = copy.deepcopy(self.document)
        drifted['apps'][0]['replicas'] = 2
        drifted_path = self.project / 'private/loss-drifted.json'
        drifted_path.write_text(json.dumps(drifted))
        with self.assertRaises(ValueError):
            execute_replacement_plan(
                self.project, replacement['id'], replacement['plan_sha256'],
                drifted_path, lambda: api)
        self.assertEqual(api.deploy_calls, [])

        api.readiness_failure = self.apps[0]['name']
        with self.assertRaises(RuntimeError):
            execute_replacement_plan(
                self.project, replacement['id'], replacement['plan_sha256'],
                self.input_path, lambda: api)
        with self.assertRaisesRegex(ValueError, 'journal already exists'):
            execute_replacement_plan(
                self.project, replacement['id'], replacement['plan_sha256'],
                self.input_path, lambda: api)
        calls = list(api.deploy_calls)
        recovered = recover_replacement_run(
            self.project, replacement['id'], lambda: api)
        self.assertTrue(recovered['reconciliation']['read_only'])
        self.assertFalse(recovered['reconciliation']['deploy_replayed'])
        self.assertEqual(api.deploy_calls, calls)

    def test_rehashed_replacement_source_tampering_fails_before_deploy(self):
        api, _, fresh, _ = self.complete_partial_cleanup()
        replacement, path = prepare_replacement_plan(
            self.project, fresh['id'], self.input_path, lambda: api,
            plan_id='20260927T150450Z-loss-replace')
        source_path = (self.project / 'private/operations/worker-loss/runs' /
                       (fresh['id'] + '.json'))
        source = json.loads(source_path.read_text())
        source['target']['available'] = True
        source_path.write_text(json.dumps(source))
        replacement['source']['cleanup_journal_sha256'] = _record_digest(source)
        replacement['plan_sha256'] = plan_digest(replacement)
        path.write_text(json.dumps(replacement))

        with self.assertRaises(ValueError):
            execute_replacement_plan(
                self.project, replacement['id'], replacement['plan_sha256'],
                self.input_path, lambda: api)
        self.assertEqual(api.deploy_calls, [])

    def test_replacement_private_path_symlink_duplicate_plan_and_cli_redaction(self):
        api, _, fresh, remaining = self.complete_partial_cleanup()
        outside = self.project.parent / 'loss-replacement-outside.json'
        outside.write_text(json.dumps(self.document))
        self.addCleanup(lambda: outside.unlink(missing_ok=True))
        linked = self.project / 'private/loss-link.json'
        linked.symlink_to(outside)
        for path in (outside, linked):
            with self.assertRaises(ValueError):
                prepare_replacement_plan(
                    self.project, fresh['id'], path, lambda: api,
                    plan_id='bad-private-path')

        outside_records = self.project.parent / (self.project.name + '-records')
        outside_records.mkdir()
        self.addCleanup(lambda: outside_records.rmdir())
        record_dir = (self.project /
                      'private/operations/worker-loss/replacement-plans')
        record_dir.symlink_to(outside_records, target_is_directory=True)
        with self.assertRaises(ValueError):
            prepare_replacement_plan(
                self.project, fresh['id'], self.input_path, lambda: api,
                plan_id='bad-record-symlink')
        record_dir.unlink()

        source_runs = (self.project /
                       'private/operations/worker-loss/runs')
        outside_source_runs = (self.project.parent /
                               (self.project.name + '-source-runs'))
        source_runs.rename(outside_source_runs)
        source_runs.symlink_to(outside_source_runs, target_is_directory=True)
        try:
            with self.assertRaises(ValueError):
                prepare_replacement_plan(
                    self.project, fresh['id'], self.input_path, lambda: api,
                    plan_id='bad-source-symlink')
        finally:
            source_runs.unlink()
            outside_source_runs.rename(source_runs)

        replacement, _ = prepare_replacement_plan(
            self.project, fresh['id'], self.input_path, lambda: api,
            plan_id='20260927T150500Z-loss-replace')
        with self.assertRaises(FileExistsError):
            prepare_replacement_plan(
                self.project, fresh['id'], self.input_path, lambda: api,
                plan_id=replacement['id'])

        raw, public = self.invoke(api, [
            'plan-worker-loss-replacement', '--run', fresh['id'],
            '--input', str(self.input_path), '--plan-id',
            '20260927T150600Z-loss-cli'])
        self.assertTrue(public['executable'])
        self.assertEqual(public['replacement_count'], 2)
        for row in self.document['snapshot']['workloads']:
            self.assertNotIn(row['id'], raw)
        self.assertNotIn(remaining, raw)

    def test_all_new_cli_routes_redact_exact_ids_and_private_specs(self):
        api, prepared, _ = self.partial()
        outputs = []
        raw, cleanup = self.invoke(api, [
            'plan-worker-loss-recovery-cleanup', '--run', prepared['id'],
            '--plan-id', '20260927T150700Z-loss-cli-cleanup'])
        outputs.append(raw)
        api.fail_before = None
        raw, completed = self.invoke(api, [
            'execute-worker-loss-recovery-cleanup', '--plan', cleanup['id'],
            '--sha256', cleanup['sha256']])
        outputs.append(raw)
        self.assertTrue(completed['replacement_plan_allowed'])

        raw, replacement = self.invoke(api, [
            'plan-worker-loss-replacement', '--run', cleanup['id'],
            '--input', str(self.input_path), '--plan-id',
            '20260927T150701Z-loss-cli-replace'])
        outputs.append(raw)
        raw, executed = self.invoke(api, [
            'execute-worker-loss-replacement', '--plan', replacement['id'],
            '--sha256', replacement['sha256'], '--input', str(self.input_path)])
        outputs.append(raw)
        self.assertTrue(executed['all_replacements_ready'])
        replacement_ids = [row['id'] for row in api.live['workloads']]
        raw, recovered = self.invoke(api, [
            'recover-worker-loss-replacement', '--run', replacement['id']])
        outputs.append(raw)
        self.assertTrue(recovered['read_only'])
        self.assertFalse(recovered['deploy_replayed'])

        combined = '\n'.join(outputs)
        for row in self.document['snapshot']['workloads']:
            self.assertNotIn(row['id'], combined)
        for workload_id in replacement_ids:
            self.assertNotIn(workload_id, combined)
        for document in self.apps:
            self.assertNotIn(document['image'], combined)


if __name__ == '__main__':
    unittest.main()
