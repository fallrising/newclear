"""Strict dedicated-table evidence contracts; synthetic schema is not kernel proof."""
import copy
from datetime import timedelta
import json

from fresh_execution import exact, sha256, timestamp
from fresh_network_access import MANAGEMENT_PORTS, _firewall, private_ip
import fresh_network_staging as staging
from fresh_network_staging_host import validate_request
from fresh_rebuild import plan_digest


OPERATION = 'fresh-network-firewall-activation'
HOST_FIELDS = staging.HOST_FIELDS
host_index = staging.host_index
fresh = staging.fresh
LIMIT = 256 * 1024
ACTION_FIELDS = {'schema_version', 'operation', 'plan_id', 'plan_sha256', 'run_id',
                 'execution_sha256', 'pending_sha256', 'host_index', 'host',
                 'staging_intent_sha256', 'staging_receipt_sha256', 'network'}


def _bounded(value):
    """Bound decoded inputs too; Python equality alone would accept bool as int."""
    remaining = 4096
    def visit(item, depth=0):
        nonlocal remaining
        remaining -= 1
        if remaining < 0 or depth > 16:
            raise ValueError('firewall document exceeds bounds')
        kind = type(item)
        if kind is dict:
            for key, child in item.items():
                if type(key) is not str or len(key) > 128:
                    raise ValueError('invalid firewall object key')
                visit(child, depth + 1)
        elif kind is list:
            for child in item:
                visit(child, depth + 1)
        elif kind is str:
            if len(item) > 65536:
                raise ValueError('firewall string exceeds bounds')
        elif kind is int:
            if not -(2**63) <= item <= 2**64 - 1:
                raise ValueError('firewall integer exceeds bounds')
        elif kind is not bool and item is not None:
            raise ValueError('invalid firewall JSON type')
    visit(value)
    raw = json.dumps(value, ensure_ascii=False, allow_nan=False,
                     sort_keys=True, separators=(',', ':')).encode('utf-8')
    if len(raw) > LIMIT:
        raise ValueError('firewall document exceeds bounds')
    return raw


def decode_ruleset(raw):
    """Decode bounded strict JSON without duplicate keys or non-finite numbers."""
    if type(raw) is not bytes or len(raw) > LIMIT:
        raise ValueError('invalid firewall JSON size')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate firewall JSON key')
            result[key] = value
        return result
    def invalid(_):
        raise ValueError('invalid firewall JSON constant')
    try:
        document = json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                              parse_constant=invalid)
        _bounded(document)
        exact(document, {'nftables'})
        if type(document['nftables']) is not list:
            raise ValueError('invalid firewall ruleset')
        return document
    except (ValueError, TypeError, RecursionError, UnicodeError):
        raise ValueError('invalid firewall JSON document') from None


def _validate_action(value):
    _bounded(value)
    exact(value, ACTION_FIELDS)
    if value['operation'] != OPERATION:
        raise ValueError('invalid firewall action operation')
    base = {k: v for k, v in value.items() if k not in
            ('staging_intent_sha256', 'staging_receipt_sha256', 'network')}
    base['operation'] = staging.OPERATION
    validate_request({'schema_version': 1, 'operation': 'observe', 'action': base})
    for field in ('staging_intent_sha256', 'staging_receipt_sha256'):
        sha256(value[field])
    network = value['network']
    exact(network, {'controller_ip', 'private_interface', 'host_ips'})
    controller = private_ip(network['controller_ip'])
    if (type(network['private_interface']) is not str
            or network['private_interface'] not in ('tailscale0', 'wg0')
            or type(network['host_ips']) is not list or len(network['host_ips']) != 4):
        raise ValueError('invalid firewall network')
    addresses = [private_ip(ip) for ip in network['host_ips']]
    if (len(set([controller] + addresses)) != 5
            or addresses[value['host_index']] != value['host']['ip']):
        raise ValueError('invalid firewall endpoint binding')
    expected = _firewall([{'ip': ip} for ip in addresses], value['host_index'],
                         controller, network['private_interface'])
    if value['host']['files'][0]['content'] != expected:
        raise ValueError('firewall payload differs from derived policy')


def action(plan, digest, pending, index, staging_intent_sha, staging_receipt_sha):
    """Derive policy endpoints from all current render hosts, never caller endpoints."""
    index = host_index(index)
    if (type(plan) is not dict or not {'id', 'run_id', 'execution_sha256', 'render'} <= set(plan)
            or type(pending) is not dict or 'sha256' not in pending):
        raise ValueError('invalid firewall plan binding')
    render = plan['render']
    exact(render, {'profile', 'private_interface', 'controller_ip', 'controller_known_hosts', 'hosts'})
    if (render['profile'] != 'A' or type(render['hosts']) is not list
            or len(render['hosts']) != 4 or type(render['controller_known_hosts']) is not str
            or len(render['controller_known_hosts'].encode('utf-8')) > 65536):
        raise ValueError('invalid firewall plan render')
    if any(type(host) is not dict or 'ip' not in host for host in render['hosts']):
        raise ValueError('invalid firewall plan host')
    network = {'controller_ip': render['controller_ip'], 'private_interface': render['private_interface'],
               'host_ips': [host['ip'] for host in render['hosts']]}
    actions = []
    for number in range(4):
        result = staging.action(plan, digest, pending, number)
        result.update(operation=OPERATION, staging_intent_sha256=staging_intent_sha,
                      staging_receipt_sha256=staging_receipt_sha, network=copy.deepcopy(network))
        _validate_action(result)
        actions.append(result)
    for field in ('machine_id', 'boot_id', 'host_key_sha256'):
        if len({row['host'][field] for row in actions}) != 4:
            raise ValueError('firewall host incarnations are not distinct')
    return actions[index]


def _match(left, right):
    return {'match': {'op': '==', 'left': copy.deepcopy(left), 'right': copy.deepcopy(right)}}


def expected_ruleset(expected):
    """Narrow libnftables-json(5) schema; output normalization needs live fixtures."""
    _validate_action(expected)
    network, index = expected['network'], expected['host_index']
    ips, controller = network['host_ips'], network['controller_ip']
    objects = [{'table': {'family': 'inet', 'name': 'eru_fresh_access'}},
               {'chain': {'family': 'inet', 'table': 'eru_fresh_access', 'name': 'input',
                          'type': 'filter', 'hook': 'input', 'prio': -20, 'policy': 'accept'}}]
    def rule(expressions):
        objects.append({'rule': {'family': 'inet', 'table': 'eru_fresh_access',
                                  'chain': 'input', 'expr': expressions}})
    interface = {'meta': {'key': 'iifname'}}
    source = {'payload': {'protocol': 'ip', 'field': 'saddr'}}
    target = {'payload': {'protocol': 'ip', 'field': 'daddr'}}
    port = {'payload': {'protocol': 'tcp', 'field': 'dport'}}
    rule([_match(interface, 'lo'), {'accept': None}])
    allowed = [(22, [controller] if index == 0 else [controller, ips[0]])]
    allowed.append((5001, [controller] + ips) if index == 0 else (80, [controller, ips[0]]))
    for number, sources in allowed:
        for address in sources:
            rule([_match(interface, network['private_interface']), _match(source, address),
                  _match(target, ips[index]), _match(port, number), {'accept': None}])
    rule([_match(port, {'set': list(MANAGEMENT_PORTS)}), {'drop': None}])
    return copy.deepcopy({'nftables': objects})


def validate_ruleset(document, expected):
    """Only leading metainfo and top-level object handles are nonsemantic."""
    _bounded(document)
    exact(document, {'nftables'})
    objects = document['nftables']
    if type(objects) is not list:
        raise ValueError('invalid firewall ruleset objects')
    objects = copy.deepcopy(objects)
    if objects and type(objects[0]) is dict and 'metainfo' in objects[0]:
        exact(objects[0], {'metainfo'})
        metadata = objects.pop(0)['metainfo']
        exact(metadata, {'version', 'release_name', 'json_schema_version'})
        if (type(metadata['json_schema_version']) is not int or metadata['json_schema_version'] != 1
                or any(type(metadata[k]) is not str or not 1 <= len(metadata[k]) <= 128
                       or any(ord(c) < 32 or ord(c) > 126 for c in metadata[k])
                       for k in ('version', 'release_name'))):
            raise ValueError('invalid firewall metainfo')
    for item in objects:
        if type(item) is not dict or len(item) != 1 or next(iter(item)) not in ('table', 'chain', 'rule'):
            raise ValueError('unexpected firewall object')
        body = next(iter(item.values()))
        if type(body) is not dict:
            raise ValueError('invalid firewall object')
        if 'handle' in body:
            handle = body.pop('handle')
            if type(handle) is not int or not 0 <= handle <= 2**64 - 1:
                raise ValueError('invalid firewall handle')
    canonical = {'nftables': objects}
    if _bounded(canonical) != _bounded(expected_ruleset(expected)):
        raise ValueError('firewall policy differs from current derivation')


def authorization(document, expected, now):
    _validate_action(expected)
    exact(document, {'schema_version', 'operation', 'plan_id', 'plan_sha256',
                     'execution_sha256', 'pending_sha256', 'scope', 'owner_confirmed',
                     'authorized_at', 'expires_at'})
    if (type(document['schema_version']) is not int or document['schema_version'] != 1
            or document['operation'] != OPERATION + '-authorization'
            or document['scope'] != 'activate-fresh-firewall-only' or document['owner_confirmed'] is not True
            or any(document[k] != expected[k] for k in
                   ('plan_id', 'plan_sha256', 'execution_sha256', 'pending_sha256'))):
        raise ValueError('firewall authorization binding invalid')
    start, end = timestamp(document['authorized_at']), timestamp(document['expires_at'])
    if not start <= now <= end or end - start > timedelta(minutes=15):
        raise ValueError('firewall authorization expired or future')


def observation(value, expected, now, *, intent_sha=None, since=None):
    _validate_action(expected)
    exact(value, {'observed_at', 'host', 'directory', 'files', 'table'})
    observed = staging.observation({k: v for k, v in value.items() if k != 'table'},
        expected, now, intent_sha=expected['staging_intent_sha256'], since=since)
    table = value['table']
    if intent_sha is None:
        exact(table, {'kind'})
        if table['kind'] != 'absent':
            raise ValueError('firewall table already exists')
    else:
        sha256(intent_sha)
        exact(table, {'kind', 'ruleset', 'intent_sha256'})
        if table['kind'] != 'present' or table['intent_sha256'] != intent_sha:
            raise ValueError('firewall table provenance invalid')
        validate_ruleset(table['ruleset'], expected)
    return observed


def intent_record(expected, authorization_ref, before, predecessor, created, identity):
    return {'schema_version': 1, 'operation': OPERATION + '-intent',
            'action': copy.deepcopy(expected), 'authorization': copy.deepcopy(authorization_ref),
            'before': copy.deepcopy(before), 'predecessor_sha256': predecessor,
            'created_at': created, 'private_identity': copy.deepcopy(identity)}


def validate_intent(record, expected, authorization_ref, predecessor, identity, now):
    exact(record, {'schema_version', 'operation', 'action', 'authorization', 'before',
                   'predecessor_sha256', 'created_at', 'private_identity'})
    created = fresh(record['created_at'], now)
    observed = observation(record['before'], expected, now)
    if observed > created:
        raise ValueError('firewall before observation follows intent')
    rebuilt = intent_record(expected, authorization_ref, record['before'], predecessor,
                            record['created_at'], identity)
    if plan_digest(rebuilt) != plan_digest(record):
        raise ValueError('firewall intent is not current derivation')


def validate_receipt(record, intent, digest, now):
    exact(record, {'schema_version', 'operation', 'intent_sha256', 'observation', 'created_at', 'recovered'})
    sha256(digest)
    if (type(record['schema_version']) is not int or record['schema_version'] != 1
            or record['operation'] != OPERATION + '-receipt' or record['intent_sha256'] != digest
            or type(record['recovered']) is not bool):
        raise ValueError('firewall receipt binding invalid')
    created = fresh(record['created_at'], now)
    observed = observation(record['observation'], intent['action'], now,
                           intent_sha=digest, since=intent['created_at'])
    if observed > created:
        raise ValueError('firewall receipt precedes observation')
