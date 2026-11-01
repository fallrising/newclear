"""Synthetic durable firewall lifecycle; no kernel or host transport."""
import copy
from datetime import timedelta
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_firewall_ops as ops
import fresh_network_firewall as contract
import fresh_network_staging_ops as staging
import test_fresh_network_staging as fixture
from fresh_rebuild import plan_digest


class Adapter:
    def __init__(self, f):
        self.f, self.calls, self.states, self.lose = f, [], {}, False

    def observe(self, action):
        self.calls.append(('observe', action['host_index']))
        value = self.f.adapter.observe(action)
        value['table'] = copy.deepcopy(self.states.get(action['host_index'], {'kind': 'absent'}))
        return value

    def activate(self, action, digest):
        self.calls.append(('activate', action['host_index']))
        self.states[action['host_index']] = {'kind': 'present',
            'ruleset': contract.expected_ruleset(action), 'intent_sha256': digest}
        if self.lose:
            raise OSError('private lost response')


class FirewallLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkStagingTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.project, self.now, self.source = self.f.project, self.f.now, self.f.source
        self.authpath = 'private/firewall-authorization.json'
        self.auth = {**self.f.auth, 'operation': contract.OPERATION + '-authorization',
                     'scope': 'activate-fresh-firewall-only'}
        self.save_auth()
        self.adapter = Adapter(self.f)

    def save_auth(self):
        self.authsha = self.f.f.f.f.r.write(self.authpath, self.auth)
        self.f.f.f.f.r.f.secure()

    def complete(self):
        self.staged = [self.f.stage(i) for i in range(4)]
        self.assertEqual([r['status'] for r in self.staged], ['staged'] * 4)

    def activate(self, index=0):
        return ops.activate_network_firewall(self.project, self.f.plan['id'], self.f.plan['sha256'],
            self.authpath, self.authsha, index, self.adapter, now=self.now, source_state=self.source)

    def inspect(self, result, index=0):
        return ops.inspect_network_firewall(self.project, self.f.run, index,
            result['intent_sha256'], now=self.now, source_state=self.source)

    def reconcile(self, result, index=0):
        return ops.reconcile_network_firewall(self.project, self.f.run, index,
            result['intent_sha256'], self.adapter, now=self.now, source_state=self.source)

    def slot(self, index=0):
        return self.project / ops.AREA / self.f.run / ('host-' + str(index))

    def test_all_four_staging_receipts_required_before_any_observation(self):
        for index in range(4):
            self.assertEqual(self.activate()['status'], 'blocked')
            self.assertEqual(self.adapter.calls, [])
            self.assertEqual(self.f.stage(index)['status'], 'staged')
        result = self.activate()
        self.assertEqual(result['status'], 'firewall-active')
        self.assertEqual(self.adapter.calls, [('observe', 0), ('activate', 0), ('observe', 0)])
        record = json.loads((self.slot() / 'intent.json').read_text())['intent']
        staging_intent = json.loads((self.f.slot() / 'intent.json').read_text())['sha256']
        staging_receipt = json.loads((self.f.slot() / 'receipt.json').read_text())['sha256']
        self.assertEqual(record['action']['staging_intent_sha256'], staging_intent)
        self.assertEqual(record['action']['staging_receipt_sha256'], staging_receipt)
        self.assertFalse(result['stage_accepted'])
        self.assertFalse(result['generation_changed'])

    def test_single_dispatch_lost_reply_readonly_recovery(self):
        self.complete()
        self.adapter.lose = True
        result = self.activate()
        self.assertEqual(result['status'], 'uncertain')
        before = list(self.adapter.calls)
        self.assertEqual(self.activate()['status'], 'uncertain')
        self.assertEqual(self.adapter.calls, before)
        real_open = os.open
        def readonly(path, flags, *args, **kwargs):
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return real_open(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=readonly):
            self.assertEqual(self.inspect(result)['status'], 'uncertain')
        self.assertEqual(self.reconcile(result)['status'], 'firewall-active')
        self.assertEqual([c for c in self.adapter.calls if c[0] == 'activate'], [('activate', 0)])
        encoded = json.dumps(self.inspect(result))
        for secret in ('10.', 'machine_id', 'ruleset', 'private', 'authorization'):
            self.assertNotIn(secret, encoded)

    def test_activation_order_and_receipt_predecessor(self):
        self.complete()
        self.assertEqual(self.activate(1)['status'], 'blocked')
        self.assertEqual(self.adapter.calls, [])
        first = self.activate()
        second = self.activate(1)
        self.assertEqual(second['status'], 'firewall-active')
        intent = json.loads((self.slot(1) / 'intent.json').read_text())['intent']
        self.assertEqual(intent['predecessor_sha256'], first['receipt_sha256'])

    def test_cross_operation_authorization_denied(self):
        self.complete()
        original = copy.deepcopy(self.auth)
        for operation, scope in [('fresh-network-file-staging-authorization', 'stage-network-files-only'),
                                 ('fresh-network-directory-preparation-authorization', 'prepare-network-directory-only')]:
            self.auth = {**original, 'operation': operation, 'scope': scope}
            self.save_auth()
            self.assertEqual(self.activate()['status'], 'blocked')
        self.assertEqual(self.adapter.calls, [])

    def test_existing_table_and_staged_file_drift_denied(self):
        self.complete()
        self.adapter.states[0] = {'kind': 'present', 'ruleset': {}, 'intent_sha256': 'f' * 64}
        self.assertEqual(self.activate()['status'], 'blocked')
        self.adapter.states.clear()
        self.f.adapter.states[0][0]['sha256'] = 'f' * 64
        self.assertEqual(self.activate()['status'], 'blocked')
        self.assertFalse(self.slot().exists())
        self.assertFalse(any(c[0] == 'activate' for c in self.adapter.calls))

    def test_raw_staging_publication_mutation_before_dispatch(self):
        self.complete()
        observe = self.adapter.observe
        def changed(action):
            value = observe(action)
            path = self.f.slot(3) / 'receipt.json'
            path.write_bytes(path.read_bytes() + b' ')
            return value
        with patch.object(self.adapter, 'observe', side_effect=changed):
            result = self.activate()
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse(any(c[0] == 'activate' for c in self.adapter.calls))
        self.assertEqual(self.activate()['status'], 'blocked')

    def test_staging_authority_revoked_after_activation_blocks_receipt(self):
        self.complete()
        activate = self.adapter.activate
        def changed(action, digest):
            activate(action, digest)
            self.f.auth['owner_confirmed'] = False
            self.f.save_auth()
        with patch.object(self.adapter, 'activate', side_effect=changed):
            result = self.activate()
        self.assertEqual(result['status'], 'blocked')
        self.assertTrue(result['dispatch_attempted'])
        self.assertFalse((self.slot() / 'receipt.json').exists())

    def test_absent_after_lost_response_never_replayed(self):
        self.complete()
        self.adapter.lose = True
        result = self.activate()
        self.adapter.states.clear()
        self.assertEqual(self.reconcile(result)['status'], 'uncertain')
        self.assertEqual(self.activate()['status'], 'uncertain')
        self.assertEqual([c for c in self.adapter.calls if c[0] == 'activate'], [('activate', 0)])

    def test_success_return_still_requires_independent_observation(self):
        self.complete()
        with patch.object(self.adapter, 'activate', return_value={'status': 'success'}) as activate:
            result = self.activate()
        activate.assert_called_once()
        self.assertEqual(result['status'], 'uncertain')
        self.assertFalse((self.slot() / 'receipt.json').exists())

    def test_raw_intent_late_failure_prevents_dispatch(self):
        self.complete()
        publish = ops._publish
        def changed(files, directory, name, value):
            digest = publish(files, directory, name, value)
            if name == 'intent.json':
                path = self.slot() / name
                path.write_bytes(path.read_bytes() + b' ')
            return digest
        with patch.object(ops, '_publish', side_effect=changed):
            result = self.activate()
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse(any(c[0] == 'activate' for c in self.adapter.calls))
        self.assertTrue((self.slot() / '.firewall-failed').exists())


    def test_late_receipt_failure_is_poisoned_and_never_recovered(self):
        self.complete()
        publish = ops._publish
        def fail(files, directory, name, value):
            result = publish(files, directory, name, value)
            if name == 'receipt.json':
                raise OSError('late fsync error')
            return result
        with patch.object(ops, '_publish', side_effect=fail):
            result = self.activate()
        self.assertEqual(result['status'], 'blocked')
        self.assertTrue(result['dispatch_attempted'])
        self.assertTrue((self.slot() / '.firewall-failed').exists())
        self.assertEqual(self.inspect(result)['status'], 'blocked')
        self.assertEqual(self.reconcile(result)['status'], 'blocked')

    def test_final_clock_rechecks_old_before_observation(self):
        self.complete()
        real_plan = ops._Session.plan
        observe = self.adapter.observe
        current = [self.now]
        count = [0]
        def old(action):
            result = observe(action)
            result['observed_at'] = (self.now - timedelta(minutes=14, seconds=59)).isoformat()
            return result
        def plan(session, *args):
            result = real_plan(session, *args)
            count[0] += 1
            if count[0] == 3:
                current[0] = self.now + timedelta(seconds=2)
            return result
        with patch.object(self.adapter, 'observe', side_effect=old), \
                patch.object(ops._Session, 'plan', new=plan), \
                patch.object(ops, '_time', side_effect=lambda _: current[0]):
            self.assertEqual(self.activate()['status'], 'blocked')
        self.assertFalse(any(x[0] == 'activate' for x in self.adapter.calls))
        self.assertTrue((self.slot() / '.firewall-failed').exists())

    def test_final_pending_check_after_last_plan_prevents_dispatch(self):
        self.complete()
        original = ops._Session.plan
        count = [0]
        def mutate(session, *args):
            result = original(session, *args)
            count[0] += 1
            if count[0] == 3:
                path = self.project / 'private/pending-generation/reservation.json'
                path.write_bytes(path.read_bytes() + b' ')
            return result
        with patch.object(ops._Session, 'plan', new=mutate):
            result = self.activate()
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse(any(x[0] == 'activate' for x in self.adapter.calls))
        self.assertTrue((self.slot() / '.firewall-failed').exists())

    def test_late_receipt_claim_loser_cannot_poison_completed_winner(self):
        self.complete()
        self.adapter.lose = True
        result = self.activate()
        original = os.open
        nested = []
        def interleave(path, flags, *args, **kwargs):
            if path == '.receipt-claim' and not nested:
                nested.append(None)
                nested[0] = self.reconcile(result)
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=interleave):
            loser = self.reconcile(result)
        self.assertEqual(nested[0]['status'], 'firewall-active')
        self.assertEqual(loser['status'], 'blocked')
        self.assertFalse((self.slot() / '.receipt-claim').exists())
        self.assertFalse((self.slot() / '.firewall-failed').exists())
        self.assertEqual(self.inspect(result)['status'], 'firewall-active')

    def test_replaced_new_local_claim_is_unowned_and_not_poisoned(self):
        self.complete()
        original = ops.PrivateFiles.directory
        swapped = []
        def replace(files, parts, **kwargs):
            if tuple(parts) == tuple(self.slot().relative_to(self.project).parts[1:]) and self.slot().exists() and not swapped:
                moved = self.slot().with_name('saved-host-0')
                self.slot().rename(moved)
                self.slot().mkdir(mode=0o700)
                swapped.append(moved)
            return original(files, parts, **kwargs)
        with patch.object(ops.PrivateFiles, 'directory', new=replace):
            result = self.activate()
        self.assertEqual(result['status'], 'blocked')
        self.assertTrue(swapped)
        self.assertEqual(list(self.slot().iterdir()), [])
        self.assertEqual(list(swapped[0].iterdir()), [])
        self.assertFalse(any(x[0] == 'activate' for x in self.adapter.calls))

    def test_changed_source_state_cannot_dispatch(self):
        self.complete()
        self.source = {**self.source, 'sha': 'e' * 40}
        self.assertEqual(self.activate()['status'], 'blocked')
        self.assertEqual(self.adapter.calls, [])


if __name__ == '__main__':
    unittest.main()
