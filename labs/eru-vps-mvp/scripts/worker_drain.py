"""Offline plan for draining explicitly owned ERU-012 stateless apps from one worker.

This planner never executes deployments, removals, scheduling fences, or
component reinstalls. It requires exact source specs and explicit destinations;
unknown, stale, or partially-owned workloads block the whole drain.
"""
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path
import re
import uuid

from app_desired import WORKERS, build_plan as build_app_plan, canonical_bytes
from app_desired import sha256, snapshot_binding, spec_identity

PLAN_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$')
NODE_ALIASES = {
    'worker-2': 'ckc-disposable-02',
    'worker-3': 'ckc-disposable-03',
    'worker-4': 'ckc-disposable-04',
}
MAX_APPS = 32
MAX_ISSUES = 128


def plan_digest(plan):
    unsigned = dict(plan)
    unsigned.pop('plan_sha256', None)
    return sha256(canonical_bytes(unsigned))


def build_plan(target, snapshot, desired_specs, destinations, health_ok,
               consistency_issues=(), plan_id=None):
    """Build a review-only plan to move ERU-012 apps off one nonempty worker.

    desired_specs contains the exact current v1 spec for every app on target.
    destinations explicitly maps each app's logical name to a different,
    reviewed worker. Only a complete, owned source revision may be moved.
    """
    if not isinstance(target, str) or target not in WORKERS:
        raise ValueError('target must be a reviewed worker')
    if (not isinstance(snapshot, dict)
            or not all(isinstance(snapshot.get(key), list)
                       for key in ('pods', 'nodes', 'workloads'))):
        raise ValueError('snapshot must contain pods, nodes and workloads arrays')
    if not isinstance(desired_specs, list) or not 1 <= len(desired_specs) <= MAX_APPS:
        raise ValueError('desired_specs must contain 1..32 app specs')
    if not isinstance(destinations, dict):
        raise ValueError('destinations must map logical app names to workers')
    if type(health_ok) is not bool:
        raise ValueError('health_ok must be a boolean assertion')
    if (not isinstance(consistency_issues, (list, tuple))
            or len(consistency_issues) > MAX_ISSUES
            or any(not isinstance(issue, str) or not issue for issue in consistency_issues)):
        raise ValueError('consistency_issues must be a bounded list of nonempty strings')

    plan_id = plan_id or (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-')
                          + uuid.uuid4().hex[:8])
    if not isinstance(plan_id, str) or not PLAN_ID.fullmatch(plan_id):
        raise ValueError('invalid worker drain plan ID')

    blockers = []
    if health_ok is not True:
        blockers.append('control-plane health preflight is not asserted healthy')
    if consistency_issues:
        blockers.append('cluster consistency preflight has reported issues')
    if not any(isinstance(row, dict) and row.get('name') == 'eru'
               for row in snapshot['pods']):
        blockers.append('expected eru pod is missing from snapshot')

    target_nodes = [row for row in snapshot['nodes']
                    if isinstance(row, dict) and row.get('name') == target]
    if len(target_nodes) != 1:
        blockers.append('target node identity is missing or ambiguous')
    elif target_nodes[0].get('available') is not True:
        blockers.append('target worker is not available; use the worker-loss recovery path')

    all_ids = []
    malformed_rows = 0
    target_ids = []
    for row in snapshot['workloads']:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id']:
            malformed_rows += 1
            continue
        all_ids.append(row['id'])
        if row.get('nodename') == target:
            target_ids.append(row['id'])
    if malformed_rows:
        blockers.append('workload snapshot contains malformed rows')
    if len(set(all_ids)) != len(all_ids):
        blockers.append('workload snapshot contains duplicate IDs')
    if not target_ids:
        blockers.append('target is empty; use the ordinary empty-worker reinstall path')

    normalized_specs = []
    logical_names = set()
    for document in desired_specs:
        normalized, source_hash, source_appname = spec_identity(document)
        logical = normalized['name']
        if logical in logical_names:
            raise ValueError('desired_specs contains duplicate logical app names')
        logical_names.add(logical)
        if normalized['node'] != target:
            raise ValueError('each source spec must name the drain target')
        normalized_specs.append((normalized, source_hash, source_appname))

    if set(destinations) != logical_names:
        blockers.append('destination map must name each desired app exactly once')

    moves = []
    mapped_ids = set()
    for source_spec, source_hash, source_appname in normalized_specs:
        logical = source_spec['name']
        app_blockers = []
        source_review = build_app_plan(source_spec, snapshot)
        if source_review['blockers']:
            app_blockers.extend(source_review['blockers'])
        if source_review['action'] != 'no_op':
            app_blockers.append('source app is not a complete current revision')
        source_rows = source_review['current_revision']
        source_ids = sorted(row['id'] for row in source_rows)
        if len(source_ids) != source_spec['replicas']:
            app_blockers.append('source replica count does not match desired state')
        if any(row.get('node') != target for row in source_rows):
            app_blockers.append('source revision is not entirely on the drain target')
        if source_review['older_owned_revisions']:
            app_blockers.append('older owned revisions need separate reconciliation before drain')
        if mapped_ids.intersection(source_ids):
            app_blockers.append('a source workload ID is claimed by more than one app spec')
        mapped_ids.update(source_ids)

        destination = destinations.get(logical)
        replacement = None
        if (not isinstance(destination, str) or destination not in WORKERS
                or destination == target):
            app_blockers.append('destination must be a different reviewed worker')
        else:
            replacement_spec = dict(source_spec)
            replacement_spec['node'] = destination
            replacement_review = build_app_plan(replacement_spec, snapshot)
            if replacement_review['blockers']:
                app_blockers.extend(replacement_review['blockers'])
            if replacement_review['action'] not in ('deploy_revision', 'no_op'):
                app_blockers.append('destination revision is partial or uncertain')
            expected_old = sorted(
                [{'id': row['id'], 'node': target, 'spec_sha256': source_hash}
                 for row in source_rows],
                key=lambda item: item['id'])
            if replacement_review['older_owned_revisions'] != expected_old:
                app_blockers.append(
                    'destination app has owned revisions outside the exact source revision')
            _, replacement_hash, replacement_appname = spec_identity(replacement_spec)
            replacement = {
                'node': destination,
                'spec_sha256': replacement_hash,
                'appname': replacement_appname,
                'review_action': replacement_review['action'],
                'review_plan_sha256': replacement_review['plan_sha256'],
            }

        if set(source_ids) & set(target_ids) != set(source_ids):
            app_blockers.append('source revision IDs are not present on the drain target')
        blockers.extend('app ' + logical + ': ' + reason for reason in app_blockers)
        moves.append({
            'logical_app': logical,
            'source': {
                'node': target,
                'spec_sha256': source_hash,
                'appname': source_appname,
                'workload_ids': source_ids,
                'replicas': source_spec['replicas'],
            },
            'replacement': replacement,
            'decision': 'blocked' if app_blockers else 'reviewable',
            'blockers': sorted(set(app_blockers)),
        })

    unmapped = sorted(set(target_ids) - mapped_ids)
    if unmapped:
        blockers.append('target has workloads not covered by exact current ERU-012 specs')
    duplicate_target_ids = len(set(target_ids)) != len(target_ids)
    if duplicate_target_ids:
        blockers.append('target workload list contains duplicate IDs')

    normalized_snapshot = snapshot_binding(snapshot)
    snapshot_hash = sha256(canonical_bytes(normalized_snapshot))
    result = {
        'schema_version': 1,
        'operation': 'worker-nonempty-drain-plan',
        'id': plan_id,
        'target': {'node': target, 'alias': NODE_ALIASES[target]},
        'snapshot': normalized_snapshot,
        'snapshot_sha256': snapshot_hash,
        'preflight': {
            'source': 'caller_supplied_assertion',
            'health_ok': health_ok,
            'consistency_issue_count': len(consistency_issues),
        },
        'target_workload_ids': sorted(set(target_ids)),
        'unmapped_target_workload_ids': unmapped,
        'moves': sorted(moves, key=lambda item: item['logical_app']),
        'decision': 'blocked' if blockers else 'reviewable',
        'blockers': sorted(set(blockers)),
        'executable': False,
        'execution_implemented': False,
        'steps': [
            'Recheck live health, consistency, target identity, and the hash-bound snapshot',
            'Deploy every replacement revision using the ERU-012 executor and verify exact owner, digest, replica count, destination, and HTTP readiness',
            'Keep every source revision until all replacements are ready',
            'Only then remove exact source workload IDs with the ERU-012 exact-ID cleanup flow',
            'Reconcile every removal; do not reinstall until the target has no workloads, containers, tasks, or resource usage',
            'Run the ordinary component-reinstall flow on the now-empty worker',
        ],
        'failure_policy': [
            'If any replacement create or readiness is uncertain, stop and retain all source revisions; use read-only app reconciliation',
            'If exact cleanup is partial, keep the target fenced and reconcile the listed IDs; never replay a failed plan',
            'Do not quarantine or restore worker component files until the existing empty-target guard passes',
            'This planner covers only ERU-012 stateless, digest-pinned workloads; unknown or legacy workloads block',
        ],
        'checks_not_performed': [
            'live health and consistency; the preflight values above are caller assertions',
            'resource capacity on destination workers; Eru core remains the authoritative admission check',
            'deploy, HTTP probe, exact-ID cleanup, scheduling fence, or component reinstall',
        ],
    }
    result['plan_sha256'] = plan_digest(result)
    return result


def _read_json(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError('input must be a regular JSON file no larger than 16 MiB')
    return json.loads(path.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, choices=sorted(WORKERS))
    parser.add_argument('--input', required=True,
                        help='offline JSON with snapshot, apps, destinations, health_ok, consistency_issues')
    parser.add_argument('--plan-id')
    args = parser.parse_args()
    document = _read_json(args.input)
    allowed = {'snapshot', 'apps', 'destinations', 'health_ok', 'consistency_issues'}
    if not isinstance(document, dict) or set(document) != allowed:
        parser.error('input JSON must contain exactly: ' + ', '.join(sorted(allowed)))
    plan = build_plan(args.target, document['snapshot'], document['apps'],
                      document['destinations'], document['health_ok'],
                      document['consistency_issues'], args.plan_id)
    print(json.dumps(plan, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
