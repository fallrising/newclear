"""Recovery uses fresh plans and actual temporary backups, including lost replies."""
from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import test_labctl as fixtures
import test_core_update as core_fixture
import test_component_reinstall as component_fixture
from core_update import BINARY
from labops import atomic_json, digest
from labctl import ALIASES
from recovery import RecoveryOperator, worker_issues
from worker_reinstall import sha


class OfflineRecovery(RecoveryOperator):
    def __init__(self, project, snapshot, backend):
        super().__init__(project)
        self.live = deepcopy(snapshot)
        self.backend = backend
        self.restarts = self.restores = 0
        self.lost_reply = False
        self.core_api_calls = 0

    def host_snapshot(self): return deepcopy(self.live['hosts'])
    def protected_services(self): return {'protected': 'unchanged'}
    def etcd_ready(self): pass
    def offline_workloads(self): return {'workloads': 0}
    def core_runtime(self, allow_inactive=False):
        if not self.restarts and not allow_inactive: raise RuntimeError('core is offline')
        return {'ActiveState': 'active' if self.restarts else 'failed', 'InvocationID': str(self.restarts),
                'sha256': sha(b'old-binary') if self.restarts else None}
    def snapshot(self):
        self.core_api_calls += 1
        if not self.restarts: raise RuntimeError('core API is unavailable')
        return deepcopy(self.live)
    def remote(self, config):
        if config['action'] == 'inspect-recovery': return self.backend.inspect_recovery(config['source_run'])
        assert config['action'] == 'rollback'
        result = self.backend.rollback(config['source_run'], config['id'], config['expected_recovery'])
        self.restores += 1
        if self.lost_reply: raise TimeoutError('rollback response lost')
        return result
    def command(self, host, argv, stdin=None, **kwargs):
        assert host == ALIASES[0] and argv[-2:] == ['restart', 'eru-core.service']
        self.restarts += 1
        return ''


class OfflineCoreTests(unittest.TestCase):
    def setUp(self):
        lab = fixtures.OperatorTests('test_wrong_supplied_hash_cannot_remove');lab.setUp()
        core = core_fixture.CoreUpdateTests('test_existing_run_cannot_be_replayed');core.setUp()
        self.addCleanup(lab.doCleanups);self.addCleanup(core.doCleanups)
        lab.snapshot['workloads'] = []
        for host in lab.snapshot['hosts'].values(): host.update(containers='', tasks='TASK PID STATUS')
        self.op = OfflineRecovery(lab.project, lab.snapshot, core.updater)
        self.before = core.before
        source = {'id': 'source-run', 'operation': 'core-patch', 'snapshot': deepcopy(lab.snapshot),
                  'bindings': {'inventory': self.op.inventory, 'cluster': self.op.cluster()},
                  'footprint': core.before, 'sha256': sha(b'new-binary')}
        atomic_json(self.op.root / 'plans/source-run.json', {'plan': source, 'sha256': digest(source)})
        atomic_json(self.op.root / 'runs/source-run.json', {'id': 'source-run', 'operation': 'core-patch',
            'plan_hash': digest(source), 'status': 'failed', 'started_at': '2026-09-22T01:00:00+00:00', 'failed_at': 'verifying-core'})
        core.updater.install('source-run', core.before, b'new-binary', sha(b'new-binary'))

    def plan(self): return self.op.make_recovery_plan('source-run', 'core-rollback')
    def execute(self, envelope): return self.op.execute_recovery(envelope['plan']['id'], envelope['sha256'])

    def test_offline_core_can_plan_and_restore_without_calling_core_api_until_restart(self):
        envelope = self.plan()
        self.assertEqual(self.op.core_api_calls, 0)
        result = self.execute(envelope)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual((self.op.restores, self.op.restarts), (1, 1))
        self.assertEqual(self.op.backend.path(BINARY).read_bytes(), b'old-binary')
        self.assertEqual(json.loads((self.op.root / 'runs/source-run.json').read_text())['status'], 'failed')
        with self.assertRaisesRegex(ValueError, 'never replay'): self.execute(envelope)

    def test_lost_restore_reply_does_not_retry_or_restart(self):
        envelope = self.plan();self.op.lost_reply = True
        with self.assertRaisesRegex(TimeoutError, 'response lost'): self.execute(envelope)
        self.assertEqual((self.op.restores, self.op.restarts), (1, 0))
        self.assertEqual(self.op.journal['status'], 'failed')
        self.assertEqual(self.op.journal['failed_at'], 'restoring-core-binary')
        with self.assertRaisesRegex(ValueError, 'never replay'): self.execute(envelope)

    def test_source_journal_changes_block_before_mutation(self):
        envelope = self.plan()
        path = self.op.root / 'runs/source-run.json';record=json.loads(path.read_text());record['reconciled_at']='later'
        atomic_json(path,record)
        with self.assertRaisesRegex(ValueError, 'source journal changed'): self.execute(envelope)
        self.assertEqual((self.op.restores, self.op.restarts), (0, 0))

    def test_new_runtime_or_boot_blocks_offline_plan(self):
        host=self.op.live['hosts'][ALIASES[3]]
        host['containers']='foreign'
        with self.assertRaisesRegex(ValueError, 'empty ERU runtime'): self.plan()
        host['containers']='';host['boot_id']='new-boot'
        with self.assertRaisesRegex(ValueError, 'identity changed'): self.plan()

    def test_later_completed_update_invalidates_original_source(self):
        atomic_json(self.op.root / 'runs/later.json', {'id':'later','operation':'core-patch','status':'complete',
            'started_at':'2026-09-23T01:00:00+00:00'})
        with self.assertRaisesRegex(ValueError, 'superseded'): self.plan()

    def test_backup_corruption_blocks_before_plan(self):
        (self.op.backend.directory('source-run')/'binary.before').write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError, 'checksum'): self.plan()

    def test_replacement_between_binary_and_manifest_is_recoverable_offline(self):
        source=self.op.backend.directory('source-run')
        self.op.backend.path('/var/lib/eru-mvp/owner.json').write_bytes((source/'owner.before').read_bytes())
        self.assertEqual(self.execute(self.plan())['status'],'complete')

    def test_changed_state_between_plan_and_execute_blocks(self):
        envelope=self.plan();self.op.backend.path(BINARY).write_bytes(b'old-binary')
        with self.assertRaisesRegex(ValueError, 'state changed after plan'): self.execute(envelope)
        self.assertEqual((self.op.restores,self.op.restarts),(0,0))

    def test_new_plan_finishes_lost_reply_without_repeating_restore(self):
        envelope=self.plan();self.op.lost_reply=True
        with self.assertRaises(TimeoutError): self.execute(envelope)
        self.op.lost_reply=False
        self.assertEqual(self.execute(self.plan())['status'],'complete')
        self.assertEqual((self.op.restores,self.op.restarts),(1,1))

    def test_a_wrong_supplied_hash_never_creates_a_run(self):
        envelope=self.plan()
        with self.assertRaisesRegex(ValueError,'invalid'):
            self.op.execute_recovery(envelope['plan']['id'],'wrong')
        self.assertFalse((self.op.root/'runs'/(envelope['plan']['id']+'.json')).exists())

    def test_a_later_failed_update_also_prevents_using_an_old_backup(self):
        atomic_json(self.op.root / 'runs/later.json', {'id':'later','operation':'core-patch','status':'failed',
            'started_at':'2026-09-23T01:00:00+00:00'})
        with self.assertRaisesRegex(ValueError,'superseded'): self.plan()

    def test_copied_plan_cannot_execute_under_another_run_identity(self):
        envelope=self.plan()
        atomic_json(self.op.root/'plans/copied-plan.json',envelope)
        with self.assertRaisesRegex(ValueError,'invalid'):
            self.op.execute_recovery('copied-plan',envelope['sha256'])
        self.assertFalse((self.op.root/'runs/copied-plan.json').exists())
        self.assertEqual((self.op.restores,self.op.restarts),(0,0))


class WorkerRecoveryTests(unittest.TestCase):
    def setup_flow(self, action='worker-resume', target='worker-4'):
        import tempfile
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        op=Mock();op.project=Path(temp.name);op.core={'ip':'example.invalid'};op.journal={}
        op.worker_scope.return_value={'blockers':[]}
        before=component_fixture.snapshot(True)
        alias=f'ckc-disposable-0{target[-1]}'
        if target != 'worker-4':
            before['nodes'][0]['name']=target
            before['hosts'][alias]=before['hosts'].pop('ckc-disposable-04')
        op.cli.return_value=before['nodes']
        plan={'id':'new-recovery','source_run':'failed-source','action':action,
              'source':{'plan':{'id':'failed-source','node':target}},'observed':{'snapshot':before,
              'readiness':{'canaries':[]},'protected_services':{},'recovery':{'stage':'installed'}}}
        component=Mock();component.resume_attempted=False
        resumed=deepcopy(before);resumed['nodes'][0]['bypass']=False
        component.check_isolation.side_effect=[before,resumed]
        self.enterContext(patch('recovery.ComponentReinstall',return_value=component))
        self.enterContext(patch('recovery.HTTPGuards',component_fixture.FakeGuards))
        return op,component,plan

    def test_resume_preserves_new_state_and_never_restores_or_counts_reinstall(self):
        op,component,plan=self.setup_flow()
        RecoveryOperator.recover_worker(op,plan)
        component.remote.assert_not_called()
        component.run_smoke.assert_called_once()
        self.assertEqual(op.journal['recovered_source'],'failed-source')
        self.assertFalse((op.project/'private/operations/worker-component-revisions.json').exists())

    def test_peer_resume_uses_selected_node_and_never_changes_worker_four(self):
        op,component,plan=self.setup_flow(target='worker-2')
        RecoveryOperator.recover_worker(op,plan)
        up=component.command.call_args_list[-1]
        self.assertEqual(up.args[1][-2:], ['up','worker-2'])
        op.worker_scope.assert_called_with('ckc-disposable-02')
        self.assertEqual(op.journal['recovered_source'],'failed-source')

    def test_peer_lost_resume_reply_refences_selected_worker(self):
        op,component,plan=self.setup_flow(target='worker-3')
        component.command.side_effect=TimeoutError('up reply lost')
        with self.assertRaisesRegex(TimeoutError,'reply lost'):
            RecoveryOperator.recover_worker(op,plan)
        component.fence.assert_called_with(corrective=True)
        self.assertEqual(op.journal['resume_recovery'],'fenced')
        self.assertNotIn('recovered_source',op.journal)

    def test_restore_references_original_backup_but_uses_new_recovery_id(self):
        op,component,plan=self.setup_flow('worker-restore')
        RecoveryOperator.recover_worker(op,plan)
        component.remote.assert_called_once_with('restore',plan['source']['plan'],extra={
            'recovery_id':'new-recovery','expected_recovery':plan['observed']['recovery']})

    def test_lost_resume_response_refences_once_and_preserves_uncertain_result(self):
        op,component,plan=self.setup_flow()
        component.command.side_effect=TimeoutError('up reply lost')
        with self.assertRaises(TimeoutError): RecoveryOperator.recover_worker(op,plan)
        self.assertEqual(component.fence.call_count,2)
        component.fence.assert_called_with(corrective=True)
        self.assertEqual(op.journal['resume_recovery'],'fenced')
        self.assertNotIn('recovered_source',op.journal)

    def test_failed_corrective_fence_is_not_reported_as_fenced(self):
        op,component,plan=self.setup_flow()
        component.command.side_effect=TimeoutError('up reply lost')
        component.fence.side_effect=[None,TimeoutError('down reply lost')]
        with self.assertRaises(TimeoutError): RecoveryOperator.recover_worker(op,plan)
        self.assertEqual(op.journal['resume_recovery'],'uncertain')

    def test_failed_smoke_never_resumes(self):
        op,component,plan=self.setup_flow()
        component.run_smoke.side_effect=RuntimeError('smoke failed')
        with self.assertRaises(RuntimeError): RecoveryOperator.recover_worker(op,plan)
        component.command.assert_not_called()
        self.assertEqual(component.fence.call_count,1)

    def test_only_target_unavailability_is_allowed(self):
        snapshot=component_fixture.snapshot();snapshot['nodes'][0]['available']=False
        inventory=[{'node':'core','alias':'core'},{'node':'worker-4','alias':'ckc-disposable-04'}]
        self.assertEqual(worker_issues(snapshot,inventory),[])
        snapshot['nodes'][0]['resource_usage']='{"memory":1}'
        self.assertTrue(worker_issues(snapshot,inventory))

    def test_restore_reply_was_lost_start_services_without_repeating_restore(self):
        op,component,plan=self.setup_flow('worker-restore')
        plan['observed']['recovery']['stage']='restored'
        RecoveryOperator.recover_worker(op,plan)
        component.remote.assert_not_called()
        self.assertTrue(any('start' in c.args[1] for c in component.command.call_args_list))

    def test_peer_observation_checks_selected_alias_and_guard_target(self):
        op=Mock()
        snapshot=component_fixture.snapshot(True)
        snapshot['nodes'][0]['name']='worker-2'
        snapshot['hosts']['ckc-disposable-02']=snapshot['hosts'].pop('ckc-disposable-04')
        # Keep another host after the target in iteration order: observing it must not retarget recovery.
        snapshot['hosts']['ckc-disposable-04']=deepcopy(snapshot['hosts']['ckc-disposable-02'])
        op.snapshot.return_value=snapshot
        op.inventory=[{'alias':'ckc-disposable-01','node':'core'},
                      {'alias':'ckc-disposable-02','node':'worker-2'}]
        op.worker_readiness.return_value={'blockers':[]}
        op.worker_state.return_value={'exists':True,'stage':'installed','journal_sha256':'journal',
            'snapshot_sha256':'backup','restore_possible':False}
        op.worker_services.return_value='ActiveState=inactive\n'*3
        op.worker_scope.return_value={'blockers':[],'manifest_sha256':'manifest'}
        source={'plan':{'snapshot':deepcopy(snapshot),'id':'peer-source','node':'worker-2',
                        'component_scope':{'manifest_sha256':'manifest'}}}
        with patch('recovery.ComponentReinstall'):
            result=RecoveryOperator.observe_worker(op,source,'worker-resume','health','canaries')
        op.worker_readiness.assert_called_with('health','canaries',snapshot,'worker-2')
        op.worker_scope.assert_called_with('ckc-disposable-02')
        op.worker_services.assert_called_with(source)
        self.assertEqual(result['recovery']['journal_sha256'],'journal')

    def test_peer_source_plan_and_recovery_hosts_are_bound(self):
        lab=fixtures.OperatorTests('test_wrong_supplied_hash_cannot_remove');lab.setUp()
        self.addCleanup(lab.doCleanups)
        op=RecoveryOperator(lab.project)
        source={'id':'peer-source','operation':'rebuild-node','node':'worker-2',
                'rebuild_mode':'component-reinstall',
                'bindings':{'inventory':op.inventory,'cluster':op.cluster()}}
        atomic_json(op.root/'plans/peer-source.json',{'plan':source,'sha256':digest(source)})
        atomic_json(op.root/'runs/peer-source.json',{'id':'peer-source','operation':'rebuild-node',
            'plan_hash':digest(source),'status':'failed','started_at':'2026-09-24T00:00:00+00:00'})
        self.assertEqual(op.source('peer-source','worker-resume')['plan']['node'],'worker-2')
        with patch.object(op,'observe',return_value={'readiness':{'canaries':[]}}):
            recovery=op.make_recovery_plan('peer-source','worker-resume','health','canaries')['plan']
        self.assertEqual(recovery['mutation_hosts'],['ckc-disposable-01','ckc-disposable-02'])
        source['node']='unknown'
        atomic_json(op.root/'plans/peer-source.json',{'plan':source,'sha256':digest(source)})
        journal=json.loads((op.root/'runs/peer-source.json').read_text());journal['plan_hash']=digest(source)
        atomic_json(op.root/'runs/peer-source.json',journal)
        with self.assertRaisesRegex(ValueError,'reviewed component'):
            op.source('peer-source','worker-resume')

    def test_worker_plan_preserves_new_state_on_resume_but_blocks_restore(self):
        op=Mock();snapshot=component_fixture.snapshot(True)
        old=deepcopy(snapshot)
        op.snapshot.return_value=snapshot
        op.inventory=[{'alias':'core','node':'core'},{'alias':'ckc-disposable-04','node':'worker-4'}]
        op.worker_readiness.return_value={'blockers':[]}
        op.worker_state.return_value={'exists':True,'stage':'installed','journal_sha256':'journal',
            'snapshot_sha256':'backup','tree_sha256':'new-tree','restore_possible':False,'conflicts':['new or changed data: cursor']}
        op.worker_services.return_value='ActiveState=inactive\n'*3
        op.worker_scope.return_value={'blockers':[],'manifest_sha256':'manifest'}
        source={'plan':{'snapshot':old,'id':'source','node':'worker-4','component_scope':{'manifest_sha256':'manifest'}}}
        with patch('recovery.ComponentReinstall'):
            with self.assertRaisesRegex(ValueError,'overwrite new state'):
                RecoveryOperator.observe_worker(op,source,'worker-restore','health','canaries')
            result=RecoveryOperator.observe_worker(op,source,'worker-resume','health','canaries')
            self.assertNotIn('tree_sha256',result['recovery'])
            self.assertEqual(result['recovery']['journal_sha256'],'journal')


class MetadataCountTests(unittest.TestCase):
    def test_actual_fields_format_distinguishes_zero_and_existing_records(self):
        from recovery import count_field
        self.assertEqual(count_field('"Revision" : 42\n"More" : false\n"Count" : 0\n'),0)
        self.assertEqual(count_field('"Count" : 6\n'),6)

    def test_missing_malformed_or_duplicate_count_never_means_empty(self):
        from recovery import count_field
        for output in ['', '{}', '"Count" : -1', '"Count" : many', '"Count" : 0\n"Count" : 1']:
            with self.subTest(output=output), self.assertRaises(ValueError): count_field(output)

    def test_nonempty_metadata_prevents_offline_rollback(self):
        op=Mock();op.command.return_value='"Count" : 1\n'
        with self.assertRaisesRegex(ValueError,'empty workload'):
            RecoveryOperator.offline_workloads(op)
        self.assertTrue(all(c.args[1][-1]=='fields' for c in op.command.call_args_list))
