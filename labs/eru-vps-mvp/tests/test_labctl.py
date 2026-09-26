"""Safety regressions: concurrency, drift, exact ownership and uncertain results."""
import base64
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
import reimage_receipt
import reimage_review
from labops import ClusterLock, atomic_json, digest, lock_fds


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
        self.trusted_hostkeys_dir = project / 'trusted-hostkeys'
        self.trusted_hostkeys_dir.mkdir(exist_ok=True)
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


class FakeReimageOperator(FakeOperator):
    def __init__(self, project, snapshot):
        super().__init__(project, snapshot)
        self.agent_active = True
        self.fail_after_fence = False
        self.fail_after_remove = False
        self.inject_runtime_after_stop = False
        self.remote_commands = []

    def cli(self, *argv):
        command = ['sudo', '-n', '/usr/local/bin/eru-cli', '--eru',
                   self.core['ip'] + ':5001', '--output', 'json', *argv]
        event = {'at': '2026-09-26T00:00:00+00:00', 'host': self.core['alias'],
                 'argv': command, 'status': 'complete', 'exit_code': 0,
                 'stdout': '', 'stderr': ''}
        self.events.append(event)
        self.save_journal()
        if argv == ('pod', 'list'):
            return copy.deepcopy(self.live['pods'])
        if argv == ('pod', 'nodes', 'eru'):
            return copy.deepcopy(self.live['nodes'])
        if argv == ('workload', 'list'):
            return copy.deepcopy(self.live['workloads'])
        if len(argv) == 3 and argv[:2] == ('node', 'get'):
            return [copy.deepcopy(node) for node in self.live['nodes'] if node['name'] == argv[2]]
        raise AssertionError(argv)

    def host_snapshot(self):
        return copy.deepcopy(self.live['hosts'])

    def command(self, host, argv, stdin=None, check=True, timeout=90):
        self.remote_commands.append((host, list(argv)))
        event = {'at': '2026-09-26T00:00:00+00:00', 'host': host,
                 'argv': list(argv), 'status': 'started'}
        self.events.append(event)
        self.save_journal()
        try:
            output = ''
            status = 0
            if argv[:4] == ['sudo', '-n', 'systemctl', 'is-active']:
                units = argv[4:]
                states = [('active' if unit != 'eru-agent.service' or self.agent_active else 'inactive')
                          for unit in units]
                output = '\n'.join(states) + '\n'
                status = 0 if all(value == 'active' for value in states) else 3
            elif argv[:4] == ['sudo', '-n', 'systemctl', 'stop'] and argv[4:] == ['eru-agent.service']:
                self.agent_active = False
                if self.inject_runtime_after_stop:
                    self.live['hosts'][host]['containers'] = 'late-container'
            elif 'node' in argv and 'down' in argv:
                target = argv[-1]
                next(row for row in self.live['nodes'] if row['name'] == target)['bypass'] = True
                if self.fail_after_fence:
                    event.update(status='uncertain', error='TimeoutError')
                    self.save_journal()
                    raise TimeoutError('SSH response lost after node down')
            elif 'node' in argv and 'remove' in argv:
                target = argv[-1]
                self.live['nodes'] = [row for row in self.live['nodes'] if row['name'] != target]
                if self.fail_after_remove:
                    event.update(status='uncertain', error='TimeoutError')
                    self.save_journal()
                    raise TimeoutError('SSH response lost after node remove')
            else:
                raise AssertionError((host, argv))
            event.update(status='complete', exit_code=status, stdout=output, stderr='')
            self.save_journal()
            if check and status:
                raise RuntimeError('fake remote command failed')
            return output
        except BaseException:
            if event.get('status') == 'started':
                event.update(status='uncertain', error='Exception')
                self.save_journal()
            raise


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
        self.snapshot = {'hosts': {h['alias']: {'machine_id': 'id-' + h['alias'], 'boot_id': f'00000000-0000-0000-0000-{i:012x}',
                                               'containers': '', 'tasks': '', 'docker': ''} for i, h in enumerate(self.inventory, 1)},
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

    def write_reimage_receipt(self, plan, changes=None):
        intent = plan['provider_reimage_intent']
        key_blob = b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00 ' + b'\x01' * 32
        key_text = base64.b64encode(key_blob).decode()
        fingerprint = 'SHA256:' + base64.b64encode(hashlib.sha256(key_blob).digest()).decode().rstrip('=')
        trusted = self.op.trusted_hostkeys_dir / 'disposable-04'
        trusted.write_text('ckc-disposable-04 ssh-ed25519 ' + key_text + '\n')
        data = {
            'schema_version': 1,
            'provider_api_used': False,
            'plan_id': plan['id'],
            'plan_sha256': digest(plan),
            'provider_resource_ref': intent['provider_resource_ref'],
            'os_image_ref': intent['os_image_ref'],
            'target': copy.deepcopy(intent['target']),
            'erase_scope': copy.deepcopy(intent['erase_scope']),
            'replacement': {'machine_id': 'replacement-machine-id-4',
                            'boot_id': '11111111-1111-1111-1111-111111111111',
                            'os_release': 'Debian GNU/Linux 13'},
            'provider_console_action_ref': 'console-action-test-4',
            'console_completed_at': labctl.now(),
            'owner_confirmed': True,
            'owner_reviewed_at': labctl.now(),
            'host_key_verified_via': 'provider-console',
            'host_key_fingerprints': {'ssh-ed25519': fingerprint},
        }
        if changes:
            data.update(changes)
        path = self.project / 'private/reimage-receipts/worker-4.json'
        atomic_json(path, data)
        return path.relative_to(self.project)

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
        self.assertTrue(any('Worker-only install, re-registration and resume' in x for x in plan['blockers']))
        self.assertFalse(any('invalid manual reimage intent' in x for x in plan['blockers']))

    def reimage_preparation_plan(self):
        self.empty_reimage_target()
        self.op = FakeReimageOperator(self.project, self.op.live)
        intent_path = self.write_reimage_intent()
        envelope = self.op.plan('rebuild-node', node='worker-4', rebuild_mode='provider-reimage',
                                reimage_intent=str(intent_path))
        return envelope

    def prepared_reimage_plan(self):
        envelope = self.reimage_preparation_plan()
        self.op.prepare_reimage(envelope['plan']['id'], envelope['sha256'])
        return envelope

    def test_manual_reimage_has_separate_empty_worker_preparation_gate(self):
        envelope = self.reimage_preparation_plan()
        plan = envelope['plan']
        self.assertFalse(plan['executable'])
        self.assertTrue(plan['reimage_preparation']['executable'], plan['reimage_preparation']['blockers'])
        self.assertEqual(plan['reimage_preparation']['blockers'], [])
        self.assertTrue(any('replacement-host verification' in item for item in plan['blockers']))
        self.assertEqual(plan['reimage_preparation']['steps'][-1],
                         'Stop at an owner-operated provider console boundary; do not reimage via API')

    def test_prepare_reimage_fences_stops_only_agent_and_deregisters_target(self):
        envelope = self.reimage_preparation_plan()
        result = self.op.prepare_reimage(envelope['plan']['id'], envelope['sha256'])
        self.assertEqual((result['status'], result['stage']), ('prepared', 'awaiting-owner-console-reimage'))
        self.assertFalse(self.op.agent_active)
        self.assertEqual([node['name'] for node in self.op.live['nodes']], ['worker-2', 'worker-3'])
        self.assertEqual(set(host for host, _ in self.op.remote_commands),
                         {labctl.ALIASES[0], labctl.ALIASES[3]})
        self.assertTrue(all(host in labctl.ALIASES for host, _ in self.op.remote_commands))
        self.assertTrue(any('node' in argv and 'down' in argv for _, argv in self.op.remote_commands))
        self.assertTrue(any('systemctl' in argv and 'stop' in argv and 'eru-agent.service' in argv
                            for _, argv in self.op.remote_commands))
        self.assertFalse(any('docker' in argv or 'containerd' in argv and 'stop' in argv
                             for _, argv in self.op.remote_commands))
        journal = self.journal(envelope)
        self.assertEqual(journal['registration_removed']['verified_absent'], True)
        self.assertEqual(journal['status'], 'prepared')
        with self.assertRaisesRegex(ValueError, 'journal; inspect/reconcile'):
            self.op.prepare_reimage(envelope['plan']['id'], envelope['sha256'])

    def test_prepare_reimage_lost_fence_response_is_not_replayed(self):
        envelope = self.reimage_preparation_plan()
        self.op.fail_after_fence = True
        with self.assertRaisesRegex(TimeoutError, 'response lost'):
            self.op.prepare_reimage(envelope['plan']['id'], envelope['sha256'])
        journal = self.journal(envelope)
        self.assertEqual(journal['status'], 'failed')
        self.assertEqual(journal['failed_at'], 'fencing-worker-4')
        self.assertEqual(sum('node' in argv and 'down' in argv
                             for _, argv in self.op.remote_commands), 1)
        self.assertFalse(any('remove' in argv for _, argv in self.op.remote_commands))
        self.assertTrue(next(node for node in self.op.live['nodes'] if node['name'] == 'worker-4')['bypass'])

    def test_prepare_reimage_lost_remove_response_reconciles_read_only(self):
        envelope = self.reimage_preparation_plan()
        self.op.fail_after_remove = True
        with self.assertRaisesRegex(TimeoutError, 'response lost'):
            self.op.prepare_reimage(envelope['plan']['id'], envelope['sha256'])
        before = list(self.op.remote_commands)
        journal = self.op.reconcile(envelope['plan']['id'])
        self.assertEqual(journal['status'], 'failed')
        self.assertFalse(journal['reconciliation']['target_registered'])
        self.assertEqual(journal['reconciliation']['target_workload_count'], 0)
        self.assertEqual(before, self.op.remote_commands)

    def test_prepare_reimage_rechecks_target_runtime_after_agent_stop(self):
        envelope = self.reimage_preparation_plan()
        self.op.inject_runtime_after_stop = True
        with self.assertRaisesRegex(ValueError, 'runtime is not empty after stopping agent'):
            self.op.prepare_reimage(envelope['plan']['id'], envelope['sha256'])
        journal = self.journal(envelope)
        self.assertEqual(journal['status'], 'failed')
        self.assertEqual(journal['failed_at'], 'stopping-agent-worker-4')
        self.assertFalse(any('remove' in argv for _, argv in self.op.remote_commands))
        self.assertTrue(next(node for node in self.op.live['nodes'] if node['name'] == 'worker-4')['bypass'])

    def test_prepare_reimage_refuses_plan_or_live_state_drift_before_mutation(self):
        envelope = self.reimage_preparation_plan()
        changed = copy.deepcopy(envelope['plan'])
        changed['snapshot']['hosts'][labctl.ALIASES[3]]['machine_id'] = 'different'
        atomic_json(self.op.root / 'plans' / (changed['id'] + '.json'),
                    {'plan': changed, 'sha256': envelope['sha256']})
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.op.prepare_reimage(changed['id'], envelope['sha256'])
        self.assertEqual(self.op.remote_commands, [])

        envelope = self.reimage_preparation_plan()
        self.op.live['workloads'] = [self.foreign]
        with self.assertRaisesRegex(ValueError, 'cluster state changed|runtime and metadata'):
            self.op.prepare_reimage(envelope['plan']['id'], envelope['sha256'])
        self.assertEqual(self.op.remote_commands, [])

    def test_reimage_preparation_plan_blocks_docker_or_runtime_and_existing_fence(self):
        cases = [
            ('docker', 'container-foreign', 'Docker workloads'),
            ('containers', 'foreign-container', 'must be empty'),
            ('tasks', 'TASK SERVICE PID STATUS\nforeign task eru 12 RUNNING', 'must be empty'),
        ]
        for field, value, message in cases:
            with self.subTest(field=field):
                self.empty_reimage_target()
                self.op.live['hosts'][labctl.ALIASES[3]][field] = value
                intent_path = self.write_reimage_intent()
                plan = self.op.plan('rebuild-node', node='worker-4', rebuild_mode='provider-reimage',
                                    reimage_intent=str(intent_path))['plan']
                self.assertFalse(plan['reimage_preparation']['executable'])
                self.assertTrue(any(message in blocker for blocker in plan['reimage_preparation']['blockers']))

        self.empty_reimage_target()
        self.op.live['nodes'][2]['bypass'] = True
        intent_path = self.write_reimage_intent()
        plan = self.op.plan('rebuild-node', node='worker-4', rebuild_mode='provider-reimage',
                            reimage_intent=str(intent_path))['plan']
        self.assertFalse(plan['reimage_preparation']['executable'])
        self.assertTrue(any('already fenced' in blocker for blocker in plan['reimage_preparation']['blockers']))

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

    def test_reimage_receipt_records_owner_attestation_without_remote_mutation(self):
        envelope = self.prepared_reimage_plan()
        plan = envelope['plan']
        receipt_path = self.write_reimage_receipt(plan)
        before = copy.deepcopy(self.op.live)
        result = self.op.record_reimage_receipt(plan['id'], envelope['sha256'], str(receipt_path))
        self.assertEqual(result['status'], 'owner-receipt-recorded')
        self.assertFalse(result['remote_mutation_performed'])
        recorded_path = self.op.root / 'reimage-receipts' / (plan['id'] + '.json')
        self.assertTrue(recorded_path.is_file())
        self.assertEqual(recorded_path.stat().st_mode & 0o777, 0o600)
        recorded = labctl.read(recorded_path)
        self.assertEqual(recorded['receipt']['replacement']['machine_id'], 'replacement-machine-id-4')
        self.assertEqual(recorded['receipt']['host_key_verified_via'], 'provider-console')
        self.assertEqual(recorded['trusted_host_key_file_check']['path'], 'disposable-04')
        self.assertEqual(recorded['trusted_host_key_file_check']['host_key_fingerprints'],
                         recorded['receipt']['host_key_fingerprints'])
        self.assertEqual(recorded['trusted_host_key_file_check']['file_sha256'],
                         hashlib.sha256((self.op.trusted_hostkeys_dir / 'disposable-04').read_bytes()).hexdigest())
        self.assertFalse(plan['executable'])
        self.assertEqual(self.op.live, before)
        self.assertEqual(self.op.removed, [])
        with self.assertRaisesRegex(ValueError, 'already recorded'):
            self.op.record_reimage_receipt(plan['id'], envelope['sha256'], str(receipt_path))

    def test_reimage_receipt_rejects_scope_identity_trust_and_hash_drift(self):
        envelope = self.prepared_reimage_plan()
        plan = envelope['plan']
        intent = plan['provider_reimage_intent']
        host = plan['snapshot']['hosts'][labctl.ALIASES[3]]
        invalid = [
            {'provider_resource_ref': 'another-instance'},
            {'erase_scope': {'boot_volume_ref': 'other-boot', 'additional_volume_refs': []}},
            {'target': {'alias': labctl.ALIASES[3], 'node': 'worker-4', 'machine_id': 'other-id'}},
            {'replacement': {'machine_id': host['machine_id'], 'boot_id': '11111111-1111-1111-1111-111111111111',
                             'os_release': 'Debian GNU/Linux 13'}},
            {'replacement': {'machine_id': 'replacement-machine-id-4', 'boot_id': host['boot_id'],
                             'os_release': 'Debian GNU/Linux 13'}},
            {'host_key_verified_via': 'ssh-keyscan'},
            {'host_key_fingerprints': {}},
            {'host_key_fingerprints': {'ssh-ed25519': 'SHA256:!!!'}},
            {'owner_confirmed': False},
            {'owner_reviewed_at': '2020-01-01T00:00:00Z'},
        ]
        for change in invalid:
            with self.subTest(change=change):
                receipt_path = self.write_reimage_receipt(plan, change)
                with self.assertRaises(ValueError):
                    self.op.record_reimage_receipt(plan['id'], envelope['sha256'], str(receipt_path))
                self.assertFalse((self.op.root / 'reimage-receipts' / (plan['id'] + '.json')).exists())
        receipt_path = self.write_reimage_receipt(plan)
        with self.assertRaisesRegex(ValueError, 'plan hash mismatch'):
            self.op.record_reimage_receipt(plan['id'], '0' * 64, str(receipt_path))
        self.assertFalse((self.op.root / 'reimage-receipts' / (plan['id'] + '.json')).exists())

    def test_reimage_host_readonly_gate_records_immutable_observation(self):
        envelope = self.prepared_reimage_plan()
        receipt_path = self.write_reimage_receipt(envelope['plan'])
        self.op.record_reimage_receipt(envelope['plan']['id'], envelope['sha256'], str(receipt_path))
        observation = {
            'machine_id': 'replacement-machine-id-4',
            'boot_id': '11111111-1111-1111-1111-111111111111',
            'os_release': 'Debian GNU/Linux 13',
            'tailscale_ipv4': '100.64.0.4',
            'services': {'ssh.service': 'active', 'tailscaled.service': 'active',
                         'docker.service': 'active', 'containerd.service': 'active'},
            'runtime_counts': {'containers': 0, 'tasks': 0},
            'core_config_present': False, 'etcd_data_present': False,
            'eru_agent_binary_present': False, 'eru_agent_config_present': False,
            'eru_agent_unit_present': False, 'docker_version': 'Docker version fake',
            'containerd_version': 'containerd fake',
            'ssh_verified_by_strict_host_key_check': True,
        }
        before = copy.deepcopy(self.op.live)
        with patch('reimage_host.inspect_replacement_host', return_value=observation) as inspect:
            result = self.op.verify_reimage_host(envelope['plan']['id'], envelope['sha256'])
        self.assertEqual(result['status'], 'replacement-host-readonly-verified')
        self.assertFalse(result['remote_mutation_performed'])
        self.assertEqual(result['alias'], labctl.ALIASES[3])
        recorded_path = self.op.root / 'reimage-observations' / (envelope['plan']['id'] + '.json')
        recorded = labctl.read(recorded_path)
        self.assertEqual(recorded['observation']['machine_id'], observation['machine_id'])
        self.assertTrue(recorded['observation']['ssh_verified_by_strict_host_key_check'])
        self.assertEqual(self.op.live, before)
        self.assertEqual(self.op.removed, [])
        with patch('reimage_host.inspect_replacement_host') as inspect_again:
            with self.assertRaisesRegex(ValueError, 'already recorded'):
                self.op.verify_reimage_host(envelope['plan']['id'], envelope['sha256'])
            inspect_again.assert_not_called()

    def test_reimage_host_gate_blocks_if_trust_file_changed_after_receipt(self):
        envelope = self.prepared_reimage_plan()
        receipt_path = self.write_reimage_receipt(envelope['plan'])
        self.op.record_reimage_receipt(envelope['plan']['id'], envelope['sha256'], str(receipt_path))
        trust_file = self.op.trusted_hostkeys_dir / 'disposable-04'
        trust_file.write_text(trust_file.read_text() + '# changed after receipt recording\n')
        with patch('reimage_host.inspect_replacement_host') as inspect:
            with self.assertRaisesRegex(ValueError, 'trusted worker host-key file changed'):
                self.op.verify_reimage_host(envelope['plan']['id'], envelope['sha256'])
            inspect.assert_not_called()
        self.assertFalse((self.op.root / 'reimage-observations' / (envelope['plan']['id'] + '.json')).exists())

    def test_reimage_receipt_requires_manual_oob_key_in_local_trust_file(self):
        envelope = self.prepared_reimage_plan()
        plan = envelope['plan']
        receipt_path = self.write_reimage_receipt(plan)
        trust_file = self.op.trusted_hostkeys_dir / 'disposable-04'
        changed_blob = b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00 ' + b'\x02' * 32
        trust_file.write_text('ckc-disposable-04 ssh-ed25519 ' +
                              base64.b64encode(changed_blob).decode() + '\n')
        with self.assertRaisesRegex(ValueError, 'fingerprints differ'):
            self.op.record_reimage_receipt(plan['id'], envelope['sha256'], str(receipt_path))
        self.assertFalse((self.op.root / 'reimage-receipts' / (plan['id'] + '.json')).exists())

        trust_file.unlink()
        outside = self.project / 'trusted-key-outside'
        outside.write_text('ckc-disposable-04 ssh-ed25519 ' +
                           base64.b64encode(changed_blob).decode() + '\n')
        trust_file.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'missing or unsafe'):
            self.op.record_reimage_receipt(plan['id'], envelope['sha256'], str(receipt_path))
        self.assertFalse((self.op.root / 'reimage-receipts' / (plan['id'] + '.json')).exists())

    def test_reimage_receipt_supports_checkout_private_symlink(self):
        envelope = self.prepared_reimage_plan()
        receipt_path = self.write_reimage_receipt(envelope['plan'])
        linked_project = self.project / 'linked-project'
        linked_project.mkdir()
        (linked_project / 'private').symlink_to(self.project / 'private', target_is_directory=True)
        loaded = reimage_receipt.load_receipt(
            linked_project, 'private/reimage-receipts/worker-4.json', plan=envelope['plan'],
            plan_sha256=envelope['sha256'])
        self.assertEqual(loaded['path'], str(receipt_path))
        self.assertEqual(loaded['sha256'], hashlib.sha256((self.project / receipt_path).read_bytes()).hexdigest())

    def test_reimage_receipt_requires_completed_preparation_journal(self):
        self.empty_reimage_target()
        intent_path = self.write_reimage_intent()
        envelope = self.op.plan('rebuild-node', node='worker-4', rebuild_mode='provider-reimage',
                                reimage_intent=str(intent_path))
        receipt_path = self.write_reimage_receipt(envelope['plan'])
        with self.assertRaisesRegex(ValueError, 'preparation journal is missing or unsafe'):
            self.op.record_reimage_receipt(envelope['plan']['id'], envelope['sha256'], str(receipt_path))
        self.assertFalse((self.op.root / 'reimage-receipts' / (envelope['plan']['id'] + '.json')).exists())

    def test_reimage_receipt_cannot_be_recorded_with_live_preflight_blockers(self):
        intent_path = self.write_reimage_intent()
        envelope = self.op.plan('rebuild-node', node='worker-4', rebuild_mode='provider-reimage',
                                reimage_intent=str(intent_path))
        receipt_path = self.write_reimage_receipt(envelope['plan'])
        with self.assertRaisesRegex(ValueError, 'unresolved preflight blockers'):
            self.op.record_reimage_receipt(envelope['plan']['id'], envelope['sha256'], str(receipt_path))
        self.assertFalse((self.op.root / 'reimage-receipts' / (envelope['plan']['id'] + '.json')).exists())

    def test_reimage_receipt_rejects_external_symlink_and_duplicate_fields(self):
        envelope = self.prepared_reimage_plan()
        plan = envelope['plan']
        receipt_path = self.write_reimage_receipt(plan)
        outside = self.project / 'outside-receipt.json'
        outside.write_text((self.project / receipt_path).read_text())
        with self.assertRaisesRegex(ValueError, 'under private/reimage-receipts'):
            self.op.record_reimage_receipt(plan['id'], envelope['sha256'], str(outside))
        linked = self.project / 'private/reimage-receipts/linked.json'
        linked.symlink_to(self.project / receipt_path)
        with self.assertRaisesRegex(ValueError, 'regular JSON file'):
            self.op.record_reimage_receipt(plan['id'], envelope['sha256'], str(linked))
        duplicate = self.project / 'private/reimage-receipts/duplicate.json'
        duplicate.write_text('{"schema_version":1,"schema_version":1}')
        with self.assertRaisesRegex(ValueError, 'duplicate field'):
            self.op.record_reimage_receipt(plan['id'], envelope['sha256'], str(duplicate))

    def test_reimage_receipt_rejects_nested_path_and_symlink_directory(self):
        self.empty_reimage_target()
        intent_path = self.write_reimage_intent()
        envelope = self.op.plan('rebuild-node', node='worker-4', rebuild_mode='provider-reimage',
                                reimage_intent=str(intent_path))
        receipt_path = self.write_reimage_receipt(envelope['plan'])
        nested = self.project / 'private/reimage-receipts/nested/worker-4.json'
        nested.parent.mkdir()
        nested.write_bytes((self.project / receipt_path).read_bytes())
        with self.assertRaisesRegex(ValueError, 'under private/reimage-receipts'):
            self.op.record_reimage_receipt(envelope['plan']['id'], envelope['sha256'], str(nested))

        receipt_root = self.project / 'private/reimage-receipts'
        saved_root = self.project / 'private/reimage-receipts.saved'
        outside = self.project / 'receipt-directory'
        outside.mkdir()
        (outside / 'worker-4.json').write_bytes((self.project / receipt_path).read_bytes())
        receipt_root.rename(saved_root)
        receipt_root.symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'regular JSON file'):
            self.op.record_reimage_receipt(
                envelope['plan']['id'], envelope['sha256'], 'private/reimage-receipts/worker-4.json')

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
