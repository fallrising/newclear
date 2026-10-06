"""Strict contracts for fresh-only, per-action bootstrap journals.

An accepted historical receipt never grants current writer authority. Raw host
observations are parsed by the fixed helper, then checked against this plan.
"""
import copy
from datetime import timedelta

from fresh_execution import exact, identifier, sha256, timestamp
from fresh_rebuild import plan_digest

OPERATION = 'fresh-bootstrap'
STEPS = (('etcd-install', 0, None), ('etcd-start', 0, None),
         ('empty-accept', 0, None), ('core-install', 0, None),
         ('core-start', 0, None), ('pod-create', 0, None)) + tuple(
    (step, worker if step in ('worker-install', 'worker-proxy-start', 'worker-agent-start') else 0, worker)
    for worker in range(1, 4)
    for step in ('worker-install', 'worker-proxy-start', 'worker-register', 'worker-agent-start', 'worker-up')
) + (('cluster-accept', 0, None),)
ACCEPTANCE = frozenset((2, 21))
BINDING = {'plan_id', 'plan_sha256', 'execution_sha256', 'pending_sha256',
           'bootstrap_sha256', 'step_index'}
HOST_FIELDS = {'machine_id', 'boot_id', 'host_key_sha256'}


def step_index(value):
    if type(value) is not int or not 0 <= value < len(STEPS):
        raise ValueError('invalid bootstrap step index')
    return value


def stage(index):
    return 'empty-control-plane' if step_index(index) <= 2 else 'cluster-bootstrapped'


def expected_services(index, *, after=False):
    """Derive service phase solely from the fixed completed prefix."""
    index = step_index(index)
    rows = [{unit: 'stopped' for unit in ('etcd.service', 'eru-core.service', 'eru-agent.service')}
            for _ in range(4)]
    for name, host, _ in STEPS[:index + int(after)]:
        unit = {'etcd-start': 'etcd.service', 'core-start': 'eru-core.service',
                'worker-agent-start': 'eru-agent.service'}.get(name)
        if unit:
            rows[host][unit] = 'active'
    return rows


def authorization(document, expected, now):
    exact(document, BINDING | {'schema_version', 'operation', 'scope', 'owner_confirmed',
                               'authorized_at', 'expires_at'})
    if (type(document['schema_version']) is not int or document['schema_version'] != 1
            or document['operation'] != OPERATION + '-authorization'
            or document['scope'] != 'fresh-bootstrap-one-step-only'
            or document['owner_confirmed'] is not True
            or any(plan_digest(document[k]) != plan_digest(expected[k]) for k in BINDING)):
        raise ValueError('bootstrap authorization differs')
    step_index(document['step_index'])
    identifier(document['plan_id'])
    for key in BINDING - {'step_index', 'plan_id'}:
        sha256(document[key])
    start, end = timestamp(document['authorized_at']), timestamp(document['expires_at'])
    if not start <= now < end or not timedelta(0) < end-start <= timedelta(minutes=15):
        raise ValueError('bootstrap authorization expired or future')


def validate_request(document, network, digest, pending, network_receipt):
    exact(document, {'schema_version', 'operation', 'run_id', 'execution_sha256', 'pending_sha256',
                     'plan_id', 'plan_sha256', 'network_receipt_sha256', 'token_file',
                     'safe_core_binary', 'artifact_lock_sha256', 'capacities', 'prior_baseline'})
    if (type(document['schema_version']) is not int or document['schema_version'] != 1
            or document['operation'] != OPERATION + '-request'
            or document['run_id'] != network['run_id']
            or document['execution_sha256'] != network['execution_sha256']
            or document['pending_sha256'] != pending['sha256']
            or document['plan_id'] != network['id'] or document['plan_sha256'] != digest
            or document['network_receipt_sha256'] != network_receipt):
        raise ValueError('bootstrap request binding differs')
    for key in ('token_file', 'safe_core_binary', 'prior_baseline'):
        exact(document[key], {'path', 'sha256'})
        sha256(document[key]['sha256'])
    sha256(document['artifact_lock_sha256'])
    if type(document['capacities']) is not list or len(document['capacities']) != 3:
        raise ValueError('bootstrap requires exactly three reviewed capacities')


def action(plan, digest, index):
    index = step_index(index)
    name, host, worker = STEPS[index]
    return {'schema_version': 1, 'operation': OPERATION + '-action',
            **{k: plan[k] for k in ('plan_id', 'plan_sha256', 'run_id', 'execution_sha256', 'pending_sha256')},
            'bootstrap_sha256': sha256(digest), 'step_index': index, 'step': name,
            'host_index': host, 'host': copy.deepcopy(plan['network_render']['hosts'][host]),
            'worker_index': worker, 'render': copy.deepcopy(plan['render'])}


def validate_action(value):
    exact(value, BINDING | {'schema_version', 'operation', 'run_id', 'step', 'host_index',
                           'host', 'worker_index', 'render'})
    index = step_index(value['step_index'])
    if (type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['operation'] != OPERATION + '-action'
            or (value['step'], value['host_index'], value['worker_index']) != STEPS[index]
            or type(value['host_index']) is not int
            or value['worker_index'] is not None and type(value['worker_index']) is not int):
        raise ValueError('bootstrap action differs from fixed step')
    identifier(value['run_id'])
    identifier(value['plan_id'])
    for key in BINDING - {'step_index', 'plan_id'}:
        sha256(value[key])


def fresh(value, now):
    observed = timestamp(value)
    if not timedelta(0) <= now-observed <= timedelta(minutes=15):
        raise ValueError('bootstrap observation expired or future')
    return observed


def observation(value, expected, now, *, intent_sha=None, since=None, before=False):
    validate_action(expected)
    exact(value, {'schema_version', 'action_sha256', 'observed_at', 'host', 'state',
                  'provenance', 'evidence'})
    if (type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['action_sha256'] != plan_digest(expected)
            or value['host'] != {k: expected['host'][k] for k in HOST_FIELDS}):
        raise ValueError('bootstrap observation binding differs')
    observed = fresh(value['observed_at'], now)
    if since is not None and observed < timestamp(since):
        raise ValueError('bootstrap observation predates intent')
    readonly = expected['step_index'] in ACCEPTANCE
    wanted = 'complete' if readonly or not before else 'absent'
    if value['state'] != wanted:
        raise ValueError('bootstrap state is unknown or differs')
    provenance = value['provenance']
    if before or readonly:
        if provenance is not None:
            raise ValueError('bootstrap before/readonly observation has writer provenance')
    else:
        exact(provenance, {'intent_sha256', 'action_sha256', 'started_at', 'completed_at'})
        if (provenance['intent_sha256'] != intent_sha
                or provenance['action_sha256'] != plan_digest(expected)
                or since is None or not timestamp(since) <= timestamp(provenance['started_at'])
                <= timestamp(provenance['completed_at']) <= observed):
            raise ValueError('bootstrap writer provenance differs')
    exact(value['evidence'], {'files', 'commands', 'services'})
    from fresh_bootstrap_host import validate_evidence
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
        raise ValueError('bootstrap intent precedes observation')
    if plan_digest(record) != plan_digest(intent_record(expected, authref, record['before'],
                                        predecessor, record['created_at'], identity, record['network'], predecessor_refs)):
        raise ValueError('bootstrap intent differs from derivation')


def validate_receipt(record, intent, digest, now):
    exact(record, {'schema_version', 'operation', 'intent_sha256', 'observation', 'created_at',
                   'recovered', 'network', 'agents', 'timing', 'intent_ref'})
    if (type(record['schema_version']) is not int or record['schema_version'] != 1
            or record['operation'] != OPERATION + '-receipt' or record['intent_sha256'] != digest
            or type(record['recovered']) is not bool):
        raise ValueError('bootstrap receipt binding differs')
    created = fresh(record['created_at'], now)
    result = observation(record['observation'], intent['action'], now, intent_sha=digest,
                         since=intent['created_at'])
    if timestamp(record['observation']['observed_at']) > created:
        raise ValueError('bootstrap receipt predates observation')
    return result
