from contextlib import closing
import json
import sqlite3
import unittest
import test_bot_policy as bp
bridge = bp.bridge
RID = bp.RID
RID2 = bp.RID2


class RenewalTests(unittest.TestCase):
    setUp = bp.PolicyTests.setUp
    transport = bp.PolicyTests.transport
    policy = bp.PolicyTests.policy
    init = bp.PolicyTests.init
    call = bp.PolicyTests.call
    counts = bp.PolicyTests.counts

    def candidate(self, **changes):
        old=json.loads(self.policy_path.read_text())
        end=bridge.protocol.timestamp(old['expires_at'])
        value={**old,'not_before':bridge.probe.utc(end),'expires_at':bridge.probe.utc(end+3600),
               'authority_until':bridge.probe.utc(end+7200),**changes}
        self.next_path=self.root/'next.json'; self.next_path.write_text(json.dumps(value)); self.next_path.chmod(0o600)
        return value

    def renew(self, **kwargs):
        return bridge.renew_policy(self.config,self.state,self.policy_path,self.next_path,clock=lambda:self.now,**kwargs)

    def snapshot(self):
        with closing(sqlite3.connect(self.state/'requests.sqlite')) as db:
            return {name:list(db.execute('SELECT * FROM '+name)) for name in ('requests','bot_policy','bot_reservations')}

    def receipts(self):
        with closing(sqlite3.connect(self.state/'requests.sqlite')) as db:
            return [json.loads(row[0]) for row in db.execute('SELECT receipt FROM bot_policy_renewals')]

    def test_preview_is_offline_and_preserves_every_row(self):
        self.init(); self.call('health.status'); self.candidate(); before=self.snapshot()
        result=self.renew(dry_run=True)
        self.assertEqual(result['state'],'planned'); self.assertEqual(result['previous_calls'],1)
        self.assertEqual(result['renewable_at'],json.loads(self.next_path.read_text())['not_before'])
        self.assertEqual(self.snapshot(),before); self.assertEqual(self.calls,[])

    def test_early_exhausted_renewal_is_rejected(self):
        self.init(max_calls=1); self.call('health.status'); self.candidate()
        with self.assertRaisesRegex(bridge.BridgeError,'POLICY_RENEWAL_TOO_EARLY'): self.renew()
        self.assertEqual(self.counts(),(1,0)); self.assertEqual(self.calls,[])

    def test_nonoverlap_binding_and_hard_bounds(self):
        self.init()
        for change,code in [({'not_before':bridge.probe.utc(self.now+3599)},'INVALID_POLICY_RENEWAL'),
                            ({'config_sha256':'f'*64},'POLICY_CONTEXT_MISMATCH'),
                            ({'max_calls':241},'INVALID_POLICY')]:
            with self.subTest(change=change):
                self.candidate(**change)
                with self.assertRaisesRegex(bridge.BridgeError,code): self.renew(dry_run=True)
        self.assertEqual(self.counts(),(0,0))

    def test_atomic_archive_and_request_preservation(self):
        self.init(); self.call(); before=self.snapshot(); self.candidate(); self.now+=3600
        out=self.renew(); self.assertEqual(out['state'],'renewed')
        after=self.snapshot(); self.assertEqual(after['requests'],before['requests']); self.assertEqual(self.counts(),(0,0))
        receipt=self.receipts()[0]
        self.assertEqual(receipt['previous_ledger']['calls'],1)
        self.assertEqual(float.fromhex(receipt['previous_ledger']['high_water']), self.now)
        self.assertEqual(receipt['reservation_ids'],[RID]); self.assertEqual(len(self.receipts()),1)
        self.assertEqual(receipt['previous_policy'],json.loads(self.policy_path.read_text()))
        with self.assertRaisesRegex(bridge.BridgeError,'POLICY_CONTEXT_MISMATCH'): self.call()
        self.policy_path=self.next_path
        self.assertEqual(self.call()['state'],'accepted'); self.assertEqual(self.counts(),(1,0))
        self.assertEqual(sum(m=='POST' for m,_,_ in self.calls),1)

    def test_replay_after_usage_does_not_replenish(self):
        self.init(); self.candidate(); self.now+=3600; self.renew()
        old=self.policy_path; self.policy_path=self.next_path; self.call('health.status'); self.policy_path=old
        before=self.snapshot(); self.now+=5
        out=self.renew(); self.assertEqual(out['state'],'already_applied')
        after=self.snapshot()
        self.assertEqual(after['requests'],before['requests']); self.assertEqual(after['bot_reservations'],before['bot_reservations'])
        self.assertEqual(after['bot_policy'][0][:3],before['bot_policy'][0][:3])
        self.assertEqual(after['bot_policy'][0][4:],before['bot_policy'][0][4:])
        self.assertEqual(after['bot_policy'][0][3],self.now); self.assertEqual(len(self.receipts()),1)

    def test_transaction_failure_leaves_old_budget_and_reservations(self):
        self.init(); self.call(); self.candidate(); self.now+=3600
        with closing(sqlite3.connect(self.state/'requests.sqlite')) as db:
            db.execute("CREATE TRIGGER refuse_reset BEFORE DELETE ON bot_reservations BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END"); db.commit()
        before=self.snapshot()
        with self.assertRaises(bridge.BridgeError): self.renew()
        after=self.snapshot(); self.assertEqual(after['requests'],before['requests']); self.assertEqual(after['bot_reservations'],before['bot_reservations'])
        self.assertEqual(after['bot_policy'][0][1:3],before['bot_policy'][0][1:3])
        with closing(sqlite3.connect(self.state/'requests.sqlite')) as db:
            self.assertIsNone(db.execute("SELECT 1 FROM sqlite_master WHERE name='bot_policy_renewals'").fetchone())

    def test_lock_serializes_renewal_with_calls(self):
        self.init(); self.candidate(); self.now+=3600
        with bridge.journal(self.state):
            with self.assertRaisesRegex(bridge.BridgeError,'STATE_BUSY'): self.renew()
        self.assertEqual(self.counts(),(0,0))

    def test_bootstrap_only_reservation_charges_new_lease(self):
        self.init(); self.denied=True; self.call(); self.candidate(); self.now+=3600; self.renew()
        self.policy_path=self.next_path; self.denied=False; self.call()
        self.assertEqual(self.counts(),(1,1)); self.assertEqual(self.receipts()[0]['reservation_ids'],[RID])

    def test_lost_ack_payload_survives_renewal(self):
        self.init(); self.fail_ack=True; self.call(); payload=self.calls[-1][2]
        self.candidate(); self.now+=3600; self.renew(); self.policy_path=self.next_path; self.fail_ack=False
        self.assertEqual(self.call()['state'],'accepted'); self.assertEqual(self.calls[-1][2],payload)
        self.assertEqual(self.counts(),(1,0))

    def test_cross_window_intervals_and_high_water_are_preserved(self):
        self.init(expires_at=bridge.probe.utc(self.now+10)); self.call(); self.now+=9; self.call('health.status')
        self.candidate(); self.now+=1; self.renew(); self.policy_path=self.next_path
        with self.assertRaisesRegex(bridge.BridgeError,'POLICY_RATE_LIMITED'): self.call('health.status')
        self.now+=5
        with self.assertRaisesRegex(bridge.BridgeError,'POLICY_RATE_LIMITED'): self.call(rid=RID2)
        self.now-=1
        with self.assertRaisesRegex(bridge.BridgeError,'POLICY_CLOCK_ROLLBACK'): self.call('health.status')
        self.assertEqual(self.counts(),(0,0))

    def test_future_and_expired_candidate_cannot_be_applied(self):
        self.init(); self.candidate(not_before=bridge.probe.utc(self.now+4000)); self.now+=3600
        with self.assertRaisesRegex(bridge.BridgeError,'POLICY_NOT_STARTED'): self.renew()
        self.now+=3600
        with self.assertRaisesRegex(bridge.BridgeError,'POLICY_EXPIRED'): self.renew()
        self.now-=1
        with self.assertRaisesRegex(bridge.BridgeError,'POLICY_CLOCK_ROLLBACK'): self.renew()
        self.assertEqual(self.counts(),(0,0))

    def test_missing_state_cannot_be_renewed(self):
        self.init(); self.candidate(); (self.state/'requests.sqlite').unlink(); self.now+=3600
        with self.assertRaisesRegex(bridge.BridgeError,'POLICY_NOT_INITIALIZED'): self.renew()

    def test_second_renewal_keeps_history_and_stale_replay_refused(self):
        self.init(); original=self.policy_path; self.candidate(); second=self.next_path
        self.now+=3600; self.renew(); self.policy_path=second
        third={**json.loads(second.read_text()),'not_before':bridge.probe.utc(self.now+3600),
               'expires_at':bridge.probe.utc(self.now+7200),'authority_until':bridge.probe.utc(self.now+7200)}
        self.next_path=self.root/'third.json'; self.next_path.write_text(json.dumps(third)); self.next_path.chmod(0o600)
        self.now+=3600; self.renew(); self.assertEqual(len(self.receipts()),2)
        self.policy_path=original; self.next_path=second
        with self.assertRaisesRegex(bridge.BridgeError,'POLICY_CONTEXT_MISMATCH'): self.renew()

    def test_replay_after_new_expiry_preserves_clock_observation(self):
        self.init(); self.candidate(); self.now+=3600; self.renew()
        self.now+=3600
        self.assertEqual(self.renew()['state'],'already_applied')
        self.now-=1; self.policy_path=self.next_path
        with self.assertRaisesRegex(bridge.BridgeError,'POLICY_CLOCK_ROLLBACK'): self.call('health.status')
        self.assertEqual(self.counts(),(0,0)); self.assertEqual(self.calls,[])

    def test_replay_preview_remains_read_only(self):
        self.init(); self.candidate(); self.now+=3600; self.renew()
        before=self.snapshot(); self.now+=3600
        self.assertEqual(self.renew(dry_run=True)['state'],'already_applied')
        self.assertEqual(self.snapshot(),before)

    def test_corrupt_receipt_cannot_claim_replay_success(self):
        self.init(); self.candidate(); self.now+=3600; self.renew()
        with closing(sqlite3.connect(self.state/'requests.sqlite')) as db:
            db.execute("UPDATE bot_policy_renewals SET receipt='{}'"); db.commit()
        with self.assertRaisesRegex(bridge.BridgeError,'STATE_CORRUPT'): self.renew()


if __name__=='__main__': unittest.main()
