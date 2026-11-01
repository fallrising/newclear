"""Replacement facts CLI binding and public-output boundary."""
from contextlib import redirect_stdout, redirect_stderr
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import labctl


class FreshReplacementCLITests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.project = Path(temp.name)
        self.summary = {'status': 'observed', 'id': 'fresh-run',
                        'sha256': 'a' * 64, 'host_count': 4, 'stage_accepted': False,
                        'executable': False, 'remote_mutation_performed': False,
                        'generation_changed': False}
        self.inspect = Mock(return_value={**self.summary, 'raw': 'PRIVATE-SENTINEL'})
        self.collect = Mock(return_value={**self.summary, 'raw': 'PRIVATE-SENTINEL'})
        self.args = ['inspect-fresh-replacement-facts', '--observation', 'fresh-run',
                     '--sha256', 'b' * 64]

    def invoke(self, args=None):
        output = io.StringIO()
        with patch.dict(sys.modules, {'fresh_replacement_ops':
                SimpleNamespace(inspect_replacement_facts=self.inspect,
                                collect_replacement_facts=self.collect)}), \
                patch.object(labctl, 'PROJECT', self.project), \
                patch.object(labctl, 'Operator') as operator, \
                patch.object(labctl, 'ClusterLock') as lock, \
                patch.object(sys, 'argv', ['labctl.py', *(self.args if args is None else args)]), \
                redirect_stdout(output):
            labctl.main()
            operator.assert_not_called()
            lock.assert_not_called()
        return output.getvalue()

    def test_exact_binding_and_sanitized_readonly_summary(self):
        pending = self.project / 'private/pending-generation'
        pending.mkdir(parents=True)
        before = sorted(str(p) for p in self.project.rglob('*'))
        self.assertEqual(json.loads(self.invoke()), self.summary)
        self.inspect.assert_called_once_with(self.project, 'fresh-run', 'b' * 64)
        self.assertEqual(before, sorted(str(p) for p in self.project.rglob('*')))

    def test_private_errors_are_redacted(self):
        for error in (ValueError, OSError, RuntimeError, subprocess.SubprocessError):
            with self.subTest(error=error):
                self.inspect.side_effect = error('PRIVATE-SENTINEL')
                with self.assertRaises(SystemExit) as caught:
                    self.invoke()
                self.assertEqual(str(caught.exception),
                                 'fresh replacement observation rejected; check private inputs and evidence')

    def test_missing_digest_is_rejected_before_api(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
            self.invoke(['inspect-fresh-replacement-facts', '--observation', 'fresh-run'])
        self.assertEqual(caught.exception.code, 2)
        self.inspect.assert_not_called()

    def test_collect_binds_both_digests_and_redacts(self):
        args = ['collect-fresh-replacement-facts', '--run', 'exec-run',
                '--sha256', 'a' * 64, '--input', 'private/facts.json',
                '--input-sha256', 'b' * 64, '--observation-id', 'new-facts']
        self.assertEqual(json.loads(self.invoke(args)), self.summary)
        self.collect.assert_called_once_with(self.project, 'exec-run', 'a' * 64,
                                             'private/facts.json', 'b' * 64, 'new-facts')
        self.inspect.assert_not_called()
        self.collect.side_effect = OSError('PRIVATE-SENTINEL')
        with self.assertRaises(SystemExit) as caught:
            self.invoke(args)
        self.assertEqual(str(caught.exception),
                         'fresh replacement observation rejected; check private inputs and evidence')

    def test_collect_requires_explicit_input_digest(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
            self.invoke(['collect-fresh-replacement-facts', '--run', 'exec-run',
                         '--sha256', 'a' * 64, '--input', 'private/facts.json',
                         '--observation-id', 'new-facts'])
        self.assertEqual(caught.exception.code, 2)
        self.collect.assert_not_called()
