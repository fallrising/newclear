"""Best-effort Python audit guard for trusted pinned code, not an OS security sandbox."""
from __future__ import annotations
import os
from pathlib import Path
import sys


def install(sandbox, source):
    sandbox = Path(sandbox).resolve()
    readable = (sandbox, Path(source).resolve(), Path(__file__).resolve().parent,
                Path(sys.base_prefix).resolve(), Path(sys.prefix).resolve())
    blocked = []

    def check_path(value, write=False):
        if isinstance(value, int) or value is None:
            return  # stdout/stderr/anonymous temporary-file descriptors
        p = Path(os.fsdecode(value)).resolve()
        roots = (sandbox,) if write else readable
        if not any(p == r or r in p.parents for r in roots):
            blocked.append('file-write' if write else 'file-read')
            raise PermissionError('lab guard: file access outside isolated roots')

    def guard(event, args):
        if event.startswith('socket.') or event in {
            'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.fork', 'os.exec',
        }:
            blocked.append(event)
            raise PermissionError('lab guard: network and child processes disabled')
        if event == 'open':
            mode, flags = args[1], args[2]
            writing = bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND))
            writing = writing or (isinstance(mode, str) and any(c in mode for c in 'wax+'))
            check_path(args[0], writing)
        elif event in {'os.mkdir', 'os.remove', 'os.rmdir', 'os.chmod', 'os.utime'}:
            check_path(args[0], True)
        elif event in {'os.rename', 'os.link', 'os.symlink'}:
            check_path(args[0], True)
            check_path(args[1], True)
        elif event in {'os.listdir', 'os.scandir', 'os.chdir'} and args:
            check_path(args[0])

    sys.dont_write_bytecode = True
    sys.addaudithook(guard)
    return blocked
