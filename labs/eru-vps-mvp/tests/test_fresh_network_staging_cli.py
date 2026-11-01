"""Read-only network staging CLI bindings and private output boundary."""
from contextlib import redirect_stdout, redirect_stderr
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import labctl


class NetworkStagingCLITests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.project = Path(temp.name)
        self.result = {'status': 'uncertain', 'id': 'fresh-run', 'host_index': 0,
                       'intent_sha256': 'a' * 64, 'stage_accepted': False,
                       'generation_changed': False, 'external_fence_verified': False,
                       'dispatch_attempted': False}
        self.inspect = Mock(return_value={**self.result, 'raw': 'PRIVATE-SENTINEL'})
        self.args = ['inspect-fresh-network-staging', '--run', 'fresh-run',
                     '--host-index', '0', '--sha256', 'a' * 64]

    def invoke(self, args=None):
        output = io.StringIO()
        with patch.dict(sys.modules, {'fresh_network_staging_ops':
                SimpleNamespace(inspect_network_staging=self.inspect)}), \
                patch.object(labctl, 'PROJECT', self.project), \
                patch.object(labctl, 'Operator') as operator, \
                patch.object(labctl, 'ClusterLock') as lock, \
                patch.object(sys, 'argv', ['labctl.py', *(self.args if args is None else args)]), \
                redirect_stdout(output):
            labctl.main()
            operator.assert_not_called()
            lock.assert_not_called()
        return output.getvalue()

    def test_exact_intent_binding_and_private_redaction(self):
        self.assertEqual(json.loads(self.invoke()), self.result)
        self.inspect.assert_called_once_with(self.project, 'fresh-run', 0, 'a' * 64)
        self.assertEqual(list(self.project.rglob('*')), [])

    def test_private_errors_are_redacted(self):
        for error in (ValueError, OSError, RuntimeError):
            with self.subTest(error=error):
                self.inspect.side_effect = error('PRIVATE-SENTINEL')
                with self.assertRaises(SystemExit) as caught:
                    self.invoke()
                self.assertEqual(str(caught.exception),
                                 'fresh network staging inspection rejected; check private evidence')

    def test_host_index_requires_explicit_zero_to_three(self):
        for value in ('-1', '4', 'True', 'all'):
            with self.subTest(value=value), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
                self.invoke(['inspect-fresh-network-staging', '--run', 'fresh-run',
                             '--host-index', value, '--sha256', 'a' * 64])
            self.assertEqual(caught.exception.code, 2)
        self.inspect.assert_not_called()

    def test_digest_is_mandatory_before_api(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
            self.invoke(['inspect-fresh-network-staging', '--run', 'fresh-run', '--host-index', '0'])
        self.assertEqual(caught.exception.code, 2)
        self.inspect.assert_not_called()

    def test_no_production_execute_or_reconcile_cli(self):
        for command in ('stage-fresh-network-files', 'execute-fresh-network-staging',
                        'reconcile-fresh-network-files'):
            with self.subTest(command=command), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
                self.invoke([command])
            self.assertEqual(caught.exception.code, 2)
        self.inspect.assert_not_called()
