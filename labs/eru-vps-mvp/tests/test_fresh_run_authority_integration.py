"""Synthetic renewed action against an immutable, genuinely old predecessor."""
from datetime import timedelta
import unittest
from contextlib import contextmanager

import test_fresh_network_directory as fixture


class RunAuthorityIntegrationTests(unittest.TestCase):
    def test_hour_old_plan_and_predecessor_with_new_operation_authorization(self):
        f = fixture.NetworkDirectoryTests()
        f.setUp()
        self.addCleanup(f.doCleanups)
        self.assertEqual(f.prepare(0)['status'], 'prepared')
        f.now += timedelta(hours=1)
        f.adapter.now = f.now
        f.authpath = 'private/directory-authority-renewed.json'
        f.auth['authorized_at'] = f.now.isoformat()
        f.auth['expires_at'] = (f.now + timedelta(minutes=15)).isoformat()
        f.save_auth()
        self.assertEqual(f.prepare(1)['status'], 'blocked')
        target = {'plan_id': f.plan['id'], 'expected_sha': f.plan['sha256'],
                  'authorization_file': f.authpath, 'authorization_sha': f.authsha, 'host_index': 1}
        with renewal(f, 'prepare_network_directory', target):
            self.assertEqual(f.prepare(1)['status'], 'prepared')

    def test_day_old_acceptance_is_readonly_integrity_not_current_readiness(self):
        import os
        from unittest.mock import patch
        import test_fresh_network_ready_ops as ready_fixture
        import fresh_run_authority as authority
        import fresh_network_ready_ops as ready
        f = ready_fixture.NetworkReadyTests()
        f.setUp()
        self.addCleanup(f.doCleanups)
        f.manual()
        f.prerequisites()
        accepted = f.accept()
        self.assertEqual(accepted['status'], 'network-ready')
        path = f.project / ready.AREA / f.f.run / 'receipt.json'
        before = path.read_bytes()
        current = f.now + timedelta(days=1)
        real_open = os.open
        def readonly(path, flags, *args, **kwargs):
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return real_open(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=readonly):
            result = authority.inspect_history(f.project, f.f.run, f.f.plan['execution_sha256'],
                accepted['receipt_sha256'], now=current, source_state=f.source)
        self.assertEqual(result['status'], 'historically-valid')
        self.assertTrue(result['historical_integrity'])
        self.assertFalse(result['current_network_ready'])
        self.assertFalse(result['stage_accepted'])
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(f.collect_calls, 1)
        self.assertEqual(f.inspect(accepted, now=current)['status'], 'blocked')


def renewal(f, operation, target, *, at=None, manual_authorizations=None, ref_only=False):
    """Append new authority bytes without overwriting any original evidence."""
    import copy
    import fresh_run_authority as authority
    from fresh_rebuild import plan_digest
    a = f.f.f
    now = at or f.now
    f.renewal_counter = getattr(f, 'renewal_counter', 0) + 1
    suffix = str(f.renewal_counter) + '-' + str(int(now.timestamp())) + '-' + operation + '-' + str(target.get('host_index', 0))
    def write(name, value):
        path = 'private/renewal-' + suffix + '-' + name + '.json'
        sha = a.f.r.write(path, value)
        a.f.r.f.secure()
        return {'path': path, 'sha256': sha}
    isolation = copy.deepcopy(a.isolation)
    isolation['observed_at'] = now.isoformat()
    fence = copy.deepcopy(a.fence)
    fence['observed_at'] = now.isoformat()
    fence['isolation'] = write('isolation', isolation)
    auth = copy.deepcopy(a.auth)
    auth['issued_at'] = now.isoformat()
    auth['expires_at'] = (now + timedelta(minutes=15)).isoformat()
    admission = copy.deepcopy(a.document)
    admission['owner_authorization'] = write('stage-auth', auth)
    admission['writer_fence'] = write('fence', fence)
    doc = {'schema_version': 1, 'kind': 'fresh-run-step-renewal', 'authority': 'owner',
        'approved': True, 'owner_confirmed': True, 'target': target,
        'binding': {'run_id': f.run, 'execution_sha256': f.plan['execution_sha256'],
            'pending_sha256': f.auth['pending_sha256'], 'plan_id': f.plan['id'],
            'plan_sha256': f.plan['sha256'], 'operation': operation, 'target_sha256': plan_digest(target)},
        'admission_request': write('admission', admission), 'writer_fence': None,
        'issued_at': now.isoformat(), 'expires_at': (now+timedelta(minutes=15)).isoformat(),
        'manual_authorizations': manual_authorizations or []}
    ref = write('renewal', doc)
    if ref_only:
        return ref
    @contextmanager
    def owned():
        from fresh_run_lock import FreshRunLock
        import pending_generation
        with FreshRunLock(f.project, pending_generation.inspect(f.project)) as lock:
            with authority.current_step(f.project, ref, operation=operation, target=target, lock=lock,
                                        now=lambda: f.now, source_state=f.source) as step:
                yield step
    return owned()
