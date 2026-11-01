"""One-operation Linux subreaper, invoked as an isolated stdlib script.

The private journal and cooperating same-UID parent are the trust boundary.
Only waitpid(__WALL) returning ECHILD closes the admitted local fork tree;
neither procfs enumeration nor helper exit proves closure or remote effects.
"""
import ctypes
import errno
import json
import math
import os
import re
import signal
import stat
import sys
import time


PROTOCOL = "subreaper-v1"
MAX_JSON = 65536
MAX_CHILDREN = 4096
WALL = 0x40000000
MISSING = object()


class HelperError(ValueError):
    """Fail closed without publishing a closure receipt."""


def _private(fd, *, directory=False):
    info = os.fstat(fd)
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if (not expected(info.st_mode) or info.st_uid != os.getuid()
            or info.st_mode & 0o077 or (not directory and info.st_nlink != 1)):
        raise HelperError("unsafe journal")


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise HelperError("duplicate key")
        result[key] = value
    return result


def _invalid_constant(value):
    raise HelperError("nonfinite JSON")


def _read(directory, name):
    try:
        source = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                         dir_fd=directory)
    except FileNotFoundError:
        return MISSING
    try:
        _private(source)
        with os.fdopen(source, "rb") as stream:
            source = None
            data = stream.read(MAX_JSON + 1)
        if len(data) > MAX_JSON:
            raise HelperError("oversized journal")
        return json.loads(data, object_pairs_hook=_pairs, parse_constant=_invalid_constant)
    finally:
        if source is not None:
            os.close(source)


def _write(directory, name, value):
    data = json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(data) > MAX_JSON:
        raise HelperError("oversized receipt")
    temporary = ".helper-" + os.urandom(16).hex()
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=directory)
    published = False
    try:
        with os.fdopen(fd, "wb") as stream:
            fd = None
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        # A fresh operation must never replace existing helper evidence. The
        # cooperating parent admits a single helper for this private directory.
        try:
            os.stat(name, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise HelperError("receipt already exists")
        # Rename publishes an already single-linked file. Linking then
        # unlinking would briefly make strict private-file readers reject it.
        os.rename(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
        published = True
        os.fsync(directory)
    except BaseException:
        if published:
            # A failed durability step must not leave apparently accepted
            # evidence behind. The caller still receives the original failure.
            try:
                os.unlink(name, dir_fd=directory)
                os.fsync(directory)
            except OSError:
                pass
        raise
    finally:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass


def _text(value, maximum):
    return (type(value) is str and bool(value) and "\0" not in value
            and len(value.encode("utf-8")) <= maximum)


def _request(value):
    keys = {"operation_id", "request_digest", "nonce", "argv", "cwd", "timeout_seconds"}
    if type(value) is not dict or set(value) != keys:
        raise HelperError("request fields")
    if (not _text(value["operation_id"], 256)
            or type(value["request_digest"]) is not str
            or re.fullmatch("[0-9a-f]{64}", value["request_digest"]) is None
            or type(value["nonce"]) is not str
            or re.fullmatch("[0-9a-f]{32}", value["nonce"]) is None):
        raise HelperError("request identity")
    argv = value["argv"]
    if (type(argv) is not list or not argv or len(argv) > 4096
            or any(type(arg) is not str or "\0" in arg for arg in argv)
            or not os.path.isabs(argv[0])):
        raise HelperError("trusted absolute executable required")
    cwd = value["cwd"]
    if (not _text(cwd, MAX_JSON) or not os.path.isabs(cwd)
            or os.path.realpath(cwd) != cwd or not os.path.isdir(cwd)):
        raise HelperError("canonical cwd required")
    timeout = value["timeout_seconds"]
    if (type(timeout) not in (int, float) or not math.isfinite(timeout)
            or not 0 < timeout <= 1800):
        raise HelperError("bounded timeout required")
    return value


def _identity(pid):
    with open(f"/proc/{pid}/stat", "rb") as source:
        text = source.read(4097)
    if len(text) > 4096:
        raise HelperError("process identity bound")
    fields = text[text.rindex(b")") + 2:].split()
    return {"pid": pid, "start_ticks": int(fields[19]), "ppid": int(fields[1])}


def _subreaper():
    if sys.platform != "linux" or not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise HelperError("Linux pidfds required")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:
        raise HelperError("subreaper unavailable")
    enabled = ctypes.c_int()
    if libc.prctl(37, ctypes.byref(enabled), 0, 0, 0) != 0 or enabled.value != 1:
        raise HelperError("subreaper verification failed")
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)


def _control(directory, name, nonce):
    value = _read(directory, name)
    if value is MISSING:
        return False
    if type(value) is not dict or set(value) != {"nonce"} or value["nonce"] != nonce:
        raise HelperError("control mismatch")
    return True


def _fork_payload(request):
    # This is the only fork site. The parent never reopens this gate.
    pid = os.fork()
    if pid == 0:
        try:
            null = os.open(os.devnull, os.O_RDONLY)
            os.dup2(null, 0)
            # Close even descriptors above a subsequently lowered RLIMIT_NOFILE.
            for name in os.listdir("/proc/self/fd"):
                fd = int(name)
                if fd > 2:
                    try:
                        os.close(fd)
                    except OSError as exc:
                        if exc.errno != errno.EBADF:
                            raise
                        # The proc directory descriptor is already closed.
            os.chdir(request["cwd"])
            os.execv(request["argv"][0], request["argv"])
        except BaseException:
            # A forked bootstrap is admitted even when exec fails.
            os._exit(127)
    return pid


def _reap(leader, exit_code):
    """Sole waiter; no Popen poll/wait and no procfs closure inference."""
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG | WALL)
        except ChildProcessError:
            return exit_code, True
        except InterruptedError:
            continue
        if pid == 0:
            return exit_code, False
        if pid == leader:
            exit_code = os.waitstatus_to_exitcode(status)


def _kill_children():
    own = os.getpid()
    with open(f"/proc/self/task/{own}/children", encoding="ascii") as source:
        data = source.read(MAX_CHILDREN * 24 + 1)
    children = data.split()
    if len(data) > MAX_CHILDREN * 24 or len(children) > MAX_CHILDREN:
        raise HelperError("child discovery bound")
    for value in children:
        pid = int(value)
        fd = None
        try:
            before = _identity(pid)
            fd = os.pidfd_open(pid)
            after = _identity(pid)
            if before == after and after["ppid"] == own:
                signal.pidfd_send_signal(fd, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except FileNotFoundError:
            pass
        finally:
            if fd is not None:
                os.close(fd)


def run(directory):
    if type(directory) is not int or directory < 3:
        raise HelperError("inherited directory required")
    _private(directory, directory=True)
    os.set_inheritable(directory, False)
    request = _request(_read(directory, "helper-request.json"))
    _subreaper()
    identity = _identity(os.getpid())
    identity.pop("ppid")
    with open("/proc/sys/kernel/random/boot_id", encoding="ascii") as source:
        boot = source.read(129).strip()
    if not _text(boot, 128):
        raise HelperError("boot identity unavailable")
    identity["boot_id"] = boot
    ready = dict(protocol=PROTOCOL, operation_id=request["operation_id"],
                 request_digest=request["request_digest"], nonce=request["nonce"],
                 helper_identity=identity)
    _write(directory, "helper-ready.json", ready)
    bootstrap_deadline = time.monotonic() + 5
    while not _control(directory, "go.json", request["nonce"]):
        if time.monotonic() >= bootstrap_deadline:
            return 2
        time.sleep(.005)
    leader = _fork_payload(request)
    deadline = time.monotonic() + request["timeout_seconds"]
    exit_code = None
    reason = None
    cleanup_deadline = None
    unexpected = False
    while True:
        exit_code, echild = _reap(leader, exit_code)
        if reason is None:
            try:
                if _control(directory, "stop.json", request["nonce"]):
                    reason = "cancelled"
                elif exit_code is not None:
                    reason = "exited"
                elif time.monotonic() >= deadline:
                    reason = "timeout"
            except (OSError, ValueError, TypeError, RecursionError):
                unexpected = True
                reason = "cancelled"
            if reason is not None:
                cleanup_deadline = time.monotonic() + 1
        if echild:
            if unexpected or exit_code is None or reason is None:
                return 2
            proof = dict(ready, admitted=True, fork_gate_closed=True, wait_echild=True,
                         leader_exit_code=exit_code, reason=reason, effects_resolved=False)
            _write(directory, "closure.json", proof)
            return 0
        if cleanup_deadline is not None:
            if time.monotonic() >= cleanup_deadline:
                return 2
            try:
                _kill_children()
            except (OSError, ValueError):
                # A later *kernel* ECHILD may still prove closure despite a
                # visibility/resource/signal failure. Never use an empty scan.
                pass
        time.sleep(.005)


def main():
    try:
        if len(sys.argv) != 2:
            return 2
        return run(int(sys.argv[1]))
    except BaseException:
        # Helper diagnostics must not contaminate payload stdout/stderr.
        return 2


if __name__ == "__main__":
    sys.exit(main())
