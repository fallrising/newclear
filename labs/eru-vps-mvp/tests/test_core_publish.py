import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from core_publish import publish
from core_release import validation_record
from labops import atomic_json


class CorePublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.builds = self.project / 'private/builds'
        self.first = self.builds / 'primary'
        self.second = self.builds / 'independent'
        self.first.mkdir(parents=True)
        self.second.mkdir(parents=True)
        self.patches = self.project / 'patches'
        self.patches.mkdir()
        self.patch_bytes = b'fix.patch\n'
        self.patch = self.patches / 'core-v0.1.5-fix.patch'
        self.patch.write_bytes(self.patch_bytes)
        self.artifact_sha = hashlib.sha256(b'ELF core artifact').hexdigest()
        self.base = {
            'schema_version': 1, 'release_id': 'core-v0.1.5-fix-r1',
            'repository': 'projecteru2/core', 'source_tag': 'v0.1.5',
            'target_version': 'v0.1.5', 'patch_revision': 1,
            'compatible_from_versions': ['v0.1.5', 'v0.1.4'], 'architecture': 'linux/amd64',
            'patch_file': self.patch.name,
            'patch_sha256': hashlib.sha256(self.patch_bytes).hexdigest(),
            'source_commit': 'a' * 40, 'artifact_sha256': self.artifact_sha,
            'toolchain': {'version': 'go1.27.1', 'os': 'linux', 'arch': 'amd64', 'sha256': 'b' * 64},
            'status': 'verified-not-deployed',
        }
        self.steps = [
            {'name': 'baseline', 'argv': ['/tmp/build/go/bin/go', 'test', 'baseline'], 'exit_code': 1},
            {'name': 'regression', 'argv': ['/tmp/build/go/bin/go', 'test', './cluster/calcium', '-run', 'Target'], 'exit_code': 0},
            {'name': 'calcium', 'argv': ['/tmp/build/go/bin/go', 'test', './cluster/calcium'], 'exit_code': 0},
            {'name': 'locks', 'argv': ['/tmp/build/go/bin/go', 'test', './lock/...'], 'exit_code': 0},
            {'name': 'build', 'argv': ['/tmp/build/go/bin/go', 'build', '-trimpath', '-o', '/tmp/build/eru-core', '.'], 'exit_code': 0},
            {'name': 'compatibility-from-v0.1.4',
             'argv': ['/tmp/build/go/bin/go', 'test', './compat/v0.1.4', '-count=1'], 'exit_code': 0},
        ]
        for directory in (self.first, self.second):
            (directory / 'baseline.log').write_text('cannot create context from nil parent\n' * 2)
        first = dict(self.base, steps=self.steps, artifact_sha256=self.artifact_sha)
        second = dict(self.base, steps=self.steps, artifact_sha256=self.artifact_sha)
        atomic_json(self.first / 'result.json', first)
        atomic_json(self.second / 'result.json', second)
        atomic_json(self.project / 'artifacts.amd64.lock.json', {'architecture': 'linux/amd64'})

    def test_publishes_only_safe_summary_from_identical_independent_builds(self):
        output = 'patches/core-v0.1.5-fix.validation.json'
        report = publish(self.project, self.first / 'result.json', self.second / 'result.json', output)
        published = validation_record(self.project, output)
        self.assertEqual(published['artifact_sha256'], self.artifact_sha)
        self.assertEqual(report['independent_runner_verification']['byte_identical_to_first_build'], True)
        self.assertIn('v0.1.4', published['compatible_from_versions'])
        text = (self.patches / Path(output).name).read_text()
        self.assertNotIn('/tmp/build', text)
        self.assertIn('<private artifact>', text)
        self.assertEqual(len(report['build_result_sha256']['primary']), 64)

    def test_same_result_file_cannot_claim_independent_builds(self):
        first = self.first / 'result.json'
        for index, independent in enumerate((first, Path('private/builds/primary/result.json'))):
            with self.subTest(independent=str(independent)):
                with self.assertRaisesRegex(ValueError, 'distinct.*files'):
                    publish(self.project, first, independent,
                            f'patches/same-file-{index}.validation.json')

    def test_hardlinked_result_files_cannot_claim_independent_builds(self):
        second = self.second / 'result.json'
        second.unlink()
        os.link(self.first / 'result.json', second)
        with self.assertRaisesRegex(ValueError, 'distinct.*files'):
            publish(self.project, self.first / 'result.json', second,
                    'patches/hardlink.validation.json')

    def test_distinct_result_files_with_identical_bytes_are_accepted(self):
        first, second = self.first / 'result.json', self.second / 'result.json'
        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertFalse(first.samefile(second))
        output = 'patches/identical.validation.json'
        publish(self.project, first, second, output)
        self.assertEqual(validation_record(self.project, output)['artifact_sha256'],
                         self.artifact_sha)
        self.assertEqual(list(self.patches.glob('.*.validation.json')), [])

    def test_racing_destination_creation_preserves_competing_manifest(self):
        output = self.patches / 'race.validation.json'
        competing = b'{"competing": "immutable reviewed release"}\n'

        def create_competitor(project, temporary):
            release = validation_record(project, temporary)
            output.write_bytes(competing)
            return release

        with patch('core_publish.validation_record', side_effect=create_competitor):
            with self.assertRaises(FileExistsError):
                publish(self.project, self.first / 'result.json',
                        self.second / 'result.json', output)
        self.assertEqual(output.read_bytes(), competing)
        self.assertEqual(list(self.patches.glob('.*.validation.json')), [])

    def test_racing_destination_symlink_is_preserved_without_touching_its_target(self):
        output = self.patches / 'symlink-race.validation.json'
        target = self.patches / 'competing.validation.json'
        target.write_bytes(b'previous reviewed manifest\n')

        def create_competitor(project, temporary):
            release = validation_record(project, temporary)
            output.symlink_to(target)
            return release

        with patch('core_publish.validation_record', side_effect=create_competitor):
            with self.assertRaises(FileExistsError):
                publish(self.project, self.first / 'result.json',
                        self.second / 'result.json', output)
        self.assertTrue(output.is_symlink())
        self.assertEqual(target.read_bytes(), b'previous reviewed manifest\n')
        self.assertEqual(list(self.patches.glob('.*.validation.json')), [])

    def test_result_inputs_must_remain_regular_files(self):
        second = self.second / 'result.json'
        second.unlink()
        second.symlink_to(self.first / 'result.json')
        with self.assertRaisesRegex(ValueError, 'regular result.json'):
            publish(self.project, self.first / 'result.json', second,
                    'patches/symlink.validation.json')
        second.unlink()
        second.mkdir()
        with self.assertRaisesRegex(ValueError, 'regular result.json'):
            publish(self.project, self.first / 'result.json', second,
                    'patches/directory.validation.json')

    def test_validation_failure_cleans_temporary_manifest(self):
        output = self.patches / 'failed.validation.json'
        with patch('core_publish.validation_record', side_effect=ValueError('invalid candidate')):
            with self.assertRaisesRegex(ValueError, 'invalid candidate'):
                publish(self.project, self.first / 'result.json',
                        self.second / 'result.json', output)
        self.assertFalse(output.exists())
        self.assertEqual(list(self.patches.glob('.*.validation.json')), [])

    def test_mismatched_build_provenance_or_binary_is_rejected(self):
        second = json.loads((self.second / 'result.json').read_text())
        second['source_commit'] = 'c' * 40
        atomic_json(self.second / 'result.json', second)
        with self.assertRaisesRegex(ValueError, 'identity does not match'):
            publish(self.project, self.first / 'result.json', self.second / 'result.json',
                    'patches/mismatch.validation.json')
        second['source_commit'] = 'a' * 40
        second['artifact_sha256'] = 'd' * 64
        atomic_json(self.second / 'result.json', second)
        with self.assertRaisesRegex(ValueError, 'identity does not match'):
            publish(self.project, self.first / 'result.json', self.second / 'result.json',
                    'patches/different.validation.json')

    def test_failed_tests_missing_panic_log_and_external_result_are_rejected(self):
        second = json.loads((self.second / 'result.json').read_text())
        second['steps'][2]['exit_code'] = 1
        atomic_json(self.second / 'result.json', second)
        with self.assertRaisesRegex(ValueError, 'test or build step failed'):
            publish(self.project, self.first / 'result.json', self.second / 'result.json',
                    'patches/failure.validation.json')
        second['steps'][2]['exit_code'] = 0
        atomic_json(self.second / 'result.json', second)
        (self.first / 'baseline.log').write_text('different failure\n')
        with self.assertRaisesRegex(ValueError, 'expected regression'):
            publish(self.project, self.first / 'result.json', self.second / 'result.json',
                    'patches/no-regression.validation.json')
        with self.assertRaisesRegex(ValueError, 'private/builds'):
            publish(self.project, self.project / 'outside.json', self.second / 'result.json',
                    'patches/outside.validation.json')

    def test_refuses_overwrite_and_private_output_path(self):
        existing = self.patches / 'existing.validation.json'
        existing.write_text('{}')
        with self.assertRaises(FileExistsError):
            publish(self.project, self.first / 'result.json', self.second / 'result.json', existing)
        with self.assertRaisesRegex(ValueError, 'under patches'):
            publish(self.project, self.first / 'result.json', self.second / 'result.json',
                    'private/builds/public.validation.json')


if __name__ == '__main__':
    unittest.main()
