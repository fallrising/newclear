#!/usr/bin/env python3
"""Validate/build the pinned core patch with an isolated official Go toolchain."""
import argparse
import hashlib
import io
import json
import os
import re
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
    parser.add_argument('--patch', type=Path, default=PROJECT / 'patches/core-v0.1.5-lock-context.patch',
                        help='Reviewed patch file under patches/')
    parser.add_argument('--patch-revision', type=int, default=1)
    parser.add_argument('--go-version', default=GO_VERSION,
                        help='Pinned official Go release used to build; default is the reviewed Go 1.27.1')
    parser.add_argument('--go-sha256',
                        help='Expected SHA256 of the official Go archive; required when overriding --go-version')
    parser.add_argument('--compatibility-from', action='append', default=[], metavar='VERSION=./PACKAGE',
                        help='Run a version-specific Go compatibility test package; repeat for each supported source version')
    args = parser.parse_args()
    os.umask(0o077)
    root = args.output.resolve()
    root.mkdir(parents=True, mode=0o700)  # never reuse an uncertain build
    upstream = json.loads((PROJECT / 'upstream.lock.json').read_text())['core']
    commit, source_tag = upstream['commit'], upstream['tag']
    patch_input = args.patch if args.patch.is_absolute() else PROJECT / args.patch
    patch = patch_input.resolve()
    patch_dir = (PROJECT / 'patches').resolve()
    if (patch_input.is_symlink() or not patch.is_relative_to(patch_dir) or not patch.is_file()
            or patch.suffix != '.patch'):
        raise ValueError('--patch must be a regular reviewed patch file under patches/')
    if args.patch_revision < 1:
        raise ValueError('--patch-revision must be positive')
    version_re = re.compile(r'^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')
    if not version_re.fullmatch(source_tag):
        raise ValueError('upstream.lock core tag must be a stable vMAJOR.MINOR.PATCH')
    compatibility_tests = []
    seen_versions = {source_tag}
    for spec in args.compatibility_from:
        version, separator, package = spec.partition('=')
        package_re = re.compile(r'^\./[A-Za-z0-9_./*+-]+$')
        if (not separator or not version_re.fullmatch(version) or version in seen_versions
                or not package_re.fullmatch(package) or '..' in Path(package).parts):
            raise ValueError('--compatibility-from must be a unique VERSION=./PACKAGE Go test package')
        seen_versions.add(version)
        compatibility_tests.append((version, package))
    compatible = [source_tag, *(version for version, _ in compatibility_tests)]
    go_version = args.go_version
    go_sha256 = args.go_sha256 or (GO_SHA256 if go_version == GO_VERSION else None)
    if (not re.fullmatch(r'go[0-9]+\.[0-9]+\.[0-9]+', go_version)
            or not go_sha256 or not re.fullmatch(r'[0-9a-f]{64}', go_sha256)):
        raise ValueError('select an exact Go version and expected official archive SHA256')
    release_id = f'core-{source_tag}-{patch.stem}-r{args.patch_revision}'
    architecture = json.loads((PROJECT / 'artifacts.amd64.lock.json').read_text())['architecture']
    report = {'schema_version': 1, 'release_id': release_id, 'repository': 'projecteru2/core',
              'source_tag': source_tag, 'target_version': source_tag, 'patch_revision': args.patch_revision,
              'compatible_from_versions': compatible, 'architecture': architecture, 'patch_file': patch.name,
              'source_commit': commit, 'patch_sha256': hashlib.sha256(patch.read_bytes()).hexdigest(),
              'toolchain': {'version': go_version, 'os': 'linux', 'arch': 'amd64',
                            'sha256': go_sha256},
              'go_version': go_version, 'go_archive_sha256': go_sha256, 'steps': [], 'status': 'running',
              'independent_runner_verification': {'status': 'pending', 'artifact_sha256': None,
                                                   'byte_identical_to_first_build': False, 'steps': []}}
    source = root / 'core'; source.mkdir()
    archive = subprocess.check_output(['git', '-C', str(args.source.resolve()), 'archive', commit])
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(source, filter='data')
    download = root / (go_version + '.linux-amd64.tar.gz')
    with urllib.request.urlopen('https://go.dev/dl/' + download.name, timeout=60) as src, download.open('wb') as dst:
        while data := src.read(1024 * 1024):
            dst.write(data)
    if hashlib.sha256(download.read_bytes()).hexdigest() != go_sha256:
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
        for version, package in compatibility_tests:
            name = 'compatibility-from-' + version
            if run(name, [go, 'test', package, '-count=1']):
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
