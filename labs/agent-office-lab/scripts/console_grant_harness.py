#!/usr/bin/env python3
"""Private offline harness for browser remote-grant console tests.

It creates a synthetic lab under the system temp directory, never reads real
credentials, and uses real dispatcher/exec/claims with a local Python provider stub.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

import office_console
import remote_grant

PRODUCTION_LAB = Path(__file__).resolve().parents[1]
SOURCES = remote_grant.SOURCE_NAMES


def safe_directory(value):
    roots = {Path(tempfile.gettempdir()).resolve(), Path('/tmp').resolve()}
    supplied = Path(value).expanduser().absolute()
    path = supplied.resolve()
    if supplied != path or not any(path != root and path.is_relative_to(root) for root in roots):
        raise ValueError('harness_directory_must_be_physical_and_under_temp')
    if path.exists() and not (path / '.office-grant-harness').is_file():
        raise ValueError('harness_requires_fresh_directory_or_its_own_marker')
    return path


def copy_sources(lab, provider='pi'):
    scripts = lab / 'scripts'
    scripts.mkdir(parents=True, mode=0o700, exist_ok=True)
    for name in SOURCES if provider == 'pi' else remote_grant.CURSOR_SOURCE_NAMES:
        source = PRODUCTION_LAB / 'scripts' / name
        target = scripts / name
        target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        shutil.copy2(source, target)
    if provider == 'cursor':
        lock = lab / 'tools/cursor/cli-lock.json'
        lock.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(PRODUCTION_LAB / 'tools/cursor/cli-lock.json', lock)
    (lab / 'runs').mkdir(mode=0o700, exist_ok=True)


def write_status(root, spawn_count, consumed_count, active):
    path = root / 'harness.json'
    tmp = root / ('.harness-' + os.urandom(8).hex())
    tmp.write_text(json.dumps({'spawn_count': spawn_count, 'consumed_count': consumed_count, 'active': active}, sort_keys=True) + '\n')
    tmp.chmod(0o600)
    os.replace(tmp, path)


def stub_code(lab):
    return r'''# Synthetic failed provider; no network or credentials.
import argparse,datetime,json,signal,sys,time
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
def handler(*_):
    global stop; stop=True
signal.signal(signal.SIGINT,handler);signal.signal(signal.SIGTERM,handler)
with slots.execution_slot(lab):
    authorization=grants.claim_runner(lab,a.authorization_ref,'pi')
    slots.mark_started()
    run=lab/'runs'/('pi-work-harness-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    (run/'workspace').mkdir(parents=True,exist_ok=False)
    started=time.monotonic()
    while not stop and time.monotonic()-started<20:
        time.sleep(0.1)
    report={'status':'failed','reason':'harness_stub','provider':'pi','model':'deepseek-flash','model_inference_verified':False,
            'cleanup_errors':[],'startup_only':False,'office':{'provider':'pi','status':'failed','model':'deepseek/deepseek-flash','cleanup_completed':True},
            'remote_usage':{'requests':0,'output_tokens':0},'authorization':{'kind':'server_grant','fingerprint':authorization}}
    (run/'result.json').write_text(json.dumps(report)+'\n')
    slots.mark_clean()
    print(json.dumps({'status':'failed','reason':'harness_stub','model_inference_verified':False,'artifacts':str(run)}),flush=True)
sys.exit(1)
'''.replace('PRODUCTION_SCRIPTS', repr(str(Path(__file__).resolve().parent)))


class HarnessConsole(office_console.Console):
    def __init__(self, harness_root, *args, revoke_after_plan=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.harness_root = harness_root
        previous = json.loads((harness_root/'harness.json').read_text()) if (harness_root/'harness.json').exists() else {}
        self.spawn_count = previous.get('spawn_count', 0)
        self.consumed_count = previous.get('consumed_count', 0)
        self.processes = []
        self.revoke_after_plan = revoke_after_plan
        write_status(self.harness_root, self.spawn_count, self.consumed_count, False)

    def plan(self, selection):
        value = super().plan(selection)
        if self.revoke_after_plan and value.get('plan', {}).get('authorization', {}).get('kind') == 'server_grant':
            grant_id = self.plans[value['plan_id']]['grant_id']
            remote_grant.revoke(self.lab, grant_id)
        return value

    def spawn(self, command, log):
        if '--allow-remote' in command or 'grant' in command:
            raise office_console.ConsoleError('unsafe_harness_command')
        if command[2:6] != ['run', 'pi', '--execute', '--remote-grant']:
            raise office_console.ConsoleError('unexpected_harness_command')
        code = """import sys
from pathlib import Path
import office_dispatch as dispatch
dispatch.detect=lambda *a,**k: {'launch_prerequisites_present':True}
raise SystemExit(dispatch.launch('pi',False,Path(sys.argv[1]),remote_grant=sys.argv[2]))
"""
        self.spawn_count += 1
        process = subprocess.Popen([sys.executable, '-c', code, str(self.lab), command[6]], cwd=self.lab,
                                   env={'PATH':os.defpath,'PYTHONPATH':str(Path(__file__).resolve().parent)},
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        self.processes.append(process)
        write_status(self.harness_root, self.spawn_count, self.consumed_count, True)
        return process

    def snapshot(self):
        result = super().snapshot()
        count = sum(row.get('authorization_consumed') is True for row in result['jobs'])
        self.consumed_count = max(self.consumed_count, count)
        write_status(self.harness_root, self.spawn_count, self.consumed_count,
                     any(p.poll() is None for p in self.processes))
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harness', action='store_true', required=True)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--scenario', choices=['no_optin', 'no_grant', 'grant', 'revoke_after_plan'], required=True)
    args = parser.parse_args(argv)
    root = safe_directory(args.directory)
    initial = not root.exists()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root.chmod(0o700)
    (root / '.office-grant-harness').touch(mode=0o600)
    lab = root / 'lab'
    lab.mkdir(mode=0o700, exist_ok=True)
    if initial:
        copy_sources(lab)
        (lab/'scripts/run_pi_work.py').write_text(stub_code(lab))
    if args.scenario in ('no_optin', 'grant', 'revoke_after_plan') and initial:
        try:
            if remote_grant.pending(lab, 'pi') is None:
                remote_grant.create(lab, 'pi', 900)
        except FileNotFoundError:
            remote_grant.create(lab, 'pi', 900)
    providers = [] if args.scenario == 'no_optin' else ['pi']
    console = HarnessConsole(root, lab=lab, roots=[lab/'runs'], remote_grant_providers=providers,
                             revoke_after_plan=args.scenario == 'revoke_after_plan')
    server = office_console.serve(console, 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f'http://127.0.0.1:{server.server_port}/#token={console.token}', flush=True)
    def stop(*_):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, stop)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        console.close(); server.shutdown(); server.server_close(); thread.join(5)
        console.snapshot()
        (root/'harness-final.json').write_text(json.dumps({
            'all_direct_children_exited':all(p.poll() is not None for p in console.processes),
            'server_thread_alive':thread.is_alive(), 'model_requests':0,
            'provider':'synthetic_failed_stub'})+'\n')


if __name__ == '__main__':
    main()
