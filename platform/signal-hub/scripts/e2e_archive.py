"""M5 real production CLI/HTTP drill; only self-created synthetic directories.

No network policy bypass: the synthetic receiver is a forbidden loopback URL.
SQL only freezes/sets synthetic delivery history to exercise persisted states;
all event ingestion, archive, import, backup and restore use production paths.
"""
import argparse
from contextlib import closing
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
from pathlib import Path
import secrets
import selectors
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from e2e_smoke import API_URI, registry, Draft202012Validator, FormatChecker


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    binary = str(Path(parser.parse_args().binary).resolve())
    checks = 0
    commands = 0
    with tempfile.TemporaryDirectory(prefix='signalhub-m5-') as directory:
        root = Path(directory)
        source_dir = root / 'source'
        source_dir.mkdir(mode=0o700)
        archive_dir = source_dir / 'archive'
        archive_dir.mkdir(mode=0o700)
        db_path = source_dir / 'events.sqlite'
        tokens = {role: secrets.token_urlsafe(32) for role in ('owner', 'reader', 'source', 'webhook')}
        for role, token in tokens.items():
            path = source_dir / (role + '.token')
            path.write_text(token)
            path.chmod(0o600)
        ref = lambda role: 'file:' + str(source_dir / (role + '.token'))
        url = 'https://127.0.0.1:9/synthetic'
        subscription = dict(id='archive-state', filter={'types': ['demo.event.*']}, channel=dict(kind='webhook', url=url, secret_ref=ref('webhook')), mode='immediate', start='now')
        config = dict(sources=[dict(name='demo', source_prefix='urn:example:demo:', allowed_types=['demo.event.*'], retention_days=1, token_ref=ref('source'))], rules=[], subscriptions=[subscription], webhook_allowlist=[url])
        config_path = source_dir / 'config.json'
        def save():
            config_path.write_text(json.dumps(config))
            config_path.chmod(0o600)
        save()
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
        def start(database=db_path, configuration=config_path, credential_dir=source_dir):
            nonlocal child, base
            child = subprocess.Popen([binary, '-config', str(configuration), '-db', str(database), '-owner-token-ref', 'file:' + str(credential_dir / 'owner.token'), '-readonly-token-ref', 'file:' + str(credential_dir / 'reader.token'), '-listen', '127.0.0.1:0'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            with selectors.DefaultSelector() as selector:
                selector.register(child.stderr, selectors.EVENT_READ)
                assert selector.select(timeout=20), 'startup timed out'
            line = child.stderr.readline().strip()
            assert line.startswith('signalhub listening on 127.0.0.1:'), line
            base = 'http://' + line.removeprefix('signalhub listening on ')
        def call(method, path, role='reader', body=None, want=200, media='application/json'):
            nonlocal checks
            headers = {'Content-Type': media, 'Authorization': 'Bearer ' + tokens[role]}
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
            if route.startswith('/v1/events/'):
                route = '/v1/events/{seq}'
            elif route.startswith('/v1/metrics/'):
                route = '/v1/metrics/{rule_id}'
            elif route.endswith(':replay'):
                route = '/v1/deliveries/{delivery_id}:replay'
            pointer = '/paths/' + route.replace('~', '~0').replace('/', '~1') + '/' + method.lower() + '/responses/' + str(want) + '/content/application~1json/schema'
            Draft202012Validator({'$ref': API_URI + '#' + pointer}, registry=registry, format_checker=FormatChecker()).validate(value)
            checks += 1
            return value
        def cli(*args, ok=True):
            nonlocal commands
            result = subprocess.run([binary, *map(str, args)], capture_output=True, text=True, timeout=20)
            assert (result.returncode == 0) == ok, (args[0:2], result.returncode, result.stderr)
            assert all(token not in result.stdout + result.stderr for token in tokens.values())
            commands += 1
            return result
        def rows(sql, params=(), database=db_path, immutable=False):
            # Finished backup snapshots must not acquire WAL/SHM sidecars.
            target = Path(database).resolve().as_uri() + '?mode=ro&immutable=1' if immutable else database
            with closing(sqlite3.connect(target, uri=immutable)) as db:
                return db.execute(sql, params).fetchall()
        def wait(label, predicate):
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                value = predicate()
                if value:
                    return value
                time.sleep(.05)
            raise AssertionError('timeout: ' + label)
        source = 'urn:example:demo:archive'
        now = datetime.now(timezone.utc)
        old = (now - timedelta(days=3)).replace(hour=12, minute=0, second=0, microsecond=0)
        day = old.date().isoformat()
        def event(identity, when=old):
            return dict(specversion='1.0', id=identity, source=source, type='demo.event.created', time=when.isoformat().replace('+00:00', 'Z'), summary='Synthetic M5 ' + identity, correlationid='m5-archive-chain', data={'value': 1})
        def send(value, want=202):
            return call('POST', '/v1/events', 'source', value, want, 'application/cloudevents+json')
        def query():
            return call('GET', '/v1/events?source=' + quote(source, safe=''))['items']
        def queue_snapshot():
            return (rows('SELECT * FROM deliveries ORDER BY ordinal'), rows('SELECT * FROM delivery_attempts ORDER BY delivery_id,attempt'))
        def cursor_snapshot():
            return rows('SELECT id,activation_seq,scan_seq,digest_start FROM subscriptions ORDER BY id')
        def assert_cursor_progress(before):
            after = cursor_snapshot()
            assert [(row[0], row[1], row[3]) for row in after] == [(row[0], row[1], row[3]) for row in before]
            assert all(new[2] >= old[2] for old, new in zip(before, after)), 'maintenance reset a subscription scan cursor'
        try:
            start()
            historical = [event('old-' + str(i)) for i in range(4)]
            seqs = [send(value)['seq'] for value in historical]
            recent = [event('recent-' + str(i), now + timedelta(microseconds=i)) for i in range(2)]
            for value in recent:
                send(value)
            original = {item['seq']: item for item in query()}
            wait('all six delivery records materialized', lambda: rows('SELECT COUNT(*) FROM deliveries WHERE attempt_count=1')[0][0] == 6)
            stop()
            # Freeze only our synthetic queue, including representative leases,
            # terminal state and DLQ. Actual transport recovery is below.
            with closing(sqlite3.connect(db_path)) as db, db:
                db.execute("UPDATE deliveries SET next_attempt_at='9999-01-01T00:00:00Z', next_attempt_key='10000-01-01T00:00:00.!'")
                for seq, state in zip(seqs, ('pending', 'inflight', 'dlq', 'succeeded')):
                    db.execute("UPDATE deliveries SET state=?, lease_token=CASE WHEN ?='inflight' THEN 'synthetic-m5-lease' END, lease_until=CASE WHEN ?='inflight' THEN '10000-01-01T00:00:00.!' END WHERE event_seq=?", (state, state, state, seq))
            start()
            before_queue = queue_snapshot()
            before_cursors = cursor_snapshot()
            bad = root / 'not-a-directory'
            bad.write_text('synthetic write failure')
            cli('archive', 'run', '--db', db_path, '--archive-dir', bad, ok=False)
            assert {item['seq'] for item in query()} == set(original), 'write failure deleted hot data'
            assert rows('SELECT COUNT(*) FROM archives')[0][0] == 0
            cli('archive', 'run', '--db', db_path, '--archive-dir', archive_dir)
            cli('archive', 'verify', '--db', db_path, '--archive-dir', archive_dir, '--day', day)
            manifests = rows('SELECT day,part,path,event_count,sha256,first_seq,last_seq,verified_at,purged_at FROM archives ORDER BY part')
            assert len(manifests) == 1
            manifest = manifests[0]
            file = archive_dir / manifest[2]
            old_bytes = file.read_bytes()
            assert manifest[0] == day and manifest[3] == 4 and manifest[4] == digest(file)
            assert manifest[5:7] == (min(seqs), max(seqs)) and all(manifest[7:])
            assert [json.loads(line) for line in gzip.decompress(old_bytes).splitlines()] == historical
            assert rows('SELECT event_seq FROM archive_members ORDER BY ordinal') == [(seq,) for seq in seqs]
            assert {item['event']['id'] for item in query()} == {value['id'] for value in recent}
            for seq in seqs:
                call('GET', '/v1/events/' + str(seq), want=404)
            assert queue_snapshot() == before_queue, 'purge changed materialized delivery state'
            assert_cursor_progress(before_cursors)
            assert send(historical[0], 200) == {'seq': seqs[0], 'duplicate': True}
            send({**historical[0], 'summary': 'conflict after purge'}, 409)
            assert {item['event']['id'] for item in query()} == {value['id'] for value in recent}, 'producer retry rehydrated archive'
            late = event('late')
            late_seq = send(late)['seq']
            wait('late event delivery materialized and attempted', lambda: rows('SELECT attempt_count FROM deliveries WHERE event_seq=?', (late_seq,)) == [(1,)])
            with closing(sqlite3.connect(db_path)) as db, db:
                db.execute("UPDATE deliveries SET next_attempt_at='9999-01-01T00:00:00Z', next_attempt_key='10000-01-01T00:00:00.!' WHERE event_seq=?", (late_seq,))
            cli('archive', 'run', '--db', db_path, '--archive-dir', archive_dir)
            assert file.read_bytes() == old_bytes, 'late part overwrote original immutable file'
            parts = rows('SELECT part,path,event_count FROM archives WHERE day=? ORDER BY part', (day,))
            assert len(parts) == 2 and parts[1][0] > parts[0][0] and parts[1][2] == 1
            assert [json.loads(line) for line in gzip.decompress((archive_dir / parts[1][1]).read_bytes()).splitlines()] == [late]
            cli('archive', 'verify', '--db', db_path, '--archive-dir', archive_dir, '--day', day)
            cli('archive', 'import', '--db', db_path, '--archive-dir', archive_dir, '--day', day, ok=False)
            corrupt = root / 'corrupt-archive'
            shutil.copytree(archive_dir, corrupt)
            (corrupt / parts[1][1]).write_bytes(b'not a gzip archive')
            cli('archive', 'verify', '--db', db_path, '--archive-dir', corrupt, '--day', day, ok=False)
            cli('archive', 'import', '--db', db_path, '--archive-dir', corrupt, '--day', day, '--reason', 'synthetic corrupt drill', ok=False)
            assert len(query()) == 2, 'part verification failure partially imported the day'
            cursor = call('GET', '/v1/events?source=' + quote(source, safe='') + '&limit=1')['next_cursor']
            assert cursor
            freshness = call('GET', '/v1/sources')
            before_import_queue = queue_snapshot()
            before_import_cursors = cursor_snapshot()
            cli('archive', 'import', '--db', db_path, '--archive-dir', archive_dir, '--day', day, '--reason', 'synthetic archive drill')
            restored = query()
            assert len(restored) == 7
            for seq in seqs:
                item = call('GET', '/v1/events/' + str(seq))['item']
                assert item == {**original[seq], 'restored': True}
            assert {item['seq'] for item in restored if item.get('restored')} == {*seqs, late_seq}
            assert call('GET', '/v1/sources') == freshness, 'import changed producer freshness'
            assert queue_snapshot() == before_import_queue, 'import changed existing queue'
            assert_cursor_progress(before_import_cursors)
            call('GET', '/v1/events?source=' + quote(source, safe='') + '&limit=1&cursor=' + quote(cursor, safe=''), want=400)
            deadlines = rows('SELECT seq,restore_until FROM events WHERE restored=1 ORDER BY seq')
            cli('archive', 'import', '--db', db_path, '--archive-dir', archive_dir, '--day', day, '--reason', 'synthetic repeat drill')
            assert query() == restored and rows('SELECT seq,restore_until FROM events WHERE restored=1 ORDER BY seq') == deadlines
            assert rows("SELECT actor,reason FROM audit_log WHERE action='archive.import' ORDER BY seq") == [('owner', 'synthetic archive drill'), ('owner', 'synthetic repeat drill')]
            assert send(historical[0], 200)['seq'] == seqs[0]
            cli('archive', 'run', '--db', db_path, '--archive-dir', archive_dir)
            assert len(query()) == 7, 'restore retention deadline was ignored'
            # Delivery projections exclude restored history. Rule evaluation
            # and explicit backfill include restored hot rows, so later ticks
            # cannot erase recomputed history.
            config['rules'] = [dict(id='archive-count', version=1, title='Archive count', filter={'types': ['demo.event.*']}, aggregation={'fn': 'count'}, bucket='1d')]
            config['subscriptions'].append({**subscription, 'id': 'after-import', 'start': 'earliest_hot'})
            save()
            call('POST', '/v1/config:reload', 'owner')
            wait('new subscription scans ordinary hot history', lambda: rows("SELECT COUNT(*) FROM deliveries WHERE subscription_id='after-import'")[0][0] == 2)
            assert not rows("SELECT event_seq FROM deliveries WHERE subscription_id='after-import' AND event_seq IN (" + ','.join('?' for _ in [*seqs, late_seq]) + ')', [*seqs, late_seq])
            metric_path = '/v1/metrics/archive-count?from=' + day + 'T00:00:00Z&to=' + (old.date() + timedelta(days=1)).isoformat() + 'T00:00:00Z'
            assert sum(item['sample_count'] for item in call('GET', metric_path)['items']) == 5
            stop()
            cli('rules', 'backfill', '--db', db_path, '--config', config_path, '--rule', 'archive-count', '--from', day)
            start()
            assert sum(item['sample_count'] for item in call('GET', metric_path)['items']) == 5
            # Snapshot the actual WAL service while a bounded producer writes.
            backup = root / 'snapshot.sqlite'
            failures = []
            started = threading.Event()
            def writer():
                try:
                    for i in range(24):
                        send(event('during-backup-' + str(i), now))
                        started.set()
                except BaseException as error:
                    failures.append(error)
                    started.set()
            thread = threading.Thread(target=writer)
            thread.start()
            try:
                assert started.wait(20)
                cli('backup', '--db', db_path, '--output', backup)
            finally:
                thread.join(timeout=20)
            assert not thread.is_alive() and not failures, failures
            manifest_path = Path(str(backup) + '.manifest.json')
            backup_bytes = backup.read_bytes()
            backup_manifest_bytes = manifest_path.read_bytes()
            backup_manifest = json.loads(backup_manifest_bytes)
            assert backup_manifest['version'] == 1 and backup_manifest['file'] == backup.name
            assert backup_manifest['size_bytes'] == len(backup_bytes) and backup_manifest['sha256'] == digest(backup)
            assert rows('PRAGMA integrity_check', database=backup, immutable=True) == [('ok',)]
            for secret in tokens.values():
                assert secret.encode() not in backup_bytes
            cli('backup', '--db', db_path, '--output', backup, ok=False)
            assert backup.read_bytes() == backup_bytes and manifest_path.read_bytes() == backup_manifest_bytes
            snapshot_state = {table: rows('SELECT * FROM ' + table, database=backup, immutable=True) for table in ('events', 'event_identities', 'archives', 'archive_members', 'deliveries', 'delivery_attempts', 'subscriptions', 'rollups')}
            snapshot_sequences = dict(rows('SELECT name,seq FROM sqlite_sequence', database=backup, immutable=True))
            stop()
            source_hash = digest(db_path)
            drill = root / 'drill'
            drill.mkdir(mode=0o700)
            restored_db = drill / 'events.sqlite'
            cli('restore', '--backup', backup, '--db', restored_db, '--reason', 'synthetic isolated restore')
            assert rows('PRAGMA integrity_check', database=restored_db) == [('ok',)]
            for table, expected in snapshot_state.items():
                assert rows('SELECT * FROM ' + table, database=restored_db) == expected, 'snapshot changed ' + table
            for name, seq in snapshot_sequences.items():
                expected = seq + 1 if name == 'audit_log' else seq
                assert rows('SELECT seq FROM sqlite_sequence WHERE name=?', (name,), restored_db) == [(expected,)]
            assert rows("SELECT actor,reason FROM audit_log WHERE action='backup.restore'", database=restored_db) == [('owner', 'synthetic isolated restore')]
            restored_hash = digest(restored_db)
            cli('restore', '--backup', backup, '--db', restored_db, '--reason', 'no overwrite', ok=False)
            assert digest(restored_db) == restored_hash
            # Independent synthetic credentials/config and archive copy. No
            # source configuration, tokens, or existing backups are overwritten.
            for role in tokens:
                tokens[role] = secrets.token_urlsafe(32)
                path = drill / (role + '.token')
                path.write_text(tokens[role])
                path.chmod(0o600)
            isolated_config = json.loads(json.dumps(config).replace(str(source_dir), str(drill)))
            isolated_path = drill / 'config.json'
            isolated_path.write_text(json.dumps(isolated_config))
            isolated_path.chmod(0o600)
            isolated_archive = drill / 'archive'
            shutil.copytree(archive_dir, isolated_archive)
            cli('archive', 'verify', '--db', restored_db, '--archive-dir', isolated_archive, '--day', day)
            start(restored_db, isolated_path, drill)
            assert call('GET', '/v1/events/' + str(seqs[0]))['item']['restored'] is True
            assert sum(item['sample_count'] for item in call('GET', metric_path)['items']) == 5
            highest = rows('SELECT MAX(seq) FROM event_identities', database=restored_db)[0][0]
            new_seq = send(event('isolated-new-ingest', now))['seq']
            assert new_seq > highest
            replay_id = 'archive-state:' + str(seqs[2])
            assert call('POST', '/v1/deliveries/' + quote(replay_id, safe='') + ':replay', 'owner', {'reason': 'isolated replay'}, 202)['delivery_id'] == replay_id
            wait('isolated replay resumes attempts', lambda: rows('SELECT attempt_count FROM deliveries WHERE delivery_id=?', (replay_id,), restored_db)[0][0] > 1)
            # Advance the synthetic saved lease, proving restart recovery keeps
            # delivery identity and materialized body even after purge/import.
            inflight_id = 'archive-state:' + str(seqs[1])
            with closing(sqlite3.connect(restored_db)) as db, db:
                db.execute("UPDATE deliveries SET lease_until='' WHERE delivery_id=?", (inflight_id,))
            wait('isolated inflight recovers', lambda: rows('SELECT attempt_count FROM deliveries WHERE delivery_id=?', (inflight_id,), restored_db)[0][0] > 1)
            assert rows('SELECT body FROM deliveries WHERE delivery_id=?', (inflight_id,), restored_db) == rows('SELECT body FROM deliveries WHERE delivery_id=?', (inflight_id,), backup, immutable=True)
            assert digest(db_path) == source_hash and backup.read_bytes() == backup_bytes and manifest_path.read_bytes() == backup_manifest_bytes
            print(f'PASS: {checks} M5 real HTTP/OpenAPI responses and {commands} CLI outcomes; archive bytes/hash/membership/exact purge, write/corruption failures, late immutable part, durable dedupe/seq, restored repeat/audit/cursor, rule backfill, queue preservation, live WAL backup, isolated restore/query/new ingest/replay/lease recovery')
        finally:
            stop()


if __name__ == '__main__':
    main()
