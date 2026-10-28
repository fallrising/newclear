#!/usr/bin/env python3
"""Bounded cloudlab.m1 node collector. Python 3.11 standard library only."""
import argparse
import fcntl
import hashlib
import http.client
import hmac
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import secrets
import signal
import sqlite3
import stat
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

MAX_JSON = 32768


class ProtocolError(ValueError):
    """Safe diagnostic without request bodies, URLs or credentials."""


class AuthenticationError(ProtocolError):
    """An operator must inspect the existing grant; do not retry forever."""


class RetryableError(ProtocolError):
    """A temporary transport or server failure; journal remains authoritative."""


class InstanceLock:
    """Lifetime advisory lock for CLI users of one canonical journal. Never unlink."""
    def __init__(self, journal_path):
        self.path = str(Path(journal_path).resolve()) + '.lock'
        self.fd = None

    def __enter__(self):
        fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                    or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600):
                raise ProtocolError('invalid runner lock')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(fd)
            raise
        self.fd = fd
        return self

    def __exit__(self, *args):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


def encode(value):
    try:
        raw = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'), sort_keys=True).encode('utf-8')
    except (ValueError, TypeError, UnicodeError, RecursionError) as exc:
        raise ProtocolError('invalid JSON value') from exc
    if len(raw) > MAX_JSON:
        raise ProtocolError('JSON exceeds byte limit')
    return raw


def strict_json(raw):
    if not isinstance(raw, bytes) or len(raw) > MAX_JSON:
        raise ProtocolError('invalid JSON size')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ProtocolError('duplicate JSON key')
            result[key] = value
        return result
    def no_number(value):
        raise ProtocolError('only integer JSON numbers allowed')
    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_float=no_number, parse_constant=no_number)
        # JSON escapes must not smuggle unpaired surrogates into valid UTF-8.
        encode(value)
        return value
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise ProtocolError('invalid strict JSON') from exc


def fields(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected.split()):
        raise ProtocolError('unexpected object fields')


def identifier(value):
    if not isinstance(value, str) or not 1 <= len(value.encode('utf-8')) <= 128 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ProtocolError('invalid identifier')
    return value


def integer(value, minimum=1, maximum=2**53 - 1):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ProtocolError('invalid integer')
    return value


def utc(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value):
        raise ProtocolError('invalid UTC timestamp')
    try:
        return int(datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp())
    except ValueError as exc:
        raise ProtocolError('invalid UTC timestamp') from exc


def refs(resource, recipe):
    fields(resource, 'resource_id generation')
    identifier(resource['resource_id'])
    integer(resource['generation'])
    fields(recipe, 'recipe_id version digest')
    if recipe['recipe_id'] != 'node-health' or recipe['version'] != '1.0.0' or not isinstance(recipe['digest'], str) or not re.fullmatch('sha256:[0-9a-f]{64}', recipe['digest']):
        raise ProtocolError('unsupported recipe')


class Config:
    @classmethod
    def from_dict(cls, value, allow_loopback_http=False):
        required = set('base_url audience credential_id generation secret_hex journal_path workspace_id resource_ref recipe_ref'.split())
        optional = {'cloudflare_access_client_id', 'cloudflare_access_client_secret'}
        if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required not in (set(), optional):
            raise ProtocolError('unexpected configuration fields')
        for key in optional & value.keys():
            item = value[key]
            if not isinstance(item, str) or not 1 <= len(item) <= 1024 or any(ord(c) < 33 or ord(c) > 126 for c in item):
                raise ProtocolError('invalid Access service credential')
        for key in ('audience', 'credential_id', 'workspace_id'):
            identifier(value[key])
            if '\n' in value[key] or '\r' in value[key]:
                raise ProtocolError('invalid signing context')
        integer(value['generation'])
        secret = value['secret_hex']
        if not isinstance(secret, str) or not re.fullmatch(r'[0-9a-fA-F]{64,}', secret) or len(secret) % 2:
            raise ProtocolError('secret must contain at least 32 bytes of hex')
        if not isinstance(value['journal_path'], str) or not value['journal_path'] or '\x00' in value['journal_path']:
            raise ProtocolError('invalid journal path')
        refs(value['resource_ref'], value['recipe_ref'])
        base = value['base_url']
        if not isinstance(base, str) or any(ord(c) < 33 or ord(c) > 126 for c in base):
            raise ProtocolError('invalid control-plane URL')
        try:
            url = urllib.parse.urlsplit(base)
            port = url.port
            valid = url.scheme == 'https'
            if url.scheme == 'http' and allow_loopback_http:
                valid = ipaddress.ip_address(url.hostname).is_loopback
            if not valid or not url.hostname or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment or (port is not None and not 1 <= port <= 65535):
                raise ProtocolError('HTTPS required; HTTP needs explicit numeric loopback opt-in')
        except (ValueError, TypeError) as exc:
            raise ProtocolError('invalid control-plane URL') from exc
        obj = cls()
        for key, item in value.items():
            if key not in ('secret_hex', 'cloudflare_access_client_secret'):
                setattr(obj, key, item)
        obj.base_url = base.rstrip('/')
        obj._secret = bytes.fromhex(secret)
        obj._access_client_secret = value.get('cloudflare_access_client_secret')
        return obj


def signed_headers(config, path, body, now=None, nonce=None):
    if path not in ('/api/runner/claim', '/api/runner/report'):
        raise ProtocolError('unsupported runner route')
    now = int(time.time()) if now is None else integer(now, 0)
    nonce = secrets.token_hex(16) if nonce is None else nonce
    if not isinstance(nonce, str) or not re.fullmatch('[0-9a-f]{32}', nonce):
        raise ProtocolError('invalid nonce')
    message = '\n'.join(['CLOUDLAB-M1', config.audience, config.credential_id, str(config.generation),
        'POST', path, str(now), nonce, hashlib.sha256(body).hexdigest()]).encode('utf-8')
    return {'Content-Type': 'application/json', 'X-Lab-Key-Id': config.credential_id,
        'X-Lab-Time': str(now), 'X-Lab-Nonce': nonce,
        'X-Lab-Signature': hmac.new(config._secret, message, hashlib.sha256).hexdigest()}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ProtocolError('control-plane redirects prohibited')


class HttpClient:
    def __init__(self, config):
        self.config = config
        # Do not send machine credentials through ambient proxy settings.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.opener.addheaders = [("User-Agent", "cloud-lab-m1/1.0")]

    def post(self, path, body):
        headers = signed_headers(self.config, path, body)
        if self.config._access_client_secret is not None:
            headers['CF-Access-Client-Id'] = self.config.cloudflare_access_client_id
            headers['CF-Access-Client-Secret'] = self.config._access_client_secret
        request = urllib.request.Request(self.config.base_url + path, body, headers, method='POST')
        try:
            with self.opener.open(request, timeout=5) as response:
                if response.status != 200 or response.headers.get_content_type() != 'application/json':
                    raise ProtocolError('invalid control-plane response')
                raw = response.read(MAX_JSON + 1)
        except urllib.error.HTTPError as exc:
            exc.close()
            if exc.code in (401, 403):
                raise AuthenticationError('control-plane authorization rejected') from exc
            if exc.code in (408, 409, 429) or 500 <= exc.code <= 599:
                raise RetryableError('control-plane temporarily unavailable') from exc
            raise ProtocolError('control-plane request rejected') from exc
        except (urllib.error.URLError, TimeoutError, OSError, http.client.IncompleteRead,
                http.client.RemoteDisconnected) as exc:
            raise RetryableError('control-plane request unavailable') from exc
        return strict_json(raw)


def validate_assignment(a, config, now):
    # JSON round-trip also rejects floats, invalid encodings and excessive size from injected clients.
    strict_json(encode(a))
    fields(a, 'command_id command attempt external_ref')
    identifier(a['command_id'])
    command = a['command']
    fields(command, 'schema_version schema_minor workspace_id resource_ref recipe_ref parameters idempotency_key not_before dispatch_deadline execution_deadline timeout_seconds output_budget_bytes')
    if command['schema_version'] != 'cloudlab.command.v1' or integer(command['schema_minor'], 0, 0) != 0:
        raise ProtocolError('unsupported command version')
    refs(command['resource_ref'], command['recipe_ref'])
    if command['workspace_id'] != config.workspace_id or command['resource_ref'] != config.resource_ref or command['recipe_ref'] != config.recipe_ref:
        raise ProtocolError('assignment outside pinned scope')
    fields(command['parameters'], 'max_sample_age_seconds')
    integer(command['parameters']['max_sample_age_seconds'], 1, 60)
    integer(command['timeout_seconds'], 10, 10)
    integer(command['output_budget_bytes'], 16384, 16384)
    identifier(command['idempotency_key'])
    start, dispatch, finish = (timestamp(command[k]) for k in ('not_before', 'dispatch_deadline', 'execution_deadline'))
    if not start <= dispatch <= finish:
        raise ProtocolError('invalid command deadline ordering')
    attempt = a['attempt']
    fields(attempt, 'attempt_id fence mode lease_expires_at')
    identifier(attempt['attempt_id'])
    integer(attempt['fence'])
    if attempt['mode'] not in ('dispatch', 'reconcile_only') or timestamp(attempt['lease_expires_at']) <= now:
        raise ProtocolError('invalid or expired attempt')
    fields(a['external_ref'], 'owner adapter_id external_id')
    if a['external_ref'] != dict(owner='python-node-health', adapter_id='node-health', external_id=a['command_id']):
        raise ProtocolError('invalid external reference')
    return start <= now < dispatch and finish - now >= command['timeout_seconds']


def identity(a):
    return hashlib.sha256(encode({'command': a['command'], 'external_ref': a['external_ref']})).hexdigest()


UNKNOWN = {'owner_outcome': 'unknown', 'started_at': None, 'finished_at': None, 'artifact': None}


class Journal:
    def __init__(self, path):
        # The containing directory is operator-owned durable state, never a temporary cache.
        self.db = sqlite3.connect(path, timeout=5, isolation_level=None)
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS executions (command_id TEXT PRIMARY KEY, identity_digest TEXT NOT NULL, external_ref BLOB NOT NULL, state TEXT NOT NULL CHECK(state IN (\'started\',\'completed\',\'unknown\')), result BLOB)')
        os.chmod(path, 0o600)

    def close(self):
        self.db.close()

    def lookup(self, a):
        row = self.db.execute('SELECT identity_digest, state, result FROM executions WHERE command_id=?', (a['command_id'],)).fetchone()
        if row is None:
            return None
        if row[0] != identity(a):
            raise ProtocolError('immutable command or reference changed')
        return row[1], strict_json(row[2]) if row[2] is not None else dict(UNKNOWN)

    def start(self, a, unknown=False):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            existing = self.lookup(a)
            if existing is not None:
                self.db.execute('COMMIT')
                return False
            self.db.execute('INSERT INTO executions VALUES (?, ?, ?, ?, ?)',
                (a['command_id'], identity(a), encode(a['external_ref']), 'unknown' if unknown else 'started',
                 encode(UNKNOWN) if unknown else None))
            self.db.execute('COMMIT')
            return True
        except BaseException:
            if self.db.in_transaction:
                self.db.execute('ROLLBACK')
            raise

    def complete(self, a, result):
        raw = encode(result)
        self.db.execute('BEGIN IMMEDIATE')
        try:
            current = self.lookup(a)
            if current is None or current[0] != 'started':
                raise ProtocolError('journal completion conflict')
            self.db.execute('UPDATE executions SET state=?, result=? WHERE command_id=?',
                ('completed' if result['owner_outcome'] == 'succeeded' else 'unknown', raw, a['command_id']))
            self.db.execute('COMMIT')
        except BaseException:
            if self.db.in_transaction:
                self.db.execute('ROLLBACK')
            raise


def metric_health(metrics):
    fields(metrics, 'load_1m_milli cpu_count disk_free_percent')
    load = integer(metrics['load_1m_milli'], 0)
    cpus = integer(metrics['cpu_count'])
    free = integer(metrics['disk_free_percent'], 0, 100)
    return 'healthy' if load <= cpus * 2000 and free >= 10 else 'unhealthy'


def fixed_collector():
    # Fixed OS observation boundaries; never accept a path, hostname or command.
    load = os.getloadavg()[0]
    if type(load) not in (float, int) or not math.isfinite(load) or load < 0:
        raise ProtocolError('load observation unavailable')
    cpus = integer(os.cpu_count())
    disk = os.statvfs('/')
    blocks = integer(disk.f_blocks)
    available = integer(disk.f_bavail, 0, blocks)
    metrics = {'load_1m_milli': integer(math.floor(load * 1000), 0),
        'cpu_count': cpus, 'disk_free_percent': available * 100 // blocks}
    return {'status': metric_health(metrics), 'sample_age_seconds': 0,
        'checks': {'collector': 'ok'}, 'metrics': metrics}


def validate_artifact(value):
    fields(value, 'status sample_age_seconds checks metrics')
    if value['status'] != metric_health(value['metrics']):
        raise ProtocolError('invalid collector status')
    integer(value['sample_age_seconds'], 0, 0)
    fields(value['checks'], 'collector')
    if value['checks']['collector'] != 'ok':
        raise ProtocolError('invalid collector check')
    raw = encode(value)
    if len(raw) > 16384:
        raise ProtocolError('collector output exceeds budget')
    return raw.decode('utf-8')


class Runner:
    def __init__(self, config, journal, client=None, collector=None, clock=None):
        if not hasattr(os, 'geteuid') or os.geteuid() == 0:
            raise ProtocolError('runner requires a non-root operating-system user')
        self.config, self.journal = config, journal
        self.client = client or HttpClient(config)
        self.collector = collector or fixed_collector
        self.clock = clock or time.time

    def run_once(self):
        response = self.client.post('/api/runner/claim', b'{}')
        fields(response, 'assignment request_id')
        identifier(response['request_id'])
        a = response['assignment']
        if a is None:
            return False
        runnable = validate_assignment(a, self.config, int(self.clock()))
        current = self.journal.lookup(a)
        if current is None:
            execute = a['attempt']['mode'] == 'dispatch' and runnable
            if self.journal.start(a, unknown=not execute) and execute:
                started = utc(self.clock())
                try:
                    # A slow journal commit must not consume the remaining execution window.
                    if not validate_assignment(a, self.config, timestamp(started)):
                        raise ProtocolError('execution window elapsed before collection')
                    artifact = validate_artifact(self.collector())
                    finished_seconds = int(self.clock())
                    result = dict(owner_outcome='succeeded', started_at=started,
                        finished_at=utc(finished_seconds), artifact=artifact)
                    if (not timestamp(started) <= finished_seconds <= timestamp(a['command']['execution_deadline'])
                            or finished_seconds - timestamp(started) > a['command']['timeout_seconds']):
                        result = dict(UNKNOWN)
                except Exception:
                    result = dict(UNKNOWN)
                # Persist completion before any network reporting. Journal errors stop the cycle.
                self.journal.complete(a, result)
            current = self.journal.lookup(a)
        report = dict(current[1], command_id=a['command_id'], attempt_id=a['attempt']['attempt_id'], fence=a['attempt']['fence'])
        ack = self.client.post('/api/runner/report', encode(report))
        fields(ack, 'command request_id')
        identifier(ack['request_id'])
        if not isinstance(ack['command'], dict) or ack['command'].get('command_id') != a['command_id']:
            raise ProtocolError('report acknowledgement mismatch')
        return True


def log_event(**event):
    print(encode(dict(event, at=utc(time.time()))).decode(), flush=True)


def resident_loop(runner, stop, *, stop_at, poll_seconds=30, clock=time.time,
                  monotonic=time.monotonic, emit=log_event):
    integer(poll_seconds, 5, 60)
    deadline = monotonic() + max(0, stop_at - clock())
    backoff = poll_seconds
    while not stop.is_set():
        if clock() >= stop_at or monotonic() >= deadline:
            emit(event='stopped', reason='deadline')
            return 0
        delay = poll_seconds
        try:
            worked = runner.run_once()
            emit(event='reported' if worked else 'idle')
            backoff = poll_seconds
        except RetryableError:
            delay = backoff
            backoff = min(120, backoff * 2)
            emit(event='retry', delay_seconds=delay)
        except (ProtocolError, OSError, sqlite3.Error) as exc:
            emit(event='fatal', reason='authorization' if isinstance(exc, AuthenticationError) else 'protocol_or_journal')
            return 1
        if not stop.is_set():
            stop.wait(max(0, min(delay, stop_at - clock(), deadline - monotonic())))
    emit(event='stopped', reason='signal')
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, help='private JSON configuration file')
    parser.add_argument('--once', action='store_true', help='one claim and at most one report')
    parser.add_argument('--stop-at', help='required for resident mode: earliest grant expiry as UTC YYYY-MM-DDTHH:MM:SSZ')
    parser.add_argument('--poll-seconds', type=int, default=30, help='resident poll interval, 5 to 60 seconds')
    parser.add_argument('--allow-loopback-http', action='store_true', help='explicit local-test transport only')
    args = parser.parse_args(argv)
    journal = None
    lock = None
    handlers = {}
    try:
        if not hasattr(os, 'geteuid') or os.geteuid() == 0:
            raise ProtocolError('runner requires a non-root operating-system user')
        integer(args.poll_seconds, 5, 60)
        stop_at = timestamp(args.stop_at) if args.stop_at else None
        if not args.once and stop_at is None:
            raise ProtocolError('resident mode requires an explicit stop-at')
        path = Path(args.config)
        if path.stat().st_mode & 0o077:
            raise ProtocolError('configuration must be private to its owner (mode 0600)')
        with path.open('rb') as handle:
            config = Config.from_dict(strict_json(handle.read(MAX_JSON + 1)), args.allow_loopback_http)
        journal_path = Path(config.journal_path)
        if not journal_path.is_absolute():
            config.journal_path = str(path.resolve().parent / journal_path)
        lock = InstanceLock(config.journal_path)
        lock.__enter__()
        stop = threading.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            handlers[sig] = signal.signal(sig, lambda *_: stop.set())
        journal = Journal(config.journal_path)
        runner = Runner(config, journal)
        if args.once:
            if stop_at is not None and time.time() >= stop_at:
                log_event(event='stopped', reason='deadline')
                return 0
            if not stop.is_set():
                runner.run_once()
                print('runner cycle complete', flush=True)
            return 0
        return resident_loop(runner, stop, stop_at=stop_at, poll_seconds=args.poll_seconds)
    except (ProtocolError, OSError, sqlite3.Error, ValueError):
        print('runner configuration or journal unavailable', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        if journal is not None:
            journal.close()
        if lock is not None:
            lock.__exit__()
        for sig, handler in handlers.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    sys.exit(main())
