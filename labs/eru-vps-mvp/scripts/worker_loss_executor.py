"""Hash-bound exact stale-metadata cleanup and recovery for ERU-010.

The executor assumes the lost worker was externally fenced before planning.
It dissociates only reviewed workload IDs, never repairs quota automatically,
never contacts the lost worker, and stops before replacement deployment.
"""
import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import uuid

from app_desired import WORKERS, canonical_bytes, sha256, snapshot_binding
from labops import ClusterLock, atomic_json
from worker_loss import (_resource_usage, plan_digest as review_plan_digest)


class UncertainDissociation(RuntimeError):
    """A dissociate reply or its read-only result could not be proven."""


APPNAME = re.compile(r'^erumvp[0-9a-f]{12}$')
WORKLOAD_ID = re.compile(r'^erumvp[0-9a-f]{12}_[A-Za-z0-9_-]+$')
SHA256 = re.compile(r'^[0-9a-f]{64}$')


def _now():
    return datetime.now(timezone.utc).isoformat()


def plan_digest(plan):
    unsigned = dict(plan)
    unsigned.pop('plan_sha256', None)
    return sha256(canonical_bytes(unsigned))


def _seal(plan):
    plan['plan_sha256'] = plan_digest(plan)
    return plan


def _record_digest(record):
    return sha256(canonical_bytes(record))


def _control_binding(snapshot):
    binding = snapshot_binding(snapshot)
    binding.pop('hosts_sha256', None)
    return binding


def _workload_binding(snapshot):
    rows = _control_binding(snapshot).get('workloads')
    if (not isinstance(rows, list)
            or any(not isinstance(row, dict)
                   or set(row) != {'id', 'nodename', 'labels'}
                   or not isinstance(row.get('id'), str) or not row['id']
                   for row in rows)
            or len({row['id'] for row in rows}) != len(rows)):
        raise ValueError('control-plane workload identities are malformed')
    return rows


def _node(snapshot, name):
    matches = [row for row in snapshot.get('nodes', [])
               if isinstance(row, dict) and row.get('name') == name]
    if len(matches) != 1:
        raise ValueError('worker node is missing or ambiguous')
    return matches[0]


def _node_static_digest(snapshot):
    rows = snapshot.get('nodes')
    if not isinstance(rows, list) or not rows:
        raise ValueError('control-plane node rows are missing')
    stable = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('name'), str):
            raise ValueError('control-plane node rows are malformed')
        stable.append({key: value for key, value in row.items()
                       if key != 'resource_usage'})
    return sha256(canonical_bytes(sorted(stable, key=lambda row: row['name'])))


def _target_fenced(snapshot, target):
    row = _node(snapshot, target)
    if row.get('available') is not False or row.get('bypass') is not True:
        raise ValueError('lost target is not unavailable and bypassed')
    return row


def _usage_state(snapshot, target):
    value, nonzero = _resource_usage(_node(snapshot, target).get('resource_usage'))
    return {'sha256': sha256(canonical_bytes(value)), 'nonzero': nonzero}


def _preflight(api, snapshot, target, destinations):
    result = api.preflight(snapshot, target, destinations)
    if (not isinstance(result, dict) or result.get('health_ok') is not True
            or not isinstance(result.get('consistency_issues'), list)):
        return False, {'health_ok': False, 'consistency_issue_count': None}
    clean = not result['consistency_issues']
    return clean, {
        'health_ok': True,
        'consistency_issue_count': len(result['consistency_issues']),
    }


def _review_targets(review):
    targets = []
    logical_names = set()
    workload_ids = set()
    moves = review.get('moves')
    if not isinstance(moves, list) or not moves:
        raise ValueError('worker loss review plan has no moves')
    for move in moves:
        if (not isinstance(move, dict) or move.get('decision') != 'reviewable'
                or move.get('blockers')):
            raise ValueError('worker loss review move is blocked or malformed')
        logical = move.get('logical_app')
        source = move.get('source')
        replacement = move.get('replacement')
        if (not isinstance(logical, str) or logical in logical_names
                or not isinstance(source, dict) or not isinstance(replacement, dict)
                or source.get('node') != review.get('target', {}).get('node')
                or source.get('node') not in WORKERS
                or replacement.get('node') not in WORKERS
                or replacement.get('node') == source.get('node')
                or not isinstance(source.get('spec_sha256'), str)
                or not SHA256.fullmatch(source['spec_sha256'])
                or not isinstance(source.get('appname'), str)
                or not APPNAME.fullmatch(source['appname'])
                or not isinstance(replacement.get('spec_sha256'), str)
                or not SHA256.fullmatch(replacement['spec_sha256'])
                or not isinstance(replacement.get('appname'), str)
                or not APPNAME.fullmatch(replacement['appname'])
                or replacement.get('replicas') != source.get('replicas')):
            raise ValueError('worker loss review move identity is malformed')
        logical_names.add(logical)
        ids = source.get('workload_ids')
        if (not isinstance(ids, list) or not ids
                or any(not isinstance(item, str) or not WORKLOAD_ID.fullmatch(item)
                       or not item.startswith(source['appname'] + '_') for item in ids)
                or len(set(ids)) != len(ids)
                or len(ids) != source.get('replicas')):
            raise ValueError('worker loss source IDs are malformed')
        for workload_id in ids:
            if workload_id in workload_ids:
                raise ValueError('worker loss source IDs are duplicated')
            workload_ids.add(workload_id)
            targets.append({
                'id': workload_id, 'node': source['node'],
                'logical_app': logical, 'spec_sha256': source.get('spec_sha256'),
                'appname': source.get('appname'),
            })
    if sorted(workload_ids) != sorted(
            review.get('target_stale_state', {}).get('workload_ids', [])):
        raise ValueError('review moves do not cover the exact stale target IDs')
    return sorted(targets, key=lambda row: row['id'])


def _target_matches(row, target):
    if (not isinstance(row, dict) or row.get('id') != target['id']
            or row.get('nodename') != target['node']):
        return False
    labels = row.get('labels')
    return (isinstance(labels, dict)
            and labels.get('owner') == 'eru-vps-mvp'
            and labels.get('logical_app') == target['logical_app']
            and labels.get('spec_sha256') == target['spec_sha256']
            and row['id'].startswith(target['appname'] + '_'))


def _validate_review(review):
    if (not isinstance(review, dict)
            or review.get('plan_sha256') != review_plan_digest(review)
            or review.get('operation') != 'worker-loss-recovery-review-plan'
            or review.get('decision') != 'reviewable'
            or review.get('executable') is not False
            or review.get('execution_implemented') is not False
            or review.get('blockers')
            or review.get('fence', {}).get('confirmed') is not True
            or not isinstance(review.get('fence', {}).get('proof_sha256'), str)
            or not SHA256.fullmatch(review['fence']['proof_sha256'])
            or review.get('target', {}).get('node') not in WORKERS
            or review.get('target', {}).get('available') is not False
            or review.get('target', {}).get('bypass') is not True
            or not isinstance(
                review.get('target_stale_state', {}).get('resource_usage_sha256'), str)
            or not SHA256.fullmatch(
                review['target_stale_state']['resource_usage_sha256'])):
        raise ValueError('worker loss review plan is blocked, corrupt, or malformed')
    return _review_targets(review)


def execution_plan(review, api):
    """Recheck live control-plane state without using target SSH."""
    targets = _validate_review(review)
    target = review['target']['node']
    destinations = sorted({move['replacement']['node'] for move in review['moves']})
    first = api.snapshot()
    clean, _ = _preflight(api, first, target, destinations)
    if not clean:
        raise ValueError('live worker-loss preflight is not clean')
    second = api.snapshot()
    clean, second_preflight = _preflight(api, second, target, destinations)
    if not clean or _control_binding(first) != _control_binding(second):
        raise ValueError('live control-plane snapshot is not stable and clean')
    live_binding = _control_binding(second)
    reviewed_binding = copy.deepcopy(review.get('snapshot'))
    if isinstance(reviewed_binding, dict):
        reviewed_binding.pop('hosts_sha256', None)
    if live_binding != reviewed_binding:
        raise ValueError('live control-plane state differs from the review plan')
    _target_fenced(second, target)
    usage = _usage_state(second, target)
    if usage['sha256'] != review['target_stale_state']['resource_usage_sha256']:
        raise ValueError('lost target quota differs from the review plan')
    rows = {row['id']: row for row in second['workloads']
            if isinstance(row, dict) and isinstance(row.get('id'), str)}
    if len(rows) != len(second['workloads']):
        raise ValueError('live workload rows are malformed or duplicated')
    for stale in targets:
        if not _target_matches(rows.get(stale['id']), stale):
            raise ValueError('live stale workload identity differs from review')

    return _seal({
        'schema_version': 1,
        'operation': 'worker-loss-stale-cleanup-plan',
        'id': review['id'],
        'review_plan_sha256': review['plan_sha256'],
        'target': copy.deepcopy(review['target']),
        'detection': copy.deepcopy(review['detection']),
        'fence': copy.deepcopy(review['fence']),
        'destinations': destinations,
        'targets': targets,
        'baseline': {
            'snapshot': live_binding,
            'snapshot_sha256': sha256(canonical_bytes(live_binding)),
            'node_static_sha256': _node_static_digest(second),
            'workloads': _workload_binding(second),
            'target_resource_usage_sha256': usage['sha256'],
        },
        'preflight': second_preflight,
        'decision': 'ready',
        'blockers': [],
        'executable': True,
        'execution_implemented': True,
        'steps': [
            'Recheck stable control-plane state, healthy workers, and the unavailable/bypassed target',
            'Journal intent before each exact stale workload dissociation',
            'After each reply, query the exact ID and audit the full control-plane workload identity set',
            'Require every stale ID absent and target resource usage zero without resource --fix',
            'Stop with a replacement-plan gate; do not deploy a replacement in this executor',
        ],
        'failure_policy': [
            'A plan with any journal is never replayed; use read-only reconciliation',
            'A lost reply with the exact target still visible remains uncertain',
            'Identity drift, an extra workload, healthy-worker inconsistency, or quota residue stops the run',
            'Recovery never calls dissociate and never changes quota or node state',
        ],
    })


class WorkerLossExecutor:
    def __init__(self, root, api):
        self.root = Path(root)
        self.api = api

    def run_path(self, run_id):
        from worker_drain import PLAN_ID
        if not isinstance(run_id, str) or not PLAN_ID.fullmatch(run_id):
            raise ValueError('invalid worker loss run ID')
        return self.root / 'runs' / (run_id + '.json')

    def _existing_record_path(self, category, record_id):
        """Resolve one fixed private record without following symlink components."""
        from worker_drain import PLAN_ID
        if (category not in {
                'review-plans', 'execution-plans',
                'recovery-cleanup-plans', 'runs'}
                or not isinstance(record_id, str)
                or not PLAN_ID.fullmatch(record_id)):
            raise ValueError('invalid worker loss record reference')
        project = self.root.parents[2]
        directory = self.root / category
        try:
            parts = directory.relative_to(project).parts
        except ValueError as exc:
            raise ValueError('worker loss record path escaped the project') from exc
        current = project
        for part in parts:
            current = current / part
            if current.is_symlink():
                raise ValueError('worker loss record paths may not contain symlinks')
            if not current.is_dir():
                raise ValueError('worker loss record directory is unavailable')
        path = directory / (record_id + '.json')
        if path.is_symlink() or not path.is_file():
            raise ValueError('worker loss record is unavailable')
        return path

    def _load_record(self, category, record_id):
        return json.loads(self._existing_record_path(category, record_id).read_text())

    def _save(self, path, journal):
        journal['updated_at'] = _now()
        atomic_json(path, journal)

    def _stage(self, path, journal, stage):
        journal['stage'] = stage
        journal.setdefault('events', []).append({'at': _now(), 'event': stage})
        self._save(path, journal)

    @staticmethod
    def _expected_workloads(journal, absent_ids):
        baseline = journal.get('baseline', {}).get('workloads')
        if not isinstance(baseline, list):
            raise ValueError('worker loss journal baseline is malformed')
        return [row for row in baseline if row.get('id') not in absent_ids]

    def _audit(self, snapshot, journal, absent_ids):
        clean, summary = _preflight(
            self.api, snapshot, journal['target']['node'], journal['destinations'])
        if not clean:
            raise ValueError('worker loss live preflight is not clean')
        _target_fenced(snapshot, journal['target']['node'])
        if _node_static_digest(snapshot) != journal['baseline']['node_static_sha256']:
            raise ValueError('worker node identity or fence state changed')
        if _workload_binding(snapshot) != self._expected_workloads(journal, absent_ids):
            raise ValueError('control-plane workload identities changed outside exact dissociation')
        return summary

    def _validate_recovery_derivation(
            self, plan, source_plan, source_journal, review):
        """Prove one recovery plan is an exact live-derived subset of its source."""
        source = plan.get('source')
        recovery = plan.get('recovery')
        targets = plan.get('targets')
        if (not isinstance(source, dict) or not isinstance(recovery, dict)
                or not isinstance(targets, list) or not targets
                or source.get('run_id') != source_plan.get('id')
                or source_journal.get('id') != source_plan.get('id')
                or plan.get('id') == source_plan.get('id')
                or plan.get('review_plan_id') != review.get('id')
                or plan.get('review_plan_sha256') != review.get('plan_sha256')
                or plan.get('origin_run_id') != review.get('id')
                or plan.get('target') != review.get('target')
                or plan.get('destinations') != sorted({
                    move['replacement']['node'] for move in review['moves']})
                or plan.get('fence') != review.get('fence')
                or plan.get('detection') != review.get('detection')):
            raise ValueError('worker loss recovery derivation is malformed')
        source_targets = {
            row.get('id'): row for row in source_journal.get('targets', [])
            if isinstance(row, dict)}
        states = recovery.get('target_states')
        baseline_workloads = _workload_binding(
            plan.get('baseline', {}).get('snapshot'))
        baseline_rows = {row['id']: row for row in baseline_workloads}
        if (len(source_targets) != len(source_journal.get('targets', []))
                or baseline_workloads !=
                   plan.get('baseline', {}).get('workloads')
                or not isinstance(states, list)
                or len(states) != len(source_targets)
                or any(not isinstance(row, dict)
                       or set(row) != {'workload_id', 'state'}
                       for row in states)
                or {row['workload_id'] for row in states} != set(source_targets)
                or any(row['state'] not in {'absent', 'present_exact'}
                       for row in states)
                or {row['workload_id'] for row in states
                    if row['state'] == 'present_exact'} !=
                   {row.get('id') for row in targets}
                or any(not isinstance(row, dict)
                       or source_targets.get(row.get('id')) != row
                       for row in targets)
                or any(
                    (_target_matches(
                        baseline_rows.get(row['workload_id']),
                        source_targets[row['workload_id']]))
                    != (row['state'] == 'present_exact')
                    for row in states)
                or recovery.get('remaining_exact_ids') !=
                   sorted(row['id'] for row in targets)
                or recovery.get('workload_identities') != baseline_workloads
                or recovery.get('target_resource_usage') != {
                    'sha256': plan.get('baseline', {}).get(
                        'target_resource_usage_sha256'),
                    'nonzero': plan.get('baseline', {}).get(
                        'target_resource_usage_nonzero'),
                }
                or not isinstance(recovery.get('stable_snapshot_sha256'), list)
                or len(recovery['stable_snapshot_sha256']) != 2
                or len(set(recovery['stable_snapshot_sha256'])) != 1
                or any(not isinstance(item, str) or not SHA256.fullmatch(item)
                       for item in recovery['stable_snapshot_sha256'])
                or recovery['stable_snapshot_sha256'][-1] !=
                   plan.get('baseline', {}).get('snapshot_sha256')
                or _record_digest(plan.get('baseline', {}).get('snapshot')) !=
                   plan.get('baseline', {}).get('snapshot_sha256')):
            raise ValueError('worker loss recovery subset is not source-authorized')

    def _validate_provenance_chain(self, saved_plan, journal, seen=None):
        """Validate a saved cleanup lineage back to one immutable review plan."""
        seen = set() if seen is None else set(seen)
        if (not isinstance(saved_plan, dict) or not isinstance(journal, dict)
                or not isinstance(saved_plan.get('id'), str)
                or saved_plan['id'] in seen
                or journal.get('id') != saved_plan['id']
                or saved_plan.get('plan_sha256') != plan_digest(saved_plan)
                or journal.get('plan_sha256') != saved_plan['plan_sha256']
                or journal.get('review_plan_sha256') !=
                   saved_plan.get('review_plan_sha256')
                or journal.get('target') != saved_plan.get('target')
                or journal.get('destinations') != saved_plan.get('destinations')
                or journal.get('targets') != saved_plan.get('targets')
                or journal.get('baseline') != saved_plan.get('baseline')
                or journal.get('fence') not in (None, saved_plan.get('fence'))):
            raise ValueError('worker loss saved plan/journal provenance is corrupt')
        seen.add(saved_plan['id'])
        operation = saved_plan.get('operation')
        if operation == 'worker-loss-stale-cleanup-plan':
            if journal.get('operation') != 'worker-loss-stale-cleanup':
                raise ValueError('worker loss source operation is inconsistent')
            review_id = journal.get(
                'review_plan_id',
                journal.get('origin_run_id', saved_plan['id']))
            from worker_drain import PLAN_ID
            if not isinstance(review_id, str) or not PLAN_ID.fullmatch(review_id):
                raise ValueError('worker loss review provenance ID is invalid')
            review = self._load_record('review-plans', review_id)
            review_targets = _validate_review(review)
            reviewed_binding = copy.deepcopy(review.get('snapshot'))
            if isinstance(reviewed_binding, dict):
                reviewed_binding.pop('hosts_sha256', None)
            if (review.get('id') != review_id
                    or saved_plan.get('id') != review_id
                    or saved_plan.get('review_plan_sha256') !=
                       review.get('plan_sha256')
                    or saved_plan.get('target') != review.get('target')
                    or saved_plan.get('detection') != review.get('detection')
                    or saved_plan.get('fence') != review.get('fence')
                    or saved_plan.get('destinations') != sorted({
                        move['replacement']['node'] for move in review['moves']})
                    or saved_plan.get('targets') != review_targets
                    or saved_plan.get('baseline', {}).get('snapshot') !=
                       reviewed_binding
                    or saved_plan.get('baseline', {}).get('workloads') !=
                       reviewed_binding.get('workloads')
                    or saved_plan.get('baseline', {}).get(
                        'target_resource_usage_sha256') !=
                       review.get('target_stale_state', {}).get(
                           'resource_usage_sha256')):
                raise ValueError('worker loss execution plan differs from review provenance')
            return review
        if operation != 'worker-loss-recovery-cleanup-plan':
            raise ValueError('worker loss provenance operation is invalid')
        if journal.get('operation') != 'worker-loss-recovery-cleanup':
            raise ValueError('worker loss recovery source operation is inconsistent')
        source = saved_plan.get('source')
        if (not isinstance(source, dict)
                or source.get('plan_category') not in {
                    'execution-plans', 'recovery-cleanup-plans'}
                or not isinstance(source.get('run_id'), str)
                or not isinstance(source.get('plan_sha256'), str)
                or not SHA256.fullmatch(source['plan_sha256'])
                or not isinstance(source.get('journal_sha256'), str)
                or not SHA256.fullmatch(source['journal_sha256'])
                or journal.get('source') != source):
            raise ValueError('worker loss recovery provenance source is malformed')
        parent_journal = self._load_record('runs', source['run_id'])
        parent_plan = self._load_record(
            source['plan_category'], source['run_id'])
        if (_record_digest(parent_journal) != source['journal_sha256']
                or parent_plan.get('plan_sha256') != source['plan_sha256']
                or plan_digest(parent_plan) != source['plan_sha256']):
            raise ValueError('worker loss recovery provenance source changed')
        review = self._validate_provenance_chain(
            parent_plan, parent_journal, seen)
        self._validate_recovery_derivation(
            saved_plan, parent_plan, parent_journal, review)
        return review

    def _validate_plan(self, plan, expected_sha256):
        if (not isinstance(plan, dict) or plan.get('plan_sha256') != plan_digest(plan)
                or expected_sha256 != plan.get('plan_sha256')
                or plan.get('operation') not in {
                    'worker-loss-stale-cleanup-plan',
                    'worker-loss-recovery-cleanup-plan',
                }
                or plan.get('decision') != 'ready'
                or plan.get('executable') is not True
                or plan.get('execution_implemented') is not True
                or plan.get('blockers')):
            raise ValueError('worker loss cleanup plan hash or execution contract is invalid')
        targets = plan.get('targets')
        if (not isinstance(targets, list) or not targets
                or any(not isinstance(row, dict)
                       or not isinstance(row.get('id'), str)
                       or not WORKLOAD_ID.fullmatch(row['id'])
                       or row.get('node') != plan.get('target', {}).get('node')
                       or row.get('node') not in WORKERS
                       or not isinstance(row.get('logical_app'), str)
                       or not isinstance(row.get('spec_sha256'), str)
                       or not SHA256.fullmatch(row['spec_sha256'])
                       or not isinstance(row.get('appname'), str)
                       or not APPNAME.fullmatch(row['appname'])
                       or not row['id'].startswith(row['appname'] + '_')
                       for row in targets)
                or len({row['id'] for row in targets}) != len(targets)):
            raise ValueError('worker loss cleanup targets are malformed')
        target = plan.get('target')
        destinations = plan.get('destinations')
        if (not isinstance(target, dict) or target.get('node') not in WORKERS
                or target.get('available') is not False
                or target.get('bypass') is not True
                or not isinstance(destinations, list) or not destinations
                or set(destinations) - (WORKERS - {target['node']})
                or len(set(destinations)) != len(destinations)):
            raise ValueError('worker loss target or destinations are malformed')
        if plan.get('operation') == 'worker-loss-recovery-cleanup-plan':
            source = plan.get('source')
            recovery = plan.get('recovery')
            if (not isinstance(source, dict)
                    or source.get('plan_category') not in {
                        'execution-plans', 'recovery-cleanup-plans'}
                    or not isinstance(source.get('run_id'), str)
                    or not isinstance(source.get('plan_sha256'), str)
                    or not SHA256.fullmatch(source['plan_sha256'])
                    or not isinstance(source.get('journal_sha256'), str)
                    or not SHA256.fullmatch(source['journal_sha256'])
                    or not isinstance(recovery, dict)
                    or recovery.get('remaining_exact_ids') !=
                       sorted(item['id'] for item in targets)
                    or not isinstance(recovery.get('stable_snapshot_sha256'), list)
                    or len(recovery['stable_snapshot_sha256']) != 2
                    or len(set(recovery['stable_snapshot_sha256'])) != 1
                    or any(not isinstance(item, str) or not SHA256.fullmatch(item)
                           for item in recovery['stable_snapshot_sha256'])
                    or recovery.get('workload_identities') !=
                       plan.get('baseline', {}).get('workloads')):
                raise ValueError('worker loss recovery cleanup binding is malformed')
            source_journal = self._load_record('runs', source['run_id'])
            saved_source_plan = self._load_record(
                source['plan_category'], source['run_id'])
            if (_record_digest(source_journal) != source['journal_sha256']
                    or source_journal.get('id') != source['run_id']
                    or saved_source_plan.get('plan_sha256') != source['plan_sha256']
                    or plan_digest(saved_source_plan) != source['plan_sha256']
                    or saved_source_plan.get('id') != source['run_id']
                    or source_journal.get('plan_sha256') != source['plan_sha256']
                    or source_journal.get('review_plan_sha256') !=
                       saved_source_plan.get('review_plan_sha256')
                    or source_journal.get('target') != saved_source_plan.get('target')
                    or source_journal.get('destinations') !=
                       saved_source_plan.get('destinations')
                    or source_journal.get('targets') != saved_source_plan.get('targets')
                    or source_journal.get('baseline') != saved_source_plan.get('baseline')
                    or source_journal.get('fence') not in (
                        None, saved_source_plan.get('fence'))
                    or plan.get('review_plan_sha256') !=
                       saved_source_plan.get('review_plan_sha256')
                    or plan.get('review_plan_id') !=
                       source_journal.get(
                           'review_plan_id',
                           source_journal.get('origin_run_id', source['run_id']))
                    or plan.get('origin_run_id') !=
                       source_journal.get('origin_run_id', source['run_id'])
                    or plan.get('target') != saved_source_plan.get('target')
                    or plan.get('destinations') != saved_source_plan.get('destinations')
                    or plan.get('fence') != saved_source_plan.get('fence')
                    or plan.get('detection') != saved_source_plan.get('detection')):
                raise ValueError('worker loss recovery source binding changed')
            source_targets = {
                row.get('id'): row for row in source_journal['targets']
                if isinstance(row, dict)}
            states = recovery.get('target_states')
            baseline_workloads = _workload_binding(
                plan.get('baseline', {}).get('snapshot'))
            baseline_rows = {row['id']: row for row in baseline_workloads}
            if (len(source_targets) != len(source_journal['targets'])
                    or baseline_workloads !=
                       plan.get('baseline', {}).get('workloads')
                    or not isinstance(states, list)
                    or len(states) != len(source_targets)
                    or any(not isinstance(row, dict)
                           or set(row) != {'workload_id', 'state'}
                           for row in states)
                    or {row.get('workload_id') for row in states} !=
                       set(source_targets)
                    or any(row.get('state') not in {'absent', 'present_exact'}
                           for row in states)
                    or {row['workload_id'] for row in states
                        if row['state'] == 'present_exact'} !=
                       {row['id'] for row in targets}
                    or any(source_targets[row['id']] != row for row in targets)
                    or any(
                        (_target_matches(
                            baseline_rows.get(row['workload_id']),
                            source_targets[row['workload_id']]))
                        != (row['state'] == 'present_exact')
                        for row in states)
                    or recovery.get('target_resource_usage') != {
                        'sha256': plan.get('baseline', {}).get(
                            'target_resource_usage_sha256'),
                        'nonzero': plan.get('baseline', {}).get(
                            'target_resource_usage_nonzero'),
                    }
                    or recovery['stable_snapshot_sha256'][-1] !=
                       plan.get('baseline', {}).get('snapshot_sha256')
                    or _record_digest(plan.get('baseline', {}).get('snapshot')) !=
                       plan.get('baseline', {}).get('snapshot_sha256')):
                raise ValueError('worker loss recovery subset is not source-authorized')
            review = self._validate_provenance_chain(
                saved_source_plan, source_journal)
            self._validate_recovery_derivation(
                plan, saved_source_plan, source_journal, review)

    def plan_fresh_cleanup(self, run_id, plan_id=None):
        with ClusterLock(self.root.parents[2]):
            return self._plan_fresh_cleanup_locked(run_id, plan_id)

    def _plan_fresh_cleanup_locked(self, run_id, plan_id=None):
        """Build a new exact-ID plan from read-only proof of remaining state."""
        source = self._load_record('runs', run_id)
        if source.get('operation') == 'worker-loss-stale-cleanup':
            plan_category = 'execution-plans'
        elif source.get('operation') == 'worker-loss-recovery-cleanup':
            plan_category = 'recovery-cleanup-plans'
        else:
            raise ValueError('worker loss source journal operation is invalid')
        source_plan = self._load_record(plan_category, run_id)
        if (source.get('plan_sha256') != source_plan.get('plan_sha256')
                or source_plan.get('plan_sha256') != plan_digest(source_plan)
                or source.get('id') != run_id
                or source_plan.get('id') != run_id
                or source.get('review_plan_sha256') !=
                   source_plan.get('review_plan_sha256')
                or source.get('target') != source_plan.get('target')
                or source.get('destinations') != source_plan.get('destinations')
                or source.get('targets') != source_plan.get('targets')
                or source.get('baseline') != source_plan.get('baseline')
                or source.get('fence') not in (None, source_plan.get('fence'))
                or not isinstance(source.get('targets'), list)
                or not source['targets']):
            raise ValueError('worker loss source journal or plan is corrupt')
        self._validate_provenance_chain(source_plan, source)
        if source.get('status') == 'complete':
            raise ValueError('completed cleanup has no remaining subset to plan')

        target_by_id = {item.get('id'): item for item in source['targets']
                        if isinstance(item, dict)}
        if len(target_by_id) != len(source['targets']):
            raise ValueError('worker loss source targets are malformed or duplicated')
        states = []
        absent = set()
        present = []
        for workload_id in sorted(target_by_id):
            target = target_by_id[workload_id]
            try:
                row = self.api.get_workload(workload_id)
            except Exception as exc:
                raise ValueError('exact worker loss recovery query failed') from exc
            if row is None:
                state = 'absent'
                absent.add(workload_id)
            elif _target_matches(row, target):
                state = 'present_exact'
                present.append(target)
            else:
                raise ValueError('exact worker loss recovery identity changed')
            states.append({'workload_id': workload_id, 'state': state})
        if not present:
            raise ValueError('read-only recovery found no present exact IDs for fresh cleanup')

        first = self.api.snapshot()
        first_summary = self._audit(first, source, absent)
        second = self.api.snapshot()
        second_summary = self._audit(second, source, absent)
        first_binding = _control_binding(first)
        second_binding = _control_binding(second)
        if first_binding != second_binding:
            raise ValueError('worker loss recovery snapshots are not stable')
        usage = _usage_state(second, source['target']['node'])
        snapshots = [_record_digest(first_binding), _record_digest(second_binding)]
        plan_id = plan_id or ('lossrec-' + uuid.uuid4().hex[:24])
        from worker_drain import PLAN_ID
        if (not isinstance(plan_id, str) or not PLAN_ID.fullmatch(plan_id)
                or plan_id == run_id):
            raise ValueError('fresh worker loss cleanup requires a new valid plan ID')
        origin_run_id = source.get('origin_run_id', run_id)
        review_plan_id = source.get('review_plan_id', origin_run_id)
        plan = {
            'schema_version': 1,
            'operation': 'worker-loss-recovery-cleanup-plan',
            'id': plan_id,
            'review_plan_id': review_plan_id,
            'review_plan_sha256': source['review_plan_sha256'],
            'origin_run_id': origin_run_id,
            'source': {
                'run_id': run_id,
                'plan_category': plan_category,
                'plan_sha256': source['plan_sha256'],
                'journal_sha256': _record_digest(source),
            },
            'target': copy.deepcopy(source['target']),
            'detection': copy.deepcopy(source_plan.get('detection')),
            'fence': copy.deepcopy(source_plan.get('fence')),
            'destinations': list(source['destinations']),
            'targets': copy.deepcopy(present),
            'baseline': {
                'snapshot': second_binding,
                'snapshot_sha256': snapshots[-1],
                'node_static_sha256': _node_static_digest(second),
                'workloads': _workload_binding(second),
                'target_resource_usage_sha256': usage['sha256'],
                'target_resource_usage_nonzero': usage['nonzero'],
            },
            'recovery': {
                'read_only': True,
                'dissociate_replayed': False,
                'target_states': states,
                'remaining_exact_ids': sorted(item['id'] for item in present),
                'stable_snapshot_sha256': snapshots,
                'workload_identities': _workload_binding(second),
                'target_resource_usage': usage,
                'preflight': [first_summary, second_summary],
            },
            'preflight': second_summary,
            'decision': 'ready', 'blockers': [],
            'executable': True, 'execution_implemented': True,
            'steps': [
                'Recheck the source journal, stable snapshot pair, target fence, quota, and full workload identities',
                'Dissociate only the recovered present_exact subset under a new plan and journal',
                'Require every remaining stale ID absent and target quota zero without resource --fix',
                'Stop at the fresh replacement-plan gate',
            ],
            'failure_policy': [
                'Never replay the source or fresh plan after a journal exists',
                'Query, identity, snapshot, fence, quota, or healthy-worker uncertainty blocks mutation',
            ],
        }
        return _seal(plan)

    def execute(self, plan, expected_sha256):
        with ClusterLock(self.root.parents[2]):
            return self._execute_locked(plan, expected_sha256)

    def _execute_locked(self, plan, expected_sha256):
        self._validate_plan(plan, expected_sha256)
        path = self.run_path(plan['id'])
        if path.exists() or path.is_symlink():
            raise ValueError('worker loss plan already has a journal; reconcile and create a fresh plan')
        journal = {
            'id': plan['id'],
            'operation': ('worker-loss-recovery-cleanup'
                          if plan['operation'] == 'worker-loss-recovery-cleanup-plan'
                          else 'worker-loss-stale-cleanup'),
            'status': 'running', 'stage': 'created', 'started_at': _now(),
            'plan_sha256': plan['plan_sha256'],
            'review_plan_sha256': plan['review_plan_sha256'],
            'review_plan_id': plan.get('review_plan_id', plan['id']),
            'origin_run_id': plan.get('origin_run_id', plan['id']),
            'target': copy.deepcopy(plan['target']),
            'fence': copy.deepcopy(plan.get('fence')),
            'destinations': list(plan['destinations']),
            'targets': copy.deepcopy(plan['targets']),
            'baseline': copy.deepcopy(plan['baseline']),
            'dissociated_ids': [], 'dissociate_attempted': False,
            'events': [], 'replacement_plan_allowed': False,
        }
        if plan.get('source'):
            journal['source'] = copy.deepcopy(plan['source'])
        self._save(path, journal)
        try:
            self._stage(path, journal, 'preflight')
            before = self.api.snapshot()
            summary = self._audit(before, journal, set())
            if _control_binding(before) != journal['baseline']['snapshot']:
                raise ValueError('control-plane snapshot changed before dissociation')
            journal['preflight_recheck'] = summary
            self._save(path, journal)

            for target in journal['targets']:
                absent = set(journal['dissociated_ids'])
                self._stage(path, journal, 'verify_exact_target')
                current = self.api.snapshot()
                self._audit(current, journal, absent)
                row = self.api.get_workload(target['id'])
                if not _target_matches(row, target):
                    raise ValueError('exact stale workload identity changed before dissociation')

                self._stage(path, journal, 'dissociate_intent')
                journal['dissociate_attempted'] = True
                journal['intent_workload_id'] = target['id']
                self._save(path, journal)
                try:
                    self.api.dissociate_exact(target['id'])
                except Exception as dissociate_error:
                    try:
                        observed = self.api.get_workload(target['id'])
                    except Exception as reconcile_error:
                        journal.update(
                            status='uncertain',
                            reason='dissociate_reply_and_exact_query_unavailable',
                            dissociate_error_type=type(dissociate_error).__name__,
                            reconcile_error_type=type(reconcile_error).__name__)
                        self._save(path, journal)
                        raise UncertainDissociation(
                            'dissociate reply and exact reconciliation are unavailable') from None
                    if observed is None:
                        journal['dissociated_ids'].append(target['id'])
                        journal['events'].append({
                            'at': _now(), 'event': 'dissociate_reply_lost_target_absent',
                            'workload_id': target['id'],
                        })
                        self._save(path, journal)
                    else:
                        journal.update(
                            status='uncertain',
                            reason=('dissociate_reply_lost_target_still_exact'
                                    if _target_matches(observed, target)
                                    else 'dissociate_reply_lost_identity_changed'),
                            dissociate_error_type=type(dissociate_error).__name__)
                        self._save(path, journal)
                        raise UncertainDissociation(
                            'dissociate reply was lost and target remains; do not replay') from None
                else:
                    observed = self.api.get_workload(target['id'])
                    if observed is not None:
                        journal.update(status='uncertain',
                                       reason='dissociated_target_still_visible')
                        self._save(path, journal)
                        raise UncertainDissociation(
                            'dissociated target remains visible; do not replay')
                    journal['dissociated_ids'].append(target['id'])
                    journal['events'].append({
                        'at': _now(), 'event': 'exact_stale_target_absent',
                        'workload_id': target['id'],
                    })
                    self._save(path, journal)

                self._stage(path, journal, 'post_dissociate_audit')
                after = self.api.snapshot()
                self._audit(after, journal, set(journal['dissociated_ids']))

            self._stage(path, journal, 'final_metadata_and_quota_audit')
            first = self.api.snapshot()
            final_summary = self._audit(
                first, journal, set(journal['dissociated_ids']))
            second = self.api.snapshot()
            self._audit(second, journal, set(journal['dissociated_ids']))
            if _control_binding(first) != _control_binding(second):
                raise ValueError('final control-plane state is not stable')
            usage = _usage_state(second, journal['target']['node'])
            journal['final_resource_usage'] = usage
            journal['final_preflight'] = final_summary
            if usage['nonzero']:
                journal.update(status='needs_review', reason='stale_quota_remains')
                self._save(path, journal)
                raise RuntimeError('stale quota remains; no automatic quota repair is allowed')
            journal.update(
                status='complete', stage='stale_state_cleared', completed_at=_now(),
                result='exact_stale_metadata_absent_and_target_quota_zero',
                replacement_plan_allowed=True,
                next_step='Create a fresh replacement deployment plan; this executor stops here')
            self._save(path, journal)
            return journal
        except BaseException as exc:
            if journal.get('status') == 'running':
                journal.update(
                    status=('uncertain' if journal.get('dissociate_attempted') else 'failed'),
                    reason=type(exc).__name__)
                self._save(path, journal)
            raise

    def reconcile(self, run_id):
        with ClusterLock(self.root.parents[2]):
            return self._reconcile_locked(run_id)

    def _reconcile_locked(self, run_id):
        path = self._existing_record_path('runs', run_id)
        journal = json.loads(path.read_text())
        if (journal.get('id') != run_id
                or journal.get('operation') not in {
                    'worker-loss-stale-cleanup', 'worker-loss-recovery-cleanup'}
                or not isinstance(journal.get('targets'), list)
                or not isinstance(journal.get('baseline'), dict)):
            raise ValueError('worker loss journal is malformed')
        for target in journal['targets']:
            if (not isinstance(target, dict)
                    or not isinstance(target.get('id'), str)
                    or not WORKLOAD_ID.fullmatch(target['id'])
                    or not isinstance(target.get('appname'), str)
                    or not APPNAME.fullmatch(target['appname'])
                    or not target['id'].startswith(target['appname'] + '_')
                    or not isinstance(target.get('spec_sha256'), str)
                    or not SHA256.fullmatch(target['spec_sha256'])
                    or target.get('node') != journal.get('target', {}).get('node')):
                raise ValueError('worker loss journal targets are malformed')
        observation = {
            'at': _now(), 'read_only': True, 'dissociate_replayed': False,
            'targets': [], 'remaining_exact_ids': [],
            'snapshot_matches_reconciled_state': False,
            'fresh_cleanup_plan_allowed': False,
            'replacement_plan_allowed': False,
        }
        absent = set()
        uncertain = False
        for target in journal['targets']:
            try:
                row = self.api.get_workload(target['id'])
                if row is None:
                    state = 'absent'
                    absent.add(target['id'])
                elif _target_matches(row, target):
                    state = 'present_exact'
                    observation['remaining_exact_ids'].append(target['id'])
                else:
                    state = 'identity_changed'
                    uncertain = True
            except Exception as exc:
                state = 'query_failed'
                uncertain = True
                observation.setdefault('query_error_types', []).append(type(exc).__name__)
            observation['targets'].append({'workload_id': target['id'], 'state': state})

        try:
            first = self.api.snapshot()
            first_summary = self._audit(first, journal, absent)
            second = self.api.snapshot()
            second_summary = self._audit(second, journal, absent)
            if _control_binding(first) != _control_binding(second):
                raise ValueError('read-only reconciliation snapshot is not stable')
            usage = _usage_state(second, journal['target']['node'])
            observation.update(
                snapshot_matches_reconciled_state=True,
                target_resource_usage=usage,
                live_preflight=second_summary)
        except Exception as exc:
            uncertain = True
            observation['snapshot_issue_type'] = type(exc).__name__
            usage = {'nonzero': None, 'sha256': None}

        all_absent = len(absent) == len(journal['targets'])
        stable = observation['snapshot_matches_reconciled_state'] and not uncertain
        observation['replacement_plan_allowed'] = (
            stable and all_absent and usage['nonzero'] is False)
        observation['fresh_cleanup_plan_allowed'] = (
            stable and bool(observation['remaining_exact_ids']) and not all_absent)
        if observation['replacement_plan_allowed']:
            recommendation = 'stale_state_clear_create_fresh_replacement_plan'
        elif observation['fresh_cleanup_plan_allowed']:
            recommendation = 'create_fresh_exact_cleanup_plan_for_remaining_ids'
        elif all_absent and usage.get('nonzero') is True:
            recommendation = 'metadata_absent_but_quota_nonzero_operator_review_required'
        else:
            recommendation = 'state_uncertain_no_mutation_allowed'
        observation['recovery_recommendation'] = recommendation
        journal['reconciliation'] = observation
        if journal.get('status') != 'complete':
            journal.update(status='needs_review', stage='reconciled_read_only')
        self._save(path, journal)
        return journal

    def recover(self, run_id):
        return self.reconcile(run_id)
