"""Offline contract tests for the Eru CLI/SSH adapter."""
import copy
import json
from pathlib import Path
import sys
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from app_cli_adapter import EruCLIAdapter
from app_desired import OWNER, spec_identity


def spec(node='worker-2'):
    return {
        'schema_version': 1,
        'name': 'hello-api',
        'image': 'registry.example/hello@sha256:' + 'a' * 64,
        'node': node,
        'replicas': 1,
        'entrypoint': 'web',
        'command': ['python', '-m', 'http.server', '8080'],
        'restart': 'always',
        'resources': {'cpu': 0.25, 'memory': '128M', 'storage': '256M'},
        'network': 'eru',
        'service': {'port': 8080, 'path': '/', 'expected_status': 200,
                    'body_contains': 'ready marker'},
        'stateless': True,
    }


def inventory(workers=('worker-2', 'worker-3', 'worker-4')):
    rows = [{'alias': 'ckc-disposable-01', 'node': None, 'role': 'core',
             'ip': '192.0.2.1'}]
    for index, node in enumerate(workers, 2):
        rows.append({'alias': 'ckc-disposable-' + str(index).zfill(2),
                     'node': node, 'role': 'worker', 'ip': '192.0.2.' + str(index)})
    return rows


def cluster_snapshot(hosts):
    return {
        'at': '2026-09-25T00:00:00Z',
        'hosts': copy.deepcopy(hosts),
        'pods': [{'name': 'eru'}],
        'nodes': [
            {'name': item['node'], 'endpoint': 'containerd://ckc@' + item['ip'] + ':22',
             'podname': 'eru', 'available': True, 'labels': {'owner': OWNER},
             'resource_capacity': '{"cpu":4}', 'resource_usage': '{}'}
            for item in inventory()[1:]
        ],
        'workloads': [],
    }


class FakeOperator:
    def __init__(self, workers=('worker-2', 'worker-3', 'worker-4')):
        self.inventory = inventory(workers)
        self.core = self.inventory[0]
        self.hosts = {
            row['alias']: {'containers': '', 'tasks': '',
                           'private_ip': row['ip']}
            for row in self.inventory
        }
        self.live = cluster_snapshot(self.hosts)
        self.etcd_health = {'exit_code': 0, 'stdout': 'healthy', 'stderr': ''}
        self.core_state = 'active'
        self.events = []
        self.commands = []
        self.cli_calls = []
        self.rows = []
        self.spec_path = '/tmp/eru-mvp-app-test_1.yaml'
        self.probe_reply = {'status': 200, 'body_match': True}

    def snapshot(self):
        return copy.deepcopy(self.live)

    def health(self):
        return copy.deepcopy(self.etcd_health)

    def command(self, host, argv, stdin=None, check=True, timeout=90):
        self.commands.append({'host': host, 'argv': list(argv), 'stdin': stdin,
                              'timeout': timeout, 'check': check})
        stdout = ''
        exit_code = 0
        if argv[-2:] == ['is-active', 'eru-core.service']:
            stdout = self.core_state
            exit_code = 0 if stdout == 'active' else 3
        elif stdin and 'HTTPConnection' in stdin:
            stdout = json.dumps(self.probe_reply)
        elif argv == ['python3', '-'] and stdin and 'mkstemp' in stdin:
            stdout = self.spec_path
        self.events.append({'host': host, 'argv': list(argv), 'exit_code': exit_code,
                            'stdout': stdout, 'stderr': ''})
        if check and exit_code:
            raise RuntimeError('fake command failed')
        return stdout

    def cli(self, *argv):
        self.cli_calls.append(argv)
        return copy.deepcopy(self.rows)


class EruCLIAdapterTests(unittest.TestCase):
    def setUp(self):
        self.operator = FakeOperator()
        self.adapter = EruCLIAdapter(self.operator)

    def test_prepare_plan_collects_live_health_consistency_and_redacts_host_facts(self):
        plan = self.adapter.prepare_plan(spec(), '20260925T123000Z-adapter')
        self.assertTrue(plan['executable'])
        self.assertTrue(plan['preflight']['health_ok'])
        self.assertEqual(plan['preflight']['source'], 'caller_supplied')
        serialized = json.dumps(plan)
        self.assertNotIn('192.0.2.1', serialized)
        self.assertNotIn('private_ip', serialized)
        self.assertTrue(any(command['argv'][-2:] == ['is-active', 'eru-core.service']
                            for command in self.operator.commands))

    def test_etcd_or_core_health_failure_blocks_prepared_plan(self):
        for etcd, core in ((1, 'active'), (0, 'inactive')):
            with self.subTest(etcd=etcd, core=core):
                operator = FakeOperator()
                operator.etcd_health['exit_code'] = etcd
                operator.core_state = core
                plan = EruCLIAdapter(operator).prepare_plan(spec(), '20260925T123000Z-health')
                self.assertFalse(plan['executable'])
                self.assertTrue(plan['blockers'])

    def test_runtime_metadata_mismatch_blocks_prepared_plan(self):
        operator = FakeOperator()
        operator.hosts['ckc-disposable-02']['containers'] = 'orphan-container'
        operator.live['hosts'] = copy.deepcopy(operator.hosts)
        plan = EruCLIAdapter(operator).prepare_plan(spec(), '20260925T123000Z-mismatch')
        self.assertFalse(plan['executable'])
        self.assertTrue(any('runtime and metadata' in blocker for blocker in plan['blockers']))

    def test_deploy_uses_reviewed_argv_and_removes_only_its_spec_file(self):
        plan = self.adapter.prepare_plan(spec(), '20260925T123000Z-deploy')
        self.adapter.deploy(plan)
        image_cache = next(command for command in self.operator.commands
                           if 'image' in command['argv'] and 'cache' in command['argv'])
        self.assertEqual(image_cache['host'], 'ckc-disposable-01')
        self.assertEqual(image_cache['argv'][-5:],
                         ['image', 'cache', '--node', 'worker-2', spec()['image']])
        deployment = next(command for command in self.operator.commands
                          if 'workload' in command['argv'] and 'deploy' in command['argv'])
        self.assertEqual(deployment['host'], 'ckc-disposable-01')
        self.assertEqual(deployment['timeout'], 180)
        argv = deployment['argv']
        self.assertIn('--node', argv)
        self.assertEqual(argv[argv.index('--node') + 1], 'worker-2')
        self.assertEqual(argv[argv.index('--image') + 1], spec()['image'])
        self.assertEqual(argv[-1], self.operator.spec_path)
        writer = next(command for command in self.operator.commands
                      if command['argv'] == ['python3', '-'])
        self.assertIn(plan['appname'], writer['stdin'])
        self.assertIn('spec_sha256', writer['stdin'])
        cleanup = [command for command in self.operator.commands
                   if command['argv'] == ['rm', '--', self.operator.spec_path]]
        self.assertEqual(len(cleanup), 1)

    def test_deploy_rejects_wrong_identity_before_remote_command(self):
        plan = self.adapter.prepare_plan(spec(), '20260925T123000Z-tamper')
        plan['spec_sha256'] = '0' * 64
        before = len(self.operator.commands)
        with self.assertRaisesRegex(ValueError, 'identity'):
            self.adapter.deploy(plan)
        self.assertEqual(len(self.operator.commands), before)

    def test_unexpected_remote_spec_path_is_rejected_before_deploy(self):
        self.operator.spec_path = '/etc/eru/core.yaml'
        plan = self.adapter.prepare_plan(spec(), '20260925T123000Z-path')
        with self.assertRaisesRegex(RuntimeError, 'temporary namespace'):
            self.adapter.deploy(plan)
        self.assertFalse(any('deploy' in command['argv'] for command in self.operator.commands))

    def test_list_revision_uses_exact_appname_query(self):
        _, _, appname = spec_identity(spec())
        self.operator.rows = [{'id': appname + '_web_one'}]
        self.assertEqual(self.adapter.list_revision(appname), self.operator.rows)
        self.assertEqual(self.operator.cli_calls[-1], ('workload', 'list', appname))
        with self.assertRaisesRegex(ValueError, 'appname'):
            self.adapter.list_revision('foreign-app')

    def test_exact_workload_lookup_and_remove_use_only_validated_ids(self):
        _, _, appname = spec_identity(spec())
        workload_id = appname + '_web_one'
        self.operator.rows = [{'id': workload_id}]
        self.assertEqual(self.adapter.get_workload(workload_id), {'id': workload_id})
        self.adapter.remove_exact(workload_id)
        removal = self.operator.commands[-1]
        self.assertEqual(removal['host'], 'ckc-disposable-01')
        self.assertEqual(removal['argv'][-4:], ['workload', 'remove', '--force', workload_id])
        before = len(self.operator.commands)
        for bad_id in ('foreign-app_web_one', appname + '_; rm -rf /'):
            with self.subTest(bad_id=bad_id):
                with self.assertRaisesRegex(ValueError, 'workload ID'):
                    self.adapter.remove_exact(bad_id)
        self.assertEqual(len(self.operator.commands), before)

    def test_probe_runs_on_worker_and_returns_only_safe_summary(self):
        desired = spec()
        _, digest, appname = spec_identity(desired)
        row = {'id': appname + '_web_one', 'nodename': desired['node'],
               'labels': {'owner': OWNER, 'logical_app': desired['name'],
                          'spec_sha256': digest}}
        result = self.adapter.probe(row, desired)
        self.assertEqual(result, {'status': 200, 'body_match': True})
        command = self.operator.commands[-1]
        self.assertEqual(command['host'], 'ckc-disposable-02')
        self.assertEqual(command['argv'], ['sudo', '-n', 'python3', '-'])
        self.assertIn('body_contains', command['stdin'])
        self.assertNotIn('response body', json.dumps(result))

    def test_probe_rejects_unreviewed_worker_alias_and_raw_response(self):
        operator = FakeOperator(workers=('worker-3', 'worker-4'))
        adapter = EruCLIAdapter(operator)
        desired = spec('worker-2')
        _, digest, appname = spec_identity(desired)
        row = {'id': appname + '_web_one', 'nodename': desired['node'],
               'labels': {'owner': OWNER, 'logical_app': desired['name'],
                          'spec_sha256': digest}}
        with self.assertRaisesRegex(ValueError, 'reviewed worker alias'):
            adapter.probe(row, desired)
        operator = FakeOperator()
        operator.probe_reply = {'status': 200, 'body_match': True, 'body': 'response body'}
        with self.assertRaisesRegex(RuntimeError, 'safe summary'):
            EruCLIAdapter(operator).probe(row, desired)


if __name__ == '__main__':
    unittest.main()
