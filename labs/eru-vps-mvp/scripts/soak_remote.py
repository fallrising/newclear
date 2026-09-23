"""Allowlisted VPS-local observer installation/status/stop. Invoked over admin aliases."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time

BASE = Path('/var/lib/eru-mvp/soak')
FILES = {'soak_runner.py', 'control_probe.py'}


def safe_path(path, create=False):
    for item in [*reversed(path.parents), path]:
        if create and not item.exists():
            item.mkdir(mode=0o700)
        s = item.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            raise ValueError('unsafe observer directory: ' + str(item))


def read_record(path, limit=65536):
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_uid != 0 or s.st_size > limit:
        raise ValueError('unsafe observer record')
    return json.loads(path.read_text())


def config_hash(config):
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


def command(argv):
    p = subprocess.run(argv, text=True, capture_output=True, timeout=20)
    if p.returncode:
        raise RuntimeError(p.stderr or p.stdout)
    return p.stdout


def dispatch(request):
    run_id = request['run_id']
    if not re.fullmatch(r'\d{8}T\d{6}Z-[a-f0-9]{8}', run_id):
        raise ValueError('invalid run ID')
    unit = 'eru-mvp-soak-' + run_id + '.service'
    directory = BASE / run_id
    action = request['action']
    if action == 'start':
        config = request['config']
        duration = config['deadline_epoch'] - config['start_epoch']
        lead = config['start_epoch'] - time.time()
        if (config['run_id'] != run_id or not 30 <= duration <= 86400 or not 0 < lead <= 300
                or not 5 <= config['interval'] <= 60 or config['role'] not in ('control', 'http')
                or config.get('max_bytes', 0) != 192 * 1024 * 1024):
            raise ValueError('invalid bounded observer config')
        if set(request['files']) != FILES:
            raise ValueError('unexpected observer files')
        safe_path(BASE, create=True)
        directory.mkdir(mode=0o700)  # never reuse a previous/uncertain run
        for name, value in {**request['files'], 'config.json': json.dumps(config, sort_keys=True)}.items():
            fd = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as stream:
                stream.write(value)
        command(['systemd-run', '--unit=' + unit, '--description=ERU MVP finite read-only soak',
            '--property=Type=exec', '--property=Restart=no', '--property=RemainAfterExit=yes',
            '--property=RuntimeMaxSec=' + str(int(duration + lead + 120)),
            '--property=TimeoutStopSec=15', '--property=KillMode=control-group',
            '--property=UMask=0077', '--property=MemoryMax=256M', '--property=TasksMax=32',
            '--property=Nice=10', '--property=NoNewPrivileges=yes', '--property=ProtectSystem=strict',
            '--property=ReadWritePaths=' + str(directory), '--property=PrivateTmp=yes',
            '--property=StandardOutput=journal', '--property=StandardError=journal',
            '/usr/bin/python3', '-B', str(directory / 'soak_runner.py'), str(directory)])
    elif action not in ('status', 'stop'):
        raise ValueError('unknown observer action')
    if directory.exists():
        safe_path(directory)
        config = read_record(directory / 'config.json')
        if config_hash(config) != request['config_sha256']:
            raise ValueError('observer config does not match controller record')
        if action == 'stop':
            command(['systemctl', 'stop', unit])
        status = read_record(directory / 'status.json') if (directory / 'status.json').exists() else None
    else:
        if action == 'stop':
            raise ValueError('missing observer directory; cannot stop')
        status = None
    p = subprocess.run(['systemctl', 'show', unit,
        '--property=LoadState,ActiveState,SubState,MainPID,Result,ExecMainStatus,InvocationID'],
        capture_output=True, text=True, timeout=10)
    properties = dict(line.split('=', 1) for line in p.stdout.splitlines() if '=' in line)
    return {'unit': unit, 'directory': str(directory), 'systemd': properties,
            'status': status, 'observed_at_epoch': time.time(),
            'current_boot_id': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def copy_prefix(stream, size, output=None):
    """Copy/hash exactly a committed prefix; never follow a concurrently growing tail."""
    if type(size) is not int or not 0 <= size <= 192 * 1024 * 1024:
        raise ValueError('invalid evidence byte count')
    digest = hashlib.sha256()
    left = size
    while left:
        chunk = stream.read(min(left, 1024 * 1024))
        if not chunk:
            raise ValueError('evidence shorter than committed status')
        digest.update(chunk)
        if output is not None:
            output.write(chunk)
        left -= len(chunk)
    return digest.hexdigest()


def open_samples(directory):
    fd = os.open(directory / 'samples.jsonl', os.O_RDONLY | os.O_NOFOLLOW)
    s = os.fstat(fd)
    if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_nlink != 1:
        os.close(fd)
        raise ValueError('unsafe observer evidence')
    return os.fdopen(fd, 'rb')


def export_info(request):
    # Reuse the read-only path/config identity checks, without changing the unit.
    result = dispatch({**request, 'action': 'status'})
    status = result.get('status')
    if not status or status.get('config_sha256') != request['config_sha256']:
        raise ValueError('missing or mismatched observer status')
    directory = Path(result['directory'])
    with open_samples(directory) as stream:
        checksum = copy_prefix(stream, status['bytes'])
    sources = {}
    for name in FILES:
        path = directory / name
        s = path.lstat()
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_nlink != 1 or s.st_size > 1024 * 1024:
            raise ValueError('unsafe observer source')
        sources[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {**result, 'evidence': {'bytes': status['bytes'], 'sha256': checksum},
            'source_sha256': sources}


def export_samples(request, output):
    # Status may advance after export_info. Only stream its frozen byte boundary.
    result = dispatch({**request, 'action': 'status'})
    with open_samples(Path(result['directory'])) as stream:
        checksum = copy_prefix(stream, request['bytes'], output)
    if checksum != request['sha256']:
        raise ValueError('committed evidence changed during collection')
