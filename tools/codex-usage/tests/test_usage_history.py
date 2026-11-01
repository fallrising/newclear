"""Offline history contracts against the archived cc-quota schema."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).parents[1]))
import agent_usage as a


class History(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'history.db'
        self.now = 1800000000
        self.config = {'version': 1, 'sources': [
            {'provider': 'claude', 'kind': 'claude-db', 'path': str(self.path)}]}
        with contextlib.closing(sqlite3.connect(self.path)) as conn:
            conn.execute('''CREATE TABLE snapshots(
                ts INTEGER, window TEXT, used_pct REAL, remaining_pct REAL, reset_in_s INTEGER,
                elapsed_pct REAL, pace REAL, exhaust_in_s INTEGER, resets_at INTEGER,
                local_tokens INTEGER, local_output_tokens INTEGER, verdict TEXT,
                PRIMARY KEY(ts,window))''')
            conn.execute('CREATE TABLE raw(ts INTEGER PRIMARY KEY,json TEXT)')
            conn.execute('CREATE TABLE errors(ts INTEGER,message TEXT)')
            conn.execute('INSERT INTO raw VALUES(?,?)', (self.now, 'SECRET-RAW'))
            conn.commit()

    def row(self, age=10, window='five_hour', used=30, reset=None, tokens=17, output=3):
        with contextlib.closing(sqlite3.connect(self.path)) as conn:
            conn.execute('INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                         (self.now - age, window, used, 999, None, None, None, None,
                          reset, tokens, output, 'SECRET-VERDICT'))
            conn.commit()

    def history(self, **kwargs):
        return a.history(self.config, now=self.now, **kwargs)

    def cli(self, *args):
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream), mock.patch.object(a.time, 'time', return_value=self.now):
            code = a.main(list(args))
        return code, stream.getvalue()

    def config_file(self):
        path = Path(self.tmp.name) / 'config.json'
        path.write_text(json.dumps(self.config))
        return str(path)

    def test_schema_historical_values_and_no_current_claim(self):
        self.row(reset=self.now - 1)
        r = self.history()
        self.assertEqual(r['schema_version'], 1)
        self.assertEqual(r['metric_scope'], 'quota_history')
        self.assertEqual((r['provider'], r['source_kind']), ('claude', 'claude-db'))
        self.assertFalse(r['identity_verified'])
        self.assertEqual(r['status'], 'ok')
        p = r['points'][0]
        self.assertEqual(p['observed_used_percent'], 30)
        self.assertEqual(p['observed_remaining_percent'], 70)
        self.assertTrue(p['historical'])
        self.assertNotIn('remaining_percent', p)
        self.assertEqual((p['local_tokens'], p['local_output_tokens']), (17, 3))
        self.assertEqual(r['usage_scope'], 'local_activity_not_quota_cycle')
        self.assertIsNone(p['gap_before_seconds'])

    def test_interleaved_windows_gap_is_per_window(self):
        self.row(age=8000)
        self.row(age=6000, window='seven_day')
        self.row(age=4000, window='seven_day')
        self.row(age=1000)
        r = self.history()
        self.assertEqual([p['gap_before_seconds'] for p in r['points']], [None, None, 2000, 7000])
        self.assertIn('history_gap', r['errors'])
        self.assertEqual(r['status'], 'partial')

    def test_gap_threshold_and_historical_age_not_stale(self):
        self.row(age=20000)
        self.row(age=14600)
        self.assertEqual(self.history()['status'], 'ok')

    def test_now_anchored_range_and_inclusive_boundaries(self):
        self.row(age=3601)
        self.assertEqual(self.history(hours=1)['points'], [])
        self.assertEqual(self.history(hours=1)['status'], 'unknown')
        self.row(age=3600, window='seven_day')
        self.row(age=0)
        self.assertEqual(len(self.history(hours=1)['points']), 2)

    def test_limit_rows_sorting_ties_and_truncation(self):
        for name in ('seven_day_opus', 'five_hour', 'seven_day'):
            self.row(window=name)
        self.row(age=20)
        r = self.history(limit=2)
        self.assertEqual([p['window'] for p in r['points']], ['seven_day', 'seven_day_opus'])
        self.assertTrue(r['truncated'])
        self.assertEqual(r['status'], 'partial')
        self.assertIn('history_truncated', r['errors'])
        self.assertFalse(self.history(limit=4)['truncated'])

    def test_null_usage_unknown_or_partial_never_zero(self):
        self.row(used=None, tokens=None, output=None)
        r = self.history()
        self.assertEqual(r['status'], 'unknown')
        self.assertIsNone(r['points'][0]['observed_remaining_percent'])
        self.row(age=20, window='seven_day', used=0)
        self.assertEqual(self.history()['status'], 'partial')
        self.assertIn('window_value_missing', self.history()['errors'])

    def test_future_excluded_and_visible(self):
        self.row(age=-1)
        self.assertEqual(self.history()['points'], [])
        self.assertIn('future_observation_excluded', self.history()['errors'])
        self.row()
        self.assertEqual(self.history()['status'], 'partial')

    def test_later_error_private_and_equal_latest_counts(self):
        self.row()
        with contextlib.closing(sqlite3.connect(self.path)) as conn:
            conn.execute('INSERT INTO errors VALUES(?,?)', (self.now - 10, 'SECRET-ERROR'))
            conn.commit()
        r = self.history()
        self.assertEqual(r['status'], 'partial')
        self.assertIn('recorded_error_after_snapshot', r['errors'])
        self.assertNotIn('SECRET', json.dumps(r))
        self.assertNotIn(str(self.path), json.dumps(r))

    def test_older_error_does_not_poison_history(self):
        self.row()
        with contextlib.closing(sqlite3.connect(self.path)) as conn:
            conn.execute('INSERT INTO errors VALUES(?,?)', (self.now - 11, 'SECRET'))
            conn.commit()
        self.assertEqual(self.history()['status'], 'ok')

    def test_fractional_timestamp_error_comparison_keeps_source_precision(self):
        self.row(age=9.8765433)
        with contextlib.closing(sqlite3.connect(self.path)) as conn:
            conn.execute('INSERT INTO errors VALUES(?,?)', (self.now - 9.8765433, 'SECRET'))
            conn.commit()
        self.assertIn('recorded_error_after_snapshot', self.history()['errors'])

    def test_missing_database_not_created(self):
        self.config['sources'][0]['path'] += '-missing'
        self.assertEqual(self.history()['status'], 'error')
        self.assertFalse(Path(self.config['sources'][0]['path']).exists())

    def test_hash_mtime_and_directory_unchanged(self):
        self.row()
        before = (hashlib.sha256(self.path.read_bytes()).hexdigest(), self.path.stat().st_mtime_ns,
                  sorted(p.name for p in self.path.parent.iterdir()))
        self.history()
        after = (hashlib.sha256(self.path.read_bytes()).hexdigest(), self.path.stat().st_mtime_ns,
                 sorted(p.name for p in self.path.parent.iterdir()))
        self.assertEqual(before, after)

    def test_wal_copy_rejected_without_creating_or_changing_sidecars(self):
        self.row()
        writer = self.path.with_name('writer.db')
        writer.write_bytes(self.path.read_bytes())
        with contextlib.closing(sqlite3.connect(writer)) as conn:
            self.assertEqual(conn.execute('PRAGMA journal_mode=WAL').fetchone()[0], 'wal')
            conn.execute('INSERT INTO errors VALUES(?,?)', (self.now - 100, 'SECRET'))
            conn.commit()
            for include_shm in (None, False, True):
                with self.subTest(include_shm=include_shm):
                    copied = self.path.with_name(f'copied-{include_shm}.db')
                    copied.write_bytes(writer.read_bytes())
                    if include_shm is not None:
                        Path(str(copied) + '-wal').write_bytes(Path(str(writer) + '-wal').read_bytes())
                    if include_shm:
                        Path(str(copied) + '-shm').write_bytes(Path(str(writer) + '-shm').read_bytes())
                    self.config['sources'][0]['path'] = str(copied)
                    def files():
                        return {p.name: (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
                                for p in copied.parent.iterdir()}
                    before = files()
                    result = self.history()
                    self.assertEqual(files(), before)
                    self.assertEqual(result['errors'], ['database_wal_unsupported'])
                    self.assertEqual(result['points'], [])
                    self.assertEqual(result['status'], 'error')

    def test_existing_sidecars_rejected_before_sqlite_connect(self):
        for suffix, code in [('-wal', 'database_wal_unsupported'), ('-shm', 'database_wal_unsupported'),
                             ('-journal', 'database_sidecar_unsupported')]:
            with self.subTest(suffix=suffix):
                sidecar = Path(str(self.path) + suffix)
                sidecar.write_bytes(b'SECRET-SIDECAR')
                with mock.patch.object(a.sqlite3, 'connect', side_effect=AssertionError):
                    result = self.history()
                self.assertEqual(result['errors'], [code])
                self.assertEqual(sidecar.read_bytes(), b'SECRET-SIDECAR')
                sidecar.unlink()

    def test_invalid_options_are_sanitized(self):
        for name, values in [('hours', [0, 8761, True, 1.5, 'SECRET']),
                             ('limit', [0, 501, True, 1.5, 'SECRET'])]:
            for value in values:
                with self.subTest(name=name, value=value), self.assertRaises(a.UsageError) as caught:
                    self.history(**{name: value})
                self.assertEqual(caught.exception.code, 'options_invalid')
        for args in [[], ['--hours', 'SECRET'], ['--hours', '0'], ['--limit', '501'],
                     ['--format', 'SECRET'], ['--provider', 'SECRET']]:
            code, text = self.cli('history', *args)
            self.assertEqual(code, 1)
            self.assertNotIn('SECRET', text)
            self.assertEqual(json.loads(text)['errors'], ['options_invalid'])
        for option, value in [('--hours', '0'), ('--hours', '8761'), ('--limit', '0'), ('--limit', '501')]:
            code, text = self.cli('history', '--config', self.config_file(), option, value)
            self.assertEqual(code, 1)
            self.assertEqual(json.loads(text)['errors'], ['options_invalid'])

    def test_invalid_schema_and_values_fail_without_raw_labels(self):
        for field, value in [('window', 'SECRET'), ('used_pct', -1), ('used_pct', float('inf')),
                             ('used_pct', 'SECRET'), ('resets_at', -1), ('local_tokens', -1),
                             ('local_output_tokens', 'SECRET'), ('ts', 'SECRET')]:
            with self.subTest(field=field, value=value):
                with contextlib.closing(sqlite3.connect(self.path)) as conn:
                    conn.execute('DELETE FROM snapshots')
                    conn.commit()
                self.row()
                with contextlib.closing(sqlite3.connect(self.path)) as conn:
                    conn.execute(f'UPDATE snapshots SET {field}=?', (value,))
                    conn.commit()
                r = self.history()
                self.assertEqual(r['status'], 'error')
                self.assertEqual(r['points'], [])
                self.assertNotIn('SECRET', json.dumps(r))
        with contextlib.closing(sqlite3.connect(self.path)) as conn:
            conn.execute('DROP TABLE snapshots')
            conn.commit()
        self.assertEqual(self.history()['status'], 'error')

    def test_invalid_error_timestamp_fails(self):
        self.row()
        with contextlib.closing(sqlite3.connect(self.path)) as conn:
            conn.execute('INSERT INTO errors VALUES(?,?)', ('SECRET', 'SECRET'))
            conn.commit()
        self.assertEqual(self.history()['status'], 'error')

    def test_only_configured_claude_db_no_collectors_credentials(self):
        cases = [[], [{'provider': 'claude', 'kind': 'manual', 'path': 'SECRET'}],
                 [{'provider': 'claude', 'kind': 'claude-statusline', 'path': 'SECRET'}],
                 [{'provider': 'codex', 'kind': 'codex', 'target_file': 'SECRET'}]]
        with mock.patch.object(a.codex_usage, 'collect', side_effect=AssertionError), \
                mock.patch.object(a, 'run_fixed', side_effect=AssertionError), \
                mock.patch.object(a, 'cursor_request', side_effect=AssertionError), \
                mock.patch.object(a.os.environ, 'get', side_effect=AssertionError), \
                mock.patch.object(a, 'read_json', side_effect=AssertionError):
            for sources in cases:
                r = a.history({'version': 1, 'sources': sources}, now=self.now)
                self.assertEqual(r['status'], 'unknown')
                self.assertEqual(r['points'], [])
                self.assertNotIn('SECRET', json.dumps(r))

    def test_config_validation_still_applies(self):
        with self.assertRaises(a.UsageError):
            a.history({'version': 1, 'sources': [], 'SECRET': True}, now=self.now)

    def test_cli_json_table_and_exit_codes(self):
        config = self.config_file()
        code, text = self.cli('history', '--config', config)
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(text)['status'], 'unknown')
        self.row()
        code, text = self.cli('history', '--config', config, '--hours', '24', '--limit', '100')
        self.assertEqual(code, 0)
        self.assertEqual(len(json.loads(text)['points']), 1)
        self.row(age=8000)
        code, text = self.cli('history', '--config', config, '--format', 'table', '--limit', '1')
        self.assertEqual(code, 2)
        for word in ('Historical', 'UTC', 'five_hour', 'local', 'history_truncated'):
            self.assertIn(word, text)

    def test_database_limits_and_query_only_deadline_no_private_reads(self):
        self.row()
        original = sqlite3.connect
        queries = []
        def connect(*args, **kwargs):
            self.assertIn('mode=ro', args[0])
            conn = original(*args, **kwargs)
            conn.set_trace_callback(queries.append)
            def authorize(action, table, column, *_):
                if action == sqlite3.SQLITE_READ and (table == 'raw' or column in ('message', 'verdict')):
                    return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK
            conn.set_authorizer(authorize)
            return conn
        with mock.patch.object(a.sqlite3, 'connect', side_effect=connect):
            self.assertEqual(self.history()['status'], 'ok')
        self.assertIn('PRAGMA query_only=ON', queries)
        with mock.patch.object(a, 'DB_LIMIT', 1):
            self.assertEqual(self.history()['status'], 'error')
        with mock.patch.object(a.time, 'monotonic', side_effect=[0] + [100] * 1000):
            with contextlib.closing(sqlite3.connect(self.path)) as conn:
                conn.executemany('INSERT INTO errors VALUES(?,?)', [(self.now - 100, 'SECRET')] * 2000)
                conn.commit()
            self.assertEqual(self.history()['status'], 'error')


if __name__ == '__main__':
    unittest.main()
