"""Temporary fixture coverage for nonexecuting execution preparation."""
from datetime import timedelta
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import test_fresh_rebuild as fixtures
import fresh_execution_ops as ops
import pending_generation


class FreshExecutionTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.FreshRebuildPlanTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        f = self.fixture
        self.project, self.now = f.project, f.now
        self.review, _ = f.save()
        self.run = 'fresh-run-1'
        p = self.review['plan']
        self.binding = {'run_id': self.run, 'plan_id': p['id'],
                        'review_sha256': self.review['sha256'],
                        'scope_sha256': p['scope']['scope_sha256'],
                        'cluster_id': p['cluster_id'],
                        'generation_before': p['generation_before'],
                        'target_generation': p['generation_after']}
        self.evidence = {
            'owner_authorization': {'authority': 'owner', 'approved': True,
                'issued_at': self.now.isoformat(),
                'expires_at': (self.now + timedelta(minutes=30)).isoformat()},
            'writer_fence': {'observed_at': self.now.isoformat(), 'active': True,
                             'controller_count': 1, 'in_flight_writers': 0},
            'host_baseline': {'observed_at': self.now.isoformat(), 'hosts': [
                {'alias': h['alias'], 'node': h['node'], 'machine_id': h['current_machine_id'],
                 'boot_id_sha256': hashlib.sha256(h['alias'].encode()).hexdigest(),
                 'host_key_sha256': hashlib.sha256(h['node'].encode()).hexdigest()}
                for h in p['scope']['hosts']]},
            'external_materials': {'observed_at': self.now.isoformat(), 'materials': {}},
        }
        for name in p['bindings']['external_materials']:
            rel = 'private/fresh-execution-inputs/' + name + '.bin'
            path = self.project / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(name.encode())
            self.evidence['external_materials']['materials'][name] = {
                'path': rel, 'sha256': hashlib.sha256(name.encode()).hexdigest(),
                'size': len(name)}
        self.input_path = 'private/fresh-execution-inputs/prepare.json'
        self.write_evidence()

    def secure(self):
        for path in (self.project / 'private').rglob('*'):
            if not path.is_symlink():
                path.chmod(0o700 if path.is_dir() else 0o600)
        (self.project / 'private').chmod(0o700)

    def write_evidence(self):
        self.document = {'schema_version': 1, 'binding': self.binding}
        for kind, fields in self.evidence.items():
            relative = 'private/fresh-execution-inputs/' + kind + '.json'
            value = {'schema_version': 1, 'kind': kind, 'binding': self.binding, **fields}
            self.fixture.write_json(relative, value)
            self.document[kind] = {'path': relative, 'sha256': self.fixture.file_sha(relative)}
        self.fixture.write_json(self.input_path, self.document)
        self.secure()

    def prepare(self, **kwargs):
        return ops.prepare_execution(self.project, self.review['plan']['id'],
            self.review['sha256'], self.input_path, self.run,
            now=kwargs.get('now', self.now), source_state=self.fixture.report['source'])

    def inspect(self, sha, **kwargs):
        return ops.inspect_execution(self.project, self.run, sha,
            now=kwargs.get('now', self.now), source_state=self.fixture.report['source'])

    def test_prepare_is_immutable_nonexecuting_and_inspect_readonly(self):
        old = (self.project / 'private/operations/cluster.json').read_bytes()
        envelope, relative = self.prepare()
        self.assertEqual(envelope['execution']['executable'], False)
        self.assertEqual(self.inspect(envelope['sha256'])['status'], 'prepared')
        self.assertEqual(old, (self.project / 'private/operations/cluster.json').read_bytes())
        self.assertFalse((self.project / 'private/pending-generation').exists())
        raw = (self.project / relative).read_bytes()
        with self.assertRaises((ValueError, FileExistsError, RuntimeError)):
            self.prepare()
        self.assertEqual(raw, (self.project / relative).read_bytes())

    def reserve(self, envelope, **changes):
        binding = {k: v for k, v in self.binding.items() if k != 'plan_id'}
        binding.update(execution_sha256=envelope['sha256'],
            cluster_sha256=envelope['execution']['cluster_sha256'],
            fence_sha256=envelope['execution']['evidence']['writer_fence']['sha256'])
        binding.update(changes)
        return pending_generation.reserve(self.project, binding)

    def test_exact_reservation_is_observed_without_mutation(self):
        envelope, _ = self.prepare()
        self.reserve(envelope)
        before = {str(p): p.read_bytes() for p in self.fixture.private.rglob('*') if p.is_file()}
        with patch.object(ops.os, 'fsync', side_effect=AssertionError('inspection wrote')):
            result = self.inspect(envelope['sha256'])
        self.assertEqual(result['status'], 'reserved')
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.fixture.private.rglob('*') if p.is_file()})
        self.assertNotIn(self.fixture.sentinel, json.dumps(result))
        with self.assertRaises(RuntimeError):
            self.prepare()

    def test_foreign_reservation_blocks(self):
        envelope, _ = self.prepare()
        self.reserve(envelope, fence_sha256='f' * 64)
        self.assertEqual(self.inspect(envelope['sha256'])['status'], 'blocked')

    def test_absent_inspection_does_not_create_execution_directory(self):
        before = set(self.fixture.private.rglob('*'))
        with patch.object(ops.os, 'fsync', side_effect=AssertionError('inspection wrote')):
            self.assertEqual(self.inspect('f' * 64)['status'], 'absent')
        self.assertEqual(before, set(self.fixture.private.rglob('*')))

    def test_incomplete_and_extra_run_records_block(self):
        envelope, relative = self.prepare()
        parent = (self.project / relative).parent
        (parent / '.temporary').write_text('interrupted')
        self.assertEqual(self.inspect(envelope['sha256'])['status'], 'blocked')
        (self.project / relative).unlink()
        self.assertEqual(self.inspect(envelope['sha256'])['status'], 'blocked')

    def test_current_freshness_not_original_review_time(self):
        envelope, _ = self.prepare()
        self.assertEqual(self.inspect(envelope['sha256'], now=self.now + timedelta(minutes=16))['status'], 'blocked')
        with self.assertRaises(ValueError):
            self.prepare(now=self.now + timedelta(days=2))

    def test_invalid_evidence_stops_before_run_directory(self):
        original = copy.deepcopy(self.evidence)
        cases = [
            ('owner_authorization', 'approved', 1),
            ('owner_authorization', 'expires_at', (self.now + timedelta(hours=2)).isoformat()),
            ('owner_authorization', 'issued_at', (self.now + timedelta(seconds=1)).isoformat()),
            ('writer_fence', 'controller_count', True),
            ('writer_fence', 'in_flight_writers', False),
            ('writer_fence', 'active', False),
            ('writer_fence', 'observed_at', (self.now - timedelta(minutes=16)).isoformat()),
            ('host_baseline', 'hosts', original['host_baseline']['hosts'][:3]),
            ('external_materials', 'synthetic', True),
        ]
        for kind, key, value in cases:
            with self.subTest(kind=kind, key=key):
                self.evidence = copy.deepcopy(original)
                self.evidence[kind][key] = value
                self.write_evidence()
                with self.assertRaises(ValueError):
                    self.prepare()
                self.assertFalse((self.project / ops.AREA).exists())

    def test_cross_run_evidence_is_rejected(self):
        self.binding['run_id'] = 'foreign-run'
        self.write_evidence()
        with self.assertRaises(ValueError):
            self.prepare()

    def test_raw_material_hash_is_checked(self):
        material = next(iter(self.evidence['external_materials']['materials'].values()))
        (self.project / material['path']).write_bytes(b'wrong')
        with self.assertRaises(ValueError):
            self.prepare()

    def test_private_links_fifo_duplicate_json_and_oversize_rejected(self):
        path = self.project / self.input_path
        raw = path.read_bytes()
        cases = ['symlink', 'hardlink', 'fifo', 'duplicate', 'oversize']
        for case in cases:
            with self.subTest(case=case):
                path.unlink()
                if case == 'symlink':
                    target = path.with_suffix('.target')
                    target.write_bytes(raw)
                    path.symlink_to(target)
                elif case == 'hardlink':
                    target = path.with_suffix('.hardtarget')
                    target.write_bytes(raw)
                    target.chmod(0o600)
                    os.link(target, path)
                elif case == 'fifo':
                    os.mkfifo(path, 0o600)
                elif case == 'duplicate':
                    path.write_bytes(b'{"schema_version":1,"schema_version":1}')
                    path.chmod(0o600)
                else:
                    path.write_bytes(b' ' * (ops.MAX_BYTES + 1))
                    path.chmod(0o600)
                with self.assertRaises((ValueError, OSError)):
                    self.prepare()
        path.unlink()
        path.write_bytes(raw)
        path.chmod(0o600)

    def test_review_semantic_tamper_rehash_is_rejected(self):
        import fresh_rebuild
        path = self.fixture.output_path(self.review['plan']['id'])
        self.review['plan']['scope']['volume_count'] = 999
        self.review['sha256'] = fresh_rebuild.plan_digest(self.review['plan'])
        path.write_text(json.dumps(self.review))
        with self.assertRaises(ValueError):
            self.prepare()

    def test_code_inventory_cluster_and_source_drift_reject(self):
        for relative in ['scripts/fixture.py', 'private/deployment-plan.json', 'private/operations/cluster.json']:
            path = self.project / relative
            original = path.read_bytes()
            with self.subTest(path=relative):
                path.write_bytes(original + b' ')
                with self.assertRaises(ValueError):
                    self.prepare()
                path.write_bytes(original)
        self.fixture.report['source']['project_clean'] = False
        with self.assertRaises(ValueError):
            self.prepare()

    def test_trusted_private_symlink_and_pinned_identity(self):
        backing = self.project / 'backing'
        self.fixture.private.rename(backing)
        self.fixture.private.symlink_to(backing, target_is_directory=True)
        envelope, _ = self.prepare()
        self.assertEqual(self.inspect(envelope['sha256'])['status'], 'prepared')
        replacement = self.project / 'replacement'
        import shutil
        shutil.copytree(backing, replacement)
        self.fixture.private.unlink()
        self.fixture.private.symlink_to(replacement, target_is_directory=True)
        self.assertEqual(self.inspect(envelope['sha256'])['status'], 'blocked')

    def test_interrupted_publication_reserves_run(self):
        with patch.object(ops.os, 'link', side_effect=OSError('publication failed')):
            with self.assertRaises(OSError):
                self.prepare()
        self.assertEqual(self.inspect('f' * 64)['status'], 'blocked')
        with self.assertRaises(FileExistsError):
            self.prepare()

    def test_lexical_parent_paths_rejected(self):
        with self.assertRaises(ValueError):
            ops.prepare_execution(self.project, self.review['plan']['id'], self.review['sha256'],
                'private/fresh-execution-inputs/../fresh-execution-inputs/prepare.json', self.run,
                now=self.now, source_state=self.fixture.report['source'])

    def test_new_private_and_public_fifo_inputs_rejected_before_legacy_reader(self):
        for relative in ['private/preflight/new.json', 'scripts/new.py']:
            path = self.project / relative
            with self.subTest(relative=relative):
                os.mkfifo(path, 0o600)
                with self.assertRaises(ValueError):
                    self.prepare()
                path.unlink()

    def test_alternate_cluster_binding_cannot_replace_current_generation(self):
        import fresh_rebuild
        old = self.review['plan']['bindings']['cluster_record']
        relative = 'private/operations/alternate-cluster.json'
        self.fixture.write_json(relative, {'cluster_id': 'eru-vps-mvp', 'generation': 7})
        self.secure()
        self.review['plan']['bindings']['cluster_record'] = {
            'path': relative, 'sha256': self.fixture.file_sha(relative)}
        self.review['sha256'] = fresh_rebuild.plan_digest(self.review['plan'])
        self.fixture.output_path(self.review['plan']['id']).write_text(json.dumps(self.review))
        with self.assertRaisesRegex(ValueError, 'canonical'):
            self.prepare()
        self.assertEqual(old['path'], 'private/operations/cluster.json')

    def test_late_source_drift_leaves_blocked_publication(self):
        real_link = ops.os.link
        def changed(*args, **kwargs):
            real_link(*args, **kwargs)
            (self.project / 'scripts/fixture.py').write_text('# changed after publication\n')
        with patch.object(ops.os, 'link', side_effect=changed):
            with self.assertRaises(ValueError):
                self.prepare()
        self.assertEqual(self.inspect('f' * 64)['status'], 'blocked')
        self.assertTrue((self.project / ops.AREA / self.run / '.publication-failed').exists())

    def test_failed_run_directory_fsync_keeps_stop_marker(self):
        real_fsync = ops.os.fsync
        def fail_after_link(fd):
            names = os.listdir(fd) if __import__('stat').S_ISDIR(os.fstat(fd).st_mode) else []
            if names == ['execution.json']:
                raise OSError('late directory sync failure')
            return real_fsync(fd)
        with patch.object(ops.os, 'fsync', side_effect=fail_after_link):
            with self.assertRaises(OSError):
                self.prepare()
        self.assertTrue((self.project / ops.AREA / self.run / '.publication-failed').exists())
        self.assertEqual(self.inspect('f' * 64)['status'], 'blocked')

    def test_overflow_numbers_and_excessive_nesting_are_invalid_json(self):
        for raw in (b'{"extra":1e999}', b'{"extra":' + b'[' * 66 + b'0' + b']' * 66 + b'}'):
            with self.subTest(raw=raw[:20]), self.assertRaises(ValueError):
                ops._decode(raw)

    def test_duplicate_machine_baselines_are_rejected_even_if_review_matches(self):
        import fresh_execution
        plan = copy.deepcopy(self.review['plan'])
        machine = plan['scope']['hosts'][0]['current_machine_id']
        plan['scope']['hosts'][1]['current_machine_id'] = machine
        self.evidence['host_baseline']['hosts'][1]['machine_id'] = machine
        self.write_evidence()
        evidence = {kind: json.loads((self.project / self.document[kind]['path']).read_text())
                    for kind in fresh_execution.KINDS}
        with self.assertRaisesRegex(ValueError, 'distinct'):
            fresh_execution.validate_evidence(self.document, evidence, plan, self.binding, self.now)

    def test_readonly_source_timeout_is_blocked(self):
        import subprocess
        envelope, _ = self.prepare()
        with patch.object(ops, '_git_source', side_effect=subprocess.TimeoutExpired('git', 15)):
            result = ops.inspect_execution(self.project, self.run, envelope['sha256'], now=self.now)
        self.assertEqual(result['status'], 'blocked')

    def test_source_queries_disable_optional_git_index_writes(self):
        import subprocess
        results = [subprocess.CompletedProcess([], 0, 'a' * 40 + '\n', ''),
                   subprocess.CompletedProcess([], 0, '', '')]
        with patch.object(ops.subprocess, 'run', side_effect=results) as run:
            self.assertEqual(ops._git_source(self.project),
                             {'commit': 'a' * 40, 'project_clean': True})
        commands = [call.args[0] for call in run.call_args_list]
        prefix = ['git', '--no-optional-locks', '-C', str(self.project)]
        self.assertEqual(commands, [prefix + ['rev-parse', 'HEAD'],
                                    prefix + ['status', '--porcelain', '--', '.']])
