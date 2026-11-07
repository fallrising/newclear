#!/usr/bin/env python3
"""One explicit entry for pinned synthetic Office tasks. Default: plan only."""
import pi_retry
import local_text_task
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
from execution_slot import SlotError, acknowledge_stopped, execution_slot, inspect_slot
import remote_cli
import remote_grant as grants

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


def validate_keep_open(provider, keep_open, check_cancel=False, check_failure=None, check_crash=False):
    if keep_open and (provider != 'opencode' or check_cancel or check_failure is not None or check_crash):
        raise SlotError('keep_open_requires_local_task_only')


def validate_resume(provider, check_resume, check_cancel=False, check_failure=None, check_crash=False, keep_open=False, allow_remote=False):
    if check_resume and (provider != 'pi' or check_cancel or check_failure is not None or check_crash or keep_open or allow_remote):
        raise SlotError('resume_check_requires_pi_no_remote_or_other_checks')


def validate_host_restart(provider, check_host_restart, check_resume, check_cancel, check_failure, check_crash, keep_open, allow_remote=False):
    if check_host_restart and (provider != 'pi' or check_resume or check_cancel or check_failure is not None or check_crash or keep_open or allow_remote):
        raise SlotError('host_restart_requires_pi_no_remote_or_other_checks')


def validate_question(provider, check_question, check_cancel=False, check_failure=None, check_crash=False, check_resume=False, check_host_restart=False, keep_open=False, allow_remote=False):
    if check_question and (provider != 'pi' or check_cancel or check_failure is not None or check_crash
                           or check_resume or check_host_restart or keep_open or allow_remote):
        raise SlotError('question_check_requires_pi_no_remote_or_other_checks')


def plan(provider, check_cancel=False, check_failure=None, check_crash=False, keep_open=False, check_resume=False, check_host_restart=False, check_question=False):
    validate_question(provider, check_question, check_cancel, check_failure, check_crash, check_resume, check_host_restart, keep_open)
    validate_host_restart(provider, check_host_restart, check_resume, check_cancel, check_failure, check_crash, keep_open)
    validate_resume(provider, check_resume, check_cancel, check_failure, check_crash, keep_open)
    validate_keep_open(provider, keep_open, check_cancel, check_failure, check_crash)
    validate_crash(provider, check_crash, check_cancel, check_failure)
    validate_failure(provider, check_failure, check_cancel)
    if check_cancel and provider not in ('opencode', 'pi'):
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
    if check_failure is not None or check_resume or check_host_restart:
        limits.update(provider_request_cap=0, output_tokens_per_request_cap=0, injected_error_responses=1)
    if check_question:
        limits.update(provider_request_cap=0, output_tokens_per_request_cap=0,
                      injected_error_responses_on_accidental_request=1)
    if check_crash or (check_cancel and provider == 'pi'):
        limits.update(provider_request_cap=0, output_tokens_per_request_cap=0, held_loopback_requests=1)
    return {'mode': 'plan', 'provider': provider, 'model': spec['model'], 'pinned_version': spec['version'],
            'task': 'synthetic_file', 'remote': spec['remote'] and check_failure is None and not check_crash and not check_cancel and not check_resume and not check_host_restart and not check_question, 'limits': limits,
            'command': ['python3', 'scripts/office_dispatch.py', 'run', provider, '--execute']
                       + (['--allow-remote'] if spec['remote'] and check_failure is None and not check_crash and not check_cancel and not check_resume and not check_host_restart and not check_question else [])
                       + (['--check-failure', str(check_failure)] if check_failure is not None else [])
                       + (['--check-crash'] if check_crash else [])
                       + (['--check-cancel'] if check_cancel else [])
                       + (['--keep-open'] if keep_open else [])
                       + (['--check-resume'] if check_resume else []) + (['--check-host-restart'] if check_host_restart else []) + (['--check-question'] if check_question else []),
            'injected_http_failure': check_failure,
            'native_host_restart_check':check_host_restart, 'native_resume_check':check_resume, 'native_question_check':check_question,
            'keep_open': keep_open, 'native_cancel_check': check_cancel, 'native_crash_check': check_crash,
            'model_task_started': False, 'automatic_fallback': False}


def launch(provider, allow_remote, lab=LAB, check_cancel=False, check_failure=None, check_crash=False, retry_parent=None, keep_open=False, check_resume=False, check_host_restart=False, remote_grant=None, check_question=False):
    validate_question(provider, check_question, check_cancel, check_failure, check_crash, check_resume, check_host_restart, keep_open, allow_remote or remote_grant is not None)
    if check_question and retry_parent is not None:
        raise SlotError('question_check_requires_pi_no_remote_or_other_checks')
    grant_remote = remote_grant is not None
    if grant_remote:
        if allow_remote:
            raise SlotError('remote_grant_conflicts_with_allow_remote')
        if provider != 'pi':
            raise grants.GrantError('remote_grant_provider_not_supported')
        if retry_parent is not None or check_cancel or check_failure is not None or check_crash or check_resume or check_host_restart or keep_open or check_question:
            raise SlotError('remote_grant_requires_fresh_task')
    effective_allow_remote = allow_remote or grant_remote
    validate_host_restart(provider, check_host_restart, check_resume, check_cancel, check_failure, check_crash, keep_open, effective_allow_remote)
    validate_resume(provider, check_resume, check_cancel, check_failure, check_crash, keep_open, effective_allow_remote)
    validate_keep_open(provider, keep_open, check_cancel, check_failure, check_crash)
    validate_crash(provider, check_crash, check_cancel, check_failure, effective_allow_remote)
    spec = SPECS[provider]
    validate_failure(provider, check_failure, check_cancel, effective_allow_remote)
    if check_cancel and provider not in ('opencode', 'pi'):
        raise SlotError('local_cancel_check_only')
    if (spec['remote'] and check_failure is None and not check_crash and not check_cancel and not check_resume and not check_host_restart and not check_question) != effective_allow_remote:
        raise SlotError('explicit_remote_authorization_required' if spec['remote'] else 'local_remote_flag_forbidden')
    # Lock before preflight and grant consumption, then replace this process; the runner adopts the same lock/PID.
    with execution_slot(lab) as slot:
        if retry_parent is not None:
            meta, _, _ = pi_retry.inspect(lab, retry_parent)
            mode = 'crash' if check_crash else 'http_' + str(check_failure) if check_failure else 'task'
            if provider != 'pi' or check_cancel or check_resume or check_host_restart or mode != meta['mode']:
                raise SlotError('retry_mode_mismatch')
        check = detect(provider, lab)
        ready = (check['cli_compatible'] and all(check['runtime'].values())) if check_failure is not None or check_crash or (check_cancel and provider == 'pi') or check_resume or check_host_restart or check_question else check['launch_prerequisites_present']
        if not ready:
            print(json.dumps({'status': 'blocked', 'reason': 'preflight_failed', 'check': check}))
            return 1
        consumed = None
        if grant_remote:
            consumed = grants.consume(lab, remote_grant, 'pi', 'dispatcher')
        python = strata_home(lab) / 'source/.venv/bin/python' if provider == 'opencode' else Path(sys.executable)
        runner_args = ['--check-failure', str(check_failure)] if check_failure is not None else spec['args']
        if grant_remote:
            runner_args = ['--allow-remote', '--authorization-ref', consumed['id']]
        if check_host_restart: runner_args = ['--check-host-restart']
        if check_resume: runner_args = ['--check-resume']
        if check_question: runner_args = ['--check-question']
        if check_crash: runner_args = ['--check-crash']
        if check_cancel and provider == 'pi': runner_args = []
        command = [str(python), str(lab / 'scripts' / spec['runner']), *runner_args]
        if check_cancel:
            command.append('--check-cancel')
        if keep_open: command.append('--keep-open')
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


def launch_text_task(request_path, request_sha256, lab=LAB):
    local_text_task.load_request(lab, Path(request_path), request_sha256)
    with execution_slot(lab) as slot:
        if not detect('opencode', lab)['launch_prerequisites_present']:
            raise SlotError('preflight_failed')
        command = [str(strata_home(lab) / 'source/.venv/bin/python'), str(lab / 'scripts/run_local_work.py'),
                   '--harness','office-opencode','--text-request',str(request_path),'--request-sha256',request_sha256]
        os.execve(command[0], command, slot.exec_env(os.environ))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    commands.add_parser('status', help='Read the shared execution state without launching or acknowledging anything')
    check = commands.add_parser('detect'); check.add_argument('--provider', choices=[*SPECS, 'all'], default='all')
    preview = commands.add_parser('plan'); preview.add_argument('provider', choices=SPECS)
    grant = commands.add_parser('grant'); grant.add_argument('provider', choices=['pi']); grant.add_argument('--ttl', type=int, default=900); grant.add_argument('--confirm-paid-remote-run', action='store_true', required=True)
    revoke = commands.add_parser('grant-revoke'); revoke.add_argument('grant_id')
    commands.add_parser('grants', help='List pending remote grants without exposing IDs')
    run = commands.add_parser('run'); run.add_argument('provider', choices=SPECS)
    run.add_argument('--execute', action='store_true')
    remote_group = run.add_mutually_exclusive_group(); remote_group.add_argument('--allow-remote', action='store_true'); remote_group.add_argument('--remote-grant')
    run.add_argument('--check-cancel', action='store_true', help='OpenCode: local task cancellation; Pi: cancel a held loopback request without model calls')
    run.add_argument('--check-failure', type=int, choices=(401, 429), help='Pi only: injected loopback HTTP failure; no remote calls')
    run.add_argument('--check-host-restart', action='store_true', help='Pi only: crash/restart Office and reconnect one saved session; no model calls')
    run.add_argument('--check-resume', action='store_true', help='Pi only: reconnect one saved session after an injected local 429 and owned CLI exit; no model calls')
    run.add_argument('--check-crash', action='store_true', help='Pi only: kill the owned native CLI during a held loopback request; no remote calls')
    run.add_argument('--check-question', action='store_true', help='Pi only: exercise native confirm UI; no model calls')
    run.add_argument('--keep-open', action='store_true', help='OpenCode only: keep the verified native terminal and local model open until stopped')
    text = commands.add_parser('local-text'); text.add_argument('--request',required=True); text.add_argument('--sha256',required=True); text.add_argument('--execute',action='store_true',required=True)
    retry = commands.add_parser('retry'); retry.add_argument('run_id')
    retry.add_argument('--execute', action='store_true'); retry.add_argument('--allow-remote', action='store_true')
    ack = commands.add_parser('acknowledge-interruption')
    ack.add_argument('--confirm-all-owned-processes-stopped', action='store_true', required=True)
    args = parser.parse_args(argv)
    try:
        if args.action == 'local-text': return launch_text_task(args.request,args.sha256)
        if args.action == 'grant':
            value = grants.create(LAB, args.provider, args.ttl)
            print(json.dumps({'id': value['id'], 'fingerprint': value['fingerprint'], 'expires_at': value['expires_at'],
                              'limits': value['limits'], 'money_cap': None}, indent=2))
            return 0
        if args.action == 'grant-revoke':
            grants.revoke(LAB, args.grant_id)
            print(json.dumps({'status':'revoked', 'fingerprint': grants.fingerprint(args.grant_id)}))
            return 0
        if args.action == 'grants':
            row = grants.pending(LAB, 'pi')
            print(json.dumps({'remote_grants': {'enabled_providers':['pi'], 'pending': [] if row is None else [grants.public(row)]}}, indent=2))
            return 0
        if args.action == 'status':
            state = inspect_slot(LAB)
            print(json.dumps({'shared_execution':state,'model_task_started':False}))
            return 1 if state['status'] == 'unavailable' else 0
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
            if args.action == 'run' and (args.allow_remote or args.remote_grant):
                parser.error('--allow-remote/--remote-grant requires --execute')
            print(json.dumps(plan(args.provider, getattr(args, 'check_cancel', False), getattr(args, 'check_failure', None), getattr(args, 'check_crash', False), getattr(args, 'keep_open', False), getattr(args, 'check_resume', False), getattr(args, 'check_host_restart', False), getattr(args, 'check_question', False)), indent=2)); return 0
        return launch(args.provider, args.allow_remote, check_cancel=args.check_cancel, check_failure=args.check_failure, check_crash=args.check_crash, keep_open=args.keep_open, check_resume=args.check_resume, check_host_restart=args.check_host_restart, remote_grant=args.remote_grant, check_question=args.check_question)
    except grants.GrantError as error:
        print(json.dumps({'status':'blocked', 'reason':str(error)}), file=sys.stderr)
        return 1
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
