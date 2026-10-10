"""Strict contracts for fresh-only, per-action replay journals.

An accepted historical receipt never grants current writer authority. Raw host
observations are parsed by the fixed helper, then checked against this plan.
"""
import copy
from datetime import timedelta

from fresh_execution import exact, identifier, sha256, timestamp
from fresh_rebuild import plan_digest

OPERATION = 'fresh-replay'
BINDING = {'plan_id', 'plan_sha256', 'execution_sha256', 'pending_sha256',
           'replay_sha256', 'step_index'}
HOST_FIELDS = {'machine_id', 'boot_id', 'host_key_sha256'}
READONLY = frozenset(('child-plan', 'app-ready', 'canary-get', 'bridge-http', 'canary-logs',
                     'host-http', 'apps-accept', 'quota-accept', 'resources-accept', 'residue-accept'))


def steps(desired):
    from app_desired import validate_spec
    if type(desired) is not list or not desired:
        raise ValueError('requires reviewed desired apps')
    result = []
    names = set()
    for index, document in enumerate(desired):
        spec = validate_spec(document)
        if spec['name'] in names:
            raise ValueError('duplicate desired app')
        names.add(spec['name'])
        for name in ('child-plan', 'app-cache', 'app-deploy', 'app-ready'):
            result.append({'step': name, 'app_index': index, 'node': spec['node'], 'canary': False})
    for node in ('worker-2', 'worker-3', 'worker-4'):
        for name in ('canary-cache', 'bridge-deploy', 'canary-get', 'bridge-http', 'canary-exec',
                     'canary-logs', 'canary-stop', 'canary-start', 'bridge-http', 'bridge-remove',
                     'host-deploy', 'host-http', 'host-remove'):
            result.append({'step': name, 'app_index': None, 'node': node, 'canary': True})
    result.append({'step': 'apps-accept', 'app_index': None, 'node': None, 'canary': False})
    for node in ('worker-2', 'worker-3', 'worker-4'):
        for name in ('memory-reject', 'storage-reject', 'quota-accept'):
            result.append({'step': name, 'app_index': None, 'node': node, 'canary': True})
    for name in ('resources-accept', 'residue-accept'):
        result.append({'step': name, 'app_index': None, 'node': None, 'canary': False})
    return result


def step_index(value, schedule):
    if type(value) is not int or not 0 <= value < len(schedule):
        raise ValueError('invalid replay step index')
    return value


def stage(index, schedule):
    name = schedule[step_index(index, schedule)]['step']
    if name == 'residue-accept':
        return 'residue-audited'
    if name in ('memory-reject', 'storage-reject', 'quota-accept', 'resources-accept'):
        return 'resources-accepted'
    return 'apps-replayed'


def expected_services(index=None, *, after=False):
    return [{'etcd.service': 'active' if i == 0 else 'stopped',
             'eru-core.service': 'active' if i == 0 else 'stopped',
             'eru-agent.service': 'stopped' if i == 0 else 'active'} for i in range(4)]


def authorization(document, expected, now):
    exact(document, BINDING | {'schema_version', 'operation', 'scope', 'owner_confirmed',
                               'authorized_at', 'expires_at'})
    if (type(document['schema_version']) is not int or document['schema_version'] != 1
            or document['operation'] != OPERATION + '-authorization'
            or document['scope'] != 'fresh-replay-one-step-only' or document['owner_confirmed'] is not True
            or any(plan_digest(document[k]) != plan_digest(expected[k]) for k in BINDING)):
        raise ValueError('replay authorization differs')
    identifier(document['plan_id'])
    for key in BINDING - {'step_index', 'plan_id'}:
        sha256(document[key])
    start, end = timestamp(document['authorized_at']), timestamp(document['expires_at'])
    if not start <= now < end or not timedelta(0) < end-start <= timedelta(minutes=15):
        raise ValueError('replay authorization expired or future')


def action(plan, digest, index):
    descriptor = plan['steps'][step_index(index, plan['steps'])]
    return {'schema_version': 1, 'operation': OPERATION + '-action',
            **{k: plan[k] for k in ('plan_id', 'plan_sha256', 'run_id', 'execution_sha256',
                                   'pending_sha256', 'bootstrap_sha256')},
            'replay_sha256': sha256(digest), 'step_index': index, **copy.deepcopy(descriptor),
            'host_index': 0, 'host': copy.deepcopy(plan['network_render']['hosts'][0]),
            'render': copy.deepcopy(plan['render']), 'desired_apps': copy.deepcopy(plan['desired_apps']),
            'canary_image': plan['canary_image'], 'bootstrap_facts': copy.deepcopy(plan['bootstrap_facts'])}


def validate_action(value):
    exact(value, BINDING | {'schema_version', 'operation', 'run_id', 'bootstrap_sha256', 'step', 'app_index', 'node',
                           'canary', 'host_index', 'host', 'render', 'desired_apps', 'canary_image', 'bootstrap_facts'})
    schedule = steps(value['desired_apps'])
    index = step_index(value['step_index'], schedule)
    if (type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['operation'] != OPERATION + '-action' or value['host_index'] != 0
            or type(value['host_index']) is not int
            or any(plan_digest(value[k]) != plan_digest(v) for k, v in schedule[index].items())):
        raise ValueError('replay action differs from fixed step')
    identifier(value['run_id']); identifier(value['plan_id'])
    for key in BINDING - {'step_index', 'plan_id'}:
        sha256(value[key])


def fresh(value, now):
    observed = timestamp(value)
    if not timedelta(0) <= now-observed <= timedelta(minutes=15):
        raise ValueError('replay observation expired or future')
    return observed


def observation(value, expected, now, *, intent_sha=None, since=None, before=False):
    validate_action(expected)
    exact(value, {'schema_version', 'action_sha256', 'observed_at', 'host', 'state',
                  'provenance', 'evidence'})
    if (type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['action_sha256'] != plan_digest(expected)
            or value['host'] != {k: expected['host'][k] for k in HOST_FIELDS}):
        raise ValueError('replay observation binding differs')
    observed = fresh(value['observed_at'], now)
    for capture in value['evidence']['captures']:
        start = fresh(capture['started_at'], now)
        completed = fresh(capture['completed_at'], now)
        if not start <= completed <= observed:
            raise ValueError('replay raw capture chronology differs')
    if since is not None and observed < timestamp(since):
        raise ValueError('replay observation predates intent')
    readonly = expected['step'] in READONLY
    wanted = 'complete' if readonly or not before else 'absent'
    if value['state'] != wanted:
        raise ValueError('replay state unknown or differs')
    provenance = value['provenance']
    if before or readonly:
        if provenance is not None:
            raise ValueError('before/readonly observation has writer provenance')
    else:
        exact(provenance, {'intent_sha256', 'action_sha256', 'started_at', 'completed_at'})
        if (provenance['intent_sha256'] != intent_sha or provenance['action_sha256'] != plan_digest(expected)
                or since is None or not timestamp(since) <= timestamp(provenance['started_at'])
                <= timestamp(provenance['completed_at']) <= observed):
            raise ValueError('replay writer provenance differs')
    from fresh_replay_host import validate_evidence
    return validate_evidence(expected, value, before=before)


def intent_record(expected, authref, before, predecessor, created, identity, network, predecessor_refs):
    return {'schema_version': 1, 'operation': OPERATION + '-intent', 'action': expected,
            'authorization': authref, 'before': before, 'predecessor_sha256': predecessor,
            'created_at': created, 'private_identity': identity, 'network': network,
            'predecessor_refs': predecessor_refs}


def validate_intent(record, expected, authref, predecessor, identity, now, predecessor_refs):
    exact(record, {'schema_version', 'operation', 'action', 'authorization', 'before',
                   'predecessor_sha256', 'created_at', 'private_identity', 'network', 'predecessor_refs'})
    created = fresh(record['created_at'], now)
    observation(record['before'], expected, now, before=True)
    if (timestamp(record['before']['observed_at']) > created
            or timestamp(record['network']['observed_at']) > timestamp(record['before']['observed_at'])):
        raise ValueError('replay intent precedes observation')
    if plan_digest(record) != plan_digest(intent_record(expected, authref, record['before'],
                                        predecessor, record['created_at'], identity, record['network'], predecessor_refs)):
        raise ValueError('replay intent differs from derivation')


def validate_receipt(record, intent, digest, now):
    exact(record, {'schema_version', 'operation', 'intent_sha256', 'observation', 'created_at',
                   'recovered', 'network', 'timing', 'intent_ref'})
    if (type(record['schema_version']) is not int or record['schema_version'] != 1
            or record['operation'] != OPERATION + '-receipt' or record['intent_sha256'] != digest
            or type(record['recovered']) is not bool):
        raise ValueError('replay receipt binding differs')
    created = fresh(record['created_at'], now)
    result = observation(record['observation'], intent['action'], now, intent_sha=digest,
                         since=intent['created_at'])
    if timestamp(record['observation']['observed_at']) > created:
        raise ValueError('replay receipt predates observation')
    return result
