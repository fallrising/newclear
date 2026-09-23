"""Safety regressions: concurrency, drift, exact ownership and uncertain results."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import labctl
from labops import ClusterLock, atomic_json, lock_fds


class LockTests(unittest.TestCase):
    def test_competing_process_is_rejected_and_lock_releases(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            command = [sys.executable, '-c',
                'from pathlib import Path; from labops import ClusterLock; '
                'x=ClusterLock(Path(__import__("sys").argv[1])); x.__enter__()', temp]
            env = {**os.environ, 'PYTHONPATH': str(SCRIPTS)}
            env.pop('ERU_MVP_LOCK_FD', None)
            with ClusterLock(project):
                result = subprocess.run(command, env=env, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b'already running', result.stderr)
                with ClusterLock(project):
                    self.assertEqual(len(lock_fds()), 1)
            self.assertEqual(subprocess.run(command, env=env, capture_output=True).returncode, 0)

    def test_surviving_child_keeps_parent_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            env = {**os.environ, 'PYTHONPATH': str(SCRIPTS)}
            env.pop('ERU_MVP_LOCK_FD', None)
            # Holder exits without waiting; its child keeps the shared flock FD.
            holder = '''from pathlib import Path
import subprocess,sys
from labops import ClusterLock,lock_fds
with ClusterLock(Path(sys.argv[1])):
 subprocess.Popen([sys.executable,'-c','import sys;sys.stdin.buffer.read(1)'],pass_fds=lock_fds())
'''
            parent = subprocess.Popen([sys.executable, '-c', holder, temp], env=env, stdin=subprocess.PIPE)
            parent.wait(timeout=5)
            try:
                with self.assertRaisesRegex(RuntimeError, 'already running'):
                    with ClusterLock(project):
                        pass
            finally:
                parent.stdin.write(b'x')
                parent.stdin.close()

    def test_atomic_records_are_private_and_replace_valid_json(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'run.json'
            atomic_json(path, {'stage': 'executing'})
            atomic_json(path, {'stage': 'failed'})
            self.assertEqual(json.loads(path.read_text()), {'stage': 'failed'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


class FakeOperator(labctl.Operator):
    def __init__(self, project, snapshot):
        super().__init__(project)
        self.live = copy.deepcopy(snapshot)
        self.removed = []
        self.lose_response = False

    def worker_scope(self, alias):
        return {'scope_verified': True, 'blockers': []}

    def health(self):
        return {'exit_code': 0, 'stdout': 'healthy', 'stderr': ''}

    def snapshot(self):
        return copy.deepcopy(self.live)

    def cli(self, *argv):
        assert argv == ('workload', 'list'), argv
        return copy.deepcopy(self.live['workloads'])

    def command(self, host, argv, stdin=None):
        assert 'remove' in argv, argv
        target = argv[-1]
        self.removed.append(target)
        self.live['workloads'] = [w for w in self.live['workloads'] if w['id'] != target]
        for facts in self.live['hosts'].values():
            facts['containers'] = '\n'.join(x for x in facts['containers'].splitlines() if x != target)
        if self.lose_response:
            raise TimeoutError('SSH response lost after remote remove')
        return ''


class OperatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.inventory = [{'alias': alias, 'ip': f'192.0.2.{i}', 'node': f'worker-{i}',
                           'role': 'core' if i == 1 else 'worker'}
                          for i, alias in enumerate(labctl.ALIASES, 1)]
        atomic_json(self.project / 'private/deployment-plan.json', self.inventory)
        for file in ['artifacts.amd64.lock.json', 'upstream.lock.json', 'private/verified-host-public-keys.json']:
            atomic_json(self.project / file, {})
        self.run = '20260922T000000Z-abc123'
        self.app = 'erumvp012345abcdef'
        self.own = {'id': self.app + '_web_one', 'nodename': 'worker-4', 'podname': 'eru', 'image': 'pinned',
                    'labels': {'owner': labctl.OWNER, 'run': self.run}}
        self.foreign = {'id': 'otherapp_web_one', 'nodename': 'worker-4', 'podname': 'eru', 'image': 'other',
                        'labels': {'owner': 'another-project'}}
        self.evidence = {'run_id': self.run, 'nodes': {'worker-4': {'app': self.app, 'workload_ids': []}}}
        atomic_json(self.project / 'private/smoke' / (self.run + '.json'), self.evidence)
        self.snapshot = {'hosts': {h['alias']: {'machine_id': 'id-' + h['alias'], 'containers': '',
                                               'tasks': '', 'docker': ''} for h in self.inventory},
                         'pods': [{'name': 'eru'}], 'nodes': [
                             {'name': x['node'], 'endpoint': x['ip'], 'podname': 'eru', 'available': True,
                              'labels': {'owner': labctl.OWNER}, 'resource_capacity': '{}', 'resource_usage': '{}'}
                             for x in self.inventory[1:]], 'workloads': [self.own, self.foreign]}
        self.snapshot['hosts'][labctl.ALIASES[3]]['containers'] = self.own['id'] + '\n' + self.foreign['id']
        self.op = FakeOperator(self.project, self.snapshot)

    def plan_cleanup(self):
        return self.op.plan('cleanup', smoke_run=self.run)

    def execute(self, envelope):
        return self.op.execute(envelope['plan']['id'], envelope['sha256'])

    def journal(self, envelope):
        return labctl.read(self.op.root / 'runs' / (envelope['plan']['id'] + '.json'))

    def test_cleanup_recovers_uncertain_create_and_preserves_foreign_workload(self):
        # IDs may be missing if create succeeded but its response was lost.
        plan = self.plan_cleanup()
        self.assertEqual([x['id'] for x in plan['plan']['targets']], [self.own['id']])
        result = self.execute(plan)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(self.op.removed, [self.own['id']])
        self.assertEqual(self.op.live['workloads'], [self.foreign])

    def test_tampered_plan_hash_cannot_remove(self):
        plan = self.plan_cleanup()
        path = self.op.root / 'plans' / (plan['plan']['id'] + '.json')
        plan['plan']['targets'][0]['id'] = self.foreign['id']
        atomic_json(path, plan)
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.execute(plan)
        self.assertEqual(self.op.removed, [])

    def test_wrong_supplied_hash_cannot_remove(self):
        plan = self.plan_cleanup()
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.op.execute(plan['plan']['id'], '0' * 64)
        self.assertEqual(self.op.removed, [])

    def test_input_drift_fails_before_mutation(self):
        plan = self.plan_cleanup()
        atomic_json(self.project / 'artifacts.amd64.lock.json', {'changed': True})
        with self.assertRaisesRegex(ValueError, 'pinned inputs changed'):
            self.execute(plan)
        self.assertEqual(self.journal(plan)['failed_at'], 'preflight')
        self.assertEqual(self.op.removed, [])

    def test_generation_drift_fails_before_mutation(self):
        plan = self.plan_cleanup()
        state = self.op.cluster()
        state['generation'] += 1
        atomic_json(self.op.root / 'cluster.json', state)
        with self.assertRaisesRegex(ValueError, 'generation'):
            self.execute(plan)
        self.assertEqual(self.op.removed, [])

    def test_host_replacement_fails_before_mutation(self):
        plan = self.plan_cleanup()
        self.op.live['hosts'][labctl.ALIASES[3]]['machine_id'] = 'replacement'
        with self.assertRaisesRegex(ValueError, 'host identity'):
            self.execute(plan)
        self.assertEqual(self.op.removed, [])

    def test_new_workload_after_plan_is_not_silently_deleted(self):
        plan = self.plan_cleanup()
        extra = copy.deepcopy(self.own)
        extra['id'] += '_extra'
        self.op.live['workloads'].append(extra)
        self.op.live['hosts'][labctl.ALIASES[3]]['containers'] += '\n' + extra['id']
        with self.assertRaisesRegex(ValueError, 'cluster state changed'):
            self.execute(plan)
        self.assertEqual(self.op.removed, [])

    def test_foreign_labels_in_matching_app_fail_closed(self):
        for field in ['owner', 'run']:
            with self.subTest(field=field):
                workloads = copy.deepcopy([self.own])
                workloads[0]['labels'][field] = 'someone-else'
                with self.assertRaisesRegex(ValueError, 'ownership'):
                    labctl.cleanup_targets(self.evidence, workloads)

    def test_wrong_node_fails_closed(self):
        workloads = copy.deepcopy([self.own])
        workloads[0]['nodename'] = 'worker-3'
        with self.assertRaisesRegex(ValueError, 'ownership'):
            labctl.cleanup_targets(self.evidence, workloads)

    def test_evidence_drift_fails_before_remove(self):
        plan = self.plan_cleanup()
        atomic_json(self.project / 'private/smoke' / (self.run + '.json'), {**self.evidence, 'changed': True})
        with self.assertRaisesRegex(ValueError, 'evidence changed'):
            self.execute(plan)
        self.assertEqual(self.op.removed, [])

    def test_lost_response_is_journaled_and_never_replayed(self):
        plan = self.plan_cleanup()
        self.op.lose_response = True
        with self.assertRaises(TimeoutError):
            self.execute(plan)
        self.assertEqual(self.journal(plan)['status'], 'failed')
        self.assertEqual(self.journal(plan)['failed_at'], 'removing')
        self.op.reconcile(plan['plan']['id'])
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.execute(plan)
        self.assertEqual(self.op.removed, [self.own['id']])
        fresh = self.plan_cleanup()
        self.assertEqual(fresh['plan']['targets'], [])
        self.assertEqual(self.execute(fresh)['status'], 'complete')

    def test_orphaned_running_journal_reconciles_without_mutation(self):
        plan = self.plan_cleanup()
        path = self.op.root / 'runs' / (plan['plan']['id'] + '.json')
        atomic_json(path, {'id': plan['plan']['id'], 'status': 'running', 'stage': 'executing'})
        result = self.op.reconcile(plan['plan']['id'])
        self.assertEqual(result['status'], 'interrupted')
        self.assertEqual(self.op.removed, [])

    def test_rebuild_is_explicit_and_non_executable(self):
        for node in [None, 'worker-1']:
            with self.assertRaisesRegex(ValueError, 'explicit worker'):
                self.op.plan('rebuild-node', node=node)
        plan = self.op.plan('rebuild-node', node='worker-4')
        self.assertFalse(plan['plan']['executable'])
        with self.assertRaisesRegex(ValueError, 'not executable'):
            self.execute(plan)
        self.assertEqual(self.op.removed, [])

    def test_empty_metadata_with_leaked_usage_blocks_execution(self):
        self.op.live['workloads'] = []
        self.op.live['hosts'][labctl.ALIASES[3]]['containers'] = ''
        self.op.live['nodes'][2]['resource_usage'] = '{"cpumem":{"cpu":1}}'
        plan = self.plan_cleanup()
        self.assertFalse(plan['plan']['executable'])
        self.assertTrue(any('nonzero resource usage' in x for x in plan['plan']['blockers']))
        with self.assertRaisesRegex(ValueError, 'not executable'):
            self.execute(plan)
        self.assertEqual(self.op.removed, [])

    def test_orphan_runtime_blocks_plan(self):
        self.op.live['hosts'][labctl.ALIASES[3]]['containers'] += '\norphan_web_x'
        plan = self.plan_cleanup()
        self.assertFalse(plan['plan']['executable'])
        self.assertTrue(any('runtime and metadata' in x for x in plan['plan']['blockers']))

    def test_reconcile_keeps_partial_evidence_when_host_is_unreachable(self):
        plan = self.plan_cleanup()
        path = self.op.root / 'runs' / (plan['plan']['id'] + '.json')
        atomic_json(path, {'id': plan['plan']['id'], 'status': 'running', 'stage': 'executing'})
        def unavailable():
            raise RuntimeError('worker unreachable')
        self.op.snapshot = unavailable
        result = self.op.reconcile(plan['plan']['id'])
        self.assertEqual(result['status'], 'interrupted')
        self.assertIn('worker unreachable', result['reconciliation']['error'])
        self.assertEqual(self.op.removed, [])

    def test_unhealthy_etcd_blocks_a_new_plan_and_a_previously_healthy_plan(self):
        healthy = self.plan_cleanup()
        self.op.health = lambda: {'exit_code': 1, 'stdout': '', 'stderr': 'timeout'}
        blocked = self.plan_cleanup()
        self.assertFalse(blocked['plan']['executable'])
        with self.assertRaisesRegex(ValueError, 'etcd health failed'):
            self.execute(healthy)
        self.assertEqual(self.op.removed, [])

    def test_component_reinstall_is_default_but_never_executable(self):
        plan = self.op.plan('rebuild-node', node='worker-4')['plan']
        self.assertEqual(plan['rebuild_mode'], 'component-reinstall')
        self.assertFalse(plan['executable'])
        self.assertTrue(any('worker-4 must have empty' in x for x in plan['blockers']))
        self.assertFalse(any('Provider ID' in x for x in plan['blockers']))

    def test_peer_worker_plan_audits_selected_target_but_cannot_execute(self):
        for index in (2, 3):
            node = f'worker-{index}'
            alias = labctl.ALIASES[index - 1]
            plan = self.op.plan('rebuild-node', node=node)['plan']
            self.assertEqual(plan['mutation_hosts'], [labctl.ALIASES[0], alias])
            self.assertFalse(plan['executable'])
            self.assertTrue(any('peer canary and recovery support' in x for x in plan['blockers']))
            self.assertFalse(any(node + ' must have empty' in x for x in plan['blockers']))
            self.op.live['hosts'][alias]['tasks'] = 'TASK PID STATUS\nstray 1 RUNNING\n'
            dirty = self.op.plan('rebuild-node', node=node)['plan']
            self.assertTrue(any(node + ' must have empty' in x for x in dirty['blockers']))
            self.op.live['hosts'][alias]['tasks'] = ''

    def test_manual_reimage_does_not_require_provider_api(self):
        plan = self.op.plan('rebuild-node', node='worker-4', rebuild_mode='provider-reimage')['plan']
        self.assertEqual(plan['rebuild_mode'], 'provider-reimage')
        self.assertTrue(any('provider console' in x for x in plan['steps']))
        self.assertFalse(plan['executable'])
        with self.assertRaisesRegex(ValueError, 'only to rebuild-node'):
            self.op.plan('smoke', rebuild_mode='component-reinstall')

    def test_dirty_worker_scope_blocks_plan(self):
        self.op.worker_scope = lambda alias: {'scope_verified': False, 'blockers': ['owned file modified']}
        plan = self.op.plan('rebuild-node', node='worker-4')['plan']
        self.assertIn('owned file modified', plan['blockers'])
        self.assertFalse(plan['executable'])

    def test_no_global_cleanup_and_no_path_traversal(self):
        with self.assertRaisesRegex(ValueError, 'requires --smoke-run'):
            self.op.plan('cleanup')
        for invalid in ['../../etc/passwd', '/tmp/x', '', 'x/y']:
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    labctl.identifier(invalid)


if __name__ == '__main__':
    unittest.main()
