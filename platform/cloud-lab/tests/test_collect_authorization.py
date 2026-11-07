"""Synthetic Cloudflare envelopes; no credentials or provider calls."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from test_authorization import snapshot as seed, NOW

ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('authorization_collection',ROOT/'tools/collect_authorization.py')
mod=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(mod)
TOKEN='12345678-1234-4234-8234-123456789abd'


def profile():
    return {'schema_version':'cloudlab.authorization-source.v1','account_id':'a'*32,
            'target':seed()['target'], 'grant_ids':{r:'grant-'+r for r in ('human','bot','runner','scheduler')},
            'service_token_ids':{'bot':TOKEN,'runner':TOKEN}}


class Clock:
    def __init__(self):self.value=NOW
    def __call__(self):v=self.value;self.value+=1;return v


class Provider:
    def __init__(self):
        self.calls=[];self.grants=[];self.active=0;self.enabled=0;self.mutate=None
        for role,grant_id in profile()['grant_ids'].items():
            g=copy.deepcopy(seed()['subjects'][0]['grant']);g['id']=grant_id
            p=json.loads(g['policy']);p['principal_id']='principal-'+role
            p['capabilities']=['dispatch:claim','runs:report'] if role=='runner' else ['commands:read'] if role in ('human','bot') else ['commands:submit','node:health:read']
            g['policy']=json.dumps(p);self.grants.append(g)
        self.token={'id':TOKEN,'enabled':True,'expires_at':'2030-01-01T00:30:00.999Z',
                    'client_id':'PRIVATE-CLIENT','client_secret':'MUST-NOT-ESCAPE'}
    def __call__(self,request):
        self.calls.append(copy.deepcopy(request))
        if request['path'].endswith('/settings'):
            result={'bindings':[{'name':'DB','type':'d1','id':profile()['target']['database_id']},
                                {'name':'MACHINE_KEYS','type':'secret_text'}, {'name':'PUBLIC_ORIGIN','type':'plain_text','text':'https://private.example.invalid'}],
                    'compatibility_date':'2026-10-26'}
        elif request['path'].endswith('/query'):
            result=[{'success':True,'results':copy.deepcopy(self.grants),'meta':{'duration':0.1}},
                    {'success':True,'results':[{'active_commands':self.active}]},
                    {'success':True,'results':[{'enabled_count':self.enabled}]}]
        else:result=copy.deepcopy(self.token)
        envelope={'success':True,'status':200,'result':result}
        if self.mutate:self.mutate(envelope,request,len(self.calls))
        return envelope


class CollectionTests(unittest.TestCase):
    def setUp(self):self.p=profile();self.provider=Provider();self.clock=Clock()
    def collect(self):return mod.collect(self.p,self.provider,clock=self.clock)
    def test_live_metadata_shape_and_unknown_layers(self):
        result=self.collect();snap=result['snapshot'];self.assertEqual(snap['observed_at'],'2030-01-01T00:00:00Z')
        self.assertEqual(len(snap['subjects']),4)
        runner=next(x for x in snap['subjects'] if x['role']=='runner')
        self.assertIsNone(runner['credential']);self.assertIsNone(runner['runner_stop_at'])
        self.assertEqual(runner['access_service']['expires_at'],'2030-01-01T00:30:00Z')
        self.assertEqual(result['provenance']['sources']['credential'],'unavailable_worker_secret_not_readable')
        self.assertFalse(result['provenance']['atomic_snapshot'])
        for secret in ['MUST-NOT-ESCAPE','PRIVATE-CLIENT','private.example.invalid']:
            self.assertNotIn(secret,json.dumps(result))
    def test_only_fixed_read_requests_shared_token_fetched_once(self):
        self.collect();calls=self.provider.calls;self.assertEqual(len(calls),5)
        self.assertEqual([x['method'] for x in calls],['GET','POST','GET','POST','GET'])
        for call in calls:
            self.assertTrue(call['path'].startswith('/accounts/'+'a'*32+'/'))
            if call['method']=='POST':self.assertEqual(call['body'],{'sql':mod.SQL})
        self.assertEqual(mod.SQL.upper().count('SELECT'),3)
        for word in ['UPDATE','DELETE','INSERT','PRAGMA']:self.assertNotIn(word,mod.SQL.upper())
    def test_distinct_selected_tokens_bounded(self):
        other='12345678-1234-4234-8234-123456789abe';self.p['service_token_ids']['bot']=other
        self.provider.mutate=lambda e,r,n:e['result'].update(id=r['path'].split('/')[-1]) if '/service_tokens/' in r['path'] else None
        self.assertEqual(len(self.collect()['provenance']['requests']),6)
    def test_disabled_and_null_expiry_not_invented(self):
        self.provider.token.update(enabled=False,expires_at=None)
        row=next(x for x in self.collect()['snapshot']['subjects'] if x['role']=='runner')
        self.assertEqual(row['access_service'],{'id':TOKEN,'revoked':True,'expires_at':None})
    def test_required_token_metadata_missing_or_wrong_id_refused(self):
        for field,value in [('enabled',None),('id','wrong'),('expires_at','nope')]:
            self.provider=Provider();self.provider.token[field]=value
            with self.subTest(field=field),self.assertRaises(mod.CollectionError):self.collect()
        self.provider=Provider();del self.provider.token['enabled']
        with self.assertRaises(mod.CollectionError):self.collect()
    def test_http_and_inner_query_failure_abort(self):
        def http(e,r,n):e.update(success=False,status=403)
        self.provider.mutate=http
        with self.assertRaises(mod.CollectionError):self.collect()
        self.assertEqual(len(self.provider.calls),1)
        self.provider=Provider()
        def inner(e,r,n):
            if r['method']=='POST':e['result'][1]['success']=False
        self.provider.mutate=inner
        with self.assertRaises(mod.CollectionError):self.collect()
    def test_target_binding_failure_before_query(self):
        def bad(e,r,n):e['result']['bindings'][0]['id']='wrong'
        self.provider.mutate=bad
        with self.assertRaises(mod.CollectionError):self.collect()
        self.assertEqual(len(self.provider.calls),1)
    def test_settings_and_d1_drift_abort(self):
        for kind in ('settings','grant','active','schedule'):
            self.provider=Provider()
            def drift(e,r,n):
                if n==5 and kind=='settings':e['result']['compatibility_date']='2026-10-27'
                if n==4:
                    if kind=='grant':e['result'][0]['results'][0]['revision']+=1
                    if kind=='active':e['result'][1]['results'][0]['active_commands']=1
                    if kind=='schedule':e['result'][2]['results'][0]['enabled_count']=1
            self.provider.mutate=drift
            with self.subTest(kind=kind),self.assertRaises(mod.CollectionError):self.collect()
    def test_order_change_without_content_drift_accepted(self):
        def reorder(e,r,n):
            if n==5:e['result']['bindings'].reverse()
            if n==4:e['result'][0]['results'].reverse()
        self.provider.mutate=reorder
        self.assertTrue(self.collect()['provenance']['pre_post_equal'])
    def test_missing_extra_duplicate_grant_refused(self):
        for mode in ('missing','extra','duplicate'):
            self.provider=Provider()
            if mode=='missing':self.provider.grants.pop()
            if mode=='extra':
                g=copy.deepcopy(self.provider.grants[0]);g['id']='extra';self.provider.grants.append(g)
            if mode=='duplicate':self.provider.grants[0]=copy.deepcopy(self.provider.grants[1])
            with self.subTest(mode=mode),self.assertRaises(mod.CollectionError):self.collect()
    def test_clock_regression_and_total_span_refused(self):
        for delta in (-20,200):
            self.provider=Provider();self.clock=Clock()
            def shift(e,r,n):
                if n==2:self.clock.value+=delta
            self.provider.mutate=shift
            with self.subTest(delta=delta),self.assertRaises(mod.CollectionError):self.collect()
    def test_malformed_profiles_before_network_and_response_size(self):
        for key,value in [('account_id','../../escape'),('target',{'worker_name':'arbitrary','database_id':'bad'}),('old_bundle','/private/secret')]:
            p=profile();p[key]=value;provider=Provider()
            with self.subTest(key=key),self.assertRaises(mod.CollectionError):mod.collect(p,provider,clock=Clock())
            self.assertEqual(provider.calls,[])
        self.provider.token['extra']='x'*65537
        with self.assertRaises(mod.CollectionError):self.collect()
    def test_counts_preserved_to_block_planning(self):
        self.provider.active=1;self.provider.enabled=1
        s=self.collect()['snapshot'];self.assertEqual(s['active_commands'],1);self.assertTrue(s['schedules_enabled'])
        with self.assertRaises(mod.auth.AuthorizationError):mod.auth.make_plan(s,role='runner',action='revoke',now=NOW+20)
    def test_private_output_manifest_and_existing_directory_refusal(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);p=base/'profile.json';p.write_text(json.dumps(self.p));p.chmod(0o600);out=base/'collection'
            with mock.patch.object(mod.auth.files,'require_outside_checkout'):
                result=mod.write_collection(p,out,self.provider,clock=self.clock)
                self.assertTrue(result['saved']);self.assertEqual(out.stat().st_mode&0o777,0o700)
                for name in ('snapshot.json','provenance.json','manifest.json'):
                    self.assertEqual((out/name).stat().st_mode&0o777,0o600)
                manifest=json.loads((out/'manifest.json').read_text());self.assertTrue(manifest['complete'])
                self.provider.calls.clear()
                with self.assertRaises(mod.CollectionError):mod.write_collection(p,out,self.provider,clock=self.clock)
                self.assertEqual(self.provider.calls,[])
    def test_failed_collection_leaves_no_success_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);p=base/'profile.json';p.write_text(json.dumps(self.p));p.chmod(0o600);out=base/'collection'
            self.provider.mutate=lambda e,r,n:e.update(success=False,status=403)
            with mock.patch.object(mod.auth.files,'require_outside_checkout'),self.assertRaises(mod.CollectionError):
                mod.write_collection(p,out,self.provider,clock=self.clock)
            self.assertFalse((out/'manifest.json').exists())
    def test_parent_sync_failure_closes_open_descriptors(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);p=base/'profile.json';p.write_text(json.dumps(self.p));p.chmod(0o600)
            real_open=os.open;opened=set()
            def track(*args,**kwargs):
                fd=real_open(*args,**kwargs);opened.add(fd);return fd
            with mock.patch.object(mod.auth.files,'require_outside_checkout'),mock.patch.object(mod.os,'open',side_effect=track),mock.patch.object(mod.os,'fsync',side_effect=OSError('synthetic sync failure')):
                with self.assertRaises(mod.CollectionError):mod.write_collection(p,base/'collection',self.provider,clock=self.clock)
            for fd in opened:
                with self.assertRaises(OSError):os.fstat(fd)
            self.assertEqual(self.provider.calls,[])
            self.assertFalse((base/'collection'/'manifest.json').exists())

    def test_private_input_symlink_and_checkout_refused_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);p=base/'profile.json';p.write_text(json.dumps(self.p));p.chmod(0o600);link=base/'link';link.symlink_to(p)
            with self.assertRaises(mod.CollectionError):mod.write_collection(link,base/'collection',self.provider,clock=self.clock)
            (base/'.git').mkdir()
            with self.assertRaises(mod.CollectionError):mod.write_collection(p,base/'other',self.provider,clock=self.clock)
            self.assertEqual(self.provider.calls,[])


if __name__=='__main__':unittest.main()
