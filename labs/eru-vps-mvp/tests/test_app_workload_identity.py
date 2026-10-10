"""Source-derived opaque runtime IDs retain exact app/name/ownership binding."""
import copy
import unittest

import app_desired
import app_executor
import test_app_executor as fixtures


class WorkloadIdentityTests(unittest.TestCase):
    def setUp(self):
        self.spec = fixtures.spec()
        self.row = fixtures.workload(self.spec)
        self.row['name'] = self.row['id']
        self.row['id'] = 'a' * 32
        self.snapshot = fixtures.snapshot([self.row])
        self.plan = app_executor.execution_plan(self.spec, self.snapshot, True,
                                                plan_id='opaque-identity')

    def test_existing_opaque_id_is_noop_and_ready_without_create(self):
        self.assertEqual(self.plan['action'], 'no_op')
        self.assertTrue(self.plan['executable'])
        valid, reason, ids = app_executor._safe_revision_rows([self.row], self.plan)
        self.assertTrue(valid, reason)
        self.assertEqual(ids, [self.row['id']])

    def test_binding_retains_explicit_name_and_detects_name_drift(self):
        bound = app_desired.snapshot_binding(self.snapshot)
        self.assertEqual(bound['workloads'][0]['name'], self.row['name'])
        self.assertEqual(app_desired.snapshot_binding(bound), bound)
        changed = copy.deepcopy(self.snapshot)
        changed['workloads'][0]['name'] = 'foreign_web_one'
        self.assertNotEqual(app_desired.snapshot_binding(changed), bound)

    def test_explicit_foreign_or_malformed_name_cannot_fallback_to_id(self):
        for name in ('foreign_web_one', None, '', 'invalid', 'bad/name_web_one'):
            row = fixtures.workload(self.spec)
            row['name'] = name
            plan = app_executor.execution_plan(self.spec, fixtures.snapshot([row]), True,
                                               plan_id='foreign-identity')
            with self.subTest(name=name):
                self.assertFalse(plan['executable'])
                self.assertFalse(app_executor._safe_revision_rows([row], plan)[0])

    def test_wrong_entrypoint_cannot_claim_current_revision(self):
        row = copy.deepcopy(self.row)
        _, _, appname = app_desired.spec_identity(self.spec)
        row['name'] = appname + '_foreign_one'
        plan = app_executor.execution_plan(self.spec, fixtures.snapshot([row]), True,
                                           plan_id='wrong-entry')
        self.assertFalse(plan['executable'])
        self.assertFalse(app_executor._safe_revision_rows([row], plan)[0])

    def test_legacy_display_id_with_wrong_entrypoint_cannot_claim_revision(self):
        row = fixtures.workload(self.spec)
        _, _, appname = app_desired.spec_identity(self.spec)
        row['id'] = appname + '_foreign_one'
        plan = app_executor.execution_plan(self.spec, fixtures.snapshot([row]), True,
                                           plan_id='legacy-wrong-entry')
        self.assertFalse(plan['executable'])
        self.assertFalse(app_executor._safe_revision_rows([row], plan)[0])

    def test_underscore_entrypoint_rejected_before_source_identity_is_lost(self):
        document = copy.deepcopy(self.spec)
        document['entrypoint'] = 'web_v1'
        with self.assertRaisesRegex(ValueError, 'entrypoint'):
            app_desired.validate_spec(document)


if __name__ == '__main__':
    unittest.main()
