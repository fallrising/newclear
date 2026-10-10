"""Independent local network-stage acceptance regressions; synthetic inputs only."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

import fresh_network_ready_ops as ops
import fresh_network_directory_ops as directory
import test_fresh_network_ready_ops as fixture


class NetworkReadyIndependentReview(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkReadyTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)

    def test_manual_first_then_all_current_predecessors_and_real_probe_semantics(self):
        original = copy.deepcopy(self.f.setup)
        for change in (
                lambda setup: setup['hosts'][0].update(public_ipv4='8.8.4.4'),
                lambda setup: setup.update(worker_helper_sha256='b' * 64)):
            with self.subTest(change=change):
                self.f.setup = copy.deepcopy(original)
                change(self.f.setup)
                self.f.inputsha = self.f.write(self.f.inputpath, self.f.setup)
                result = self.f.prepare()
                self.assertEqual(result['status'], 'blocked')
                self.assertFalse((self.f.project / ops.MANUAL_AREA / self.f.f.run).exists())
        self.f.setup = original
        self.f.inputsha = self.f.write(self.f.inputpath, original)
        self.f.manual()
        self.assertEqual(self.f.accept()['status'], 'blocked', 'accept must wait for predecessor receipts')
        self.assertEqual(self.f.collect_calls, 0)
        self.f.prerequisites()
        path = (self.f.project / directory.AREA / self.f.f.run /
                'host-3' / 'receipt.json')
        receipt_bytes = path.read_bytes()
        path.unlink()
        self.assertEqual(self.f.accept()['status'], 'blocked')
        self.assertEqual(self.f.collect_calls, 0)
        path.write_bytes(receipt_bytes)
        path.chmod(0o600)

        def unknown_denial(*args, **kwargs):
            evidence = self.f.collector(*args, **kwargs)
            evidence['public_denials'][0]['outcome'] = 'no-route'
            return evidence

        self.assertEqual(self.f.accept(unknown_denial)['status'], 'blocked')
        self.assertEqual(self.f.collect_calls, 1)
        self.assertFalse((self.f.project / ops.AREA / self.f.f.run / 'receipt.json').exists())
        result = self.f.accept()
        self.assertEqual(result['status'], 'network-ready')
        self.assertEqual(result['next_stage'], 'empty-control-plane')
        self.assertEqual(self.f.inspect(result)['status'], 'network-ready')
        raw = (self.f.project / self.f.inputpath)
        raw.write_bytes(raw.read_bytes() + b' ')
        self.assertEqual(self.f.inspect(result)['status'], 'blocked')
        self.assertEqual(self.f.collect_calls, 2)


if __name__ == '__main__':
    unittest.main()
