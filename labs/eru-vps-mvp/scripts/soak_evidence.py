"""Read-only, bounded collection of immutable prefixes from running VPS observers."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import uuid

from labctl import identifier
from labops import atomic_json
from soak_remote import config_hash
from soak_runner import MAX_BYTES

HOSTS = ('ckc-disposable-01', 'ckc-disposable-02', 'ckc-disposable-03')


def validate_manifest(manifest):
    if set(manifest['hosts']) != set(HOSTS):
        raise ValueError('expected exactly observer hosts 01–03')
    for alias, item in manifest['hosts'].items():
        cfg = item['config']
        if (config_hash(cfg) != item['config_sha256'] or cfg['run_id'] != manifest['id']
                or cfg['start_epoch'] != manifest['start_epoch'] or cfg['deadline_epoch'] != manifest['deadline_epoch']
                or cfg['role'] != ('control' if alias == HOSTS[0] else 'http')
                or cfg.get('acceptance') != manifest.get('acceptance')
                or not 5 <= cfg['interval'] <= 60
                or not 30 <= cfg['deadline_epoch'] - cfg['start_epoch'] <= 86400):
            raise ValueError('inconsistent observer manifest: ' + alias)


def transfer(op, alias, request, path):
    if alias not in HOSTS:
        raise ValueError('unexpected observer host')
    source = (op.project / 'scripts/soak_remote.py').read_text()
    program = source + '\nimport sys\nexport_samples(' + repr(request) + ',sys.stdout.buffer)\n'
    print(f'[{alias}] read committed observer evidence ({request["bytes"]} bytes)', flush=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        p = subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'PermitLocalCommand=no', '-o', 'ConnectTimeout=10', alias,
            shlex.join(['sudo', '-n', 'python3', '-'])], input=program, text=True,
            stdout=stream, stderr=subprocess.PIPE, timeout=180)
        stream.flush()
        os.fsync(stream.fileno())
    if p.returncode:
        raise RuntimeError('evidence transfer failed: ' + p.stderr)
    if path.stat().st_size != request['bytes']:
        raise ValueError('transferred byte count mismatch')
    with path.open('rb') as stream:
        checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
    if checksum != request['sha256']:
        raise ValueError('transferred checksum mismatch')


def collect(op, run_id):
    root = op.project / 'private/soak' / identifier(run_id)
    manifest = json.loads((root / 'manifest.json').read_text())
    if manifest['id'] != run_id:
        raise ValueError('run identity mismatch')
    validate_manifest(manifest)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8]
    directory = root / 'collections' / stamp
    directory.mkdir(parents=True, mode=0o700)
    record = {'id': stamp, 'run_id': run_id, 'state': 'collecting', 'hosts': {}}
    atomic_json(directory / 'manifest.json', manifest)
    atomic_json(directory / 'collection.json', record)
    atomic_json(root / 'latest-collection.json', {'id': stamp})
    source = (op.project / 'scripts/soak_remote.py').read_text()
    for alias, item in manifest['hosts'].items():
        entry = record['hosts'][alias] = {'state': 'collecting'}
        atomic_json(directory / 'collection.json', record)
        try:
            request = {'run_id': run_id, 'config_sha256': item['config_sha256']}
            info = json.loads(op.command(alias, ['sudo', '-n', 'python3', '-'],
                source + '\nprint(json.dumps(export_info(' + repr(request) + ')))\n'))
            entry['snapshot'] = info
            atomic_json(directory / 'collection.json', record)
            evidence = info['evidence']
            if (info['source_sha256'] != manifest['source_sha256']
                    or type(evidence['bytes']) is not int or not 0 <= evidence['bytes'] <= MAX_BYTES):
                raise ValueError('observer source or byte budget mismatch')
            partial = directory / (alias + '.partial')
            transfer(op, alias, {**request, **evidence}, partial)
            partial.rename(directory / (alias + '.samples.jsonl'))
            entry['state'] = 'complete'
        except Exception as exc:
            entry.update(state='failed', error=str(exc))
        finally:
            atomic_json(directory / 'collection.json', record)
    record['state'] = 'complete' if all(e['state'] == 'complete' for e in record['hosts'].values()) else 'partial'
    atomic_json(directory / 'collection.json', record)
    return directory


def collection_path(project, run_id, collection_id=None):
    root = project / 'private/soak' / identifier(run_id)
    if collection_id is None:
        collection_id = json.loads((root / 'latest-collection.json').read_text())['id']
    return root / 'collections' / identifier(collection_id)
