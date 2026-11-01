"""Local storage/crash tests with a synthetic semantic replay loader boundary.

Real generation derivation, safe private I/O, journals, reservation and locks run;
these tests do not establish replay validators or public driver integration.
"""
import base64
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

from app_desired import canonical_bytes
import fresh_generation as contract
import fresh_generation_ops as ops
from fresh_bootstrap_render import build_render
from fresh_execution_ops import PrivateFiles
from fresh_rebuild import ACCEPTANCE_CHECKS, TOPOLOGY, plan_digest
from fresh_run_lock import FreshRunLock
import pending_generation as pending
from test_fresh_bootstrap_render import fixture
import test_fresh_generation as timing_fixture


class GenerationStorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.project = Path(self.tmp.name); (self.project/'private').mkdir(mode=0o700)
        self.now = datetime(2026,10,6,0,7,tzinfo=timezone.utc)
        self.run = 'run-1'; self.replay_sha = '9'*64
        inventory = [{'alias':a,'node':n,'role':r,'ip':'100.80.0.'+str(i+1)} for i,(a,n,r) in enumerate(TOPOLOGY)]
        self.write(contract.PATHS[0],inventory); self.write(contract.PATHS[1],{})
        cluster_ref = self.write(contract.PATHS[2],{'cluster_id':'eru-vps-mvp','generation':1})
        self.before = {p:(self.project/p).read_bytes() for p in contract.PATHS}
        bindings = {'cluster_id':'eru-vps-mvp','run_id':self.run,'generation_before':1,'target_generation':2,
            **{f:'a'*64 for f in pending._HASH_FIELDS},'cluster_sha256':cluster_ref['sha256']}
        pending.reserve(self.project,bindings); self.pending = pending.inspect(self.project)
        access, lock, token, options = fixture()
        access['controller_known_hosts'] = ''.join(h['ip']+' ssh-ed25519 '+base64.b64encode(
            b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20'+bytes([i+1])*32).decode()+'\n' for i,h in enumerate(access['hosts']))
        rendered = build_render(access,lock,token,**options)
        self.timing = timing_fixture.GenerationContractTests().timing()
        fence = self.write('private/fence.json',{'observed_at':self.timing['quiesced_at']})
        def envelope(key,value):
            return {key:value,'sha256':plan_digest(value)}
        self.acceptance = {'schema_version':1,'operation':'fresh-replay-acceptance-evidence',
            'run_id':self.run,'execution_sha256':'a'*64,'pending_sha256':self.pending['sha256'],
            'bootstrap_sha256':'8'*64,'replay_sha256':self.replay_sha,'receipt_sha256':'7'*64,
            'private_identity':self.pending['reservation']['private_identity'],
            'context':{'review':envelope('plan',{'id':'review','generation_before':1,'generation_after':2,
                'series':{'id':'campaign','iteration':1},'scope':{'scope_sha256':'a'*64}}),
                'execution':envelope('execution',{'evidence':{'writer_fence':fence}}),
                'bootstrap':envelope('plan',{'render':rendered}),
                'network':envelope('plan',{'id':'network','render':access}), 'replay':envelope('plan',{'id':'replay'})},
            'checks':{},'evidence_refs':[],
            'timing':{'bootstrap':{'installation_started_at':self.timing['installation_started_at'],
                                  'ready_at':self.timing['v01_completed_at']},
                      'residue_completed_at':self.timing['residue_completed_at']}}
        for gate in sorted(ACCEPTANCE_CHECKS):
            ref = {**self.write('private/evidence-'+gate+'.json',{'gate':gate,'raw_observations':['synthetic-boundary']}),'kind':'json'}
            self.acceptance['checks'][gate] = [ref]; self.acceptance['evidence_refs'].append(ref)
        self.acceptance['evidence_refs'].append({**fence,'kind':'json'})
        for p in contract.PATHS:
            self.acceptance['evidence_refs'].append({'path':p,'sha256':contract.sha(self.before[p]),'kind':'json'})
        timing_binding = ops._binding(self.acceptance)
        queues=[]
        for i,(alias,node,role) in enumerate(TOPOLOGY):
            console_id='console-'+str(i)
            action=self.write('private/console-action-'+str(i)+'.json',{
                'kind':'fresh-console-action','provider_api_used':False,'owner_confirmed':True,
                'binding':{'run_id':self.run},'target':{'alias':alias,'node':node},
                'provider_console_action_ref':console_id,'created_at':self.timing['quiesced_at']})
            receipt=self.write('private/console-receipt-'+str(i)+'.json',{
                'kind':'fresh-console-receipt','provider_api_used':False,'owner_confirmed':True,
                'binding':{'run_id':self.run},'target':{'alias':alias,'node':node},
                'provider_console_action_ref':console_id,'action':action,
                'console_completed_at':self.timing['installation_started_at']})
            self.acceptance['evidence_refs'].extend([{**action,'kind':'json'},{**receipt,'kind':'json'}])
            interval=self.timing['provider_queue_intervals'][i] if i<2 else {
                'started_at':self.timing['quiesced_at'],'completed_at':self.timing['quiesced_at']}
            queues.append(self.write('private/queue-'+str(i)+'.json',{'schema_version':1,
                'operation':'fresh-generation-console-queue','binding':timing_binding,'alias':alias,'node':node,
                'action':action,'receipt':receipt,'provider_console_action_ref':console_id,
                'requested_at':interval['started_at'],'started_at':interval['completed_at'],'owner_confirmed':True}))
        clocks={}
        for kind,start,end,a,b in [('total','quiesced_at','residue_completed_at',0,360),
                                 ('installation','installation_started_at','v01_completed_at',60,300)]:
            clocks[kind]=self.write('private/clock-'+kind+'.json',{'schema_version':1,
                'operation':'fresh-generation-clock-interval','binding':timing_binding,'kind':kind,
                'observer':'controller','clock_id':'clock-1','started_at':self.timing[start],
                'completed_at':self.timing[end],'started_monotonic_ns':a*1000000000,
                'completed_monotonic_ns':b*1000000000})
        self.proof_document={'schema_version':1,'operation':'fresh-generation-timing-observation',
            'binding':timing_binding,'timing':self.timing,'source':'manual-console-owner-review',
            'owner_confirmed':True,'reviewed_at':self.timing['residue_completed_at'],
            'console_queues':queues,'clock_intervals':clocks}
        proof=self.write('private/timing-observation.json',self.proof_document)
        self.input_document={'schema_version':1,'operation':'fresh-generation-timing','binding':timing_binding,
            'timing':self.timing,'proofs':[proof]}
        self.input=self.write('private/timing-input.json',self.input_document)
        self.refresh_renewal()
        loader = types.SimpleNamespace(load_acceptance=self.load_acceptance)
        mocked = patch.dict('sys.modules',{'fresh_replay_ops':loader}); mocked.start(); self.addCleanup(mocked.stop)

    def write(self,path,value):
        target = self.project/path; target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        target.write_bytes(canonical_bytes(value)); target.chmod(0o600)
        return {'path':path,'sha256':contract.sha(target.read_bytes())}

    def refresh_renewal(self):
        target={'run_id':self.run,'replay_sha':self.replay_sha,
            'input_file':self.input['path'],'input_sha':self.input['sha256']}
        self.renewal_document={'schema_version':1,'kind':'fresh-run-step-renewal','authority':'owner',
            'approved':True,'owner_confirmed':True,'binding':{'run_id':self.run,'execution_sha256':'a'*64,
                'pending_sha256':self.pending['sha256'],'plan_id':'network',
                'plan_sha256':self.acceptance['context']['network']['sha256'],'operation':'prepare_generation',
                'target_sha256':plan_digest(target)},'target':target,'admission_request':None,
            'issued_at':'2026-10-06T00:06:00+00:00','expires_at':'2026-10-06T00:21:00+00:00',
            'manual_authorizations':[],'writer_fence':self.acceptance['context']['execution']['execution']['evidence']['writer_fence']}
        self.renewal=self.write('private/generation-renewal.json',self.renewal_document)

    def load_acceptance(self,project,run,digest,**kwargs):
        self.assertEqual((Path(project),run,digest),(self.project,self.run,self.replay_sha))
        files = PrivateFiles(project,max_bytes=ops.LIMIT)
        try:
            for ref in self.acceptance['evidence_refs']:
                if files.read(ref['path'])[2] != ref['sha256']:
                    raise ValueError('synthetic replay original raw proof changed')
            files.recheck()
        finally:
            files.close()
        return copy.deepcopy(self.acceptance)

    def prepare(self):
        with FreshRunLock(self.project,self.pending) as lock:
            with patch.object(ops,'_assert_current',return_value=types.SimpleNamespace(pending=self.pending,lock=lock,ref=self.renewal)):
                result = ops.prepare_generation(self.project,self.run,self.replay_sha,self.input['path'],self.input['sha256'],now=self.now)
        self.assertEqual(result['status'],'generation-prepared',result)
        self.generation_sha = result['generation_sha256']
        return result

    def finalize(self):
        with FreshRunLock(self.project,self.pending) as lock:
            with patch.object(ops,'_assert_current',return_value=types.SimpleNamespace(pending=self.pending,lock=lock,ref=self.renewal)):
                return ops.finalize_generation(self.project,self.run,self.generation_sha,now=self.now)

    def test_fixed_commit_seal_order_and_independent_barrier_read(self):
        self.prepare()
        self.assertEqual(ops.inspect_generation(self.project,self.run,self.generation_sha,now=self.now)['status'],'before')
        result = self.finalize(); self.assertEqual(result['status'],'completed')
        self.assertEqual(json.loads((self.project/contract.PATHS[2]).read_text())['generation'],2)
        self.assertEqual(pending.inspect(self.project)['status'],'completed')
        observed=ops.inspect_generation(self.project,self.run,self.generation_sha,now=self.now)
        self.assertFalse(observed['stage_accepted']); self.assertFalse(observed['generation_changed'])
        self.assertTrue(observed['generation_committed']); self.assertTrue(observed['barrier_completed'])
        fd = os.open(self.project/'private',os.O_RDONLY|os.O_DIRECTORY)
        try:
            pending.assert_no_pending(fd,project=self.project)
            with self.assertRaises(RuntimeError): pending.assert_no_pending(fd)
        finally: os.close(fd)
        proof = ops.verify_completed(self.project,self.run,now=self.now)
        self.assertEqual(proof['original_pending'],self.pending)
        ref = {'path':ops.ACCEPTED+'/review.json','sha256':contract.sha((self.project/ops.ACCEPTED/'review.json').read_bytes())}
        self.assertTrue(ops.verify_accepted_lineage(self.project,ref,now=self.now)['historical_integrity'])

    def test_every_crash_prefix_is_read_only_then_locally_finalizable(self):
        self.prepare()
        original = ops._replace
        for fail_after in (0,1,2):
            # Continue the same interrupted run, never roll back files.
            calls = []
            def replace(files,path,before,raw):
                if len(calls) == 1: raise OSError('synthetic lost local response')
                original(files,path,before,raw); calls.append(path)
            with patch.object(ops,'_replace',side_effect=replace):
                result = self.finalize()
            if fail_after < 2: self.assertEqual(result['status'],'blocked')
            before = {str(p.relative_to(self.project)):p.read_bytes() for p in self.project.rglob('*') if p.is_file()}
            state = ops.inspect_generation(self.project,self.run,self.generation_sha,now=self.now)
            after = {str(p.relative_to(self.project)):p.read_bytes() for p in self.project.rglob('*') if p.is_file()}
            self.assertEqual(before,after)
            self.assertIn(state['status'],('prefix','completed'))
            if state['status']=='completed': break
        self.assertEqual(json.loads((self.project/contract.PATHS[2]).read_text())['generation'],2)

    def test_all_after_lost_seal_never_increments_twice(self):
        self.prepare()
        original = ops._seal
        def seal(files,run,name,value):
            if name=='commit': raise OSError('synthetic lost commit publication')
            return original(files,run,name,value)
        with patch.object(ops,'_seal',side_effect=seal): self.assertEqual(self.finalize()['status'],'blocked')
        self.assertEqual(ops.inspect_generation(self.project,self.run,self.generation_sha,now=self.now)['status'],'all-after')
        with patch.object(ops,'_replace',side_effect=AssertionError('all-after must never write again')):
            self.assertEqual(self.finalize()['status'],'completed')

    def test_foreign_mixture_and_raw_tamper_stay_blocked(self):
        self.prepare()
        path = self.project/contract.PATHS[2]
        self.write(contract.PATHS[2],{'cluster_id':'eru-vps-mvp','generation':2})
        self.assertEqual(self.finalize()['status'],'blocked')
        self.assertEqual(pending.inspect(self.project)['status'],'pending')
        self.assertEqual(ops.inspect_generation(self.project,self.run,self.generation_sha,now=self.now)['status'],'blocked')

    def test_completion_corruption_retains_reservation_and_blocks(self):
        self.prepare(); self.assertEqual(self.finalize()['status'],'completed')
        old = (self.project/'private/pending-generation/reservation.json').read_bytes()
        self.write('private/pending-generation/completion.json',{'completed':True})
        self.assertEqual(pending.inspect(self.project),{'status':'invalid','blocked':True})
        self.assertEqual((self.project/'private/pending-generation/reservation.json').read_bytes(),old)

    def test_index_raw_tampering_and_gate_removal_are_rejected(self):
        self.prepare()
        ref = self.acceptance['checks']['V04'][0]
        (self.project/ref['path']).write_bytes(b'{}')
        self.assertEqual(self.finalize()['status'],'blocked')
        with self.assertRaises(ValueError):
            ops.verify_transition(self.project,self.run,self.generation_sha,self.pending,now=self.now)

    def test_missing_gate_never_prepares(self):
        del self.acceptance['checks']['V03']
        with FreshRunLock(self.project,self.pending) as lock:
            with patch.object(ops,'_assert_current',return_value=types.SimpleNamespace(pending=self.pending,lock=lock,ref=self.renewal)):
                result = ops.prepare_generation(self.project,self.run,self.replay_sha,self.input['path'],self.input['sha256'],now=self.now)
        self.assertEqual(result['status'],'blocked')
        self.assertFalse((self.project/ops.AREA).exists())

    def test_caller_pass_is_not_receipt_evidence(self):
        self.acceptance['checks']['V04']='passed'
        with self.assertRaises(ValueError): ops._acceptance(self.project,self.run,self.replay_sha,self.now,None)

    def test_unrenewed_public_prepare_cannot_create_records(self):
        result = ops.prepare_generation(self.project,self.run,self.replay_sha,self.input['path'],self.input['sha256'],now=self.now)
        self.assertEqual(result['status'],'blocked'); self.assertFalse((self.project/ops.AREA).exists())
