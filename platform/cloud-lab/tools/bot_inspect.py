#!/usr/bin/env python3
"""Read local bot policy and quota without contacting the control plane."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import time

_spec = importlib.util.spec_from_file_location('inspection_bridge', Path(__file__).with_name('bot_bridge.py'))
bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bridge)
require = bridge.require
MAX_DB_BYTES = 16 * 1024 * 1024
MAX_REQUESTS = 10000
MAX_PENDING = 20


def existing_file(parent, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1, 'UNSAFE_STATE')
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextmanager
def readonly_journal(directory):
    """Existing DELETE-mode bridge state only; no SQLite recovery or sidecar writes."""
    root = Path(os.path.abspath(directory))
    require(not any((p/'.git').exists() or (p/'.git').is_symlink() for p in (root, *root.parents)), 'UNSAFE_STATE')
    parent = bridge.probe.directory_fd(root)
    lock = data = db = None
    try:
        info = os.fstat(parent)
        require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700, 'UNSAFE_STATE')
        lock = existing_file(parent, 'bridge.lock')
        try:
            fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            raise bridge.BridgeError('STATE_BUSY') from None
        for suffix in ('-journal', '-wal', '-shm'):
            try:
                os.stat('requests.sqlite'+suffix, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                continue
            raise bridge.BridgeError('STATE_RECOVERY_REQUIRED')
        data = existing_file(parent, 'requests.sqlite')
        require(os.fstat(data).st_size <= MAX_DB_BYTES, 'STATE_TOO_LARGE')
        # immutable disables recovery/sidecars. The shared FLOCK excludes supported writers;
        # rejecting every existing journal above prevents silently ignoring pending writes.
        db = sqlite3.connect(f'file:/proc/self/fd/{data}?mode=ro&immutable=1', uri=True, timeout=0)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        db.execute('PRAGMA trusted_schema=OFF')
        steps = 0
        def bounded_query():
            nonlocal steps
            steps += 1
            return steps >= 2000  # At most two million SQLite VM instructions per observation.
        db.set_progress_handler(bounded_query, 1000)
        yield db
    finally:
        if db is not None:
            db.close()
        for fd in (data, lock, parent):
            if fd is not None:
                os.close(fd)


def request_id(value):
    bridge.parse_request(bridge.probe.encode({'schema_version':'cloudlab.bot-request.v1',
                         'operation':'health.status', 'request_id':value}))
    return value


def local_admission(policy, row, now, state, reserved, *, new):
    def result(code, wait=None):
        return {'allowed':code == 'LOCAL_POLICY_READY', 'code':code, 'wait_seconds':wait}
    if state != 'active':
        return result('POLICY_'+state.upper())
    if row['calls'] >= policy['max_calls']:
        return result('POLICY_CALL_LIMIT')
    wait = max(0, (row['last_call'] or 0)+policy['call_interval_seconds']-now)
    if new and reserved >= policy['max_new_requests']:
        return result('POLICY_NEW_REQUEST_LIMIT')
    if new:
        wait = max(wait, (row['last_new'] or 0)+policy['new_request_interval_seconds']-now)
    wait = math.ceil(wait)
    if now+wait >= bridge.protocol.timestamp(policy['expires_at']):
        return result('POLICY_WINDOW_TOO_SHORT')
    return result('POLICY_RATE_LIMITED', wait) if wait else result('LOCAL_POLICY_READY', 0)


def inspect_policy(config_path, state_dir, policy_path, *, clock=time.time):
    """A local observation, never a remote authorization or result verification."""
    try:
        config, fingerprint = bridge.config_identity(config_path, False)
        policy, digest = bridge.read_policy(policy_path, fingerprint)
        with readonly_journal(state_dir) as db:
            require(db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bot_policy'").fetchone()
                    is not None, 'POLICY_NOT_INITIALIZED')
            row = bridge.policy_row(db, policy, digest)
            require(all(row[k] is None or row[k] <= row['high_water'] for k in ('last_call', 'last_new')), 'STATE_CORRUPT')
            rows = db.execute('SELECT * FROM requests ORDER BY request_id LIMIT ?', (MAX_REQUESTS+1,)).fetchall()
            require(len(rows) <= MAX_REQUESTS, 'STATE_TOO_LARGE')
            reservations = db.execute('SELECT request_id FROM bot_reservations ORDER BY request_id LIMIT 25').fetchall()
            require(len(reservations) <= policy['max_new_requests'] and len(reservations) <= row['calls'], 'STATE_CORRUPT')
            reserved = {request_id(r[0]) for r in reservations}
            require(len(reserved) == len(reservations), 'STATE_CORRUPT')
            pending, saved = [], set()
            acked = 0
            for item in rows:
                rid = request_id(item['request_id'])
                require(rid not in saved and item['profile'] == fingerprint, 'STATE_CORRUPT')
                saved.add(rid)
                require(isinstance(item['payload'], str), 'STATE_CORRUPT')
                payload = item['payload'].encode()
                require(hashlib.sha256(payload).hexdigest() == item['digest'], 'STATE_CORRUPT')
                command = bridge.protocol.strict_json(payload)
                require(isinstance(command, dict) and command.get('idempotency_key') == rid and
                        all(command.get(k) == config[k] for k in ('workspace_id', 'resource_ref', 'recipe_ref')), 'STATE_CORRUPT')
                known = item['command_id']
                require(known is None or isinstance(known, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', known), 'STATE_CORRUPT')
                if known is None:
                    pending.append({'request_id':rid, 'state':'ack_unconfirmed'})
                else:
                    acked += 1
            gaps = sorted(reserved-saved)
            pending.extend({'request_id':rid, 'state':'reserved_without_payload'} for rid in gaps)
            pending.sort(key=lambda item:item['request_id'])
            now = clock()
            require(type(now) in (int, float) and math.isfinite(now), 'POLICY_CLOCK_ROLLBACK')
            state = 'active'
            if now < row['high_water']:
                state = 'clock_rollback'
            elif now < bridge.protocol.timestamp(policy['not_before']):
                state = 'not_started'
            elif now >= bridge.protocol.timestamp(policy['expires_at']):
                state = 'expired'
            quota = lambda used, limit: {'used':used, 'limit':limit, 'remaining':limit-used}
            return {'schema_version':'cloudlab.bot-inspection.v1', 'observed_at':bridge.probe.utc(int(now)),
                    'state':state, 'not_before':policy['not_before'], 'expires_at':policy['expires_at'],
                    'authority_until':policy['authority_until'], 'authority_source':'saved_policy',
                    'remote_authorization':'not_checked', 'remote_results':'not_checked',
                    'seconds_remaining':None if state == 'clock_rollback' else max(0, math.floor(bridge.protocol.timestamp(policy['expires_at'])-now)),
                    'quota':{'calls':quota(row['calls'],policy['max_calls']),
                             'new_requests':quota(len(reserved),policy['max_new_requests'])},
                    'local_admission':{name:local_admission(policy,row,now,state,len(reserved),new=new)
                                       for name,new in (('existing_request',False),('new_request',True))},
                    'requests':{'total':len(rows), 'acked':acked, 'unconfirmed':len(rows)-acked,
                                'reserved_without_payload':len(gaps)},
                    'pending':pending[:MAX_PENDING], 'pending_truncated':len(pending)>MAX_PENDING}
    except bridge.BridgeError:
        raise
    except (bridge.probe.ProbeError, OSError, ValueError,
            TypeError, KeyError, IndexError, RecursionError, sqlite3.Error, OverflowError):
        raise bridge.BridgeError('CONFIG_OR_STATE_UNAVAILABLE') from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--policy', required=True)
    args = parser.parse_args(argv)
    try:
        out = inspect_policy(args.config, args.state_dir, args.policy)
        print(json.dumps(out, separators=(',', ':'), allow_nan=False))
        return 0
    except bridge.BridgeError as error:
        print(json.dumps({'schema_version':'cloudlab.bot-inspection-error.v1', 'code':str(error)}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
