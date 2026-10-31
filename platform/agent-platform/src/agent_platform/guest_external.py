"""Fixed guest-only helper: root drops all authority before workspace access.

This file is installed root-owned and hash-attested before each operation. No
repository module is imported, even during checkout/result verification.
"""

import ctypes
import json
import os
import resource
import selectors
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path("/home/agentprobe/workspace")
LIMIT = 32768
ENV = {
    "HOME": "/home/agentprobe",
    "USER": "agentprobe",
    "LOGNAME": "agentprobe",
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
    "PYTHONDONTWRITEBYTECODE": "1",
}


def drop_privileges():
    if os.getuid() != 0 or os.geteuid() != 0:
        raise RuntimeError("external_launcher_denied")
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(4, 0, 0, 0, 0):  # PR_SET_DUMPABLE
        raise RuntimeError("external_launcher_denied")
    os.setgroups([])
    os.setresgid(2000, 2000, 2000)
    os.setresuid(2000, 2000, 2000)
    if libc.prctl(38, 1, 0, 0, 0) or libc.prctl(4, 0, 0, 0, 0):
        raise RuntimeError("external_launcher_denied")
    if (
        os.getresuid() != (2000, 2000, 2000)
        or os.getresgid() != (2000, 2000, 2000)
        or os.getgroups()
    ):
        raise RuntimeError("external_launcher_denied")
    os.environ.clear()
    os.environ.update(ENV)


def file_operation(request):
    # Open every component relative to an already-open directory. No symlink or
    # path-resolution race can redirect this capability outside the workspace.
    parts = request["path"].split("/")
    if any(part in {"", ".", ".."} for part in parts) or "\x00" in request["path"]:
        raise ValueError("workspace_path_invalid")
    parent = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        writing = request["action"] == "write"
        flags = (
            os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_WRONLY | os.O_CREAT if writing else os.O_RDONLY)
        )
        fd = os.open(parts[-1], flags, 0o600, dir_fd=parent)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError("workspace_file_not_regular")
            if writing:
                content = request["content"].encode()
                if len(content) > LIMIT:
                    raise ValueError("workspace_content_limit")
                os.ftruncate(fd, 0)
                with os.fdopen(os.dup(fd), "wb") as stream:
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
                return {"ok": True, "bytes": len(content)}
            with os.fdopen(os.dup(fd), "rb") as stream:
                content = stream.read(LIMIT + 1)
            if len(content) > LIMIT:
                raise ValueError("workspace_content_limit")
            return {"ok": True, "content": content.decode("utf-8")}
        finally:
            os.close(fd)
    finally:
        os.close(parent)


def command(request):
    process = subprocess.Popen(
        request["argv"],
        cwd=ROOT,
        env=ENV,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        close_fds=True,
        start_new_session=True,
        bufsize=0,
    )
    output = bytearray()
    selector = selectors.DefaultSelector()
    deadline = time.monotonic() + request["timeout_seconds"]
    status = "completed"
    try:
        os.set_blocking(process.stdout.fileno(), False)
        selector.register(process.stdout, selectors.EVENT_READ)
        while process.poll() is None or selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                status = "timeout"
                break
            for key, _ in selector.select(min(0.1, remaining)):
                chunk = os.read(key.fd, min(65536, LIMIT + 1 - len(output)))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                output.extend(chunk)
                if len(output) > LIMIT:
                    status = "output_limit"
                    break
            if status != "completed":
                break
        if status != "completed":
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait(timeout=2)
        # Kill descendants in the original process group even if stdout closed.
        # Escaped groups are independently detected by root guest attestation.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        return {
            "ok": True,
            "status": status,
            "exit_code": process.returncode,
            "output": bytes(output[:LIMIT]).decode("utf-8", errors="replace"),
        }
    finally:
        selector.close()
        process.stdout.close()
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=2)


def main():
    request = json.loads(sys.argv[1])
    # Load the trusted sibling while isolated Python sys.path excludes cwd; never
    # import repository code with root authority.
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "workspace_helper", "/opt/agent-platform/guest_workspace.py"
    )
    workspace = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(workspace)
    drop_privileges()
    action = request["action"]
    if action == "checkout":
        ROOT.mkdir(mode=0o700)
        workspace.git("init", "--quiet")
        workspace.git("fetch", "--quiet", "/opt/agent-platform/source.bundle", request["base_sha"])
        workspace.git("checkout", "--quiet", "--detach", request["base_sha"])
        actual = workspace.git("rev-parse", "HEAD").decode().strip()
        if actual != request["base_sha"]:
            raise RuntimeError("checkout_sha_mismatch")
        value = {"base_sha": actual}
    elif action == "result":
        value = workspace.result(request)
    else:
        os.chdir(ROOT)
        try:
            value = command(request) if action == "exec" else file_operation(request)
        except (OSError, ValueError):
            value = {"ok": False, "error": "workspace_operation_refused"}
    print(json.dumps(value, ensure_ascii=False))


if __name__ == "__main__":
    main()
