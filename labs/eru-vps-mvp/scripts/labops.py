"""Controller-local locking and durable private records for the ERU lab."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

LOCK_ENV = 'ERU_MVP_LOCK_FD'


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
        self.inherited = False

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if LOCK_ENV in os.environ:
            self.fd = int(os.environ[LOCK_ENV])
            actual, expected = os.fstat(self.fd), self.path.stat()
            if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
                raise RuntimeError('inherited lock is not this cluster lock')
            self.inherited = True
        else:
            self.fd = os.open(self.path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if not self.inherited:
                os.close(self.fd)
            raise RuntimeError('cluster operation already running on controller B') from None
        os.environ[LOCK_ENV] = str(self.fd)
        return self

    def __exit__(self, *exc):
        if not self.inherited:
            # close, not LOCK_UN: a surviving child must retain the lock.
            os.close(self.fd)
            os.environ.pop(LOCK_ENV, None)
