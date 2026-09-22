import copy
import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from control_health import histogram, summarize


def sample(time, count, upper='.008'):
    metrics = ''
    for name in ['etcd_disk_wal_fsync_duration_seconds', 'etcd_disk_backend_commit_duration_seconds']:
        metrics += f'{name}_bucket{{le="{upper}"}} {count}\n{name}_bucket{{le="+Inf"}} {count}\n'
    return {'time': time, 'metrics': metrics, 'commands': {
        k: {'exit_code': 0, 'stdout': '{}' if k == 'alarms' else ''}
        for k in ['health', 'status', 'alarms', 'services', 'journal']}}


class HealthTests(unittest.TestCase):
    def test_multiline_metrics_and_window_delta(self):
        report = summarize([sample(0, 100), sample(600, 220)])
        self.assertEqual(report['findings'], [])
        self.assertEqual(report['histogram_deltas']['etcd_disk_wal_fsync_duration_seconds']['observations'], 120)

    def test_no_observations_is_not_a_healthy_disk_verdict(self):
        self.assertTrue(summarize([sample(0, 100), sample(600, 100)])['findings'])

    def test_counter_reset_is_rejected(self):
        self.assertIn('counter reset', ' '.join(summarize([sample(0, 100), sample(600, 10)])['findings']))

    def test_latency_threshold_is_not_hidden_by_health_success(self):
        result = summarize([sample(0, 100, '.032'), sample(600, 220, '.032')])
        self.assertEqual(result['health_failures'], 0)
        self.assertIn('threshold', ' '.join(result['findings']))

    def test_timeout_restart_alarm_and_slow_journal_are_retained(self):
        a, b = sample(0, 100), sample(600, 220)
        b['commands']['health']['exit_code'] = 1
        b['commands']['services']['stdout'] = 'new invocation'
        b['commands']['alarms']['stdout'] = '{"alarms":[{}]}'
        b['commands']['journal']['stdout'] = 'slow fdatasync'
        result = summarize([a, b])
        self.assertEqual(result['health_failures'], 1)
        self.assertEqual(len(result['findings']), 4)
