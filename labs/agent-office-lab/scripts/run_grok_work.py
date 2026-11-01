#!/usr/bin/env python3
"""Prepare, dry-run or explicitly authorize one native Office/Grok fixture."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from remote_cli import LAB, isolated_env, installed_cli, private_directory, write_new_private, probe
from grok_task_hook import MODEL, task_prompt
from run_grok_startup import process_table, collect_owned, alive_owned
from grok_startup import sandbox_profile

SOURCES = ['run_grok_work.py','grok_task_hook.py','grok_work_policy.mjs','office_grok_work.mjs','grok-work/grok','remote_cli.py','run_grok_startup.py','grok_startup.py','cursor_task_hook.py','grok_native_evidence.py']


def credential_path(lab=LAB):
    auth = lab / '.local/remote/grok/auth.json'
    current = lab
    for part in auth.relative_to(lab).parts:
        current = current / part
        if current.is_symlink(): raise ValueError('credential_symlink')
    info = auth.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > 65536:
        raise ValueError('credential_requires_private_regular_file')
    return auth


def prepare(out, socket_dir, remote, timeout_seconds=240, budget_multiplier=1):
    home = private_directory(out / 'home'); config = private_directory(home / 'grok')
    workspace = private_directory(out / 'workspace')
    write_new_private(workspace / 'input.json', {'marker': secrets.token_hex(12), 'values': [7, 11, -2, 9]})
    write_new_private(workspace / 'result.json', {})
    # Copy only credentials, never the owner's settings, hooks, rules, MCPs or host switch state.
    source = credential_path()
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f: body = f.read(65537)
    if len(body) > 65536: raise ValueError('credential_too_large')
    target = config / 'auth.json'
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f: f.write(body)
    write_new_private(out / 'task-plan.json', {'allow_remote': remote, 'model': MODEL,
        'prompt': task_prompt(budget_multiplier) if remote else None, 'budget_multiplier': budget_multiplier, 'max_tool_calls': 4*budget_multiplier, 'deadline': time.time() + timeout_seconds, 'timeout_seconds': timeout_seconds})
    profile = sandbox_profile(out, socket_dir)
    # Signed-in native startup needs HTTPS metadata even without a prompt.
    profile += '(allow network-outbound (remote ip "*:443"))'
    profile += f'(deny file-read* (subpath {json.dumps(str(LAB / ".local"))}))'
    (out / 'grok.sb').write_text(profile)
    env = isolated_env(home, 'grok')
    env.update(TMPDIR=str(socket_dir), LAB_GROK_WORK_OUT=str(out), LAB_GROK_SOCKET_DIR=str(socket_dir),
               PATH=str(LAB / 'scripts/grok-work') + os.pathsep + os.environ['PATH'])
    return env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--check-startup', action='store_true', help='Authenticated CLI startup with HTTPS metadata access; no prompt')
    group.add_argument('--allow-remote', action='store_true', help='Explicitly authorize one quota-consuming fixture')
    parser.add_argument('--timeout-seconds', type=int, choices=[240,480], default=240, help='Approved task deadline; default 240 seconds')
    parser.add_argument('--budget-multiplier', type=int, choices=[1,2], default=1)
    args = parser.parse_args()
    if args.timeout_seconds > 240*args.budget_multiplier:parser.error('480 seconds requires doubled budget')
    if not args.check_startup and not args.allow_remote:
        print(json.dumps({'mode': 'plan', 'model': MODEL, 'max_prompts': 1, 'max_tool_calls': 4*args.budget_multiplier, 'native_max_turns': 6*args.budget_multiplier, 'hook_failure_behavior': 'fail_open',
            'allowed_tools': ['read_file(input.json/result.json)', 'search_replace(result.json)'], 'timeout_seconds': args.timeout_seconds,
            'host_retries': 0, 'provider_request_cap': None, 'token_cap': None, 'money_cap': None,
            'command': f'python3 scripts/run_grok_work.py --allow-remote --timeout-seconds {args.timeout_seconds} --budget-multiplier {args.budget_multiplier}', 'remote_requests_sent': False}, indent=2)); return 0
    if not probe('grok')['compatible']: raise ValueError('preflight_failed')
    out = private_directory(LAB / 'runs' / ('grok-work-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')))
    socket_dir = Path(tempfile.mkdtemp(prefix='office-grok-', dir='/private/tmp'))
    report = {'status': 'starting', 'provider': 'grok', 'version': '1.0.70', 'model': MODEL,
              'startup_only': args.check_startup, 'budget_multiplier': args.budget_multiplier, 'timeout_seconds': args.timeout_seconds, 'model_inference_verified': False,
              'provider_request_cap': None, 'token_cap': None, 'money_cap': None, 'cleanup_errors': []}
    process = None; owned = {}; started = time.monotonic()
    def interrupted(*_): raise InterruptedError('interrupted')
    signal.signal(signal.SIGINT, interrupted); signal.signal(signal.SIGTERM, interrupted)
    try:
        env = prepare(out, socket_dir, args.allow_remote, args.timeout_seconds, args.budget_multiplier)
        report['source_sha256'] = {}
        for name in SOURCES:
            source = LAB / 'scripts' / name; report['source_sha256'][name] = hashlib.sha256(source.read_bytes()).hexdigest()
            shutil.copy2(source, out / name.replace('/', '-'))
        denied = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(out / 'grok.sb'), sys.executable,
            '-c', 'import socket; s=socket.socket(); s.settimeout(2); print(s.connect_ex(("192.0.2.1",80)))'],
            cwd=out, env=env, capture_output=True, text=True, timeout=5)
        if denied.returncode or denied.stdout.strip() not in ('1', '13'): raise ValueError('network_denial_failed')
        with (out / 'office.stdout.log').open('w') as stdout, (out / 'office.stderr.log').open('w') as stderr:
            process = subprocess.Popen([shutil.which('node'), str(LAB / 'scripts/office_grok_work.mjs'), str(out)],
                cwd=out, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
            while process.poll() is None:
                owned = collect_owned(process_table(), owned, process.pid, socket_dir / 'leader.sock')
                if time.monotonic() - started > args.timeout_seconds: raise TimeoutError('deadline')
                time.sleep(0.1)
        office = json.loads((out / 'office-result.json').read_text()); report['office'] = office
        if process.returncode or office['status'] != 'completed': raise ValueError('native_acceptance_failed')
        report['model_inference_verified'] = bool(args.allow_remote and office.get('task_completed') and office.get('native_stop_verified'))
        report['status'] = 'completed'
    except (OSError, ValueError, subprocess.SubprocessError):
        report['status'] = 'failed'; report['reason'] = 'grok_acceptance_failed'
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN); signal.signal(signal.SIGTERM, signal.SIG_IGN)
        if process:
            owned = collect_owned(process_table(), owned, process.pid, socket_dir / 'leader.sock')
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=12)
                except subprocess.TimeoutExpired: report['cleanup_errors'].append('office_shutdown_timeout')
            remaining = alive_owned(process_table(), owned)
            report['owned_processes_seen'] = len(owned)
            for sig in (signal.SIGTERM, signal.SIGKILL):
                for pid in remaining:
                    try: os.kill(pid, sig)
                    except ProcessLookupError: pass
                deadline = time.monotonic() + 5
                while remaining and time.monotonic() < deadline:
                    time.sleep(0.1); remaining = alive_owned(process_table(), owned)
                if not remaining: break
            if remaining: report['cleanup_errors'].append('owned_process_survived')
            if process.poll() is None: process.wait(timeout=2)
        copied_auth = out / 'home/grok/auth.json'
        if copied_auth.exists(): copied_auth.unlink()
        report['copied_credentials_removed'] = not copied_auth.exists()
        if (out / 'office-result.json').is_file(): report['office'] = json.loads((out / 'office-result.json').read_text())
        if not report.get('office', {}).get('cleanup_completed'): report['cleanup_errors'].append('native_cleanup_unverified')
        if report['cleanup_errors']: report['status'] = 'failed'; report['model_inference_verified'] = False
        report['elapsed_s'] = time.monotonic() - started
        (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        if not report['cleanup_errors']: shutil.rmtree(socket_dir)
        print(json.dumps({'status': report['status'], 'model_inference_verified': report['model_inference_verified'],
                          'cleanup_errors': report['cleanup_errors'], 'artifacts': str(out)}, indent=2))
    return 0 if report['status'] == 'completed' else 1


if __name__ == '__main__':
    try: raise SystemExit(main())
    except (OSError, ValueError, subprocess.SubprocessError):
        print('Grok fixture preflight failed; no credential is printed', file=sys.stderr); raise SystemExit(1)
