"""Safety regressions: concurrency, drift, exact ownership and uncertain results."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import labctl
import reimage_review
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

    def test_competing_thread_is_rejected_despite_inherited_fd_environment(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            result = []

            def compete():
                try:
                    with ClusterLock(project):
                        result.append('acquired')
                except RuntimeError as exc:
                    result.append(str(exc))

            with ClusterLock(project):
                thread = threading.Thread(target=compete)
                thread.start()
                thread.join(timeout=5)
                self.assertFalse(thread.is_alive())
                self.assertEqual(len(result), 1)
                self.assertIn('already running', result[0])
            self.assertEqual(len(result), 1)

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

    def write_reimage_intent(self, changes=None):
        target = next(host for host in self.inventory if host['node'] == 'worker-4')
        data = {
            'schema_version': 1,
            'provider_api_used': False,
            'provider_resource_ref': 'provider-instance-test-4',
            'os_image_ref': 'debian-image-test-12',
            'target': {'alias': target['alias'], 'node': target['node'],
                       'machine_id': self.snapshot['hosts'][target['alias']]['machine_id']},
            'erase_scope': {'boot_volume_ref': 'boot-volume-test-4',
                            'additional_volume_refs': ['data-volume-test-4']},
            'reviewed_at': labctl.now(),
        }
        if changes:
            data.update(changes)
        path = self.project / 'private/reimage-intents/worker-4.json'
        atomic_json(path, data)
        return path.relative_to(self.project)

    def empty_reimage_target(self):
        self.op.live['workloads'] = []
        self.op.live['hosts'][labctl.ALIASES[3]]['containers'] = ''

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
            self.assertTrue(any('requires --health and --canary-run' in x for x in plan['blockers']))
            self.assertFalse(any(node + ' must have empty' in x for x in plan['blockers']))
            self.op.live['hosts'][alias]['tasks'] = 'TASK PID STATUS\nstray 1 RUNNING\n'
            dirty = self.op.plan('rebuild-node', node=node)['plan']
            self.assertTrue(any(node + ' must have empty' in x for x in dirty['blockers']))
            self.op.live['hosts'][alias]['tasks'] = ''

    def test_canary_plan_guards_other_two_workers_and_keeps_target_empty(self):
        self.op.live['workloads'] = []
        self.op.live['hosts'][labctl.ALIASES[3]]['containers'] = ''
        for excluded, expected in [('worker-2', ['worker-3', 'worker-4']),
                                   ('worker-3', ['worker-2', 'worker-4']),
                                   ('worker-4', ['worker-2', 'worker-3'])]:
            plan = self.op.plan('canary-start', guard_exclude=excluded)['plan']
            self.assertTrue(plan['executable'], plan['blockers'])
            self.assertEqual(plan['guard_exclude'], excluded)
            self.assertEqual(plan['guard_nodes'], expected)
            self.assertEqual(plan['mutation_hosts'], [labctl.ALIASES[0]] +
                             [labctl.ALIASES[int(node[-1]) - 1] for node in expected])
            self.assertNotIn(excluded, plan['guard_nodes'])
        with self.assertRaisesRegex(ValueError, 'only to canary-start'):
            self.op.plan('smoke', guard_exclude='worker-2')
        with self.assertRaisesRegex(ValueError, 'exclude-node'):
            self.op.plan('canary-start', node='worker-2')

    def test_empty_peer_plan_can_execute_only_with_bound_health_and_guards(self):
        self.op.live['workloads'] = []
        self.op.live['hosts'][labctl.ALIASES[3]]['containers'] = ''
        self.op.worker_scope = lambda alias: {'blockers': [], 'manifest_sha256': alias}
        self.op.worker_readiness = lambda health, canaries, snapshot, target='worker-4': {
            'blockers': [], 'health_file': health, 'canary_run': canaries, 'guard_target': target}
        for node in ('worker-2', 'worker-3'):
            plan = self.op.plan('rebuild-node', node=node, health_file='health', canary_run='owned-guards')['plan']
            self.assertTrue(plan['executable'], plan['blockers'])
            self.assertEqual(plan['worker_readiness']['guard_target'], node)
            self.assertEqual(plan['mutation_hosts'], [labctl.ALIASES[0], labctl.ALIASES[int(node[-1]) - 1]])
        self.op.worker_readiness = lambda health, canaries, snapshot, target='worker-4': {
            'blockers': ['guard pair includes selected worker'], 'health_file': health, 'canary_run': canaries}
        blocked = self.op.plan('rebuild-node', node='worker-2', health_file='health', canary_run='wrong-guards')['plan']
        self.assertFalse(blocked['executable'])
        self.assertIn('guard pair includes selected worker', blocked['blockers'])

    def test_peer_execute_binds_component_to_plan_target(self):
        self.op.live['workloads'] = []
        self.op.live['hosts'][labctl.ALIASES[3]]['containers'] = ''
        self.op.worker_scope = lambda alias: {'blockers': [], 'manifest_sha256': alias}
        self.op.worker_readiness = lambda health, canaries, snapshot, target='worker-4': {
            'blockers': [], 'health_file': health, 'canary_run': canaries, 'guard_target': target}
        envelope = self.op.plan('rebuild-node', node='worker-2', health_file='health', canary_run='owned-guards')
        with patch('component_reinstall.ComponentReinstall') as executor:
            self.execute(envelope)
        executor.assert_called_once_with(self.op, target='worker-2')
        executor.return_value.execute.assert_called_once()

    def test_manual_reimage_does_not_require_provider_api(self):
        plan = self.op.plan('rebuild-node', node='worker-4', rebuild_mode='provider-reimage')['plan']
        self.assertEqual(plan['rebuild_mode'], 'provider-reimage')
        self.assertTrue(any('--reimage-intent' in x for x in plan['blockers']))
        self.assertTrue(any('console' in x for x in plan['steps']))
        self.assertFalse(plan['executable'])
        with self.assertRaisesRegex(ValueError, 'only to rebuild-node'):
            self.op.plan('smoke', rebuild_mode='component-reinstall')

    def test_manual_reimage_binds_exact_private_owner_reviewed_scope(self):
        self.empty_reimage_target()
        intent_path = self.write_reimage_intent()
        path = self.project / intent_path
        plan = self.op.plan('rebuild-node', node='worker-4', rebuild_mode='provider-reimage',
                            reimage_intent=str(intent_path))['plan']
        intent = plan['provider_reimage_intent']
        self.assertEqual(intent['target'], {'alias': labctl.ALIASES[3], 'node': 'worker-4',
                                            'machine_id': 'id-' + labctl.ALIASES[3]})
        self.assertEqual(intent['provider_resource_ref'], 'provider-instance-test-4')
        self.assertEqual(intent['os_image_ref'], 'debian-image-test-12')
        self.assertEqual(intent['erase_scope'], {'boot_volume_ref': 'boot-volume-test-4',
                                                 'additional_volume_refs': ['data-volume-test-4']})
        self.assertEqual(plan['bindings']['provider_reimage_intent'], {
            'path': str(intent_path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        self.assertFalse(plan['executable'])
        self.assertTrue(any('Drain/re-registration/resume adapter' in x for x in plan['blockers']))
        self.assertFalse(any('invalid manual reimage intent' in x for x in plan['blockers']))

    def test_manual_reimage_rejects_wrong_identity_api_and_unsafe_scope(self):
        invalid = [
            {'provider_api_used': True},
            {'target': {'alias': labctl.ALIASES[3], 'node': 'worker-4', 'machine_id': 'other-id'}},
            {'erase_scope': {'boot_volume_ref': '*', 'additional_volume_refs': []}},
            {'erase_scope': {'boot_volume_ref': 'boot-4', 'additional_volume_refs': ['disk-4', 'disk-4']}},
            {'reviewed_at': '2020-01-01T00:00:00Z'},
        ]
        for changes in invalid:
            with self.subTest(changes=changes):
                path = self.write_reimage_intent(changes)
                plan = self.op.plan('rebuild-node', node='worker-4', rebuild_mode='provider-reimage',
                                    reimage_intent=str(path))['plan']
                self.assertFalse(plan['executable'])
                self.assertNotIn('provider_reimage_intent', plan)
                self.assertTrue(any('invalid manual reimage intent' in x for x in plan['blockers']))

    def test_manual_reimage_supports_checkout_private_symlink(self):
        path = self.write_reimage_intent()
        linked_project = self.project / 'linked-project'
        linked_project.mkdir()
        (linked_project / 'private').symlink_to(self.project / 'private', target_is_directory=True)
        loaded = reimage_review.load_intent(
            linked_project, 'private/reimage-intents/worker-4.json', node='worker-4',
            alias=labctl.ALIASES[3], machine_id='id-' + labctl.ALIASES[3])
        self.assertEqual(loaded['path'], str(path))
        self.assertEqual(loaded['sha256'], hashlib.sha256((self.project / path).read_bytes()).hexdigest())

    def test_manual_reimage_intent_must_be_private_non_symlink_json(self):
        path = self.write_reimage_intent()
        outside = self.project / 'outside.json'
        outside.write_text((self.project / path).read_text())
        with self.assertRaisesRegex(ValueError, 'under private/reimage-intents'):
            reimage_review.load_intent(self.project, outside, node='worker-4', alias=labctl.ALIASES[3],
                                       machine_id='id-' + labctl.ALIASES[3])
        linked = self.project / 'private/reimage-intents/linked.json'
        linked.symlink_to(self.project / path)
        with self.assertRaisesRegex(ValueError, 'under private/reimage-intents'):
            reimage_review.load_intent(self.project, linked, node='worker-4', alias=labctl.ALIASES[3],
                                       machine_id='id-' + labctl.ALIASES[3])
        duplicate = self.project / 'private/reimage-intents/duplicate.json'
        duplicate.write_text('{"schema_version":1,"schema_version":1}')
        with self.assertRaisesRegex(ValueError, 'duplicate field'):
            reimage_review.load_intent(self.project, duplicate, node='worker-4', alias=labctl.ALIASES[3],
                                       machine_id='id-' + labctl.ALIASES[3])
        with self.assertRaisesRegex(ValueError, 'only to provider-reimage'):
            self.op.plan('rebuild-node', node='worker-4', reimage_intent=str(path))

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
