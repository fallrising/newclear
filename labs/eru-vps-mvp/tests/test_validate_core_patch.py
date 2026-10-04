"""Regression for git apply silently skipping a nested, untracked source tree."""
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import validate_core_patch
from validate_core_patch import apply_source_patch


class PatchRunnerTests(unittest.TestCase):
    def test_patch_under_enclosing_git_repository_really_changes_source(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            subprocess.run(['git', 'init', '--quiet', str(parent)], check=True)
            source = parent / 'private/build/core'
            source.mkdir(parents=True)
            (source / 'lock.go').write_text('broken\n')
            patch = parent / 'fix.patch'
            patch.write_text('--- a/lock.go\n+++ b/lock.go\n@@ -1 +1 @@\n-broken\n+fixed\n')
            apply_source_patch(source, patch, check=True)
            apply_source_patch(source, patch, include='lock.go')
            self.assertEqual((source / 'lock.go').read_text(), 'fixed\n')
            self.assertTrue((source / '.git').is_dir())

    def test_exact_source_patch_can_use_zero_context_hunks(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            (source / 'file.go').write_text('first\nsecond\n')
            patch = source / 'insert.patch'
            patch.write_text('--- a/file.go\n+++ b/file.go\n@@ -1,0 +2 @@\n+inserted\n')
            apply_source_patch(source, patch, check=True)
            apply_source_patch(source, patch, include='file.go')
            self.assertEqual((source / 'file.go').read_text(), 'first\ninserted\nsecond\n')


class CandidateValidationTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(os.umask, os.umask(0o077))
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / 'project'
        self.project.mkdir()
        self.source = self.root / 'upstream'
        self.source.mkdir()
        self.git('init', '--quiet')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('config', 'tag.gpgsign', 'false')
        self.git('config', 'core.hooksPath', '/dev/null')
        (self.source / 'cluster/calcium').mkdir(parents=True)
        (self.source / 'cluster/calcium/lock_test.go').write_text('existing tests\n')
        (self.source / 'cluster/calcium/lock.go').write_text('broken\n')
        (self.source / 'version.txt').write_text('baseline\n')
        self.git('add', '.')
        self.git('commit', '--quiet', '-m', 'fixture baseline')
        self.baseline = self.git('rev-parse', 'HEAD').strip()
        self.git('tag', 'v0.1.5')
        (self.source / 'version.txt').write_text('candidate\n')
        self.git('add', '.')
        self.git('commit', '--quiet', '-m', 'fixture candidate')
        self.candidate = self.git('rev-parse', 'HEAD').strip()
        self.git('tag', '-a', 'v0.1.7', '-m', 'fixture annotated candidate')
        (self.source / 'version.txt').write_text('uncommitted checkout content\n')
        self.before_status = self.git('status', '--porcelain')
        self.lock = self.project / 'upstream.lock.json'
        self.lock.write_text(json.dumps({'core': {'tag': 'v0.1.5', 'commit': self.baseline}}))
        self.before_lock = self.lock.read_bytes()
        (self.project / 'artifacts.amd64.lock.json').write_text(json.dumps({'architecture': 'linux/amd64'}))
        patches = self.project / 'patches'
        patches.mkdir()
        self.patch_file = patches / 'cumulative.patch'
        self.patch_file.write_text(
            '--- a/cluster/calcium/lock_test.go\n+++ b/cluster/calcium/lock_test.go\n'
            '@@ -1 +1,2 @@\n existing tests\n+regression tests\n'
            '--- a/cluster/calcium/lock.go\n+++ b/cluster/calcium/lock.go\n'
            '@@ -1 +1 @@\n-broken\n+fixed\n'
            '--- /dev/null\n+++ b/compat/v015/compat_test.go\n'
            '@@ -0,0 +1 @@\n+candidate compatibility tests\n')
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w:gz') as tar:
            entry = tarfile.TarInfo('go/bin/go')
            entry.size = 0
            entry.mode = 0o755
            tar.addfile(entry, io.BytesIO())
        self.toolchain = archive.getvalue()
        self.go_sha = hashlib.sha256(self.toolchain).hexdigest()
        self.output = self.root / 'build'
        self.go_calls = []
        self.baseline_log = 'cannot create context from nil parent\n' * 2
        self.fail_package = None

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.source), *args], text=True)

    def validate(self, *extra):
        real_run = subprocess.run

        def run(argv, **kwargs):
            if str(argv[0]).endswith('/go/bin/go'):
                self.go_calls.append(argv)
                tree = Path(kwargs['cwd'])
                baseline = (tree / 'cluster/calcium/lock.go').read_text() == 'broken\n'
                self.assertEqual((tree / 'cluster/calcium/lock_test.go').read_text(),
                                 'existing tests\nregression tests\n')
                if baseline:
                    self.assertFalse((tree / 'compat/v015/compat_test.go').exists())
                    kwargs['stdout'].write(self.baseline_log)
                    return subprocess.CompletedProcess(argv, 1)
                if self.fail_package is not None and self.fail_package in argv:
                    return subprocess.CompletedProcess(argv, 1)
                if argv[1] == 'build':
                    Path(argv[argv.index('-o') + 1]).write_bytes((tree / 'version.txt').read_bytes())
                if './compat/v015' in argv:
                    self.assertEqual((tree / 'compat/v015/compat_test.go').read_text(),
                                     'candidate compatibility tests\n')
                return subprocess.CompletedProcess(argv, 0)
            return real_run(argv, **kwargs)

        argv = ['validate_core_patch.py', '--source', str(self.source), '--output', str(self.output),
                '--patch', str(self.patch_file), '--go-sha256', self.go_sha, *extra]
        with patch.object(validate_core_patch, 'PROJECT', self.project), \
                patch.object(sys, 'argv', argv), patch.object(subprocess, 'run', side_effect=run), \
                patch('urllib.request.urlopen', return_value=io.BytesIO(self.toolchain)) as download, \
                redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            try:
                validate_core_patch.main()
            except BaseException:
                if not self.output.exists():
                    download.assert_not_called()
                raise
        return json.loads((self.output / 'result.json').read_text())

    def assert_source_unchanged(self):
        self.assertEqual(self.lock.read_bytes(), self.before_lock)
        self.assertEqual(self.git('rev-parse', 'HEAD').strip(), self.candidate)
        self.assertEqual(self.git('status', '--porcelain'), self.before_status)
        self.assertEqual((self.source / 'version.txt').read_text(), 'uncommitted checkout content\n')

    def test_default_source_uses_locked_archive_without_checkout_or_lock_changes(self):
        report = self.validate()
        self.assertEqual((report['source_tag'], report['source_commit']), ('v0.1.5', self.baseline))
        self.assertEqual((self.output / 'eru-core').read_bytes(), b'baseline\n')
        self.assertEqual(report['status'], 'verified-not-deployed')
        self.assert_source_unchanged()

    def test_candidate_source_binds_annotated_tag_and_exact_archive(self):
        report = self.validate('--source-tag', 'v0.1.7', '--source-commit', self.candidate)
        self.assertEqual((report['source_tag'], report['target_version'], report['source_commit']),
                         ('v0.1.7', 'v0.1.7', self.candidate))
        self.assertEqual(report['compatible_from_versions'], ['v0.1.7'])
        self.assertEqual((self.output / 'eru-core').read_bytes(), b'candidate\n')
        self.assert_source_unchanged()

    def test_candidate_selector_rejects_invalid_inputs_before_creating_output_or_downloading(self):
        cases = [
            ['--source-tag', 'v0.1.7'], ['--source-commit', self.candidate],
            ['--source-tag', 'v0.1.7-rc1', '--source-commit', self.candidate],
            ['--source-tag', 'v0.1.7', '--source-commit', 'not-a-commit'],
            ['--source-tag', 'v0.1.7', '--source-commit', 'A' * 40],
            ['--source-tag', 'v0.1.7', '--source-commit', self.baseline],
            ['--source-tag', 'v0.1.8', '--source-commit', self.candidate],
        ]
        for arguments in cases:
            with self.subTest(arguments=arguments):
                with self.assertRaises(ValueError):
                    self.validate(*arguments)
                self.assertFalse(self.output.exists())
                self.assert_source_unchanged()
        self.assertEqual(self.go_calls, [])

    def test_default_lock_tag_commit_mismatch_rejects_before_output_or_download(self):
        self.lock.write_text(json.dumps({'core': {'tag': 'v0.1.5', 'commit': self.candidate}}))
        with self.assertRaisesRegex(ValueError, 'tag.*commit'):
            self.validate()
        self.assertFalse(self.output.exists())
        self.assertEqual(self.go_calls, [])

    def test_cumulative_patch_applies_new_compatibility_files_after_baseline(self):
        report = self.validate('--source-tag', 'v0.1.7', '--source-commit', self.candidate,
                               '--compatibility-from', 'v0.1.5=./compat/v015')
        self.assertEqual(report['status'], 'verified-not-deployed')
        self.assertEqual(report['steps'][0]['name'], 'baseline')
        self.assertEqual(report['steps'][0]['exit_code'], 1)
        self.assertEqual(report['steps'][-1]['name'], 'compatibility-from-v0.1.5')
        self.assertEqual(report['steps'][-1]['exit_code'], 0)
        self.assert_source_unchanged()

    def test_invalid_patch_is_checked_before_running_baseline_tests(self):
        self.patch_file.write_text(self.patch_file.read_text().replace('-broken', '-different source'))
        with self.assertRaises(subprocess.CalledProcessError):
            self.validate()
        self.assertEqual(self.go_calls, [])
        report = json.loads((self.output / 'result.json').read_text())
        self.assertEqual(report['status'], 'failed')
        self.assertEqual((self.output / 'core/cluster/calcium/lock_test.go').read_text(),
                         'existing tests\n')
        self.assert_source_unchanged()

    def test_failed_metadata_semantics_prevents_artifact_acceptance(self):
        self.fail_package = './store/etcdv3/meta'
        with self.assertRaisesRegex(RuntimeError, 'calcium failed'):
            self.validate('--source-tag', 'v0.1.7', '--source-commit', self.candidate)
        report = json.loads((self.output / 'result.json').read_text())
        self.assertEqual(report['status'], 'failed')
        self.assertNotIn('artifact_sha256', report)
        self.assertFalse((self.output / 'eru-core').exists())
        self.assert_source_unchanged()

    def test_unrelated_baseline_failure_does_not_apply_remaining_patch(self):
        self.baseline_log = 'unrelated test failure\n'
        with self.assertRaisesRegex(ValueError, 'both expected nil-context failures'):
            self.validate()
        self.assertEqual(len(self.go_calls), 1)
        self.assertEqual((self.output / 'core/cluster/calcium/lock.go').read_text(), 'broken\n')
        self.assertFalse((self.output / 'core/compat/v015/compat_test.go').exists())
        report = json.loads((self.output / 'result.json').read_text())
        self.assertEqual(report['status'], 'failed')
        self.assert_source_unchanged()
