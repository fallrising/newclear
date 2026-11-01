#!/usr/bin/env python3
"""Prepare or run one native Office/Pi synthetic task with a bounded DeepSeek relay."""
import argparse
from execution_slot import guarded_main, mark_started, mark_clean
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import time
from deepseek_relay import Relay, MAX_REQUESTS, MAX_OUTPUT, MAX_BODY
from remote_cli import LAB, isolated_env, private_directory, probe, write_new_private


def prepare(out, port, token):
    workspace = private_directory(out / 'workspace')
    home = private_directory(out / 'home')
    agent = private_directory(home / 'pi')
    tmp = private_directory(out / 'tmp')
    write_new_private(workspace / 'input.json', {'marker': secrets.token_hex(12), 'values': [7, 11, -2, 9]})
    write_new_private(agent / 'auth.json', {'deepseek': {'type': 'api_key', 'key': token}})
    write_new_private(agent / 'models.json', {'providers': {'deepseek': {'baseUrl': f'http://127.0.0.1:{port}/v1',
        'api': 'openai-completions', 'models': [{'id': 'deepseek-flash', 'name': 'DeepSeek bounded fixture',
        'reasoning': False, 'contextWindow': 32768, 'maxTokens': MAX_OUTPUT}]}}})
    write_new_private(agent / 'settings.json', {'defaultProvider': 'deepseek', 'defaultModel': 'deepseek-flash',
        'defaultThinkingLevel': 'off', 'retry': {'enabled': False, 'provider': {'maxRetries': 0}},
        'compaction': {'enabled': False}, 'cacheWarming': {'enabled': False}})
    profile = ('(version 1)(allow default)(deny network*)'
               '(allow network-outbound (remote ip "localhost:*"))'
               '(allow network-inbound network-bind (local ip "localhost:*"))'
               '(allow network* (local unix-socket) (remote unix-socket))'
               '(deny file-write*)'
               f'(allow file-write* (subpath {json.dumps(str(out))}))'
               '(allow file-write* (regex #"^/dev/"))'
               f'(deny file-read* (subpath {json.dumps(str(LAB / ".local"))}))')
    (out / 'pi.sb').write_text(profile)
    env = isolated_env(home, 'pi')
    env.update(TMPDIR=str(tmp), LAB_PI_OUT=str(out), LAB_PI_WORKSPACE=str(workspace),
               PATH=str(LAB / 'scripts/bin') + os.pathsep + os.environ['PATH'])
    return env


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--check-startup', action='store_true', help='Real Office/Pi boot, no remote request permitted')
    group.add_argument('--allow-remote', action='store_true', help='Authorize one bounded paid DeepSeek fixture run')
    args = parser.parse_args()
    if not args.allow_remote and not args.check_startup:
        print(json.dumps({'mode': 'plan', 'command': 'python3 scripts/run_pi_work.py --allow-remote',
                          'provider': 'pi', 'model': 'deepseek-flash', 'max_requests': MAX_REQUESTS,
                          'max_output_tokens_per_request': MAX_OUTPUT, 'max_request_bytes': MAX_BODY,
                          'timeout_seconds': 180, 'automatic_retries': False, 'remote_requests_sent': False}, indent=2))
        return 0
    if not probe('pi')['compatible']:
        raise ValueError('Pi preflight failed')
    api_key = None
    if args.allow_remote:
        auth = LAB / '.local/remote/pi/auth.json'
        if auth.is_symlink() or auth.stat().st_mode & 0o077:
            raise ValueError('Pi credentials require a private regular file')
        saved = json.loads(auth.read_text()).get('deepseek', {})
        if saved.get('type') != 'api_key' or not isinstance(saved.get('key'), str) or not saved['key']:
            raise ValueError('DeepSeek key missing')
        api_key = saved['key']
    mark_started()
    out = private_directory(LAB / 'runs' / ('pi-work-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')))
    token = secrets.token_urlsafe(32)
    relay = Relay(token, api_key)
    process = None
    report = {'status': 'starting', 'startup_only': args.check_startup, 'provider': 'pi', 'model': 'deepseek-flash',
              'model_inference_verified': False, 'cleanup_errors': [], 'cloud_fallback': False}
    started = time.monotonic()
    def interrupted(*_):
        raise InterruptedError('Interrupted')
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    try:
        port = relay.start()
        env = prepare(out, port, token)
        for name in ('execution_slot.py', 'run_pi_work.py', 'deepseek_relay.py', 'office_pi.mjs', 'pi_boundary.mjs', 'pi_office_policy.mjs', 'remote_cli.py'):
            shutil.copy2(LAB / 'scripts' / name, out / name)
        shutil.copy2(LAB / 'scripts/bin/pi', out / 'pi-launcher.py')
        command = [shutil.which('node'), str(LAB / 'scripts/office_pi.mjs'), str(out)]
        if args.check_startup: command.append('--check-startup')
        with (out / 'office.stdout.log').open('w') as stdout, (out / 'office.stderr.log').open('w') as stderr:
            process = subprocess.Popen(command, cwd=out, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
            code = process.wait(timeout=180)
        office = json.loads((out / 'office-result.json').read_text())
        report['office'] = office
        if code or office['status'] != 'completed': raise ValueError('Native Office/Pi acceptance failed')
        if args.check_startup:
            if relay.records: raise ValueError('Startup unexpectedly requested inference')
        else:
            if not relay.records or any(r['status'] != 'completed' for r in relay.records): raise ValueError('Provider requests did not complete')
            if not any(r.get('output_tokens', 0) > 0 for r in relay.records): raise ValueError('No provider usage evidence')
            if not office.get('file_task_passed') or not office.get('agent_settled_verified'): raise ValueError('Missing native evidence')
            report['model_inference_verified'] = True
        report['status'] = 'completed'
    except (OSError, ValueError, subprocess.SubprocessError):
        report['status'] = 'failed'; report['reason'] = 'bounded_pi_acceptance_failed'
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN); signal.signal(signal.SIGTERM, signal.SIG_IGN)
        if process and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL); process.wait(); report['cleanup_errors'].append('forced_process_group_stop')
        relay.close()
        if (out / 'office-result.json').is_file(): report['office'] = json.loads((out / 'office-result.json').read_text())
        report['requests'] = relay.records
        report['elapsed_s'] = time.monotonic() - started
        if not report.get('office', {}).get('cleanup_completed'): report['cleanup_errors'].append('native_cleanup_not_verified')
        if report['cleanup_errors']: report['status'] = 'failed'
        (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'model_inference_verified': report['model_inference_verified'],
              'requests': len(relay.records), 'cleanup_errors': report['cleanup_errors'], 'artifacts': str(out)}, indent=2))
    if not report['cleanup_errors']:
        mark_clean()
    return 0 if report['status'] == 'completed' else 1


if __name__ == '__main__':
    try: raise SystemExit(guarded_main(main, bool(set(sys.argv[1:]) & {'--allow-remote', '--check-startup'})))
    except (OSError, ValueError):
        print('Pi fixture could not start; check preflight and isolated credentials. No secret is printed.', file=sys.stderr)
        raise SystemExit(1)
