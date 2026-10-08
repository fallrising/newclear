"""Completed-lock admission with real generation proof and current input checks.

GenerationStorageTests supplies synthetic replay acceptance/artifacts. This adds
actual inspect_history calls at that replay boundary and a synthetic network
reader calling check_current. Owner setup is explicit _Step fixture admission;
_Step.check/_check_inputs/check_direct, private I/O, locks, generation writes,
proofs and nested-history guards are real. This is not full CLI evidence.
"""
from datetime import timedelta
import sys
import unittest
from unittest.mock import patch

import fresh_generation_ops as generation
import fresh_network_ready_ops as network
import fresh_run_authority as authority
from fresh_network_admission import HOST_FIELDS
from fresh_rebuild import plan_digest
from fresh_run_lock import FreshRunLock
import test_fresh_generation_ops as storage_fixture


class CompletionAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.f = f = storage_fixture.GenerationStorageTests()
        f.setUp()
        self.addCleanup(f.doCleanups)
        f.prepare()
        self.states = []
        self.record = {'run_id': f.run, 'execution_sha256': 'a'*64,
            'pending_sha256': f.pending['sha256'], 'plan_id': 'network',
            'plan_sha256': f.acceptance['context']['network']['sha256']}
        f.write(network.MANUAL_AREA+'/'+f.run+'/intent.json',
                {'intent': self.record, 'sha256': plan_digest(self.record)})
        for path in (f.project/'private').rglob('*'):
            if path.is_dir(): path.chmod(0o700)
        self.lock = FreshRunLock(f.project, f.pending)
        self.lock.__enter__()
        self.addCleanup(self.lock.__exit__, None, None, None)
        self.owner = owner = authority._Step(f.project, 'finalize_generation',
            {'run_id': f.run, 'generation_sha': f.generation_sha}, lambda: f.now, None)
        self.addCleanup(owner.files.close)
        owner.lock = self.lock
        owner.binding = {**self.record, 'operation': owner.operation,
            'target_sha256': plan_digest(owner.target)}
        hosts = [{key: key+'-'+str(i) for key in HOST_FIELDS} for i in range(4)]
        owner.baseline = {'hosts': hosts}
        old_hosts = [{**host, 'isolated': True, 'method': 'network',
            'proof': f.write('private/current-isolation-'+str(i)+'.json', {'host': i})}
            for i, host in enumerate(hosts)]
        isolation = f.write('private/current-isolation.json', {'schema_version': 1,
            'kind': 'fresh-run-step-isolation', 'binding': owner.binding,
            'observed_at': f.now.isoformat(), 'other_controllers_stopped': True,
            'ci_writers_stopped': True, 'app_writers_stopped': True, 'old_hosts': old_hosts})
        prior = f.acceptance['context']['execution']['execution']['evidence']['writer_fence']
        owner.execution = {'created_at': (f.now-timedelta(days=1)).isoformat(),
            'evidence': {'writer_fence': prior}}
        self.fence = {'schema_version': 1, 'kind': 'fresh-run-step-fence',
            'binding': owner.binding, 'observed_at': f.now.isoformat(), 'active': True,
            'controller_count': 1, 'in_flight_writers': 0, 'prior_fence': prior,
            'isolation': isolation}
        fence = f.write('private/current-fence.json', self.fence)
        owner.original_isolation = None
        owner.document = {'admission_request': None, 'writer_fence': fence,
            'issued_at': f.now.isoformat(), 'expires_at': (f.now+timedelta(minutes=15)).isoformat()}
        owner.ref = f.write('private/current-renewal.json', owner.document)
        loader = sys.modules['fresh_replay_ops']
        def load(*args, **kwargs):
            active = authority.active()
            self.states.append(None if active is None else
                (active.operation, active.historical, active.entered, active._generation_proof_depth))
            authority.inspect_history(f.project, f.run, 'a'*64, 'b'*64, now=f.now)
            return f.load_acceptance(*args, **kwargs)
        def read(*args, **kwargs):
            authority.check_current()
            return {'status': 'network-ready'}
        for mock in (patch.object(loader, 'load_acceptance', side_effect=load),
                     patch.object(network, 'inspect_network_ready', side_effect=read)):
            mock.start(); self.addCleanup(mock.stop)
        self.token = authority._ACTIVE.set(owner)
        self.addCleanup(authority._ACTIVE.reset, self.token)

    def complete(self):
        f = self.f
        result = generation.finalize_generation(f.project, f.run, f.generation_sha, now=f.now)
        self.assertEqual(result['status'], 'completed')
        self.assertFalse(self.owner.entered)
        self.assertEqual(self.owner._generation_proof_depth, 0)
        self.assertTrue(self.owner.used)

    def test_completed_driver_lock_boundary_revalidates_after_operation_return(self):
        self.complete()
        self.lock.check_pending()  # next_step's actual post-operation boundary
        self.owner.check()  # current_step's exit boundary
        self.assertTrue(any(row and row[2:] == (False, 1) for row in self.states))
        self.assertEqual(self.owner._generation_proof_depth, 0)

    def test_expired_current_renewal_rejected_at_completed_boundary(self):
        self.complete()
        self.f.now += timedelta(minutes=16)
        with self.assertRaisesRegex(ValueError, 'renewal time invalid'):
            self.lock.check_pending()

    def test_changed_current_fence_rejected_at_completed_boundary(self):
        self.complete()
        self.f.write('private/current-fence.json', {**self.fence, 'active': False})
        with self.assertRaises(ValueError): self.lock.check_pending()

    def test_changed_raw_evidence_rejected_at_completed_boundary(self):
        self.complete()
        path = self.f.project/'private/fence.json'
        before = path.read_bytes()
        try:
            self.f.write('private/fence.json', {'observed_at': 'changed'})
            with self.assertRaises(ValueError): self.lock.check_pending()
        finally: path.write_bytes(before)

    def test_foreign_run_or_execution_remains_rejected(self):
        self.complete()
        for key in ('run_id', 'execution_sha256'):
            with self.subTest(key=key):
                previous = self.owner.binding[key]
                self.owner.binding[key] = 'foreign' if key == 'run_id' else 'f'*64
                try:
                    with self.assertRaises((ValueError, OSError)): self.lock.check_pending()
                finally: self.owner.binding[key] = previous

    def test_foreign_project_and_private_identity_remain_rejected(self):
        self.complete()
        project = self.owner.files.project
        self.owner.files.project = project/'foreign'
        try:
            with self.assertRaises((ValueError, OSError)): self.lock.check_pending()
        finally: self.owner.files.project = project
        identity = self.owner.files.identity
        self.owner.files.identity = [0, 0]
        try:
            with self.assertRaises(ValueError): self.lock.check_pending()
        finally: self.owner.files.identity = identity

    def test_historical_or_foreign_lock_owner_never_receives_current_route(self):
        self.complete()
        self.owner.historical = True
        try:
            with self.assertRaisesRegex(ValueError, 'nested historical inspection forbidden'):
                self.lock.check_pending()
        finally: self.owner.historical = False
        self.owner.lock = object()
        try:
            with self.assertRaisesRegex(ValueError, 'nested historical inspection forbidden'):
                self.lock.check_pending()
        finally: self.owner.lock = self.lock

    def test_direct_nested_history_still_forbidden_after_operation_return(self):
        self.complete()
        with self.assertRaisesRegex(ValueError, 'nested historical inspection forbidden'):
            authority.inspect_history(self.f.project, self.f.run, 'a'*64, 'b'*64, now=self.f.now)

    def test_foreign_physical_prefix_rejected_at_completed_boundary(self):
        self.complete()
        path = self.f.project/'private/operations/cluster.json'
        before = path.read_bytes()
        try:
            self.f.write('private/operations/cluster.json', {'cluster_id': 'eru-vps-mvp', 'generation': 99})
            with self.assertRaises(ValueError): self.lock.check_pending()
        finally: path.write_bytes(before)
