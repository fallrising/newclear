"""Exact staging evidence contracts; observations are trusted-adapter assertions."""
import copy
from datetime import timedelta

from fresh_execution import exact, timestamp
from fresh_rebuild import plan_digest


OPERATION = 'fresh-network-file-staging'
HOST_FIELDS = {'alias', 'node', 'ip', 'machine_id', 'boot_id', 'host_key_sha256'}


def host_index(value):
    if type(value) is not int or not 0 <= value < 4:
        raise ValueError('invalid staging host index')
    return value


def fresh(value, now):
    value = timestamp(value)
    if not value <= now or now - value > timedelta(minutes=15):
        raise ValueError('staging evidence expired or future')
    return value


def authorization(document, action, now):
    exact(document, {'schema_version', 'operation', 'plan_id', 'plan_sha256',
                     'execution_sha256', 'pending_sha256', 'scope', 'owner_confirmed',
                     'authorized_at', 'expires_at'})
    if (type(document['schema_version']) is not int or document['schema_version'] != 1
            or document['operation'] != OPERATION + '-authorization'
            or document['scope'] != 'stage-network-files-only'
            or document['owner_confirmed'] is not True
            or any(document[k] != action[k] for k in
                   ('plan_id', 'plan_sha256', 'execution_sha256', 'pending_sha256'))):
        raise ValueError('staging authorization binding invalid')
    start, end = timestamp(document['authorized_at']), timestamp(document['expires_at'])
    if not start <= now <= end or end - start > timedelta(minutes=15):
        raise ValueError('staging authorization expired or future')


def action(plan, digest, pending, index):
    return {'schema_version': 1, 'operation': OPERATION, 'plan_id': plan['id'],
            'plan_sha256': digest, 'run_id': plan['run_id'],
            'execution_sha256': plan['execution_sha256'], 'pending_sha256': pending['sha256'],
            'host_index': host_index(index), 'host': copy.deepcopy(plan['render']['hosts'][index])}


def observation(value, expected, now, *, intent_sha=None, since=None):
    exact(value, {'observed_at', 'host', 'directory', 'files'})
    observed = fresh(value['observed_at'], now)
    if since is not None and observed < timestamp(since):
        raise ValueError('staging observation predates intent')
    exact(value['host'], HOST_FIELDS)
    if value['host'] != {k: expected['host'][k] for k in HOST_FIELDS}:
        raise ValueError('staging host identity mismatch')
    directory = value['directory']
    exact(directory, {'path', 'kind', 'uid', 'gid', 'mode'})
    if (directory != {'path': '/etc/eru', 'kind': 'directory', 'uid': 0, 'gid': 0, 'mode': '0700'}
            or type(directory['uid']) is not int or type(directory['gid']) is not int):
        raise ValueError('staging directory is unsafe')
    if type(value['files']) is not list or len(value['files']) != 2:
        raise ValueError('staging requires exactly two file observations')
    for actual, planned in zip(value['files'], expected['host']['files']):
        if intent_sha is None:
            exact(actual, {'path', 'kind'})
            if actual != {'path': planned['path'], 'kind': 'absent'}:
                raise ValueError('staging before file is not absent')
        else:
            exact(actual, {'path', 'kind', 'uid', 'gid', 'mode', 'nlink', 'sha256', 'intent_sha256'})
            want = {'path': planned['path'], 'kind': 'regular', 'uid': 0, 'gid': 0,
                    'mode': '0600', 'nlink': 1, 'sha256': planned['sha256'], 'intent_sha256': intent_sha}
            if (actual != want or any(type(actual[k]) is not int for k in ('uid', 'gid', 'nlink'))):
                raise ValueError('staging postcondition or action provenance invalid')
    return observed


def intent_record(expected, authorization_ref, before, predecessor, created, identity):
    return {'schema_version': 1, 'operation': OPERATION + '-intent',
            'action': expected, 'authorization': authorization_ref, 'before': before,
            'predecessor_sha256': predecessor, 'created_at': created, 'private_identity': identity}


def validate_intent(record, expected, authorization_ref, predecessor, identity, now):
    exact(record, {'schema_version', 'operation', 'action', 'authorization', 'before',
                   'predecessor_sha256', 'created_at', 'private_identity'})
    created = fresh(record['created_at'], now)
    observed = observation(record['before'], expected, now)
    if observed > created:
        raise ValueError('staging before observation follows intent')
    rebuilt = intent_record(expected, authorization_ref, record['before'], predecessor,
                            record['created_at'], identity)
    if plan_digest(rebuilt) != plan_digest(record):
        raise ValueError('staging intent is not current derivation')


def validate_receipt(record, intent, digest, now):
    exact(record, {'schema_version', 'operation', 'intent_sha256', 'observation', 'created_at', 'recovered'})
    if (type(record['schema_version']) is not int or record['schema_version'] != 1
            or record['operation'] != OPERATION + '-receipt' or record['intent_sha256'] != digest
            or type(record['recovered']) is not bool):
        raise ValueError('staging receipt binding invalid')
    created = fresh(record['created_at'], now)
    observed = observation(record['observation'], intent['action'], now,
                           intent_sha=digest, since=intent['created_at'])
    if observed > created:
        raise ValueError('staging receipt precedes observation')
