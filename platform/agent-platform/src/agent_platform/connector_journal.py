"""Private, fsync-backed connector journal; one process and one writer per run."""

import fcntl
import json
import os
import threading
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID, uuid4

from .domain import Problem


def private_file(path):
    path = Path(path)
    info = path.lstat()
    if (
        not path.is_file()
        or path.is_symlink()
        or info.st_uid != os.getuid()
        or info.st_mode & 0o077
    ):
        raise ValueError("connector_file_must_be_private_and_owned")
    return path


class Journal:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if (
            self.root.is_symlink()
            or self.root.stat().st_uid != os.getuid()
            or self.root.stat().st_mode & 0o077
        ):
            raise ValueError("connector_directory_must_be_private_and_owned")
        self.lockfile = open(self.root / "owner.lock", "a")
        os.chmod(self.root / "owner.lock", 0o600)
        try:
            fcntl.flock(self.lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except Exception:
            self.lockfile.close()
            raise
        self.locks = {}
        self.mutex = threading.Lock()

    def close(self):
        self.lockfile.close()

    @contextmanager
    def locked(self, run_id):
        identifier = str(UUID(str(run_id)))
        with self.mutex:
            lock = self.locks.setdefault(identifier, threading.Lock())
        with lock:
            yield identifier

    def read(self, run_id):
        path = self.root / (str(UUID(str(run_id))) + ".json")
        return json.loads(private_file(path).read_text()) if path.exists() else None

    def write(self, row):
        path = self.root / (str(UUID(row["run_id"])) + ".json")
        temporary = self.root / (uuid4().hex + ".tmp")
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(row, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            temporary.unlink(missing_ok=True)

    def operation(self, row, kind, payload_hash, effect):
        old = row["operations"].get(kind)
        if old:
            if old["payload_hash"] != payload_hash:
                raise Problem(409, "connector_operation_conflict")
            if old["state"] != "completed":
                raise Problem(409, "connector_operation_uncertain")
            return old["result"]
        operation = {"state": "started", "payload_hash": payload_hash}
        row["operations"][kind] = operation
        self.write(row)  # Intent durable BEFORE upstream mutation, even if process dies next.
        result = effect()
        operation.update(state="completed", result=result)
        self.write(row)
        return result
