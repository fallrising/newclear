"""Failure boundaries for the scoped worker state machine."""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from component_reinstall import ComponentReinstall, empty_target, protected_membership, ALIAS, TARGET


def snapshot(bypass=False):
    return {'pods': [], 'workloads': [], 'nodes': [{'name': TARGET, 'available': True,
        'bypass': bypass, 'resource_usage': '{}', 'podname': 'eru', 'endpoint': 'fixed',
        'labels': {}, 'resource_capacity': '{}'}], 'hosts': {ALIAS: {
            'containers': '', 'tasks': 'TASK PID STATUS\n', 'machine_id': 'machine', 'boot_id': 'boot',
            'hostname': 'worker', 'tailscale': 'private', 'docker': '', 'ssh_config_hash': 'ssh',
            'trusted_hostkeys_hash': 'keys'}}}


class FakeGuards:
    summary = {'failures': []}
    def __init__(self, *args): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def check(self): pass


class ComponentTests(unittest.TestCase):
    def setup_executor(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        op = Mock(); op.root = Path(temp.name); op.core = {'alias': 'ckc-disposable-01', 'ip': 'example.invalid'}
        op.journal = {}; stages = []; op.stage.side_effect = stages.append
        op.worker_scope.return_value = {'blockers': [], 'manifest_sha256': 'manifest'}
        op.snapshot.return_value = snapshot(True)
        op.cli.return_value = snapshot(True)['nodes']
        executor = ComponentReinstall(op, FakeGuards)
        executor.payload = Mock(return_value={}); executor.service_baseline = Mock(return_value={})
        executor.fence = Mock(); executor.remote = Mock(return_value={'stage': 'success'})
        executor.run_smoke = Mock(); executor.check_isolation = Mock(side_effect=[snapshot(True), snapshot(False)])
        plan = {'executable': True, 'node': TARGET, 'rebuild_mode': 'component-reinstall', 'id': 'run',
                'component_scope': {'manifest_sha256': 'manifest'}, 'worker_readiness': {'canaries': []}, 'bindings': {'cluster': {'generation': 1}}}
        return op, executor, plan, stages

    def test_failure_after_quarantine_never_resumes(self):
        op, executor, plan, stages = self.setup_executor()
        executor.remote.side_effect = [{'stage': 'quarantined'}, RuntimeError('lost install reply')]
        with self.assertRaisesRegex(RuntimeError, 'lost install'):
            executor.execute(plan, snapshot())
        self.assertNotIn('resuming-worker-4', stages)
        executor.run_smoke.assert_not_called()
        self.assertFalse((op.root / 'worker-component-revisions.json').exists())

    def test_failed_smoke_keeps_fence_and_no_revision(self):
        op, executor, plan, stages = self.setup_executor()
        executor.run_smoke.side_effect = RuntimeError('smoke failed')
        with self.assertRaisesRegex(RuntimeError, 'smoke failed'):
            executor.execute(plan, snapshot())
        self.assertNotIn('resuming-worker-4', stages)
        self.assertFalse((op.root / 'worker-component-revisions.json').exists())

    def test_success_orders_fence_stop_quarantine_verify_resume(self):
        op, executor, plan, stages = self.setup_executor()
        executor.execute(plan, snapshot())
        self.assertEqual(stages, ['preparing-worker-payload', 'fencing-worker-4', 'stopping-worker-4',
            'quarantining-worker-4', 'installing-worker-4', 'verifying-worker-4', 'resuming-worker-4'])
        result = json.loads((op.root / 'worker-component-revisions.json').read_text())
        self.assertEqual(result[TARGET]['revision'], 1)
        self.assertEqual(result[TARGET]['generation'], 1)

    def test_orphan_tasks_and_usage_block_before_fence(self):
        op, executor, plan, stages = self.setup_executor()
        for key, value in [('tasks', 'TASK PID STATUS\nrogue 123 RUNNING\n'), ('containers', 'rogue')]:
            before = snapshot(); before['hosts'][ALIAS][key] = value
            with self.assertRaisesRegex(ValueError, 'empty metadata'):
                executor.execute(plan, before)
        before = snapshot(); before['nodes'][0]['resource_usage'] = '{"memory":1}'
        with self.assertRaises(ValueError): executor.execute(plan, before)
        executor.fence.assert_not_called()

    def test_review_only_plan_cannot_use_prototype(self):
        op, executor, plan, stages = self.setup_executor();plan['executable'] = False
        with self.assertRaisesRegex(ValueError, 'review-only'):
            executor.execute(plan, snapshot())
        executor.fence.assert_not_called()

    def test_guard_failure_before_fence_never_stops_worker(self):
        op, executor, plan, stages = self.setup_executor()
        class FailedGuards(FakeGuards):
            def check(self): raise ValueError('HTTP failed')
        executor.guard_factory = FailedGuards
        with self.assertRaisesRegex(ValueError, 'HTTP failed'):
            executor.execute(plan, snapshot())
        executor.fence.assert_not_called()
        op.command.assert_not_called()
        self.assertFalse((op.root / 'worker-component-revisions.json').exists())

    def test_failed_guard_at_shutdown_refences_and_does_not_count_revision(self):
        op, executor, plan, stages = self.setup_executor()
        class FailedGuards(FakeGuards):
            summary = {'failures': ['HTTP late failure']}
        executor.guard_factory = FailedGuards
        with self.assertRaisesRegex(ValueError, 'HTTP failure'):
            executor.execute(plan, snapshot())
        self.assertEqual(op.journal['resume_recovery'], 'fenced')
        executor.fence.assert_called_with(corrective=True)
        self.assertFalse((op.root / 'worker-component-revisions.json').exists())

    def test_peer_order_is_ignored_but_peer_state_changes_are_not(self):
        before = snapshot()
        for name in ['worker-2', 'worker-3']:
            before['nodes'].append({**before['nodes'][0], 'name': name})
            before['workloads'].append({'id': name + '-fixture', 'nodename': name, 'labels': {'owner': 'fixture'}})
        after = copy.deepcopy(before)
        after['nodes'].reverse();after['workloads'].reverse()
        self.assertEqual(protected_membership(before), protected_membership(after))
        after['nodes'][0]['available'] = False
        self.assertNotEqual(protected_membership(before), protected_membership(after))

    def test_reviewed_fault_boundary_leaves_quarantine_fenced_without_install(self):
        op, executor, plan, stages = self.setup_executor()
        plan['fault_after'] = 'quarantine'
        with self.assertRaisesRegex(RuntimeError, 'planned recovery drill'):
            executor.execute(plan, snapshot())
        self.assertEqual([c.args[0] for c in executor.remote.call_args_list], ['quarantine'])
        self.assertNotIn('resuming-worker-4', stages)
        self.assertFalse((op.root / 'worker-component-revisions.json').exists())
