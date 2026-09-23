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

from labops import atomic_json, digest
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

    def cancellation_directory(self, cancel_id):
        self.directory(cancel_id)  # same strict identifier validation
        return self.path('/var/lib/eru-mvp/core-cancellations/' + cancel_id)

    def cancellation_journal(self, run_id):
        self.entry('/var/lib/eru-mvp/core-updates')
        directory = self.directory(run_id)
        entry = self.entry('/' + str(directory.relative_to(self.root)))
        journal_path = '/' + str((directory / 'journal.json').relative_to(self.root))
        journal_entry = self.entry(journal_path)
        if not entry or entry['type'] != 'directory' or not journal_entry or journal_entry['type'] != 'file':
            raise ValueError('cancellation requires a durable original update journal')
        journal = json.loads((directory / 'journal.json').read_text())
        if journal.get('id') != run_id or journal.get('owner') != 'eru-vps-mvp':
            raise ValueError('update identity mismatch')
        if journal.get('stage') != 'backing-up' or 'manifest_after_sha256' in journal:
            raise ValueError('cancellation requires backing-up before replacement intent')
        return journal

    def retained_update_files(self, run_id):
        """Bind even partial/unknown regular files; never delete or adopt them."""
        directory = self.directory(run_id)
        staged = '/usr/local/bin/.eru-core-' + run_id
        value = self.entry(staged)
        if value and value['type'] != 'file':
            raise ValueError('unsafe staged core binary')
        names = ['/' + str(directory.relative_to(self.root)), staged]
        for parent, dirs, files in os.walk(directory, followlinks=False):
            for child in sorted(dirs + files):
                path = Path(parent) / child
                if path == directory / 'cancelled.json':
                    continue
                names.append('/' + str(path.relative_to(self.root)))
                if len(names) > 256:
                    raise ValueError('update archive exceeds entry bound')
                self.entry(names[-1])  # reject links/mounts before walking children
        entries = [self.entry(name) for name in sorted(names)]
        if sum(e.get('size', 0) for e in entries if e) > 512 * 1024 * 1024:
            raise ValueError('update archive exceeds size bound')
        return dict(zip(sorted(names), entries))

    def cancellation_archive(self, run_id):
        """Validate a completed receipt without requiring the old core still live.

        Later legitimate updates may change the live binary. The archived source
        journal, retained files and separate cancellation intent must still agree.
        """
        journal = self.cancellation_journal(run_id)
        marker = self.directory(run_id) / 'cancelled.json'
        entry = self.entry('/' + str(marker.relative_to(self.root)))
        if not entry:
            return None
        if entry['type'] != 'file':
            raise ValueError('unsafe cancellation receipt')
        receipt = json.loads(marker.read_text())
        if (receipt.get('schema') != 1 or receipt.get('owner') != 'eru-vps-mvp' or
                receipt.get('stage') != 'cancelled' or receipt.get('source_run') != run_id):
            raise ValueError('invalid cancellation receipt')
        self.entry('/var/lib/eru-mvp/core-cancellations')
        attempt = self.cancellation_directory(receipt['id'])
        for path, kind in [(attempt, 'directory'), (attempt / 'journal.json', 'file')]:
            value = self.entry('/' + str(path.relative_to(self.root)))
            if not value or value['type'] != kind:
                raise ValueError('missing or unsafe cancellation intent')
        intent = json.loads((attempt / 'journal.json').read_text())
        if intent != {**receipt, 'stage': 'cancel-intent'}:
            raise ValueError('cancellation intent/receipt mismatch')
        observed = receipt['observed']
        source = observed['source']
        if (observed['stage'] != 'backing-up' or observed['journal_sha256'] != digest(journal) or
                source['before'] != journal['before'] or source['new_sha256'] != journal['new_sha256'] or
                not re.fullmatch(r'[0-9a-f]{64}', source['plan_sha256']) or
                observed['retained'] != self.retained_update_files(run_id)):
            raise ValueError('cancelled archive changed or does not match original update')
        return receipt

    def inspect_cancellation(self, run_id, source):
        journal = self.cancellation_journal(run_id)
        if (source['before'] != journal['before'] or source['new_sha256'] != journal['new_sha256'] or
                not re.fullmatch(r'[0-9a-f]{64}', source['plan_sha256'])):
            raise ValueError('remote update journal does not match source plan')
        if self.inspect() != source['before']:
            raise ValueError('original core files changed; cannot cancel')
        preserved = {}
        owner = json.loads(self.path(MANIFEST).read_text())
        for name, checksum in owner['files'].items():
            value = self.entry(name)
            if not value or value.get('sha256') != checksum:
                raise ValueError('preserved core configuration changed: ' + name)
            preserved[name] = value
        receipt = self.cancellation_archive(run_id)
        if receipt and receipt['observed']['source'] != source:
            raise ValueError('cancellation belongs to a different source plan')
        return {'source': source, 'stage': 'cancelled' if receipt else 'backing-up',
                'journal_sha256': digest(journal), 'manifest': self.entry(MANIFEST),
                'preserved': preserved, 'retained': self.retained_update_files(run_id),
                'receipt_sha256': digest(receipt) if receipt else None}

    def cancel(self, run_id, cancel_id, expected):
        observed = self.inspect_cancellation(run_id, expected['source'])
        if observed != expected:
            raise ValueError('core cancellation state changed after plan')
        if observed['stage'] == 'cancelled':
            raise ValueError('already cancelled; verify with a new recovery plan')
        attempt = self.cancellation_directory(cancel_id)
        attempt.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.entry('/var/lib/eru-mvp/core-cancellations')
        self.sync(attempt.parent.parent)
        attempt.mkdir(mode=0o700)  # never replay even an incomplete cancellation
        self.sync(attempt.parent)
        record = {'schema': 1, 'id': cancel_id, 'source_run': run_id,
                  'owner': 'eru-vps-mvp', 'stage': 'cancel-intent', 'observed': observed}
        self.save(attempt, record)
        if self.inspect_cancellation(run_id, expected['source']) != observed:
            raise ValueError('core cancellation state changed while recording intent')
        # Only this new receipt changes the source directory. Original journal,
        # partial backups, staged binary and unknown data remain byte-for-byte.
        record['stage'] = 'cancelled'
        atomic_json(self.directory(run_id) / 'cancelled.json', record)
        return self.cancellation_archive(run_id)

    def recovery(self, run_id):
        directory = self.directory(run_id)
        journal_path = '/' + str((directory / 'journal.json').relative_to(self.root))
        entry = self.entry(journal_path)
        if not entry or entry['type'] != 'file':
            raise ValueError('missing or unsafe core update journal; inspect original files before recovery')
        journal = json.loads(self.path(journal_path).read_text())
        if journal['id'] != run_id or journal['owner'] != 'eru-vps-mvp':
            raise ValueError('update identity mismatch')
        if journal.get('stage') == 'backing-up':
            raise ValueError('update stopped before replacement intent; verify original files and preserve incomplete backups')
        if journal.get('stage') not in ['replace-intent', 'binary-replaced', 'installed', 'rolled-back']:
            raise ValueError('update is not eligible for rollback; inspect before proceeding')
        if not journal.get('manifest_after_sha256'):
            raise ValueError('incomplete core recovery journal: missing manifest checksum')
        before = journal['before']
        for name, checksum in [('binary.before', before['binary']['sha256']),
                               ('owner.before', before['manifest_sha256']),
                               ('owner.after', journal['manifest_after_sha256'])]:
            entry = self.entry('/' + str((directory / name).relative_to(self.root)))
            if not entry or entry.get('sha256') != checksum:
                raise ValueError('recovery backup checksum mismatch')
        return directory, journal

    def inspect_recovery(self, run_id):
        directory, journal = self.recovery(run_id)
        before = journal['before']
        original_owner = json.loads((directory / 'owner.before').read_text())
        for name, checksum in original_owner['files'].items():
            if name == BINARY:
                continue
            entry = self.entry(name)
            if not entry or entry.get('sha256') != checksum:
                raise ValueError('preserved core configuration changed: ' + name)
        binary = self.entry(BINARY)
        manifest = self.entry(MANIFEST)
        # Replacement/rollback preserve these attributes. A known checksum alone
        # does not authorize undoing a later permission/group/filesystem change.
        attributes = ['type', 'mode', 'uid', 'gid', 'dev']
        if self.entry(UNIT) != before['unit'] or not binary or any(
                binary.get(key) != before['binary'].get(key) for key in attributes) or binary.get('sha256') not in [
                before['binary']['sha256'], journal['new_sha256']] or not manifest or manifest.get('sha256') not in [
                before['manifest_sha256'], journal['manifest_after_sha256']]:
            raise ValueError('later changes exist; recovery will not overwrite them')
        if journal['stage'] == 'rolled-back' and (binary['sha256'] != before['binary']['sha256'] or
                manifest['sha256'] != before['manifest_sha256']):
            raise ValueError('rolled-back files changed')
        return {'before': before, 'new_sha256': journal['new_sha256'],
                'journal_sha256': digest(journal), 'binary': binary, 'manifest': manifest,
                'unit': self.entry(UNIT), 'stage': journal['stage']}

    def rollback(self, run_id, rollback_id, expected=None):
        observed = self.inspect_recovery(run_id)
        if observed['stage'] == 'rolled-back':
            raise ValueError('already rolled back; verify service state with a new recovery plan')
        if expected is not None and observed != expected:
            raise ValueError('core recovery state changed after plan')
        directory, journal = self.recovery(run_id)
        before = journal['before']
        rollback_dir = self.directory(rollback_id)
        rollback_dir.mkdir(mode=0o700)
        record = {'id': rollback_id, 'source': run_id, 'stage': 'rollback-intent'}
        self.save(rollback_dir, record)
        temporary = self.path('/usr/local/bin/.eru-core-' + rollback_id)
        self.write_new(temporary, (directory / 'binary.before').read_bytes(),
                       before['binary']['mode'], before['binary']['gid'])
        os.replace(temporary, self.path(BINARY))
        self.sync(self.path(BINARY).parent)
        owner_temp = self.path('/var/lib/eru-mvp/.owner-restore-' + rollback_id)
        self.write_new(owner_temp, (directory / 'owner.before').read_bytes())
        os.replace(owner_temp, self.path(MANIFEST))
        self.sync(self.path(MANIFEST).parent)
        # Preserve the original manifest bytes so partial recovery remains hash-verifiable.
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
    elif config['action'] == 'inspect-cancellation':
        result = updater.inspect_cancellation(config['source_run'], config['source'])
    elif config['action'] == 'inspect-recovery':
        result = updater.inspect_recovery(config['source_run'])
    else:
        path = updater.path('/var/lib/eru-mvp/core-update.lock')
        with path.open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if config['action'] == 'install':
                result = updater.install(config['id'], config['expected'],
                    decode_payload(config), config['sha256'])
            elif config['action'] == 'cancel':
                result = updater.cancel(config['source_run'], config['id'], config['expected_cancellation'])
            elif config['action'] == 'rollback':
                result = updater.rollback(config['source_run'], config['id'], config.get('expected_recovery'))
            else:
                raise ValueError('unknown core update action')
    print(json.dumps(result))
