"""Persistent admission barrier for cooperating mutations on one controller.

This infrastructure API provides no live authorization or external writer fence.
Completion is admitted only after the complete immutable generation proof validates.
Reservations remain immutable; interrupted or unknown states continue to block.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat

PENDING_DIRECTORY = 'pending-generation'
RECORD_NAME = 'reservation.json'
MAX_RECORD_BYTES = 4096
_HASH = re.compile(r'[a-f0-9]{64}\Z')
_IDENTIFIER = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z')
_HASH_FIELDS = {'review_sha256', 'execution_sha256', 'scope_sha256',
                'cluster_sha256', 'fence_sha256'}
_FIELDS = _HASH_FIELDS | {'cluster_id', 'run_id', 'generation_before', 'target_generation'}
_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def assert_no_pending(private_fd, *, project=None):
    """Ordinary admission requires a physical, deeply verified completion proof."""
    try:
        os.stat(PENDING_DIRECTORY, dir_fd=private_fd, follow_symlinks=False)
    except FileNotFoundError:
        if project is not None:
            try:
                verify_retirements(project,private_fd)
            except (OSError,ValueError,RuntimeError,KeyError,TypeError,AttributeError,IndexError,RecursionError):
                raise RuntimeError('pending generation history blocks controller mutation') from None
        else:
            try:
                os.stat('generation-history',dir_fd=private_fd,follow_symlinks=False)
            except FileNotFoundError:
                return
            raise RuntimeError('pending generation history requires verification')
        return
    if project is not None:
        try:
            from fresh_generation import _physical
            from fresh_generation_ops import verify_completed
            with _physical():
                verify_retirements(project,private_fd)
                observed = _inspect_reservation(project, allow_completion=True)
                if observed.get('status') == 'pending':
                    proof = verify_completed(project, observed['reservation']['bindings']['run_id'],
                                             private_fd=private_fd)
                    if proof['status'] == 'completed':
                        return
        except (OSError, ValueError, RuntimeError, KeyError, TypeError, AttributeError, IndexError, RecursionError):
            pass
    raise RuntimeError('pending generation blocks controller mutation')


def _bindings(value):
    if type(value) is not dict or set(value) != _FIELDS:
        raise ValueError('pending generation requires exact binding fields')
    if value['cluster_id'] != 'eru-vps-mvp':
        raise ValueError('pending generation cluster identity is invalid')
    if type(value['run_id']) is not str or not _IDENTIFIER.fullmatch(value['run_id']):
        raise ValueError('pending generation run identity is invalid')
    before, target = value['generation_before'], value['target_generation']
    if (type(before) is not int or type(target) is not int
            or not 1 <= before < 2**63 - 1 or target != before + 1):
        raise ValueError('pending generation must reserve exactly G + 1')
    for field in _HASH_FIELDS:
        if type(value[field]) is not str or not _HASH.fullmatch(value[field]):
            raise ValueError('pending generation SHA-256 binding is invalid')
    return dict(value)


def _identity(info):
    return [info.st_dev, info.st_ino]


def _private(info, directory=False):
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if (not kind(info.st_mode) or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) & 0o077
            or (not directory and info.st_nlink != 1)):
        raise ValueError('unsafe pending generation entry')


def _check_directory(private_fd, pending_fd, directory=PENDING_DIRECTORY):
    current = os.stat(directory, dir_fd=private_fd, follow_symlinks=False)
    actual = os.fstat(pending_fd)
    _private(current, directory=True)
    if _identity(current) != _identity(actual):
        raise RuntimeError('pending generation directory changed')


def reserve(project, bindings, *, verify=None):
    """Reserve durably under ordinary ClusterLock; return the record digest.

    Binding hashes are provenance, not validation of their underlying evidence.
    An optional verify(lock) callback revalidates current underlying evidence
    while holding the ordinary lock and returns the exact complete bindings.
    Callback failure or disagreement prevents publication. The default remains
    provenance-only; this helper never grants live cluster permission.
    Failed publication retains the pending path; another generation cannot skip it.
    """
    from labops import ClusterLock
    bindings = _bindings(bindings)
    with ClusterLock(project) as lock:
        private_fd = lock.private_fd
        _private(os.fstat(private_fd), directory=True)
        if verify is not None:
            checked = _bindings(verify(lock))
            if checked != bindings:
                raise RuntimeError('checked reservation bindings changed')
        lock.check_private_root()
        value = {'schema': 1, 'operation': 'fresh-generation-reservation',
                 'bindings': bindings, 'private_identity': _identity(os.fstat(private_fd))}
        raw = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
        lock.check_private_root()
        _archive_completed(project, lock, bindings)
        os.mkdir(PENDING_DIRECTORY, mode=0o700, dir_fd=private_fd)
        # Preserve the reservation even if a subsequent durability step fails.
        os.fsync(private_fd)
        parent_fd = os.open(Path(project), os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
        pending_fd = os.open(PENDING_DIRECTORY, _DIR_FLAGS, dir_fd=private_fd)
        try:
            _check_directory(private_fd, pending_fd)
            fd = os.open('.reservation.tmp', os.O_WRONLY | os.O_CREAT | os.O_EXCL
                         | os.O_NOFOLLOW, 0o600, dir_fd=pending_fd)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            lock.check_private_root()
            _check_directory(private_fd, pending_fd)
            os.link('.reservation.tmp', RECORD_NAME, src_dir_fd=pending_fd,
                    dst_dir_fd=pending_fd, follow_symlinks=False)
            os.unlink('.reservation.tmp', dir_fd=pending_fd)
            os.fsync(pending_fd)
            lock.check_private_root()
            _check_directory(private_fd, pending_fd)
            return hashlib.sha256(raw).hexdigest()
        finally:
            os.close(pending_fd)


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate pending generation field')
        value[key] = item
    return value


def _invalid_constant(_value):
    raise ValueError('nonstandard pending generation number')


def _inspect_reservation(project, *, allow_completion=False, directory=PENDING_DIRECTORY):
    """Read only; malformed or interrupted records remain blocked, never cleared.

    The result is an observation, not mutation admission: admission must acquire
    ClusterLock and recheck the path while holding it.
    """
    private = Path(project) / 'private'
    try:
        private_fd = os.open(private, os.O_RDONLY | os.O_DIRECTORY)
    except FileNotFoundError:
        if private.is_symlink():
            return {'status': 'invalid', 'blocked': True}
        return {'status': 'absent', 'blocked': False}
    except OSError:
        return {'status': 'invalid', 'blocked': True}
    try:
        pinned = _identity(os.fstat(private_fd))
        def check_root():
            if _identity(private.stat()) != pinned:
                raise ValueError('controller private root changed')
        try:
            if directory == PENDING_DIRECTORY:
                try:
                    assert_no_pending(private_fd)
                except RuntimeError:
                    pass
            os.stat(directory, dir_fd=private_fd, follow_symlinks=False)
        except FileNotFoundError:
            try:
                check_root()
            except (OSError, ValueError):
                return {'status': 'invalid', 'blocked': True}
            return {'status': 'absent', 'blocked': False}
        try:
            _private(os.fstat(private_fd), directory=True)
            from fresh_execution_ops import PrivateFiles
            files = PrivateFiles(project)
            try:
                pending_fd = files.directory(files.parts('private/' + directory))
            finally:
                files.close()
            try:
                _check_directory(private_fd, pending_fd, directory)
                names = sorted(os.listdir(pending_fd))
                permitted = [[RECORD_NAME], ['completion.json', RECORD_NAME]] if allow_completion else [[RECORD_NAME]]
                if names not in permitted:
                    raise ValueError('unexpected pending generation records')
                fd = os.open(RECORD_NAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                             dir_fd=pending_fd)
                try:
                    before = os.fstat(fd)
                    _private(before)
                    if before.st_size > MAX_RECORD_BYTES:
                        raise ValueError('oversized pending generation record')
                    raw = os.read(fd, MAX_RECORD_BYTES + 1)
                    after = os.fstat(fd)
                    current = os.stat(RECORD_NAME, dir_fd=pending_fd, follow_symlinks=False)
                    if (len(raw) != before.st_size or _identity(current) != _identity(after)
                            or before.st_mtime_ns != after.st_mtime_ns
                            or before.st_ctime_ns != after.st_ctime_ns):
                        raise ValueError('pending generation record changed')
                finally:
                    os.close(fd)
                value = json.loads(raw, object_pairs_hook=_unique,
                                   parse_constant=_invalid_constant)
                if (type(value) is not dict or set(value) != {
                        'schema', 'operation', 'bindings', 'private_identity'}
                        or type(value['schema']) is not int or value['schema'] != 1
                        or value['operation'] != 'fresh-generation-reservation'
                        or type(value['private_identity']) is not list
                        or any(type(item) is not int for item in value['private_identity'])
                        or value['private_identity'] != pinned):
                    raise ValueError('invalid pending generation record')
                _bindings(value['bindings'])
                _check_directory(private_fd, pending_fd, directory)
                check_root()
                return {'status': 'pending', 'blocked': True,
                        'reservation': value, 'sha256': hashlib.sha256(raw).hexdigest(),
                        'pending_identity': _identity(os.fstat(pending_fd)),
                        'record_identity': _identity(current)}
            finally:
                os.close(pending_fd)
        except (OSError, ValueError, RuntimeError, RecursionError):
            return {'status': 'invalid', 'blocked': True}
    except (OSError, ValueError, RuntimeError, RecursionError):
        return {'status': 'invalid', 'blocked': True}
    finally:
        os.close(private_fd)


def inspect(project):
    """Observe durable state; completed status is derived, never a stored flag."""
    from fresh_generation import historical_pending
    historical = historical_pending(project)
    if historical is not None:
        return historical
    try:
        retiring = _retiring_pending(project)
        if retiring is not None:
            return retiring
    except FileNotFoundError:
        pass
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,AttributeError,IndexError,RecursionError):
        return {'status':'invalid','blocked':True}
    observed = _inspect_reservation(project, allow_completion=True)
    if observed.get('status') != 'pending':
        return observed
    path = Path(project) / 'private' / PENDING_DIRECTORY / 'completion.json'
    try:
        path.lstat()
    except FileNotFoundError:
        return observed
    try:
        from fresh_generation_ops import verify_completed
        proof = verify_completed(project, observed['reservation']['bindings']['run_id'])
        if proof['status'] != 'completed':
            raise ValueError('incomplete completion proof')
        return {**observed, 'status': 'completed', 'blocked': False}
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, AttributeError, IndexError, RecursionError):
        return {'status': 'invalid', 'blocked': True}



def _archive_completed(project, lock, bindings):
    observed = inspect(project)
    if observed['status'] == 'absent':
        return
    if observed['status'] != 'completed':
        raise RuntimeError('pending generation cannot be archived')
    from fresh_generation_ops import verify_completed
    proof = verify_completed(project, observed['reservation']['bindings']['run_id'], private_fd=lock.private_fd)
    if (bindings['generation_before'] != observed['reservation']['bindings']['target_generation']
            or bindings['cluster_sha256'] != proof['after_hashes']['private/operations/cluster.json']):
        raise ValueError('next generation does not continue completed predecessor')
    retire_completed(project, lock.private_fd)


HISTORY = 'private/generation-history'


def _history_names(files):
    try:
        fd = files.directory(files.parts(HISTORY))
    except FileNotFoundError:
        return []
    try:
        names = sorted(os.listdir(fd))
        if any(not _HASH.fullmatch(n) for n in names):
            raise ValueError('unknown generation retirement claim')
        return names
    finally:
        os.close(fd)


def _retirement_intent(files, observed, directory, claim_identity):
    completion, _, digest = files.json('private/' + directory + '/completion.json')
    return {'schema_version': 1, 'operation': 'fresh-generation-retirement-intent',
        'run_id': observed['reservation']['bindings']['run_id'], 'reservation_sha256': observed['sha256'],
        'generation_sha256': completion['generation_sha256'], 'completion_sha256': digest,
        'private_identity': files.identity, 'pending_identity': observed['pending_identity'],
        'record_identity': observed['record_identity'], 'claim_identity': claim_identity,
        'acceptance': completion['acceptance']}


def _retirement_receipt(intent, ref):
    return {'schema_version': 1, 'operation': 'fresh-generation-retirement-receipt',
        'intent': ref, 'archive': HISTORY + '/' + intent['reservation_sha256'] + '/pending-generation',
        'completion_sha256': intent['completion_sha256'], 'private_identity': intent['private_identity'],
        'pending_identity': intent['pending_identity'], 'record_identity': intent['record_identity']}


def _retirement(files, digest, *, require_complete=True, current=False, now=None, source_state=None):
    """Read a claimed retirement and verify its complete historical generation."""
    from fresh_generation_ops import verify_retained_completion
    claim = HISTORY + '/' + digest
    fd = files.directory(files.parts(claim))
    try:
        claim_identity = _identity(os.fstat(fd))
        names = sorted(os.listdir(fd))
        failed = '.retirement-failed' in names
        if failed:
            if files.read(claim + '/.retirement-failed')[0] != b'fresh-generation-retirement-failed\n':
                raise ValueError('unknown retirement failure marker')
            names.remove('.retirement-failed')
        allowed = (['intent.json'], ['intent.json', 'pending-generation'],
                   ['intent.json', 'pending-generation', 'receipt.json'])
        if names not in allowed:
            raise ValueError('generation retirement is unknown or incomplete')
    finally:
        os.close(fd)
    intent, path, sha = files.json(claim + '/intent.json')
    ref = {'path': path, 'sha256': sha}
    if intent.get('reservation_sha256') != digest:
        raise ValueError('generation retirement claim differs')
    directory = 'generation-history/' + digest + '/pending-generation' if 'pending-generation' in names else PENDING_DIRECTORY
    observed = _inspect_reservation(files.project,allow_completion=True,directory=directory)
    if observed.get('sha256') != digest or observed['status'] != 'pending':
        raise ValueError('generation retirement reservation differs')
    if intent != _retirement_intent(files,observed,directory,claim_identity):
        raise ValueError('generation retirement intent differs')
    verify_retained_completion(files.project,intent['run_id'],intent['generation_sha256'],directory,
        current=current,now=now,source_state=source_state)
    has_receipt = 'receipt.json' in names
    complete = has_receipt and not failed
    if has_receipt:
        if files.json(claim + '/receipt.json')[0] != _retirement_receipt(intent,ref):
            raise ValueError('generation retirement receipt differs')
    if require_complete and not complete:
        raise ValueError('generation retirement requires explicit local finalize')
    return {'complete':complete,'pending':observed,'directory':directory,'intent':intent}


def _generation_state_present(project, private_fd):
    """Preserve ordinary admission when neither generation entry exists."""
    if _identity(os.stat(Path(project) / 'private')) != _identity(os.fstat(private_fd)):
        raise ValueError('generation root descriptor differs')
    present = False
    for name in (PENDING_DIRECTORY, 'generation-history'):
        try:
            os.stat(name, dir_fd=private_fd, follow_symlinks=False)
            present = True
        except FileNotFoundError:
            pass
    return present


def verify_retirements(project, private_fd=None):
    if private_fd is not None and not _generation_state_present(project, private_fd):
        return []
    from fresh_generation import _physical
    from fresh_execution_ops import PrivateFiles
    with _physical():
        files = PrivateFiles(project)
        try:
            if private_fd is not None and _identity(os.fstat(private_fd)) != files.identity:
                raise ValueError('retirement root descriptor differs')
            result = [_retirement(files,n) for n in _history_names(files)]
            files.recheck()
            return result
        finally:
            files.close()


def _retiring_pending(project):
    """Only expose an exact completed reservation to its explicit local finalize."""
    from fresh_execution_ops import PrivateFiles
    from fresh_generation_ops import verify_completed
    files = PrivateFiles(project)
    try:
        active = []
        names = _history_names(files)
        if not names:
            return None
        canonical = _inspect_reservation(project,allow_completion=True)
        for name in names:
            try:
                item = _retirement(files,name)
            except (OSError,ValueError,RuntimeError,KeyError,TypeError):
                if canonical.get('sha256') == name:
                    # A crash before/inside intent publication leaves the original
                    # complete reservation intact. Explicit finalize rederives it.
                    verify_completed(project,canonical['reservation']['bindings']['run_id'])
                    active.append(canonical)
                else:
                    item = _retirement(files,name,require_complete=False,current=True)
                    if item['complete']:
                        raise ValueError('unexpected completed retirement failure')
                    active.append(item['pending'])
        if len(active)>1:
            raise ValueError('multiple active generation retirements')
        return active[0] if active else None
    finally:
        files.close()


def retire_completed(project, private_fd, *, now=None, source_state=None):
    """Under the held controller lock: intent -> retained inode -> receipt.

    Unknown or partial claims never admit ordinary mutation. This function is
    also used by the exact fresh-owned explicit finalize recovery path.
    """
    if not _generation_state_present(project, private_fd):
        return False
    from fresh_generation import _physical
    from fresh_generation_ops import verify_completed, verify_retained_completion, _publish_once
    from fresh_execution_ops import PrivateFiles
    with _physical():
        files = PrivateFiles(project)
        try:
            if files.identity != _identity(os.fstat(private_fd)):
                raise ValueError('retirement root descriptor differs')
            observed = _inspect_reservation(project,allow_completion=True)
            names = _history_names(files)
            if observed['status'] == 'absent':
                active = []
                for name in names:
                    item = _retirement(files,name,require_complete=False,now=now,source_state=source_state)
                    if not item['complete']:
                        item = _retirement(files,name,require_complete=False,current=True,now=now,source_state=source_state)
                        active.append(item)
                if not active:
                    return False
                if len(active)!=1:
                    raise ValueError('multiple interrupted retirements')
                observed = active[0]['pending']
                directory = active[0]['directory']
            else:
                if observed['status'] != 'pending':
                    raise ValueError('retirement has invalid current reservation')
                run = observed['reservation']['bindings']['run_id']
                verify_completed(project,run,private_fd=private_fd,now=now,source_state=source_state)
                directory = PENDING_DIRECTORY
            digest = observed['sha256']
            for name in names:
                if name != digest:
                    _retirement(files,name)
            history_fd = files.directory(files.parts(HISTORY),create=True)
            try:
                try:
                    os.mkdir(digest,0o700,dir_fd=history_fd)
                except FileExistsError:
                    pass
                os.fsync(history_fd)
            finally:
                os.close(history_fd)
            claim_path = HISTORY + '/' + digest
            claim_fd = files.directory(files.parts(claim_path))
            try:
                allowed = {'intent.json','pending-generation','receipt.json','.intent.json.tmp','.receipt.json.tmp','.retirement-failed'}
                if set(os.listdir(claim_fd)) - allowed:
                    raise ValueError('unknown generation retirement entry')
                failed_path = claim_path+'/.retirement-failed'
                try:
                    failure_marker = files.read(failed_path)[0]
                except FileNotFoundError:
                    failure_marker = None
                if failure_marker is not None and failure_marker != b'fresh-generation-retirement-failed\n':
                    raise ValueError('unknown retirement failure marker')
                intent = _retirement_intent(files,observed,directory,_identity(os.fstat(claim_fd)))
                intent_ref = _publish_once(files,claim_path+'/intent.json',intent)
                if directory == PENDING_DIRECTORY:
                    if _inspect_reservation(project,allow_completion=True) != observed:
                        raise ValueError('retirement pending changed before archive')
                    try:
                        os.stat(PENDING_DIRECTORY,dir_fd=claim_fd,follow_symlinks=False)
                    except FileNotFoundError:
                        pass
                    else:
                        raise ValueError('retirement archive already exists')
                    files.check()
                    os.rename(PENDING_DIRECTORY,PENDING_DIRECTORY,src_dir_fd=private_fd,dst_dir_fd=claim_fd)
                    os.fsync(claim_fd); os.fsync(private_fd)
                    # These exact bytes moved with the original retained inode.
                    for key in list(files.seen):
                        if key.startswith('private/pending-generation/'):
                            files.seen.pop(key)
                archive = 'generation-history/' + digest + '/pending-generation'
                verify_retained_completion(project,intent['run_id'],intent['generation_sha256'],archive,
                    current=True,now=now,source_state=source_state)
                os.fsync(claim_fd); os.fsync(private_fd)
                _publish_once(files,claim_path+'/receipt.json',_retirement_receipt(intent,intent_ref))
                os.fsync(claim_fd); os.fsync(private_fd)
                if failure_marker is not None:
                    if files.read(failed_path)[0] != failure_marker:
                        raise ValueError('retirement failure marker changed')
                    os.unlink('.retirement-failed',dir_fd=claim_fd)
                    files.seen.pop(failed_path,None)
                    os.fsync(claim_fd)
                files.recheck()
                _retirement(files,digest,now=now,source_state=source_state)
                return True
            except BaseException:
                try:
                    failure_fd = os.open('.retirement-failed',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=claim_fd)
                    with os.fdopen(failure_fd,'wb') as stream:
                        stream.write(b'fresh-generation-retirement-failed\n'); stream.flush(); os.fsync(stream.fileno())
                    os.fsync(claim_fd)
                except OSError:
                    pass
                raise
            finally:
                os.close(claim_fd)
        finally:
            files.close()
