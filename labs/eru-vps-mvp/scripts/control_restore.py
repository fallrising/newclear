"""Validation for ERU-016 control-metadata restore review plans.

This module only builds an immutable description of a possible future restore.
It cannot capture or restore etcd, start services, reconcile workers, or advance
the accepted cluster generation.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import re

from app_desired import canonical_bytes


ALIASES = tuple(f'ckc-disposable-{index:02d}' for index in range(1, 5))
TOPOLOGY = tuple(
    (alias, f'worker-{index}', 'core' if index == 1 else 'worker')
    for index, alias in enumerate(ALIASES, 1)
)
TOP_FIELDS = {
    'schema_version', 'mode', 'topology_profile', 'expected_cluster',
    'controller_report', 'inventory', 'cluster_record',
    'source_cluster_snapshot', 'snapshot', 'writer_quiescence',
    'old_control_plane', 'target_etcd', 'revision_policy',
    'retained_workers', 'reconciliation', 'objectives', 'evidence_store',
    'application_volume_restore',
}
SHA256 = re.compile(r'^[0-9a-f]{64}$')
ETCD_HASH = re.compile(r'^[0-9a-f]{8}$')
IDENTIFIER = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$')
ETCD_VERSION = re.compile(r'^v3\.6\.\d+$')
RPO_CANDIDATE_SECONDS = 15 * 60
RTO_CANDIDATE_SECONDS = 30 * 60


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def plan_digest(plan):
    return sha256_bytes(canonical_bytes(plan))


def _sha(value, label):
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise ValueError(label + ' must be 64 lowercase hex digits')
    return value


def _identifier(value, label):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError(label + ' must be a bounded identifier')
    return value


def _exact(value, fields, label):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ValueError(label + ' must contain exactly the reviewed fields')
    return value


def _timestamp(value, label, now, *, maximum_age_days=30, future_ok=False):
    if not isinstance(value, str):
        raise ValueError(label + ' must be a timezone-aware ISO-8601 timestamp')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError(label + ' must be a valid ISO-8601 timestamp') from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(label + ' must include a timezone')
    parsed = parsed.astimezone(timezone.utc)
    age = (now - parsed).total_seconds()
    if (not future_ok and age < 0) or age > maximum_age_days * 24 * 60 * 60:
        raise ValueError(label + ' is outside the allowed review window')
    return parsed


def _binding(value, label):
    _exact(value, {'path', 'sha256'}, label)
    if not isinstance(value['path'], str) or not value['path']:
        raise ValueError(label + ' path must be non-empty')
    return {'path': value['path'], 'sha256': _sha(value['sha256'], label + ' sha256')}


def _boolean(value, label):
    if type(value) is not bool:
        raise ValueError(label + ' must be boolean')
    return value


def _controller(report, bindings, now, blockers):
    if not isinstance(report, dict):
        raise ValueError('controller report must be an object')
    try:
        checked = _timestamp(
            report['checked_at'], 'controller report checked_at', now,
            maximum_age_days=1)
        source = report['source']
        locks = report['locks']
    except KeyError as exc:
        raise ValueError('controller report is missing readiness fields') from exc
    _exact(source, {'commit', 'project_clean'}, 'controller report source')
    if not isinstance(source['commit'], str) or not re.fullmatch(r'[0-9a-f]{40}', source['commit']):
        raise ValueError('controller report source commit is invalid')
    _boolean(source['project_clean'], 'controller report source cleanliness')
    expected_locks = {
        'artifact_sha256': bindings['artifacts_lock_sha256'],
        'upstream_sha256': bindings['upstream_lock_sha256'],
        'core_validation_sha256': bindings['core_validation_sha256'],
        'restore_trust_sha256': bindings['restore_trust_sha256'],
    }
    if not isinstance(locks, dict) or any(
            locks.get(name) != value for name, value in expected_locks.items()):
        raise ValueError('controller report lock bindings differ from current files')
    current_source = bindings.get('current_source')
    if (not isinstance(current_source, dict)
            or current_source != {'commit': source['commit'], 'project_clean': True}):
        raise ValueError('controller source commit or cleanliness changed after preflight')
    ready = report.get('ready_for_review')
    report_blockers = report.get('blockers')
    if type(ready) is not bool or not isinstance(report_blockers, list) or any(
            not isinstance(item, str) for item in report_blockers):
        raise ValueError('controller report readiness is malformed')
    if not ready or report_blockers or not source['project_clean']:
        blockers.add('controller-not-ready')
    return {
        'checked_at': checked.isoformat(), 'ready_for_review': ready,
        'source_commit': source['commit'], 'project_clean': source['project_clean'],
        'lock_digests': expected_locks,
        'reported_blocker_count': len(report_blockers),
    }


def _snapshot(document, loaded, now, blockers):
    snapshot = _exact(document, {
        'path', 'sha256', 'size_bytes', 'capture_method', 'full_keyspace',
        'capture_started_at', 'capture_completed_at',
        'source_endpoint_evidence_sha256', 'status_evidence', 'toolchain',
        'external_copy',
    }, 'snapshot')
    if snapshot['capture_method'] != 'etcdctl-snapshot-save':
        raise ValueError('only etcdctl snapshot save full-keyspace captures are accepted')
    if snapshot['full_keyspace'] is not True:
        raise ValueError('snapshot must be a full-keyspace capture')
    if snapshot['sha256'] != loaded['snapshot_sha256']:
        raise ValueError('snapshot bytes changed or do not match the reviewed SHA-256')
    if type(snapshot['size_bytes']) is not int or snapshot['size_bytes'] != loaded['snapshot_size']:
        raise ValueError('snapshot byte size differs from the reviewed file')
    _sha(snapshot['source_endpoint_evidence_sha256'], 'source endpoint evidence sha256')
    started = _timestamp(snapshot['capture_started_at'], 'snapshot capture started_at', now)
    completed = _timestamp(snapshot['capture_completed_at'], 'snapshot capture completed_at', now)
    if completed < started:
        raise ValueError('snapshot capture chronology is invalid')

    status = loaded['status']
    _exact(status, {
        'schema_version', 'operation', 'snapshot_sha256', 'snapshot_hash',
        'revision', 'total_keys', 'total_size_bytes', 'checked_at',
        'etcdutl_sha256',
    }, 'snapshot status evidence')
    if (status['schema_version'] != 1
            or status['operation'] != 'etcdutl-snapshot-status'
            or status['snapshot_sha256'] != loaded['snapshot_sha256']
            or status['total_size_bytes'] != loaded['snapshot_size']):
        raise ValueError('snapshot status evidence does not describe the reviewed bytes')
    if not isinstance(status['snapshot_hash'], str) or not ETCD_HASH.fullmatch(status['snapshot_hash']):
        raise ValueError('snapshot status hash is invalid')
    if type(status['revision']) is not int or status['revision'] < 1:
        raise ValueError('snapshot revision must be positive')
    if type(status['total_keys']) is not int or status['total_keys'] < 1:
        raise ValueError('snapshot total key count must be positive')
    status_checked = _timestamp(status['checked_at'], 'snapshot status checked_at', now)
    if status_checked < completed:
        raise ValueError('snapshot status cannot predate capture completion')

    toolchain = _exact(snapshot['toolchain'], {
        'etcd_version', 'artifact_release_sha256', 'etcd_sha256',
        'etcdctl_sha256', 'etcdutl_sha256', 'verified',
    }, 'snapshot toolchain')
    if not isinstance(toolchain['etcd_version'], str) or not ETCD_VERSION.fullmatch(toolchain['etcd_version']):
        raise ValueError('snapshot toolchain requires an exact etcd v3.6 patch release')
    for name in ('artifact_release_sha256', 'etcd_sha256', 'etcdctl_sha256', 'etcdutl_sha256'):
        _sha(toolchain[name], 'toolchain ' + name)
    _boolean(toolchain['verified'], 'snapshot toolchain verified')
    if (toolchain['etcd_version'] != loaded['etcd_release']['tag']
            or toolchain['artifact_release_sha256'] != loaded['etcd_release']['sha256']):
        raise ValueError('snapshot toolchain differs from the pinned etcd artifact release')
    if status['etcdutl_sha256'] != toolchain['etcdutl_sha256']:
        raise ValueError('snapshot status was not produced by the reviewed etcdutl binary')
    trusted = loaded['trust_index']
    trusted_status = {
        'receipt_sha256': loaded['status_binding']['sha256'],
        'snapshot_sha256': loaded['snapshot_sha256'],
        'source_cluster_snapshot_sha256': loaded['source_cluster_snapshot_sha256'],
        'source_endpoint_evidence_sha256': snapshot['source_endpoint_evidence_sha256'],
        'capture_method': 'etcdctl-snapshot-save',
        'full_keyspace': True,
        'etcdutl_sha256': toolchain['etcdutl_sha256'],
    }
    if trusted_status not in trusted['status_receipts']:
        raise ValueError('snapshot status receipt is not anchored in the trusted restore index')
    trusted_toolchain = {
        'etcd_version': toolchain['etcd_version'],
        'artifact_release_sha256': toolchain['artifact_release_sha256'],
        'etcd_sha256': toolchain['etcd_sha256'],
        'etcdctl_sha256': toolchain['etcdctl_sha256'],
        'etcdutl_sha256': toolchain['etcdutl_sha256'],
    }
    if trusted_toolchain not in trusted['toolchains']:
        raise ValueError('etcd toolchain is not anchored in the trusted restore index')
    if not toolchain['verified']:
        blockers.add('toolchain-not-verified')

    external = _exact(snapshot['external_copy'], {
        'catalog_receipt', 'object_id_sha256', 'object_sha256', 'encrypted',
        'retained_until', 'restore_read_test_evidence_sha256',
    }, 'external snapshot copy')
    catalog = loaded['catalog']
    _exact(catalog, {
        'schema_version', 'operation', 'snapshot_sha256', 'object_sha256',
        'object_id_sha256', 'encrypted', 'retained_until',
        'restore_read_test_evidence_sha256', 'recorded_at',
    }, 'external snapshot catalog receipt')
    retained = _timestamp(external['retained_until'], 'external copy retained_until', now,
                          maximum_age_days=3650, future_ok=True)
    catalog_recorded = _timestamp(catalog['recorded_at'], 'catalog recorded_at', now)
    if catalog_recorded < completed:
        raise ValueError('external catalog receipt cannot predate capture completion')
    expected_catalog = {
        'schema_version': 1,
        'operation': 'external-snapshot-catalog-receipt',
        'snapshot_sha256': loaded['snapshot_sha256'],
        'object_sha256': _sha(external['object_sha256'], 'external object sha256'),
        'object_id_sha256': _sha(external['object_id_sha256'], 'external object id sha256'),
        'encrypted': _boolean(external['encrypted'], 'external copy encrypted'),
        'retained_until': external['retained_until'],
        'restore_read_test_evidence_sha256': _sha(
            external['restore_read_test_evidence_sha256'],
            'external restore-read evidence sha256'),
        'recorded_at': catalog['recorded_at'],
    }
    if catalog != expected_catalog or external['object_sha256'] != loaded['snapshot_sha256']:
        raise ValueError('external catalog receipt does not independently bind the snapshot copy')
    trusted_catalog = {
        'receipt_sha256': loaded['catalog_binding']['sha256'],
        'snapshot_sha256': loaded['snapshot_sha256'],
        'object_sha256': external['object_sha256'],
        'object_id_sha256': external['object_id_sha256'],
    }
    if trusted_catalog not in trusted['catalog_receipts']:
        raise ValueError('external catalog receipt is not anchored in the trusted restore index')
    if not external['encrypted'] or retained <= now:
        blockers.add('external-copy-unavailable')
    return {
        'source': {'path': loaded['snapshot_path'], 'sha256': loaded['snapshot_sha256']},
        'size_bytes': loaded['snapshot_size'],
        'capture_method': snapshot['capture_method'], 'full_keyspace': True,
        'capture_started_at': started.isoformat(),
        'capture_completed_at': completed.isoformat(),
        'source_endpoint_evidence_sha256': snapshot['source_endpoint_evidence_sha256'],
        'status': {
            'source': loaded['status_binding'], 'snapshot_hash': status['snapshot_hash'],
            'revision': status['revision'], 'total_keys': status['total_keys'],
            'total_size_bytes': status['total_size_bytes'],
            'checked_at': status_checked.isoformat(),
        },
        'toolchain': dict(toolchain),
        'external_copy': {
            'catalog_receipt': loaded['catalog_binding'],
            'object_id_sha256': external['object_id_sha256'],
            'object_sha256': external['object_sha256'],
            'encrypted': external['encrypted'],
            'retained_until': retained.isoformat(),
            'restore_read_test_evidence_sha256': external['restore_read_test_evidence_sha256'],
        },
    }, started, completed


def build_plan(document, *, inventory, cluster, controller_report,
               source_snapshot, loaded, bindings, plan_id, now=None):
    """Build one non-executable restore review plan from pre-validated files."""
    current = now or datetime.now(timezone.utc)
    if not isinstance(document, dict) or set(document) != TOP_FIELDS:
        raise ValueError('control restore input must contain exactly the reviewed schema fields')
    if document['schema_version'] != 1:
        raise ValueError('unsupported control restore input schema')
    if document['mode'] != 'restore-control':
        raise ValueError('ERU-016 accepts restore-control mode only; fresh mode is separate')
    if document['topology_profile'] != 'profile-a-four-host-basic':
        raise ValueError('only the reviewed Profile A topology is supported')
    if document['application_volume_restore'] is not False:
        raise ValueError('control metadata restore cannot claim application-volume recovery')

    if not isinstance(cluster, dict) or set(cluster) != {'cluster_id', 'generation'}:
        raise ValueError('current cluster record is malformed')
    generation = cluster.get('generation')
    if cluster.get('cluster_id') != 'eru-vps-mvp' or type(generation) is not int or generation < 1:
        raise ValueError('current cluster identity or generation is invalid')
    if document['expected_cluster'] != {'cluster_id': 'eru-vps-mvp', 'generation': generation}:
        raise ValueError('expected cluster must match the current cluster and generation')
    for field in ('controller_report', 'inventory', 'cluster_record', 'source_cluster_snapshot'):
        if _binding(document[field], field) != bindings[field]:
            raise ValueError(field + ' binding differs from the validated private record')

    if (not isinstance(inventory, list) or len(inventory) != 4
            or tuple((row.get('alias'), row.get('node'), row.get('role'))
                     for row in inventory) != TOPOLOGY
            or any(set(row) != {'alias', 'node', 'role', 'ip'} for row in inventory)):
        raise ValueError('inventory differs from the reviewed Profile A topology')

    source = _exact(source_snapshot, {
        'schema_version', 'operation', 'cluster_id', 'generation',
        'topology_profile', 'captured_at', 'member_set_sha256',
        'cluster_id_sha256', 'token_sha256', 'data_dirs_sha256',
        'runtime_snapshot_sha256', 'node_workload_snapshot_sha256',
        'plugin_accounting_sha256', 'worker_count', 'workload_count',
        'etcd_members', 'eru_membership', 'runtime_workers', 'plugin_accounts',
    }, 'source cluster snapshot')
    if (source['schema_version'] != 1
            or source['operation'] != 'control-source-snapshot'
            or source['cluster_id'] != 'eru-vps-mvp'
            or source['generation'] != generation
            or source['topology_profile'] != 'profile-a-four-host-basic'):
        raise ValueError('source cluster snapshot differs from current generation or topology')
    _timestamp(source['captured_at'], 'source cluster snapshot captured_at', current)
    for field in ('member_set_sha256', 'cluster_id_sha256', 'token_sha256',
                  'data_dirs_sha256', 'runtime_snapshot_sha256',
                  'node_workload_snapshot_sha256', 'plugin_accounting_sha256'):
        _sha(source[field], 'source cluster snapshot ' + field)
    if source['worker_count'] != 3 or type(source['workload_count']) is not int or source['workload_count'] < 0:
        raise ValueError('source cluster snapshot worker/workload counts are invalid')
    source_members = source['etcd_members']
    if not isinstance(source_members, list) or len(source_members) != 1:
        raise ValueError('source Profile A snapshot must enumerate one etcd member')
    source_member = _exact(source_members[0], {
        'host_alias', 'node', 'member_id_sha256', 'name_sha256',
        'peer_url_sha256', 'client_url_sha256', 'data_dir_sha256',
    }, 'source etcd member')
    if (source_member['host_alias'], source_member['node']) != (
            'ckc-disposable-01', 'worker-1'):
        raise ValueError('source etcd member differs from the reviewed Profile A core host')
    for name in ('member_id_sha256', 'name_sha256', 'peer_url_sha256',
                 'client_url_sha256', 'data_dir_sha256'):
        _sha(source_member[name], 'source etcd member ' + name)
    if (source['member_set_sha256'] != sha256_bytes(canonical_bytes(source_members))
            or source['data_dirs_sha256'] != sha256_bytes(
                canonical_bytes([source_member['data_dir_sha256']]))):
        raise ValueError('source etcd member/data-dir aggregate is not derived from exact records')
    membership = _exact(
        source['eru_membership'], {'nodes', 'workloads'},
        'source Eru membership')
    nodes = membership['nodes']
    worker_names = ['worker-2', 'worker-3', 'worker-4']
    if not isinstance(nodes, list) or [row.get('name') for row in nodes] != worker_names:
        raise ValueError('source Eru membership must enumerate the exact retained workers')
    for row in nodes:
        _exact(row, {
            'name', 'podname', 'endpoint_sha256', 'available', 'bypass',
            'labels_sha256', 'resource_capacity_sha256', 'resource_usage_sha256',
        }, 'source Eru node')
        if not isinstance(row['podname'], str) or not row['podname']:
            raise ValueError('source Eru node podname is invalid')
        _boolean(row['available'], 'source Eru node available')
        _boolean(row['bypass'], 'source Eru node bypass')
        for name in ('endpoint_sha256', 'labels_sha256', 'resource_capacity_sha256',
                     'resource_usage_sha256'):
            _sha(row[name], 'source Eru node ' + name)
    workloads = membership['workloads']
    if not isinstance(workloads, list) or len(workloads) != source['workload_count']:
        raise ValueError('source Eru workloads differ from the reviewed workload count')
    workload_ids = set()
    for row in workloads:
        _exact(row, {
            'id', 'nodename', 'podname', 'image_sha256', 'labels_sha256',
        }, 'source Eru workload')
        if (not isinstance(row['id'], str) or not row['id']
                or len(row['id']) > 256 or row['id'] in workload_ids
                or row['nodename'] not in worker_names
                or not isinstance(row['podname'], str) or not row['podname']):
            raise ValueError('source Eru workload identity is invalid')
        workload_ids.add(row['id'])
        _sha(row['image_sha256'], 'source Eru workload image sha256')
        _sha(row['labels_sha256'], 'source Eru workload labels sha256')
    runtime_workers = source['runtime_workers']
    if (not isinstance(runtime_workers, list)
            or [row.get('node') for row in runtime_workers] != worker_names):
        raise ValueError('source runtime evidence must enumerate the exact retained workers')
    for row in runtime_workers:
        _exact(row, {'node', 'containers_sha256', 'tasks_sha256'}, 'source worker runtime')
        _sha(row['containers_sha256'], 'source containers sha256')
        _sha(row['tasks_sha256'], 'source tasks sha256')
    plugin_accounts = source['plugin_accounts']
    if not isinstance(plugin_accounts, list):
        raise ValueError('source plugin accounting must be a list')
    plugin_pairs = set()
    for row in plugin_accounts:
        _exact(row, {
            'plugin', 'node', 'capacity_sha256', 'usage_sha256',
        }, 'source plugin account')
        pair = (row['plugin'], row['node'])
        if (not isinstance(row['plugin'], str) or not row['plugin']
                or row['node'] not in worker_names or pair in plugin_pairs):
            raise ValueError('source plugin account identity is invalid')
        plugin_pairs.add(pair)
        _sha(row['capacity_sha256'], 'source plugin capacity sha256')
        _sha(row['usage_sha256'], 'source plugin usage sha256')
    if {(row['plugin'], row['node']) for row in plugin_accounts
            if row['plugin'] == 'resource-storage'} != {
                ('resource-storage', 'worker-2'),
                ('resource-storage', 'worker-3'),
                ('resource-storage', 'worker-4')}:
        raise ValueError('source plugin accounting must cover every retained worker')
    expected_evidence_digests = {
        'runtime_snapshot_sha256': sha256_bytes(canonical_bytes(runtime_workers)),
        'node_workload_snapshot_sha256': sha256_bytes(canonical_bytes(membership)),
        'plugin_accounting_sha256': sha256_bytes(canonical_bytes(plugin_accounts)),
    }
    if any(source[name] != value for name, value in expected_evidence_digests.items()):
        raise ValueError('source retained-worker evidence digest is not derived from exact records')

    blockers = set()
    controller = _controller(controller_report, bindings, current, blockers)
    snapshot, capture_started, capture_completed = _snapshot(
        document['snapshot'], loaded, current, blockers)

    quiet = _exact(document['writer_quiescence'], {
        'confirmed', 'quiesced_at', 'in_flight_zero',
        'writer_set_sha256', 'evidence_sha256',
    }, 'writer quiescence')
    _boolean(quiet['confirmed'], 'writer quiescence confirmed')
    _boolean(quiet['in_flight_zero'], 'writer quiescence in_flight_zero')
    quiesced = _timestamp(quiet['quiesced_at'], 'writer quiesced_at', current)
    for name in ('writer_set_sha256', 'evidence_sha256'):
        _sha(quiet[name], 'writer quiescence ' + name)
    if quiesced > capture_started:
        raise ValueError('writers must be quiesced before snapshot capture starts')
    if not quiet['confirmed'] or not quiet['in_flight_zero']:
        blockers.add('writers-not-quiesced')

    old = _exact(document['old_control_plane'], {
        'source_member_set_sha256', 'source_cluster_id_sha256',
        'source_token_sha256', 'source_data_dirs_sha256',
        'isolation_confirmed', 'isolated_at', 'evidence_sha256',
    }, 'old control plane')
    source_pairs = {
        'source_member_set_sha256': 'member_set_sha256',
        'source_cluster_id_sha256': 'cluster_id_sha256',
        'source_token_sha256': 'token_sha256',
        'source_data_dirs_sha256': 'data_dirs_sha256',
    }
    for old_name, source_name in source_pairs.items():
        if _sha(old[old_name], 'old control plane ' + old_name) != source[source_name]:
            raise ValueError('old control plane identity differs from the source snapshot')
    _boolean(old['isolation_confirmed'], 'old control plane isolation_confirmed')
    _sha(old['evidence_sha256'], 'old control plane evidence sha256')
    isolated_at = None
    if old['isolated_at'] is not None:
        isolated_at = _timestamp(old['isolated_at'], 'old control plane isolated_at', current)
        if isolated_at < capture_completed:
            raise ValueError('old control plane isolation cannot predate snapshot completion')
    if not old['isolation_confirmed'] or isolated_at is None:
        blockers.add('old-control-not-isolated')

    target = _exact(document['target_etcd'], {
        'members', 'initial_cluster_sha256', 'target_token_sha256',
        'target_data_dirs_sha256',
    }, 'target etcd')
    members = target['members']
    if not isinstance(members, list) or len(members) != 1:
        raise ValueError('Profile A restore requires exactly one target etcd member')
    member = _exact(members[0], {
        'host_alias', 'node', 'name_sha256', 'peer_url_sha256',
        'client_url_sha256', 'data_dir_sha256',
    }, 'target etcd member')
    if (member['host_alias'], member['node']) != ('ckc-disposable-01', 'worker-1'):
        raise ValueError('target etcd member must be bound to the reviewed Profile A core host')
    for name in ('name_sha256', 'peer_url_sha256', 'client_url_sha256', 'data_dir_sha256'):
        _sha(member[name], 'target member ' + name)
    if len({member[name] for name in (
            'name_sha256', 'peer_url_sha256', 'client_url_sha256',
            'data_dir_sha256')}) != 4:
        raise ValueError('target etcd member fields must be distinct reviewed identities')
    for name in ('initial_cluster_sha256', 'target_token_sha256', 'target_data_dirs_sha256'):
        _sha(target[name], 'target etcd ' + name)
    if target['initial_cluster_sha256'] != sha256_bytes(canonical_bytes(members)):
        raise ValueError('target initial cluster digest does not match target membership')
    if target['target_data_dirs_sha256'] != sha256_bytes(
            canonical_bytes([member['data_dir_sha256']])):
        raise ValueError('target data-dir digest does not match target member data dirs')
    if (target['target_token_sha256'] == source['token_sha256']
            or target['target_data_dirs_sha256'] == source['data_dirs_sha256']
            or member['data_dir_sha256'] == source['data_dirs_sha256']):
        raise ValueError('restore requires a new cluster token and new data directories')

    revision = _exact(document['revision_policy'], {
        'mode', 'bump_revision', 'mark_compacted', 'basis',
        'watch_consumers', 'client_restart_set_sha256',
    }, 'revision policy')
    if (revision['mode'] != 'bump-and-mark-compacted'
            or type(revision['bump_revision']) is not int
            or not 0 < revision['bump_revision'] < 2 ** 63
            or revision['mark_compacted'] is not True):
        raise ValueError('revision policy must use a positive bump and mark-compacted')
    basis = _exact(revision['basis'], {
        'snapshot_revision', 'estimated_write_rate_per_second',
        'maximum_restore_window_seconds', 'calculated_minimum_bump',
        'evidence_sha256',
    }, 'revision policy basis')
    if (type(basis['estimated_write_rate_per_second']) is not int
            or type(basis['maximum_restore_window_seconds']) is not int):
        raise ValueError('revision policy rate and restore window must be integers')
    expected_minimum = (
        basis['estimated_write_rate_per_second']
        * basis['maximum_restore_window_seconds'] + 1)
    if (basis['snapshot_revision'] != snapshot['status']['revision']
            or basis['estimated_write_rate_per_second'] < 1
            or basis['maximum_restore_window_seconds'] < 1
            or basis['calculated_minimum_bump'] != expected_minimum
            or revision['bump_revision'] < basis['calculated_minimum_bump']):
        raise ValueError('revision bump is not adequate for the reviewed status and restore window')
    _sha(basis['evidence_sha256'], 'revision policy basis evidence sha256')
    consumers = revision['watch_consumers']
    expected_consumers = sorted({
        'eru-agent', 'eru-core', *(row['plugin'] for row in plugin_accounts)})
    if (not isinstance(consumers, list)
            or [row.get('name') for row in consumers] != expected_consumers):
        raise ValueError('revision policy must enumerate every known watch/cache consumer')
    for row in consumers:
        _exact(row, {'name', 'restart_required', 'evidence_sha256'}, 'watch consumer')
        if row['restart_required'] is not True:
            raise ValueError('every known watch/cache consumer must be restarted')
        _sha(row['evidence_sha256'], 'watch consumer evidence sha256')
    expected_restart_digest = sha256_bytes(canonical_bytes(consumers))
    if revision['client_restart_set_sha256'] != expected_restart_digest:
        raise ValueError('client restart set digest differs from known consumers')

    retained = _exact(document['retained_workers'], {
        'worker_count', 'inventory_sha256', 'runtime_snapshot_sha256',
        'node_workload_snapshot_sha256', 'plugin_accounting_sha256',
    }, 'retained workers')
    expected_retained = {
        'worker_count': 3, 'inventory_sha256': bindings['inventory']['sha256'],
        'runtime_snapshot_sha256': source['runtime_snapshot_sha256'],
        'node_workload_snapshot_sha256': source['node_workload_snapshot_sha256'],
        'plugin_accounting_sha256': source['plugin_accounting_sha256'],
    }
    if retained != expected_retained:
        raise ValueError('retained worker baseline differs from source and inventory evidence')

    reconciliation = _exact(document['reconciliation'], {
        'expected_etcd_membership_sha256', 'expected_eru_membership_sha256',
        'expected_runtime_sha256',
        'expected_plugin_accounting_sha256', 'expected_http_sha256',
        'core_key_recovery_mode', 'core_key_available',
        'core_key_evidence_sha256', 'core_key_revoke_set_sha256',
    }, 'reconciliation')
    if reconciliation['expected_etcd_membership_sha256'] != target['initial_cluster_sha256']:
        raise ValueError('reconciliation etcd membership differs from target etcd membership')
    if reconciliation['expected_eru_membership_sha256'] != source['node_workload_snapshot_sha256']:
        raise ValueError('reconciliation Eru membership differs from source node/workload evidence')
    if reconciliation['expected_runtime_sha256'] != source['runtime_snapshot_sha256']:
        raise ValueError('reconciliation runtime differs from retained worker evidence')
    if reconciliation['expected_plugin_accounting_sha256'] != source['plugin_accounting_sha256']:
        raise ValueError('reconciliation plugin accounting differs from source evidence')
    _sha(reconciliation['expected_http_sha256'], 'expected HTTP evidence sha256')
    if reconciliation['core_key_recovery_mode'] not in {
            'restore-verified-external-key', 'rotate-and-revoke'}:
        raise ValueError('core key recovery mode is invalid')
    _boolean(reconciliation['core_key_available'], 'core key availability')
    _sha(reconciliation['core_key_evidence_sha256'], 'core key evidence sha256')
    _sha(reconciliation['core_key_revoke_set_sha256'], 'core key revoke set sha256')
    if not reconciliation['core_key_available']:
        blockers.add('core-key-unavailable')
    else:
        trusted_core_key = {
            'recovery_mode': reconciliation['core_key_recovery_mode'],
            'evidence_sha256': reconciliation['core_key_evidence_sha256'],
            'revoke_set_sha256': reconciliation['core_key_revoke_set_sha256'],
        }
        if trusted_core_key not in loaded['trust_index']['core_key_records']:
            raise ValueError('core key recovery is not anchored in the trusted restore index')

    objectives = _exact(document['objectives'], {
        'rpo_candidate_seconds', 'outage_cutoff_at', 'protected_through_at',
        'rto_candidate_seconds', 'rto_start_definition_sha256',
        'rto_end_definition_sha256',
    }, 'restore objectives')
    if (objectives['rpo_candidate_seconds'] != RPO_CANDIDATE_SECONDS
            or objectives['rto_candidate_seconds'] != RTO_CANDIDATE_SECONDS):
        raise ValueError('restore objectives differ from the reviewed RPO/RTO candidates')
    cutoff = _timestamp(objectives['outage_cutoff_at'], 'outage cutoff', current)
    protected = _timestamp(objectives['protected_through_at'], 'protected through', current)
    gap = max(0, int((cutoff - protected).total_seconds()))
    if gap > RPO_CANDIDATE_SECONDS:
        blockers.add('rpo-candidate-missed')
    for name in ('rto_start_definition_sha256', 'rto_end_definition_sha256'):
        _sha(objectives[name], 'restore objectives ' + name)

    evidence = _exact(document['evidence_store'], {
        'available', 'encrypted', 'retention_policy_sha256', 'evidence_sha256',
    }, 'evidence store')
    _boolean(evidence['available'], 'evidence store available')
    _boolean(evidence['encrypted'], 'evidence store encrypted')
    _sha(evidence['retention_policy_sha256'], 'evidence retention policy sha256')
    _sha(evidence['evidence_sha256'], 'evidence store evidence sha256')
    if not evidence['available'] or not evidence['encrypted']:
        blockers.add('evidence-store-unavailable')

    stage_specs = [
        ('writers-quiesced', False), ('full-snapshot-captured', False),
        ('external-copy-verified', False), ('old-control-isolated', False),
        ('target-generation-consumed', False), ('new-data-dirs-prepared', True),
        ('snapshot-restored-to-all-members', True),
        ('restore-config-written-before-start', True),
        ('new-cluster-started-and-healthy', True), ('clients-restarted', True),
        ('metadata-runtime-plugin-reconciled', True), ('http-verified', False),
        ('generation-accepted', False), ('writers-resumed', True),
    ]
    blockers_list = sorted(blockers)
    plan = {
        'schema_version': 1,
        'id': _identifier(plan_id, 'control restore plan id'),
        'created_at': current.isoformat(),
        'operation': 'control-metadata-restore-review-plan',
        'mode': 'restore-control',
        'topology_profile': 'profile-a-four-host-basic',
        'cluster_id': 'eru-vps-mvp',
        'generation_before': generation, 'generation_after': generation + 1,
        'bindings': {**bindings, 'controller': controller},
        'source_cluster': dict(source),
        'snapshot': snapshot,
        'writer_quiescence': {**quiet, 'quiesced_at': quiesced.isoformat()},
        'old_control_plane': {**old, 'isolated_at': (
            isolated_at.isoformat() if isolated_at else None)},
        'target_etcd': dict(target),
        'revision_policy': dict(revision),
        'retained_workers': dict(retained),
        'reconciliation': dict(reconciliation),
        'objectives': {
            **objectives, 'outage_cutoff_at': cutoff.isoformat(),
            'protected_through_at': protected.isoformat(),
            'candidate_rpo_seconds': gap, 'rto_status': 'checks_not_performed',
        },
        'evidence_store': dict(evidence),
        'application_volume_restore': False,
        'stages': [
            {
                'stage': name, 'implemented': False, 'executable': False,
                'destructive': destructive,
                'prerequisites': [] if index == 0 else [stage_specs[index - 1][0]],
                'evidence_status': 'checks_not_performed',
            }
            for index, (name, destructive) in enumerate(stage_specs)
        ],
        'decision': 'blocked' if blockers_list else 'reviewable',
        'blocker_codes': blockers_list,
        'executable': False, 'execution_implemented': False,
        'remote_mutation_performed': False,
        'checks_not_performed': [
            'V10', 'old-control-isolation', 'etcdutl-restore',
            'worker-runtime-plugin-reconciliation', 'HTTP', 'RPO', 'RTO'],
    }
    return plan
