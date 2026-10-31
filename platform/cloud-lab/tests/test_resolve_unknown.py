import copy, hashlib, importlib.util, json, os, sqlite3, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('resolve_unknown',ROOT/'tools/resolve_unknown.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=1893456000
RID='12345678-1234-4234-8234-123456789abc'
def snapshot():
 c={'schema_version':'cloudlab.command.v1','schema_minor':0,'workspace_id':'lab','resource_ref':{'resource_id':'node','generation':1},'recipe_ref':{'recipe_id':'node-health','version':'1.0.0','digest':'sha256:'+hashlib.sha256((ROOT/'recipes/node-health.json').read_bytes()).hexdigest()},'parameters':{'max_sample_age_seconds':30},'idempotency_key':'original','not_before':'2029-12-31T23:55:00Z','dispatch_deadline':'2029-12-31T23:56:00Z','execution_deadline':'2029-12-31T23:57:00Z','timeout_seconds':10,'output_budget_bytes':16384}
 ext={'owner':'python-node-health','adapter_id':'node-health','external_id':'command-1'}
 v={'command_id':'command-1','revision':7,'command':c,'delivery':'reconciling','cancel_requested':False,'external_ref':ext,'attempt':{'attempt_id':'attempt-1','fence':3,'mode':'reconcile_only','lease_expires_at':'2030-01-01T00:00:15Z'},'result':None,'created_at':c['not_before'],'updated_at':'2029-12-31T23:59:59Z','holder':'runner'}
 body=json.dumps(c,separators=(',',':'));raw=json.dumps(v,separators=(',',':'))
 identity=hashlib.sha256(json.dumps({'command':c,'external_ref':ext},sort_keys=True,separators=(',',':')).encode()).hexdigest()
 return {'schema_version':'cloudlab.unknown-resolution.v1','observed_at':'2030-01-01T00:00:00Z','target':{'worker_name':'cloud-lab','database_id':RID},'command':{'id':'command-1','principal_id':'scheduler','idem_key':'original','body':body,'body_digest':hashlib.sha256(body.encode()).hexdigest(),'submit_grant':'gs','grant_revision':1,'record':raw,'revision':7,'active':1,'created_at':NOW*1000-300000},'journal':{'command_id':'command-1','identity_digest':identity,'state':'unknown','result':{'owner_outcome':'unknown','started_at':None,'finished_at':None,'artifact':None}}}
class ResolutionTests(unittest.TestCase):
 def plan(self,s=None,now=NOW):return m.make_plan(s or snapshot(),operator_id='owner-approved',resolution_id=RID,now=now)
 def db(self,s):
  db=sqlite3.connect(':memory:');db.create_function('unixepoch',0,lambda:NOW);db.executescript((ROOT/'apps/control/migrations/0001.sql').read_text());db.execute("INSERT INTO grants VALUES('gs',1,0,'{}')")
  r=s['command'];db.execute('INSERT INTO commands('+','.join(r)+') VALUES('+','.join('?' for _ in r)+')',list(r.values()));return db
 def test_closure_preserves_unknown_and_identity_once(self):
  s=snapshot();before=copy.deepcopy(s);p=self.plan(s);self.assertEqual(s,before);self.assertTrue(p['approval_required']);self.assertFalse(p['applied']);self.assertEqual(p['required_worker_feature'],'closed_unknown-v1')
  db=self.db(s);n=db.execute(p['query']['sql'],p['query']['params']);self.assertEqual(n.rowcount,1)
  row=db.execute('SELECT record,revision,active,body,body_digest,idem_key FROM commands').fetchone();v=json.loads(row[0]);old=json.loads(s['command']['record'])
  self.assertEqual(row[1:3],(8,0));self.assertEqual(v['delivery'],'closed_unknown');self.assertIsNone(v['result']);self.assertEqual(v['resolution']['decided_by'],'owner-approved')
  for k in old:
   if k not in ['delivery','revision','updated_at']:self.assertEqual(v[k],old[k])
  self.assertEqual(row[3:],tuple(s['command'][k] for k in ['body','body_digest','idem_key']));self.assertEqual(db.execute(p['query']['sql'],p['query']['params']).rowcount,0)
 def test_cas_refuses_drift_and_result_race(self):
  for sql in ["UPDATE commands SET revision=revision+1","UPDATE commands SET record=json_set(record,'$.result',json('{}'))","UPDATE commands SET body=body||' '","UPDATE commands SET active=0"]:
   s=snapshot();p=self.plan(s);db=self.db(s);db.execute(sql);before=db.execute('SELECT * FROM commands').fetchall();self.assertEqual(db.execute(p['query']['sql'],p['query']['params']).rowcount,0);self.assertEqual(before,db.execute('SELECT * FROM commands').fetchall())
 def test_sql_expired_plan_refuses_even_if_caller_forgets(self):
  s=snapshot();p=self.plan(s);db=self.db(s);expired=copy.deepcopy(p['query']['params']);expired[-2]='2000-01-01T00:00:00Z';expired[-1]='2000-01-01T00:01:00Z';self.assertEqual(db.execute(p['query']['sql'],expired).rowcount,0)
 def test_unsafe_evidence_rejected(self):
  edits=[lambda s:s['journal'].update(state='started'),lambda s:s['journal']['result'].update(owner_outcome='succeeded'),lambda s:s['journal'].update(identity_digest='0'*64),lambda s:s['command'].update(active=0),lambda s:s['command'].update(body_digest='0'*64),lambda s:s.update(observed_at='2029-12-31T23:54:59Z'),lambda s:s.update(observed_at='2030-01-01T00:00:01Z'),lambda s:s['command'].update(revision=True)]
  for edit in edits:
   s=snapshot();edit(s)
   with self.subTest(edit=edit),self.assertRaises(ValueError):self.plan(s)
 def test_record_guards_and_deadline(self):
  for key,value in [('result',{}),('delivery','result_recorded'),('resolution',{}),('revision',8),('artifact','secret')]:
   s=snapshot();v=json.loads(s['command']['record']);v[key]=value;s['command']['record']=json.dumps(v)
   with self.subTest(key=key),self.assertRaises(ValueError):self.plan(s)
  s=snapshot();s['observed_at']='2029-12-31T23:56:59Z'
  with self.assertRaises(ValueError):self.plan(s,NOW-181)
 def test_target_operator_and_resolution_ids(self):
  for kwargs in [{'operator_id':'private@example.test','resolution_id':RID},{'operator_id':'owner','resolution_id':'bad'}]:
   with self.assertRaises(ValueError):m.make_plan(snapshot(),now=NOW,**kwargs)
 def test_private_cli_writes_exclusively(self):
  # Launcher temp can be inside a checkout; isolate only that ancestry check.
  with tempfile.TemporaryDirectory() as root, patch.object(m.files,'require_outside_checkout'):
   src=Path(root)/'input.json';out=Path(root)/'plan.json';src.write_text(json.dumps(snapshot()));src.chmod(0o600)
   r=m.run(src,out,operator_id='owner',resolution_id=RID,now=NOW);self.assertTrue(r['saved']);self.assertFalse(r['applied']);self.assertEqual(out.stat().st_mode&0o777,0o600)
   with self.assertRaises(ValueError):m.run(src,out,operator_id='owner',resolution_id=RID,now=NOW)
   src.chmod(0o644)
   with self.assertRaises(ValueError):m.run(src,Path(root)/'other.json',operator_id='owner',resolution_id=RID,now=NOW)

 def test_real_checkout_input_is_rejected(self):
  with self.assertRaises(ValueError):m.files.require_outside_checkout(ROOT/'recipes/node-health.json')
