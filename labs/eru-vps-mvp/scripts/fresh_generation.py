"""Exact local generation contracts and scoped, read-only historical snapshots."""
from contextlib import contextmanager
from contextvars import ContextVar
import base64
import copy
import hashlib
import math
import os
from pathlib import Path

from app_desired import canonical_bytes
from fresh_execution import exact, timestamp
from fresh_observation import public_key
from fresh_rebuild import TOPOLOGY

PATHS = ('private/deployment-plan.json', 'private/verified-host-public-keys.json',
         'private/operations/cluster.json')
_HISTORY = ContextVar('fresh_generation_verified_history', default=None)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def decode(value):
    if type(value) is not str:
        raise ValueError('generation bytes must be canonical base64')
    raw = base64.b64decode(value, validate=True)
    if base64.b64encode(raw).decode() != value:
        raise ValueError('generation bytes must be canonical base64')
    return raw


def classify(writes, current):
    """Only a prefix of the fixed writes is resumable, including all-after."""
    if not writes or len({w['path'] for w in writes}) != len(writes) or set(current) != {w['path'] for w in writes}:
        raise ValueError('generation write set differs')
    prefixes = [n for n in range(len(writes) + 1) if all(
        current[w['path']] == w['after_sha256' if i < n else 'before_sha256']
        for i, w in enumerate(writes))]
    if not prefixes:
        raise ValueError('generation files are not an exact prefix')
    n = max(prefixes)  # A byte-identical no-op cannot cause a second increment.
    return ('all-after' if n == len(writes) else 'before' if n == 0 else 'prefix', n)


def measured_timing(value):
    exact(value, {'quiesced_at', 'installation_started_at', 'v01_completed_at',
        'residue_completed_at', 'provider_queue_intervals', 'no_queue_observed',
        'total_monotonic_seconds', 'installation_monotonic_seconds'})
    start, install, ready, end = [timestamp(value[k]) for k in
        ('quiesced_at', 'installation_started_at', 'v01_completed_at', 'residue_completed_at')]
    if not start <= install <= ready <= end:
        raise ValueError('generation timing chronology differs')
    total, installation = (end-start).total_seconds(), (ready-install).total_seconds()
    for key, wall in [('total_monotonic_seconds', total), ('installation_monotonic_seconds', installation)]:
        n = value[key]
        if type(n) not in (int, float) or not math.isfinite(n) or n < 0 or abs(n-wall) > 1:
            raise ValueError('generation requires measured matching monotonic durations')
    rows = value['provider_queue_intervals']
    if type(rows) is not list or type(value['no_queue_observed']) is not bool:
        raise ValueError('provider queue evidence is unknown')
    if (not rows) != value['no_queue_observed']:
        raise ValueError('zero provider queue requires explicit observed no-queue evidence')
    intervals = []
    for row in rows:
        exact(row, {'started_at', 'completed_at'})
        a, b = timestamp(row['started_at']), timestamp(row['completed_at'])
        if not start <= a <= b <= end:
            raise ValueError('provider queue interval outside run')
        intervals.append((a, b))
    merged = []
    for a, b in sorted(intervals):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return {'total_seconds': total, 'provider_queue_seconds': sum((b-a).total_seconds() for a,b in merged),
            'installation_seconds': installation, 'candidate_seconds': 1800}


def derive_after(context, before):
    """Derive every current-state byte from verified bootstrap/network envelopes."""
    from fresh_execution_ops import _decode
    from fresh_bootstrap_render import validate_render
    review = context['review']['plan']
    bootstrap = context['bootstrap']['plan']
    network = context['network']['plan']['render']
    rendered = validate_render(bootstrap['render'])
    if rendered['inputs']['access_render'] != network:
        raise ValueError('generation bootstrap/network render differs')
    old = _decode(before[PATHS[0]])
    cluster = _decode(before[PATHS[2]])
    if (type(old) is not list or [(r.get('alias'), r.get('node'), r.get('role')) for r in old] != list(TOPOLOGY)
            or cluster.get('cluster_id') != 'eru-vps-mvp'
            or type(cluster.get('generation')) is not int or cluster['generation'] != review['generation_before']
            or review['generation_after'] != cluster['generation'] + 1):
        raise ValueError('generation current topology or generation differs')
    keys = network['controller_known_hosts'].splitlines()
    if len(keys) != 4:
        raise ValueError('generation requires four exact trust anchors')
    trusted, inventory = {}, []
    for i, (host, payload, line) in enumerate(zip(network['hosts'], rendered['hosts'], keys)):
        ip, key = line.split(' ', 1)
        if ip != host['ip'] or public_key(key) != host['host_key_sha256']:
            raise ValueError('generation trust differs from network identity')
        if (host['alias'], host['node']) != TOPOLOGY[i][:2]:
            raise ValueError('generation host topology differs')
        trusted[host['alias']] = [key]
        row = {k: v for k,v in old[i].items() if k not in ('files', 'artifacts', 'binaries', 'units')}
        row.update({k: host[k] for k in ('alias', 'node', 'ip', 'machine_id', 'boot_id', 'host_key_sha256')})
        row.update(role=TOPOLOGY[i][2], core_ip=network['hosts'][0]['ip'])
        pieces = [payload['etcd_install'], payload['core_install']] if i == 0 else [payload['agent_install']]
        files = [copy.deepcopy(f) for piece in pieces for f in piece['files']]
        files.extend(copy.deepcopy(host['files']))
        if len({f['path'] for f in files}) != len(files):
            raise ValueError('generation deployment files duplicate')
        # Deployment-plan consumers use numeric permissions, bootstrap wire uses strings.
        row['files'] = [{**f, 'mode': int(f['mode'], 8)} for f in files]
        row['artifacts'] = [copy.deepcopy(a) for piece in pieces for a in piece['artifacts']]
        row['binaries'] = [copy.deepcopy(a) for piece in pieces for a in piece['binaries']]
        inventory.append(row)
    after_cluster = {**cluster, 'generation': cluster['generation'] + 1}
    return {PATHS[0]: canonical_bytes(inventory), PATHS[1]: canonical_bytes(trusted), PATHS[2]: canonical_bytes(after_cluster)}


def _view(project):
    view = _HISTORY.get()
    if view is None or Path(project).absolute() != view['project']:
        return None
    info = (Path(project) / 'private').stat()
    if [info.st_dev, info.st_ino] != view['identity']:
        raise ValueError('generation historical private root changed')
    view['check']()
    return view


def historical_read(files, path):
    view = _view(files.project)
    if view is None:
        return None
    relative = 'private/' + '/'.join(files.parts(path))
    if relative not in view['before']:
        return None
    raw = view['before'][relative]
    if files.identity != view['identity'] or len(raw) > files.max_bytes:
        raise ValueError('generation historical read identity/limit differs')
    return raw, relative, sha(raw)


def historical_pending(project):
    view = _view(project)
    return copy.deepcopy(view['pending']) if view is not None else None


def historical_code_inputs(project, inputs):
    view = _view(project)
    if view is None:
        return inputs
    return {p: sha(view['before'][p]) if p in view['before'] else h for p,h in inputs.items()}


@contextmanager
def _physical():
    token = _HISTORY.set(None)
    try:
        yield
    finally:
        _HISTORY.reset(token)


@contextmanager
def _historical(project, before, pending, identity, check):
    token = _HISTORY.set({'project': Path(project).absolute(), 'before': before,
        'pending': pending, 'identity': identity, 'check': check})
    try:
        yield
    finally:
        _HISTORY.reset(token)
