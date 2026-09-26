"""Fenced, staged execution and read-only recovery for ERU-009 worker drains.

The offline planner remains review-only. This coordinator accepts a separately
prepared hash-bound execution plan, stages every ERU-012 replacement through
AppExecutor, and only then removes the source workloads through
AppRevisionCleanup. It never resumes scheduling or runs component reinstall.
"""
from datetime import datetime, timezone
import copy
import json
from pathlib import Path
import re

from app_cleanup import AppRevisionCleanup
from app_desired import (OWNER, canonical_bytes, sha256, snapshot_binding,
                         spec_identity)
from app_executor import (AppExecutor, UncertainExecution, _safe_revision_rows,
                          execution_plan as app_execution_plan)
from component_reinstall import empty_target
from labops import ClusterLock, atomic_json
from worker_drain import (PLAN_ID, build_plan as build_drain_plan,
                          plan_digest as drain_plan_digest)


def plan_digest(plan):
    unsigned = dict(plan)
    unsigned.pop('plan_sha256', None)
    return sha256(canonical_bytes(unsigned))


def _now():
    return datetime.now(timezone.utc).isoformat()


def _identity_rows(snapshot):
    binding = snapshot_binding(snapshot)
    return binding.get('workloads', [])


def _host_static_digest(snapshot):
    hosts = snapshot.get('hosts')
    if not isinstance(hosts, dict) or not hosts:
        raise ValueError('live snapshot is missing host identity facts')
    stable = {}
    for alias, facts in hosts.items():
        if not isinstance(alias, str) or not isinstance(facts, dict):
            raise ValueError('live snapshot contains malformed host identity facts')
        # Workload creates/removes legitimately change these two command
        # outputs. All other facts, including machine and boot identity, stay
        # bound while the drain runs.
        stable[alias] = {key: value for key, value in facts.items()
                         if key not in {'containers', 'tasks'}}
    return sha256(canonical_bytes(stable))


def _node_static_digest(snapshot):
    nodes = snapshot.get('nodes')
    if not isinstance(nodes, list) or not nodes:
        raise ValueError('live snapshot is missing node identity facts')
    stable = []
    for row in nodes:
        if not isinstance(row, dict):
            raise ValueError('live snapshot contains malformed node identity facts')
        required = ('name', 'podname', 'endpoint', 'labels', 'resource_capacity')
        if any(key not in row for key in required):
            raise ValueError('live snapshot is missing stable node identity fields')
        stable.append({key: row[key] for key in required})
    return sha256(canonical_bytes(sorted(stable, key=lambda row: row['name'])))


def _node(snapshot, name):
    matches = [row for row in snapshot.get('nodes', [])
               if isinstance(row, dict) and row.get('name') == name]
    if len(matches) != 1:
        raise ValueError('worker node is missing or ambiguous in live snapshot')
    return matches[0]


def _preflight(api, snapshot):
    result = api.preflight(snapshot)
    if (not isinstance(result, dict) or result.get('health_ok') is not True
            or not isinstance(result.get('consistency_issues'), list)
            or result.get('consistency_issues')):
        return False, {
            'health_ok': isinstance(result, dict) and result.get('health_ok') is True,
            'consistency_issue_count': (
                len(result['consistency_issues'])
                if isinstance(result, dict)
                and isinstance(result.get('consistency_issues'), list) else None),
        }
    return True, {'health_ok': True, 'consistency_issue_count': 0}


def _validated_specs(review_plan, desired_specs):
    if not isinstance(desired_specs, list):
        raise ValueError('desired_specs must be supplied again from private input')
    moves = review_plan.get('moves')
    if not isinstance(moves, list) or len(desired_specs) != len(moves):
        raise ValueError('desired specs do not cover every planned app move')
    by_name = {}
    for document in desired_specs:
        normalized, source_hash, source_appname = spec_identity(document)
        if normalized['name'] in by_name:
            raise ValueError('desired specs contain duplicate logical app names')
        by_name[normalized['name']] = (normalized, source_hash, source_appname)
    if set(by_name) != {move.get('logical_app') for move in moves}:
        raise ValueError('desired specs differ from the reviewed logical app set')
    for move in moves:
        logical = move['logical_app']
        normalized, source_hash, source_appname = by_name[logical]
        source = move.get('source')
        replacement = move.get('replacement')
        if (not isinstance(source, dict) or not isinstance(replacement, dict)
                or normalized['node'] != review_plan['target']['node']
                or source.get('spec_sha256') != source_hash
                or source.get('appname') != source_appname
                or source.get('replicas') != normalized['replicas']):
            raise ValueError('desired source spec differs from the review plan')
        destination_spec = dict(normalized, node=replacement.get('node'))
        _, destination_hash, destination_appname = spec_identity(destination_spec)
        if (replacement.get('spec_sha256') != destination_hash
                or replacement.get('appname') != destination_appname):
            raise ValueError('desired replacement identity differs from the review plan')
    return by_name


def _validate_review_plan(review_plan, desired_specs):
    if (not isinstance(review_plan, dict)
            or review_plan.get('plan_sha256') != drain_plan_digest(review_plan)):
        raise ValueError('worker drain review plan hash mismatch')
    if (review_plan.get('operation') != 'worker-nonempty-drain-plan'
            or review_plan.get('decision') != 'reviewable'
            or review_plan.get('executable') is not False
            or review_plan.get('execution_implemented') is not False
            or review_plan.get('blockers')):
        raise ValueError('worker drain review plan is blocked or malformed')
    specs = _validated_specs(review_plan, desired_specs)
    destinations = {move['logical_app']: move['replacement']['node']
                    for move in review_plan['moves']}
    preflight = review_plan.get('preflight')
    if (not isinstance(preflight, dict) or preflight.get('health_ok') is not True
            or preflight.get('consistency_issue_count') != 0):
        raise ValueError('offline worker drain assertions are not clean')
    rebuilt = build_drain_plan(
        review_plan['target']['node'], review_plan['snapshot'],
        desired_specs, destinations, True, (), review_plan['id'])
    if drain_plan_digest(rebuilt) != review_plan['plan_sha256']:
        raise ValueError('worker drain review payload differs from its plan hash')
    return specs


def execution_plan(review_plan, desired_specs, api):
    """Bind a review-only plan to current, read-only health and state checks."""
    specs = _validate_review_plan(review_plan, desired_specs)
    snapshot = api.snapshot()
    clean, preflight_summary = _preflight(api, snapshot)
    if not clean:
        raise ValueError('live health/consistency preflight failed')
    confirmed_snapshot = api.snapshot()
    if snapshot_binding(confirmed_snapshot) != snapshot_binding(snapshot):
        raise ValueError('live cluster changed during drain preflight')
    snapshot = confirmed_snapshot
    binding = snapshot_binding(snapshot)
    if sha256(canonical_bytes(binding)) != review_plan.get('snapshot_sha256'):
        raise ValueError('live cluster snapshot differs from the reviewed drain plan')
    target_name = review_plan['target']['node']
    target_node = _node(snapshot, target_name)
    if target_node.get('available') is not True or target_node.get('bypass') is not False:
        raise ValueError('target must be available and not already fenced')
    for move in review_plan['moves']:
        destination_node = _node(snapshot, move['replacement']['node'])
        if destination_node.get('available') is not True:
            raise ValueError('replacement worker is not available')
        if destination_node.get('bypass') is not False:
            raise ValueError('replacement worker is already fenced')
        # Recheck the exact source and replacement identities against fresh
        # workload rows before making an execution plan.
        source_spec, _, _ = specs[move['logical_app']]
        source_review = app_execution_plan(
            source_spec, snapshot, True, (),
            plan_id='drainsource-' + sha256(
                (review_plan['id'] + '\0' + move['logical_app']).encode())[:24])
        if (source_review['action'] != 'no_op'
                or sorted(item['id'] for item in source_review['current_revision'])
                != move['source']['workload_ids']):
            raise ValueError('source revision changed after offline drain review')
    return _seal_execution_plan({
        'schema_version': 1,
        'operation': 'worker-nonempty-drain-execution-plan',
        'id': review_plan['id'],
        'review_plan': review_plan,
        'review_plan_sha256': review_plan['plan_sha256'],
        'target': copy.deepcopy(review_plan['target']),
        'moves': copy.deepcopy(review_plan['moves']),
        'baseline': {
            'snapshot': binding,
            'snapshot_sha256': sha256(canonical_bytes(binding)),
            'host_static_sha256': _host_static_digest(snapshot),
            'node_static_sha256': _node_static_digest(snapshot),
            'workloads': _identity_rows(snapshot),
        },
        'preflight': preflight_summary,
        'decision': 'ready',
        'blockers': [],
        'executable': True,
        'execution_implemented': True,
        'steps': [
            'Fence the target once and confirm bypass before creating replacements',
            'Create and prove every replacement revision; retain every source revision',
            'Recheck all replacement revisions before exact-ID source cleanup begins',
            'Reconcile each exact removal and preserve the fence on every uncertain result',
            'Confirm target metadata, containers, tasks, and resource usage are empty',
            'Stop for a fresh ordinary component-reinstall plan; do not reinstall here',
        ],
        'failure_policy': [
            'A plan with a journal is never replayed; reconcile it read-only first',
            'Any uncertain replacement retains all source revisions',
            'Any uncertain cleanup leaves the target fenced and blocks reinstall',
            'Recovery performs reads only and never retries fence, deploy, or remove',
        ],
    })


def _seal_execution_plan(plan):
    plan['plan_sha256'] = plan_digest(plan)
    return plan


class WorkerDrainExecutor:
    """Execute a multi-app drain through the injected ERU-012 adapter.

    The adapter extends the AppExecutor API with ``fence_node(node)``. Its
    snapshot, preflight, revision, exact-ID and probe calls remain read-only;
    deploy, remove_exact, and fence_node are the only mutation methods.
    """

    def __init__(self, root, api, app_root=None):
        self.root = Path(root)
        self.api = api
        self.app_root = Path(app_root) if app_root else self.root.parent / 'apps'

    def run_path(self, run_id):
        if not isinstance(run_id, str) or not PLAN_ID.fullmatch(run_id):
            raise ValueError('invalid worker drain run ID')
        return self.root / 'runs' / (run_id + '.json')

    def _save(self, path, journal):
        journal['updated_at'] = _now()
        atomic_json(path, journal)

    def _stage(self, path, journal, stage):
        journal['stage'] = stage
        journal.setdefault('events', []).append({'at': _now(), 'event': stage})
        self._save(path, journal)

    def _execution_payload(self, plan, expected_sha256, desired_specs):
        if (not isinstance(plan, dict) or plan.get('plan_sha256') != plan_digest(plan)
                or expected_sha256 != plan.get('plan_sha256')):
            raise ValueError('worker drain execution plan hash mismatch')
        if (plan.get('operation') != 'worker-nonempty-drain-execution-plan'
                or plan.get('decision') != 'ready' or plan.get('executable') is not True
                or plan.get('execution_implemented') is not True or plan.get('blockers')):
            raise ValueError('worker drain execution plan is blocked or review-only')
        review = plan.get('review_plan')
        specs = _validate_review_plan(review, desired_specs)
        if (plan.get('review_plan_sha256') != review.get('plan_sha256')
                or plan.get('target') != review.get('target')
                or plan.get('moves') != review.get('moves')
                or plan.get('baseline', {}).get('snapshot') != review.get('snapshot')
                or plan.get('baseline', {}).get('snapshot_sha256') != review.get('snapshot_sha256')):
            raise ValueError('worker drain execution plan differs from its reviewed source')
        if (plan.get('preflight', {}).get('health_ok') is not True
                or plan.get('preflight', {}).get('consistency_issue_count') != 0):
            raise ValueError('worker drain execution plan preflight is not clean')
        baseline = plan.get('baseline')
        if (not isinstance(baseline, dict)
                or not re.fullmatch(r'[0-9a-f]{64}', baseline.get('host_static_sha256', ''))
                or not re.fullmatch(r'[0-9a-f]{64}', baseline.get('node_static_sha256', ''))
                or baseline.get('workloads') != review['snapshot'].get('workloads')):
            raise ValueError('worker drain execution baseline is malformed')
        return review, specs

    def _journal_for(self, plan):
        review = plan['review_plan']
        move_rows = []
        for move in review['moves']:
            logical = move['logical_app']
            suffix = sha256((plan['id'] + '\0' + plan['plan_sha256'] + '\0'
                             + logical).encode())[:24]
            move_rows.append({
                'logical_app': logical,
                'source': copy.deepcopy(move['source']),
                'replacement': copy.deepcopy(move['replacement']),
                'app_run_id': 'drainapp-' + suffix,
                'cleanup_plan_id': 'drainrm-' + suffix,
                'replacement_state': 'not_started',
                'cleanup_state': 'not_started',
            })
        return {
            'id': plan['id'], 'operation': 'worker-nonempty-drain',
            'status': 'running', 'stage': 'created', 'started_at': _now(),
            'plan_sha256': plan['plan_sha256'], 'review_plan_sha256': plan['review_plan_sha256'],
            'target': copy.deepcopy(plan['target']), 'plan': plan,
            'baseline': copy.deepcopy(plan['baseline']), 'moves': move_rows,
            'staged_revisions': [], 'removed_ids': [], 'events': [],
            'component_reinstall_allowed': False,
        }

    @staticmethod
    def _expected_workloads(journal):
        expected = {row['id']: row for row in journal['baseline']['workloads']}
        removed = set(journal.get('removed_ids', []))
        for workload_id in removed:
            expected.pop(workload_id, None)
        for row in journal.get('staged_revisions', []):
            existing = expected.get(row['id'])
            if existing is not None and existing != row:
                raise ValueError('replacement workload ID conflicts with reviewed baseline')
            expected[row['id']] = row
        return sorted(expected.values(), key=lambda item: item['id'])

    def _check_state(self, snapshot, journal, expected_workloads, require_fenced):
        binding = snapshot_binding(snapshot)
        baseline = journal['baseline']
        if binding.get('pods') != baseline['snapshot'].get('pods'):
            raise ValueError('cluster pod identity changed during worker drain')
        if _host_static_digest(snapshot) != baseline['host_static_sha256']:
            raise ValueError('host identity changed during worker drain')
        if _node_static_digest(snapshot) != baseline['node_static_sha256']:
            raise ValueError('node identity or capacity changed during worker drain')
        baseline_node_names = sorted(row['name'] for row in baseline['snapshot']['nodes'])
        current_nodes = snapshot.get('nodes', [])
        if sorted(row.get('name') for row in current_nodes if isinstance(row, dict)) != baseline_node_names:
            raise ValueError('worker membership changed during worker drain')
        if any(row.get('available') is not True for row in current_nodes):
            raise ValueError('a worker became unavailable during worker drain')
        target_row = _node(snapshot, journal['target']['node'])
        if type(target_row.get('bypass')) is not bool:
            raise ValueError('target fence state is unreadable')
        if require_fenced and target_row.get('bypass') is not True:
            raise ValueError('target scheduling fence is not observed')
        observed = sorted(_identity_rows(snapshot), key=lambda item: item['id'])
        if observed != sorted(expected_workloads, key=lambda item: item['id']):
            raise ValueError('workload identities changed outside the reviewed drain stages')
        return target_row

    def _live_check(self, journal, expected_workloads, require_fenced):
        snapshot = self.api.snapshot()
        clean, summary = _preflight(self.api, snapshot)
        if not clean:
            raise ValueError('live health/consistency preflight failed')
        confirmed = self.api.snapshot()
        if snapshot_binding(confirmed) != snapshot_binding(snapshot):
            raise ValueError('cluster changed during health/consistency preflight')
        snapshot = confirmed
        node = self._check_state(snapshot, journal, expected_workloads, require_fenced)
        return snapshot, summary, node

    @staticmethod
    def _source_targets(move):
        source = move['source']
        return sorted([{'id': workload_id, 'node': source['node'],
                        'spec_sha256': source['spec_sha256']}
                       for workload_id in source['workload_ids']], key=lambda row: row['id'])

    def _check_replacement_ready(self, move, document, run_id, journal):
        replacement_spec = dict(document, node=move['replacement']['node'])
        expected = self._expected_workloads(journal)
        snapshot, _, _ = self._live_check(journal, expected, require_fenced=True)
        app_plan = app_execution_plan(replacement_spec, snapshot, True, (), plan_id=run_id)
        if (app_plan.get('executable') is not True
                or app_plan.get('spec_sha256') != move['replacement']['spec_sha256']
                or app_plan.get('appname') != move['replacement']['appname']):
            raise ValueError('replacement revision no longer matches the drain plan')
        if app_plan.get('older_owned_revisions') != self._source_targets(move):
            raise ValueError('replacement does not retain exactly the reviewed source revision')
        return app_plan

    def _all_replacements_ready(self, journal, specs):
        summaries = []
        for move in journal['moves']:
            document = specs[move['logical_app']][0]
            replacement = move['replacement']
            stub = {
                'appname': replacement['appname'],
                'logical_app': move['logical_app'],
                'spec_sha256': replacement['spec_sha256'],
                'spec': {'node': replacement['node'], 'replicas': move['source']['replicas']},
            }
            rows = self.api.list_revision(replacement['appname'])
            valid, reason, ids = _safe_revision_rows(rows, stub)
            if not valid:
                return False, {'logical_app': move['logical_app'], 'reason': reason,
                               'workload_ids': ids}
            if ids != sorted(move.get('replacement_workload_ids', [])):
                return False, {'logical_app': move['logical_app'],
                               'reason': 'replacement_ids_differ_from_ready_journal',
                               'workload_ids': ids}
            probes = []
            replacement_spec = dict(document, node=replacement['node'])
            for row in rows:
                result = self.api.probe(row, replacement_spec)
                if (not isinstance(result, dict) or isinstance(result.get('status'), bool)
                        or not isinstance(result.get('status'), int)
                        or not isinstance(result.get('body_match'), bool)):
                    return False, {'logical_app': move['logical_app'],
                                   'reason': 'malformed_probe_result', 'workload_ids': ids}
                passed = (result['status'] == replacement_spec['service']['expected_status']
                          and result['body_match'])
                probes.append({'workload_id': row['id'], 'http_status': result['status'],
                               'body_match': result['body_match'], 'passed': passed})
                if not passed:
                    return False, {'logical_app': move['logical_app'],
                                   'reason': 'replacement_readiness_failed',
                                   'workload_ids': ids, 'probes': probes}
            summaries.append({'logical_app': move['logical_app'],
                              'workload_ids': ids, 'probes': probes})
        return True, summaries

    def execute(self, plan, expected_sha256, desired_specs):
        project = self.root.parents[2]
        with ClusterLock(project):
            return self._execute_locked(plan, expected_sha256, desired_specs)

    def _execute_locked(self, plan, expected_sha256, desired_specs):
        review, specs = self._execution_payload(plan, expected_sha256, desired_specs)
        path = self.run_path(plan['id'])
        if path.exists() or path.is_symlink():
            raise ValueError('worker drain journal already exists; reconcile it and do not replay')
        journal = self._journal_for(plan)
        self._save(path, journal)
        try:
            self._stage(path, journal, 'preflight')
            live, summary, target = self._live_check(
                journal, journal['baseline']['workloads'], require_fenced=False)
            if target.get('available') is not True or target.get('bypass') is not False:
                journal.update(status='failed', reason='target_is_not_available_and_unfenced')
                self._save(path, journal)
                raise ValueError('target is not available and unfenced')
            if sha256(canonical_bytes(snapshot_binding(live))) != plan['baseline']['snapshot_sha256']:
                journal.update(status='failed', reason='initial_snapshot_changed')
                self._save(path, journal)
                raise ValueError('live cluster snapshot changed; create a fresh drain plan')
            journal['preflight_recheck'] = summary
            self._save(path, journal)

            # A fence reply may be lost. In that case observe the state once;
            # never issue a second node-down command from this plan.
            self._stage(path, journal, 'fence_intent')
            journal['fence_attempted'] = True
            self._save(path, journal)
            fence_error = None
            try:
                self.api.fence_node(journal['target']['node'])
            except Exception as exc:
                fence_error = type(exc).__name__
            after_fence = self.api.snapshot()
            clean, fence_preflight = _preflight(self.api, after_fence)
            after_fence_confirmed = self.api.snapshot()
            if snapshot_binding(after_fence_confirmed) != snapshot_binding(after_fence):
                clean = False
            after_fence = after_fence_confirmed
            try:
                target = self._check_state(after_fence, journal,
                                           journal['baseline']['workloads'],
                                           require_fenced=True)
            except Exception:
                target = None
            if not clean or target is None:
                journal.update(status='uncertain', stage='fence_uncertain',
                               reason='fence_outcome_not_confirmed',
                               fence_error_type=fence_error,
                               fence_reconcile_preflight=fence_preflight)
                self._save(path, journal)
                raise UncertainExecution(
                    'target fence is uncertain; reconcile read-only and do not replay') from None
            journal['fence_observation'] = {
                'confirmed': True, 'reply_lost': fence_error is not None,
                'available': target.get('available'), 'bypass': target.get('bypass'),
            }
            self._save(path, journal)

            executor = AppExecutor(self.app_root, self.api)
            for move in journal['moves']:
                self._stage(path, journal, 'replacement_intent')
                expected = self._expected_workloads(journal)
                snapshot, _, target = self._live_check(journal, expected, require_fenced=True)
                if target.get('available') is not True:
                    raise ValueError('target became unavailable while replacements were staged')
                app_plan = self._check_replacement_ready(
                    move, specs[move['logical_app']][0], move['app_run_id'], journal)
                move['replacement_state'] = 'running'
                move['app_plan_sha256'] = app_plan['plan_sha256']
                self._save(path, journal)
                child = executor._execute_locked(app_plan, app_plan['plan_sha256'])
                if child.get('status') != 'complete':
                    raise UncertainExecution('replacement executor did not confirm readiness')
                move['replacement_state'] = 'ready'
                move['replacement_workload_ids'] = child['observed_workload_ids']
                journal['staged_revisions'] = sorted(journal['staged_revisions'] + [
                    {'id': workload_id, 'nodename': move['replacement']['node'],
                     'labels': {'owner': OWNER, 'logical_app': move['logical_app'],
                                'spec_sha256': move['replacement']['spec_sha256']}}
                    for workload_id in child['observed_workload_ids']],
                    key=lambda row: row['id'])
                self._save(path, journal)
                expected = self._expected_workloads(journal)
                self._live_check(journal, expected, require_fenced=True)

            self._stage(path, journal, 'all_replacements_ready')
            expected = self._expected_workloads(journal)
            self._live_check(journal, expected, require_fenced=True)
            ready, readiness = self._all_replacements_ready(journal, specs)
            journal['replacement_readiness_recheck'] = readiness
            self._save(path, journal)
            if not ready:
                journal.update(status='needs_review', reason='not_all_replacements_ready')
                self._save(path, journal)
                raise RuntimeError('all replacements must be ready before any source cleanup')

            cleanup = AppRevisionCleanup(self.app_root, self.api)
            for move, review_move in zip(journal['moves'], review['moves']):
                self._stage(path, journal, 'cleanup_intent')
                expected = self._expected_workloads(journal)
                self._live_check(journal, expected, require_fenced=True)
                cleanup_plan = cleanup.plan(move['app_run_id'], move['cleanup_plan_id'])
                if (cleanup_plan.get('executable') is not True
                        or cleanup_plan.get('targets') != self._source_targets(review_move)):
                    journal.update(status='needs_review', reason='cleanup_targets_differ_from_review')
                    self._save(path, journal)
                    raise RuntimeError('exact source cleanup targets differ from the drain plan')
                cleanup_snapshot, _, _ = self._live_check(
                    journal, expected, require_fenced=True)
                if snapshot_binding(cleanup_snapshot) != cleanup_plan.get('snapshot'):
                    journal.update(status='needs_review', reason='cleanup_snapshot_changed')
                    self._save(path, journal)
                    raise RuntimeError('cleanup plan snapshot differs from the drain state')
                move['cleanup_state'] = 'running'
                move['cleanup_plan_sha256'] = cleanup_plan['plan_sha256']
                self._save(path, journal)
                cleaned = cleanup._execute_locked(cleanup_plan, cleanup_plan['plan_sha256'])
                if cleaned.get('status') != 'complete':
                    raise UncertainExecution('exact-ID cleanup did not complete')
                move['cleanup_state'] = 'complete'
                move['removed_ids'] = [item['id'] for item in self._source_targets(review_move)]
                journal['removed_ids'] = sorted(set(
                    journal['removed_ids'] + move['removed_ids']))
                self._save(path, journal)

            self._stage(path, journal, 'final_empty_target_audit')
            expected = self._expected_workloads(journal)
            final, summary, target = self._live_check(journal, expected, require_fenced=True)
            if any(row.get('nodename') == journal['target']['node']
                   for row in final.get('workloads', []) if isinstance(row, dict)):
                raise ValueError('target metadata still contains a workload')
            # Share the exact, established component-reinstall empty check:
            # metadata, container list, task list, and nested resource usage.
            empty_target(final, journal['target']['node'], journal['target']['alias'])
            host = final['hosts'][journal['target']['alias']]
            task_rows = [line for line in host['tasks'].splitlines()
                         if line.strip() and not line.upper().startswith('TASK ')]
            journal['empty_target_audit'] = {
                'read_only': True, 'workload_count': 0,
                'container_count': len(host['containers'].splitlines()),
                'task_count': len(task_rows), 'resource_usage_zero': True,
                'fence_confirmed': True,
                'preflight': summary,
            }
            journal.update(status='complete', stage='drain_complete', completed_at=_now(),
                           result='target_empty_and_fenced',
                           component_reinstall_allowed=True,
                           next_step='Create a fresh ordinary component-reinstall plan; this executor stops here')
            self._save(path, journal)
            return journal
        except UncertainExecution:
            if journal.get('status') == 'running':
                journal.update(status='uncertain', reason='UncertainExecution')
                self._save(path, journal)
            raise
        except BaseException as exc:
            if journal.get('status') == 'running':
                status = ('uncertain' if journal.get('fence_attempted')
                          or journal.get('removed_ids') else 'failed')
                journal.update(status=status, reason=type(exc).__name__)
                self._save(path, journal)
            raise

    def reconcile(self, run_id):
        """Inspect a drain journal and live state without replaying any action."""
        project = self.root.parents[2]
        with ClusterLock(project):
            return self._reconcile_locked(run_id)

    def _reconcile_locked(self, run_id):
        path = self.run_path(run_id)
        if not path.exists() or path.is_symlink():
            raise FileNotFoundError('worker drain journal missing')
        journal = json.loads(path.read_text())
        if (journal.get('id') != run_id or journal.get('operation') != 'worker-nonempty-drain'
                or journal.get('plan_sha256') != plan_digest(journal.get('plan', {}))):
            raise ValueError('worker drain journal or saved plan is corrupt')
        plan = journal['plan']
        if (plan.get('operation') != 'worker-nonempty-drain-execution-plan'
                or plan.get('id') != run_id
                or plan.get('review_plan_sha256') != plan.get('review_plan', {}).get('plan_sha256')
                or plan.get('review_plan', {}).get('plan_sha256')
                   != drain_plan_digest(plan.get('review_plan', {}))
                or journal.get('target') != plan.get('target')
                or journal.get('baseline') != plan.get('baseline')
                or journal.get('review_plan_sha256') != plan.get('review_plan_sha256')):
            raise ValueError('worker drain journal bindings are inconsistent')
        expected_moves = self._journal_for(plan)['moves']
        actual_moves = journal.get('moves')
        if (not isinstance(actual_moves, list) or len(actual_moves) != len(expected_moves)
                or any(any(actual.get(key) != expected.get(key)
                           for key in ('logical_app', 'source', 'replacement',
                                       'app_run_id', 'cleanup_plan_id'))
                       for actual, expected in zip(actual_moves, expected_moves)
                       if isinstance(actual, dict))
                or any(not isinstance(actual, dict) for actual in actual_moves)):
            raise ValueError('worker drain journal app bindings are inconsistent')
        observation = {
            'at': _now(), 'read_only': True, 'fence_replayed': False,
            'deploy_replayed': False, 'remove_replayed': False,
            'target': {}, 'apps': [],
        }
        snapshot = None
        try:
            snapshot = self.api.snapshot()
            clean, summary = _preflight(self.api, snapshot)
            confirmed = self.api.snapshot()
            if snapshot_binding(confirmed) != snapshot_binding(snapshot):
                clean = False
            snapshot = confirmed
            node = _node(snapshot, journal['target']['node'])
            observation['target'] = {
                'available': node.get('available'), 'bypass': node.get('bypass'),
                'live_preflight': summary, 'preflight_clean': clean,
            }
            try:
                self._check_state(snapshot, journal, self._identity_rows_from_observation(
                    journal, snapshot), require_fenced=False)
                observation['snapshot_readable'] = True
            except Exception as exc:
                observation['snapshot_readable'] = False
                observation['snapshot_issue_type'] = type(exc).__name__
        except Exception as exc:
            observation['snapshot_error_type'] = type(exc).__name__

        all_replacements_observed = True
        all_source_absent = True
        any_source_missing = False
        for move in journal['moves']:
            replacement = move['replacement']
            stub = {
                'appname': replacement['appname'], 'logical_app': move['logical_app'],
                'spec_sha256': replacement['spec_sha256'],
                'spec': {'node': replacement['node'], 'replicas': move['source']['replicas']},
            }
            app_observation = {'logical_app': move['logical_app']}
            try:
                rows = self.api.list_revision(replacement['appname'])
                valid, reason, identifiers = _safe_revision_rows(rows, stub)
                app_observation['replacement'] = {
                    'state': 'exact_revision_present' if valid else 'incomplete_or_mismatched',
                    'reason': reason, 'workload_ids': identifiers,
                    'readiness_reprobed': False,
                }
                if (not valid or identifiers != sorted(
                        move.get('replacement_workload_ids', []))):
                    app_observation['replacement']['state'] = 'incomplete_or_unjournaled'
                    all_replacements_observed = False
            except Exception as exc:
                app_observation['replacement'] = {
                    'state': 'query_error', 'error_type': type(exc).__name__,
                    'readiness_reprobed': False,
                }
                all_replacements_observed = False

            source_states = []
            for workload_id in move['source']['workload_ids']:
                try:
                    row = self.api.get_workload(workload_id)
                    if row is None:
                        state = 'absent'
                        any_source_missing = True
                    elif self._source_row_matches(row, move):
                        state = 'present_exact'
                        all_source_absent = False
                    else:
                        state = 'identity_mismatch'
                        all_source_absent = False
                    source_states.append({'workload_id': workload_id, 'state': state})
                except Exception as exc:
                    state = 'query_error'
                    all_source_absent = False
                    source_states.append({'workload_id': workload_id, 'state': state,
                                          'error_type': type(exc).__name__})
            app_observation['sources'] = source_states
            app_observation['staged_child_journal'] = self._child_ready_state(
                move['app_run_id'])
            app_observation['cleanup_child_journal'] = self._child_cleanup_state(
                move['cleanup_plan_id'])
            observation['apps'].append(app_observation)

        if observation.get('target', {}).get('bypass') is not True:
            recommendation = 'target_fence_not_confirmed_operator_review_required'
        elif not all_replacements_observed:
            recommendation = 'retain_sources_and_create_no_mutations'
        elif not all_source_absent:
            recommendation = 'replacement_presence_observed_revalidate_before_any_fresh_exact_cleanup_plan'
        elif (snapshot is not None
              and observation.get('snapshot_readable') is True
              and observation.get('target', {}).get('preflight_clean') is True
              and observation.get('target', {}).get('available') is True):
            if not self._stored_replacement_readiness(journal):
                recommendation = 'replacement_readiness_not_confirmed_reinstall_blocked'
                observation['component_reinstall_allowed'] = False
            else:
                try:
                    empty_target(snapshot, journal['target']['node'], journal['target']['alias'])
                    recommendation = 'target_empty_and_fenced_fresh_component_reinstall_plan_may_be_created'
                    observation['component_reinstall_allowed'] = True
                except Exception:
                    recommendation = 'target_runtime_or_usage_not_empty_reinstall_blocked'
                    observation['component_reinstall_allowed'] = False
        else:
            recommendation = 'live_snapshot_unavailable_reinstall_blocked'
            observation['component_reinstall_allowed'] = False
        if any_source_missing and not all_replacements_observed:
            recommendation = 'source_loss_without_complete_replacements_operator_attention_required'
        observation['recovery_recommendation'] = recommendation
        observation['component_reinstall_allowed'] = (
            observation.get('component_reinstall_allowed') is True
            and observation.get('target', {}).get('bypass') is True)
        journal['reconciliation'] = observation
        if journal.get('status') != 'complete':
            journal.update(status='needs_review', stage='reconciled_read_only')
        self._save(path, journal)
        return journal

    def _identity_rows_from_observation(self, journal, snapshot):
        # Recovery compares only the currently observed set with itself here;
        # exact source/replacement identities are independently queried below.
        # This marks the snapshot readable without inventing expected mutations.
        return _identity_rows(snapshot)

    @staticmethod
    def _source_row_matches(row, move):
        if not isinstance(row, dict):
            return False
        labels = row.get('labels')
        return (row.get('id') in move['source']['workload_ids']
                and row.get('nodename') == move['source']['node']
                and isinstance(labels, dict) and labels.get('owner') == OWNER
                and labels.get('logical_app') == move['logical_app']
                and labels.get('spec_sha256') == move['source']['spec_sha256'])

    def _child_ready_state(self, run_id):
        path = self.app_root / 'runs' / (run_id + '.json')
        if not path.exists() or path.is_symlink():
            return 'missing'
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return 'unreadable'
        return ('complete_with_probe_evidence'
                if data.get('status') == 'complete'
                and isinstance(data.get('probes'), list)
                and all(isinstance(row, dict) and row.get('passed') is True
                        for row in data['probes'])
                else str(data.get('status', 'unknown')))

    def _child_cleanup_state(self, plan_id):
        path = self.app_root / 'runs' / ('remove-' + plan_id + '.json')
        if not path.exists() or path.is_symlink():
            return 'missing'
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return 'unreadable'
        return str(data.get('status', 'unknown'))

    @staticmethod
    def _stored_replacement_readiness(journal):
        observations = journal.get('replacement_readiness_recheck')
        if not isinstance(observations, list):
            return False
        by_app = {row.get('logical_app'): row for row in observations
                  if isinstance(row, dict) and isinstance(row.get('logical_app'), str)}
        if set(by_app) != {move['logical_app'] for move in journal.get('moves', [])}:
            return False
        for move in journal.get('moves', []):
            summary = by_app[move['logical_app']]
            probes = summary.get('probes')
            identifiers = summary.get('workload_ids')
            expected_ids = move.get('replacement_workload_ids')
            if (not isinstance(probes, list)
                    or len(probes) != move['source']['replicas']
                    or not isinstance(identifiers, list)
                    or not isinstance(expected_ids, list)
                    or any(not isinstance(workload_id, str)
                           for workload_id in identifiers + expected_ids)
                    or sorted(identifiers) != sorted(expected_ids or [])
                    or any(not isinstance(probe, dict)
                           or not isinstance(probe.get('workload_id'), str)
                           for probe in probes)
                    or sorted([probe.get('workload_id') for probe in probes])
                       != sorted(expected_ids or [])
                    or any(probe.get('passed') is not True for probe in probes)):
                return False
        return True

    def recover(self, run_id):
        """Named read-only recovery entry point; it never resumes a failed run."""
        return self.reconcile(run_id)
