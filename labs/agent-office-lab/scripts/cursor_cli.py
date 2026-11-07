#!/usr/bin/env python3
"""Pinned official Cursor CLI installation, offline preflight and isolated owner login."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from remote_cli import LAB, private_directory

PIN = json.loads((LAB / 'tools/cursor/cli-lock.json').read_text())
FLAGS = ['--resume', '--model', '--trust', '--workspace', '--output-format', '--sandbox']


def isolated_cursor_env(home, parent=None):
    parent = os.environ if parent is None else parent
    env = {k: parent[k] for k in ('PATH', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM') if k in parent}
    env.update(HOME=str(home), TMPDIR=str(home), CURSOR_CONFIG_DIR=str(home / '.cursor'),
               AGENT_CLI_CREDENTIAL_STORE='file', NO_OPEN_BROWSER='1', NO_COLOR='1')
    return env


def tree_digest(root):
    digest = hashlib.sha256()
    for path in sorted(root.rglob('*')):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError('runtime_link_or_special_file')
        if path.is_file():
            digest.update((path.relative_to(root).as_posix() + '\0' +
                           hashlib.sha256(path.read_bytes()).hexdigest() + '\n').encode())
    return digest.hexdigest()


def installed_cli(lab=LAB, pin=PIN):
    root = lab / 'tools/cursor/runtime' / pin['version']
    if not root.resolve().is_relative_to(lab.resolve()) or root.is_symlink():
        raise ValueError('runtime_outside_lab')
    binary = root / 'cursor-agent'
    if not binary.is_file(): raise ValueError('not_installed')
    if tree_digest(root) != pin['runtime_tree_sha256']: raise ValueError('runtime_digest_mismatch')
    if json.loads((root / 'package.json').read_text()).get('name') != pin['package']:
        raise ValueError('package_identity_mismatch')
    if not os.access(binary, os.X_OK): raise ValueError('entrypoint_not_executable')
    return binary.resolve()


def extract_archive(archive, destination):
    # Only ordinary files/directories under the official package root are accepted.
    with tarfile.open(archive) as bundle:
        members = bundle.getmembers()
        if sum(m.size for m in members) > 1024 * 1024 * 1024: raise ValueError('archive_too_large')
        seen = set()
        for member in members:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0] != 'dist-package' or not (member.isfile() or member.isdir()) or name in seen:
                raise ValueError('unsafe_archive_member')
            seen.add(name)
        for member in members:
            target = destination.joinpath(*PurePosixPath(member.name).parts[1:])
            if member.isdir(): target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(member) as source, target.open('xb') as dest:
                    shutil.copyfileobj(source, dest)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)


def install(archive=None):
    if sys.platform != 'darwin' or platform.machine() != 'arm64':
        raise ValueError('pinned_platform_requires_macos_arm64')
    parent = private_directory(LAB / 'tools/cursor/runtime')
    final = parent / PIN['version']
    if final.exists() or final.is_symlink():
        installed_cli(); return
    with tempfile.TemporaryDirectory(dir=parent, prefix='.install-') as tmp:
        tmp = Path(tmp)
        if archive is None:
            archive = tmp / 'download.tar.gz'
            with urllib.request.urlopen(PIN['url'], timeout=60) as response, archive.open('xb') as dest:
                if response.url != PIN['url']: raise ValueError('unexpected_download_redirect')
                count = 0
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > 512 * 1024 * 1024: raise ValueError('download_too_large')
                    dest.write(chunk)
        if hashlib.sha256(Path(archive).read_bytes()).hexdigest() != PIN['archive_sha256']:
            raise ValueError('archive_digest_mismatch')
        stage = tmp / 'runtime'; stage.mkdir()
        extract_archive(archive, stage)
        if tree_digest(stage) != PIN['runtime_tree_sha256']: raise ValueError('runtime_digest_mismatch')
        stage.rename(final)
    installed_cli()


def assess(version, help_text, pin=PIN):
    if version.strip() != pin['version']: return 'cli_version_mismatch'
    if 'Start the Cursor Agent' not in help_text: return 'cli_identity_mismatch'
    if any(not re.search(re.escape(flag) + r'(?=[\s,=<>\[])', help_text) for flag in FLAGS):
        return 'required_capability_missing'
    return None


def probe(lab=LAB):
    result = {'provider': 'cursor', 'version': PIN['version'], 'compatible': False,
              'model_inference_verified': False, 'authentication_verified': False}
    try:
        binary = installed_cli(lab)
        if sys.platform != 'darwin': raise ValueError('network_denied_probe_requires_macos')
        with tempfile.TemporaryDirectory(prefix='office-cursor-check-') as tmp:
            env = isolated_cursor_env(Path(tmp))
            def run(args):
                return subprocess.run(['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)',
                    str(binary), *args], cwd=tmp, env=env, stdin=subprocess.DEVNULL,
                    capture_output=True, text=True, timeout=30)
            version, help_result = run(['--version']), run(['--help'])
            if version.returncode or help_result.returncode: raise ValueError('version_or_help_failed')
            reason = assess(version.stdout, help_result.stdout)
            if reason: raise ValueError(reason)
            result.update(compatible=True, network_denied=True, required_flags=FLAGS,
                          runtime_tree_sha256=PIN['runtime_tree_sha256'])
    except ValueError as error:
        result['reason'] = str(error)
    except (OSError, subprocess.SubprocessError):
        result['reason'] = 'probe_failed_or_timed_out'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'check', 'login'])
    parser.add_argument('--archive', type=Path, help='Previously downloaded official archive; install only')
    args = parser.parse_args()
    if args.archive and args.action != 'install': parser.error('--archive is only for install')
    if args.action == 'install':
        install(args.archive); print('Installed and verified pinned Cursor CLI inside the lab.'); return 0
    check = probe()
    if args.action == 'check' or not check['compatible']:
        print(json.dumps(check, indent=2)); return 0 if check['compatible'] else 1
    # Explicit owner login only. Never use system keychain or inherit API keys/endpoints/hooks.
    os.umask(0o077)
    home = private_directory(LAB / '.local/remote/cursor-home')
    private_directory(home / '.cursor')
    workspace = private_directory(home / 'login-workspace')
    return subprocess.call([str(installed_cli()), 'login'], cwd=workspace, env=isolated_cursor_env(home))


if __name__ == '__main__':
    try: raise SystemExit(main())
    except (OSError, ValueError, tarfile.TarError):
        print('Cursor setup failed; inspect installation or isolated directories. No credential is printed.', file=sys.stderr)
        raise SystemExit(1)
