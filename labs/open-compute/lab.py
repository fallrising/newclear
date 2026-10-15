#!/usr/bin/env python3
"""Bounded black-box probe for the pinned open-compute release (Python stdlib)."""

import argparse
from contextlib import ExitStack, contextmanager, nullcontext
import hashlib
import http.client
import json
import os
from pathlib import Path
import platform
import pwd
import re
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import threading
import time
import urllib.request
from urllib.parse import urlsplit


HERE = Path(__file__).resolve().parent
BODY_LIMIT = 1024 * 1024
LOG_LIMIT = 32 * 1024
HTTP_TOTAL_TIMEOUT = 20.0
DOWNLOAD_TOTAL_TIMEOUT = 300.0
RECOVERY_TOTAL_TIMEOUT = 120.0
INSTANCE = "lab"
WORKER = "m1-worker"
FLOW = "m1-flow"
BUCKET = "lab-bucket"
R2_KEY = "restore/sentinel.bin"
R2_HTTP_METADATA = {"contentType": "application/octet-stream",
                    "cacheControl": "private, max-age=60",
                    "contentDisposition": 'attachment; filename="sentinel.bin"'}
MARKER = ".open-compute-lab-owner"


class LabError(Exception):
    """An experiment gate failed; never silently convert this into a skip."""


class ProcessObservationError(LabError):
    """Process ownership/exits cannot be established from the available evidence."""


def require(condition, message):
    if not condition:
        raise LabError(message)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_binary(path, artifact):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode), "artifact must be a regular non-symlink file")
    require(info.st_size == artifact["bytes"], "artifact size does not match lock")
    digest = sha256_file(path)
    require(digest == artifact["sha256"], "artifact SHA256 does not match lock")
    return digest


def validate_lock(lock):
    require(lock.get("schema_version") == 1, "unsupported lock schema")
    require(re.fullmatch(r"[0-9a-f]{40}", lock["source_commit"]), "invalid source pin")
    artifact = lock["artifact"]
    require(re.fullmatch(r"[0-9a-f]{64}", artifact["sha256"]), "invalid artifact pin")
    expected = (lock["repository"] + "/releases/download/" + lock["release"] +
                "/" + artifact["name"])
    require(artifact["url"] == expected, "artifact URL must match pinned repository and release")
    parsed = urlsplit(expected)
    require(parsed.scheme == "https" and parsed.hostname == "github.com" and
            not parsed.username and not parsed.password and not parsed.query and not parsed.fragment,
            "artifact source must be an uncredentialed GitHub HTTPS URL")
    require(artifact["os"] == "Linux" and artifact["architecture"] == "x86_64",
            "M1 supports only Linux x64")
    require(0 < artifact["bytes"] < 512 * 1024 * 1024, "invalid artifact size bound")


def preflight(port):
    require(platform.system() == "Linux" and platform.machine() == "x86_64",
            "M1 requires Linux x86_64")
    require(os.geteuid() != 0 and os.getuid() == os.geteuid(),
            "original runtime requires a real non-root account; no guard bypass is supported")
    home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    require(home.is_absolute() and home.is_dir(), "passwd home must be an existing absolute directory")
    require(home.resolve() == home, "passwd home must not resolve through a symlink")
    require(home.stat().st_uid == os.geteuid() and os.access(home, os.W_OK | os.X_OK),
            "passwd home must be writable and owned by the current account")
    scope = home / ".open-compute"
    require(not os.path.lexists(scope), "existing scope refused; use a fresh disposable account")
    require(1024 <= port <= 65535, "port must be between 1024 and 65535")
    require(not any(name.startswith("OPEN_COMPUTE_TEST_") for name in os.environ),
            "upstream test-only environment overrides are not supported")
    try:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    except OSError as exc:
        raise LabError("loopback port is unavailable") from exc
    require(proc_namespace_supported(), "the current PID namespace cannot be safely observed through /proc")
    return scope


def exclusive_file(path, contents, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "wb") as stream:
        stream.write(contents)


def validate_artifact_paths(scope, cache, output):
    """Keep reports/cache outside both the lexical and resolved runtime scope."""
    roots = {scope.absolute(), scope.resolve()}
    cache_path, output_path = cache.resolve(), output.resolve()
    for path, label in ((cache_path, "cache"), (output_path, "output")):
        require(not any(path.is_relative_to(root) for root in roots),
                label + " must not be inside the runtime scope")
    require(not os.path.lexists(output), "output directory already exists; a new directory is required")
    require(not cache_path.is_relative_to(output_path), "output directory cannot contain the runtime cache")
    return cache_path, output_path


def file_identity(path):
    info = path.lstat()
    require(not stat.S_ISLNK(info.st_mode), "owned state cannot be a symlink")
    return {"device": info.st_dev, "inode": info.st_ino}


@contextmanager
def defer_owner_signals():
    """Defer Python handlers only across M4 descriptor ownership transfers.

    pthread masking alone cannot protect this main thread when another thread
    receives the process signal. Restore every prior handler before replay.
    """
    require(threading.current_thread() is threading.main_thread(), "ownership")
    watched = (signal.SIGALRM, signal.SIGINT, signal.SIGTERM)
    previous, pending = {}, {}
    restoration_error = None
    def deferred(signum, frame):
        pending.setdefault(signum, frame)
    try:
        for signum in watched:
            previous[signum] = signal.getsignal(signum)
            signal.signal(signum, deferred)
        yield
    finally:
        for signum, handler in previous.items():
            try:
                signal.signal(signum, handler)
            except BaseException as exc:
                # A previously restored handler can run while the remaining
                # handlers are being restored. Finish restoring before raising.
                if restoration_error is None:
                    restoration_error = exc
        if restoration_error is not None:
            raise restoration_error
        for signum, frame in pending.items():
            handler = previous[signum]
            if callable(handler):
                handler(signum, frame)
            elif handler == signal.SIG_DFL:
                signal.raise_signal(signum)


class OwnedScope:
    def __init__(self, path, port, *, bounded_owner=False):
        self.path, self.port = path, port
        self.bounded_owner = bounded_owner
        self.marker = secrets.token_hex(32)
        self.identity = None

    def create(self):
        # mkdir is exclusive, including when the target is a dangling symlink.
        self.path.mkdir(mode=0o700)
        self.identity = file_identity(self.path)
        exclusive_file(self.path / MARKER, self.marker.encode())
        keys = self.path / "keys"
        keys.mkdir(mode=0o700)
        token = secrets.token_hex(32)
        exclusive_file(keys / "admin.token", (token + "\n").encode())
        manifest = ('instances = []\n\n[server]\n'
                    f'public_bind = "127.0.0.1:{self.port}"\n'
                    'admin_auth = { file = "./keys/admin.token" }\n')
        exclusive_file(self.path / "ocd.toml", manifest.encode())
        return token

    def check_owner(self):
        if self.bounded_owner:
            return self._check_owner_bounded()
        require(self.identity is not None, "scope was not created by this invocation")
        require(file_identity(self.path) == self.identity, "scope identity changed; cleanup refused")
        marker = self.path / MARKER
        require(stat.S_ISREG(marker.lstat().st_mode), "ownership marker changed; cleanup refused")
        require(marker.read_text() == self.marker, "ownership marker does not match; cleanup refused")
        require(self.path.stat().st_uid == os.geteuid(), "scope owner changed; cleanup refused")

    def _check_owner_bounded(self):
        # M4 only: no path-following or unbounded marker reads at ownership gates.
        root_fd = marker_fd = None
        try:
            require(self.identity is not None, "ownership")
            with defer_owner_signals():
                root_fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            root = os.fstat(root_fd)
            require({"device": root.st_dev, "inode": root.st_ino} == self.identity and
                    root.st_uid == os.geteuid() and stat.S_IMODE(root.st_mode) == 0o700, "ownership")
            before = os.stat(MARKER, dir_fd=root_fd, follow_symlinks=False)
            with defer_owner_signals():
                marker_fd = os.open(MARKER, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=root_fd)
            opened = os.fstat(marker_fd)
            def metadata(info):
                return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink,
                        info.st_size, info.st_mtime_ns, info.st_ctime_ns)
            require(stat.S_ISREG(opened.st_mode) and opened.st_uid == os.geteuid() and
                    opened.st_nlink == 1 and stat.S_IMODE(opened.st_mode) == 0o600 and
                    opened.st_size == 64 and metadata(before) == metadata(opened), "ownership")
            marker = os.read(marker_fd, 65)
            require(re.fullmatch(b"[0-9a-f]{64}", marker) is not None and
                    marker == self.marker.encode("ascii") and
                    metadata(opened) == metadata(os.fstat(marker_fd)) and
                    metadata(opened) == metadata(os.stat(MARKER, dir_fd=root_fd, follow_symlinks=False)), "ownership")
            require(file_identity(self.path) == self.identity, "ownership")
        except OSError:
            raise LabError("ownership") from None
        finally:
            with defer_owner_signals():
                try:
                    if marker_fd is not None:
                        os.close(marker_fd)
                finally:
                    if root_fd is not None:
                        os.close(root_fd)

    def remove(self, processes_stopped):
        require(processes_stopped, "live owned processes prevent scope removal")
        self.check_owner()
        require(shutil.rmtree.avoids_symlink_attacks, "safe directory cleanup is unavailable")
        shutil.rmtree(self.path)


class ArtifactRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlsplit(newurl)
        require(parsed.scheme == "https" and parsed.hostname in {
            "github.com", "release-assets.githubusercontent.com"
        }, "artifact redirect left the allowed HTTPS release origins")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


@contextmanager
def download_deadline():
    # M1 is a sequential Linux CLI. SIGALRM also interrupts urllib header reads
    # and DNS calls before an HTTP response/socket has been handed to the caller.
    require(threading.current_thread() is threading.main_thread(), "download requires the main thread")
    require(signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0), "an existing alarm prevents a bounded download")
    previous = signal.getsignal(signal.SIGALRM)
    def expired(_signum, _frame):
        raise LabError("artifact download total deadline exceeded")
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, DOWNLOAD_TOTAL_TIMEOUT)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


@contextmanager
def recovery_deadline():
    """One budget spans stop, local I/O, restored startup and read-only checks."""
    require(threading.current_thread() is threading.main_thread(), "recovery requires the main thread")
    require(signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0), "an existing alarm prevents bounded recovery")
    previous = signal.getsignal(signal.SIGALRM)
    deadline = time.monotonic() + RECOVERY_TOTAL_TIMEOUT
    def expired(_signum, _frame):
        raise LabError("cold recovery total deadline exceeded")
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, RECOVERY_TOTAL_TIMEOUT)
    try:
        yield deadline
        require(time.monotonic() < deadline, "cold recovery total deadline exceeded")
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def download_binary(cache, artifact, run_id):
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not cache.is_symlink() and cache.stat().st_uid == os.geteuid(), "cache must be owned")
    destination = cache / artifact["name"]
    if os.path.lexists(destination):
        verify_binary(destination, artifact)
        require(os.access(destination, os.X_OK), "cached artifact is not executable")
        return destination
    temporary = cache / (artifact["name"] + ".partial-" + run_id)
    created_identity = None
    total = 0
    try:
        request = urllib.request.Request(artifact["url"], headers={"User-Agent": "open-compute-lab/1"})
        with download_deadline():
            with urllib.request.build_opener(ArtifactRedirects()).open(request, timeout=30) as response:
                require(response.status == 200, "artifact download did not return HTTP 200")
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, "wb") as stream:
                    info = os.fstat(stream.fileno())
                    created_identity = {"device": info.st_dev, "inode": info.st_ino}
                    while True:
                        chunk = response.read(64 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        require(total <= artifact["bytes"], "artifact exceeds pinned size")
                        stream.write(chunk)
        verify_binary(temporary, artifact)
        temporary.chmod(0o700)
        os.link(temporary, destination)  # Do not overwrite an existing cache entry.
        return destination
    finally:
        if created_identity is not None and os.path.lexists(temporary):
            require(file_identity(temporary) == created_identity, "partial artifact identity changed; cleanup refused")
            temporary.unlink()


def proc_namespace_supported():
    try:
        return os.readlink("/proc/self") == str(os.getpid())
    except OSError:
        return False


def process_info(pid):
    try:
        with Path(f"/proc/{pid}/stat").open("rb", buffering=0) as stream:
            record = stream.read(4097)
    except (FileNotFoundError, ProcessLookupError):
        return None
    except OSError as exc:
        raise ProcessObservationError("process identity is unreadable") from exc
    try:
        require(len(record) <= 4096, "process identity record exceeds limit")
        require(int(record.split(b" ", 1)[0]) == int(pid), "process PID record mismatch")
        fields = record[record.rindex(b")") + 2:].split()
        info = {"pid": int(pid), "state": fields[0].decode("ascii"),
                "ppid": int(fields[1]), "pgid": int(fields[2]), "start_ticks": int(fields[19])}
        require(len(info["state"]) == 1 and info["pid"] > 0 and
                all(info[key] >= 0 for key in ("ppid", "pgid", "start_ticks")),
                "invalid process identity fields")
        return info
    except (LabError, ValueError, IndexError) as exc:
        raise ProcessObservationError("process identity record is malformed") from exc


def same_process(identity):
    current = process_info(identity["pid"])
    return current is not None and current["start_ticks"] == identity["start_ticks"] and current["state"] != "Z"


def public_process(identity, strict=False):
    value = {key: identity[key] for key in ("pid", "pgid", "start_ticks")}
    if strict:
        require(all(type(item) is int and item >= (0 if key == "start_ticks" else 1)
                    for key, item in value.items()), "identity")
    return value


class Process:
    """Own one process and observed descendants, including separate workerd groups."""

    def __init__(self, argv):
        require(proc_namespace_supported(), "the current PID namespace cannot be safely observed through /proc")
        self.process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, start_new_session=True)
        try:
            self.identity = process_info(self.process.pid)
            if self.identity is None:
                raise ProcessObservationError("cannot identify newly spawned process")
        except ProcessObservationError:
            # The unreaped direct Popen child cannot have its PID reused. Stop it,
            # but propagate unknown ownership so no scope deletion is claimed.
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)
            self.process.stdout.close()
            raise
        self.known = {(self.identity["pid"], self.identity["start_ticks"]): self.identity}
        self.tail = bytearray()
        self.lock = threading.Lock()
        self.scan_lock = threading.Lock()
        self.done = threading.Event()
        self.observation_error = None
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.monitor = threading.Thread(target=self._monitor, daemon=True)
        self.reader.start()
        self.monitor.start()

    def _read(self):
        try:
            while chunk := self.process.stdout.read1(4096):
                with self.lock:
                    self.tail.extend(chunk)
                    del self.tail[:-LOG_LIMIT]
        except Exception:
            self.observation_error = "process output read failed"

    def snapshot(self):
        # Serialize admissions, but never hold the copying/output lock across proc I/O.
        with self.scan_lock:
            try:
                self._snapshot()
            except (ProcessObservationError, OSError) as exc:
                with self.lock:
                    self.observation_error = str(exc)
                raise ProcessObservationError(str(exc)) from exc

    def _snapshot(self):
        with self.lock:
            if self.observation_error:
                raise ProcessObservationError(self.observation_error)
            known = dict(self.known)
        if len(known) > 1024:
            raise ProcessObservationError("process generation history exceeds limit")
        # Path.iterdir/listdir allocates the whole directory before yielding on
        # Python 3.11. scandir permits rejecting entry 8193 without that allocation.
        pids = []
        try:
            with os.scandir("/proc") as entries:
                for entry in entries:
                    if entry.name.isdecimal():
                        if len(pids) == 8192:
                            raise ProcessObservationError("process table exceeds limit")
                        pids.append(int(entry.name))
        except OSError as exc:
            raise ProcessObservationError("process table is unreadable") from exc
        table = {}
        for pid in pids:
            info = process_info(pid)
            if info is not None:
                table[pid] = info
        parents = {info["pid"]: info for key, info in known.items()
                   if info["pid"] in table and
                   table[info["pid"]]["start_ticks"] == info["start_ticks"] and
                   table[info["pid"]]["state"] != "Z"}
        while True:
            added = False
            for pid, candidate in table.items():
                key = (pid, candidate["start_ticks"])
                if key in known or candidate["ppid"] not in parents:
                    continue
                if len(known) == 1024:
                    raise ProcessObservationError("process generation history exceeds limit")
                parent = parents[candidate["ppid"]]
                # An earlier PPID alone does not grant ownership. Sandwich the
                # edge with fresh generation reads, including newly admitted
                # parents, so a reused parent cannot authorize a grandchild.
                for _ in range(2):
                    current_parent = process_info(parent["pid"])
                    current_child = process_info(pid)
                    if (current_parent is None or current_parent["state"] == "Z" or
                            current_parent["start_ticks"] != parent["start_ticks"] or
                            current_child is None or
                            any(current_child[field] != candidate[field]
                                for field in ("pid", "start_ticks", "ppid")) or
                            current_child["start_ticks"] < current_parent["start_ticks"]):
                        raise ProcessObservationError("process parent edge changed during observation")
                with self.lock:
                    self.known[key] = current_child
                known[key] = current_child
                if current_child["state"] != "Z":
                    parents[pid] = current_child
                added = True
            if not added:
                break

    def observed_identities(self):
        """Copy retained authorized generations for a read-only observer."""
        with self.lock:
            if self.observation_error:
                raise ProcessObservationError(self.observation_error)
            root = (self.identity["pid"], self.identity["start_ticks"])
            identities = [self.identity] + [item for key, item in self.known.items() if key != root]
            return [{"pid": item["pid"], "start_ticks": item["start_ticks"]} for item in identities]

    def _monitor(self):
        try:
            while not self.done.wait(0.05):
                self.snapshot()
        except Exception as exc:
            self.observation_error = str(exc)

    def text(self):
        with self.lock:
            return bytes(self.tail).decode(errors="replace")

    def live(self, strict=True):
        if strict and self.observation_error:
            raise ProcessObservationError(self.observation_error)
        with self.lock:
            identities = [identity.copy() for identity in self.known.values()]
        found = []
        for identity in identities:
            try:
                if same_process(identity):
                    found.append(identity)
            except ProcessObservationError as exc:
                self.observation_error = str(exc)
                if strict:
                    raise
                found.append(identity)  # Unknown is not evidence of exit.
        return found

    def children(self, refresh=True):
        if refresh:
            if self.observation_error:
                raise ProcessObservationError(self.observation_error)
            self.snapshot()
        with self.lock:
            root = (self.identity["pid"], self.identity["start_ticks"])
            return [public_process(item) for key, item in self.known.items() if key != root]

    def finish_threads(self):
        self.done.set()
        self.monitor.join(timeout=2)
        self.reader.join(timeout=2)
        if self.monitor.is_alive() or self.reader.is_alive():
            self.observation_error = "process observation/output drain did not finish"
        if not self.reader.is_alive():
            self.process.stdout.close()

    def stop(self, grace=30):
        try:
            self.snapshot()
        except (LabError, OSError) as exc:
            self.observation_error = str(exc)
        was_running = self.process.poll() is None
        if was_running:
            self.signal_owned(self.identity, signal.SIGTERM)
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline:
            self.process.poll()  # Reap our direct child, then check its former descendants.
            if not self.live(strict=False):
                break
            time.sleep(0.05)
        forced = bool(self.live(strict=False))
        if forced:
            # Each signal is gated by the originally observed PID + start time.
            for identity in self.live(strict=False):
                self.signal_owned(identity, signal.SIGKILL)
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            deadline = time.monotonic() + 5
            while self.live(strict=False) and time.monotonic() < deadline:
                time.sleep(0.05)
        self.finish_threads()
        return {"was_running": was_running, "signal": "SIGTERM", "forced": forced,
                "exit_code": self.process.poll(),
                "all_owned_exited": not self.live(strict=False) and not self.observation_error,
                "observation_error": self.observation_error,
                "children": self.children(refresh=False)}

    def signal_owned(self, identity, sig):
        try:
            if same_process(identity):
                os.kill(identity["pid"], sig)
        except ProcessLookupError:
            pass
        except (ProcessObservationError, OSError) as exc:
            self.observation_error = str(exc)


def command(argv, timeout=30):
    child = Process(argv)
    try:
        child.process.wait(timeout=timeout)
        child.finish_threads()
        require(child.process.returncode == 0, "CLI command failed: " + child.text()[-4096:])
        require(not child.live(), "CLI command left a live descendant")
        return child.text()
    except subprocess.TimeoutExpired as exc:
        raise LabError("CLI command deadline exceeded") from exc
    finally:
        if child.live(strict=False) or child.observation_error:
            stopped = child.stop(grace=2)
            if not stopped["all_owned_exited"]:
                raise ProcessObservationError("CLI process cleanup cannot be verified")
        else:
            child.finish_threads()


class LocalHTTP:
    def __init__(self, port, token=None):
        self.port, self.token = port, token

    def request(self, method, path, body=None, content_type="application/json", host=None, *, deadline=None, expected_status=None):
        if expected_status is not None:
            require(type(expected_status) is int and expected_status == 404 and method == "GET" and
                    body is None and self.token is None and host is not None and
                    re.fullmatch(r"/jobs/[a-z0-9][a-z0-9-]{0,63}", path) is not None,
                    "invalid expected missing-job response")
        require(path.startswith("/") and not path.startswith("//") and "\r" not in path and "\n" not in path,
                "invalid local request path")
        headers = {"Content-Type": content_type}
        if host is not None:
            headers["Host"] = host
        elif self.token:
            require(path.startswith("/client/v4/"), "credential is restricted to management API")
            headers["Authorization"] = "Bearer " + self.token
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body, separators=(",", ":")).encode()
        require(body is None or len(body) <= BODY_LIMIT, "request exceeds body bound")
        default_deadline = time.monotonic() + HTTP_TOTAL_TIMEOUT
        if getattr(self, "scenario_deadline", None) is not None:
            default_deadline = min(default_deadline, self.scenario_deadline)
        deadline = min(default_deadline, deadline) if deadline is not None else default_deadline
        remaining = deadline - time.monotonic()
        require(remaining > 0, "HTTP total deadline exceeded")
        expired = threading.Event()
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=min(10, remaining))
        timer = None
        try:
            # Numeric loopback connect is itself bounded. The watchdog then spans
            # request writes, slow response headers, and slow response bodies.
            connection.connect()
            stream_socket = connection.sock
            def expire():
                expired.set()
                try:
                    stream_socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                stream_socket.close()
            remaining = deadline - time.monotonic()
            require(remaining > 0, "HTTP total deadline exceeded")
            stream_socket.settimeout(min(10, remaining))
            timer = threading.Timer(remaining, expire)
            timer.daemon = True
            timer.start()
            connection.request(method, path, body, headers)
            response = connection.getresponse()
            raw = response.read(BODY_LIMIT + 1)
            require(not expired.is_set() and time.monotonic() < deadline, "HTTP total deadline exceeded")
            require(len(raw) <= BODY_LIMIT, "response exceeds body bound")
            require(not 300 <= response.status < 400, "management/Worker redirects are refused")
            require(response.status == expected_status if expected_status is not None else 200 <= response.status < 300,
                    f"HTTP {response.status} for {method} {path}: " + raw.decode(errors="replace")[:2048])
            value = json.loads(raw) if raw else None
            if expected_status is not None:
                require(isinstance(value, dict) and set(value) == {"job", "row_count"} and
                        value["job"] is None and type(value["row_count"]) is int and value["row_count"] == 0,
                        "invalid expected missing-job response")
            return value
        except (OSError, http.client.HTTPException) as exc:
            if expired.is_set() or time.monotonic() >= deadline:
                raise LabError("HTTP total deadline exceeded") from exc
            raise
        finally:
            if timer is not None:
                timer.cancel()
            connection.close()

    def v4(self, method, path, body=None, content_type="application/json"):
        envelope = self.request(method, "/client/v4" + path, body, content_type)
        require(isinstance(envelope, dict) and envelope.get("success") is True,
                "v4 request did not return success")
        return envelope.get("result")


class ReadOnlyHTTP(LocalHTTP):
    """The recovery comparison phase cannot repair missing resources."""
    def __init__(self, port, token=None):
        super().__init__(port, token)
        self.read_requests = 0

    def request(self, method, path, body=None, content_type="application/json", host=None):
        require(method == "GET" and body is None, "restored readback prohibits HTTP writes")
        self.read_requests += 1
        return super().request(method, path, body, content_type, host)


class CrashReadOnlyHTTP(LocalHTTP):
    """M5 recovery counts successful GETs and refuses writes before any I/O."""
    def __init__(self, port, token=None, *, counter=None):
        super().__init__(port, token)
        # The management and Worker clients share one scenario-wide bound.
        self._counter = [0] if counter is None else counter

    @property
    def read_requests(self):
        return self._counter[0]

    def request(self, method, path, body=None, content_type="application/json", host=None,
                *, deadline=None, expected_status=None):
        require(method == "GET" and body is None, "schema")
        require(self.read_requests < 256, "schema")
        value = super().request(method, path, body, content_type, host,
                                deadline=deadline, expected_status=expected_status)
        self._counter[0] += 1
        return value


def checkpoint_row(value, job_id, *, committed, completed=0):
    """Strict fixed fixture row, including JSON integer types (bool is refused)."""
    require(isinstance(value, dict) and set(value) == {"job", "row_count"} and
            type(value["row_count"]) is int and value["row_count"] == 1, "schema")
    row = value["job"]
    require(isinstance(row, dict) and
            set(row) == {"id", "payload", "callback_count", "step_nonce", "completed"} and
            row["id"] == job_id and row["payload"] == "synthetic-m1" and
            type(row["callback_count"]) is int and row["callback_count"] == int(committed) and
            type(row["completed"]) is int and row["completed"] == completed, "schema")
    require(isinstance(row["step_nonce"], str) and 0 < len(row["step_nonce"]) <= 256
            if committed else row["step_nonce"] is None, "schema")
    return json.dumps(row, sort_keys=True, allow_nan=False, separators=(",", ":"))


def crash_state_identity(value):
    require(isinstance(value, dict) and set(value) ==
            {"scope", "data", "control_db", "scheduler_db", "config_sha256"}, "schema")
    for key in ("scope", "data", "control_db", "scheduler_db"):
        item = value[key]
        require(isinstance(item, dict) and set(item) == {"device", "inode"} and
                all(type(number) is int and number >= 0 for number in item.values()), "schema")
    require(isinstance(value["config_sha256"], str) and
            re.fullmatch(r"[0-9a-f]{64}", value["config_sha256"]), "schema")
    return json.loads(json.dumps(value, allow_nan=False))


def worker_host(endpoint, port):
    require(endpoint.get("kind") == "local_origin" and endpoint.get("scope") == "local_machine",
            "Worker endpoint must be a local origin")
    parsed = urlsplit(endpoint["url"])
    require(parsed.scheme == "http" and parsed.port == port and parsed.path in ("", "/") and
            not parsed.username and not parsed.password and not parsed.query and not parsed.fragment,
            "Worker endpoint must use the configured local HTTP port")
    require(re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,240}[a-z0-9])?\.localhost", parsed.hostname or ""),
            "unexpected Worker routing hostname")
    return parsed.netloc


def multipart(database_id, with_r2=False):
    boundary = "oc-lab-" + secrets.token_hex(16)
    metadata = {
        "main_module": "index.js", "compatibility_date": "2026-09-08",
        "bindings": [{"type": "d1", "name": "DB", "id": database_id},
                     {"type": "workflow", "name": "FLOW", "workflow_name": FLOW,
                      "class_name": "LabFlow"}],
        "exports": {"LabFlow": {"type": "workflow", "name": FLOW}}
    }
    if with_r2:
        metadata["bindings"].append({"type": "r2_bucket", "name": "BUCKET", "bucket_name": BUCKET})
    source = (HERE / "fixtures/worker.js").read_bytes()
    require(len(source) < 32 * 1024, "fixture exceeds upload bound")
    parts = []
    for name, kind, payload in [("metadata", "application/json", json.dumps(metadata).encode()),
                                ("index.js", "application/javascript+module", source)]:
        parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
                      f'filename="{name}"\r\nContent-Type: {kind}\r\n\r\n').encode() + payload + b"\r\n")
    return b"".join(parts) + f"--{boundary}--\r\n".encode(), "multipart/form-data; boundary=" + boundary


def poll(probe, predicate, timeout, phase):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = probe()
        if predicate(value):
            return value
        time.sleep(0.25)
    raise LabError(phase + " deadline exceeded")


def wait_workflow(api, path, target, timeout=60):
    def probe():
        result = api.v4("GET", path)
        status = result.get("status")
        if status in {"errored", "terminated", "paused", "rollingBack", "waitingForPause"}:
            raise LabError("Workflow entered " + str(status) + ": " + json.dumps(result.get("error"))[:2048])
        if target == "waiting" and status == "complete":
            raise LabError("Workflow completed before its required event wait")
        return result
    return poll(probe, lambda value: value.get("status") == target, timeout, "Workflow " + target)


def assert_resume(before, retained, after, output, job_id):
    require(before["callback_count"] == 1 and isinstance(before["step_nonce"], str) and before["step_nonce"],
            "first committed callback must have counter=1 and a nonce")
    require(retained == before, "D1 row changed across restart before approval")
    require(after["id"] == job_id and after["callback_count"] == 1,
            "committed Workflow callback ran again or job identity changed")
    require(after["step_nonce"] == before["step_nonce"], "persisted callback nonce changed")
    require(after["completed"] == 1 and output == {"jobId": job_id, "nonce": before["step_nonce"]},
            "Workflow output/completion did not preserve the committed step result")


def deployment_observation(api, base, database_id, with_r2=True):
    """Read the immutable code/runtime/binding projection, without altering it."""
    path = base + "/workers/scripts/" + WORKER
    deployments = api.v4("GET", path + "/deployments")["deployments"]
    require(len(deployments) == 1, "expected one original Worker deployment")
    deployment = deployments[0]
    require(len(deployment["versions"]) == 1 and deployment["versions"][0]["percentage"] == 100,
            "expected one fully active Worker version")
    if not with_r2:
        require(isinstance(deployment["id"], str) and
                re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", deployment["id"]), "schema")
    version_id = deployment["versions"][0]["version_id"]
    require(isinstance(version_id, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", version_id),
            "invalid discovered Worker version")
    version = api.v4("GET", path + "/versions/" + version_id)
    require(version["id"] == version_id, "Worker version lookup changed identity")
    resources = version["resources"]
    bindings = sorted(resources["bindings"], key=lambda binding: binding["name"])
    expected = sorted([
        {"type": "d1", "name": "DB", "database_id": database_id},
        {"type": "workflow", "name": "FLOW", "workflow_name": FLOW, "class_name": "LabFlow"}
    ], key=lambda binding: binding["name"])
    if with_r2:
        expected = sorted(expected + [{"type": "r2_bucket", "name": "BUCKET", "bucket_name": BUCKET}],
                          key=lambda binding: binding["name"])
    require(bindings == expected, "deployed D1/R2/Workflow bindings disagree with fixture resources")
    etag = resources["script"]["etag"]
    require(isinstance(etag, str) and re.fullmatch(r"[0-9a-f]{64}", etag), "invalid Worker code digest")
    return {"deployment_id": deployment["id"], "version_id": version_id,
            "script_etag": etag, "runtime": resources["script_runtime"], "bindings": bindings}


def assert_r2(observation, payload, nonce):
    require(observation.get("key") == R2_KEY, "R2 object key changed")
    values = observation.get("bytes")
    require(isinstance(values, list) and all(type(value) is int and 0 <= value <= 255 for value in values),
            "R2 body is not a byte array")
    require(bytes(values) == payload and observation.get("size") == len(payload), "R2 bytes or size changed")
    require(observation.get("httpMetadata") == R2_HTTP_METADATA, "R2 HTTP metadata changed")
    require(observation.get("customMetadata") == {"purpose": "cold-restore", "nonce": nonce},
            "R2 custom metadata changed")
    require(observation.get("headers") == {"content-type": R2_HTTP_METADATA["contentType"],
            "cache-control": R2_HTTP_METADATA["cacheControl"],
            "content-disposition": R2_HTTP_METADATA["contentDisposition"]}, "R2 metadata header projection changed")
    for field in ("etag", "httpEtag", "version", "uploaded"):
        require(isinstance(observation.get(field), str) and 0 < len(observation[field]) <= 200,
                "R2 persisted identity is missing or unbounded")
    require(observation["httpEtag"] == '"' + observation["etag"] + '"', "R2 HTTP etag disagrees")


def public_backup_summary(summary):
    """Do not let private inventory or helper diagnostics enter evidence."""
    allowed = {"source_root", "staging_root", "restored_root", "locks_acquired", "archive_verified",
               "source_verified", "source_absent", "data_absent", "restored_verified", "entry_count",
               "file_count", "total_bytes", "inventory_sha256", "private_removed", "staging_removed"}
    require(isinstance(summary, dict) and not set(summary) - allowed, "backup evidence contains an unexpected field")
    for key, value in summary.items():
        if key.endswith("_root"):
            require(isinstance(value, dict) and set(value) == {"device", "inode"} and
                    all(type(item) is int and item >= 0 for item in value.values()), "invalid root identity evidence")
        elif key == "inventory_sha256":
            require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value), "invalid inventory digest evidence")
        elif key in {"entry_count", "file_count", "total_bytes"}:
            require(type(value) is int and value >= 0, "invalid inventory count evidence")
        else:
            require(type(value) is bool, "invalid backup gate evidence")
    return summary


def cleanup_scope(scope, restore, original_identity=None, restored_identity=None, resources=False, storage=False, crash=False):
    """Only recover() can remove the original M2 source, never final cleanup."""
    if scope is None or scope.identity is None:
        return {}
    if restore and (restored_identity is None or scope.identity != restored_identity):
        scope.check_owner()
        return {"source_preserved": scope.identity == original_identity,
                "scope_preserved": True, "scope_removed": False}
    require(not restore or restored_identity != original_identity, "original source cannot be removed by final cleanup")
    if restore:
        from cold_backup import CLEANUP_SECONDS, absent, cleanup_deadline
        # This 30-second final cleanup is separate from the original Workflow
        # recovery budget. Private package cleanup follows with its own timer.
        deadline = time.monotonic() + CLEANUP_SECONDS
        with cleanup_deadline():
            scope.remove(processes_stopped=True)
            require(absent(scope.path), "restored scope cleanup did not finish")
            require(time.monotonic() < deadline, "restored scope cleanup deadline exceeded")
    elif resources or storage or crash:
        with m3_deadline(30, "M5 scope cleanup" if crash else "M4 scope cleanup" if storage else "M3 scope cleanup"):
            scope.remove(processes_stopped=True)
            require(not os.path.lexists(scope.path), "owned scope cleanup did not finish")
    else:
        scope.remove(processes_stopped=True)
    return {"scope_removed": True}


class Redactor:
    def __init__(self):
        self.secrets = []

    def clean(self, text):
        for secret in sorted(self.secrets, key=len, reverse=True):
            if secret:
                text = text.replace(secret, "[redacted]")
        lines = []
        for line in text.splitlines():
            if re.search(r"authorization|bearer |(?:token|secret|master.key|private.key)\s*[:=]", line, re.I):
                lines.append("[sensitive diagnostic line removed]")
            else:
                # Runtime output is untrusted. Strip path and credential-shaped
                # strings in diagnostics; structured release hashes are separate.
                line = re.sub(r"/(?:home|root|workspace|tmp|var)/[^\s\"']+", "[local-path]", line)
                line = re.sub(r"[A-Za-z0-9_+/=-]{40,}", "[long-value]", line)
                lines.append(line)
        return "\n".join(lines)[-4096:]

    def check_report(self, report):
        encoded = json.dumps(report, indent=2, sort_keys=True)
        require(not any(secret and secret in encoded for secret in self.secrets), "report failed secret scan")
        require(len(encoded.encode()) < 128 * 1024, "report exceeds evidence bound")
        return encoded + "\n"


def state_identity(scope, data, config):
    return {"scope": file_identity(scope), "data": file_identity(data),
            "control_db": file_identity(data / "control.sqlite"),
            "scheduler_db": file_identity(data / "scheduler.sqlite"),
            "config_sha256": sha256_file(config)}


def source_commit():
    try:
        value = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=HERE,
                                        stderr=subprocess.DEVNULL, timeout=5).decode().strip()
        return value if re.fullmatch(r"[0-9a-f]{40}", value) else None
    except (OSError, subprocess.SubprocessError):
        return None


@contextmanager
def m3_deadline(seconds, phase):
    """Nest finite main-thread budgets without pausing an existing alarm."""
    require(threading.current_thread() is threading.main_thread(), "M3 requires the main thread")
    require(seconds > 0, "M3 deadline must be positive")
    previous = signal.getsignal(signal.SIGALRM)
    started = time.monotonic()
    remaining, interval = signal.getitimer(signal.ITIMER_REAL)
    previous_end = started + remaining if remaining > 0 else None
    own_end = started + seconds
    deadline = min(own_end, previous_end) if previous_end is not None else own_end
    previous_fired = False
    def expired(signum, frame):
        nonlocal previous_fired
        if previous_end is not None and previous_end <= own_end and callable(previous):
            previous_fired = True
            previous(signum, frame)
        raise LabError(phase + " total deadline exceeded")
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, max(.000001, deadline - time.monotonic()))
    try:
        yield deadline
        require(time.monotonic() < deadline, phase + " total deadline exceeded")
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        if previous_end is not None:
            remaining = previous_end - time.monotonic()
            if remaining <= 0 and previous_fired:
                # The inherited one-shot was already delivered by our handler.
                # Re-arming it would deliver twice and interrupt outer restoration.
                if interval > 0:
                    signal.setitimer(signal.ITIMER_REAL, interval - (-remaining % interval), interval)
            else:
                signal.setitimer(signal.ITIMER_REAL, max(.000001, remaining), interval)


def integration(args, restore=False, resources=False, storage=False, crash=False):
    require(sum((restore, resources, storage, crash)) <= 1, "M3 resources and M2 restore are separate scenarios")
    if resources:
        import resources as resource_tools
    if storage:
        import storage as storage_tools
    if crash:
        import crash as crash_tools
    run_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + secrets.token_hex(4)
    command_name = "make integration-crash" if crash else "make integration-storage" if storage else ("make integration-resources" if resources else ("make integration-restore" if restore else "make integration"))
    report = {"schema_version": 1, "run_id": run_id, "command": command_name,
              "harness_commit": source_commit(), "result": "failed", "phase": "preflight",
              "environment": {"os": platform.system(), "architecture": platform.machine(),
                              "euid": os.geteuid(), "python": platform.python_version()},
              "acceptance": ({f"M2-{n:02}": "not_run" for n in range(1, 10)} if restore else
                             {f"AC-{n:02}": "not_run" for n in range(1, 9)})}
    functional_acceptance = report["acceptance"]
    phases = {}
    snapshots = {}
    workload = storage_tools.initial_workload() if storage else None
    graceful_stops = set()
    intentional_crash = None
    read_counter = [0]
    scenario_deadline = None
    scenario_budget = ExitStack()
    if resources:
        report["functional_acceptance"] = functional_acceptance
        report["acceptance"] = {f"M3-{n:02}": "not_run" for n in range(1, 6)}
        report["scenario"] = "observed-process-tree-resources"

    if storage:
        report["functional_acceptance"] = functional_acceptance
        report["acceptance"] = {f"M4-{n:02}": "not_run" for n in range(1, 6)}
        report["scenario"] = "cold-storage-footprint"

    if crash:
        # Historical graceful restart AC-06 has no meaning in this experiment.
        functional_acceptance.pop("AC-06")
        report["functional_acceptance"] = functional_acceptance
        report["acceptance"] = {f"M5-{n:02}": "not_run" for n in range(1, 6)}
        report["scenario"] = "checkpoint-sigkill"
        report["crash"] = crash_tools.initial_crash()
        report["readback"] = crash_tools.initial_readback()

    def crash_error(exc):
        if isinstance(exc, crash_tools.CrashError):
            return exc.reason
        text = str(exc)
        if isinstance(exc, ProcessObservationError):
            return "observer"
        return "deadline" if "deadline" in text else (text if text in
                {"ownership", "identity", "signal", "survivor", "observer", "schema"} else "schema")

    def scenario_error(exc):
        return crash_error(exc) if crash else (storage_error(exc) if storage else redactor.clean(str(exc)))

    def project_crash_observations():
        if not crash:
            return
        # Validate independently: corrupting one extension cannot erase the
        # other extension's observed facts or break bounded stdout reporting.
        for name, projector, initial, gate in (
                ("crash", crash_tools.project_crash, crash_tools.initial_crash, "M5-02"),
                ("readback", crash_tools.project_readback, crash_tools.initial_readback, "M5-03")):
            try:
                value = report[name]
                projected = (projector(value, complete=report["acceptance"]["M5-03"] == "passed")
                             if name == "readback" else projector(value))
                if name == "crash" and projected["status"] == "verified":
                    require({key: projected["targets"][0][key] for key in ("pid", "pgid", "start_ticks")} ==
                            report.get("daemon_before"), "identity")
                report[name] = projected
            except Exception:
                report[name] = initial()
                report["result"] = "failed"
                report["error"] = "schema"
                report["evidence_file_written"] = False
                report["acceptance"][gate] = "not_run"
                report["acceptance"]["M5-05"] = "not_run"

    def storage_error(exc):
        if isinstance(exc, storage_tools.StorageError):
            return exc.reason
        text = str(exc)
        return "deadline" if "deadline" in text else ("ownership" if text == "ownership" else "schema")

    def project_storage_observations():
        if not storage:
            return
        report.pop("storage", None)
        report.pop("storage_partial", None)
        if report["result"] == "passed":
            value = storage_tools.storage_extension(snapshots, workload)
            report["storage"] = storage_tools.project_storage(value)
        else:
            report["storage_partial"] = storage_tools.partial_extension(snapshots, workload)

    def cold_checkpoint(name):
        report["phase"] = name
        stopped = daemon.stop()
        report.setdefault("storage_shutdowns", {})[name] = stopped
        require(stopped["was_running"] and not stopped["forced"] and stopped["all_owned_exited"] and
                stopped["exit_code"] == 0 and not daemon.observation_error and not daemon.live(),
                "ownership")
        graceful_stops.add(id(daemon))
        if name == "cold_after_completion":
            report["final_shutdown"] = stopped
        with m3_deadline(10, "M4 snapshot"):
            scope.check_owner()
            deadline = min(time.monotonic() + 10, scenario_deadline)
            value = storage_tools.cold_snapshot(scope, name, deadline=deadline)
            value = storage_tools.project_snapshot(value)
            require(value["phase"] == name, "schema")
            scope.check_owner()
            snapshots[name] = value

    def validate_batch(value, job_id):
        expected = {"id": job_id, "payload": "x" * 128, "callback_count": 0,
                    "step_nonce": None, "completed": 0}
        require(isinstance(value, dict) and set(value) == {"job", "row_count"} and
                type(value["row_count"]) is int and value["row_count"] == 1 and
                isinstance(value["job"], dict) and set(value["job"]) == set(expected) and
                type(value["job"]["callback_count"]) is int and type(value["job"]["completed"]) is int and
                value["job"] == expected, "schema")
        return json.dumps(value, sort_keys=True, allow_nan=False, separators=(",", ":"))

    def project_observations():
        if not resources:
            return
        projected = {}
        for name, value in phases.items():
            require(name in resource_tools.PHASE_NAMES, "invalid resource phase")
            value = resource_tools.project_phase(value)
            require(value["phase"] == name, "resource phase identity changed")
            projected[name] = value
        require(len(json.dumps(projected, indent=2, sort_keys=True, allow_nan=False).encode()) <= resource_tools.EXTENSION_LIMIT,
                "resource partial evidence exceeds bound")
        if set(projected) == set(resource_tools.PHASE_NAMES):
            report["resources"] = resource_tools.resources_extension(projected)
            report.pop("resource_phases", None)
        elif projected:
            report["resource_phases"] = projected

    def observe(name):
        report["phase"] = name
        read = name.endswith("read_probe")
        index = 0
        def probe(deadline):
            nonlocal index
            if index % 2 == 0:
                observed = worker.request("GET", "/health", host=host, deadline=deadline)
                require(observed == {"fixture": "open-compute-m1", "ok": True} and observed["ok"] is True,
                        "resource health probe changed")
            else:
                observed = worker.request("GET", "/jobs/" + job_id, host=host, deadline=deadline)
                require(type(observed["row_count"]) is int and observed["row_count"] == 1 and
                        json.dumps(observed["job"], sort_keys=True, allow_nan=False) == json.dumps(before, sort_keys=True, allow_nan=False),
                        "resource job probe changed the original D1 row")
            index += 1
        try:
            value = resource_tools.observe_phase(name, daemon.observed_identities,
                                                duration_seconds=4 if read else 3,
                                                probe=probe if read else None, probe_count=8 if read else 0)
            value = resource_tools.project_phase(value)
            require(value["phase"] == name and value["status"] == "observed" and index == (8 if read else 0),
                    "required resource window was not observed")
            phases[name] = value
        except resource_tools.ResourceError as exc:
            if exc.partial_summary is not None:
                value = resource_tools.project_phase(exc.partial_summary)
                require(value["phase"] == name, "resource partial phase identity changed")
                phases[name] = value
            raise
        finally:
            project_observations()
    if restore:
        report.update({"scenario": "same-path-cold-restore", "cold_restore": {},
                       "limitations": {"same_runner": True, "same_path": True, "same_uid": True,
                                       "fresh_machine_tested": False, "version_migration_tested": False}})
    redactor = Redactor()
    scope = None
    daemon = None
    daemons = []
    cleanup_unknown = False
    cold_restore = None
    original_scope_identity = restored_scope_identity = None
    output = Path(args.output) if args.output else HERE / ".lab-runs" / run_id
    cache = Path(args.cache)
    output_allowed = False
    scope_hint = None
    old_handlers = {}
    def interrupted(signum, _frame):
        raise LabError("harness interrupted by signal " + str(signum))
    for sig in (signal.SIGINT, signal.SIGTERM):
        old_handlers[sig] = signal.signal(sig, interrupted)
    try:
        scope_hint = Path(pwd.getpwuid(os.getuid()).pw_dir) / ".open-compute"
        cache, output = validate_artifact_paths(scope_hint, cache, output)
        output_allowed = True
        scope_path = preflight(args.port)
        if not restore:
            functional_acceptance["AC-02"] = "passed"
        report["phase"] = "artifact"
        lock = json.loads((HERE / "upstream.lock.json").read_text())
        validate_lock(lock)
        report["upstream"] = lock
        binary = download_binary(cache, lock["artifact"], run_id)
        version = command([str(binary), "--version"]).strip()
        require(version == "ocd " + lock["release"].removeprefix("v"), "runtime --version disagrees with lock")
        report["runtime"] = {"version_text": version, "artifact_sha256": sha256_file(binary)}
        functional_acceptance["M2-01" if restore else "AC-01"] = "passed"
        scope = OwnedScope(scope_path, args.port, bounded_owner=True) if storage or crash else OwnedScope(scope_path, args.port)
        redactor.secrets.append(scope.create())
        original_scope_identity = dict(scope.identity)
        config = scope_path / "instances" / INSTANCE / "compute.toml"
        data = config.parent / "data"

        def cli(*arguments, timeout=30):
            return command([str(binary), "--no-update-check", *arguments], timeout)

        def start():
            process = Process([str(binary), "--no-update-check", "run"])
            daemons.append(process)
            unauthenticated = LocalHTTP(args.port)
            if storage or crash:
                unauthenticated.scenario_deadline = scenario_deadline
            def ready():
                require(process.process.poll() is None, "daemon exited during startup: " + process.text())
                if not (scope_path / "run/control.sock").is_socket():
                    return False
                try:
                    unauthenticated.request("GET", "/health/live")
                    return True
                except (OSError, http.client.HTTPException):
                    return False
            poll(ready, bool, 60, "daemon bootstrap")
            return process

        def running_instance():
            records = json.loads(cli("instances", "--json"))["instances"]
            require(len(records) == 1 and records[0]["name"] == INSTANCE and records[0]["state"] == "running",
                    "expected exactly one running lab instance")
            return records[0]["instance_id"]

        report["phase"] = "bootstrap"
        if resources or storage or crash:
            scenario_deadline = time.monotonic() + 300
            scenario_budget.enter_context(m3_deadline(300, "M5 scenario" if crash else "M4 scenario" if storage else "M3 scenario"))
        daemon = start()
        cli("--config", str(config), "instance", "setup", "--name", INSTANCE,
            "--data-dir", str(data), "--yes", timeout=90)
        instance_id = running_instance()
        for name in ("deployer.token", "read-only.token", "master.key"):
            secret_file = data / "keys" / name
            require(stat.S_ISREG(secret_file.lstat().st_mode) and secret_file.stat().st_mode & 0o077 == 0,
                    "generated secret must be owner-only")
            secret_bytes = secret_file.read_bytes()
            require(len(secret_bytes) <= 4096, "secret file exceeds bound")
            redactor.secrets.extend([secret_bytes.hex(), secret_bytes.decode(errors="replace").strip()])
        token = (data / "keys/deployer.token").read_text().strip()
        api = LocalHTTP(args.port, token)
        if storage or crash:
            api.scenario_deadline = scenario_deadline
        accounts = api.v4("GET", "/accounts")
        require(len(accounts) == 1, "expected exactly one API account")
        account = accounts[0]["id"]
        require(re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", account), "invalid discovered account id")
        base = "/accounts/" + account
        report["instance"] = {"instance_id": instance_id, "account_id": account, "name": INSTANCE}
        report["phase"] = "deployment"
        database = api.v4("POST", base + "/d1/database", {"name": "lab-db"})
        database_id = database["uuid"]
        require(re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", database_id), "invalid database id")
        api.v4("POST", base + "/d1/database/" + database_id + "/query", {
            "sql": "CREATE TABLE jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, callback_count INTEGER NOT NULL DEFAULT 0, step_nonce TEXT, completed INTEGER NOT NULL DEFAULT 0)",
            "params": []})
        if restore:
            bucket = api.v4("POST", base + "/r2/buckets", {"name": BUCKET})
            require(bucket["name"] == BUCKET and bucket["jurisdiction"] == "default" and
                    bucket["storage_class"] == "Standard", "unexpected R2 bucket configuration")
        upload, content_type = multipart(database_id, with_r2=restore)
        api.v4("PUT", base + "/workers/scripts/" + WORKER, upload, content_type)
        endpoints = api.v4("GET", base + "/open-compute/workers/" + WORKER + "/endpoints")
        local_endpoints = [endpoint for endpoint in endpoints if endpoint.get("kind") == "local_origin"]
        require(len(local_endpoints) == 1, "expected one local Worker endpoint")
        host = worker_host(local_endpoints[0], args.port)
        worker = LocalHTTP(args.port)
        if storage or crash:
            worker.scenario_deadline = scenario_deadline
        health = worker.request("GET", "/health", host=host)
        require(health == {"fixture": "open-compute-m1", "ok": True}, "deployed Worker did not answer")
        job_id = "job-" + run_id.lower()
        submission = {"id": job_id, "payload": "synthetic-m1"}
        first = worker.request("POST", "/jobs", submission, host=host)
        second = worker.request("POST", "/jobs", submission, host=host)
        require(first == second and second["row_count"] == 1 and second["job"]["id"] == job_id,
                "duplicate submission did not retain one identical logical row")
        if not restore:
            functional_acceptance.update({"AC-03": "passed", "AC-04": "passed"})
        if storage:
            require(type(second["row_count"]) is int and second["row_count"] == 1, "schema")
        if crash:
            require(checkpoint_row(first, job_id, committed=False) ==
                    checkpoint_row(second, job_id, committed=False), "schema")
            deployment_before = deployment_observation(api, base, database_id, with_r2=False)
        report["duplicate_submission"] = {"requests": 2, "row_count": second["row_count"]}
        if restore:
            r2_payload = bytes([0, 255, 13, 10]) + secrets.token_bytes(60)
            r2_nonce = secrets.token_hex(16)
            worker.request("PUT", "/r2/sentinel", {"bytes": list(r2_payload), "nonce": r2_nonce}, host=host)
            r2_before = worker.request("GET", "/r2/sentinel", host=host)
            assert_r2(r2_before, r2_payload, r2_nonce)
            deployment_before = deployment_observation(api, base, database_id)
            report["r2"] = {"key": R2_KEY, "size": len(r2_payload),
                            "content_sha256": hashlib.sha256(r2_payload).hexdigest()}
        report["phase"] = "durable_wait"
        workflow_id = "flow-" + run_id.lower()
        workflow_path = base + "/workflows/" + FLOW + "/instances/" + workflow_id
        workflow_deadline = time.monotonic() + 300
        if crash:
            api.scenario_deadline = worker.scenario_deadline = min(scenario_deadline, workflow_deadline)
        creation = api.v4("POST", base + "/workflows/" + FLOW + "/instances",
                          {"instance_id": workflow_id, "params": {"jobId": job_id}})
        require(creation["id"] == workflow_id, "Workflow identity changed during creation")
        waiting = wait_workflow(api, workflow_path, "waiting")
        before_observation = worker.request("GET", "/jobs/" + job_id, host=host)
        if storage:
            require(type(before_observation["row_count"]) is int and before_observation["row_count"] == 1, "schema")
        if crash:
            checkpoint_row(before_observation, job_id, committed=True)
            require(waiting["status"] == "waiting", "schema")
        before = before_observation["job"]
        require(before["callback_count"] == 1 and isinstance(before["step_nonce"], str) and before["step_nonce"],
                "waiting Workflow has no single committed callback")
        require(any(step.get("name") == "instrumented-callback" and step.get("success") is True
                    for step in waiting.get("steps", [])), "first step was not publicly committed")
        functional_acceptance["M2-02" if restore else "AC-05"] = "passed"
        report["workflow"] = {"id": workflow_id, "before_status": waiting["status"],
                              "before_callback_count": before["callback_count"],
                              "before_nonce_sha256": hashlib.sha256(before["step_nonce"].encode()).hexdigest()}
        if storage:
            require(type(before["callback_count"]) is int and before["callback_count"] == 1 and
                    type(before["completed"]) is int and before["completed"] == 0, "schema")
        state_before = state_identity(scope_path, data, config)
        if crash:
            state_before = crash_state_identity(state_before)
        daemon.children()  # Refresh the descendant graph before proving liveness.
        live_children = [public_process(child, strict=crash) for child in daemon.live() if child["pid"] != daemon.process.pid]
        require(live_children, "no live supervised runtime child was observed")
        report["live_children_before_restart"] = live_children
        if resources:
            report["acceptance"]["M3-01"] = "passed"
            observe("source_idle")
            observe("source_read_probe")
        if storage:
            report["acceptance"]["M4-01"] = "passed"
        if crash:
            require(not daemon.observation_error, "observer")
            report["acceptance"]["M5-01"] = "passed"
        report["phase"] = "checkpoint_crash" if crash else "cold_shutdown" if restore else "daemon_restart"
        with recovery_deadline() if restore else nullcontext(None) as deadline:
            report["daemon_before"] = public_process(daemon.identity, strict=crash)
            if crash:
                try:
                    with m3_deadline(min(10, scenario_deadline - time.monotonic()), "M5 crash") as crash_deadline:
                        receipt = crash_tools.abrupt_shutdown(daemon, deadline=crash_deadline, read_identity=process_info)
                        report["crash"] = receipt
                        receipt = crash_tools.project_crash(receipt)
                        require(receipt["status"] == "verified" and receipt["targets"] and
                                {key: receipt["targets"][0][key] for key in ("pid", "pgid", "start_ticks")} ==
                                report["daemon_before"], "identity")
                        require(time.monotonic() < crash_deadline, "deadline")
                    report["crash"] = receipt
                    intentional_crash = daemon
                    report["acceptance"]["M5-02"] = "passed"
                except crash_tools.CrashError as exc:
                    report["crash"] = exc.receipt
                    raise
            elif storage:
                cold_checkpoint("cold_baseline")
                stopped = report["storage_shutdowns"]["cold_baseline"]
            else:
                stopped = daemon.stop()
            if not crash:
                report["first_shutdown"] = stopped
                require(stopped["was_running"] and not stopped["forced"] and stopped["all_owned_exited"] and
                        stopped["exit_code"] == 0, "original daemon did not exit gracefully with all owned children")
            scope.check_owner()
            if restore:
                from cold_backup import ColdRestore
                def progress(event, summary):
                    nonlocal restored_scope_identity
                    gates = {"locked": "M2-03", "backup_verified": "M2-04",
                             "source_removed": "M2-05", "restored": "M2-06"}
                    require(event in gates, "unknown cold restore progress event")
                    report["cold_restore"].update(public_backup_summary(summary))
                    if event == "backup_verified":
                        require(summary.get("archive_verified") is True and summary.get("source_verified") is True,
                                "source deletion requires verified backup and source comparison")
                    if event == "restored":
                        restored_root = summary.get("restored_root")
                        require(summary.get("restored_verified") is True and restored_root == scope.identity and
                                restored_root != original_scope_identity, "restored ownership transfer is unverified")
                        restored_scope_identity = dict(restored_root)
                    functional_acceptance[gates[event]] = "passed"
                    report["phase"] = "cold_" + event
                cold_restore = ColdRestore(scope, cache, output, deadline, progress)
                report["cold_restore"].update(public_backup_summary(cold_restore.recover()))
                require(all(functional_acceptance["M2-" + str(number).zfill(2)] == "passed"
                            for number in range(3, 7)), "cold restore gates incomplete; runtime spawn refused")
                require(report["cold_restore"].get("source_absent") is True and
                        report["cold_restore"].get("data_absent") is True and
                        report["cold_restore"].get("restored_verified") is True,
                        "cold restore lacks deletion or pre-spawn verification")
                report["phase"] = "restored_startup"
            if crash:
                require(intentional_crash is daemon and report["acceptance"]["M5-02"] == "passed", "ownership")
            daemon = start()
            poll(lambda: json.loads(cli("instances", "--json"))["instances"],
                 lambda rows: len(rows) == 1 and rows[0]["state"] == "running", 60, "instance restart")
            require(running_instance() == instance_id, "instance identity changed across daemon restart")
            report["daemon_after"] = public_process(daemon.identity, strict=crash)
            require(report["daemon_after"] != report["daemon_before"], "daemon process identity did not change")
            if crash:
                report["phase"] = "crash_readback"
                api = CrashReadOnlyHTTP(args.port, token, counter=read_counter)
                worker = CrashReadOnlyHTTP(args.port, counter=read_counter)
                api.scenario_deadline = worker.scenario_deadline = min(scenario_deadline, workflow_deadline)
                report["readback"]["read_only_http_enforced"] = True
                crash_health = worker.request("GET", "/health", host=host)
                require(crash_health == {"fixture": "open-compute-m1", "ok": True} and
                        crash_health["ok"] is True, "schema")
                require(api.v4("GET", "/accounts") == accounts, "identity")
                deployment_after = deployment_observation(api, base, database_id, with_r2=False)
                require(deployment_after == deployment_before, "identity")
                report["readback"]["instance_account_database_unchanged"] = True
                state_after = crash_state_identity(state_identity(scope_path, data, config))
                require(state_before == state_after, "identity")
                report["state_identity"] = {"before": state_before, "after": state_after, "same": True}
                report["readback"]["state_identity_unchanged"] = True
                report["deployment"] = {"deployment_id": deployment_before["deployment_id"],
                                        "version_id": deployment_before["version_id"],
                                        "script_etag": deployment_before["script_etag"],
                                        "code_runtime_bindings_unchanged": True}
            elif restore:
                # Read credentials from the restored files. Old observed state
                # is used only for assertions, never to reconstruct authority.
                restored_token = (data / "keys/deployer.token").read_text().strip()
                api = ReadOnlyHTTP(args.port, restored_token)
                worker = ReadOnlyHTTP(args.port)
                restored_accounts = api.v4("GET", "/accounts")
                require(len(restored_accounts) == 1 and restored_accounts[0]["id"] == account,
                        "account identity changed across cold restore")
                report["phase"] = "restored_readback"
                deployment_after = deployment_observation(api, base, database_id)
                require(deployment_after == deployment_before, "deployment, code or bindings changed across restore")
                r2_after = worker.request("GET", "/r2/sentinel", host=host)
                assert_r2(r2_after, r2_payload, r2_nonce)
                require(r2_after == r2_before, "R2 object identity or metadata changed across restore")
                report["deployment"] = {"deployment_id": deployment_before["deployment_id"],
                                        "version_id": deployment_before["version_id"],
                                        "script_etag": deployment_before["script_etag"],
                                        "code_runtime_bindings_unchanged": True}
                report["r2"].update({"bytes_unchanged": True, "metadata_unchanged": True,
                                      "etag_version_uploaded_unchanged": True})
            elif not crash:
                state_after = state_identity(scope_path, data, config)
                require(state_before == state_after, "scope/data/database/config identity changed across restart")
                report["state_identity"] = {"before": state_before, "after": state_after, "same": True}
                functional_acceptance["AC-06"] = "passed"
                if storage:
                    require(api.v4("GET", "/accounts") == accounts, "schema")
            retained_observation = worker.request("GET", "/jobs/" + job_id, host=host)
            if crash:
                require(checkpoint_row(retained_observation, job_id, committed=True) ==
                        checkpoint_row(before_observation, job_id, committed=True), "schema")
                report["readback"]["d1_row_unchanged"] = True
            retained = retained_observation["job"]
            require(retained == before, "D1 state did not survive daemon restart")
            if storage:
                require(json.dumps(retained, sort_keys=True, allow_nan=False) ==
                        json.dumps(before, sort_keys=True, allow_nan=False), "schema")
            retained_workflow = wait_workflow(api, workflow_path, "waiting")
            if crash:
                require(retained_workflow["status"] == "waiting", "schema")
                report["readback"]["original_workflow_waiting"] = True
                report["readback"]["read_requests"] = read_counter[0]
                report["readback"] = crash_tools.project_readback(report["readback"], complete=True)
                report["acceptance"]["M5-03"] = "passed"
            if restore:
                report["readback"] = {"instance_account_database_unchanged": True, "d1_row_unchanged": True,
                                      "original_workflow_waiting": True, "read_only_http_enforced": True,
                                      "read_requests": api.read_requests + worker.read_requests}
                functional_acceptance["M2-07"] = "passed"
        if storage:
            batch = {}
            for index in range(16):
                fixed_id = f"disk-{index:02}"
                workload["absence_checks_attempted"] += 1
                missing = worker.request("GET", "/jobs/" + fixed_id, host=host,
                                         deadline=scenario_deadline, expected_status=404)
                require(isinstance(missing, dict) and set(missing) == {"job", "row_count"} and
                        missing["job"] is None and type(missing["row_count"]) is int and missing["row_count"] == 0, "schema")
                workload["absence_checks_completed"] += 1
                submitted = []
                for _ in range(2):
                    workload["submission_attempted"] += 1
                    value = worker.request("POST", "/jobs", {"id": fixed_id, "payload": "x" * 128},
                                           host=host, deadline=scenario_deadline)
                    submitted.append(validate_batch(value, fixed_id))
                    workload["submission_completed"] += 1
                require(submitted[0] == submitted[1], "schema")
                batch[fixed_id] = submitted[0]
            cold_checkpoint("cold_after_writes")
            report["daemon_second"] = public_process(daemon.identity)
            daemon = start()
            poll(lambda: json.loads(cli("instances", "--json"))["instances"],
                 lambda rows: len(rows) == 1 and rows[0]["state"] == "running", 60, "instance restart")
            require(running_instance() == instance_id and state_identity(scope_path, data, config) == state_before,
                    "schema")
            report["daemon_third"] = public_process(daemon.identity)
            require(report["daemon_third"] not in (report["daemon_before"], report["daemon_second"]), "ownership")
            require(api.v4("GET", "/accounts") == accounts, "schema")
            for fixed_id in batch:
                workload["retained_reads_attempted"] += 1
                value = worker.request("GET", "/jobs/" + fixed_id, host=host, deadline=scenario_deadline)
                require(validate_batch(value, fixed_id) == batch[fixed_id], "schema")
                workload["retained_reads_completed"] += 1
            observation = worker.request("GET", "/jobs/" + job_id, host=host, deadline=scenario_deadline)
            require(type(observation["row_count"]) is int and observation["row_count"] == 1, "schema")
            retained = observation["job"]
            require(json.dumps(retained, sort_keys=True, allow_nan=False) ==
                    json.dumps(before, sort_keys=True, allow_nan=False), "schema")
            wait_workflow(api, workflow_path, "waiting", timeout=min(60, workflow_deadline - time.monotonic()))
            report["acceptance"]["M4-03"] = "passed"
        if resources:
            observe("restarted_idle")
            observe("restarted_read_probe")
            # Every accepted phase passed copied identities, bounded acquisition,
            # strict units/protocol projection and its exact workload checks.
            resource_tools.project_resources(report["resources"])
            report["acceptance"]["M3-02"] = "passed"
            report["acceptance"]["M3-03"] = "passed"
        report["phase"] = "resume"
        if restore or crash:
            api = LocalHTTP(args.port, restored_token if restore else token)
            if crash:
                worker = LocalHTTP(args.port)
        require(not (restore or resources or storage or crash) or time.monotonic() < workflow_deadline - HTTP_TOTAL_TIMEOUT,
                "original Workflow deadline leaves no approval margin")
        if storage or crash:
            api.scenario_deadline = min(scenario_deadline, workflow_deadline)
            worker.scenario_deadline = min(scenario_deadline, workflow_deadline)
        event = api.v4("POST", workflow_path + "/events/approval", {"approved": True})
        require(event["instanceId"] == workflow_id, "approval targeted a different Workflow")
        complete = wait_workflow(api, workflow_path, "complete",
                                 timeout=min(60, workflow_deadline - time.monotonic()) if restore or resources or storage or crash else 60)
        require(not (restore or resources or storage or crash) or time.monotonic() < workflow_deadline, "original Workflow wall-clock deadline exceeded")
        after_observation = worker.request("GET", "/jobs/" + job_id, host=host)
        if crash:
            checkpoint_row(after_observation, job_id, committed=True, completed=1)
        after = after_observation["job"]
        assert_resume(before, retained, after, complete.get("output"), job_id)
        if storage:
            require(type(after["callback_count"]) is int and type(after["completed"]) is int, "schema")
        report["workflow"].update({"after_status": complete["status"], "after_callback_count": after["callback_count"],
                                   "after_nonce_sha256": hashlib.sha256(after["step_nonce"].encode()).hexdigest(),
                                   "same_id": True, "nonce_unchanged": True, "completed": after["completed"]})
        functional_acceptance["M2-08" if restore else "AC-07"] = "passed"
        if storage:
            cold_checkpoint("cold_after_completion")
            storage_tools.storage_extension(snapshots, workload)
            report["acceptance"]["M4-02"] = "passed"
        report["phase"] = "cleanup"
        report["result"] = "passed"
    except Exception as exc:
        report["error"] = scenario_error(exc)
        cleanup_unknown = isinstance(exc, ProcessObservationError)
    finally:
        try:
            scenario_budget.close()
        except Exception as exc:
            # Expiry must not bypass the separately bounded final cleanup.
            report["result"] = "failed"
            report["error"] = scenario_error(exc)
        try:
            with m3_deadline(150, "M5 final cleanup" if crash else "M4 final cleanup" if storage else "M3 final cleanup") if resources or storage or crash else nullcontext():
                clean = not cleanup_unknown
                for item in daemons:
                    if crash and item is intentional_crash:
                        require(not item.observation_error and not item.live() and
                                item.process.poll() == -9, "ownership")
                        # The helper already verified retained exits and closed
                        # observers. This exact owner alone has intentional -9.
                        continue
                    if item.live(strict=False) or item.observation_error:
                        shutdown = item.stop()
                        if item is daemon:
                            report["final_shutdown"] = shutdown
                        clean = clean and shutdown["all_owned_exited"] and not shutdown["forced"] and shutdown["exit_code"] == 0
                        if crash:
                            clean = clean and shutdown["was_running"] is True and shutdown.get("signal") == "SIGTERM"
                        if storage and clean and not item.observation_error:
                            graceful_stops.add(id(item))
                    else:
                        item.process.poll()
                        item.finish_threads()
                        if item is daemon and report["result"] == "passed" and not (storage and id(item) in graceful_stops):
                            clean = False
                    if storage or crash:
                        clean = clean and not item.observation_error and (item.process.poll() == 0)
                        if storage and id(item) not in graceful_stops:
                            clean = False
                    if item.text() and report["result"] != "passed":
                        report.setdefault("diagnostics", []).append(redactor.clean(item.text()))
                require(clean and not any(item.live() for item in daemons), "owned runtime cleanup failed or could not be verified")
                report.update(cleanup_scope(scope, restore, original_scope_identity, restored_scope_identity, resources=resources, storage=storage, crash=crash))
                if cold_restore is not None:
                    report["cold_restore"].update(public_backup_summary(cold_restore.cleanup(processes_stopped=True)))
                    require(report["cold_restore"].get("private_removed") is True and
                            report["cold_restore"].get("staging_removed") is True, "private recovery cleanup incomplete")
                if report["result"] == "passed":
                    functional_acceptance["M2-09" if restore else "AC-08"] = "passed"
                    require(all(value == "passed" for value in functional_acceptance.values()), "acceptance coverage incomplete")
                    if resources:
                        report["acceptance"]["M3-04"] = "passed"
                    if crash:
                        require(report["acceptance"]["M5-03"] == "passed", "schema")
                        report["acceptance"]["M5-04"] = "passed"
                    if storage:
                        report["acceptance"]["M4-04"] = "passed"
                    report["phase"] = "complete"
        except Exception as exc:
            report["result"] = "failed"
            report["cleanup_error"] = scenario_error(exc)
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
    if crash:
        # Include successful reads observed before a later comparison failed.
        if isinstance(report.get("readback"), dict) and type(report["readback"].get("read_requests")) is int:
            report["readback"]["read_requests"] = read_counter[0]
        project_crash_observations()
    report["evidence_file_written"] = False
    if output_allowed:
        try:
            # Revalidate after cleanup. A refused path must never be used even
            # for diagnostics; failure still has the bounded stdout report.
            with m3_deadline(10, "M5 evidence" if crash else "M4 evidence") if storage or crash else nullcontext():
                validate_artifact_paths(scope_hint, cache, output)
                output.parent.mkdir(parents=True, exist_ok=True)
                output.mkdir(mode=0o700)
                report["evidence_file_written"] = True
                project_observations()
                project_storage_observations()
                project_crash_observations()
                if crash and report["result"] == "passed":
                    redactor.check_report(report)
                    report["acceptance"]["M5-05"] = "passed"
                    require(all(value == "passed" for value in report["acceptance"].values()), "schema")
                if resources and report["result"] == "passed":
                    # Scan the projected report before granting the report gate;
                    # a failed exclusive write revokes it below.
                    redactor.check_report(report)
                    report["acceptance"]["M3-05"] = "passed"
                    require(all(value == "passed" for value in report["acceptance"].values()), "M3 acceptance coverage incomplete")
                if storage and report["result"] == "passed":
                    redactor.check_report(report)
                    report["acceptance"]["M4-05"] = "passed"
                    require(all(value == "passed" for value in report["acceptance"].values()), "schema")
                encoded = redactor.check_report(report)
                exclusive_file(output / "report.json", encoded.encode())
        except Exception as exc:
            if report["result"] == "passed":
                report["phase"] = "evidence"
            report["result"] = "failed"
            report["evidence_file_written"] = False
            report["evidence_write_error"] = scenario_error(exc)
            if crash:
                report["acceptance"]["M5-05"] = "not_run"
            if resources:
                report["acceptance"]["M3-05"] = "not_run"
            if storage:
                report["acceptance"]["M4-05"] = "not_run"
    # Failure reporting must survive projection failure: retain only a validated
    # prefix and rebuild counts from the internally bounded workload.
    try:
        project_storage_observations()
    except Exception as exc:
        report["result"] = "failed"
        report["error"] = storage_error(exc)
        report["acceptance"]["M4-05"] = "not_run"
        report.pop("storage", None)
        report.pop("storage_partial", None)
        valid = {}
        for name in storage_tools.PHASE_NAMES:
            if name not in snapshots:
                break
            try:
                valid[name] = storage_tools.project_snapshot(snapshots[name])
            except Exception:
                break
        try:
            report["storage_partial"] = storage_tools.partial_extension(valid, workload)
        except Exception:
            report["storage_partial"] = storage_tools.partial_extension({}, storage_tools.initial_workload())
    project_observations()
    project_crash_observations()
    encoded = redactor.check_report(report)
    print(encoded, end="", flush=True)
    return 0 if report["result"] == "passed" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("preflight", "integration", "integration-restore", "integration-resources", "integration-storage", "integration-crash"))
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--cache", default=str(HERE / ".lab-cache"))
    parser.add_argument("--output", help="new directory for sanitized report.json; must not exist")
    args = parser.parse_args()
    if args.command == "preflight":
        try:
            preflight(args.port)
            print(json.dumps({"result": "passed", "runtime_started": False}))
            return 0
        except (LabError, OSError) as exc:
            print(json.dumps({"result": "failed", "runtime_started": False, "error": str(exc)}))
            return 1
    return integration(args, restore=args.command == "integration-restore", resources=args.command == "integration-resources",
                       storage=args.command == "integration-storage", crash=args.command == "integration-crash")


if __name__ == "__main__":
    sys.exit(main())
