"""Bounded, same-path cold recovery of this invocation's synthetic scope.

This format is private local evidence, not a general-purpose archive importer.
No paths, per-file digests, config, or key material belong in public reports.
"""

from contextlib import contextmanager
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import shutil
import signal
import stat
import struct
import tempfile
import threading
import time

MARKER = ".open-compute-lab-owner"
DATA = "instances/lab/data"
MAGIC = b"OCLABC01"
MAX_ENTRIES = 4096
MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
MAX_MANIFEST = 4 * 1024 * 1024
MAX_PATH = 512
MAX_ARCHIVE = 288 * 1024 * 1024
CHUNK = 1024 * 1024
CLEANUP_SECONDS = 30
EXCLUDED_DIRS = frozenset(("cache", "tmp", "run", DATA + "/cache",
                           DATA + "/tmp", DATA + "/runtime", DATA + "/tessdata"))
EXCLUDED_FILES = frozenset(("ocd.lock", MARKER, DATA + "/platform.lock",
                            DATA + "/objects/backend.lock"))
LOCKS = ("ocd.lock", DATA + "/platform.lock", DATA + "/objects/backend.lock")
REQUIRED_FILES = frozenset(("ocd.toml", "keys/admin.token", "instances/lab/compute.toml",
    DATA + "/control.sqlite", DATA + "/scheduler.sqlite", DATA + "/keys/master.key",
    DATA + "/keys/deployer.token", DATA + "/keys/read-only.token",
    DATA + "/objects/format.json"))


class BackupError(RuntimeError):
    """A bounded, public-safe recovery error; never includes a filesystem path."""


class CleanupDeadline(BackupError):
    """Escape per-tree error handling immediately when cleanup time expires."""


@contextmanager
def cleanup_deadline():
    require(threading.current_thread() is threading.main_thread(),
            "private cleanup requires the main thread")
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    require(previous_timer == (0.0, 0.0), "an existing alarm prevents private cleanup")
    previous_handler = signal.getsignal(signal.SIGALRM)
    def expired(_signum, _frame):
        raise CleanupDeadline("private cleanup deadline exceeded")
    signal.signal(signal.SIGALRM, expired)
    try:
        signal.setitimer(signal.ITIMER_REAL, CLEANUP_SECONDS)
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        signal.setitimer(signal.ITIMER_REAL, *previous_timer)


def require(value, message):
    if not value:
        raise BackupError(message)


def identity(info):
    return {"device": info.st_dev, "inode": info.st_ino}


def absent(path):
    # Permission or I/O failure is unknown, never proof of absence.
    try:
        path.lstat()
    except FileNotFoundError:
        return True
    return False


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True).encode("ascii")


def excluded(path):
    return path in EXCLUDED_FILES or any(path == p or path.startswith(p + "/")
                                         for p in EXCLUDED_DIRS)


def valid_path(path):
    require(isinstance(path, str) and 0 < len(path.encode("utf-8")) <= MAX_PATH,
            "inventory path is outside bounds")
    require("\\" not in path and "\0" not in path and not path.startswith("/")
            and all(p not in ("", ".", "..") for p in path.split("/"))
            and str(PurePosixPath(path)) == path, "inventory path is not canonical")


def private_path(path):
    return any(path == root or path.startswith(root + "/")
               for root in ("keys", DATA + "/keys", DATA + "/objects"))


def validate_mode(path, kind, mode, uid):
    require(type(mode) is int and 0 <= mode <= 0o777 and not mode & 0o022
            and type(uid) is int and uid == os.geteuid(), "inventory ownership or mode is unsafe")
    if private_path(path):
        require(mode == (0o700 if kind == "directory" else 0o600),
                "private authority permissions are unsafe")


def validate_stat(path, info, kind=None):
    actual = "directory" if stat.S_ISDIR(info.st_mode) else (
        "file" if stat.S_ISREG(info.st_mode) else None)
    require(actual is not None and (kind is None or actual == kind),
            "unsupported filesystem entry")
    require(actual != "file" or info.st_nlink == 1, "hard-linked file is refused")
    validate_mode(path, actual, stat.S_IMODE(info.st_mode), info.st_uid)
    return actual


@contextmanager
def ownership_transition():
    # Prevent alarm/cancellation between exclusive creation/rename and recording
    # its ownership. Pending signals are delivered after the record is complete.
    old = signal.pthread_sigmask(signal.SIG_BLOCK,
                                 {signal.SIGALRM, signal.SIGINT, signal.SIGTERM})
    try:
        yield
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, old)


class OwnedTree:
    """Private scratch with identity tracking for every created child."""

    def __init__(self, path):
        self.path = path
        self.identity = None
        self.marker = secrets.token_hex(32)
        self.created = {}
        self.installed = False

    def create(self):
        with ownership_transition():
            self.path.mkdir(mode=0o700)
            self.identity = identity(self.path.lstat())
            with self.create_file(MARKER) as stream:
                stream.write(self.marker.encode())

    def check(self):
        info = self.path.lstat()
        require(identity(info) == self.identity and stat.S_ISDIR(info.st_mode)
                and stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.geteuid(),
                "private root ownership changed")
        with self.open_created(MARKER) as stream:
            require(stream.read(129) == self.marker.encode(), "private ownership marker changed")

    def create_dir(self, relative):
        with ownership_transition():
            path = self.path / relative
            path.mkdir(mode=0o700)
            self.created[relative] = identity(path.lstat())

    def create_file(self, relative):
        with ownership_transition():
            path = self.path / relative
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            self.created[relative] = identity(os.fstat(fd))
            return os.fdopen(fd, "wb")

    def open_created(self, relative):
        path = self.path / relative
        info = path.lstat()
        require(identity(info) == self.created.get(relative), "private file ownership changed")
        validate_stat(relative, info, "file")
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        opened = os.fstat(fd)
        if identity(opened) != identity(info):
            os.close(fd)
            raise BackupError("private file ownership changed")
        return os.fdopen(fd, "rb")

    def check_entries(self, check_deadline):
        self.check()
        observed = {}
        def visit(directory, prefix):
            with os.scandir(directory) as children:
                for child in children:
                    check_deadline()
                    require(len(observed) < MAX_ENTRIES + 4, "private cleanup exceeds bounds")
                    relative = prefix + child.name
                    info = child.stat(follow_symlinks=False)
                    kind = validate_stat(relative, info)
                    observed[relative] = identity(info)
                    if kind == "directory":
                        visit(Path(child.path), relative + "/")
        visit(self.path, "")
        require(observed == self.created, "private cleanup found unowned entries")
        self.check()

    def remove(self, check_deadline):
        if self.identity is None or self.installed:
            return True
        self.check_entries(check_deadline)
        require(shutil.rmtree.avoids_symlink_attacks, "safe cleanup is unavailable")
        shutil.rmtree(self.path)
        check_deadline()
        require(absent(self.path), "private cleanup did not finish")
        check_deadline()
        self.identity = None
        return True


class ColdRestore:
    def __init__(self, scope, cache, output, deadline, progress):
        self.scope, self.cache, self.output = scope, Path(cache), Path(output)
        self.deadline, self.progress = deadline, progress
        self.private = self.stage = None
        self.source_identity = None
        self.summary = {}
        self._started = False

    def tick(self):
        require(time.monotonic() < self.deadline, "cold recovery deadline exceeded")

    def emit(self, event, **updates):
        self.summary.update(updates)
        self.progress(event, dict(self.summary))

    def inventory(self, root):
        self.tick()
        info = root.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == 0o700, "scope root is unsafe")
        entries, total, discovered = [], 0, 0
        excluded_seen = set()
        def visit(directory, prefix):
            nonlocal total, discovered
            children = []
            # Do not materialize an unbounded directory before applying limits.
            # Count discoveries across the entire tree, including siblings whose
            # payload will be inspected after this directory has been sorted.
            with os.scandir(directory) as scan:
                for child in scan:
                    self.tick()
                    path = prefix + child.name
                    valid_path(path)
                    if path in EXCLUDED_DIRS or path in EXCLUDED_FILES:
                        require(path not in excluded_seen, "duplicate excluded path")
                        excluded_seen.add(path)
                        require(len(excluded_seen) <= len(EXCLUDED_DIRS) + len(EXCLUDED_FILES),
                                "excluded entry count exceeds bounds")
                    else:
                        discovered += 1
                        require(discovered <= MAX_ENTRIES, "inventory entry count exceeds bounds")
                    children.append(Path(child.path))
            for child in sorted(children, key=lambda p: p.name):
                self.tick()
                path = prefix + child.name
                valid_path(path)
                info = child.lstat()
                if path in EXCLUDED_DIRS:
                    validate_stat(path, info, "directory")
                    continue
                if path in EXCLUDED_FILES:
                    validate_stat(path, info, "file")
                    continue
                kind = validate_stat(path, info)
                entry = {"path": path, "type": kind, "mode": stat.S_IMODE(info.st_mode),
                         "uid": info.st_uid}
                entries.append(entry)
                require(len(entries) <= MAX_ENTRIES, "inventory entry count exceeds bounds")
                if kind == "directory":
                    visit(child, path + "/")
                else:
                    require(info.st_size <= MAX_FILE, "inventory file exceeds bounds")
                    total += info.st_size
                    require(total <= MAX_TOTAL, "inventory payload exceeds bounds")
                    entry.update(size=info.st_size, sha256=self.file_hash(child, path, info))
        visit(root, "")
        entries.sort(key=lambda e: e["path"])
        manifest = {"format": 1, "entries": entries}
        self.validate_manifest(manifest)
        require(len(canonical(manifest)) <= MAX_MANIFEST, "manifest exceeds bounds")
        return manifest

    def file_hash(self, path, relative, before, output=None):
        digest, count = hashlib.sha256(), 0
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as source:
            opened = os.fstat(source.fileno())
            require(identity(opened) == identity(before), "source entry changed")
            validate_stat(relative, opened, "file")
            while True:
                self.tick()
                chunk = source.read(min(CHUNK, MAX_FILE + 1 - count))
                if not chunk:
                    break
                count += len(chunk)
                require(count <= MAX_FILE, "source file exceeds bounds")
                digest.update(chunk)
                if output is not None:
                    output.write(chunk)
            after = os.fstat(source.fileno())
        require(count == before.st_size and (after.st_size, after.st_mtime_ns,
                after.st_ctime_ns) == (before.st_size, before.st_mtime_ns, before.st_ctime_ns),
                "source entry changed during backup")
        return digest.hexdigest()

    def validate_manifest(self, manifest):
        require(type(manifest) is dict and set(manifest) == {"format", "entries"}
                and type(manifest["format"]) is int and manifest["format"] == 1,
                "invalid backup manifest")
        entries = manifest["entries"]
        require(type(entries) is list and 0 < len(entries) <= MAX_ENTRIES,
                "inventory entry count exceeds bounds")
        known, total, previous = {}, 0, ""
        for entry in entries:
            self.tick()
            require(type(entry) is dict, "invalid backup entry")
            kind = entry.get("type")
            require(kind in ("file", "directory"), "unsupported archive entry")
            keys = {"path", "type", "mode", "uid"}
            if kind == "file":
                keys |= {"size", "sha256"}
            require(set(entry) == keys, "invalid backup entry fields")
            path = entry["path"]
            valid_path(path)
            require(path > previous and not excluded(path), "duplicate or excluded archive entry")
            parent = str(PurePosixPath(path).parent)
            require(parent == "." or known.get(parent) == "directory", "missing archive parent")
            validate_mode(path, kind, entry["mode"], entry["uid"])
            if kind == "file":
                size, digest = entry["size"], entry["sha256"]
                require(type(size) is int and 0 <= size <= MAX_FILE,
                        "archive file exceeds bounds")
                require(isinstance(digest, str) and len(digest) == 64
                        and all(c in "0123456789abcdef" for c in digest), "invalid archive digest")
                total += size
                require(total <= MAX_TOTAL, "archive payload exceeds bounds")
            known[path], previous = kind, path
        require(all(known.get(p) == "file" for p in REQUIRED_FILES),
                "backup is missing required authority")
        require(any(p.startswith(DATA + "/d1/") and kind == "file"
                    for p, kind in known.items()), "backup is missing D1 authority")
        require(any(p.startswith(DATA + "/objects/objects/") and kind == "file"
                    for p, kind in known.items()), "backup is missing object payloads")

    def write_package(self, manifest):
        self.private.check()
        raw = canonical(manifest)
        with self.private.create_file("payload.ocb") as target:
            target.write(MAGIC + struct.pack(">Q", len(raw)) + raw)
            for entry in manifest["entries"]:
                self.tick()
                if entry["type"] == "file":
                    path = self.scope.path / entry["path"]
                    info = path.lstat()
                    require(info.st_size == entry["size"], "source changed before copy")
                    digest = self.file_hash(path, entry["path"], info, target)
                    require(digest == entry["sha256"], "source changed before copy")
            target.flush()
            os.fsync(target.fileno())
            require(target.tell() <= MAX_ARCHIVE, "archive exceeds bounds")

    @staticmethod
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate manifest field")
            result[key] = value
        return result

    def read_package(self, expected, extract=False):
        self.private.check()
        with self.private.open_created("payload.ocb") as source:
            require(os.fstat(source.fileno()).st_size <= MAX_ARCHIVE, "archive exceeds bounds")
            require(source.read(8) == MAGIC, "invalid backup header")
            length = source.read(8)
            require(len(length) == 8, "truncated backup header")
            length = struct.unpack(">Q", length)[0]
            require(0 < length <= MAX_MANIFEST, "manifest exceeds bounds")
            raw = source.read(length)
            require(len(raw) == length, "truncated manifest")
            manifest = json.loads(raw, object_pairs_hook=self.unique_pairs)
            self.validate_manifest(manifest)
            require(canonical(manifest) == raw and manifest == expected,
                    "backup inventory verification failed")
            for entry in manifest["entries"]:
                self.tick()
                if entry["type"] == "directory":
                    if extract:
                        self.stage.create_dir(entry["path"])
                    continue
                target = self.stage.create_file(entry["path"]) if extract else None
                try:
                    digest, remaining = hashlib.sha256(), entry["size"]
                    while remaining:
                        self.tick()
                        chunk = source.read(min(CHUNK, remaining))
                        require(chunk, "truncated backup payload")
                        remaining -= len(chunk)
                        digest.update(chunk)
                        if target is not None:
                            target.write(chunk)
                    require(digest.hexdigest() == entry["sha256"], "backup payload verification failed")
                    if target is not None:
                        target.flush()
                        os.fchmod(target.fileno(), entry["mode"])
                finally:
                    if target is not None:
                        target.close()
            require(not source.read(1), "extra backup payload bytes")
        if extract:
            for entry in reversed(manifest["entries"]):
                self.tick()
                if entry["type"] == "directory":
                    os.chmod(self.stage.path / entry["path"], entry["mode"], follow_symlinks=False)
        return manifest

    def prepare_roots(self):
        source = self.scope.path.resolve(strict=True)
        cache, output = self.cache.resolve(), self.output.resolve()
        parent = Path(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir()).resolve(strict=True)
        stage_path = source.parent / (".oc-restore-" + secrets.token_hex(16))
        private_path = parent / (".oc-backup-" + secrets.token_hex(16))
        roots = (source, cache, output, stage_path)
        require(all(not private_path.is_relative_to(p) and not p.is_relative_to(private_path)
                    for p in roots), "private backup placement overlaps owned state")
        require(all(not stage_path.is_relative_to(p) and not p.is_relative_to(stage_path)
                    for p in (source, cache, output)), "restore staging overlaps owned state")
        self.private, self.stage = OwnedTree(private_path), OwnedTree(stage_path)
        self.private.create()
        self.stage.create()
        require(self.stage.identity != self.source_identity, "staging root is not independent")

    def acquire_locks(self):
        descriptors = []
        try:
            for relative in LOCKS:
                self.tick()
                path = self.scope.path / relative
                # Validate every ancestor; O_NOFOLLOW alone protects only the leaf.
                for parent in reversed(path.parents):
                    if parent == self.scope.path or self.scope.path in parent.parents:
                        validate_stat(str(parent.relative_to(self.scope.path)), parent.lstat(), "directory")
                before = path.lstat()
                validate_stat(relative, before, "file")
                fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
                descriptors.append(fd)
                require(identity(os.fstat(fd)) == identity(before), "source lock changed")
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return descriptors
        except BaseException:
            for fd in descriptors:
                os.close(fd)
            raise

    def install(self):
        self.stage.check_entries(self.tick)
        require(absent(self.scope.path), "restore destination is occupied")
        # Linux RENAME_NOREPLACE closes the empty-destination check/rename race.
        with ownership_transition():
            code = self._rename(-100, os.fsencode(self.stage.path), -100,
                                os.fsencode(self.scope.path), 1)
            require(code == 0, "atomic no-clobber restore failed")
            self.scope.identity = dict(self.stage.identity)
            self.scope.marker = self.stage.marker
            self.stage.installed = True
        self.scope.check_owner()

    def recover(self):
        descriptors = []
        try:
            require(not self._started, "recovery is single-use")
            self._started = True
            self.tick()
            self.scope.check_owner()
            self.source_identity = dict(self.scope.identity)
            library = ctypes.CDLL(None, use_errno=True)
            self._rename = library.renameat2
            self._rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                                     ctypes.c_char_p, ctypes.c_uint]
            self._rename.restype = ctypes.c_int
            descriptors = self.acquire_locks()
            self.emit("locked", source_root=self.source_identity, locks_acquired=True)
            self.prepare_roots()
            manifest = self.inventory(self.scope.path)
            self.write_package(manifest)
            self.read_package(manifest)
            require(self.inventory(self.scope.path) == manifest, "source inventory changed")
            self.emit("backup_verified", staging_root=dict(self.stage.identity),
                      archive_verified=True, source_verified=True,
                      entry_count=len(manifest["entries"]),
                      file_count=sum(e["type"] == "file" for e in manifest["entries"]),
                      total_bytes=sum(e.get("size", 0) for e in manifest["entries"]),
                      inventory_sha256=hashlib.sha256(canonical(manifest)).hexdigest())
            # A callback cannot invalidate the package and still authorize deletion.
            self.read_package(manifest)
            require(self.inventory(self.scope.path) == manifest, "source inventory changed")
            self.tick()
            self.scope.check_owner()
            self.stage.check_entries(self.tick)
            self.private.check_entries(self.tick)
            try:
                self.scope.remove(processes_stopped=True)
            finally:
                # Do not mask the global deadline around potentially long tree
                # deletion. Even a signal after unlink must settle ownership.
                if absent(self.scope.path):
                    self.scope.identity = None
            require(absent(self.scope.path) and absent(self.scope.path / DATA),
                    "source removal is incomplete")
            self.emit("source_removed", source_absent=True, data_absent=True)
            self.read_package(manifest)
            self.stage.check()
            require(absent(self.scope.path), "restore destination is occupied")
            self.read_package(manifest, extract=True)
            require(self.inventory(self.stage.path) == manifest, "restored inventory verification failed")
            self.tick()
            self.install()
            self.emit("restored", restored_root=dict(self.scope.identity), restored_verified=True)
            return dict(self.summary)
        except BackupError:
            raise
        except (OSError, ValueError, TypeError, AttributeError, RecursionError) as error:
            raise BackupError("cold recovery failed a filesystem or archive check") from None
        finally:
            for fd in descriptors:
                os.close(fd)

    def cleanup(self, processes_stopped):
        require(processes_stopped, "unknown or live processes prevent private cleanup")
        # Cleanup has a separate bounded budget after the recovery timer is disarmed.
        end = time.monotonic() + CLEANUP_SECONDS
        def tick():
            require(time.monotonic() < end, "private cleanup deadline exceeded")
        result = {"private_removed": self.private is None, "staging_removed": self.stage is None}
        failed = False
        with cleanup_deadline():
            for key, tree in (("private_removed", self.private), ("staging_removed", self.stage)):
                if tree is not None:
                    try:
                        result[key] = tree.remove(tick)
                    except CleanupDeadline:
                        raise
                    except (BackupError, OSError):
                        failed = True
        require(not failed, "private recovery cleanup refused changed ownership or entries")
        return result
