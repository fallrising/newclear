#!/usr/bin/env python3
"""Collect private control-plane health evidence without changing remote services."""
import argparse
from contextlib import nullcontext
import json
import math
import re
import time
from datetime import datetime, timezone

from labctl import Operator, PROJECT
from labops import ClusterLock, atomic_json


def histogram(text, name):
    pattern = re.compile(re.escape(name) + r'_bucket\{le="([^"]+)"\} (\S+)')
    return {float(m[1]): float(m[2]) for m in pattern.finditer(text)}


def summarize(samples):
    failures = []
    for i, sample in enumerate(samples):
        for key in ['health', 'status', 'alarms', 'services', 'journal']:
            event = sample.get('commands', {}).get(key, {})
            if event.get('exit_code') != 0:
                failures.append(f'sample {i}: {key} failed')
        alarms = sample.get('commands', {}).get('alarms', {}).get('stdout', '')
        try:
            if json.loads(alarms).get('alarms'):
                failures.append(f'sample {i}: etcd alarms present')
        except (ValueError, AttributeError):
            failures.append(f'sample {i}: invalid alarm response')
        if 'metrics' not in sample:
            failures.append(f'sample {i}: metrics missing')
        journal = sample.get('commands', {}).get('journal', {}).get('stdout', '')
        if re.search(r'slow fdatasync|took too long|panic:|request timed out', journal):
            failures.append(f'sample {i}: slow operation or panic in journal')
    histograms = {}
    if len(samples) >= 2:
        for name in ['etcd_disk_wal_fsync_duration_seconds', 'etcd_disk_backend_commit_duration_seconds']:
            first, last = [histogram(s.get('metrics', ''), name) for s in [samples[0], samples[-1]]]
            if not first or first.keys() != last.keys():
                failures.append(name + ': missing or changed buckets')
                continue
            delta = {b: last[b] - first[b] for b in first}
            count = delta.get(math.inf, 0)
            if any(v < 0 for v in delta.values()):
                failures.append(name + ': counter reset')
                continue
            if count <= 0:
                failures.append(name + ': no observations in window')
                continue
            upper = next(b for b in sorted(delta) if delta[b] >= count * .99)
            histograms[name] = {'observations': count, 'p99_bucket_upper_seconds': upper if math.isfinite(upper) else None}
            threshold = .01 if 'wal_fsync' in name else .025
            if upper >= threshold:
                failures.append(name + ': p99 bucket upper bound exceeds candidate threshold')
    services = [s.get('commands', {}).get('services', {}).get('stdout') for s in samples]
    if services and any(s != services[0] for s in services):
        failures.append('service state/invocation changed during observation')
    return {'samples': len(samples), 'health_failures': sum(s.get('commands', {}).get('health', {}).get('exit_code') != 0 for s in samples),
            'duration_seconds': samples[-1]['time'] - samples[0]['time'] if len(samples) > 1 else 0,
            'histogram_deltas': histograms, 'findings': failures,
            'note': 'Read-only observation, not a deployment approval or proof of storage root cause.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=int, default=61)
    parser.add_argument('--interval', type=float, default=10)
    parser.add_argument('--disk-probe', action='store_true', help='Bounded scratch-file writes on 01; does not touch etcd data')
    parser.add_argument('--concurrent-read-only', action='store_true', help='Observe a planned mutation without holding its controller lock; forbidden with --disk-probe')
    args = parser.parse_args()
    if args.concurrent_read_only and args.disk_probe:
        parser.error('concurrent observation cannot write a disk probe')
    if not 2 <= args.samples <= 361 or not 1 <= args.interval <= 60:
        parser.error('samples must be 2..361 and interval 1..60 seconds')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    if args.disk_probe:
        path = PROJECT / 'private/diagnostics' / (stamp + '-fdatasync.json')
        with ClusterLock(PROJECT):
            op = Operator()
            result = {'host': 'ckc-disposable-01', 'started_at': stamp}
            try:
                result['probe'] = json.loads(op.command('ckc-disposable-01', ['sudo', '-n', 'python3', '-'],
                    (PROJECT / 'scripts/control_disk_probe.py').read_text()))
            except BaseException as exc:
                result['error'] = str(exc)
                raise
            finally:
                result['events'] = op.events
                atomic_json(path, result)
                print('Evidence:', path)
        print(json.dumps({k: v for k, v in result['probe'].items() if k != 'seconds'}, indent=2))
        return
    path = PROJECT / 'private/diagnostics' / (stamp + '-control-health.json')
    report = {'host': 'ckc-disposable-01', 'samples': [], 'status': 'collecting'}
    with (nullcontext() if args.concurrent_read_only else ClusterLock(PROJECT)):
        op = Operator()
        try:
            for index in range(args.samples):
                start = time.monotonic()
                sample = json.loads(op.command('ckc-disposable-01', ['sudo', '-n', 'python3', '-'],
                                               (PROJECT / 'scripts/control_probe.py').read_text()))
                report['samples'].append(sample)
                report['summary'] = summarize(report['samples'])
                atomic_json(path, report)
                print(json.dumps({'sample': index + 1, 'health_exit': sample['commands']['health']['exit_code'],
                                  'findings': len(report['summary']['findings'])}), flush=True)
                if index + 1 < args.samples:
                    time.sleep(max(0, args.interval - (time.monotonic() - start)))
            report['status'] = 'complete'
        except BaseException as exc:
            report.update(status='interrupted', error=str(exc))
            raise
        finally:
            atomic_json(path, report)
            print('Evidence:', path)
    print(json.dumps(report['summary'], indent=2))


if __name__ == '__main__':
    main()
