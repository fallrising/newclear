#!/usr/bin/env python3
"""Disk-backed one-shot remote task grants for the Office dispatcher.

The browser never sees or creates grant IDs.  This module stores the paid-run
capability in private lab state and consumes it atomically immediately before a
remote runner is exec'd.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import stat
import time

from office_results import reject_duplicates
from contextlib import contextmanager

GRANT_ID = re.compile(r'[0-9a-f]{32}\Z')
PROVIDER = 'pi'
TASK = 'synthetic_file'
MAX_SIZE = 4096
MAX_ENTRIES = 128
TTL_MIN = 60
TTL_MAX = 1800
KEYS = {'version', 'id', 'provider', 'task', 'model', 'pinned_version', 'limits',
        'source_sha256', 'uid', 'lab', 'created_at', 'expires_at', 'max_runs'}
SOURCE_NAMES = tuple(dict.fromkeys((
    'remote_grant.py', 'office_dispatch.py', 'office_console.py', 'office_console.js', 'office_results.py', 'run_pi_work.py', 'office_pi.mjs', 'office_pi_host.mjs', 'office_pi_restart.mjs',
    'manual_recovery.mjs', 'deepseek_relay.py', 'pi_retry.py', 'execution_slot.py',
    'process_ownership.py', 'remote_cli.py', 'pi_boundary.mjs', 'pi_office_policy.mjs',
    'pi_session_evidence.mjs', 'bin/pi'
)))


class GrantError(ValueError):
    pass


def fingerprint(grant_id: str) -> str:
    if not isinstance(grant_id, str) or not GRANT_ID.fullmatch(grant_id):
        raise GrantError('invalid_remote_grant_id')
    return hashlib.sha256(grant_id.encode()).hexdigest()[:12]


def _lab_fd(lab):
    # Resolve OS aliases in the parent, but never follow a substituted lab itself.
    fd = os.open(Path(lab).parent.resolve() / Path(lab).name,
                 os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    info = os.fstat(fd)
    if info.st_uid != os.getuid() or info.st_mode & 0o022:
        os.close(fd)
        raise GrantError('remote_grant_unavailable')
    return fd


def _child_dir(fd, name, create=False):
    if create:
        try: os.mkdir(name, mode=0o700, dir_fd=fd)
        except FileExistsError: pass
    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
    info = os.fstat(child)
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        os.close(child)
        raise GrantError('remote_grant_unavailable')
    return child


def _read_dir(lab, create=False):
    fd = _lab_fd(lab)
    try:
        for part in ('state', 'remote-grants'):
            child = _child_dir(fd, part, create)
            os.close(fd); fd = child
        if create:
            for name in ('pending', 'consumed', 'revoked'):
                os.close(_child_dir(fd, name, True))
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextmanager
def _directory(fd):
    try: yield fd
    finally: os.close(fd)


def _lock(root_fd: int) -> int:
    try:
        fd = os.open('grants.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=root_fd)
    except OSError:
        raise GrantError('remote_grant_unavailable') from None
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1:
        os.close(fd)
        raise GrantError('remote_grant_unavailable')
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = os.stat('grants.lock', dir_fd=root_fd, follow_symlinks=False)
        if (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
            raise GrantError('remote_grant_unavailable')
    except BaseException:
        os.close(fd)
        raise
    return fd


def _check_entries(fd: int):
    try:
        if len(os.listdir(fd)) > MAX_ENTRIES:
            raise GrantError('remote_grant_unavailable')
    except TypeError:
        if len(os.listdir(f'/proc/self/fd/{fd}')) > MAX_ENTRIES:
            raise GrantError('remote_grant_unavailable')


def _read_json_at(fd: int, name: str) -> dict:
    try:
        child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    except FileNotFoundError:
        raise
    except OSError:
        raise GrantError('remote_grant_unavailable') from None
    with os.fdopen(child, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & 0o077 or info.st_nlink != 1 or info.st_size > MAX_SIZE):
            raise GrantError('remote_grant_unavailable')
        raw = stream.read(MAX_SIZE + 1)
    if len(raw) > MAX_SIZE:
        raise GrantError('remote_grant_unavailable')
    try:
        value = json.loads(raw, object_pairs_hook=reject_duplicates)
    except (ValueError, UnicodeError):
        raise GrantError('remote_grant_unavailable') from None
    if not isinstance(value, dict):
        raise GrantError('remote_grant_unavailable')
    if GRANT_ID.fullmatch(name[:-5]) and value.get('id') != name[:-5]:
        raise GrantError('remote_grant_unavailable')
    return value


def _write_json_at(fd: int, name: str, value: dict):
    temp = '.grant-' + secrets.token_hex(12)
    child = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        with os.fdopen(child, 'w') as stream:
            json.dump(value, stream, sort_keys=True, separators=(',', ':'))
            stream.write('\n')
            stream.flush(); os.fsync(stream.fileno())
        os.link(temp, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
        os.unlink(temp, dir_fd=fd)
        os.fsync(fd)
    finally:
        try: os.unlink(temp, dir_fd=fd)
        except FileNotFoundError: pass


def _source_hashes(lab: Path) -> dict:
    result = {}
    with _directory(_lab_fd(lab)) as lab_fd:
        root_fd = os.open('scripts', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=lab_fd)
    try:
        if os.fstat(root_fd).st_uid != os.getuid() or os.fstat(root_fd).st_mode & 0o022:
            raise GrantError('remote_grant_source_changed')
        for name in SOURCE_NAMES:
            fd = root_fd
            close_fd = None
            parts = name.split('/')
            try:
                for part in parts[:-1]:
                    close_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    fd = close_fd
                    info = os.fstat(fd)
                    if info.st_uid != os.getuid() or info.st_mode & 0o022:
                        raise GrantError('remote_grant_source_changed')
                child = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
                with os.fdopen(child, 'rb') as stream:
                    info = os.fstat(stream.fileno())
                    if (not stat.S_ISREG(info.st_mode) or info.st_size > 1024 * 1024
                            or info.st_uid != os.getuid() or info.st_mode & 0o022):
                        raise GrantError('remote_grant_source_changed')
                    raw = stream.read(1024 * 1024 + 1)
                    if len(raw) > 1024 * 1024: raise GrantError('remote_grant_source_changed')
                    result[name] = hashlib.sha256(raw).hexdigest()
            finally:
                if close_fd is not None:
                    os.close(close_fd)
    finally:
        os.close(root_fd)
    return result


def expected_binding(lab: Path, provider: str) -> dict:
    if provider != PROVIDER:
        raise GrantError('remote_grant_provider_not_supported')
    import office_dispatch as dispatch
    plan = dispatch.plan(provider)
    return {'model': plan['model'], 'pinned_version': plan['pinned_version'],
            'limits': plan['limits'], 'source_sha256': _source_hashes(Path(lab))}


def _validate(value: dict, lab: Path, provider: str, now: float, check_binding: bool = True) -> dict:
    if set(value) != KEYS:
        raise GrantError('remote_grant_unavailable')
    grant_id = value['id']
    if (type(value.get('version')) is not int or value.get('version') != 1 or not isinstance(grant_id, str) or not GRANT_ID.fullmatch(grant_id)
            or value.get('provider') != provider or value.get('task') != TASK
            or type(value.get('uid')) is not int or value.get('uid') != os.getuid() or value.get('lab') != str(Path(lab).resolve())
            or type(value.get('max_runs')) is not int or value.get('max_runs') != 1 or type(value.get('created_at')) not in (int, float)
            or type(value.get('expires_at')) not in (int, float)
            or not math.isfinite(value['created_at']) or not math.isfinite(value['expires_at'])):
        raise GrantError('remote_grant_unavailable')
    if value['created_at'] > now + 5:
        raise GrantError('remote_grant_source_changed')
    if value['expires_at'] <= now:
        raise GrantError('remote_grant_expired')
    if not TTL_MIN <= value['expires_at'] - value['created_at'] <= TTL_MAX:
        raise GrantError('remote_grant_unavailable')
    if check_binding:
        expected = expected_binding(lab, provider)
        if (value.get('model') != expected['model'] or value.get('pinned_version') != expected['pinned_version']
                or json.dumps(value.get('limits'), sort_keys=True, allow_nan=False) != json.dumps(expected['limits'], sort_keys=True) or value.get('source_sha256') != expected['source_sha256']):
            raise GrantError('remote_grant_source_changed')
    return value


def _pending_records(lab: Path, provider: str, now: float, check_binding: bool = True):
    try:
        root_fd = _read_dir(lab)
    except FileNotFoundError:
        return []
    try:
        pending_fd = _child_dir(root_fd, 'pending')
        try:
            _check_entries(pending_fd)
            rows = []
            for name in os.listdir(pending_fd):
                if not name.endswith('.json') or not GRANT_ID.fullmatch(name[:-5]):
                    continue
                try:
                    rows.append(_validate(_read_json_at(pending_fd, name), lab, provider, now, check_binding))
                except FileNotFoundError:
                    continue  # Concurrent consumption can remove a listed pending record.
                except GrantError as error:
                    if str(error) != 'remote_grant_expired':
                        raise
            return rows
        finally:
            os.close(pending_fd)
    finally:
        os.close(root_fd)


def pending(lab: Path, provider: str, now: float | None = None) -> dict | None:
    if provider != PROVIDER:
        raise GrantError('remote_grant_provider_not_supported')
    rows = _pending_records(Path(lab), provider, time.time() if now is None else now, check_binding=True)
    if len(rows) > 1:
        raise GrantError('remote_grant_unavailable')
    return rows[0] if rows else None


def create(lab: Path, provider: str, ttl_s: int, now: float | None = None) -> dict:
    if provider != PROVIDER:
        raise GrantError('remote_grant_provider_not_supported')
    if type(ttl_s) is not int or ttl_s < TTL_MIN or ttl_s > TTL_MAX:
        raise GrantError('invalid_remote_grant_ttl')
    lab = Path(lab)
    now = time.time() if now is None else now
    if not math.isfinite(now): raise GrantError('remote_grant_unavailable')
    root_fd = _read_dir(lab, create=True)
    lock_fd = None
    try:
        lock_fd = _lock(root_fd)
        if pending(lab, provider, now) is not None:
            raise GrantError('remote_grant_unavailable')
        grant_id = secrets.token_hex(16)
        binding = expected_binding(lab, provider)
        value = {'version': 1, 'id': grant_id, 'provider': provider, 'task': TASK,
                 'model': binding['model'], 'pinned_version': binding['pinned_version'],
                 'limits': binding['limits'], 'source_sha256': binding['source_sha256'],
                 'uid': os.getuid(), 'lab': str(lab.resolve()), 'created_at': now,
                 'expires_at': now + ttl_s, 'max_runs': 1}
        pending_fd = _child_dir(root_fd, 'pending')
        try:
            _check_entries(pending_fd)
            _write_json_at(pending_fd, grant_id + '.json', value)
        finally:
            os.close(pending_fd)
        return dict(value, fingerprint=fingerprint(grant_id))
    finally:
        if lock_fd is not None: os.close(lock_fd)
        os.close(root_fd)


def consume(lab: Path, grant_id: str, provider: str, entry: str, now: float | None = None) -> dict:
    if provider != PROVIDER:
        raise GrantError('remote_grant_provider_not_supported')
    if not isinstance(grant_id, str) or not GRANT_ID.fullmatch(grant_id):
        raise GrantError('invalid_remote_grant_id')
    if entry not in ('console', 'cli', 'dispatcher'):
        raise GrantError('invalid_remote_grant_entry')
    lab = Path(lab); now = time.time() if now is None else now
    try:
        root_fd = _read_dir(lab)
    except FileNotFoundError:
        raise GrantError('remote_grant_unavailable') from None
    lock_fd = None
    try:
        lock_fd = _lock(root_fd)
        pending_fd = _child_dir(root_fd, 'pending')
        try:
            consumed_fd = _child_dir(root_fd, 'consumed')
        except BaseException:
            os.close(pending_fd); raise
        try:
            try:
                value = _read_json_at(pending_fd, grant_id + '.json')
            except FileNotFoundError:
                # Distinguish ordinary races from unknown state without exposing paths.
                try:
                    _read_json_at(consumed_fd, grant_id + '.json')
                    raise GrantError('remote_grant_used')
                except FileNotFoundError:
                    revoked_fd = _child_dir(root_fd, 'revoked')
                    try:
                        try: _read_json_at(revoked_fd, grant_id + '.json')
                        except FileNotFoundError: raise GrantError('remote_grant_unavailable') from None
                        raise GrantError('remote_grant_used')
                    finally: os.close(revoked_fd)
            value = _validate(value, lab, provider, now, check_binding=True)
            # A prior tombstone is never overwritten, even if pending was restored.
            for name in ('consumed', 'revoked'):
                with _directory(_child_dir(root_fd, name)) as target_fd:
                    try: os.stat(grant_id + '.json', dir_fd=target_fd, follow_symlinks=False)
                    except FileNotFoundError: pass
                    else: raise GrantError('remote_grant_used')
            os.rename(grant_id + '.json', grant_id + '.json', src_dir_fd=pending_fd, dst_dir_fd=consumed_fd)
            os.fsync(pending_fd); os.fsync(consumed_fd)
            use = {'consumed_at': now, 'entry': entry, 'pid': os.getpid()}
            _write_json_at(consumed_fd, grant_id + '.use.json', use)
            return dict(value, fingerprint=fingerprint(grant_id))
        finally:
            os.close(pending_fd); os.close(consumed_fd)
    finally:
        if lock_fd is not None: os.close(lock_fd)
        os.close(root_fd)


def revoke(lab: Path, grant_id: str):
    if not isinstance(grant_id, str) or not GRANT_ID.fullmatch(grant_id):
        raise GrantError('invalid_remote_grant_id')
    lab = Path(lab)
    root_fd = _read_dir(lab)
    lock_fd = None
    try:
        lock_fd = _lock(root_fd)
        pending_fd = _child_dir(root_fd, 'pending')
        try:
            revoked_fd = _child_dir(root_fd, 'revoked')
        except BaseException:
            os.close(pending_fd); raise
        try:
            _read_json_at(pending_fd, grant_id + '.json')
            try: os.stat(grant_id + '.json', dir_fd=revoked_fd, follow_symlinks=False)
            except FileNotFoundError: pass
            else: raise GrantError('remote_grant_used')
            os.rename(grant_id + '.json', grant_id + '.json', src_dir_fd=pending_fd, dst_dir_fd=revoked_fd)
            os.fsync(pending_fd); os.fsync(revoked_fd)
        except FileNotFoundError:
            raise GrantError('remote_grant_unavailable') from None
        finally:
            os.close(pending_fd); os.close(revoked_fd)
    finally:
        if lock_fd is not None: os.close(lock_fd)
        os.close(root_fd)


def public(record: dict) -> dict:
    return {'provider': record['provider'], 'fingerprint': fingerprint(record['id']),
            'task': record['task'], 'model': record['model'], 'expires_at': record['expires_at'],
            'limits': record['limits']}


def inspect(lab: Path, grant_id: str, provider: str, now: float | None = None) -> dict:
    if provider != PROVIDER:
        raise GrantError('remote_grant_provider_not_supported')
    if not isinstance(grant_id, str) or not GRANT_ID.fullmatch(grant_id):
        raise GrantError('invalid_remote_grant_id')
    lab = Path(lab); now = time.time() if now is None else now
    try:
        root_fd = _read_dir(lab)
    except FileNotFoundError:
        raise GrantError('remote_grant_unavailable') from None
    try:
        pending_fd = _child_dir(root_fd, 'pending')
        try:
            return _validate(_read_json_at(pending_fd, grant_id + '.json'), lab, provider, now, check_binding=True)
        except FileNotFoundError:
            consumed_fd = _child_dir(root_fd, 'consumed')
            try:
                try: _read_json_at(consumed_fd, grant_id + '.json')
                except FileNotFoundError: raise GrantError('remote_grant_unavailable') from None
                raise GrantError('remote_grant_used')
            finally: os.close(consumed_fd)
        finally:
            os.close(pending_fd)
    finally:
        os.close(root_fd)


def consumed(lab: Path, grant_id: str) -> bool:
    if not isinstance(grant_id, str) or not GRANT_ID.fullmatch(grant_id):
        raise GrantError('invalid_remote_grant_id')
    root_fd = _read_dir(Path(lab))
    try:
        consumed_fd = _child_dir(root_fd, 'consumed')
        try:
            # The atomic rename is authoritative; a crash may precede the use receipt.
            _read_json_at(consumed_fd, grant_id + '.json')
            return True
        except FileNotFoundError:
            try: _read_json_at(consumed_fd, grant_id + '.use.json')
            except FileNotFoundError: return False
            raise GrantError('remote_grant_unavailable')
        finally:
            os.close(consumed_fd)
    finally:
        os.close(root_fd)


def _sanitized(function):
    from functools import wraps
    @wraps(function)
    def call(*args, **kwargs):
        try: return function(*args, **kwargs)
        except GrantError: raise
        except (OSError, UnicodeError, ValueError, TypeError, OverflowError, RecursionError):
            raise GrantError('remote_grant_unavailable') from None
    return call

for _name in ('create', 'pending', 'consume', 'revoke', 'inspect', 'consumed'):
    globals()[_name] = _sanitized(globals()[_name])
