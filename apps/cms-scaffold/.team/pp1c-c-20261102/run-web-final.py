from pathlib import Path
import datetime
import hashlib
import json
import os
import subprocess
import time

root = Path.cwd()
evidence = root / '.team/pp1c-c-20261102'
commands = [
    ['npm', 'test'],
    ['npm', 'run', 'lint'],
    ['npm', 'run', 'typecheck'],
    ['npm', 'run', 'build'],
    ['npm', 'run', 'test:bundle'],
    ['npm', 'run', 'measure:bundle'],
]
results = []
for index, command in enumerate(commands):
    environment = dict(os.environ)
    environment['PATH'] = '/home/ckc/.local/node-v24.18.0/bin:' + environment['PATH']
    if command == ['npm', 'run', 'build']:
        environment['VITE_API_BASE'] = 'https://api.cms.test:8443'
    record = {'command': command, 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    start = time.monotonic()
    try:
        with (evidence / f'web-final-{index}.log').open('w') as log:
            completed = subprocess.run(command, env=environment, stdout=log, stderr=log, timeout=900)
        record['exit'] = completed.returncode
    except subprocess.TimeoutExpired:
        record['exit'] = 124
    record['elapsedSeconds'] = time.monotonic() - start
    results.append(record)
    (evidence / 'web-final.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(record), flush=True)
    if record['exit']:
        raise SystemExit(record['exit'])
expected = json.loads((evidence / 'runtime/frontend-artifacts.json').read_text())['sha256']
actual = {}
for surface in ['front', 'back', 'admin']:
    dist = root / 'apps' / ('web-' + surface) / 'dist'
    actual[surface] = {str(f.relative_to(dist)): hashlib.sha256(f.read_bytes()).hexdigest()
                       for f in sorted(dist.rglob('*')) if f.is_file()}
(evidence / 'web-final-dist-readback.json').write_text(json.dumps({'equal': actual == expected, 'sha256': actual}, indent=2) + '\n')
if actual != expected:
    raise SystemExit('DIST_READBACK_MISMATCH')
