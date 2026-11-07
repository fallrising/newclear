"""Install an irreversible, process-local Linux network deny before SDK import."""

from __future__ import annotations

import ctypes
import ctypes.util
import errno
import os
import socket
import sys


DENIED = ("socket", "socketpair", "connect", "sendto", "sendmsg", "sendmmsg")


def local_environment() -> None:
    """Remove implicit cloud configuration without reading or logging its value."""
    for key in tuple(os.environ):
        if key.endswith(("_API_KEY", "_AUTH_TOKEN")) or key in (
            "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "MEMVID_TOKEN", "OPENAI_TOKEN",
        ):
            os.environ.pop(key, None)
    os.environ.update({
        "MEMVID_TELEMETRY": "0", "MEMVID_OFFLINE": "1",
        "HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
        "TRANSFORMERS_OFFLINE": "1", "TOKENIZERS_PARALLELISM": "false",
    })


def deny_network() -> dict:
    """Deny socket creation and sends for this process and all descendants.

    This is a runtime test boundary, not a general sandbox for hostile programs.
    It is installed before native libraries create threads. It needs Linux and
    libseccomp but no root privileges; it never changes host firewall rules.
    """
    if sys.platform != "linux":
        raise RuntimeError("Offline acceptance requires Linux and libseccomp")
    name = ctypes.util.find_library("seccomp")
    if not name:
        raise RuntimeError("libseccomp is required for offline acceptance")
    lib = ctypes.CDLL(name, use_errno=True)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_rule_add.restype = ctypes.c_int
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_load.restype = ctypes.c_int
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    context = lib.seccomp_init(0x7FFF0000)  # SCMP_ACT_ALLOW
    if not context:
        raise RuntimeError("Could not allocate seccomp filter")
    try:
        for syscall in DENIED:
            number = lib.seccomp_syscall_resolve_name(syscall.encode("ascii"))
            if number < 0:
                raise RuntimeError(f"Unknown syscall: {syscall}")
            result = lib.seccomp_rule_add(context, 0x00050000 | errno.EPERM, number, 0)
            if result != 0:
                raise RuntimeError(f"Could not add {syscall} rule: {result}")
        result = lib.seccomp_load(context)
        if result != 0:
            raise RuntimeError(f"Could not load network filter: {result}")
    finally:
        lib.seccomp_release(context)
    checks = {}
    for label, family in (("ipv4", socket.AF_INET), ("ipv6", socket.AF_INET6)):
        try:
            probe = socket.socket(family, socket.SOCK_STREAM)
        except OSError as exc:
            if exc.errno != errno.EPERM:
                raise RuntimeError(f"Unexpected {label} deny result: {exc.errno}") from exc
            checks[label] = "EPERM"
        else:
            probe.close()
            raise RuntimeError(f"Network filter did not deny {label} sockets")
    return {"mechanism": "Linux libseccomp", "denied_syscalls": list(DENIED),
            "probes": checks, "installed_before_sdk_import": True,
            "inherited_by_subprocesses": True}
