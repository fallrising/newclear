#!/usr/bin/env python3
"""Collect bounded read-only metadata through an existing provider request adapter."""
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import time
import uuid

_spec = importlib.util.spec_from_file_location('collection_authorization', Path(__file__).with_name('authorization.py'))
auth = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(auth)
SQL = ('SELECT id,revision,revoked,policy FROM grants ORDER BY id LIMIT 5; '
       'SELECT COUNT(*) AS active_commands FROM commands WHERE active=1; '
       'SELECT COUNT(*) AS enabled_count FROM schedules WHERE enabled=1;')
MAX_SPAN = 120
MAX_RESPONSE = 65536


class CollectionError(ValueError):
    """Stable diagnostics never echo provider messages, identifiers or file paths."""


def require(ok, code='INVALID_COLLECTION_SOURCE'):
    if not ok:
        raise CollectionError(code)


def encode(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise CollectionError('INVALID_COLLECTION_SOURCE') from None


def digest(value):
    return hashlib.sha256(encode(value)).hexdigest()


def canonical_uuid(value):
    require(isinstance(value, str))
    try:
        require(str(uuid.UUID(value)) == value)
    except ValueError:
        raise CollectionError('INVALID_COLLECTION_PROFILE') from None


def validate_profile(profile):
    try:
        require(len(encode(profile)) <= 32768)
        auth.shape(profile, 'schema_version account_id target grant_ids service_token_ids')
        require(profile['schema_version'] == 'cloudlab.authorization-source.v1')
        require(isinstance(profile['account_id'], str) and re.fullmatch('[a-f0-9]{32}', profile['account_id']))
        auth.shape(profile['target'], 'worker_name database_id')
        require(profile['target']['worker_name'] in ('cloud-lab', 'cloud-lab-qualification'))
        canonical_uuid(profile['target']['database_id'])
        auth.shape(profile['grant_ids'], 'human bot runner scheduler')
        for value in profile['grant_ids'].values(): auth.identifier(value)
        require(len(set(profile['grant_ids'].values())) == 4)
        auth.shape(profile['service_token_ids'], 'bot runner')
        for value in profile['service_token_ids'].values(): canonical_uuid(value)
    except auth.AuthorizationError:
        raise CollectionError('INVALID_COLLECTION_PROFILE') from None
    return copy.deepcopy(profile)


def settings_projection(result, database_id):
    require(isinstance(result, dict) and isinstance(result.get('bindings'), list))
    bindings = result['bindings']
    require(all(isinstance(b, dict) and isinstance(b.get('name'), str) for b in bindings))
    require(len({b['name'] for b in bindings}) == len(bindings))
    db = [b for b in bindings if b['name'] == 'DB']
    require(len(db) == 1 and db[0].get('type') == 'd1', 'WORKER_DB_BINDING_MISMATCH')
    ids = [db[0][key] for key in ('id', 'database_id') if key in db[0]]
    require(ids and all(value == database_id for value in ids), 'WORKER_DB_BINDING_MISMATCH')
    projected = copy.deepcopy(result)
    projected['bindings'] = sorted(bindings, key=lambda b: b['name'])
    return projected


def d1_projection(result, grant_ids):
    require(isinstance(result, list) and len(result) == 3)
    require(all(isinstance(x, dict) and x.get('success') is True and isinstance(x.get('results'), list) for x in result), 'D1_QUERY_FAILED')
    grants = result[0]['results']
    require(len(grants) == 4 and all(isinstance(g, dict) and isinstance(g.get('id'), str) for g in grants))
    require({g['id'] for g in grants} == set(grant_ids.values()), 'GRANT_MAPPING_MISMATCH')
    for grant in grants: auth.shape(grant, 'id revision revoked policy')
    counts = []
    for item, key in zip(result[1:], ('active_commands', 'enabled_count')):
        require(len(item['results']) == 1)
        row = item['results'][0]
        auth.shape(row, key); auth.integer(row[key]); counts.append(row[key])
    return {'grants': sorted(copy.deepcopy(grants), key=lambda g: g['id']),
            'active_commands': counts[0], 'enabled_count': counts[1]}


def provider_expiry(value):
    if value is None:
        return None
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})', value), 'INVALID_PROVIDER_EXPIRY')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        # Floor fractional seconds, never extend a provider expiry by rounding up.
        return parsed.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    except (ValueError, OverflowError):
        raise CollectionError('INVALID_PROVIDER_EXPIRY') from None


def token_projection(result, token_id):
    require(isinstance(result, dict) and result.get('id') == token_id, 'TOKEN_MAPPING_MISMATCH')
    require(type(result.get('enabled')) is bool and 'expires_at' in result, 'TOKEN_METADATA_INCOMPLETE')
    return {'id': token_id, 'revoked': not result['enabled'], 'expires_at': provider_expiry(result['expires_at'])}


def collect(profile, request, *, clock=time.time):
    """No retry/mutations; adapter must bound individual transport calls."""
    profile = validate_profile(profile)
    started = clock()
    require(type(started) in (int, float) and 0 <= started < 253402300000, 'INVALID_CLOCK')
    previous = started
    records = []

    def tick():
        nonlocal previous
        value = clock()
        require(type(value) in (int, float) and previous <= value and value - started <= MAX_SPAN, 'COLLECTION_TIME_INVALID')
        previous = value
        return auth.utc(int(value))

    def read(label, method, path, body=None):
        sent = tick()
        options = {'method': method, 'path': path}
        if body is not None: options['body'] = body
        try:
            response = request(copy.deepcopy(options))
        except Exception:
            raise CollectionError('SOURCE_UNAVAILABLE') from None
        received = tick()
        require(len(encode(response)) <= MAX_RESPONSE, 'SOURCE_RESPONSE_TOO_LARGE')
        require(isinstance(response, dict) and response.get('success') is True and response.get('status') == 200 and 'result' in response, 'SOURCE_REQUEST_FAILED')
        records.append({'source': label, 'method': method, 'started_at': sent, 'finished_at': received,
                        'response_sha256': digest(response)})
        return response['result']

    base = '/accounts/' + profile['account_id']
    settings_path = base + '/workers/scripts/' + profile['target']['worker_name'] + '/settings'
    d1_path = base + '/d1/database/' + profile['target']['database_id'] + '/query'
    try:
        before_settings = settings_projection(read('worker-settings-before', 'GET', settings_path), profile['target']['database_id'])
        before_d1 = d1_projection(read('d1-before', 'POST', d1_path, {'sql': SQL}), profile['grant_ids'])
        tokens = {}
        token_sources = {}
        for index, token_id in enumerate(sorted(set(profile['service_token_ids'].values()))):
            label = 'access-token-' + str(index)
            tokens[token_id] = token_projection(read(label, 'GET', base + '/access/service_tokens/' + token_id), token_id)
            token_sources[token_id] = label
        after_d1 = d1_projection(read('d1-after', 'POST', d1_path, {'sql': SQL}), profile['grant_ids'])
        after_settings = settings_projection(read('worker-settings-after', 'GET', settings_path), profile['target']['database_id'])
        require(before_d1 == after_d1 and before_settings == after_settings, 'SOURCE_DRIFT')
        finished = tick()
        by_id = {g['id']: g for g in before_d1['grants']}
        subjects = []
        for role in ('human', 'bot', 'runner', 'scheduler'):
            machine = role in ('bot', 'runner')
            subjects.append({'role': role, 'grant': by_id[profile['grant_ids'][role]], 'credential': None,
                             'access_required': machine, 'access_service': tokens[profile['service_token_ids'][role]] if machine else None,
                             'runner_stop_at': None})
        snapshot = {'schema_version': 'cloudlab.authorization.v1', 'observed_at': auth.utc(int(started)),
                    'target': profile['target'], 'active_commands': before_d1['active_commands'],
                    'schedules_enabled': before_d1['enabled_count'] > 0, 'subjects': subjects}
        auth.validate(snapshot)
    except auth.AuthorizationError:
        raise CollectionError('INVALID_COLLECTION_SOURCE') from None
    provenance = {'schema_version': 'cloudlab.authorization-provenance.v1',
        'started_at': auth.utc(int(started)), 'finished_at': finished, 'requests': records,
        'profile_sha256': digest(profile), 'snapshot_sha256': hashlib.sha256(auth.files.encode(snapshot)).hexdigest(),
        'pre_post_equal': True, 'worker_db_binding_verified': True, 'atomic_snapshot': False,
        'source_projections': {'settings_sha256': digest(before_settings), 'd1_sha256': digest(before_d1)},
        'sources': {'grant': ['d1-before', 'd1-after'], 'credential': 'unavailable_worker_secret_not_readable',
                    'access_service': {r: token_sources[t] for r, t in profile['service_token_ids'].items()},
                    'runner_stop': 'not_observed', 'human_session': 'not_evaluated'},
        'role_mapping': 'operator_selected_not_verified_against_worker_secrets_or_access_policy',
        'access_policy_verified': False, 'no_mutations': True}
    return {'snapshot': snapshot, 'provenance': provenance}


def write_collection(profile_path, output_directory, request, *, clock=time.time):
    """Reserve a new private directory, then write the success manifest last."""
    try:
        source = auth.files.canonical_path(profile_path)
        destination = auth.files.canonical_path(output_directory)
        auth.files.require_outside_checkout(source)
        auth.files.require_outside_checkout(destination)
        profile = validate_profile(auth.files.read_private(source))
        parent = auth.files.open_directory(destination.parent)
        try:
            info = os.fstat(parent)
            require(info.st_uid == os.geteuid() and not info.st_mode & 0o022, 'UNSAFE_OUTPUT_PARENT')
            os.mkdir(destination.name, mode=0o700, dir_fd=parent)
            os.fsync(parent)
            root = os.open(destination.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        finally:
            os.close(parent)
        try:
            result = collect(profile, request, clock=clock)
            payloads = {name + '.json': auth.files.encode(result[name]) for name in ('snapshot', 'provenance')}
            manifest = {'schema_version': 'cloudlab.authorization-collection.v1', 'complete': True,
                        'files': {name: hashlib.sha256(raw).hexdigest() for name, raw in payloads.items()}}
            payloads['manifest.json'] = auth.files.encode(manifest)
            for name, raw in payloads.items():
                fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=root)
                with os.fdopen(fd, 'wb') as handle:
                    os.fchmod(handle.fileno(), 0o600)
                    handle.write(raw); handle.flush(); os.fsync(handle.fileno())
                os.fsync(root)
            return {'saved': True, 'snapshot_sha256': manifest['files']['snapshot.json'],
                    'request_count': len(result['provenance']['requests']), 'applied': False}
        finally:
            os.close(root)
    except (OSError, auth.files.PreparationError, auth.AuthorizationError):
        raise CollectionError('PRIVATE_FILE_UNAVAILABLE_OR_UNSAFE') from None
