#!/usr/bin/env python3
"""Start or inspect finite observers on VPSs; controller can exit immediately."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import uuid

from canaries import guard_targets, warmup
from core_patch import PatchOperator
from labctl import PROJECT, consistency_issues, identifier
from labops import ClusterLock, atomic_json
from soak_remote import config_hash
from soak_runner import MAX_BYTES, iso

ALIASES = ('ckc-disposable-01', 'ckc-disposable-02', 'ckc-disposable-03')


def remote(op, alias, request):
    if alias not in ALIASES:
        raise ValueError('observer host outside allowed scope')
    source = (op.project / 'scripts/soak_remote.py').read_text()
    source += '\nprint(json.dumps(dispatch(' + repr(request) + ')))\n'
    return json.loads(op.command(alias, ['sudo', '-n', 'python3', '-'], source))


def assessment(result, interval):
    status = result.get('status')
    if not status:
        return 'missing_evidence'
    state = status.get('state')
    if state in ('waiting', 'running'):
        if result['current_boot_id'] != status.get('boot_id'):
            return 'interrupted_by_reboot'
        if result['systemd'].get('SubState') != 'running':
            return 'observer_not_running'
        latest = status.get('last_sample_epoch', status['start_epoch'])
        if result['observed_at_epoch'] > latest + interval + 90:
            return 'stale_observer'
        return state
    if state in ('complete', 'complete_with_failures'):
        if (status.get('samples', 0) < 2 or status.get('last_sample_epoch', 0) < status['deadline_epoch']
                or status.get('elapsed_seconds', 0) < status['deadline_epoch'] - status['start_epoch'] - 5):
            return 'incomplete_coverage'
        return 'complete_needs_review' if state == 'complete' else 'complete_with_failures'
    return state or 'invalid_evidence'


def start(op, canary_run, duration, interval, lead):
    snapshot = op.snapshot()
    issues = consistency_issues(snapshot, op.inventory)
    if issues or op.health()['exit_code']:
        raise ValueError('unhealthy or inconsistent cluster: ' + '; '.join(issues))
    targets = guard_targets(op, snapshot, canary_run)
    if {w['id'] for w in snapshot['workloads']} != {t['id'] for t in targets}:
        raise ValueError('soak requires exactly the two owned canaries; worker-4 stays empty')
    warmup(op, targets)
    runtime = op.core_runtime()
    revision = json.loads((op.project / 'private/operations/core-revision.json').read_text())
    # Revision schema is owned by the core updater; compare its recorded executable SHA.
    expected = revision['artifact_sha256']
    if runtime['sha256'] != expected:
        raise ValueError('live core does not match recorded patched revision')
    root = op.project / 'private/soak'
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    # A failed/uncertain launch is inspected explicitly, never silently superseded.
    for path in root.glob('*/manifest.json'):
        old = json.loads(path.read_text())
        if old['deadline_epoch'] + 120 > time.time() and old.get('state') != 'stopped':
            raise ValueError('existing observation may still be active: ' + old['id'])
    run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8]
    directory = root / run_id
    directory.mkdir(mode=0o700)
    begin = int(time.time()) + lead
    files = {name: (op.project / 'scripts' / name).read_text()
             for name in ('soak_runner.py', 'control_probe.py')}
    manifest = {'id': run_id, 'canary_run': identifier(canary_run), 'state': 'starting',
        'start_epoch': begin, 'deadline_epoch': begin + duration,
        'scheduled_start_at': iso(begin), 'deadline_at': iso(begin + duration),
        'unit': 'eru-mvp-soak-' + run_id + '.service',
        'remote_directory': '/var/lib/eru-mvp/soak/' + run_id,
        'core_runtime': runtime, 'snapshot': snapshot, 'hosts': {},
        'source_sha256': {name: hashlib.sha256(value.encode()).hexdigest() for name, value in files.items()}}
    for alias in ALIASES:
        target = next((t for t in targets if t['alias'] == alias), None)
        config = {'run_id': run_id, 'role': 'http' if target else 'control', 'start_epoch': begin,
                  'deadline_epoch': begin + duration, 'interval': interval, 'max_bytes': MAX_BYTES}
        if target:
            config.update(url=target['url'], workload=target)
        manifest['hosts'][alias] = {'config': config, 'config_sha256': config_hash(config), 'launch': 'pending'}
    path = directory / 'manifest.json'
    atomic_json(path, manifest)
    try:
        for alias, item in manifest['hosts'].items():
            item['launch'] = 'attempting'
            atomic_json(path, manifest)  # before SSH; lost acknowledgement remains uncertain
            item['initial'] = remote(op, alias, {'action': 'start', 'run_id': run_id,
                'config': item['config'], 'config_sha256': item['config_sha256'], 'files': files})
            item['launch'] = 'acknowledged'
            atomic_json(path, manifest)
        manifest['state'] = 'launched'
    except BaseException as exc:
        manifest.update(state='uncertain', error=str(exc))
        raise
    finally:
        atomic_json(path, manifest)
        atomic_json(directory / 'launch-events.json', op.events)
        print('Private manifest:', path, flush=True)
    return {k: manifest[k] for k in ('id', 'canary_run', 'state', 'scheduled_start_at', 'deadline_at', 'unit')}


def inspect(op, run_id, stop=False):
    directory = op.project / 'private/soak' / identifier(run_id)
    path = directory / 'manifest.json'
    manifest = json.loads(path.read_text())
    results = {}
    for alias, item in manifest['hosts'].items():
        try:
            result = remote(op, alias, {'action': 'stop' if stop else 'status', 'run_id': run_id,
                                      'config_sha256': item['config_sha256']})
            result['assessment'] = assessment(result, item['config']['interval'])
            results[alias] = result
        except Exception as exc:
            results[alias] = {'assessment': 'unreachable_or_uncertain', 'error': str(exc)}
        atomic_json(directory / 'latest-status.json', results)
    if stop and all(r['assessment'] not in ('running', 'waiting', 'unreachable_or_uncertain') for r in results.values()):
        manifest.update(state='stopped', stopped_at=iso(time.time()))
        atomic_json(path, manifest)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    create = sub.add_parser('start')
    create.add_argument('--canary-run', required=True)
    create.add_argument('--duration-seconds', type=int, default=86400)
    create.add_argument('--interval', type=int, default=30)
    create.add_argument('--lead-seconds', type=int, default=90)
    for action in ('status', 'stop'):
        sub.add_parser(action).add_argument('--run', required=True)
    args = parser.parse_args()
    if args.action == 'start':
        if not 30 <= args.duration_seconds <= 86400 or not 5 <= args.interval <= 60 or not 15 <= args.lead_seconds <= 300:
            parser.error('duration 30..86400, interval 5..60, lead 15..300 seconds')
        with ClusterLock(PROJECT):
            result = start(PatchOperator(), args.canary_run, args.duration_seconds, args.interval, args.lead_seconds)
    elif args.action == 'stop':
        with ClusterLock(PROJECT):
            result = inspect(PatchOperator(), args.run, stop=True)
    else:
        result = inspect(PatchOperator(), args.run)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
