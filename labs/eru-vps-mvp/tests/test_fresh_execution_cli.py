"""CLI contracts for local fresh execution preparation and safe observation."""
from contextlib import redirect_stdout, redirect_stderr
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import labctl


class FreshExecutionCLITests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project = Path(temporary.name)
        previous = os.umask(0o077)
        self.addCleanup(os.umask, previous)
        self.summary = {
            'status': 'prepared', 'id': 'run-one', 'sha256': 'b' * 64,
            'host_count': 4, 'generation_before': 7, 'target_generation': 8,
            'executable': False, 'remote_mutation_performed': False,
            'generation_changed': False,
        }
        self.api = SimpleNamespace(
            prepare_execution=Mock(return_value=({'private': 'PRIVATE-SENTINEL'}, Path('private/example.json'))),
            inspect_execution=Mock(return_value={**self.summary, 'raw_evidence': 'PRIVATE-SENTINEL'}),
            public_summary=Mock(return_value={**self.summary, 'raw_evidence': 'PRIVATE-SENTINEL'}),
        )

    def invoke(self, arguments):
        output = io.StringIO()
        with patch.dict(sys.modules, {'fresh_execution_ops': self.api}), \
                patch.object(labctl, 'PROJECT', self.project), \
                patch.object(labctl, 'Operator') as operator, \
                patch.object(sys, 'argv', ['labctl.py', *arguments]), \
                redirect_stdout(output):
            labctl.main()
            operator.assert_not_called()
        return output.getvalue()

    def test_prepare_routes_exact_bindings_and_prints_only_public_summary(self):
        out = self.invoke(['prepare-fresh-execution', '--plan', 'review-one',
                           '--sha256', 'a' * 64, '--input', 'private/request.json',
                           '--run-id', 'run-one'])
        self.api.prepare_execution.assert_called_once_with(
            self.project, 'review-one', 'a' * 64, 'private/request.json', 'run-one')
        self.assertEqual(json.loads(out), self.summary)
        self.assertNotIn('PRIVATE-SENTINEL', out)
        self.api.inspect_execution.assert_not_called()

    def test_inspection_remains_available_with_pending_and_redacts_details(self):
        pending = self.project / 'private/pending-generation'
        pending.mkdir(parents=True)
        before = sorted(str(p.relative_to(self.project)) for p in self.project.rglob('*'))
        out = self.invoke(['inspect-fresh-execution', '--run', 'run-one', '--sha256', 'b' * 64])
        self.api.inspect_execution.assert_called_once_with(self.project, 'run-one', 'b' * 64)
        self.assertEqual(json.loads(out), self.summary)
        self.assertEqual(before, sorted(str(p.relative_to(self.project)) for p in self.project.rglob('*')))
        self.assertNotIn('PRIVATE-SENTINEL', out)
        self.api.prepare_execution.assert_not_called()

    def test_rejected_private_inputs_do_not_escape_in_error_output(self):
        for exception in (ValueError, OSError, RuntimeError, subprocess.SubprocessError):
            with self.subTest(exception=exception):
                self.api.prepare_execution.side_effect = exception('PRIVATE-SENTINEL')
                output = io.StringIO()
                with redirect_stderr(output), self.assertRaises(SystemExit) as caught:
                    self.invoke(['prepare-fresh-execution', '--plan', 'review-one',
                                 '--sha256', 'a' * 64, '--input', 'private/request.json',
                                 '--run-id', 'run-one'])
                self.assertEqual(str(caught.exception), 'fresh execution request rejected; check private inputs and evidence')
                self.assertNotIn('PRIVATE-SENTINEL', output.getvalue())

    def test_collect_routes_exact_bindings_and_redacts_private_refs(self):
        collect = Mock(return_value=({**self.summary, 'raw': 'PRIVATE-SENTINEL'},
                                    {'private': 'PRIVATE-SENTINEL'}))
        with patch.dict(sys.modules, {'fresh_observation_ops': SimpleNamespace(
                collect_observation=collect)}):
            out = self.invoke(['collect-fresh-baseline', '--plan', 'review-one',
                               '--sha256', 'a' * 64, '--run-id', 'run-one',
                               '--observation-id', 'observation-one'])
        collect.assert_called_once_with(self.project, 'review-one', 'a' * 64,
                                        'run-one', 'observation-one')
        self.assertEqual(json.loads(out), self.summary)
        self.assertNotIn('PRIVATE-SENTINEL', out)

    def test_collect_failure_redacts_transport_error(self):
        collect = Mock(side_effect=OSError('PRIVATE-SENTINEL'))
        with patch.dict(sys.modules, {'fresh_observation_ops': SimpleNamespace(
                collect_observation=collect)}), self.assertRaises(SystemExit) as caught:
            self.invoke(['collect-fresh-baseline', '--plan', 'review-one',
                         '--sha256', 'a' * 64, '--run-id', 'run-one',
                         '--observation-id', 'observation-one'])
        self.assertEqual(str(caught.exception),
                         'fresh observation rejected; check private inputs and evidence')

    def test_inspection_requires_explicit_expected_digest(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
            self.invoke(['inspect-fresh-execution', '--run', 'run-one'])
        self.assertEqual(caught.exception.code, 2)
        self.api.inspect_execution.assert_not_called()
