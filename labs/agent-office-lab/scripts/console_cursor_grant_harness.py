#!/usr/bin/env python3
"""Cursor console control test: real dispatcher/exec/slot, failed local provider stub.

No native Cursor, credentials or model requests. Never use this as inference or
native cancellation evidence. All writes are confined to a marked temporary lab.
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
import office_console
import remote_grant as grants


def runner_source():
    return '''# Synthetic failed provider; no network or credentials.
import argparse,json,signal,sys,time
from pathlib import Path
sys.path.insert(0, PRODUCTION_SCRIPTS)
import execution_slot as slots
import remote_grant as grants
p=argparse.ArgumentParser()
p.add_argument('--allow-remote',action='store_true',required=True)
p.add_argument('--authorization-ref',required=True)
a=p.parse_args()
lab=Path(__file__).resolve().parents[1]
stop=False
def interrupt(*_):
    global stop
    stop=True
signal.signal(signal.SIGINT,interrupt)
signal.signal(signal.SIGTERM,interrupt)
with slots.execution_slot(lab):
    authorization=grants.claim_runner(lab,a.authorization_ref,'cursor')
    slots.mark_started()
    run=lab/'runs/cursor-work-harness'
    run.mkdir(mode=0o700)
    started=time.monotonic()
    while not stop and time.monotonic()-started<20:
        time.sleep(0.05)
    report={'provider':'cursor','model':'composer-2.5','status':'failed',
        'reason':'synthetic_provider_stub','startup_only':False,
        'model_inference_verified':False,'cleanup_errors':[],
        'office':{'provider':'cursor','model':'composer-2.5','status':'failed','cleanup_completed':True},
        'authorization':{'kind':'server_grant','fingerprint':authorization}}
    (run/'result.json').write_text(json.dumps(report))
    slots.mark_clean()
    print(json.dumps({'artifacts':str(run),'status':'failed','model_inference_verified':False}),flush=True)
raise SystemExit(1)
'''.replace('PRODUCTION_SCRIPTS', repr(str(Path(__file__).resolve().parent)))


class CursorHarnessConsole(harness.HarnessConsole):
    def spawn(self, command, log):
        if len(command) != 7 or command[2:6] != ['run', 'cursor', '--execute', '--remote-grant']:
            raise office_console.ConsoleError('unexpected_harness_command')
        code = '''import sys
from pathlib import Path
import office_dispatch as dispatch
dispatch.detect=lambda *a,**k: {'launch_prerequisites_present':True}
raise SystemExit(dispatch.launch('cursor',False,Path(sys.argv[1]),remote_grant=sys.argv[2]))
'''
        process = subprocess.Popen([sys.executable, '-c', code, str(self.lab), command[6]],
            cwd=self.lab, env={'PATH':os.defpath, 'PYTHONPATH':str(Path(__file__).resolve().parent)},
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        self.spawn_count += 1
        self.processes.append(process)
        harness.write_status(self.harness_root, self.spawn_count, self.consumed_count, True)
        return process

    def snapshot(self):
        result = super().snapshot()
        # Read actual atomic consumption; spawning is not evidence of consumption.
        count = sum(row.get('authorization_consumed') is True for row in result['jobs'])
        self.consumed_count = max(self.consumed_count, count)
        harness.write_status(self.harness_root, self.spawn_count, self.consumed_count,
                             any(p.poll() is None for p in self.processes))
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harness', action='store_true', required=True)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--scenario', choices=['no_optin', 'no_grant', 'grant', 'revoke_after_plan'], required=True)
    args = parser.parse_args()
    root = harness.safe_directory(args.directory)
    initial = not root.exists()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    (root / '.office-grant-harness').touch(mode=0o600)
    lab = root / 'lab'; lab.mkdir(mode=0o700, exist_ok=True)
    if initial:
        harness.copy_sources(lab, 'cursor')
        (lab / 'scripts/run_cursor_work.py').write_text(runner_source())
        if args.scenario != 'no_grant': grants.create(lab, 'cursor', 900)
    app = CursorHarnessConsole(root, lab=lab, remote_grant_providers=[] if args.scenario == 'no_optin' else ['cursor'],
                               revoke_after_plan=args.scenario == 'revoke_after_plan')
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
        app.snapshot()
        (root / 'harness-final.json').write_text(json.dumps({
            'all_direct_children_exited': all(p.poll() is not None for p in app.processes),
            'server_thread_alive': thread.is_alive(), 'model_requests': 0,
            'provider': 'synthetic_failed_stub'})+'\n')


if __name__ == '__main__': main()
