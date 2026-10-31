#!/usr/bin/env python3
"""Probe current process capabilities and launch a bounded LOCAL-provider Codex child.

No sandbox elevation; no cloud model fallback; does not change global configuration.
"""
import ctypes
import datetime
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

LAB = Path(__file__).resolve().parents[1]

def main():
    out = LAB / 'runs' / ('local-codex-' + datetime.datetime.now(
        datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    out.mkdir(parents=True)
    report = {'cloud_fallback': False, 'permission_escalation': False, 'checks': {}}
    try:
        metal = ctypes.CDLL('/System/Library/Frameworks/Metal.framework/Metal')
        metal.MTLCreateSystemDefaultDevice.restype = ctypes.c_void_p
        report['checks']['metal_device_available'] = bool(metal.MTLCreateSystemDefaultDevice())
    except Exception as exc:
        report['checks']['metal_error'] = str(exc)
    try:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            sock.listen(1)
            report['checks']['loopback_bind'] = 'passed'
    except OSError as exc:
        report['checks']['loopback_bind'] = str(exc)
    check = subprocess.run(['/usr/sbin/sysctl', 'vm.swapusage',
        'kern.memorystatus_vm_pressure_level'], capture_output=True, text=True)
    report['checks']['resource_sysctl'] = {'returncode': check.returncode,
        'stdout': check.stdout.strip(), 'stderr': check.stderr.strip()}
    settings = {
        'model': 'qwen3.8-flash-next-q2_0',
        'model_provider': 'strata_local',
        'model_context_window': 32768,
        'model_auto_compact_token_limit': 24576,
        'model_reasoning_effort': 'none',
        'web_search': 'disabled',
        'analytics.enabled': False,
        'feedback.enabled': False,
        'check_for_update_on_startup': False,
        'otel.exporter': 'none',
        'otel.metrics_exporter': 'none',
        'otel.trace_exporter': 'none',
        'sqlite_home': str(out / 'state'),
        'model_providers.strata_local.name': 'Strata localhost only',
        'model_providers.strata_local.base_url': 'http://127.0.0.1:8080/v1',
        'model_providers.strata_local.wire_api': 'responses',
        'model_providers.strata_local.requires_openai_auth': False,
        'model_providers.strata_local.supports_websockets': False,
        'model_providers.strata_local.request_max_retries': 0,
        'model_providers.strata_local.stream_max_retries': 0,
        'model_providers.strata_local.stream_idle_timeout_ms': 15000,
    }
    command = ['/opt/homebrew/bin/codex', '--no-daemon', '--ask-for-approval', 'never',
        'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
        '--sandbox', 'workspace-write', '-C', str(LAB), '--json']
    for key, value in settings.items():
        command.extend(['-c', key + '=' + json.dumps(value)])
    command.append('Local connection smoke test. Do not use tools or read files. Reply exactly LOCAL_MODEL_OK.')
    (out / 'command.json').write_text(json.dumps(command, indent=2) + '\n')
    # Only synthetic content is submitted; no credentials copied into the provider configuration.
    env = dict(os.environ)
    for key in ('OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'AZURE_OPENAI_API_KEY'):
        env.pop(key, None)
    started = time.monotonic()
    with (out / 'stdout.jsonl').open('w') as stdout, (out / 'stderr.log').open('w') as stderr:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, env=env)
        report['child_pid'] = child.pid
        try:
            report['child_exit_code'] = child.wait(timeout=45)
        except subprocess.TimeoutExpired:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            report.update(child_exit_code=child.returncode, timeout=True)
    report['elapsed_s'] = time.monotonic() - started
    report['child_exited'] = child.poll() is not None
    report['inference_verified'] = False
    output = (out / 'stdout.jsonl').read_text()
    for line in output.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        item = event.get('item', {})
        if item.get('type') == 'agent_message' and item.get('text', '').strip() == 'LOCAL_MODEL_OK':
            report['inference_verified'] = report['child_exit_code'] == 0
    (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(dict(report, artifacts=str(out)), indent=2))
    print((out / 'stderr.log').read_text()[-5000:])
    print(output[-3000:])
    return 0 if report['inference_verified'] else 1

if __name__ == '__main__':
    sys.exit(main())
