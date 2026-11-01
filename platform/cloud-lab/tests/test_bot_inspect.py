from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import unittest
from unittest.mock import patch
import test_bot_policy as base

spec = importlib.util.spec_from_file_location('bot_inspect', base.base.ROOT/'tools/bot_inspect.py')
inspect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspect)


class InspectionTests(unittest.TestCase):
    setUp = base.PolicyTests.setUp
    policy = base.PolicyTests.policy
    init = base.PolicyTests.init
    call = base.PolicyTests.call
    transport = base.PolicyTests.transport

    def read(self):
        return inspect.inspect_policy(self.config, self.state, self.policy_path, clock=lambda:self.now)

    def snapshot(self):
        return {p.name:(p.read_bytes(), p.stat().st_mtime_ns) for p in self.state.iterdir()}

    def sql(self, text, params=()):
        with closing(sqlite3.connect(self.state/'requests.sqlite')) as db:
            db.execute(text, params); db.commit()

    def test_active_read_does_not_consume_or_write(self):
        self.init(); self.call(); before=self.snapshot(); self.now+=5
        for _ in range(2):
            out=self.read()
            self.assertEqual(out['state'],'active')
            self.assertEqual(out['quota']['calls'], {'used':1,'limit':240,'remaining':239})
            self.assertEqual(out['quota']['new_requests'], {'used':1,'limit':24,'remaining':23})
            self.assertTrue(out['local_admission']['existing_request']['allowed'])
            self.assertFalse(out['local_admission']['new_request']['allowed'])
            self.assertEqual(out['local_admission']['new_request']['wait_seconds'],55)
            self.assertEqual(out['remote_authorization'],'not_checked')
            self.assertEqual(out['requests']['acked'],1)
        self.assertEqual(self.snapshot(),before); self.assertEqual(len(self.calls),2)
        raw=json.dumps(out)
        for private in [self.profile['secret_hex'],self.profile['base_url'],str(self.root),'command-1','idempotency_key']:
            self.assertNotIn(private,raw)

    def test_expiry_and_clock_rollback_are_readonly_observations(self):
        self.init(); before=self.snapshot(); start=self.now
        for at,state in [(start-1,'clock_rollback'),(start+3600,'expired'),(start+4000,'expired')]:
            self.now=at; out=self.read(); self.assertEqual(out['state'],state)
            self.assertFalse(out['local_admission']['existing_request']['allowed'])
            self.assertFalse(out['local_admission']['new_request']['allowed'])
        self.assertEqual(self.snapshot(),before)

    def test_not_started_and_fractional_cooldown(self):
        self.init(); self.sql('UPDATE bot_policy SET high_water=?',(self.now-100,)); self.now-=1
        self.assertEqual(self.read()['state'],'not_started')
        self.now+=1; self.call(); self.now+=4.2
        self.assertEqual(self.read()['local_admission']['existing_request']['wait_seconds'],1)

    def test_new_limit_does_not_block_existing_request(self):
        self.init(max_new_requests=1); self.call(); self.now+=60
        out=self.read(); self.assertTrue(out['local_admission']['existing_request']['allowed'])
        self.assertEqual(out['local_admission']['new_request']['code'],'POLICY_NEW_REQUEST_LIMIT')

    def test_exhausted_new_budget_is_not_reported_as_only_a_cooldown(self):
        self.init(max_new_requests=1); self.call()
        self.assertEqual(self.read()['local_admission']['new_request']['code'],'POLICY_NEW_REQUEST_LIMIT')

    def test_call_limit_blocks_both(self):
        self.init(max_calls=1); self.call(); self.now+=60
        out=self.read()
        for v in out['local_admission'].values():self.assertEqual(v['code'],'POLICY_CALL_LIMIT')

    def test_wait_past_expiry_is_not_promised(self):
        self.init(expires_at=base.bridge.probe.utc(self.now+10)); self.call()
        out=self.read(); self.assertEqual(out['local_admission']['new_request']['code'],'POLICY_WINDOW_TOO_SHORT')
        self.assertIsNone(out['local_admission']['new_request']['wait_seconds'])

    def test_ack_loss_and_payloadless_reservations_are_distinct(self):
        self.init(); self.fail_ack=True; self.call()
        out=self.read(); self.assertEqual(out['requests']['unconfirmed'],1)
        self.assertEqual(out['pending'][0],{'request_id':base.RID,'state':'ack_unconfirmed'})
        self.assertEqual(out['requests']['reserved_without_payload'],0)
        self.sql('DELETE FROM requests')
        out=self.read(); self.assertEqual(out['requests']['reserved_without_payload'],1)
        self.assertEqual(out['pending'][0]['state'],'reserved_without_payload')

    def test_missing_state_creates_nothing(self):
        self.policy(); before=self.snapshot()
        with self.assertRaisesRegex(ValueError,'CONFIG_OR_STATE_UNAVAILABLE'):self.read()
        self.assertEqual(self.snapshot(),before)

    def test_missing_policy_table_does_not_initialize(self):
        self.policy(); base.base.BridgeTests.call(self)
        before=self.snapshot()
        with self.assertRaisesRegex(ValueError,'POLICY_NOT_INITIALIZED'):self.read()
        self.assertEqual(self.snapshot(),before)

    def test_writer_lock_prevents_observation(self):
        self.init()
        with base.bridge.journal(self.state):
            with self.assertRaisesRegex(ValueError,'STATE_BUSY'):self.read()

    def test_hot_journal_or_wal_refused_without_recovery(self):
        self.init()
        for suffix in ('-journal','-wal','-shm'):
            p=self.state/('requests.sqlite'+suffix);p.write_bytes(b'unknown')
            before=self.snapshot()
            with self.assertRaisesRegex(ValueError,'STATE_RECOVERY_REQUIRED'):self.read()
            self.assertEqual(self.snapshot(),before);p.unlink()

    def test_unsafe_modes_links_and_nonregular_files_refused(self):
        self.init()
        for name in ('requests.sqlite','bridge.lock'):
            p=self.state/name;p.chmod(0o640)
            with self.assertRaisesRegex(ValueError,'UNSAFE_STATE'):self.read()
            p.chmod(0o600);other=self.root/'linked';os.link(p,other)
            with self.assertRaisesRegex(ValueError,'UNSAFE_STATE'):self.read()
            other.unlink();p.rename(other);p.symlink_to(other)
            with self.assertRaises(ValueError):self.read()
            p.unlink();other.rename(p)
        p=self.state/'requests.sqlite';p.unlink();os.mkfifo(p,0o600)
        with self.assertRaisesRegex(ValueError,'UNSAFE_STATE'):self.read()

    def test_wrong_config_or_policy_refused(self):
        self.init();self.policy(max_calls=239)
        with self.assertRaisesRegex(ValueError,'POLICY_CONTEXT_MISMATCH'):self.read()
        self.policy();self.profile['generation']=2;self.config.write_text(json.dumps(self.profile))
        with self.assertRaisesRegex(ValueError,'POLICY_CONTEXT_MISMATCH'):self.read()

    def test_corrupt_payload_or_ledger_refused(self):
        self.init();self.call();self.sql("UPDATE requests SET payload='{}'")
        with self.assertRaisesRegex(ValueError,'STATE_CORRUPT'):self.read()
        self.sql('DELETE FROM requests');self.sql('UPDATE bot_policy SET calls=-1')
        with self.assertRaisesRegex(ValueError,'STATE_CORRUPT'):self.read()

    def test_pending_list_bounded_with_exact_total(self):
        self.init();self.fail_ack=True;self.call()
        with closing(sqlite3.connect(self.state/'requests.sqlite')) as db:
            profile,payload=db.execute('SELECT profile,payload FROM requests').fetchone()
            for n in range(1,22):
                rid=f'{n:08x}-1234-4234-8234-123456789abc';command=json.loads(payload);command['idempotency_key']=rid;raw=base.bridge.probe.encode(command)
                db.execute('INSERT INTO requests VALUES(?,?,?,?,NULL)',(rid,profile,raw.decode(),hashlib.sha256(raw).hexdigest()))
            db.commit()
        out=self.read();self.assertEqual(out['requests']['unconfirmed'],22)
        self.assertEqual(len(out['pending']),20);self.assertTrue(out['pending_truncated'])

    def test_size_and_row_bounds_refuse(self):
        self.init();self.call()
        with patch.object(inspect,'MAX_DB_BYTES',1):
            with self.assertRaisesRegex(ValueError,'STATE_TOO_LARGE'):self.read()
        with patch.object(inspect,'MAX_REQUESTS',0):
            with self.assertRaisesRegex(ValueError,'STATE_TOO_LARGE'):self.read()

    def test_renewal_preserves_historical_ack_and_fresh_quota(self):
        old=self.init();self.call();oldpath=self.root/'old.json';oldpath.write_bytes(self.policy_path.read_bytes());oldpath.chmod(0o600)
        self.now+=3600;self.policy()
        base.bridge.renew_policy(self.config,self.state,oldpath,self.policy_path,clock=lambda:self.now)
        out=self.read();self.assertEqual(out['requests']['acked'],1)
        self.assertEqual(out['quota']['calls']['used'],0);self.assertEqual(out['quota']['new_requests']['used'],0)

    def test_no_network_client_or_request_is_constructed(self):
        self.init()
        with patch.object(inspect.bridge.probe,'HTTPSClient',side_effect=AssertionError('network forbidden')):
            self.assertEqual(self.read()['state'],'active')

    def cli_args(self):
        # Launcher temp lives below a Git checkout. Remove only that ancestor check in
        # this synthetic child, as in the existing bridge/MCP integration fixtures.
        child = """import pathlib,runpy,sys
from unittest.mock import patch
root=pathlib.Path(sys.argv.pop(1));sys.argv=sys.argv[1:];script=sys.argv[0];exists=pathlib.Path.exists
with patch.object(pathlib.Path,'exists',lambda p: False if p.name=='.git' and not p.parent.is_relative_to(root) else exists(p)):
    runpy.run_path(script,run_name='__main__')
"""
        return [sys.executable,'-B','-c',child,str(self.root),str(base.base.ROOT/'tools/bot_inspect.py'),
              '--config',str(self.config),'--state-dir',str(self.state),'--policy',str(self.policy_path)]

    def test_cli_readonly_lock_error_and_private_error_output(self):
        self.init();before=self.snapshot();args=self.cli_args()
        p=subprocess.run(args,capture_output=True,text=True,timeout=10)
        self.assertEqual(p.returncode,0,p.stderr+p.stdout);self.assertEqual(p.stderr,'')
        self.assertEqual(json.loads(p.stdout)['quota']['calls']['used'],0)
        with base.bridge.journal(self.state):
            p=subprocess.run(args,capture_output=True,text=True,timeout=10)
            self.assertEqual(p.returncode,2);self.assertEqual(json.loads(p.stdout)['code'],'STATE_BUSY')
        self.assertEqual(self.snapshot(),before)
        self.config.write_text('{broken private secret')
        p=subprocess.run(args,capture_output=True,text=True,timeout=10)
        self.assertEqual(p.returncode,2);self.assertEqual(p.stderr,'')
        self.assertEqual(json.loads(p.stdout),{'schema_version':'cloudlab.bot-inspection-error.v1','code':'CONFIG_OR_STATE_UNAVAILABLE'})

    def assert_cli_corruption_safe(self, codes=('CONFIG_OR_STATE_UNAVAILABLE',)):
        before=self.snapshot()
        p=subprocess.run(self.cli_args(),capture_output=True,text=True,timeout=10)
        self.assertEqual(p.returncode,2,p.stderr);self.assertEqual(p.stderr,'')
        out=json.loads(p.stdout)
        self.assertEqual(set(out),{'schema_version','code'})
        self.assertEqual(out['schema_version'],'cloudlab.bot-inspection-error.v1')
        self.assertIn(out['code'],codes)
        self.assertEqual(self.snapshot(),before)

    def test_cli_malformed_policy_schema_is_sanitized_and_preserved(self):
        self.init();self.sql('DROP TABLE bot_policy');self.sql('CREATE TABLE bot_policy(id INTEGER)')
        self.sql('INSERT INTO bot_policy VALUES(1)');self.assert_cli_corruption_safe()

    def test_cli_malformed_request_schema_is_sanitized_and_preserved(self):
        self.init();self.sql('DROP TABLE requests');self.sql('CREATE TABLE requests(request_id TEXT)')
        self.sql('INSERT INTO requests VALUES(?)',(base.RID,));self.assert_cli_corruption_safe()

    def test_cli_deep_payload_is_sanitized_and_preserved(self):
        self.init();self.call();payload='['*1100+'0'+']'*1100
        self.sql('UPDATE requests SET payload=?,digest=?',(payload,hashlib.sha256(payload.encode()).hexdigest()))
        # Python versions differ in whether JSON rejects this nesting first or the
        # application rejects the successfully parsed non-command array.
        self.assert_cli_corruption_safe(('CONFIG_OR_STATE_UNAVAILABLE','STATE_CORRUPT'))


if __name__=='__main__':unittest.main()
