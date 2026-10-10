"""Offline byte-integrity verification and immutable, nonexecuting restore plans.

Operator declarations are unauthenticated. SHA trailers do not validate bbolt,
full keyspace, live state, recovery readiness, freshness or an offsite backup.
"""
import argparse
from datetime import datetime
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import stat

JSON_LIMIT = 64 * 1024
SNAPSHOT_LIMIT = 8 * 1024**3
CHUNK = 1024 * 1024
ETCD_VERSION = 'v3.6.14'
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
GATES = (
    'authenticated-capture/full-keyspace', 'bbolt-etcdutl-status',
    'encrypted-offsite-roundtrip', 'quiesce-inflight-writers',
    'isolate-old-control', 'preserve-workers',
    'new-member-identities-and-empty-data-dirs',
    'revision-bump-and-compaction-review', 'restore-tool-and-version',
    'credentials-and-endpoints', 'node-workload-plugin-reconciliation',
    'http-smoke', 'RPO-RTO',
)


def _fail():
    raise ValueError('metadata input rejected')


def _id(value):
    if type(value) is not str or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', value):
        _fail()
    return value


def _sha(value):
    if type(value) is not str or not re.fullmatch(r'[0-9a-f]{64}', value):
        _fail()
    return value


def _integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        _fail()
    return value


def _exact(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        _fail()


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail()
        result[key] = value
    return result


def _depth(value, depth=0):
    if depth > 16:
        _fail()
    if type(value) is dict:
        for item in value.values():
            _depth(item, depth + 1)
    elif type(value) is list:
        for item in value:
            _depth(item, depth + 1)


def _decode(raw):
    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique,
                           parse_constant=lambda _: _fail())
        _depth(value)
        return value
    except (UnicodeError, ValueError, RecursionError):
        _fail()


def _identity(info):
    return info.st_dev, info.st_ino


def _file_state(info):
    return (_identity(info), info.st_mode, info.st_uid, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _safe(info, directory=False, public=False):
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if (not kind(info.st_mode) or info.st_uid != os.geteuid()
            or info.st_mode & (0o022 if public else 0o077)
            or (not directory and info.st_nlink != 1)):
        _fail()


class PrivateFiles:
    """Keep descriptors and revalidate every directory edge and input inode."""
    def __init__(self, project):
        self.project = Path(project).absolute()
        self.dirs = {}
        self.files = []
        self.project_fd = os.open(self.project, DIR_FLAGS)
        self.project_identity = _identity(os.fstat(self.project_fd))
        try:
            self.directory(())
        except BaseException:
            self.close()
            raise

    def close(self):
        for item in self.files:
            os.close(item['fd'])
        for fd in self.dirs.values():
            os.close(fd)
        os.close(self.project_fd)

    def parts(self, value):
        if type(value) is not str or not value or '\x00' in value:
            _fail()
        path = value
        if path.startswith('/'):
            prefix = str(self.project) + '/'
            if not path.startswith(prefix):
                _fail()
            path = path[len(prefix):]
        parts = path.split('/')
        if (len(parts) < 2 or parts[0] != 'private'
                or any(part in ('', '.', '..') for part in parts)):
            _fail()
        return tuple(parts[1:])

    def directory(self, parts, create=False):
        route = ('private',) + tuple(parts)
        parent = self.project_fd
        for index, name in enumerate(route):
            key = route[:index+1]
            if key not in self.dirs:
                if create and index > 0:
                    try:
                        os.mkdir(name, 0o700, dir_fd=parent)
                        os.fsync(parent)
                    except FileExistsError:
                        pass
                fd = os.open(name, DIR_FLAGS, dir_fd=parent)
                try:
                    _safe(os.fstat(fd), directory=True)
                except BaseException:
                    os.close(fd)
                    raise
                self.dirs[key] = fd
            parent = self.dirs[key]
        self.check_directories()
        return parent

    def check_directories(self):
        info = os.stat(self.project, follow_symlinks=False)
        if not stat.S_ISDIR(info.st_mode) or _identity(info) != self.project_identity:
            _fail()
        for key, fd in self.dirs.items():
            parent = self.project_fd if len(key) == 1 else self.dirs[key[:-1]]
            actual = os.stat(key[-1], dir_fd=parent, follow_symlinks=False)
            pinned = os.fstat(fd)
            _safe(actual, directory=True)
            _safe(pinned, directory=True)
            if _identity(actual) != _identity(pinned):
                _fail()

    def open(self, parts, maximum, public=False):
        parent = self.project_fd if public else self.directory(parts[:-1])
        fd = os.open(parts[-1], FILE_FLAGS, dir_fd=parent)
        try:
            info = os.fstat(fd)
            _safe(info, public=public)
            if info.st_size > maximum:
                _fail()
            if any(_identity(info) == _identity(os.fstat(x['fd'])) for x in self.files):
                _fail()
            item = {'fd': fd, 'parent': parent, 'name': parts[-1],
                    'state': _file_state(info), 'limit': maximum, 'public': public}
            self.files.append(item)
            return item
        except BaseException:
            os.close(fd)
            raise

    def check_file(self, item):
        self.check_directories()
        pinned = os.fstat(item['fd'])
        actual = os.stat(item['name'], dir_fd=item['parent'], follow_symlinks=False)
        _safe(pinned, public=item['public'])
        _safe(actual, public=item['public'])
        if _file_state(pinned) != item['state'] or _file_state(actual) != item['state']:
            _fail()

    def scan(self, item, snapshot=False):
        self.check_file(item)
        fd = item['fd']
        os.lseek(fd, 0, os.SEEK_SET)
        total = 0
        whole = hashlib.sha256()
        payload = hashlib.sha256()
        tail = b''
        raw = bytearray()
        while True:
            block = os.read(fd, CHUNK)
            if not block:
                break
            total += len(block)
            if total > item['limit']:
                _fail()
            whole.update(block)
            if snapshot:
                combined = tail + block
                if len(combined) > 32:
                    payload.update(combined[:-32])
                tail = combined[-32:]
            else:
                raw.extend(block)
        self.check_file(item)
        if total != item['state'][4]:
            _fail()
        if snapshot and (total < 544 or total % 512 != 32 or payload.digest() != tail):
            _fail()
        return bytes(raw), whole.hexdigest(), total

    def read_json(self, value, expected):
        _sha(expected)
        parts = self.parts(value)
        item = self.open(parts, JSON_LIMIT)
        raw, digest, _ = self.scan(item)
        if digest != expected:
            _fail()
        item.update(digest=digest, snapshot=False)
        return _decode(raw), 'private/' + '/'.join(parts)

    def lock(self):
        item = self.open(('artifacts.amd64.lock.json',), JSON_LIMIT, public=True)
        raw, digest, _ = self.scan(item)
        value = _decode(raw)
        if type(value) is not dict or type(value.get('artifacts')) is not list:
            _fail()
        rows = [x for x in value['artifacts'] if type(x) is dict
                and x.get('repository') == 'etcd-io/etcd']
        if len(rows) != 1 or rows[0].get('tag') != ETCD_VERSION:
            _fail()
        item.update(digest=digest, snapshot=False)
        return digest

    def recheck(self):
        for item in self.files:
            _, digest, _ = self.scan(item, snapshot=item['snapshot'])
            if digest != item['digest']:
                _fail()
        self.check_directories()

    def publish(self, plan_id, plan):
        parent = self.directory(('metadata', 'restore-plans'), create=True)
        self.recheck()
        # Exclusive mkdir is the permanent claim even if the following fsync fails.
        os.mkdir(plan_id, 0o700, dir_fd=parent)
        os.fsync(parent)
        target = self.directory(('metadata', 'restore-plans', plan_id))
        raw = json.dumps(plan, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        self.recheck()
        fd = os.open('plan.json', os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=target)
        try:
            with os.fdopen(fd, 'wb', closefd=False) as stream:
                stream.write(raw)
                stream.flush()
            info = os.fstat(fd)
            _safe(info)
            if info.st_size != len(raw):
                _fail()
            # Pin the completed write before fsync can race with another writer.
            before = _file_state(info)

            def check_output():
                self.check_directories()
                actual = os.stat('plan.json', dir_fd=target, follow_symlinks=False)
                pinned = os.fstat(fd)
                _safe(actual)
                _safe(pinned)
                if _file_state(actual) != before or _file_state(pinned) != before:
                    _fail()

            def readback():
                check_output()
                os.lseek(fd, 0, os.SEEK_SET)
                content = bytearray()
                # Read at most exact expected bytes plus one sentinel byte.
                while len(content) <= len(raw):
                    block = os.read(fd, min(CHUNK, len(raw) + 1 - len(content)))
                    if not block:
                        break
                    content.extend(block)
                check_output()
                if content != raw:
                    _fail()
                return hashlib.sha256(content).hexdigest()

            check_output()
            os.fsync(fd)
            digest = readback()
            self.recheck()
            check_output()
            os.fsync(target)
            self.recheck()
            if readback() != digest:
                _fail()
            return digest
        finally:
            os.close(fd)


def _manifest(value, cluster, generation):
    _exact(value, {'schema', 'backup_id', 'cluster_id', 'generation', 'etcd_version',
                   'captured_at', 'capture_method', 'scope', 'snapshot'})
    _id(value['backup_id'])
    _id(value['cluster_id'])
    _integer(value['generation'], 0, 2**63-1)
    if (value['schema'] != 'eru.metadata-backup.v1' or value['cluster_id'] != cluster
            or value['generation'] != generation or value['etcd_version'] != ETCD_VERSION
            or value['capture_method'] != 'etcdctl-snapshot-save'
            or value['scope'] != 'full-keyspace'):
        _fail()
    stamp = value['captured_at']
    if type(stamp) is not str or not re.fullmatch(
            r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)', stamp):
        _fail()
    try:
        datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    except ValueError:
        _fail()
    snapshot = value['snapshot']
    _exact(snapshot, {'file', 'bytes', 'sha256'})
    if snapshot['file'] != 'snapshot.db':
        _fail()
    _integer(snapshot['bytes'], 544, SNAPSHOT_LIMIT)
    _sha(snapshot['sha256'])


def _peer_url(value):
    if type(value) is not str:
        _fail()
    # Exact grammar excludes credentials, path, query, fragment and URL normalization.
    match = re.fullmatch(r'https://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):([0-9]{1,5})', value)
    if not match or not 1 <= int(match[2]) <= 65535:
        _fail()
    host = match[1]
    if host.startswith('['):
        try:
            host = ipaddress.IPv6Address(host[1:-1]).compressed
        except ValueError:
            _fail()
    elif re.fullmatch(r'[0-9.]+', host):
        try:
            host = str(ipaddress.IPv4Address(host))
        except ValueError:
            _fail()
    elif (len(host) > 253 or any(not re.fullmatch(
            r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', label)
            for label in host.split('.'))):
        _fail()
    return host.lower(), int(match[2])


def _request(value):
    _exact(value, {'schema', 'recovery_id', 'cluster_token', 'members'})
    if value['schema'] != 'eru.metadata-restore-request.v1':
        _fail()
    recovery = _id(value['recovery_id'])
    _id(value['cluster_token'])
    members = value['members']
    if type(members) is not list or len(members) not in (1, 3):
        _fail()
    seen = {key: set() for key in ('name', 'peer_url', 'data_dir')}
    for member in members:
        _exact(member, seen)
        name = _id(member['name'])
        peer = _peer_url(member['peer_url'])
        if member['data_dir'] != f'/var/lib/etcd-recovery/{recovery}/{name}':
            _fail()
        for key in seen:
            canonical = peer if key == 'peer_url' else member[key]
            if canonical in seen[key]:
                _fail()
            seen[key].add(canonical)


def _verify(files, manifest, sha256, cluster, generation):
    _id(cluster)
    _integer(generation, 0, 2**63-1)
    parts = files.parts(manifest)
    if parts[-1] == 'snapshot.db':
        _fail()
    value, path = files.read_json(manifest, sha256)
    _manifest(value, cluster, generation)
    lock_sha = files.lock()
    item = files.open(parts[:-1] + ('snapshot.db',), SNAPSHOT_LIMIT)
    _, snapshot_sha, size = files.scan(item, snapshot=True)
    if size != value['snapshot']['bytes'] or snapshot_sha != value['snapshot']['sha256']:
        _fail()
    item.update(digest=snapshot_sha, snapshot=True)
    result = {'status': 'integrity-verified', 'integrity_verified': True,
        'execution_allowed': False, 'bbolt_validated': False, 'live_validated': False,
        'manifest_sha256': sha256, 'snapshot_sha256': snapshot_sha, 'bytes': size,
        'gates': {gate: 'UNEXECUTED' for gate in GATES}}
    return result, value, path, lock_sha


def verify(project, manifest, sha256, cluster, generation):
    files = PrivateFiles(project)
    try:
        result, _, _, _ = _verify(files, manifest, sha256, cluster, generation)
        files.recheck()
        return result
    finally:
        files.close()


def plan_restore(project, manifest, sha256, cluster, generation,
                 request, request_sha256, plan_id):
    _id(plan_id)
    files = PrivateFiles(project)
    try:
        result, source, path, lock_sha = _verify(files, manifest, sha256, cluster, generation)
        target, request_path = files.read_json(request, request_sha256)
        _request(target)
        plan = {'schema': 'eru.metadata-restore-plan.v1', 'plan_id': plan_id,
            'status': 'review-only', 'execution_allowed': False,
            'bbolt_validated': False, 'live_validated': False,
            'source': {'manifest': {'path': path, 'sha256': sha256},
                'request': {'path': request_path, 'sha256': request_sha256},
                'snapshot': {'path': str(Path(path).parent / 'snapshot.db'),
                    'sha256': result['snapshot_sha256'], 'bytes': result['bytes']},
                'artifact_lock_sha256': lock_sha, 'declarations': source},
            'target': target, 'gates': result['gates']}
        digest = files.publish(plan_id, plan)
        result.update(status='review-only', request_sha256=request_sha256,
                      plan_sha256=digest, member_count=len(target['members']))
        return result
    finally:
        files.close()


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        _fail()


def cli(project, argv):
    """Contain parse and runtime errors; never expose private user input."""
    try:
        parser = _Parser(prog='labctl metadata-backup', description=__doc__)
        sub = parser.add_subparsers(dest='operation', required=True)
        for operation in ('verify', 'plan-restore'):
            command = sub.add_parser(operation)
            command.add_argument('--manifest', required=True)
            command.add_argument('--sha256', required=True)
            command.add_argument('--cluster', required=True)
            command.add_argument('--generation', required=True, type=int)
            if operation == 'plan-restore':
                command.add_argument('--request', required=True)
                command.add_argument('--request-sha256', required=True)
                command.add_argument('--plan-id', required=True)
        args = parser.parse_args(argv)
        common = (project, args.manifest, args.sha256, args.cluster, args.generation)
        if args.operation == 'verify':
            result = verify(*common)
        else:
            result = plan_restore(*common, args.request, args.request_sha256, args.plan_id)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        print(json.dumps({'status': 'rejected', 'error': 'metadata-backup-rejected',
                          'execution_allowed': False}, sort_keys=True))
        return 1
