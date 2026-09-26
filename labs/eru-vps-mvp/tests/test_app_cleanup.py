"""Offline exact-ID old revision cleanup state-machine tests."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

TESTS = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS))
sys.path.insert(0, str(TESTS.parent / 'scripts'))
from app_cleanup import AppRevisionCleanup
from app_executor import AppExecutor, UncertainExecution, execution_plan, plan_digest
from test_app_executor import FakeEruAPI, snapshot, spec, workload


class AppRevisionCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'private/operations/apps'
        self.source_id = '20260925T123000Z-source01'
        self.cleanup_id = '20260925T123100Z-clean001'

    def deployment_with_prior(self, **kwargs):
        older = spec()
        older['image'] = 'registry.example/hello@sha256:' + 'b' * 64
        previous = workload(older)
        api = FakeEruAPI(snapshot([previous]), **kwargs)
        plan = execution_plan(spec(), api.snapshot(), True, (), self.source_id)
        executor = AppExecutor(self.root, api)
        result = executor.execute(plan, plan['plan_sha256'])
        self.assertEqual(result['status'], 'complete')
        return api, executor, previous, result

    def make_plan(self, api):
        cleanup = AppRevisionCleanup(self.root, api)
        plan = cleanup.plan(self.source_id, self.cleanup_id)
        self.assertTrue(plan['executable'])
        self.assertEqual(len(plan['targets']), 1)
        return cleanup, plan

    def test_exact_old_revision_is_removed_only_after_new_revision_is_ready(self):
        api, executor, old, deployed = self.deployment_with_prior()
        cleanup, plan = self.make_plan(api)
        self.assertEqual(plan['targets'][0]['id'], old['id'])
        self.assertEqual(api.removed, [])
        result = cleanup.execute(plan, plan['plan_sha256'])
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['removed_ids'], [old['id']])
        self.assertEqual(api.removed, [old['id']])
        self.assertEqual([row['id'] for row in api.live['workloads']],
                         deployed['observed_workload_ids'])
        self.assertTrue(all(probe['passed'] for probe in result['new_revision_probes']))
        source_journal = json.loads(executor.run_path(self.source_id).read_text())
        self.assertEqual(source_journal['status'], 'complete')

    def test_cleanup_plan_requires_completed_http_ready_source_run(self):
        older = spec()
        older['image'] = 'registry.example/hello@sha256:' + 'b' * 64
        api = FakeEruAPI(snapshot([workload(older)]), interrupt_probe=True)
        plan = execution_plan(spec(), api.snapshot(), True, (), self.source_id)
        executor = AppExecutor(self.root, api)
        with self.assertRaises(KeyboardInterrupt):
            executor.execute(plan, plan['plan_sha256'])
        cleanup = AppRevisionCleanup(self.root, api)
        with self.assertRaisesRegex(ValueError, 'completed ready'):
            cleanup.plan(self.source_id, self.cleanup_id)
        self.assertEqual(api.removed, [])

    def test_snapshot_drift_after_cleanup_plan_blocks_remove(self):
        api, _, old, _ = self.deployment_with_prior()
        cleanup, plan = self.make_plan(api)
        api.live['workloads'][0]['labels']['owner'] = 'foreign'
        with self.assertRaisesRegex(ValueError, 'snapshot changed'):
            cleanup.execute(plan, plan['plan_sha256'])
        journal = json.loads(cleanup.journal_path(self.cleanup_id).read_text())
        self.assertEqual(journal['status'], 'failed')
        self.assertEqual(api.removed, [])

    def test_tampered_target_is_rejected_even_when_rehashed(self):
        api, _, old, _ = self.deployment_with_prior()
        cleanup, plan = self.make_plan(api)
        plan['targets'][0]['id'] = 'foreignapp_web_one'
        plan['plan_sha256'] = plan_digest(plan)
        with self.assertRaisesRegex(ValueError, 'exact reviewed app state'):
            cleanup.execute(plan, plan['plan_sha256'])
        self.assertEqual(api.removed, [])

    def test_http_readiness_failure_retains_old_revision(self):
        api, _, old, _ = self.deployment_with_prior()
        cleanup, plan = self.make_plan(api)
        api.probe_result = {'status': 503, 'body_match': False}
        with self.assertRaisesRegex(RuntimeError, 'new revision is not ready'):
            cleanup.execute(plan, plan['plan_sha256'])
        journal = json.loads(cleanup.journal_path(self.cleanup_id).read_text())
        self.assertEqual(journal['status'], 'failed')
        self.assertEqual(journal['reason'], 'new_revision_http_readiness_failed')
        self.assertIn(old['id'], [row['id'] for row in api.live['workloads']])
        self.assertEqual(api.removed, [])

    def test_lost_remove_reply_with_target_absent_is_reconciled_without_replay(self):
        api, _, old, _ = self.deployment_with_prior(fail_remove_after=True)
        cleanup, plan = self.make_plan(api)
        result = cleanup.execute(plan, plan['plan_sha256'])
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(api.removed, [old['id']])
        self.assertIn('remove_reply_lost_target_absent',
                      [event['event'] for event in result['events']])

    def test_lost_remove_reply_with_target_present_is_uncertain_and_read_only(self):
        api, _, old, _ = self.deployment_with_prior(fail_remove_before=True)
        cleanup, plan = self.make_plan(api)
        with self.assertRaises(UncertainExecution):
            cleanup.execute(plan, plan['plan_sha256'])
        self.assertEqual(api.removed, [old['id']])
        journal = json.loads(cleanup.journal_path(self.cleanup_id).read_text())
        self.assertEqual(journal['status'], 'uncertain')
        before = len(api.removed)
        observed = cleanup.reconcile(self.cleanup_id)
        self.assertEqual(api.removed[before:], [])
        self.assertTrue(observed['reconciliation']['read_only'])
        self.assertFalse(observed['reconciliation']['remove_replayed'])
        self.assertEqual(observed['reconciliation']['targets'][0]['state'], 'matches_target')
        with self.assertRaisesRegex(ValueError, 'already has a journal'):
            cleanup.execute(plan, plan['plan_sha256'])
        self.assertEqual(api.removed, [old['id']])

    def test_fresh_plan_after_partial_cleanup_contains_only_remaining_exact_ids(self):
        older = spec()
        older['replicas'] = 2
        older['image'] = 'registry.example/hello@sha256:' + 'b' * 64
        first = workload(older)
        second = dict(first, id=first['id'].rsplit('_', 1)[0] + '_two')
        api = FakeEruAPI(snapshot([first, second]))
        plan = execution_plan(spec(), api.snapshot(), True, (), self.source_id)
        AppExecutor(self.root, api).execute(plan, plan['plan_sha256'])

        api.live['workloads'] = [row for row in api.live['workloads']
                                 if row['id'] != first['id']]
        cleanup = AppRevisionCleanup(self.root, api)
        fresh = cleanup.plan(self.source_id, '20260925T123200Z-clean002')

        self.assertTrue(fresh['executable'])
        self.assertEqual(fresh['targets'], [
            {'id': second['id'], 'node': older['node'],
             'spec_sha256': first['labels']['spec_sha256']},
        ])
        self.assertEqual(api.removed, [])
        result = cleanup.execute(fresh, fresh['plan_sha256'])
        self.assertEqual(result['removed_ids'], [second['id']])
        self.assertEqual(api.removed, [second['id']])

    def test_identity_drift_on_an_unrelated_workload_stops_after_one_remove(self):
        older = spec()
        older['replicas'] = 2
        older['image'] = 'registry.example/hello@sha256:' + 'b' * 64
        first = workload(older)
        second = copy.deepcopy(first)
        second['id'] = first['id'].rsplit('_', 1)[0] + '_two'
        other_spec = spec()
        other_spec['name'] = 'metrics-api'
        unrelated = workload(other_spec)

        class DriftAfterFirstRemoveAPI(FakeEruAPI):
            def remove_exact(self, workload_id):
                super().remove_exact(workload_id)
                if len(self.removed) == 1:
                    row = next(row for row in self.live['workloads']
                               if row['id'] == unrelated['id'])
                    row['labels']['owner'] = 'foreign'

        api = DriftAfterFirstRemoveAPI(snapshot([first, second, unrelated]))
        app_plan = execution_plan(spec(), api.snapshot(), True, (), self.source_id)
        AppExecutor(self.root, api).execute(app_plan, app_plan['plan_sha256'])
        cleanup = AppRevisionCleanup(self.root, api)
        plan = cleanup.plan(self.source_id, self.cleanup_id)
        self.assertEqual([row['id'] for row in plan['targets']],
                         [first['id'], second['id']])

        with self.assertRaisesRegex(RuntimeError, 'post-remove state changed'):
            cleanup.execute(plan, plan['plan_sha256'])

        journal = json.loads(cleanup.journal_path(self.cleanup_id).read_text())
        live_ids = {row['id'] for row in api.live['workloads']}
        self.assertEqual(journal['status'], 'needs_review')
        self.assertEqual(api.removed, [first['id']])
        self.assertIn(second['id'], live_ids)
        self.assertIn(unrelated['id'], live_ids)

    def test_final_identity_audit_catches_drift_after_last_remove_audit(self):
        older = spec()
        older['image'] = 'registry.example/hello@sha256:' + 'b' * 64
        old = workload(older)
        other_spec = spec()
        other_spec['name'] = 'metrics-api'
        unrelated = workload(other_spec)

        class DriftOnFinalProbeAPI(FakeEruAPI):
            drifted = False

            def probe(self, row, desired):
                result = super().probe(row, desired)
                if self.removed and not self.drifted:
                    current = next(item for item in self.live['workloads']
                                   if item['id'] == unrelated['id'])
                    current['nodename'] = 'worker-3'
                    self.drifted = True
                return result

        api = DriftOnFinalProbeAPI(snapshot([old, unrelated]))
        app_plan = execution_plan(spec(), api.snapshot(), True, (), self.source_id)
        AppExecutor(self.root, api).execute(app_plan, app_plan['plan_sha256'])
        cleanup = AppRevisionCleanup(self.root, api)
        plan = cleanup.plan(self.source_id, self.cleanup_id)

        with self.assertRaisesRegex(RuntimeError, 'final workload identities'):
            cleanup.execute(plan, plan['plan_sha256'])

        journal = json.loads(cleanup.journal_path(self.cleanup_id).read_text())
        self.assertEqual(journal['status'], 'needs_review')
        self.assertEqual(api.removed, [old['id']])
        self.assertTrue(api.drifted)


if __name__ == '__main__':
    unittest.main()
