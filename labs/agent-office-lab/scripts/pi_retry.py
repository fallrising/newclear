"""Explicit, serial Pi retry lineage. No scheduler, provider calls or legacy import."""
from contextlib import contextmanager
import hashlib
import json
import os
import secrets

import execution_slot as slots
from office_results import read_json, normalize, MARKER, reject_duplicates

MODES = ('task', 'http_401', 'http_429', 'crash')
SOURCES = ('run_pi_work.py', 'office_pi.mjs', 'deepseek_relay.py', 'pi_retry.py',
           'execution_slot.py', 'process_ownership.py', 'remote_cli.py', 'pi_boundary.mjs', 'pi_office_policy.mjs', 'bin/pi')


def fingerprint(lab):
    digest = hashlib.sha256()
    for name in SOURCES:
        digest.update(name.encode() + b'\0' + (lab / 'scripts' / name).read_bytes() + b'\0')
    return digest.hexdigest()


def valid_id(value):
    return isinstance(value, str) and slots.RETRY_RUN.fullmatch(value) is not None


def receipt(value):
    if (not isinstance(value, dict) or set(value) != {'schema','root','parent','attempt','mode','source_sha256','fixture_sha256'}
            or type(value['schema']) is not int or value['schema'] != 1
            or not valid_id(value['root']) or type(value['attempt']) is not int or not 0 <= value['attempt'] <= 2
            or (value['parent'] is not None and not valid_id(value['parent']))
            or ((value['attempt'] == 0) != (value['parent'] is None))
            or value['mode'] not in MODES or not isinstance(value['source_sha256'], str)
            or any(not isinstance(value[k], str) or len(value[k]) != 64 or any(c not in '0123456789abcdef' for c in value[k]) for k in ('source_sha256','fixture_sha256'))):
        raise slots.SlotError('invalid_retry_receipt')
    return value


@contextmanager
def run_directory(lab, run_id):
    if not valid_id(run_id): raise slots.SlotError('invalid_retry_run_id')
    fd = os.open(lab, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in ('runs', run_id):
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise slots.SlotError('unsafe_retry_directory')
        yield fd
    finally:
        os.close(fd)


def read_private(fd, name):
    child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    with os.fdopen(child, 'rb') as stream:
        if slots._private_file(stream.fileno()).st_size > 4096: raise slots.SlotError('invalid_retry_file')
        value = json.loads(stream.read(4097), object_pairs_hook=reject_duplicates)
    if not isinstance(value, dict): raise slots.SlotError('invalid_retry_file')
    return value


def write(fd, name, value, replace=False):
    temp = '.retry-' + secrets.token_hex(12)
    child = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        with os.fdopen(child, 'w') as stream:
            json.dump(value, stream); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        if replace:
            os.replace(temp, name, src_dir_fd=fd, dst_dir_fd=fd)
        else:
            os.link(temp, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
        os.fsync(fd)
    finally:
        try: os.unlink(temp, dir_fd=fd)
        except FileNotFoundError: pass


def history(lab, run_id):
    with run_directory(lab, run_id) as fd:
        meta = receipt(read_private(fd, 'attempt.json'))
    with run_directory(lab, meta['root']) as root:
        ledger = read_private(root, 'attempts.json')
    if (set(ledger) != {'schema','runs'} or type(ledger['schema']) is not int or ledger['schema'] != 1
            or not isinstance(ledger['runs'], list) or not 1 <= len(ledger['runs']) <= 3
            or not all(valid_id(x) for x in ledger['runs']) or len(set(ledger['runs'])) != len(ledger['runs'])
            or ledger['runs'][0] != meta['root'] or meta['attempt'] >= len(ledger['runs'])
            or ledger['runs'][meta['attempt']] != run_id):
        raise slots.SlotError('invalid_retry_history')
    for index, name in enumerate(ledger['runs']):
        with run_directory(lab, name) as fd:
            saved = receipt(read_private(fd, 'attempt.json'))
        expected = dict(meta, attempt=index, parent=ledger['runs'][index-1] if index else None)
        if saved != expected: raise slots.SlotError('inconsistent_retry_history')
    return meta, ledger


def inspect(lab, run_id):
    """Read-only eligibility; execution rechecks this while holding the shared slot."""
    try:
        meta, ledger = history(lab, run_id)
        if ledger['runs'][-1] != run_id: raise slots.SlotError('retry_requires_latest_attempt')
        if meta['attempt'] >= 2: raise slots.SlotError('retry_limit_reached')
        if meta['source_sha256'] != fingerprint(lab): raise slots.SlotError('retry_source_changed')
        with run_directory(lab, run_id) as fd:
            report, _ = read_json(fd, ('result.json',), 2 * 1024 * 1024)
            row = normalize(fd, run_id)
        if (row['provider'] != 'pi' or row['status'] != 'failed' or not row['cleanup_verified']
                or report.get('startup_only') is not False or type(report.get('remaining_owned_processes')) is not int
                or report['remaining_owned_processes'] != 0):
            raise slots.SlotError('retry_requires_clean_failed_run')
        actual_mode = ('crash' if 'crash_injection' in report else
                       'http_' + str(report['fault_injection'].get('http_status')) if 'fault_injection' in report else 'task')
        if actual_mode != meta['mode']: raise slots.SlotError('retry_mode_mismatch')
        with run_directory(lab, meta['root']) as fd:
            fixture, _ = read_json(fd, ('workspace','input.json'), 4096)
        if (set(fixture) != {'marker','values'} or not isinstance(fixture['marker'], str)
                or not MARKER.fullmatch(fixture['marker']) or not isinstance(fixture['values'], list)
                or not 1 <= len(fixture['values']) <= 100
                or any(type(v) is not int or abs(v) > 10**9 for v in fixture['values'])):
            raise slots.SlotError('invalid_retry_fixture')
        if fixture_hash(fixture) != meta['fixture_sha256']: raise slots.SlotError('retry_fixture_changed')
        return meta, ledger, fixture
    except slots.SlotError:
        raise
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, RecursionError):
        raise slots.SlotError('retry_history_unavailable_or_invalid') from None


def fixture_hash(fixture):
    return hashlib.sha256(json.dumps(fixture, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def register(lab, out, mode, fixture):
    """Reserve a fresh attempt before native startup. An incomplete reservation cannot be retried."""
    parent = slots.retry_parent(lab)
    if mode not in MODES or out.parent != lab / 'runs': raise slots.SlotError('invalid_retry_mode_or_run')
    if parent:
        meta, ledger, fixture = inspect(lab, parent)
        if meta['mode'] != mode: raise slots.SlotError('retry_mode_mismatch')
        meta = dict(meta, attempt=meta['attempt']+1, parent=parent)
        ledger = dict(ledger, runs=[*ledger['runs'], out.name])
    else:
        meta = {'schema':1,'root':out.name,'parent':None,'attempt':0,'mode':mode,'source_sha256':fingerprint(lab),'fixture_sha256':fixture_hash(fixture)}
        ledger = {'schema':1,'runs':[out.name]}
    with run_directory(lab, out.name) as fd:
        write(fd, 'attempt.json', receipt(meta))
    with run_directory(lab, meta['root']) as fd:
        write(fd, 'attempts.json', ledger, replace=parent is not None)
    return meta, fixture
