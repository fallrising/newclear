"""Current bootstrap authority can read immutable network history safely."""
from datetime import timedelta
from types import SimpleNamespace
import unittest

import test_fresh_network_ready_ops as fixture
from test_fresh_run_authority_integration import renewal
import fresh_run_authority as authority


class BootstrapAuthorityTests(unittest.TestCase):
    def test_current_bootstrap_can_inspect_own_history_and_restores_scope(self):
        f = fixture.NetworkReadyTests()
        f.setUp()
        self.addCleanup(f.doCleanups)
        f.manual()
        f.prerequisites()
        accepted = f.accept()
        self.assertEqual(accepted['status'], 'network-ready')
        helper = SimpleNamespace(project=f.project, source=f.source, now=f.now+timedelta(hours=1),
            f=f.f.f, plan=f.f.plan, run=f.f.run, auth=f.f.auth)
        target = {'plan_id': f.f.plan['id'], 'plan_sha': f.f.plan['sha256'],
                  'network_receipt_sha': accepted['receipt_sha256'],
                  'input_file': 'private/bootstrap.json', 'input_sha': 'a'*64}

        @authority.operation
        def prepare_bootstrap(project, plan_id, plan_sha, network_receipt_sha,
                              input_file, input_sha, *, now=None, source_state=None):
            owner = authority.active()
            result = authority.inspect_history(project, helper.run,
                f.f.plan['execution_sha256'], network_receipt_sha,
                now=helper.now, source_state=f.source)
            with self.assertRaises(ValueError):
                authority.inspect_history(project, helper.run, 'f'*64, network_receipt_sha,
                    now=helper.now, source_state=f.source)
            self.assertIs(authority.active(), owner)
            self.assertTrue(owner.entered)
            self.assertTrue(owner.used)
            return result

        with renewal(helper, 'prepare_bootstrap', target, at=helper.now):
            current = authority.active()
            result = prepare_bootstrap(f.project, **target, now=helper.now, source_state=f.source)
            self.assertTrue(result['historical_integrity'])
            self.assertFalse(result['current_network_ready'])
            self.assertIs(authority.active(), current)
            with self.assertRaises(ValueError):
                prepare_bootstrap(f.project, **target, now=helper.now, source_state=f.source)
        self.assertIsNone(authority.active())
