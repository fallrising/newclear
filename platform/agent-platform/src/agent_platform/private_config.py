"""Bounded Linux private-file reads using pinned, validated descriptors."""

import errno
import os
import stat

_ACLS = {"system.posix_acl_access", "system.posix_acl_default"}


def _no_acl(fd):
    try:
        names = os.listxattr(fd)
    except OSError as error:
        if error.errno not in (errno.ENOTSUP, errno.EOPNOTSUPP):
            raise
    else:
        if _ACLS.intersection(names):
            raise ValueError()


def _directory(fd, *, private=False):
    info = os.fstat(fd)
    mode = stat.S_IMODE(info.st_mode)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, os.geteuid()):
        raise ValueError()
    if private:
        if info.st_uid != os.geteuid() or mode & 0o7077 or not mode & stat.S_IXUSR:
            raise ValueError()
    elif mode & 0o022 and not (info.st_uid == 0 and mode & stat.S_ISVTX):
        raise ValueError()
    _no_acl(fd)


def _regular(fd, limit):
    info = os.fstat(fd)
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.geteuid()
        or info.st_nlink != 1
        or stat.S_IMODE(info.st_mode) & 0o7177
        or not info.st_mode & stat.S_IRUSR
        or not 0 <= info.st_size <= limit
    ):
        raise ValueError()
    _no_acl(fd)
    return (
        info.st_dev,
        info.st_ino,
        info.st_mode,
        info.st_uid,
        info.st_gid,
        info.st_nlink,
        info.st_size,
        info.st_mtime_ns,
        info.st_ctime_ns,
    )


def read_private_text(path, *, max_bytes):
    """Read strict UTF-8, or raise a fixed ValueError without filesystem details.

    This validates storage for a trusted process. It cannot isolate a malicious
    process with the same UID, root access, or access to the broker's memory.
    """
    directory = file_fd = None
    try:
        value = os.fspath(path)
        if (
            type(value) is not str
            or not value.startswith("/")
            or len(value) > 4096
            or "\x00" in value
            or type(max_bytes) is not int
            or not 0 < max_bytes <= 65536
        ):
            raise ValueError()
        parts = value.split("/")[1:]
        if not parts or any(part in ("", ".", "..") for part in parts):
            raise ValueError()
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
        directory = os.open("/", flags | os.O_DIRECTORY)
        _directory(directory)
        for part in parts[:-1]:
            child = os.open(part, flags | os.O_DIRECTORY, dir_fd=directory)
            os.close(directory)
            directory = child
            _directory(directory)
        _directory(directory, private=True)
        file_fd = os.open(parts[-1], flags | os.O_NONBLOCK, dir_fd=directory)
        before = _regular(file_fd, max_bytes)
        data = bytearray()
        while len(data) <= max_bytes:
            chunk = os.read(file_fd, max_bytes + 1 - len(data))
            if not chunk:
                break
            data.extend(chunk)
        if len(data) > max_bytes or before != _regular(file_fd, max_bytes):
            raise ValueError()
        if len(data) != before[6]:
            raise ValueError()
        return data.decode("utf-8")
    except Exception:
        raise ValueError("private_config_invalid") from None
    finally:
        if file_fd is not None:
            os.close(file_fd)
        if directory is not None:
            os.close(directory)
