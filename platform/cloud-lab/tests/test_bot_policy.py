from contextlib import closing
import hashlib
import json
import sqlite3
import unittest
from unittest.mock import patch
import test_bot_bridge as base
bridge = base.bridge
RID = base.RID

RID2 = '22345678-1234-4234-8234-123456789abc'


class PolicyTests(unittest.TestCase):
    setUp = base.BridgeTests.setUp
    transport = base.BridgeTests.transport

    def policy(self, **changes):
        value = {'schema_version': 'cloudlab.bot-policy.v1',
                 'config_sha256': hashlib.sha256(bridge.probe.encode(self.profile)).hexdigest(),
                 'not_before': bridge.probe.utc(self.now), 'expires_at': bridge.probe.utc(self.now+3600),
                 'authority_until': bridge.probe.utc(self.now+7200),
                 'max_calls': 240, 'max_new_requests': 24,
                 'call_interval_seconds': 5, 'new_request_interval_seconds': 60}
        value.update(changes)
        self.policy_path = self.root/'policy.json'
        self.policy_path.write_text(json.dumps(value)); self.policy_path.chmod(0o600)
        return value

    def init(self, **changes):
        self.policy(**changes)
        return bridge.initialize_policy(self.config, self.state, self.policy_path, clock=lambda:self.now)

    def call(self, op='health.check', rid=RID, **kwargs):
        return base.BridgeTests.call(self, op, rid, policy_path=self.policy_path, **kwargs)

    def counts(self):
        with closing(sqlite3.connect(self.state/'requests.sqlite')) as db:
            return db.execute('SELECT calls, (SELECT count(*) FROM bot_reservations) FROM bot_policy').fetchone()

    def test_explicit_init_and_no_reinit(self):
        self.policy()
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_NOT_INITIALIZED'): self.call()
        self.init()
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_ALREADY_INITIALIZED'):
            bridge.initialize_policy(self.config,self.state,self.policy_path,clock=lambda:self.now)
        self.assertEqual(self.counts(), (0,0)); self.assertEqual(self.calls, [])

    def test_strict_policy(self):
        for changes in ({'max_calls':True}, {'max_calls':241}, {'max_new_requests':25},
                        {'call_interval_seconds':4}, {'new_request_interval_seconds':59},
                        {'expires_at':bridge.probe.utc(self.now+86401)},
                        {'authority_until':bridge.probe.utc(self.now+1)}, {'extra':1}):
            with self.subTest(changes=changes):
                self.policy(**changes)
                with self.assertRaisesRegex(bridge.BridgeError, 'INVALID_POLICY'):
                    bridge.initialize_policy(self.config,self.state,self.policy_path,clock=lambda:self.now)
        self.assertEqual(self.calls, [])

    def test_config_binding_and_policy_modification(self):
        self.init(); self.profile['generation']=2; self.config.write_text(json.dumps(self.profile))
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_CONTEXT_MISMATCH'): self.call()
        self.profile['generation']=1; self.config.write_text(json.dumps(self.profile))
        self.policy(max_calls=239)
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_CONTEXT_MISMATCH'): self.call()
        self.assertEqual(self.calls, [])

    def test_omitting_policy_cannot_bypass_bound_state(self):
        self.init()
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_REQUIRED'): base.BridgeTests.call(self)
        self.assertEqual(self.calls, [])

    def test_calls_persist_across_handles_and_local_status_counts(self):
        self.init(max_calls=2)
        self.assertEqual(self.call('health.status')['state'], 'not_found')
        self.now+=5; self.call('health.status')
        self.now+=5
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_CALL_LIMIT'): self.call()
        self.assertEqual(self.counts(), (2,0)); self.assertEqual(self.calls, [])

    def test_interval_and_clock_rollback(self):
        self.init(); self.call(); count=len(self.calls)
        self.now+=4
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_RATE_LIMITED'): self.call()
        self.now-=5
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_CLOCK_ROLLBACK'): self.call()
        self.now+=7
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_RATE_LIMITED'): self.call(rid=RID2)
        self.assertEqual(len(self.calls),count); self.assertEqual(self.counts(), (1,1))

    def test_expiry_blocks_status_and_submission(self):
        self.init(); self.now+=3600
        for op in ('health.status','health.check'):
            with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_EXPIRED'): self.call(op)
        self.assertEqual(self.calls, [])

    def test_lost_ack_retry_keeps_bytes_and_new_budget(self):
        self.init(max_new_requests=1); self.fail_ack=True
        self.assertEqual(self.call()['state'],'unconfirmed'); raw=self.calls[-1][2]
        self.now+=5; self.fail_ack=False
        self.assertEqual(self.call()['state'],'accepted'); self.assertEqual(self.calls[-1][2],raw)
        self.now+=60
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_NEW_REQUEST_LIMIT'): self.call(rid=RID2)
        self.assertEqual(self.counts(), (2,1))

    def test_bootstrap_failure_consumes_new_id_reservation(self):
        self.init(max_new_requests=1); self.denied=True; self.call()
        self.now+=60; self.denied=False
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_NEW_REQUEST_LIMIT'): self.call(rid=RID2)
        self.assertEqual(self.call()['state'],'accepted'); self.assertEqual(self.counts(), (2,1))

    def test_reservation_is_committed_before_network_and_failure_prevents_io(self):
        self.init()
        original=self.transport
        def transport(*args):
            self.assertEqual(self.counts(),(1,1)); return original(*args)
        with patch.object(self,'transport',side_effect=transport): self.call()
        self.now+=5
        with closing(sqlite3.connect(self.state/'requests.sqlite')) as db:
            db.execute("CREATE TRIGGER fail_budget BEFORE UPDATE ON bot_policy BEGIN SELECT RAISE(ABORT,'full'); END")
            db.commit()
        count=len(self.calls)
        with self.assertRaises(bridge.BridgeError): self.call()
        self.assertEqual(len(self.calls), count)

    def test_state_loss_fails_closed(self):
        self.init(); (self.state/'requests.sqlite').unlink()
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_NOT_INITIALIZED'): self.call()
        self.assertEqual(self.calls, [])

    def test_expiry_between_bootstrap_and_post_keeps_reservation(self):
        self.init(expires_at=bridge.probe.utc(self.now+10))
        original=self.transport
        def transport(*args):
            result=original(*args); self.now+=10; return result
        with patch.object(self,'transport',side_effect=transport):
            result=self.call()
        self.assertEqual(result['code'],'POLICY_EXPIRED'); self.assertFalse(result['verified'])
        self.assertFalse(any(m=='POST' for m,_,_ in self.calls)); self.assertEqual(self.counts(),(1,1))

    def test_existing_request_preserved_and_not_new(self):
        base.BridgeTests.call(self); self.init(max_new_requests=1)
        self.assertEqual(self.call()['state'],'accepted'); self.assertEqual(self.counts(),(1,0))
        self.assertEqual(sum(m=='POST' for m,_,_ in self.calls),1)

    def test_observed_expiry_cannot_be_reversed_by_clock_after_restart(self):
        self.init(); self.call('health.status'); self.now+=3600
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_EXPIRED'): self.call()
        self.now-=10
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_CLOCK_ROLLBACK'): self.call()
        self.assertEqual(self.counts(),(1,0)); self.assertEqual(self.calls,[])

    def test_expiry_during_call_is_persistent(self):
        self.init(expires_at=bridge.probe.utc(self.now+10))
        original=self.transport
        def transport(*args):
            result=original(*args); self.now+=10; return result
        with patch.object(self,'transport',side_effect=transport): self.call()
        count=len(self.calls); self.now-=1
        with self.assertRaisesRegex(bridge.BridgeError, 'POLICY_CLOCK_ROLLBACK'): self.call()
        self.assertEqual(len(self.calls),count); self.assertEqual(self.counts(),(1,1))

    def test_policy_owner_only_permissions(self):
        self.init(); self.policy_path.chmod(0o400)
        self.assertEqual(self.call('health.status')['state'],'not_found')
        self.policy_path.chmod(0o640); self.now+=5
        with self.assertRaisesRegex(bridge.BridgeError,'INVALID_POLICY'): self.call()
        self.assertEqual(self.calls,[])

    def test_lock_prevents_concurrent_admission(self):
        self.init()
        with bridge.journal(self.state):
            with self.assertRaisesRegex(bridge.BridgeError,'STATE_BUSY'): self.call()
        self.assertEqual(self.counts(),(0,0)); self.assertEqual(self.calls,[])


if __name__=='__main__': unittest.main()
