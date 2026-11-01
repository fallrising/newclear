"""Current network-stage prerequisites; attestations do not prove external fencing."""
from datetime import timedelta

from fresh_execution import exact, sha256, timestamp
from fresh_rebuild import plan_digest

STAGE = 'network-and-access-ready'
HOST_FIELDS = {'alias', 'node', 'machine_id', 'boot_id_sha256', 'host_key_sha256'}


def _same(value, expected):
    if plan_digest(value) != plan_digest(expected):
        raise ValueError('network prerequisite binding mismatch')


def _evidence(item, kind, binding, extras):
    exact(item, {'schema_version', 'kind', 'binding'} | extras)
    if type(item['schema_version']) is not int or item['schema_version'] != 1 or item['kind'] != kind:
        raise ValueError('unsupported network prerequisite evidence')
    _same(item['binding'], binding)


def validate(document, authorization, fence, isolation, *, execution, execution_sha,
             pending_sha, replacement, baseline, now):
    """Validate scope, strict types, chronology and old-host isolation attestations."""
    exact(document, {'schema_version', 'binding', 'replacement_observation',
                     'owner_authorization', 'writer_fence'})
    if type(document['schema_version']) is not int or document['schema_version'] != 1:
        raise ValueError('unsupported network prerequisite request')
    binding = {**execution['binding'], 'execution_sha256': sha256(execution_sha),
               'pending_sha256': sha256(pending_sha),
               'replacement_sha256': sha256(plan_digest(replacement)), 'stage': STAGE}
    _same(document['binding'], binding)
    completed = timestamp(replacement['completed_at'])
    _evidence(authorization, 'fresh-stage-authorization', binding,
              {'authority', 'approved', 'issued_at', 'expires_at'})
    issued, expires = timestamp(authorization['issued_at']), timestamp(authorization['expires_at'])
    if (authorization['authority'] != 'owner' or authorization['approved'] is not True
            or not completed <= issued <= now < expires
            or not timedelta(0) < expires - issued <= timedelta(hours=1)):
        raise ValueError('network prerequisite authorization invalid or expired')
    _evidence(fence, 'fresh-stage-fence', binding,
              {'observed_at', 'active', 'controller_count', 'in_flight_writers', 'prior_fence', 'isolation'})
    if (fence['active'] is not True or type(fence['controller_count']) is not int
            or fence['controller_count'] != 1 or type(fence['in_flight_writers']) is not int
            or fence['in_flight_writers'] != 0):
        raise ValueError('network prerequisite fence not exclusive and quiescent')
    _same(fence['prior_fence'], execution['evidence']['writer_fence'])
    observed = timestamp(fence['observed_at'])
    if not completed <= observed <= now or now - observed > timedelta(minutes=15):
        raise ValueError('network prerequisite fence stale or future')
    _evidence(isolation, 'fresh-writer-isolation', binding,
              {'observed_at', 'other_controllers_stopped', 'ci_writers_stopped',
               'app_writers_stopped', 'old_hosts'})
    isolated = timestamp(isolation['observed_at'])
    if (not completed <= isolated <= observed or now - isolated > timedelta(minutes=15)
            or any(isolation[key] is not True for key in (
                'other_controllers_stopped', 'ci_writers_stopped', 'app_writers_stopped'))):
        raise ValueError('network prerequisite isolation invalid or stale')
    if type(baseline['schema_version']) is not int or baseline['schema_version'] != 2:
        raise ValueError('network prerequisites require observed original baseline')
    hosts = isolation['old_hosts']
    if type(hosts) is not list or len(hosts) != 4 or len(baseline['hosts']) != 4:
        raise ValueError('network prerequisites require four old host proofs')
    paths, digests = set(), set()
    for host, original in zip(hosts, baseline['hosts']):
        exact(host, HOST_FIELDS | {'isolated', 'method', 'proof'})
        _same({key: host[key] for key in HOST_FIELDS}, original)
        if host['isolated'] is not True or host['method'] not in ('provider-console', 'network'):
            raise ValueError('network prerequisite old host isolation unknown')
        exact(host['proof'], {'path', 'sha256'})
        digest = sha256(host['proof']['sha256'])
        path = host['proof']['path']
        if type(path) is not str or path in paths or digest in digests:
            raise ValueError('network prerequisite isolation proof reused')
        paths.add(path)
        digests.add(digest)
    return binding
