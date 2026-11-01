"""Synthetic current-stage prerequisites; no remote connections or real inputs."""
import copy
from datetime import timedelta
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_admission_ops as ops
import fresh_replacement_ops
import pending_generation
import test_fresh_replacement as fixture


class NetworkAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.ReplacementTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.project, self.now = self.f.project, self.f.now
        self.execution = self.f.r.execution
        record = self.execution['execution']
        fields = ('cluster_id', 'run_id', 'generation_before', 'target_generation', 'review_sha256', 'scope_sha256')
        binding = {k: record['binding'][k] for k in fields}
        binding.update(execution_sha256=self.execution['sha256'], cluster_sha256=record['cluster_sha256'],
                       fence_sha256=record['evidence']['writer_fence']['sha256'])
        self.pending_sha = pending_generation.reserve(self.project, binding)
        self.observation = self.f.collect()
        self.assertEqual(self.observation['status'], 'observed')
        self.binding = {**record['binding'], 'execution_sha256': self.execution['sha256'],
            'pending_sha256': self.pending_sha, 'replacement_sha256': self.observation['sha256'],
            'stage': 'network-and-access-ready'}
        self.auth = {'schema_version': 1, 'kind': 'fresh-stage-authorization', 'binding': self.binding,
            'authority': 'owner', 'approved': True, 'issued_at': self.now.isoformat(),
            'expires_at': (self.now + timedelta(minutes=30)).isoformat()}
        self.isolation = {'schema_version': 1, 'kind': 'fresh-writer-isolation', 'binding': self.binding,
            'observed_at': self.now.isoformat(), 'other_controllers_stopped': True,
            'ci_writers_stopped': True, 'app_writers_stopped': True, 'old_hosts': []}
        for i, host in enumerate(self.f.r.baseline['hosts']):
            path = 'private/isolation-proof-' + str(i)
            (self.project / path).write_bytes(('proof ' + str(i)).encode())
            self.isolation['old_hosts'].append({**host, 'isolated': True, 'method': 'provider-console',
                'proof': self.ref(path)})
        self.fence = {'schema_version': 1, 'kind': 'fresh-stage-fence', 'binding': self.binding,
            'observed_at': self.now.isoformat(), 'active': True, 'controller_count': 1,
            'in_flight_writers': 0, 'prior_fence': record['evidence']['writer_fence'], 'isolation': {}}
        self.document = {'schema_version': 1, 'binding': self.binding,
            'replacement_observation': self.ref(fresh_replacement_ops.AREA + '/' + self.observation['id'] + '/observation.json'),
            'owner_authorization': {}, 'writer_fence': {}}
        self.path = 'private/network-request.json'
        self.save()

    def ref(self, path):
        return {'path': path, 'sha256': hashlib.sha256((self.project / path).read_bytes()).hexdigest()}

    def save(self):
        def write(path, value):
            self.f.r.write(path, value)
            return self.ref(path)
        self.fence['isolation'] = write('private/stage-isolation.json', self.isolation)
        self.document['writer_fence'] = write('private/stage-fence.json', self.fence)
        self.document['owner_authorization'] = write('private/stage-auth.json', self.auth)
        self.input_sha = write(self.path, self.document)['sha256']
        self.f.r.f.secure()

    def inspect(self, **kwargs):
        options = {'now': self.now, 'source_state': self.f.r.f.fixture.report['source']}
        options.update(kwargs)
        return ops.inspect_network_admission(self.project, self.f.r.run, self.execution['sha256'],
                                            self.path, self.input_sha, **options)

    def test_current_scoped_evidence_after_historical_preparation_expiry(self):
        before = self.f.r.snapshot()
        result = self.inspect()
        self.assertEqual(result['status'], 'prerequisites-reviewed')
        self.assertEqual(result['host_count'], 4)
        self.assertEqual(result['stage'], 'network-and-access-ready')
        for flag in ('stage_accepted', 'executable', 'remote_mutation_performed',
                     'generation_changed', 'external_fence_verified'):
            self.assertIs(result[flag], False)
        self.assertEqual(before, self.f.r.snapshot())
        self.assertEqual(len(self.f.calls), 4)

    def test_missing_malformed_and_foreign_pending_block(self):
        path = self.project / 'private/pending-generation/reservation.json'
        original = path.read_bytes()
        value = json.loads(original)
        value['bindings']['execution_sha256'] = 'f' * 64
        path.write_text(json.dumps(value))
        self.assertEqual(self.inspect()['status'], 'blocked')
        path.write_bytes(b'invalid')
        self.assertEqual(self.inspect()['status'], 'blocked')
        path.unlink()
        self.assertEqual(self.inspect()['status'], 'blocked')
        path.parent.rmdir()
        self.assertEqual(self.inspect()['status'], 'blocked')

    def test_rehashed_request_binding_and_exact_schema_reject(self):
        original = copy.deepcopy(self.document)
        changes = [lambda d: d['binding'].update(stage='bootstrap'),
            lambda d: d['binding'].update(execution_sha256='f' * 64),
            lambda d: d['binding'].update(pending_sha256='f' * 64),
            lambda d: d['binding'].update(replacement_sha256='f' * 64),
            lambda d: d['binding'].update(generation_before=True),
            lambda d: d.update(schema_version=True), lambda d: d.update(extra=True),
            lambda d: d['replacement_observation'].update(path='private/../unsafe')]
        for change in changes:
            with self.subTest(change=change):
                self.document = copy.deepcopy(original)
                change(self.document)
                self.save()
                self.assertEqual(self.inspect()['status'], 'blocked')

    def test_rehashed_authorization_and_fence_fail_closed(self):
        original_auth, original_fence = copy.deepcopy(self.auth), copy.deepcopy(self.fence)
        changes = [lambda: self.auth.update(kind='owner_authorization'),
            lambda: self.auth.update(approved=1),
            lambda: self.auth.update(expires_at=self.now.isoformat()),
            lambda: self.auth.update(issued_at=(self.now - timedelta(seconds=1)).isoformat()),
            lambda: self.auth.update(expires_at=(self.now + timedelta(hours=2)).isoformat()),
            lambda: self.fence.update(controller_count=True),
            lambda: self.fence.update(in_flight_writers=False),
            lambda: self.fence.update(active=1),
            lambda: self.fence.update(observed_at=(self.now + timedelta(seconds=1)).isoformat()),
            lambda: self.fence.update(observed_at=(self.now - timedelta(seconds=1)).isoformat()),
            lambda: self.fence['binding'].update(run_id='foreign'),
            lambda: self.fence.update(prior_fence=self.document['owner_authorization'])]
        for change in changes:
            with self.subTest(change=change):
                self.auth, self.fence = copy.deepcopy(original_auth), copy.deepcopy(original_fence)
                change()
                self.save()
                self.assertEqual(self.inspect()['status'], 'blocked')

    def test_rehashed_isolation_old_identity_and_proofs_reject(self):
        original = copy.deepcopy(self.isolation)
        changes = [lambda: self.isolation.update(other_controllers_stopped=1),
            lambda: self.isolation.update(ci_writers_stopped=False),
            lambda: self.isolation.update(app_writers_stopped=False),
            lambda: self.isolation.update(observed_at=(self.now + timedelta(seconds=1)).isoformat()),
            lambda: self.isolation['old_hosts'].pop(),
            lambda: self.isolation['old_hosts'].reverse(),
            lambda: self.isolation['old_hosts'][0].update(machine_id='replacement-machine-1'),
            lambda: self.isolation['old_hosts'][0].update(isolated=1),
            lambda: self.isolation['old_hosts'][0].update(method='tcp-unreachable'),
            lambda: self.isolation['old_hosts'][1].update(proof=self.isolation['old_hosts'][0]['proof'])]
        for change in changes:
            with self.subTest(change=change):
                self.isolation = copy.deepcopy(original)
                change()
                self.save()
                self.assertEqual(self.inspect()['status'], 'blocked')
        self.isolation = original
        proof = self.isolation['old_hosts'][0]['proof']
        path = self.project / proof['path']
        path.write_bytes(b'')
        proof['sha256'] = hashlib.sha256(b'').hexdigest()
        self.save()
        self.assertEqual(self.inspect()['status'], 'blocked')
        path.unlink()
        path.symlink_to('/dev/null')
        self.assertEqual(self.inspect()['status'], 'blocked')

    def test_raw_sha_pin_and_current_source_rechecked(self):
        path = self.project / self.path
        raw = path.read_bytes()
        path.write_bytes(raw + b' ')
        self.assertEqual(self.inspect()['status'], 'blocked')
        path.write_bytes(raw)
        source = copy.deepcopy(self.f.r.f.fixture.report['source'])
        source['sha'] = 'f' * 40
        self.assertEqual(self.inspect(source_state=source)['status'], 'blocked')

    def test_mid_operation_request_and_pending_changes_reject(self):
        original = ops.inspect_replacement_facts
        request = self.project / self.path
        raw = request.read_bytes()
        def change_request(*args, **kwargs):
            result = original(*args, **kwargs)
            request.write_bytes(raw + b' ')
            return result
        with patch.object(ops, 'inspect_replacement_facts', side_effect=change_request):
            self.assertEqual(self.inspect()['status'], 'blocked')
        request.write_bytes(raw)
        path = self.project / 'private/pending-generation/reservation.json'
        def change_pending(*args, **kwargs):
            result = original(*args, **kwargs)
            path.write_bytes(path.read_bytes() + b' ')
            return result
        with patch.object(ops, 'inspect_replacement_facts', side_effect=change_pending):
            self.assertEqual(self.inspect()['status'], 'blocked')

    def test_final_clock_checks_expiry_and_replacement_freshness(self):
        for late in (self.now + timedelta(minutes=30), self.now + timedelta(minutes=15, seconds=1)):
            with self.subTest(late=late):
                with patch.object(ops, '_time', side_effect=[self.now, self.now, late]):
                    self.assertEqual(self.inspect()['status'], 'blocked')

    def test_no_filesystem_writes_or_transport_and_summary_is_safe(self):
        import os
        import subprocess
        real_open = os.open
        def read_only(path, flags, *args, **kwargs):
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return real_open(path, flags, *args, **kwargs)
        with patch.object(os, 'open', side_effect=read_only):
            with patch.object(os, 'mkdir', side_effect=AssertionError('write')):
                with patch.object(subprocess, 'Popen', side_effect=AssertionError('transport')):
                    result = self.inspect()
        self.assertEqual(result['status'], 'prerequisites-reviewed')
        public = json.dumps(result)
        self.assertNotIn('private/', public)
        self.assertNotIn('proof ', public)
        self.assertNotIn('replacement-machine-', public)
        self.assertNotIn(self.f.keys[0], public)

    def test_final_receipt_age_rechecked_even_when_new_facts_remain_fresh(self):
        self.now += timedelta(days=7, seconds=-1)
        self.observation = self.f.collect(observation_id='replacement-late', now=self.now)
        self.assertEqual(self.observation['status'], 'observed')
        self.binding['replacement_sha256'] = self.observation['sha256']
        self.document['replacement_observation'] = self.ref(
            fresh_replacement_ops.AREA + '/' + self.observation['id'] + '/observation.json')
        self.auth.update(issued_at=self.now.isoformat(), expires_at=(self.now + timedelta(minutes=30)).isoformat())
        self.fence['observed_at'] = self.isolation['observed_at'] = self.now.isoformat()
        self.save()
        self.assertEqual(self.inspect()['status'], 'prerequisites-reviewed')
        with patch.object(ops, '_time', side_effect=[self.now, self.now, self.now + timedelta(seconds=2)]):
            self.assertEqual(self.inspect()['status'], 'blocked')

    def test_same_proof_bytes_under_distinct_paths_still_reject(self):
        first, second = [host['proof'] for host in self.isolation['old_hosts'][:2]]
        (self.project / second['path']).write_bytes((self.project / first['path']).read_bytes())
        second['sha256'] = first['sha256']
        self.save()
        self.assertEqual(self.inspect()['status'], 'blocked')

    def test_private_root_retarget_during_inspection_rejects(self):
        original = ops.inspect_replacement_facts
        private = self.project / 'private'
        moved = self.project / 'private-held'
        def retarget(*args, **kwargs):
            result = original(*args, **kwargs)
            private.rename(moved)
            private.mkdir(mode=0o700)
            return result
        with patch.object(ops, 'inspect_replacement_facts', side_effect=retarget):
            self.assertEqual(self.inspect()['status'], 'blocked')

    def test_publication_marker_late_in_proof_reads_rejects(self):
        original = ops.PrivateFiles.read
        target = self.document['replacement_observation']['path'].rsplit('/', 1)[0]
        proof = self.isolation['old_hosts'][0]['proof']['path']
        changed = []
        def reading(files, path):
            result = original(files, path)
            if path == proof and not changed:
                (self.project / target / '.collection-failed').write_bytes(b'')
                changed.append(True)
            return result
        with patch.object(ops.PrivateFiles, 'read', reading):
            self.assertEqual(self.inspect()['status'], 'blocked')
        self.assertEqual(changed, [True])
