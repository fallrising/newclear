import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from core_release import classify_transition, runtime_release, validation_record
from labops import atomic_json


class CoreReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.patches = self.project / 'patches'
        self.patches.mkdir()
        self.patch = self.patches / 'fix.patch'
        self.patch.write_bytes(b'patch bytes\n')
        self.artifact_sha = hashlib.sha256(b'ELF artifact').hexdigest()
        atomic_json(self.project / 'artifacts.amd64.lock.json', {'architecture': 'linux/amd64'})
        self.validation_path = self.patches / 'core-v0.1.5-fix.validation.json'
        atomic_json(self.validation_path, self.manifest())

    def manifest(self):
        return {
            'schema_version': 1,
            'release_id': 'core-v0.1.5-fix-r1',
            'repository': 'projecteru2/core',
            'source_tag': 'v0.1.5',
            'target_version': 'v0.1.5',
            'patch_revision': 1,
            'compatible_from_versions': ['v0.1.5'],
            'architecture': 'linux/amd64',
            'patch_file': self.patch.name,
            'patch_sha256': hashlib.sha256(self.patch.read_bytes()).hexdigest(),
            'source_commit': 'a' * 40,
            'artifact_sha256': self.artifact_sha,
            'toolchain': {
                'version': 'go1.27.1', 'os': 'linux', 'arch': 'amd64',
                'sha256': 'b' * 64,
            },
            'steps': [
                {'name': 'baseline-final', 'argv': ['go', 'test', 'baseline'], 'exit_code': 1},
                {'name': 'patched-final', 'argv': ['go', 'test', 'regression'], 'exit_code': 0},
                {'name': 'calcium-tests', 'argv': ['go', 'test', './cluster/calcium'], 'exit_code': 0},
                {'name': 'lock-tests', 'argv': ['go', 'test', './lock/...'], 'exit_code': 0},
                {'name': 'build', 'argv': ['go', 'build'], 'exit_code': 0},
            ],
            'independent_runner_verification': {
                'status': 'verified-not-deployed',
                'artifact_sha256': self.artifact_sha,
                'byte_identical_to_first_build': True,
                'steps': [
                    {'name': 'baseline', 'exit_code': 1},
                    {'name': 'regression', 'exit_code': 0},
                    {'name': 'calcium', 'exit_code': 0},
                    {'name': 'locks', 'exit_code': 0},
                    {'name': 'build', 'exit_code': 0},
                ],
            },
        }

    def release(self):
        return validation_record(self.project, self.validation_path)

    def test_valid_record_binds_source_patch_toolchain_and_reproducible_artifact(self):
        record = self.release()
        self.assertEqual(record['source_tag'], 'v0.1.5')
        self.assertEqual(record['patch_sha256'], hashlib.sha256(self.patch.read_bytes()).hexdigest())
        self.assertEqual(record['artifact_sha256'], self.artifact_sha)
        self.assertEqual(len(record['validation_sha256']), 64)

    def test_record_rejects_path_escape_wrong_arch_and_changed_patch(self):
        with self.assertRaisesRegex(ValueError, 'under patches'):
            validation_record(self.project, 'private/not-a-release.validation.json')
        record = self.manifest()
        record['architecture'] = 'linux/arm64'
        atomic_json(self.validation_path, record)
        with self.assertRaisesRegex(ValueError, 'architecture'):
            self.release()
        record['architecture'] = 'linux/amd64'
        self.patch.write_bytes(b'changed')
        atomic_json(self.validation_path, record)
        with self.assertRaisesRegex(ValueError, 'patch checksum'):
            self.release()

    def test_runtime_checksum_drift_from_recorded_patch_blocks_version_guessing(self):
        revision = {
            'operation': 'core-patch',
            'artifact_sha256': 'f' * 64,
        }
        with self.assertRaisesRegex(ValueError, 'differs from the recorded patch'):
            runtime_release(self.project, self.artifact_sha, revision)

    def test_running_binary_claimed_by_invalid_record_is_not_treated_as_baseline(self):
        record = self.manifest()
        record['compatible_from_versions'] = ['v0.1.5', 'v0.1.4']
        atomic_json(self.validation_path, record)
        with self.assertRaisesRegex(ValueError, 'version-specific test'):
            runtime_release(self.project, self.artifact_sha)

    def test_record_rejects_failed_or_non_reproducible_release(self):
        record = self.manifest()
        record['steps'][2]['exit_code'] = 1
        atomic_json(self.validation_path, record)
        with self.assertRaisesRegex(ValueError, 'incomplete or failed'):
            self.release()
        record = self.manifest()
        record['independent_runner_verification']['artifact_sha256'] = 'c' * 64
        atomic_json(self.validation_path, record)
        with self.assertRaisesRegex(ValueError, 'reproducible build'):
            self.release()


    def test_compatibility_claim_requires_a_passing_version_specific_step(self):
        record = self.manifest()
        record['compatible_from_versions'] = ['v0.1.5', 'v0.1.4']
        atomic_json(self.validation_path, record)
        with self.assertRaisesRegex(ValueError, 'version-specific test'):
            self.release()
        record['steps'].append({'name': 'compatibility-from-v0.1.4',
                                'argv': ['go', 'test', './compat'], 'exit_code': 0})
        atomic_json(self.validation_path, record)
        self.assertIn('v0.1.4', self.release()['compatible_from_versions'])

    def test_transition_distinguishes_reapply_patch_revision_upgrade_and_rollback(self):
        current = self.release()
        self.assertEqual(classify_transition(current, current, 'v0.1.5')['kind'], 'same-release-reapply')

        newer_revision = copy.deepcopy(current)
        newer_revision.update(release_id='core-v0.1.5-fix-r2', patch_revision=2,
                              artifact_sha256='d' * 64)
        transition = classify_transition(current, newer_revision, 'v0.1.5')
        self.assertEqual(transition['kind'], 'same-version-patch-update')
        self.assertFalse(transition['cross_version'])

        next_release = copy.deepcopy(newer_revision)
        next_release.update(release_id='core-v0.2.0-fix-r1', source_tag='v0.2.0',
                            target_version='v0.2.0', patch_revision=1,
                            compatible_from_versions=['v0.2.0', 'v0.1.5'],
                            artifact_sha256='e' * 64)
        transition = classify_transition(current, next_release, 'v0.1.5')
        self.assertEqual(transition['kind'], 'cross-version-upgrade')
        self.assertTrue(transition['cross_version'])

        older = copy.deepcopy(current)
        older.update(source_tag='v0.1.4', target_version='v0.1.4', artifact_sha256='f' * 64,
                     compatible_from_versions=['v0.1.4'])
        with self.assertRaisesRegex(ValueError, 'downgrade'):
            classify_transition(next_release, older, 'v0.2.0')

    def test_same_upstream_tag_cannot_hide_a_source_commit_change(self):
        current = self.release()
        changed_source = copy.deepcopy(current)
        changed_source.update(source_commit='c' * 40, patch_revision=2,
                              artifact_sha256='d' * 64)
        with self.assertRaisesRegex(ValueError, 'different source commit'):
            classify_transition(current, changed_source, 'v0.1.5')

    def test_same_artifact_checksum_cannot_be_relabelled_as_a_new_core_version(self):
        current = self.release()
        relabelled = copy.deepcopy(current)
        relabelled.update(source_tag='v0.2.0', target_version='v0.2.0')
        with self.assertRaisesRegex(ValueError, 'two core versions'):
            classify_transition(current, relabelled, 'v0.1.5')

    def test_unknown_installed_version_allows_only_the_pinned_baseline(self):
        target = self.release()
        self.assertEqual(classify_transition(None, target, 'v0.1.5')['kind'], 'baseline-install')
        newer = copy.deepcopy(target)
        newer.update(source_tag='v0.2.0', target_version='v0.2.0',
                     compatible_from_versions=['v0.2.0', 'v0.1.5'])
        with self.assertRaisesRegex(ValueError, 'version is unknown'):
            classify_transition(None, newer, 'v0.1.5')


if __name__ == '__main__':
    unittest.main()
