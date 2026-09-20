#!/usr/bin/env python3
"""Relay host-loopback HTTP bytes to one pinned Unix-domain socket."""

from __future__ import annotations

import argparse
import errno
import fcntl
import os
from pathlib import Path
import select
import signal
import socket
import stat
import sys
import threading


_BUFFER = 64 * 1024
_CLIENTS = 16
_IDLE_SECONDS = 60


class ProxyError(ValueError):
    pass


def _absolute_path(raw: str, label: str) -> Path:
    path = Path(raw)
    if (
        not raw
        or "\x00" in raw
        or "\n" in raw
        or not path.is_absolute()
        or ".." in path.parts
        or path.as_posix() != raw
    ):
        raise ProxyError(label + " is invalid")
    try:
        if path.parent.resolve(strict=True) != path.parent or path.parent.is_symlink():
            raise ProxyError(label + " parent is unsafe")
    except OSError as exc:
        raise ProxyError(label + " parent is unsafe") from exc
    return path


def _pin_socket(path: Path) -> tuple[int, str, tuple[int, int, int]]:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        parent = os.open(path.parent, flags)
        info = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
    except OSError as exc:
        try:
            os.close(parent)
        except (OSError, UnboundLocalError):
            pass
        raise ProxyError("Unix socket is unavailable") from exc
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
        os.close(parent)
        raise ProxyError("Unix socket is unsafe")
    return parent, path.name, (info.st_dev, info.st_ino, info.st_uid)


def _lock_pid(path: Path) -> tuple[int, tuple[int, int]]:
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        descriptor = os.open(path, flags, 0o600)
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid():
            raise ProxyError("PID file is unsafe")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.fchmod(descriptor, 0o600)
        os.ftruncate(descriptor, 0)
        os.write(descriptor, (str(os.getpid()) + "\n").encode("ascii"))
        os.fsync(descriptor)
        return descriptor, (info.st_dev, info.st_ino)
    except BlockingIOError as exc:
        try:
            os.close(descriptor)
        except (OSError, UnboundLocalError):
            pass
        raise ProxyError("proxy is already running") from exc
    except (OSError, ProxyError) as exc:
        try:
            os.close(descriptor)
        except (OSError, UnboundLocalError):
            pass
        if isinstance(exc, ProxyError):
            raise
        raise ProxyError("PID file is unsafe") from exc


def _same_socket(parent: int, name: str, identity: tuple[int, int, int]) -> bool:
    try:
        info = os.stat(name, dir_fd=parent, follow_symlinks=False)
    except OSError:
        return False
    return (
        stat.S_ISSOCK(info.st_mode)
        and (info.st_dev, info.st_ino, info.st_uid) == identity
        and info.st_nlink == 1
    )


def _relay(
    client: socket.socket,
    parent: int,
    name: str,
    identity: tuple[int, int, int],
    slots: threading.BoundedSemaphore,
) -> None:
    backend = None
    try:
        if not _same_socket(parent, name, identity):
            return
        backend = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        backend.settimeout(_IDLE_SECONDS)
        backend.connect(f"/proc/self/fd/{parent}/{name}")
        client.settimeout(_IDLE_SECONDS)
        peers = {client: backend, backend: client}
        while True:
            readable, _, _ = select.select(tuple(peers), (), (), _IDLE_SECONDS)
            if not readable:
                return
            for source in readable:
                chunk = source.recv(_BUFFER)
                if not chunk:
                    return
                peers[source].sendall(chunk)
    except (OSError, ValueError):
        return
    finally:
        if backend is not None:
            backend.close()
        client.close()
        slots.release()


def _serve(args: argparse.Namespace) -> int:
    if args.listen != "127.0.0.1" or not 1024 <= args.port <= 65535:
        return 64
    try:
        unix_path = _absolute_path(args.unix_socket, "Unix socket")
        pid_path = _absolute_path(args.pid_file, "PID file")
        parent, name, identity = _pin_socket(unix_path)
        pid_descriptor, pid_identity = _lock_pid(pid_path)
    except ProxyError:
        return 73

    stop = threading.Event()

    def request_stop(_signum: int, _frame: object) -> None:
        stop.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    slots = threading.BoundedSemaphore(_CLIENTS)
    try:
        listener.bind(("127.0.0.1", args.port))
        listener.listen(_CLIENTS)
        listener.settimeout(0.5)
        while not stop.is_set():
            if not _same_socket(parent, name, identity):
                return 70
            try:
                client, peer = listener.accept()
            except socket.timeout:
                continue
            if peer[0] != "127.0.0.1" or not slots.acquire(blocking=False):
                client.close()
                continue
            threading.Thread(
                target=_relay,
                args=(client, parent, name, identity, slots),
                daemon=True,
            ).start()
        return 0
    except OSError as exc:
        return 73 if exc.errno == errno.EADDRINUSE else 70
    finally:
        listener.close()
        try:
            current = pid_path.lstat()
            if (current.st_dev, current.st_ino) == pid_identity:
                pid_path.unlink()
                directory = os.open(
                    pid_path.parent,
                    os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
                )
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
        except OSError:
            pass
        os.close(pid_descriptor)
        os.close(parent)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="loopback-uds-proxy")
    parser.add_argument("--listen", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--unix-socket", required=True)
    parser.add_argument("--pid-file", required=True)
    return _serve(parser.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
