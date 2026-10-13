"""Bounded metadata-only observations of this invocation's cold owned scope.

This module neither authorizes process exit nor grants deletion authority.
Only aggregate numeric metadata is projected; payloads are never opened.
"""

from contextlib import contextmanager, ExitStack
import fcntl
import json
import math
import os
import re
import signal
import stat
import threading
import time

PHASE_NAMES = ("cold_baseline", "cold_after_writes", "cold_after_completion")
GROUP_NAMES = ("scope_transient", "instance_transient", "derived_tessdata",
               "local_objects", "instance_other", "scope_other")
METRICS = ("logical_bytes", "allocated_bytes", "regular_paths", "unique_files",
           "hardlink_aliases", "directories", "sockets")
MARKER = ".open-compute-lab-owner"
DATA = "instances/lab/data"
LOCKS = ("ocd.lock", DATA + "/platform.lock", DATA + "/objects/backend.lock")
MAX_ENTRIES = 8192
MAX_DEPTH = 32
MAX_PATH_BYTES = 512
MAX_FILE_LOGICAL_BYTES = 536870912
MAX_TOTAL_LOGICAL_BYTES = 2147483648
MAX_TOTAL_ALLOCATED_BYTES = 2147483648
SNAPSHOT_SECONDS = 10
EXTENSION_BYTES = 49152

LIMITS = {"max_entries": 8192, "max_depth": 32, "max_path_bytes": 512,
          "max_file_logical_bytes": 536870912, "max_total_logical_bytes": 2147483648,
          "max_total_allocated_bytes": 2147483648, "snapshot_seconds": 10,
          "extension_bytes": 49152}
LIMITATIONS = {"regular_files_only": True, "directory_socket_blocks_excluded": True,
    "observed_hardlinks_deduplicated": True, "sequential_metadata": True,
    "cold_cooperating_runtime": True, "physical_extent_allocation": "unknown",
    "same_device_bind_mount_coverage": "unknown", "filesystem_allocation_policy": "unknown",
    "peak_growth_rate_capacity_retention_tested": False}
UNITS = {"allocated_block_bytes": 512}
OP_COUNTS = {"submission": 32, "absence_checks": 16, "retained_reads": 16}


class StorageError(RuntimeError):
    """Only fixed, path-free reason codes may escape storage boundaries."""

    def __init__(self, reason):
        self.reason = (reason if reason in
            {"ownership", "lock", "type", "metadata", "limit", "deadline", "schema"}
            else "schema")
        super().__init__(self.reason)


_active_gate = None


class _SignalGate:
    """Defer Python handlers during descriptor ownership transitions.

    A main-thread OS signal mask alone cannot defer Python handlers delivered
    through another unmasked thread. Wrappers queue handlers while each narrow
    acquisition/release operation owns no interruptible descriptor gap.
    """

    def __init__(self):
        self.depth = 0
        self.pending = []
        self.handlers = {}
        self.owners = {}

    def dispatch(self, signum, frame):
        if self.depth:
            self.pending.append((signum, frame))
            return
        previous = self.handlers[signum]
        if previous == signal.SIG_IGN:
            return
        # A handler can run after ExitStack pops a callback but before its
        # critical release begins. Keep a second bounded ownership registry so
        # that interruption closes all acquired handles before replay/unwinding.
        self.depth += 1
        failure = None
        try:
            for owner in reversed(tuple(self.owners)):
                try:
                    owner.close()
                except Exception as exc:
                    failure = failure or exc
        finally:
            self.depth -= 1
        if callable(previous):
            previous(signum, frame)
        elif previous == signal.SIG_DFL:
            signal.signal(signum, previous)
            signal.raise_signal(signum)
        if failure is not None:
            raise failure
        self.drain()

    def drain(self):
        while not self.depth and self.pending:
            signum, frame = self.pending.pop(0)
            self.dispatch(signum, frame)


@contextmanager
def _deferred_handlers():
    global _active_gate
    gate, previous_gate = _SignalGate(), _active_gate
    _active_gate = gate
    try:
        for signum in (signal.SIGALRM, signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            gate.handlers[signum] = signal.getsignal(signum)
            signal.signal(signum, gate.dispatch)
        yield
    finally:
        # All resources unwind before this context restores the originals.
        for signum, previous in gate.handlers.items():
            signal.signal(signum, previous)
        _active_gate = previous_gate


@contextmanager
def _critical():
    gate = _active_gate
    if gate is None:
        yield
        return
    gate.depth += 1
    try:
        yield
    finally:
        gate.depth -= 1
        gate.drain()


class _Handle:
    def __init__(self, release):
        self.value = None
        self.release = release
        self.gate = _active_gate

    def close(self):
        with _critical():
            if self.value is not None:
                value, self.value = self.value, None
                try:
                    self.release(value)
                finally:
                    if self.gate is not None:
                        self.gate.owners.pop(self, None)


def _acquire(stack, factory, release):
    owner = _Handle(release)
    with _critical():
        try:
            owner.value = factory()
            if owner.gate is not None:
                owner.gate.owners[owner] = None
            stack.callback(owner.close)
        except BaseException:
            # Trace exceptions also unwind an acquired but unregistered handle.
            # If registered, its later callback is harmless: close consumes once.
            owner.close()
            raise
        return owner.value


def _open(stack, path, flags, reason, *, lock=False, dir_fd=None):
    return _acquire(stack, lambda: os.open(path, flags, dir_fd=dir_fd),
                    _close_lock if lock else lambda fd: _close_fd(fd, reason))


def _require(condition, reason="schema"):
    if not condition:
        raise StorageError(reason)


def _integer(value):
    return type(value) is int and value >= 0


def _number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value) and value >= 0
    except OverflowError:
        return False


def _keys(value, keys):
    _require(type(value) is dict and set(value) == set(keys))


def _fixed(value, expected):
    _keys(value, expected)
    _require(all(type(value[k]) is type(v) and value[k] == v
                 for k, v in expected.items()))
    return dict(expected)


def initial_workload():
    result = {"jobs": 16, "payload_bytes_per_job": 128, "unique_payload_bytes": 2048}
    for prefix in OP_COUNTS:
        result[prefix + "_attempted"] = 0
        result[prefix + "_completed"] = 0
    return result


def _workload(value, complete=False):
    template = initial_workload()
    _keys(value, template)
    for key in ("jobs", "payload_bytes_per_job", "unique_payload_bytes"):
        _require(type(value[key]) is int and value[key] == template[key])
    for prefix, count in OP_COUNTS.items():
        attempted, completed = value[prefix + "_attempted"], value[prefix + "_completed"]
        _require(_integer(attempted) and _integer(completed) and completed <= attempted <= count)
        if complete:
            _require(completed == attempted == count)
    return dict(value)


def _metrics(value):
    _keys(value, METRICS)
    _require(all(_integer(value[k]) for k in METRICS))
    _require(value["unique_files"] <= value["regular_paths"] and
             value["hardlink_aliases"] == value["regular_paths"] - value["unique_files"])
    _require((value["unique_files"] == 0) == (value["regular_paths"] == 0))
    _require(value["unique_files"] > 0 or
             (value["logical_bytes"] == value["allocated_bytes"] == 0))
    _require(value["logical_bytes"] <= LIMITS["max_total_logical_bytes"] and
             value["allocated_bytes"] <= LIMITS["max_total_allocated_bytes"])
    _require(value["logical_bytes"] <= value["unique_files"] * LIMITS["max_file_logical_bytes"])
    _require(value["allocated_bytes"] % UNITS["allocated_block_bytes"] == 0)
    return {k: value[k] for k in METRICS}


def project_snapshot(value):
    _keys(value, ("phase", "elapsed_seconds", "entries", "totals", "groups"))
    _require(type(value["phase"]) is str and value["phase"] in PHASE_NAMES)
    _require(_number(value["elapsed_seconds"]) and _integer(value["entries"]))
    totals = _metrics(value["totals"])
    _keys(value["groups"], GROUP_NAMES)
    groups = {name: _metrics(value["groups"][name]) for name in GROUP_NAMES}
    _require(all(groups[name]["sockets"] == 0 for name in GROUP_NAMES
                 if name not in ("scope_transient", "instance_transient")))
    _require(all(sum(group[k] for group in groups.values()) == totals[k] for k in METRICS))
    _require(value["entries"] == totals["regular_paths"] + totals["directories"] + totals["sockets"]
             and value["entries"] <= LIMITS["max_entries"])
    _require(groups["scope_other"]["directories"] >= 1)
    return {"phase": value["phase"], "elapsed_seconds": value["elapsed_seconds"],
            "entries": value["entries"], "totals": totals, "groups": groups}


def _snapshots(value, complete):
    _require(type(value) is dict)
    expected = PHASE_NAMES if complete else PHASE_NAMES[:len(value)]
    _require(set(value) == set(expected))
    result = {name: project_snapshot(value[name]) for name in expected}
    _require(all(snapshot["phase"] == name for name, snapshot in result.items()))
    return result


def _deltas(snapshots):
    result = {}
    for name, before, after in (("writes_minus_baseline", PHASE_NAMES[0], PHASE_NAMES[1]),
                               ("completion_minus_writes", PHASE_NAMES[1], PHASE_NAMES[2])):
        result[name] = {key: snapshots[after]["totals"][key] -
                       snapshots[before]["totals"][key] for key in METRICS}
    return result


def _bounded(value):
    try:
        encoded = json.dumps(value, indent=2, sort_keys=True, allow_nan=False).encode()
    except (ValueError, TypeError, OverflowError):
        raise StorageError("schema") from None
    _require(len(encoded) <= EXTENSION_BYTES)
    return value


def _extension(snapshots, workload, complete):
    result = {"schema_version": 1, "units": dict(UNITS), "limits": dict(LIMITS),
              "limitations": dict(LIMITATIONS), "workload": _workload(workload, complete),
              "snapshots": _snapshots(snapshots, complete)}
    if complete:
        result["deltas"] = _deltas(result["snapshots"])
    return _bounded(result)


def storage_extension(snapshots, workload):
    return _extension(snapshots, workload, True)


def partial_extension(snapshots, workload):
    return _extension(snapshots, workload, False)


def project_storage(value):
    _keys(value, ("schema_version", "units", "limits", "limitations", "workload", "snapshots", "deltas"))
    _require(type(value["schema_version"]) is int and value["schema_version"] == 1)
    _fixed(value["units"], UNITS)
    _fixed(value["limits"], LIMITS)
    _fixed(value["limitations"], LIMITATIONS)
    result = storage_extension(value["snapshots"], value["workload"])
    _keys(value["deltas"], result["deltas"])
    for name, delta in result["deltas"].items():
        _keys(value["deltas"][name], METRICS)
        _require(all(type(value["deltas"][name][k]) is int and
                     value["deltas"][name][k] == v for k, v in delta.items()))
    return result


def _group(path):
    def below(prefix):
        return path == prefix or path.startswith(prefix + "/")
    if any(below(prefix) for prefix in ("cache", "tmp", "run")):
        return "scope_transient"
    if any(below(DATA + "/" + name) for name in ("cache", "tmp", "runtime")):
        return "instance_transient"
    if below(DATA + "/tessdata"):
        return "derived_tessdata"
    if below(DATA + "/objects"):
        return "local_objects"
    return "instance_other" if below(DATA) else "scope_other"


def _signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_size,
            info.st_blocks, info.st_nlink, info.st_mtime_ns, info.st_ctime_ns)


def _directory_signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid,
            info.st_mtime_ns, info.st_ctime_ns)


def _safe(info, device, reason="ownership"):
    _require(info.st_uid == os.geteuid() and info.st_dev == device and
             not info.st_mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX | 0o022), reason)


def _tick(deadline):
    _require(time.monotonic() < deadline, "deadline")


@contextmanager
def _deadline(deadline):
    _require(threading.current_thread() is threading.main_thread(), "deadline")
    _require(type(deadline) in (int, float) and math.isfinite(deadline), "deadline")
    started = time.monotonic()
    _tick(deadline)
    own_end = min(deadline, started + SNAPSHOT_SECONDS)
    previous_handler = signal.getsignal(signal.SIGALRM)
    remaining, interval = signal.getitimer(signal.ITIMER_REAL)
    previous_end = started + remaining if remaining > 0 else None
    end = min(own_end, previous_end) if previous_end is not None else own_end
    inherited_fired = False
    def expired(signum, frame):
        nonlocal inherited_fired
        if previous_end is not None and previous_end <= own_end:
            inherited_fired = True
            if callable(previous_handler):
                try:
                    previous_handler(signum, frame)
                except Exception:
                    raise StorageError("deadline") from None
        raise StorageError("deadline")
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, max(.000001, end - time.monotonic()))
    try:
        yield end
        _tick(end)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_end is not None:
            left = previous_end - time.monotonic()
            if left <= 0 and inherited_fired:
                if interval > 0:
                    signal.setitimer(signal.ITIMER_REAL, interval - (-left % interval), interval)
            else:
                signal.setitimer(signal.ITIMER_REAL, max(.000001, left), interval)


def _marker(root_fd, scope, device):
    with ExitStack() as stack:
        try:
            expected = scope.marker.encode("ascii") if type(scope.marker) is str else scope.marker
            _require(type(expected) is bytes and re.fullmatch(b"[a-f0-9]{64}", expected), "ownership")
            before = os.stat(MARKER, dir_fd=root_fd, follow_symlinks=False)
            _safe(before, device)
            _require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                     stat.S_IMODE(before.st_mode) == 0o600 and before.st_size == 64, "ownership")
            fd = _open(stack, MARKER, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                       "ownership", dir_fd=root_fd)
            _require(_signature(os.fstat(fd)) == _signature(before), "ownership")
            _require(os.read(fd, 65) == expected, "ownership")
            _require(_signature(os.fstat(fd)) == _signature(before) and
                     _signature(os.stat(MARKER, dir_fd=root_fd, follow_symlinks=False)) ==
                     _signature(before), "ownership")
            return _signature(before)
        except (OSError, UnicodeError, AttributeError, TypeError):
            raise StorageError("ownership") from None


def _close_fd(fd, reason="metadata"):
    try:
        os.close(fd)
    except OSError:
        raise StorageError(reason) from None


def _close_lock(fd):
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)
    except OSError:
        raise StorageError("lock") from None


def _lock(root_fd, relative, device, stack, deadline):
    """Keep the validated directory chain open through the final lock recheck."""
    fd = root_fd
    ancestors = []
    try:
        parts = relative.split("/")
        for name in parts[:-1]:
            _tick(deadline)
            before = os.stat(name, dir_fd=fd, follow_symlinks=False)
            _safe(before, device, "lock")
            _require(stat.S_ISDIR(before.st_mode), "lock")
            child = _open(stack, name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK,
                          "lock", dir_fd=fd)
            _require(_directory_signature(before) == _directory_signature(os.fstat(child)), "lock")
            ancestors.append((fd, name, child, _directory_signature(before)))
            fd = child
        name = parts[-1]
        before = os.stat(name, dir_fd=fd, follow_symlinks=False)
        _safe(before, device, "lock")
        _require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "lock")
        leaf = _open(stack, name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                     "lock", lock=True, dir_fd=fd)
        _require(_signature(before) == _signature(os.fstat(leaf)), "lock")
        fcntl.flock(leaf, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _require(_signature(before) == _signature(os.stat(name, dir_fd=fd, follow_symlinks=False)), "lock")
        return (fd, name, leaf, _signature(before), ancestors)
    except OSError:
        raise StorageError("lock") from None


def _recheck_lock(lock, device):
    fd, name, leaf, signature, ancestors = lock
    try:
        _require(_signature(os.fstat(leaf)) == signature and
                 _signature(os.stat(name, dir_fd=fd, follow_symlinks=False)) == signature, "lock")
        for parent, name, child, before in ancestors:
            info = os.stat(name, dir_fd=parent, follow_symlinks=False)
            _safe(info, device, "lock")
            _require(_directory_signature(info) == before and
                     _directory_signature(os.fstat(child)) == before, "lock")
    except OSError:
        raise StorageError("lock") from None


def _scan(root_fd, device, deadline):
    groups = {name: {key: 0 for key in METRICS} for name in GROUP_NAMES}
    inodes = {}
    entries = 0
    total_logical = total_allocated = 0

    def visit(fd, prefix, depth):
        nonlocal entries, total_logical, total_allocated
        _tick(deadline)
        _require(depth <= MAX_DEPTH, "limit")
        before = os.fstat(fd)
        _safe(before, device)
        _require(stat.S_ISDIR(before.st_mode), "type")
        group = _group(prefix)
        entries += 1
        _require(entries <= MAX_ENTRIES, "limit")
        groups[group]["directories"] += 1
        with ExitStack() as scan_stack:
            scan = _acquire(scan_stack, lambda: os.scandir(fd), lambda value: value.close())
            for entry in scan:
                _tick(deadline)
                if not prefix and entry.name == MARKER:
                    continue
                path = prefix + "/" + entry.name if prefix else entry.name
                try:
                    length = len(path.encode("utf-8"))
                except UnicodeError:
                    raise StorageError("limit") from None
                _require(length <= MAX_PATH_BYTES, "limit")
                info = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                _require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode) or
                         stat.S_ISSOCK(info.st_mode), "type")
                _safe(info, device)
                group = _group(path)
                if stat.S_ISDIR(info.st_mode):
                    _require(depth + 1 <= MAX_DEPTH, "limit")
                    with ExitStack() as child_stack:
                        child = _open(child_stack, entry.name,
                            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK,
                            "metadata", dir_fd=fd)
                        _require(_directory_signature(info) == _directory_signature(os.fstat(child)), "metadata")
                        visit(child, path, depth + 1)
                        _require(_directory_signature(info) == _directory_signature(
                            os.stat(entry.name, dir_fd=fd, follow_symlinks=False)), "metadata")
                    continue
                entries += 1
                _require(entries <= MAX_ENTRIES, "limit")
                if stat.S_ISREG(info.st_mode):
                    _require(info.st_size >= 0 and info.st_blocks >= 0 and info.st_nlink >= 1, "metadata")
                    _require(info.st_size <= MAX_FILE_LOGICAL_BYTES, "limit")
                    signature = _signature(info)
                    _require(signature == _signature(os.stat(entry.name, dir_fd=fd,
                                                            follow_symlinks=False)), "metadata")
                    groups[group]["regular_paths"] += 1
                    inode = (info.st_dev, info.st_ino)
                    if inode in inodes:
                        old_signature, old_group, observed = inodes[inode]
                        _require((signature, group) == (old_signature, old_group), "metadata")
                        _require(observed + 1 <= info.st_nlink, "metadata")
                        inodes[inode] = (signature, group, observed + 1)
                        groups[group]["hardlink_aliases"] += 1
                    else:
                        inodes[inode] = (signature, group, 1)
                        total_logical += info.st_size
                        total_allocated += info.st_blocks * 512
                        _require(total_logical <= MAX_TOTAL_LOGICAL_BYTES and
                                 total_allocated <= MAX_TOTAL_ALLOCATED_BYTES, "limit")
                        groups[group]["unique_files"] += 1
                        groups[group]["logical_bytes"] += info.st_size
                        groups[group]["allocated_bytes"] += info.st_blocks * 512
                elif stat.S_ISSOCK(info.st_mode):
                    _require(group in ("scope_transient", "instance_transient"), "type")
                    _require(_signature(info) == _signature(os.stat(entry.name, dir_fd=fd,
                                                                  follow_symlinks=False)), "metadata")
                    groups[group]["sockets"] += 1
                else:
                    raise StorageError("type")
        _tick(deadline)
        _require(_directory_signature(before) == _directory_signature(os.fstat(fd)), "metadata")

    try:
        visit(root_fd, "", 0)
    except OSError:
        raise StorageError("metadata") from None
    return entries, groups


def cold_snapshot(scope, phase, *, deadline):
    _require(type(phase) is str and phase in PHASE_NAMES)
    started = time.monotonic()
    with _deadline(deadline) as end, _deferred_handlers(), ExitStack() as stack:
        try:
            identity = scope.identity
            _require(type(identity) is dict and set(identity) == {"device", "inode"} and
                     all(type(v) is int and v >= 0 for v in identity.values()), "ownership")
            root_fd = _open(stack, scope.path,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK, "ownership")
            root = os.fstat(root_fd)
            device = root.st_dev
            _require({"device": root.st_dev, "inode": root.st_ino} == identity, "ownership")
            _safe(root, device)
            _require(stat.S_ISDIR(root.st_mode), "ownership")
            marker_signature = _marker(root_fd, scope, device)
        except (OSError, AttributeError, TypeError):
            raise StorageError("ownership") from None
        locks = [_lock(root_fd, name, device, stack, end) for name in LOCKS]
        entries, groups = _scan(root_fd, device, end)
        _tick(end)
        for lock in locks:
            _tick(end)
            _recheck_lock(lock, device)
        _require(_marker(root_fd, scope, device) == marker_signature, "ownership")
        try:
            final = os.stat(scope.path, follow_symlinks=False)
            _require(_directory_signature(final) == _directory_signature(root) and
                     _directory_signature(os.fstat(root_fd)) == _directory_signature(root), "ownership")
        except OSError:
            raise StorageError("ownership") from None
        _tick(end)
        result = project_snapshot({"phase": phase, "elapsed_seconds": time.monotonic() - started,
            "entries": entries, "groups": groups,
            "totals": {key: sum(group[key] for group in groups.values()) for key in METRICS}})
    return result
