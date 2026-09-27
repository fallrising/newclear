"""Pure ERU-015 full-cluster fresh-rebuild review-plan validation.

The resulting plan describes one future destructive rebuild.  It never grants
execution authority and contains no provider, SSH, etcd, or workload mutation.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
import re

from app_desired import canonical_bytes, spec_identity


ALIASES = tuple(f'ckc-disposable-{index:02d}' for index in range(1, 5))
TOPOLOGY = tuple(
    (alias, f'worker-{index}', 'core' if index == 1 else 'worker')
    for index, alias in enumerate(ALIASES, 1)
)
TOP_FIELDS = {
    'schema_version', 'mode', 'topology_profile', 'series',
    'expected_cluster', 'controller_report', 'inventory', 'host_intents',
    'fresh_etcd', 'external_materials', 'desired_apps',
    'writer_quiescence_review', 'data_disposition_review',
}
MATERIALS = {
    'bootstrap_secrets', 'provider_console_access', 'external_evidence_store',
}
ACCEPTANCE_CHECKS = {
    'V01', 'V02', 'V03', 'V04', 'residual_node_workload_plugin_capacity',
}
SHA256 = re.compile(r'^[0-9a-f]{64}$')
IDENTIFIER = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$')


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


def _timestamp(value, label, now, *, maximum_age_days=30):
    if not isinstance(value, str):
        raise ValueError(label + ' must be a timezone-aware ISO-8601 timestamp')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError(label + ' must be a valid ISO-8601 timestamp') from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(label + ' must include a timezone')
    age = (now - parsed.astimezone(timezone.utc)).total_seconds()
    if not 0 <= age <= maximum_age_days * 24 * 60 * 60:
        raise ValueError(label + ' is outside the allowed review window')
    return parsed.astimezone(timezone.utc).isoformat()


def _path_binding(value, label):
    if not isinstance(value, dict) or set(value) != {'path', 'sha256'}:
        raise ValueError(label + ' must contain exactly path and sha256')
    if not isinstance(value['path'], str) or not value['path']:
        raise ValueError(label + ' path must be non-empty')
    return {'path': value['path'], 'sha256': _sha(value['sha256'], label + ' sha256')}


def _series(value, generation_before, previous_proof):
    if not isinstance(value, dict) or set(value) != {
            'id', 'required_successes', 'iteration', 'previous_accepted_run'}:
        raise ValueError('series must contain the exact ERU-015 campaign fields')
    series_id = _identifier(value['id'], 'series id')
    if type(value['required_successes']) is not int or value['required_successes'] != 3:
        raise ValueError('fresh rebuild series requires exactly three successes')
    iteration = value['iteration']
    if type(iteration) is not int or not 1 <= iteration <= 3:
        raise ValueError('series iteration must be 1, 2 or 3')
    previous = value['previous_accepted_run']
    if iteration == 1:
        if previous is not None or previous_proof is not None:
            raise ValueError('series iteration 1 cannot claim a previous accepted run')
    else:
        if not isinstance(previous, dict) or set(previous) != {
                'id', 'plan_sha256', 'generation', 'acceptance'}:
            raise ValueError('later series iterations require one exact previous accepted run')
        reference = {
            'id': _identifier(previous['id'], 'previous accepted run id'),
            'plan_sha256': _sha(previous['plan_sha256'], 'previous accepted plan sha256'),
            'generation': previous['generation'],
            'acceptance': _path_binding(previous['acceptance'], 'previous acceptance'),
        }
        if type(reference['generation']) is not int or reference['generation'] != generation_before:
            raise ValueError('previous accepted run generation must equal the current generation')
        if not isinstance(previous_proof, dict) or set(previous_proof) != {
                'review_plan', 'review_path', 'acceptance', 'acceptance_path',
                'acceptance_sha256'}:
            raise ValueError('previous accepted run proof is missing')
        envelope = previous_proof['review_plan']
        if not isinstance(envelope, dict) or set(envelope) != {'plan', 'sha256'}:
            raise ValueError('previous review plan envelope is malformed')
        prior_plan = envelope['plan']
        if (not isinstance(prior_plan, dict)
                or envelope['sha256'] != plan_digest(prior_plan)
                or envelope['sha256'] != reference['plan_sha256']
                or prior_plan.get('id') != reference['id']
                or prior_plan.get('operation') != 'full-cluster-fresh-rebuild-review-plan'
                or prior_plan.get('mode') != 'fresh'
                or prior_plan.get('generation_after') != generation_before
                or prior_plan.get('executable') is not False
                or prior_plan.get('execution_implemented') is not False
                or prior_plan.get('series', {}).get('id') != series_id
                or prior_plan.get('series', {}).get('iteration') != iteration - 1):
            raise ValueError('previous review plan does not match the immediate campaign predecessor')
        acceptance = previous_proof['acceptance']
        accepted_fields = {
            'schema_version', 'operation', 'status', 'plan_id', 'plan_sha256',
            'cluster_id', 'generation', 'series_id', 'iteration', 'checks',
            'rto', 'evidence_index_sha256',
        }
        if not isinstance(acceptance, dict) or set(acceptance) != accepted_fields:
            raise ValueError('previous accepted run evidence is malformed')
        checks = acceptance['checks']
        rto = acceptance['rto']
        if (type(acceptance['schema_version']) is not int
                or acceptance['schema_version'] != 1
                or acceptance['operation'] != 'full-cluster-fresh-rebuild-acceptance'
                or acceptance['status'] != 'accepted'
                or acceptance['plan_id'] != reference['id']
                or acceptance['plan_sha256'] != reference['plan_sha256']
                or acceptance['cluster_id'] != 'eru-vps-mvp'
                or type(acceptance['generation']) is not int
                or acceptance['generation'] != generation_before
                or acceptance['series_id'] != series_id
                or type(acceptance['iteration']) is not int
                or acceptance['iteration'] != iteration - 1
                or not isinstance(checks, dict) or set(checks) != ACCEPTANCE_CHECKS
                or any(result != 'passed' for result in checks.values())
                or not isinstance(rto, dict) or set(rto) != {
                    'total_seconds', 'provider_queue_seconds',
                    'installation_seconds', 'candidate_seconds'}
                or any(type(rto[name]) not in (int, float)
                       or not math.isfinite(rto[name]) or rto[name] < 0
                       for name in ('total_seconds', 'provider_queue_seconds',
                                    'installation_seconds'))
                or type(rto['candidate_seconds']) is not int
                or rto['candidate_seconds'] != 30 * 60):
            raise ValueError('previous accepted run did not pass the required fresh-rebuild gates')
        _sha(acceptance['evidence_index_sha256'], 'previous evidence index sha256')
        if (previous_proof['acceptance_path'] != reference['acceptance']['path']
                or previous_proof['acceptance_sha256'] != reference['acceptance']['sha256']):
            raise ValueError('previous acceptance binding changed during validation')
        previous = {
            **reference,
            'review_plan_path': previous_proof['review_path'],
            'rto': rto,
            'evidence_index_sha256': acceptance['evidence_index_sha256'],
        }
    return {
        'id': series_id, 'required_successes': 3, 'iteration': iteration,
        'previous_accepted_run': previous,
    }


def _review(value, label, now, blockers, confirmation):
    if not isinstance(value, dict) or set(value) != {confirmation, 'reviewed_at', 'evidence_sha256'}:
        raise ValueError(label + ' must contain the exact review fields')
    confirmed = value[confirmation]
    if type(confirmed) is not bool:
        raise ValueError(label + ' confirmation must be boolean')
    normalized = {
        confirmation: confirmed,
        'reviewed_at': _timestamp(value['reviewed_at'], label + ' reviewed_at', now),
        'evidence_sha256': _sha(value['evidence_sha256'], label + ' evidence_sha256'),
    }
    if not confirmed:
        blockers.append(label + ' is not confirmed')
    return normalized


def _materials(value, blockers):
    if not isinstance(value, dict) or set(value) != MATERIALS:
        raise ValueError('external_materials must name the exact required external bundles')
    result = {}
    for name in sorted(MATERIALS):
        item = value[name]
        if not isinstance(item, dict) or set(item) != {'available', 'evidence_sha256'}:
            raise ValueError('external material must contain available and evidence_sha256')
        if type(item['available']) is not bool:
            raise ValueError('external material availability must be boolean')
        result[name] = {
            'available': item['available'],
            'evidence_sha256': _sha(item['evidence_sha256'], name + ' evidence_sha256'),
        }
        if not item['available']:
            blockers.append('external material is unavailable: ' + name)
    return result


def _controller(report, bindings, now, blockers):
    if not isinstance(report, dict):
        raise ValueError('controller report must be an object')
    try:
        checked_at = _timestamp(
            report['checked_at'], 'controller report checked_at', now,
            maximum_age_days=1)
        source = report['source']
        locks = report['locks']
    except KeyError as exc:
        raise ValueError('controller report is missing required readiness fields') from exc
    if not isinstance(source, dict) or not isinstance(locks, dict):
        raise ValueError('controller report source and locks must be objects')
    commit = source.get('commit')
    if not isinstance(commit, str) or not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('controller report source commit is invalid')
    project_clean = source.get('project_clean')
    if type(project_clean) is not bool:
        raise ValueError('controller report source cleanliness is invalid')
    expected_locks = {
        'artifact_sha256': bindings['artifacts_lock_sha256'],
        'upstream_sha256': bindings['upstream_lock_sha256'],
        'core_validation_sha256': bindings['core_validation_sha256'],
    }
    if any(locks.get(name) != expected for name, expected in expected_locks.items()):
        raise ValueError('controller report lock bindings differ from current files')
    current_source = bindings.get('current_source')
    if (not isinstance(current_source, dict)
            or set(current_source) != {'commit', 'project_clean'}
            or current_source.get('commit') != commit
            or current_source.get('project_clean') is not True):
        raise ValueError('controller source commit or cleanliness changed after preflight')
    ready = report.get('ready_for_review')
    report_blockers = report.get('blockers')
    if type(ready) is not bool or not isinstance(report_blockers, list) or any(
            not isinstance(item, str) for item in report_blockers):
        raise ValueError('controller report readiness is malformed')
    if not ready or report_blockers:
        blockers.append('controller report is not ready for review')
    if not project_clean:
        blockers.append('controller report did not observe clean project source')
    return {
        'checked_at': checked_at,
        'ready_for_review': ready,
        'source_commit': commit,
        'project_clean': project_clean,
        'lock_digests': expected_locks,
        'reported_blocker_count': len(report_blockers),
    }


def build_plan(document, *, inventory, cluster, host_intents, controller_report,
               bindings, plan_id, now=None, previous_accepted=None):
    """Build one immutable, non-executable fresh rebuild review plan."""
    current = now or datetime.now(timezone.utc)
    if not isinstance(document, dict) or set(document) != TOP_FIELDS:
        raise ValueError('fresh rebuild input must contain exactly the reviewed schema fields')
    if type(document['schema_version']) is not int or document['schema_version'] != 1:
        raise ValueError('unsupported fresh rebuild input schema')
    if document['mode'] != 'fresh':
        raise ValueError('ERU-015 accepts fresh mode only; restore-control is separate')
    if document['topology_profile'] != 'profile-a-four-host-basic':
        raise ValueError('only the reviewed Profile A four-host topology is supported')
    if not isinstance(cluster, dict) or cluster.get('cluster_id') != 'eru-vps-mvp':
        raise ValueError('current cluster identity is invalid')
    generation_before = cluster.get('generation')
    if type(generation_before) is not int or generation_before < 1:
        raise ValueError('current cluster generation is invalid')
    expected = document['expected_cluster']
    if (not isinstance(expected, dict)
            or set(expected) != {'cluster_id', 'generation'}
            or expected != {'cluster_id': 'eru-vps-mvp', 'generation': generation_before}):
        raise ValueError('expected cluster must match the current cluster and generation')
    controller_source = _path_binding(document['controller_report'], 'controller_report')
    inventory_source = _path_binding(document['inventory'], 'inventory')
    if controller_source != bindings.get('controller_report'):
        raise ValueError('controller report binding differs from the validated private record')
    if inventory_source != bindings.get('inventory'):
        raise ValueError('inventory binding differs from the validated private record')

    if (not isinstance(inventory, list) or len(inventory) != 4
            or any(not isinstance(row, dict) for row in inventory)):
        raise ValueError('inventory must contain exactly four host objects')
    actual_topology = tuple((row.get('alias'), row.get('node'), row.get('role')) for row in inventory)
    if actual_topology != TOPOLOGY:
        raise ValueError('inventory differs from the reviewed Profile A topology')
    if any(set(row) != {'alias', 'node', 'role', 'ip'} for row in inventory):
        raise ValueError('inventory rows must contain exactly alias, node, role and ip')

    blockers = []
    series = _series(document['series'], generation_before, previous_accepted)
    controller_binding = _controller(controller_report, bindings, current, blockers)
    external = _materials(document['external_materials'], blockers)
    writer_review = _review(
        document['writer_quiescence_review'], 'writer quiescence review', current,
        blockers, 'confirmed')
    data_review = _review(
        document['data_disposition_review'], 'data disposition review', current,
        blockers, 'confirmed_discardable')

    fresh = document['fresh_etcd']
    if not isinstance(fresh, dict) or set(fresh) != {
            'mode', 'restore_source', 'prior_token_sha256', 'target_token_sha256'}:
        raise ValueError('fresh_etcd must contain the exact empty-cluster fields')
    if fresh['mode'] != 'new-empty' or fresh['restore_source'] is not None:
        raise ValueError('fresh rebuild cannot import a snapshot or existing etcd state')
    prior_token = _sha(fresh['prior_token_sha256'], 'prior etcd token sha256')
    target_token = _sha(fresh['target_token_sha256'], 'target etcd token sha256')
    if prior_token == target_token:
        raise ValueError('fresh rebuild requires a new etcd cluster token')

    if not isinstance(host_intents, list) or len(host_intents) != 4:
        raise ValueError('exactly four validated host intents are required')
    scope = []
    resources = set()
    volumes = set()
    os_images = set()
    for topology, inventory_row, record in zip(TOPOLOGY, inventory, host_intents):
        if not isinstance(record, dict) or set(record) != {'intent', 'path', 'sha256'}:
            raise ValueError('validated host intent record is malformed')
        intent = record['intent']
        target = intent.get('target') if isinstance(intent, dict) else None
        alias, node, role = topology
        if target != {'alias': alias, 'node': node, 'machine_id': target.get('machine_id') if isinstance(target, dict) else None}:
            raise ValueError('host intent order or target differs from reviewed topology')
        provider_ref = intent['provider_resource_ref']
        if provider_ref in resources:
            raise ValueError('provider resource references must be unique across all hosts')
        resources.add(provider_ref)
        erase = intent['erase_scope']
        host_volumes = [erase['boot_volume_ref'], *erase['additional_volume_refs']]
        if any(volume in volumes for volume in host_volumes):
            raise ValueError('volume references must be unique across all hosts')
        volumes.update(host_volumes)
        os_images.add(intent['os_image_ref'])
        scope.append({
            'alias': alias, 'node': node, 'role': role,
            'inventory_ip': inventory_row['ip'],
            'provider_api_used': False,
            'provider_resource_ref': provider_ref,
            'os_image_ref': intent['os_image_ref'],
            'current_machine_id': target['machine_id'],
            'erase_scope': erase,
            'reviewed_at': intent['reviewed_at'],
            'source': {'path': record['path'], 'sha256': record['sha256']},
        })
    if len(os_images) != 1:
        raise ValueError('all four hosts must use the same reviewed OS image')

    apps = document['desired_apps']
    if not isinstance(apps, list) or not apps:
        raise ValueError('desired_apps must be a non-empty list')
    normalized_apps = []
    logical_names = set()
    for app in apps:
        spec, spec_hash, appname = spec_identity(app)
        if spec['name'] in logical_names:
            raise ValueError('desired app logical names must be unique')
        logical_names.add(spec['name'])
        normalized_apps.append({
            'logical_app': spec['name'], 'spec': spec,
            'spec_sha256': spec_hash, 'appname': appname,
        })
    normalized_apps.sort(key=lambda row: row['logical_app'])
    desired_apps_sha256 = sha256_bytes(canonical_bytes(normalized_apps))
    campaign_binding = {
        'topology_profile': 'profile-a-four-host-basic',
        'source_commit': controller_binding['source_commit'],
        'artifacts_lock_sha256': bindings['artifacts_lock_sha256'],
        'upstream_lock_sha256': bindings['upstream_lock_sha256'],
        'core_validation_sha256': bindings['core_validation_sha256'],
        'host_scope': [
            {key: host[key] for key in (
                'alias', 'node', 'role', 'provider_resource_ref', 'os_image_ref',
                'erase_scope')}
            for host in scope
        ],
        'desired_apps_sha256': desired_apps_sha256,
    }
    campaign_sha256 = sha256_bytes(canonical_bytes(campaign_binding))
    if previous_accepted is not None:
        previous_plan = previous_accepted['review_plan']['plan']
        if (previous_plan.get('decision') != 'reviewable'
                or previous_plan.get('blockers') != []):
            raise ValueError('previous fresh rebuild plan was not reviewable')
        if previous_plan.get('campaign_sha256') != campaign_sha256:
            raise ValueError('fresh rebuild campaign version, scope or desired manifests changed')
        if previous_plan.get('fresh_policy', {}).get('target_token_sha256') != prior_token:
            raise ValueError('fresh rebuild token lineage does not continue from the predecessor')

    stages = [
        ('controller-ready', False,
         ['controller-report', 'source-commit', 'artifact-locks', 'external-materials']),
        ('scope-reviewed', False,
         ['four-host-intents', 'provider-and-volume-scope', 'data-disposition-review']),
        ('writers-quiesced', False,
         ['writer-stop-receipt', 'in-flight-operations-zero']),
        ('generation-started', False,
         ['external-journal-consumes-generation-after', 'plan-id-and-sha256']),
        ('hosts-reimaged', True,
         ['four-owner-receipts', 'new-machine-and-boot-identities',
          'new-host-keys', 'os-image-and-volume-results']),
        ('network-and-access-ready', True,
         ['four-private-endpoints', 'strict-ssh-trust', 'firewall-policy']),
        ('empty-control-plane', True,
         ['empty-etcd-data-roots', 'new-cluster-token', 'no-snapshot-restore',
          'empty-core-and-plugin-keyspace']),
        ('cluster-bootstrapped', True,
         ['pinned-source-and-artifacts', 'V01-command-results', 'V01-duration']),
        ('apps-replayed', True,
         ['fresh-ERU-012-plans', 'exact-replicas-and-labels', 'V02', 'V03-http']),
        ('resources-accepted', True,
         ['V04-over-capacity-rejection', 'V04-remove', 'zero-residual-quota']),
        ('residue-audited', False,
         ['old-machine-node-workload-identities-absent',
          'old-plugin-capacity-absent', 'unexpected-data-roots-absent']),
        ('generation-accepted', False,
         ['all-prior-gates', 'rto-components', 'generation-commit-once',
          'immutable-evidence-index']),
    ]
    plan = {
        'schema_version': 1,
        'id': _identifier(plan_id, 'fresh rebuild plan id'),
        'created_at': current.isoformat(),
        'operation': 'full-cluster-fresh-rebuild-review-plan',
        'mode': 'fresh',
        'topology_profile': 'profile-a-four-host-basic',
        'series': series,
        'campaign_sha256': campaign_sha256,
        'cluster_id': 'eru-vps-mvp',
        'generation_before': generation_before,
        'generation_after': generation_before + 1,
        'scope': {
            'hosts': scope,
            'host_count': 4,
            'volume_count': len(volumes),
            'scope_sha256': sha256_bytes(canonical_bytes(scope)),
        },
        'bindings': {
            **bindings,
            'controller': controller_binding,
            'writer_quiescence_review': writer_review,
            'data_disposition_review': data_review,
            'external_materials': external,
        },
        'fresh_policy': {
            'etcd_mode': 'new-empty',
            'prior_token_sha256': prior_token,
            'target_token_sha256': target_token,
            'restore_allowed': False,
            'restore_source': None,
            'existing_etcd_allowed': False,
            'existing_runtime_authoritative': False,
            'old_metadata_import_allowed': False,
            'app_source': 'versioned-desired-specs-only',
        },
        'desired_apps': normalized_apps,
        'desired_apps_sha256': desired_apps_sha256,
        'stages': [
            {
                'stage': name, 'implemented': False, 'executable': False,
                'destructive': destructive, 'host_scope': list(ALIASES),
                'prerequisites': [] if index == 0 else [stages[index - 1][0]],
                'required_evidence': evidence,
                'evidence_status': 'checks_not_performed',
            }
            for index, (name, destructive, evidence) in enumerate(stages)
        ],
        'acceptance': {
            'V01': 'checks_not_performed',
            'V02': 'checks_not_performed',
            'V03': 'checks_not_performed',
            'V04': 'checks_not_performed',
            'residual_node_workload_plugin_capacity': 'checks_not_performed',
            'rto_candidate_seconds': 30 * 60,
            'rto_status': 'checks_not_performed',
            'required_consecutive_successes': 3,
        },
        'decision': 'blocked' if blockers else 'reviewable',
        'blockers': blockers,
        'executable': False,
        'execution_implemented': False,
        'remote_mutation_performed': False,
        'checks_not_performed': ['V01', 'V02', 'V03', 'V04', 'V08'],
    }
    return plan
