"""Offline M0 contract checker. No server, storage, credentials or network."""
import base64
import hashlib
import hmac
import json
import re
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import rfc8785
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError
from openapi_spec_validator import OpenAPIV31SpecValidator
from jsonschema_path import SchemaPath
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parent

def reject_constant(value):
    raise ValueError(f'non-JSON number: {value}')

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'duplicate JSON key: {key}')
        result[key] = value
    return result

def loads(value):
    return json.loads(value, object_pairs_hook=unique_object, parse_constant=reject_constant)

SCHEMAS = {p.stem.removesuffix('.schema'): loads(p.read_text())
           for p in (ROOT/'schemas').glob('*.json')}
REGISTRY = Registry().with_resources((s['$id'], Resource.from_contents(s)) for s in SCHEMAS.values())
FORMATS = FormatChecker()

def canonical_event(event):
    # CloudEvents optional attribute null means unset. Data is object-only here.
    return rfc8785.dumps({k: v for k, v in event.items() if v is not None})

def matches(pattern, value):
    return value.startswith(pattern[:-1]) if pattern.endswith('*') else value == pattern

def intersects_namespace(pattern, namespace):
    return (namespace.startswith(pattern[:-1]) or pattern[:-1].startswith(namespace)) if pattern.endswith('*') else pattern.startswith(namespace)

def semantic(name, document):
    if name == 'event':
        canonical_event(document)  # Reject unsafe integer/non-Unicode JCS inputs.
        known = SCHEMAS['event']['properties']
        if any(k not in known and isinstance(v, float) for k, v in document.items()):
            raise ValueError('extension integer requires an integer JSON representation')
        if 'data' in document and len(rfc8785.dumps(document['data'])) > 16384:
            raise ValueError('data exceeds 16 KiB in canonical UTF-8')
        return
    groups = ['sources', 'rules', 'subscriptions'] if name == 'config' else [name]
    for group in groups:
        if group not in ('sources', 'rules', 'subscriptions'):
            continue
        rows = document[group]
        key = 'name' if group == 'sources' else 'id'
        ids = [row[key] for row in rows]
        if len(ids) != len(set(ids)):
            raise ValueError(f'duplicate {group} {key}')
        for row in rows:
            if group == 'sources' and any(intersects_namespace(t, 'signalhub.') for t in row['allowed_types']):
                raise ValueError('external source allows reserved event types')
            if group == 'rules':
                types = row['filter'].get('types')
                if not types or any(intersects_namespace(t, 'signalhub.rule.') for t in types):
                    raise ValueError('rule must explicitly exclude rule-generated types')
            if group == 'subscriptions':
                filt = row['filter']
                types = filt.get('types')
                if (not types or any(matches(t, 'signalhub.delivery.dlq') for t in types)) and row['id'].startswith(filt.get('subject_prefix', '')):
                    raise ValueError('subscription may consume its own delivery failure')
                if row['mode'] == 'digest':
                    try:
                        ZoneInfo(row['digest']['timezone'])
                    except (ZoneInfoNotFoundError, ValueError) as exc:
                        raise ValueError('unknown IANA timezone') from exc
                if name == 'config' and row['channel']['kind'] == 'webhook' and row['channel']['url'] not in document['webhook_allowlist']:
                    raise ValueError('webhook URL is not exactly allowlisted')

def validate(name, document):
    Draft202012Validator(SCHEMAS[name], registry=REGISTRY, format_checker=FORMATS).validate(document)
    semantic(name, document)

def webhook_result(case):
    stamp = case['timestamp']
    delivery = case['delivery_id']
    signature = case['signature']
    if not re.fullmatch(r'0|[1-9][0-9]*', stamp):
        return 'reject'
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,63}:(?:[1-9][0-9]*|digest:[0-9]+)', delivery):
        return 'reject'
    if not re.fullmatch(r'v1=[0-9a-f]{64}', signature):
        return 'reject'
    if abs(case['now'] - int(stamp)) > 300:
        return 'reject'
    body = base64.b64decode(case['body_base64'], validate=True)
    payload = f'v1.{stamp}.{delivery}.'.encode('ascii') + body
    actual = 'v1=' + hmac.new(bytes.fromhex(case['key_hex']), payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, actual):
        return 'reject'
    return 'duplicate' if delivery in case['accepted_ids'] else 'accept'

def main():
    for schema in SCHEMAS.values():
        Draft202012Validator.check_schema(schema)
    cases = loads((ROOT/'fixtures.json').read_text())
    coverage = {name: set() for name in SCHEMAS}
    for case in cases:
        try:
            validate(case['schema'], case['instance'])
            valid = True
        except (ValueError, ValidationError):
            valid = False
        assert valid == case['valid'], f"fixture failed: {case['name']}"
        coverage[case['schema']].add(valid)
    assert all(v == {False, True} for v in coverage.values()), coverage
    boundary = dict(specversion='1.0', id='boundary', source='urn:example:test',
                    type='test.size.checked', time='2026-10-03T00:00:00Z',
                    data={'v': '界' * 5458 + 'xx'})
    assert len(rfc8785.dumps(boundary['data'])) == 16384
    validate('event', boundary)
    boundary['data']['v'] += 'x'
    try:
        validate('event', boundary)
    except ValueError:
        pass
    else:
        raise AssertionError('16385-byte data accepted')
    for bad in ['{"id":1,"id":2}', '{"x":NaN}', '{"x":Infinity}']:
        try:
            loads(bad)
        except ValueError:
            pass
        else:
            raise AssertionError('strict JSON parser accepted invalid input')
    # RFC 4231 test case 1, an external HMAC known-answer anchor.
    assert hmac.new(bytes.fromhex('0b'*20), b'Hi There', hashlib.sha256).hexdigest() == 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
    vectors = loads((ROOT/'webhook-vectors.json').read_text())
    for case in vectors:
        assert webhook_result(case) == case['expected'], f"webhook failed: {case['name']}"
    hashes = loads((ROOT/'canonical-vectors.json').read_text())
    for case in hashes:
        actual = canonical_event(loads(case['input']))
        assert actual.decode() == case['canonical'] and hashlib.sha256(actual).hexdigest() == case['sha256'], case['name']
    api = loads((ROOT/'openapi.json').read_text())
    def local_reference(uri):
        allowed = {'./schemas/event.schema.json', (ROOT/'schemas/event.schema.json').as_uri()}
        if uri not in allowed:
            raise ValueError(f'nonlocal or unknown reference: {uri}')
        return SCHEMAS['event']
    document = SchemaPath.from_dict(api, base_uri=(ROOT/'openapi.json').as_uri(),
                                   handlers={'<all_urls>': local_reference})
    OpenAPIV31SpecValidator(document).validate()
    assert set(api['paths']['/v1/events']) >= {'get','post'}
    assert not any(method in path for path in api['paths'].values() for method in ('put','patch','delete'))
    print(f'PASS: {len(SCHEMAS)} schemas; {len(cases)} positive/negative fixtures; {len(vectors)} webhook vectors; {len(hashes)} canonical vectors; strict JSON; RFC 4231; OpenAPI 3.1')

if __name__ == '__main__':
    main()
