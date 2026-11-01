"""Synthetic exact replay contracts, with no host or private input access."""
import copy
from datetime import datetime, timezone
import unittest

import fresh_replay as replay
from test_app_desired import spec


class ReplayContractTests(unittest.TestCase):
    def test_fixed_steps_cover_reviewed_specs_and_every_worker(self):
        desired = [spec()]
        steps = replay.steps(desired)
        self.assertEqual([s['step'] for s in steps[:4]], ['child-plan', 'app-cache', 'app-deploy', 'app-ready'])
        for node in ('worker-2', 'worker-3', 'worker-4'):
            names = [s['step'] for s in steps if s.get('node') == node and s.get('canary')]
            for required in ('canary-cache', 'bridge-deploy', 'canary-get', 'canary-exec', 'canary-logs',
                             'canary-stop', 'canary-start', 'bridge-remove', 'host-deploy', 'host-http',
                             'host-remove', 'memory-reject', 'storage-reject', 'quota-accept'):
                self.assertIn(required, names)
        self.assertEqual(steps[-1]['step'], 'residue-accept')

    def test_unreviewed_spec_and_boolean_step_rejected(self):
        bad = spec(); bad['network'] = 'host'
        with self.assertRaises(ValueError):
            replay.steps([bad])
        with self.assertRaises(ValueError):
            replay.step_index(True, replay.steps([spec()]))
