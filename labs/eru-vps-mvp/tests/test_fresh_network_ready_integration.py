"""Full network mainline through actual coordinator and copied-source probe bundles."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import pending_generation
from fresh_network_probe import collect_network_evidence
import test_fresh_network_ready_ops as ready_fixture
from test_fresh_network_probe_ssh import SyntheticProbe


class NetworkMainlineIntegration(unittest.TestCase):
    def test_dual_stack_key_authentication_to_immutable_network_receipt(self):
        flow = ready_fixture.NetworkReadyTests()
        flow.setUp()
        self.addCleanup(flow.doCleanups)
        probe = SyntheticProbe(render=flow.render, setup=flow.setup, dual_stack=True)
        self.addCleanup(probe.close)
        flow.setup = copy.deepcopy(probe.setup)
        flow.inputsha = flow.write(flow.inputpath, flow.setup)
        flow.auth['setup_sha256'] = flow.inputsha
        flow.authsha = flow.write(flow.authpath, flow.auth)
        flow.manual()
        self.assertEqual(flow.accept(lambda *a, **kw: self.fail("premature probe"))["status"], "blocked")
        flow.prerequisites()
        before = pending_generation.inspect(flow.project)
        def collector(render, keys, *, setup, now):
            return collect_network_evidence(render, keys, setup=setup, now=now,
                transport=probe.transport, runner=probe.runner)
        # A successful command with no effective publickey method cannot advance.
        probe.auth_method = 'none'
        self.assertEqual(flow.accept(collector)['status'], 'blocked')
        probe.auth_method = 'publickey'
        result = flow.accept(collector)
        self.assertEqual(result['status'], 'network-ready')
        self.assertTrue(result['stage_accepted'])
        self.assertEqual(result['next_stage'], 'empty-control-plane')
        self.assertEqual(pending_generation.inspect(flow.project), before)
        calls = len(probe.calls)
        self.assertEqual(flow.inspect(result)['receipt_sha256'], result['receipt_sha256'])
        self.assertEqual(flow.accept(collector)['receipt_sha256'], result['receipt_sha256'])
        self.assertEqual(len(probe.calls), calls)
        self.assertFalse(result['generation_changed'])
        self.assertFalse(result['remote_mutation_performed'])
