"""Controller-local locking and durable private records for the ERU lab."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile
import stat
from threading import RLock

LOCK_ENV = 'ERU_MVP_LOCK_FD'
_PROCESS_LOCK = RLock()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2, sort_keys=True)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def lock_fds():
    return (int(os.environ[LOCK_ENV]),) if LOCK_ENV in os.environ else ()


class ClusterLock:
    """One mutation per controller checkout; inherited by cooperating children.

    Keep the inode: never unlink a lock file. It is not a cross-controller lock.
    """
    def __init__(self, project):
        self.path = Path(project) / 'private/controller.lock'
        self.fd = None
        self.private_fd = None
        self.inherited = False
        self.thread_lock_acquired = False

    def check_private_root(self):
        """Reject replacement of the trusted backing root while this lock lives."""
        if self.private_fd is None:
            raise RuntimeError('controller lock is not active')
        actual, expected = os.fstat(self.private_fd), self.path.parent.stat()
        if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
            raise RuntimeError('controller private root changed')

    def _admit(self):
        """Ordinary mutations reject every persistent pending path."""
        from pending_generation import assert_no_pending
        assert_no_pending(self.private_fd)

    def __enter__(self):
        if self.thread_lock_acquired:
            raise RuntimeError('controller lock context is already active')
        self.fd = None
        self.inherited = False
        if not _PROCESS_LOCK.acquire(blocking=False):
            raise RuntimeError('cluster operation already running on controller B')
        self.thread_lock_acquired = True
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            # The private root itself may be a trusted symlink. Descendants
            # are always opened relative to this pinned backing directory.
            self.private_fd = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            if LOCK_ENV in os.environ:
                self.fd = int(os.environ[LOCK_ENV])
                self.inherited = True
                actual, expected = os.fstat(self.fd), os.stat(
                    'controller.lock', dir_fd=self.private_fd, follow_symlinks=False)
                if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
                    raise RuntimeError('inherited lock is not this cluster lock')
            else:
                self.fd = os.open('controller.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW,
                                  0o600, dir_fd=self.private_fd)
            info = os.fstat(self.fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise RuntimeError('unsafe controller lock file')
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.check_private_root()
            self._admit()
            self.check_private_root()
            os.environ[LOCK_ENV] = str(self.fd)
            return self
        except BlockingIOError:
            if self.fd is not None and not self.inherited:
                os.close(self.fd)
            if self.private_fd is not None:
                os.close(self.private_fd)
                self.private_fd = None
            self.thread_lock_acquired = False
            _PROCESS_LOCK.release()
            raise RuntimeError('cluster operation already running on controller B') from None
        except BaseException:
            if self.fd is not None and not self.inherited:
                os.close(self.fd)
            if self.private_fd is not None:
                os.close(self.private_fd)
                self.private_fd = None
            self.thread_lock_acquired = False
            _PROCESS_LOCK.release()
            raise

    def __exit__(self, *exc):
        try:
            if not self.inherited:
                # close, not LOCK_UN: a surviving child must retain the lock.
                os.close(self.fd)
                os.environ.pop(LOCK_ENV, None)
        finally:
            if self.private_fd is not None:
                os.close(self.private_fd)
                self.private_fd = None
            if self.thread_lock_acquired:
                self.thread_lock_acquired = False
                _PROCESS_LOCK.release()
