"""Offline integrity/coverage review and guest-side correlation; never declares root cause."""
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

from labops import atomic_json
from soak_evidence import HOSTS, validate_manifest
from soak_runner import MAX_BYTES, MAX_RECORD, Summary, iso


def number(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('non-finite or invalid numeric evidence')
    return value


def cpu(text):
    line = next(line for line in text.splitlines() if line.startswith('cpu '))
    values = [int(x) for x in line.split()[1:9]]  # guest time is already included in user/nice
    if len(values) != 8:
        raise ValueError('missing CPU counters')
    return values


def disks(text):
    rows = {}
    for line in text.splitlines():
        fields = line.split()
        if len(fields) >= 14 and not fields[2].startswith(('loop', 'ram')):
            rows[fields[2]] = [int(v) for v in fields[3:]]
    return rows


def pressure(text, kind):
    fields = next(line for line in text.splitlines() if line.startswith(kind + ' ')).split()[1:]
    return int(dict(item.split('=', 1) for item in fields)['total'])


def io_window(before, after):
    """Interval averages, not a causal attribution or per-request latency measurement."""
    seconds = number(after['monotonic']) - number(before['monotonic'])
    if seconds <= 0:
        raise ValueError('invalid diagnostic interval')
    result = {'from': iso(before['time']), 'to': iso(after['time']), 'seconds': seconds, 'issues': []}
    try:
        delta = [b - a for a, b in zip(cpu(before['stat']), cpu(after['stat']))]
        if any(v < 0 for v in delta) or sum(delta) <= 0:
            raise ValueError('CPU counters decreased or did not advance')
        result.update(iowait_percent=100 * delta[4] / sum(delta), steal_percent=100 * delta[7] / sum(delta))
    except (KeyError, ValueError, StopIteration) as exc:
        result['issues'].append('CPU metric unavailable: ' + str(exc))
    for kind in ('some', 'full'):
        try:
            delta = pressure(after['pressure/io'], kind) - pressure(before['pressure/io'], kind)
            if delta < 0:
                raise ValueError('pressure counter decreased')
            result['io_pressure_' + kind + '_percent'] = 100 * delta / (seconds * 1e6)
        except (KeyError, ValueError, StopIteration) as exc:
            result['issues'].append('PSI ' + kind + ' unavailable: ' + str(exc))
    result['devices'] = {}
    try:
        first, last = disks(before['diskstats']), disks(after['diskstats'])
        if not first or first.keys() != last.keys():
            result['issues'].append('disk counters missing or device membership changed')
        for device in first.keys() & last.keys():
            a, b = first[device], last[device]
            # Exclude in-flight requests (a gauge); retain completed read/write counters.
            delta = {i: b[i] - a[i] for i in (0, 3, 4, 7, 9, 10)}
            if any(v < 0 for v in delta.values()):
                result['issues'].append(device + ': disk counters decreased')
                continue
            operations = delta[0] + delta[4]
            result['devices'][device] = {'read_write_operations': operations,
                'read_write_mean_ms': (delta[3] + delta[7]) / operations if operations else None,
                'io_ticks_ms': delta[9], 'weighted_io_ms': delta[10]}
    except (KeyError, ValueError, IndexError) as exc:
        result['issues'].append('disk metric unavailable: ' + str(exc))
    return result


def validate_sample(sample, config):
    for key in ('time', 'monotonic', 'seconds'):
        number(sample[key])
    if sample['seconds'] < 0:
        raise ValueError('negative probe duration')
    commands = sample['commands']
    required = ('services', 'tasks') if config['role'] == 'http' else (
        'health', 'status', 'alarms', 'services', 'journal', 'storage', 'space')
    for key in required:
        command = commands[key]
        if command.get('exit_code') == 0 and not isinstance(command.get('stdout'), str):
            raise ValueError('successful command lacks text output')
    if config['role'] == 'http':
        if (type(sample['ok']) is not bool or sample['workload_id'] != config['workload']['id']
                or (sample['ok'] and sample.get('http_status') != 200)):
            raise ValueError('HTTP evidence identity/schema mismatch')


def analyze_host(path, item, entry, source_hashes):
    cfg = item['config']
    if entry.get('state') != 'complete':
        return {'assessment': 'invalid_evidence', 'errors': ['collection did not complete'], 'samples': 0}
    snapshot = entry['snapshot']
    status, evidence = snapshot['status'], snapshot['evidence']
    errors = Counter()
    expected = {'run_id': cfg['run_id'], 'role': cfg['role'], 'start_epoch': cfg['start_epoch'],
                'deadline_epoch': cfg['deadline_epoch'], 'config_sha256': item['config_sha256']}
    if any(status.get(key) != value for key, value in expected.items()):
        errors['status/config identity mismatch'] += 1
    if snapshot.get('source_sha256') != source_hashes:
        errors['observer source checksum mismatch'] += 1
    if not 0 <= evidence['bytes'] <= MAX_BYTES or path.stat().st_size != evidence['bytes']:
        raise ValueError('evidence size mismatch')
    if status.get('bytes') != evidence['bytes']:
        errors['status/evidence byte count mismatch'] += 1
    summary = Summary(cfg['role'])
    digest = hashlib.sha256()
    first = previous = None
    count = 0
    max_gap = max_probe = 0
    peaks, diagnostic_issues, events = {}, Counter(), []
    event_count = 0
    with path.open('rb') as stream:
        while True:
            raw = stream.readline(MAX_RECORD + 1)
            if not raw:
                break
            if len(raw) > MAX_RECORD or not raw.endswith(b'\n'):
                raise ValueError('oversized or unfinished JSONL record')
            digest.update(raw)
            sample = json.loads(raw)
            validate_sample(sample, cfg)
            count += 1
            max_probe = max(max_probe, sample['seconds'])
            failures_before = summary.failures.copy()
            warnings_before = summary.warnings.copy()
            if first is None:
                first = sample
                if not cfg['start_epoch'] - .01 <= sample['time'] <= cfg['start_epoch'] + 5:
                    errors['first sample outside scheduled start tolerance'] += 1
            else:
                gap = sample['monotonic'] - previous['monotonic']
                wall_gap = sample['time'] - previous['time']
                max_gap = max(max_gap, gap)
                if gap <= 0 or wall_gap <= 0:
                    errors['non-increasing sample times'] += 1
                if abs((sample['time'] - first['time']) - (sample['monotonic'] - first['monotonic'])) > 5:
                    errors['wall clock discontinuity'] += 1
                if gap > cfg['interval'] + 5:
                    summary.failures['observation_gap'] += 1
            summary.add(sample)
            changed = dict(summary.failures - failures_before)
            warnings = dict(summary.warnings - warnings_before)
            if cfg['role'] == 'control' and previous:
                window = io_window(previous, sample)
                for name in ('iowait_percent', 'steal_percent', 'io_pressure_some_percent', 'io_pressure_full_percent'):
                    if name in window:
                        peaks[name] = max(peaks.get(name, 0), window[name])
                for issue in window['issues']:
                    diagnostic_issues[issue] += 1
                for device, metrics in window['devices'].items():
                    value = metrics['read_write_mean_ms']
                    if value is not None:
                        key = device + '.read_write_mean_ms'
                        peaks[key] = max(peaks.get(key, 0), value)
            else:
                window = None
            if changed or warnings:
                event_count += 1
                if len(events) < 100:
                    events.append({'at': iso(sample['time']), 'failures': changed,
                                   'warnings_by_sample': warnings, 'guest_interval': window})
            previous = sample
    if digest.hexdigest() != evidence['sha256']:
        errors['evidence checksum mismatch'] += 1
    if count != status.get('samples'):
        errors['sample count mismatch'] += 1
    if previous and abs(previous['time'] - status.get('last_sample_epoch', -1)) > .001:
        errors['last sample/status mismatch'] += 1
    computed = summary.report()
    if status.get('summary', computed) != computed:
        errors['raw samples disagree with stored summary'] += 1
    complete_state = status.get('state') in ('complete', 'complete_with_failures')
    coverage = bool(first and previous and count >= 2 and previous['time'] >= cfg['deadline_epoch'] - .001
                    and previous['monotonic'] - first['monotonic'] >= cfg['deadline_epoch'] - cfg['start_epoch'] - 5)
    if status.get('state') == 'complete_with_failures' and not summary.failures:
        errors['failed completion state disagrees with samples'] += 1
    if complete_state and not coverage:
        errors['complete status lacks full duration coverage'] += 1
    if errors:
        verdict = 'invalid_evidence'
    elif summary.failures:
        verdict = 'observed_failures'
    elif complete_state:
        verdict = 'complete_needs_review'
    elif (status.get('state') in ('running', 'waiting') and snapshot['systemd'].get('SubState') == 'running'
          and snapshot['current_boot_id'] == status['boot_id']
          and snapshot['observed_at_epoch'] <= status.get('last_sample_epoch', cfg['start_epoch']) + cfg['interval'] + 90):
        verdict = 'in_progress'
    else:
        verdict = 'incomplete'
    return {'assessment': verdict, 'samples': count, 'bytes': evidence['bytes'], 'integrity_errors': dict(errors),
        'first_sample_at': iso(first['time']) if first else None, 'last_sample_at': iso(previous['time']) if previous else None,
        'covered_seconds': previous['monotonic'] - first['monotonic'] if first else 0,
        'first_epoch': first['time'] if first else None, 'last_epoch': previous['time'] if previous else None,
        'max_gap_seconds': max_gap, 'max_probe_seconds': max_probe, 'summary': computed,
        'peak_guest_interval_metrics': peaks, 'diagnostic_issues': dict(diagnostic_issues),
        'event_samples': event_count, 'events': events, 'events_omitted': max(0, event_count - len(events))}


def report(directory):
    directory = Path(directory)
    manifest = json.loads((directory / 'manifest.json').read_text())
    record = json.loads((directory / 'collection.json').read_text())
    validate_manifest(manifest)
    if record['run_id'] != manifest['id'] or not set(record['hosts']) <= set(HOSTS):
        raise ValueError('collection identity mismatch')
    results = {}
    for alias in HOSTS:
        try:
            results[alias] = analyze_host(directory / (alias + '.samples.jsonl'), manifest['hosts'][alias],
                record['hosts'].get(alias, {}), manifest['source_sha256'])
        except (OSError, ValueError, KeyError, TypeError, AttributeError, StopIteration) as exc:
            results[alias] = {'assessment': 'invalid_evidence', 'errors': [str(exc)], 'samples': 0}
    states = {r['assessment'] for r in results.values()}
    verdict = next((v for v in ('invalid_evidence', 'observed_failures', 'incomplete', 'in_progress') if v in states),
                   'complete_needs_review')
    if record['state'] != 'complete':
        verdict = 'invalid_evidence'
    starts = [r.get('first_epoch') for r in results.values()]
    ends = [r.get('last_epoch') for r in results.values()]
    common = max(0, min(ends) - max(starts)) if all(v is not None for v in starts + ends) else 0
    result = {'run_id': manifest['id'], 'collection_id': record['id'], 'assessment': verdict,
        'common_coverage_seconds': common, 'hosts': results,
        'analysis_source_sha256': {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
            for name in ('soak_report.py', 'soak_evidence.py', 'soak_runner.py', 'soak_remote.py')},
        'note': 'Snapshot at collection time; no automatic PASS. Interval averages and temporal correlation do not establish storage/provider root cause. No backend observations means backend latency is untested.'}
    atomic_json(directory / 'report.json', result)
    return result
