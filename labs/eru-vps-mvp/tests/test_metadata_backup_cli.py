"""Exercise public labctl dispatch without inventory, Operator or network."""
import ast
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_metadata_backup as fixtures
import labctl
import metadata_backup as mb


class MetadataCLITests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.MetadataTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.project = self.fixture.project
        self.common = ['--manifest', 'private/backup/manifest.json',
            '--sha256', self.fixture.manifest_sha, '--cluster', 'cluster', '--generation', '1']

    def run_public(self, args):
        # Separate Python process invokes the public main with a synthetic project.
        source = ('import sys; from pathlib import Path; import labctl; '
            'labctl.PROJECT=Path(sys.argv[1]); sys.argv=["labctl",*sys.argv[2:]]; '
            'labctl.main()')
        return subprocess.run([sys.executable, '-c', source, str(self.project),
            'metadata-backup', *args], cwd=fixtures.SCRIPTS,
            capture_output=True, text=True, timeout=10)

    def test_public_verify_and_plan(self):
        result = self.run_public(['verify', *self.common])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'integrity-verified')
        self.assertEqual(result.stderr, '')
        result = self.run_public(['plan-restore', *self.common,
            '--request', 'private/backup/restore.json',
            '--request-sha256', self.fixture.request_sha, '--plan-id', 'public'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'review-only')
        for secret in ['cluster', 'review-token', 'example.invalid', 'private/', 'public']:
            self.assertNotIn(secret, result.stdout)
        self.assertFalse((self.project/'private/operations').exists())

    def test_help_needs_no_private_or_lock(self):
        with patch.object(labctl, 'PROJECT', Path('/missing/project')), \
             patch.object(labctl, 'Operator', side_effect=AssertionError('Operator')), \
             patch.object(mb, 'PrivateFiles', side_effect=AssertionError('private read')):
            for args in [[], ['verify'], ['plan-restore']]:
                with patch.object(sys, 'argv', ['labctl','metadata-backup', *args, '--help']), \
                     contextlib.redirect_stdout(io.StringIO()) as output:
                    with self.assertRaises(SystemExit) as exc:
                        labctl.main()
                    self.assertEqual(exc.exception.code, 0)
                    self.assertIn('usage:', output.getvalue())

    def test_parse_and_runtime_failures_have_fixed_redacted_json(self):
        sentinel = 'PRIVATE_SENTINEL_path-token'
        cases = [[], [sentinel], ['verify', '--unknown', sentinel],
                 ['verify', *self.common, '--generation', sentinel],
                 ['verify', *self.common, '--manifest', sentinel],
                 ['plan-restore', *self.common],
                 ['verify', *self.common, '--generation'],
                 ['execute', sentinel]]
        expected = {'status': 'rejected', 'error': 'metadata-backup-rejected',
                    'execution_allowed': False}
        for args in cases:
            with self.subTest(args=args):
                result = self.run_public(args)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(json.loads(result.stdout), expected)
                self.assertEqual(result.stderr, '')
                self.assertNotIn(sentinel, result.stdout)
                self.assertNotIn('Traceback', result.stdout)

    def test_no_operator_initialization_and_no_external_calls(self):
        with patch.object(labctl, 'PROJECT', self.project), \
             patch.object(labctl, 'Operator', side_effect=AssertionError('Operator')), \
             patch('subprocess.run', side_effect=AssertionError('external call')), \
             patch.object(sys, 'argv', ['labctl','metadata-backup','verify', *self.common]), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(SystemExit) as exc:
                labctl.main()
            self.assertEqual(exc.exception.code, 0)
            self.assertEqual(json.loads(output.getvalue())['status'], 'integrity-verified')
        tree = ast.parse(Path(mb.__file__).read_text())
        imported = {node.names[0].name.split('.')[0] for node in ast.walk(tree)
                    if isinstance(node, ast.Import)}
        self.assertFalse(imported & {'subprocess','socket','urllib','requests'})


if __name__ == '__main__':
    unittest.main()
