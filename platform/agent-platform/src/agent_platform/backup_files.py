"""Pinned private descriptors, strict manifests and streaming corruption checks."""

import hashlib
import json
import os
import re
import stat
from contextlib import contextmanager
from pathlib import Path

from .private_config import _directory as _safe_directory
from .private_config import _no_acl

MANIFEST_LIMIT = 65536
DUMP_LIMIT = 8 * 1024**3


def fail(code):
    raise ValueError(code) from None


def _directory(path):
    path = Path(path)
    if not path.is_absolute():
        path = Path.cwd() / path
    if ".." in path.parts:
        fail("backup_unsafe_path")
    fd = os.open("/" if path.is_absolute() else ".", os.O_RDONLY | os.O_DIRECTORY)
    try:
        _safe_directory(fd)
        for part in path.parts:
            if part in ("/", "."):
                continue
            new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = new
            _safe_directory(fd)
        return fd
    except (OSError, ValueError):
        os.close(fd)
        fail("backup_unsafe_path")


def _private(fd, *, directory=False):
    info = os.fstat(fd)
    try:
        _no_acl(fd)
    except (OSError, ValueError):
        fail("backup_unsafe_path")
    expected = 0o700 if directory else 0o600
    valid_type = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    if (
        not valid_type
        or info.st_uid != os.geteuid()
        or stat.S_IMODE(info.st_mode) != expected
        or (not directory and info.st_nlink != 1)
    ):
        fail("backup_unsafe_path")
    return info


@contextmanager
def create_bundle(path):
    """Never remove or replace existing files, including remnants of failed attempts."""
    path = Path(path)
    parent = _directory(path.parent)
    fd = None
    try:
        _private(parent, directory=True)
        try:
            os.mkdir(path.name, 0o700, dir_fd=parent)
        except FileExistsError:
            fail("backup_destination_exists")
        fd = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        _private(fd, directory=True)
        yield fd
        os.fsync(parent)
    except BaseException as exc:
        if fd is not None:
            try:
                os.unlink("manifest.json", dir_fd=fd)
            except FileNotFoundError:
                pass
        if isinstance(exc, OSError):
            fail("backup_file_error")
        raise
    finally:
        if fd is not None:
            os.close(fd)
        os.close(parent)


def _file(directory, name, *, create=False):
    flags = (
        os.O_NOFOLLOW
        | os.O_NONBLOCK
        | (os.O_WRONLY | os.O_CREAT | os.O_EXCL if create else os.O_RDONLY)
    )
    try:
        fd = os.open(name, flags, 0o600, dir_fd=directory)
    except FileNotFoundError:
        fail("backup_incomplete")
    except OSError:
        fail("backup_unsafe_path")
    try:
        _private(fd)
        return os.fdopen(fd, "wb" if create else "rb")
    except BaseException:
        os.close(fd)
        raise


def create_dump(directory):
    return _file(directory, "database.dump", create=True)


def _hash(dump):
    before = _private(dump.fileno())
    if not 5 <= before.st_size <= DUMP_LIMIT:
        fail("backup_corrupt")
    dump.seek(0)
    if dump.read(5) != b"PGDMP":
        fail("backup_corrupt")
    dump.seek(0)
    digest = hashlib.sha256()
    count = 0
    while chunk := dump.read(1024 * 1024):
        count += len(chunk)
        if count > DUMP_LIMIT:
            fail("backup_corrupt")
        digest.update(chunk)
    after = _private(dump.fileno())
    if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
        after.st_size,
        after.st_mtime_ns,
        after.st_ctime_ns,
    ) or count != before.st_size:
        fail("backup_corrupt")
    dump.seek(0)
    return count, digest.hexdigest()


def complete_bundle(directory, manifest):
    with _file(directory, "database.dump") as dump:
        size, digest = _hash(dump)
        os.fsync(dump.fileno())
    manifest = {**manifest, "dump_bytes": size, "dump_sha256": digest}
    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    if len(payload) > MANIFEST_LIMIT:
        fail("backup_manifest_invalid")
    with _file(directory, "manifest.json", create=True) as target:
        target.write(payload)
        target.flush()
        os.fsync(target.fileno())
    os.fsync(directory)
    return manifest


def _pairs(values):
    output = {}
    for key, value in values:
        if key in output:
            fail("backup_manifest_invalid")
        output[key] = value
    return output


def _manifest(source):
    if _private(source.fileno()).st_size > MANIFEST_LIMIT:
        fail("backup_manifest_invalid")
    try:
        value = json.loads(
            source.read(MANIFEST_LIMIT + 1),
            object_pairs_hook=_pairs,
            parse_constant=lambda _: fail("backup_manifest_invalid"),
        )
        if (
            not isinstance(value, dict)
            or type(value.get("dump_bytes")) is not int
            or not 5 <= value["dump_bytes"] <= DUMP_LIMIT
            or not isinstance(value.get("dump_sha256"), str)
            or re.fullmatch("[a-f0-9]{64}", value["dump_sha256"]) is None
        ):
            fail("backup_manifest_invalid")
        return value
    except (ValueError, UnicodeError, RecursionError):
        fail("backup_manifest_invalid")


@contextmanager
def read_bundle(path):
    directory = _directory(path)
    try:
        _private(directory, directory=True)
        with _file(directory, "manifest.json") as source:
            manifest = _manifest(source)
        with _file(directory, "database.dump") as dump:
            size, digest = _hash(dump)
            if size != manifest["dump_bytes"] or digest != manifest["dump_sha256"]:
                fail("backup_corrupt")
            yield manifest, dump
    except OSError:
        fail("backup_file_error")
    finally:
        os.close(directory)
