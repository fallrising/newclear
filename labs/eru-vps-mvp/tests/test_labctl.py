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
import reimage_worker_install
import reimage_worker_access
import reimage_worker_registration
import reimage_worker_smoke
import reimage_worker_resume
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
        aliases = {row['alias'] for row in self.inventory}
        return {alias: copy.deepcopy(facts) for alias, facts in self.live['hosts'].items()
                if alias in aliases}

    def command(self, host, argv, stdin=None, check=True, timeout=90,
                ssh_options=None, record_output=True):
        self.remote_commands.append((host, list(argv)))
        event = {'at': '2026-09-26T00:00:00+00:00', 'host': host,
                 'argv': list(argv), 'status': 'started'}
        if ssh_options:
            event['ssh_options'] = list(ssh_options)
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
        self.assertTrue(any('Generation commit' in x for x in plan['blockers']))
        self.assertFalse(any('invalid manual reimage intent' in x for x in plan['blockers']))

    def seed_worker_smoke_canaries(self):
        run_id = '20260926T000000Z-peer1234'
        nodes = {}
        rows = []
        for index, node in enumerate(('worker-2', 'worker-3'), 2):
            app = 'erumvp' + f'{index:012x}'
            workload_id = app + '_web_one'
            rows.append({'id': workload_id, 'nodename': node, 'podname': 'eru', 'image': 'nginx:pinned',
                         'labels': {'owner': labctl.OWNER, 'run': run_id}})
            alias = labctl.ALIASES[index - 1]
            self.op.live['hosts'][alias]['containers'] = workload_id
            nodes[node] = {'app': app, 'worker_alias': alias, 'workload_ids': [workload_id]}
        self.op.live['workloads'].extend(rows)
        atomic_json(self.project / 'private/smoke' / (run_id + '.json'), {
            'run_id': run_id, 'purpose': 'reinstall-canaries', 'status': 'running',
            'nodes': nodes})
        self.worker_smoke_canary_run = run_id
        return run_id

    def reimage_preparation_plan(self, peer_canaries=False):
        self.empty_reimage_target()
        if peer_canaries:
            self.seed_worker_smoke_canaries()
        self.op = FakeReimageOperator(self.project, self.op.live)
        intent_path = self.write_reimage_intent()
        envelope = self.op.plan('rebuild-node', node='worker-4', rebuild_mode='provider-reimage',
                                reimage_intent=str(intent_path))
        return envelope

    def prepared_reimage_plan(self, peer_canaries=False):
        envelope = self.reimage_preparation_plan(peer_canaries=peer_canaries)
        self.op.prepare_reimage(envelope['plan']['id'], envelope['sha256'])
        return envelope

    def configure_reimage_bootstrap_inputs(self):
        self.inventory = [dict(row, ip=f'100.64.0.{i}')
                          for i, row in enumerate(self.inventory, 1)]
        atomic_json(self.project / 'private/deployment-plan.json', self.inventory)
        for row in self.snapshot['nodes']:
            i = int(row['name'].removeprefix('worker-'))
            row['endpoint'] = 'containerd://ckc@100.64.0.' + str(i) + ':22'
        self.op.live['nodes'] = copy.deepcopy(self.snapshot['nodes'])
        lock = {
            'architecture': 'linux/amd64',
            'artifacts': [
                {'repository': 'projecteru2/agent', 'tag': 'v0.1.3', 'sha256': 'b' * 64,
                 'url': 'https://example.invalid/agent.tar.gz'},
                {'repository': 'containernetworking/plugins', 'tag': 'v1.9.1', 'sha256': 'c' * 64,
                 'url': 'https://example.invalid/cni.tar.gz'},
            ],
        }
        atomic_json(self.project / 'artifacts.amd64.lock.json', lock)
        patches = self.project / 'patches'
        patches.mkdir(exist_ok=True)
        for filename in ['core-v0.1.5-safe-node-add.patch',
                         'core-v0.1.5-safe-node-add.validation.json']:
            (patches / filename).write_bytes((SCRIPTS.parent / 'patches' / filename).read_bytes())

    def observed_reimage_source_plan(self, peer_canaries=False, replacement_ip='100.64.0.44'):
        envelope = self.prepared_reimage_plan(peer_canaries=peer_canaries)
        receipt_path = self.write_reimage_receipt(envelope['plan'])
        self.op.record_reimage_receipt(envelope['plan']['id'], envelope['sha256'], str(receipt_path))
        receipt_record = labctl.read(self.op.root / 'reimage-receipts' / (envelope['plan']['id'] + '.json'))
        observation = {
            'schema_version': 1,
            'machine_id': 'replacement-machine-id-4',
            'boot_id': '11111111-1111-1111-1111-111111111111',
            'os_release': 'Debian GNU/Linux 13',
            'tailscale_ipv4': replacement_ip,
            'services': {'ssh.service': 'active', 'tailscaled.service': 'active',
                         'docker.service': 'active', 'containerd.service': 'active'},
            'runtime_counts': {'containers': 0, 'tasks': 0},
            'core_config_present': False, 'etcd_data_present': False,
            'eru_agent_binary_present': False, 'eru_agent_config_present': False,
            'eru_agent_unit_present': False, 'docker_version': 'Docker version fake',
            'containerd_version': 'containerd fake',
            'ssh_verified_by_strict_host_key_check': True,
            'host_key_file_check': receipt_record['trusted_host_key_file_check'],
        }
        with patch('reimage_host.inspect_replacement_host', return_value=observation):
            self.op.verify_reimage_host(envelope['plan']['id'], envelope['sha256'])
        return envelope

    def test_reimage_worker_plan_uses_only_verified_identity_and_worker_payload(self):
        self.configure_reimage_bootstrap_inputs()
        source = self.observed_reimage_source_plan()
        before = list(self.op.remote_commands)
        envelope = self.op.plan_reimage_worker(source['plan']['id'], source['sha256'])
        plan = envelope['plan']
        self.assertFalse(plan['executable'])
        self.assertEqual(plan['operation'], 'provider-reimage-worker-bootstrap')
        self.assertEqual(plan['source_reimage_plan'], {
            'id': source['plan']['id'], 'sha256': source['sha256']})
        self.assertEqual(plan['target']['tailscale_ipv4'], '100.64.0.44')
        self.assertEqual(plan['target']['machine_id'], 'replacement-machine-id-4')
        self.assertEqual(plan['registration']['endpoint'], 'containerd://ckc@100.64.0.44:22')
        self.assertEqual(plan['registration']['resource_capacity'], source['plan']['snapshot']['nodes'][2]['resource_capacity'])
        self.assertEqual(plan['registration']['labels'], source['plan']['snapshot']['nodes'][2]['labels'])
        self.assertEqual({row['repository'] for row in plan['worker_payload']['artifacts']}, {
            'projecteru2/agent', 'containernetworking/plugins'})
        self.assertEqual(len(plan['worker_files']), 6)
        self.assertFalse(any('core' in row['repository'] or 'etcd' in row['repository']
                             for row in plan['worker_payload']['artifacts']))
        self.assertEqual(before, self.op.remote_commands)
        path = self.op.root / 'reimage-bootstrap-plans' / (plan['id'] + '.json')
        self.assertTrue(path.is_file())
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_reimage_worker_plan_rejects_observation_tampering_and_invalid_runtime(self):
        self.configure_reimage_bootstrap_inputs()
        source = self.observed_reimage_source_plan()
        observation_path = self.op.root / 'reimage-observations' / (source['plan']['id'] + '.json')
        changed = labctl.read(observation_path)
        changed['observation']['tailscale_ipv4'] = '100.64.0.45'
        atomic_json(observation_path, changed)
        with self.assertRaisesRegex(ValueError, 'observation is missing, changed'):
            self.op.plan_reimage_worker(source['plan']['id'], source['sha256'])

        changed['observation_sha256'] = labctl.digest(changed['observation'])
        changed['observation']['runtime_counts'] = {'containers': 1, 'tasks': 0}
        changed['observation_sha256'] = labctl.digest(changed['observation'])
        atomic_json(observation_path, changed)
        with self.assertRaisesRegex(ValueError, 'runtime must be empty'):
            self.op.plan_reimage_worker(source['plan']['id'], source['sha256'])

    def ready_worker_bootstrap(self, peer_canaries=False, replacement_ip='100.64.0.44'):
        scripts = self.project / 'scripts'
        scripts.mkdir(exist_ok=True)
        for source in SCRIPTS.glob('*.py'):
            (scripts / source.name).write_bytes(source.read_bytes())
        blob = bytes.fromhex('0000000b7373682d6564323535313900000020' + '07' * 32)
        approved = 'ssh-ed25519 ' + base64.b64encode(blob).decode()
        atomic_json(self.project / 'private/verified-host-public-keys.json',
                    {labctl.ALIASES[0]: [approved]})
        self.configure_reimage_bootstrap_inputs()
        source = self.observed_reimage_source_plan(peer_canaries=peer_canaries,
                                                   replacement_ip=replacement_ip)
        envelope = self.op.plan_reimage_worker(source['plan']['id'], source['sha256'])
        observation = labctl.read(self.op.root / 'reimage-observations' /
                                  (source['plan']['id'] + '.json'))['observation']
        self.op = FakeWorkerInstallOperator(self.project, self.op.live)
        self.op.configure_install_reports(envelope['plan']['target'])
        return envelope, observation

    def test_worker_install_gate_is_separate_and_revalidates_local_bindings(self):
        envelope, observation = self.ready_worker_bootstrap()
        plan = envelope['plan']
        self.assertFalse(plan['executable'])
        self.assertEqual(plan['worker_install']['executable'], True)
        self.assertEqual(plan['worker_install']['blockers'], [])
        before = list(self.op.remote_commands)
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            context = reimage_worker_install._validated_context(
                self.op, plan['id'], envelope['sha256'])
        self.assertEqual(context[0]['worker_payload_sha256'], plan['worker_payload_sha256'])
        self.assertEqual(before, self.op.remote_commands)

    def test_reimage_worker_install_only_installs_and_leaves_agent_and_node_absent(self):
        envelope, observation = self.ready_worker_bootstrap()
        plan = envelope['plan']
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            result = self.op.install_reimage_worker(plan['id'], envelope['sha256'])
        self.assertEqual(result['status'], 'installed-awaiting-registration')
        self.assertFalse(result['agent_started'])
        self.assertFalse(result['node_registered'])
        self.assertEqual(self.op.install_calls, 1)
        self.assertIn('from="100.64.0.1",command="/usr/local/libexec/eru-ssh-command",no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 ',
                      self.op.install_input)
        self.assertEqual([row['name'] for row in self.op.live['nodes']], ['worker-2', 'worker-3'])
        self.assertEqual(result['post_install']['agent_active_state'], 'inactive')
        self.assertEqual(result['post_install']['agent_unit_state'], 'disabled')
        self.assertEqual(result['post_install']['proxy_socket_active_state'], 'active')
        journal_text = json.dumps(result)
        self.assertNotIn(self.op.public_key, journal_text)
        target_events = [event for event in result['events'] if event['host'] == plan['target']['alias']]
        self.assertTrue(target_events)
        self.assertTrue(all(event.get('ssh_options') == [
            'UserKnownHostsFile=' + str(self.op.trusted_hostkeys_dir / 'disposable-04'),
            'GlobalKnownHostsFile=/dev/null', 'UpdateHostKeys=no'] for event in target_events
            if event['argv'] != ['sudo', '-n', 'systemctl', 'stop', 'eru-agent.service']))
        self.assertFalse(any('node' in argv and any(op in argv for op in ('add', 'up'))
                             for _, argv in self.op.remote_commands))
        with self.assertRaisesRegex(ValueError, 'already has a journal'):
            with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
                self.op.install_reimage_worker(plan['id'], envelope['sha256'])
        self.assertEqual(self.op.install_calls, 1)

    def test_uncertain_worker_install_reconciles_read_only_and_is_never_replayed(self):
        envelope, observation = self.ready_worker_bootstrap()
        plan = envelope['plan']
        self.op.lose_install_reply = True
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(TimeoutError, 'response lost'):
                self.op.install_reimage_worker(plan['id'], envelope['sha256'])
        journal = self.journal(envelope)
        self.assertEqual(journal['status'], 'failed')
        self.assertIsNone(journal['remote_mutation_performed'])
        self.assertTrue(journal['remote_mutation_attempted'])
        count = self.op.install_calls
        ssh_config = ('user ckc\\nhostname 100.64.0.44\\nport 22\\n'
                      'proxycommand /usr/bin/tailscale nc %h %p\\n')
        with patch('reimage_worker_install.subprocess.run',
                   return_value=subprocess.CompletedProcess(['ssh', '-G'], 0, ssh_config, '')):
            reconciled = self.op.reconcile(plan['id'])
        self.assertFalse(reconciled['reconciliation']['remote_mutation_performed'])
        self.assertTrue(reconciled['reconciliation']['target_registered'] is False)
        self.assertEqual(reconciled['status'], 'failed')
        self.assertEqual(self.op.install_calls, count)
        self.assertEqual(self.op.install_calls, 1)
        with self.assertRaisesRegex(ValueError, 'already has a journal'):
            with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
                self.op.install_reimage_worker(plan['id'], envelope['sha256'])

    def install_ready_worker_for_registration(self, peer_canaries=False):
        envelope, observation = self.ready_worker_bootstrap(peer_canaries=peer_canaries)
        plan = envelope['plan']
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            installed = self.op.install_reimage_worker(plan['id'], envelope['sha256'])
        self.assertEqual(installed['status'], 'installed-awaiting-registration')
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            access_plan = self.op.plan_reimage_worker_access(plan['id'], envelope['sha256'])
            self.assertTrue(access_plan['plan']['executable'], access_plan['plan']['blockers'])
            access_ready = self.op.prepare_reimage_worker_access(
                access_plan['plan']['id'], access_plan['sha256'])
        self.assertEqual(access_ready['status'], 'access-ready-awaiting-registration')
        self.access_envelope = access_plan
        return envelope, observation

    def install_worker_without_access(self, peer_canaries=False):
        envelope, observation = self.ready_worker_bootstrap(peer_canaries=peer_canaries)
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            installed = self.op.install_reimage_worker(envelope['plan']['id'], envelope['sha256'])
        self.assertEqual(installed['status'], 'installed-awaiting-registration')
        return envelope, observation

    def test_worker_access_plan_is_read_only_then_updates_only_core_trust_and_allowlist(self):
        envelope, observation = self.install_worker_without_access()
        plan = envelope['plan']
        before_files = copy.deepcopy(self.op.core_access_files)
        before_nft = self.op.core_nft_table
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            access_envelope = self.op.plan_reimage_worker_access(plan['id'], envelope['sha256'])
        access_plan = access_envelope['plan']
        self.assertTrue(access_plan['executable'], access_plan['blockers'])
        self.assertEqual(access_plan['old_worker_ip'], '100.64.0.4')
        self.assertEqual(access_plan['new_worker_ip'], '100.64.0.44')
        self.assertEqual(self.op.core_access_files, before_files)
        self.assertEqual(self.op.core_nft_table, before_nft)
        self.assertEqual(self.op.core_access_apply_calls, 0)
        trusted_lines = (self.op.trusted_hostkeys_dir / 'disposable-04').read_text().splitlines()
        trusted_key = ' '.join(trusted_lines[0].split()[1:3])
        self.assertNotIn(trusted_key, json.dumps(access_plan))

        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            prepared = self.op.prepare_reimage_worker_access(access_plan['id'], access_envelope['sha256'])
        self.assertEqual(prepared['status'], 'access-ready-awaiting-registration')
        self.assertTrue(prepared['remote_mutation_performed'])
        self.assertEqual(self.op.core_access_apply_calls, 1)
        self.assertEqual(self.op.core_access_files['firewall'],
                         reimage_worker_access._firewall_text(
                             self.op.core['ip'], access_plan['new_worker_ips']).encode())
        known_lines = self.op.core_access_files['known_hosts'].decode().splitlines()
        target_lines = [line for line in known_lines if line.split()[0] == '100.64.0.44']
        self.assertEqual(len(target_lines), 1)
        self.assertEqual(' '.join(target_lines[0].split()[1:3]), trusted_key)
        self.assertFalse(any(line.split()[0] == '100.64.0.4' for line in known_lines))
        self.assertEqual(reimage_worker_access._nft_worker_ips(
            self.op.core_nft_table, self.op.core['ip']), access_plan['new_worker_ips'])
        self.assertEqual([row['name'] for row in self.op.live['nodes']], ['worker-2', 'worker-3'])
        self.assertEqual(self.op.agent_start_calls, 0)
        write_calls = [row for row in self.op.remote_commands
                       if row[1] == ['sudo', '-n', 'python3', '-c', reimage_worker_access.APPLY_CORE_ACCESS]]
        self.assertEqual([row[0] for row in write_calls], [self.op.core['alias']])
        journal_text = json.dumps(prepared)
        self.assertNotIn(trusted_key, journal_text)

    def test_worker_access_can_replace_host_key_when_tailscale_ip_is_unchanged(self):
        envelope, observation = self.ready_worker_bootstrap(replacement_ip='100.64.0.4')
        bootstrap = envelope['plan']
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            self.op.install_reimage_worker(bootstrap['id'], envelope['sha256'])
            access = self.op.plan_reimage_worker_access(bootstrap['id'], envelope['sha256'])
            result = self.op.prepare_reimage_worker_access(access['plan']['id'], access['sha256'])
        self.assertEqual(result['status'], 'access-ready-awaiting-registration')
        self.assertEqual(access['plan']['old_worker_ip'], access['plan']['new_worker_ip'])
        self.assertEqual(access['plan']['core_access_before']['firewall_sha256'],
                         access['plan']['core_access_after']['firewall_sha256'])
        self.assertEqual(self.op.core_access_write_calls, 1)
        self.assertEqual(self.op.core_access_apply_calls, 1)
        self.assertEqual(reimage_worker_access._nft_worker_ips(
            self.op.core_nft_table, self.op.core['ip']), access['plan']['old_worker_ips'])

    def test_worker_access_fresh_plan_completes_exact_partial_known_hosts_state(self):
        envelope, observation = self.install_worker_without_access()
        bootstrap = envelope['plan']
        context = reimage_worker_install._validated_context(
            self.op, bootstrap['id'], envelope['sha256'])
        trusted = context[4]
        keys, _fingerprints, _check = reimage_worker_access._trusted_keys(
            self.op, bootstrap, context[2], trusted)
        partial_known_hosts = reimage_worker_access._known_hosts_after(
            self.op.core_access_files['known_hosts'], '100.64.0.4', '100.64.0.44',
            ['100.64.0.2', '100.64.0.3', '100.64.0.4'], keys)
        self.op.core_access_files['known_hosts'] = partial_known_hosts
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            access = self.op.plan_reimage_worker_access(bootstrap['id'], envelope['sha256'])
            result = self.op.prepare_reimage_worker_access(access['plan']['id'], access['sha256'])
        self.assertEqual(result['status'], 'access-ready-awaiting-registration')
        self.assertEqual(self.op.core_access_write_calls, 1)
        self.assertEqual(reimage_worker_access._nft_worker_ips(
            self.op.core_nft_table, self.op.core['ip']), access['plan']['new_worker_ips'])
        self.assertEqual(self.op.core_access_files['known_hosts'], partial_known_hosts)

    def test_worker_registration_requires_completed_core_access_stage(self):
        envelope, observation = self.install_worker_without_access()
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(ValueError, 'successful core worker access preparation'):
                self.op.register_reimage_worker(envelope['plan']['id'], envelope['sha256'])
        self.assertEqual(self.op.add_calls, 0)
        self.assertEqual(self.op.agent_start_calls, 0)

    def test_uncertain_worker_access_is_read_only_reconciled_then_adopted_by_fresh_plan(self):
        envelope, observation = self.install_worker_without_access()
        bootstrap = envelope['plan']
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            access = self.op.plan_reimage_worker_access(bootstrap['id'], envelope['sha256'])
        self.op.lose_access_reply = True
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(TimeoutError, 'core access SSH response lost'):
                self.op.prepare_reimage_worker_access(access['plan']['id'], access['sha256'])
        self.assertEqual(self.op.core_access_apply_calls, 1)
        old_run_id = access['plan']['id'] + '-access'
        reconciled = self.op.reconcile(old_run_id)
        self.assertEqual(reconciled['status'], 'failed')
        self.assertFalse(reconciled['reconciliation']['remote_mutation_performed'])
        self.assertTrue(reconciled['reconciliation']['known_hosts_matches_plan'])
        self.assertTrue(reconciled['reconciliation']['firewall_matches_plan'])
        self.assertTrue(reconciled['reconciliation']['live_firewall_matches_plan'])
        self.op.lose_access_reply = False
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            fresh = self.op.plan_reimage_worker_access(bootstrap['id'], envelope['sha256'])
            adopted = self.op.prepare_reimage_worker_access(fresh['plan']['id'], fresh['sha256'])
        self.assertEqual(adopted['status'], 'access-ready-awaiting-registration')
        self.assertFalse(adopted['remote_mutation_attempted'])
        self.assertFalse(adopted['remote_mutation_performed'])
        self.assertEqual(self.op.core_access_apply_calls, 1)

    def test_worker_access_executor_rejects_file_drift_before_remote_write(self):
        envelope, observation = self.install_worker_without_access()
        bootstrap = envelope['plan']
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            access = self.op.plan_reimage_worker_access(bootstrap['id'], envelope['sha256'])
        self.op.core_access_files['known_hosts'] += b'# unexpected drift\n'
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(ValueError, 'binding changed after planning: core_access_before'):
                self.op.prepare_reimage_worker_access(access['plan']['id'], access['sha256'])
        self.assertEqual(self.op.core_access_apply_calls, 0)

    def test_access_parser_expands_an_exact_nft_ipv4_interval(self):
        core_ip = self.op.core['ip']
        table = ('table inet eru_mvp {\n'
                 ' chain input {\n'
                 '  type filter hook input priority filter - 10; policy accept;\n'
                 '  ip daddr ' + core_ip + ' tcp dport 5001 ip saddr { 100.64.0.2-100.64.0.4 } accept\n'
                 '  ip daddr ' + core_ip + ' tcp dport 5001 drop\n'
                 ' }\n}\n')
        self.assertEqual(reimage_worker_access._nft_worker_ips(table, core_ip),
                         ['100.64.0.2', '100.64.0.3', '100.64.0.4'])

    def test_access_remote_source_compiles(self):
        compile(reimage_worker_access.INSPECT_CORE_ACCESS, 'inspect-core-access', 'exec')
        compile(reimage_worker_access.APPLY_CORE_ACCESS, 'apply-core-access', 'exec')

    def test_reimage_worker_registration_adds_under_safe_core_and_stops_fenced(self):
        envelope, observation = self.install_ready_worker_for_registration()
        plan = envelope['plan']
        generation_before = self.op.cluster()['generation']
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            result = self.op.register_reimage_worker(plan['id'], envelope['sha256'])
        self.assertEqual(result['status'], 'registered-awaiting-smoke')
        self.assertTrue(result['node_registered'])
        self.assertTrue(result['agent_started'])
        self.assertTrue(result['available'])
        self.assertTrue(result['bypass'])
        self.assertEqual(result['core_artifact_sha256'], reimage_worker_registration.validation_record(
            self.project, 'patches/core-v0.1.5-safe-node-add.validation.json')['artifact_sha256'])
        node = next(row for row in self.op.live['nodes'] if row['name'] == plan['target']['node'])
        self.assertEqual(node['endpoint'], plan['registration']['endpoint'])
        self.assertTrue(node['bypass'])
        self.assertTrue(node['available'])
        self.assertEqual(self.op.add_calls, 1)
        self.assertEqual(self.op.agent_start_calls, 1)
        args = next(argv for host, argv in self.op.remote_commands
                    if host == self.op.core['alias'] and 'add' in argv)
        self.assertEqual(args[args.index('--extra-resources') + 1], '{}')
        self.assertEqual(self.op.cluster()['generation'], generation_before)
        self.assertFalse(any('node' in argv and 'up' in argv for _, argv in self.op.remote_commands))
        self.assertEqual(self.op.live['workloads'], [])
        with self.assertRaisesRegex(ValueError, 'already has a journal'):
            with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
                self.op.register_reimage_worker(plan['id'], envelope['sha256'])

    def test_worker_registration_refuses_unpatched_core_before_mutation(self):
        envelope, observation = self.install_ready_worker_for_registration()
        plan = envelope['plan']
        self.op.running_core_sha = 'a' * 64
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(ValueError, 'not the verified safe AddNode release'):
                self.op.register_reimage_worker(plan['id'], envelope['sha256'])
        self.assertEqual(self.op.add_calls, 0)
        self.assertEqual(self.op.agent_start_calls, 0)
        journal = labctl.read(self.op.root / 'runs' / (plan['id'] + '-register.json'))
        self.assertEqual(journal['status'], 'failed')

    def test_core_restart_after_add_keeps_worker_fenced_and_agent_stopped(self):
        envelope, observation = self.install_ready_worker_for_registration()
        plan = envelope['plan']
        self.op.rotate_core_after_add = True
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(ValueError, 'core process changed before worker agent start'):
                self.op.register_reimage_worker(plan['id'], envelope['sha256'])
        node = next(row for row in self.op.live['nodes'] if row['name'] == plan['target']['node'])
        self.assertTrue(node['bypass'])
        self.assertFalse(node['available'])
        self.assertEqual(self.op.add_calls, 1)
        self.assertEqual(self.op.agent_start_calls, 0)

    def test_lost_node_add_response_is_read_only_reconciled_without_replay(self):
        envelope, observation = self.install_ready_worker_for_registration()
        plan = envelope['plan']
        self.op.lose_add_reply = True
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(TimeoutError, 'node add response lost'):
                self.op.register_reimage_worker(plan['id'], envelope['sha256'])
        before_add_calls = self.op.add_calls
        before_agent_calls = self.op.agent_start_calls
        ssh_config = ('user ckc\nhostname 100.64.0.44\nport 22\n'
                      'proxycommand /usr/bin/tailscale nc %h %p\nproxyjump none\n')
        with patch('reimage_worker_registration.install.subprocess.run',
                   return_value=subprocess.CompletedProcess(['ssh', '-G'], 0, ssh_config, '')):
            result = self.op.reconcile(plan['id'] + '-register')
        self.assertEqual(result['status'], 'failed')
        self.assertTrue(result['reconciliation']['target_registration']['present'])
        self.assertTrue(result['reconciliation']['target_registration']['bypass'])
        self.assertTrue(result['reconciliation']['target_matches_plan'])
        self.assertFalse(result['reconciliation']['remote_mutation_performed'])
        self.assertEqual(self.op.add_calls, before_add_calls)
        self.assertEqual(self.op.agent_start_calls, before_agent_calls)
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(ValueError, 'already has a journal'):
                self.op.register_reimage_worker(plan['id'], envelope['sha256'])

    def test_lost_agent_start_response_reconciles_without_retry_or_resume(self):
        envelope, observation = self.install_ready_worker_for_registration()
        plan = envelope['plan']
        self.op.lose_agent_start_reply = True
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(TimeoutError, 'agent start response lost'):
                self.op.register_reimage_worker(plan['id'], envelope['sha256'])
        ssh_config = ('user ckc\nhostname 100.64.0.44\nport 22\n'
                      'proxycommand /usr/bin/tailscale nc %h %p\nproxyjump none\n')
        before_add_calls = self.op.add_calls
        before_agent_calls = self.op.agent_start_calls
        with patch('reimage_worker_registration.install.subprocess.run',
                   return_value=subprocess.CompletedProcess(['ssh', '-G'], 0, ssh_config, '')):
            result = self.op.reconcile(plan['id'] + '-register')
        self.assertTrue(result['reconciliation']['target_registration']['bypass'])
        self.assertEqual(result['reconciliation']['worker']['agent_active_state'], 'active')
        self.assertEqual(self.op.add_calls, before_add_calls)
        self.assertEqual(self.op.agent_start_calls, before_agent_calls)
        self.assertFalse(any('node' in argv and 'up' in argv for _, argv in self.op.remote_commands))

    def registered_worker_smoke_plan(self):
        envelope, observation = self.install_ready_worker_for_registration(peer_canaries=True)
        plan = envelope['plan']
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            registered = self.op.register_reimage_worker(plan['id'], envelope['sha256'])
        self.assertEqual(registered['status'], 'registered-awaiting-smoke')
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            smoke_plan = self.op.plan_reimage_worker_smoke(
                plan['id'], envelope['sha256'], self.worker_smoke_canary_run)
        return envelope, observation, smoke_plan

    def fake_worker_smoke_runner(self, *, leaves_workload=False, returncode=0):
        def run(operator, plan):
            node = plan['target']['node']
            alias = plan['target']['alias']
            app = 'erumvpabcdef012345'
            workload_id = app + '_web_one'
            row = {'id': workload_id, 'nodename': node, 'podname': 'eru', 'image': 'nginx:pinned',
                   'labels': {'owner': labctl.OWNER, 'run': '20260926T000000Z-smoke1234'}}
            target_node = next(item for item in operator.live['nodes'] if item['name'] == node)
            assert target_node['bypass'] is True
            operator.live['workloads'].append(row)
            operator.live['hosts'][alias]['containers'] = workload_id
            if not leaves_workload:
                operator.live['workloads'].remove(row)
                operator.live['hosts'][alias]['containers'] = ''
            report = {'run_id': '20260926T000000Z-smoke1234', 'pass': returncode == 0,
                      'nodes': {node: {'result': 'PASS' if returncode == 0 else 'FAIL',
                                       'workload_ids': [workload_id],
                                       'workloads_empty': not leaves_workload,
                                       'usage_restored': not leaves_workload}}}
            filename = report['run_id'] + '.json'
            atomic_json(operator.project / 'private/smoke' / filename, report)
            return {'returncode': returncode, 'evidence_files': [filename],
                    'log_path': 'private/operations/runs/fake-worker-smoke.log',
                    'log_sha256': 'f' * 64}
        return run

    def test_reimage_worker_fenced_smoke_cleans_target_and_keeps_peer_guards(self):
        _bootstrap, observation, envelope = self.registered_worker_smoke_plan()
        plan = envelope['plan']
        generation_before = self.op.cluster()['generation']
        guard_instances = []
        def guard_factory(project, run_id, targets):
            guard = FakeHTTPGuards(project, run_id, targets)
            guard_instances.append(guard)
            return guard
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            result = reimage_worker_smoke.run_reimage_worker_smoke(
                self.op, plan['id'], envelope['sha256'], guard_factory=guard_factory,
                smoke_runner=self.fake_worker_smoke_runner())
        self.assertEqual(result['status'], 'smoked-awaiting-resume')
        self.assertTrue(result['available'])
        self.assertTrue(result['bypass'])
        self.assertEqual(result['smoke_evidence']['result'], 'PASS')
        self.assertEqual(result['smoke_evidence']['workloads_empty'], True)
        self.assertEqual(len(guard_instances), 1)
        self.assertEqual(set(guard_instances[0].summary['hosts']),
                         {'ckc-disposable-02', 'ckc-disposable-03'})
        self.assertEqual(self.op.cluster()['generation'], generation_before)
        self.assertEqual([row['nodename'] for row in self.op.live['workloads']],
                         ['worker-2', 'worker-3'])
        node = next(row for row in self.op.live['nodes'] if row['name'] == 'worker-4')
        self.assertTrue(node['bypass'])
        self.assertTrue(node['available'])
        self.assertFalse(any('node' in argv and 'up' in argv for _, argv in self.op.remote_commands))

    def test_reimage_worker_smoke_failure_keeps_target_fenced(self):
        _bootstrap, observation, envelope = self.registered_worker_smoke_plan()
        plan = envelope['plan']
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(ValueError, 'does not prove a clean, successful target lifecycle'):
                reimage_worker_smoke.run_reimage_worker_smoke(
                    self.op, plan['id'], envelope['sha256'], guard_factory=FakeHTTPGuards,
                    smoke_runner=self.fake_worker_smoke_runner(leaves_workload=True))
        node = next(row for row in self.op.live['nodes'] if row['name'] == 'worker-4')
        self.assertTrue(node['bypass'])
        self.assertTrue(node['available'])
        self.assertTrue(any(row['nodename'] == 'worker-4' for row in self.op.live['workloads']))
        self.assertFalse(any('node' in argv and 'up' in argv for _, argv in self.op.remote_commands))

    def test_reimage_worker_smoke_rejects_peer_canary_drift_before_target_smoke(self):
        _bootstrap, observation, envelope = self.registered_worker_smoke_plan()
        plan = envelope['plan']
        canary_path = self.project / 'private/smoke' / (plan['canary_run'] + '.json')
        canary = labctl.read(canary_path)
        canary['drift_marker'] = 'changed-after-plan'
        atomic_json(canary_path, canary)
        called = []
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(ValueError, 'worker, canary, service, core or cluster state changed'):
                reimage_worker_smoke.run_reimage_worker_smoke(
                    self.op, plan['id'], envelope['sha256'],
                    guard_factory=FakeHTTPGuards,
                    smoke_runner=lambda *_: called.append(True))
        self.assertEqual(called, [])
        node = next(row for row in self.op.live['nodes'] if row['name'] == 'worker-4')
        self.assertTrue(node['bypass'])
        self.assertFalse(any('node' in argv and 'up' in argv for _, argv in self.op.remote_commands))

    def test_uncertain_reimage_worker_smoke_reconciles_read_only_without_replay(self):
        _bootstrap, observation, envelope = self.registered_worker_smoke_plan()
        plan = envelope['plan']
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(TimeoutError, 'smoke result lost'):
                reimage_worker_smoke.run_reimage_worker_smoke(
                    self.op, plan['id'], envelope['sha256'], guard_factory=FakeHTTPGuards,
                    smoke_runner=lambda *_: (_ for _ in ()).throw(TimeoutError('smoke result lost')))
        before = list(self.op.remote_commands)
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            result = self.op.reconcile(plan['id'])
        self.assertFalse(result['reconciliation']['remote_mutation_performed'])
        self.assertTrue(result['reconciliation']['target_registration']['bypass'])
        self.assertGreater(len(self.op.remote_commands), len(before))
        self.assertFalse(any('node' in argv and 'up' in argv for _, argv in self.op.remote_commands))
        self.assertFalse(any('workload' in argv and any(word in argv for word in ('deploy', 'remove'))
                             for _, argv in self.op.remote_commands))

    def smoked_worker_resume_plan(self):
        _bootstrap, observation, smoke_envelope = self.registered_worker_smoke_plan()
        smoke_plan = smoke_envelope['plan']
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            result = reimage_worker_smoke.run_reimage_worker_smoke(
                self.op, smoke_plan['id'], smoke_envelope['sha256'],
                guard_factory=FakeHTTPGuards, smoke_runner=self.fake_worker_smoke_runner())
        self.assertEqual(result['status'], 'smoked-awaiting-resume')
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            resume_envelope = self.op.plan_reimage_worker_resume(
                smoke_plan['id'], smoke_envelope['sha256'])
        return observation, smoke_envelope, resume_envelope

    def test_worker_resume_uses_core_alias_once_and_keeps_generation_unchanged(self):
        observation, _smoke_envelope, envelope = self.smoked_worker_resume_plan()
        plan = envelope['plan']
        generation_before = self.op.cluster()['generation']
        guards = []
        def guard_factory(project, run_id, targets):
            guard = FakeHTTPGuards(project, run_id, targets)
            guards.append(guard)
            return guard
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            result = reimage_worker_resume.resume_reimage_worker(
                self.op, plan['id'], envelope['sha256'], guard_factory=guard_factory,
                sleep=lambda _: None, attempts=3, interval=0)
        self.assertEqual(result['status'], 'resumed-awaiting-generation-commit')
        self.assertTrue(result['resume_attempted'])
        self.assertEqual(result['resume_outcome'], 'response-received')
        self.assertTrue(result['available'])
        self.assertFalse(result['bypass'])
        self.assertEqual(self.op.resume_calls, 1)
        self.assertEqual(self.op.cluster()['generation'], generation_before)
        up_events = [(host, argv) for host, argv in self.op.remote_commands
                     if argv[-3:-1] == ['node', 'up']]
        self.assertEqual(len(up_events), 1)
        self.assertEqual(up_events[0][0], 'ckc-disposable-01')
        self.assertEqual(set(guards[0].summary['hosts']), {'ckc-disposable-02', 'ckc-disposable-03'})
        target = next(row for row in self.op.live['nodes'] if row['name'] == 'worker-4')
        self.assertTrue(target['available'])
        self.assertFalse(target['bypass'])

    def test_worker_resume_rejects_smoke_or_canary_drift_before_node_up(self):
        observation, smoke_envelope, envelope = self.smoked_worker_resume_plan()
        plan = envelope['plan']
        path = self.project / 'private/smoke' / (plan['canary_run'] + '.json')
        changed = labctl.read(path)
        changed['changed_after_resume_plan'] = True
        atomic_json(path, changed)
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(ValueError, 'worker, canary, service, core or cluster state changed'):
                reimage_worker_resume.resume_reimage_worker(
                    self.op, plan['id'], envelope['sha256'], guard_factory=FakeHTTPGuards,
                    sleep=lambda _: None, attempts=2, interval=0)
        self.assertEqual(self.op.resume_calls, 0)
        journal = labctl.read(self.op.root / 'runs' / (plan['id'] + '.json'))
        self.assertFalse(journal['resume_attempted'])
        self.assertTrue(next(row for row in self.op.live['nodes'] if row['name'] == 'worker-4')['bypass'])

    def test_uncertain_worker_resume_reconciles_without_a_second_node_up(self):
        observation, _smoke_envelope, envelope = self.smoked_worker_resume_plan()
        plan = envelope['plan']
        self.op.lose_resume_reply = True
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(TimeoutError, 'core node up response lost'):
                reimage_worker_resume.resume_reimage_worker(
                    self.op, plan['id'], envelope['sha256'], guard_factory=FakeHTTPGuards,
                    sleep=lambda _: None, attempts=2, interval=0)
        before = self.op.resume_calls
        self.assertEqual(before, 1)
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            result = self.op.reconcile(plan['id'])
        self.assertFalse(result['reconciliation']['node_up_replayed'])
        self.assertEqual(result['reconciliation']['target_registration']['bypass'], False)
        self.assertEqual(self.op.resume_calls, before)
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(ValueError, 'already has a journal'):
                reimage_worker_resume.resume_reimage_worker(
                    self.op, plan['id'], envelope['sha256'], guard_factory=FakeHTTPGuards)
        with self.assertRaisesRegex(ValueError, 'already attempted'):
            self.op.plan_reimage_worker_resume(
                plan['smoke_plan']['id'], plan['smoke_plan']['sha256'])

    def test_worker_resume_requires_completed_fenced_smoke(self):
        _bootstrap, observation, smoke_envelope = self.registered_worker_smoke_plan()
        plan = smoke_envelope['plan']
        atomic_json(self.op.root / 'runs' / (plan['id'] + '.json'), {
            'id': plan['id'], 'operation': 'provider-reimage-worker-smoke',
            'plan_hash': smoke_envelope['sha256'], 'target': plan['target']['node'],
            'target_alias': plan['target']['alias'], 'status': 'failed',
            'available': True, 'bypass': True, 'remote_mutation_performed': None,
        })
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(ValueError, 'has not completed successfully'):
                self.op.plan_reimage_worker_resume(plan['id'], smoke_envelope['sha256'])
        self.assertEqual(self.op.resume_calls, 0)

    def test_worker_install_embedded_remote_sources_compile(self):
        compile('import os\nEXPECTED = {}\n' + reimage_worker_install.INSTALL_PREFLIGHT,
                'worker-install-preflight', 'exec')
        compile(reimage_worker_install.POST_FACTS, 'worker-install-verifier', 'exec')
        source = 'CONFIG = {}\n' + (SCRIPTS / 'remote_install.py').read_text()
        compile(source, 'worker-remote-installer', 'exec')

    def test_worker_install_rejects_core_key_drift_against_pinned_input(self):
        envelope, observation = self.ready_worker_bootstrap()
        plan = envelope['plan']
        drifted = bytes.fromhex('0000000b7373682d6564323535313900000020' + '08' * 32)
        self.op.public_key = 'ssh-ed25519 ' + base64.b64encode(drifted).decode() + ' eru-vps-mvp-core'
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(ValueError, 'not uniquely approved'):
                self.op.install_reimage_worker(plan['id'], envelope['sha256'])
        self.assertEqual(self.op.install_calls, 0)
        self.assertFalse(any(host == plan['target']['alias']
                             for host, _ in self.op.remote_commands))
        self.assertEqual(self.journal(envelope)['status'], 'failed')

    def test_worker_install_preflight_drift_fails_before_installer(self):
        envelope, observation = self.ready_worker_bootstrap()
        plan = envelope['plan']
        self.op.preflight['install_destinations_absent'] = False
        with patch('reimage_worker_install.inspect_replacement_host', return_value=observation):
            with self.assertRaisesRegex(ValueError, 'clean, empty worker install target'):
                self.op.install_reimage_worker(plan['id'], envelope['sha256'])
        self.assertEqual(self.op.install_calls, 0)
        self.assertEqual(self.journal(envelope)['status'], 'failed')

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
class FakeHTTPGuards:
    def __init__(self, project, run_id, targets):
        self.project = project
        self.run_id = run_id
        self.targets = targets
        self.summary = None
        self.fail = False

    def __enter__(self):
        if self.fail:
            raise ValueError('fake HTTP guard failed')
        return self

    def check(self):
        if self.fail:
            raise ValueError('fake HTTP guard failed')

    def __exit__(self, *args):
        self.summary = {'failures': [], 'hosts': {row['alias']: {
            'samples': 3, 'failures': 0, 'max_gap_seconds': 1, 'duration_seconds': 2,
        } for row in self.targets}}


class FakeWorkerInstallOperator(FakeReimageOperator):
    def __init__(self, project, snapshot):
        super().__init__(project, snapshot)
        self.target_alias = next(row['alias'] for row in self.inventory if row['node'] == 'worker-4')
        self.install_calls = 0
        self.install_input = None
        self.installed = False
        self.lose_install_reply = False
        blob = bytes.fromhex('0000000b7373682d6564323535313900000020' + '07' * 32)
        self.public_key = 'ssh-ed25519 ' + base64.b64encode(blob).decode() + ' eru-vps-mvp-core'
        self.preflight = None
        self.post_facts = None
        self.agent_enabled = 'disabled'
        self.add_calls = 0
        self.agent_start_calls = 0
        self.resume_calls = 0
        self.lose_resume_reply = False
        self.resume_keeps_fence = False
        self.lose_add_reply = False
        self.lose_agent_start_reply = False
        self.rotate_core_after_add = False
        self.running_core_sha = '0203e3a41c9abf51c35fb52e5224cc796b4ab99b220d610ec9fd5397921072fd'
        self.core_access_apply_calls = 0
        self.core_access_write_calls = 0
        self.lose_access_reply = False
        old_worker_ips = [row['ip'] for row in self.inventory if row['role'] == 'worker']
        old_host_key = 'ssh-ed25519 ' + base64.b64encode(
            bytes.fromhex('0000000b7373682d6564323535313900000020' + '02' * 32)).decode()
        self.core_access_files = {
            'known_hosts': ''.join(ip + ' ' + old_host_key + chr(10) for ip in old_worker_ips).encode(),
            'firewall': reimage_worker_access._firewall_text(
                self.core['ip'], old_worker_ips).encode(),
        }
        self.core_nft_table = self._render_nft(old_worker_ips)

    def _render_nft(self, worker_ips):
        return ('table inet eru_mvp {\n'
                ' chain input {\n'
                '  type filter hook input priority -10; policy accept;\n'
                '  ip daddr ' + self.core['ip'] + ' tcp dport 5001 ip saddr { ' +
                ', '.join(worker_ips) + ' } accept\n'
                '  ip daddr ' + self.core['ip'] + ' tcp dport 5001 drop\n'
                ' }\n}\n')

    def _core_file_observation(self, name):
        raw = self.core_access_files[name]
        return {'content': base64.b64encode(raw).decode(),
                'sha256': hashlib.sha256(raw).hexdigest(), 'uid': 0, 'mode': 0o600}

    def _record_install_event(self, host, argv, stdin, check, timeout, ssh_options, record_output, output=''):
        event = {'at': '2026-09-26T00:00:00+00:00', 'host': host,
                 'argv': list(argv), 'status': 'started'}
        if ssh_options:
            event['ssh_options'] = list(ssh_options)
        self.remote_commands.append((host, list(argv)))
        self.events.append(event); self.save_journal()
        event.update(status='complete', exit_code=0,
                     stdout=output if record_output else None, stderr='')
        if not record_output:
            event['stdout_sha256'] = hashlib.sha256(output.encode()).hexdigest()
        self.save_journal()
        return output

    def command(self, host, argv, stdin=None, check=True, timeout=90,
                ssh_options=None, record_output=True):
        if (host == self.core['alias'] and argv == [
                'sudo', '-n', 'python3', '-c', reimage_worker_access.INSPECT_CORE_ACCESS]):
            result = {'known_hosts': self._core_file_observation('known_hosts'),
                      'firewall': self._core_file_observation('firewall'),
                      'nft_table': self.core_nft_table,
                      'nft_sha256': hashlib.sha256(self.core_nft_table.encode()).hexdigest()}
            return self._record_install_event(host, argv, stdin, check, timeout,
                                              ssh_options, record_output,
                                              json.dumps(result, sort_keys=True))
        if (host == self.core['alias'] and argv == [
                'sudo', '-n', 'python3', '-c', reimage_worker_access.APPLY_CORE_ACCESS]):
            payload = json.loads(stdin)
            self.core_access_apply_calls += 1
            current_known = hashlib.sha256(self.core_access_files['known_hosts']).hexdigest()
            current_firewall = hashlib.sha256(self.core_access_files['firewall']).hexdigest()
            if current_known not in (payload['known_hosts_before_sha256'], payload['known_hosts_after_sha256']):
                raise ValueError('fake known_hosts precondition failed')
            if current_firewall not in (payload['firewall_before_sha256'], payload['firewall_after_sha256']):
                raise ValueError('fake firewall precondition failed')
            if hashlib.sha256(self.core_nft_table.encode()).hexdigest() != payload['nft_before_sha256']:
                raise ValueError('fake nft precondition failed')
            wanted_known = base64.b64decode(payload['known_hosts_after_base64'])
            wanted_firewall = base64.b64decode(payload['firewall_after_base64'])
            if self.core_access_files['known_hosts'] != wanted_known:
                self.core_access_files['known_hosts'] = wanted_known
                self.core_access_write_calls += 1
            if self.core_access_files['firewall'] != wanted_firewall:
                self.core_access_files['firewall'] = wanted_firewall
                self.core_access_write_calls += 1
            if payload['old_worker_ips'] != payload['new_worker_ips']:
                self.core_nft_table = self._render_nft(payload['new_worker_ips'])
            output = json.dumps({
                'known_hosts_sha256': hashlib.sha256(self.core_access_files['known_hosts']).hexdigest(),
                'firewall_sha256': hashlib.sha256(self.core_access_files['firewall']).hexdigest(),
                'nft_sha256': hashlib.sha256(self.core_nft_table.encode()).hexdigest(),
                'allowed_workers': payload['new_worker_ips'],
            }, sort_keys=True)
            result = self._record_install_event(host, argv, stdin, check, timeout,
                                                ssh_options, record_output, output)
            if self.lose_access_reply:
                self.events[-1].update(status='uncertain', error='TimeoutError')
                self.save_journal()
                raise TimeoutError('core access SSH response lost')
            return result
        if host == self.core['alias'] and argv == ['sudo', '-n', 'python3', '-'] and stdin == reimage_worker_registration.RUNTIME_FACTS:
            runtime = {'MainPID': '4242', 'ActiveState': 'active', 'InvocationID': 'fake-core-invocation',
                       'NRestarts': '0', 'sha256': self.running_core_sha}
            return self._record_install_event(host, argv, stdin, check, timeout,
                                              ssh_options, record_output, json.dumps(runtime))
        if host == self.core['alias'] and argv == ['sudo', '-n', 'cat', '/etc/eru/ssh_key.pub']:
            return self._record_install_event(host, argv, stdin, check, timeout,
                                              ssh_options, record_output, self.public_key + chr(10))
        if argv[:4] == ['sudo', '-n', 'systemctl', 'show']:
            output = host + ':' + ','.join(argv[5:]) + ':active\n'
            return self._record_install_event(host, argv, stdin, check, timeout,
                                              ssh_options, record_output, output)
        if argv[:6] == ['sudo', '-n', 'ctr', '--namespace', 'eru', 'containers'] and argv[6:7] == ['info']:
            output = json.dumps({'Labels': {'eru.network.eru': '10.88.0.2'}})
            return self._record_install_event(host, argv, stdin, check, timeout,
                                              ssh_options, record_output, output)
        if host == self.core['alias'] and 'node' in argv and 'add' in argv:
            self.add_calls += 1
            pod = argv[argv.index('add') + 1]
            name = argv[argv.index('--nodename') + 1]
            endpoint = argv[argv.index('--endpoint') + 1]
            capacity = argv[argv.index('--extra-resources') + 1]
            labels = {}
            for index, value in enumerate(argv[:-1]):
                if value == '--label':
                    key, separator, label = argv[index + 1].partition('=')
                    if separator:
                        labels[key] = label
            self.live['nodes'].append({
                'name': name, 'podname': pod, 'endpoint': endpoint, 'labels': labels,
                'resource_capacity': capacity, 'resource_usage': '{}', 'available': False, 'bypass': True,
            })
            output = json.dumps({'node_add': 'accepted'})
            result = self._record_install_event(host, argv, stdin, check, timeout,
                                                ssh_options, record_output, output)
            if self.lose_add_reply:
                self.events[-1].update(status='uncertain', error='TimeoutError')
                self.save_journal()
                raise TimeoutError('core node add response lost')
            if self.rotate_core_after_add:
                self.running_core_sha = 'c' * 64
            return result
        if host == self.core['alias'] and argv[-3:-1] == ['node', 'get']:
            name = argv[-1]
            rows = [copy.deepcopy(row) for row in self.live['nodes'] if row['name'] == name]
            return self._record_install_event(host, argv, stdin, check, timeout,
                                              ssh_options, record_output, json.dumps(rows))
        if host == self.core['alias'] and argv[-3:-1] == ['node', 'up']:
            name = argv[-1]
            self.resume_calls += 1
            node = next(row for row in self.live['nodes'] if row['name'] == name)
            if not self.resume_keeps_fence:
                node['bypass'] = False
            output = self._record_install_event(host, argv, stdin, check, timeout,
                                                ssh_options, record_output, '')
            if self.lose_resume_reply:
                self.events[-1].update(status='uncertain', error='TimeoutError')
                self.save_journal()
                raise TimeoutError('core node up response lost')
            return output
        if host == self.target_alias and argv == ['sudo', '-n', 'python3', '-']:
            if isinstance(stdin, str) and stdin.startswith('CONFIG='):
                self.install_input = stdin
                self.install_calls += 1
                self.installed = True
                self.agent_active = False
                self.agent_enabled = 'disabled'
                if self.lose_install_reply:
                    event = self.events[-1] if self.events else None
                    # Use the common fake event writer, then mark the result uncertain.
                    self._record_install_event(host, argv, stdin, check, timeout,
                                               ssh_options, record_output, '')
                    self.events[-1].update(status='uncertain', error='TimeoutError')
                    self.save_journal()
                    raise TimeoutError('worker install SSH response lost')
                return self._record_install_event(host, argv, stdin, check, timeout,
                                                  ssh_options, record_output,
                                                  json.dumps({'role': 'worker', 'install_complete': True}))
            if isinstance(stdin, str) and stdin.startswith('import os'+chr(10)+'EXPECTED = '):
                return self._record_install_event(host, argv, stdin, check, timeout,
                    ssh_options, record_output, json.dumps(self.preflight or {}))
            if stdin == reimage_worker_install.POST_FACTS:
                facts = dict(self.post_facts or {})
                facts['agent_active_state'] = 'active' if self.agent_active else 'inactive'
                facts['agent_unit_state'] = self.agent_enabled
                return self._record_install_event(host, argv, stdin, check, timeout,
                    ssh_options, record_output, json.dumps(facts))
        if host == self.target_alias and argv == ['sudo', '-n', 'systemctl', 'enable', '--now', 'eru-agent.service']:
            self.agent_start_calls += 1
            self.agent_active = True
            self.agent_enabled = 'enabled'
            for row in self.live['nodes']:
                if row['name'] == 'worker-4':
                    row['available'] = True
            output = self._record_install_event(host, argv, stdin, check, timeout,
                                                ssh_options, record_output, '')
            if self.lose_agent_start_reply:
                self.events[-1].update(status='uncertain', error='TimeoutError')
                self.save_journal()
                raise TimeoutError('worker agent start response lost')
            return output
        if host == self.target_alias and len(argv) == 5 and argv[:4] == ['sudo', '-n', 'python3', '-']:
            return self._record_install_event(host, argv, stdin, check, timeout,
                ssh_options, record_output, json.dumps(self.audit_report()))
        return super().command(host, argv, stdin, check, timeout, ssh_options, record_output)

    def audit_report(self):
        from worker_scope import REINSTALL_FILES, SHARED_FILES
        return {'scope_verified': self.installed, 'blockers': [],
                'node': 'worker-4', 'manifest_sha256': 'd' * 64,
                'files_to_reinstall': [{'path': path, 'sha256': 'e' * 64} for path in REINSTALL_FILES],
                'preserved_owned_files': list(SHARED_FILES)}

    def configure_install_reports(self, target):
        from reimage_worker_install import PRESERVED_SERVICES
        services = {unit: 'active' for unit in PRESERVED_SERVICES}
        self.preflight = {'schema_version': 1, 'services': services,
            'runtime_counts': {'containers': 0, 'tasks': 0}, 'docker_containers': [],
            'owner_manifest_present': False, 'install_destinations_absent': True,
            'authorized_key_path_verified': True, 'docker_version': target['docker_version'],
            'containerd_version': target['containerd_version']}
        self.post_facts = {'schema_version': 1, 'machine_id': target['machine_id'],
            'boot_id': target['boot_id'], 'os_release': target['os_release'],
            'tailscale_ipv4': target['tailscale_ipv4'], 'services': services,
            'runtime_counts': {'containers': 0, 'tasks': 0}, 'docker_containers': [],
            'docker_version': target['docker_version'], 'containerd_version': target['containerd_version'],
            'agent_active_state': 'inactive', 'agent_unit_state': 'disabled',
            'proxy_socket_active_state': 'active', 'proxy_socket_unit_state': 'enabled',
            'root_login_prohibited': True, 'owner_manifest_present': True}
