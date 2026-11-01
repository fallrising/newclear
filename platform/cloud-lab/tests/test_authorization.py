"""Synthetic authorization snapshots and real SQLite plan safety boundaries."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('cloudlab_authorization', ROOT/'tools/authorization.py')
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)
NOW = 1893456000  # 2030-01-01T00:00:00Z


def snapshot():
    policy = dict(principal_id='runner-principal', workspace_id='workspace',
                  resource_ref={'resource_id':'node','generation':1},
                  recipe_ref={'recipe_id':'node-health','version':'1.0.0','digest':'sha256:'+'a'*64},
                  capabilities=['dispatch:claim','runs:report','runs:reconcile'],
                  not_before='2029-12-31T23:00:00Z', expires_at='2030-01-01T01:00:00Z',
                  max_timeout_seconds=10, max_output_bytes=16384)
    return dict(schema_version='cloudlab.authorization.v1', observed_at='2030-01-01T00:00:00Z',
                target={'worker_name':'cloud-lab-qualification','database_id':'12345678-1234-4234-8234-123456789abc'},
                active_commands=0, schedules_enabled=False,
                subjects=[dict(role='runner',grant={'id':'grant-runner','revision':1,'revoked':0,'policy':json.dumps(policy)},
                               credential={'id':'key-runner','principal_id':'runner-principal','grant_id':'grant-runner','generation':1,'revoked':False,'expires_at':'2030-01-01T02:00:00Z'},
                               access_required=True, access_service={'id':'access-token','revoked':False,'expires_at':'2030-01-01T00:30:00Z'},
                               runner_stop_at='2030-01-01T00:45:00Z')])


class AuthorizationTests(unittest.TestCase):
    def setUp(self): self.s = snapshot()
    def status(self, now=NOW): return mod.status(self.s, now=now)['subjects'][0]
    def plan(self, action='renew', **kw):
        return mod.make_plan(self.s, role='runner', action=action, now=NOW,
                             expires_at=kw.get('expires_at','2030-01-02T00:00:00Z') if action=='renew' else kw.get('expires_at'))
    def test_earliest_layer_and_no_identifiers(self):
        out = mod.status(self.s, now=NOW)
        row = out['subjects'][0]
        self.assertEqual(row['effective_expires_at'],'2030-01-01T00:30:00Z')
        self.assertEqual(row['state'],'expiring')
        self.assertEqual(row['limiting_layers'],['access_service'])
        for value in ['grant-runner','runner-principal','key-runner','access-token','workspace','12345678']:
            self.assertNotIn(value,json.dumps(out))
        self.assertFalse(out['live_verified'])
    def test_boundary_expiry_and_stop(self):
        self.s['observed_at']='2030-01-01T00:30:00Z'
        self.assertEqual(self.status(NOW+1800)['state'],'expired')
        self.s['subjects'][0]['runner_stop_at']='2029-12-31T23:59:59Z'
        self.assertEqual(self.status()['layers']['runner_stop']['state'],'expired')
    def test_revocation_precedes_stale_or_expired(self):
        self.s['subjects'][0]['grant']['revoked']=1
        self.assertEqual(self.status(NOW+7200)['state'],'revoked')
    def test_missing_stale_and_future_observations(self):
        self.s['subjects'][0]['access_service']=None
        self.assertEqual(self.status()['state'],'unknown')
        self.s=snapshot()
        self.assertEqual(self.status(NOW+301)['state'],'unknown')
        self.assertEqual(self.status(NOW-1)['state'],'unknown')
    def test_not_yet_valid_and_optional_access(self):
        row=self.s['subjects'][0];p=json.loads(row['grant']['policy']);p['not_before']='2030-01-01T00:01:00Z';row['grant']['policy']=json.dumps(p)
        self.assertEqual(self.status()['state'],'not_yet_valid')
        row['access_required']=False;row['access_service']=None
        self.assertEqual(self.status()['layers']['access_service']['state'],'not_applicable')
    def test_human_session_not_inferred(self):
        row=self.s['subjects'][0];row.update(role='human',credential=None,access_required=False,access_service=None,runner_stop_at=None)
        policy=json.loads(row['grant']['policy']);policy['capabilities']=['commands:read'];row['grant']['policy']=json.dumps(policy)
        self.assertEqual(self.status()['human_session'],'not_evaluated')
        self.assertEqual(self.status()['layers']['credential']['state'],'not_applicable')
    def test_strict_shapes_reject_secret_duplicate_role_bool_revision_and_bad_policy(self):
        variants=[]
        s=snapshot();s['subjects'][0]['credential']['secret_hex']='f'*64;variants.append(s)
        s=snapshot();s['subjects']*=2;variants.append(s)
        s=snapshot();s['subjects'][0]['grant']['revision']=True;variants.append(s)
        s=snapshot();s['subjects'][0]['grant']['policy']='{"x":1,"x":2}';variants.append(s)
        s=snapshot();s['observed_at']='2030-02-30T00:00:00Z';variants.append(s)
        s=snapshot();s['active_commands']=-1;variants.append(s)
        s=snapshot();s['subjects'][0]['role']='administrator';variants.append(s)
        for s in variants:
            with self.subTest(s=s), self.assertRaises(mod.AuthorizationError):mod.status(s,now=NOW)
    def test_plan_scope_preserved_and_companion_expiry_visible(self):
        before=copy.deepcopy(self.s);plan=self.plan()
        self.assertEqual(self.s,before)
        self.assertTrue(plan['approval_required']);self.assertFalse(plan['applied'])
        self.assertEqual(plan['valid_until'],'2030-01-01T00:05:00Z')
        self.assertEqual(plan['target'],self.s['target'])
        params=plan['query']['params'];new=json.loads(params[0]);old=json.loads(self.s['subjects'][0]['grant']['policy'])
        self.assertEqual(new.pop('expires_at'),'2030-01-02T00:00:00Z');old.pop('expires_at');self.assertEqual(new,old)
        self.assertIn('access_service',plan['companion_layers_not_extended'])
        self.assertIn('credential',plan['companion_layers_not_extended'])
        self.assertIn('runner_stop',plan['companion_layers_not_extended'])
    def test_plan_refuses_stale_future_revoked_busy_enabled(self):
        variants=[]
        for key,value in [('observed_at','2029-12-31T23:54:59Z'),('observed_at','2030-01-01T00:00:01Z'),('active_commands',1),('schedules_enabled',True)]:
            s=snapshot();s[key]=value;variants.append(s)
        s=snapshot();s['subjects'][0]['grant']['revoked']=1;variants.append(s)
        s=snapshot();s['subjects'][0]['grant']=None;variants.append(s)
        for s in variants:
            self.s=s
            with self.subTest(s=s), self.assertRaises(mod.AuthorizationError):self.plan()
    def test_renewal_limits_and_revoke_options(self):
        for expiry in [None,'2030-01-01T00:00:00Z','2030-01-01T01:00:00Z','2030-02-01T00:00:00Z']:
            with self.subTest(expiry=expiry),self.assertRaises(mod.AuthorizationError):self.plan(expires_at=expiry)
        with self.assertRaises(mod.AuthorizationError):self.plan('revoke',expires_at='2030-01-02T00:00:00Z')
        with self.assertRaises(mod.AuthorizationError):mod.make_plan(self.s,role='bot',action='renew',expires_at='2030-01-02T00:00:00Z',now=NOW)
    def db(self):
        db=sqlite3.connect(':memory:');self.addCleanup(db.close)
        db.executescript((ROOT/'apps/control/migrations/0001.sql').read_text())
        g=self.s['subjects'][0]['grant'];db.execute('INSERT INTO grants VALUES (?,?,?,?)',(g['id'],g['revision'],g['revoked'],g['policy']))
        return db
    def apply(self,db,plan):return db.execute(plan['query']['sql'],plan['query']['params']).rowcount
    def test_sql_renew_exactly_once_and_preserves_scope(self):
        db=self.db();p=self.plan();self.assertEqual(self.apply(db,p),1);self.assertEqual(self.apply(db,p),0)
        g=db.execute('SELECT revision,revoked,policy FROM grants').fetchone();self.assertEqual(g[:2],(2,0));self.assertEqual(g[2],p['query']['params'][0])
    def test_sql_revoke_exactly_once_and_retains_policy(self):
        db=self.db();p=self.plan('revoke');self.assertEqual(self.apply(db,p),1);self.assertEqual(self.apply(db,p),0)
        self.assertEqual(db.execute('SELECT revision,revoked,policy FROM grants').fetchone(),(2,1,self.s['subjects'][0]['grant']['policy']))
    def test_sql_rejects_revision_policy_and_revocation_drift(self):
        p=self.plan()
        for sql in ['UPDATE grants SET revision=2',"UPDATE grants SET policy='{}'",'UPDATE grants SET revoked=1']:
            db=self.db();db.execute(sql);self.assertEqual(self.apply(db,p),0)
    def test_sql_rejects_new_active_unknown_and_enabled_schedule(self):
        p=self.plan();db=self.db()
        db.execute("INSERT INTO commands VALUES ('cmd','p','idem','{}','digest','grant-runner',1,'{}',1,1,0)")
        self.assertEqual(self.apply(db,p),0)
        db.execute('UPDATE commands SET active=0');db.execute("INSERT INTO schedules VALUES ('health-minute',1,1,'grant-runner',NULL)")
        self.assertEqual(self.apply(db,p),0)
    def test_rejects_mismatched_credential_binding_and_unknown_fields(self):
        for field,value in [('grant_id','other-grant'),('principal_id','other-principal')]:
            s=snapshot();s['subjects'][0]['credential'][field]=value
            with self.assertRaises(mod.AuthorizationError):mod.status(s,now=NOW)
        self.s['subjects'][0]['grant']['policy']=json.dumps(dict(json.loads(self.s['subjects'][0]['grant']['policy']),secret='not-allowed'))
        with self.assertRaises(mod.AuthorizationError):self.status()
    def test_expired_grant_plan_does_not_extend_command_deadlines(self):
        row=self.s['subjects'][0];p=json.loads(row['grant']['policy']);p['expires_at']='2029-12-31T23:59:59Z';row['grant']['policy']=json.dumps(p)
        self.assertEqual(self.status()['state'],'expired')
        db=self.db();db.execute("INSERT INTO commands VALUES ('old','p','idem','old-body','digest','grant-runner',1,'{}',1,0,0)")
        before=db.execute('SELECT * FROM commands').fetchall()
        self.assertEqual(self.apply(db,self.plan()),1)
        self.assertEqual(db.execute('SELECT * FROM commands').fetchall(),before)
    def test_no_false_complete_deadline_when_layer_unknown(self):
        self.s['subjects'][0]['credential']['expires_at']=None
        row=self.status();self.assertEqual(row['state'],'unknown');self.assertFalse(row['deadline_complete'])
    def test_private_reader_rejects_oversize_duplicate_json_and_hardlink(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'snapshot.json'
            for raw in ['{"x":1,"x":2}', 'x'*32769, '{"x":NaN}']:
                source.write_text(raw);source.chmod(0o600)
                with patch.object(mod.files,'require_outside_checkout'),self.assertRaises(mod.AuthorizationError):mod.run(source,now=NOW)
            source.write_text(json.dumps(self.s));os.link(source,root/'alias')
            with patch.object(mod.files,'require_outside_checkout'),self.assertRaises(mod.AuthorizationError):mod.run(source,now=NOW)

    def test_revoked_unknown_expiry_is_not_complete(self):
        for name in ('credential','access_service'):
            self.s=snapshot();self.s['subjects'][0][name].update(revoked=True,expires_at=None)
            with self.subTest(layer=name):
                row=self.status();self.assertEqual(row['state'],'revoked');self.assertFalse(row['deadline_complete'])
    def test_exact_freshness_and_renewal_boundaries(self):
        self.assertTrue(mod.status(self.s,now=NOW+300)['snapshot_fresh'])
        self.assertFalse(mod.status(self.s,now=NOW+301)['snapshot_fresh'])
        self.assertEqual(self.plan(expires_at='2030-01-31T00:00:00Z')['action'],'renew')
        with self.assertRaises(mod.AuthorizationError):self.plan(expires_at='2030-01-31T00:00:01Z')
    def test_unsafe_output_parent_refused(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'snapshot.json';source.write_text(json.dumps(self.s));source.chmod(0o600)
            unsafe=root/'unsafe';unsafe.mkdir();unsafe.chmod(0o777)
            with patch.object(mod.files,'require_outside_checkout'),self.assertRaises(mod.AuthorizationError):
                mod.run(source,unsafe/'plan.json',role='runner',action='revoke',now=NOW)
            self.assertFalse((unsafe/'plan.json').exists())

    def test_io_exclusive_output_and_private_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'snapshot.json';out=root/'plan.json'
            source.write_text(json.dumps(self.s));source.chmod(0o600)
            # This synthetic directory may be below launcher checkout ancestors.
            from unittest.mock import patch
            with patch.object(mod.files,'require_outside_checkout'):
                result=mod.run(source,out,role='runner',action='renew',expires_at='2030-01-02T00:00:00Z',now=NOW)
                self.assertTrue(result['saved']);self.assertEqual(out.stat().st_mode&0o777,0o600)
                with self.assertRaises(mod.AuthorizationError):mod.run(source,out,role='runner',action='revoke',now=NOW)
                source.chmod(0o644)
                with self.assertRaises(mod.AuthorizationError):mod.run(source,now=NOW)
    def test_io_rejects_symlink_and_checkout_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'snapshot.json';source.write_text(json.dumps(self.s));source.chmod(0o600)
            link=root/'link';link.symlink_to(source)
            with self.assertRaises(mod.AuthorizationError):mod.run(link,now=NOW)
            (root/'.git').mkdir()
            with self.assertRaises(mod.AuthorizationError):mod.run(source,now=NOW)


if __name__=='__main__':unittest.main()
