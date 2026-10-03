"""Formal V11 evidence: per-second slots, 99% threshold and host failure gates."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from labops import atomic_json
from soak_evidence import HOSTS
from soak_remote import config_hash
from soak_report import report
from soak_runner import RateSampler, Summary, disk_uses, observe
from test_soak import control
from test_soak_evidence import fixture

SPACE = 'Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/vda1 100 30 70 30% /\n'


def row(slot, ok=True):
    return {'slot': slot, 'at': 1000.01 + slot, 'late_seconds': .01,
            'skipped': False, 'seconds': .05, 'ok': ok,
            'http_status': 200 if ok else 503}


def http_sample(requests):
    commands = {'services': control()['commands']['services'],
        'tasks': {'exit_code': 0, 'stdout': 'canary\n'},
        'space': {'exit_code': 0, 'stdout': SPACE},
        'kernel_journal': {'exit_code': 0, 'stdout': ''}}
    return {'commands': commands, 'workload_id': 'canary', 'ok': True,
            'http_status': 200, 'http_requests': requests}


def v11_fixture(directory, mutation=None):
    manifest, record = fixture(directory)
    manifest['acceptance'] = 'v11'
    for alias in HOSTS:
        cfg = manifest['hosts'][alias]['config']
        cfg['acceptance'] = 'v11'
        manifest['hosts'][alias]['config_sha256'] = config_hash(cfg)
        path = directory / (alias + '.samples.jsonl')
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        for sample in rows:
            sample['commands']['space'] = {'exit_code': 0, 'stdout': SPACE}
            sample['commands']['kernel_journal'] = {'exit_code': 0, 'stdout': ''}
        if alias != HOSTS[0]:
            for sample in rows: sample['http_requests'] = []
            rows[1]['http_requests'] = [row(n) for n in range(15)]
            rows[2]['http_requests'] = [row(n) for n in range(15, 30)]
            if mutation and alias == HOSTS[1]: mutation(rows)
        summary = Summary(cfg['role'], 30 if alias != HOSTS[0] else None, True)
        for sample in rows: summary.add(sample)
        summary.finish()
        data = ''.join(json.dumps(sample) + '\n' for sample in rows).encode()
        path.write_bytes(data)
        snapshot = record['hosts'][alias]['snapshot']
        snapshot['status'].update(config_sha256=config_hash(cfg), bytes=len(data), summary=summary.report())
        snapshot['evidence'] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    atomic_json(directory / 'manifest.json', manifest)
    atomic_json(directory / 'collection.json', record)


class V11Tests(unittest.TestCase):
    def test_bounded_sampler_and_observer_cover_each_second_independently(self):
        with tempfile.TemporaryDirectory() as tmp:
            begin = int(time.time()) + 2
            cfg = {'run_id': '20260923T000000Z-1234abcd', 'role': 'http',
                'interval': 5, 'start_epoch': begin, 'deadline_epoch': begin + 3,
                'acceptance': 'v11', 'url': 'http://private.invalid/', 'workload': {'id': 'canary'}}
            real_sampler = RateSampler
            with patch('soak_runner.RateSampler', side_effect=lambda url, start, duration:
                       real_sampler(url, start, duration,
                                    request=lambda _: {'ok': True, 'http_status': 200})):
                result = observe(tmp, cfg, probe=lambda: http_sample([]))
            rows = [json.loads(line) for line in (Path(tmp) / 'samples.jsonl').read_text().splitlines()]
            self.assertEqual(result['state'], 'complete')
            self.assertEqual(result['summary']['http_rate']['successful'], 3)
            self.assertEqual([r['slot'] for sample in rows for r in sample['http_requests']], [0, 1, 2])
            self.assertGreaterEqual(rows[-1]['time'], begin + 3)

    def test_scheduler_delay_records_missed_second_and_no_false_success(self):
        calls = []
        def slow(_):
            calls.append(time.monotonic())
            if len(calls) == 1: time.sleep(2.2)
            return {'ok': True, 'http_status': 200}
        sampler = RateSampler('http://private.invalid/', time.time() + 1, 3, slow)
        sampler.start(); sampler.thread.join(timeout=5); sampler.close(normal=True)
        rows = sampler.drain()
        self.assertEqual([r['slot'] for r in rows], [0, 1, 2])
        self.assertFalse(rows[0]['ok'])
        self.assertTrue(rows[1]['skipped'])
        self.assertEqual(len(calls), 2)

    def test_99_percent_accepts_one_failed_slot_and_rejects_two(self):
        for bad in (1, 2):
            summary = Summary('http', 100, True)
            sample = http_sample([row(n, n >= bad) for n in range(100)])
            summary.add(sample); summary.finish()
            with self.subTest(failed=bad):
                self.assertEqual(summary.report()['http_rate']['successful'], 100 - bad)
                self.assertEqual('http_rate_below_99_percent' in summary.failures, bad == 2)

    def test_offline_report_finds_missing_slot_even_with_matching_hashes_and_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            v11_fixture(root, lambda rows: rows[1]['http_requests'].pop(5))
            result = report(root)
            self.assertEqual(result['hosts'][HOSTS[1]]['assessment'], 'observed_failures')
            self.assertIn('http_rate_sequence', result['hosts'][HOSTS[1]]['summary']['failures'])
            self.assertEqual(result['hosts'][HOSTS[1]]['integrity_errors'], {})

    def test_short_pilot_is_not_formal_v11_and_full_synthetic_rate_is_visible(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); v11_fixture(root)
            result = report(root)
            self.assertEqual(result['assessment'], 'incomplete')
            self.assertFalse(result['formal_v11_duration'])
            self.assertEqual(result['hosts'][HOSTS[1]]['summary']['http_rate']['successful'], 30)

    def test_interrupted_v11_observer_retains_interrupted_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            begin = int(time.time()) + 1
            cfg = {'run_id': '20260923T000000Z-1234abcd', 'role': 'http',
                'interval': 5, 'start_epoch': begin, 'deadline_epoch': begin + 3,
                'acceptance': 'v11', 'url': 'http://private.invalid/', 'workload': {'id': 'canary'}}
            with self.assertRaises(InterruptedError):
                observe(tmp, cfg, probe=lambda: (_ for _ in ()).throw(InterruptedError('stopped')))
            status = json.loads((Path(tmp) / 'status.json').read_text())
            self.assertEqual(status['state'], 'interrupted')
            self.assertLess(status['samples'], 2)
            with self.assertRaises(FileExistsError):
                observe(tmp, cfg, probe=lambda: http_sample([]))

    def test_actual_vps_df_header_is_parsed(self):
        output = 'Filesystem 1-blocks Used Available Capacity Mounted on\n/dev/vda1 100 30 70 30% /\n'
        self.assertEqual(disk_uses(output), [30])

    def test_oom_or_disk_threshold_blocks_control_acceptance(self):
        sample = control()
        sample['commands']['space'] = {'exit_code': 0, 'stdout': SPACE.replace('30%', '81%')}
        sample['commands']['kernel_journal'] = {'exit_code': 0, 'stdout': 'kernel: Out of memory: Killed process 123'}
        summary = Summary('control', v11=True)
        summary.add(sample)
        self.assertIn('disk_above_80_percent', summary.failures)
        self.assertIn('kernel_oom', summary.failures)
        self.assertEqual(summary.report()['disk_max_percent'], 81)


if __name__ == '__main__': unittest.main()
