"""Offline ERU-012 desired-state contract and drift planner tests."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from app_desired import OWNER, build_plan, render_eru_spec, snapshot_binding, spec_identity, validate_spec


def spec():
    return {
        'schema_version': 1,
        'name': 'hello-api',
        'image': 'registry.example/hello@sha256:' + 'a' * 64,
        'node': 'worker-2',
        'replicas': 1,
        'entrypoint': 'web',
        'command': ['python', '-m', 'http.server', '8080'],
        'restart': 'always',
        'resources': {'cpu': 0.25, 'memory': '128M', 'storage': '256M'},
        'network': 'eru',
        'service': {'port': 8080, 'path': '/', 'expected_status': 200,
                    'body_contains': 'ready'},
        'stateless': True,
    }


def snapshot(workloads=None, available=True):
    return {
        'pods': [{'name': 'eru'}],
        'nodes': [{'name': 'worker-2', 'available': available}],
        'workloads': copy.deepcopy(workloads or []),
    }


def workload(document=None, spec_hash=None, appname=None, node='worker-2', **labels):
    document = document or spec()
    _, default_hash, default_app = spec_identity(document)
    return {'id': (appname or default_app) + '_web_one', 'nodename': node,
            'labels': {'owner': OWNER, 'logical_app': document['name'],
                       'spec_sha256': spec_hash or default_hash, **labels}}


class SpecValidationTests(unittest.TestCase):
    def test_spec_identity_is_stable_and_changes_with_any_desired_field(self):
        first = spec()
        reordered = dict(reversed(list(first.items())))
        self.assertEqual(spec_identity(first)[1:], spec_identity(reordered)[1:])
        changed = copy.deepcopy(first)
        changed['command'][-1] = '9090'
        self.assertNotEqual(spec_identity(first)[1], spec_identity(changed)[1])
        self.assertNotEqual(spec_identity(first)[2], spec_identity(changed)[2])

    def test_requires_digest_pinned_image_and_explicit_stateless_contract(self):
        for field, value in [('image', 'registry.example/hello:latest'), ('stateless', False)]:
            invalid = spec(); invalid[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_spec(invalid)

    def test_rejects_unknown_secret_or_volume_fields(self):
        for field in ('environment', 'volumes', 'secret', 'auto_remove'):
            invalid = {**spec(), field: {'TOKEN': 'never-accept-secrets'}}
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'unsupported'):
                validate_spec(invalid)

    def test_rejects_host_network_until_separately_reviewed(self):
        invalid = spec(); invalid['network'] = 'host'
        with self.assertRaisesRegex(ValueError, 'separate reviewed plan'):
            validate_spec(invalid)

    def test_rejects_invalid_target_quantity_command_and_service(self):
        cases = [
            ('node', 'worker-1'),
            ('replicas', True),
            ('command', ['echo', '']),
            ('resources', {'cpu': float('nan'), 'memory': '128M', 'storage': '256M'}),
            ('service', {'port': 0, 'path': '/', 'expected_status': 200, 'body_contains': 'ok'}),
        ]
        for field, value in cases:
            invalid = spec(); invalid[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_spec(invalid)


class DesiredStatePlanTests(unittest.TestCase):
    def test_empty_snapshot_plans_one_deterministic_revision_without_remove(self):
        desired = spec()
        plan = build_plan(desired, snapshot())
        self.assertEqual(plan['decision'], 'reviewable')
        self.assertFalse(plan['executable'])
        self.assertFalse(plan['execution_implemented'])
        self.assertIn('resource capacity and usage fit', plan['checks_not_performed'][1])
        self.assertEqual(plan['action'], 'deploy_revision')
        self.assertEqual(plan['appname'], spec_identity(desired)[2])
        self.assertEqual(plan['deploy_argv'][0:5],
                         ['eru-cli', 'workload', 'deploy', '--pod', 'eru'])
        self.assertIn('logical_app: "hello-api"', plan['eru_spec'])
        self.assertIn('spec_sha256:', plan['eru_spec'])
        self.assertFalse(any('remove' in item for item in plan['deploy_argv']))

    def test_identical_desired_revision_is_a_noop(self):
        desired = spec()
        plan = build_plan(desired, snapshot([workload(desired)]))
        self.assertEqual(plan['decision'], 'reviewable')
        self.assertFalse(plan['executable'])
        self.assertEqual(plan['action'], 'no_op')
        self.assertEqual(len(plan['current_revision']), 1)

    def test_partial_or_duplicate_revision_is_uncertain_and_never_retried(self):
        desired = spec()
        _, digest, appname = spec_identity(desired)
        partial = build_plan(desired, snapshot([workload(desired, spec_hash=digest, appname=appname + 'x')]))
        self.assertFalse(partial['executable'])
        self.assertEqual(partial['action'], 'reconcile_uncertain_revision')
        duplicate = build_plan(desired, snapshot([workload(desired),
            {**workload(desired), 'id': workload(desired)['id'] + '_duplicate'}]))
        self.assertFalse(duplicate['executable'])
        self.assertEqual(duplicate['action'], 'reconcile_uncertain_revision')

    def test_release_name_occupied_by_foreign_or_wrong_digest_workload_blocks(self):
        desired = spec(); _, digest, appname = spec_identity(desired)
        foreign = workload(desired, spec_hash=digest, appname=appname, owner='someone-else')
        plan = build_plan(desired, snapshot([foreign]))
        self.assertFalse(plan['executable'])
        self.assertEqual(plan['action'], 'blocked')
        self.assertTrue(any('unverified ownership' in item for item in plan['blockers']))

    def test_unowned_workload_claiming_same_logical_name_blocks(self):
        row = workload(spec())
        row['id'] = 'foreign_workload_web_one'
        row['labels']['owner'] = 'another-system'
        plan = build_plan(spec(), snapshot([row]))
        self.assertFalse(plan['executable'])
        self.assertEqual(plan['action'], 'blocked')
        self.assertTrue(any('without this operator ownership' in item for item in plan['blockers']))

    def test_old_owned_revision_is_retained_for_explicit_cleanup(self):
        old = spec(); old['image'] = 'registry.example/hello@sha256:' + 'b' * 64
        row = workload(old)
        plan = build_plan(spec(), snapshot([row]))
        self.assertEqual(plan['decision'], 'reviewable')
        self.assertFalse(plan['executable'])
        self.assertEqual(plan['action'], 'deploy_revision')
        self.assertEqual([item['id'] for item in plan['older_owned_revisions']], [row['id']])
        self.assertTrue(any('separate exact-ID cleanup plan' in step for step in plan['steps']))

    def test_missing_expected_pod_blocks_plan(self):
        state = snapshot(); state['pods'] = []
        plan = build_plan(spec(), state)
        self.assertEqual(plan['decision'], 'blocked')
        self.assertIn('expected eru pod is missing from snapshot', plan['blockers'])

    def test_target_availability_is_a_hard_gate(self):
        plan = build_plan(spec(), snapshot(available=False))
        self.assertFalse(plan['executable'])
        self.assertEqual(plan['decision'], 'blocked')
        self.assertEqual(plan['action'], 'blocked')
        self.assertIn('target node is not available', plan['blockers'])

    def test_snapshot_observation_time_and_row_order_do_not_change_binding(self):
        second = workload()
        second['id'] += '-other'
        state = snapshot([workload(), second])
        state['pods'].append({'name': 'other-pod'})
        state['nodes'].append({'name': 'worker-3', 'available': True})
        state['at'] = '2026-09-25T00:00:00Z'
        state['hosts'] = {'control': {'private_ip': '100.64.1.1', 'detail': 'private'}}
        reversed_state = copy.deepcopy(state)
        reversed_state['at'] = '2026-09-25T00:00:05Z'
        reversed_state['pods'].reverse()
        reversed_state['nodes'].reverse()
        reversed_state['workloads'].reverse()
        self.assertEqual(snapshot_binding(state), snapshot_binding(reversed_state))
        self.assertEqual(build_plan(spec(), state)['snapshot_sha256'],
                         build_plan(spec(), reversed_state)['snapshot_sha256'])
        changed_state = copy.deepcopy(state)
        changed_state['hosts']['control']['private_ip'] = '100.64.1.2'
        self.assertNotEqual(snapshot_binding(state), snapshot_binding(changed_state))

    def test_snapshot_change_changes_plan_binding(self):
        first = build_plan(spec(), snapshot())
        second = build_plan(spec(), snapshot(available=False))
        self.assertNotEqual(first['snapshot_sha256'], second['snapshot_sha256'])
        self.assertNotEqual(first['plan_sha256'], second['plan_sha256'])

    def test_spec_yaml_escapes_user_supplied_command_strings(self):
        desired = spec(); desired['command'] = ['sh', '-c', 'echo: "hello"']
        normalized, digest, appname = spec_identity(desired)
        output = render_eru_spec(normalized, digest, appname)
        self.assertIn('["sh", "-c", "echo: \\\"hello\\\""]', output)
        self.assertIn('appname: "' + appname + '"', output)
        with self.assertRaisesRegex(ValueError, 'identity differs'):
            render_eru_spec(normalized, '0' * 64, appname)


if __name__ == '__main__':
    unittest.main()
