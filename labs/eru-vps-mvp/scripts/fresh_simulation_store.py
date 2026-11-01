"""Immutable, bounded local records for synthetic fresh-rebuild simulations.

This store has no production private-root integration. Directory traversal uses
no-follow descriptors; every operation reopens and checks the pinned root.
Unknown entries (including abandoned publication temporaries) fail audit closed.
"""
from __future__ import annotations

import errno
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import uuid

MAX_RECORD_BYTES = 1024 * 1024
MAX_DEPTH = 64
_NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.json\Z')
_DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _name(name):
    if not isinstance(name, str) or not _NAME.fullmatch(name):
        raise ValueError('invalid simulation record filename')
    return name


def _validate(value, depth=0):
    if depth > MAX_DEPTH:
        raise ValueError('simulation JSON nesting exceeds limit')
    if type(value) is dict:
        for key, item in value.items():
            if type(key) is not str:
                raise ValueError('simulation JSON keys must be strings')
            _validate(item, depth + 1)
    elif type(value) is list:
        for item in value:
            _validate(item, depth + 1)
    elif type(value) is float:
        if not math.isfinite(value):
            raise ValueError('simulation JSON requires finite numbers')
    elif type(value) not in (str, int, bool, type(None)):
        raise ValueError('simulation record contains a non-JSON value')


def _encode(value):
    if type(value) is not dict:
        raise ValueError('simulation record must be a JSON object')
    try:
        _validate(value)
        raw = json.dumps(value, sort_keys=True, separators=(',', ':'),
                         ensure_ascii=True, allow_nan=False).encode('utf-8')
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise ValueError('invalid simulation JSON object') from None
    if len(raw) > MAX_RECORD_BYTES:
        raise ValueError('simulation record exceeds size limit')
    return raw


def record_digest(value):
    """Return SHA-256 of the strict canonical representation."""
    return hashlib.sha256(_encode(value)).hexdigest()


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key')
        result[key] = value
    return result


def _constant(_value):
    raise ValueError('nonstandard JSON number')


def _decode(raw):
    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique,
                           parse_constant=_constant)
        _encode(value)
        return value
    except (ValueError, UnicodeError, RecursionError):
        raise ValueError('invalid simulation JSON record') from None


def _identity(info):
    return info.st_dev, info.st_ino


def _private(info, directory=False):
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if (not expected(info.st_mode) or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) & 0o077
            or (not directory and info.st_nlink != 1)):
        raise ValueError('unsafe simulation record filesystem entry')


class RecordStore:
    """A flat isolated directory; its parent must already exist.

    Created roots and records have mode 0700 and 0600. Existing roots and
    records must be owner-private, and regular records cannot have hardlinks.
    A failed write may leave a complete published record, which remains reserved.
    """

    def __init__(self, root):
        try:
            supplied = Path(root)
        except TypeError:
            raise ValueError('invalid simulation root') from None
        if '..' in supplied.parts:
            raise ValueError('simulation root may not traverse parent directories')
        self.root = supplied.absolute()
        if self.root == Path('/'):
            raise ValueError('simulation root must be an isolated directory')
        self._pinned = None
        fd = self._open_root(create=True)
        try:
            self._pinned = _identity(os.fstat(fd))
        finally:
            os.close(fd)

    def _open_root(self, create=False):
        fd = os.open('/', _DIRECTORY_FLAGS)
        try:
            parts = self.root.parts[1:]
            for index, part in enumerate(parts):
                if create and index == len(parts) - 1:
                    try:
                        os.mkdir(part, mode=0o700, dir_fd=fd)
                    except FileExistsError:
                        pass
                next_fd = os.open(part, _DIRECTORY_FLAGS, dir_fd=fd)
                if create and index == len(parts) - 1:
                    try:
                        _private(os.fstat(next_fd), directory=True)
                        # Sync even an existing root: a previous creation may
                        # have failed at this durability boundary.
                        os.fsync(fd)
                    except BaseException:
                        os.close(next_fd)
                        raise
                os.close(fd)
                fd = next_fd
            info = os.fstat(fd)
            _private(info, directory=True)
            if self._pinned is not None and _identity(info) != self._pinned:
                raise ValueError('simulation root identity changed')
            result, fd = fd, None
            return result
        except OSError as exc:
            if exc.errno in (errno.ELOOP, errno.ENOTDIR, errno.ENOENT):
                raise ValueError('simulation root is unavailable or unsafe') from None
            raise
        finally:
            if fd is not None:
                os.close(fd)

    def _check_root(self):
        fd = self._open_root()
        os.close(fd)

    @staticmethod
    def _read_at(fd, name):
        try:
            record = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                             dir_fd=fd)
        except OSError as exc:
            if exc.errno in (errno.ELOOP, errno.ENOTDIR):
                raise ValueError('unsafe simulation record filesystem entry') from None
            if exc.errno == errno.ENOENT:
                raise FileNotFoundError('simulation record is missing') from None
            raise
        try:
            before = os.fstat(record)
            _private(before)
            if before.st_size > MAX_RECORD_BYTES:
                raise ValueError('simulation record exceeds size limit')
            with os.fdopen(record, 'rb', closefd=False) as stream:
                raw = stream.read(MAX_RECORD_BYTES + 1)
            after = os.fstat(record)
            current = os.stat(name, dir_fd=fd, follow_symlinks=False)
            _private(after)
            if (len(raw) > MAX_RECORD_BYTES or before.st_size != len(raw)
                    or before.st_mtime_ns != after.st_mtime_ns
                    or before.st_ctime_ns != after.st_ctime_ns
                    or _identity(after) != _identity(current)):
                raise ValueError('simulation record changed while reading')
            return _decode(raw)
        finally:
            os.close(record)

    def read(self, name):
        name = _name(name)
        fd = self._open_root()
        try:
            value = self._read_at(fd, name)
            self._check_root()
            return value
        finally:
            os.close(fd)

    def names(self):
        fd = self._open_root()
        try:
            names = sorted(os.listdir(fd))
            for name in names:
                _name(name)
                self._read_at(fd, name)
            self._check_root()
            return names
        finally:
            os.close(fd)

    def write_once(self, name, value):
        name = _name(name)
        raw = _encode(value)
        fd = self._open_root()
        temporary = '.fresh-' + uuid.uuid4().hex + '.tmp'
        created = False
        try:
            record = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                             | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            created = True
            with os.fdopen(record, 'wb') as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            self._check_root()
            try:
                os.link(temporary, name, src_dir_fd=fd, dst_dir_fd=fd,
                        follow_symlinks=False)
            except FileExistsError:
                raise FileExistsError('simulation record already exists') from None
            os.unlink(temporary, dir_fd=fd)
            created = False
            os.fsync(fd)
            self._check_root()
            return hashlib.sha256(raw).hexdigest()
        finally:
            try:
                if created:
                    os.unlink(temporary, dir_fd=fd)
            finally:
                os.close(fd)
