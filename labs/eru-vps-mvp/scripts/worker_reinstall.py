"""Stopped-worker quarantine, pinned-file reinstall and checksum-checked recovery.

This module performs no scheduling or service operations. The controller must
fence worker-4 and stop its ERU services before using it. No recursive reset,
shared-runtime installation, ownership adoption or overwrite recovery exists.
"""
import hashlib
import os
from pathlib import Path
import re
import stat

from labops import atomic_json, digest
from worker_scope import audit, REINSTALL_FILES, STATE_DIRS, MANIFEST, mount_points


def sha(data):
    return hashlib.sha256(data).hexdigest()


class WorkerReinstall:
    def __init__(self, root=Path('/'), owner_uid=0):
        self.root = Path(root)
        self.uid = owner_uid
        self.mounts = mount_points(root) if self.root == Path('/') or (self.root / 'proc/self/mountinfo').exists() else set()

    def path(self, name):
        if not name.startswith('/') or '..' in Path(name).parts:
            raise ValueError('invalid absolute path')
        current = self.root
        for part in Path(name).parts[1:]:
            current /= part
            if current.is_symlink():
                raise ValueError('symlink: ' + name)
            if current.exists():
                st = current.lstat()
                if st.st_uid != self.uid or st.st_mode & 0o022:
                    raise ValueError('unsafe ownership/permissions: ' + name)
        return current

    def entry(self, name):
        path = self.path(name)
        if not path.exists():
            return None
        st = path.lstat()
        if os.path.ismount(path) or name in self.mounts:
            raise ValueError('mount in target: ' + name)
        result = {'path': name, 'mode': stat.S_IMODE(st.st_mode), 'uid': st.st_uid,
                  'gid': st.st_gid, 'dev': st.st_dev, 'ino': st.st_ino}
        if stat.S_ISREG(st.st_mode) and st.st_nlink == 1:
            if st.st_size > 128 * 1024 * 1024:
                raise ValueError('file exceeds 128 MiB bound')
            result.update(type='file', sha256=sha(path.read_bytes()), size=st.st_size)
        elif stat.S_ISDIR(st.st_mode):
            result['type'] = 'directory'
        else:
            raise ValueError('unsupported type or hardlink: ' + name)
        return result

    def inventory(self):
        scope = audit(self.root, self.uid)
        if scope['blockers']:
            raise ValueError('; '.join(scope['blockers']))
        entries, absent = [], []
        for name in REINSTALL_FILES + STATE_DIRS:
            entry = self.entry(name)
            if entry is None:
                absent.append(name)
                continue
            entries.append(entry)
            if entry['type'] == 'directory':
                for parent, dirs, files in os.walk(self.path(name), followlinks=False):
                    for child in sorted(dirs + files):
                        entry = self.entry('/' + str((Path(parent) / child).relative_to(self.root)))
                        entries.append(entry)
        if sum(e.get('size', 0) for e in entries) > 256 * 1024 * 1024:
            raise ValueError('backup exceeds 256 MiB bound')
        return scope, sorted(entries, key=lambda e: e['path']), absent

    def directory(self, run_id):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}', run_id):
            raise ValueError('invalid recovery ID')
        return self.path('/var/lib/eru-mvp/recovery/' + run_id)

    @staticmethod
    def sync(directory):
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def write_new(self, path, data, mode=0o600, gid=None):
        self.path('/' + str(path.relative_to(self.root)))
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            os.fchmod(stream.fileno(), mode)
            if gid is not None and os.geteuid() == 0:
                os.fchown(stream.fileno(), self.uid, gid)
            stream.flush()
            os.fsync(stream.fileno())
        self.sync(path.parent)

    def save(self, directory, journal):
        atomic_json(directory / 'journal.json', journal)

    def load(self, run_id):
        import json
        directory = self.directory(run_id)
        for name in ['journal.json', 'snapshot.json']:
            entry = self.entry('/' + str((directory / name).relative_to(self.root)))
            if not entry or entry['type'] != 'file':
                raise ValueError('unsafe recovery record: ' + name)
        journal = json.loads((directory / 'journal.json').read_text())
        if journal['id'] != run_id or journal['owner'] != 'eru-vps-mvp':
            raise ValueError('recovery identity mismatch')
        manifest = self.path(MANIFEST)
        if sha(manifest.read_bytes()) != journal['manifest_sha256']:
            raise ValueError('ownership manifest changed')
        # The immutable snapshot is hashed into the mutable journal.
        snapshot = (directory / 'snapshot.json').read_bytes()
        if sha(snapshot) != journal['snapshot_sha256']:
            raise ValueError('backup snapshot checksum mismatch')
        record = json.loads(snapshot)
        if set(record['roots']) != set(REINSTALL_FILES + STATE_DIRS):
            raise ValueError('unexpected recovery scope')
        seen = set()
        for item in record['entries']:
            name = item['path']
            if name in seen or not (name in REINSTALL_FILES + STATE_DIRS or
                    any(name.startswith(root + '/') for root in STATE_DIRS)):
                raise ValueError('unexpected recovery entry')
            seen.add(name)
            if item['type'] == 'file':
                backup = self.path('/' + str((directory / 'backup' / name.lstrip('/')).relative_to(self.root)))
                if not backup.is_file() or backup.stat().st_nlink != 1 or sha(backup.read_bytes()) != item['sha256']:
                    raise ValueError('backup checksum mismatch: ' + name)
        return directory, journal, record

    def quarantine(self, run_id, expected_manifest):
        scope, entries, absent = self.inventory()
        if scope['manifest_sha256'] != expected_manifest:
            raise ValueError('manifest changed after plan')
        directory = self.directory(run_id)
        directory.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.mkdir(mode=0o700)  # an existing run is never replayed
        journal = {'id': run_id, 'owner': 'eru-vps-mvp', 'stage': 'backing-up',
                   'manifest_sha256': expected_manifest, 'removed': [], 'intent': None}
        self.save(directory, journal)
        try:
            for item in entries:
                if item['type'] == 'file':
                    backup = directory / 'backup' / item['path'].lstrip('/')
                    backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    data = self.path(item['path']).read_bytes()
                    if sha(data) != item['sha256'] or self.entry(item['path']) != item:
                        raise ValueError('file changed during backup')
                    self.write_new(backup, data)
            for parent, dirs, names in os.walk(directory, topdown=False):
                self.sync(parent)
            self.sync(directory.parent)
            self.sync(directory.parent.parent)
            record = {'roots': list(REINSTALL_FILES + STATE_DIRS), 'entries': entries, 'absent': absent}
            atomic_json(directory / 'snapshot.json', record)
            journal['snapshot_sha256'] = sha((directory / 'snapshot.json').read_bytes())
            journal['stage'] = 'backed-up'
            self.save(directory, journal)
            self.load(run_id)  # verify every backup before touching any source
            if self.inventory()[1:] != (entries, absent):
                raise ValueError('scope changed during backup')
            for item in sorted(entries, key=lambda e: e['path'].count('/'), reverse=True):
                journal.update(stage='quarantining', intent=item['path'])
                self.save(directory, journal)
                if self.entry(item['path']) != item:
                    raise ValueError('path changed before quarantine: ' + item['path'])
                target = self.path(item['path'])
                target.rmdir() if item['type'] == 'directory' else target.unlink()
                self.sync(target.parent)
                journal['removed'].append(item['path'])
                journal['intent'] = None
                self.save(directory, journal)
            journal['stage'] = 'quarantined'
            self.save(directory, journal)
            return journal
        except BaseException as exc:
            journal.update(error=str(exc), failed_at=journal['stage'])
            self.save(directory, journal)
            raise

    def reconcile(self, run_id):
        _, journal, record = self.load(run_id)
        findings = []
        originals = {e['path']: e for e in record['entries']}
        created = journal.get('created', {})
        for name in record['roots']:
            target = self.path(name)
            names = [name]
            if target.is_dir():
                for parent, dirs, files in os.walk(target, followlinks=False):
                    names += ['/' + str((Path(parent) / x).relative_to(self.root)) for x in dirs + files]
            for path in names:
                actual = self.entry(path)
                owned_new = actual is not None and actual == created.get(path)
                untouched = actual is not None and path in originals and actual == originals[path] and path not in journal['removed']
                if actual is not None and not (owned_new or untouched):
                    findings.append('new or changed data: ' + path)
        current = []
        for name in record['roots']:
            current.append(self.entry(name))
            if self.path(name).is_dir():
                for parent, dirs, files in os.walk(self.path(name), followlinks=False):
                    for child in sorted(dirs + files):
                        current.append(self.entry('/' + str((Path(parent) / child).relative_to(self.root))))
        return {'stage': journal['stage'], 'conflicts': findings,
                'journal_sha256': digest(journal), 'snapshot_sha256': journal['snapshot_sha256'],
                'tree_sha256': digest(sorted((e for e in current if e), key=lambda e: e['path'])),
                'restore_possible': not findings and journal['stage'] in ['backed-up', 'quarantining', 'quarantined', 'installing', 'installed', 'restoring']}

    def restore(self, run_id):
        directory, journal, record = self.load(run_id)
        state = self.reconcile(run_id)
        if not state['restore_possible']:
            raise ValueError('restore blocked: ' + '; '.join(state['conflicts']) + ' stage=' + state['stage'])
        # Remove only installer-created files whose current inode/bytes were
        # verified by reconcile; an agent-created state tree blocks this path.
        if journal['stage'] in ['installing', 'installed']:
            for name, entry in list(journal.get('created', {}).items()):
                if name not in REINSTALL_FILES or self.entry(name) != entry:
                    raise ValueError('installer-created file changed before recovery')
                journal['intent'] = name
                self.save(directory, journal)
                self.path(name).unlink()
                self.sync(self.path(name).parent)
                del journal['created'][name]
                self.save(directory, journal)
        journal['stage'] = 'restoring'
        self.save(directory, journal)
        for item in sorted(record['entries'], key=lambda e: e['path'].count('/')):
            target = self.path(item['path'])
            if target.exists():
                continue  # reconcile proved this is the untouched original inode
            journal['intent'] = item['path']
            self.save(directory, journal)
            if item['type'] == 'directory':
                target.mkdir(mode=item['mode'])
                target.chmod(item['mode'])
                if os.geteuid() == 0:
                    os.chown(target, self.uid, item['gid'])
                self.sync(target.parent)
            else:
                data = (directory / 'backup' / item['path'].lstrip('/')).read_bytes()
                if sha(data) != item['sha256']:
                    raise ValueError('backup changed before restore')
                self.write_new(target, data, item['mode'], item['gid'])
            journal.setdefault('created', {})[item['path']] = self.entry(item['path'])
            journal['intent'] = None
            self.save(directory, journal)
        if audit(self.root, self.uid)['blockers']:
            raise ValueError('restored scope audit failed')
        journal['stage'] = 'restored'
        self.save(directory, journal)
        return journal

    def install(self, run_id, files):
        directory, journal, record = self.load(run_id)
        if journal['stage'] != 'quarantined' or journal.get('error'):
            raise ValueError('requires a completed quarantine; reconcile failed operations')
        if set(files) != set(REINSTALL_FILES):
            raise ValueError('installer accepts exactly six ERU component files')
        originals = {e['path']: e for e in record['entries']}
        for name in REINSTALL_FILES + STATE_DIRS:
            if self.path(name).exists():
                raise ValueError('new data exists after quarantine: ' + name)
        for name, data in files.items():
            if not isinstance(data, bytes) or sha(data) != originals[name]['sha256']:
                raise ValueError('pinned component differs from owned baseline: ' + name)
        journal['stage'] = 'installing'
        self.save(directory, journal)
        for name in REINSTALL_FILES:
            journal['intent'] = name
            self.save(directory, journal)
            self.write_new(self.path(name), files[name], originals[name]['mode'], originals[name]['gid'])
            journal.setdefault('created', {})[name] = self.entry(name)
            journal['intent'] = None
            self.save(directory, journal)
        if audit(self.root, self.uid)['blockers']:
            raise ValueError('installed scope audit failed')
        journal['stage'] = 'installed'
        self.save(directory, journal)
        return journal


def remote_main(config):
    """Controller-only entry point, additionally checks the worker locally."""
    import base64
    import fcntl
    import json
    import subprocess
    if os.geteuid() != 0 or config['node'] != 'worker-4':
        raise ValueError('initial scope is root on worker-4 only')
    if Path('/etc/machine-id').read_text().strip() != config['machine_id']:
        raise ValueError('worker machine identity changed')
    worker = WorkerReinstall()
    if sha(worker.path(MANIFEST).read_bytes()) != config['manifest_sha256']:
        raise ValueError('worker ownership changed')
    for name in ['/etc/eru/core.yaml', '/var/lib/etcd-eru-mvp']:
        if worker.path(name).exists():
            raise ValueError('control-plane state on worker')
    lock = worker.path('/var/lib/eru-mvp/reinstall.lock')
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if config['action'] in ['reconcile', 'inspect-recovery']:
            path = worker.directory(config['run_id']) / 'journal.json'
            if config['action'] == 'inspect-recovery' and not path.exists():
                result = {'exists': False}
            else:
                result = {'exists': True, **worker.reconcile(config['run_id'])}
            print(json.dumps(result))
            return
        for unit in ['eru-agent.service', 'eru-containerd-proxy.socket', 'eru-containerd-proxy.service']:
            p = subprocess.run(['systemctl', 'show', '--property=ActiveState', '--value', unit],
                               capture_output=True, text=True, check=True, timeout=15)
            if p.stdout.strip() != 'inactive':
                raise ValueError('ERU service must be inactive: ' + unit)
        for resource in ['containers', 'tasks']:
            p = subprocess.run(['ctr', '--namespace', 'eru', resource, 'list', '-q'],
                               capture_output=True, text=True, check=True, timeout=15)
            if p.stdout.strip():
                raise ValueError('worker runtime is not empty')
        if config['action'] == 'quarantine':
            result = worker.quarantine(config['run_id'], config['manifest_sha256'])
        elif config['action'] == 'install':
            result = worker.install(config['run_id'], {k: base64.b64decode(v, validate=True) for k, v in config['files'].items()})
        elif config['action'] == 'restore':
            if config.get('expected_recovery') != {'exists': True, **worker.reconcile(config['run_id'])}:
                raise ValueError('worker recovery state changed after plan')
            recovery_id = config['recovery_id']
            directory = worker.directory(recovery_id)
            directory.mkdir(mode=0o700)
            worker.sync(directory.parent)
            worker.save(directory, {'id': recovery_id, 'source': config['run_id'], 'stage': 'restore-intent'})
            result = worker.restore(config['run_id'])
            worker.save(directory, {'id': recovery_id, 'source': config['run_id'], 'stage': 'restored'})
        else:
            raise ValueError('unknown worker action')
        print(json.dumps(result))
    finally:
        os.close(fd)
