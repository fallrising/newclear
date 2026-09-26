"""Exercise multi-app worker drains with an in-memory ERU adapter only."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from app_desired import OWNER, spec_identity
from app_cli_adapter import EruCLIAdapter
from app_executor import UncertainExecution
from worker_drain import build_plan
from worker_drain_executor import WorkerDrainExecutor, execution_plan


WORKERS = {
    'worker-2': 'ckc-disposable-02',
    'worker-3': 'ckc-disposable-03',
    'worker-4': 'ckc-disposable-04',
}


def spec(name='hello-api', node='worker-4', replicas=1, image='a'):
    return {
        'schema_version': 1, 'name': name,
        'image': 'registry.example/' + name + '@sha256:' + image * 64,
        'node': node, 'replicas': replicas, 'entrypoint': 'web',
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
        {'id': appname + '_web_' + str(index + 1), 'nodename': normalized['node'],
         'labels': {'owner': OWNER, 'logical_app': normalized['name'],
                    'spec_sha256': digest}}
        for index in range(normalized['replicas'])
    ]


def make_snapshot(workloads):
    nodes = []
    for node in WORKERS:
        count = sum(row['nodename'] == node for row in workloads)
        nodes.append({
            'name': node, 'available': True, 'bypass': False, 'podname': 'eru',
            'endpoint': 'containerd://worker:' + node,
            'labels': {'owner': OWNER}, 'resource_capacity': '{"cpu":4}',
            'resource_usage': json.dumps({'cpu': count * 0.25, 'memory': count, 'storage': count}),
        })
    hosts = {}
    for node, alias in WORKERS.items():
        ids = [row['id'] for row in workloads if row['nodename'] == node]
        hosts[alias] = {
            'machine_id': 'machine-' + node, 'boot_id': 'boot-' + node,
            'hostname': node, 'tailscale': '100.64.0.' + str(len(hosts) + 2),
            'owner': OWNER, 'core_config': False, 'etcd_data': False, 'docker': '',
            'containers': '\n'.join(ids),
            'tasks': 'TASK PID STATUS\n' + ''.join(item + ' 1 RUNNING\n' for item in ids),
        }
    hosts['ckc-disposable-01'] = {
        'machine_id': 'machine-core', 'boot_id': 'boot-core', 'hostname': 'core',
        'tailscale': '100.64.0.1', 'owner': OWNER, 'core_config': True,
        'etcd_data': True, 'docker': '', 'containers': '', 'tasks': 'TASK PID STATUS\n',
    }
    return {'pods': [{'name': 'eru'}], 'nodes': nodes,
            'workloads': copy.deepcopy(workloads), 'hosts': hosts}


class FakeDrainAPI:
    def __init__(self, initial, *, lost_fence_reply=False, fence_before=False,
                 fail_deploy_app=None, fail_remove_id=None, fail_probe_app=None):
        self.live = copy.deepcopy(initial)
        self.lost_fence_reply = lost_fence_reply
        self.fence_before = fence_before
        self.fail_deploy_app = fail_deploy_app
        self.fail_remove_id = fail_remove_id
        self.fail_probe_app = fail_probe_app
        self.fence_calls = 0
        self.deploy_calls = []
        self.remove_calls = []
        self.probe_calls = []
        self.remove_probe_counts = []
        self.deploy_source_sets = []
        self.remove_replacement_sets = []

    def _refresh_runtime(self):
        rows = self.live['workloads']
        for node, alias in WORKERS.items():
            ids = [row['id'] for row in rows if row['nodename'] == node]
            host = self.live['hosts'][alias]
            host['containers'] = '\n'.join(ids)
            host['tasks'] = 'TASK PID STATUS\n' + ''.join(
                item + ' 1 RUNNING\n' for item in ids)
            node_row = next(row for row in self.live['nodes'] if row['name'] == node)
            node_row['resource_usage'] = json.dumps(
                {'cpu': len(ids) * 0.25, 'memory': len(ids), 'storage': len(ids)})

    def snapshot(self):
        self._refresh_runtime()
        result = copy.deepcopy(self.live)
        result['at'] = 'ignored-observation-time'
        return result

    def preflight(self, snapshot):
        expected = {row['id'] for row in snapshot['workloads']}
        for node, alias in WORKERS.items():
            host_ids = set(snapshot['hosts'][alias]['containers'].splitlines())
            if host_ids != {row['id'] for row in snapshot['workloads']
                            if row['nodename'] == node}:
                return {'health_ok': True, 'consistency_issues': ['runtime mismatch']}
        return {'health_ok': True, 'consistency_issues': []}

    def fence_node(self, node):
        self.fence_calls += 1
        if self.fence_before:
            raise TimeoutError('lost before fence')
        next(row for row in self.live['nodes'] if row['name'] == node)['bypass'] = True
        if self.lost_fence_reply:
            raise TimeoutError('lost after fence')

    def deploy(self, plan):
        self.deploy_calls.append(plan['logical_app'])
        current_target = [row['id'] for row in self.live['workloads']
                          if row['nodename'] == 'worker-4']
        self.deploy_source_sets.append(set(current_target))
        if self.fail_deploy_app == plan['logical_app']:
            raise TimeoutError('create outcome uncertain before visible revision')
        for index in range(plan['spec']['replicas']):
            self.live['workloads'].append({
                'id': plan['appname'] + '_web_' + str(index + 1),
                'nodename': plan['spec']['node'],
                'labels': {'owner': OWNER, 'logical_app': plan['logical_app'],
                           'spec_sha256': plan['spec_sha256']},
            })
        self._refresh_runtime()

    def list_revision(self, appname):
        return copy.deepcopy([row for row in self.live['workloads']
                              if row['id'].startswith(appname + '_')])

    def get_workload(self, workload_id):
        matches = [row for row in self.live['workloads'] if row['id'] == workload_id]
        if len(matches) > 1:
            raise RuntimeError('duplicate exact workload ID')
        return copy.deepcopy(matches[0]) if matches else None

    def remove_exact(self, workload_id):
        self.remove_calls.append(workload_id)
        destination_ids = {row['id'] for row in self.live['workloads']
                           if row['nodename'] != 'worker-4'}
        self.remove_replacement_sets.append(destination_ids)
        self.remove_probe_counts.append(len(self.probe_calls))
        if self.fail_remove_id == workload_id:
            raise TimeoutError('remove outcome uncertain before delete')
        self.live['workloads'] = [row for row in self.live['workloads']
                                  if row['id'] != workload_id]
        self._refresh_runtime()

    def probe(self, row, desired):
        self.probe_calls.append(row['id'])
        if row.get('labels', {}).get('logical_app') == self.fail_probe_app:
            return {'status': 503, 'body_match': False}
        return {'status': 200, 'body_match': True}


class WorkerDrainExecutorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.private = Path(self.temp.name) / 'private/operations'
        self.root = self.private / 'worker-drain'
        self.app_root = self.private / 'apps'
        self.hello = spec()
        self.metrics = spec('metrics-api', replicas=2, image='b')
        self.apps = [self.hello, self.metrics]
        self.sources = rows_for(self.hello) + rows_for(self.metrics)
        self.initial = make_snapshot(self.sources)
        self.destinations = {'hello-api': 'worker-2', 'metrics-api': 'worker-3'}
        self.review = build_plan('worker-4', self.initial, self.apps, self.destinations,
                                 True, (), '20260926T120000Z-drainrun')

    def prepared(self, api):
        return execution_plan(self.review, self.apps, api)

    def test_multi_app_keeps_every_source_until_all_alternatives_are_ready(self):
        api = FakeDrainAPI(self.initial)
        plan = self.prepared(api)
        result = WorkerDrainExecutor(self.root, api, self.app_root).execute(
            plan, plan['plan_sha256'], self.apps)

        self.assertEqual(result['status'], 'complete')
        self.assertTrue(result['component_reinstall_allowed'])
        self.assertEqual(result['empty_target_audit']['workload_count'], 0)
        self.assertEqual(api.fence_calls, 1)
        self.assertEqual(len(api.deploy_calls), 2)
        self.assertTrue(all(set(row['id'] for row in self.sources) <= source_ids
                            for source_ids in api.deploy_source_sets))
        self.assertTrue(all(len(ids) == 3 for ids in api.remove_replacement_sets))
        self.assertGreaterEqual(api.remove_probe_counts[0], 6)
        self.assertEqual(set(api.remove_calls), {row['id'] for row in self.sources})
        self.assertEqual(len(api.live['workloads']), 3)
        self.assertTrue(all(row['nodename'] != 'worker-4' for row in api.live['workloads']))
        target = next(row for row in api.live['nodes'] if row['name'] == 'worker-4')
        self.assertTrue(target['bypass'])

    def test_uncertain_second_replacement_keeps_all_sources_and_skips_cleanup(self):
        api = FakeDrainAPI(self.initial, fail_deploy_app='metrics-api')
        plan = self.prepared(api)
        executor = WorkerDrainExecutor(self.root, api, self.app_root)
        with self.assertRaises(UncertainExecution):
            executor.execute(plan, plan['plan_sha256'], self.apps)
        saved = json.loads(executor.run_path(plan['id']).read_text())
        self.assertEqual(saved['status'], 'uncertain')
        self.assertEqual(set(row['id'] for row in api.live['workloads']
                             if row['nodename'] == 'worker-4'),
                         {row['id'] for row in self.sources})
        self.assertEqual(api.remove_calls, [])
        self.assertTrue(next(row for row in api.live['nodes']
                             if row['name'] == 'worker-4')['bypass'])

    def test_failed_http_readiness_keeps_every_source_and_skips_cleanup(self):
        api = FakeDrainAPI(self.initial, fail_probe_app='metrics-api')
        plan = self.prepared(api)
        executor = WorkerDrainExecutor(self.root, api, self.app_root)
        with self.assertRaisesRegex(RuntimeError, 'HTTP readiness failed'):
            executor.execute(plan, plan['plan_sha256'], self.apps)
        self.assertEqual(api.remove_calls, [])
        self.assertEqual({row['id'] for row in api.live['workloads']
                          if row['nodename'] == 'worker-4'},
                         {row['id'] for row in self.sources})

    def test_lost_fence_reply_is_read_only_reconciled_once(self):
        api = FakeDrainAPI(self.initial, lost_fence_reply=True)
        plan = self.prepared(api)
        result = WorkerDrainExecutor(self.root, api, self.app_root).execute(
            plan, plan['plan_sha256'], self.apps)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(api.fence_calls, 1)
        self.assertTrue(result['fence_observation']['reply_lost'])

    def test_unconfirmed_fence_stops_before_any_app_mutation(self):
        api = FakeDrainAPI(self.initial, fence_before=True)
        plan = self.prepared(api)
        executor = WorkerDrainExecutor(self.root, api, self.app_root)
        with self.assertRaises(UncertainExecution):
            executor.execute(plan, plan['plan_sha256'], self.apps)
        self.assertEqual(api.fence_calls, 1)
        self.assertEqual(api.deploy_calls, [])
        self.assertEqual(api.remove_calls, [])

    def test_partial_cleanup_recovery_only_reads_and_never_retries(self):
        second_source_id = next(row['id'] for row in self.sources
                                if row['labels']['logical_app'] == 'metrics-api')
        api = FakeDrainAPI(self.initial, fail_remove_id=second_source_id)
        plan = self.prepared(api)
        executor = WorkerDrainExecutor(self.root, api, self.app_root)
        with self.assertRaises(UncertainExecution):
            executor.execute(plan, plan['plan_sha256'], self.apps)
        before = (api.fence_calls, list(api.deploy_calls), list(api.remove_calls),
                  list(api.probe_calls))

        reconciled = executor.recover(plan['id'])
        after = (api.fence_calls, list(api.deploy_calls), list(api.remove_calls),
                 list(api.probe_calls))
        self.assertEqual(before, after)
        self.assertTrue(reconciled['reconciliation']['read_only'])
        self.assertFalse(reconciled['reconciliation']['remove_replayed'])
        self.assertEqual(reconciled['status'], 'needs_review')
        self.assertEqual(reconciled['reconciliation']['recovery_recommendation'],
                         'replacement_presence_observed_revalidate_before_any_fresh_exact_cleanup_plan')
        self.assertFalse(reconciled['reconciliation']['component_reinstall_allowed'])

    def test_stale_live_snapshot_rejects_execution_before_fence(self):
        api = FakeDrainAPI(self.initial)
        plan = self.prepared(api)
        api.live['workloads'].append({
            'id': 'foreign-workload', 'nodename': 'worker-3', 'labels': {},
        })
        api._refresh_runtime()
        executor = WorkerDrainExecutor(self.root, api, self.app_root)
        with self.assertRaisesRegex(ValueError, 'preflight|snapshot changed|workload identities'):
            executor.execute(plan, plan['plan_sha256'], self.apps)
        self.assertEqual(api.fence_calls, 0)
        self.assertEqual(api.deploy_calls, [])
        self.assertEqual(api.remove_calls, [])

    def test_journaled_plan_cannot_be_replayed(self):
        api = FakeDrainAPI(self.initial)
        plan = self.prepared(api)
        executor = WorkerDrainExecutor(self.root, api, self.app_root)
        executor.execute(plan, plan['plan_sha256'], self.apps)
        with self.assertRaisesRegex(ValueError, 'do not replay'):
            executor.execute(plan, plan['plan_sha256'], self.apps)
        self.assertEqual(api.fence_calls, 1)
        self.assertEqual(len(api.deploy_calls), 2)

    def test_live_adapter_fence_is_one_exact_core_command(self):
        class Operator:
            core = {'role': 'core', 'alias': 'ckc-disposable-01', 'ip': '100.64.0.1'}

            def __init__(self):
                self.commands = []

            def command(self, host, argv, **kwargs):
                self.commands.append((host, argv, kwargs))

        operator = Operator()
        EruCLIAdapter(operator).fence_node('worker-4')
        self.assertEqual(len(operator.commands), 1)
        host, argv, kwargs = operator.commands[0]
        self.assertEqual(host, 'ckc-disposable-01')
        self.assertEqual(argv[-2:], ['down', 'worker-4'])
        self.assertIn('node', argv)
        self.assertEqual(kwargs['timeout'], 90)


if __name__ == '__main__':
    unittest.main()
