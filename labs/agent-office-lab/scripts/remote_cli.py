#!/usr/bin/env python3
"""Pinned remote CLI preflight and isolated owner authentication. Never runs a model task."""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

LAB = Path(__file__).resolve().parents[1]
SPECS = {
    'pi': {'package': '@earendil-works/pi-coding-agent', 'version': '1.4.0',
           'bin': 'dist/bundle/cli.js', 'banner': 'pi - AI coding assistant',
           'flags': ['--model', '--provider', '--extension', '--session-dir', '--session-id',
                     '--no-extensions', '--no-mcp', '--no-context-files', '--offline']},
    'grok': {'package': '@xai-official/grok', 'version': '1.0.70', 'bin': 'bin/grok',
             'banner': 'Grok Build TUI',
             'flags': ['--model', '--resume', '--session-id', '--leader-socket', '--no-alt-screen']},
}


def isolated_env(home, provider, parent=None):
    parent = os.environ if parent is None else parent
    env = {k: parent[k] for k in ('PATH', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM') if k in parent}
    env.update(HOME=str(home), TMPDIR=str(home), NO_COLOR='1')
    if provider == 'pi':
        env.update(PI_CODING_AGENT_DIR=str(home / 'pi'), PI_OFFLINE='1', PI_TELEMETRY='0')
    else:
        env['GROK_HOME'] = str(home / 'grok')
    return env


def installed_cli(provider, lab=LAB):
    spec = SPECS[provider]
    package = lab / 'tools' / provider / 'node_modules' / spec['package']
    if not package.resolve().is_relative_to(lab.resolve()):
        raise ValueError('package_outside_lab')
    manifest = package / 'package.json'
    if not manifest.is_file():
        raise ValueError('not_installed')
    try:
        meta = json.loads(manifest.read_text())
    except (ValueError, OSError):
        raise ValueError('invalid_package_metadata') from None
    if not isinstance(meta, dict):
        raise ValueError('invalid_package_metadata')
    if meta.get('name') != spec['package'] or meta.get('version') != spec['version']:
        raise ValueError('package_identity_or_version_mismatch')
    bins = meta.get('bin', {})
    if not isinstance(bins, dict) or bins.get(provider) != spec['bin']:
        raise ValueError('package_entrypoint_mismatch')
    binary = package / spec['bin']
    if not binary.is_file() or not binary.resolve().is_relative_to(package.resolve()):
        raise ValueError('entrypoint_missing_or_outside_package')
    return binary.resolve()


def assess(provider, version, help_text, trust_accepted=True):
    spec = SPECS[provider]
    if not re.search(r'(?<![\w.])' + re.escape(spec['version']) + r'(?![\w.])', version):
        return 'cli_version_mismatch'
    if spec['banner'] not in help_text:
        return 'cli_identity_mismatch'
    if any(not re.search(re.escape(flag) + r'(?=[\s,=<>\[])', help_text) for flag in spec['flags']):
        return 'required_capability_missing'
    if provider == 'grok' and not trust_accepted:
        return 'native_adapter_trust_flag_unsupported'
    return None


def probe(provider, lab=LAB):
    spec = SPECS[provider]
    result = {'provider': provider, 'package': spec['package'], 'pinned_version': spec['version'],
              'compatible': False, 'model_inference_verified': False, 'authentication_verified': False}
    try:
        binary = installed_cli(provider, lab)
        if sys.platform != 'darwin' or not Path('/usr/bin/sandbox-exec').is_file():
            raise ValueError('network_denied_probe_requires_macos')
        with tempfile.TemporaryDirectory(prefix='office-cli-check-') as directory:
            home = Path(directory)
            env = isolated_env(home, provider)
            def run(args):
                return subprocess.run(['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)',
                                       str(binary), *args], cwd=home, env=env, stdin=subprocess.DEVNULL,
                                      capture_output=True, text=True, timeout=20)
            version, help_result = run(['--version']), run(['--help'])
            if version.returncode or help_result.returncode:
                raise ValueError('version_or_help_failed')
            trust = provider != 'grok' or run(['--trust', '--help']).returncode == 0
            error = assess(provider, version.stdout, help_result.stdout, trust)
            if error:
                raise ValueError(error)
            result.update(compatible=True, network_denied=True, required_flags=spec['flags'],
                          version=spec['version'], executable_sha256=hashlib.sha256(binary.read_bytes()).hexdigest())
            if provider == 'grok':
                result['native_adapter_trust_flag_accepted'] = True
                result['workspace_trust_must_be_disclosed_before_task'] = True
    except ValueError as error:
        result['reason'] = str(error)
    except (OSError, subprocess.SubprocessError):
        # Never expose arbitrary CLI stderr, environment, private paths or credentials.
        result['reason'] = 'probe_failed_or_timed_out'
    return result


def private_directory(path, root=LAB):
    if not path.is_relative_to(root):
        raise ValueError('Private directory must be inside the lab')
    current = root
    for part in path.relative_to(root).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('Private directory cannot contain symlinks')
        current.mkdir(mode=0o700, exist_ok=True)
        current.chmod(0o700)
    return path


def write_new_private(path, payload):
    # Existing credentials are never overwritten by setup; no following symlinks.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(payload, handle, indent=2)
        handle.write('\n')


def setup_pi(key, lab=LAB):
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,512}', key):
        raise ValueError('Expected a DeepSeek API key; whitespace, interpolation and commands are not accepted')
    home = private_directory(lab / '.local/remote', lab)
    agent = private_directory(home / 'pi', lab)
    auth = agent / 'auth.json'
    if auth.exists() or auth.is_symlink():
        raise ValueError('Isolated Pi credentials already exist; setup will not overwrite them')
    models = agent / 'models.json'
    expected = json.loads((lab / 'configs/pi-models.example.json').read_text())
    if models.is_symlink():
        raise ValueError('Pi model configuration cannot be a symlink')
    if not models.exists():
        write_new_private(models, expected)
    elif json.loads(models.read_text()) != expected:
        raise ValueError('Existing Pi model configuration differs from the isolated lab configuration')
    write_new_private(auth, {'deepseek': {'type': 'api_key', 'key': key}})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'setup-pi', 'login-grok'])
    parser.add_argument('--provider', choices=['pi', 'grok', 'all'], default='all')
    args = parser.parse_args()
    if args.action == 'check':
        selected = SPECS if args.provider == 'all' else [args.provider]
        results = [probe(provider) for provider in selected]
        print(json.dumps({'checks': results, 'remote_requests_sent': False}, indent=2))
        return 0 if all(row['compatible'] for row in results) else 1
    if args.provider != 'all':
        parser.error('--provider applies only to check')
    provider = 'pi' if args.action == 'setup-pi' else 'grok'
    result = probe(provider)
    if not result['compatible']:
        print(json.dumps(result)); return 1
    if args.action == 'setup-pi':
        if not sys.stdin.isatty():
            parser.error('Run setup-pi in your own terminal; keys are read without echo')
        setup_pi(getpass.getpass('DeepSeek API key (hidden): '))
        print('Saved isolated Pi credentials. No API request was sent; the key has not been validated.')
        return 0
    home = private_directory(LAB / '.local/remote')
    private_directory(home / 'grok')
    workspace = private_directory(home / 'login-workspace')
    # An explicit owner command opens only the native login, never a model task.
    return subprocess.call([str(installed_cli('grok')), 'login', '--device-auth'], cwd=workspace,
                           env=isolated_env(home, 'grok'))


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError):
        print('Setup failed. Check the private directory, existing credentials and key format; no secret is printed.', file=sys.stderr)
        raise SystemExit(1)
