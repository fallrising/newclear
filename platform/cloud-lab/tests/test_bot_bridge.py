import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bot_bridge', ROOT/'tools/bot_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
RID = '12345678-1234-4234-8234-123456789abc'


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root/'state'
        self.state.mkdir(mode=0o700)
        exists = Path.exists
        fixture = self.root
        self.markers = patch.object(Path, 'exists', lambda p: False if p.name=='.git' and not p.parent.is_relative_to(fixture) else exists(p))
        self.markers.start(); self.addCleanup(self.markers.stop)
        self.profile = {'base_url':'https://lab.example','audience':'synthetic-bot','credential_id':'bot','generation':1,'secret_hex':'ab'*32,'journal_path':'unused','workspace_id':'lab','resource_ref':{'resource_id':'node','generation':1},'recipe_ref':{'recipe_id':'node-health','version':'1.0.0','digest':'sha256:'+'a'*64}}
        self.config = self.root/'bot.json'
        self.config.write_text(json.dumps(self.profile)); self.config.chmod(0o600)
        self.now = 1793059200
        self.calls = []; self.command = None; self.record = None
        self.fail_ack = False; self.denied = False; self.bad_scope = False

    def transport(self, method, path, raw, headers):
        self.calls.append((method,path,raw))
        if self.denied: return 403, {'message':'private-server-secret'}
        if path=='/api/bootstrap':
            return 200, {**{k:self.profile[k] for k in ('workspace_id','resource_ref','recipe_ref')}, 'now':'2026-10-27T00:00:00Z', 'capabilities':['commands:read','commands:submit','node:health:read'], **({'workspace_id':'wrong'} if self.bad_scope else {})}
        if method=='POST':
            command = json.loads(raw)
            if self.command is not None: self.assertEqual(command,self.command)
            self.command = command
            if self.record is None: self.record = {'command_id':'command-1','command':command,'delivery':'accepted','result':None}
            if self.fail_ack: raise OSError('private-network-message')
            return 202, {'command':copy.deepcopy(self.record)}
        return 200, {'command':copy.deepcopy(self.record)}

    def call(self, op='health.check', rid=RID, allow=True, **kwargs):
        data=json.dumps({'schema_version':'cloudlab.bot-request.v1','operation':op,'request_id':rid}).encode()
        return bridge.handle(data,self.config,self.state,allow_submit=allow,transport=self.transport,clock=lambda:self.now,**kwargs)

    def test_explicit_submit_flag_and_strict_input_before_any_io(self):
        with self.assertRaises(bridge.BridgeError): self.call(allow=False)
        cases=[b'{}',b'[]',b'{"operation":"a","operation":"b"}',b' '*4097]
        valid={'schema_version':'cloudlab.bot-request.v1','operation':'health.check','request_id':RID}
        cases += [json.dumps({**valid,**extra}).encode() for extra in [{'url':'https://evil.example'},{'operation':'shell.exec'},{'request_id':'../escape'},{'request_id':RID.upper()},{'schema_version':True}]]
        for raw in cases:
            with self.subTest(raw=raw[:80]),self.assertRaises(bridge.BridgeError):
                bridge.handle(raw,self.root/'missing',self.state,allow_submit=True,transport=self.transport)
        self.assertEqual(self.calls,[])
        self.assertEqual(list(self.state.iterdir()),[])

    def test_saved_before_send_and_duplicate_known_ack_only_reads(self):
        base=self.transport
        def send(method,path,raw,headers):
            if method=='POST':
                db=sqlite3.connect(self.state/'requests.sqlite')
                saved=db.execute('SELECT payload FROM requests WHERE request_id=?',(RID,)).fetchone();db.close()
                self.assertEqual(saved[0].encode(),raw)
            return base(method,path,raw,headers)
        result=bridge.handle(json.dumps({'schema_version':'cloudlab.bot-request.v1','operation':'health.check','request_id':RID}).encode(),self.config,self.state,allow_submit=True,transport=send,clock=lambda:self.now)
        self.assertEqual(result['state'],'accepted');self.assertFalse(result['verified'])
        self.now+=500
        again=self.call()
        self.assertEqual(again['command_id'],result['command_id'])
        self.assertEqual(sum(x[0]=='POST' for x in self.calls),1)
        self.assertFalse((self.root/'unused').exists())
        self.assertEqual((self.state/'requests.sqlite').stat().st_mode&0o777,0o600)

    def test_lost_ack_status_does_not_submit_and_retry_preserves_expired_bytes(self):
        self.fail_ack=True
        result=self.call();self.assertEqual(result['state'],'unconfirmed')
        raw=self.calls[-1][2];self.assertIn(b'"idempotency_key":"'+RID.encode()+b'"',raw)
        count=len(self.calls);status=self.call('health.status',allow=False)
        self.assertEqual(status['state'],'unconfirmed');self.assertEqual(len(self.calls),count)
        self.now+=400;self.fail_ack=False
        retry=self.call();self.assertEqual(retry['command_id'],'command-1')
        self.assertEqual(self.calls[-1][2],raw)
        self.assertEqual(sum(x[0]=='POST' for x in self.calls),2)

    def test_missing_status_is_local_and_no_submission(self):
        result=self.call('health.status',allow=False)
        self.assertEqual(result['state'],'not_found');self.assertEqual(self.calls,[])

    def test_config_change_cannot_rebind_saved_request(self):
        self.call();self.profile['generation']=2;self.config.write_text(json.dumps(self.profile))
        count=len(self.calls)
        with self.assertRaises(bridge.BridgeError):self.call('health.status',allow=False)
        self.assertEqual(len(self.calls),count)

    def test_scope_mismatch_creates_no_request_or_post(self):
        self.bad_scope=True
        result=self.call();self.assertEqual(result['state'],'error')
        self.assertFalse(any(x[0]=='POST' for x in self.calls))
        db=sqlite3.connect(self.state/'requests.sqlite');self.assertEqual(db.execute('SELECT count(*) FROM requests').fetchone()[0],0);db.close()

    def test_auth_failure_clears_health_and_sanitizes_body(self):
        self.call();self.denied=True
        result=self.call('health.status',allow=False)
        self.assertEqual(result['state'],'denied');self.assertIsNone(result['health']);self.assertFalse(result['verified'])
        self.assertNotIn('private',json.dumps(result));self.assertNotIn(self.profile['secret_hex'],json.dumps(result))

    def test_validated_unhealthy_stale_future_and_unknown_are_distinct(self):
        self.call()
        self.record.update(delivery='result_recorded',result={'owner_outcome':'succeeded','validation':{'status':'passed'},'health':'unhealthy','finished_at':'2026-10-27T00:00:00Z'})
        result=self.call('health.status',allow=False)
        self.assertEqual(result['state'],'validated');self.assertTrue(result['verified']);self.assertEqual(result['health'],'unhealthy')
        self.now+=31;result=self.call('health.status',allow=False)
        self.assertEqual(result['state'],'stale');self.assertFalse(result['verified']);self.assertIsNone(result['health'])
        self.now-=40;result=self.call('health.status',allow=False);self.assertEqual(result['state'],'unverified')
        self.record.update(delivery='reconciling',result=None)
        self.assertEqual(self.call('health.status',allow=False)['state'],'unknown')
        self.assertEqual(sum(x[0]=='POST' for x in self.calls),1)

    def test_malformed_response_and_identity_drift_are_not_accepted(self):
        self.call()
        for change in [{'command_id':'https://evil.example'},{'command_id':'another-command'},{'command':{}},{'delivery':'success'},{'delivery':'result_recorded','result':{'validation':None}}]:
            with self.subTest(change=change):
                original=copy.deepcopy(self.record);self.record.update(change)
                result=self.call('health.status',allow=False);self.assertEqual(result['state'],'unconfirmed');self.assertFalse(result['verified']);self.record=original

    def test_corrupt_payload_does_not_retry(self):
        self.fail_ack=True;self.call();db=sqlite3.connect(self.state/'requests.sqlite');db.execute("UPDATE requests SET payload='{}'");db.commit();db.close();count=len(self.calls)
        with self.assertRaises(bridge.BridgeError):self.call()
        self.assertEqual(len(self.calls),count)

    def test_busy_lock_and_unsafe_private_paths(self):
        lock=self.state/'bridge.lock'
        with lock.open('w') as f:
            lock.chmod(0o600);fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(bridge.BridgeError):self.call()
        self.assertEqual(self.calls,[])
        self.state.chmod(0o755)
        with self.assertRaises(bridge.BridgeError):self.call()
        self.state.chmod(0o700)
        db=self.state/'requests.sqlite';outside=self.root/'outside';outside.write_text('unique');db.symlink_to(outside)
        with self.assertRaises(bridge.BridgeError):self.call()
        self.assertEqual(outside.read_text(),'unique')

    def test_state_in_git_is_refused(self):
        (self.root/'.git').mkdir()
        with self.assertRaises(bridge.BridgeError):self.call()
        self.assertEqual(self.calls,[])

    def test_database_failure_prevents_send(self):
        with patch('sqlite3.connect',side_effect=sqlite3.OperationalError('disk full')):
            with self.assertRaises(bridge.BridgeError):self.call()
        self.assertEqual(self.calls,[])


    def test_durable_write_failure_never_sends_command(self):
        self.call('health.status',allow=False)
        db=sqlite3.connect(self.state/'requests.sqlite')
        db.execute("CREATE TRIGGER reject_request BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END")
        db.commit();db.close()
        with self.assertRaises(bridge.BridgeError):self.call()
        self.assertFalse(any(method=='POST' for method,_,_ in self.calls))

    def test_corrupt_non_object_payload_is_stable_error(self):
        import hashlib
        self.fail_ack=True;self.call()
        db=sqlite3.connect(self.state/'requests.sqlite');db.execute('UPDATE requests SET payload=?,digest=?',('[]',hashlib.sha256(b'[]').hexdigest()));db.commit();db.close()
        with self.assertRaises(bridge.BridgeError):self.call()


if __name__=='__main__':unittest.main()

class ClosedUnknownTests(unittest.TestCase):
    def test_closed_unknown_is_never_verified(self):
        command={'parameters':{'max_sample_age_seconds':30}}
        request={'request_id':RID,'operation':'health.status'}
        value={'command_id':'command-1','command':command,'delivery':'closed_unknown','result':{'owner_outcome':'succeeded'}}
        out=bridge.project(request,value,command,'command-1',1793059200)
        self.assertEqual(out['state'],'unknown');self.assertEqual(out['code'],'RECONCILIATION_CLOSED')
        self.assertFalse(out['verified']);self.assertIsNone(out['health']);self.assertIsNone(out['observed_at'])
