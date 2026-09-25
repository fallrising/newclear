import json
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from core_update import CoreUpdate, BINARY, MANIFEST, UNIT
from core_patch import readiness
from worker_reinstall import sha
from labops import atomic_json
from test_control_health import sample


class CoreUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.updater = CoreUpdate(self.root, os.getuid())
        for name, data in [(BINARY, b'old-binary'), (UNIT, b'original-unit')]:
            p = self.root / name.lstrip('/')
            p.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
            p.write_bytes(data)
            p.chmod(0o755 if name == BINARY else 0o644)
        atomic_json(self.root / MANIFEST.lstrip('/'), {'owner': 'eru-vps-mvp',
            'files': {BINARY: sha(b'old-binary'), UNIT: sha(b'original-unit')}, 'key_generated': True})
        for directory in self.root.rglob('*'):
            if directory.is_dir(): directory.chmod(0o700)
        self.before = self.updater.inspect()

    def install(self):
        return self.updater.install('run-1', self.before, b'new-binary', sha(b'new-binary'))

    def test_install_verifies_backups_and_rollback_restores_only_binary_and_manifest(self):
        self.assertEqual(self.install()['stage'], 'installed')
        self.assertEqual(self.updater.inspect()['binary']['sha256'], sha(b'new-binary'))
        self.assertEqual(self.updater.entry(UNIT), self.before['unit'])
        record = self.updater.rollback('run-1', 'rollback-1')
        self.assertEqual(record['stage'], 'rolled-back')
        self.assertEqual(self.updater.inspect()['binary']['sha256'], sha(b'old-binary'))
        self.assertTrue(json.loads(self.updater.path(MANIFEST).read_text())['key_generated'])

    def test_failed_checksum_or_source_drift_never_replaces_binary(self):
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.updater.install('run-1', self.before, b'bad', sha(b'new-binary'))
        self.updater.path(BINARY).write_bytes(b'external-change')
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            self.install()
        self.assertFalse(self.updater.directory('run-1').exists())

    def test_symlink_hardlink_and_mount_are_rejected(self):
        binary = self.updater.path(BINARY)
        copy = self.root / 'outside'
        copy.write_bytes(b'old-binary')
        copy.chmod(0o600)
        binary.unlink()
        binary.symlink_to(copy)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.updater.inspect()
        binary.unlink()
        os.link(copy, binary)
        with self.assertRaisesRegex(ValueError, 'hardlink'):
            self.updater.inspect()
        binary.unlink()
        binary.write_bytes(b'old-binary')
        binary.chmod(0o755)
        self.updater.mounts.add(BINARY)
        with self.assertRaisesRegex(ValueError, 'mount'):
            self.updater.inspect()

    def test_interruption_between_binary_and_manifest_is_recoverable(self):
        original_save = self.updater.save
        def stop(directory, journal):
            if journal['stage'] == 'binary-replaced':
                raise OSError('power loss')
            original_save(directory, journal)
        with patch.object(self.updater, 'save', side_effect=stop):
            with self.assertRaisesRegex(OSError, 'power loss'):
                self.install()
        self.assertEqual(self.updater.path(BINARY).read_bytes(), b'new-binary')
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            self.updater.inspect()
        self.updater.rollback('run-1', 'rollback-1')
        self.assertEqual(self.updater.path(BINARY).read_bytes(), b'old-binary')

    def test_backup_corruption_and_later_changes_block_rollback(self):
        self.install()
        backup = self.updater.directory('run-1') / 'binary.before'
        backup.write_bytes(b'corruption')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.updater.rollback('run-1', 'rollback-1')
        backup.write_bytes(b'old-binary')
        self.updater.path(BINARY).write_bytes(b'newer-install')
        with self.assertRaisesRegex(ValueError, 'later changes'):
            self.updater.rollback('run-1', 'rollback-1')
        self.assertEqual(self.updater.path(BINARY).read_bytes(), b'newer-install')

    def test_existing_run_cannot_be_replayed(self):
        self.install()
        with self.assertRaises(ValueError):
            self.install()
        self.assertEqual(self.updater.path(BINARY).read_bytes(), b'new-binary')


class ReadinessTests(unittest.TestCase):
    def report(self):
        samples = [sample(n * 10, 100 + n, '.128') for n in range(21)]
        for s in samples:
            s['commands']['services']['stdout'] = 'ActiveState=active\n' * 4
        return {'status': 'complete', 'samples': samples}

    def test_performance_warning_does_not_prevent_bounded_functional_trial(self):
        result = readiness(self.report(), at=210)
        self.assertTrue(result['eligible_for_bounded_trial'])
        self.assertEqual(len(result['performance_findings']), 2)

    def test_stale_incomplete_restart_timeout_or_inactive_is_blocked(self):
        cases = ['stale', 'incomplete', 'restart', 'timeout', 'inactive', 'panic', 'gap']
        for case in cases:
            with self.subTest(case=case):
                report = self.report()
                b = report['samples'][-1]['commands']
                at = 210
                if case == 'stale': at = 1000
                if case == 'incomplete': report['status'] = 'collecting'
                if case == 'restart': b['services']['stdout'] += 'new invocation'
                if case == 'timeout': b['health']['exit_code'] = 1
                if case == 'inactive': b['services']['stdout'] = 'ActiveState=failed\n' * 4
                if case == 'gap': report['samples'][10]['time'] += 21
                if case == 'panic': b['journal']['stdout'] = 'panic: cannot create context from nil parent'
                self.assertFalse(readiness(report, at=at)['eligible_for_bounded_trial'])

from copy import deepcopy
from core_patch import PatchOperator
import test_labctl as fixtures


class FakePatch(PatchOperator):
    def __init__(self, project, snapshot):
        super().__init__(project)
        self.live = deepcopy(snapshot)
        self.installs = self.restarts = 0
        self.lose_install_response = False
        self.footprint = {'binary': {'sha256': sha(b'old')}}

    def snapshot(self): return deepcopy(self.live)
    def health(self): return {'exit_code': 0}
    def protected_services(self): return {'protected': 'same invocations'}
    def core_runtime(self):
        return {'sha256': sha(b'new' if self.restarts else b'old'),
                'InvocationID': str(self.restarts)}
    def remote(self, config):
        if config['action'] == 'inspect': return deepcopy(self.footprint)
        self.installs += 1
        self.footprint['binary']['sha256'] = config['sha256']
        if self.lose_install_response: raise TimeoutError('install reply lost')
        return {'stage': 'installed'}
    def command(self, host, argv, stdin=None):
        assert host == 'ckc-disposable-01' and argv[-2:] == ['restart', 'eru-core.service']
        self.restarts += 1
        return ''


class PatchFlowTests(unittest.TestCase):
    def setUp(self):
        import time
        fixture = fixtures.OperatorTests('test_wrong_supplied_hash_cannot_remove')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.snapshot['workloads'] = []
        for host in fixture.snapshot['hosts'].values(): host['containers'] = ''
        self.op = FakePatch(fixture.project, fixture.snapshot)
        self.project = fixture.project
        report = ReadinessTests().report()
        for s in report['samples']: s['time'] += time.time() - 210
        atomic_json(self.project / 'private/health.json', report)
        patch_dir = self.project / 'patches'
        patch_dir.mkdir(parents=True)
        patch_bytes = b'fixture patch\n'
        (patch_dir / 'core-v0.1.5-lock-context.patch').write_bytes(patch_bytes)
        artifact_sha = sha(b'new')
        atomic_json(self.project / 'artifacts.amd64.lock.json', {'architecture': 'linux/amd64'})
        atomic_json(self.project / 'upstream.lock.json', {'core': {'tag': 'v0.1.5', 'commit': 'a' * 40}})
        atomic_json(patch_dir / 'core-v0.1.5-lock-context.validation.json', {
            'schema_version': 1, 'release_id': 'core-v0.1.5-lock-context-r1',
            'repository': 'projecteru2/core', 'source_tag': 'v0.1.5', 'target_version': 'v0.1.5',
            'patch_revision': 1, 'compatible_from_versions': ['v0.1.5'], 'architecture': 'linux/amd64',
            'patch_file': 'core-v0.1.5-lock-context.patch',
            'patch_sha256': hashlib.sha256(patch_bytes).hexdigest(), 'source_commit': 'a' * 40,
            'artifact_sha256': artifact_sha,
            'toolchain': {'version': 'go1.27.1', 'os': 'linux', 'arch': 'amd64', 'sha256': 'b' * 64},
            'steps': [{'name': name, 'argv': argv, 'exit_code': code} for name, argv, code in [
                ('baseline-final', ['go', 'test', 'baseline'], 1),
                ('patched-final', ['go', 'test', 'regression'], 0),
                ('calcium-tests', ['go', 'test', './cluster/calcium'], 0),
                ('lock-tests', ['go', 'test', './lock/...'], 0),
                ('build', ['go', 'build'], 0)]],
            'independent_runner_verification': {'status': 'verified-not-deployed',
                'artifact_sha256': artifact_sha, 'byte_identical_to_first_build': True,
                'steps': [{'name': name, 'exit_code': code} for name, code in [
                    ('baseline', 1), ('regression', 0), ('calcium', 0), ('locks', 0), ('build', 0)]],
            },
        })
        self.enterContext(patch('core_patch.artifact', return_value=(b'new', artifact_sha)))

    def plan(self): return self.op.make_plan('private/builds/fixture', 'private/health.json')

    def test_verified_install_updates_revision_and_cannot_be_replayed(self):
        plan = self.plan()
        result = self.op.apply_plan(plan['plan']['id'], plan['sha256'])
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(plan['plan']['version_transition']['kind'], 'baseline-install')
        self.assertEqual((self.op.installs, self.op.restarts), (1, 1))
        revision = json.loads((self.op.root / 'core-revision.json').read_text())
        self.assertEqual(revision['release']['release_id'], 'core-v0.1.5-lock-context-r1')
        with self.assertRaisesRegex(ValueError, 'never replay'):
            self.op.apply_plan(plan['plan']['id'], plan['sha256'])
        self.assertEqual((self.op.installs, self.op.restarts), (1, 1))

    def test_hash_bound_plan_classifies_a_reviewed_cross_version_candidate(self):
        import copy
        self.op.restarts = 1  # The current running checksum maps to the reviewed v0.1.5 artifact.
        old_path = self.project / 'patches/core-v0.1.5-lock-context.validation.json'
        candidate = json.loads(old_path.read_text())
        patch_bytes = b'v0.2.0 fixture patch\n'
        patch_name = 'core-v0.2.0-lock-context.patch'
        (self.project / 'patches' / patch_name).write_bytes(patch_bytes)
        candidate.update({
            'release_id': 'core-v0.2.0-lock-context-r1',
            'source_tag': 'v0.2.0', 'target_version': 'v0.2.0',
            'source_commit': 'b' * 40, 'patch_revision': 1,
            'compatible_from_versions': ['v0.2.0', 'v0.1.5'],
            'patch_file': patch_name,
            'patch_sha256': hashlib.sha256(patch_bytes).hexdigest(),
            'artifact_sha256': sha(b'newer'),
        })
        candidate['steps'].append({
            'name': 'compatibility-from-v0.1.5',
            'argv': ['go', 'test', './compatibility/v0.1.5'],
            'exit_code': 0,
        })
        candidate['independent_runner_verification']['artifact_sha256'] = sha(b'newer')
        validation_file = self.project / 'patches/core-v0.2.0-lock-context.validation.json'
        atomic_json(validation_file, candidate)
        with patch('core_patch.artifact', return_value=(b'newer', sha(b'newer'))):
            plan = self.op.make_plan('private/builds/v0.2.0', 'private/health.json',
                                     validation_file='patches/core-v0.2.0-lock-context.validation.json')
        self.assertTrue(plan['plan']['executable'])
        self.assertEqual(plan['plan']['version_transition'], {
            'kind': 'cross-version-upgrade', 'from_version': 'v0.1.5',
            'to_version': 'v0.2.0', 'cross_version': True,
        })

    def test_lost_install_response_is_failed_and_never_retried_or_restarted(self):
        plan = self.plan()
        self.op.lose_install_response = True
        with self.assertRaises(TimeoutError): self.op.apply_plan(plan['plan']['id'], plan['sha256'])
        self.assertEqual(self.op.journal['failed_at'], 'replacing-core-binary')
        self.assertEqual((self.op.installs, self.op.restarts), (1, 0))
        with self.assertRaisesRegex(ValueError, 'never replay'):
            self.op.apply_plan(plan['plan']['id'], plan['sha256'])

    def test_changed_release_validation_record_blocks_before_install(self):
        plan = self.plan()
        manifest_path = self.project / 'patches/core-v0.1.5-lock-context.validation.json'
        record = json.loads(manifest_path.read_text())
        record['release_id'] = 'changed-after-plan'
        atomic_json(manifest_path, record)
        with self.assertRaisesRegex(ValueError, 'bound inputs changed'):
            self.op.apply_plan(plan['plan']['id'], plan['sha256'])
        self.assertEqual((self.op.installs, self.op.restarts), (0, 0))

    def test_health_evidence_drift_prevents_install(self):
        plan = self.plan()
        atomic_json(self.project / 'private/health.json', {'changed': True})
        with self.assertRaisesRegex(ValueError, 'health evidence'):
            self.op.apply_plan(plan['plan']['id'], plan['sha256'])
        self.assertEqual((self.op.installs, self.op.restarts), (0, 0))

    def test_release_reapply_cannot_silently_downgrade_verified_core(self):
        atomic_json(self.op.root / 'core-revision.json', {'operation': 'core-patch'})
        plan = self.op.plan('reapply')['plan']
        self.assertFalse(plan['executable'])
        self.assertIn('downgrade', ' '.join(plan['blockers']))


class PayloadTests(unittest.TestCase):
    def test_gzip_transport_keeps_exact_binary_checksum(self):
        import gzip, base64
        from core_update import decode_payload
        binary = b'ELF fixture' * 100
        config = {'payload': base64.b64encode(gzip.compress(binary, mtime=0)).decode(),
                  'payload_encoding': 'gzip-base64', 'sha256': sha(binary)}
        self.assertEqual(decode_payload(config), binary)
        config['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'checksum'): decode_payload(config)
