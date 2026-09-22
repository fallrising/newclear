"""Atomic, owned core binary replacement with durable backup and explicit rollback.

No service, key, config or etcd data changes. The controller restarts only core
and verifies the running executable after this module returns.
"""
import base64
import fcntl
import gzip
import io
import json
import os
from pathlib import Path
import re

from labops import atomic_json
from worker_reinstall import WorkerReinstall, sha

BINARY = '/usr/local/bin/eru-core'
MANIFEST = '/var/lib/eru-mvp/owner.json'
UNIT = '/etc/systemd/system/eru-core.service'


class CoreUpdate(WorkerReinstall):
    def inspect(self):
        manifest = self.entry(MANIFEST)
        binary = self.entry(BINARY)
        unit = self.entry(UNIT)
        if not all(e and e['type'] == 'file' for e in [manifest, binary, unit]):
            raise ValueError('core binary, unit and manifest must be regular owned files')
        state = json.loads(self.path(MANIFEST).read_text())
        if state.get('owner') != 'eru-vps-mvp' or any(
                state['files'].get(e['path']) != e['sha256'] for e in [binary, unit]):
            raise ValueError('core ownership/checksum mismatch')
        return {'binary': binary, 'unit': unit, 'manifest_sha256': manifest['sha256']}

    def directory(self, run_id):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}', run_id):
            raise ValueError('invalid update ID')
        return self.path('/var/lib/eru-mvp/core-updates/' + run_id)

    def install(self, run_id, expected, data, checksum):
        if sha(data) != checksum or len(data) > 128 * 1024 * 1024:
            raise ValueError('core payload checksum/size mismatch')
        if self.inspect() != expected:
            raise ValueError('core files changed after plan')
        if expected['binary']['sha256'] == checksum:
            raise ValueError('core already has this binary; no replacement needed')
        directory = self.directory(run_id)
        directory.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory.mkdir(mode=0o700)  # never replay an existing update
        self.sync(directory.parent)
        journal = {'id': run_id, 'stage': 'backing-up', 'before': expected,
                   'new_sha256': checksum, 'owner': 'eru-vps-mvp'}
        self.save(directory, journal)
        self.write_new(directory / 'binary.before', self.path(BINARY).read_bytes())
        self.write_new(directory / 'owner.before', self.path(MANIFEST).read_bytes())
        if sha((directory / 'binary.before').read_bytes()) != expected['binary']['sha256'] or sha(
                (directory / 'owner.before').read_bytes()) != expected['manifest_sha256']:
            raise ValueError('backup checksum mismatch')
        state = json.loads((directory / 'owner.before').read_text())
        state['files'][BINARY] = checksum
        atomic_json(directory / 'owner.after', state)
        journal['manifest_after_sha256'] = sha((directory / 'owner.after').read_bytes())
        temporary = self.path('/usr/local/bin/.eru-core-' + run_id)
        self.write_new(temporary, data, expected['binary']['mode'], expected['binary']['gid'])
        if self.inspect() != expected:
            raise ValueError('core files changed while backing up')
        journal['stage'] = 'replace-intent'
        self.save(directory, journal)
        os.replace(temporary, self.path(BINARY))
        self.sync(self.path(BINARY).parent)
        journal['stage'] = 'binary-replaced'
        self.save(directory, journal)
        atomic_json(self.path(MANIFEST), state)
        journal['stage'] = 'installed'
        self.save(directory, journal)
        return journal

    def recovery(self, run_id):
        directory = self.directory(run_id)
        journal = json.loads(self.path('/' + str((directory / 'journal.json').relative_to(self.root))).read_text())
        if journal['id'] != run_id or journal['owner'] != 'eru-vps-mvp':
            raise ValueError('update identity mismatch')
        before = journal['before']
        for name, checksum in [('binary.before', before['binary']['sha256']),
                               ('owner.before', before['manifest_sha256']),
                               ('owner.after', journal['manifest_after_sha256'])]:
            entry = self.entry('/' + str((directory / name).relative_to(self.root)))
            if not entry or entry.get('sha256') != checksum:
                raise ValueError('recovery backup checksum mismatch')
        return directory, journal

    def rollback(self, run_id, rollback_id):
        directory, journal = self.recovery(run_id)
        if journal['stage'] not in ['replace-intent', 'binary-replaced', 'installed']:
            raise ValueError('update is not eligible for rollback; inspect before proceeding')
        before = journal['before']
        binary = self.entry(BINARY)
        manifest = self.entry(MANIFEST)
        if self.entry(UNIT) != before['unit'] or not binary or binary.get('sha256') not in [
                before['binary']['sha256'], journal['new_sha256']] or not manifest or manifest.get('sha256') not in [
                before['manifest_sha256'], journal['manifest_after_sha256']]:
            raise ValueError('later changes exist; recovery will not overwrite them')
        rollback_dir = self.directory(rollback_id)
        rollback_dir.mkdir(mode=0o700)
        record = {'id': rollback_id, 'source': run_id, 'stage': 'rollback-intent'}
        self.save(rollback_dir, record)
        temporary = self.path('/usr/local/bin/.eru-core-' + rollback_id)
        self.write_new(temporary, (directory / 'binary.before').read_bytes(),
                       before['binary']['mode'], before['binary']['gid'])
        os.replace(temporary, self.path(BINARY))
        self.sync(self.path(BINARY).parent)
        atomic_json(self.path(MANIFEST), json.loads((directory / 'owner.before').read_text()))
        # JSON normalization is intentional; verify semantic ownership, not old whitespace.
        self.inspect()
        record['stage'] = 'rolled-back'
        self.save(rollback_dir, record)
        journal['stage'] = 'rolled-back'
        self.save(directory, journal)
        return record


def decode_payload(config):
    if config.get('payload_encoding') != 'gzip-base64' or len(config['payload']) > 180 * 1024 * 1024:
        raise ValueError('unsupported or oversized payload')
    compressed = base64.b64decode(config['payload'], validate=True)
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as source:
        data = source.read(128 * 1024 * 1024 + 1)
    if len(data) > 128 * 1024 * 1024 or sha(data) != config['sha256']:
        raise ValueError('decoded payload checksum/size mismatch')
    return data


def remote_main(config):
    if os.geteuid() != 0 or Path('/etc/machine-id').read_text().strip() != config['machine_id']:
        raise ValueError('core host identity/root mismatch')
    if not Path('/etc/eru/core.yaml').is_file() or not Path('/var/lib/etcd-eru-mvp').is_dir():
        raise ValueError('host is not the existing control plane')
    updater = CoreUpdate()
    if config['action'] == 'inspect':
        result = updater.inspect()
    else:
        path = updater.path('/var/lib/eru-mvp/core-update.lock')
        with path.open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if config['action'] == 'install':
                result = updater.install(config['id'], config['expected'],
                    decode_payload(config), config['sha256'])
            elif config['action'] == 'rollback':
                result = updater.rollback(config['source_run'], config['id'])
            else:
                raise ValueError('unknown core update action')
    print(json.dumps(result))
