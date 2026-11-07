#!/usr/bin/env python3
"""Prepare one private, offline operator decision; never apply SQL or run work."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('resolution_auth', Path(__file__).with_name('authorization.py'))
auth = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(auth)
files = auth.files
UNKNOWN = {'owner_outcome': 'unknown', 'started_at': None, 'finished_at': None, 'artifact': None}


class ResolutionError(ValueError):
    """Stable diagnostics, no private input or path in messages."""


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def _plan(snapshot, operator_id, resolution_id, now):
    require, shape = auth.require, auth.shape
    require(len(files.encode(snapshot)) <= 32768)
    shape(snapshot, 'schema_version observed_at target command journal')
    require(snapshot['schema_version'] == 'cloudlab.unknown-resolution.v1')
    auth.integer(now, 0, 253402300799)
    observed = auth.seconds(snapshot['observed_at'])
    require(0 <= now - observed < 300, 'FRESH_SNAPSHOT_REQUIRED')
    auth.identifier(operator_id)
    require(str(uuid.UUID(resolution_id)) == resolution_id and uuid.UUID(resolution_id).version == 4)
    target = snapshot['target']
    shape(target, 'worker_name database_id')
    require(target['worker_name'] in ('cloud-lab', 'cloud-lab-qualification'))
    require(str(uuid.UUID(target['database_id'])) == target['database_id'])
    row, journal = snapshot['command'], snapshot['journal']
    shape(row, 'id principal_id idem_key body body_digest submit_grant grant_revision record revision active created_at')
    for name in ('id', 'principal_id', 'idem_key', 'submit_grant'): auth.identifier(row[name])
    auth.integer(row['revision'], 1, 2147483646)
    auth.integer(row['grant_revision'], 1)
    auth.integer(row['active'], 1, 1)
    auth.integer(row['created_at'], 0, 253402300799000)
    require(isinstance(row['body'], str) and isinstance(row['record'], str))
    command = files.strict_json(row['body'].encode())
    value = files.strict_json(row['record'].encode())
    require(hashlib.sha256(row['body'].encode()).hexdigest() == row['body_digest'])
    shape(value, 'command_id revision command delivery cancel_requested external_ref attempt result created_at updated_at holder')
    require(value['command_id'] == row['id'] and value['revision'] == row['revision'] and type(value['revision']) is int)
    require(value['command'] == command and value['delivery'] == 'reconciling' and value['result'] is None)
    require(type(value['cancel_requested']) is bool)
    auth.identifier(value['holder'])
    require(auth.seconds(value['created_at']) * 1000 == row['created_at'])
    require(auth.seconds(value['updated_at']) <= observed)
    shape(command, 'schema_version schema_minor workspace_id resource_ref recipe_ref parameters idempotency_key not_before dispatch_deadline execution_deadline timeout_seconds output_budget_bytes')
    require(command['schema_version'] == 'cloudlab.command.v1')
    auth.integer(command['schema_minor'], 0, 0)
    auth.identifier(command['workspace_id'])
    require(command['idempotency_key'] == row['idem_key'])
    shape(command['resource_ref'], 'resource_id generation')
    auth.identifier(command['resource_ref']['resource_id']); auth.integer(command['resource_ref']['generation'], 1)
    require(command['recipe_ref'] == {'recipe_id': 'node-health', 'version': '1.0.0',
            'digest': 'sha256:' + hashlib.sha256((ROOT/'recipes/node-health.json').read_bytes()).hexdigest()})
    shape(command['parameters'], 'max_sample_age_seconds')
    auth.integer(command['parameters']['max_sample_age_seconds'], 1, 60)
    auth.integer(command['timeout_seconds'], 10, 10); auth.integer(command['output_budget_bytes'], 16384, 16384)
    start, dispatch, end = (auth.seconds(command[k]) for k in ('not_before', 'dispatch_deadline', 'execution_deadline'))
    require(start <= dispatch <= end < now, 'EXECUTION_WINDOW_OPEN')
    require(value['external_ref'] == {'owner': 'python-node-health', 'adapter_id': 'node-health', 'external_id': row['id']})
    shape(value['attempt'], 'attempt_id fence mode lease_expires_at')
    auth.identifier(value['attempt']['attempt_id']); auth.integer(value['attempt']['fence'], 1)
    require(value['attempt']['mode'] in ('dispatch', 'reconcile_only'))
    auth.seconds(value['attempt']['lease_expires_at'])
    shape(journal, 'command_id identity_digest state result')
    require(journal['command_id'] == row['id'] and journal['state'] == 'unknown' and journal['result'] == UNKNOWN)
    identity = hashlib.sha256(canonical({'command': command, 'external_ref': value['external_ref']})).hexdigest()
    require(journal['identity_digest'] == identity, 'JOURNAL_IDENTITY_MISMATCH')
    decision = {'id': resolution_id, 'action': 'close_unknown', 'reason': 'operator_accepts_unknown',
                'decided_by': operator_id, 'decided_at': auth.utc(now),
                'journal_sha256': hashlib.sha256(canonical(journal)).hexdigest()}
    next_value = copy.deepcopy(value)
    next_value.update(delivery='closed_unknown', revision=row['revision'] + 1, updated_at=auth.utc(now), resolution=decision)
    raw = canonical(next_value).decode()
    require(len(raw.encode()) <= 30000)
    until = auth.utc(min(now + 60, observed + 300))
    sql = ('UPDATE commands SET record=?,revision=?,active=0 WHERE id=? AND revision=? AND active=1'
           ' AND record=? AND body=? AND body_digest=? AND submit_grant=? AND grant_revision=?'
           ' AND principal_id=? AND idem_key=? AND created_at=?'
           ' AND unixepoch()>=unixepoch(?) AND unixepoch()<unixepoch(?)')
    params = [raw, row['revision'] + 1, row['id'], row['revision'], row['record'], row['body'], row['body_digest'],
              row['submit_grant'], row['grant_revision'], row['principal_id'], row['idem_key'], row['created_at'], auth.utc(now), until]
    return {'schema_version': 'cloudlab.unknown-resolution-plan.v1', 'target': copy.deepcopy(target),
            'created_at': auth.utc(now), 'valid_until': until, 'command_id': row['id'], 'resolution': decision,
            'snapshot_sha256': hashlib.sha256(canonical(snapshot)).hexdigest(), 'approval_required': True,
            'applied': False, 'required_worker_feature': 'closed_unknown-v1', 'expected_affected_rows': 1,
            'query': {'sql': sql, 'params': params}, 'owner_outcome': 'unknown',
            'operator_checks': ['confirm original journal/config/source provenance and exact command approval',
                                'verify compatible active Worker; pause runner and drain in-flight HTTP',
                                'fresh snapshot and execute once within valid_until; require changes=1',
                                'unknown reply: read resolution ID before any new plan; never force or replay',
                                'preserve journal/history and resume original service/deadlines; no old-worker rollback']}


def make_plan(snapshot, *, operator_id, resolution_id, now):
    try:
        return _plan(snapshot, operator_id, resolution_id, now)
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError, OSError) as error:
        raise ResolutionError('INVALID_RESOLUTION_EVIDENCE') from error


def run(snapshot_path, output_path, *, operator_id, resolution_id, now=None):
    try:
        source, destination = files.canonical_path(snapshot_path), files.canonical_path(output_path)
        files.require_outside_checkout(source); files.require_outside_checkout(destination)
        plan = make_plan(files.read_private(source), operator_id=operator_id, resolution_id=resolution_id,
                         now=int(time.time()) if now is None else now)
        parent = files.open_directory(destination.parent)
        try:
            info = os.fstat(parent)
            auth.require(info.st_uid == os.geteuid() and not info.st_mode & 0o022)
            fd = os.open(destination.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            raw = files.encode(plan)
            with os.fdopen(fd, 'wb') as output:
                output.write(raw); output.flush(); os.fsync(output.fileno())
            os.fsync(parent)
        finally:
            os.close(parent)
        return {'saved': True, 'applied': False, 'sha256': hashlib.sha256(raw).hexdigest()}
    except (OSError, ValueError) as error:
        raise ResolutionError('PRIVATE_PLAN_UNAVAILABLE_OR_INVALID') from error


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True); parser.add_argument('--output', required=True)
    parser.add_argument('--operator', required=True); parser.add_argument('--resolution-id', required=True)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(run(args.snapshot, args.output, operator_id=args.operator, resolution_id=args.resolution_id)))
        return 0
    except ResolutionError as error:
        print(str(error), file=sys.stderr); return 2


if __name__ == '__main__':
    sys.exit(main())
