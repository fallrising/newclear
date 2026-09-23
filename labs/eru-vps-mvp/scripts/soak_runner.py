#!/usr/bin/env python3
"""VPS-local finite read-only observer. No controller connection or ERU mutations."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import urllib.request

MAX_BYTES = 192 * 1024 * 1024
MAX_RECORD = 1024 * 1024
HISTOGRAMS = ('etcd_disk_wal_fsync_duration_seconds', 'etcd_disk_backend_commit_duration_seconds')


def iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec='seconds')


def replace_json(path, value):
    # Avoid introducing a synchronous disk benchmark on the same disk as etcd.
    # A reboot/torn final record needs review; missing evidence can never pass.
    temp = path.with_suffix('.tmp')
    with temp.open('w') as stream:
        json.dump(value, stream, sort_keys=True, allow_nan=False)
        stream.write('\n')
    os.replace(temp, path)


def http_probe(url, workload_id):
    result = {'time': time.time(), 'commands': {}, 'workload_id': workload_id}
    for name, argv in {
        'services': ['systemctl', 'show', '--property=Id,ActiveState,SubState,MainPID,InvocationID,NRestarts',
                     'eru-agent.service', 'eru-containerd-proxy.socket', 'docker.service', 'containerd.service'],
        'tasks': ['ctr', '--namespace', 'eru', 'tasks', 'list', '-q'],
    }.items():
        try:
            p = subprocess.run(argv, capture_output=True, text=True, timeout=5)
            result['commands'][name] = {'exit_code': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr}
        except subprocess.TimeoutExpired:
            result['commands'][name] = {'exit_code': None, 'error': 'timeout'}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(url, timeout=2) as response:
            result['http_status'] = response.status
            result['ok'] = response.status == 200 and b'Welcome to nginx!' in response.read(65536)
    except Exception as exc:
        result.update(ok=False, error=str(exc))
    return result


def buckets(metrics, name):
    return {float(m[1]): float(m[2]) for m in re.finditer(
        re.escape(name) + r'_bucket\{le="([^"]+)"\} (\S+)', metrics)}


class Summary:
    def __init__(self, role):
        self.role = role
        self.failures = Counter()
        self.warnings = Counter()
        self.first_services = None
        self.previous_buckets = {}
        self.total_buckets = {}

    def add(self, sample):
        if self.role == 'http':
            if sample.get('ok') is not True:
                self.failures['http_failed'] += 1
            commands = sample.get('commands')
            if commands is not None:
                for name in ('services', 'tasks'):
                    if commands.get(name, {}).get('exit_code') != 0:
                        self.failures[name + '_failed'] += 1
                services = commands.get('services', {}).get('stdout', '')
                if services.count('ActiveState=active\n') != 4:
                    self.failures['service_not_running'] += 1
                if self.first_services is None:
                    self.first_services = services
                elif self.first_services != services:
                    self.failures['service_state_or_invocation_changed'] += 1
                if commands.get('tasks', {}).get('stdout', '').split() != [sample.get('workload_id')]:
                    self.failures['workload_membership_changed'] += 1
            return
        commands = sample.get('commands', {})
        for name in ('health', 'status', 'alarms', 'services', 'journal', 'storage', 'space'):
            if commands.get(name, {}).get('exit_code') != 0:
                self.failures[name + '_failed'] += 1
        try:
            alarms = json.loads(commands['alarms']['stdout'])
            if not isinstance(alarms, dict) or alarms.get('alarms'):
                self.failures['etcd_alarms'] += 1
        except (KeyError, ValueError, TypeError):
            self.failures['invalid_alarms'] += 1
        services = commands.get('services', {}).get('stdout', '')
        if services.count('ActiveState=active\n') != 4 or services.count('SubState=running\n') != 4:
            self.failures['service_not_running'] += 1
        if self.first_services is None:
            self.first_services = services
        elif services != self.first_services:
            self.failures['service_state_or_invocation_changed'] += 1
        journal = commands.get('journal', {}).get('stdout', '')
        for pattern, key in [('slow fdatasync', 'slow_fdatasync'), ('took too long', 'slow_operation'),
                             ('panic:', 'panic'), ('request timed out', 'request_timeout')]:
            if pattern in journal:
                self.warnings[key] += 1  # overlapping windows; samples, not unique incidents
                if key in ('panic', 'request_timeout'):
                    self.failures[key] += 1
        if 'metrics' not in sample:
            self.failures['metrics_missing'] += 1
        for name in HISTOGRAMS:
            current = buckets(sample.get('metrics', ''), name)
            if not current or math.inf not in current or any(not math.isfinite(v) for v in current.values()):
                self.failures[name + '_missing_or_invalid'] += 1
                continue
            previous = self.previous_buckets.get(name)
            if previous is not None:
                if previous.keys() != current.keys() or any(current[k] < previous[k] for k in current):
                    self.failures[name + '_reset_or_changed'] += 1
                else:
                    totals = self.total_buckets.setdefault(name, {k: 0 for k in current})
                    if totals.keys() == current.keys():
                        for key in current:
                            totals[key] += current[key] - previous[key]
            self.previous_buckets[name] = current

    def report(self):
        histograms = {}
        for name, delta in self.total_buckets.items():
            count = delta.get(math.inf, 0)
            upper = next((k for k in sorted(delta) if count > 0 and delta[k] >= .99 * count), None)
            histograms[name] = {'observations': count,
                'p99_bucket_upper_seconds': upper if upper is not None and math.isfinite(upper) else None,
                'threshold_exceeded': upper is not None and upper >= (.01 if 'wal_fsync' in name else .025)}
        return {'failures': dict(self.failures), 'warnings_by_sample': dict(self.warnings),
                'histogram_deltas': histograms}


def observe(directory, config, probe=None):
    directory = Path(directory)
    os.umask(0o077)
    status_path = directory / 'status.json'
    # Exclusive creation prevents restart/replay, including after an uncertain launch.
    fd = os.open(directory / 'samples.jsonl', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    boot_id = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    status = {'run_id': config['run_id'], 'role': config['role'], 'state': 'waiting',
        'pid': os.getpid(), 'boot_id': boot_id, 'launched_at': iso(time.time()),
        'start_epoch': config['start_epoch'], 'deadline_epoch': config['deadline_epoch'],
        'scheduled_start_at': iso(config['start_epoch']), 'deadline_at': iso(config['deadline_epoch']),
        'samples': 0, 'bytes': 0, 'assessment': 'pending_review',
        'config_sha256': hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()}
    summary = Summary(config['role'])
    def interrupted(signum, frame):
        raise InterruptedError('received signal ' + str(signum))
    previous_handlers = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        with os.fdopen(fd, 'w') as stream:
            replace_json(status_path, status)
            time.sleep(max(0, config['start_epoch'] - time.time()))
            wall, mono = time.time(), time.monotonic()
            end = mono + config['deadline_epoch'] - wall
            if wall - config['start_epoch'] > 5 or end <= mono:
                raise RuntimeError('missed scheduled start; create a new observation')
            status.update(state='running', started_at=iso(wall))
            prior_mono = None
            prior_wall = config['start_epoch'] - 1
            next_sample = mono
            while True:
                time.sleep(max(0, next_sample - time.monotonic()))
                sample_mono, sample_wall = time.monotonic(), time.time()
                if abs((sample_wall - wall) - (sample_mono - mono)) > 5:
                    raise RuntimeError('wall clock jumped; coverage is uncertain')
                if prior_mono is not None and sample_mono - prior_mono > config['interval'] + 5:
                    summary.failures['observation_gap'] += 1
                if probe:
                    sample = probe()
                elif config['role'] == 'control':
                    from control_probe import probe as control_probe
                    sample = control_probe('@' + str(int(prior_wall - 1)))
                else:
                    sample = http_probe(config['url'], config['workload']['id'])
                sample.update(monotonic=sample_mono, time=sample_wall,
                              seconds=time.monotonic() - sample_mono)
                summary.add(sample)
                encoded = json.dumps(sample, sort_keys=True, allow_nan=False) + '\n'
                size = len(encoded.encode())
                if size > MAX_RECORD or status['bytes'] + size > config.get('max_bytes', MAX_BYTES):
                    raise RuntimeError('evidence byte budget exhausted; no truncation accepted')
                stream.write(encoded)
                stream.flush()
                status.update(samples=status['samples'] + 1, bytes=status['bytes'] + size,
                              last_sample_at=iso(sample_wall), last_sample_epoch=sample_wall,
                              elapsed_seconds=sample_mono - mono, summary=summary.report())
                replace_json(status_path, status)
                prior_mono, prior_wall = sample_mono, sample_wall
                if sample_mono >= end:
                    break  # final sample covers the deadline
                next_sample = min(end, sample_mono + config['interval'])
            status['state'] = 'complete' if not summary.failures else 'complete_with_failures'
    except BaseException as exc:
        status.update(state='interrupted' if isinstance(exc, (InterruptedError, KeyboardInterrupt)) else 'failed',
                      error=str(exc), summary=summary.report())
        raise
    finally:
        status['updated_at'] = iso(time.time())
        if status['state'] not in ('waiting', 'running'):
            status['finished_at'] = status['updated_at']
        replace_json(status_path, status)
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    config = json.loads((args.directory / 'config.json').read_text())
    duration = config['deadline_epoch'] - config['start_epoch']
    if not 30 <= duration <= 86400 or not 5 <= config['interval'] <= 60 or config['role'] not in ('control', 'http'):
        parser.error('invalid duration, interval or role')
    observe(args.directory, config)


if __name__ == '__main__':
    main()
