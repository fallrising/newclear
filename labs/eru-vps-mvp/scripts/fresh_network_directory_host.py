"""Fixed durable directory preparation; importing this module performs no IO."""
import base64
import copy
from datetime import datetime, timezone
import json
import os
import sys

import fresh_network_staging_host as support

LIMIT = support.LIMIT
OPERATION = 'fresh-network-directory-preparation'
SLOT = '.eru-fresh-directory'
SLOT_PATH = 'etc/' + SLOT
DIRECTORY = {'path': '/etc/eru', 'uid': 0, 'gid': 0, 'mode': '0700'}


def validate_request(request):
    """Validate exact data-only action before filesystem access, defensively copied."""
    fields = {'schema_version', 'operation', 'action'}
    if type(request) is dict and request.get('operation') == 'prepare':
        fields.add('intent_sha256')
    support._exact(request, fields)
    if (type(request['schema_version']) is not int or request['schema_version'] != 1
            or request['operation'] not in ('prepare', 'observe')):
        raise ValueError('invalid directory request')
    if 'intent_sha256' in request:
        support._match(request['intent_sha256'], r'[0-9a-f]{64}')
    action = request['action']
    support._exact(action, {'schema_version', 'operation', 'plan_id', 'plan_sha256', 'run_id',
                           'execution_sha256', 'pending_sha256', 'host_index', 'host', 'directory'})
    support._exact(action['directory'], DIRECTORY)
    if (action['operation'] != OPERATION or action['directory'] != DIRECTORY
            or type(action['directory']['uid']) is not int
            or type(action['directory']['gid']) is not int):
        raise ValueError('invalid directory action')
    support._exact(action['host'], {'alias', 'node', 'ip', 'machine_id', 'boot_id', 'host_key_sha256'})
    # Reuse the reviewed common action/host checks through a local synthetic
    # staging action. These empty payloads are never written or sent on the wire.
    common = copy.deepcopy(action)
    del common['directory']
    common['operation'] = support.OPERATION
    names = ('fresh-access.nft', 'known_hosts' if common['host_index'] == 0 else 'fresh-core-authorized-key')
    common['host']['files'] = [{'path': '/etc/eru/' + name, 'mode': '0600',
                               'content': '', 'sha256': support._sha(b'')} for name in names]
    support.validate_request({'schema_version': 1, 'operation': 'observe', 'action': common})
    if len(support._bytes(request)) > LIMIT:
        raise ValueError('directory request too large')
    return copy.deepcopy(request)


def _inode(info):
    return info.st_dev, info.st_ino


class _Session(support._Session):
    def __init__(self, root, uid, gid, action):
        super().__init__(root, uid, gid, action, require_eru=False)

    def directory(self, path):
        fd = super().directory(path)
        if path == SLOT_PATH:
            self._directory(fd, private=True)
        return fd

    def check(self):
        super().check()
        if SLOT_PATH in self.dirs:
            self._directory(self.dirs[SLOT_PATH], private=True)

    def absent_path(self, name):
        try:
            os.stat(name, dir_fd=self.dirs['etc'], follow_symlinks=False)
        except FileNotFoundError:
            return
        raise ValueError('directory path exists')

    def observe(self, now):
        self.check()
        try:
            os.stat(SLOT, dir_fd=self.dirs['etc'], follow_symlinks=False)
        except FileNotFoundError:
            self.absent_path('eru')
            directory = {'path': '/etc/eru', 'kind': 'absent'}
        else:
            if SLOT_PATH not in self.dirs:
                self.directory(SLOT_PATH)
            if 'etc/eru' not in self.dirs:
                self.directory('etc/eru')
            journal = self.dirs[SLOT_PATH]
            if set(os.listdir(journal)) != {'intent.json', 'complete.json'}:
                raise ValueError('incomplete directory journal')
            raw = self.read(SLOT_PATH + '/intent.json', True)
            intent = support._decode(raw)
            support._exact(intent, {'schema_version', 'action', 'intent_sha256'})
            support._match(intent['intent_sha256'], r'[0-9a-f]{64}')
            expected = {'schema_version': 1, 'action': self.action,
                        'intent_sha256': intent['intent_sha256']}
            if raw != support._bytes(expected):
                raise ValueError('directory intent changed')
            info = self._directory(self.dirs['etc/eru'], private=True)
            complete = {'schema_version': 1, 'action_sha256': support._sha(support._bytes(self.action)),
                        'intent_sha256': intent['intent_sha256'],
                        'directory': {'device': info.st_dev, 'inode': info.st_ino}}
            if self.read(SLOT_PATH + '/complete.json', True) != support._bytes(complete):
                raise ValueError('directory completion changed')
            directory = {'path': '/etc/eru', 'kind': 'directory', 'uid': self.uid,
                         'gid': self.gid, 'mode': '0700', 'device': info.st_dev,
                         'inode': info.st_ino, 'intent_sha256': intent['intent_sha256']}
        self.check()
        if directory['kind'] == 'absent':
            self.absent_path('eru')
            self.absent_path(SLOT)
        elif set(os.listdir(self.dirs[SLOT_PATH])) != {'intent.json', 'complete.json'}:
            raise ValueError('directory journal changed')
        return {'observed_at': (now or datetime.now(timezone.utc)).isoformat(),
                'host': copy.deepcopy(self.action['host']), 'directory': directory}


def handle(request, *, root='/', owner_uid=0, owner_gid=0, now=None):
    """Root/owner/time injection is a direct-import test seam, never wire data."""
    session, claimed = None, False
    try:
        request = validate_request(request)
        session = _Session(root, owner_uid, owner_gid, request['action'])
        if request['operation'] == 'observe':
            return session.observe(now)
        session.absent_path('eru')
        session.check()
        parent = session.dirs['etc']
        os.mkdir(SLOT, mode=0o700, dir_fd=parent)
        created = os.stat(SLOT, dir_fd=parent, follow_symlinks=False)
        journal = session.directory(SLOT_PATH)
        if _inode(created) != _inode(os.fstat(journal)) or os.listdir(journal):
            raise ValueError('directory claim replaced')
        claimed = True
        os.fsync(parent)
        session.check()
        session.absent_path('eru')
        session.publish(SLOT_PATH, 'intent.json', support._bytes({
            'schema_version': 1, 'action': request['action'],
            'intent_sha256': request['intent_sha256']}))
        session.check()
        if set(os.listdir(journal)) != {'intent.json'}:
            raise ValueError('directory journal changed before target')
        session.absent_path('eru')
        os.mkdir('eru', mode=0o700, dir_fd=parent)
        created = os.stat('eru', dir_fd=parent, follow_symlinks=False)
        target = session.directory('etc/eru')
        if _inode(created) != _inode(os.fstat(target)) or os.listdir(target):
            raise ValueError('created directory replaced')
        os.fsync(target)
        os.fsync(parent)
        session.check()
        if set(os.listdir(journal)) != {'intent.json'} or os.listdir(target):
            raise ValueError('directory state changed before completion')
        complete = {'schema_version': 1, 'action_sha256': support._sha(support._bytes(request['action'])),
                    'intent_sha256': request['intent_sha256'],
                    'directory': {'device': created.st_dev, 'inode': created.st_ino}}
        session.publish(SLOT_PATH, 'complete.json', support._bytes(complete))
        return session.observe(now)
    except BaseException as error:
        if claimed:
            # Pinning this descriptor means a replacement journal never receives
            # this operation's failure marker. A claim loser never writes one.
            try:
                fd = session.dirs[SLOT_PATH]
                marker = os.open('.directory-failed', os.O_WRONLY | os.O_CREAT | os.O_EXCL
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
        raise ValueError('network directory preparation unavailable') from None
    finally:
        if session is not None:
            session.close()


def main(encoded):
    try:
        if type(encoded) is not str or len(encoded) > 4 * ((LIMIT + 2) // 3):
            raise ValueError('invalid directory request encoding')
        raw = base64.b64decode(encoded, validate=True)
        result = handle(support._decode(raw))
        print(json.dumps(result, sort_keys=True, allow_nan=False))
    except Exception:
        print('network directory preparation unavailable', file=sys.stderr)
        raise SystemExit(1) from None
