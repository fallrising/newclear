"""Immutable local network-access plans; never dispatch or accept a stage."""
from datetime import datetime, timedelta, timezone
import os
import fresh_run_authority as authority

from fresh_execution import exact, identifier, sha256, timestamp
from fresh_execution_ops import PrivateFiles
from fresh_network_access import render
from fresh_network_admission import STAGE, validate
from fresh_network_admission_ops import _load, _pending, _Publications
from fresh_observation_ops import _publish
from fresh_rebuild import plan_digest
from fresh_reimage_receipts import validate_receipts
from fresh_replacement import validate_observation
from fresh_replacement_ops import ERRORS
import pending_generation

AREA = 'private/operations/fresh-rebuild/network-access-plans'


def _time(now):
    value = now() if callable(now) else now
    value = value or datetime.now(timezone.utc)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('network access time requires timezone')
    return value.astimezone(timezone.utc)


def _summary(plan_id, execution_sha=None):
    result = {'status': 'blocked', 'id': plan_id, 'stage': STAGE,
              'stage_accepted': False, 'executable': False, 'remote_mutation_performed': False,
              'generation_changed': False, 'external_fence_verified': False}
    if execution_sha is not None:
        result['execution_sha256'] = execution_sha
    return result


def _context(files, publications, run_id, execution_sha, input_file, input_sha,
             pending, current, source_state, historical_at=None):
    document, path, digest = files.json(str(input_file))
    if digest != input_sha:
        raise ValueError('network access request bytes changed')
    exact(document, {'schema_version', 'binding', 'admission_request', 'admission_sha256',
                     'controller_ip', 'private_interface', 'core_client_key'})
    files.binding(document['admission_request'])
    ref = document['admission_request']
    values = _load(files, publications, run_id, execution_sha, ref['path'], ref['sha256'],
                   pending, current, source_state, historical_at=historical_at)
    admission, _, _, _, _, _, _, replacement_request, receipts, admission_ref, _, _, _ = values
    assessment = {'schema_version': 1, 'operation': 'fresh-network-prerequisites-assessment',
                  'input': admission_ref, 'request': admission}
    if plan_digest(assessment) != document['admission_sha256']:
        raise ValueError('network access admission assessment changed')
    key = files.binding(document['core_client_key'])
    rendered = render(document, admission, replacement_request, receipts, key)
    files.recheck()
    _pending(files, pending, values[4], execution_sha)
    publications.check()
    return document, {'path': path, 'sha256': digest}, rendered, values


def _record(files, document, ref, rendered, plan_id, run_id, execution_sha, created):
    return {'schema_version': 1, 'operation': 'fresh-network-access-plan', 'id': plan_id,
            'run_id': run_id, 'execution_sha256': execution_sha, 'created_at': created,
            'binding': document['binding'], 'input': ref, 'admission_sha256': document['admission_sha256'],
            'private_identity': files.identity, 'render': rendered}


def _fresh(record, values, pending, current):
    validation_time = current
    if authority.active() is not None:
        authority.active().scope(record)
        authority.check_current()
        validation_time = authority.event_time(record['created_at'], current)
    created = timestamp(record['created_at'])
    if not created <= validation_time or validation_time - created > timedelta(minutes=15):
        raise ValueError('network access plan is future or expired')
    (document, authorization, fence, isolation, execution, baseline, replacement,
     request, receipts, _, plan, receipt_request, actions) = values
    # This clock check runs after the final filesystem and publication checks.
    validate(document, authorization, fence, isolation, execution=execution,
             execution_sha=record['execution_sha256'], pending_sha=pending['sha256'],
             replacement=replacement['observation'], baseline=baseline, now=validation_time)
    validate_observation(replacement, request, receipts, replacement['observation']['id'],
                         authority.event_time(replacement['observation']['completed_at'], validation_time))
    validate_receipts(receipt_request, actions, receipts, plan=plan,
                      execution={'execution': execution, 'sha256': record['execution_sha256']},
                      baseline=baseline, now=validation_time)


def _success(base, digest):
    return {**base, 'status': 'planned', 'sha256': digest, 'host_count': 4, 'file_count': 8}


@authority.operation
def prepare_network_access(project, run_id, execution_sha, input_file, input_sha, plan_id,
                           *, now=None, source_state=None):
    identifier(run_id)
    identifier(plan_id)
    sha256(execution_sha)
    sha256(input_sha)
    base = _summary(plan_id, execution_sha)
    files, publications, directory = None, None, None
    try:
        current = _time(now)
        pending = pending_generation.inspect(project)
        if pending['status'] != 'pending':
            return base
        files = PrivateFiles(project)
        publications = _Publications(files)
        args = (files, publications, run_id, execution_sha, input_file, input_sha, pending)
        document, ref, rendered, values = _context(*args, current, source_state)
        parent = files.directory(files.parts(AREA), create=True)
        try:
            os.mkdir(plan_id, 0o700, dir_fd=parent)
            directory = files.directory(files.parts(AREA) + (plan_id,))
            os.fsync(parent)
        finally:
            os.close(parent)
        path = AREA + '/' + plan_id + '/plan.json'
        publications.pin(path, [])
        document, ref, rendered, values = _context(*args, _time(now), source_state)
        record = _record(files, document, ref, rendered, plan_id, run_id, execution_sha, current.isoformat())
        _fresh(record, values, pending, _time(now))
        envelope = {'plan': record, 'sha256': plan_digest(record)}
        published_sha = _publish(files, directory, 'plan.json', envelope)
        # Switch the pinned claim to its only valid completed form; the original
        # descriptor remains pinned, so replacing the directory never succeeds.
        parts = files.parts(path)[:-1]
        pinned, _ = publications.directories[parts]
        publications.directories[parts] = (pinned, ['plan.json'])
        document, ref, rendered, values = _context(*args, _time(now), source_state)
        if plan_digest(_record(files, document, ref, rendered, plan_id, run_id, execution_sha,
                               record['created_at'])) != envelope['sha256']:
            raise ValueError('network access plan derivation changed')
        stored = files.binding({'path': path, 'sha256': published_sha})
        if plan_digest(stored) != plan_digest(envelope):
            raise ValueError('network access published bytes changed')
        files.recheck()
        _pending(files, pending, values[4], execution_sha)
        publications.check()
        _fresh(record, values, pending, _time(now))
        return _success(base, envelope['sha256'])
    except BaseException as error:
        if directory is not None:
            try:
                fd = os.open('.planning-failed', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
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
        if publications is not None:
            publications.close()
        if files is not None:
            files.close()


@authority.operation
def inspect_network_access(project, plan_id, expected_sha, *, now=None, source_state=None):
    identifier(plan_id)
    sha256(expected_sha)
    base = _summary(plan_id)
    files, publications = None, None
    try:
        current = _time(now)
        pending = pending_generation.inspect(project)
        if pending['status'] != 'pending':
            return base
        files = PrivateFiles(project)
        publications = _Publications(files)
        path = AREA + '/' + plan_id + '/plan.json'
        publications.pin(path, ['plan.json'])
        envelope, _, _ = files.json(path)
        exact(envelope, {'plan', 'sha256'})
        record = envelope['plan']
        if envelope['sha256'] != expected_sha or plan_digest(record) != expected_sha:
            raise ValueError('network access plan digest mismatch')
        run_id, execution_sha = identifier(record['run_id']), sha256(record['execution_sha256'])
        base['execution_sha256'] = execution_sha
        files.binding(record['input'])
        args = (files, publications, run_id, execution_sha, record['input']['path'],
                record['input']['sha256'], pending)
        _context(*args, current, source_state, historical_at=record['created_at'])
        document, ref, rendered, values = _context(*args, _time(now), source_state, historical_at=record['created_at'])
        rebuilt = _record(files, document, ref, rendered, plan_id, run_id, execution_sha, record['created_at'])
        if plan_digest(rebuilt) != expected_sha:
            raise ValueError('network access plan is not the current deterministic derivation')
        files.recheck()
        _pending(files, pending, values[4], execution_sha)
        publications.check()
        _fresh(record, values, pending, _time(now))
        return _success(base, expected_sha)
    except ERRORS:
        return base
    finally:
        if publications is not None:
            publications.close()
        if files is not None:
            files.close()
