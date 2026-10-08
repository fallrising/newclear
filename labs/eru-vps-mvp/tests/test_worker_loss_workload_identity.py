"""Loss journals retain verified names without changing legacy raw IDs."""
import copy
import unittest
from app_desired import sha256

from app_desired import snapshot_binding
from worker_loss_executor import _workload_binding


class LossWorkloadBindingTests(unittest.TestCase):
    def test_source_name_is_retained_with_opaque_id(self):
        row = {'id': 'opaque-runtime-id', 'name': 'hello-api-deadbeef_web_runtime',
               'nodename': 'worker-2', 'labels': {'owner': 'eru-vps-mvp'}}
        source = {'workloads': [row]}
        self.assertEqual(_workload_binding(source), [row])
        self.assertEqual(_workload_binding(snapshot_binding(source)), [row])
        self.assertEqual(source, {'workloads': [row]})

    def test_legacy_binding_stays_exact_and_invalid_explicit_name_rejects(self):
        row = {'id': 'hello-api-deadbeef_web_runtime',
               'nodename': 'worker-2', 'labels': {'owner': 'eru-vps-mvp'}}
        self.assertEqual(_workload_binding({'workloads': [row]}), [row])
        for name in (None, '', 0, 'invalid'):
            with self.subTest(name=name):
                invalid = copy.deepcopy(row)
                invalid['name'] = name
                with self.assertRaises(ValueError):
                    _workload_binding({'workloads': [invalid]})

    def test_loss_replacement_and_readonly_recovery_keep_real_name_and_opaque_id(self):
        import test_worker_loss_recovery as fixtures
        from worker_loss_ops import (prepare_replacement_plan,
                                     execute_replacement_plan,
                                     recover_replacement_run)
        fixture = fixtures.WorkerLossRecoveryTests(methodName='runTest')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        api, _, cleanup, _ = fixture.complete_partial_cleanup()
        original_deploy = api.deploy

        def deploy_with_opaque_id(plan):
            before = len(api.live['workloads'])
            original_deploy(plan)
            for row in api.live['workloads'][before:]:
                row['id'] = sha256(row['id'].encode())

        api.deploy = deploy_with_opaque_id
        plan, _ = prepare_replacement_plan(
            fixture.project, cleanup['id'], fixture.input_path, lambda: api,
            plan_id='20261007T100000Z-opaque-loss')
        result = execute_replacement_plan(
            fixture.project, plan['id'], plan['plan_sha256'], fixture.input_path,
            lambda: api)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(len(result['staged_revisions']), 2)
        for row in result['staged_revisions']:
            self.assertEqual(len(row['id']), 64)
            self.assertNotEqual(row['id'], row['name'])
            self.assertIn(row, _workload_binding(api.snapshot()))
        calls = list(api.deploy_calls)
        recovered = recover_replacement_run(fixture.project, plan['id'], lambda: api)
        self.assertTrue(recovered['reconciliation']['read_only'])
        self.assertFalse(recovered['reconciliation']['deploy_replayed'])
        self.assertEqual(api.deploy_calls, calls)
        self.assertEqual(recovered['staged_revisions'], result['staged_revisions'])
