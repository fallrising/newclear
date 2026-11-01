#!/usr/bin/env python3
"""Execute the real pinned package against synthetic inputs in a fresh offline child."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from source import LOCK, ROOT, verify


def run(source):
    source = verify(source)
    with tempfile.TemporaryDirectory(prefix='te-lab-') as tmp:
        # Import ONLY manifest-verified package bytes, never the checkout root. Root-level
        # untracked shlex.py/json.py/etc. must not shadow standard-library dependencies.
        import_root = Path(tmp) / 'verified-upstream'
        for relative, digest in LOCK['files'].items():
            original = source / relative
            data = original.read_bytes()
            if original.is_symlink() or hashlib.sha256(data).hexdigest() != digest:
                raise ValueError('upstream changed while staging verified package')
            target = import_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        # Do not inherit tokens, provider endpoints, host CLI settings, PYTHONPATH, or HOME.
        env = {'HOME': tmp, 'TMPDIR': tmp, 'PATH': '', 'PYTHONDONTWRITEBYTECODE': '1',
               'PYTHONUTF8': '1', 'TOKENECONOMIZER_HOME': str(Path(tmp) / 'te-home')}
        result = subprocess.run([sys.executable, '-I', '-B', str(ROOT / 'scenarios.py'),
                                 '--source', str(import_root), '--sandbox', tmp],
                                env=env, cwd=tmp, text=True, capture_output=True, timeout=120)
        if result.returncode:
            raise RuntimeError('scenario worker failed:\n' + result.stderr.replace(tmp, '<sandbox>'))
        report = json.loads(result.stdout)
        report['upstream'] = {'repository': LOCK['repository'], 'commit': LOCK['commit'],
                              'package_files_verified': len(LOCK['files'])}
        return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, default=ROOT / '.upstream/TokenEconomizer')
    p.add_argument('--out', type=Path, help='new report path; existing files are never overwritten')
    args = p.parse_args()
    report = run(args.source)
    text = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open('x', encoding='utf-8') as f:
            f.write(text)
    print(text, end='')
