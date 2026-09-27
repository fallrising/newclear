#!/usr/bin/env python3
"""Build a review-only ERU-010 plan after one worker is externally fenced.

The planner records V07 detection timing and binds exact stale workload and
quota state to explicit replacement workers. It never contacts a host and it
never dissociates metadata, fixes quota, deploys a replacement, or changes node
availability.
"""
from datetime import datetime, timezone
import argparse
import json
import math
from pathlib import Path
import re
import uuid

from app_desired import (OWNER, WORKERS, canonical_bytes, sha256,
                         snapshot_binding, spec_identity)
from worker_drain import MAX_APPS, MAX_ISSUES, NODE_ALIASES, PLAN_ID


FENCE_METHODS = {'network_isolation', 'provider_power_off'}
INPUT_FIELDS = {
    'snapshot', 'apps', 'destinations', 'detection', 'fence',
    'control_plane_health_ok', 'healthy_workers_ok',
    'unexpected_consistency_issues',
}
DETECTION_CANDIDATE_SECONDS = 180


def plan_digest(plan):
    unsigned = dict(plan)
    unsigned.pop('plan_sha256', None)
    return sha256(canonical_bytes(unsigned))


def _timestamp(value, field):
    if not isinstance(value, str) or not value or len(value) > 64:
        raise ValueError(field + ' must be a bounded timezone-aware timestamp')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError(field + ' must be an ISO-8601 timestamp') from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(field + ' must include a timezone')
    parsed = parsed.astimezone(timezone.utc)
    return parsed, parsed.isoformat().replace('+00:00', 'Z')


def _timing(document):
    if (not isinstance(document, dict)
            or set(document) != {'failure_started_at', 'detected_at'}):
        raise ValueError('detection must contain exactly failure_started_at and detected_at')
    started, started_text = _timestamp(
        document['failure_started_at'], 'detection.failure_started_at')
    detected, detected_text = _timestamp(
        document['detected_at'], 'detection.detected_at')
    seconds = (detected - started).total_seconds()
    if seconds < 0 or seconds > 86400:
        raise ValueError('detection interval must be from 0 through 86400 seconds')
    if not seconds.is_integer():
        raise ValueError('detection interval must resolve to whole seconds')
    seconds = int(seconds)
    return {
        'source': 'caller_supplied_incident_timestamps',
        'failure_started_at': started_text,
        'detected_at': detected_text,
        'seconds': seconds,
        'candidate_seconds': DETECTION_CANDIDATE_SECONDS,
        'within_candidate': seconds <= DETECTION_CANDIDATE_SECONDS,
    }, detected


def _fence(document, detected):
    fields = {'confirmed', 'method', 'confirmed_at', 'proof_sha256'}
    if not isinstance(document, dict) or set(document) != fields:
        raise ValueError('fence must contain exactly confirmed, method, confirmed_at and proof_sha256')
    if type(document['confirmed']) is not bool:
        raise ValueError('fence.confirmed must be a boolean')
    if document['method'] not in FENCE_METHODS:
        raise ValueError('fence.method must be provider_power_off or network_isolation')
    proof = document['proof_sha256']
    if not isinstance(proof, str) or not re.fullmatch(r'[0-9a-f]{64}', proof):
        raise ValueError('fence.proof_sha256 must be 64 lowercase hex digits')
    confirmed, confirmed_text = _timestamp(document['confirmed_at'], 'fence.confirmed_at')
    if confirmed < detected:
        raise ValueError('fence confirmation cannot precede incident detection')
    return {
        'source': 'caller_supplied_external_attestation',
        'confirmed': document['confirmed'],
        'method': document['method'],
        'confirmed_at': confirmed_text,
        'proof_sha256': proof,
    }


def _resource_usage(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError('target resource_usage is not valid JSON') from exc
    if not isinstance(value, dict):
        raise ValueError('target resource_usage must be a JSON object')

    def values(item):
        if isinstance(item, dict):
            for key in sorted(item):
                if not isinstance(key, str):
                    raise ValueError('target resource_usage contains a non-string key')
                yield from values(item[key])
        elif isinstance(item, list):
            for child in item:
                yield from values(child)
        elif isinstance(item, bool) or not isinstance(item, (int, float)):
            raise ValueError('target resource_usage contains a non-numeric value')
        elif not math.isfinite(item) or item < 0:
            raise ValueError('target resource_usage contains an invalid quantity')
        else:
            yield item

    quantities = list(values(value))
    return value, any(item != 0 for item in quantities)


def _node(snapshot, name):
    matches = [row for row in snapshot['nodes']
               if isinstance(row, dict) and row.get('name') == name]
    return matches[0] if len(matches) == 1 else None


def build_plan(target, snapshot, desired_specs, destinations, detection,
               fence, control_plane_health_ok, healthy_workers_ok,
               unexpected_consistency_issues=(), plan_id=None):
    """Bind exact stale state and external fence evidence for operator review."""
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
    if type(control_plane_health_ok) is not bool:
        raise ValueError('control_plane_health_ok must be a boolean assertion')
    if type(healthy_workers_ok) is not bool:
        raise ValueError('healthy_workers_ok must be a boolean assertion')
    if (not isinstance(unexpected_consistency_issues, (list, tuple))
            or len(unexpected_consistency_issues) > MAX_ISSUES
            or any(not isinstance(issue, str) or not issue
                   for issue in unexpected_consistency_issues)):
        raise ValueError('unexpected_consistency_issues must be a bounded list of strings')

    timing, detected_at = _timing(detection)
    fence_record = _fence(fence, detected_at)
    plan_id = plan_id or (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-')
                          + uuid.uuid4().hex[:8])
    if not isinstance(plan_id, str) or not PLAN_ID.fullmatch(plan_id):
        raise ValueError('invalid worker loss plan ID')

    blockers = []
    if control_plane_health_ok is not True:
        blockers.append('control-plane health preflight is not asserted healthy')
    if healthy_workers_ok is not True:
        blockers.append('healthy-worker preflight is not asserted clean')
    if unexpected_consistency_issues:
        blockers.append('unexpected consistency issues remain outside the lost target')
    if fence_record['confirmed'] is not True:
        blockers.append('external fence is not confirmed')
    if not any(isinstance(row, dict) and row.get('name') == 'eru'
               for row in snapshot['pods']):
        blockers.append('expected eru pod is missing from snapshot')

    target_node = _node(snapshot, target)
    target_available = target_node.get('available') if target_node else None
    target_bypass = target_node.get('bypass') if target_node else None
    if target_node is None:
        blockers.append('target node identity is missing or ambiguous')
    elif target_available is not False or target_bypass is not True:
        blockers.append('lost target must be unavailable and bypassed in control-plane state')

    usage_digest = None
    usage_nonzero = None
    if target_node is not None:
        try:
            usage, usage_nonzero = _resource_usage(target_node.get('resource_usage'))
            usage_digest = sha256(canonical_bytes(usage))
        except (TypeError, ValueError):
            blockers.append('lost target resource usage is missing or malformed')

    all_ids = []
    target_ids = []
    valid_rows = []
    for row in snapshot['workloads']:
        if (not isinstance(row, dict) or not isinstance(row.get('id'), str)
                or not row['id'] or not isinstance(row.get('labels'), dict)):
            blockers.append('workload snapshot contains malformed rows')
            continue
        valid_rows.append(row)
        all_ids.append(row['id'])
        if row.get('nodename') == target:
            target_ids.append(row['id'])
    if len(set(all_ids)) != len(all_ids):
        blockers.append('workload snapshot contains duplicate IDs')
    if not target_ids:
        blockers.append('lost target has no stale workloads for this recovery path')

    normalized_specs = []
    logical_names = set()
    for document in desired_specs:
        normalized, source_hash, source_appname = spec_identity(document)
        logical = normalized['name']
        if logical in logical_names:
            raise ValueError('desired_specs contains duplicate logical app names')
        if normalized['node'] != target:
            raise ValueError('each source spec must name the lost target')
        logical_names.add(logical)
        normalized_specs.append((normalized, source_hash, source_appname))
    if set(destinations) != logical_names:
        blockers.append('destination map must name each desired app exactly once')

    moves = []
    mapped_ids = set()
    for source_spec, source_hash, source_appname in normalized_specs:
        logical = source_spec['name']
        app_blockers = []
        source_rows = []
        conflicting_rows = []
        for row in valid_rows:
            labels = row['labels']
            claims_logical = labels.get('logical_app') == logical
            claims_release = row['id'].startswith(source_appname + '_')
            if not claims_logical and not claims_release:
                continue
            exact = (claims_logical and claims_release
                     and labels.get('owner') == OWNER
                     and labels.get('spec_sha256') == source_hash
                     and row.get('nodename') == target)
            (source_rows if exact else conflicting_rows).append(row)

        source_ids = sorted(row['id'] for row in source_rows)
        if len(source_ids) != source_spec['replicas']:
            app_blockers.append('source replica count does not match the exact desired revision')
        if conflicting_rows:
            app_blockers.append('logical app has an older or foreign revision requiring separate review')
        if mapped_ids.intersection(source_ids):
            app_blockers.append('a source workload ID is claimed by more than one app spec')
        mapped_ids.update(source_ids)

        destination = destinations.get(logical)
        replacement = None
        if (not isinstance(destination, str) or destination not in WORKERS
                or destination == target):
            app_blockers.append('destination must be a different reviewed worker')
        else:
            destination_node = _node(snapshot, destination)
            if (destination_node is None
                    or destination_node.get('available') is not True
                    or destination_node.get('bypass') is not False):
                app_blockers.append('destination worker must be available and not bypassed')
            replacement_spec = dict(source_spec, node=destination)
            _, replacement_hash, replacement_appname = spec_identity(replacement_spec)
            replacement = {
                'node': destination,
                'spec_sha256': replacement_hash,
                'appname': replacement_appname,
                'replicas': source_spec['replicas'],
            }

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
        blockers.append('lost target has workloads not covered by exact current ERU-012 specs')

    acceptance_gaps = [
        'exact stale metadata and quota reconciliation has not been executed',
        'replacement deployment and HTTP readiness have not been executed',
        'bounded VPS failure drill evidence has not been collected',
    ]
    if not timing['within_candidate']:
        acceptance_gaps.append('detection exceeded the 180 second candidate')

    normalized_snapshot = snapshot_binding(snapshot)
    result = {
        'schema_version': 1,
        'operation': 'worker-loss-recovery-review-plan',
        'id': plan_id,
        'target': {
            'node': target, 'alias': NODE_ALIASES[target],
            'available': target_available, 'bypass': target_bypass,
        },
        'detection': timing,
        'fence': fence_record,
        'snapshot': normalized_snapshot,
        'snapshot_sha256': sha256(canonical_bytes(normalized_snapshot)),
        'preflight': {
            'source': 'caller_supplied_assertions',
            'control_plane_health_ok': control_plane_health_ok,
            'healthy_workers_ok': healthy_workers_ok,
            'unexpected_consistency_issue_count': len(unexpected_consistency_issues),
        },
        'target_stale_state': {
            'workload_ids': sorted(set(target_ids)),
            'workload_count': len(set(target_ids)),
            'resource_usage_sha256': usage_digest,
            'resource_usage_nonzero': usage_nonzero,
        },
        'unmapped_target_workload_ids': unmapped,
        'moves': sorted(moves, key=lambda item: item['logical_app']),
        'decision': 'blocked' if blockers else 'reviewable',
        'blockers': sorted(set(blockers)),
        'executable': False,
        'execution_implemented': False,
        'v07_complete': False,
        'acceptance_gaps': sorted(acceptance_gaps),
        'steps': [
            'Reconfirm the external fence proof and unavailable/bypassed target before any mutation',
            'Dissociate only the hash-bound stale source workload IDs; never act on healthy-worker workloads',
            'Re-read metadata and quota; require every stale ID absent and target resource usage zero without blanket resource --fix',
            'Create each hash-bound replacement once on its explicit healthy worker and verify exact owner, digest, replica count, node, and HTTP readiness',
            'Record drill timing and final consistency evidence; do not claim automatic replica maintenance',
        ],
        'failure_policy': [
            'An absent or uncertain external fence blocks all metadata and replacement mutations',
            'Any unknown workload, partial revision, quota ambiguity, or healthy-worker drift blocks the whole plan',
            'Future execution must journal intent before exact dissociation and must reconcile uncertain replies without replay',
            'Replacement creation requires a separate live hash-bound plan after stale metadata and quota are confirmed clear',
        ],
        'checks_not_performed': [
            'provider or network fence verification; only its caller-supplied proof digest is bound',
            'live target runtime inspection, which may be unreachable after fencing',
            'metadata dissociation, node removal, quota repair, replacement deploy, or HTTP probe',
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
    parser.add_argument('--input', required=True, help='offline private worker-loss review input')
    parser.add_argument('--plan-id')
    args = parser.parse_args()
    document = _read_json(args.input)
    if not isinstance(document, dict) or set(document) != INPUT_FIELDS:
        parser.error('input JSON must contain exactly: ' + ', '.join(sorted(INPUT_FIELDS)))
    plan = build_plan(
        args.target, document['snapshot'], document['apps'], document['destinations'],
        document['detection'], document['fence'], document['control_plane_health_ok'],
        document['healthy_workers_ok'], document['unexpected_consistency_issues'],
        args.plan_id)
    print(json.dumps(plan, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
