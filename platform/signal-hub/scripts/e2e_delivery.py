"""M4 production binary/OpenAPI boundary, synthetic fixtures only.

The production sender must deny even explicitly allowlisted loopback targets.
The Go service/subprocess test supplies a pinned trusted TLS fixture separately
for successful deliveries; no production bypass flag exists.
"""
import argparse
import copy
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import secrets
import selectors
import sqlite3
import subprocess
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from e2e_smoke import API_URI, registry, Draft202012Validator, FormatChecker


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    binary = str(Path(parser.parse_args().binary).resolve())
    checks = 0
    received = []

    class Receiver(BaseHTTPRequestHandler):
        def handle(self):
            received.append(True)
        def log_message(self, *_):
            pass

    receiver = HTTPServer(('127.0.0.1', 0), Receiver)
    thread = threading.Thread(target=receiver.serve_forever, daemon=True)
    thread.start()
    child = None
    try:
        with tempfile.TemporaryDirectory(prefix='signalhub-m4-') as directory:
            root = Path(directory)
            tokens = {role: secrets.token_urlsafe(32) for role in ('owner', 'reader', 'source', 'replacement')}
            for role, token in tokens.items():
                path = root / (role + '.token')
                path.write_text(token)
                path.chmod(0o600)
            ref = lambda role: 'file:' + str(root / (role + '.token'))
            url = f'https://127.0.0.1:{receiver.server_port}/synthetic'
            config = dict(sources=[dict(name='demo', source_prefix='urn:example:demo:', allowed_types=['demo.event.*'], token_ref=ref('source'))], rules=[], subscriptions=[], webhook_allowlist=[url])
            config_path = root / 'config.json'
            db_path = root / 'events.db'
            def save(value):
                config_path.write_text(json.dumps(value))
                config_path.chmod(0o600)
            save(config)
            child = subprocess.Popen([binary, '-config', str(config_path), '-db', str(db_path), '-owner-token-ref', ref('owner'), '-readonly-token-ref', ref('reader'), '-listen', '127.0.0.1:0'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            with selectors.DefaultSelector() as selector:
                selector.register(child.stderr, selectors.EVENT_READ)
                assert selector.select(timeout=20), 'startup timed out'
            line = child.stderr.readline().strip()
            assert line.startswith('signalhub listening on 127.0.0.1:'), line
            base = 'http://' + line.removeprefix('signalhub listening on ')
            def call(method, path, role='reader', body=None, want=200, media='application/json'):
                nonlocal checks
                headers = {'Content-Type': media}
                if role:
                    headers['Authorization'] = 'Bearer ' + tokens[role]
                data = body.encode() if isinstance(body, str) else None if body is None else json.dumps(body).encode()
                try:
                    response = urlopen(Request(base + path, data=data, headers=headers, method=method), timeout=20)
                except HTTPError as error:
                    response = error
                with response:
                    raw = response.read()
                    assert response.status == want, (path, response.status, raw)
                    assert response.headers.get('Cache-Control') == 'no-store'
                assert all(token.encode() not in raw for token in tokens.values())
                assert str(root).encode() not in raw and url.encode() not in raw
                value = json.loads(raw)
                route = path.split('?')[0]
                if route.endswith(':replay'):
                    route = '/v1/deliveries/{delivery_id}:replay'
                pointer = '/paths/' + route.replace('~', '~0').replace('/', '~1') + '/' + method.lower() + '/responses/' + str(want) + '/content/application~1json/schema'
                Draft202012Validator({'$ref': API_URI + '#' + pointer}, registry=registry, format_checker=FormatChecker()).validate(value)
                checks += 1
                return value
            def event(identity):
                return dict(specversion='1.0', id=identity, source='urn:example:demo:service', type='demo.event.created', time=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), summary='Synthetic M4 boundary')
            def send(identity, role='source', want=202):
                return call('POST', '/v1/events', role, event(identity), want, 'application/cloudevents+json')
            def wait(label, predicate):
                until = time.monotonic() + 20
                while time.monotonic() < until:
                    value = predicate()
                    if value:
                        return value
                    time.sleep(.05)
                raise AssertionError('timeout: ' + label)
            for path in ('/v1/subscriptions', '/v1/deliveries'):
                call('GET', path, None, want=401)
                call('GET', path, 'source', want=403)
                assert call('GET', path)['items'] == []
            old = send('before-activation')['seq']
            for name, start in [('future', 'now'), ('history', 'earliest_hot')]:
                config['subscriptions'].append(dict(id=name, filter={'types': ['demo.event.*']}, channel=dict(kind='webhook', url=url, secret_ref=ref('replacement')), mode='immediate', start=start))
            save(config)
            call('POST', '/v1/config:reload', 'owner')
            first = call('GET', '/v1/subscriptions?limit=1')
            assert first['items'][0]['id'] == 'future' and first['next_cursor']
            assert call('GET', '/v1/subscriptions?limit=1&cursor=' + quote(first['next_cursor'], safe=''))['items'][0]['id'] == 'history'
            new = send('after-activation')['seq']
            def queued():
                rows = call('GET', '/v1/deliveries')['items']
                return rows if len(rows) == 3 and all(r['attempt_count'] == 1 for r in rows) else None
            rows = wait('three projected transport failures', queued)
            assert [r['delivery_id'] for r in rows] == sorted(r['delivery_id'] for r in rows)
            assert {r['event_seq'] for r in rows if r['subscription_id'] == 'future'} == {new}
            assert {r['event_seq'] for r in rows if r['subscription_id'] == 'history'} == {old, new}
            assert not received, 'production sender dialed forbidden loopback target'
            page = call('GET', '/v1/deliveries?limit=1')
            call('GET', '/v1/deliveries?state=dlq&cursor=' + quote(page['next_cursor'], safe=''), want=400)
            assert call('GET', '/v1/deliveries?limit=1&cursor=' + quote(page['next_cursor'], safe=''))['items']
            for path in ['/v1/deliveries?state=unknown', '/v1/deliveries?limit=201', '/v1/subscriptions?extra=yes', '/v1/deliveries?subscription=', '/v1/deliveries?limit=1&limit=2']:
                call('GET', path, want=400)
            delivery_id = rows[0]['delivery_id']
            replay = '/v1/deliveries/' + quote(delivery_id, safe='') + ':replay'
            call('POST', replay, 'reader', {'reason': 'fixture'}, 403)
            call('POST', replay, 'owner', {'reason': 'fixture'}, 409)
            call('POST', replay, 'owner', {'reason': ' '}, 400)
            call('POST', replay, 'owner', '{', 400)
            call('POST', replay, 'owner', {'reason': 'fixture'}, 415, 'text/plain')
            # Advance only this synthetic retry budget to its final due attempt;
            # focused Go tests independently exercise all twelve transitions.
            with sqlite3.connect(db_path) as db:
                db.execute("UPDATE deliveries SET cycle_attempts=11,next_attempt_key='',next_attempt_at='2000-01-01T00:00:00Z' WHERE delivery_id=?", (delivery_id,))
            wait('DLQ after terminal budget', lambda: call('GET', '/v1/deliveries?state=dlq')['items'])
            assert call('GET', '/v1/events?type=signalhub.delivery.dlq')['items']
            assert call('POST', replay, 'owner', {'reason': 'synthetic boundary replay'}, 202)['delivery_id'] == delivery_id
            bad = copy.deepcopy(config)
            bad['sources'][0]['token_ref'] = ref('replacement')
            bad['subscriptions'][0]['filter']['severity_min'] = 'error'
            save(bad)
            call('POST', '/v1/config:reload', 'owner', want=400)
            send('old-token-kept')
            send('replacement-denied', 'replacement', 401)
            with sqlite3.connect(db_path) as db:
                definitions = b''.join(row[0] for row in db.execute('SELECT definition FROM subscriptions'))
                assert url.encode() not in definitions and b'token_ref' not in definitions and b'secret_ref' not in definitions
                assert db.execute('SELECT count(*) FROM audit_log WHERE reason=?', ('synthetic boundary replay',)).fetchone()[0] == 1
            assert not received
            print(f'PASS: {checks} M4 real HTTP/OpenAPI responses; activation, pagination, roles, replay audit, atomic rejection, production loopback SSRF denial')
    finally:
        if child is not None:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=20)
            child.stderr.close()
        receiver.shutdown()
        receiver.server_close()
        thread.join(timeout=5)


if __name__ == '__main__':
    main()
