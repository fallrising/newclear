"""Read-only four-host receipt CLI dispatch and public-output boundary."""
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


class FreshReceiptCLITests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.project = Path(temp.name)
        self.summary = {'status': 'receipts-reviewed', 'id': 'fresh-run',
                        'sha256': 'a' * 64, 'host_count': 4, 'stage_accepted': False,
                        'executable': False, 'remote_mutation_performed': False,
                        'generation_changed': False}
        self.inspect = Mock(return_value={**self.summary, 'raw': 'PRIVATE-SENTINEL'})
        self.args = ['inspect-fresh-reimage-receipts', '--run', 'fresh-run',
                     '--sha256', 'b' * 64, '--input', 'private/receipt-request.json']

    def invoke(self, args=None):
        output = io.StringIO()
        with patch.dict(sys.modules, {'fresh_reimage_receipt_ops':
                SimpleNamespace(inspect_receipts=self.inspect)}), \
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
        self.inspect.assert_called_once_with(self.project, 'fresh-run', 'b' * 64,
                                             'private/receipt-request.json')
        self.assertEqual(before, sorted(str(p) for p in self.project.rglob('*')))

    def test_private_errors_are_redacted(self):
        for error in (ValueError, OSError, RuntimeError, subprocess.SubprocessError):
            with self.subTest(error=error):
                self.inspect.side_effect = error('PRIVATE-SENTINEL')
                with self.assertRaises(SystemExit) as caught:
                    self.invoke()
                self.assertEqual(str(caught.exception),
                                 'fresh receipt inspection rejected; check private evidence')

    def test_missing_digest_is_rejected_before_api(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
            self.invoke(['inspect-fresh-reimage-receipts', '--run', 'fresh-run',
                         '--input', 'private/receipt-request.json'])
        self.assertEqual(caught.exception.code, 2)
        self.inspect.assert_not_called()
