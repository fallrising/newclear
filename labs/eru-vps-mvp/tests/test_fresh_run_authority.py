"""Explicit current owner capability, immutable inputs, and single-operation scope."""
from datetime import timedelta
import unittest

import test_fresh_network_directory as fixture
from test_fresh_run_authority_integration import renewal
import fresh_network_directory_ops as ops
import fresh_run_authority as authority
from fresh_run_lock import FreshRunLock
import pending_generation


class RunAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkDirectoryTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.target = {'plan_id': self.f.plan['id'], 'expected_sha': self.f.plan['sha256'],
                       'authorization_file': self.f.authpath, 'authorization_sha': self.f.authsha, 'host_index': 0}

    def test_owned_current_operation_once_and_default_context_restored(self):
        with renewal(self.f, 'prepare_network_directory', self.target):
            self.assertEqual(self.f.prepare()['status'], 'prepared')
            with self.assertRaises(ValueError):
                self.f.prepare()
        self.assertIsNone(authority.active())
        self.assertEqual(self.f.prepare()['status'], 'prepared')

    def test_wrong_actual_target_never_dispatches_and_nested_context_rejected(self):
        with self.assertRaises(ValueError):
            with renewal(self.f, 'prepare_network_directory', self.target):
                self.f.prepare(1)
        self.assertEqual(self.f.adapter.calls, [])
        self.assertIsNone(authority.active())

    def test_json_boolean_target_cannot_equal_integer_host_index(self):
        forged = {**self.target, 'host_index': False}
        ref = renewal(self.f, 'prepare_network_directory', forged, ref_only=True)
        with FreshRunLock(self.f.project, pending_generation.inspect(self.f.project)) as lock:
            with self.assertRaises(ValueError):
                with authority.current_step(self.f.project, ref, operation='prepare_network_directory',
                                            target=self.target, lock=lock, now=self.f.now):
                    self.fail('boolean target accepted as an integer')
        self.assertEqual(self.f.adapter.calls, [])

    def test_no_owned_lock_rejected(self):
        ref = renewal(self.f, 'prepare_network_directory', self.target, ref_only=True)
        with self.assertRaises(ValueError):
            with authority.current_step(self.f.project, ref, operation='prepare_network_directory',
                                        target=self.target, lock=None, now=self.f.now):
                self.fail('unowned authority entered')

    def test_during_dispatch_expiry_leaves_intent_without_accepted_receipt(self):
        prepare = self.f.adapter.prepare
        def delayed(action, digest):
            prepare(action, digest)
            self.f.now += timedelta(minutes=16)
            self.f.adapter.now = self.f.now
        self.f.adapter.prepare = delayed
        with self.assertRaises(ValueError):
            with renewal(self.f, 'prepare_network_directory', self.target):
                self.f.prepare()
        self.assertTrue((self.f.slot() / 'intent.json').exists())
        self.assertFalse((self.f.slot() / 'receipt.json').exists())
        self.assertEqual([x for x in self.f.adapter.calls if x[0] == 'prepare'], [('prepare', 0)])

    def test_changed_current_proof_blocks_before_dispatch(self):
        cm = renewal(self.f, 'prepare_network_directory', self.target)
        path = self.f.project / self.f.f.f.isolation['old_hosts'][0]['proof']['path']
        path.write_bytes(b'changed isolation')
        with self.assertRaises(ValueError):
            with cm:
                self.f.prepare()
        self.assertEqual(self.f.adapter.calls, [])

    def test_manual_host_intervals_require_exact_contiguous_authority(self):
        import copy
        from fresh_rebuild import plan_digest
        from fresh_network_ready import OPERATION
        original = self.f.now
        self.f.now += timedelta(hours=1)
        self.f.adapter.now = self.f.now
        self.f.authpath = 'private/new-directory-auth.json'
        self.f.auth['authorized_at'] = self.f.now.isoformat()
        self.f.auth['expires_at'] = (self.f.now + timedelta(minutes=15)).isoformat()
        self.f.save_auth()
        self.target['authorization_file'] = self.f.authpath
        self.target['authorization_sha'] = self.f.authsha
        manual = {**self.f.auth, 'operation': OPERATION+'-authorization',
                  'scope': 'manual-console-network-and-access-only', 'setup_sha256': 'a'*64}
        refs = []
        for index in range(5):
            doc = {**manual, 'authorized_at': (original+timedelta(minutes=index*14)).isoformat(),
                   'expires_at': (original+timedelta(minutes=index*14+15)).isoformat()}
            path = 'private/manual-cover-'+str(index)+'.json'
            sha = self.f.f.f.f.r.write(path, doc)
            refs.append({'path': path, 'sha256': sha})
        self.f.f.f.f.r.f.secure()
        intent = {'plan_id': self.f.plan['id'], 'plan_sha256': self.f.plan['sha256'],
            'execution_sha256': self.f.plan['execution_sha256'], 'pending_sha256': self.f.auth['pending_sha256'],
            'input': {'path': 'private/setup.json', 'sha256': 'a'*64}, 'created_at': original.isoformat(),
            'authorization': refs[0], 'actions': [{'host_index': i} for i in range(4)]}
        digest = plan_digest(intent)
        value = {'schema_version': 1, 'operation': OPERATION+'-receipt', 'intent_sha256': digest,
                 'owner_confirmed': True, 'hosts': [{'action': a, 'owner_confirmed': True,
                    'started_at': original.isoformat(), 'completed_at': self.f.now.isoformat()} for a in intent['actions']]}
        with renewal(self.f, 'prepare_network_directory', self.target, manual_authorizations=refs[1:]):
            self.assertEqual(authority.validate_manual(value, intent, digest, self.f.now), value)
            malformed = copy.deepcopy(value)
            malformed['hosts'][0]['action'] = {'host_index': 9}
            with self.assertRaises(ValueError):
                authority.validate_manual(malformed, intent, digest, self.f.now)
            self.assertEqual(self.f.prepare()['status'], 'prepared')
        # Missing one middle short-lived authorization must not be filled by
        # current renewal or by the old manual intent authorization.
        with renewal(self.f, 'prepare_network_directory', self.target, manual_authorizations=refs[2:]):
            with self.assertRaises(ValueError):
                authority.validate_manual(value, intent, digest, self.f.now)
            self.assertEqual(self.f.prepare()['status'], 'prepared')
