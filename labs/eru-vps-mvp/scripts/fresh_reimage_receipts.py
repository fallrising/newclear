"""Four-host manual console attestations; never authorization or stage acceptance."""
import base64
from datetime import timedelta, timezone
import hashlib

from fresh_execution import context, exact, sha256, timestamp
from fresh_rebuild import plan_digest
from reimage_receipt import _boot_id, _fingerprints, _text

COMMON = {'schema_version', 'kind', 'binding', 'target', 'host_intent',
          'provider_resource_ref', 'os_image_ref', 'erase_scope',
          'provider_api_used', 'owner_confirmed', 'provider_console_action_ref'}
ACTION = COMMON | {'created_at'}
RECEIPT = COMMON | {'action', 'replacement', 'volume_results', 'console_completed_at',
                    'owner_reviewed_at', 'host_key_verified_via', 'host_key_fingerprints'}


def _same(left, right):
    if plan_digest(left) != plan_digest(right):
        raise ValueError('fresh receipt binding mismatch')


def _ref(value):
    exact(value, {'path', 'sha256'})
    _text(value['path'], 'private evidence reference', 512)
    sha256(value['sha256'])


def _validate_receipts(document, actions, receipts, *, plan, execution, baseline, now):
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('fresh receipt assessment requires timezone')
    now = now.astimezone(timezone.utc)
    exact(execution, {'execution', 'sha256'})
    record = execution['execution']
    if plan_digest(record) != execution['sha256']:
        raise ValueError('fresh receipt execution digest mismatch')
    binding = context(plan, plan_digest(plan), record['binding']['run_id'])
    _same(record['binding'], binding)
    exact(baseline, {'schema_version', 'kind', 'binding', 'observed_at', 'hosts', 'observation'})
    if type(baseline['schema_version']) is not int or baseline['schema_version'] != 2:
        raise ValueError('fresh receipts require observed original baseline')
    if baseline['kind'] != 'host_baseline':
        raise ValueError('fresh receipts require host baseline')
    _same(baseline['binding'], binding)
    _ref(baseline['observation'])
    binding = {**binding, 'execution_sha256': sha256(execution['sha256']),
               'observation_sha256': baseline['observation']['sha256']}
    exact(document, {'schema_version', 'binding', 'hosts'})
    if type(document['schema_version']) is not int or document['schema_version'] != 1:
        raise ValueError('unsupported fresh receipt request schema')
    _same(document['binding'], binding)
    old = baseline['hosts']
    if any(type(rows) is not list or len(rows) != 4 for rows in
           (old, document['hosts'], actions, receipts, plan['scope']['hosts'])):
        raise ValueError('fresh receipts require exactly four complete hosts')
    old_machines, old_boots, old_keys = set(), set(), set()
    for host, expected in zip(old, plan['scope']['hosts']):
        exact(host, {'alias', 'node', 'machine_id', 'boot_id_sha256', 'host_key_sha256'})
        _same({k: host[k] for k in ('alias', 'node', 'machine_id')},
              {'alias': expected['alias'], 'node': expected['node'],
               'machine_id': expected['current_machine_id']})
        old_machines.add(_text(host['machine_id'], 'old machine identity', 128))
        old_boots.add(sha256(host['boot_id_sha256']))
        old_keys.add(sha256(host['host_key_sha256']))
    if any(len(values) != 4 for values in (old_machines, old_boots, old_keys)):
        raise ValueError('original identities must be distinct')
    machines, boots, keys, action_refs, paths, hashes = set(), set(), set(), set(), set(), set()
    prepared = timestamp(record['created_at'])
    if prepared > now:
        raise ValueError('fresh preparation is future')
    for row, action, receipt, host in zip(document['hosts'], actions, receipts, plan['scope']['hosts']):
        exact(row, {'alias', 'node', 'action', 'receipt'})
        if row['alias'] != host['alias'] or row['node'] != host['node']:
            raise ValueError('fresh receipt host order mismatch')
        for ref in (row['action'], row['receipt']):
            _ref(ref)
            if ref['path'] in paths or ref['sha256'] in hashes:
                raise ValueError('fresh receipt evidence reference reused')
            paths.add(ref['path'])
            hashes.add(ref['sha256'])
        for item, kind, fields in ((action, 'fresh-console-action', ACTION),
                                    (receipt, 'fresh-console-receipt', RECEIPT)):
            exact(item, fields)
            if (type(item['schema_version']) is not int or item['schema_version'] != 1
                    or item['kind'] != kind or item['provider_api_used'] is not False
                    or item['owner_confirmed'] is not True):
                raise ValueError('fresh console requires exact manual owner attestation')
            _same(item['binding'], binding)
            _same(item['target'], {'alias': host['alias'], 'node': host['node'],
                                  'machine_id': host['current_machine_id']})
            _same(item['host_intent'], host['source'])
            for field in ('provider_resource_ref', 'os_image_ref', 'erase_scope'):
                _same(item[field], host[field])
        _same(receipt['action'], row['action'])
        action_ref = _text(action['provider_console_action_ref'], 'console action reference')
        if receipt['provider_console_action_ref'] != action_ref or action_ref in action_refs:
            raise ValueError('fresh console action reference mismatch or reuse')
        action_refs.add(action_ref)
        created = timestamp(action['created_at'])
        completed = timestamp(receipt['console_completed_at'])
        reviewed = timestamp(receipt['owner_reviewed_at'])
        if (not prepared <= created <= completed <= reviewed <= now
                or completed - created > timedelta(hours=24)
                or now - reviewed > timedelta(days=7)):
            raise ValueError('fresh console receipt times are invalid or stale')
        scope = host['erase_scope']
        expected_volumes = [{'volume_ref': v, 'result': 'erased'} for v in
                            [scope['boot_volume_ref'], *scope['additional_volume_refs']]]
        _same(receipt['volume_results'], expected_volumes)
        replacement = receipt['replacement']
        exact(replacement, {'machine_id', 'boot_id', 'os_release'})
        machine = _text(replacement['machine_id'], 'replacement machine identity', 128)
        boot = _boot_id(replacement['boot_id'], 'replacement boot identity')
        _text(replacement['os_release'], 'replacement OS release', 256)
        boot_hash = hashlib.sha256(boot.encode()).hexdigest()
        if receipt['host_key_verified_via'] != 'provider-console':
            raise ValueError('fresh host key requires out-of-band console attestation')
        exact(receipt['host_key_fingerprints'], {'ssh-ed25519'})
        fingerprint = _fingerprints(receipt['host_key_fingerprints'])['ssh-ed25519']
        key_hash = base64.b64decode(fingerprint.removeprefix('SHA256:') + '=').hex()
        if (machine in old_machines | machines or boot_hash in old_boots | boots
                or key_hash in old_keys | keys):
            raise ValueError('fresh replacement identity reused')
        machines.add(machine)
        boots.add(boot_hash)
        keys.add(key_hash)
    return {'binding': binding, 'hosts': document['hosts']}


def validate_receipts(document, actions, receipts, *, plan, execution, baseline, now):
    """Validate supplied attestations against already verified historical evidence."""
    try:
        return _validate_receipts(document, actions, receipts, plan=plan,
                                  execution=execution, baseline=baseline, now=now)
    except (KeyError, TypeError, IndexError, AttributeError, RecursionError, OverflowError):
        raise ValueError('malformed fresh receipt evidence') from None
