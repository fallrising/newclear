#!/usr/bin/env python3
"""One read-only, standard-library entry point for explicitly configured usage sources.

Quota observations, local activity and team spending are deliberately distinct.
No source starts a model turn, discovers accounts or reads credential files.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import closing
import datetime as dt
import http.client
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

import codex_usage

PROVIDERS = ('codex', 'claude', 'opencode-go', 'grok', 'cursor', 'grok-bot', 'antigravity')
KINDS = {
    'codex': ('codex', 'manual'), 'claude': ('claude-db', 'claude-statusline', 'manual'),
    'opencode-go': ('opencode-stats', 'manual'), 'grok': ('manual',),
    'cursor': ('cursor-admin', 'manual'), 'grok-bot': ('manual',), 'antigravity': ('manual',),
}
LIMITATIONS = {
    'codex': 'Requires explicit target; source update time and cycle tokens may be unknown.',
    'claude': 'Existing cc-quota database or explicit statusline capture; identity is unverified.',
    'opencode-go': 'OpenCode stats describe all local providers, never Go subscription quota.',
    'grok': 'Manual quota observations only; no verified headless quota adapter.',
    'cursor': 'Admin spending API only; spending does not establish subscription remaining quota.',
    'grok-bot': 'Manual quota observations only; no verified headless quota adapter.',
    'antigravity': 'Manual quota observations only; no verified headless quota adapter.',
}
FILE_LIMIT = 1024 * 1024
DB_LIMIT = 64 * 1024 * 1024
OUTPUT_LIMIT = 1024 * 1024
ALIAS = re.compile(r'[a-z][a-z0-9_-]{0,31}\Z')
ENV_NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,127}\Z')


class UsageError(Exception):
    def __init__(self, code):
        self.code = code


def fail(code):
    raise UsageError(code)


def numeric(value, minimum=0, maximum=1e18):
    if type(value) not in (int, float):
        return None
    try:
        return value if math.isfinite(value) and minimum <= value <= maximum else None
    except OverflowError:
        return None


def iso(timestamp):
    try:
        return dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).isoformat().replace('+00:00', 'Z')
    except (TypeError, ValueError, OverflowError, OSError):
        fail('timestamp_invalid')


def timestamp(value):
    if not isinstance(value, str) or len(value) > 64:
        fail('timestamp_invalid')
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None or parsed.utcoffset() != dt.timedelta(0):
            fail('timestamp_invalid')
        return parsed.timestamp()
    except (ValueError, OverflowError, OSError):
        fail('timestamp_invalid')


def regular_fd(path, limit=FILE_LIMIT):
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            os.close(fd)
            fail('file_invalid')
        return fd
    except (OSError, ValueError, TypeError):
        if fd is not None:
            os.close(fd)
        fail('file_unavailable')


def read_json(path):
    try:
        with os.fdopen(regular_fd(path), 'rb') as stream:
            raw = stream.read(FILE_LIMIT + 1)
        if len(raw) > FILE_LIMIT:
            fail('file_too_large')
        return decode_json(raw)
    except (OSError, ValueError):
        fail('file_invalid')


def decode_json(raw):
    try:
        value = json.loads(raw, parse_constant=lambda _: fail('json_invalid'))
        if not isinstance(value, dict):
            fail('json_invalid')
        return value
    except (ValueError, UnicodeError, RecursionError):
        fail('json_invalid')


def path_option(value):
    return isinstance(value, str) and 0 < len(value) <= 4096 and '\0' not in value


def validate_config(config):
    if (not isinstance(config, dict) or set(config) != {'version', 'sources'}
            or type(config['version']) is not int or config['version'] != 1
            or not isinstance(config['sources'], list) or len(config['sources']) > len(PROVIDERS)):
        fail('config_invalid')
    seen = set()
    common = {'provider', 'kind', 'pool_id', 'max_age_seconds'}
    extras = {'manual': {'path'}, 'claude-db': {'path'}, 'claude-statusline': {'path'},
              'codex': {'cli', 'codex_home', 'target_file', 'timeout'},
              'opencode-stats': {'cli', 'days', 'timeout'},
              'cursor-admin': {'expected_email', 'token_env', 'timeout'}}
    for source in config['sources']:
        if not isinstance(source, dict):
            fail('config_invalid')
        provider, kind = source.get('provider'), source.get('kind')
        if not isinstance(provider, str) or provider not in PROVIDERS or provider in seen:
            fail('config_invalid')
        if not isinstance(kind, str) or kind not in KINDS[provider] or set(source) - common - extras[kind]:
            fail('config_invalid')
        seen.add(provider)
        if 'pool_id' in source and (not isinstance(source['pool_id'], str) or not ALIAS.fullmatch(source['pool_id'])):
            fail('config_invalid')
        if numeric(source.get('max_age_seconds', 5400), 1, 604800) is None:
            fail('config_invalid')
        if numeric(source.get('timeout', 10), .05, 120) is None:
            fail('config_invalid')
        for field in ('path', 'cli', 'codex_home', 'target_file'):
            if field in source and not path_option(source[field]):
                fail('config_invalid')
        if 'path' in extras[kind] and 'path' not in source:
            fail('config_invalid')
        if kind == 'codex' and 'target_file' not in source:
            fail('config_invalid')
        if kind == 'opencode-stats' and (type(source.get('days', 1)) is not int or not 1 <= source.get('days', 1) <= 365):
            fail('config_invalid')
        if kind == 'cursor-admin':
            email, env = source.get('expected_email'), source.get('token_env')
            if (not isinstance(email, str) or len(email) > 320 or not re.fullmatch(r'[^\s@]+@[^\s@]+', email)
                    or not isinstance(env, str) or not ENV_NAME.fullmatch(env)):
                fail('config_invalid')
    return config


def provider_result(provider, source=None):
    return {'provider': provider, 'source_kind': source['kind'] if source else None,
            'pool_id': source.get('pool_id') if source else None,
            'metric_scope': 'quota', 'identity_verified': False,
            'observed_at': None, 'age_seconds': None, 'stale': None,
            'status': 'unknown', 'windows': [], 'usage': {},
            'errors': [] if source else ['source_not_configured']}


def observation(result, observed, now, max_age):
    stamp = timestamp(observed)
    if stamp > now:
        fail('observation_in_future')
    result['observed_at'] = iso(stamp)
    result['age_seconds'] = round(now - stamp, 3)
    result['stale'] = now - stamp > max_age
    if result['stale']:
        result['errors'].append('observation_stale')


def live_observation(result, now, max_age):
    # A locally generated ISO timestamp rounds to microseconds. Compare it at
    # that same precision; external/manual timestamps still use the strict gate.
    observed = iso(now)
    observation(result, observed, timestamp(observed), max_age)


def window(name, used, reset, duration, result, now, *, codex=False):
    if not isinstance(name, str) or not ALIAS.fullmatch(name):
        fail('window_invalid')
    if used is not None and numeric(used, -(2 ** 31) if codex else 0) is None:
        fail('window_invalid')
    if duration is not None and (type(duration) is not int or not 0 <= duration <= 5256000):
        fail('window_invalid')
    reset_stamp = timestamp(reset) if reset is not None else None
    historical = bool(result['stale']) or (reset_stamp is not None and reset_stamp <= now)
    if reset_stamp is not None and reset_stamp <= now and 'window_reset_elapsed' not in result['errors']:
        result['errors'].append('window_reset_elapsed')
    remaining = max(0, min(100, 100 - used)) if used is not None else None
    return {'name': name, 'used_percent': None if historical else used,
            'remaining_percent': None if historical else remaining,
            'observed_used_percent': used, 'observed_remaining_percent': remaining,
            'historical': historical, 'resets_at': iso(reset_stamp) if reset_stamp is not None else None,
            'seconds_until_reset': max(0, reset_stamp - now) if reset_stamp is not None else None,
            'window_duration_minutes': duration, 'cycle_tokens': None}


def finish(result):
    if any(w['observed_used_percent'] is None for w in result['windows']):
        result['errors'].append('window_value_missing')
    usable = (any(w['observed_used_percent'] is not None for w in result['windows'])
              or any(numeric(value) is not None for value in result['usage'].values()))
    result['status'] = ('partial' if result['errors'] else 'ok') if usable else 'unknown'
    if not usable and not result['errors']:
        result['errors'].append('source_data_missing')
    return result


def manual_source(source, result, now):
    data = read_json(source['path'])
    if set(data) != {'observed_at', 'windows'} or not isinstance(data['windows'], list) or len(data['windows']) > 32:
        fail('manual_schema_invalid')
    observation(result, data['observed_at'], now, source.get('max_age_seconds', 5400))
    names = set()
    for raw in data['windows']:
        if (not isinstance(raw, dict) or set(raw) - {'name', 'used_percent', 'resets_at', 'window_duration_minutes'}
                or 'name' not in raw or 'used_percent' not in raw):
            fail('manual_schema_invalid')
        entry = window(raw['name'], raw['used_percent'], raw.get('resets_at'),
                       raw.get('window_duration_minutes'), result, now)
        if entry['name'] in names:
            fail('manual_schema_invalid')
        names.add(entry['name'])
        result['windows'].append(entry)


def claude_db(source, result, now):
    result['usage_scope'] = 'local_activity_not_quota_cycle'
    fd = regular_fd(source['path'], DB_LIMIT)
    os.close(fd)
    uri = Path(source['path']).absolute().as_uri() + '?mode=ro'
    deadline = time.monotonic() + 2
    try:
        with closing(sqlite3.connect(uri, uri=True, timeout=1)) as conn:
            conn.execute('PRAGMA query_only=ON')
            conn.set_progress_handler(lambda: time.monotonic() > deadline, 1000)
            last = conn.execute('SELECT MAX(ts) FROM snapshots').fetchone()[0]
            if last is None:
                result['errors'].append('database_empty')
                return
            if numeric(last, 0, 253402300799) is None:
                fail('database_schema_invalid')
            observation(result, iso(last), now, source.get('max_age_seconds', 5400))
            rows = conn.execute('SELECT window,used_pct,resets_at,local_tokens,local_output_tokens FROM snapshots WHERE ts=? LIMIT 33', (last,)).fetchall()
            if len(rows) > 32:
                fail('database_schema_invalid')
            for name, used, reset, tokens, output in rows:
                if name not in ('five_hour', 'seven_day', 'seven_day_opus'):
                    fail('database_schema_invalid')
                if reset is not None and numeric(reset, 0, 253402300799) is None:
                    fail('database_schema_invalid')
                result['windows'].append(window(name, used, iso(reset) if reset is not None else None,
                                                300 if name == 'five_hour' else 10080, result, now))
                # Local tokens are scoped to individual quota windows, never summed.
                result['windows'][-1]['local_tokens'] = numeric(tokens)
                result['windows'][-1]['local_output_tokens'] = numeric(output)
            if len(rows) == 1:
                result['usage'] = {'local_tokens': numeric(rows[0][3]), 'local_output_tokens': numeric(rows[0][4])}
            error = conn.execute('SELECT MAX(ts) FROM errors').fetchone()[0]
            if error is not None and (numeric(error, 0, 253402300799) is None or error >= last):
                result['errors'].append('recorded_error_after_snapshot')
    except sqlite3.Error:
        fail('database_unavailable_or_schema_invalid')


def history(config, hours=24, limit=100, now=None):
    """Read bounded historical quota observations; never collect or migrate data."""
    if type(hours) is not int or not 1 <= hours <= 8760 or type(limit) is not int or not 1 <= limit <= 500:
        fail('options_invalid')
    config = validate_config(config)
    now = time.time() if now is None else now
    if numeric(now, 0, 253402300799) is None:
        fail('timestamp_invalid')
    result = {'schema_version': 1, 'collected_at': iso(now), 'provider': 'claude',
              'source_kind': 'claude-db', 'identity_verified': False, 'metric_scope': 'quota_history',
              'usage_scope': 'local_activity_not_quota_cycle', 'status': 'unknown', 'errors': [],
              'hours': hours, 'limit': limit, 'truncated': False, 'points': []}
    source = next((s for s in config['sources'] if s['provider'] == 'claude'), None)
    if source is None or source['kind'] != 'claude-db':
        result['errors'] = ['source_not_configured' if source is None else 'history_source_unsupported']
        return result
    try:
        points, truncated, future, recorded_error = claude_history_rows(source, now, hours, limit)
        result['points'], result['truncated'] = points, truncated
        if truncated:
            result['errors'].append('history_truncated')
        if future:
            result['errors'].append('future_observation_excluded')
        if any(p['gap_before_seconds'] is not None and p['gap_before_seconds'] > 5400 for p in points):
            result['errors'].append('history_gap')
        if any(p['observed_used_percent'] is None for p in points):
            result['errors'].append('window_value_missing')
        if recorded_error:
            result['errors'].append('recorded_error_after_snapshot')
        usable = any(p['observed_used_percent'] is not None for p in points)
        if usable:
            result['status'] = 'partial' if result['errors'] else 'ok'
        elif not points:
            result['errors'].append('history_empty')
    except UsageError as error:
        result['status'], result['errors'] = 'error', [error.code]
        result['points'], result['truncated'] = [], False
    return result


def claude_history_rows(source, now, hours, limit):
    fd = regular_fd(source['path'], DB_LIMIT)
    try:
        with os.fdopen(fd, 'rb') as stream:
            header = stream.read(20)
    except OSError:
        fail('file_unavailable')
    # Even a mode=ro connection may create or modify WAL shared memory.
    # Reject before connecting; immutable mode could silently omit live WAL data.
    if (header[18:19] == b'\x02' or header[19:20] == b'\x02'
            or any(os.path.lexists(source['path'] + suffix) for suffix in ('-wal', '-shm'))):
        fail('database_wal_unsupported')
    if os.path.lexists(source['path'] + '-journal'):
        fail('database_sidecar_unsupported')
    uri = Path(source['path']).absolute().as_uri() + '?mode=ro'
    deadline = time.monotonic() + 2
    try:
        with closing(sqlite3.connect(uri, uri=True, timeout=1)) as conn:
            conn.execute('PRAGMA query_only=ON')
            conn.set_progress_handler(lambda: time.monotonic() > deadline, 1000)
            conn.execute('BEGIN')
            # All queries use fixed SQL. Invalid timestamp storage must not hide
            # malformed data through SQLite's comparison/coercion rules.
            for sql in (
                    "SELECT ts FROM snapshots WHERE typeof(ts) NOT IN ('integer','real') OR ts<0 OR ts>253402300799 LIMIT 1",
                    "SELECT ts FROM errors WHERE typeof(ts) NOT IN ('integer','real') OR ts<0 OR ts>253402300799 LIMIT 1"):
                if conn.execute(sql).fetchone() is not None:
                    fail('database_schema_invalid')
            rows = conn.execute(
                'SELECT ts,window,used_pct,resets_at,local_tokens,local_output_tokens FROM snapshots '
                'WHERE ts>=? AND ts<=? ORDER BY ts DESC,window DESC LIMIT ?',
                (now - hours * 3600, now, limit + 1)).fetchall()
            future = conn.execute('SELECT 1 FROM snapshots WHERE ts>? LIMIT 1', (now,)).fetchone() is not None
            error_stamp = conn.execute('SELECT MAX(ts) FROM errors').fetchone()[0]
        points, previous = [], {}
        for observed, name, used, reset, tokens, output in reversed(rows[:limit]):
            if (numeric(observed, 0, 253402300799) is None
                    or name not in ('five_hour', 'seven_day', 'seven_day_opus')
                    or (used is not None and numeric(used) is None)
                    or (reset is not None and numeric(reset, 0, 253402300799) is None)
                    or (tokens is not None and numeric(tokens) is None)
                    or (output is not None and numeric(output) is None)):
                fail('database_schema_invalid')
            gap = observed - previous[name] if name in previous else None
            previous[name] = observed
            points.append({'observed_at': iso(observed), 'window': name,
                           'observed_used_percent': used,
                           'observed_remaining_percent': max(0, min(100, 100 - used)) if used is not None else None,
                           'resets_at': iso(reset) if reset is not None else None,
                           'local_tokens': tokens, 'local_output_tokens': output,
                           'historical': True, 'gap_before_seconds': gap})
        # Compare the stored timestamps before ISO rendering rounds fractions.
        recorded_error = bool(rows and error_stamp is not None and error_stamp >= rows[0][0])
        return points, len(rows) > limit, future, recorded_error
    except sqlite3.Error:
        fail('database_unavailable_or_schema_invalid')


def history_table(result):
    lines = [f'Historical Claude quota observations (UTC) status={result["status"]}',
             'Local tokens describe local activity, not quota-cycle totals.',
             'Observed at (UTC)            Window          Observed used / remaining   local tokens / output   gap seconds']
    def shown(value):
        return '?' if value is None else f'{value:g}'
    for point in result['points']:
        lines.append(f'{point["observed_at"]:<28} {point["window"]:<15} '
                     f'{shown(point["observed_used_percent"])}% / {shown(point["observed_remaining_percent"])}%'
                     f'   {shown(point["local_tokens"])} / {shown(point["local_output_tokens"])}'
                     f'   {shown(point["gap_before_seconds"])}')
        lines.append(f'  resets_at={point["resets_at"] or "?"}')
    lines.append(f'hours={result["hours"]} limit={result["limit"]} truncated={str(result["truncated"]).lower()}')
    if result['errors']:
        lines.append('  ' + ', '.join(result['errors']))
    return '\n'.join(lines)


def statusline_fields(data):
    limits = data.get('rate_limits', {})
    if limits is None:
        return {}
    if not isinstance(limits, dict):
        fail('statusline_schema_invalid')
    out = {}
    for name in ('five_hour', 'seven_day'):
        value = limits.get(name)
        if value is None:
            continue
        if not isinstance(value, dict):
            fail('statusline_schema_invalid')
        used, reset = value.get('used_percentage'), value.get('resets_at')
        if used is not None and numeric(used) is None:
            fail('statusline_schema_invalid')
        if reset is not None and numeric(reset, 0, 253402300799) is None:
            fail('statusline_schema_invalid')
        out[name] = {'used_percentage': used, 'resets_at': reset}
    return out


def capture_claude(path, stream, now=None):
    now = time.time() if now is None else now
    try:
        raw = stream.read(FILE_LIMIT + 1)
        if len(raw) > FILE_LIMIT:
            fail('input_too_large')
        fields = statusline_fields(decode_json(raw))
        target = Path(path)
        def check_target():
            try:
                info = target.lstat()
                if not stat.S_ISREG(info.st_mode):
                    fail('capture_target_invalid')
            except FileNotFoundError:
                pass
        check_target()
        fd, temporary = tempfile.mkstemp(prefix='.agent-usage-', dir=target.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as output:
                json.dump({'version': 1, 'observed_at': iso(now), 'rate_limits': fields}, output, allow_nan=False)
                output.flush()
                os.fsync(output.fileno())
            check_target()
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    except (OSError, ValueError, UnicodeError, RecursionError):
        fail('capture_failed')


def claude_statusline(source, result, now):
    data = read_json(source['path'])
    if set(data) != {'version', 'observed_at', 'rate_limits'} or type(data['version']) is not int or data['version'] != 1:
        fail('statusline_schema_invalid')
    observation(result, data['observed_at'], now, source.get('max_age_seconds', 5400))
    for name, raw in statusline_fields(data).items():
        result['windows'].append(window(name, raw['used_percentage'],
                                       iso(raw['resets_at']) if raw['resets_at'] is not None else None,
                                       300 if name == 'five_hour' else 10080, result, now))


def codex_source(source, result, now):
    raw = codex_usage.collect(codex_usage.Options(codex=source.get('cli', 'codex'),
                                                codex_home=source.get('codex_home'),
                                                target_file=source['target_file'], timeout=source.get('timeout', 10)))
    if not raw.get('identity') or raw['identity'].get('account_email_verified') is not True:
        fail('codex_identity_or_collection_failed')
    if raw.get('status') == 'error':
        fail('codex_collection_failed')
    result['identity_verified'] = True
    result['source_update_time_status'] = 'unknown'
    for index, bucket in enumerate(raw.get('quota_buckets') or []):
        for value in bucket.get('windows', []):
            if len(result['windows']) >= 32:
                if 'codex_window_limit_exceeded' not in result['errors']:
                    result['errors'].append('codex_window_limit_exceeded')
                break
            if value.get('name') not in ('primary', 'secondary'):
                continue
            name = f'bucket_{index + 1}_{value["name"]}'
            result['windows'].append(window(name, value.get('used_percent'), value.get('resets_at'),
                                           value.get('window_duration_minutes'), result, now, codex=True))
    summary = (raw.get('token_statistics') or {}).get('summary') or {}
    for field in ('lifetimeTokens', 'peakDailyTokens', 'longestRunningTurnSec', 'currentStreakDays', 'longestStreakDays'):
        result['usage'][field] = numeric(summary.get(field))
    result['usage_scope'] = 'account_activity_not_quota_cycle'
    if raw.get('status') != 'ok':
        result['errors'].append('codex_collection_partial')


def run_fixed(argv, timeout):
    """Drain a bounded stdout with a deadline; always close our entire process group."""
    process = None
    selector = selectors.DefaultSelector()
    try:
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, start_new_session=True, bufsize=0)
        os.set_blocking(process.stdout.fileno(), False)
        selector.register(process.stdout, selectors.EVENT_READ)
        data = bytearray()
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0 or not selector.select(left):
                fail('cli_timeout')
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > OUTPUT_LIMIT:
                fail('cli_output_too_large')
        try:
            code = process.wait(timeout=max(.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            fail('cli_timeout')
        if code:
            fail('cli_failed')
        try:
            return data.decode('utf-8')
        except UnicodeError:
            fail('cli_output_invalid')
    except (OSError, ValueError):
        fail('cli_unavailable')
    finally:
        selector.close()
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=.2)
            except subprocess.TimeoutExpired:
                pass
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=1)
            process.stdout.close()


def opencode_source(source, result, now):
    text = run_fixed([source.get('cli', 'opencode'), '--pure', 'stats', '--days', str(source.get('days', 1))], source.get('timeout', 10))
    labels = {'Sessions': 'sessions', 'Messages': 'messages', 'Total Cost': 'cost_usd',
              'Avg Tokens/Session': 'average_tokens_per_session', 'Input': 'input_tokens',
              'Output': 'output_tokens', 'Cache Read': 'cache_read_tokens', 'Cache Write': 'cache_write_tokens'}
    values = {}
    for label, field in labels.items():
        matches = re.findall(r'^\s*│\s*' + re.escape(label) + r'\s+\$?(\d+(?:\.\d+)?)([KMB]?)\s*│\s*$', text, flags=re.MULTILINE)
        if len(matches) > 1:
            fail('cli_output_ambiguous')
        if matches:
            value, suffix = matches[0]
            values[field] = numeric(float(value) * {'': 1, 'K': 1000, 'M': 1000000, 'B': 1000000000}[suffix])
            if values[field] is None:
                result['errors'].append('cli_output_value_invalid')
    result['metric_scope'] = 'local_activity_all_providers'
    result['usage'] = values
    result['approximate'] = True
    result['activity_days'] = source.get('days', 1)
    result['quota_available'] = False
    live_observation(result, now, source.get('max_age_seconds', 5400))
    if len(values) != len(labels):
        result['errors'].append('cli_output_fields_missing')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def cursor_request(token, email, timeout):
    body = json.dumps({'searchTerm': email, 'page': 1, 'pageSize': 100}).encode()
    request = urllib.request.Request('https://api.cursor.com/teams/spend', data=body, method='POST',
                                     headers={'Content-Type': 'application/json',
                                              'Authorization': 'Basic ' + base64.b64encode((token + ':').encode()).decode()})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            raw = response.read(FILE_LIMIT + 1)
        if len(raw) > FILE_LIMIT:
            fail('cursor_response_too_large')
        return decode_json(raw)
    except (OSError, ValueError, urllib.error.URLError, http.client.HTTPException):
        fail('cursor_request_failed')


def cursor_source(source, result, now):
    result['metric_scope'] = 'team_spending'
    result['quota_available'] = False
    token = os.environ.get(source['token_env'])
    if not token:
        result['errors'].append('cursor_admin_key_missing')
        return
    if len(token) > 8192 or any(ord(c) < 33 or ord(c) > 126 for c in token):
        fail('cursor_admin_key_invalid')
    payload = cursor_request(token, source['expected_email'], source.get('timeout', 10))
    rows = payload.get('teamMemberSpend')
    if not isinstance(rows, list) or len(rows) > 100 or any(not isinstance(row, dict) for row in rows):
        fail('cursor_schema_invalid')
    matches = [row for row in rows if isinstance(row.get('email'), str)
               and row['email'].casefold() == source['expected_email'].casefold()]
    total = payload.get('totalMembers')
    pages = payload.get('totalPages')
    if type(pages) is not int or pages != 1:
        fail('cursor_identity_ambiguous')
    if total is not None and (type(total) is not int or total < 0):
        fail('cursor_identity_ambiguous')
    if len(matches) != 1:
        fail('cursor_identity_ambiguous')
    row = matches[0]
    for key, field in (('spendCents', 'on_demand_usd'), ('overallSpendCents', 'total_usd')):
        value = row.get(key)
        if value is not None and numeric(value) is None:
            fail('cursor_schema_invalid')
        result['usage'][field] = value / 100 if value is not None else None
    result['identity_verified'] = True
    live_observation(result, now, source.get('max_age_seconds', 5400))


def snapshot(config=None, providers=None, now=None):
    now = time.time() if now is None else now
    config = validate_config(config if config is not None else {'version': 1, 'sources': []})
    if providers is not None and (not providers or any(p not in PROVIDERS for p in providers)):
        fail('options_invalid')
    selected = set(PROVIDERS if providers is None else providers)
    sources = {source['provider']: source for source in config['sources']}
    output = {'schema_version': 1, 'collected_at': iso(now), 'providers': []}
    adapters = {'manual': manual_source, 'claude-db': claude_db, 'claude-statusline': claude_statusline,
                'codex': codex_source, 'opencode-stats': opencode_source, 'cursor-admin': cursor_source}
    for provider in PROVIDERS:
        if provider not in selected:
            continue
        source = sources.get(provider)
        result = provider_result(provider, source)
        if source:
            try:
                adapters[source['kind']](source, result, now)
                finish(result)
            except UsageError as error:
                result = provider_result(provider, source)
                result['status'] = 'error'
                result['errors'] = [error.code]
        output['providers'].append(result)
    return output


def exit_code(result):
    statuses = [p['status'] for p in result['providers']]
    return 0 if statuses and all(s == 'ok' for s in statuses) else 2 if any(s in ('ok', 'partial') for s in statuses) else 1


def table(result):
    lines = ['Provider       Source             Status   Scope                         Remaining']
    for provider in result['providers']:
        windows = ', '.join(w['name'] + '=' + (f'{w["remaining_percent"]:g}%' if w['remaining_percent'] is not None else '?')
                            for w in provider['windows']) or '?'
        lines.append(f'{provider["provider"]:<14} {(provider["source_kind"] or "unconfigured"):<18} {provider["status"]:<8} {provider["metric_scope"]:<29} {windows}')
        age = provider['age_seconds']
        stale = json.dumps(provider['stale']) if provider['stale'] is not None else '?'
        lines.append(f'  observed_at={provider["observed_at"] or "?"} age_seconds={age if age is not None else "?"} stale={stale}'
                     + (' approximate=true' if provider.get('approximate') else ''))
        for entry in provider['windows']:
            seconds = entry['seconds_until_reset']
            lines.append(f'  {entry["name"]}: resets_at={entry["resets_at"] or "?"} seconds_until_reset={seconds if seconds is not None else "?"}')
        for key, value in provider['usage'].items():
            lines.append(f'  {key}: {value if value is not None else "?"}')
        if provider['errors']:
            lines.append('  ' + ', '.join(provider['errors']))
    return '\n'.join(lines)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail('options_invalid')


def main(argv=None):
    parser = Parser(description=__doc__)
    subs = parser.add_subparsers(dest='command', required=True, parser_class=Parser)
    subs.add_parser('sources')
    snap = subs.add_parser('snapshot')
    snap.add_argument('--config')
    snap.add_argument('--format', choices=('json', 'table'), default='json')
    snap.add_argument('--provider', action='append', choices=PROVIDERS)
    snap.add_argument('--codex-target')
    capture = subs.add_parser('capture-claude')
    capture.add_argument('--output', required=True)
    hist = subs.add_parser('history')
    hist.add_argument('--config', required=True)
    hist.add_argument('--hours', type=int, default=24)
    hist.add_argument('--limit', type=int, default=100)
    hist.add_argument('--format', choices=('json', 'table'), default='json')
    try:
        args = parser.parse_args(argv)
        if args.command == 'sources':
            print(json.dumps({'schema_version': 1, 'providers': [
                {'provider': provider, 'source_kinds': KINDS[provider],
                 'availability': 'implemented_adapters_require_configuration',
                 'unavailable_sources': ([{'kind': 'grok-session', 'reason': 'usage_output_format_unverified'}]
                                         if provider == 'grok' else []),
                 'limitation': LIMITATIONS[provider]}
                for provider in PROVIDERS]}, indent=2))
            return 0
        if args.command == 'capture-claude':
            capture_claude(args.output, sys.stdin)
            print(json.dumps({'status': 'ok', 'source_kind': 'claude-statusline'}))
            return 0
        if args.command == 'history':
            result = history(read_json(args.config), args.hours, args.limit)
            print(history_table(result) if args.format == 'table' else json.dumps(result, indent=2, allow_nan=False))
            return 0 if result['status'] == 'ok' else 2 if result['status'] == 'partial' else 1
        config = read_json(args.config) if args.config else {'version': 1, 'sources': []}
        if args.codex_target:
            validate_config(config)
            if any(source['provider'] == 'codex' for source in config['sources']):
                fail('codex_source_duplicate')
            config['sources'].append({'provider': 'codex', 'kind': 'codex', 'target_file': args.codex_target})
        result = snapshot(config, args.provider)
        print(table(result) if args.format == 'table' else json.dumps(result, indent=2, allow_nan=False))
        return exit_code(result)
    except UsageError as error:
        print(json.dumps({'schema_version': 1, 'status': 'error', 'errors': [error.code]}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
