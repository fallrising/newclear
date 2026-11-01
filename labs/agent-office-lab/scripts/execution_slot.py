"""One cooperative execution slot per lab, retained across dispatcher exec.

An uncleared journal blocks new work after a crash. It is never a retry queue.
"""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import secrets
import re
import stat
import sys

LAB = Path(__file__).resolve().parents[1]
FD_ENV = 'LAB_EXECUTION_SLOT_FD'
_active = None
RETRY_RUN = re.compile(r'pi-work-[A-Za-z0-9_-]{1,100}\Z')


class SlotError(ValueError):
    pass


def _private_file(fd):
    info = os.fstat(fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
            or info.st_mode & 0o077 or info.st_nlink != 1):
        raise SlotError('unsafe_slot_file')
    return info


def _directory(lab):
    fd = os.open(lab, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in ('state', 'dispatch'):
            try:
                os.mkdir(part, 0o700, dir_fd=fd)
            except FileExistsError:
                pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise SlotError('unsafe_slot_directory')
        return fd
    except BaseException:
        os.close(fd)
        raise


def _read(directory):
    try:
        fd = os.open('active.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, 'rb') as stream:
        if _private_file(stream.fileno()).st_size > 4096:
            raise SlotError('invalid_slot_journal')
        value = json.loads(stream.read(4097))
    if (not isinstance(value, dict) or value.get('schema') != 1
            or type(value.get('pid')) is not int or value['pid'] <= 0
            or value.get('phase') not in ('guarded', 'running', 'uncertain')):
        raise SlotError('invalid_slot_journal')
    if 'retry_parent' in value and (not isinstance(value['retry_parent'], str) or not RETRY_RUN.fullmatch(value['retry_parent'])):
        raise SlotError('invalid_retry_parent')
    return value


class Slot:
    def __init__(self, directory, fd):
        self.directory, self.fd = directory, fd
        self.started = False
        self.clean = False
        self.retry_parent = None

    def select_retry(self, run_id):
        if self.started or not isinstance(run_id, str) or not RETRY_RUN.fullmatch(run_id):
            raise SlotError('invalid_retry_parent')
        self.retry_parent = run_id
        self.write('guarded')

    def write(self, phase):
        name = '.active-' + secrets.token_hex(12)
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.directory)
        try:
            with os.fdopen(fd, 'w') as stream:
                value = {'schema': 1, 'pid': os.getpid(), 'phase': phase}
                if self.retry_parent is not None: value['retry_parent'] = self.retry_parent
                json.dump(value, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, 'active.json', src_dir_fd=self.directory, dst_dir_fd=self.directory)
        finally:
            try:
                os.unlink(name, dir_fd=self.directory)
            except FileNotFoundError:
                pass

    def exec_env(self, parent):
        os.set_inheritable(self.fd, True)
        return dict(parent, **{FD_ENV: str(self.fd)})


@contextmanager
def execution_slot(lab=LAB):
    global _active
    if _active is not None:
        raise SlotError('nested_execution_not_supported')
    directory, fd = _directory(lab), None
    try:
        inherited = os.environ.pop(FD_ENV, None)
        if inherited is None:
            fd = os.open('execution.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                         0o600, dir_fd=directory)
        else:
            if not inherited.isdigit() or int(inherited) < 3:
                raise SlotError('invalid_inherited_slot')
            fd = os.dup(int(inherited))
        info = _private_file(fd)
        current = os.stat('execution.lock', dir_fd=directory, follow_symlinks=False)
        if (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
            raise SlotError('invalid_inherited_slot')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SlotError('execution_busy') from None
        prior = _read(directory)
        if inherited is None and prior is not None:
            raise SlotError('cleanup_unconfirmed')
        if inherited is not None:
            if prior is None or {k:v for k,v in prior.items() if k != 'retry_parent'} != {'schema': 1, 'pid': os.getpid(), 'phase': 'guarded'}:
                raise SlotError('invalid_inherited_journal')
            os.close(int(inherited))
        slot = Slot(directory, fd)
        if inherited is not None: slot.retry_parent = prior.get('retry_parent')
        slot.write('guarded')
        _active = slot
        try:
            yield slot
        finally:
            _active = None
            if not slot.started or slot.clean:
                os.unlink('active.json', dir_fd=directory)
            else:
                slot.write('uncertain')
    finally:
        if fd is not None:
            os.close(fd)
        os.close(directory)


def mark_started():
    if _active is not None:
        _active.started = True
        _active.write('running')


def retry_parent(lab=LAB):
    """Require this checkout's live execution slot for retry mutations."""
    if _active is None or not os.path.samestat(os.fstat(_active.directory), os.stat(lab / 'state/dispatch', follow_symlinks=False)):
        raise SlotError('retry_requires_execution_slot')
    return _active.retry_parent


def mark_clean():
    if _active is not None:
        _active.clean = True


def guarded_main(main, mutating):
    if not mutating:
        return main()
    try:
        with execution_slot():
            return main()
    except SlotError as error:
        print(json.dumps({'status': 'blocked', 'reason': str(error)}), file=sys.stderr)
        return 1


def acknowledge_stopped(lab=LAB):
    """Operator acknowledgement ONLY; does not discover, stop or resume processes."""
    directory = _directory(lab)
    fd = None
    try:
        fd = os.open('execution.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                     0o600, dir_fd=directory)
        _private_file(fd)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SlotError('execution_busy') from None
        prior = _read(directory)
        if prior is not None:
            # Retain the previous interruption record; only active state is cleared.
            os.replace('active.json', 'acknowledged-' + secrets.token_hex(12) + '.json',
                       src_dir_fd=directory, dst_dir_fd=directory)
        return prior is not None
    finally:
        if fd is not None:
            os.close(fd)
        os.close(directory)
