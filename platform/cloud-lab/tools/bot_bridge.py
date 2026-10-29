#!/usr/bin/env python3
"""One fixed bot request per process; no model invocation or arbitrary execution."""
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
import uuid

_spec = importlib.util.spec_from_file_location('bot_probe', Path(__file__).with_name('live_probe.py'))
probe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(probe)
protocol = probe._protocol
MAX_INPUT = 4096
POLICY_CODES = {'INVALID_POLICY', 'POLICY_CONTEXT_MISMATCH', 'POLICY_REQUIRED',
                'POLICY_NOT_INITIALIZED', 'POLICY_ALREADY_INITIALIZED', 'POLICY_EXPIRED',
                'POLICY_NOT_STARTED', 'POLICY_CLOCK_ROLLBACK', 'POLICY_CALL_LIMIT',
                'POLICY_NEW_REQUEST_LIMIT', 'POLICY_RATE_LIMITED'}
DELIVERIES = {'accepted', 'dispatching', 'reconciling', 'result_recorded',
              'cancelled_before_dispatch', 'expired_before_dispatch'}


class BridgeError(ValueError):
    """Stable codes only: never expose paths, server messages or credentials."""


def require(ok, code):
    if not ok:
        raise BridgeError(code)


def parse_request(raw):
    require(isinstance(raw, bytes) and len(raw) <= MAX_INPUT, 'INVALID_REQUEST')
    try:
        value = protocol.strict_json(raw)
        require(isinstance(value, dict) and set(value) == {'schema_version', 'operation', 'request_id'}, 'INVALID_REQUEST')
        require(value['schema_version'] == 'cloudlab.bot-request.v1' and value['operation'] in ('health.check', 'health.status'), 'INVALID_REQUEST')
        rid = value['request_id']
        require(isinstance(rid, str) and str(uuid.UUID(rid)) == rid and uuid.UUID(rid).version == 4, 'INVALID_REQUEST')
        return value
    except (ValueError, TypeError, AttributeError):
        raise BridgeError('INVALID_REQUEST') from None


def private_fd(parent, name):
    fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=parent)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1, 'UNSAFE_STATE')
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextmanager
def journal(directory):
    """Owner-only Linux state, one caller at a time; no cleanup or WAL mode."""
    root = Path(os.path.abspath(directory))
    require(not any((p/'.git').exists() or (p/'.git').is_symlink() for p in (root, *root.parents)), 'UNSAFE_STATE')
    parent = probe.directory_fd(root)
    lock = None
    db = None
    try:
        info = os.fstat(parent)
        require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700, 'UNSAFE_STATE')
        lock = private_fd(parent, 'bridge.lock')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BridgeError('STATE_BUSY') from None
        fd = private_fd(parent, 'requests.sqlite')
        os.close(fd)
        os.fsync(parent)
        # Pinned directory descriptor avoids following a replaced path ancestor.
        db = sqlite3.connect(f'/proc/self/fd/{parent}/requests.sqlite', timeout=0)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA journal_mode=DELETE')
        db.execute('PRAGMA synchronous=FULL')
        db.execute('CREATE TABLE IF NOT EXISTS requests (request_id TEXT PRIMARY KEY, profile TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, command_id TEXT)')
        db.commit()
        os.fsync(parent)
        yield db
    finally:
        if db is not None:
            db.close()
        if lock is not None:
            os.close(lock)
        os.close(parent)



def read_policy(path, fingerprint):
    try:
        value = protocol.strict_json(probe.private_read(path))
        keys = {'schema_version', 'config_sha256', 'not_before', 'expires_at', 'authority_until',
                'max_calls', 'max_new_requests', 'call_interval_seconds', 'new_request_interval_seconds'}
        require(isinstance(value, dict) and set(value) == keys, 'INVALID_POLICY')
        require(value['schema_version'] == 'cloudlab.bot-policy.v1', 'INVALID_POLICY')
        for key, low, high in (('max_calls', 1, 240), ('max_new_requests', 1, 24),
                               ('call_interval_seconds', 5, 86400),
                               ('new_request_interval_seconds', 60, 86400)):
            require(type(value[key]) is int and low <= value[key] <= high, 'INVALID_POLICY')
        start, end, authority = (protocol.timestamp(value[k]) for k in
                                 ('not_before', 'expires_at', 'authority_until'))
        require(0 < end-start <= 86400 and end <= authority, 'INVALID_POLICY')
        require(value['config_sha256'] == fingerprint, 'POLICY_CONTEXT_MISMATCH')
        return value, hashlib.sha256(probe.encode(value)).hexdigest()
    except BridgeError:
        raise
    except (probe.ProbeError, OSError, ValueError, TypeError, KeyError):
        raise BridgeError('INVALID_POLICY') from None


def policy_time(policy, now, high_water):
    require(type(now) in (int, float) and math.isfinite(now), 'POLICY_CLOCK_ROLLBACK')
    require(now >= high_water, 'POLICY_CLOCK_ROLLBACK')
    require(now >= protocol.timestamp(policy['not_before']), 'POLICY_NOT_STARTED')
    require(now < protocol.timestamp(policy['expires_at']), 'POLICY_EXPIRED')


def observe_policy_time(db, policy, now, high_water):
    # Remember even rejected observations: expiry must not be undone by rollback.
    require(type(now) in (int, float) and math.isfinite(now), 'POLICY_CLOCK_ROLLBACK')
    db.execute('UPDATE bot_policy SET high_water=? WHERE id=1', (max(now, high_water),))
    db.commit()
    policy_time(policy, now, high_water)


def config_identity(path, allow_loopback_http):
    config = protocol.strict_json(probe.private_read(path))
    protocol.Config.from_dict(config, allow_loopback_http=allow_loopback_http)
    require(config['recipe_ref']['recipe_id'] == 'node-health', 'UNSUPPORTED_RECIPE')
    return config, hashlib.sha256(probe.encode(config)).hexdigest()


def initialize_policy(config_path, state_dir, policy_path, *, allow_loopback_http=False, clock=time.time):
    """Explicit offline provisioning; never replace a policy or reset its ledger."""
    try:
        _, fingerprint = config_identity(config_path, allow_loopback_http)
        policy, digest = read_policy(policy_path, fingerprint)
        now = clock()
        policy_time(policy, now, protocol.timestamp(policy['not_before']))
        with journal(state_dir) as db:
            exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='bot_policy'").fetchone()
            require(exists is None, 'POLICY_ALREADY_INITIALIZED')
            db.execute('BEGIN IMMEDIATE')
            db.execute('CREATE TABLE bot_policy (id INTEGER PRIMARY KEY CHECK(id=1), digest TEXT NOT NULL, calls INTEGER NOT NULL, high_water REAL NOT NULL, last_call REAL, last_new REAL)')
            db.execute('CREATE TABLE bot_reservations (request_id TEXT PRIMARY KEY)')
            db.execute('INSERT INTO bot_policy VALUES(1,?,0,?,NULL,NULL)', (digest, now))
            db.commit()
        return {'schema_version': 'cloudlab.bot-policy-initialized.v1', 'expires_at': policy['expires_at']}
    except BridgeError:
        raise
    except (probe.ProbeError, OSError, ValueError, TypeError, KeyError, sqlite3.Error):
        raise BridgeError('CONFIG_OR_STATE_UNAVAILABLE') from None


def admit_policy(db, path, fingerprint, request, saved, now):
    """Call and new-ID reservations commit under the same FLOCK before any I/O."""
    exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='bot_policy'").fetchone()
    if path is None:
        require(exists is None, 'POLICY_REQUIRED')
        return None
    policy, digest = read_policy(path, fingerprint)
    require(exists is not None, 'POLICY_NOT_INITIALIZED')
    rows = db.execute('SELECT * FROM bot_policy').fetchall()
    require(len(rows) == 1 and rows[0]['id'] == 1, 'STATE_CORRUPT')
    row = rows[0]
    require(row['digest'] == digest, 'POLICY_CONTEXT_MISMATCH')
    require(type(row['calls']) is int and 0 <= row['calls'] <= policy['max_calls'], 'STATE_CORRUPT')
    for key in ('high_water', 'last_call', 'last_new'):
        require(row[key] is None and key != 'high_water' or
                type(row[key]) in (int, float) and math.isfinite(row[key]), 'STATE_CORRUPT')
    observe_policy_time(db, policy, now, row['high_water'])
    require(row['calls'] < policy['max_calls'], 'POLICY_CALL_LIMIT')
    require(row['last_call'] is None or now-row['last_call'] >= policy['call_interval_seconds'], 'POLICY_RATE_LIMITED')
    reserved = db.execute('SELECT 1 FROM bot_reservations WHERE request_id=?', (request['request_id'],)).fetchone()
    is_new = request['operation'] == 'health.check' and saved is None and reserved is None
    if is_new:
        count = db.execute('SELECT count(*) FROM bot_reservations').fetchone()[0]
        require(count < policy['max_new_requests'], 'POLICY_NEW_REQUEST_LIMIT')
        require(row['last_new'] is None or now-row['last_new'] >= policy['new_request_interval_seconds'], 'POLICY_RATE_LIMITED')
        db.execute('INSERT INTO bot_reservations VALUES(?)', (request['request_id'],))
    db.execute('UPDATE bot_policy SET calls=calls+1, last_call=?, last_new=? WHERE id=1',
               (now, now if is_new else row['last_new']))
    db.commit()
    return policy


def response(request, state, code, command_id=None):
    return {'schema_version': 'cloudlab.bot-response.v1', 'request_id': request['request_id'],
            'operation': request['operation'], 'state': state, 'code': code,
            'command_id': command_id, 'verified': False, 'health': None, 'observed_at': None}


def project(request, value, command, known_id, now):
    require(isinstance(value, dict) and value.get('command') == command, 'OBSERVATION_MISMATCH')
    command_id = value.get('command_id')
    require(isinstance(command_id, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', command_id)
            and (known_id is None or command_id == known_id), 'OBSERVATION_MISMATCH')
    delivery = value.get('delivery')
    require(isinstance(delivery, str) and delivery in DELIVERIES, 'INVALID_RESPONSE')
    out = response(request, 'unknown' if delivery == 'reconciling' else delivery, 'OBSERVED', command_id)
    if delivery != 'result_recorded':
        return out
    result = value.get('result')
    require(isinstance(result, dict) and isinstance(result.get('validation'), dict), 'INVALID_RESPONSE')
    try:
        finished = protocol.timestamp(result.get('finished_at'))
        # A result outside the execution window cannot be called verified here.
        within = protocol.timestamp(command['not_before']) <= finished <= protocol.timestamp(command['execution_deadline'])
    except (ValueError, TypeError):
        raise BridgeError('INVALID_RESPONSE') from None
    out['observed_at'] = result['finished_at']
    valid = (result.get('owner_outcome') == 'succeeded' and result['validation'].get('status') == 'passed'
             and result.get('health') in ('healthy', 'unhealthy') and within)
    age = int(now) - finished
    if valid and age > command['parameters']['max_sample_age_seconds']:
        out.update(state='stale', code='STALE_OBSERVATION')
    elif valid and 0 <= age <= command['parameters']['max_sample_age_seconds']:
        out.update(state='validated', code='FRESH_VALIDATED_OBSERVATION', verified=True, health=result['health'])
    else:
        out.update(state='unverified', code='UNVERIFIED_OBSERVATION')
    return out


def handle(raw, config_path, state_dir, *, allow_submit=False, allow_loopback_http=False,
           transport=None, clock=time.time, policy_path=None):
    request = parse_request(raw)
    require(request['operation'] != 'health.check' or allow_submit is True, 'SUBMIT_NOT_ENABLED')
    try:
        config, fingerprint = config_identity(config_path, allow_loopback_http)
        send = transport or probe.HTTPSClient(config['base_url'].rstrip('/'), auth_status_only=True)
        with journal(state_dir) as db:
            saved = db.execute('SELECT * FROM requests WHERE request_id=?', (request['request_id'],)).fetchone()
            if saved is not None:
                require(saved['profile'] == fingerprint, 'CONTEXT_MISMATCH')
                payload = saved['payload'].encode()
                require(hashlib.sha256(payload).hexdigest() == saved['digest'], 'STATE_CORRUPT')
                command = protocol.strict_json(payload)
                require(isinstance(command, dict) and command.get('idempotency_key') == request['request_id']
                        and all(command.get(k) == config[k] for k in ('workspace_id', 'resource_ref', 'recipe_ref')), 'STATE_CORRUPT')
                known = saved['command_id']
                require(known is None or isinstance(known, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', known), 'STATE_CORRUPT')
            else:
                known = None
            admitted_at = clock()
            policy = admit_policy(db, policy_path, fingerprint, request, saved, admitted_at)
            if saved is None and request['operation'] == 'health.status':
                return response(request, 'not_found', 'NO_LOCAL_REQUEST')
            if saved is not None and known is None and request['operation'] == 'health.status':
                return response(request, 'unconfirmed', 'ACK_UNCONFIRMED')

            def signed(method, path, body=b''):
                now = clock()
                if policy is not None:
                    row = db.execute('SELECT high_water FROM bot_policy WHERE id=1').fetchone()
                    observe_policy_time(db, policy, now, row['high_water'])
                return send(method, path, body, probe.sign_headers(config, method, path, body, now))

            # Network/server uncertainty is projected; private state errors remain explicit.
            try:
                if saved is None:
                    status, bootstrap = signed('GET', '/api/bootstrap')
                    if status in (401, 403):
                        return response(request, 'denied', 'AUTHORIZATION_DENIED')
                    if status != 200:
                        return response(request, 'unconfirmed', 'BOOTSTRAP_UNAVAILABLE')
                    require(isinstance(bootstrap, dict) and all(bootstrap.get(k) == config[k]
                            for k in ('workspace_id', 'resource_ref', 'recipe_ref')), 'SCOPE_MISMATCH')
                    caps = bootstrap.get('capabilities')
                    require(isinstance(caps, list) and all(isinstance(c, str) for c in caps)
                            and {'commands:read', 'commands:submit', 'node:health:read'} <= set(caps), 'SCOPE_MISMATCH')
                    start = protocol.timestamp(bootstrap.get('now'))
                    require(abs(start-int(clock())) <= 120, 'SERVER_TIME_INVALID')
                    command = {'schema_version':'cloudlab.command.v1', 'schema_minor':0,
                        **{k:config[k] for k in ('workspace_id','resource_ref','recipe_ref')},
                        'parameters':{'max_sample_age_seconds':30}, 'idempotency_key':request['request_id'],
                        'not_before':probe.utc(start), 'dispatch_deadline':probe.utc(start+60),
                        'execution_deadline':probe.utc(start+120), 'timeout_seconds':10, 'output_budget_bytes':16384}
                    payload = probe.encode(command)
                    db.execute('INSERT INTO requests VALUES(?,?,?,?,NULL)',
                               (request['request_id'], fingerprint, payload.decode(), hashlib.sha256(payload).hexdigest()))
                    db.commit()  # FULL synchronous commit completes before any POST.
                if known is not None:
                    status, body = signed('GET', '/api/commands/'+known)
                    expected = 200
                else:
                    status, body = signed('POST', '/api/commands', payload)
                    expected = 202
                if status in (401, 403):
                    return response(request, 'denied', 'AUTHORIZATION_DENIED', known)
                if status != expected:
                    return response(request, 'unconfirmed', 'REMOTE_UNCONFIRMED', known)
                require(isinstance(body, dict), 'INVALID_RESPONSE')
                out = project(request, body.get('command'), command, known, clock())
                if known is None:
                    db.execute('UPDATE requests SET command_id=? WHERE request_id=? AND command_id IS NULL',
                               (out['command_id'], request['request_id']))
                    db.commit()
                return out
            except BridgeError as error:
                return response(request, 'error' if str(error) in ('SCOPE_MISMATCH', 'SERVER_TIME_INVALID') else 'unconfirmed', str(error), known)
            except (probe.ProbeError, OSError, ValueError, TypeError, KeyError):
                return response(request, 'unconfirmed', 'TRANSPORT_OR_RESPONSE_UNCONFIRMED', known)
    except BridgeError:
        raise
    except (probe.ProbeError, OSError, ValueError, TypeError, KeyError, sqlite3.Error):
        raise BridgeError('CONFIG_OR_STATE_UNAVAILABLE') from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--allow-submit', action='store_true')
    parser.add_argument('--policy', help='trusted private policy; requires explicit initialization')
    parser.add_argument('--initialize-policy', action='store_true', help='offline, once per original state')
    parser.add_argument('--allow-loopback-http', action='store_true', help='numeric loopback tests only')
    args = parser.parse_args(argv)
    try:
        if args.initialize_policy:
            require(args.policy is not None, 'INVALID_POLICY')
            print(json.dumps(initialize_policy(args.config, args.state_dir, args.policy,
                             allow_loopback_http=args.allow_loopback_http)))
            return 0
        out = handle(sys.stdin.buffer.read(MAX_INPUT+1), args.config, args.state_dir,
                     allow_submit=args.allow_submit, allow_loopback_http=args.allow_loopback_http, policy_path=args.policy)
        print(json.dumps(out, separators=(',', ':')))
        return 1 if out['state'] in ('unconfirmed', 'denied', 'error') else 0
    except BridgeError as error:
        print(json.dumps({'schema_version':'cloudlab.bot-error.v1', 'code':str(error)}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
