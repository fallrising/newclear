"""M6 preparation only: real local service, synthetic sources and isolated restore.

Uses the checked-in producer examples and unmodified production binary. No real
accounts, external requests, clock injection or production acceptance claims.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import secrets
import selectors
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

from e2e_smoke import API_URI, Draft202012Validator, FormatChecker, ROOT, registry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True)
    binary = str(Path(parser.parse_args().binary).resolve(strict=True))
    samples = ROOT / 'examples/sources'
    load = lambda name: json.loads((samples / name).read_text())
    scratch = ROOT / '.local/run/scratch'
    scratch.mkdir(parents=True, exist_ok=True)
    checks = 0
    commands = 0
    opener = build_opener(ProxyHandler({}))  # Only the newly bound loopback service.
    with tempfile.TemporaryDirectory(prefix='m6-synthetic-', dir=scratch) as owned:
        root = Path(owned)
        config = load('config.json')
        assert {row['name'] for row in config['sources']} == {'release', 'inspection', 'alertmanager'}
        assert config['subscriptions'] == [] and config['webhook_allowlist'] == []
        tokens = {name: secrets.token_urlsafe(32) for name in ('owner', 'reader', 'release', 'inspection', 'alertmanager')}
        for role, token in tokens.items():
            path = root / (role + '.token')
            path.write_text(token)
            path.chmod(0o600)
        for source in config['sources']:
            source['token_ref'] = 'file:' + str(root / (source['name'] + '.token'))
            source['expected_interval'] = '2s' if source['name'] == 'inspection' else '1h'
        config_path = root / 'config.json'
        config_path.write_text(json.dumps(config))
        config_path.chmod(0o600)
        database = root / 'source.sqlite'
        process = None
        base = None

        def stop():
            nonlocal process
            if process is not None:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                        raise
                process.stderr.close()
                process = None

        def start(db):
            nonlocal process, base
            process = subprocess.Popen([
                binary, '-config', str(config_path), '-db', str(db),
                '-owner-token-ref', 'file:' + str(root / 'owner.token'),
                '-readonly-token-ref', 'file:' + str(root / 'reader.token'),
                '-listen', '127.0.0.1:0',
            ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            with selectors.DefaultSelector() as selector:
                selector.register(process.stderr, selectors.EVENT_READ)
                assert selector.select(timeout=15), 'synthetic startup timed out'
            line = process.stderr.readline().strip()
            assert line.startswith('signalhub listening on 127.0.0.1:'), line
            base = 'http://' + line.removeprefix('signalhub listening on ')

        def call(method, path, role='reader', body=None, want=200):
            nonlocal checks
            headers = {'Content-Type': 'application/json' if 'alertmanager' in path else 'application/cloudevents+json'}
            if role is not None:
                headers['Authorization'] = 'Bearer ' + tokens[role]
            request = Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
            try:
                response = opener.open(request, timeout=15)
            except HTTPError as error:
                response = error
            with response:
                raw = response.read()
                assert response.status == want, (path, response.status, raw)
                assert response.headers.get('Cache-Control') == 'no-store'
            assert all(token.encode() not in raw for token in tokens.values())
            value = json.loads(raw)
            route = path.split('?')[0]
            if route.startswith('/v1/events/'):
                route = '/v1/events/{seq}'
            pointer = '/paths/' + route.replace('~', '~0').replace('/', '~1') + '/' + method.lower() + '/responses/' + str(want) + '/content/application~1json/schema'
            Draft202012Validator({'$ref': API_URI + '#' + pointer}, registry=registry, format_checker=FormatChecker()).validate(value)
            checks += 1
            return value

        def source(name):
            return next(row for row in call('GET', '/v1/sources')['items'] if row['name'] == name)

        def adapter(body, statuses, role='alertmanager'):
            value = call('POST', '/v1/adapters/alertmanager', role, body)
            assert [row['status'] for row in value['results']] == statuses, value
            return value['results']

        def cli(*args):
            nonlocal commands
            result = subprocess.run([binary, *map(str, args)], capture_output=True, text=True, timeout=20)
            assert result.returncode == 0, (args[0], result.stderr)
            assert all(token not in result.stdout + result.stderr for token in tokens.values())
            commands += 1
            # The existing CLI writes its command JSON to the supplied output
            # stream (stderr in main), as do the M5 native acceptance tests.
            assert result.stdout == ''
            return json.loads(result.stderr)

        try:
            start(database)
            call('GET', '/healthz', role=None)
            call('GET', '/readyz', role=None)
            release = load('release.json')
            inspection = load('inspection.json')
            firing = load('alertmanager-firing.json')
            resolved = load('alertmanager-resolved.json')
            assert len(firing['alerts']) == len(resolved['alerts']) == 1
            empty = dict(firing, alerts=[])
            adapter(empty, [])
            assert source('alertmanager')['status'] == 'never'
            first = call('POST', '/v1/events', 'release', release, want=202)['seq']
            assert call('POST', '/v1/events', 'release', release)['seq'] == first
            call('POST', '/v1/events', 'inspection', release, want=403)
            call('POST', '/v1/events', 'owner', release, want=403)
            call('GET', '/v1/events', 'release', want=403)
            call('POST', '/v1/events', 'release', dict(release, summary='changed immutable event'), want=409)
            call('POST', '/v1/events', 'release', dict(release, id='forbidden-internal', type='signalhub.source.silent'), want=403)
            assert call('GET', '/v1/events/' + str(first))['item']['event'] == release

            firing_seq = adapter(firing, [202])[0]['seq']
            assert adapter(firing, [200])[0]['seq'] == firing_seq
            before_conflict = source('alertmanager')['last_received_at']
            for field in ('annotations', 'groupKey', 'generatorURL'):
                changed = copy.deepcopy(firing)
                if field == 'annotations':
                    changed['alerts'][0]['annotations']['summary'] = 'mutation must not be hidden'
                elif field == 'groupKey':
                    changed['groupKey'] += '-changed'
                else:
                    changed['alerts'][0]['generatorURL'] = 'https://example.invalid/changed'
                adapter(changed, [409])
            assert source('alertmanager')['last_received_at'] == before_conflict
            changed = copy.deepcopy(firing)
            changed['alerts'][0]['endsAt'] = '2099-01-01T00:00:00Z'
            assert adapter(changed, [200])[0]['seq'] == firing_seq, 'unused firing endsAt must not change mapped content'
            adapter(dict(firing, alerts=firing['alerts'] + [{}]), [200, 400])
            adapter(firing, [403], role='release')
            resolved_seq = adapter(resolved, [202])[0]['seq']
            assert resolved_seq != firing_seq
            assert adapter(resolved, [200])[0]['seq'] == resolved_seq

            inspection_seq = call('POST', '/v1/events', 'inspection', inspection, want=202)['seq']
            assert source('inspection')['status'] == 'fresh'
            deadline = time.monotonic() + 15
            while True:
                observed = source('inspection')
                if observed['status'] == 'silent':
                    break
                assert time.monotonic() < deadline, 'inspection did not become silent'
                time.sleep(0.1)
            received = datetime.fromisoformat(observed['last_received_at'].replace('Z', '+00:00'))
            assert (datetime.now(timezone.utc) - received).total_seconds() > 4
            page = call('GET', '/v1/events?limit=200')
            silent = [row for row in page['items'] if row['event']['type'] == 'signalhub.source.silent' and row['event'].get('subject') == 'inspection']
            assert len(silent) == 1
            assert call('POST', '/v1/events', 'inspection', inspection)['seq'] == inspection_seq
            assert source('inspection')['status'] == 'fresh'
            page = call('GET', '/v1/events?limit=200')
            assert len([row for row in page['items'] if row['event']['type'] == 'signalhub.source.recovered' and row['event'].get('subject') == 'inspection']) == 1
            assert {row['event']['source'] for row in page['items']} >= {release['source'], inspection['source'], 'urn:signalhub:alertmanager:' + firing['receiver']}
            high_seq = max(row['seq'] for row in page['items'])

            snapshot = root / 'snapshot.sqlite'
            manifest = cli('backup', '--db', database, '--output', snapshot)
            original_hash = hashlib.sha256(snapshot.read_bytes()).hexdigest()
            assert manifest['sha256'] == original_hash
            assert manifest == json.loads(Path(str(snapshot) + '.manifest.json').read_text())
            stop()
            try:
                opener.open(base + '/healthz', timeout=1)
            except URLError:
                pass
            else:
                raise AssertionError('stopped owned process still healthy')
            destination = root / 'isolated'
            destination.mkdir(mode=0o700)
            restored = destination / 'restored.sqlite'
            cli('restore', '--backup', snapshot, '--db', restored, '--reason', 'synthetic M6 preparation drill')
            assert hashlib.sha256(snapshot.read_bytes()).hexdigest() == original_hash
            # Only this run's synthetic credentials; no subscriptions or outbound
            # allowlist. A real snapshot needs independently authorized isolation.
            start(restored)
            assert call('GET', '/v1/events/' + str(first))['item']['event'] == release
            assert call('GET', '/v1/events/' + str(firing_seq))['item']['event']['id'] == firing['alerts'][0]['fingerprint'] + ':' + firing['alerts'][0]['startsAt'] + ':firing'
            assert call('POST', '/v1/events', 'release', release)['seq'] == first
            call('POST', '/v1/events', 'release', dict(release, summary='still conflicts after restore'), want=409)
            new = dict(release, id=release['id'] + '-after-restore')
            assert call('POST', '/v1/events', 'release', new, want=202)['seq'] > high_seq
            assert hashlib.sha256(snapshot.read_bytes()).hexdigest() == original_hash
        finally:
            stop()
    print(f'PASS: M6 preparation {checks} HTTP/OpenAPI responses; {commands} backup/restore commands; three synthetic sources; member409; real elapsed silence; isolated restore. Live seven-day/phone/external-monitor/yesterday-snapshot acceptance NOT performed.')


if __name__ == '__main__':
    main()
