"""Offline contracts for the unified read-only entry point."""
import contextlib
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).parents[1]))
import agent_usage as a


class Unified(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.now = 1800000000

    def write(self, name, value):
        path = self.base / name
        path.write_text(json.dumps(value))
        return str(path)

    def manual(self, **overrides):
        data = {'observed_at': a.iso(self.now), 'windows': [
            {'name': 'weekly', 'used_percent': 25, 'resets_at': a.iso(self.now + 1000),
             'window_duration_minutes': 10080}]}
        data.update(overrides)
        return {'provider': 'grok-bot', 'kind': 'manual', 'path': self.write('manual.json', data)}

    def collect(self, sources, selected=None):
        return a.snapshot({'version': 1, 'sources': sources}, selected, now=self.now)

    def test_all_seven_unknown_no_config(self):
        result = a.snapshot(now=self.now)
        self.assertEqual([p['provider'] for p in result['providers']], list(a.PROVIDERS))
        self.assertTrue(all(p['status'] == 'unknown' for p in result['providers']))
        self.assertEqual(a.exit_code(result), 1)

    def test_manual_selection_and_no_sum(self):
        result = self.collect([self.manual()], ['grok-bot'])
        provider = result['providers'][0]
        self.assertEqual(provider['windows'][0]['remaining_percent'], 75)
        self.assertEqual(provider['source_kind'], 'manual')
        self.assertFalse(provider['identity_verified'])
        self.assertEqual(a.exit_code(result), 0)
        self.assertNotIn('total', result)

    def test_stale_and_elapsed_reset_suppress_remaining(self):
        for age, reset in [(6000, 10000), (10, -1)]:
            src = self.manual(observed_at=a.iso(self.now - age), windows=[
                {'name': 'weekly', 'used_percent': 25, 'resets_at': a.iso(self.now + reset),
                 'window_duration_minutes': None}])
            p = self.collect([src], ['grok-bot'])['providers'][0]
            self.assertIsNone(p['windows'][0]['remaining_percent'])
            self.assertEqual(p['windows'][0]['observed_used_percent'], 25)
            self.assertEqual(p['status'], 'partial')

    def test_manual_invalid_values_sanitized(self):
        for value in [True, float('nan'), float('inf'), -1, 'secret@example.test']:
            src = self.manual(windows=[{'name': 'weekly', 'used_percent': value}])
            result = self.collect([src], ['grok-bot'])
            self.assertEqual(result['providers'][0]['status'], 'error')
            self.assertNotIn('secret@', json.dumps(result))

    def test_future_and_invalid_dates(self):
        for stamp in [a.iso(self.now + 1), '2026-01-01', 'secret']:
            p = self.collect([self.manual(observed_at=stamp)], ['grok-bot'])['providers'][0]
            self.assertEqual(p['status'], 'error')

    def test_config_rejects_duplicates_unknowns_and_commands(self):
        src = self.manual()
        for sources in [[src, src], [dict(src, provider='secret')], [dict(src, command='secret')],
                        [dict(src, url='https://example.test')], [dict(src, pool_id='secret@example.test')]]:
            with self.assertRaises(a.UsageError):
                a.validate_config({'version': 1, 'sources': sources})

    def test_files_bounded_regular(self):
        fifo = self.base / 'fifo'
        os.mkfifo(fifo)
        with self.assertRaises(a.UsageError):
            a.read_json(str(fifo))
        huge = self.base / 'huge'
        huge.write_bytes(b' ' * (a.FILE_LIMIT + 1))
        with self.assertRaises(a.UsageError):
            a.read_json(str(huge))

    def test_database_readonly_and_error_is_private(self):
        db = self.base / 'usage.db'
        with contextlib.closing(sqlite3.connect(db)) as conn:
            conn.execute('CREATE TABLE snapshots(ts,window,used_pct,remaining_pct,reset_in_s,elapsed_pct,pace,exhaust_in_s,resets_at,local_tokens,local_output_tokens,verdict)')
            conn.execute('CREATE TABLE errors(ts,message)')
            conn.execute('INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                         (self.now - 5, 'five_hour', 30, 70, 1000, 50, .6, None, self.now + 1000, 17, 3, 'OK'))
            conn.execute('INSERT INTO errors VALUES(?,?)', (self.now, 'private-secret@example.test'))
            conn.commit()
        before = hashlib.sha256(db.read_bytes()).hexdigest()
        p = self.collect([{'provider': 'claude', 'kind': 'claude-db', 'path': str(db)}], ['claude'])['providers'][0]
        self.assertEqual(hashlib.sha256(db.read_bytes()).hexdigest(), before)
        self.assertEqual(p['status'], 'partial')
        self.assertEqual(p['windows'][0]['remaining_percent'], 70)
        self.assertFalse(p['identity_verified'])
        self.assertNotIn('private', json.dumps(p))
        self.assertEqual(p['usage']['local_tokens'], 17)

    def test_missing_database_not_created(self):
        path = self.base / 'missing.db'
        p = self.collect([{'provider': 'claude', 'kind': 'claude-db', 'path': str(path)}], ['claude'])['providers'][0]
        self.assertEqual(p['status'], 'error')
        self.assertFalse(path.exists())

    def test_capture_whitelist_private_mode_and_symlink(self):
        path = self.base / 'capture.json'
        raw = {'rate_limits': {'five_hour': {'used_percentage': 23, 'resets_at': self.now + 1000},
                               'seven_day': {'used_percentage': None}}, 'transcript_path': 'private',
               'session_id': 'secret', 'email': 'x@example.test'}
        a.capture_claude(str(path), io.StringIO(json.dumps(raw)), now=self.now)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('private', path.read_text())
        self.assertNotIn('session', path.read_text())
        p = self.collect([{'provider': 'claude', 'kind': 'claude-statusline', 'path': str(path)}], ['claude'])['providers'][0]
        self.assertEqual(p['windows'][0]['remaining_percent'], 77)
        link = self.base / 'link'
        link.symlink_to(path)
        with self.assertRaises(a.UsageError):
            a.capture_claude(str(link), io.StringIO('{}'), now=self.now)

    def test_capture_first_response_unknown(self):
        path = self.base / 'capture.json'
        a.capture_claude(str(path), io.StringIO('{}'), now=self.now)
        p = self.collect([{'provider': 'claude', 'kind': 'claude-statusline', 'path': str(path)}], ['claude'])['providers'][0]
        self.assertEqual(p['status'], 'unknown')
        self.assertEqual(p['windows'], [])

    def test_codex_reuse_and_metadata_redaction(self):
        raw = {'status': 'ok', 'identity': {'account_email_verified': True},
               'quota_buckets': [{'bucket': 'private@example.test', 'limit_name': 'secret',
                                  'windows': [{'name': 'primary', 'used_percent': 20,
                                               'resets_at': a.iso(self.now + 300),
                                               'window_duration_minutes': 300}]}],
               'token_statistics': {'summary': {'lifetimeTokens': 123}}, 'errors': []}
        with mock.patch.object(a.codex_usage, 'collect', return_value=raw) as collect:
            p = self.collect([{'provider': 'codex', 'kind': 'codex', 'target_file': 'private'}], ['codex'])['providers'][0]
        self.assertEqual(collect.call_count, 1)
        self.assertEqual(p['windows'][0]['remaining_percent'], 80)
        self.assertIsNone(p['observed_at'])
        self.assertNotIn('private', json.dumps(p))
        self.assertNotIn('secret', json.dumps(p))

    def test_codex_identity_failure_has_no_data(self):
        with mock.patch.object(a.codex_usage, 'collect', return_value={
                'status': 'error', 'identity': None, 'quota_buckets': [{'windows': [{'used_percent': 10}]}],
                'token_statistics': {'summary': {'lifetimeTokens': 123}}, 'errors': []}):
            p = self.collect([{'provider': 'codex', 'kind': 'codex', 'target_file': 'private'}], ['codex'])['providers'][0]
        self.assertEqual(p['windows'], [])
        self.assertEqual(p['usage'], {})

    def test_codex_signed_percent_and_zero_duration_are_preserved(self):
        raw = {'status': 'ok', 'identity': {'account_email_verified': True},
               'quota_buckets': [{'windows': [{'name': 'primary', 'used_percent': -1,
                                               'resets_at': None, 'window_duration_minutes': 0}]}],
               'token_statistics': {'summary': {}}, 'errors': []}
        with mock.patch.object(a.codex_usage, 'collect', return_value=raw):
            p = self.collect([{'provider': 'codex', 'kind': 'codex', 'target_file': 'private'}], ['codex'])['providers'][0]
        self.assertEqual(p['status'], 'ok')
        self.assertEqual(p['windows'][0]['used_percent'], -1)
        self.assertEqual(p['windows'][0]['remaining_percent'], 100)
        self.assertEqual(p['windows'][0]['window_duration_minutes'], 0)

    def test_codex_source_failure_preserves_error_status(self):
        with mock.patch.object(a.codex_usage, 'collect', return_value={
                'status': 'error', 'identity': {'account_email_verified': True},
                'quota_buckets': None, 'token_statistics': None, 'errors': []}):
            p = self.collect([{'provider': 'codex', 'kind': 'codex', 'target_file': 'private'}], ['codex'])['providers'][0]
        self.assertEqual(p['status'], 'error')
        self.assertEqual(p['usage'], {})

    def test_mixed_null_windows_partial(self):
        src = self.manual(windows=[{'name': 'weekly', 'used_percent': 25},
                                   {'name': 'daily', 'used_percent': None}])
        p = self.collect([src], ['grok-bot'])['providers'][0]
        self.assertEqual(p['status'], 'partial')

    def test_codex_output_is_bounded(self):
        raw = {'status': 'ok', 'identity': {'account_email_verified': True},
               'quota_buckets': [{'windows': [{'name': 'primary', 'used_percent': 2}]}] * 100,
               'token_statistics': {'summary': {}}, 'errors': []}
        with mock.patch.object(a.codex_usage, 'collect', return_value=raw):
            p = self.collect([{'provider': 'codex', 'kind': 'codex', 'target_file': 'private'}], ['codex'])['providers'][0]
        self.assertLessEqual(len(p['windows']), 32)
        self.assertEqual(p['status'], 'partial')

    def test_partial_peers_survive_cli(self):
        config = self.write('config.json', {'version': 1, 'sources': [self.manual()]})
        output = io.StringIO()
        with contextlib.redirect_stdout(output), mock.patch.object(a.time, 'time', return_value=self.now):
            code = a.main(['snapshot', '--config', config])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue())['providers'][5]['status'], 'ok')

    def test_cli_invalid_sanitized(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = a.main(['snapshot', '--secret-account-option'])
        self.assertEqual(code, 1)
        self.assertNotIn('secret', output.getvalue())

    def test_cursor_exact_request_and_ambiguous_identity(self):
        source = {'provider': 'cursor', 'kind': 'cursor-admin', 'expected_email': 'a@example.test',
                  'token_env': 'AGENT_USAGE_TEST_TOKEN'}
        payload = {'teamMemberSpend': [{'email': 'a@example.test', 'spendCents': 125,
                                        'overallSpendCents': 250}], 'totalMembers': 1, 'totalPages': 1}
        with mock.patch.dict(os.environ, {'AGENT_USAGE_TEST_TOKEN': 'private-token'}), \
             mock.patch.object(a, 'cursor_request', return_value=payload) as request:
            p = self.collect([source], ['cursor'])['providers'][0]
        self.assertEqual(p['usage']['on_demand_usd'], 1.25)
        self.assertEqual(p['usage']['total_usd'], 2.5)
        self.assertEqual(p['windows'], [])
        self.assertTrue(p['identity_verified'])
        self.assertNotIn('private', json.dumps(p))
        self.assertEqual(request.call_args.args[1], 'a@example.test')
        payload['teamMemberSpend'] *= 2
        with mock.patch.dict(os.environ, {'AGENT_USAGE_TEST_TOKEN': 'private-token'}), \
             mock.patch.object(a, 'cursor_request', return_value=payload):
            p = self.collect([source], ['cursor'])['providers'][0]
        self.assertEqual(p['status'], 'error')
        self.assertEqual(p['usage'], {})

    def test_cursor_totalmembers_can_describe_whole_team(self):
        src = {'provider': 'cursor', 'kind': 'cursor-admin', 'expected_email': 'a@example.test',
               'token_env': 'AGENT_USAGE_TEST_TOKEN'}
        payload = {'totalPages': 1, 'totalMembers': 15, 'teamMemberSpend': [
            {'email': 'a@example.test', 'spendCents': 125, 'overallSpendCents': 250}]}
        with mock.patch.dict(os.environ, {'AGENT_USAGE_TEST_TOKEN': 'test-token'}), \
             mock.patch.object(a, 'cursor_request', return_value=payload):
            p = self.collect([src], ['cursor'])['providers'][0]
        self.assertEqual(p['status'], 'ok')
        del payload['totalPages']
        with mock.patch.dict(os.environ, {'AGENT_USAGE_TEST_TOKEN': 'test-token'}), \
             mock.patch.object(a, 'cursor_request', return_value=payload):
            p = self.collect([src], ['cursor'])['providers'][0]
        self.assertEqual(p['status'], 'error')

    def test_live_observation_fractional_time_does_not_become_future(self):
        src = {'provider': 'cursor', 'kind': 'cursor-admin', 'expected_email': 'a@example.test',
               'token_env': 'AGENT_USAGE_TEST_TOKEN'}
        payload = {'totalPages': 1, 'totalMembers': 1, 'teamMemberSpend': [
            {'email': 'a@example.test', 'spendCents': 125, 'overallSpendCents': 250}]}
        with mock.patch.dict(os.environ, {'AGENT_USAGE_TEST_TOKEN': 'test-token'}), \
             mock.patch.object(a, 'cursor_request', return_value=payload):
            result = a.snapshot({'version': 1, 'sources': [src]}, ['cursor'], now=self.now + .1234567)
        self.assertEqual(result['providers'][0]['status'], 'ok')
        self.assertEqual(result['providers'][0]['age_seconds'], 0)
        cli = self.executable('opencode', 'print("│Sessions 8 │")')
        result = a.snapshot({'version': 1, 'sources': [
            {'provider': 'opencode-go', 'kind': 'opencode-stats', 'cli': cli}]},
            ['opencode-go'], now=self.now + .1234567)
        self.assertEqual(result['providers'][0]['status'], 'partial')
        self.assertNotIn('observation_in_future', result['providers'][0]['errors'])

    def test_cursor_http_protocol_error_sanitized_and_peers_survive(self):
        src = {'provider': 'cursor', 'kind': 'cursor-admin', 'expected_email': 'a@example.test',
               'token_env': 'AGENT_USAGE_TEST_TOKEN'}
        opener = mock.Mock()
        opener.open.side_effect = http.client.BadStatusLine('private upstream@example.test')
        with mock.patch.dict(os.environ, {'AGENT_USAGE_TEST_TOKEN': 'test-token'}), \
             mock.patch.object(a.urllib.request, 'build_opener', return_value=opener):
            result = self.collect([src, self.manual()], ['cursor', 'grok-bot'])
        self.assertEqual(result['providers'][0]['errors'], ['cursor_request_failed'])
        self.assertEqual(result['providers'][1]['status'], 'ok')
        self.assertEqual(a.exit_code(result), 2)
        self.assertNotIn('private', json.dumps(result))

    def test_cursor_transport_url_body_auth_and_no_redirect(self):
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{"teamMemberSpend":[]}'
        opener = mock.Mock()
        opener.open.return_value = response
        with mock.patch.object(a.urllib.request, 'build_opener', return_value=opener) as build:
            a.cursor_request('test-token', 'test@example.test', 1)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://api.cursor.com/teams/spend')
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(json.loads(request.data), {'searchTerm': 'test@example.test', 'page': 1, 'pageSize': 100})
        self.assertEqual(request.get_header('Authorization'), 'Basic dGVzdC10b2tlbjo=')
        handler = build.call_args.args[0]
        self.assertIsNone(handler.redirect_request(None, None, 302, '', {}, 'https://elsewhere.test'))

    def test_cursor_key_missing_no_request_and_pagination_closed(self):
        src = {'provider': 'cursor', 'kind': 'cursor-admin', 'expected_email': 'a@example.test',
               'token_env': 'AGENT_USAGE_TEST_TOKEN'}
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(a, 'cursor_request') as request:
            p = self.collect([src], ['cursor'])['providers'][0]
        self.assertEqual(p['status'], 'unknown')
        request.assert_not_called()
        with mock.patch.dict(os.environ, {'AGENT_USAGE_TEST_TOKEN': 'test-token'}), \
             mock.patch.object(a, 'cursor_request', return_value={'totalPages': 2, 'totalMembers': 2,
                 'teamMemberSpend': [{'email': 'a@example.test', 'spendCents': 1}]}):
            p = self.collect([src], ['cursor'])['providers'][0]
        self.assertEqual(p['status'], 'error')
        self.assertEqual(p['usage'], {})

    def executable(self, name, code):
        path = self.base / name
        path.write_text('#!' + sys.executable + '\n' + code)
        path.chmod(0o700)
        return str(path)

    def test_opencode_exact_command_approximate_activity_not_quota(self):
        cli = self.executable('opencode', '''import sys
assert sys.argv[1:] == ['--pure','stats','--days','2'], sys.argv
print(''' + repr('''│Sessions                                              8 │
│Messages                                             22 │
│Total Cost                                        $0.06 │
│Avg Tokens/Session                                36.9K │
│Input                                            176.5K │
│Output                                             3.0K │
│Cache Read                                        41.0K │
│Cache Write                                       25.9K │''') + ''')
''')
        p = self.collect([{'provider': 'opencode-go', 'kind': 'opencode-stats', 'cli': cli, 'days': 2}], ['opencode-go'])['providers'][0]
        self.assertEqual(p['status'], 'ok')
        self.assertEqual(p['metric_scope'], 'local_activity_all_providers')
        self.assertEqual(p['usage']['input_tokens'], 176500)
        self.assertTrue(p['approximate'])
        self.assertEqual(p['windows'], [])

    def test_fixed_process_timeout_output_bound_and_cleanup(self):
        for name, code, expected in [('sleep', 'import time; time.sleep(30)', 'cli_timeout'),
                                      ('flood', 'import sys; sys.stdout.write("x" * 2000000)', 'cli_output_too_large')]:
            cli = self.executable(name, code)
            with self.assertRaises(a.UsageError) as error:
                a.run_fixed([cli], .1)
            self.assertEqual(error.exception.code, expected)

    def test_exited_leader_descendant_is_killed(self):
        pidfile = self.base / 'descendant.pid'
        cli = self.executable('parent', 'import subprocess,sys\np=subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"],stdout=subprocess.DEVNULL)\nopen(' + repr(str(pidfile)) + ',"w").write(str(p.pid))\nprint("ok")\n')
        self.assertEqual(a.run_fixed([cli], 1), 'ok\n')
        pid = int(pidfile.read_text())
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            state = Path('/proc') / str(pid) / 'stat'
            try:
                if state.read_text().split()[2] == 'Z':
                    break
            except (FileNotFoundError, ProcessLookupError):
                break
            time.sleep(.01)
        else:
            self.fail('descendant still running')

    def test_native_cli_sources_and_invalid_config(self):
        script = Path(a.__file__)
        result = subprocess.run([sys.executable, str(script), 'sources'], text=True, capture_output=True, timeout=3)
        self.assertEqual(result.returncode, 0)
        registry = json.loads(result.stdout)
        self.assertEqual(len(registry['providers']), 7)
        config = self.write('invalid.json', {'version': 1, 'sources': [{'provider': 'secret@example.test'}]})
        result = subprocess.run([sys.executable, str(script), 'snapshot', '--config', config], text=True, capture_output=True, timeout=3)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn('secret', result.stdout + result.stderr)
        self.assertNotIn('Traceback', result.stdout + result.stderr)

    def test_table_observation_reset_and_approximation(self):
        cli = self.executable('opencode', 'print("│Input 176.5K │")')
        result = self.collect([self.manual(), {'provider': 'opencode-go', 'kind': 'opencode-stats', 'cli': cli}],
                              ['opencode-go', 'grok-bot'])
        rendered = a.table(result)
        self.assertIn('observed_at=' + a.iso(self.now), rendered)
        self.assertIn('age_seconds=0', rendered)
        self.assertIn('stale=false', rendered)
        self.assertIn('approximate=true', rendered)
        self.assertIn('resets_at=' + a.iso(self.now + 1000), rendered)
        self.assertIn('seconds_until_reset=1000', rendered)


if __name__ == '__main__':
    unittest.main()
