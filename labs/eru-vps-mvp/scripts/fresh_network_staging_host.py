"""Standalone compare-and-stage helper. Importing this module performs no IO."""
import base64
import copy
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import os
import re
import secrets
import stat
import sys

LIMIT = 256 * 1024
SLOT = '.fresh-network-stage'
OPERATION = 'fresh-network-file-staging'
ALIASES = tuple('ckc-disposable-%02d' % i for i in range(1, 5))
PRIVATE = tuple(ipaddress.IPv4Network(n) for n in
                ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10'))


def _bytes(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=False, allow_nan=False).encode('utf-8')


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _exact(value, fields):
    if type(value) is not dict or set(value) != set(fields):
        raise ValueError('invalid staging fields')


def _match(value, pattern):
    if type(value) is not str or not re.fullmatch(pattern, value):
        raise ValueError('invalid staging value')


def _decode(raw):
    if type(raw) is not bytes or len(raw) > LIMIT:
        raise ValueError('invalid staging JSON size')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate field')
            result[key] = value
        return result
    def invalid(_):
        raise ValueError('invalid JSON constant')
    value = json.loads(raw.decode('utf-8'), object_pairs_hook=unique, parse_constant=invalid)
    def bounded(item, depth=0):
        if depth > 12:
            raise ValueError('JSON too deep')
        if type(item) is dict:
            for child in item.values():
                bounded(child, depth + 1)
        elif type(item) is list:
            for child in item:
                bounded(child, depth + 1)
    bounded(value)
    return value


def validate_request(request):
    """Strict bounded validation and defensive copy, without filesystem access."""
    fields = {'schema_version', 'operation', 'action'}
    if type(request) is dict and request.get('operation') == 'stage':
        fields.add('intent_sha256')
    _exact(request, fields)
    if type(request['schema_version']) is not int or request['schema_version'] != 1:
        raise ValueError('invalid schema')
    if request['operation'] not in ('stage', 'observe'):
        raise ValueError('invalid operation')
    if 'intent_sha256' in request:
        _match(request['intent_sha256'], r'[0-9a-f]{64}')
    action = request['action']
    _exact(action, {'schema_version', 'operation', 'plan_id', 'plan_sha256', 'run_id',
                    'execution_sha256', 'pending_sha256', 'host_index', 'host'})
    if (type(action['schema_version']) is not int or action['schema_version'] != 1
            or action['operation'] != OPERATION or type(action['host_index']) is not int
            or not 0 <= action['host_index'] < 4):
        raise ValueError('invalid action')
    for field in ('plan_id', 'run_id'):
        _match(action[field], r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}')
    for field in ('plan_sha256', 'execution_sha256', 'pending_sha256'):
        _match(action[field], r'[0-9a-f]{64}')
    host, index = action['host'], action['host_index']
    _exact(host, {'alias', 'node', 'ip', 'machine_id', 'boot_id', 'host_key_sha256', 'files'})
    if host['alias'] != ALIASES[index] or host['node'] != 'worker-' + str(index + 1):
        raise ValueError('invalid host role')
    if type(host['ip']) is not str:
        raise ValueError('invalid endpoint')
    ip = ipaddress.IPv4Address(host['ip'])
    if str(ip) != host['ip'] or not any(ip in network for network in PRIVATE):
        raise ValueError('invalid private endpoint')
    _match(host['machine_id'], r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}')
    _match(host['boot_id'], r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}')
    _match(host['host_key_sha256'], r'[0-9a-f]{64}')
    paths = ['/etc/eru/fresh-access.nft', '/etc/eru/' +
             ('known_hosts' if index == 0 else 'fresh-core-authorized-key')]
    if type(host['files']) is not list or len(host['files']) != 2:
        raise ValueError('invalid files')
    for row, path in zip(host['files'], paths):
        _exact(row, {'path', 'mode', 'content', 'sha256'})
        _match(row['sha256'], r'[0-9a-f]{64}')
        if (row['path'] != path or row['mode'] != '0600' or type(row['content']) is not str
                or len(row['content'].encode('utf-8')) > 65536
                or _sha(row['content'].encode('utf-8')) != row['sha256']):
            raise ValueError('invalid file payload')
    if len(_bytes(request)) > LIMIT:
        raise ValueError('request too large')
    return copy.deepcopy(request)


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


class _Session:
    def __init__(self, root, uid, gid, action, *, require_eru=True):
        self.root, self.uid, self.gid, self.action = root, uid, gid, action
        self.dirs, self.reads = {}, {}
        self.rootfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.dirs[''] = self.rootfd
        try:
            self._directory(self.rootfd)
            for path in ('etc', 'etc/eru', 'etc/ssh', 'proc', 'proc/sys',
                         'proc/sys/kernel', 'proc/sys/kernel/random'):
                if path != 'etc/eru' or require_eru:
                    self.directory(path)
            self.check()
        except BaseException:
            self.close()
            raise

    def close(self):
        for fd in self.dirs.values():
            os.close(fd)
        self.dirs.clear()

    def _directory(self, fd, private=False):
        info = os.fstat(fd)
        if (not stat.S_ISDIR(info.st_mode) or (info.st_uid, info.st_gid) != (self.uid, self.gid)
                or info.st_mode & 0o022 or (private and stat.S_IMODE(info.st_mode) != 0o700)):
            raise ValueError('unsafe directory')
        return info

    def directory(self, path):
        parent, _, name = path.rpartition('/')
        fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                     dir_fd=self.dirs[parent])
        try:
            self._directory(fd, path in ('etc/eru', 'etc/eru/' + SLOT))
        except BaseException:
            os.close(fd)
            raise
        self.dirs[path] = fd
        return fd

    def read(self, path, private=False):
        parent, _, name = path.rpartition('/')
        directory = self.dirs[parent]
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            before = os.fstat(fd)
            if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                    or (before.st_uid, before.st_gid) != (self.uid, self.gid)
                    or before.st_mode & 0o022
                    or (private and stat.S_IMODE(before.st_mode) != 0o600)):
                raise ValueError('unsafe file')
            raw = bytearray()
            while True:
                block = os.read(fd, min(65536, LIMIT + 1 - len(raw)))
                if not block:
                    break
                raw.extend(block)
                if len(raw) > LIMIT:
                    raise ValueError('file too large')
            after = os.fstat(fd)
            linked = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if _identity(before) != _identity(after) or _identity(after) != _identity(linked):
                raise ValueError('file changed during read')
            result = bytes(raw)
            previous = self.reads.get(path)
            binding = (_identity(after), result, private)
            if previous is not None and previous != binding:
                raise ValueError('file binding changed')
            self.reads[path] = binding
            return result
        finally:
            os.close(fd)

    def check(self):
        for path, fd in self.dirs.items():
            info = self._directory(fd, path in ('etc/eru', 'etc/eru/' + SLOT))
            if not path:
                linked = os.stat(self.root, follow_symlinks=False)
            else:
                parent, _, name = path.rpartition('/')
                linked = os.stat(name, dir_fd=self.dirs[parent], follow_symlinks=False)
            if (info.st_dev, info.st_ino) != (linked.st_dev, linked.st_ino):
                raise ValueError('directory binding changed')
        for path, (_, _, private) in list(self.reads.items()):
            self.read(path, private)
        host = self.action['host']
        machine = self.read('etc/machine-id').decode().strip()
        boot = self.read('proc/sys/kernel/random/boot_id').decode().strip()
        parts = self.read('etc/ssh/ssh_host_ed25519_key.pub').decode().split()
        if len(parts) < 2 or parts[0] != 'ssh-ed25519':
            raise ValueError('invalid host key')
        raw = base64.b64decode(parts[1], validate=True)
        if (len(raw) != 51 or raw[:19] != b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20'
                or base64.b64encode(raw).decode() != parts[1]
                or machine != host['machine_id'] or boot != host['boot_id']
                or _sha(raw) != host['host_key_sha256']):
            raise ValueError('host identity mismatch')

    def absent(self):
        for row in self.action['host']['files']:
            try:
                os.stat(row['path'].rsplit('/', 1)[1], dir_fd=self.dirs['etc/eru'],
                        follow_symlinks=False)
            except FileNotFoundError:
                continue
            raise ValueError('target exists')

    def publish(self, directory, name, raw):
        self.check()
        fd = self.dirs[directory]
        temp = '.stage-' + secrets.token_hex(16)
        out = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                      0o600, dir_fd=fd)
        temporary = os.fstat(out)
        try:
            view = memoryview(raw)
            while view:
                written = os.write(out, view)
                if written <= 0:
                    raise ValueError('short write')
                view = view[written:]
            os.fsync(out)
            self.check()
            linked = os.stat(temp, dir_fd=fd, follow_symlinks=False)
            if (linked.st_dev, linked.st_ino) != (temporary.st_dev, temporary.st_ino):
                raise ValueError('temporary replaced')
            os.link(temp, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
        finally:
            os.close(out)
            linked = os.stat(temp, dir_fd=fd, follow_symlinks=False)
            if (linked.st_dev, linked.st_ino) == (temporary.st_dev, temporary.st_ino):
                os.unlink(temp, dir_fd=fd)
        os.fsync(fd)
        if self.read(directory + '/' + name, True) != raw:
            raise ValueError('published bytes changed')
        self.check()

    def observe(self, now):
        self.check()
        directory = self.dirs['etc/eru']
        try:
            os.stat(SLOT, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            self.absent()
            rows = [{'path': row['path'], 'kind': 'absent'} for row in self.action['host']['files']]
        else:
            slot = 'etc/eru/' + SLOT
            if slot not in self.dirs:
                self.directory(slot)
            if set(os.listdir(self.dirs[slot])) != {'intent.json', 'complete.json'}:
                raise ValueError('incomplete journal')
            intent_raw = self.read(slot + '/intent.json', True)
            intent = _decode(intent_raw)
            _exact(intent, {'schema_version', 'action', 'intent_sha256'})
            _match(intent['intent_sha256'], r'[0-9a-f]{64}')
            wanted = {'schema_version': 1, 'action': self.action,
                      'intent_sha256': intent['intent_sha256']}
            if intent_raw != _bytes(wanted):
                raise ValueError('journal action mismatch')
            complete = {'schema_version': 1, 'action_sha256': _sha(_bytes(self.action)),
                        'intent_sha256': intent['intent_sha256'],
                        'files': [{'path': row['path'], 'sha256': row['sha256']}
                                  for row in self.action['host']['files']]}
            if self.read(slot + '/complete.json', True) != _bytes(complete):
                raise ValueError('journal completion mismatch')
            rows = []
            for row in self.action['host']['files']:
                if self.read(row['path'][1:], True) != row['content'].encode('utf-8'):
                    raise ValueError('payload mismatch')
                rows.append({'path': row['path'], 'kind': 'regular', 'uid': self.uid,
                             'gid': self.gid, 'mode': '0600', 'nlink': 1,
                             'sha256': row['sha256'], 'intent_sha256': intent['intent_sha256']})
            if set(os.listdir(self.dirs[slot])) != {'intent.json', 'complete.json'}:
                raise ValueError('journal changed')
        self.check()
        if rows[0]['kind'] == 'absent':
            self.absent()
            try:
                os.stat(SLOT, dir_fd=directory, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise ValueError('journal appeared during observation')
        elif set(os.listdir(self.dirs['etc/eru/' + SLOT])) != {'intent.json', 'complete.json'}:
            raise ValueError('journal changed during observation')
        return {'observed_at': (now or datetime.now(timezone.utc)).isoformat(),
                'host': {k: v for k, v in self.action['host'].items() if k != 'files'},
                'directory': {'path': '/etc/eru', 'kind': 'directory', 'uid': self.uid,
                              'gid': self.gid, 'mode': '0700'}, 'files': rows}


def handle(request, *, root='/', owner_uid=0, owner_gid=0, now=None):
    """Local fixture injection is deliberately unavailable in the wire protocol."""
    request = validate_request(request)
    session, claimed = None, False
    try:
        session = _Session(root, owner_uid, owner_gid, request['action'])
        if request['operation'] == 'observe':
            return session.observe(now)
        session.absent()
        session.check()
        directory = session.dirs['etc/eru']
        os.mkdir(SLOT, mode=0o700, dir_fd=directory)
        created = os.stat(SLOT, dir_fd=directory, follow_symlinks=False)
        slot = 'etc/eru/' + SLOT
        slotfd = session.directory(slot)
        opened = os.fstat(slotfd)
        if ((created.st_dev, created.st_ino) != (opened.st_dev, opened.st_ino)
                or os.listdir(slotfd)):
            raise ValueError('new claim directory changed')
        claimed = True
        os.fsync(directory)
        session.check()
        session.absent()
        session.publish(slot, 'intent.json', _bytes({'schema_version': 1,
                        'action': request['action'], 'intent_sha256': request['intent_sha256']}))
        session.absent()
        for row in request['action']['host']['files']:
            session.publish('etc/eru', row['path'].rsplit('/', 1)[1], row['content'].encode('utf-8'))
        complete = {'schema_version': 1, 'action_sha256': _sha(_bytes(request['action'])),
                    'intent_sha256': request['intent_sha256'],
                    'files': [{'path': row['path'], 'sha256': row['sha256']}
                              for row in request['action']['host']['files']]}
        session.publish(slot, 'complete.json', _bytes(complete))
        return session.observe(now)
    except BaseException as error:
        if claimed:
            try:
                fd = session.dirs['etc/eru/' + SLOT]
                marker = os.open('.staging-failed', os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                 | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                try:
                    os.fsync(marker)
                finally:
                    os.close(marker)
                os.fsync(fd)
            except OSError:
                pass
        if not isinstance(error, Exception):
            raise
        raise ValueError('network staging unavailable') from None
    finally:
        if session is not None:
            session.close()


def main(encoded):
    try:
        if type(encoded) is not str or len(encoded) > 4 * ((LIMIT + 2) // 3):
            raise ValueError('invalid request encoding')
        raw = base64.b64decode(encoded, validate=True)
        result = handle(_decode(raw))
        print(json.dumps(result, sort_keys=True, allow_nan=False))
    except Exception:
        print('network staging unavailable', file=sys.stderr)
        raise SystemExit(1) from None
