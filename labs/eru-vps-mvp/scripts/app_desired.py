"""Offline desired-state validation and drift planning for ERU-012.

This module plans one stateless, digest-pinned HTTP application revision. It
does not contact a cluster or execute deploy/remove commands. In particular,
an incomplete revision is treated as uncertain (for example, a lost deploy
reply) and must be reconciled instead of retried automatically.
"""
from __future__ import annotations

import hashlib
import json
import math
import re

OWNER = 'eru-vps-mvp'
WORKERS = {'worker-2', 'worker-3', 'worker-4'}
SPEC_FIELDS = {'schema_version', 'name', 'image', 'node', 'replicas', 'entrypoint',
               'command', 'restart', 'resources', 'network', 'service', 'stateless'}
QUANTITY = re.compile(r'^[1-9][0-9]*(?:[KMGT]i?B?|B)$')
IMAGE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[0-9a-f]{64}$')
NAME = re.compile(r'^[a-z][a-z0-9-]{0,39}$')
ENTRYPOINT = re.compile(r'^[a-z][a-z0-9_-]{0,31}$')


def canonical_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                      allow_nan=False).encode('utf-8')


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def snapshot_binding(snapshot):
    """Return stable, non-inventory plan facts and discard observation time."""
    if not isinstance(snapshot, dict):
        raise ValueError('snapshot must be an object')
    marker = '_eru_app_snapshot_binding_v1'
    if marker in snapshot:
        allowed = {marker, 'hosts_sha256', 'pods', 'nodes', 'workloads'}
        if snapshot.get(marker) is not True or set(snapshot) - allowed:
            raise ValueError('invalid normalized snapshot binding')
        digest_fields = ('hosts_sha256',)
        if any(key in snapshot and
               (not isinstance(snapshot[key], str)
                or not re.fullmatch(r'[0-9a-f]{64}', snapshot[key]))
               for key in digest_fields):
            raise ValueError('invalid normalized snapshot digest')
        row_fields = {
            'pods': ({'name'}, {'name', 'row_sha256'}),
            'nodes': ({'name', 'available', 'row_sha256'},),
            'workloads': ({'id', 'nodename', 'labels'},),
        }
        for key, accepted_shapes in row_fields.items():
            if key not in snapshot:
                continue
            rows = snapshot[key]
            if not isinstance(rows, list):
                raise ValueError('invalid normalized snapshot rows')
            for row in rows:
                if (not isinstance(row, dict) or set(row) not in accepted_shapes):
                    raise ValueError('invalid normalized snapshot row')
                if ('row_sha256' in row and
                        (not isinstance(row['row_sha256'], str)
                         or not re.fullmatch(r'[0-9a-f]{64}', row['row_sha256']))):
                    raise ValueError('invalid normalized snapshot row digest')
                if key == 'workloads':
                    labels = row['labels']
                    if (not isinstance(labels, dict)
                            or set(labels) - {'owner', 'logical_app', 'spec_sha256'}):
                        raise ValueError('invalid normalized workload labels')
        return dict(snapshot)
    result = {marker: True}
    if 'hosts' in snapshot:
        # labctl host facts can include private inventory details. Bind them
        # without copying those details into a reviewable or journaled plan.
        result['hosts_sha256'] = sha256(canonical_bytes(snapshot['hosts']))
    for key in ('pods', 'nodes', 'workloads'):
        rows = snapshot.get(key)
        if not isinstance(rows, list):
            continue
        normalized = []
        for row in rows:
            if not isinstance(row, dict):
                normalized.append({'malformed_row_type': type(row).__name__})
                continue
            if key == 'pods':
                item = {'name': row.get('name')}
                if len(row) > 1:
                    item['row_sha256'] = sha256(canonical_bytes(row))
            elif key == 'nodes':
                item = {'name': row.get('name'), 'available': row.get('available')}
                item['row_sha256'] = sha256(canonical_bytes(row))
            else:
                labels = row.get('labels')
                labels = labels if isinstance(labels, dict) else {}
                item = {
                    'id': row.get('id'),
                    'nodename': row.get('nodename'),
                    'labels': {label: labels[label] for label in
                               ('owner', 'logical_app', 'spec_sha256') if label in labels},
                }
            normalized.append(item)
        result[key] = sorted(normalized, key=canonical_bytes)
    return result


def validate_spec(document):
    if not isinstance(document, dict):
        raise ValueError('app spec must be a JSON object')
    unknown = set(document) - SPEC_FIELDS
    missing = SPEC_FIELDS - set(document)
    if unknown:
        raise ValueError('unsupported app spec fields: ' + ', '.join(sorted(unknown)))
    if missing:
        raise ValueError('missing app spec fields: ' + ', '.join(sorted(missing)))
    if document['schema_version'] != 1 or isinstance(document['schema_version'], bool):
        raise ValueError('schema_version must be 1')
    name = document['name']
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise ValueError('name must be a lowercase app identifier')
    image = document['image']
    if not isinstance(image, str) or not IMAGE.fullmatch(image):
        raise ValueError('image must be pinned by a lowercase sha256 digest')
    node = document['node']
    if not isinstance(node, str) or node not in WORKERS:
        raise ValueError('node must name one reviewed worker')
    replicas = document['replicas']
    if isinstance(replicas, bool) or not isinstance(replicas, int) or not 1 <= replicas <= 3:
        raise ValueError('replicas must be an integer from 1 to 3')
    entrypoint = document['entrypoint']
    if not isinstance(entrypoint, str) or not ENTRYPOINT.fullmatch(entrypoint):
        raise ValueError('entrypoint must be a lowercase identifier')
    command = document['command']
    if (not isinstance(command, list) or not command or len(command) > 32
            or any(not isinstance(part, str) or not part or '\x00' in part for part in command)):
        raise ValueError('command must contain 1..32 nonempty strings')
    if document['restart'] != 'always':
        raise ValueError('only restart=always is supported by this HTTP service contract')
    resources = document['resources']
    if not isinstance(resources, dict) or set(resources) != {'cpu', 'memory', 'storage'}:
        raise ValueError('resources must contain exactly cpu, memory and storage')
    cpu = resources['cpu']
    if (isinstance(cpu, bool) or not isinstance(cpu, (int, float)) or not math.isfinite(cpu)
            or not 0 < cpu <= 16):
        raise ValueError('resources.cpu must be finite and in (0, 16]')
    for field in ('memory', 'storage'):
        value = resources[field]
        if not isinstance(value, str) or not QUANTITY.fullmatch(value):
            raise ValueError('resources.' + field + ' must be a positive explicit byte quantity')
    if document['network'] != 'eru':
        raise ValueError('network must be eru; host networking requires a separate reviewed plan')
    service = document['service']
    if not isinstance(service, dict) or set(service) != {'port', 'path', 'expected_status', 'body_contains'}:
        raise ValueError('service must contain exactly port, path, expected_status and body_contains')
    port = service['port']
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError('service.port must be from 1 to 65535')
    path = service['path']
    if not isinstance(path, str) or not path.startswith('/') or '\n' in path or '\r' in path:
        raise ValueError('service.path must be an absolute HTTP path')
    status = service['expected_status']
    if isinstance(status, bool) or not isinstance(status, int) or not 200 <= status <= 399:
        raise ValueError('service.expected_status must be an HTTP success status')
    body = service['body_contains']
    if not isinstance(body, str) or not body or len(body) > 512 or '\x00' in body:
        raise ValueError('service.body_contains must be a bounded nonempty string')
    if document['stateless'] is not True:
        raise ValueError('ERU-012 v1 accepts only explicitly stateless workloads')

    # Return a fresh, normalized structure so hashes never depend on caller order
    # or mutation after validation.
    return {
        'schema_version': 1,
        'name': name,
        'image': image,
        'node': node,
        'replicas': replicas,
        'entrypoint': entrypoint,
        'command': list(command),
        'restart': 'always',
        'resources': {'cpu': float(cpu), 'memory': resources['memory'], 'storage': resources['storage']},
        'network': 'eru',
        'service': {'port': port, 'path': path, 'expected_status': status,
                    'body_contains': body},
        'stateless': True,
    }


def spec_identity(document):
    spec = validate_spec(document)
    spec_hash = sha256(canonical_bytes(spec))
    # Eru app names are unique per immutable revision. A retry of the same
    # desired spec therefore queries the same name before it could create again.
    appname = 'erumvp' + sha256((spec['name'] + '\0' + spec_hash).encode())[:12]
    return spec, spec_hash, appname


def render_eru_spec(spec, spec_hash, appname):
    spec, expected_hash, expected_appname = spec_identity(spec)
    if spec_hash != expected_hash or appname != expected_appname:
        raise ValueError('rendered app identity differs from normalized spec')
    labels = {'owner': OWNER, 'logical_app': spec['name'], 'spec_sha256': spec_hash}
    lines = [
        'appname: ' + json.dumps(appname),
        'entrypoints:',
        '  ' + spec['entrypoint'] + ':',
        '    commands: ' + json.dumps(spec['command'], ensure_ascii=False),
        '    restart: always',
        '    publish: [' + json.dumps(str(spec['service']['port'])) + ']',
        'labels:',
    ]
    lines.extend('  ' + key + ': ' + json.dumps(value, ensure_ascii=False)
                 for key, value in labels.items())
    return '\n'.join(lines) + '\n'


def build_plan(document, snapshot):
    """Build a read-only plan from a normalized spec and labctl-style snapshot."""
    spec, spec_hash, appname = spec_identity(document)
    if (not isinstance(snapshot, dict) or not isinstance(snapshot.get('nodes'), list)
            or not isinstance(snapshot.get('workloads'), list) or not isinstance(snapshot.get('pods'), list)):
        raise ValueError('snapshot must contain pods, nodes and workloads arrays')
    blockers = []
    if not any(isinstance(row, dict) and row.get('name') == 'eru' for row in snapshot['pods']):
        blockers.append('expected eru pod is missing from snapshot')
    nodes = [row for row in snapshot['nodes'] if isinstance(row, dict) and row.get('name') == spec['node']]
    if len(nodes) != 1:
        blockers.append('target node identity is missing or ambiguous')
    elif nodes[0].get('available') is not True:
        blockers.append('target node is not available')

    current = []
    prior = []
    ids = set()
    prefix = appname + '_'
    for row in snapshot['workloads']:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str):
            blockers.append('workload snapshot contains a malformed row')
            continue
        wid = row['id']
        if wid in ids:
            blockers.append('workload snapshot contains duplicate IDs')
            continue
        ids.add(wid)
        labels = row.get('labels') if isinstance(row.get('labels'), dict) else {}
        claims_logical = labels.get('logical_app') == spec['name']
        claims_release = wid.startswith(prefix)
        if claims_release and (labels.get('owner') != OWNER or not claims_logical
                               or labels.get('spec_sha256') != spec_hash):
            blockers.append('deterministic release name is occupied by unverified ownership: ' + wid)
            continue
        if not claims_logical:
            continue
        if labels.get('owner') != OWNER:
            blockers.append('logical app contains a workload without this operator ownership: ' + wid)
            continue
        observed_hash = labels.get('spec_sha256')
        if not isinstance(observed_hash, str) or not re.fullmatch(r'[0-9a-f]{64}', observed_hash):
            blockers.append('owned logical app has a workload without a valid spec digest: ' + wid)
            continue
        item = {'id': wid, 'node': row.get('nodename'), 'spec_sha256': observed_hash}
        if observed_hash == spec_hash:
            if not wid.startswith(prefix):
                blockers.append('current digest is attached to an unexpected Eru app name: ' + wid)
            if row.get('nodename') != spec['node']:
                blockers.append('current revision is placed on a different node: ' + wid)
            current.append(item)
        else:
            prior.append(item)

    if blockers:
        action = 'reconcile_uncertain_revision' if current else 'blocked'
    elif len(current) == 0:
        action = 'deploy_revision'
    elif len(current) == spec['replicas']:
        action = 'no_op'
    else:
        action = 'reconcile_uncertain_revision'
        blockers.append('current revision has a partial or duplicate replica set; inspect before retry')

    deploy_argv = [
        'eru-cli', 'workload', 'deploy', '--pod', 'eru', '--node', spec['node'],
        '--entry', spec['entrypoint'], '--image', spec['image'], '--network', spec['network'],
        '--count', str(spec['replicas']), '--cpu', format(spec['resources']['cpu'], '.15g'),
        '--memory', spec['resources']['memory'], '--storage', spec['resources']['storage'],
        '<reviewed-spec-file>',
    ]
    plan = {
        'schema_version': 1,
        'operation': 'app-desired-state-plan',
        'logical_app': spec['name'],
        'appname': appname,
        'spec': spec,
        'spec_sha256': spec_hash,
        'snapshot_sha256': sha256(canonical_bytes(snapshot_binding(snapshot))),
        'action': action,
        'decision': 'blocked' if blockers else 'reviewable',
        'executable': False,
        'execution_implemented': False,
        'blockers': sorted(set(blockers)),
        'checks_not_performed': [
            'live etcd/core health and full labctl consistency audit',
            'resource capacity and usage fit for the requested replicas',
            'runtime identity and HTTP readiness on the selected worker',
            'remote create/reply-loss reconciliation and cleanup execution',
        ],
        'current_revision': current,
        'older_owned_revisions': sorted(prior, key=lambda item: item['id']),
        'deploy_argv': deploy_argv,
        'eru_spec': render_eru_spec(spec, spec_hash, appname),
        'steps': [
            'Re-read desired revision and exact app ownership before any create',
            'For deploy_revision, create only this immutable appname and verify exact owner/digest/count/node',
            'Probe the declared private HTTP endpoint before promoting the new revision',
            'Keep older owned revisions until replacement readiness is independently established',
            'Require a separate exact-ID cleanup plan for older revisions',
        ],
    }
    plan['plan_sha256'] = sha256(canonical_bytes(plan))
    return plan
