#!/usr/bin/env python3
"""Prepare, dry-run or explicitly authorize one native Office/Cursor fixture."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from cursor_cli import PIN, isolated_cursor_env, installed_cli, probe
from cursor_task_hook import MODEL, PROMPT, EVENTS
from remote_cli import LAB, private_directory, write_new_private
from run_grok_startup import process_table, collect_owned, alive_owned
from grok_startup import sandbox_profile

SOURCES = ['run_cursor_work.py', 'cursor_cli.py', 'cursor_task_hook.py', 'cursor_work_policy.mjs',
           'office_cursor_work.mjs', 'cursor-task/cursor-agent', 'remote_cli.py', 'run_grok_startup.py', 'grok_startup.py']


def credential_path(lab=LAB):
    auth = lab / '.local/remote/cursor-home/.cursor/auth.json'
    current = lab
    for part in auth.relative_to(lab).parts:
        current = current / part
        if current.is_symlink(): raise ValueError('credential_symlink')
    info = auth.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > 65536:
        raise ValueError('credential_requires_private_regular_file')
    return auth


def account_status():
    auth = credential_path()
    home = auth.parent.parent
    r = subprocess.run([str(installed_cli()), 'status', '--format', 'json'], cwd=home / 'login-workspace',
        env=isolated_cursor_env(home), capture_output=True, text=True, timeout=30)
    data = json.loads(r.stdout)
    return r.returncode == 0 and isinstance(data, dict) and data.get('isAuthenticated') is True


def prepare(out, socket_dir, remote):
    home = private_directory(out / 'home'); config = private_directory(home / '.cursor')
    workspace = private_directory(out / 'workspace'); cursor = private_directory(workspace / '.cursor')
    write_new_private(workspace / 'input.json', {'marker': secrets.token_hex(12), 'values': [7, 11, -2, 9]})
    # Copy only credentials, never the owner's settings, hooks, rules, MCPs or host switch state.
    source = credential_path()
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f: body = f.read(65537)
    if len(body) > 65536: raise ValueError('credential_too_large')
    target = config / 'auth.json'
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f: f.write(body)
    write_new_private(config / 'cli-config.json', {'version': 1, 'editor': {'vimMode': False},
        'permissions': {'allow': ['Read(input.json)', 'Write(result.json)'],
                        'deny': ['Shell(*)', 'WebFetch(*)', 'Mcp(*:*)']}})
    hooks = {event: [{'command': shlex.join([sys.executable, str(LAB / 'scripts/cursor_task_hook.py'), event]),
                      'timeout': 3, 'failClosed': True, **({'loop_limit': 0} if event == 'stop' else {})}] for event in EVENTS}
    write_new_private(cursor / 'hooks.json', {'version': 1, 'hooks': hooks})
    write_new_private(out / 'task-plan.json', {'allow_remote': remote, 'model': MODEL,
        'prompt': PROMPT if remote else None, 'deadline': time.time() + 120})
    profile = sandbox_profile(out, socket_dir)
    # Signed-in native startup needs HTTPS metadata even without a prompt.
    profile += '(allow network-outbound (remote ip "*:443"))'
    profile += f'(deny file-read* (subpath {json.dumps(str(LAB / ".local"))}))'
    (out / 'cursor.sb').write_text(profile)
    env = isolated_cursor_env(home)
    env.update(TMPDIR=str(socket_dir), LAB_CURSOR_WORK_OUT=str(out),
               PATH=str(LAB / 'scripts/cursor-task') + os.pathsep + os.environ['PATH'])
    return env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--check-startup', action='store_true', help='Authenticated CLI startup with HTTPS metadata access; no prompt')
    group.add_argument('--allow-remote', action='store_true', help='Explicitly authorize one quota-consuming fixture')
    group.add_argument('--check-account', action='store_true', help='Read-only native login status; no model prompt')
    args = parser.parse_args()
    if args.check_account:
        verified = account_status(); print(json.dumps({'authentication_verified': verified, 'model_inference_verified': False})); return 0 if verified else 1
    if not args.check_startup and not args.allow_remote:
        print(json.dumps({'mode': 'plan', 'model': MODEL, 'max_prompts': 1, 'max_tool_calls': 2,
            'allowed_tools': ['Read(input.json)', 'Write(result.json)'], 'timeout_seconds': 120,
            'host_retries': 0, 'provider_request_cap': None, 'token_cap': None, 'money_cap': None,
            'command': 'python3 scripts/run_cursor_work.py --allow-remote', 'remote_requests_sent': False}, indent=2)); return 0
    if not probe()['compatible']: raise ValueError('preflight_failed')
    out = private_directory(LAB / 'runs' / ('cursor-work-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')))
    socket_dir = Path(tempfile.mkdtemp(prefix='office-cursor-', dir='/private/tmp'))
    report = {'status': 'starting', 'provider': 'cursor', 'version': PIN['version'], 'model': MODEL,
              'startup_only': args.check_startup, 'model_inference_verified': False,
              'provider_request_cap': None, 'token_cap': None, 'money_cap': None, 'cleanup_errors': []}
    process = None; owned = {}; started = time.monotonic()
    def interrupted(*_): raise InterruptedError('interrupted')
    signal.signal(signal.SIGINT, interrupted); signal.signal(signal.SIGTERM, interrupted)
    try:
        env = prepare(out, socket_dir, args.allow_remote)
        report['source_sha256'] = {}
        for name in SOURCES:
            source = LAB / 'scripts' / name; report['source_sha256'][name] = hashlib.sha256(source.read_bytes()).hexdigest()
            shutil.copy2(source, out / name.replace('/', '-'))
        denied = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(out / 'cursor.sb'), sys.executable,
            '-c', 'import socket; s=socket.socket(); s.settimeout(2); print(s.connect_ex(("192.0.2.1",80)))'],
            cwd=out, env=env, capture_output=True, text=True, timeout=5)
        if denied.returncode or denied.stdout.strip() not in ('1', '13'): raise ValueError('network_denial_failed')
        with (out / 'office.stdout.log').open('w') as stdout, (out / 'office.stderr.log').open('w') as stderr:
            process = subprocess.Popen([shutil.which('node'), str(LAB / 'scripts/office_cursor_work.mjs'), str(out)],
                cwd=out, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
            while process.poll() is None:
                owned = collect_owned(process_table(), owned, process.pid, socket_dir / 'unused.sock')
                if time.monotonic() - started > 120: raise TimeoutError('deadline')
                time.sleep(0.1)
        office = json.loads((out / 'office-result.json').read_text()); report['office'] = office
        if process.returncode or office['status'] != 'completed': raise ValueError('native_acceptance_failed')
        report['model_inference_verified'] = bool(args.allow_remote and office.get('file_task_passed') and office.get('native_stop_verified'))
        report['status'] = 'completed'
    except (OSError, ValueError, subprocess.SubprocessError):
        report['status'] = 'failed'; report['reason'] = 'cursor_acceptance_failed'
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN); signal.signal(signal.SIGTERM, signal.SIG_IGN)
        if process:
            owned = collect_owned(process_table(), owned, process.pid, socket_dir / 'unused.sock')
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
        copied_auth = out / 'home/.cursor/auth.json'
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
        print('Cursor fixture preflight failed; no credential is printed', file=sys.stderr); raise SystemExit(1)
