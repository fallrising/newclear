"""ERU-010 live preparation, exact dissociation, and read-only recovery tests."""
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
from worker_loss import build_plan as build_review_plan
from worker_loss import plan_digest as review_plan_digest
from worker_loss_adapter import WorkerLossCLIAdapter
from worker_loss_executor import (UncertainDissociation, WorkerLossExecutor,
                                  execution_plan, plan_digest as execution_plan_digest)
from worker_loss_ops import (execute_saved_plan, prepare_execution_plan,
                             recover_run, save_review_plan)


def spec(name='hello-api', replicas=1):
    return {
        'schema_version': 1, 'name': name,
        'image': 'registry.example/' + name + '@sha256:' + 'a' * 64,
        'node': 'worker-4', 'replicas': replicas, 'entrypoint': 'web',
        'command': ['python', '-m', 'http.server', '8080'], 'restart': 'always',
        'resources': {'cpu': 0.25, 'memory': '128M', 'storage': '256M'},
        'network': 'eru',
        'service': {'port': 8080, 'path': '/', 'expected_status': 200,
                    'body_contains': 'ready'},
        'stateless': True,
    }


def rows_for(document):
    normalized, digest, appname = spec_identity(document)
    return [
        {'id': appname + '_web_' + str(index + 1),
         'nodename': normalized['node'],
         'labels': {'owner': OWNER, 'logical_app': normalized['name'],
                    'spec_sha256': digest}}
        for index in range(normalized['replicas'])
    ]


def snapshot(workloads):
    count = sum(row.get('nodename') == 'worker-4' for row in workloads)
    return {
        'pods': [{'name': 'eru'}],
        'nodes': [
            {'name': 'worker-2', 'podname': 'eru', 'endpoint': 'containerd://ckc@192.0.2.2:22',
             'labels': {'owner': OWNER}, 'resource_capacity': '{"cpu":4}',
             'available': True, 'bypass': False, 'resource_usage': '{}'},
            {'name': 'worker-3', 'podname': 'eru', 'endpoint': 'containerd://ckc@192.0.2.3:22',
             'labels': {'owner': OWNER}, 'resource_capacity': '{"cpu":4}',
             'available': True, 'bypass': False, 'resource_usage': '{}'},
            {'name': 'worker-4', 'podname': 'eru', 'endpoint': 'containerd://ckc@192.0.2.4:22',
             'labels': {'owner': OWNER}, 'resource_capacity': '{"cpu":4}',
             'available': False, 'bypass': True,
             'resource_usage': json.dumps({'cpu': count * 0.25})},
        ],
        'workloads': copy.deepcopy(workloads),
    }


def review_input(apps):
    workloads = [row for document in apps for row in rows_for(document)]
    destinations = {document['name']: 'worker-' + str(index + 2)
                    for index, document in enumerate(apps)}
    return {
        'snapshot': snapshot(workloads), 'apps': apps,
        'destinations': destinations,
        'detection': {'failure_started_at': '2026-09-27T12:00:00Z',
                      'detected_at': '2026-09-27T12:02:00Z'},
        'fence': {'confirmed': True, 'method': 'provider_power_off',
                  'confirmed_at': '2026-09-27T12:03:00Z',
                  'proof_sha256': 'f' * 64},
        'control_plane_health_ok': True, 'healthy_workers_ok': True,
        'unexpected_consistency_issues': [],
    }


class FakeLossAPI:
    def __init__(self, state, *, fail_before=None, fail_after=None,
                 stale_quota=False):
        self.live = copy.deepcopy(state)
        self.fail_before = fail_before
        self.fail_after = fail_after
        self.stale_quota = stale_quota
        self.dissociate_calls = []
        self.snapshot_calls = 0
        self.preflight_result = {'health_ok': True, 'consistency_issues': []}

    def _usage(self):
        target = next(row for row in self.live['nodes'] if row['name'] == 'worker-4')
        count = sum(row.get('nodename') == 'worker-4' for row in self.live['workloads'])
        target['resource_usage'] = json.dumps(
            {'cpu': 0.25 if self.stale_quota and count == 0 else count * 0.25})

    def snapshot(self):
        self.snapshot_calls += 1
        self._usage()
        result = copy.deepcopy(self.live)
        result['at'] = 'observation-' + str(self.snapshot_calls)
        return result

    def preflight(self, snapshot_value, target, destinations):
        self.asserted = (target, tuple(sorted(destinations)))
        return copy.deepcopy(self.preflight_result)

    def get_workload(self, workload_id):
        rows = [row for row in self.live['workloads'] if row.get('id') == workload_id]
        if len(rows) > 1:
            raise RuntimeError('duplicate exact ID')
        return copy.deepcopy(rows[0]) if rows else None

    def dissociate_exact(self, workload_id):
        self.dissociate_calls.append(workload_id)
        if workload_id == self.fail_before:
            raise TimeoutError('reply lost before dissociation')
        self.live['workloads'] = [row for row in self.live['workloads']
                                  if row.get('id') != workload_id]
        if workload_id == self.fail_after:
            raise TimeoutError('reply lost after dissociation')


class WorkerLossExecutionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.root = self.project / 'private/operations/worker-loss'
        self.apps = [spec(), spec('metrics-api')]
        self.document = review_input(self.apps)
        self.review = build_review_plan(
            'worker-4', self.document['snapshot'], self.apps,
            self.document['destinations'], self.document['detection'],
            self.document['fence'], True, True, (),
            plan_id='20260927T120300Z-loss-exec')

    def prepared(self, api):
        return execution_plan(self.review, api)

    def test_live_plan_is_stable_hash_bound_and_does_not_mutate(self):
        api = FakeLossAPI(self.document['snapshot'])
        plan = self.prepared(api)
        self.assertEqual(plan['decision'], 'ready')
        self.assertTrue(plan['executable'])
        self.assertEqual(plan['target']['node'], 'worker-4')
        self.assertEqual(len(plan['targets']), 2)
        self.assertEqual(api.dissociate_calls, [])
        self.assertEqual(api.asserted, ('worker-4', ('worker-2', 'worker-3')))

    def test_exact_dissociation_clears_metadata_and_quota_without_fix(self):
        api = FakeLossAPI(self.document['snapshot'])
        plan = self.prepared(api)
        result = WorkerLossExecutor(self.root, api).execute(
            plan, plan['plan_sha256'])
        self.assertEqual(result['status'], 'complete')
        self.assertTrue(result['replacement_plan_allowed'])
        self.assertEqual(set(api.dissociate_calls),
                         {row['id'] for row in self.document['snapshot']['workloads']})
        self.assertEqual(api.live['workloads'], [])
        self.assertNotIn('resource', json.dumps(result.get('events', [])))

    def test_lost_reply_after_dissociation_is_reconciled_without_replay(self):
        target_id = self.document['snapshot']['workloads'][0]['id']
        api = FakeLossAPI(self.document['snapshot'], fail_after=target_id)
        plan = self.prepared(api)
        result = WorkerLossExecutor(self.root, api).execute(plan, plan['plan_sha256'])
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(api.dissociate_calls.count(target_id), 1)
        self.assertIn('dissociate_reply_lost_target_absent',
                      [row['event'] for row in result['events']])

    def test_lost_reply_with_target_present_is_uncertain_and_never_replayed(self):
        target_id = self.document['snapshot']['workloads'][0]['id']
        api = FakeLossAPI(self.document['snapshot'], fail_before=target_id)
        plan = self.prepared(api)
        executor = WorkerLossExecutor(self.root, api)
        with self.assertRaises(UncertainDissociation):
            executor.execute(plan, plan['plan_sha256'])
        with self.assertRaisesRegex(ValueError, 'already has a journal'):
            executor.execute(plan, plan['plan_sha256'])
        before = list(api.dissociate_calls)
        recovered = executor.reconcile(plan['id'])
        self.assertEqual(api.dissociate_calls, before)
        self.assertTrue(recovered['reconciliation']['read_only'])
        self.assertFalse(recovered['reconciliation']['dissociate_replayed'])
        self.assertTrue(recovered['reconciliation']['fresh_cleanup_plan_allowed'])

    def test_partial_dissociation_recovery_reports_exact_remaining_subset(self):
        second_id = self.document['snapshot']['workloads'][1]['id']
        api = FakeLossAPI(self.document['snapshot'], fail_before=second_id)
        plan = self.prepared(api)
        executor = WorkerLossExecutor(self.root, api)
        with self.assertRaises(UncertainDissociation):
            executor.execute(plan, plan['plan_sha256'])
        before = list(api.dissociate_calls)
        recovered = executor.reconcile(plan['id'])
        observation = recovered['reconciliation']
        self.assertEqual(api.dissociate_calls, before)
        self.assertEqual(observation['remaining_exact_ids'], [second_id])
        self.assertTrue(observation['fresh_cleanup_plan_allowed'])
        self.assertFalse(observation['replacement_plan_allowed'])

    def test_stale_quota_blocks_replacement_after_all_metadata_is_absent(self):
        api = FakeLossAPI(self.document['snapshot'], stale_quota=True)
        plan = self.prepared(api)
        executor = WorkerLossExecutor(self.root, api)
        with self.assertRaisesRegex(RuntimeError, 'quota'):
            executor.execute(plan, plan['plan_sha256'])
        recovered = executor.reconcile(plan['id'])
        self.assertFalse(recovered['reconciliation']['replacement_plan_allowed'])
        self.assertFalse(recovered['reconciliation']['fresh_cleanup_plan_allowed'])
        self.assertEqual(api.live['workloads'], [])

    def test_live_drift_or_exact_identity_change_blocks_before_mutation(self):
        api = FakeLossAPI(self.document['snapshot'])
        plan = self.prepared(api)
        api.live['nodes'][2]['bypass'] = False
        with self.assertRaises(ValueError):
            WorkerLossExecutor(self.root, api).execute(plan, plan['plan_sha256'])
        self.assertEqual(api.dissociate_calls, [])

        api = FakeLossAPI(self.document['snapshot'])
        plan = self.prepared(api)
        api.live['workloads'][0]['labels']['owner'] = 'foreign'
        with self.assertRaises(ValueError):
            WorkerLossExecutor(self.root, api).execute(plan, plan['plan_sha256'])
        self.assertEqual(api.dissociate_calls, [])

    def test_rehashed_tampering_is_rejected_before_live_read_or_mutation(self):
        bad_review = copy.deepcopy(self.review)
        original_id = bad_review['moves'][0]['source']['workload_ids'][0]
        bad_review['moves'][0]['source']['workload_ids'][0] = 'malformed;workload'
        stale_ids = bad_review['target_stale_state']['workload_ids']
        stale_ids[stale_ids.index(original_id)] = 'malformed;workload'
        bad_review['plan_sha256'] = review_plan_digest(bad_review)
        api = FakeLossAPI(self.document['snapshot'])
        with self.assertRaises(ValueError):
            execution_plan(bad_review, api)
        self.assertEqual(api.snapshot_calls, 0)

        api = FakeLossAPI(self.document['snapshot'])
        plan = self.prepared(api)
        plan['targets'][0]['appname'] = 'foreign-app'
        plan['plan_sha256'] = execution_plan_digest(plan)
        before = list(api.dissociate_calls)
        with self.assertRaises(ValueError):
            WorkerLossExecutor(self.root, api).execute(plan, plan['plan_sha256'])
        self.assertEqual(api.dissociate_calls, before)

class FakeOperator:
    def __init__(self, state):
        self.inventory = [
            {'role': 'core', 'alias': 'ckc-disposable-01', 'ip': '192.0.2.1'},
            {'role': 'worker', 'alias': 'ckc-disposable-02', 'ip': '192.0.2.2',
             'node': 'worker-2'},
            {'role': 'worker', 'alias': 'ckc-disposable-03', 'ip': '192.0.2.3',
             'node': 'worker-3'},
            {'role': 'worker', 'alias': 'ckc-disposable-04', 'ip': '192.0.2.4',
             'node': 'worker-4'},
        ]
        self.core = self.inventory[0]
        self.state = copy.deepcopy(state)
        self.commands = []
        self.events = []

    def cli(self, *argv):
        if argv == ('pod', 'list'):
            return copy.deepcopy(self.state['pods'])
        if argv == ('pod', 'nodes', 'eru'):
            return copy.deepcopy(self.state['nodes'])
        if argv == ('workload', 'list'):
            return copy.deepcopy(self.state['workloads'])
        if argv[:2] == ('workload', 'list'):
            return [copy.deepcopy(row) for row in self.state['workloads']
                    if row['id'].startswith(argv[2] + '_')]
        raise AssertionError(argv)

    def health(self):
        return {'exit_code': 0, 'stdout': 'healthy', 'stderr': ''}

    def command(self, host, argv, stdin=None, check=True, timeout=90):
        self.commands.append({'host': host, 'argv': list(argv), 'stdin': stdin,
                              'timeout': timeout})
        if argv[-2:] == ['is-active', 'eru-core.service']:
            output = 'active\n'
        elif stdin and 'containers' in stdin and 'tasks' in stdin:
            node = next(row['node'] for row in self.inventory if row['alias'] == host)
            ids = [row['id'] for row in self.state['workloads'] if row['nodename'] == node]
            output = json.dumps({'containers': ids, 'tasks': ids})
        elif 'dissociate' in argv:
            workload_id = argv[-1]
            self.state['workloads'] = [row for row in self.state['workloads']
                                       if row['id'] != workload_id]
            output = ''
        else:
            output = ''
        self.events.append({'exit_code': 0, 'stdout': output, 'stderr': ''})
        return output


class WorkerLossAdapterAndOpsTests(unittest.TestCase):
    def test_adapter_never_ssh_connects_to_lost_target_and_dissociates_exact_id(self):
        document = review_input([spec()])
        operator = FakeOperator(document['snapshot'])
        adapter = WorkerLossCLIAdapter(operator)
        state = adapter.snapshot()
        result = adapter.preflight(state, 'worker-4', {'worker-2'})
        self.assertTrue(result['health_ok'])
        self.assertEqual(result['consistency_issues'], [])
        self.assertNotIn('ckc-disposable-04',
                         [command['host'] for command in operator.commands])
        workload_id = state['workloads'][0]['id']
        adapter.dissociate_exact(workload_id)
        command = operator.commands[-1]
        self.assertEqual(command['host'], 'ckc-disposable-01')
        self.assertEqual(command['argv'][-3:], ['workload', 'dissociate', workload_id])
        before = len(operator.commands)
        with self.assertRaisesRegex(ValueError, 'workload ID'):
            adapter.dissociate_exact(workload_id + ';invalid')
        self.assertEqual(len(operator.commands), before)

    def test_private_ops_save_prepare_execute_and_recover_without_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            private = project / 'private'; private.mkdir()
            document = review_input([spec()])
            input_path = private / 'loss.json'
            input_path.write_text(json.dumps(document))
            review, _ = save_review_plan(
                project, 'worker-4', input_path, '20260927T130000Z-lossops')
            api = FakeLossAPI(document['snapshot'])
            prepared, path = prepare_execution_plan(
                project, review['id'], review['plan_sha256'], input_path, api)
            self.assertEqual(path.parent.name, 'execution-plans')
            result = execute_saved_plan(
                project, prepared['id'], prepared['plan_sha256'], lambda: api)
            self.assertEqual(result['status'], 'complete')
            before = list(api.dissociate_calls)
            recovered = recover_run(project, prepared['id'], lambda: api)
            self.assertEqual(api.dissociate_calls, before)
            self.assertTrue(recovered['reconciliation']['replacement_plan_allowed'])

    def test_labctl_prepare_execute_and_recover_outputs_mask_exact_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            private = project / 'private'; private.mkdir()
            document = review_input([spec()])
            input_path = private / 'loss.json'
            input_path.write_text(json.dumps(document))
            review, _ = save_review_plan(
                project, 'worker-4', input_path, '20260927T131000Z-losscli2')
            api = FakeLossAPI(document['snapshot'])

            def invoke(argv):
                output = io.StringIO()
                with (patch.object(labctl, 'PROJECT', project),
                      patch.object(labctl, 'Operator', return_value=object()),
                      patch('worker_loss_adapter.WorkerLossCLIAdapter',
                            return_value=api),
                      patch.object(sys, 'argv', ['labctl.py', *argv]),
                      contextlib.redirect_stdout(output)):
                    labctl.main()
                return output.getvalue(), json.loads(output.getvalue())

            raw, prepared = invoke([
                'prepare-worker-loss', '--plan', review['id'],
                '--sha256', review['plan_sha256'], '--input', str(input_path)])
            self.assertTrue(prepared['executable'])
            self.assertNotIn(document['snapshot']['workloads'][0]['id'], raw)
            raw, executed = invoke([
                'execute-worker-loss-cleanup', '--plan', prepared['id'],
                '--sha256', prepared['sha256']])
            self.assertEqual(executed['status'], 'complete')
            self.assertNotIn(document['snapshot']['workloads'][0]['id'], raw)
            before = list(api.dissociate_calls)
            raw, recovered = invoke(['recover-worker-loss', '--run', prepared['id']])
            self.assertTrue(recovered['read_only'])
            self.assertTrue(recovered['replacement_plan_allowed'])
            self.assertEqual(api.dissociate_calls, before)
            self.assertNotIn(document['snapshot']['workloads'][0]['id'], raw)


if __name__ == '__main__':
    unittest.main()
