"""Immutable replacement facts; only dedicated local evidence writes are allowed."""
from datetime import datetime, timezone
import hashlib
import os
import subprocess

from fresh_execution import exact, identifier, sha256
from fresh_execution_ops import AREA as EXECUTION_AREA, PrivateFiles
from fresh_observation import HOST_LIMIT, decode
from fresh_observation_ops import SSHReader, _publish
from fresh_rebuild import plan_digest
from fresh_reimage_receipt_ops import inspect_receipts, _pending_matches
from fresh_replacement import script, validate_observation, validate_outputs, validate_request
import pending_generation

AREA = 'private/operations/fresh-rebuild/replacement-observations'
ERRORS = (OSError, ValueError, RuntimeError, KeyError, TypeError, IndexError,
          AttributeError, RecursionError, OverflowError, subprocess.SubprocessError)


def _time(now):
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('replacement time requires timezone')
    return value.astimezone(timezone.utc)


def _summary(observation_id, execution_sha=None):
    result = {'status': 'blocked', 'id': observation_id, 'stage_accepted': False,
              'executable': False, 'remote_mutation_performed': False, 'generation_changed': False}
    if execution_sha is not None:
        result['execution_sha256'] = execution_sha
    return result


def _context(files, run_id, execution_sha, input_file, input_sha, current, source_state, pending):
    if pending_generation.inspect(files.project) != pending:
        raise ValueError('replacement pending changed')
    request, relative, raw_sha = files.json(str(input_file))
    if raw_sha != input_sha:
        raise ValueError('replacement request bytes changed')
    exact(request, {'schema_version', 'run_id', 'execution_sha256', 'receipt_request',
                    'receipt_assessment_sha256', 'hosts'})
    receipt_request = files.binding(request['receipt_request'])
    assessment = inspect_receipts(files.project, run_id, execution_sha,
        request['receipt_request']['path'], now=current, source_state=source_state)
    if assessment['status'] != 'receipts-reviewed' or assessment['sha256'] != request['receipt_assessment_sha256']:
        raise ValueError('replacement receipts assessment failed')
    receipts = []
    for row in receipt_request['hosts']:
        files.binding(row['action'])
        receipts.append(files.binding(row['receipt']))
    envelope, _, _ = files.json(EXECUTION_AREA + '/' + run_id + '/execution.json')
    if envelope['sha256'] != execution_sha or plan_digest(envelope['execution']) != execution_sha:
        raise ValueError('replacement execution changed')
    if not _pending_matches(pending, envelope['execution'], execution_sha, files.identity):
        raise ValueError('replacement pending mismatched')
    validate_request(request, receipts, receipt_request['hosts'], run_id, execution_sha)
    files.recheck()
    if pending_generation.inspect(files.project) != pending:
        raise ValueError('replacement pending changed')
    return request, receipts, {'path': relative, 'sha256': raw_sha}


def _directory_check(files, observation_id, directory, complete=False):
    current = files.directory(files.parts(AREA) + (observation_id,))
    try:
        first, second = os.fstat(directory), os.fstat(current)
        if (first.st_dev, first.st_ino) != (second.st_dev, second.st_ino):
            raise ValueError('replacement observation directory changed')
        if complete and os.listdir(current) != ['observation.json']:
            raise ValueError('replacement observation publication incomplete')
    finally:
        os.close(current)


def collect_replacement_facts(project, run_id, execution_sha, input_file, input_sha,
                              observation_id, *, reader=None, now=None, source_state=None):
    identifier(run_id)
    identifier(observation_id)
    sha256(execution_sha)
    sha256(input_sha)
    base = _summary(observation_id, execution_sha)
    files, directory = None, None
    try:
        started = _time(now)
        pending = pending_generation.inspect(project)
        files = PrivateFiles(project)
        args = (files, run_id, execution_sha, input_file, input_sha)
        request, receipts, ref = _context(*args, started, source_state, pending)
        parent = files.directory(files.parts(AREA), create=True)
        try:
            os.mkdir(observation_id, 0o700, dir_fd=parent)
            directory = files.directory(files.parts(AREA) + (observation_id,))
            os.fsync(parent)
        finally:
            os.close(parent)
        captures = []
        transport = reader if reader is not None else SSHReader()
        source = script()
        for host, receipt in zip(request['hosts'], receipts):
            _context(*args, _time(now), source_state, pending)
            _directory_check(files, observation_id, directory)
            raw = transport(host, source, host['public_key'])
            if type(raw) is not bytes or len(raw) > HOST_LIMIT:
                raise ValueError('replacement transport result invalid or oversized')
            outputs = decode(raw)
            validate_outputs(outputs, receipt, host['public_key'])
            captures.append({**host, 'script_sha256': hashlib.sha256(source.encode()).hexdigest(), 'outputs': outputs})
            _context(*args, _time(now), source_state, pending)
            _directory_check(files, observation_id, directory)
        completed = _time(now)
        _context(*args, completed, source_state, pending)
        record = {'schema_version': 1, 'operation': 'fresh-replacement-observation',
                  'id': observation_id, 'run_id': run_id, 'execution_sha256': execution_sha,
                  'input': ref, 'receipt_assessment_sha256': request['receipt_assessment_sha256'],
                  'private_identity': files.identity, 'observed_at': started.isoformat(),
                  'completed_at': completed.isoformat(), 'captures': captures}
        envelope = {'observation': record, 'sha256': plan_digest(record)}
        validate_observation(envelope, request, receipts, observation_id, completed)
        _directory_check(files, observation_id, directory)
        _publish(files, directory, 'observation.json', envelope)
        final_time = _time(now)
        _context(*args, final_time, source_state, pending)
        validate_observation(envelope, request, receipts, observation_id, _time(now))
        _directory_check(files, observation_id, directory, complete=True)
        return {**base, 'status': 'observed', 'sha256': envelope['sha256'], 'host_count': 4}
    except BaseException as error:
        if directory is not None:
            try:
                fd = os.open('.collection-failed', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
                os.close(fd)
                os.fsync(directory)
            except OSError:
                pass
        if not isinstance(error, ERRORS):
            raise
        return base
    finally:
        if directory is not None:
            os.close(directory)
        if files is not None:
            files.close()


def inspect_replacement_facts(project, observation_id, expected_sha, *, now=None, source_state=None):
    identifier(observation_id)
    sha256(expected_sha)
    base = _summary(observation_id)
    files, directory = None, None
    try:
        current = _time(now)
        pending = pending_generation.inspect(project)
        files = PrivateFiles(project)
        directory = files.directory(files.parts(AREA) + (observation_id,))
        _directory_check(files, observation_id, directory, complete=True)
        envelope, _, _ = files.json(AREA + '/' + observation_id + '/observation.json')
        exact(envelope, {'observation', 'sha256'})
        record = envelope['observation']
        if envelope['sha256'] != expected_sha or plan_digest(record) != expected_sha:
            raise ValueError('replacement observation digest mismatch')
        run_id, execution_sha = identifier(record['run_id']), sha256(record['execution_sha256'])
        base['execution_sha256'] = execution_sha
        if record['private_identity'] != files.identity:
            raise ValueError('replacement observation private root changed')
        files.binding(record['input'])
        args = (files, run_id, execution_sha, record['input']['path'], record['input']['sha256'])
        request, receipts, _ = _context(*args, current, source_state, pending)
        validate_observation(envelope, request, receipts, observation_id, current)
        files.recheck()
        final_time = _time(now)
        _context(*args, final_time, source_state, pending)
        validate_observation(envelope, request, receipts, observation_id, _time(now))
        _directory_check(files, observation_id, directory, complete=True)
        return {**base, 'status': 'observed', 'sha256': expected_sha, 'host_count': 4}
    except ERRORS:
        return base
    finally:
        if directory is not None:
            os.close(directory)
        if files is not None:
            files.close()
