"""Fetch and verify the explicitly pinned upstream; never install or execute its scripts."""
from __future__ import annotations
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOCK = json.loads((ROOT / 'upstream.lock.json').read_text())


def git(path, *args):
    return subprocess.check_output(['git', '-C', str(path), *args], text=True).strip()


def verify(source):
    source = Path(source).resolve()
    if git(source, 'rev-parse', 'HEAD') != LOCK['commit']:
        raise ValueError('upstream commit mismatch')
    package = source / 'tokeneconomizer'
    actual = {}
    for p in sorted(package.rglob('*')):
        if p.is_symlink():
            raise ValueError('upstream package contains symlink')
        if p.is_file():
            actual[p.relative_to(source).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    if package.is_symlink() or actual != LOCK['files']:
        raise ValueError('upstream package manifest mismatch (modified, missing or extra files)')
    return source


def prepare(destination):
    destination = Path(destination).absolute()
    if destination.exists():
        return verify(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # No setup.py/pip/npm, post-checkout hook, global plugin installation or model request.
    subprocess.run(['git', 'clone', '--no-checkout', '--filter=blob:none',
                    LOCK['repository'], str(destination)], check=True)
    subprocess.run(['git', '-C', str(destination), '-c', 'core.hooksPath=/dev/null',
                    'checkout', '--detach', LOCK['commit']], check=True)
    return verify(destination)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--destination', type=Path, default=ROOT / '.upstream/TokenEconomizer')
    args = p.parse_args()
    prepare(args.destination)
    print('Verified Microsoft TokenEconomizer ' + LOCK['commit'])
