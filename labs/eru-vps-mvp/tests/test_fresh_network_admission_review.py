"""Independent synthetic audit of stage prerequisites; no real host access."""
import copy
from contextlib import ExitStack, redirect_stdout
from datetime import timedelta
import hashlib
import io
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fresh_network_admission_ops as ops
import fresh_replacement_ops as replacement_ops
import fresh_execution_ops as execution_ops
import pending_generation
import labctl
import test_fresh_replacement as replacement_fixture


class NetworkAdmissionReviewTests(unittest.TestCase):
    def setUp(self):
        self.f = replacement_fixture.ReplacementTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.project, self.now = self.f.project, self.f.now
        self.observation = self.f.collect()
        self.assertEqual(self.observation['status'], 'observed')
        self.execution = self.f.r.execution
        self.record = self.execution['execution']
        self.run = self.f.r.run
        fields = ('cluster_id', 'run_id', 'generation_before', 'target_generation',
                  'review_sha256', 'scope_sha256')
        reserved = {k: self.record['binding'][k] for k in fields}
        reserved.update(execution_sha256=self.execution['sha256'],
                        cluster_sha256=self.record['cluster_sha256'],
                        fence_sha256=self.record['evidence']['writer_fence']['sha256'])
        self.pending_sha = pending_generation.reserve(self.project, reserved)
        self.binding = {**self.record['binding'], 'execution_sha256': self.execution['sha256'],
            'pending_sha256': self.pending_sha, 'replacement_sha256': self.observation['sha256'],
            'stage': 'network-and-access-ready'}
        self.authority = {'schema_version': 1, 'kind': 'fresh-stage-authorization',
            'binding': copy.deepcopy(self.binding), 'authority': 'owner', 'approved': True,
            'issued_at': self.now.isoformat(), 'expires_at': (self.now + timedelta(minutes=10)).isoformat()}
        self.isolation = {'schema_version': 1, 'kind': 'fresh-writer-isolation',
            'binding': copy.deepcopy(self.binding), 'observed_at': self.now.isoformat(),
            'other_controllers_stopped': True, 'ci_writers_stopped': True,
            'app_writers_stopped': True, 'old_hosts': []}
        for i, host in enumerate(self.f.r.baseline['hosts']):
            path = 'private/review-network/proof-' + str(i) + '.txt'
            raw = ('synthetic console proof old host ' + str(i)).encode()
            target = self.project / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            self.isolation['old_hosts'].append({**host, 'isolated': True,
                'method': 'provider-console', 'proof': {'path': path, 'sha256': hashlib.sha256(raw).hexdigest()}})
        self.fence = {'schema_version': 1, 'kind': 'fresh-stage-fence',
            'binding': copy.deepcopy(self.binding), 'observed_at': self.now.isoformat(),
            'active': True, 'controller_count': 1, 'in_flight_writers': 0,
            'prior_fence': copy.deepcopy(self.record['evidence']['writer_fence']), 'isolation': {}}
        observation_path = replacement_ops.AREA + '/' + self.observation['id'] + '/observation.json'
        self.request = {'schema_version': 1, 'binding': copy.deepcopy(self.binding),
            'replacement_observation': {'path': observation_path,
                'sha256': hashlib.sha256((self.project / observation_path).read_bytes()).hexdigest()},
            'owner_authorization': {}, 'writer_fence': {}}
        self.path = 'private/review-network/request.json'
        self.save()

    def ref(self, path, value):
        return {'path': path, 'sha256': self.f.r.write(path, value)}

    def save(self):
        self.fence['isolation'] = self.ref('private/review-network/isolation.json', self.isolation)
        self.request['owner_authorization'] = self.ref('private/review-network/owner.json', self.authority)
        self.request['writer_fence'] = self.ref('private/review-network/fence.json', self.fence)
        self.input_sha = self.f.r.write(self.path, self.request)
        self.f.r.f.secure()

    def inspect(self, **kwargs):
        options = {'now': self.now, 'source_state': self.f.r.f.fixture.report['source']}
        options.update(kwargs)
        return ops.inspect_network_admission(self.project, self.run, self.execution['sha256'],
                                            self.path, self.input_sha, **options)

    def blocked(self):
        result = self.inspect()
        self.assertEqual(result['status'], 'blocked', result)
        self.assertNotIn('private/', json.dumps(result))

    def test_independently_constructed_current_evidence_has_no_capability(self):
        result = self.inspect()
        self.assertEqual(result['status'], 'prerequisites-reviewed', result)
        self.assertEqual(result['host_count'], 4)
        self.assertEqual(result['stage'], 'network-and-access-ready')
        for key in ('stage_accepted', 'executable', 'generation_changed',
                    'remote_mutation_performed', 'external_fence_verified'):
            self.assertIs(result[key], False)
        self.assertNotIn('private/', json.dumps(result))
        self.assertNotIn(self.f.keys[0], json.dumps(result))
        self.assertEqual(pending_generation.inspect(self.project)['sha256'], self.pending_sha)

    def test_absent_invalid_and_midflight_disappearing_pending(self):
        original = pending_generation.inspect(self.project)
        for state in ({'status': 'absent', 'blocked': False}, {'status': 'invalid', 'blocked': True}):
            with self.subTest(state=state), patch.object(pending_generation, 'inspect', return_value=state):
                self.blocked()
        calls = []
        def drifting(_project):
            calls.append(1)
            return original if len(calls) == 1 else {'status': 'absent', 'blocked': False}
        with patch.object(pending_generation, 'inspect', side_effect=drifting):
            self.blocked()
        self.assertGreaterEqual(len(calls), 2)

    def test_cross_stage_run_generation_and_replacement_cannot_be_rehashed(self):
        originals = [copy.deepcopy(x) for x in (self.request, self.authority, self.fence, self.isolation)]
        changes = [('stage', 'erased-and-untrusted'), ('run_id', 'another-run'),
                   ('target_generation', True), ('pending_sha256', 'a' * 64),
                   ('replacement_sha256', 'b' * 64), ('execution_sha256', 'c' * 64)]
        for field, value in changes:
            with self.subTest(field=field):
                self.request, self.authority, self.fence, self.isolation = copy.deepcopy(originals)
                for item in (self.request, self.authority, self.fence, self.isolation):
                    item['binding'][field] = value
                self.save()
                self.blocked()

    def test_new_identity_or_down_state_is_not_old_host_isolation(self):
        original = copy.deepcopy(self.isolation)
        changes = [lambda x: x['old_hosts'][0].update(machine_id=self.f.r.receipts[0]['replacement']['machine_id']),
                   lambda x: x['old_hosts'][0].update(boot_id_sha256='a' * 64),
                   lambda x: x['old_hosts'][0].update(method='node-down'),
                   lambda x: x['old_hosts'][0].update(isolated=1),
                   lambda x: x['old_hosts'].reverse(), lambda x: x['old_hosts'].pop(),
                   lambda x: x.update(ci_writers_stopped=False)]
        for i, change in enumerate(changes):
            with self.subTest(case=i):
                self.isolation = copy.deepcopy(original)
                change(self.isolation)
                self.save()
                self.blocked()

    def test_reused_proof_bytes_and_path_are_rejected_even_after_rehash(self):
        original = copy.deepcopy(self.isolation)
        first = self.isolation['old_hosts'][0]['proof']
        self.isolation['old_hosts'][1]['proof'] = copy.deepcopy(first)
        self.save()
        self.blocked()
        self.isolation = original
        second = self.isolation['old_hosts'][1]['proof']
        (self.project / second['path']).write_bytes((self.project / first['path']).read_bytes())
        second['sha256'] = first['sha256']
        self.save()
        self.blocked()

    def test_empty_symlink_noncanonical_and_changed_proofs_fail_closed(self):
        proof = self.isolation['old_hosts'][0]['proof']
        path = self.project / proof['path']
        raw, digest = path.read_bytes(), proof['sha256']
        for contents in (raw + b' ', b''):
            path.write_bytes(contents)
            if not contents:
                proof['sha256'] = hashlib.sha256(contents).hexdigest()
                self.save()
            self.blocked()
        path.unlink()
        path.symlink_to('/dev/null')
        self.blocked()
        path.unlink()
        path.write_bytes(raw)
        proof['sha256'] = digest
        proof['path'] = proof['path'].replace('/proof-', '/../review-network/proof-')
        self.save()
        self.blocked()

    def test_prior_fence_exact_reference_and_current_authority_required(self):
        prior = copy.deepcopy(self.fence['prior_fence'])
        raw = (self.project / prior['path']).read_bytes()
        alternate = self.project / 'private/review-network/copied-prior.json'
        alternate.write_bytes(raw)
        self.fence['prior_fence']['path'] = str(alternate.relative_to(self.project))
        self.save()
        self.blocked()
        self.fence['prior_fence'] = prior
        self.save()
        self.request['owner_authorization'] = copy.deepcopy(self.record['evidence']['owner_authorization'])
        self.input_sha = self.f.r.write(self.path, self.request)
        self.f.r.f.secure()
        self.blocked()

    def test_time_order_future_stale_and_boolean_counts(self):
        originals = [copy.deepcopy(x) for x in (self.authority, self.fence, self.isolation)]
        changes = [(0, 'issued_at', (self.now - timedelta(seconds=1)).isoformat()),
                   (0, 'expires_at', self.now.isoformat()),
                   (0, 'expires_at', (self.now + timedelta(hours=1, seconds=1)).isoformat()),
                   (1, 'observed_at', (self.now + timedelta(seconds=1)).isoformat()),
                   (1, 'controller_count', True), (1, 'in_flight_writers', False),
                   (2, 'observed_at', (self.now - timedelta(seconds=1)).isoformat())]
        for index, field, value in changes:
            with self.subTest(index=index, field=field):
                self.authority, self.fence, self.isolation = copy.deepcopy(originals)
                (self.authority, self.fence, self.isolation)[index][field] = value
                self.save()
                self.blocked()
        self.authority, self.fence, self.isolation = originals
        self.save()
        self.assertEqual(self.inspect(now=self.now + timedelta(minutes=16))['status'], 'blocked')

    def test_complete_call_performs_no_write_or_remote_syscall(self):
        snapshot = self.f.r.snapshot()
        original_open = os.open
        def readonly_open(path, flags, *args, **kwargs):
            self.assertFalse(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND))
            return original_open(path, flags, *args, **kwargs)
        with ExitStack() as stack:
            stack.enter_context(patch.object(os, 'open', side_effect=readonly_open))
            for name in ('mkdir', 'rename', 'replace', 'unlink', 'link', 'write', 'ftruncate'):
                stack.enter_context(patch.object(os, name, side_effect=AssertionError('write syscall ' + name)))
            stack.enter_context(patch.object(subprocess, 'Popen', side_effect=AssertionError('remote/process')))
            stack.enter_context(patch.object(pending_generation, 'reserve', side_effect=AssertionError('reserve')))
            self.assertEqual(self.inspect()['status'], 'prerequisites-reviewed')
        self.assertEqual(snapshot, self.f.r.snapshot())
        self.assertEqual(len(self.f.calls), 4)

    def test_current_source_and_historical_raw_input_drift_fail_closed(self):
        source = {**self.f.r.f.fixture.report['source'], 'commit': 'd' * 40}
        self.assertEqual(self.inspect(source_state=source)['status'], 'blocked')
        original_input = self.project / self.record['input']['path']
        original_input.write_bytes(original_input.read_bytes() + b' ')
        self.blocked()

    def test_final_authorization_expiry_is_rechecked(self):
        expiry = self.now + timedelta(seconds=1)
        self.authority['expires_at'] = expiry.isoformat()
        self.save()
        calls = []
        def advancing(_now):
            calls.append(1)
            return self.now if len(calls) <= 2 else expiry
        with patch.object(ops, '_time', side_effect=advancing):
            self.blocked()
        self.assertGreaterEqual(len(calls), 3)

    def test_midflight_proof_drift_is_rechecked(self):
        proof = self.isolation['old_hosts'][0]['proof']
        original_read = execution_ops.PrivateFiles.read
        changed = []
        def drifting(files, path):
            raw = original_read(files, path)
            if str(path) == proof['path'] and not changed:
                changed.append(True)
                target = self.project / proof['path']
                target.write_bytes(target.read_bytes() + b' ')
            return raw
        with patch.object(execution_ops.PrivateFiles, 'read', new=drifting):
            self.blocked()
        self.assertTrue(changed)

    def test_midflight_private_root_replacement_is_rejected(self):
        private = self.project / 'private'
        replacement = self.project / 'replacement-root'
        shutil.copytree(private, replacement)
        original_read = execution_ops.PrivateFiles.read
        changed = []
        def replacing(files, path):
            raw = original_read(files, path)
            if str(path) == self.path and not changed:
                changed.append(True)
                private.rename(self.project / 'held-root')
                replacement.rename(private)
            return raw
        with patch.object(execution_ops.PrivateFiles, 'read', new=replacing):
            self.blocked()
        self.assertTrue(changed)

    def test_real_ops_through_cli_is_sanitized_and_never_enters_mutation(self):
        output = io.StringIO()
        args = ['labctl.py', 'inspect-fresh-network-admission', '--run', self.run,
                '--sha256', self.execution['sha256'], '--input', self.path,
                '--input-sha256', self.input_sha]
        source = self.f.r.f.fixture.report['source']
        with patch.object(ops, '_time', return_value=self.now), \
                patch.object(execution_ops, '_git_source', return_value=source), \
                patch.object(labctl, 'PROJECT', self.project), \
                patch.object(labctl, 'Operator', side_effect=AssertionError('Operator')), \
                patch.object(labctl, 'ClusterLock', side_effect=AssertionError('ClusterLock')), \
                patch.object(sys, 'argv', args), redirect_stdout(output):
            labctl.main()
        result = json.loads(output.getvalue())
        self.assertEqual(result['status'], 'prerequisites-reviewed', result)
        self.assertIs(result['external_fence_verified'], False)
        self.assertIs(result['executable'], False)
        for private in (self.path, self.f.keys[0], self.f.r.f.fixture.sentinel,
                        self.isolation['old_hosts'][0]['machine_id']):
            self.assertNotIn(private, output.getvalue())

    def test_real_source_check_cannot_drift_midflight(self):
        source = self.f.r.f.fixture.report['source']
        changed = {**source, 'commit': 'e' * 40}
        calls = []
        def drifting(_project):
            calls.append(1)
            return source if len(calls) == 1 else changed
        with patch.object(execution_ops, '_git_source', side_effect=drifting):
            self.assertEqual(self.inspect(source_state=None)['status'], 'blocked')
        self.assertGreaterEqual(len(calls), 2)

    def test_observation_publication_failure_marker_after_second_inspection_blocks(self):
        inspect = ops.inspect_replacement_facts
        calls = []
        def poisoned(*args, **kwargs):
            result = inspect(*args, **kwargs)
            calls.append(1)
            if len(calls) == 2:
                marker = self.project / replacement_ops.AREA / self.observation['id'] / '.collection-failed'
                marker.write_bytes(b'')
                marker.chmod(0o600)
            return result
        with patch.object(ops, 'inspect_replacement_facts', side_effect=poisoned):
            self.blocked()
        self.assertEqual(len(calls), 2)

    def test_other_publication_markers_added_late_are_rejected(self):
        inspect = ops.inspect_replacement_facts
        original_read = execution_ops.PrivateFiles.read
        proof_path = self.isolation['old_hosts'][0]['proof']['path']
        directories = [(self.project / execution_ops.AREA / self.run, '.publication-failed'),
                       ((self.project / self.f.r.refs['observation']['path']).parent, '.collection-failed')]
        for directory, name in directories:
            with self.subTest(publication=directory.name):
                calls, injected = [], []
                marker = directory / name
                def inspected(*args, **kwargs):
                    result = inspect(*args, **kwargs)
                    calls.append(1)
                    return result
                def poisoned(files, path):
                    result = original_read(files, path)
                    if str(path) == proof_path and len(calls) == 2 and not injected:
                        injected.append(True)
                        marker.write_bytes(b'')
                        marker.chmod(0o600)
                    return result
                try:
                    with patch.object(ops, 'inspect_replacement_facts', side_effect=inspected), \
                            patch.object(execution_ops.PrivateFiles, 'read', new=poisoned):
                        self.blocked()
                    self.assertTrue(injected)
                finally:
                    if marker.exists():
                        marker.unlink()

    def test_identical_replacement_publication_parent_swap_is_rejected(self):
        inspect = ops.inspect_replacement_facts
        directory = self.project / replacement_ops.AREA / self.observation['id']
        held = directory.with_name('held-original')
        calls = []
        def swapped(*args, **kwargs):
            result = inspect(*args, **kwargs)
            calls.append(1)
            if len(calls) == 2:
                directory.rename(held)
                shutil.copytree(held, directory)
            return result
        with patch.object(ops, 'inspect_replacement_facts', side_effect=swapped):
            self.blocked()
        self.assertEqual(len(calls), 2)
