#!/usr/bin/env python3
"""Test-only synthetic sources and durable delivery capture; standard library only."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import http.client
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

MAX_BODY = 4 * 1024 * 1024
TIMEOUT = 10
ID_PATTERN = re.compile(r'[a-z][a-z0-9-]{0,63}:(?:[1-9][0-9]*|digest:[0-9]+)\Z')
TIMESTAMP_PATTERN = re.compile(r'(?:0|[1-9][0-9]*)\Z')
SIGNATURE_PATTERN = re.compile(r'v1=[0-9a-f]{64}\Z')


class FixtureError(Exception):
    """Fixed diagnostics safe to print without credential or payload values."""


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def encoded(value):
    return json.dumps(value, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate key')
            result[key] = value
        return result
    def invalid(_):
        raise ValueError('nonfinite number')
    def finite_float(value):
        parsed = float(value)
        if not math.isfinite(parsed):
            raise ValueError('nonfinite number')
        return parsed
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                      parse_constant=invalid, parse_float=finite_float)


def connect(path):
    db = sqlite3.connect(path, timeout=TIMEOUT)
    db.execute('PRAGMA synchronous=FULL')
    return db


@contextmanager
def database(path):
    db = connect(path)
    try:
        with db:
            yield db
    finally:
        db.close()


def envelope(kind, run_index):
    event_type = {'release': 'release.deploy.succeeded',
                  'inspection': 'inspection.check.passed'}[kind]
    return encoded({'specversion': '1.0', 'id': 'docker-' + str(uuid.uuid4()),
                    'source': 'urn:example:' + kind + ':docker', 'type': event_type,
                    'time': utc_now(), 'summary': 'Synthetic Docker test completed ' + kind + ' run',
                    'data': {'synthetic': True, 'environment': 'Docker test',
                             'run_index': run_index, 'result': 'succeeded' if kind == 'release' else 'passed'}})


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise FixtureError('invalid test endpoint URL')


def post(url, token, body, content_type='application/json'):
    validate_url(url)
    request = urllib.request.Request(url, data=body, method='POST', headers={
        'Authorization': 'Bearer ' + token.decode('ascii'),
        'Content-Type': content_type})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        response = opener.open(request, timeout=TIMEOUT)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(MAX_BODY + 1)
        if len(raw) > MAX_BODY:
            raise FixtureError('upstream response too large')
        return response.code, raw


def check_receipt(status, raw):
    try:
        result = strict_json(raw)
    except (ValueError, UnicodeError, RecursionError):
        raise FixtureError('invalid receipt JSON') from None
    if (not isinstance(result, dict) or type(result.get('seq')) is not int or result['seq'] < 1
            or 'error' in result or type(status) is not int or status not in (200, 202)
            or (status == 200 and result.get('duplicate') is not True)):
        raise FixtureError('invalid acceptance receipt')


def load_token(path):
    token = Path(path).read_bytes().strip()
    if not token or any(byte < 33 or byte > 126 for byte in token):
        raise FixtureError('invalid bearer credential file')
    return token


def send_run(db, run_index, url, token, body, sleep):
    for attempt in range(3):
        try:
            status, raw = post(url, token, body, content_type='application/cloudevents+json')
        except (OSError, urllib.error.URLError, http.client.HTTPException):
            status, raw = 0, b''
        with db:
            db.execute('INSERT INTO attempts(run_index,status,response,observed_at) VALUES(?,?,?,?)',
                       (run_index, status, raw, utc_now()))
        if status in (0, 429, 503):
            if attempt < 2:
                sleep(0.25 * (2 ** attempt))
                continue
            raise FixtureError('producer transient retry budget exhausted')
        check_receipt(status, raw)
        with db:
            db.execute('UPDATE runs SET receipt_status=?,receipt_body=? WHERE run_index=?',
                       (status, raw, run_index))
        return


def produce(kind, url, token_file, state_dir, interval, count, sleep=time.sleep):
    validate_url(url)
    if interval <= 0 or not math.isfinite(interval) or count < 0:
        raise FixtureError('interval must be positive and count nonnegative')
    token = load_token(token_file)
    state_dir = Path(state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    with (state_dir / 'producer.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise FixtureError('producer state is already in use') from None
        with database(state_dir / 'producer.sqlite') as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS runs(
                run_index INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
                body BLOB NOT NULL, receipt_status INTEGER, receipt_body BLOB);
                CREATE TABLE IF NOT EXISTS attempts(
                seq INTEGER PRIMARY KEY AUTOINCREMENT,run_index INTEGER NOT NULL,
                status INTEGER NOT NULL,response BLOB NOT NULL,observed_at TEXT NOT NULL);''')
            if db.execute('SELECT 1 FROM runs WHERE kind != ? LIMIT 1', (kind,)).fetchone():
                raise FixtureError('producer state belongs to a different source kind')
            for index, body in db.execute('SELECT run_index,body FROM runs WHERE receipt_status IS NULL ORDER BY run_index').fetchall():
                send_run(db, index, url, token, body, sleep)
            created = 0
            while count == 0 or created < count:
                with db:
                    cursor = db.execute('INSERT INTO runs(kind,body) VALUES(?,?)', (kind, b''))
                    index = cursor.lastrowid
                    body = envelope(kind, index)
                    db.execute('UPDATE runs SET body=? WHERE run_index=?', (body, index))
                send_run(db, index, url, token, body, sleep)
                created += 1
                if count == 0 or created < count:
                    sleep(interval)


class Receiver:
    def __init__(self, path, secret):
        self.path = Path(path)
        self.secret = secret
        if not secret:
            raise FixtureError('empty signing secret file')
        with database(self.path) as db:
            db.execute('''CREATE TABLE IF NOT EXISTS deliveries(
                delivery_id TEXT PRIMARY KEY,body BLOB NOT NULL,
                body_sha256 TEXT NOT NULL,received_at TEXT NOT NULL)''')

    def accept(self, headers, body, now=None):
        timestamp = headers.get('Signalhub-Timestamp', '')
        delivery_id = headers.get('Signalhub-Delivery-Id', '')
        signature = headers.get('Signalhub-Signature', '')
        if (len(timestamp) > 19 or not TIMESTAMP_PATTERN.fullmatch(timestamp)
                or not ID_PATTERN.fullmatch(delivery_id)
                or not SIGNATURE_PATTERN.fullmatch(signature)):
            return 401, {'error': 'invalid signature headers'}
        now = int(time.time()) if now is None else now
        if abs(now - int(timestamp)) > 300:
            return 401, {'error': 'stale signature'}
        expected = 'v1=' + hmac.new(self.secret, ('v1.' + timestamp + '.' + delivery_id + '.').encode('ascii') + body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return 401, {'error': 'invalid signature'}
        try:
            event = strict_json(body)
            if (not isinstance(event, dict) or event.get('specversion') != '1.0'
                    or any(not isinstance(event.get(key), str) or not event[key] for key in ('id', 'source', 'type', 'time'))
                    or ('data' in event and not isinstance(event['data'], dict))):
                raise ValueError('structured event required')
        except (ValueError, UnicodeError, RecursionError):
            return 400, {'error': 'structured CloudEvent required'}
        with database(self.path) as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT body FROM deliveries WHERE delivery_id=?', (delivery_id,)).fetchone()
            if previous is not None:
                if previous[0] == body:
                    return 200, {'duplicate': True}
                return 409, {'error': 'immutable delivery conflict'}
            db.execute('INSERT INTO deliveries VALUES(?,?,?,?)',
                       (delivery_id, body, hashlib.sha256(body).hexdigest(), utc_now()))
        return 202, {'accepted': True}


def check_members(raw, expected_count):
    try:
        result = strict_json(raw)
        members = result['results']
        if expected_count < 1 or not isinstance(members, list) or len(members) != expected_count:
            raise ValueError('member count')
        for index, member in enumerate(members):
            if type(member.get('index')) is not int or member['index'] != index:
                raise ValueError('member index')
            check_receipt(member.get('status'), encoded(member))
    except (ValueError, UnicodeError, RecursionError, KeyError, TypeError, AttributeError, FixtureError):
        raise FixtureError('adapter member receipt failure') from None


class Relay:
    def __init__(self, capture_dir, hub_url, token):
        validate_url(hub_url)
        capture_dir = Path(capture_dir)
        capture_dir.mkdir(parents=True, exist_ok=True)
        self.path = capture_dir / 'relay.sqlite'
        self.url = hub_url.rstrip('/') + '/v1/adapters/alertmanager'
        self.token = token
        with database(self.path) as db:
            db.execute('''CREATE TABLE IF NOT EXISTS captures(
                seq INTEGER PRIMARY KEY AUTOINCREMENT,request BLOB NOT NULL,
                response BLOB,hub_status INTEGER,status INTEGER,
                diagnostic TEXT,received_at TEXT NOT NULL)''')

    def accept(self, body):
        with database(self.path) as db:
            sequence = db.execute('INSERT INTO captures(request,received_at) VALUES(?,?)', (body, utc_now())).lastrowid
        hub_status, response, status = 0, b'', 502
        diagnostic = ''
        try:
            event = strict_json(body)
            alerts = event['alerts']
            if not isinstance(alerts, list) or event.get('truncatedAlerts', 0) != 0:
                raise FixtureError('adapter batch shape or truncation failure')
            hub_status, response = post(self.url, self.token, body)
            if hub_status != 200:
                raise FixtureError('adapter HTTP status failure')
            check_members(response, len(alerts))
            status = 200
        except FixtureError as error:
            diagnostic = str(error)
        except (ValueError, UnicodeError, RecursionError, KeyError, TypeError):
            diagnostic = 'adapter request JSON failure'
        except (OSError, urllib.error.URLError, http.client.HTTPException):
            diagnostic = 'adapter transport failure'
        with database(self.path) as db:
            db.execute('UPDATE captures SET response=?,hub_status=?,status=?,diagnostic=? WHERE seq=?',
                       (response, hub_status, status, diagnostic, sequence))
        if status != 200:
            return status, {'error': diagnostic, 'capture_seq': sequence}
        return 200, {'accepted': True, 'capture_seq': sequence}


def http_server(address, sink):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(TIMEOUT)

        def log_message(self, *_):
            pass

        def reply(self, status, result):
            raw = encoded(result)
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(raw)
            self.close_connection = True

        def do_GET(self):
            self.reply(200, {'status': 'ok'}) if self.path == '/healthz' else self.reply(404, {'error': 'not found'})

        def do_POST(self):
            if self.path != '/webhook':
                self.reply(404, {'error': 'not found'})
                return
            lengths = self.headers.get_all('Content-Length', [])
            if self.headers.get('Transfer-Encoding') or len(lengths) != 1 or not re.fullmatch(r'[0-9]{1,10}', lengths[0]):
                self.reply(400, {'error': 'bounded Content-Length required'})
                return
            length = int(lengths[0])
            if length > MAX_BODY:
                self.reply(413, {'error': 'body too large'})
                return
            try:
                body = self.rfile.read(length)
                if len(body) != length:
                    self.reply(400, {'error': 'incomplete body'})
                    return
                if isinstance(sink, Receiver):
                    if any(len(self.headers.get_all(name, [])) != 1 for name in
                           ('Signalhub-Timestamp', 'Signalhub-Delivery-Id', 'Signalhub-Signature')):
                        self.reply(401, {'error': 'invalid signature headers'})
                        return
                    status, result = sink.accept(self.headers, body)
                else:
                    status, result = sink.accept(body)
                self.reply(status, result)
            except TimeoutError:
                self.reply(408, {'error': 'request deadline exceeded'})
            except (sqlite3.Error, OSError):
                self.reply(503, {'error': 'fixture persistence or transport failure'})

    return HTTPServer(address, Handler)


def listen(value):
    try:
        host, port = value.rsplit(':', 1)
        port = int(port)
        if not host or not 1 <= port <= 65535:
            raise ValueError()
        return host, port
    except ValueError:
        raise argparse.ArgumentTypeError('expected host:port') from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest='command', required=True)
    producer = subcommands.add_parser('producer', help='immutable completed synthetic run events')
    producer.add_argument('--kind', required=True, choices=('release', 'inspection'))
    producer.add_argument('--url', required=True)
    producer.add_argument('--token-file', required=True, type=Path)
    producer.add_argument('--state-dir', required=True, type=Path)
    producer.add_argument('--interval', type=float, required=True)
    producer.add_argument('--count', type=int, required=True)
    receiver = subcommands.add_parser('receiver', help='durable signed HTTPS CloudEvent sink')
    receiver.add_argument('--listen', type=listen, required=True)
    receiver.add_argument('--cert-file', type=Path, required=True)
    receiver.add_argument('--key-file', type=Path, required=True)
    receiver.add_argument('--secret-file', type=Path, required=True)
    receiver.add_argument('--db', type=Path, required=True)
    relay = subcommands.add_parser('alert-relay', help='test-only observable Alertmanager relay')
    relay.add_argument('--listen', type=listen, required=True)
    relay.add_argument('--hub-url', required=True)
    relay.add_argument('--token-file', type=Path, required=True)
    relay.add_argument('--capture-dir', type=Path, required=True)
    args = parser.parse_args(argv)
    if os.geteuid() == 0:
        parser.error('test fixtures must run as a non-root user')
    os.umask(0o077)
    try:
        if args.command == 'producer':
            produce(args.kind, args.url, args.token_file, args.state_dir, args.interval, args.count)
            return 0
        if args.command == 'receiver':
            sink = Receiver(args.db, args.secret_file.read_bytes())
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(args.cert_file, args.key_file)
            server = http_server(args.listen, sink)
            server.socket = context.wrap_socket(server.socket, server_side=True, do_handshake_on_connect=False)
        else:
            sink = Relay(args.capture_dir, args.hub_url, load_token(args.token_file))
            server = http_server(args.listen, sink)
        with server:
            server.serve_forever()
    except FixtureError as error:
        print('fixture: ' + str(error), file=sys.stderr)
        return 1
    except (OSError, sqlite3.Error, ValueError):
        print('fixture: file, database, TLS, or endpoint operation failed', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == '__main__':
    sys.exit(main())
