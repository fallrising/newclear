"""Offline safety tests for nonempty ERU worker drain planning."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from app_desired import OWNER, spec_identity
from worker_drain import build_plan, plan_digest


def spec(name='hello-api', node='worker-4', replicas=1, image='a'):
    return {
        'schema_version': 1,
        'name': name,
        'image': 'registry.example/' + name + '@sha256:' + image * 64,
        'node': node,
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
    normalized, spec_hash, appname = spec_identity(document)
    return [
        {'id': appname + '_web_' + str(index + 1), 'nodename': normalized['node'],
         'labels': {'owner': OWNER, 'logical_app': normalized['name'],
                    'spec_sha256': spec_hash}}
        for index in range(normalized['replicas'])
    ]


def snapshot(workloads):
    return {
        'pods': [{'name': 'eru'}],
        'nodes': [
            {'name': 'worker-2', 'available': True},
            {'name': 'worker-3', 'available': True},
            {'name': 'worker-4', 'available': True},
        ],
        'workloads': copy.deepcopy(workloads),
        'hosts': {'private': {'secret': 'do-not-copy', 'address': '100.64.0.4'}},
        'at': 'first-observation',
    }


class WorkerDrainPlanTests(unittest.TestCase):
    def plan(self, state, apps, destinations, **kwargs):
        return build_plan('worker-4', state, apps, destinations, True,
                          plan_id='20260926T120000Z-drain1', **kwargs)

    def test_complete_owned_apps_plan_explicit_revisions_without_enabling_execution(self):
        hello = spec()
        hello['command'] = ['service', '--token', 'TEST-SECRET-DO-NOT-OUTPUT']
        metrics = spec('metrics-api', replicas=2)
        state = snapshot(rows_for(hello) + rows_for(metrics))
        plan = self.plan(state, [hello, metrics],
                         {'hello-api': 'worker-2', 'metrics-api': 'worker-3'})

        self.assertEqual(plan['decision'], 'reviewable')
        self.assertFalse(plan['executable'])
        self.assertFalse(plan['execution_implemented'])
        self.assertEqual(plan['unmapped_target_workload_ids'], [])
        self.assertEqual(len(plan['moves']), 2)
        by_app = {row['logical_app']: row for row in plan['moves']}
        self.assertEqual(by_app['hello-api']['replacement']['node'], 'worker-2')
        self.assertEqual(by_app['metrics-api']['replacement']['node'], 'worker-3')
        self.assertEqual(by_app['metrics-api']['source']['replicas'], 2)
        self.assertEqual(by_app['hello-api']['replacement']['review_action'], 'deploy_revision')
        self.assertEqual(plan['plan_sha256'], plan_digest(plan))
        self.assertNotIn('do-not-copy', json.dumps(plan))
        self.assertNotIn('100.64.0.4', json.dumps(plan))
        self.assertNotIn('TEST-SECRET-DO-NOT-OUTPUT', json.dumps(plan))

    def test_foreign_or_unmapped_target_workload_blocks_whole_plan(self):
        owned = rows_for(spec())
        foreign = {'id': 'legacy_app_1', 'nodename': 'worker-4',
                   'labels': {'owner': 'someone-else'}}
        plan = self.plan(snapshot(owned + [foreign]), [spec()], {'hello-api': 'worker-2'})
        self.assertEqual(plan['decision'], 'blocked')
        self.assertFalse(plan['executable'])
        self.assertEqual(plan['unmapped_target_workload_ids'], ['legacy_app_1'])
        self.assertTrue(any('not covered by exact current ERU-012 specs' in reason
                            for reason in plan['blockers']))

    def test_partial_source_replica_set_blocks_without_guessing(self):
        document = spec(replicas=2)
        plan = self.plan(snapshot(rows_for(document)[:1]), [document],
                         {'hello-api': 'worker-2'})
        move = plan['moves'][0]
        self.assertEqual(plan['decision'], 'blocked')
        self.assertEqual(move['decision'], 'blocked')
        self.assertTrue(any('complete current revision' in reason
                            for reason in move['blockers']))

    def test_stale_revision_and_destination_revision_outside_source_block(self):
        document = spec()
        old = spec(image='b')
        old_row = rows_for(old)[0]
        plan = self.plan(snapshot(rows_for(document) + [old_row]), [document],
                         {'hello-api': 'worker-2'})
        self.assertEqual(plan['decision'], 'blocked')
        self.assertTrue(any('older owned revisions' in reason for reason in plan['blockers']))
        self.assertTrue(any('outside the exact source revision' in reason
                            for reason in plan['blockers']))

    def test_destination_must_be_live_distinct_and_explicit(self):
        document = spec()
        state = snapshot(rows_for(document))
        state['nodes'][0]['available'] = False
        plan = self.plan(state, [document], {'hello-api': 'worker-2'})
        self.assertEqual(plan['decision'], 'blocked')
        self.assertTrue(any('target node is not available' in reason
                            for reason in plan['blockers']))

        state = snapshot(rows_for(document))
        state['nodes'][0]['available'] = False
        state['nodes'][2]['available'] = False
        plan = self.plan(state, [document], {'hello-api': 'worker-2'})
        self.assertTrue(any('target worker is not available' in reason
                            for reason in plan['blockers']))

        plan = self.plan(snapshot(rows_for(document)), [document],
                         {'hello-api': 'worker-4'})
        self.assertTrue(any('different reviewed worker' in reason
                            for reason in plan['blockers']))
        malformed = self.plan(snapshot(rows_for(document)), [document],
                              {'hello-api': ['worker-2']})
        self.assertEqual(malformed['decision'], 'blocked')

    def test_bad_health_or_consistency_blocks_before_any_execution(self):
        document = spec()
        state = snapshot(rows_for(document))
        plan = build_plan('worker-4', state, [document], {'hello-api': 'worker-2'},
                          False, ['metadata drift'],
                          plan_id='20260926T120000Z-drain1')
        self.assertEqual(plan['decision'], 'blocked')
        self.assertTrue(any('health preflight' in reason for reason in plan['blockers']))
        self.assertTrue(any('consistency preflight' in reason for reason in plan['blockers']))
        self.assertFalse(plan['executable'])

    def test_empty_target_uses_existing_reinstall_path_and_bad_maps_fail_closed(self):
        document = spec()
        plan = self.plan(snapshot([]), [document], {'hello-api': 'worker-2'})
        self.assertTrue(any('target is empty' in reason for reason in plan['blockers']))
        with self.assertRaisesRegex(ValueError, 'duplicate logical'):
            self.plan(snapshot(rows_for(document)), [document, document],
                      {'hello-api': 'worker-2'})
        plan = self.plan(snapshot(rows_for(document)), [document],
                         {'hello-api': 'worker-2', 'unused': 'worker-3'})
        self.assertTrue(any('destination map must name' in reason for reason in plan['blockers']))

    def test_snapshot_order_does_not_change_hash_but_live_state_does(self):
        first_app, second_app = spec(), spec('metrics-api')
        state = snapshot(rows_for(first_app) + rows_for(second_app))
        inputs = [first_app, second_app]
        destinations = {'hello-api': 'worker-2', 'metrics-api': 'worker-3'}
        first = self.plan(state, inputs, destinations)
        reordered = copy.deepcopy(state)
        reordered['at'] = 'later-observation'
        reordered['nodes'].reverse()
        reordered['pods'].reverse()
        reordered['workloads'].reverse()
        second = self.plan(reordered, list(reversed(inputs)), destinations)
        self.assertEqual(first['snapshot_sha256'], second['snapshot_sha256'])
        self.assertEqual(first['plan_sha256'], second['plan_sha256'])
        changed = copy.deepcopy(state)
        changed['nodes'][0]['available'] = False
        third = self.plan(changed, inputs, destinations)
        self.assertNotEqual(first['snapshot_sha256'], third['snapshot_sha256'])
        self.assertNotEqual(first['plan_sha256'], third['plan_sha256'])

    def test_cli_emits_only_a_review_plan_from_offline_json(self):
        document = spec()
        payload = {
            'snapshot': snapshot(rows_for(document)),
            'apps': [document],
            'destinations': {'hello-api': 'worker-2'},
            'health_ok': True,
            'consistency_issues': [],
        }
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / 'input.json'
            input_path.write_text(json.dumps(payload))
            result = subprocess.run(
                [sys.executable, str(Path(__file__).resolve().parents[1] / 'scripts/worker_drain.py'),
                 '--target', 'worker-4', '--input', str(input_path),
                 '--plan-id', '20260926T120000Z-drain1'],
                capture_output=True, text=True, check=True)
        plan = json.loads(result.stdout)
        self.assertEqual(plan['operation'], 'worker-nonempty-drain-plan')
        self.assertFalse(plan['executable'])
        self.assertEqual(plan['decision'], 'reviewable')

    def test_failure_policy_keeps_sources_until_all_replacements_ready(self):
        document = spec()
        plan = self.plan(snapshot(rows_for(document)), [document],
                         {'hello-api': 'worker-2'})
        self.assertIn('Keep every source revision until all replacements are ready', plan['steps'][2])
        self.assertTrue(any('retain all source revisions' in item
                            for item in plan['failure_policy']))
        self.assertTrue(any('never replay' in item for item in plan['failure_policy']))


if __name__ == '__main__':
    unittest.main()
