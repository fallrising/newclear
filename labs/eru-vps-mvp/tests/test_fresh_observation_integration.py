"""Preparation boundary for independently validated observation-backed evidence."""
import copy
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import Mock, patch

import test_fresh_execution as fixtures


class ObservationPreparationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.FreshExecutionTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.f = self.fixture
        self.baseline = {'schema_version': 1, 'kind': 'host_baseline',
                         'binding': self.f.binding, **self.f.evidence['host_baseline']}
        self.loader = Mock(return_value=copy.deepcopy(self.baseline))
        self.module = SimpleNamespace(load_observation=self.loader)
        self.ref = {'path': 'private/operations/fresh-rebuild/observations/obs/observation.json',
                    'sha256': 'a' * 64}
        self.f.evidence['host_baseline'].update(schema_version=2, observation=self.ref)
        self.f.write_evidence()

    def test_v2_rederives_baseline_and_keeps_original_refs(self):
        with patch.dict(sys.modules, {'fresh_observation_ops': self.module}):
            envelope, _ = self.f.prepare()
            self.assertEqual(self.f.inspect(envelope['sha256'])['status'], 'prepared')
        self.assertEqual(self.loader.call_count, 2)
        self.assertEqual(self.loader.call_args.args[1], self.ref)
        self.assertEqual(envelope['execution']['evidence']['host_baseline'],
                         self.f.document['host_baseline'])
        self.assertFalse(envelope['execution']['executable'])

    def test_rehashed_declared_host_cannot_override_observation(self):
        self.f.evidence['host_baseline']['hosts'][0]['boot_id_sha256'] = 'f' * 64
        self.f.write_evidence()
        with patch.dict(sys.modules, {'fresh_observation_ops': self.module}), \
                self.assertRaises(ValueError):
            self.f.prepare()
        self.loader.assert_called_once()

    def test_observation_failure_and_extra_fields_are_rejected(self):
        self.loader.side_effect = ValueError('observation invalid')
        with patch.dict(sys.modules, {'fresh_observation_ops': self.module}), \
                self.assertRaises(ValueError):
            self.f.prepare()
        self.loader.side_effect = None
        self.f.evidence['host_baseline']['unknown'] = True
        self.f.write_evidence()
        with patch.dict(sys.modules, {'fresh_observation_ops': self.module}), \
                self.assertRaises(ValueError):
            self.f.prepare()

    def test_v1_does_not_load_observation(self):
        self.f.evidence['host_baseline'].pop('observation')
        self.f.evidence['host_baseline'].pop('schema_version')
        self.f.write_evidence()
        with patch.dict(sys.modules, {'fresh_observation_ops': self.module}):
            self.f.prepare()
        self.loader.assert_not_called()
