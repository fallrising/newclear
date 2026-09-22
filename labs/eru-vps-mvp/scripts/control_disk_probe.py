"""Root-side bounded fdatasync probe for 01; run through control_health --disk-probe.

Writes at most 480 KiB through one unique 4 KiB scratch file, then unlinks only
that file. It does not touch etcd data, keys, configuration or service state.
"""
import json
import os
from pathlib import Path
import tempfile
import time


def probe():
    root = Path('/var/lib/eru-mvp')
    if root.is_symlink() or root.stat().st_uid != 0 or root.stat().st_mode & 0o022:
        raise ValueError('unsafe diagnostic directory')
    if json.loads((root / 'owner.json').read_text())['owner'] != 'eru-vps-mvp':
        raise ValueError('unowned diagnostic directory')
    fd, name = tempfile.mkstemp(prefix='fsync-diagnostic-', dir=root)
    samples = []
    try:
        for _ in range(120):
            if os.pwrite(fd, os.urandom(4096), 0) != 4096:
                raise RuntimeError('short diagnostic write')
            start = time.monotonic()
            os.fdatasync(fd)
            samples.append(time.monotonic() - start)
            time.sleep(.25)
    finally:
        os.close(fd)
        os.unlink(name)
    return {'sample_count': len(samples), 'seconds': samples, 'max_seconds': max(samples),
            'p99_seconds': sorted(samples)[118], 'file_removed': not Path(name).exists(),
            'scope': 'unique 4KiB scratch file on same filesystem; no etcd data writes'}


if __name__ == '__main__':
    print(json.dumps(probe()))
