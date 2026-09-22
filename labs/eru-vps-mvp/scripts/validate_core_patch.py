#!/usr/bin/env python3
"""Validate/build the pinned core patch with an isolated official Go toolchain."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import urllib.request

from labops import atomic_json

PROJECT = Path(__file__).resolve().parent.parent
GO_VERSION = 'go1.27.1'
GO_SHA256 = '63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445'
TESTS = '^TestWithNodesPlanLocked(NilContextOnLockFailure|PartialFailureUnlocks)$'


def apply_source_patch(source, patch, *, include=None, check=False):
    # Keep upstream-relative paths independent of any enclosing monorepo.
    subprocess.run(['git', 'init', '--quiet'], cwd=source, check=True)
    argv = ['git', 'apply']
    if check:
        argv.append('--check')
    if include:
        argv.append('--include=' + include)
    subprocess.run([*argv, str(patch)], cwd=source, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Existing core Git checkout; read via git archive only')
    parser.add_argument('--output', type=Path, required=True, help='New isolated private build directory')
    args = parser.parse_args()
    os.umask(0o077)
    root = args.output.resolve()
    root.mkdir(parents=True, mode=0o700)  # never reuse an uncertain build
    commit = json.loads((PROJECT / 'upstream.lock.json').read_text())['core']['commit']
    patch = (PROJECT / 'patches/core-v0.1.5-lock-context.patch').resolve()
    report = {'source_commit': commit, 'patch_sha256': hashlib.sha256(patch.read_bytes()).hexdigest(),
              'go_version': GO_VERSION, 'go_archive_sha256': GO_SHA256, 'steps': [], 'status': 'running'}
    source = root / 'core'; source.mkdir()
    archive = subprocess.check_output(['git', '-C', str(args.source.resolve()), 'archive', commit])
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(source, filter='data')
    download = root / (GO_VERSION + '.linux-amd64.tar.gz')
    with urllib.request.urlopen('https://go.dev/dl/' + download.name, timeout=60) as src, download.open('wb') as dst:
        while data := src.read(1024 * 1024):
            dst.write(data)
    if hashlib.sha256(download.read_bytes()).hexdigest() != GO_SHA256:
        raise ValueError('official toolchain checksum mismatch')
    with tarfile.open(download) as tar:
        tar.extractall(root, filter='data')
    env = os.environ.copy()
    env.update(GOROOT=str(root / 'go'), GOPATH=str(root / 'gopath'), GOCACHE=str(root / 'cache'),
               GOTOOLCHAIN='local', GOENV='off', GOWORK='off', GOMAXPROCS='4', GOFLAGS='-mod=readonly -p=4')
    go = str(root / 'go/bin/go')

    def run(name, argv):
        with (root / (name + '.log')).open('w') as log:
            result = subprocess.run(argv, cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
        report['steps'].append({'name': name, 'argv': argv, 'exit_code': result.returncode})
        atomic_json(root / 'result.json', report)
        print(name, result.returncode, flush=True)
        return result.returncode

    try:
        apply_source_patch(source, patch, check=True)
        apply_source_patch(source, patch, include='cluster/calcium/lock_test.go')
        failed = run('baseline', [go, 'test', './cluster/calcium', '-run', TESTS, '-count=1'])
        baseline = (root / 'baseline.log').read_text()
        if not failed or baseline.count('cannot create context from nil parent') < 2:
            raise ValueError('baseline did not reproduce both expected nil-context failures')
        apply_source_patch(source, patch, include='cluster/calcium/lock.go')
        for name, argv in [
            ('regression', [go, 'test', './cluster/calcium', '-run', TESTS, '-count=1']),
            ('calcium', [go, 'test', './cluster/calcium', '-count=1']),
            ('locks', [go, 'test', './lock/...', '-count=1']),
            ('build', [go, 'build', '-buildvcs=false', '-trimpath', '-o', str(root / 'eru-core'), '.']),
        ]:
            if run(name, argv):
                raise RuntimeError(name + ' failed; see private log')
        report['artifact_sha256'] = hashlib.sha256((root / 'eru-core').read_bytes()).hexdigest()
        report['status'] = 'verified-not-deployed'
    except BaseException as exc:
        report.update(status='failed', error=str(exc))
        raise
    finally:
        atomic_json(root / 'result.json', report)


if __name__ == '__main__':
    main()
