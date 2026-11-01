"""Manual console intent/receipt contracts; receipts do not replace real probes."""
import copy
from datetime import timedelta

from fresh_execution import exact, sha256, timestamp
from fresh_network_staging import HOST_FIELDS, fresh
from fresh_rebuild import plan_digest

OPERATION = 'fresh-network-manual-setup'


def validate_setup(setup, render):
    from fresh_network_probe import validate_setup as validate
    return validate(setup, render)


def manual_actions(setup, render):
    validate_setup(setup, render)
    actions = []
    for index, (host, target) in enumerate(zip(render['hosts'], setup['hosts'])):
        access = ({'role': 'core', 'client_key_path': setup['core_key']['path'],
                   'client_key_sha256': setup['core_key']['public_key_sha256'],
                   'known_hosts_path': setup['core_known_hosts_path'],
                   'known_hosts_sha256': host['files'][1]['sha256']} if index == 0 else
                  {'role': 'worker', 'authorized_keys_path': setup['worker_authorized_keys_path'],
                   'authorized_keys_sha256': target['authorized_keys_sha256'],
                   'helper_path': setup['worker_helper_path'],
                   'helper_sha256': setup['worker_helper_sha256']})
        actions.append({'host_index': index, 'console_action_ref': target['console_action_ref'],
            'host': {k: copy.deepcopy(host[k]) for k in HOST_FIELDS},
            'private_interface': render['private_interface'], 'public_ipv4': target['public_ipv4'],
            'public_ipv6': target['public_ipv6'],
            'effective_access': access})
    return actions


def authorization(value, intent, now):
    exact(value, {'schema_version', 'operation', 'plan_id', 'plan_sha256',
                 'execution_sha256', 'pending_sha256', 'setup_sha256', 'scope', 'owner_confirmed',
                 'authorized_at', 'expires_at'})
    if (type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['operation'] != OPERATION + '-authorization'
            or value['scope'] != 'manual-console-network-and-access-only'
            or value['owner_confirmed'] is not True
            or value['setup_sha256'] != intent['input']['sha256']
            or any(value[k] != intent[k] for k in ('plan_id', 'plan_sha256',
                                                  'execution_sha256', 'pending_sha256'))):
        raise ValueError('manual setup authorization binding invalid')
    start, end = timestamp(value['authorized_at']), timestamp(value['expires_at'])
    if not start <= now < end or not timedelta(0) < end - start <= timedelta(minutes=15):
        raise ValueError('manual setup authorization expired or future')


def validate_manual_receipt(value, intent, digest, now):
    exact(value, {'schema_version', 'operation', 'intent_sha256', 'owner_confirmed', 'hosts'})
    sha256(digest)
    if (type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['operation'] != OPERATION + '-receipt'
            or value['intent_sha256'] != digest or value['owner_confirmed'] is not True
            or type(value['hosts']) is not list or len(value['hosts']) != 4):
        raise ValueError('manual setup requires four bound owner receipts')
    for row, action in zip(value['hosts'], intent['actions']):
        exact(row, {'action', 'started_at', 'completed_at', 'owner_confirmed'})
        if row['owner_confirmed'] is not True or plan_digest(row['action']) != plan_digest(action):
            raise ValueError('manual setup action receipt differs from intent')
        start, end = fresh(row['started_at'], now), fresh(row['completed_at'], now)
        if not timestamp(intent['created_at']) <= start <= end:
            raise ValueError('manual setup receipt precedes intent')
    return value
