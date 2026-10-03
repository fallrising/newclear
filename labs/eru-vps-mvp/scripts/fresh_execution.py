"""Strict preparation evidence contracts; attestations never grant live authority."""
from datetime import datetime, timezone
import re

from fresh_rebuild import MATERIALS, plan_digest

HASH = re.compile(r'[0-9a-f]{64}\Z')
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z')
KINDS = {'owner_authorization', 'writer_fence', 'host_baseline', 'external_materials'}


def exact(value, fields):
    if type(value) is not dict or set(value) != set(fields):
        raise ValueError('execution record has unexpected fields')


def identifier(value):
    if type(value) is not str or not ID.fullmatch(value):
        raise ValueError('invalid execution identifier')
    return value


def sha256(value):
    if type(value) is not str or not HASH.fullmatch(value):
        raise ValueError('invalid execution digest')
    return value


def timestamp(value):
    if type(value) is not str:
        raise ValueError('invalid execution timestamp')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('invalid execution timestamp') from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError('execution timestamp requires timezone')
    return parsed.astimezone(timezone.utc)


def context(plan, review_sha256, run_id):
    identifier(run_id)
    before, after = plan['generation_before'], plan['generation_after']
    if (type(before) is not int or type(after) is not int
            or not 1 <= before < 2**63 - 1 or after != before + 1):
        raise ValueError('invalid execution generation')
    return {'run_id': run_id, 'plan_id': plan['id'],
            'review_sha256': sha256(review_sha256),
            'scope_sha256': sha256(plan['scope']['scope_sha256']),
            'cluster_id': 'eru-vps-mvp', 'generation_before': before,
            'target_generation': after}


def validate_evidence(document, evidence, plan, binding, now):
    exact(document, {'schema_version', 'binding'} | KINDS)
    if type(document['schema_version']) is not int or document['schema_version'] != 1:
        raise ValueError('invalid execution schema')
    if plan_digest(document['binding']) != plan_digest(binding):
        raise ValueError('execution input binding mismatch')
    for kind in KINDS:
        item = evidence[kind]
        extras = {
            'owner_authorization': {'authority', 'approved', 'issued_at', 'expires_at'},
            'writer_fence': {'observed_at', 'active', 'controller_count', 'in_flight_writers'},
            'host_baseline': {'observed_at', 'hosts'},
            'external_materials': {'observed_at', 'materials'},
        }[kind]
        exact(item, {'schema_version', 'kind', 'binding'} | extras)
        if (type(item['schema_version']) is not int or item['schema_version'] != 1
                or item['kind'] != kind
                or plan_digest(item['binding']) != plan_digest(binding)):
            raise ValueError('execution evidence binding mismatch')
        if kind != 'owner_authorization':
            age = (now - timestamp(item['observed_at'])).total_seconds()
            if not 0 <= age <= 15 * 60:
                raise ValueError('execution observation is stale or future')
    owner = evidence['owner_authorization']
    issued, expires = timestamp(owner['issued_at']), timestamp(owner['expires_at'])
    if (owner['authority'] != 'owner' or owner['approved'] is not True
            or not issued <= now < expires
            or not 0 < (expires - issued).total_seconds() <= 3600):
        raise ValueError('execution owner authorization is invalid or expired')
    fence = evidence['writer_fence']
    if (fence['active'] is not True or type(fence['controller_count']) is not int
            or fence['controller_count'] != 1
            or type(fence['in_flight_writers']) is not int
            or fence['in_flight_writers'] != 0):
        raise ValueError('execution fence is not exclusive and quiescent')
    hosts = evidence['host_baseline']['hosts']
    if type(hosts) is not list or len(hosts) != 4:
        raise ValueError('execution requires four host baselines')
    boots, keys, machines = set(), set(), set()
    for host, reviewed in zip(hosts, plan['scope']['hosts']):
        exact(host, {'alias', 'node', 'machine_id', 'boot_id_sha256', 'host_key_sha256'})
        if any(host[k] != reviewed[r] for k, r in (
                ('alias', 'alias'), ('node', 'node'), ('machine_id', 'current_machine_id'))):
            raise ValueError('execution host incarnation differs from review')
        if type(host['machine_id']) is not str or not host['machine_id']:
            raise ValueError('execution host machine identity is invalid')
        machines.add(host['machine_id'])
        boots.add(sha256(host['boot_id_sha256']))
        keys.add(sha256(host['host_key_sha256']))
    if len(boots) != 4 or len(keys) != 4 or len(machines) != 4:
        raise ValueError('execution host identities must be distinct')
    materials = evidence['external_materials']['materials']
    exact(materials, MATERIALS)
    for name, item in materials.items():
        exact(item, {'path', 'sha256', 'size'})
        sha256(item['sha256'])
        if (type(item['size']) is not int or item['size'] < 1
                or item['sha256'] != plan['bindings']['external_materials'][name]['evidence_sha256']):
            raise ValueError('execution external material differs from review')


def public_summary(envelope):
    value = envelope['execution']
    binding = value['binding']
    return {'status': 'prepared', 'id': binding['run_id'], 'sha256': envelope['sha256'],
            'host_count': 4, 'generation_before': binding['generation_before'],
            'target_generation': binding['target_generation'], 'executable': False,
            'remote_mutation_performed': False, 'generation_changed': False}
