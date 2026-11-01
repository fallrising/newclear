#!/usr/bin/env python3
"""Own a guarded Strata server and a local-provider Codex file task.

Run from an environment that permits Metal, loopback and Codex sandbox creation.
No cloud fallback. No permission escalation. Uses synthetic input only.
"""
import argparse
from execution_slot import guarded_main, mark_started, mark_clean
import ctypes
import datetime
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import tomllib
import urllib.request
import uuid

import psutil
from local_opencode import prepare as prepare_opencode

LAB = Path(__file__).resolve().parents[1]
ROOT = LAB.parent
STRATA = Path(os.environ.get('STRATA_HOME', str(ROOT / 'strata-mac'))).expanduser().resolve()
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def flatten(value, prefix=''):
    for key, item in value.items():
        name = prefix + key
        if isinstance(item, dict):
            yield from flatten(item, name + '.')
        else:
            yield name, item

def stop_owned(proc):
    if proc is None:
        return
    try:
        children = psutil.Process(proc.pid).children(recursive=True)
    except psutil.NoSuchProcess:
        children = []
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
    for child in children:
        try:
            child.terminate()
        except psutil.NoSuchProcess:
            pass
    _, alive = psutil.wait_procs(children, timeout=5)
    for child in alive:
        try:
            child.kill()
        except psutil.NoSuchProcess:
            pass
    _, alive = psutil.wait_procs(alive, timeout=5)
    if alive:
        raise RuntimeError('Owned descendants remain alive')

def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--task', choices=('file', 'queue-repair'), default='file')
    parser.add_argument('--harness', choices=('codex', 'opencode', 'office-opencode'), default='codex')
    parser.add_argument('--keep-open', action='store_true', help='Keep the verified local Office demo open until Ctrl+C')
    parser.add_argument('--check-cancel', action='store_true', help='Verify cancelling a second task through the native Office')
    parser.add_argument('--check-lifecycle', action='store_true', help='Verify synthetic permission replies, browser refresh and native session resume')
    parser.add_argument('--check-restart', action='store_true', help='Verify actual Office host crash, interrupted state and manual resume')
    args = parser.parse_args()
    if (args.keep_open or args.check_cancel or args.check_lifecycle or args.check_restart) and args.harness != 'office-opencode':
        parser.error('Office lifecycle options require --harness office-opencode')
    if args.check_lifecycle and (args.task != 'file' or args.check_cancel or args.keep_open):
        parser.error('--check-lifecycle is a bounded file test; do not combine with --check-cancel or --keep-open')
    if args.check_restart and (args.task != 'file' or args.check_cancel or args.check_lifecycle or args.keep_open):
        parser.error('--check-restart is a separate bounded file acceptance')
    mark_started()
    out = LAB / 'runs' / ('local-work-' + datetime.datetime.now(
        datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    workspace = out / 'workspace'
    workspace.mkdir(parents=True)
    (out / 'runner.py').write_text(Path(__file__).read_text())
    if args.harness != 'codex':
        for name in ('execution_slot.py', 'local_opencode.py', 'office_opencode.mjs', 'local_office_policy.mjs', 'permission_probe.mjs', 'manual_recovery.mjs',
                     'office_runtime.mjs', 'office_host.mjs', 'office_restart.mjs'):
            (out / name).write_text((LAB / 'scripts' / name).read_text())
        (out / 'opencode-launcher.py').write_text((LAB / 'scripts/bin/opencode').read_text())
    codex_home = out / 'codex-home'
    codex_home.mkdir()
    fixture = {'marker': uuid.uuid4().hex, 'values': [7, 11, 24]}
    (workspace / 'input.json').write_text(json.dumps(fixture) + '\n')
    if args.task == 'queue-repair':
        shutil.copytree(LAB / 'fixtures/queue-repair', workspace, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('__pycache__'))
        (out / 'verifier.py').write_text((LAB / 'scripts/verify_queue_repair.py').read_text())
    cfg = json.loads((STRATA / 'source/strata-q2_0.json').read_text())
    cfg['args'][cfg['args'].index('--max-context') + 1] = '32768'
    cfg.update(log=str(out / 'engine.log'), host='127.0.0.1', port=8080, open_browser=False)
    if args.harness != 'codex':
        cfg['reasoning_effort'] = 'none'
    (out / 'strata-config.json').write_text(json.dumps(cfg, indent=2) + '\n')
    settings = tomllib.loads((LAB / 'configs/codex-strata-local.toml').read_text())
    settings['sqlite_home'] = str(out / 'codex-state')
    assert settings['model_provider'] == 'strata_local'
    assert settings['model_providers']['strata_local']['base_url'] == 'http://127.0.0.1:8080/v1'
    command = ['/opt/homebrew/bin/codex', '--no-daemon', '--ask-for-approval', 'never',
               'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
               '--sandbox', 'workspace-write', '-C', str(workspace), '--json']
    for key, value in flatten(settings):
        command.extend(['-c', key + '=' + json.dumps(value)])
    prompt = 'Work only in the current directory. Read input.json with your local file or shell tool. '
    if args.task == 'queue-repair':
        prompt += ('Read README.md and repair task_queue.py to satisfy the specification. '
                   'Use the shell tool to write the file (for example a Python script or cat heredoc); '
                   'do not use apply_patch. Execute tool calls, do not print tool-call markup or patches as text. '
                   'Run python3 -m unittest -v and fix any failures. Do not change README.md or the tests. ')
    command.append(prompt +
        'Create result.json containing exactly the input marker as marker and the sum of the values as total. '
        'Do not use network tools, install anything, or read other directories. Then report completion.')
    opencode_env = None
    if args.harness == 'opencode':
        opencode_command, opencode_env = prepare_opencode(out, workspace)
        command = opencode_command + ['run', '--dir', str(workspace), '--format', 'json',
                                     '--model', 'strata/' + settings['model'], '--title', 'Synthetic lab file task', command[-1]]
    elif args.harness == 'office-opencode':
        (out / 'prompt.txt').write_text(command[-1])
        _, opencode_env = prepare_opencode(out, workspace)
        driver = 'office_restart.mjs' if args.check_restart else 'office_opencode.mjs'
        command = [shutil.which('node'), str(LAB / 'scripts' / driver), str(out),
                   str(workspace), str(out / 'prompt.txt')]
        if args.keep_open:
            command.append('--keep-open')
        if args.check_cancel:
            command.append('--check-cancel')
        if args.check_lifecycle:
            command.append('--check-lifecycle')
    events_name = args.harness + '.jsonl'
    (out / f'{args.harness}-command.json').write_text(json.dumps(command, indent=2) + '\n')
    report = {'status': 'prepared', 'harness': args.harness, 'task': args.task, 'cloud_fallback': False, 'model': settings['model'],
              'context': 32768, 'model_inference_verified': False, 'file_task_passed': False,
              'strict_network_isolation_verified': False}
    print(f'Artifacts: {out}', flush=True)
    server = guard = codex = awake = None
    handles = []
    started = time.monotonic()
    def interrupted(signum, frame):
        raise RuntimeError(f'Interrupted by signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    def log(name):
        handle = (out / name).open('w')
        handles.append(handle)
        return handle
    def check_repair(stage):
        # Generated Python never runs with the runner's elevated host permissions.
        # Independent verifier: deny network and all filesystem writes (including evidence).
        check = ['/usr/bin/sandbox-exec', '-p',
                 '(version 1)(allow default)(deny network*)(deny file-write*)',
                 sys.executable, '-I', '-B', str(out / 'verifier.py'), str(workspace / 'task_queue.py')]
        (out / f'{stage}-command.json').write_text(json.dumps(check, indent=2) + '\n')
        result = subprocess.run(check, cwd=workspace, env=env, stdout=log(f'{stage}.log'),
                                stderr=subprocess.STDOUT, timeout=30)
        return result.returncode
    try:
        if args.prepare_only:
            return 0
        report['status'] = 'preflight'
        metal = ctypes.CDLL('/System/Library/Frameworks/Metal.framework/Metal')
        metal.MTLCreateSystemDefaultDevice.restype = ctypes.c_void_p
        if not metal.MTLCreateSystemDefaultDevice():
            raise RuntimeError('No Metal device visible in this execution environment')
        subprocess.run(['/usr/sbin/sysctl', 'vm.swapusage', 'kern.memorystatus_vm_pressure_level'],
                       check=True, stdout=log('preflight.log'), stderr=subprocess.STDOUT)
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(('127.0.0.1', 8080))
        env = dict(os.environ, PYTHONUNBUFFERED='1', DO_NOT_TRACK='1')
        # Give this child its own Codex state/skills/plugins/auth directory.
        # --ignore-user-config alone only skips config.toml.
        for key in list(env):
            if key.startswith('CODEX_'):
                env.pop(key)
        env['CODEX_HOME'] = str(codex_home)
        env['STRATA_DEBUG'] = '1'
        for key in ('OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'AZURE_OPENAI_API_KEY'):
            env.pop(key, None)
        for key, subdir in {'XDG_CACHE_HOME': '.cache', 'XDG_CONFIG_HOME': '.config',
            'XDG_DATA_HOME': '.local/share', 'HF_HOME': '.cache/huggingface', 'TMPDIR': '.cache/tmp'}.items():
            env[key] = str(STRATA / subdir)
        # Local inference requests must not traverse an inherited HTTP proxy.
        for key in ('NO_PROXY', 'no_proxy'):
            env[key] = ','.join(filter(None, [env.get(key), '127.0.0.1', 'localhost', '::1']))
        if args.task == 'queue-repair':
            report['baseline_exit_code'] = check_repair('baseline')
            if report['baseline_exit_code'] == 0 or 'FAILED (' not in (out / 'baseline.log').read_text():
                raise RuntimeError('Broken fixture did not produce expected baseline test failures')
        guard = subprocess.Popen([sys.executable, str(LAB / 'scripts/model-test-monitor.py'),
            '--pid', str(os.getpid()), '--output', str(out / 'resources.jsonl')],
            stdout=log('guard.log'), stderr=subprocess.STDOUT)
        awake = subprocess.Popen(['/usr/bin/caffeinate', '-i', '-w', str(os.getpid())])
        time.sleep(1)
        if guard.poll() is not None:
            raise RuntimeError('Resource guard could not start')
        report['status'] = 'starting_server'
        server = subprocess.Popen([sys.executable, str(STRATA / 'source/serve/server.py'),
            '--engine', 'strata', '--config', str(out / 'strata-config.json'),
            '--host', '127.0.0.1', '--port', '8080', '--offline'],
            cwd=STRATA / 'source', env=env, stdin=subprocess.DEVNULL,
            stdout=log('server.log'), stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            if server.poll() is not None or guard.poll() is not None:
                raise RuntimeError('Server or resource guard exited during startup')
            try:
                with OPENER.open('http://127.0.0.1:8080/health', timeout=2) as response:
                    health = json.load(response)
                if health.get('loaded') and health.get('max_context') == 32768:
                    report['health'] = health
                    break
            except (OSError, ValueError):
                pass
            time.sleep(1)
        else:
            raise TimeoutError('Strata startup exceeded 10 minutes')
        report['status'] = 'running_local_codex'
        print(f'Strata ready at 32K; running synthetic {args.task} task.', flush=True)
        codex = subprocess.Popen(command, env=opencode_env or env, cwd=workspace, stdin=subprocess.DEVNULL,
            stdout=log(events_name), stderr=log(args.harness + '.stderr.log'))
        deadline = time.monotonic() + 900
        preview_ready = False
        while codex.poll() is None:
            if server.poll() is not None or guard.poll() is not None:
                raise RuntimeError('Server or resource guard stopped')
            if args.keep_open and not preview_ready and (out / 'office-ready.json').exists():
                print((out / 'office-ready.json').read_text(), flush=True)
                print('Local demo remains open. Ctrl+C stops the Office and Strata.', flush=True)
                preview_ready = True
            if time.monotonic() > deadline and not preview_ready:
                raise TimeoutError('Codex task exceeded 15 minutes')
            time.sleep(1)
        report['agent_exit_code'] = codex.returncode
        if args.harness == 'codex':
            report['codex_exit_code'] = codex.returncode
        for handle in handles:
            handle.flush()
        events = []
        for line in (out / events_name).read_text().splitlines():
            try:
                events.append(json.loads(line))
            except ValueError:
                pass
        completed = [e for e in events if e.get('type') == 'turn.completed']
        report['codex_errors'] = [e for e in events if e.get('type') in ('error', 'turn.failed')]
        report['completed_turn_usage'] = [e.get('usage') for e in completed]
        report['model_inference_verified'] = any(
            isinstance(e.get('usage'), dict)
            and isinstance(e['usage'].get('output_tokens'), (int, float))
            and e['usage']['output_tokens'] > 0 for e in completed)
        if args.harness == 'opencode':
            report['opencode_usage'] = [e.get('part', {}).get('tokens', {}) for e in events if e.get('type') == 'step_finish']
            report['model_inference_verified'] = any(u.get('output', 0) > 0 for u in report['opencode_usage'])
            report['agent_errors'] = [e for e in events if e.get('type') == 'error']
        elif args.harness == 'office-opencode':
            office_result = json.loads((out / 'office-result.json').read_text())
            report['office_result'] = office_result
            report['model_inference_verified'] = office_result.get('model_inference_verified') is True
        if not (workspace / 'result.json').is_file():
            raise RuntimeError(f'{args.harness} did not create result.json; see its event and stderr logs')
        result = json.loads((workspace / 'result.json').read_text())
        report['file_task_passed'] = result == {'marker': fixture['marker'], 'total': sum(fixture['values'])}
        if codex.returncode or not report['model_inference_verified'] or not report['file_task_passed']:
            raise RuntimeError(report.get('office_result', {}).get('error') or
                               f'Local {args.harness} did not complete the task correctly')
        if args.task == 'queue-repair':
            report['fixture_integrity'] = all(
                (workspace / name).read_bytes() == (LAB / 'fixtures/queue-repair' / name).read_bytes()
                for name in ('README.md', 'test_task_queue.py'))
            report['code_changed'] = ((workspace / 'task_queue.py').read_bytes() !=
                                      (LAB / 'fixtures/queue-repair/task_queue.py').read_bytes())
            report['acceptance_exit_code'] = check_repair('acceptance')
            report['code_task_passed'] = (report['fixture_integrity'] and report['code_changed']
                                          and report['acceptance_exit_code'] == 0)
            if not report['code_task_passed']:
                raise RuntimeError('Code repair failed independent acceptance checks')
        report['status'] = 'completed'
    except Exception as exc:
        report.update(status='failed', error=str(exc))
        if args.keep_open and isinstance(exc, RuntimeError) and str(exc).startswith('Interrupted by signal'):
            if (out / 'office-result.json').exists():
                office_result = json.loads((out / 'office-result.json').read_text())
                if ((out / 'office-ready.json').exists() and office_result.get('file_task_passed')
                        and office_result.get('model_inference_verified')):
                    report.update(status='stopped', office_result=office_result, file_task_passed=True,
                                  model_inference_verified=True)
    finally:
        report['cleanup_errors'] = []
        for proc in (codex, server, guard, awake):
            try:
                stop_owned(proc)
            except Exception as exc:
                report['cleanup_errors'].append(str(exc))
        for handle in handles:
            handle.close()
        if args.harness == 'office-opencode' and (out / 'office-result.json').exists():
            report['office_result'] = json.loads((out / 'office-result.json').read_text())
        if report['cleanup_errors']:
            report['status'] = 'failed'
        report['elapsed_s'] = time.monotonic() - started
        (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(dict(report, artifacts=str(out)), indent=2), flush=True)
    if not report['cleanup_errors'] and (args.harness != 'office-opencode' or report.get('office_result', {}).get('cleanup_completed') is True):
        mark_clean()
    return 0 if report['status'] in ('completed', 'stopped') else 1

if __name__ == '__main__':
    sys.exit(guarded_main(main, '--prepare-only' not in sys.argv and not set(sys.argv[1:]) & {'--help', '-h'}))
