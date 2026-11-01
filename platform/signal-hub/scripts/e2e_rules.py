"""Run M3 against a real loopback binary/SQLite, without external credentials."""
import argparse
import copy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import secrets
import selectors
import sqlite3
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from e2e_smoke import API_URI, registry, Draft202012Validator, FormatChecker


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    args = parser.parse_args()
    binary = str(Path(args.binary).resolve())
    checks = 0
    with tempfile.TemporaryDirectory(prefix='signalhub-m3-') as directory:
        root = Path(directory)
        tokens = {role: secrets.token_urlsafe(32) for role in ('owner', 'reader', 'source', 'replacement')}
        for role, token in tokens.items():
            p = root / (role + '.token')
            p.write_text(token)
            p.chmod(0o600)
        ref = lambda role: 'file:' + str(root / (role + '.token'))
        config = dict(sources=[dict(name='demo', source_prefix='urn:example:demo:', allowed_types=['demo.event.*'], token_ref=ref('source'))], rules=[], subscriptions=[], webhook_allowlist=[])
        config_path = root / 'config.json'
        db_path = root / 'events.db'
        def save(value):
            config_path.write_text(json.dumps(value))
            config_path.chmod(0o600)
        save(config)
        child = None
        base = None
        def stop():
            nonlocal child
            if child is not None:
                if child.poll() is None:
                    child.terminate()
                    child.wait(timeout=20)
                child.stderr.close()
                child = None
        def start():
            nonlocal child, base
            child = subprocess.Popen([binary, '--config', str(config_path), '--db', str(db_path), '--owner-token-ref', ref('owner'), '--readonly-token-ref', ref('reader'), '--listen', '127.0.0.1:0'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            with selectors.DefaultSelector() as selector:
                selector.register(child.stderr, selectors.EVENT_READ)
                assert selector.select(timeout=20), 'startup timed out'
            line = child.stderr.readline().strip()
            assert line.startswith('signalhub listening on 127.0.0.1:'), line
            base = 'http://' + line.removeprefix('signalhub listening on ')
        def call(method, path, role='reader', body=None, want=200):
            nonlocal checks
            headers = {'Content-Type': 'application/cloudevents+json'}
            if role:
                headers['Authorization'] = 'Bearer ' + tokens[role]
            request = Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
            try:
                response = urlopen(request, timeout=20)
            except HTTPError as error:
                response = error
            with response:
                raw = response.read()
                assert response.status == want, (path, response.status, raw)
                assert response.headers.get('Cache-Control') == 'no-store'
            assert all(token.encode() not in raw for token in tokens.values())
            value = json.loads(raw)
            route = path.split('?')[0]
            if route.startswith('/v1/metrics/'):
                route = '/v1/metrics/{rule_id}'
            pointer = '/paths/' + route.replace('~', '~0').replace('/', '~1') + '/' + method.lower() + '/responses/' + str(want) + '/content/application~1json/schema'
            Draft202012Validator({'$ref': API_URI + '#' + pointer}, registry=registry, format_checker=FormatChecker()).validate(value)
            checks += 1
            return value
        def events(typ):
            return call('GET', '/v1/events?type=' + quote(typ, safe=''))['items']
        def event(identity, at, n=1):
            return dict(specversion='1.0', id=identity, source='urn:example:demo:service', type='demo.event.created', time=at.isoformat().replace('+00:00', 'Z'), subject='api', data={'duration': n})
        now = datetime.now(timezone.utc)
        hour = now.replace(minute=0, second=0, microsecond=0)
        try:
            start()
            for i in range(3):
                call('POST', '/v1/events', 'source', event('seed-' + str(i), hour - timedelta(hours=3-i) + timedelta(seconds=1), i+1), 202)
            call('POST', '/v1/events', 'source', event('partial', now, 4), 202)
            count = dict(id='count', version=1, title='Events', filter={'types': ['demo.event.*']}, aggregation={'fn': 'count'}, bucket='1h', threshold={'op': '>=', 'value': 1, 'for_buckets': 2, 'severity': 'warning'})
            total = dict(id='duration', version=1, title='Duration', filter={'types': ['demo.event.*']}, aggregation={'fn': 'sum', 'field': 'data.duration'}, bucket='1h', group_by=['subject'])
            config['rules'] = [count, total]
            save(config)
            call('GET', '/v1/rules', None, want=401)
            call('GET', '/v1/metrics/count', 'source', want=403)
            call('POST', '/v1/config:reload', 'reader', want=403)
            call('POST', '/v1/config:reload', 'owner', {}, 400)
            call('POST', '/v1/config:reload', 'owner')
            first = call('GET', '/v1/rules?limit=1')
            assert first['items'][0]['id'] == 'count'
            last = call('GET', '/v1/rules?limit=1&cursor=' + quote(first['next_cursor'], safe=''))
            assert last['items'][0]['id'] == 'duration' and last['next_cursor'] is None
            page = call('GET', '/v1/metrics/count?limit=2')
            assert len(page['items']) == 2 and page['next_cursor']
            second = call('GET', '/v1/metrics/count?limit=2&cursor=' + quote(page['next_cursor'], safe=''))
            rows = page['items'] + second['items']
            assert len(rows) == 4 and [r['value'] for r in rows] == [1,1,1,1], rows
            assert rows[-1]['partial'] and not any(r['partial'] for r in rows[:-1])
            assert page['recomputable_from'] and page['last_computed_at']
            groups = call('GET', '/v1/metrics/duration?group=' + quote('["api"]', safe=''))
            assert [r['value'] for r in groups['items']] == [1,2,3,4], groups
            call('GET', '/v1/metrics/count?group=[]&cursor=' + quote(page['next_cursor'], safe=''), want=400)
            for path in ['/v1/metrics/unknown', '/v1/metrics/count?limit=201', '/v1/metrics/count?from=bad', '/v1/rules?limit=1&limit=2', '/v1/rules?cursor=bad']:
                call('GET', path, want=404 if path.endswith('unknown') else 400)
            assert len(events('signalhub.rule.threshold.crossed')) == 1
            call('POST', '/v1/config:reload', 'owner')
            assert len(events('signalhub.rule.threshold.crossed')) == 1
            # A same-version edit plus source-token replacement must roll back together.
            bad = copy.deepcopy(config)
            bad['rules'][0]['title'] = 'Mutated without version'
            bad['sources'][0]['token_ref'] = ref('replacement')
            save(bad)
            call('POST', '/v1/config:reload', 'owner', want=400)
            call('POST', '/v1/events', 'replacement', event('denied', now), 401)
            call('POST', '/v1/events', 'source', event('old-source-still-active', now), 202)
            assert call('GET', '/v1/rules')['items'][0]['title'] == 'Events'
            assert events('signalhub.config.rejected')
            config['rules'][0]['version'] = 2
            config['rules'][0]['title'] = 'Events v2'
            save(config)
            call('POST', '/v1/config:reload', 'owner')
            call('GET', '/v1/rules?cursor=' + quote(first['next_cursor'], safe=''), want=400)
            assert all(r['rule_version'] == 2 for r in call('GET', '/v1/metrics/count')['items'])
            transitions = len(events('signalhub.rule.threshold.crossed'))
            stop()
            result = subprocess.run([binary, 'rules', 'backfill', '--config', str(config_path), '--db', str(db_path), '--rule', 'count', '--from', (hour-timedelta(hours=3)).isoformat()], capture_output=True, text=True, timeout=20)
            assert result.returncode == 0 and 'backfill completed' in result.stderr, result.stderr
            start()
            assert len(events('signalhub.rule.threshold.crossed')) == transitions
            assert call('GET', '/v1/metrics/count')['items'][-1]['value'] == 2
            # A legal near-limit group must work over actual HTTP, including
            # compact pagination and an escaped group URL larger than 16 KiB.
            long_group = '"' * 8100
            large = event('large-group', hour - timedelta(hours=2) + timedelta(seconds=2))
            large['data'] = {'group': long_group}
            call('POST', '/v1/events', 'source', large, 202)
            config['rules'].append(dict(id='large', version=1, title='Large groups', filter={'types': ['demo.event.*']}, aggregation={'fn': 'count'}, bucket='1h', group_by=['data.group'], threshold={'op': '>=', 'value': 1, 'for_buckets': 1, 'severity': 'warning'}))
            save(config)
            call('POST', '/v1/config:reload', 'owner')
            exact_group = json.dumps([long_group], separators=(',', ':'))
            large_page = call('GET', '/v1/metrics/large?limit=1&group=' + quote(exact_group, safe=''))
            assert large_page['items'] and large_page['items'][0]['value'] == 1
            cursor = large_page['next_cursor']
            assert cursor and len(cursor) < 1024
            call('GET', '/v1/metrics/large?limit=1&group=' + quote(exact_group, safe='') + '&cursor=' + quote(cursor, safe=''))
            assert events('signalhub.rule.threshold.crossed')
            with sqlite3.connect(db_path) as db:
                assert db.execute('SELECT COUNT(*) FROM ingest_conflicts').fetchone()[0] == 0
                assert db.execute('SELECT COUNT(*) FROM config_audit').fetchone()[0] >= 4
        finally:
            stop()
    print(f'PASS: {checks} M3 HTTP responses match OpenAPI; metrics, pagination, roles, atomic reload, versions, threshold dedupe, CLI backfill and restart')


if __name__ == '__main__':
    main()
