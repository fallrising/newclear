#!/usr/bin/env python3
"""Native Office/Cursor startup with no credentials, no prompt and no external network."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from remote_cli import LAB, private_directory
from cursor_cli import PIN, isolated_cursor_env, probe
from run_grok_startup import process_table, collect_owned, alive_owned
from grok_startup import sandbox_profile

SOURCES = ['run_cursor_startup.py', 'cursor_cli.py', 'grok_startup.py', 'run_grok_startup.py',
           'office_cursor.mjs', 'cursor_office_policy.mjs', 'remote_cli.py', 'bin/cursor-agent']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-startup', action='store_true')
    args = parser.parse_args()
    if not args.check_startup:
        print(json.dumps({'mode': 'plan', 'provider': 'cursor', 'version': PIN['version'],
              'command': 'python3 scripts/run_cursor_startup.py --check-startup',
              'model_inference_verified': False, 'credentials_loaded': False,
              'workspace_trust': 'new_synthetic_fixture_only', 'external_network': 'denied',
              'timeout_seconds': 45}, indent=2))
        return 0
    preflight = probe()
    if not preflight['compatible']:
        print(json.dumps(preflight)); return 1
    out = private_directory(LAB / 'runs' / ('cursor-startup-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')))
    home = private_directory(out / 'home')
    workspace = private_directory(out / 'workspace')
    (workspace / 'input.json').write_text('{"values":[7,11,-2,9]}\n')
    socket_dir = Path(tempfile.mkdtemp(prefix='office-cursor-', dir='/private/tmp'))
    socket = socket_dir / 'leader.sock'
    env = isolated_cursor_env(home)
    env.update(TMPDIR=str(socket_dir), LAB_CURSOR_OUT=str(out), LAB_CURSOR_TMP=str(socket_dir),
               PATH=str(LAB / 'scripts/bin') + os.pathsep + os.environ['PATH'])
    (out / 'cursor.sb').write_text(sandbox_profile(out, socket_dir))
    hashes = {}
    for name in SOURCES:
        source = LAB / 'scripts' / name
        hashes[name] = hashlib.sha256(source.read_bytes()).hexdigest()
        shutil.copy2(source, out / name.replace('/', '-'))
    report = {'status': 'starting', 'provider': 'cursor', 'version': PIN['version'],
              'model_inference_verified': False, 'authentication_verified': False,
              'credentials_loaded': False, 'prompt_supplied': False,
              'external_network_denied': True, 'workspace_trust': 'synthetic_fixture_only',
              'source_sha256': hashes, 'cleanup_errors': []}
    process = None; owned = {}; started = time.monotonic()
    def interrupted(*_):
        raise InterruptedError('Interrupted')
    signal.signal(signal.SIGINT, interrupted); signal.signal(signal.SIGTERM, interrupted)
    try:
        # Prove the profile rejects off-host TCP before letting the native CLI start.
        denied = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(out / 'cursor.sb'), sys.executable,
            '-c', 'import socket; s=socket.socket(); s.settimeout(2); print(s.connect_ex(("192.0.2.1",443)))'],
            env=env, cwd=workspace, capture_output=True, text=True, timeout=5)
        if denied.returncode or denied.stdout.strip() not in ('1', '13'):
            raise ValueError('External network denial could not be verified')
        report['external_tcp_denial_verified'] = True
        with (out / 'office.stdout.log').open('w') as stdout, (out / 'office.stderr.log').open('w') as stderr:
            process = subprocess.Popen([shutil.which('node'), str(LAB / 'scripts/office_cursor.mjs'), str(out)],
                cwd=out, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
            while process.poll() is None:
                owned = collect_owned(process_table(), owned, process.pid, socket)
                if time.monotonic() - started > 45:
                    raise TimeoutError('Startup deadline')
                time.sleep(0.1)
        office = json.loads((out / 'office-result.json').read_text())
        report['office'] = office
        if process.returncode or office['status'] != 'completed':
            raise ValueError('Native Cursor startup failed')
        report['status'] = 'completed'
    except (OSError, ValueError, subprocess.SubprocessError):
        report['status'] = 'failed'; report['reason'] = 'native_cursor_startup_failed'
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN); signal.signal(signal.SIGTERM, signal.SIG_IGN)
        if process:
            owned = collect_owned(process_table(), owned, process.pid, socket)
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=12)
                except subprocess.TimeoutExpired: report['cleanup_errors'].append('office_shutdown_timeout')
            # Stop only the processes observed under this run's Office host.
            remaining = alive_owned(process_table(), owned)
            report['owned_processes_seen'] = len(owned)
            report['additional_processes_stopped'] = len(remaining)
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
        if (out / 'office-result.json').is_file():
            report['office'] = json.loads((out / 'office-result.json').read_text())
        if not report.get('office', {}).get('cleanup_completed'):
            report['cleanup_errors'].append('native_cleanup_not_verified')
        if report['cleanup_errors']: report['status'] = 'failed'
        report['cleanup_completed'] = not report['cleanup_errors']
        report['elapsed_s'] = time.monotonic() - started
        (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        if report['cleanup_completed']: shutil.rmtree(socket_dir)
        print(json.dumps({'status': report['status'], 'model_inference_verified': False,
                          'cleanup_completed': report['cleanup_completed'], 'artifacts': str(out)}, indent=2))
    return 0 if report['status'] == 'completed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
