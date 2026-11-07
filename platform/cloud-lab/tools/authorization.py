#!/usr/bin/env python3
"""Offline, snapshot-only authorization status and private grant change proposals."""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time
import uuid

_spec = importlib.util.spec_from_file_location('authorization_private_files', Path(__file__).with_name('prepare_deployment.py'))
files = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(files)
MAX_AGE = 300
ROLES = {'human', 'bot', 'runner', 'scheduler'}
CAPABILITIES = {
    'human': {'commands:read', 'commands:submit', 'commands:cancel-request', 'artifact:read', 'node:health:read'},
    'bot': {'commands:read', 'commands:submit', 'commands:cancel-request', 'artifact:read', 'node:health:read'},
    'runner': {'dispatch:claim', 'runs:report', 'runs:reconcile'},
    'scheduler': {'commands:submit', 'node:health:read'},
}


class AuthorizationError(ValueError):
    """Stable diagnostics never include snapshot contents or filesystem paths."""


def require(ok, code='INVALID_SNAPSHOT'):
    if not ok:
        raise AuthorizationError(code)


def shape(value, names):
    require(isinstance(value, dict) and set(value) == set(names.split()))


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value))


def integer(value, low=0, high=2147483647):
    require(type(value) is int and low <= value <= high)


def seconds(value):
    try:
        return int(files.timestamp(value).timestamp())
    except (files.PreparationError, ValueError, OverflowError) as error:
        raise AuthorizationError('INVALID_TIMESTAMP') from error


def utc(value):
    return datetime.fromtimestamp(value, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def validate(snapshot):
    """Accept metadata only; unknown fields, including secrets, are rejected."""
    try:
        raw = files.encode(snapshot)
        require(len(raw) <= 32768)
        shape(snapshot, 'schema_version observed_at target active_commands schedules_enabled subjects')
        require(snapshot['schema_version'] == 'cloudlab.authorization.v1')
        seconds(snapshot['observed_at'])
        target = snapshot['target']
        shape(target, 'worker_name database_id')
        require(target['worker_name'] in ('cloud-lab', 'cloud-lab-qualification'))
        require(isinstance(target['database_id'], str) and str(uuid.UUID(target['database_id'])) == target['database_id'])
        integer(snapshot['active_commands'])
        require(type(snapshot['schedules_enabled']) is bool)
        subjects = snapshot['subjects']
        require(isinstance(subjects, list) and 1 <= len(subjects) <= 4)
        roles, grant_ids, credential_ids = set(), set(), set()
        for subject in subjects:
            shape(subject, 'role grant credential access_required access_service runner_stop_at')
            role = subject['role']
            require(isinstance(role, str) and role in ROLES and role not in roles)
            roles.add(role)
            grant = subject['grant']
            if grant is not None:
                shape(grant, 'id revision revoked policy')
                identifier(grant['id']); integer(grant['revision'], 1)
                require(type(grant['revoked']) is int and grant['revoked'] in (0, 1))
                require(grant['id'] not in grant_ids); grant_ids.add(grant['id'])
                require(isinstance(grant['policy'], str))
                policy = files.strict_json(grant['policy'].encode('utf-8'))
                shape(policy, 'principal_id workspace_id resource_ref recipe_ref capabilities not_before expires_at max_timeout_seconds max_output_bytes')
                for name in ('principal_id', 'workspace_id'): identifier(policy[name])
                shape(policy['resource_ref'], 'resource_id generation')
                identifier(policy['resource_ref']['resource_id']); integer(policy['resource_ref']['generation'], 1)
                shape(policy['recipe_ref'], 'recipe_id version digest')
                require(policy['recipe_ref']['recipe_id'] == 'node-health' and policy['recipe_ref']['version'] == '1.0.0')
                require(isinstance(policy['recipe_ref']['digest'], str) and re.fullmatch('sha256:[a-f0-9]{64}', policy['recipe_ref']['digest']))
                caps = policy['capabilities']
                require(isinstance(caps, list) and all(isinstance(x, str) for x in caps))
                require(len(caps) == len(set(caps)) and set(caps) <= CAPABILITIES[role])
                require(seconds(policy['not_before']) < seconds(policy['expires_at']))
                integer(policy['max_timeout_seconds'], 1, 10); integer(policy['max_output_bytes'], 1, 16384)
            credential = subject['credential']
            if credential is not None:
                shape(credential, 'id generation revoked expires_at principal_id grant_id')
                identifier(credential['id']); integer(credential['generation'], 1)
                identifier(credential['principal_id']); identifier(credential['grant_id'])
                require(credential['id'] not in credential_ids); credential_ids.add(credential['id'])
                require(type(credential['revoked']) is bool)
                if credential['expires_at'] is not None: seconds(credential['expires_at'])
                if grant is not None:
                    require(credential['grant_id'] == grant['id'] and credential['principal_id'] == policy['principal_id'])
            require(type(subject['access_required']) is bool)
            access = subject['access_service']
            if access is not None:
                shape(access, 'id revoked expires_at'); identifier(access['id'])
                require(type(access['revoked']) is bool)
                if access['expires_at'] is not None: seconds(access['expires_at'])
            if role in ('human', 'scheduler'):
                require(credential is None and access is None and not subject['access_required'])
            if not subject['access_required']: require(access is None)
            stop = subject['runner_stop_at']
            if role != 'runner': require(stop is None)
            if stop is not None: seconds(stop)
        return snapshot
    except (files.PreparationError, UnicodeError, TypeError, ValueError, RecursionError, OverflowError) as error:
        if isinstance(error, AuthorizationError): raise
        raise AuthorizationError('INVALID_SNAPSHOT') from error


def layer(expiry=None, *, present=True, applicable=True, revoked=False, not_before=None, now):
    state = 'valid'
    if not applicable: state = 'not_applicable'
    elif revoked: state = 'revoked'
    elif expiry is not None and seconds(expiry) <= now: state = 'expired'
    elif not_before is not None and seconds(not_before) > now: state = 'not_yet_valid'
    elif not present or expiry is None: state = 'unknown'
    elif seconds(expiry) - now <= 3600: state = 'expiring'
    return {'state': state, 'expires_at': expiry}


def status(snapshot, *, now):
    validate(snapshot); integer(now, 0, 253402300799)
    age = now - seconds(snapshot['observed_at'])
    fresh = 0 <= age <= MAX_AGE
    result = {'schema_version': 'cloudlab.authorization-status.v1', 'checked_at': utc(now),
              'snapshot_age_seconds': age, 'snapshot_fresh': fresh, 'live_verified': False, 'subjects': []}
    for subject in snapshot['subjects']:
        role, grant = subject['role'], subject['grant']
        policy = json.loads(grant['policy']) if grant else {}
        layers = {'grant': layer(policy.get('expires_at'), present=grant is not None,
                                 revoked=bool(grant and grant['revoked']), not_before=policy.get('not_before'), now=now)}
        for name, applicable in [('credential', role in ('bot', 'runner')), ('access_service', subject['access_required'])]:
            item = subject[name]
            layers[name] = layer(item.get('expires_at') if item else None, present=item is not None,
                                 applicable=applicable, revoked=bool(item and item['revoked']), now=now)
        layers['runner_stop'] = layer(subject['runner_stop_at'], applicable=role == 'runner', now=now)
        required = {k: v for k, v in layers.items() if v['state'] != 'not_applicable'}
        states = {v['state'] for v in required.values()}
        state = next((s for s in ('revoked', 'expired', 'not_yet_valid') if s in states), None)
        if state is None: state = 'unknown' if not fresh or 'unknown' in states else 'expiring' if 'expiring' in states else 'valid'
        deadlines = [v['expires_at'] for v in required.values() if v['expires_at'] is not None]
        earliest = min(deadlines) if deadlines else None
        result['subjects'].append({'role': role, 'state': state, 'layers': layers,
            'effective_expires_at': earliest, 'deadline_complete': fresh and all(v['expires_at'] is not None for v in required.values()),
            'limiting_layers': [k for k, v in required.items() if earliest is not None and v['expires_at'] == earliest],
            'human_session': 'not_evaluated' if role == 'human' else 'not_applicable'})
    return result


def make_plan(snapshot, *, role, action, expires_at=None, now):
    report = status(snapshot, now=now)
    require(report['snapshot_fresh'], 'FRESH_SNAPSHOT_REQUIRED')
    require(snapshot['active_commands'] == 0 and not snapshot['schedules_enabled'], 'QUIESCENT_SNAPSHOT_REQUIRED')
    require(action in ('renew', 'revoke') and role in ROLES, 'INVALID_ACTION')
    subject = next((s for s in snapshot['subjects'] if s['role'] == role), None)
    require(subject is not None and subject['grant'] is not None, 'GRANT_REQUIRED')
    grant = subject['grant']
    require(not grant['revoked'], 'GRANT_REVOKED')
    require(grant['revision'] < 2147483647, 'REVISION_EXHAUSTED')
    policy = json.loads(grant['policy'])
    where = (' WHERE id=? AND revision=? AND revoked=0 AND policy=?'
             ' AND NOT EXISTS (SELECT 1 FROM commands WHERE active=1)'
             ' AND NOT EXISTS (SELECT 1 FROM schedules WHERE enabled=1)')
    params = [grant['id'], grant['revision'], grant['policy']]
    if action == 'renew':
        require(expires_at is not None, 'EXPIRY_REQUIRED')
        expiry = seconds(expires_at)
        require(now < expiry <= now + 30 * 86400 and expiry > seconds(policy['expires_at']), 'INVALID_RENEWAL_WINDOW')
        policy['expires_at'] = expires_at
        sql = 'UPDATE grants SET policy=?,revision=revision+1' + where
        params.insert(0, json.dumps(policy, ensure_ascii=False, separators=(',', ':')))
    else:
        require(expires_at is None, 'REVOKE_HAS_NO_EXPIRY')
        sql = 'UPDATE grants SET revoked=1,revision=revision+1' + where
    current = next(s for s in report['subjects'] if s['role'] == role)
    return {'schema_version': 'cloudlab.authorization-plan.v1', 'action': action, 'role': role,
        'target': copy.deepcopy(snapshot['target']), 'created_at': utc(now),
        'valid_until': utc(seconds(snapshot['observed_at']) + MAX_AGE),
        'snapshot_sha256': hashlib.sha256(files.encode(snapshot)).hexdigest(),
        'approval_required': True, 'applied': False, 'query': {'sql': sql, 'params': params},
        'expected_affected_rows': 1, 'credential_rotation_performed': False,
        'companion_layers_not_extended': [k for k, v in current['layers'].items() if k != 'grant' and v['state'] != 'not_applicable'],
        'before': current,
        'operator_checks': ['approve exact target/action/role/expiry', 're-read target and snapshot; enforce valid_until before execution',
            'execute once; require exactly one affected row; unknown reply requires reconciliation',
            'read back unchanged scope and command deadlines; verify credentials separately',
            'never extend or replay existing commands; retain private receipts']}


def run(snapshot_path, output_path=None, *, role=None, action=None, expires_at=None, now=None):
    """File I/O boundary; no provider, subprocess, service, or network operation."""
    try:
        source = files.canonical_path(snapshot_path)
        files.require_outside_checkout(source)
        snapshot = files.read_private(source)
        now = int(time.time()) if now is None else now
        if output_path is None:
            require(role is None and action is None and expires_at is None, 'OUTPUT_REQUIRED')
            return status(snapshot, now=now)
        plan = make_plan(snapshot, role=role, action=action, expires_at=expires_at, now=now)
        destination = files.canonical_path(output_path)
        files.require_outside_checkout(destination)
        raw = files.encode(plan)
        parent = files.open_directory(destination.parent)
        try:
            info = os.fstat(parent)
            require(info.st_uid == os.geteuid() and not info.st_mode & 0o022, 'UNSAFE_OUTPUT_PARENT')
            fd = os.open(destination.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            with os.fdopen(fd, 'wb') as handle:
                os.fchmod(handle.fileno(), 0o600)
                handle.write(raw); handle.flush(); os.fsync(handle.fileno())
            os.fsync(parent)
        finally:
            os.close(parent)
        return {'saved': True, 'applied': False, 'sha256': hashlib.sha256(raw).hexdigest()}
    except (OSError, files.PreparationError) as error:
        raise AuthorizationError('PRIVATE_FILE_UNAVAILABLE_OR_UNSAFE') from error


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    inspect = sub.add_parser('status'); inspect.add_argument('--snapshot', required=True)
    plan = sub.add_parser('plan'); plan.add_argument('--snapshot', required=True)
    plan.add_argument('--role', choices=sorted(ROLES), required=True)
    plan.add_argument('--action', choices=['renew', 'revoke'], required=True)
    plan.add_argument('--expires-at'); plan.add_argument('--output', required=True)
    args = parser.parse_args(argv)
    try:
        result = run(args.snapshot) if args.command == 'status' else run(args.snapshot, args.output, role=args.role, action=args.action, expires_at=args.expires_at)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except AuthorizationError as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
