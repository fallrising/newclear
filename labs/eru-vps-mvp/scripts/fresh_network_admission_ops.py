"""Read-only current stage prerequisite review; no admission or mutation capability."""
from datetime import datetime, timezone
import os
import fresh_run_authority as authority

from fresh_execution import exact, identifier, sha256, timestamp
from fresh_execution_ops import AREA as EXECUTION_AREA, PrivateFiles, _record, _review
from fresh_network_admission import STAGE, validate
from fresh_rebuild import plan_digest
from fresh_reimage_receipt_ops import _pending_matches
from fresh_reimage_receipts import validate_receipts
from fresh_replacement import validate_observation
from fresh_replacement_ops import (AREA as REPLACEMENT_AREA, ERRORS, _context,
                                   inspect_replacement_facts)
import pending_generation


def _time(now):
    value = now() if callable(now) else now
    value = value or datetime.now(timezone.utc)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('network prerequisite time requires timezone')
    return value.astimezone(timezone.utc)


def _pending(files, expected, execution, execution_sha):
    current = pending_generation.inspect(files.project)
    if (current['status'] != 'pending' or current != expected
            or not _pending_matches(current, execution, execution_sha, files.identity)):
        raise ValueError('network prerequisites require unchanged exact pending reservation')


class _Publications:
    """Pin immutable publication directories across the complete inspection."""
    def __init__(self, files):
        self.files, self.directories = files, {}

    def pin(self, path, names):
        parts = self.files.parts(path)[:-1]
        if parts not in self.directories:
            self.directories[parts] = (self.files.directory(parts), sorted(names))
        self.check()

    def check(self):
        for parts, (pinned, names) in self.directories.items():
            current = self.files.directory(parts)
            try:
                first, second = os.fstat(pinned), os.fstat(current)
                if ((first.st_dev, first.st_ino) != (second.st_dev, second.st_ino)
                        or sorted(os.listdir(current)) != names):
                    raise ValueError('network prerequisite publication changed or incomplete')
            finally:
                os.close(current)
        self.files.check()

    def close(self):
        for directory, _ in self.directories.values():
            os.close(directory)


def _load(files, publications, run_id, execution_sha, input_file, input_sha, pending, now, source_state, historical_at=None):
    document, path, digest = files.json(str(input_file))
    if digest != input_sha:
        raise ValueError('network prerequisite request bytes changed')
    exact(document, {'schema_version', 'binding', 'replacement_observation',
                     'owner_authorization', 'writer_fence'})
    execution_path = EXECUTION_AREA + '/' + run_id + '/execution.json'
    publications.pin(execution_path, ['execution.json'])
    envelope, _, _ = files.json(execution_path)
    exact(envelope, {'execution', 'sha256'})
    execution = envelope['execution']
    if envelope['sha256'] != execution_sha or plan_digest(execution) != execution_sha:
        raise ValueError('network prerequisite execution changed')
    _pending(files, pending, execution, execution_sha)
    # Pin the original evidence and current source in this reader as well as the
    # independent replacement inspector. Historical preparation keeps its age.
    baseline = files.binding(execution['evidence']['host_baseline'])
    publications.pin(baseline['observation']['path'], ['host-baseline.json', 'observation.json'])
    created = timestamp(execution['created_at'])
    plan, source = _review(files, execution['binding']['plan_id'],
                           execution['binding']['review_sha256'], created, source_state)
    rebuilt = _record(files, plan, execution['binding']['review_sha256'], run_id,
                      execution['input']['path'], created, source)
    rebuilt['created_at'] = execution['created_at']
    if plan_digest(rebuilt) != execution_sha:
        raise ValueError('network prerequisite original preparation changed')
    publications.pin(document['replacement_observation']['path'], ['observation.json'])
    replacement = files.binding(document['replacement_observation'])
    exact(replacement, {'observation', 'sha256'})
    observation = replacement['observation']
    observation_id = identifier(observation['id'])
    if (document['replacement_observation']['path'] != REPLACEMENT_AREA + '/' + observation_id + '/observation.json'
            or observation['run_id'] != run_id or observation['execution_sha256'] != execution_sha):
        raise ValueError('network prerequisite replacement scope changed')
    replacement_time = authority.event_time(observation['completed_at'], now)
    if authority.active() is not None and authority.active().binding['plan_id'] is None:
        replacement_time = now
    reviewed = inspect_replacement_facts(files.project, observation_id, replacement['sha256'],
                                         now=replacement_time, source_state=source_state)
    if reviewed['status'] != 'observed' or reviewed['execution_sha256'] != execution_sha:
        raise ValueError('network prerequisite replacement assessment blocked')
    # Keep all replacement and receipt raw references pinned in the outer reader.
    request, receipts, _ = _context(files, run_id, execution_sha, observation['input']['path'],
        observation['input']['sha256'], replacement_time, source_state, pending)
    receipt_request = files.binding(request['receipt_request'])
    actions = [files.binding(row['action']) for row in receipt_request['hosts']]
    authorization = files.binding(document['owner_authorization'])
    fence = files.binding(document['writer_fence'])
    files.binding(fence['prior_fence'])
    isolation = files.binding(fence['isolation'])
    validate(document, authorization, fence, isolation, execution=execution,
             execution_sha=execution_sha, pending_sha=pending['sha256'], replacement=observation,
             baseline=baseline, now=(authority.event_time(historical_at, now)
                                     if historical_at is not None else now))
    for host in isolation['old_hosts']:
        ref = host['proof']
        raw, relative, digest = files.read(ref['path'])
        if not raw or relative != ref['path'] or digest != ref['sha256']:
            raise ValueError('network prerequisite isolation proof bytes invalid')
    files.recheck()
    _pending(files, pending, execution, execution_sha)
    publications.check()
    return (document, authorization, fence, isolation, execution, baseline, replacement,
            request, receipts, {'path': path, 'sha256': input_sha}, plan, receipt_request, actions)


def inspect_network_admission(project, run_id, execution_sha, input_file, input_sha,
                              *, now=None, source_state=None):
    """Check current prerequisites offline without granting stage acceptance."""
    identifier(run_id)
    sha256(execution_sha)
    sha256(input_sha)
    base = {'status': 'blocked', 'id': run_id, 'execution_sha256': execution_sha,
            'stage': STAGE, 'stage_accepted': False, 'executable': False,
            'remote_mutation_performed': False, 'generation_changed': False,
            'external_fence_verified': False}
    files, publications = None, None
    try:
        pending = pending_generation.inspect(project)
        if pending['status'] != 'pending':
            return base
        files = PrivateFiles(project)
        publications = _Publications(files)
        args = (files, publications, run_id, execution_sha, input_file, input_sha, pending)
        _load(*args, _time(now), source_state)
        values = _load(*args, _time(now), source_state)
        (document, authorization, fence, isolation, execution, baseline, replacement,
         request, receipts, ref, plan, receipt_request, actions) = values
        files.recheck()
        _pending(files, pending, execution, execution_sha)
        publications.check()
        files.check()
        final_time = _time(now)
        validate(document, authorization, fence, isolation, execution=execution,
                 execution_sha=execution_sha, pending_sha=pending['sha256'],
                 replacement=replacement['observation'], baseline=baseline, now=final_time)
        validate_observation(replacement, request, receipts, replacement['observation']['id'], final_time)
        validate_receipts(receipt_request, actions, receipts, plan=plan,
                          execution={'execution': execution, 'sha256': execution_sha},
                          baseline=baseline, now=final_time)
        assessment = {'schema_version': 1, 'operation': 'fresh-network-prerequisites-assessment',
                      'input': ref, 'request': document}
        return {**base, 'status': 'prerequisites-reviewed', 'sha256': plan_digest(assessment), 'host_count': 4}
    except ERRORS:
        return base
    finally:
        if publications is not None:
            publications.close()
        if files is not None:
            files.close()
