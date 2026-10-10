"""Network mainline CLI binding, offline inspection and private output boundary."""
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


class NetworkReadyCLITests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project = Path(temporary.name)
        self.summary = {'status': 'network-ready', 'id': 'run', 'host_count': 4,
                        'stage_accepted': True, 'generation_changed': False,
                        'next_stage': 'empty-control-plane'}
        self.apis = {name: Mock(return_value={**self.summary, 'private': 'PRIVATE-SENTINEL'})
                     for name in ('prepare_network_manual_setup', 'record_network_manual_setup',
                                  'accept_network_ready', 'inspect_network_ready')}

    def invoke(self, args):
        output = io.StringIO()
        with patch.dict(sys.modules, {'fresh_network_ready_ops': SimpleNamespace(**self.apis)}), \
                patch.object(labctl, 'PROJECT', self.project), \
                patch.object(labctl, 'Operator') as operator, \
                patch.object(labctl, 'ClusterLock') as lock, \
                patch.object(sys, 'argv', ['labctl.py', *args]), redirect_stdout(output):
            labctl.main()
            operator.assert_not_called()
            lock.assert_not_called()
        return json.loads(output.getvalue())

    def test_prepare_records_exact_before_action_bindings(self):
        args = ['prepare-fresh-network-ready', '--plan', 'plan', '--sha256', 'a'*64,
                '--authorization', 'private/auth.json', '--authorization-sha256', 'b'*64,
                '--input', 'private/setup.json', '--input-sha256', 'c'*64]
        self.assertEqual(self.invoke(args), self.summary)
        self.apis['prepare_network_manual_setup'].assert_called_once_with(
            self.project, 'plan', 'a'*64, 'private/auth.json', 'b'*64,
            'private/setup.json', 'c'*64)

    def test_record_binds_receipt_and_intent_without_collecting(self):
        args = ['record-fresh-network-ready', '--run', 'run', '--intent-sha256', 'a'*64,
                '--receipt', 'private/receipt.json', '--receipt-sha256', 'b'*64]
        self.assertEqual(self.invoke(args), self.summary)
        self.apis['record_network_manual_setup'].assert_called_once_with(
            self.project, 'run', 'a'*64, 'private/receipt.json', 'b'*64)
        self.apis['accept_network_ready'].assert_not_called()

    def test_accept_uses_fixed_collector_api_without_imported_evidence(self):
        args = ['accept-fresh-network-ready', '--run', 'run', '--manual-receipt-sha256', 'a'*64]
        self.assertEqual(self.invoke(args), self.summary)
        self.apis['accept_network_ready'].assert_called_once_with(self.project, 'run', 'a'*64)

    def test_inspect_never_collects_and_rejects_missing_expected_digest(self):
        args = ['inspect-fresh-network-ready', '--run', 'run', '--receipt-sha256', 'a'*64]
        self.assertEqual(self.invoke(args), self.summary)
        self.apis['inspect_network_ready'].assert_called_once_with(self.project, 'run', 'a'*64)
        self.apis['accept_network_ready'].assert_not_called()
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
            self.invoke(args[:-2])
        self.assertEqual(caught.exception.code, 2)
        self.assertEqual(self.apis['inspect_network_ready'].call_count, 1)

    def test_rejected_private_error_is_redacted(self):
        self.apis['accept_network_ready'].side_effect = OSError('PRIVATE-SENTINEL')
        with self.assertRaises(SystemExit) as caught:
            self.invoke(['accept-fresh-network-ready', '--run', 'run',
                         '--manual-receipt-sha256', 'a'*64])
        self.assertEqual(str(caught.exception),
                         'fresh network readiness rejected; check private inputs and evidence')
