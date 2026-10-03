"""Offline ERU-010 worker-loss recovery review planning tests."""
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
from worker_loss import build_plan, plan_digest
from worker_loss_ops import save_review_plan


def spec(name='hello-api', replicas=1):
    return {
        'schema_version': 1,
        'name': name,
        'image': 'registry.example/' + name + '@sha256:' + 'a' * 64,
        'node': 'worker-4',
        'replicas': replicas,
        'entrypoint': 'web',
        'command': ['python', '-m', 'http.server', '8080'],
        'restart': 'always',
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
    return {
        'at': 'not-hash-relevant',
        'hosts': {'private': {'address': '192.0.2.4', 'secret': 'never-copy'}},
        'pods': [{'name': 'eru'}],
        'nodes': [
            {'name': 'worker-2', 'available': True, 'bypass': False,
             'resource_usage': '{}'},
            {'name': 'worker-3', 'available': True, 'bypass': False,
             'resource_usage': '{}'},
            {'name': 'worker-4', 'available': False, 'bypass': True,
             'resource_usage': '{"cpu":0.25,"memory":134217728}'},
        ],
        'workloads': copy.deepcopy(workloads),
    }


def detection(seconds=120):
    return {'failure_started_at': '2026-09-27T12:00:00Z',
            'detected_at': '2026-09-27T12:02:00Z' if seconds == 120
            else '2026-09-27T12:04:00Z'}


def fence(confirmed=True):
    return {'confirmed': confirmed, 'method': 'provider_power_off',
            'confirmed_at': '2026-09-27T12:03:00Z',
            'proof_sha256': 'f' * 64}


class WorkerLossPlanTests(unittest.TestCase):
    def plan(self, state, apps, destinations, **kwargs):
        return build_plan(
            'worker-4', state, apps, destinations,
            kwargs.pop('detection', detection()),
            kwargs.pop('fence', fence()),
            kwargs.pop('control_plane_health_ok', True),
            kwargs.pop('healthy_workers_ok', True),
            kwargs.pop('unexpected_consistency_issues', ()),
            plan_id='20260927T120300Z-loss1', **kwargs)

    def test_confirmed_fence_exact_stale_state_and_destinations_are_reviewable(self):
        hello = spec()
        metrics = spec('metrics-api', replicas=2)
        plan = self.plan(snapshot(rows_for(hello) + rows_for(metrics)),
                         [hello, metrics],
                         {'hello-api': 'worker-2', 'metrics-api': 'worker-3'})

        self.assertEqual(plan['decision'], 'reviewable')
        self.assertFalse(plan['executable'])
        self.assertFalse(plan['execution_implemented'])
        self.assertEqual(plan['detection']['seconds'], 120)
        self.assertTrue(plan['detection']['within_candidate'])
        self.assertTrue(plan['fence']['confirmed'])
        self.assertEqual(plan['target_stale_state']['workload_count'], 3)
        self.assertTrue(plan['target_stale_state']['resource_usage_nonzero'])
        self.assertEqual(plan['unmapped_target_workload_ids'], [])
        self.assertEqual(plan['plan_sha256'], plan_digest(plan))
        rendered = json.dumps(plan)
        self.assertNotIn('192.0.2.4', rendered)
        self.assertNotIn('never-copy', rendered)

    def test_missing_external_fence_or_control_plane_fence_blocks(self):
        document = spec()
        state = snapshot(rows_for(document))
        plan = self.plan(state, [document], {'hello-api': 'worker-2'},
                         fence=fence(False))
        self.assertEqual(plan['decision'], 'blocked')
        self.assertTrue(any('external fence is not confirmed' in reason
                            for reason in plan['blockers']))

        state['nodes'][2]['bypass'] = False
        state['nodes'][2]['available'] = True
        plan = self.plan(state, [document], {'hello-api': 'worker-2'})
        self.assertTrue(any('unavailable and bypassed' in reason
                            for reason in plan['blockers']))

    def test_slow_detection_is_recorded_as_acceptance_gap_without_blocking_recovery_review(self):
        document = spec()
        late_fence = fence(); late_fence['confirmed_at'] = '2026-09-27T12:05:00Z'
        plan = self.plan(snapshot(rows_for(document)), [document],
                         {'hello-api': 'worker-2'}, detection=detection(240),
                         fence=late_fence)
        self.assertEqual(plan['decision'], 'reviewable')
        self.assertEqual(plan['detection']['seconds'], 240)
        self.assertFalse(plan['detection']['within_candidate'])
        self.assertIn('detection exceeded the 180 second candidate',
                      plan['acceptance_gaps'])

    def test_partial_unknown_or_old_target_workloads_block_exact_reconciliation(self):
        document = spec(replicas=2)
        foreign = {'id': 'foreign_1', 'nodename': 'worker-4', 'labels': {}}
        plan = self.plan(snapshot(rows_for(document)[:1] + [foreign]), [document],
                         {'hello-api': 'worker-2'})
        self.assertEqual(plan['decision'], 'blocked')
        self.assertEqual(plan['unmapped_target_workload_ids'], ['foreign_1'])
        self.assertTrue(any('replica count' in reason for reason in plan['blockers']))

        old = spec(); old['image'] = old['image'].replace('a' * 64, 'b' * 64)
        plan = self.plan(snapshot(rows_for(document) + rows_for(old)), [document],
                         {'hello-api': 'worker-2'})
        self.assertTrue(any('older or foreign revision' in reason
                            for reason in plan['blockers']))

    def test_destination_must_be_explicit_healthy_and_unfenced(self):
        document = spec()
        state = snapshot(rows_for(document))
        state['nodes'][0]['available'] = False
        state['nodes'][0]['bypass'] = True
        plan = self.plan(state, [document], {'hello-api': 'worker-2'})
        self.assertEqual(plan['decision'], 'blocked')
        self.assertTrue(any('available and not bypassed' in reason
                            for reason in plan['blockers']))

        plan = self.plan(snapshot(rows_for(document)), [document], {})
        self.assertTrue(any('destination map' in reason
                            for reason in plan['blockers']))

    def test_quota_health_and_unexpected_consistency_are_fail_closed(self):
        document = spec()
        state = snapshot(rows_for(document))
        state['nodes'][2]['resource_usage'] = '{}'
        plan = self.plan(state, [document], {'hello-api': 'worker-2'},
                         control_plane_health_ok=False,
                         healthy_workers_ok=False,
                         unexpected_consistency_issues=['healthy worker drift'])
        self.assertEqual(plan['decision'], 'blocked')
        self.assertFalse(plan['target_stale_state']['resource_usage_nonzero'])
        self.assertTrue(any('control-plane health' in reason
                            for reason in plan['blockers']))
        self.assertTrue(any('healthy-worker preflight' in reason
                            for reason in plan['blockers']))
        self.assertTrue(any('unexpected consistency' in reason
                            for reason in plan['blockers']))

        state['nodes'][2]['resource_usage'] = 'not-json'
        malformed = self.plan(state, [document], {'hello-api': 'worker-2'})
        self.assertTrue(any('resource usage is missing or malformed' in reason
                            for reason in malformed['blockers']))

    def test_snapshot_and_input_order_do_not_change_hash(self):
        hello, metrics = spec(), spec('metrics-api')
        state = snapshot(rows_for(hello) + rows_for(metrics))
        destinations = {'hello-api': 'worker-2', 'metrics-api': 'worker-3'}
        first = self.plan(state, [hello, metrics], destinations)
        reordered = copy.deepcopy(state)
        reordered['at'] = 'later'
        reordered['nodes'].reverse()
        reordered['workloads'].reverse()
        second = self.plan(reordered, [metrics, hello], destinations)
        self.assertEqual(first['snapshot_sha256'], second['snapshot_sha256'])
        self.assertEqual(first['plan_sha256'], second['plan_sha256'])


class WorkerLossPrivatePlanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        (self.project / 'private').mkdir()
        document = spec()
        self.input = self.project / 'private/worker-loss.json'
        self.input.write_text(json.dumps({
            'snapshot': snapshot(rows_for(document)),
            'apps': [document],
            'destinations': {'hello-api': 'worker-2'},
            'detection': detection(),
            'fence': fence(),
            'control_plane_health_ok': True,
            'healthy_workers_ok': True,
            'unexpected_consistency_issues': [],
        }))

    def test_private_plan_is_saved_once_and_labctl_output_masks_workload_ids(self):
        plan, path = save_review_plan(
            self.project, 'worker-4', self.input, '20260927T120300Z-losscli')
        self.assertEqual(path.parent.name, 'review-plans')
        self.assertFalse(plan['executable'])
        with self.assertRaises(FileExistsError):
            save_review_plan(self.project, 'worker-4', self.input, plan['id'])

        output = io.StringIO()
        with (patch.object(labctl, 'PROJECT', self.project),
              patch.object(sys, 'argv', [
                  'labctl.py', 'plan-worker-loss', '--target', 'worker-4',
                  '--input', str(self.input), '--plan-id', '20260927T120400Z-losscli']),
              contextlib.redirect_stdout(output)):
            labctl.main()
        public = json.loads(output.getvalue())
        self.assertEqual(public['operation'], 'worker-loss-recovery-review-plan')
        self.assertFalse(public['executable'])
        for workload_id in plan['target_stale_state']['workload_ids']:
            self.assertNotIn(workload_id, output.getvalue())

    def test_inputs_outside_private_or_through_symlink_are_rejected(self):
        outside = self.project.parent / 'worker-loss-outside.json'
        outside.write_text('{}')
        self.addCleanup(lambda: outside.unlink(missing_ok=True))
        with self.assertRaisesRegex(ValueError, 'inside project private'):
            save_review_plan(self.project, 'worker-4', outside, 'outside-loss')
        linked = self.project / 'private/linked.json'
        linked.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            save_review_plan(self.project, 'worker-4', linked, 'linked-loss')


if __name__ == '__main__':
    unittest.main()
