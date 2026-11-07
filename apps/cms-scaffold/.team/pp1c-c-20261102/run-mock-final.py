from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import time
import uuid

root = Path.cwd()
evidence = root / '.team/pp1c-c-20261102'
workspace = root / ('local/pp1c-c-mock-20261102-' + uuid.uuid4().hex)
workspace.mkdir(mode=0o700, exist_ok=False)
for cache in ['.vite', '.vite-temp']:
    (root / 'node_modules' / cache).mkdir(mode=0o700, exist_ok=True)
files = {}
for relative in ['apps/web-front', 'apps/web-back', 'apps/web-admin', 'packages', 'e2e-mock', 'docs/v2/contracts/fixtures']:
    source = root / relative
    shutil.copytree(source, workspace / relative, ignore=shutil.ignore_patterns('node_modules', 'dist', '.vite', '.vite-temp'))
for relative in ['package.json', 'package-lock.json', 'playwright.mock.config.ts']:
    shutil.copy2(root / relative, workspace / relative)
for path in workspace.rglob('*'):
    if path.is_file():
        files[str(path.relative_to(workspace))] = hashlib.sha256(path.read_bytes()).hexdigest()
name = 'cms-pp1c-c-mock-' + uuid.uuid4().hex
docker = ['docker', '--host', 'unix:///var/run/docker.sock']
image = 'sha256:6a8ca4b22705adf7134d2220ab8aadff634a6b76c816dba55e0409f8e5c180dc'
command = docker + ['run', '--name', name, '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', '1000:1000', '--read-only', '--tmpfs', '/tmp:rw,mode=1777', '--shm-size', '256m',
    '--mount', f'type=bind,src={workspace},dst=/work', '--mount', f'type=bind,src={root / "node_modules"},dst=/work/node_modules,readonly',
    '--tmpfs', '/work/node_modules/.vite-temp:uid=1000,gid=1000', '--tmpfs', '/work/node_modules/.vite:uid=1000,gid=1000',
    '--mount', 'type=bind,src=/home/ckc/.local/node-v24.18.0,dst=/opt/node,readonly',
    '--mount', 'type=bind,src=/home/ckc/.cache/ms-playwright/chromium-1243/chrome-linux64,dst=/browser,readonly',
    '-e', 'CI=1', '-e', 'HOME=/tmp', '-e', 'PLAYWRIGHT_CHROMIUM_EXECUTABLE=/browser/chrome',
    '-w', '/work', '--entrypoint', '/opt/node/bin/npm', image, 'run', 'e2e:mock']
record = {'command': command, 'image': image, 'sourceFileSha256': files}
start = time.monotonic()
try:
    with (evidence / 'mock-final.log').open('w') as log:
        record['exit'] = subprocess.run(command, stdout=log, stderr=log, timeout=900).returncode
finally:
    result = subprocess.run(docker + ['inspect', name], capture_output=True, text=True, timeout=30)
    if result.returncode == 0:
        container = json.loads(result.stdout)[0]
        assert container['Name'] == '/' + name and container['Image'] == image
        record['containerId'] = container['Id']
        if container['State']['Running']:
            subprocess.run(docker + ['stop', '--time', '5', container['Id']], capture_output=True, timeout=30, check=True)
    record['elapsedSeconds'] = time.monotonic() - start
    (evidence / 'mock-final.json').write_text(json.dumps(record, indent=2) + '\n')
raise SystemExit(record.get('exit', 1))
