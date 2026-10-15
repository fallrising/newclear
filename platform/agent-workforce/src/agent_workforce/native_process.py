"""Bounded synchronous Linux process ownership, separate from remote effects.

The immutable intent is the at-most-once boundary. A missing process receipt
is deliberately unrecoverable by execution: inspection and stop never spawn.
This is a cooperating local journal, not a daemon or a hostile-user sandbox.
Polling cannot exclude unobserved detached descendants. Spawned operations
therefore never assert whole-tree ``stopped``; ``leader_stopped`` separately
records an observed leader exit. Full-tree stop/resume requires a stronger
containment boundary than this supervisor supplies.
"""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import threading
import time
import uuid


class ProcessError(ValueError):
    """Invalid request, unsafe journal, or conflicting immutable intent."""


_LOCAL_LOCK = threading.RLock()
_MAX_JSON = 65536
_MAX_PROCESSES = 256


def _json(value):
    def check(item, depth=0):
        if depth > 40:
            raise ProcessError("JSON depth limit")
        if item is None or type(item) in (str, int, bool):
            return
        if type(item) is float and math.isfinite(item):
            return
        if type(item) is dict and all(type(key) is str for key in item):
            for child in item.values():
                check(child, depth + 1)
            return
        if type(item) is list:
            for child in item:
                check(child, depth + 1)
            return
        raise ProcessError("finite JSON required")
    try:
        check(value)
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False,
                             sort_keys=True, separators=(",", ":")).encode("utf-8")
        if len(encoded) > _MAX_JSON:
            raise ProcessError("JSON size limit")
        return encoded
    except (ValueError, TypeError, UnicodeError, RecursionError) as exc:
        raise ProcessError("invalid bounded JSON") from exc


def _operation(value):
    if type(value) is not str or not value or "\0" in value:
        raise ProcessError("operation identifier required")
    try:
        encoded = value.encode("utf-8")
    except UnicodeError as exc:
        raise ProcessError("invalid operation identifier") from exc
    if len(encoded) > 256:
        raise ProcessError("operation identifier limit")
    return hashlib.sha256(encoded).hexdigest()


def _private(fd, directory=False):
    info = os.fstat(fd)
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if (not expected(info.st_mode) or info.st_uid != os.getuid()
            or info.st_mode & 0o077 or (not directory and info.st_nlink != 1)):
        raise ProcessError("journal must be private, owned, and unlinked elsewhere")


def _open_directory(path):
    """Walk with no-follow dirfds so even an ancestor symlink is rejected."""
    absolute = os.path.abspath(os.fspath(path))
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        parts = Path(absolute).parts[1:]
        for index, part in enumerate(parts):
            try:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            except FileNotFoundError:
                if index != len(parts) - 1:
                    raise ProcessError("journal parent must exist")
                os.mkdir(part, 0o700, dir_fd=fd)
                os.fsync(fd)
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        _private(fd, directory=True)
        return absolute, fd
    except BaseException:
        os.close(fd)
        raise


def _boot():
    try:
        return Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    except OSError:
        return None


def _identity(pid):
    try:
        text = Path("/proc", str(pid), "stat").read_text()
        fields = text[text.rindex(")") + 2:].split()
        return {"pid": pid, "start_ticks": int(fields[19]), "pgid": int(fields[2]),
                "sid": int(fields[3]), "ppid": int(fields[1]), "state": fields[0]}
    except FileNotFoundError:
        return None
    except (OSError, ValueError, IndexError) as exc:
        raise ProcessError("process visibility unavailable") from exc


def _same(expected, actual):
    return actual is not None and all(expected.get(key) == actual.get(key)
                                      for key in ("pid", "start_ticks", "pgid", "sid"))


def _incarnation(expected, actual):
    return actual is not None and all(expected.get(key) == actual.get(key)
                                      for key in ("pid", "start_ticks"))


def _public_identity(identity, boot_id):
    return {key: identity[key] for key in ("pid", "start_ticks", "pgid", "sid")} | {"boot_id": boot_id}


class ProcessSupervisor:
    """Own private durable intents and synchronously supervise bounded children."""

    def __init__(self, root):
        self._root_fd = None
        self._fault = None
        try:
            self.root, self._root_fd = _open_directory(root)
            with self._locked():
                pass
        except OSError as exc:
            self.close()
            raise ProcessError("cannot open safe process journal") from exc

    def close(self):
        if self._root_fd is not None:
            os.close(self._root_fd)
            self._root_fd = None

    def __del__(self):
        self.close()

    @contextmanager
    def _locked(self):
        with _LOCAL_LOCK:
            if self._root_fd is None:
                raise ProcessError("journal closed")
            fd = None
            try:
                fd = os.open(".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
                             0o600, dir_fd=self._root_fd)
                _private(fd)
                fcntl.flock(fd, fcntl.LOCK_EX)
                yield
            except OSError as exc:
                raise ProcessError("unsafe or unavailable journal") from exc
            finally:
                if fd is not None:
                    os.close(fd)

    @contextmanager
    def _directory(self, operation_id, create=False):
        name = _operation(operation_id)
        created = False
        try:
            if create:
                try:
                    os.mkdir(name, 0o700, dir_fd=self._root_fd)
                    os.fsync(self._root_fd)
                    created = True
                except FileExistsError:
                    pass
            try:
                fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self._root_fd)
            except FileNotFoundError:
                yield None, False
                return
            try:
                _private(fd, directory=True)
                yield fd, created
            finally:
                os.close(fd)
        except OSError as exc:
            raise ProcessError("unsafe operation journal") from exc

    def _read(self, fd, name):
        try:
            source = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
        except FileNotFoundError:
            return None
        try:
            _private(source)
            with os.fdopen(source, "rb") as stream:
                source = None
                data = stream.read(_MAX_JSON + 1)
            if len(data) > _MAX_JSON:
                raise ProcessError("oversized journal")
            def pairs(items):
                result = {}
                for key, value in items:
                    if key in result:
                        raise ProcessError("duplicate journal key")
                    result[key] = value
                return result
            value = json.loads(data, object_pairs_hook=pairs)
            _json(value)
            if type(value) is not dict:
                raise ProcessError("invalid journal record")
            return value
        except (ValueError, UnicodeError, RecursionError) as exc:
            raise ProcessError("invalid journal record") from exc
        finally:
            if source is not None:
                os.close(source)

    def _write(self, fd, name, value, *, exclusive=False):
        data = _json(value)
        if not exclusive:
            # Reject hostile targets rather than replacing their directory entry.
            self._read(fd, name)
        target = name if exclusive else ".write-" + uuid.uuid4().hex
        output = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=fd)
        with os.fdopen(output, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if not exclusive:
            os.replace(target, name, src_dir_fd=fd, dst_dir_fd=fd)
        os.fsync(fd)

    def _base(self, operation_id, binding=None):
        directory = os.path.join(self.root, _operation(operation_id))
        return dict(operation_id=operation_id, status="unknown", stopped=False,
                    leader_stopped=False,
                    effects_resolved=False, exit_code=None, timed_out=False,
                    output_limited=False, ownership=None,
                    stdout_path=os.path.join(directory, "stdout"),
                    stderr_path=os.path.join(directory, "stderr"), binding=binding)

    def _record(self, fd, operation_id):
        intent = self._read(fd, "intent.json")
        state = self._read(fd, "state.json")
        if intent is None:
            if state is not None:
                raise ProcessError("receipt lacks immutable intent")
            return None, self._base(operation_id)
        if intent.get("operation_id") != operation_id:
            raise ProcessError("journal identity conflict")
        record = self._base(operation_id, intent["request"]["binding"])
        if state is not None:
            if state.get("operation_id") != operation_id:
                raise ProcessError("receipt identity conflict")
            record.update(state)
            # Paths and effects proof cannot be supplied by mutable journal data.
            for key in ("stdout_path", "stderr_path", "binding", "effects_resolved"):
                record[key] = self._base(operation_id, intent["request"]["binding"])[key]
        for name in ("stdout", "stderr"):
            try:
                output = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
            except FileNotFoundError:
                continue
            try:
                _private(output)
            finally:
                os.close(output)
        return intent, record

    def _request(self, argv, cwd, binding, timeout_seconds, max_output_bytes):
        if (type(argv) is not list or not argv or len(argv) > 256
                or any(type(arg) is not str or "\0" in arg or len(arg) > 4096 for arg in argv)
                or not os.path.isabs(argv[0])):
            raise ProcessError("trusted absolute executable argv required")
        try:
            cwd = os.fspath(cwd)
        except TypeError as exc:
            raise ProcessError("canonical cwd required") from exc
        if (type(cwd) is not str or not os.path.isabs(cwd) or "\0" in cwd
                or os.path.realpath(cwd) != cwd or not os.path.isdir(cwd)):
            raise ProcessError("canonical existing cwd required")
        try:
            valid_timeout = type(timeout_seconds) in (int, float) and math.isfinite(timeout_seconds) and 0 < timeout_seconds <= 1800
        except OverflowError:
            valid_timeout = False
        if not valid_timeout:
            raise ProcessError("bounded positive timeout required")
        if type(max_output_bytes) is not int or not 0 < max_output_bytes <= 2097152:
            raise ProcessError("bounded positive output limit required")
        if type(binding) is not dict:
            raise ProcessError("binding must be finite bounded JSON dictionary")
        _json(binding)
        return json.loads(_json(dict(argv=argv, cwd=cwd, binding=binding,
                                     timeout_seconds=float(timeout_seconds),
                                     max_output_bytes=max_output_bytes)))

    def _check_fault(self, point):
        if self._fault is not None:
            self._fault(point)

    def inspect(self, operation_id):
        _operation(operation_id)
        with self._locked(), self._directory(operation_id) as (fd, _):
            if fd is None:
                return self._base(operation_id)
            _, record = self._record(fd, operation_id)
            return self._inspect_record(record)

    def _inspect_record(self, record):
        if record["status"] == "running":
            owner = record.get("ownership")
            if not self._valid_owner(owner):
                record["status"] = "unknown"
                record["stopped"] = False
            else:
                try:
                    current = _identity(owner["pid"])
                except ProcessError:
                    current = None
                if not _same(owner, current) or current["state"] == "Z":
                    record["status"] = "unknown"
                    record["stopped"] = False
        return record

    def _update(self, operation_id, **changes):
        with self._locked(), self._directory(operation_id) as (fd, _):
            if fd is None:
                raise ProcessError("missing owned journal")
            _, record = self._record(fd, operation_id)
            if record.get("visibility_complete") is False:
                # Another observer may have learned of an escape or lost
                # visibility while this caller was outside the journal lock.
                changes["visibility_complete"] = False
                if changes.get("stopped"):
                    changes.update(stopped=False, status="unknown")
            record.update(changes)
            record["effects_resolved"] = False
            self._write(fd, "state.json", record)
            return record

    def _valid_owner(self, owner):
        return (type(owner) is dict and type(owner.get("pid")) is int
                and type(owner.get("start_ticks")) is int
                and type(owner.get("pgid")) is int and type(owner.get("sid")) is int
                and owner["pid"] > 0 and owner["pid"] == owner["pgid"] == owner["sid"]
                and bool(owner.get("boot_id")) and owner["boot_id"] == _boot())

    def _observe(self, owner, known):
        """Track original incarnations and session members; uncertainty is sticky."""
        if not self._valid_owner(owner):
            return known, False, []
        processes = {}
        try:
            with os.scandir("/proc") as entries:
                for entry in entries:
                    if entry.name.isdigit():
                        if len(processes) >= 65536:
                            return known, False, []
                        current = _identity(int(entry.name))
                        if current is not None:
                            processes[current["pid"]] = current
        except (OSError, ProcessError):
            return known, False, []
        anchor = processes.get(owner["pid"])
        if anchor is not None and not _same(owner, anchor):
            return known, False, []
        known_by_pid = {item["pid"]: item for item in known}
        known_by_pid[owner["pid"]] = owner
        matched = {pid for pid, item in known_by_pid.items() if _incarnation(item, processes.get(pid))}
        for pid in matched:
            # Process group/session membership can change without changing the
            # incarnation. Retain the observed descendant across reparenting.
            known_by_pid[pid] = _public_identity(processes[pid], owner["boot_id"])
        complete = True
        # Descendants that escape the owned session make completeness uncertain,
        # even though their already-observed identities remain safe to signal.
        for _ in range(_MAX_PROCESSES):
            added = False
            for pid, current in processes.items():
                member = current["sid"] == owner["sid"] and current["pgid"] == owner["pgid"]
                if pid not in matched and (current["ppid"] in matched or member):
                    if member and not matched:
                        complete = False
                        continue
                    if len(known_by_pid) >= _MAX_PROCESSES:
                        return list(known_by_pid.values()), False, []
                    known_by_pid[pid] = _public_identity(current, owner["boot_id"])
                    matched.add(pid)
                    added = True
            if not added:
                break
        live = []
        for pid in matched:
            current = processes[pid]
            if current["sid"] != owner["sid"] or current["pgid"] != owner["pgid"]:
                complete = False
            if current["state"] != "Z":
                live.append(known_by_pid[pid])
        return list(known_by_pid.values()), complete, live

    def _signal_exact(self, identity):
        if identity.get("boot_id") != _boot() or not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            return False
        fd = None
        try:
            fd = os.pidfd_open(identity["pid"])
            current = _identity(identity["pid"])
            if not _same(identity, current):
                return False
            signal.pidfd_send_signal(fd, signal.SIGKILL)
            return True
        except ProcessLookupError:
            return True
        except (OSError, ProcessError):
            return False
        finally:
            if fd is not None:
                os.close(fd)

    def stop(self, operation_id):
        record = self.inspect(operation_id)
        if record["status"] in ("exited", "not_started") and record["stopped"]:
            return record
        owner = record.get("ownership")
        if not self._valid_owner(owner):
            if owner is not None:
                return self._update(operation_id, status="unknown", stopped=False)
            return record
        # A missing/mismatched owner cannot authorize signals using a bare PID.
        try:
            current = _identity(owner["pid"])
        except ProcessError:
            return self._update(operation_id, status="unknown", stopped=False,
                                visibility_complete=False)
        if current is not None and not _same(owner, current):
            return self._update(operation_id, status="unknown", stopped=False)
        known = record.get("observed", [owner])
        visibility = record.get("visibility_complete", False)
        deadline = time.monotonic() + .6
        while True:
            known, complete, live = self._observe(owner, known)
            visibility = visibility and complete
            if not live or time.monotonic() >= deadline:
                try:
                    leader = _identity(owner["pid"])
                    leader_stopped = leader is None or (_same(owner, leader) and leader["state"] == "Z")
                except ProcessError:
                    leader_stopped = False
                # Even an empty scan cannot exclude a descendant that detached
                # and reparented before the first observation. No whole-tree
                # cancellation proof is emitted by this generic process port.
                return self._update(operation_id, status="unknown", stopped=False,
                                    leader_stopped=leader_stopped, observed=known, visibility_complete=visibility,
                                    stop_requested=True)
            for identity in sorted(live, key=lambda item: item["pid"] == owner["pid"]):
                if not self._signal_exact(identity):
                    visibility = False
            time.sleep(.01)

    def execute(self, operation_id, argv, cwd, *, binding, timeout_seconds,
                max_output_bytes=2097152):
        _operation(operation_id)
        request = self._request(argv, cwd, binding, timeout_seconds, max_output_bytes)
        streams = {}
        process = None
        selector = selectors.DefaultSelector()
        owner = None
        try:
            with self._locked(), self._directory(operation_id, create=True) as (fd, created):
                if not created:
                    intent, previous = self._record(fd, operation_id)
                    if intent is None:
                        raise ProcessError("existing operation lacks immutable intent; never respawn")
                    if _json(intent["request"]) != _json(request):
                        raise ProcessError("immutable process request conflict")
                    return self._inspect_record(previous)
                # Exclusive fsynced intent precedes every possible Popen.
                self._write(fd, "intent.json", dict(operation_id=operation_id, request=request), exclusive=True)
                for name in ("stdout", "stderr"):
                    output = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                     0o600, dir_fd=fd)
                    streams[name] = os.fdopen(output, "wb")
                os.fsync(fd)
                self._check_fault("after_intent")
                try:
                    process = subprocess.Popen(request["argv"], cwd=request["cwd"],
                                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                               stderr=subprocess.PIPE, start_new_session=True,
                                               close_fds=True)
                except OSError:
                    record = self._base(operation_id, request["binding"])
                    record.update(status="not_started", stopped=True, leader_stopped=True)
                    self._write(fd, "state.json", record)
                    return record
                identity = _identity(process.pid)
                boot_id = _boot()
                if identity is not None and boot_id:
                    owner = _public_identity(identity, boot_id)
                self._check_fault("after_spawn")
                record = self._base(operation_id, request["binding"])
                record.update(status="running" if self._valid_owner(owner) else "unknown",
                              ownership=owner, observed=[owner] if owner else [],
                              visibility_complete=self._valid_owner(owner))
                self._write(fd, "state.json", record)
            for name, pipe in (("stdout", process.stdout), ("stderr", process.stderr)):
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, name)
            deadline = time.monotonic() + request["timeout_seconds"]
            written = 0
            known = [owner] if owner else []
            visibility = self._valid_owner(owner)
            stopping = False
            drain_deadline = None
            while True:
                known, complete, live = self._observe(owner, known)
                visibility = visibility and complete
                # Persist descendant evidence before any reaping or stop request.
                self._update(operation_id, observed=known, visibility_complete=visibility)
                exited = process.poll() is not None
                if exited and not live and not selector.get_map():
                    break
                if not stopping and time.monotonic() >= deadline:
                    self._update(operation_id, timed_out=True)
                    self.stop(operation_id)
                    stopping = True
                    drain_deadline = time.monotonic() + .2
                if drain_deadline is not None and time.monotonic() >= drain_deadline:
                    break
                for key, _ in selector.select(.02):
                    try:
                        data = os.read(key.fileobj.fileno(), 65536)
                    except BlockingIOError:
                        continue
                    if not data:
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
                        continue
                    remaining = request["max_output_bytes"] - written
                    captured = data[:remaining]
                    streams[key.data].write(captured)
                    written += len(captured)
                    if len(data) > remaining and not stopping:
                        self._update(operation_id, output_limited=True)
                        self.stop(operation_id)
                        stopping = True
                        drain_deadline = time.monotonic() + .2
                # A concurrent stop is observable without holding an I/O lock.
                if not stopping and self.inspect(operation_id).get("stop_requested"):
                    stopping = True
                    drain_deadline = time.monotonic() + .2
            exit_code = process.poll()
            known, complete, live = self._observe(owner, known)
            visibility = visibility and complete
            for stream in streams.values():
                stream.flush()
                os.fsync(stream.fileno())
            return self._update(operation_id, status="exited" if exit_code is not None else "unknown",
                                stopped=False, leader_stopped=exit_code is not None,
                                exit_code=exit_code, observed=known,
                                visibility_complete=visibility)
        except BaseException:
            # A receipt-write fault cannot erase intent or justify respawn. Best
            # effort cleanup only signals the exact locally obtained incarnation.
            if process is not None:
                if owner is not None:
                    self._signal_exact(owner)
                try:
                    process.wait(timeout=.7)
                except subprocess.TimeoutExpired:
                    pass
            raise
        finally:
            selector.close()
            if process is not None:
                for pipe in (process.stdout, process.stderr):
                    if pipe is not None:
                        pipe.close()
            for stream in streams.values():
                stream.close()
