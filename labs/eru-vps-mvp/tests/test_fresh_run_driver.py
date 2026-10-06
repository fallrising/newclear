"""Production fresh run entry and immutable reservation on synthetic private roots."""
from datetime import timedelta
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import test_fresh_execution as fixture
import pending_generation
from labops import ClusterLock
import fresh_run_ops as ops


class FreshRunDriverTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.FreshExecutionTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.project, self.now = self.f.project, self.f.now
        self.source = self.f.fixture.report['source']

    def start(self):
        return ops.start_run(self.project, self.f.review['plan']['id'],
            self.f.review['sha256'], self.f.input_path, self.f.run,
            now=self.now, source_state=self.source)

    def test_start_validates_and_reserves_once_without_cluster_mutation(self):
        before = (self.project/'private/operations/cluster.json').read_bytes()
        result = self.start()
        self.assertEqual(result['status'], 'reserved')
        pending = pending_generation.inspect(self.project)
        self.assertEqual(pending['reservation']['bindings']['execution_sha256'], result['execution_sha256'])
        self.assertEqual(before, (self.project/'private/operations/cluster.json').read_bytes())
        with self.assertRaises(RuntimeError):
            with ClusterLock(self.project):
                self.fail('ordinary mutation admitted pending run')
        self.assertEqual(self.start()['status'], 'blocked')
        self.assertEqual(pending_generation.inspect(self.project), pending)

    def test_stale_or_drifted_start_never_reserves(self):
        self.source['project_clean'] = False
        self.assertEqual(self.start()['status'], 'blocked')
        self.assertFalse((self.project/'private/pending-generation').exists())

    def test_reserved_history_survives_elapsed_time_without_current_claim(self):
        start = self.start()
        status = ops.status_run(self.project, self.f.run, start['execution_sha256'],
                                now=self.now+timedelta(hours=4), source_state=self.source)
        self.assertEqual(status['status'], 'reserved')
        self.assertTrue(status['execution_integrity_verified'])
        self.assertFalse(status['journal_integrity_verified'])
        self.assertFalse(status['current_network_ready'])
        self.assertFalse(status['current_authority_verified'])
        self.assertFalse(status['generation_changed'])

    def test_wrong_execution_status_has_no_write_or_dispatch(self):
        self.start()
        before = {str(p):p.read_bytes() for p in (self.project/'private').rglob('*') if p.is_file()}
        result = ops.status_run(self.project, self.f.run, 'f'*64,
                                now=self.now, source_state=self.source)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(before,{str(p):p.read_bytes() for p in (self.project/'private').rglob('*') if p.is_file()})
