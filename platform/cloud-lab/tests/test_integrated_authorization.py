"""Correlate synthetic management data with self and resident observation boundaries."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from test_collect_authorization import Provider, profile, NOW

ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('integrated_authorization',ROOT/'tools/integrate_authorization.py')
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)

class Management(Provider):
    def __call__(self,request):
        value=super().__call__(request)
        if request['path'].endswith('/settings'):
            value['result']['bindings'].append({'name':'AUDIENCE','type':'plain_text','text':'integration'})
        return value

class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.guard=mock.patch.object(m.auth.files,'require_outside_checkout');self.guard.start();self.addCleanup(self.guard.stop)
        self.provider=Management();self.p=profile();self.paths={};self.calls=[];self.self_mutate=None
        self.fail_roles=set();self.resident_fail=False;self.resident_mutate=None
        for role in ('bot','runner'):
            policy=json.loads(next(g for g in self.provider.grants if g['id']=='grant-'+role)['policy'])
            value=dict(base_url='https://private.example.invalid',audience='integration',credential_id='key-'+role,generation=1,secret_hex='ab'*32,journal_path=str(self.root/(role+'.sqlite')),
                workspace_id=policy['workspace_id'],resource_ref=policy['resource_ref'],recipe_ref=policy['recipe_ref'],cloudflare_access_client_id='PRIVATE-CLIENT',cloudflare_access_client_secret='PRIVATE-SECRET')
            path=self.root/(role+'.json');path.write_text(json.dumps(value));path.chmod(0o600);self.paths[role]=path
    def factory(self,role,config):
        outer=self
        class Client:
            def post(self,path,body):
                outer.calls.append((role,path,body))
                if role in outer.fail_roles:raise m.runner.AuthenticationError('MUST-NOT-ESCAPE')
                grant=next(g for g in outer.provider.grants if g['id']=='grant-'+role);policy=json.loads(grant['policy'])
                result={'schema_version':'cloudlab.authorization-self.v1','observed_at':m.auth.utc(NOW),'request_id':'request-'+role,
                    'credential':{'id':config.credential_id,'generation':config.generation,'principal_id':policy['principal_id'],'grant_id':grant['id'],'revoked':False,'expires_at':m.auth.utc(NOW+7200)},
                    'grant':{key:value for key,value in dict(id=grant['id'],revision=grant['revision'],principal_id=policy['principal_id'],not_before=policy['not_before'],expires_at=policy['expires_at']).items()},
                    'scope':{key:policy[key] for key in ('workspace_id','resource_ref','recipe_ref')}}
                if outer.self_mutate:outer.self_mutate(result,role)
                return result
        return Client()
    def resident(self,path,sock,allow_loopback_http=False):
        if self.resident_fail:raise m.runner.ProtocolError('MUST-NOT-ESCAPE')
        result={'summary':{'source':'resident_process','observed_at':m.auth.utc(NOW),'configured_stop_at':m.auth.utc(NOW+1200),'runner_stop_at':m.auth.utc(NOW+1199),'deadline_complete':False},
                'started_at':m.auth.utc(NOW),'config_sha256':m.runner.read_inspection_config(path)._loaded_sha256,
                'process_identity_sha256':'a'*64,'response_sha256':'b'*64}
        if self.resident_mutate:self.resident_mutate(result)
        return result
    def collect(self,**kwargs):
        with mock.patch.object(m.runner,'observe_resident_evidence',side_effect=self.resident,create=True):
            return m.collect(self.p,self.provider,config_paths=kwargs.pop('config_paths',self.paths),resident_socket=kwargs.pop('resident_socket',self.root/'resident.sock'),self_client_factory=self.factory,clock=lambda:NOW,**kwargs)
    def test_all_sources_correlated_and_no_secrets_or_private_paths(self):
        result=self.collect();snap=result['snapshot'];self.assertEqual(snap['observed_at'],m.auth.utc(NOW))
        self.assertEqual(len(self.provider.calls),10);self.assertEqual(len(self.calls),2)
        row=next(x for x in snap['subjects'] if x['role']=='runner');self.assertEqual(row['runner_stop_at'],m.auth.utc(NOW+1199))
        self.assertEqual(row['credential']['id'],'key-runner')
        report=m.auth.status(snap,now=NOW);self.assertTrue(next(x for x in report['subjects'] if x['role']=='runner')['deadline_complete'])
        self.assertFalse(report['live_verified'])
        for value in ['PRIVATE-CLIENT','PRIVATE-SECRET','ab'*32,str(self.root),'private.example.invalid']:
            self.assertNotIn(value,json.dumps(result))
        self.assertFalse(result['provenance']['route_verified']);self.assertFalse(result['provenance']['business_mutations'])
        self.assertTrue(result['provenance']['nonce_writes_possible'])
    def test_absent_sources_remain_unknown_without_self_requests(self):
        result=self.collect(config_paths={},resident_socket=None)
        self.assertEqual(self.calls,[])
        self.assertTrue(all(x['credential'] is None and x['runner_stop_at'] is None for x in result['snapshot']['subjects']))
        self.assertTrue(all(x['access_service'] is None for x in result['snapshot']['subjects'] if x['role'] in ('bot','runner')))
        self.assertTrue(all(x['layers']['access_service']['state']=='unknown' for x in m.auth.status(result['snapshot'],now=NOW)['subjects'] if x['role'] in ('bot','runner')))
    def test_auth_rejection_preserves_known_grant_and_unknown_credential(self):
        self.fail_roles={'runner'};result=self.collect()
        row=next(x for x in result['snapshot']['subjects'] if x['role']=='runner')
        self.assertIsNone(row['credential']);self.assertIsNone(row['runner_stop_at']);self.assertIsNotNone(row['grant'])
        self.assertEqual(result['provenance']['self']['runner']['outcome'],'authentication_rejected')
        self.assertNotIn('MUST-NOT-ESCAPE',json.dumps(result))
    def test_resident_unavailable_does_not_erase_self_metadata(self):
        self.resident_fail=True;row=next(x for x in self.collect()['snapshot']['subjects'] if x['role']=='runner')
        self.assertIsNotNone(row['credential']);self.assertIsNone(row['runner_stop_at'])
    def test_self_grant_revision_or_principal_conflict_aborts(self):
        for key,value in [('revision',2),('expires_at',m.auth.utc(NOW+8000))]:
            self.provider=Management();self.self_mutate=lambda result,role:result['grant'].update({key:value})
            with self.subTest(key=key),self.assertRaises(m.IntegrationError):self.collect()
    def test_worker_origin_and_audience_mismatch_before_credentials_sent(self):
        for field in ('base_url','audience'):
            path=self.paths['runner'];value=json.loads(path.read_text());old=value[field];value[field]='https://other.example.invalid' if field=='base_url' else 'wrong';path.write_text(json.dumps(value))
            with self.subTest(field=field),self.assertRaises(m.IntegrationError):self.collect()
            self.assertEqual(self.calls,[]);value[field]=old;path.write_text(json.dumps(value))
    def test_selected_token_binding_conflict_aborts(self):
        self.provider.token['client_id']='other-client'
        with self.assertRaises(m.IntegrationError):self.collect()
        self.assertEqual(self.calls,[])
    def test_missing_token_client_metadata_keeps_access_unknown(self):
        del self.provider.token['client_id'];result=self.collect()
        self.assertTrue(all(x['access_service'] is None for x in result['snapshot']['subjects'] if x['role'] in ('bot','runner')))
    def test_post_management_drift_aborts(self):
        def drift(e,req,n):
            if n==7:e['result'][0]['results'][0]['revision']+=1
        self.provider.mutate=drift
        with self.assertRaises(m.IntegrationError):self.collect()
    def test_config_drift_during_self_aborts(self):
        def drift(result,role):
            path=self.paths[role];data=json.loads(path.read_text());data['generation']=2;path.write_text(json.dumps(data))
        self.self_mutate=drift
        with self.assertRaises(m.IntegrationError):self.collect()
    def test_resident_config_identity_mismatch_aborts(self):
        self.resident_mutate=lambda x:x.update(config_sha256='0'*64)
        with self.assertRaises(m.IntegrationError):self.collect()
    def test_old_self_time_is_not_freshened(self):
        self.self_mutate=lambda x,role:x.update(observed_at=m.auth.utc(NOW-100))
        result=self.collect();self.assertEqual(result['snapshot']['observed_at'],m.auth.utc(NOW-100))
        self.assertFalse(m.auth.status(result['snapshot'],now=NOW+201)['snapshot_fresh'])
    def test_bad_or_future_source_is_rejected_not_merged(self):
        self.self_mutate=lambda x,role:x.update(observed_at=m.auth.utc(NOW+121))
        result=self.collect();self.assertTrue(all(x['credential'] is None for x in result['snapshot']['subjects']))
    def test_bad_role_and_nonprivate_config_before_provider(self):
        with self.assertRaises(m.IntegrationError):self.collect(config_paths={'human':self.paths['bot']})
        self.assertEqual(self.provider.calls,[])
        self.paths['bot'].chmod(0o644)
        with self.assertRaises(m.IntegrationError):self.collect()
        self.assertEqual(self.provider.calls,[])
    def test_backward_or_long_collection_rejected(self):
        for end in (NOW-1,NOW+121):
            times=iter([NOW,end])
            with self.assertRaises(m.IntegrationError):
                m.collect(self.p,self.provider,config_paths={},clock=lambda:next(times))
    def test_private_write_status_integrity_and_existing_output(self):
        p=self.root/'profile.json';p.write_text(json.dumps(self.p));p.chmod(0o600);out=self.root/'collection'
        with mock.patch.object(m.runner,'observe_resident_evidence',side_effect=self.resident,create=True):
            saved=m.write_collection(p,out,self.provider,config_paths=self.paths,resident_socket=self.root/'resident.sock',self_client_factory=self.factory,clock=lambda:NOW)
        self.assertTrue(saved['saved']);self.assertEqual(out.stat().st_mode&0o777,0o700)
        for name in ('snapshot.json','provenance.json','manifest.json'):self.assertEqual((out/name).stat().st_mode&0o777,0o600)
        result=m.status(out,now=NOW);self.assertFalse(result['live_verified']);self.assertNotIn('key-runner',json.dumps(result))
        for name in ('snapshot.json','provenance.json'):
            original=(out/name).read_bytes();(out/name).write_bytes(original+b' ')
            with self.assertRaises(m.IntegrationError):m.status(out,now=NOW)
            (out/name).write_bytes(original)
        calls=len(self.provider.calls)
        with self.assertRaises(m.IntegrationError):m.write_collection(p,out,self.provider,clock=lambda:NOW)
        self.assertEqual(len(self.provider.calls),calls)
    def test_failed_collection_has_no_manifest(self):
        p=self.root/'profile.json';p.write_text(json.dumps(self.p));p.chmod(0o600);out=self.root/'collection'
        self.provider.token['client_id']='other'
        with self.assertRaises(m.IntegrationError):m.write_collection(p,out,self.provider,config_paths=self.paths,clock=lambda:NOW)
        self.assertFalse((out/'manifest.json').exists())
    def test_checkout_and_symlink_configs_rejected_before_requests(self):
        self.guard.stop()
        (self.root/'.git').mkdir()
        with self.assertRaises(m.IntegrationError):self.collect()
        self.assertEqual(self.provider.calls,[])
        self.guard.start()
        link=self.root/'linked.json';link.symlink_to(self.paths['runner'])
        with self.assertRaises(m.IntegrationError):self.collect(config_paths={'runner':link})
        self.assertEqual(self.provider.calls,[])
    def test_only_runner_queries_one_self_and_resident(self):
        result=self.collect(config_paths={'runner':self.paths['runner']})
        self.assertEqual([call[0] for call in self.calls],['runner'])
        self.assertEqual(result['provenance']['self']['bot']['outcome'],'not_configured')
        self.assertEqual(result['provenance']['resident']['outcome'],'verified')
        self.assertIsNone(next(x for x in result['snapshot']['subjects'] if x['role']=='bot')['access_service'])
        self.assertEqual(next(x for x in m.auth.status(result['snapshot'],now=NOW)['subjects'] if x['role']=='bot')['layers']['access_service']['state'],'unknown')
    def test_stale_resident_and_late_stop_aborts(self):
        for field,value in [('observed_at',m.auth.utc(NOW-10)),('runner_stop_at',m.auth.utc(NOW+1201))]:
            self.resident_mutate=lambda e:e['summary'].update({field:value})
            with self.subTest(field=field),self.assertRaises(m.IntegrationError):self.collect()
    def test_second_management_token_drift_aborts(self):
        self.provider.mutate=lambda e,r,n:e['result'].update(enabled=False) if n==8 else None
        with self.assertRaises(m.IntegrationError):self.collect()
