"""Independent durable staging review using temporary files and a fake adapter."""
import copy
from contextlib import redirect_stdout
import io
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
import test_fresh_network_access_review as fixture


class ReviewAdapter:
    def __init__(self, case):
        self.case, self.calls, self.completed = case, [], {}
        self.lose_response = False
        self.hook = lambda phase, action, value: None

    def observe(self, action):
        self.calls.append(('observe', copy.deepcopy(action)))
        after = action['host_index'] in self.completed
        host = action['host']
        value = {'observed_at': self.case.now.isoformat(),
            'host': {k: host[k] for k in ('alias', 'node', 'ip', 'machine_id', 'boot_id', 'host_key_sha256')},
            'directory': {'path': '/etc/eru', 'kind': 'directory', 'uid': 0, 'gid': 0, 'mode': '0700'},
            'files': []}
        for row in host['files']:
            item = {'path': row['path'], 'kind': 'absent'}
            if after:
                item = {'path': row['path'], 'kind': 'regular', 'uid': 0, 'gid': 0,
                    'mode': '0600', 'nlink': 1, 'sha256': row['sha256'],
                    'intent_sha256': self.completed[action['host_index']]}
            value['files'].append(item)
        self.hook('after' if after else 'before', action, value)
        return value

    def stage(self, action, intent_sha256):
        path = self.case.slot(action['host_index']) / 'intent.json'
        envelope = json.loads(path.read_bytes())
        self.case.assertEqual(envelope['sha256'], intent_sha256)
        self.case.assertEqual(plan_digest(envelope['intent']), intent_sha256)
        self.case.assertEqual(envelope['intent']['action'], action)
        self.calls.append(('stage', copy.deepcopy(action)))
        self.completed[action['host_index']] = intent_sha256
        self.hook('stage', action, None)
        if self.lose_response:
            raise OSError('private adapter response lost: 10.20.30.40')
        return {'untrusted': 'return value is not completion evidence'}


class NetworkStagingIndependentReview(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkAccessIndependentReview()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.project, self.now, self.source = self.f.project, self.f.now, self.f.source
        self.plan = self.f.prepare()
        self.assertEqual(self.plan['status'], 'planned')
        self.run = self.f.f.f.r.run
        self.auth_path = 'private/review-staging-authorization.json'
        self.auth = {'schema_version': 1, 'operation': 'fresh-network-file-staging-authorization',
            'plan_id': self.plan['id'], 'plan_sha256': self.plan['sha256'],
            'execution_sha256': self.f.f.execution['sha256'], 'pending_sha256': self.f.f.pending_sha,
            'scope': 'stage-network-files-only', 'owner_confirmed': True,
            'authorized_at': self.now.isoformat(), 'expires_at': (self.now + timedelta(minutes=15)).isoformat()}
        self.save_auth()
        self.adapter = ReviewAdapter(self)

    def save_auth(self):
        self.auth_sha = self.f.f.f.r.write(self.auth_path, self.auth)
        self.f.f.f.r.f.secure()

    def slot(self, index=0):
        return self.project / ops.AREA / self.run / ('host-' + str(index))

    def stage(self, index=0, **kwargs):
        options = {'now': self.now, 'source_state': self.source}
        options.update(kwargs)
        return ops.stage_network_files(self.project, self.plan['id'], self.plan['sha256'],
            self.auth_path, self.auth_sha, index, self.adapter, **options)

    def inspect(self, result, index=0, **kwargs):
        options = {'now': self.now, 'source_state': self.source}
        options.update(kwargs)
        return ops.inspect_network_staging(self.project, self.run, index, result['intent_sha256'], **options)

    def reconcile(self, result, index=0, **kwargs):
        options = {'now': self.now, 'source_state': self.source}
        options.update(kwargs)
        class ObserverOnly:
            observe = self.adapter.observe
        return ops.reconcile_network_files(self.project, self.run, index,
            result['intent_sha256'], ObserverOnly(), **options)

    def dispatches(self):
        return len([call for call in self.adapter.calls if call[0] == 'stage'])

    def test_lost_response_is_never_replayed_and_recovery_requires_exact_provenance(self):
        self.adapter.lose_response = True
        result = self.stage()
        self.assertEqual(result['status'], 'uncertain')
        self.assertEqual(self.dispatches(), 1)
        calls = copy.deepcopy(self.adapter.calls)
        self.assertEqual(self.stage()['status'], 'uncertain')
        self.assertEqual(self.adapter.calls, calls)
        before = self.f.f.f.r.snapshot()
        self.assertEqual(self.inspect(result)['status'], 'uncertain')
        self.assertEqual(before, self.f.f.f.r.snapshot())
        self.adapter.completed[0] = 'f' * 64
        self.assertNotEqual(self.reconcile(result)['status'], 'staged')
        self.adapter.completed[0] = result['intent_sha256']
        self.assertEqual(self.reconcile(result)['status'], 'staged')
        self.assertEqual(self.dispatches(), 1)
        calls = copy.deepcopy(self.adapter.calls)
        self.assertEqual(self.reconcile(result)['status'], 'staged')
        self.assertEqual(calls, self.adapter.calls)

    def test_other_plan_cannot_reclaim_same_execution_host(self):
        self.adapter.lose_response = True
        self.assertEqual(self.stage()['status'], 'uncertain')
        self.plan = self.f.prepare('independent-alternate-plan')
        self.auth.update(plan_id=self.plan['id'], plan_sha256=self.plan['sha256'])
        self.save_auth()
        self.assertEqual(self.stage()['status'], 'blocked')
        self.assertEqual(self.dispatches(), 1)

    def test_all_predecessors_are_revalidated_and_chain_is_ordered(self):
        self.assertEqual(self.stage(1)['status'], 'blocked')
        self.assertEqual(self.dispatches(), 0)
        results = [self.stage(index) for index in range(4)]
        self.assertEqual([r['status'] for r in results], ['staged'] * 4)
        previous = self.f.f.execution['sha256']
        for index, result in enumerate(results):
            intent = json.loads((self.slot(index) / 'intent.json').read_bytes())['intent']
            self.assertEqual(intent['predecessor_sha256'], previous)
            previous = result['receipt_sha256']
        path = self.slot(0) / 'receipt.json'
        envelope = json.loads(path.read_bytes())
        envelope['receipt']['observation']['files'][0]['sha256'] = 'f' * 64
        envelope['sha256'] = plan_digest(envelope['receipt'])
        path.write_text(json.dumps(envelope))
        self.assertEqual(self.inspect(results[3], 3)['status'], 'blocked')
        self.assertEqual(self.dispatches(), 4)

    def test_before_existing_files_directory_identity_and_schema_are_rejected(self):
        changes = [lambda o: o['files'][0].update(kind='regular'),
            lambda o: o['directory'].update(kind='symlink'),
            lambda o: o['directory'].update(uid=True),
            lambda o: o['directory'].update(mode='0755'),
            lambda o: o['host'].update(machine_id='foreign'),
            lambda o: o['files'].reverse(),
            lambda o: o.update(extra=True),
            lambda o: o.update(observed_at=(self.now + timedelta(seconds=1)).isoformat())]
        for mutate in changes:
            with self.subTest(mutate=mutate):
                self.adapter.hook = lambda phase, action, value: mutate(value) if phase == 'before' else None
                self.assertEqual(self.stage()['status'], 'blocked')
                self.assertFalse(self.slot().exists())
        self.assertEqual(self.dispatches(), 0)

    def test_authority_changed_by_before_observer_prevents_dispatch(self):
        path = self.project / self.auth_path
        self.adapter.hook = lambda phase, action, value: path.write_bytes(path.read_bytes() + b' ') if phase == 'before' else None
        self.assertEqual(self.stage()['status'], 'blocked')
        self.assertEqual(self.dispatches(), 0)

    def test_adapter_action_mutation_cannot_change_fixed_dispatch_payload(self):
        self.adapter.hook = lambda phase, action, value: action['host']['files'][0].update(path='/root/.ssh/authorized_keys') if phase == 'before' else None
        self.assertEqual(self.stage()['status'], 'staged')
        self.assertEqual(self.dispatches(), 1)
        action = next(a for kind, a in self.adapter.calls if kind == 'stage')
        self.assertEqual(action['host']['files'][0]['path'], '/etc/eru/fresh-access.nft')

    def test_successful_return_without_postcondition_is_uncertain(self):
        self.adapter.hook = lambda phase, action, value: value['files'][0].update(intent_sha256='f' * 64) if phase == 'after' else None
        result = self.stage()
        self.assertEqual(result['status'], 'uncertain')
        self.assertEqual(self.dispatches(), 1)
        self.assertFalse((self.slot() / 'receipt.json').exists())
        self.assertEqual(self.stage()['status'], 'uncertain')
        self.assertEqual(self.dispatches(), 1)

    def test_intent_raw_rewrite_and_late_publication_failure_prevent_dispatch(self):
        publish = ops._publish
        def rewrite(files, directory, name, value):
            digest = publish(files, directory, name, value)
            path = self.slot() / name
            path.write_bytes(path.read_bytes() + b' ')
            return digest
        with patch.object(ops, '_publish', side_effect=rewrite):
            self.assertEqual(self.stage()['status'], 'blocked')
        self.assertEqual(self.dispatches(), 0)
        self.assertEqual(self.stage()['status'], 'blocked')

    def test_intent_fsync_failure_never_dispatches_or_reuses_claim(self):
        publish = ops._publish
        def fail(*args):
            publish(*args)
            raise OSError('late fsync failure')
        with patch.object(ops, '_publish', side_effect=fail):
            self.assertEqual(self.stage()['status'], 'blocked')
        self.assertEqual(self.dispatches(), 0)
        self.assertEqual(self.stage()['status'], 'blocked')
        envelope = json.loads((self.slot() / 'intent.json').read_bytes())
        self.assertEqual(self.reconcile({'intent_sha256': envelope['sha256']})['status'], 'blocked')
        self.assertEqual(self.dispatches(), 0)

    def test_receipt_raw_rewrite_cannot_become_success(self):
        publish = ops._publish
        def rewrite(files, directory, name, value):
            digest = publish(files, directory, name, value)
            if name == 'receipt.json':
                path = self.slot() / name
                path.write_bytes(path.read_bytes() + b' ')
            return digest
        with patch.object(ops, '_publish', side_effect=rewrite):
            result = self.stage()
        self.assertNotEqual(result['status'], 'staged')
        self.assertEqual(self.dispatches(), 1)
        self.assertEqual(self.stage()['status'], 'blocked')

    def test_rehashed_action_forgery_and_corrupt_journal_fail_closed(self):
        self.adapter.lose_response = True
        result = self.stage()
        path = self.slot() / 'intent.json'
        envelope = json.loads(path.read_bytes())
        envelope['intent']['action']['host']['files'][0]['path'] = '/root/.ssh/authorized_keys'
        envelope['sha256'] = plan_digest(envelope['intent'])
        path.write_text(json.dumps(envelope))
        self.assertEqual(self.inspect({'intent_sha256': envelope['sha256']})['status'], 'blocked')
        self.assertEqual(self.reconcile({'intent_sha256': envelope['sha256']})['status'], 'blocked')
        path.write_bytes(b'{"invalid":')
        self.assertEqual(self.stage()['status'], 'blocked')
        self.assertEqual(self.dispatches(), 1)

    def test_readonly_inspection_uses_no_write_or_transport_syscalls_and_redacts(self):
        result = self.stage()
        self.assertEqual(result['status'], 'staged')
        before = self.f.f.f.r.snapshot()
        real_open = os.open
        def read_only(path, flags, *args, **kwargs):
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return real_open(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=read_only), patch.object(os, 'mkdir', side_effect=AssertionError('write')), patch('subprocess.Popen', side_effect=AssertionError('transport')):
            inspected = self.inspect(result)
            self.assertEqual(inspected['status'], 'staged')
        self.assertEqual(before, self.f.f.f.r.snapshot())
        for public in (result, inspected):
            serialized = json.dumps(public)
            for value in ('private/', '100.91.', '10.20.30.40', 'replacement-machine', '/etc/eru'):
                self.assertNotIn(value, serialized)
            for key in ('stage_accepted', 'generation_changed', 'external_fence_verified'):
                self.assertIs(public[key], False)

    def test_authorization_expiry_stops_recovery_without_observation(self):
        self.adapter.lose_response = True
        result = self.stage()
        calls = copy.deepcopy(self.adapter.calls)
        late = self.now + timedelta(minutes=15, seconds=1)
        self.assertEqual(self.reconcile(result, now=late)['status'], 'blocked')
        self.assertEqual(calls, self.adapter.calls)
        self.assertEqual(self.inspect(result, now=late)['status'], 'blocked')

    def test_real_readonly_cli_inspects_journal_without_adapter_or_lock(self):
        import fresh_execution_ops
        import labctl
        result = self.stage()
        self.assertEqual(result['status'], 'staged')
        before = self.f.f.f.r.snapshot()
        output = io.StringIO()
        with patch.object(labctl, 'PROJECT', self.project), patch.object(sys, 'argv',
                ['labctl.py', 'inspect-fresh-network-staging', '--run', self.run,
                 '--host-index', '0', '--sha256', result['intent_sha256']]), \
                patch.object(fresh_execution_ops, '_git_source', return_value=self.source), \
                patch.object(ops, '_time', return_value=self.now), \
                patch.object(labctl, 'Operator', side_effect=AssertionError('operator')), \
                patch.object(labctl, 'ClusterLock', side_effect=AssertionError('mutation lock')), \
                redirect_stdout(output):
            labctl.main()
        self.assertEqual(json.loads(output.getvalue())['status'], 'staged')
        self.assertEqual(before, self.f.f.f.r.snapshot())

    def test_intent_directory_swap_with_same_bytes_prevents_dispatch(self):
        publish = ops._publish
        def swap(*args):
            digest = publish(*args)
            directory = self.slot()
            directory.rename(directory.with_name('held-slot'))
            directory.mkdir(mode=0o700)
            path = directory / 'intent.json'
            path.write_bytes((directory.with_name('held-slot') / 'intent.json').read_bytes())
            path.chmod(0o600)
            return digest
        with patch.object(ops, '_publish', side_effect=swap):
            self.assertEqual(self.stage()['status'], 'blocked')
        self.assertEqual(self.dispatches(), 0)

    def test_final_intent_clock_expiry_prevents_dispatch(self):
        publish = ops._publish
        published = []
        def complete(*args):
            digest = publish(*args)
            published.append(True)
            return digest
        with patch.object(ops, '_publish', side_effect=complete), patch.object(ops, '_time',
                side_effect=lambda _: self.now + timedelta(minutes=16) if published else self.now):
            self.assertEqual(self.stage()['status'], 'blocked')
        self.assertEqual(self.dispatches(), 0)

    def test_after_observation_authority_drift_cannot_publish_success(self):
        path = self.project / self.auth_path
        self.adapter.hook = lambda phase, action, value: path.write_bytes(path.read_bytes() + b' ') if phase == 'after' else None
        self.assertNotEqual(self.stage()['status'], 'staged')
        self.assertEqual(self.dispatches(), 1)

    def test_recovery_authority_drift_cannot_publish_success(self):
        self.adapter.lose_response = True
        result = self.stage()
        path = self.project / 'private/pending-generation/reservation.json'
        self.adapter.hook = lambda phase, action, value: path.write_bytes(path.read_bytes() + b' ') if phase == 'after' else None
        self.assertNotEqual(self.reconcile(result)['status'], 'staged')
        self.assertEqual(self.dispatches(), 1)


    def test_before_observation_expiry_during_final_plan_io_prevents_dispatch(self):
        late = [False]
        calls = []
        original = ops._Session.plan
        def plan(session, *args):
            result = original(session, *args)
            calls.append(True)
            if len(calls) == 3:
                late[0] = True
            return result
        self.adapter.hook = lambda phase, action, value: value.update(
            observed_at=(self.now - timedelta(minutes=14, seconds=59)).isoformat()) if phase == 'before' else None
        with patch.object(ops._Session, 'plan', plan), patch.object(ops, '_time',
                side_effect=lambda _: self.now + timedelta(seconds=2) if late[0] else self.now):
            self.assertEqual(self.stage()['status'], 'blocked')
        self.assertEqual(self.dispatches(), 0)


    def test_late_recovery_loser_does_not_poison_completed_winner(self):
        self.adapter.lose_response = True
        result = self.stage()
        real_open = os.open
        fired = []
        def race(path, flags, *args, **kwargs):
            if path == '.receipt-claim' and not fired:
                fired.append(True)
                self.assertEqual(self.reconcile(result)['status'], 'staged')
            return real_open(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=race):
            self.reconcile(result)
        self.assertEqual(fired, [True])
        self.assertEqual(self.inspect(result)['status'], 'staged')
        self.assertEqual(self.dispatches(), 1)


if __name__ == '__main__':
    unittest.main()
