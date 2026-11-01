"""Root regression for pending drift after the final evidence read."""
import unittest
from unittest.mock import patch

import test_fresh_network_staging as fixture
import fresh_network_staging_ops as ops
import pending_generation


class StagingFinalReadReview(unittest.TestCase):
    def setUp(self):
        self.f = fixture.NetworkStagingTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)

    def test_pending_drift_after_last_raw_recheck_prevents_dispatch(self):
        plans, changed = [], []
        plan, recheck = ops._Session.plan, ops.PrivateFiles.recheck
        def counted(session, *args):
            value = plan(session, *args)
            plans.append(True)
            return value
        def drifting(files):
            recheck(files)
            if len(plans) == 3 and not changed:
                changed.append(True)
                path = self.f.project / 'private' / pending_generation.PENDING_DIRECTORY / 'foreign-entry'
                path.write_text('synthetic pending drift')
                path.chmod(0o600)
        with patch.object(ops._Session, 'plan', counted), \
                patch.object(ops.PrivateFiles, 'recheck', drifting):
            result = self.f.stage()
        self.assertTrue(changed)
        self.assertEqual(result['status'], 'blocked')
        self.assertFalse(result['dispatch_attempted'])
        self.assertEqual([entry for entry in self.f.adapter.calls if entry[0] == 'stage'], [])
