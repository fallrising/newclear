"""Strict private state and wire boundaries for the foreground retained lab.

This module never starts processes, performs HTTP, or reads runtime credentials.
Ownership checks protect against accidental substitution, not a hostile same UID.
"""
import fcntl
from functools import wraps
import json
import math
import os
from pathlib import Path
import pwd
import re
import secrets
import stat

import lab

MANIFEST_LIMIT = 65536
MESSAGE_LIMIT = 16384
MAX_INTEGER = (1 << 63) - 1
ERRORS = frozenset(('schema ownership busy dirty protocol io deadline preflight pin bootstrap '
                    'deployment runtime workload workflow shutdown interrupted evidence conflict not_found').split())
COMMANDS = frozenset('init serve status submit read workflow approve stop destroy'.split())


class StateError(Exception):
    """A fixed, non-secret failure reason suitable for a public projection."""
    def __init__(self, reason):
        self.reason = reason if reason in {'schema', 'ownership', 'busy', 'dirty', 'protocol', 'io', 'deadline'} else 'schema'
        super().__init__(self.reason)


def _need(condition):
    if not condition:
        raise StateError('schema')


def _keys(value, expected):
    _need(type(value) is dict and set(value) == set(expected.split()))


def _integer(value, minimum=0, maximum=MAX_INTEGER):
    _need(type(value) is int and minimum <= value <= maximum)
    return value


def _number(value, positive=False):
    _need(type(value) in (int, float) and math.isfinite(value) and
          (0 < value if positive else 0 <= value) and value <= MAX_INTEGER)
    return value


def _text(value, limit):
    _need(type(value) is str and len(value) <= limit)
    try:
        value.encode('utf-8')
    except UnicodeError:
        raise StateError('schema') from None
    return value


def _payload(value):
    value = _text(value, 128)
    _need(len(value.encode("utf-16-le")) // 2 <= 128)
    return value


def _pattern(value, pattern):
    _need(type(value) is str and re.fullmatch(pattern, value) is not None)
    return value


def _digest(value):
    return _pattern(value, r'[0-9a-f]{64}')


def _id(value):
    return _pattern(value, r'[A-Za-z0-9_-]{1,100}')


def _jobid(value):
    return _pattern(value, r'[a-z0-9][a-z0-9-]{0,63}')


def _boolean(value):
    _need(type(value) is bool)
    return value


def _json_bytes(value):
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise StateError('schema') from None


def _runtime(value, depth=0):
    _need(depth <= 4)
    if type(value) is dict:
        _need(len(value) <= 32)
        return {_text(k, 64): _runtime(v, depth + 1) for k, v in value.items()}
    if type(value) is list:
        _need(len(value) <= 32)
        return [_runtime(v, depth + 1) for v in value]
    if type(value) is str:
        return _text(value, 256)
    if value is None or type(value) is bool:
        return value
    if type(value) is int:
        return _integer(value, -MAX_INTEGER)
    _need(type(value) is float and math.isfinite(value) and abs(value) <= MAX_INTEGER)
    return value


def _identity(value):
    _keys(value, 'instance_id account_id database_id deployment')
    result = {key: _id(value[key]) for key in ('instance_id', 'account_id', 'database_id')}
    deployment = value['deployment']
    _keys(deployment, 'deployment_id version_id script_etag runtime bindings')
    expected = [{'type': 'd1', 'name': 'DB', 'database_id': result['database_id']},
                {'type': 'workflow', 'name': 'FLOW', 'workflow_name': lab.FLOW, 'class_name': 'LabFlow'}]
    _need(type(deployment['bindings']) is list and deployment['bindings'] == expected)
    # Validate exact types as equality alone admits True == 1 in arbitrary JSON.
    for binding, template in zip(deployment['bindings'], expected):
        _need(type(binding) is dict and all(type(v) is str for v in binding.values()) and binding == template)
    _need(type(deployment['runtime']) is dict)
    runtime = _runtime(deployment['runtime'])
    _need(len(_json_bytes(runtime)) <= 4096)
    result['deployment'] = dict(deployment_id=_id(deployment['deployment_id']),
                                version_id=_id(deployment['version_id']),
                                script_etag=_digest(deployment['script_etag']),
                                runtime=runtime, bindings=[dict(b) for b in expected])
    _need(len(_json_bytes(result)) <= 16384)
    return result


def _private_workflow(value):
    _keys(value, 'id job_id created_at boot_id created_monotonic phase nonce_sha256 completed')
    phase = value['phase']
    _need(type(phase) is str and phase in ('reserved', 'waiting', 'complete'))
    completed = _boolean(value['completed'])
    _need(completed == (phase == 'complete'))
    if phase == 'reserved':
        _need(value['nonce_sha256'] is None)
        nonce = None
    else:
        nonce = _digest(value['nonce_sha256'])
    return dict(id=_jobid(value['id']), job_id=_jobid(value['job_id']),
                created_at=_number(value['created_at'], positive=True),
                boot_id=_pattern(value['boot_id'], r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
                created_monotonic=_number(value['created_monotonic']), phase=phase,
                nonce_sha256=nonce, completed=completed)


def validate_manifest(value):
    """Return an independent bounded canonical private manifest, never repair it."""
    try:
        _keys(value, 'schema_version uid trial_id scope port binary fixture_sha256 identity clean workflow')
        _need(type(value['schema_version']) is int and value['schema_version'] == 1)
        scope, binary = value['scope'], value['binary']
        _keys(scope, 'device inode marker')
        _keys(binary, 'path sha256')
        path = _text(binary['path'], 4096)
        _need(len(path.encode('utf-8')) <= 4096 and path.startswith('/') and '\x00' not in path)
        result = dict(schema_version=1, uid=_integer(value['uid']),
                      trial_id=_pattern(value['trial_id'], r'[0-9a-f]{32}'),
                      scope=dict(device=_integer(scope['device']), inode=_integer(scope['inode']), marker=_digest(scope['marker'])),
                      port=_integer(value['port'], 1024, 65535),
                      binary=dict(path=path, sha256=_digest(binary['sha256'])),
                      fixture_sha256=_digest(value['fixture_sha256']),
                      identity=None if value['identity'] is None else _identity(value['identity']),
                      clean=_boolean(value['clean']),
                      workflow=None if value['workflow'] is None else _private_workflow(value['workflow']))
        _need(len(_json_bytes(result)) <= MANIFEST_LIMIT)
        return result
    except (RecursionError, OverflowError, ValueError, TypeError):
        raise StateError('schema') from None


def validate_scope(manifest):
    """Reconstruct only the fixed passwd-home scope; never create or delete it."""
    value = validate_manifest(manifest)
    if value['uid'] != os.geteuid() or os.getuid() != os.geteuid():
        raise StateError('ownership')
    if not value['clean'] or value['identity'] is None or (value['workflow'] is not None and value['workflow']['phase'] == 'reserved'):
        raise StateError('dirty')
    try:
        home = Path(pwd.getpwuid(os.getuid()).pw_dir)
        if not home.is_absolute() or home.resolve() != home:
            raise StateError('ownership')
        info = home.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
            raise StateError('ownership')
        scope = lab.OwnedScope(home / '.open-compute', value['port'], bounded_owner=True)
        scope.identity = {key: value['scope'][key] for key in ('device', 'inode')}
        scope.marker = value['scope']['marker']
        scope.check_owner()
        return scope
    except (OSError, KeyError, lab.LabError):
        raise StateError('ownership') from None


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        _need(key not in result)
        result[key] = value
    return result


def _parse(data):
    try:
        return json.loads(data.decode('utf-8'), object_pairs_hook=_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(StateError('schema')))
    except (UnicodeError, ValueError, RecursionError):
        raise StateError('schema') from None


def _job(value):
    _keys(value, 'id payload callback_count nonce_sha256 completed')
    count = _integer(value['callback_count'], 0, 1)
    complete = _integer(value['completed'], 0, 1)
    nonce = value['nonce_sha256']
    if count == 0:
        _need(nonce is None and complete == 0)
    else:
        _digest(nonce)
    return dict(id=_jobid(value['id']), payload=_payload(value['payload']),
                callback_count=count, nonce_sha256=nonce, completed=complete)


def _public_workflow(value):
    _keys(value, 'id job_id status nonce_sha256 completed')
    _need(value['status'] in ('waiting', 'complete', 'errored', 'terminated', 'paused'))
    _need(_boolean(value['completed']) == (value['status'] == 'complete'))
    return dict(id=_jobid(value['id']), job_id=_jobid(value['job_id']), status=value['status'],
                nonce_sha256=_digest(value['nonce_sha256']), completed=value['completed'])


def _response_data(command, data):
    if command in ('init', 'destroy'):
        key = 'initialized' if command == 'init' else 'destroyed'
        _keys(data, key)
        _need(data[key] is True)
        return {key: True}
    if command == 'serve':
        if data == {'ready': True}:
            _keys(data, 'ready')
            _need(data['ready'] is True)
            return {'ready': True}
        _keys(data, 'stopped clean')
        _need(data['stopped'] is True and data['clean'] is True)
        return {'stopped': True, 'clean': True}
    if command in ('read', 'submit'):
        _keys(data, 'job row_count')
        _integer(data['row_count'], 1, 1)
        return dict(job=_job(data['job']), row_count=1)
    if command in ('workflow', 'approve'):
        _keys(data, 'id job_id status callback_count nonce_sha256' + (' completed' if command == 'approve' else ''))
        _need(data['status'] == ('complete' if command == 'approve' else 'waiting'))
        _integer(data['callback_count'], 1, 1)
        result = dict(id=_jobid(data['id']), job_id=_jobid(data['job_id']), status=data['status'],
                      callback_count=1, nonce_sha256=_digest(data['nonce_sha256']))
        if command == 'approve':
            result['completed'] = _integer(data['completed'], 1, 1)
        return result
    if command == 'stop':
        _keys(data, 'was_running signal forced exit_code all_owned_exited')
        _need(data['was_running'] is True and data['signal'] == 'SIGTERM' and data['forced'] is False and
              data['all_owned_exited'] is True)
        _integer(data['exit_code'], 0, 0)
        return dict(was_running=True, signal='SIGTERM', forced=False, exit_code=0, all_owned_exited=True)
    _keys(data, 'running daemon instance_id account_id database_id deployment_id version_id worker_healthy workflow')
    _need(command == 'status' and data['running'] is True and data['worker_healthy'] is True)
    _keys(data['daemon'], 'pid start_ticks')
    result = dict(running=True, daemon={key: _integer(data['daemon'][key], 1) for key in ('pid', 'start_ticks')},
                  worker_healthy=True, workflow=None if data['workflow'] is None else _public_workflow(data['workflow']))
    result.update({key: _id(data[key]) for key in ('instance_id', 'account_id', 'database_id', 'deployment_id', 'version_id')})
    return result


def _message(value):
    _need(type(value) is dict)
    if 'args' in value:
        _keys(value, 'schema_version command args')
    else:
        _keys(value, 'schema_version command result error data')
    _need(type(value['schema_version']) is int and value['schema_version'] == 1)
    command = value['command']
    _need(type(command) is str and command in COMMANDS)
    if 'args' in value:
        _need(command in ('status', 'read', 'submit', 'workflow', 'approve', 'stop'))
        args = value['args']
        _keys(args, {'read': 'id', 'submit': 'id payload', 'workflow': 'id job_id'}.get(command, ''))
        result = {}
        if command in ('read', 'submit', 'workflow'):
            result['id'] = _jobid(args['id'])
        if command == 'submit': result['payload'] = _payload(args['payload'])
        if command == 'workflow': result['job_id'] = _jobid(args['job_id'])
        return dict(schema_version=1, command=command, args=result)
    _need(type(value['result']) is str and value['result'] in ('passed', 'failed'))
    if value['result'] == 'failed':
        _need(type(value['error']) is str and value['error'] in ERRORS)
        _keys(value['data'], '')
        return dict(schema_version=1, command=command, result='failed', error=value['error'], data={})
    _need(value['error'] is None)
    return dict(schema_version=1, command=command, result='passed', error=None,
                data=_response_data(command, value['data']))


def encode_message(value):
    """Encode exactly one bounded strict request or sanitized response frame."""
    try:
        frame = _json_bytes(_message(value)) + b'\n'
        _need(len(frame) <= MESSAGE_LIMIT)
        return frame
    except (StateError, TypeError, ValueError, RecursionError, OverflowError):
        raise StateError('protocol') from None


def decode_message(data):
    """Decode exactly one LF-terminated JSON frame (never trailing whitespace)."""
    try:
        _need(type(data) is bytes and 1 < len(data) <= MESSAGE_LIMIT and data[-1:] == b'\n' and b'\n' not in data[:-1])
        # JSON strings escape LF; reject CR framing and trailing bytes after the object.
        body = data[:-1]
        _need(body[:1] == b'{' and body[-1:] == b'}')
        return _message(_parse(body))
    except (StateError, TypeError, ValueError, RecursionError, OverflowError):
        raise StateError('protocol') from None


def _bounded_io(function):
    @wraps(function)
    def bounded(*args, **kwargs):
        try:
            with lab.m3_deadline(10, "manifest"):
                return function(*args, **kwargs)
        except lab.LabError:
            raise StateError("deadline") from None
    return bounded


def _metadata(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _identity_metadata(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink)


def _regular(info):
    if not (stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and
            info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600):
        raise StateError('ownership')


def _parent_snapshot(parent):
    """Walk trusted ancestry by descriptor; never follow symlink components."""
    fd = None
    result = []
    try:
        with lab.defer_owner_signals():
            fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        parts = parent.parts[1:]
        for index in range(len(parts) + 1):
            info = os.fstat(fd)
            immediate = index == len(parts)
            if (not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o022 or
                    info.st_uid not in ({os.geteuid()} if immediate else {0, os.geteuid()})):
                raise StateError('ownership')
            result.append((info.st_dev, info.st_ino, info.st_mode, info.st_uid))
            if not immediate:
                next_fd = None
                try:
                    with lab.defer_owner_signals():
                        next_fd = os.open(parts[index], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                        os.close(fd)
                        fd, next_fd = next_fd, None
                finally:
                    if next_fd is not None: os.close(next_fd)
        return tuple(result)
    except OSError:
        raise StateError('ownership') from None
    finally:
        if fd is not None: os.close(fd)


class StateDirectory:
    """Hold one exact private directory and its never-replaced singleton lock."""
    def __init__(self, path, *, create=False):
        self.path = Path(path)
        if not self.path.is_absolute() or '..' in self.path.parts:
            raise StateError('ownership')
        self.create = create
        self._root_fd = self._lock_fd = None
        self._root_identity = self._lock_identity = None
        self._first_save = create
        self._parents = None

    def __enter__(self):
        if self._root_fd is not None:
            raise StateError('busy')
        try:
            self._parents = _parent_snapshot(self.path.parent)
            if self.create:
                self.path.mkdir(mode=0o700)
            with lab.defer_owner_signals():
                self._root_fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            info = os.fstat(self._root_fd)
            if not (info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700):
                raise StateError('ownership')
            self._root_identity = _identity_metadata(info)
            flags = os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK
            if self.create: flags |= os.O_CREAT | os.O_EXCL
            with lab.defer_owner_signals():
                self._lock_fd = os.open('owner.lock', flags, 0o600, dir_fd=self._root_fd)
            info = os.fstat(self._lock_fd)
            _regular(info)
            if info.st_size != 0: raise StateError('ownership')
            self._lock_identity = _identity_metadata(info)
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise StateError('busy') from None
            self.check()
            if self.create:
                os.fsync(self._lock_fd)
                os.fsync(self._root_fd)
            return self
        except BaseException as exc:
            self.__exit__(None, None, None)
            if isinstance(exc, OSError):
                raise StateError('ownership') from None
            raise

    def __exit__(self, *_):
        # Closing releases flock; do not unlink the lock or erase failed-init evidence.
        for name in ('_lock_fd', '_root_fd'):
            fd = getattr(self, name)
            setattr(self, name, None)
            if fd is not None: os.close(fd)

    def check(self):
        try:
            if self._root_fd is None or self._lock_fd is None:
                raise StateError('ownership')
            if _parent_snapshot(self.path.parent) != self._parents:
                raise StateError('ownership')
            root = os.stat(self.path, follow_symlinks=False)
            if (_identity_metadata(root) != self._root_identity or
                    _identity_metadata(os.fstat(self._root_fd)) != self._root_identity):
                raise StateError('ownership')
            lock = os.stat('owner.lock', dir_fd=self._root_fd, follow_symlinks=False)
            _regular(lock)
            if lock.st_size != 0: raise StateError('ownership')
            if (_identity_metadata(lock) != self._lock_identity or
                    _identity_metadata(os.fstat(self._lock_fd)) != self._lock_identity):
                raise StateError('ownership')
        except OSError:
            raise StateError('ownership') from None

    def _read(self):
        """Return bytes plus immutable open identity for replacement validation."""
        fd = None
        try:
            self.check()
            before = os.stat('manifest.json', dir_fd=self._root_fd, follow_symlinks=False)
            _regular(before)
            if before.st_size > MANIFEST_LIMIT: raise StateError('schema')
            with lab.defer_owner_signals():
                fd = os.open('manifest.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self._root_fd)
            opened = os.fstat(fd)
            if _metadata(before) != _metadata(opened): raise StateError('ownership')
            data = bytearray()
            while len(data) <= MANIFEST_LIMIT:
                chunk = os.read(fd, min(8192, MANIFEST_LIMIT + 1 - len(data)))
                if not chunk: break
                data.extend(chunk)
            if len(data) > MANIFEST_LIMIT: raise StateError('schema')
            if (_metadata(opened) != _metadata(os.fstat(fd)) or
                    _metadata(opened) != _metadata(os.stat('manifest.json', dir_fd=self._root_fd, follow_symlinks=False))):
                raise StateError('ownership')
            self.check()
            return bytes(data), _metadata(opened)
        finally:
            if fd is not None: os.close(fd)

    @_bounded_io
    def load(self):
        try:
            data, _ = self._read()
            return validate_manifest(_parse(data))
        except OSError:
            raise StateError('io') from None

    @_bounded_io
    def save(self, manifest):
        value = validate_manifest(manifest)
        data = _json_bytes(value) + b'\n'
        if len(data) > MANIFEST_LIMIT: raise StateError('schema')
        fd = None
        try:
            self.check()
            try:
                old_data, old_identity = self._read()
                validate_manifest(_parse(old_data))
            except FileNotFoundError:
                # Only the initial creator may make the first authority record.
                if not self._first_save: raise StateError('ownership')
                old_identity = None
            temporary = '.manifest-' + secrets.token_hex(16) + '.tmp'
            with lab.defer_owner_signals():
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=self._root_fd)
            _regular(os.fstat(fd))
            remaining = memoryview(data)
            while remaining:
                written = os.write(fd, remaining)
                if written <= 0: raise StateError('io')
                remaining = remaining[written:]
            os.fsync(fd)
            os.close(fd)
            fd = None
            self.check()
            if old_identity is None:
                # link is an atomic no-clobber publication; first save cannot overwrite.
                os.link(temporary, 'manifest.json', src_dir_fd=self._root_fd,
                        dst_dir_fd=self._root_fd, follow_symlinks=False)
                self._first_save = False
                os.unlink(temporary, dir_fd=self._root_fd)
            else:
                if _metadata(os.stat('manifest.json', dir_fd=self._root_fd, follow_symlinks=False)) != old_identity:
                    raise StateError('ownership')
                os.replace(temporary, 'manifest.json', src_dir_fd=self._root_fd, dst_dir_fd=self._root_fd)
            os.fsync(self._root_fd)
            self.check()
        except OSError:
            raise StateError('io') from None
        finally:
            if fd is not None: os.close(fd)
