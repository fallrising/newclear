"""Synthetic durable dispatch tests; no SSH or effective host configuration."""
import copy
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_staging_ops as ops
from fresh_rebuild import plan_digest
import test_fresh_network_access as fixture
import pending_generation


class Adapter:
    def __init__(self, now, lose=False):
        self.now, self.lose = now, lose
        self.calls, self.states = [], {}

    def observe(self, action):
        self.calls.append(('observe', action['host_index']))
        host = action['host']
        return {'observed_at': self.now.isoformat(),
                'host': {k: v for k, v in host.items() if k != 'files'},
                'directory': {'path': '/etc/eru', 'kind': 'directory', 'uid': 0,
                              'gid': 0, 'mode': '0700'},
                'files': copy.deepcopy(self.states.get(action['host_index'],
                    [{'path': f['path'], 'kind': 'absent'} for f in host['files']]))}

    def stage(self, action, intent_sha256):
        self.calls.append(('stage', action['host_index']))
        self.states[action['host_index']] = [
            {'path': f['path'], 'kind': 'regular', 'uid': 0, 'gid': 0,
             'mode': '0600', 'nlink': 1, 'sha256': f['sha256'],
             'intent_sha256': intent_sha256} for f in action['host']['files']]
        if self.lose:
            raise OSError('lost response with private data')
        return {'status': 'irrelevant'}


class NetworkStagingTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkAccessTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.project, self.now, self.source = self.f.project, self.f.now, self.f.source
        self.plan = self.f.prepare()
        self.assertEqual(self.plan['status'], 'planned')
        self.run = self.f.f.f.r.run
        self.authpath = 'private/network-staging-authorization.json'
        self.auth = {'schema_version': 1,
            'operation': 'fresh-network-file-staging-authorization',
            'plan_id': self.plan['id'], 'plan_sha256': self.plan['sha256'],
            'execution_sha256': self.plan['execution_sha256'],
            'pending_sha256': pending_generation.inspect(self.project)['sha256'],
            'scope': 'stage-network-files-only', 'owner_confirmed': True,
            'authorized_at': self.now.isoformat(),
            'expires_at': (self.now + timedelta(minutes=15)).isoformat()}
        self.save_auth()
        self.adapter = Adapter(self.now)

    def save_auth(self):
        self.authsha = self.f.f.f.r.write(self.authpath, self.auth)
        self.f.f.f.r.f.secure()

    def stage(self, host=0, **kw):
        return ops.stage_network_files(self.project, self.plan['id'], self.plan['sha256'],
            self.authpath, self.authsha, host, self.adapter, now=self.now,
            source_state=self.source, **kw)

    def inspect(self, result, host=0):
        return ops.inspect_network_staging(self.project, self.run, host,
            result['intent_sha256'], now=self.now, source_state=self.source)

    def reconcile(self, result, host=0):
        return ops.reconcile_network_files(self.project, self.run, host,
            result['intent_sha256'], self.adapter, now=self.now, source_state=self.source)

    def slot(self, host=0):
        return self.project / ops.AREA / self.run / ('host-' + str(host))

    def test_lost_response_intent_is_durable_and_never_replayed(self):
        self.adapter.lose = True
        result = self.stage()
        self.assertEqual(result['status'], 'uncertain')
        self.assertTrue(result['dispatch_attempted'])
        self.assertTrue((self.slot() / 'intent.json').exists())
        before = list(self.adapter.calls)
        repeated = self.stage()
        self.assertEqual(repeated['status'], 'uncertain')
        self.assertFalse(repeated['dispatch_attempted'])
        self.assertEqual(self.adapter.calls, before)
        self.assertEqual(self.inspect(result)['status'], 'uncertain')
        self.assertEqual(self.reconcile(result)['status'], 'staged')
        self.assertEqual([x for x in self.adapter.calls if x[0] == 'stage'], [('stage', 0)])

    def test_four_hosts_require_complete_order_and_preserve_pending(self):
        before = pending_generation.inspect(self.project)
        self.assertEqual(self.stage(1)['status'], 'blocked')
        self.assertEqual(self.adapter.calls, [])
        results = [self.stage(i) for i in range(4)]
        self.assertEqual([x['status'] for x in results], ['staged'] * 4)
        self.assertEqual(pending_generation.inspect(self.project), before)
        prior = self.plan['execution_sha256']
        for index, result in enumerate(results):
            intent = json.loads((self.slot(index) / 'intent.json').read_text())['intent']
            self.assertEqual(intent['predecessor_sha256'], prior)
            prior = result['receipt_sha256']
            self.assertEqual(self.inspect(result, index)['status'], 'staged')
        before_calls = list(self.adapter.calls)
        self.assertEqual(self.stage(3)['status'], 'staged')
        self.assertEqual(self.adapter.calls, before_calls)

    def test_existing_file_and_unsafe_directory_never_claim_or_dispatch(self):
        original = self.adapter.observe
        for modify in (lambda o: o['directory'].update(uid=True),
                       lambda o: o['directory'].update(mode='0755'),
                       lambda o: o['directory'].update(kind='symlink'),
                       lambda o: o['files'][0].update(kind='regular'),
                       lambda o: o['host'].update(machine_id='foreign')):
            def changed(action):
                value = original(action)
                modify(value)
                return value
            with patch.object(self.adapter, 'observe', side_effect=changed):
                self.assertEqual(self.stage()['status'], 'blocked')
            self.assertFalse(self.slot().exists())
        self.assertFalse(any(x[0] == 'stage' for x in self.adapter.calls))

    def test_authorization_exact_binding_time_and_types(self):
        original = copy.deepcopy(self.auth)
        for change in ({'owner_confirmed': 1}, {'schema_version': True}, {'extra': True},
                       {'scope': 'activate-network'}, {'plan_sha256': 'f' * 64},
                       {'expires_at': (self.now + timedelta(minutes=16)).isoformat()},
                       {'authorized_at': (self.now + timedelta(seconds=1)).isoformat()}):
            self.auth = {**original, **change}
            self.save_auth()
            self.assertEqual(self.stage()['status'], 'blocked')
        self.assertEqual(self.adapter.calls, [])

    def test_postcondition_without_provenance_cannot_adopt_or_replay(self):
        original = self.adapter.stage
        def wrong(action, digest):
            original(action, digest)
            self.adapter.states[0][0]['intent_sha256'] = 'f' * 64
        with patch.object(self.adapter, 'stage', side_effect=wrong):
            result = self.stage()
        self.assertEqual(result['status'], 'uncertain')
        self.assertEqual(self.reconcile(result)['status'], 'uncertain')
        self.assertFalse((self.slot() / 'receipt.json').exists())
        self.assertEqual(self.stage()['status'], 'uncertain')
        self.assertEqual([x for x in self.adapter.calls if x[0] == 'stage'], [('stage', 0)])

    def test_raw_intent_mutation_and_late_publish_failure_prevent_dispatch(self):
        publish = ops._publish
        def mutate(files, directory, name, value):
            result = publish(files, directory, name, value)
            target = self.slot() / name
            target.write_bytes(target.read_bytes() + b' ')
            return result
        with patch.object(ops, '_publish', side_effect=mutate):
            self.assertEqual(self.stage()['status'], 'blocked')
        self.assertTrue((self.slot() / '.staging-failed').exists())
        self.assertFalse(any(x[0] == 'stage' for x in self.adapter.calls))
        self.assertEqual(self.stage()['status'], 'blocked')

    def test_late_receipt_failure_is_poisoned_and_never_recovered(self):
        publish = ops._publish
        def fail(files, directory, name, value):
            result = publish(files, directory, name, value)
            if name == 'receipt.json':
                raise OSError('late fsync error')
            return result
        with patch.object(ops, '_publish', side_effect=fail):
            result = self.stage()
        self.assertEqual(result['status'], 'blocked')
        self.assertTrue(result['dispatch_attempted'])
        self.assertTrue((self.slot() / '.staging-failed').exists())
        self.assertEqual(self.inspect(result)['status'], 'blocked')
        self.assertEqual(self.reconcile(result)['status'], 'blocked')

    def test_readonly_inspector_and_redacted_output(self):
        result = self.stage()
        real_open = os.open
        def readonly(path, flags, *args, **kwargs):
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return real_open(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=readonly), \
                patch.object(os, 'mkdir', side_effect=AssertionError('write')), \
                patch('subprocess.Popen', side_effect=AssertionError('transport')):
            self.assertEqual(self.inspect(result)['status'], 'staged')
        public = json.dumps(result)
        for secret in ('private/', '100.100.', 'ssh-ed25519', 'replacement-machine', 'lost response'):
            self.assertNotIn(secret, public)
        for flag in ('stage_accepted', 'generation_changed', 'external_fence_verified'):
            self.assertIs(result[flag], False)

    def test_different_plan_cannot_replay_existing_execution_slot(self):
        self.adapter.lose = True
        result = self.stage()
        self.f.plan_id = 'new-access-plan'
        self.plan = self.f.prepare()
        self.auth['plan_id'], self.auth['plan_sha256'] = self.plan['id'], self.plan['sha256']
        self.authpath = 'private/new-staging-authorization.json'
        self.save_auth()
        calls = list(self.adapter.calls)
        self.assertEqual(self.stage()['status'], 'blocked')
        self.assertEqual(self.adapter.calls, calls)
        self.assertEqual(self.inspect(result)['status'], 'uncertain')

    def test_rehashed_intent_payload_cannot_authorize_other_files(self):
        self.adapter.lose = True
        result = self.stage()
        path = self.slot() / 'intent.json'
        envelope = json.loads(path.read_text())
        envelope['intent']['action']['host']['files'][0]['path'] = '/etc/ssh/authorized_keys'
        envelope['sha256'] = plan_digest(envelope['intent'])
        path.write_text(json.dumps(envelope))
        forged = {**result, 'intent_sha256': envelope['sha256']}
        self.assertEqual(self.inspect(forged)['status'], 'blocked')
        self.assertEqual(self.reconcile(forged)['status'], 'blocked')

    def test_adapter_mutation_cannot_change_published_action(self):
        observe = self.adapter.observe
        def mutate(action):
            result = observe(action)
            action['host']['files'][0]['path'] = '/evil'
            return result
        with patch.object(self.adapter, 'observe', side_effect=mutate):
            result = self.stage()
        self.assertEqual(result['status'], 'staged')
        intent = json.loads((self.slot() / 'intent.json').read_text())['intent']
        self.assertEqual(intent['action']['host']['files'][0]['path'], '/etc/eru/fresh-access.nft')

    def test_same_slot_race_dispatches_once(self):
        import concurrent.futures
        import threading
        barrier = threading.Barrier(2)
        observe = self.adapter.observe
        def pause(action):
            result = observe(action)
            if all(item['kind'] == 'absent' for item in result['files']):
                barrier.wait(timeout=20)
            return result
        with patch.object(self.adapter, 'observe', side_effect=pause), \
                concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.stage(), range(2)))
        self.assertEqual(sorted(x['status'] for x in results), ['blocked', 'staged'])
        self.assertEqual([x for x in self.adapter.calls if x[0] == 'stage'], [('stage', 0)])
        self.assertFalse((self.slot() / '.staging-failed').exists())

    def test_final_clock_rechecks_old_before_observation(self):
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
            self.assertEqual(self.stage()['status'], 'blocked')
        self.assertFalse(any(x[0] == 'stage' for x in self.adapter.calls))
        self.assertTrue((self.slot() / '.staging-failed').exists())

    def test_run_unknown_entry_blocks_and_host_slot_bool_rejects(self):
        parent = self.slot().parent
        parent.mkdir(mode=0o700, parents=True)
        for item in parent.parents:
            if item == self.project:
                break
            item.chmod(0o700)
        (parent / 'foreign').write_bytes(b'')
        (parent / 'foreign').chmod(0o600)
        self.assertEqual(self.stage()['status'], 'blocked')
        self.assertEqual(self.adapter.calls, [])
        with self.assertRaises(ValueError):
            self.stage(True)

    def test_concurrent_reconcile_receipt_has_single_owner(self):
        import concurrent.futures
        import threading
        self.adapter.lose = True
        result = self.stage()
        barrier = threading.Barrier(2)
        original = ops._Session.final
        counts = {}
        def simultaneous(session, envelope):
            original(session, envelope)
            ident = threading.get_ident()
            counts[ident] = counts.get(ident, 0) + 1
            if counts[ident] == 2:
                barrier.wait(timeout=20)
        with patch.object(ops._Session, 'final', new=simultaneous), \
                concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.reconcile(result), range(2)))
        self.assertEqual(sorted(x['status'] for x in results), ['blocked', 'staged'])
        self.assertFalse((self.slot() / '.staging-failed').exists())
        self.assertEqual(self.inspect(result)['status'], 'staged')

    def test_reconcile_winner_during_stage_response_is_not_poisoned(self):
        stage = self.adapter.stage
        recovered = []
        def interleave(action, digest):
            stage(action, digest)
            recovered.append(self.reconcile({'intent_sha256': digest}))
        with patch.object(self.adapter, 'stage', side_effect=interleave):
            result = self.stage()
        self.assertEqual(recovered[0]['status'], 'staged')
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse((self.slot() / '.staging-failed').exists())
        self.assertEqual(self.inspect(result)['status'], 'staged')
        self.assertEqual([x for x in self.adapter.calls if x[0] == 'stage'], [('stage', 0)])

    def test_intent_fsync_failure_retains_claim_with_no_dispatch(self):
        publish = ops._publish
        def fail(*args):
            publish(*args)
            raise OSError('intent fsync failure')
        with patch.object(ops, '_publish', side_effect=fail):
            self.assertEqual(self.stage()['status'], 'blocked')
        self.assertTrue((self.slot() / 'intent.json').exists())
        self.assertTrue((self.slot() / '.staging-failed').exists())
        self.assertEqual(self.stage()['status'], 'blocked')
        self.assertFalse(any(x[0] == 'stage' for x in self.adapter.calls))

    def test_custom_before_exception_is_redacted_without_claim(self):
        class PrivateFailure(Exception):
            pass
        with patch.object(self.adapter, 'observe', side_effect=PrivateFailure('PRIVATE HOST SECRET')):
            result = self.stage()
        self.assertEqual(result['status'], 'blocked')
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertFalse(self.slot().exists())

    def test_final_pending_check_after_last_plan_prevents_dispatch(self):
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
            result = self.stage()
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse(any(x[0] == 'stage' for x in self.adapter.calls))
        self.assertTrue((self.slot() / '.staging-failed').exists())

    def test_late_receipt_claim_loser_cannot_poison_completed_winner(self):
        self.adapter.lose = True
        result = self.stage()
        original = os.open
        nested = []
        def interleave(path, flags, *args, **kwargs):
            if path == '.receipt-claim' and not nested:
                nested.append(None)
                nested[0] = self.reconcile(result)
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=interleave):
            loser = self.reconcile(result)
        self.assertEqual(nested[0]['status'], 'staged')
        self.assertEqual(loser['status'], 'blocked')
        self.assertFalse((self.slot() / '.receipt-claim').exists())
        self.assertFalse((self.slot() / '.staging-failed').exists())
        self.assertEqual(self.inspect(result)['status'], 'staged')
