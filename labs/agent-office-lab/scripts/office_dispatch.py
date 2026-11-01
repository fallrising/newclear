#!/usr/bin/env python3
"""One explicit entry for pinned synthetic Office tasks. Default: plan only."""
import pi_retry
import argparse
import json
import os
from pathlib import Path
import platform
import pty
import re
import select
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

import cursor_cli
from execution_slot import SlotError, acknowledge_stopped, execution_slot
import remote_cli

LAB = Path(__file__).resolve().parents[1]
VENDOR_COMMIT = '852e2ab28c4f3f31bffdf4b20353bd119c9d3270'
SPECS = {
    'opencode': {'model': 'strata/qwen3.8-flash-next-q2_0', 'version': '1.19.5',
                 'runner': 'run_local_work.py', 'args': ['--harness', 'office-opencode'],
                 'remote': False, 'timeout_seconds': None},
    'grok': {'model': 'grok-4.6', 'version': '1.0.70', 'runner': 'run_grok_work.py',
             'args': ['--allow-remote'], 'remote': True, 'timeout_seconds': 240},
    'pi': {'model': 'deepseek/deepseek-flash', 'version': '1.4.0', 'runner': 'run_pi_work.py',
           'args': ['--allow-remote'], 'remote': True, 'timeout_seconds': 180},
    'cursor': {'model': 'composer-2.5', 'version': cursor_cli.PIN['version'],
               'runner': 'run_cursor_work.py', 'args': ['--allow-remote'], 'remote': True, 'timeout_seconds': 120},
}


def strata_home(lab=LAB):
    return Path(os.environ.get('STRATA_HOME', str(lab.parent / 'strata-mac'))).expanduser().resolve()


def assess_opencode(version, help_text):
    if version.strip() != SPECS['opencode']['version']:
        return 'cli_version_mismatch'
    if 'opencode' not in help_text or 'opencode run' not in help_text:
        return 'cli_identity_mismatch'
    if any(not re.search(re.escape(flag) + r'(?=[\s,=<>\[])', help_text)
           for flag in ('--model', '--session', '--port', '--hostname')):
        return 'required_capability_missing'
    return None


def capture_probe(command, directory, env, timeout=20):
    """The pinned Bun CLI needs a PTY to flush its help before exiting."""
    master, slave = pty.openpty()
    process, complete = None, False
    try:
        try:
            process = subprocess.Popen(command, cwd=directory, env=env, stdin=subprocess.DEVNULL,
                                       stdout=slave, stderr=slave, start_new_session=True)
        finally:
            os.close(slave)
        output = bytearray()
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([master], [], [], remaining)[0]:
                raise ValueError('probe_timed_out')
            try:
                chunk = os.read(master, 4096)
            except OSError as error:
                if error.errno != 5:  # Linux reports PTY EOF as EIO; macOS returns empty bytes.
                    raise
                break
            if not chunk:
                break
            output.extend(chunk)
            if len(output) > 65536:
                raise ValueError('oversized_probe_output')
        code = process.wait(timeout=max(0.01, deadline - time.monotonic()))
        complete = True
        text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', output.decode())
        return code, text
    finally:
        os.close(master)
        if process is not None and not complete:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()


def probe_opencode(lab=LAB):
    result = {'compatible': False}
    try:
        package = lab / 'tools/opencode/node_modules/opencode-darwin-arm64'
        binary = package / 'bin/opencode'
        if not package.resolve().is_relative_to(lab.resolve()) or not binary.resolve().is_relative_to(package.resolve()):
            raise ValueError('entrypoint_outside_lab')
        meta = json.loads((package / 'package.json').read_text())
        if meta.get('name') != 'opencode-darwin-arm64' or meta.get('version') != SPECS['opencode']['version']:
            raise ValueError('package_identity_or_version_mismatch')
        if sys.platform != 'darwin' or platform.machine() != 'arm64':
            raise ValueError('requires_macos_arm64')
        with tempfile.TemporaryDirectory(prefix='office-opencode-check-') as directory:
            env = {'PATH': os.environ.get('PATH', ''), 'HOME': directory, 'TMPDIR': directory,
                   'XDG_CONFIG_HOME': directory, 'XDG_DATA_HOME': directory, 'XDG_CACHE_HOME': directory,
                   'OPENCODE_DISABLE_AUTOUPDATE': 'true', 'OPENCODE_DISABLE_MODELS_FETCH': 'true',
                   'OPENCODE_DISABLE_DEFAULT_PLUGINS': 'true', 'NO_COLOR': '1'}
            def run(flag):
                return capture_probe(['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)',
                                      str(binary), flag], directory, env)
            version, help_result = run('--version'), run('--help')
            if version[0] or help_result[0]:
                raise ValueError('version_or_help_failed')
            reason = assess_opencode(version[1], help_result[1])
            if reason:
                raise ValueError(reason)
            result.update(compatible=True, network_denied=True)
    except (OSError, ValueError, subprocess.SubprocessError):
        result['reason'] = 'opencode_missing_incompatible_or_probe_failed'
    return result


def credentials(provider, lab=LAB):
    if provider == 'opencode':
        return 'not_required'
    parts = ('.local/remote/cursor-home/.cursor/auth.json' if provider == 'cursor'
             else f'.local/remote/{provider}/auth.json').split('/')
    try:
        current = lab
        for part in parts:
            current = current / part
            if current.is_symlink():
                return 'unsafe'
        info = current.stat()
        return ('present_unverified' if stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and not info.st_mode & 0o077 and 0 < info.st_size <= 65536 else 'unsafe')
    except FileNotFoundError:
        return 'missing'
    except OSError:
        return 'unavailable'


def runtime_ready(provider, lab=LAB):
    checks = {'macos_arm64': sys.platform == 'darwin' and platform.machine() == 'arm64',
              'node': shutil.which('node') is not None, 'sandbox': Path('/usr/bin/sandbox-exec').is_file()}
    vendor = lab / 'vendor/agent-office'
    try:
        head = subprocess.run(['git', '-C', str(vendor), 'rev-parse', 'HEAD'],
                              capture_output=True, text=True, timeout=5)
        checks['office_build'] = (head.returncode == 0 and head.stdout.strip() == VENDOR_COMMIT
                                  and (vendor / 'dist/server/server/server.js').is_file())
    except (OSError, subprocess.SubprocessError):
        checks['office_build'] = False
    if provider == 'opencode':
        home = strata_home(lab)
        checks['strata_files'] = all((home / name).is_file() for name in
                                    ('source/.venv/bin/python', 'source/serve/server.py', 'source/strata-q2_0.json'))
        checks['opencode_plugin_dependencies'] = (lab / 'tools/opencode-plugin/node_modules/@opencode-ai/plugin/package.json').is_file()
    return checks


def detect(provider, lab=LAB):
    spec = SPECS[provider]
    if provider == 'opencode':
        probe = probe_opencode(lab)
    elif provider == 'cursor':
        probe = cursor_cli.probe(lab)
    else:
        probe = remote_cli.probe(provider, lab)
    auth, runtime = credentials(provider, lab), runtime_ready(provider, lab)
    return {'provider': provider, 'model': spec['model'], 'pinned_version': spec['version'],
            'cli_compatible': probe.get('compatible') is True,
            'version_and_help_network_denied': probe.get('network_denied') is True,
            'credentials': auth, 'authentication_verified': False, 'model_inference_verified': False,
            'runtime': runtime, 'launch_prerequisites_present': probe.get('compatible') is True
            and all(runtime.values()) and auth in ('not_required', 'present_unverified')}


def validate_failure(provider, check_failure, check_cancel=False, allow_remote=False):
    if check_failure is not None and (provider != 'pi' or type(check_failure) is not int
                                     or check_failure not in (401, 429) or check_cancel or allow_remote):
        raise SlotError('failure_check_requires_pi_no_remote_and_401_or_429')


def validate_crash(provider, check_crash, check_cancel=False, check_failure=None, allow_remote=False):
    if check_crash and (provider != 'pi' or check_cancel or check_failure is not None or allow_remote):
        raise SlotError('crash_check_requires_pi_no_remote_or_other_checks')


def plan(provider, check_cancel=False, check_failure=None, check_crash=False):
    validate_crash(provider, check_crash, check_cancel, check_failure)
    validate_failure(provider, check_failure, check_cancel)
    if check_cancel and provider != 'opencode':
        raise SlotError('local_cancel_check_only')
    spec = SPECS[provider]
    limits = {'timeout_seconds': spec['timeout_seconds'], 'host_retries': 0,
              'provider_request_cap': 4 if provider == 'pi' else None,
              'output_tokens_per_request_cap': 512 if provider == 'pi' else None,
              'money_cap': None}
    if provider in ('grok', 'cursor'):
        limits['tool_hook_gate'] = 4
    if provider == 'grok':
        limits.update(native_max_turns=6, hook_failure_behavior='fail_open')
    if check_failure is not None:
        limits.update(provider_request_cap=0, output_tokens_per_request_cap=0, injected_error_responses=1)
    if check_crash:
        limits.update(provider_request_cap=0, output_tokens_per_request_cap=0, held_loopback_requests=1)
    return {'mode': 'plan', 'provider': provider, 'model': spec['model'], 'pinned_version': spec['version'],
            'task': 'synthetic_file', 'remote': spec['remote'] and check_failure is None and not check_crash, 'limits': limits,
            'command': ['python3', 'scripts/office_dispatch.py', 'run', provider, '--execute']
                       + (['--allow-remote'] if spec['remote'] and check_failure is None and not check_crash else [])
                       + (['--check-failure', str(check_failure)] if check_failure is not None else [])
                       + (['--check-crash'] if check_crash else [])
                       + (['--check-cancel'] if check_cancel else []),
            'injected_http_failure': check_failure,
            'native_cancel_check': check_cancel, 'native_crash_check': check_crash,
            'model_task_started': False, 'automatic_fallback': False}


def launch(provider, allow_remote, lab=LAB, check_cancel=False, check_failure=None, check_crash=False, retry_parent=None):
    validate_crash(provider, check_crash, check_cancel, check_failure, allow_remote)
    spec = SPECS[provider]
    validate_failure(provider, check_failure, check_cancel, allow_remote)
    if check_cancel and provider != 'opencode':
        raise SlotError('local_cancel_check_only')
    if (spec['remote'] and check_failure is None and not check_crash) != allow_remote:
        raise SlotError('explicit_remote_authorization_required' if spec['remote'] else 'local_remote_flag_forbidden')
    # Lock before preflight, then replace this process; the runner adopts the same lock/PID.
    with execution_slot(lab) as slot:
        if retry_parent is not None:
            meta, _, _ = pi_retry.inspect(lab, retry_parent)
            mode = 'crash' if check_crash else 'http_' + str(check_failure) if check_failure else 'task'
            if provider != 'pi' or check_cancel or mode != meta['mode']:
                raise SlotError('retry_mode_mismatch')
        check = detect(provider, lab)
        ready = (check['cli_compatible'] and all(check['runtime'].values())) if check_failure is not None or check_crash else check['launch_prerequisites_present']
        if not ready:
            print(json.dumps({'status': 'blocked', 'reason': 'preflight_failed', 'check': check}))
            return 1
        python = strata_home(lab) / 'source/.venv/bin/python' if provider == 'opencode' else Path(sys.executable)
        runner_args = ['--check-failure', str(check_failure)] if check_failure is not None else spec['args']
        if check_crash: runner_args = ['--check-crash']
        command = [str(python), str(lab / 'scripts' / spec['runner']), *runner_args]
        if check_cancel:
            command.append('--check-cancel')
        if retry_parent is not None: slot.select_retry(retry_parent)
        os.execve(str(python), command, slot.exec_env(os.environ))
        raise RuntimeError('exec_returned_without_replacing_process')


def retry_plan(run_id, lab=LAB):
    meta, _, _ = pi_retry.inspect(lab, run_id)
    mode = meta['mode']
    options = {'check_crash':mode == 'crash', 'check_failure':int(mode[5:]) if mode.startswith('http_') else None}
    result = plan('pi', **options)
    result.update(retry_of=run_id, root_run=meta['root'], attempt=meta['attempt']+1,
                  retries_remaining_after_run=1-meta['attempt'], maximum_retries=2)
    result['command'] = ['python3','scripts/office_dispatch.py','retry',run_id,'--execute'] + (['--allow-remote'] if result['remote'] else [])
    return result, options


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    check = commands.add_parser('detect'); check.add_argument('--provider', choices=[*SPECS, 'all'], default='all')
    preview = commands.add_parser('plan'); preview.add_argument('provider', choices=SPECS)
    run = commands.add_parser('run'); run.add_argument('provider', choices=SPECS)
    run.add_argument('--execute', action='store_true'); run.add_argument('--allow-remote', action='store_true')
    run.add_argument('--check-cancel', action='store_true', help='OpenCode only: verify a second fixed native cancellation task')
    run.add_argument('--check-failure', type=int, choices=(401, 429), help='Pi only: injected loopback HTTP failure; no remote calls')
    run.add_argument('--check-crash', action='store_true', help='Pi only: kill the owned native CLI during a held loopback request; no remote calls')
    retry = commands.add_parser('retry'); retry.add_argument('run_id')
    retry.add_argument('--execute', action='store_true'); retry.add_argument('--allow-remote', action='store_true')
    ack = commands.add_parser('acknowledge-interruption')
    ack.add_argument('--confirm-all-owned-processes-stopped', action='store_true', required=True)
    args = parser.parse_args(argv)
    try:
        if args.action == 'retry':
            preview, options = retry_plan(args.run_id)
            if not args.execute:
                if args.allow_remote: parser.error('--allow-remote requires --execute')
                print(json.dumps(preview, indent=2)); return 0
            return launch('pi', args.allow_remote, retry_parent=args.run_id, **options)
        if args.action == 'detect':
            checks = [detect(p) for p in (SPECS if args.provider == 'all' else [args.provider])]
            print(json.dumps({'checks': checks, 'model_task_started': False}, indent=2))
            return 0 if all(c['cli_compatible'] for c in checks) else 1
        if args.action == 'acknowledge-interruption':
            print(json.dumps({'status': 'acknowledged', 'record_archived': acknowledge_stopped(),
                              'processes_stopped_by_this_command': False, 'model_task_started': False}))
            return 0
        if args.action == 'plan' or not args.execute:
            if args.action == 'run' and args.allow_remote:
                parser.error('--allow-remote requires --execute')
            print(json.dumps(plan(args.provider, getattr(args, 'check_cancel', False), getattr(args, 'check_failure', None), getattr(args, 'check_crash', False)), indent=2)); return 0
        return launch(args.provider, args.allow_remote, check_cancel=args.check_cancel, check_failure=args.check_failure, check_crash=args.check_crash)
    except SlotError as error:
        print(json.dumps({'status': 'blocked', 'reason': str(error)}), file=sys.stderr)
        return 1
    except (OSError, ValueError, subprocess.SubprocessError):
        # Never forward native error text, host paths or inherited environment.
        print(json.dumps({'status': 'blocked', 'reason': 'authorization_preflight_or_slot_failed',
                          'hint': 'Check explicit execution flags, prerequisites and any unconfirmed interruption.'}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
