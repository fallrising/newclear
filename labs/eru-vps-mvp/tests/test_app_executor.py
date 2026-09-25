"""Exercise app hash/journal execution with an in-memory Eru adapter only."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from app_desired import OWNER, canonical_bytes, sha256, snapshot_binding, spec_identity
from app_executor import AppExecutor, UncertainExecution, execution_plan


def spec():
    return {
        'schema_version': 1, 'name': 'hello-api',
        'image': 'registry.example/hello@sha256:' + 'a' * 64,
        'node': 'worker-2', 'replicas': 1, 'entrypoint': 'web',
        'command': ['python', '-m', 'http.server', '8080'], 'restart': 'always',
        'resources': {'cpu': 0.25, 'memory': '128M', 'storage': '256M'},
        'network': 'eru',
        'service': {'port': 8080, 'path': '/', 'expected_status': 200, 'body_contains': 'ready'},
        'stateless': True,
    }


def snapshot(workloads=None, available=True):
    return {'pods': [{'name': 'eru'}],
            'nodes': [{'name': 'worker-2', 'available': available}],
            'workloads': copy.deepcopy(workloads or [])}


def workload(document=None):
    document = document or spec()
    _, digest, appname = spec_identity(document)
    return {'id': appname + '_web_one', 'nodename': document['node'],
            'labels': {'owner': OWNER, 'logical_app': document['name'], 'spec_sha256': digest}}


class FakeEruAPI:
    def __init__(self, initial, fail_after_create=False, fail_before_create=False,
                 create_count=None, probe_result=None, interrupt_probe=False):
        self.live = copy.deepcopy(initial)
        self.fail_after_create = fail_after_create
        self.fail_before_create = fail_before_create
        self.create_count = create_count
        self.probe_result = probe_result or {'status': 200, 'body': 'ready'}
        self.interrupt_probe = interrupt_probe
        self.deploy_calls = 0
        self.list_calls = 0
        self.probe_calls = []
        self.removed = []
        self.snapshot_calls = 0

    def snapshot(self):
        self.snapshot_calls += 1
        result = copy.deepcopy(self.live)
        result['at'] = 'observation-' + str(self.snapshot_calls)
        return result

    def deploy(self, plan):
        self.deploy_calls += 1
        if self.fail_before_create:
            raise TimeoutError('reply lost before create')
        count = (plan['spec']['replicas'] if self.create_count is None
                 else self.create_count)
        for index in range(count):
            self.live['workloads'].append({
                'id': plan['appname'] + '_web_' + str(index + 1),
                'nodename': plan['spec']['node'],
                'labels': {'owner': OWNER, 'logical_app': plan['logical_app'],
                           'spec_sha256': plan['spec_sha256']},
            })
        if self.fail_after_create:
            raise TimeoutError('reply lost after create')

    def list_revision(self, appname):
        self.list_calls += 1
        return copy.deepcopy([row for row in self.live['workloads']
                              if row['id'].startswith(appname + '_')])

    def probe(self, row, desired):
        self.probe_calls.append(row['id'])
        if self.interrupt_probe:
            raise KeyboardInterrupt()
        return copy.deepcopy(self.probe_result)


class AppExecutorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'private/operations/apps'
        self.run_id = '20260925T123000Z-abcdef12'

    def plan(self, api, document=None, health=True, issues=()):
        return execution_plan(document or spec(), api.snapshot(), health, issues, self.run_id)

    def test_execution_plan_requires_health_consistency_and_stable_snapshot(self):
        api = FakeEruAPI(snapshot())
        blocked_health = self.plan(api, health=False)
        self.assertFalse(blocked_health['executable'])
        self.assertIn('live control-plane health preflight failed', blocked_health['blockers'])
        blocked_state = self.plan(api, issues=['worker runtime differs'])
        self.assertFalse(blocked_state['executable'])
        self.assertIn('cluster consistency preflight: worker runtime differs', blocked_state['blockers'])
        ready = self.plan(api)
        self.assertTrue(ready['executable'])
        self.assertEqual(ready['snapshot_sha256'],
                         sha256(canonical_bytes(snapshot_binding(ready['snapshot']))))
        self.assertEqual(ready['snapshot'], snapshot_binding(ready['snapshot']))
        self.assertNotIn('100.64.1.1', json.dumps(ready))
        self.assertNotIn('detail', json.dumps(ready))

    def test_execution_plan_rejects_malformed_consistency_input(self):
        api = FakeEruAPI(snapshot())
        with self.assertRaisesRegex(ValueError, 'consistency_issues'):
            self.plan(api, issues='worker runtime differs')

    def test_normalized_snapshot_binding_rejects_extra_inventory_fields(self):
        api = FakeEruAPI(snapshot())
        plan = self.plan(api)
        plan['snapshot']['hosts'] = {'private_ip': '100.64.1.1'}
        from app_executor import plan_digest
        plan['plan_sha256'] = plan_digest(plan)
        with self.assertRaisesRegex(ValueError, 'invalid app plan payload'):
            AppExecutor(self.root, api).execute(plan, plan['plan_sha256'])

    def test_concurrent_stale_plans_cannot_create_twice(self):
        api = FakeEruAPI(snapshot())
        plans = [self.plan(api), execution_plan(spec(), api.snapshot(), True, (),
                                               '20260925T123001Z-fedcba98')]
        executor = AppExecutor(self.root, api)

        def run(plan):
            try:
                return executor.execute(plan, plan['plan_sha256'])['status']
            except (RuntimeError, ValueError) as exc:
                return str(exc)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, plans))
        self.assertEqual(results.count('complete'), 1)
        self.assertEqual(api.deploy_calls, 1)
        self.assertTrue(any('already running' in result or 'snapshot changed' in result
                            for result in results if result != 'complete'))

    def test_successful_revision_is_journaled_and_older_release_is_retained(self):
        older = spec()
        older['image'] = 'registry.example/hello@sha256:' + 'b' * 64
        old_workload = workload(older)
        api = FakeEruAPI(snapshot([old_workload]))
        plan = self.plan(api)
        executor = AppExecutor(self.root, api)
        result = executor.execute(plan, plan['plan_sha256'])
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['stage'], 'ready')
        self.assertEqual(result['observed_workload_ids'],
                         [plan['appname'] + '_web_1'])
        self.assertEqual(result['older_owned_revisions_retained'], [old_workload['id']])
        self.assertEqual(api.deploy_calls, 1)
        self.assertEqual(api.removed, [])
        saved = json.loads(executor.run_path(self.run_id).read_text())
        self.assertEqual(saved['plan_sha256'], plan['plan_sha256'])
        self.assertTrue(saved['probes'][0]['passed'])

    def test_lost_create_reply_is_reconciled_without_second_create(self):
        api = FakeEruAPI(snapshot(), fail_after_create=True)
        plan = self.plan(api)
        result = AppExecutor(self.root, api).execute(plan, plan['plan_sha256'])
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(api.deploy_calls, 1)
        self.assertTrue(result['reply_reconciliation']['exact_revision_observed'])
        self.assertIn('created_revision_found_after_lost_reply',
                      [event['event'] for event in result['events']])

    def test_lost_reply_without_visible_create_is_uncertain_and_never_replayed(self):
        api = FakeEruAPI(snapshot(), fail_before_create=True)
        plan = self.plan(api)
        executor = AppExecutor(self.root, api)
        with self.assertRaises(UncertainExecution):
            executor.execute(plan, plan['plan_sha256'])
        self.assertEqual(api.deploy_calls, 1)
        journal = json.loads(executor.run_path(self.run_id).read_text())
        self.assertEqual(journal['status'], 'uncertain')
        self.assertFalse(journal['reply_reconciliation']['exact_revision_observed'])
        with self.assertRaisesRegex(ValueError, 'already exists'):
            executor.execute(plan, plan['plan_sha256'])
        self.assertEqual(api.deploy_calls, 1)

    def test_lost_reply_with_partial_revision_is_uncertain_and_not_retried(self):
        desired = spec(); desired['replicas'] = 2
        api = FakeEruAPI(snapshot(), fail_after_create=True, create_count=1)
        plan = self.plan(api, desired)
        executor = AppExecutor(self.root, api)
        with self.assertRaises(UncertainExecution):
            executor.execute(plan, plan['plan_sha256'])
        journal = json.loads(executor.run_path(self.run_id).read_text())
        self.assertEqual(journal['status'], 'uncertain')
        self.assertEqual(journal['reason'], 'deploy_reply_lost_replica_count_mismatch')
        self.assertEqual(api.deploy_calls, 1)

    def test_success_reply_with_partial_revision_is_uncertain(self):
        desired = spec(); desired['replicas'] = 2
        api = FakeEruAPI(snapshot(), create_count=1)
        plan = self.plan(api, desired)
        executor = AppExecutor(self.root, api)
        with self.assertRaises(UncertainExecution):
            executor.execute(plan, plan['plan_sha256'])
        self.assertEqual(api.deploy_calls, 1)
        journal = json.loads(executor.run_path(self.run_id).read_text())
        self.assertEqual(journal['status'], 'uncertain')

    def test_revision_lookup_failure_after_create_is_uncertain_and_never_retried(self):
        class LookupFails(FakeEruAPI):
            def list_revision(self, appname):
                self.list_calls += 1
                raise TimeoutError('read-only lookup unavailable')

        api = LookupFails(snapshot())
        plan = self.plan(api)
        executor = AppExecutor(self.root, api)
        with self.assertRaises(TimeoutError):
            executor.execute(plan, plan['plan_sha256'])
        journal = json.loads(executor.run_path(self.run_id).read_text())
        self.assertEqual(journal['status'], 'uncertain')
        self.assertEqual(journal['stage'], 'verify_revision')
        self.assertEqual(api.deploy_calls, 1)
        with self.assertRaisesRegex(ValueError, 'already exists'):
            executor.execute(plan, plan['plan_sha256'])
        self.assertEqual(api.deploy_calls, 1)

    def test_tampered_plan_is_rejected_before_journal_or_mutation(self):
        api = FakeEruAPI(snapshot())
        plan = self.plan(api)
        plan['appname'] = 'foreign-app'
        executor = AppExecutor(self.root, api)
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            executor.execute(plan, plan['plan_sha256'])
        self.assertEqual(api.deploy_calls, 0)
        self.assertFalse(executor.run_path(self.run_id).exists())

    def test_snapshot_drift_blocks_create_before_mutation(self):
        api = FakeEruAPI(snapshot())
        plan = self.plan(api)
        api.live['nodes'][0]['available'] = False
        executor = AppExecutor(self.root, api)
        with self.assertRaisesRegex(ValueError, 'snapshot changed'):
            executor.execute(plan, plan['plan_sha256'])
        self.assertEqual(api.deploy_calls, 0)
        journal = json.loads(executor.run_path(self.run_id).read_text())
        self.assertEqual(journal['status'], 'failed')
        self.assertEqual(journal['reason'], 'cluster_snapshot_changed')

    def test_noop_plan_does_not_create_but_still_checks_http(self):
        row = workload()
        api = FakeEruAPI(snapshot([row]))
        plan = self.plan(api)
        self.assertEqual(plan['action'], 'no_op')
        result = AppExecutor(self.root, api).execute(plan, plan['plan_sha256'])
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(api.deploy_calls, 0)
        self.assertEqual(api.probe_calls, [row['id']])

    def test_http_failure_keeps_new_workload_and_records_safe_summary(self):
        api = FakeEruAPI(snapshot(), probe_result={'status': 503, 'body': 'not ready'})
        plan = self.plan(api)
        executor = AppExecutor(self.root, api)
        with self.assertRaisesRegex(RuntimeError, 'readiness failed'):
            executor.execute(plan, plan['plan_sha256'])
        journal = json.loads(executor.run_path(self.run_id).read_text())
        self.assertEqual(journal['status'], 'failed')
        self.assertEqual(journal['reason'], 'http_readiness_failed')
        self.assertFalse(journal['probes'][0]['passed'])
        self.assertEqual(api.deploy_calls, 1)
        self.assertEqual(api.removed, [])
        self.assertNotIn('not ready', json.dumps(journal))

    def test_interrupted_after_create_reconciles_read_only_and_never_redeploys(self):
        api = FakeEruAPI(snapshot(), interrupt_probe=True)
        plan = self.plan(api)
        executor = AppExecutor(self.root, api)
        with self.assertRaises(KeyboardInterrupt):
            executor.execute(plan, plan['plan_sha256'])
        self.assertEqual(api.deploy_calls, 1)
        journal = json.loads(executor.run_path(self.run_id).read_text())
        self.assertEqual(journal['status'], 'uncertain')
        result = executor.reconcile(self.run_id)
        self.assertEqual(result['status'], 'needs_review')
        self.assertTrue(result['reconciliation']['read_only'])
        self.assertFalse(result['reconciliation']['deploy_replayed'])
        self.assertTrue(result['reconciliation']['exact_revision_observed'])
        self.assertEqual(api.deploy_calls, 1)
        self.assertEqual(api.probe_calls, [plan['appname'] + '_web_1'])

    def test_reconcile_when_revision_is_absent_is_read_only(self):
        api = FakeEruAPI(snapshot(), fail_before_create=True)
        plan = self.plan(api)
        executor = AppExecutor(self.root, api)
        with self.assertRaises(UncertainExecution):
            executor.execute(plan, plan['plan_sha256'])
        before_deploy = api.deploy_calls
        result = executor.reconcile(self.run_id)
        self.assertFalse(result['reconciliation']['exact_revision_observed'])
        self.assertEqual(result['status'], 'needs_review')
        self.assertEqual(api.deploy_calls, before_deploy)


if __name__ == '__main__':
    unittest.main()
