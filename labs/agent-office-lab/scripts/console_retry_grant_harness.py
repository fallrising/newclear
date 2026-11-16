#!/usr/bin/env python3
"""Isolated retry UI harness: real dispatcher/exec/slot; synthetic provider only.

No credentials or models. The temporary lab fingerprints a clearly labelled
failed provider stub. Production provider preflight alone is substituted.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading

import console_grant_harness as harness
import execution_slot as slots
import office_console
import pi_retry
import remote_grant as grants

PARENT = 'pi-work-SYNTHSECRET_0123456789abcdef'
OTHER = 'pi-work-SYNTHSECRET_fedcba9876543210'


def failed_report():
    return {'provider': 'pi', 'status': 'failed', 'model': 'deepseek-flash',
            'reason': 'synthetic_provider_stub', 'startup_only': False,
            'model_inference_verified': False, 'cleanup_errors': [], 'remaining_owned_processes': 0,
            'remote_usage': {'requests': 0, 'output_tokens': 0},
            'office': {'provider': 'pi', 'model': 'deepseek/deepseek-flash', 'status': 'failed', 'cleanup_completed': True}}


def seed(lab, name):
    run = lab / 'runs' / name
    run.mkdir(mode=0o700)
    with slots.execution_slot(lab):
        _, fixture = pi_retry.register(lab, run, 'task', {'marker': 'fixture', 'values': [7, 11, -2, 9]})
    (run / 'workspace').mkdir(mode=0o700)
    (run / 'workspace/input.json').write_text(json.dumps(fixture))
    (run / 'result.json').write_text(json.dumps(failed_report()))


def runner_source():
    return '''# Synthetic failed provider: no network, credentials or model.
import argparse,json,sys
from pathlib import Path
sys.path.insert(0, PRODUCTION_SCRIPTS)
import execution_slot as slots
import pi_retry
import remote_grant as grants
from console_retry_grant_harness import failed_report
p=argparse.ArgumentParser()
p.add_argument('--allow-remote',action='store_true',required=True)
p.add_argument('--authorization-ref',required=True)
a=p.parse_args()
lab=Path(__file__).resolve().parents[1]
assert grants.consumed(lab,a.authorization_ref)
with slots.execution_slot(lab):
    assert slots.retry_parent(lab) is not None
    run=lab/'runs/pi-work-harness-child'
    run.mkdir(mode=0o700)
    _,fixture=pi_retry.register(lab,run,'task',{})
    (run/'workspace').mkdir(mode=0o700)
    (run/'workspace/input.json').write_text(json.dumps(fixture))
    report=failed_report()
    report['authorization']={'kind':'server_grant','fingerprint':grants.fingerprint(a.authorization_ref)}
    (run/'result.json').write_text(json.dumps(report))
    print(json.dumps({'artifacts':str(run),'status':'failed','model_inference_verified':False}),flush=True)
raise SystemExit(1)
'''.replace('PRODUCTION_SCRIPTS', repr(str(Path(__file__).resolve().parent)))


class RetryHarnessConsole(office_console.Console):
    def __init__(self, *args, revoke=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.revoke = revoke
        self.spawn_count = 0
        self.processes = []

    def plan(self, selection):
        result = super().plan(selection)
        if self.revoke and result['executable'] and result['plan']['remote']:
            grants.revoke(self.lab, self.plans[result['plan_id']]['grant_id'])
        return result

    def spawn(self, command, log):
        if len(command) != 7 or command[2] != 'retry' or command[3] != PARENT or command[4:6] != ['--execute', '--remote-grant']:
            raise office_console.ConsoleError('unexpected_harness_command')
        code = '''import sys
from pathlib import Path
import office_dispatch as dispatch
dispatch.detect=lambda *a,**k: {'launch_prerequisites_present':True}
raise SystemExit(dispatch.launch('pi',False,Path(sys.argv[1]),retry_parent=sys.argv[2],remote_grant=sys.argv[3]))
'''
        process = subprocess.Popen([sys.executable, '-c', code, str(self.lab), command[3], command[6]],
            cwd=self.lab, env={'PATH': os.defpath, 'PYTHONPATH': str(Path(__file__).resolve().parent)},
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        self.spawn_count += 1
        self.processes.append(process)
        return process


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--scenario', choices=['retry', 'fresh', 'wrong', 'revoked'], required=True)
    args = parser.parse_args()
    root = harness.safe_directory(args.directory)
    initial = not root.exists()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    (root / '.office-grant-harness').touch(mode=0o600)
    lab = root / 'lab'; lab.mkdir(mode=0o700, exist_ok=True)
    if initial:
        harness.copy_sources(lab)
        (lab / 'scripts/run_pi_work.py').write_text(runner_source())
        seed(lab, PARENT)
        if args.scenario == 'wrong': seed(lab, OTHER)
        parent = None if args.scenario == 'fresh' else OTHER if args.scenario == 'wrong' else PARENT
        grants.create(lab, 'pi', 900, retry_parent=parent)
    app = RetryHarnessConsole(lab, remote_grant_providers=['pi'], revoke=args.scenario == 'revoked')
    server = office_console.serve(app)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    print(f'http://127.0.0.1:{server.server_port}/#token={app.token}', flush=True)
    def stop(*_): raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, stop)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        app.close(); server.shutdown(); server.server_close(); thread.join(5)
        result = {'spawn_count': app.spawn_count, 'all_direct_children_exited': all(p.poll() is not None for p in app.processes),
                  'server_thread_alive': thread.is_alive(), 'provider': 'synthetic_failed_stub', 'model_requests': 0}
        (root / 'harness-final.json').write_text(json.dumps(result, indent=2)+'\n')


if __name__ == '__main__':
    main()
