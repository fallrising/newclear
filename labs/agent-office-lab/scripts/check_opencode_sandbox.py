"""Probe the local OpenCode sandbox and fail-closed launcher without loading a model."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys

from local_opencode import LAB, prepare

out = LAB / 'runs' / ('opencode-boundary-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
workspace = out / 'workspace'
workspace.mkdir(parents=True)
command, env = prepare(out, workspace)
probe = r'''
import errno, json, pathlib, socket
result = {}
with socket.socket() as s:
    s.bind(('127.0.0.1', 0))
    s.listen(1)
    with socket.socket() as client:
        client.connect(s.getsockname())
        conn, _ = s.accept()
        conn.close()
    result['loopback_allowed'] = True
try:
    with socket.socket() as s:
        s.settimeout(0.2)
        s.connect(('203.0.113.1', 443))
except OSError as error:
    result['external_network_denied'] = error.errno in (errno.EPERM, errno.EACCES)
target = pathlib.Path.cwd().parent.parent / ('denied-probe-' + pathlib.Path.cwd().parent.name)
try:
    with target.open('x') as f:
        f.write('sandbox probe')
    target.unlink()
    result['outside_write_denied'] = False
except PermissionError:
    result['outside_write_denied'] = True
pathlib.Path('inside-probe.txt').write_text('allowed')
result['workspace_write_allowed'] = True
print(json.dumps(result))
raise SystemExit(0 if all(result.values()) and len(result) == 4 else 1)
'''
r = subprocess.run(command[:3] + [sys.executable, '-I', '-B', '-c', probe], cwd=workspace,
                   env=env, text=True, capture_output=True, timeout=20)
(out / 'probe.log').write_text(r.stdout + r.stderr)
result = {'sandbox_exit_code': r.returncode}
if r.returncode == 0:
    result.update(json.loads(r.stdout))
# This invocation expects Strata to be offline. Any live model must be stopped first.
import socket
with socket.socket() as s:
    s.settimeout(0.2)
    if s.connect_ex(('127.0.0.1', 8080)) == 0:
        raise RuntimeError('Stop Strata before testing the unavailable-provider path')
env.update(LAB_OPENCODE_RUN=str(out), LAB_OPENCODE_WORKSPACE=str(workspace))
failed = subprocess.run([str(LAB / 'scripts/bin/opencode'), '--prompt', 'Do not run'], cwd=workspace,
                        env=env, text=True, capture_output=True, timeout=10)
(out / 'unavailable.log').write_text(failed.stdout + failed.stderr)
result['unavailable_fails_closed'] = failed.returncode != 0 and 'Local OpenCode unavailable' in failed.stderr
result['status'] = 'completed' if r.returncode == 0 and result['unavailable_fails_closed'] else 'failed'
(out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(dict(result, artifacts=str(out)), indent=2))
sys.exit(0 if result['status'] == 'completed' else 1)
