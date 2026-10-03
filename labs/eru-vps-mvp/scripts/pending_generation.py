"""Persistent admission barrier for cooperating mutations on one controller.

This infrastructure API provides no live authorization or external writer fence.
There is deliberately no release, expiry, bypass or production execution CLI.
Any pending path, including an interrupted empty directory, blocks admission.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat

PENDING_DIRECTORY = 'pending-generation'
RECORD_NAME = 'reservation.json'
MAX_RECORD_BYTES = 4096
_HASH = re.compile(r'[a-f0-9]{64}\Z')
_IDENTIFIER = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z')
_HASH_FIELDS = {'review_sha256', 'execution_sha256', 'scope_sha256',
                'cluster_sha256', 'fence_sha256'}
_FIELDS = _HASH_FIELDS | {'cluster_id', 'run_id', 'generation_before', 'target_generation'}
_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def assert_no_pending(private_fd):
    """Admission checks presence, never record validity or a claimed completion."""
    try:
        os.stat(PENDING_DIRECTORY, dir_fd=private_fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    raise RuntimeError('pending generation blocks controller mutation')


def _bindings(value):
    if type(value) is not dict or set(value) != _FIELDS:
        raise ValueError('pending generation requires exact binding fields')
    if value['cluster_id'] != 'eru-vps-mvp':
        raise ValueError('pending generation cluster identity is invalid')
    if type(value['run_id']) is not str or not _IDENTIFIER.fullmatch(value['run_id']):
        raise ValueError('pending generation run identity is invalid')
    before, target = value['generation_before'], value['target_generation']
    if (type(before) is not int or type(target) is not int
            or not 1 <= before < 2**63 - 1 or target != before + 1):
        raise ValueError('pending generation must reserve exactly G + 1')
    for field in _HASH_FIELDS:
        if type(value[field]) is not str or not _HASH.fullmatch(value[field]):
            raise ValueError('pending generation SHA-256 binding is invalid')
    return dict(value)


def _identity(info):
    return [info.st_dev, info.st_ino]


def _private(info, directory=False):
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if (not kind(info.st_mode) or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) & 0o077
            or (not directory and info.st_nlink != 1)):
        raise ValueError('unsafe pending generation entry')


def _check_directory(private_fd, pending_fd):
    current = os.stat(PENDING_DIRECTORY, dir_fd=private_fd, follow_symlinks=False)
    actual = os.fstat(pending_fd)
    _private(current, directory=True)
    if _identity(current) != _identity(actual):
        raise RuntimeError('pending generation directory changed')


def reserve(project, bindings):
    """Reserve durably under ordinary ClusterLock; return the record digest.

    Binding hashes are provenance, not validation of their underlying evidence.
    No caller may interpret this helper as permission to operate a live cluster.
    Failed publication retains the pending path; another generation cannot skip it.
    """
    from labops import ClusterLock
    bindings = _bindings(bindings)
    with ClusterLock(project) as lock:
        private_fd = lock.private_fd
        _private(os.fstat(private_fd), directory=True)
        value = {'schema': 1, 'operation': 'fresh-generation-reservation',
                 'bindings': bindings, 'private_identity': _identity(os.fstat(private_fd))}
        raw = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
        lock.check_private_root()
        os.mkdir(PENDING_DIRECTORY, mode=0o700, dir_fd=private_fd)
        # Preserve the reservation even if a subsequent durability step fails.
        os.fsync(private_fd)
        parent_fd = os.open(Path(project), os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
        pending_fd = os.open(PENDING_DIRECTORY, _DIR_FLAGS, dir_fd=private_fd)
        try:
            _check_directory(private_fd, pending_fd)
            fd = os.open('.reservation.tmp', os.O_WRONLY | os.O_CREAT | os.O_EXCL
                         | os.O_NOFOLLOW, 0o600, dir_fd=pending_fd)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            lock.check_private_root()
            _check_directory(private_fd, pending_fd)
            os.link('.reservation.tmp', RECORD_NAME, src_dir_fd=pending_fd,
                    dst_dir_fd=pending_fd, follow_symlinks=False)
            os.unlink('.reservation.tmp', dir_fd=pending_fd)
            os.fsync(pending_fd)
            lock.check_private_root()
            _check_directory(private_fd, pending_fd)
            return hashlib.sha256(raw).hexdigest()
        finally:
            os.close(pending_fd)


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate pending generation field')
        value[key] = item
    return value


def _invalid_constant(_value):
    raise ValueError('nonstandard pending generation number')


def inspect(project):
    """Read only; malformed or interrupted records remain blocked, never cleared.

    The result is an observation, not mutation admission: admission must acquire
    ClusterLock and recheck the path while holding it.
    """
    private = Path(project) / 'private'
    try:
        private_fd = os.open(private, os.O_RDONLY | os.O_DIRECTORY)
    except FileNotFoundError:
        if private.is_symlink():
            return {'status': 'invalid', 'blocked': True}
        return {'status': 'absent', 'blocked': False}
    except OSError:
        return {'status': 'invalid', 'blocked': True}
    try:
        pinned = _identity(os.fstat(private_fd))
        def check_root():
            if _identity(private.stat()) != pinned:
                raise ValueError('controller private root changed')
        try:
            assert_no_pending(private_fd)
        except RuntimeError:
            pass
        else:
            try:
                check_root()
            except (OSError, ValueError):
                return {'status': 'invalid', 'blocked': True}
            return {'status': 'absent', 'blocked': False}
        try:
            _private(os.fstat(private_fd), directory=True)
            pending_fd = os.open(PENDING_DIRECTORY, _DIR_FLAGS, dir_fd=private_fd)
            try:
                _check_directory(private_fd, pending_fd)
                if os.listdir(pending_fd) != [RECORD_NAME]:
                    raise ValueError('unexpected pending generation records')
                fd = os.open(RECORD_NAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                             dir_fd=pending_fd)
                try:
                    before = os.fstat(fd)
                    _private(before)
                    if before.st_size > MAX_RECORD_BYTES:
                        raise ValueError('oversized pending generation record')
                    raw = os.read(fd, MAX_RECORD_BYTES + 1)
                    after = os.fstat(fd)
                    current = os.stat(RECORD_NAME, dir_fd=pending_fd, follow_symlinks=False)
                    if (len(raw) != before.st_size or _identity(current) != _identity(after)
                            or before.st_mtime_ns != after.st_mtime_ns
                            or before.st_ctime_ns != after.st_ctime_ns):
                        raise ValueError('pending generation record changed')
                finally:
                    os.close(fd)
                value = json.loads(raw, object_pairs_hook=_unique,
                                   parse_constant=_invalid_constant)
                if (type(value) is not dict or set(value) != {
                        'schema', 'operation', 'bindings', 'private_identity'}
                        or type(value['schema']) is not int or value['schema'] != 1
                        or value['operation'] != 'fresh-generation-reservation'
                        or type(value['private_identity']) is not list
                        or any(type(item) is not int for item in value['private_identity'])
                        or value['private_identity'] != pinned):
                    raise ValueError('invalid pending generation record')
                _bindings(value['bindings'])
                _check_directory(private_fd, pending_fd)
                check_root()
                return {'status': 'pending', 'blocked': True,
                        'reservation': value, 'sha256': hashlib.sha256(raw).hexdigest()}
            finally:
                os.close(pending_fd)
        except (OSError, ValueError, RuntimeError, RecursionError):
            return {'status': 'invalid', 'blocked': True}
    except (OSError, ValueError, RuntimeError, RecursionError):
        return {'status': 'invalid', 'blocked': True}
    finally:
        os.close(private_fd)
