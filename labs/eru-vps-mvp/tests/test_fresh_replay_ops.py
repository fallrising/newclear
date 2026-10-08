"""Immutable coordinator with production host helper; synthetic authority/network seams."""
import copy
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path
import types
import unittest
from unittest.mock import patch

import fresh_replay as contract
import fresh_replay_ops as ops
from fresh_rebuild import plan_digest
from test_fresh_replay_host import Harness


class ReplayJournalTests(unittest.TestCase):
    def setUp(self):
        self.h=Harness(); self.addCleanup(self.h.close)
        self.project=self.h.root/'controller'; self.project.mkdir(mode=0o700)
        (self.project/'private').mkdir(mode=0o700)
        identity=os.stat(self.project/'private')
        self.h.plan['private_identity']=[identity.st_dev,identity.st_ino]
        path='private/input.json'; self.write(path,{})
        self.h.plan['dependencies']=[{'path':path,'sha256':hashlib.sha256((self.project/path).read_bytes()).hexdigest()}]
        for key in ('review','execution','bootstrap','network'):
            name='private/context-'+key+'.json'
            self.write(name,{'plan':{'kind':key},'sha256':'a'*64})
            self.h.plan['context_refs'][key]=name
        self.write('private/operations/fresh-rebuild/bootstrap/synthetic-run/steps/step-21/receipt.json',
                   {'receipt':{'timing':{'installation_started_at':self.h.now.isoformat(),'ready_at':self.h.now.isoformat(),'wall_seconds':0,'candidate_seconds':1800,'provider_queue_seconds':None,'monotonic_seconds':None}}})
        self.digest=plan_digest(self.h.plan); self.h.digest=self.digest
        self.pending={'status':'pending','sha256':'3'*64}
        self.addCleanup(patch.stopall)
        patch.object(ops.pending_generation,'inspect',side_effect=lambda _:copy.deepcopy(self.pending)).start()
        patch.object(ops.authority,'active',return_value=types.SimpleNamespace(historical=False)).start()
        patch.object(ops.authority,'check_current',return_value=None).start()
        patch.object(ops._Session,'derive',side_effect=lambda *a:copy.deepcopy(self.h.plan)).start()
        patch.object(ops._Session,'network_valid',autospec=True,side_effect=self.network_valid).start()
        result=ops.prepare_replay.__wrapped__(self.project,'synthetic-run','4'*64,'5'*64,now=lambda:self.h.now)
        self.assertEqual(result['status'],'replay-planned')
        self.auths={}; self.lost=False

    def write(self,path,value):
        target=self.project/path; target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        for p in self.project.rglob('*'):
            if p.is_dir(): p.chmod(0o700)
        raw=json.dumps(value,sort_keys=True).encode(); target.write_bytes(raw); target.chmod(0o600)
        return hashlib.sha256(raw).hexdigest()

    def network_valid(self,session,value,index,now,*,after=False):
        contract.fresh(value['observed_at'],now)
        if value['services']!=contract.expected_services(): raise ValueError('synthetic current service drift')

    def collector(self,render,keys,*,setup,now,expected_services):
        return {'observed_at':now.isoformat(),'services':expected_services}

    def auth(self,index):
        action=self.h.action(index)
        value={'schema_version':1,'operation':'fresh-replay-authorization',**{k:action[k] for k in contract.BINDING},
               'scope':'fresh-replay-one-step-only','owner_confirmed':True,'authorized_at':self.h.now.isoformat(),
               'expires_at':(self.h.now+timedelta(minutes=15)).isoformat()}
        path='private/auth-'+str(index)+'.json'; sha=self.write(path,value)
        self.auths[index]=(path,sha); return path,sha

    def execute(self,index):
        path,digest=self.auth(index)
        return ops.execute_replay.__wrapped__(self.project,'synthetic-run',self.digest,index,path,digest,
                                             self.h,self.collector,now=lambda:self.h.now)

    def recover(self,index,result):
        return ops.reconcile_replay.__wrapped__(self.project,'synthetic-run',index,result['intent_sha256'],
                                               self.h,self.collector,now=lambda:self.h.now)

    def test_full_fixed_journal_to_private_acceptance_raw_refs(self):
        for i,step in enumerate(self.h.plan['steps']):
            result=self.execute(i)
            self.assertEqual(result['status'],contract.stage(i,self.h.plan['steps']) if step['step'] in ('apps-accept','resources-accept','residue-accept') else 'replay-step-complete',(i,step,result))
            self.h.now+=timedelta(seconds=2)
        proof=ops.load_acceptance(self.project,'synthetic-run',self.digest,now=lambda:self.h.now)
        self.assertEqual(set(proof['checks']),{'V01','V02','V03','V04','residual_node_workload_plugin_capacity'})
        self.assertTrue(all(proof['checks'].values()))
        self.assertEqual(proof['receipt_sha256'],result['receipt_sha256'])
        for ref in proof['evidence_refs']:
            self.assertEqual(ref['sha256'],hashlib.sha256((self.project/ref['path']).read_bytes()).hexdigest())
        self.h.now+=timedelta(days=1)
        writes=list(self.h.writes)
        status=ops.inspect_replay(self.project,'synthetic-run',self.digest,now=lambda:self.h.now)
        self.assertTrue(status['historical_integrity']); self.assertFalse(status['current_network_ready'])
        self.assertEqual(self.h.writes,writes)

    def test_lost_reply_only_observes_original_writer_interval(self):
        self.assertEqual(self.execute(0)['status'],'replay-step-complete')
        dispatch=self.h.dispatch
        def lost(action,digest):
            dispatch(action,digest); raise TimeoutError('synthetic reply lost')
        with patch.object(self.h,'dispatch',side_effect=lost): result=self.execute(1)
        self.assertEqual(result['status'],'uncertain'); count=len(self.h.writes)
        self.assertEqual(self.execute(1)['status'],'uncertain'); self.assertEqual(len(self.h.writes),count)
        self.assertEqual(self.execute(2)['status'],'blocked')
        self.h.now+=timedelta(hours=2)
        recovered=self.recover(1,result)
        self.assertEqual(recovered['status'],'replay-step-complete'); self.assertFalse(recovered['remote_mutation_performed'])
        self.assertEqual(len(self.h.writes),count)

    def test_raw_dependency_or_current_identity_drift_dispatches_zero(self):
        (self.project/'private/input.json').write_bytes(b'{} ')
        self.assertEqual(self.execute(0)['status'],'blocked'); self.assertEqual(self.h.writes,[])

    def test_missing_receipt_never_produces_acceptance_proof(self):
        self.assertEqual(self.execute(0)['status'],'replay-step-complete')
        with self.assertRaises(ValueError): ops.load_acceptance(self.project,'synthetic-run',self.digest,now=lambda:self.h.now)

    def test_current_renewal_missing_dispatches_zero(self):
        with patch.object(ops.authority,'active',return_value=None):
            self.assertEqual(self.execute(0)['status'],'blocked')
        self.assertEqual(self.h.writes,[])

    def test_out_of_order_boolean_and_foreign_pending_dispatch_zero(self):
        self.assertEqual(self.execute(2)['status'],'blocked')
        with self.assertRaises(ValueError): self.execute(True)
        self.pending={'status':'absent'}
        self.assertEqual(self.execute(0)['status'],'blocked'); self.assertEqual(self.h.writes,[])

    def test_unknown_slot_preserved_and_prevents_writer(self):
        self.assertEqual(self.execute(0)['status'],'replay-step-complete')
        target=self.project/ops._path('synthetic-run',0)/'unknown'; target.write_text('retain')
        self.assertEqual(self.execute(1)['status'],'blocked'); self.assertEqual(target.read_text(),'retain')
        self.assertEqual(self.h.writes,[])

    def test_absent_host_reply_recovery_cannot_dispatch_another_create(self):
        self.assertEqual(self.execute(0)['status'],'replay-step-complete')
        with patch.object(self.h,'dispatch',side_effect=TimeoutError('lost before reply')):
            result=self.execute(1)
        self.assertEqual(result['status'],'uncertain')
        self.h.now+=timedelta(hours=1)
        self.assertEqual(self.recover(1,result)['status'],'uncertain')
        self.assertEqual(self.h.writes,[])

    def test_recovery_original_writer_completion_outside_authority_retains_barrier(self):
        self.assertEqual(self.execute(0)['status'],'replay-step-complete')
        dispatch=self.h.dispatch
        def lost(action,digest): dispatch(action,digest);raise TimeoutError('lost')
        with patch.object(self.h,'dispatch',side_effect=lost): result=self.execute(1)
        self.h.now+=timedelta(hours=1)
        path=self.h.roots[0]/'etc/eru/.fresh-bootstrap/replay-synthetic-run/001/complete.json'
        value=json.loads(path.read_text());value['provenance']['completed_at']=self.h.now.isoformat();path.write_text(json.dumps(value))
        self.assertEqual(self.recover(1,result)['status'],'blocked')
        self.assertFalse((self.project/ops._path('synthetic-run',1)/'receipt.json').exists())
        self.assertEqual(self.pending['status'],'pending')

    def test_stale_raw_capture_with_fresh_wrapper_time_dispatches_zero(self):
        observe=self.h.observe
        def stale(action):
            value=observe(action)
            old=(self.h.now-timedelta(minutes=20)).isoformat()
            value['evidence']['captures'][1]['started_at']=old
            value['evidence']['captures'][1]['completed_at']=old
            return value
        with patch.object(self.h,'observe',side_effect=stale):
            self.assertEqual(self.execute(0)['status'],'blocked')
        self.assertEqual(self.h.writes,[])

    def test_exact_predecessor_raw_bytes_tamper_blocks_next_writer(self):
        self.assertEqual(self.execute(0)['status'],'replay-step-complete')
        self.assertEqual(self.execute(1)['status'],'replay-step-complete')
        receipt=self.project/ops._path('synthetic-run',0)/'receipt.json'
        receipt.write_bytes(receipt.read_bytes()+b' ')
        writes=list(self.h.writes)
        self.assertEqual(self.execute(2)['status'],'blocked')
        self.assertEqual(self.h.writes,writes)


    def test_plan_without_any_step_has_explicit_incomplete_acceptance_error(self):
        with self.assertRaisesRegex(ValueError,'complete fixed replay schedule'):
            ops.load_acceptance(self.project,'synthetic-run',self.digest,now=lambda:self.h.now)
        self.assertEqual(self.h.writes,[])


    def test_expired_owner_after_last_local_publication_check_dispatches_zero(self):
        self.assertEqual(self.execute(0)['status'],'replay-step-complete')
        target=ops._path('synthetic-run',1)+'/intent.json'
        original_check=ops._Publications.check
        expired=[False]; dispatches=[]
        def publication_check(publications):
            result=original_check(publications)
            if target in publications.files.seen: expired[0]=True
            return result
        def current_owner():
            if expired[0]: raise ValueError('synthetic owner expired after nested history')
        with patch.object(ops._Publications,'check',publication_check), patch.object(ops.authority,'check_current',side_effect=current_owner), patch.object(self.h,'dispatch',side_effect=lambda *a:dispatches.append(a)):
            result=self.execute(1)
        self.assertTrue(expired[0]);self.assertEqual(result['status'],'blocked')
        self.assertEqual(dispatches,[]);self.assertEqual(self.h.writes,[])

    def test_expired_owner_after_last_local_network_validation_dispatches_zero(self):
        self.assertEqual(self.execute(0)['status'],'replay-step-complete')
        target=ops._path('synthetic-run',1)+'/intent.json'
        expired=[False];dispatches=[]
        def network_valid(session,value,index,now,*,after=False):
            self.network_valid(session,value,index,now,after=after)
            if index==1 and not after and target in session.files.seen: expired[0]=True
        def current_owner():
            if expired[0]: raise ValueError('synthetic owner expired at last writer boundary')
        with patch.object(ops._Session,'network_valid',network_valid), patch.object(ops.authority,'check_current',side_effect=current_owner), patch.object(self.h,'dispatch',side_effect=lambda *a:dispatches.append(a)):
            result=self.execute(1)
        self.assertTrue(expired[0]);self.assertEqual(result['status'],'blocked')
        self.assertEqual(dispatches,[]);self.assertEqual(self.h.writes,[])
