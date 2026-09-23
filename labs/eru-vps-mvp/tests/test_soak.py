import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from soak import assessment
from soak_remote import dispatch
from soak_runner import Summary, observe


class Clock:
    def __init__(self):
        self.now = 1000.
    def time(self):
        return self.now
    def sleep(self, duration):
        self.now += duration


def config():
    return {'run_id': '20260923T000000Z-1234abcd', 'role': 'http', 'interval': 1,
            'start_epoch': 1000, 'deadline_epoch': 1003}


def control(count=10):
    services = '\n'.join('Id=' + name + '\nActiveState=active\nSubState=running\nInvocationID=old\n'
                         for name in ('core', 'etcd', 'docker', 'containerd'))
    metrics = '\n'.join(name + '_bucket{le="' + bucket + '"} ' + str(count)
                        for name in ('etcd_disk_wal_fsync_duration_seconds', 'etcd_disk_backend_commit_duration_seconds')
                        for bucket in ('.008', '+Inf'))
    return {'metrics': metrics, 'commands': {name: {'exit_code': 0, 'stdout':
        services if name == 'services' else '{}' if name == 'alarms' else ''}
        for name in ('health', 'status', 'alarms', 'services', 'journal', 'storage', 'space')}}


class SoakTests(unittest.TestCase):
    def run_observer(self, directory, cfg=None, probe=None, clock=None):
        clock = clock or Clock()
        with patch('soak_runner.time.time', clock.time), patch('soak_runner.time.monotonic', clock.time), \
                patch('soak_runner.time.sleep', clock.sleep):
            return observe(directory, cfg or config(), probe or (lambda: {'ok': True}))

    def test_deadline_sample_and_private_retained_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = self.run_observer(tmp)
            rows = [json.loads(line) for line in (Path(tmp) / 'samples.jsonl').read_text().splitlines()]
            self.assertEqual(result['state'], 'complete')
            self.assertEqual(result['assessment'], 'pending_review')
            self.assertEqual([r['time'] for r in rows], [1000, 1001, 1002, 1003])
            self.assertEqual((Path(tmp) / 'samples.jsonl').stat().st_mode & 0o777, 0o600)

    def test_interruption_preserves_evidence_and_replay_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            def fail():
                raise InterruptedError('stop requested')
            with self.assertRaises(InterruptedError):
                self.run_observer(tmp, probe=fail)
            status = (Path(tmp) / 'status.json').read_text()
            self.assertEqual(json.loads(status)['state'], 'interrupted')
            with self.assertRaises(FileExistsError):
                self.run_observer(tmp)
            self.assertEqual((Path(tmp) / 'status.json').read_text(), status)

    def test_missed_start_cannot_be_claimed_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = config(); cfg.update(start_epoch=990, deadline_epoch=1100)
            with self.assertRaisesRegex(RuntimeError, 'missed scheduled'):
                self.run_observer(tmp, cfg)
            self.assertEqual(json.loads((Path(tmp) / 'status.json').read_text())['samples'], 0)

    def test_failed_http_kept_after_later_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            samples = iter([False, True, True, True])
            result = self.run_observer(tmp, probe=lambda: {'ok': next(samples)})
            self.assertEqual(result['state'], 'complete_with_failures')
            self.assertEqual(result['summary']['failures']['http_failed'], 1)

    def test_observation_gap_survives_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            clock = Clock(); cfg = config(); cfg['deadline_epoch'] = 1020
            def slow():
                if clock.now == 1000:
                    clock.sleep(7)
                return {'ok': True}
            result = self.run_observer(tmp, cfg, slow, clock)
            self.assertEqual(result['state'], 'complete_with_failures')
            self.assertEqual(result['summary']['failures']['observation_gap'], 1)

    def test_byte_limit_fails_without_truncating_old_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = config(); cfg['max_bytes'] = 160
            with self.assertRaisesRegex(RuntimeError, 'byte budget'):
                self.run_observer(tmp, cfg)
            rows = (Path(tmp) / 'samples.jsonl').read_text().splitlines()
            self.assertGreater(len(rows), 0)
            for row in rows:
                json.loads(row)
            self.assertLessEqual((Path(tmp) / 'samples.jsonl').stat().st_size, 160)
            self.assertEqual(json.loads((Path(tmp) / 'status.json').read_text())['state'], 'failed')

    def test_control_errors_and_restarts_not_hidden(self):
        s = Summary('control'); s.add(control())
        changed = control(15)
        changed['commands']['health']['exit_code'] = 1
        changed['commands']['services']['stdout'] = changed['commands']['services']['stdout'].replace('old', 'new')
        changed['commands']['journal']['stdout'] = 'slow fdatasync\nrequest timed out\npanic:'
        s.add(changed); s.add(control(20))
        self.assertEqual(s.failures['health_failed'], 1)
        self.assertEqual(s.failures['service_state_or_invocation_changed'], 1)
        self.assertEqual(s.warnings['slow_fdatasync'], 1)
        self.assertEqual(s.failures['panic'], 1)
        self.assertTrue(s.report()['histogram_deltas'])

    def test_histogram_midrun_reset_detected_even_if_later_exceeds_baseline(self):
        s = Summary('control')
        for count in (100, 150, 5, 300):
            s.add(control(count))
        self.assertEqual(s.failures['etcd_disk_wal_fsync_duration_seconds_reset_or_changed'], 1)

    def test_status_distinguishes_reboot_stale_and_missing_coverage(self):
        r = {'status': {'state': 'running', 'boot_id': 'a', 'start_epoch': 1000,
             'last_sample_epoch': 1000}, 'current_boot_id': 'b', 'systemd': {'SubState': 'running'},
             'observed_at_epoch': 1010}
        self.assertEqual(assessment(r, 15), 'interrupted_by_reboot')
        r['current_boot_id'] = 'a'; r['observed_at_epoch'] = 1200
        self.assertEqual(assessment(r, 15), 'stale_observer')
        r['status'].update(state='complete', deadline_epoch=2000, samples=100)
        self.assertEqual(assessment(r, 15), 'incomplete_coverage')
        r['status'].update(last_sample_epoch=2000, elapsed_seconds=1000)
        self.assertEqual(assessment(r, 15), 'complete_needs_review')

    def test_remote_rejects_path_escape_and_unbounded_request_before_writes(self):
        with self.assertRaisesRegex(ValueError, 'run ID'):
            dispatch({'run_id': '../eru-core', 'action': 'stop'})
        cfg = config(); cfg.update(deadline_epoch=999999, max_bytes=192 * 1024 * 1024)
        with self.assertRaisesRegex(ValueError, 'bounded'):
            dispatch({'run_id': cfg['run_id'], 'action': 'start', 'config': cfg})


if __name__ == '__main__':
    unittest.main()
