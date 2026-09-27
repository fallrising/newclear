"""Fresh ERU-012 replacement orchestration after fenced worker loss cleanup."""
import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import uuid

from app_desired import OWNER, canonical_bytes, sha256, spec_identity
from app_executor import AppExecutor, _safe_revision_rows, execution_plan as app_execution_plan
from labops import ClusterLock, atomic_json
from worker_drain import PLAN_ID
from worker_loss import plan_digest as review_plan_digest
from worker_loss_executor import (
    SHA256, WorkerLossExecutor, _control_binding, _node, _node_static_digest,
    _preflight, _record_digest, _target_fenced, _usage_state, _workload_binding,
)


def _now():
    return datetime.now(timezone.utc).isoformat()


def plan_digest(plan):
    unsigned = dict(plan)
    unsigned.pop('plan_sha256', None)
    return sha256(canonical_bytes(unsigned))


def _validated_specs(review, desired_specs):
    if (not isinstance(review, dict)
            or review.get('plan_sha256') != review_plan_digest(review)
            or review.get('operation') != 'worker-loss-recovery-review-plan'
            or review.get('decision') != 'reviewable'
            or review.get('blockers')):
        raise ValueError('worker loss review plan is corrupt or blocked')
    moves = review.get('moves')
    if not isinstance(desired_specs, list) or not isinstance(moves, list):
        raise ValueError('private desired specs must cover every reviewed move')
    by_name = {}
    for document in desired_specs:
        normalized, digest, appname = spec_identity(document)
        if normalized['name'] in by_name:
            raise ValueError('private desired specs contain duplicate logical apps')
        by_name[normalized['name']] = (normalized, digest, appname)
    if set(by_name) != {move.get('logical_app') for move in moves}:
        raise ValueError('private desired specs differ from the reviewed app set')
    replacements = {}
    for move in moves:
        logical = move['logical_app']
        source = move.get('source')
        replacement = move.get('replacement')
        normalized, digest, appname = by_name[logical]
        if (not isinstance(source, dict) or not isinstance(replacement, dict)
                or normalized['node'] != review['target']['node']
                or source.get('spec_sha256') != digest
                or source.get('appname') != appname
                or source.get('replicas') != normalized['replicas']
                or len(source.get('workload_ids', [])) != normalized['replicas']):
            raise ValueError('private source spec differs from the worker loss review')
        destination_spec = dict(normalized, node=replacement.get('node'))
        destination_spec, destination_digest, destination_appname = spec_identity(
            destination_spec)
        if (replacement.get('spec_sha256') != destination_digest
                or replacement.get('appname') != destination_appname
                or replacement.get('replicas') != destination_spec['replicas']):
            raise ValueError('private replacement spec differs from the reviewed move')
        replacements[logical] = destination_spec
    return replacements


def build_replacement_plan(
        review, cleanup_journal, cleanup_plan, desired_specs, api, plan_id=None):
    """Bind cleared stale state and original private specs without deploying."""
    specs = _validated_specs(review, desired_specs)
    reconciliation = cleanup_journal.get('reconciliation')
    if cleanup_journal.get('operation') == 'worker-loss-stale-cleanup':
        cleanup_plan_category = 'execution-plans'
    elif cleanup_journal.get('operation') == 'worker-loss-recovery-cleanup':
        cleanup_plan_category = 'recovery-cleanup-plans'
    else:
        raise ValueError('worker loss cleanup journal operation is invalid')
    if (not isinstance(cleanup_plan, dict)
            or cleanup_plan.get('id') != cleanup_journal.get('id')
            or cleanup_plan.get('operation') != (
                'worker-loss-stale-cleanup-plan'
                if cleanup_plan_category == 'execution-plans'
                else 'worker-loss-recovery-cleanup-plan')
            or cleanup_plan.get('plan_sha256') != plan_digest(cleanup_plan)
            or cleanup_journal.get('plan_sha256') != cleanup_plan['plan_sha256']
            or cleanup_journal.get('targets') != cleanup_plan.get('targets')
            or cleanup_journal.get('baseline') != cleanup_plan.get('baseline')
            or cleanup_journal.get('status') != 'complete'
            or cleanup_journal.get('stage') != 'stale_state_cleared'
            or cleanup_journal.get('replacement_plan_allowed') is not True
            or cleanup_journal.get('final_resource_usage', {}).get('nonzero')
               is not False
            or cleanup_journal.get(
                'review_plan_id',
                cleanup_journal.get('origin_run_id', cleanup_journal.get('id')))
               != review.get('id')
            or cleanup_journal.get('review_plan_sha256') != review.get('plan_sha256')
            or not isinstance(reconciliation, dict)
            or reconciliation.get('replacement_plan_allowed') is not True
            or reconciliation.get('read_only') is not True
            or reconciliation.get('dissociate_replayed') is not False
            or reconciliation.get('target_resource_usage', {}).get('nonzero')
               is not False
            or cleanup_journal.get('target') != review.get('target')
            or cleanup_journal.get('fence') not in (None, review.get('fence'))
            or cleanup_journal.get('destinations') != sorted({
                move['replacement']['node'] for move in review['moves']})
            or cleanup_plan.get('review_plan_sha256') != review.get('plan_sha256')
            or cleanup_plan.get('target') != review.get('target')
            or cleanup_plan.get('fence') != review.get('fence')
            or cleanup_plan.get('destinations') != cleanup_journal.get('destinations')):
        raise ValueError('worker loss cleanup has not opened the replacement gate')
    original_ids = sorted(review.get('target_stale_state', {}).get('workload_ids', []))
    if not original_ids:
        raise ValueError('worker loss review has no original stale identities')
    for workload_id in original_ids:
        try:
            row = api.get_workload(workload_id)
        except Exception as exc:
            raise ValueError('original stale workload query failed') from exc
        if row is not None:
            raise ValueError('an original stale workload is still present or changed')

    target = review['target']['node']
    destinations = sorted({move['replacement']['node'] for move in review['moves']})
    first = api.snapshot()
    clean, first_summary = _preflight(api, first, target, destinations)
    if not clean:
        raise ValueError('replacement preflight is not clean')
    second = api.snapshot()
    clean, second_summary = _preflight(api, second, target, destinations)
    if not clean or _control_binding(first) != _control_binding(second):
        raise ValueError('replacement snapshots are not stable and clean')
    _target_fenced(second, target)
    usage = _usage_state(second, target)
    if usage['nonzero'] is not False:
        raise ValueError('target quota must be known zero before replacement planning')
    for destination in destinations:
        row = _node(second, destination)
        if row.get('available') is not True or row.get('bypass') is not False:
            raise ValueError('replacement destination is not available and unfenced')
    binding = _control_binding(second)
    if any(row.get('id') in set(original_ids) for row in binding.get('workloads', [])):
        raise ValueError('original stale workload identity reappeared')

    plan_id = plan_id or ('lossreplace-' + uuid.uuid4().hex[:24])
    if (not isinstance(plan_id, str) or not PLAN_ID.fullmatch(plan_id)
            or plan_id in {cleanup_journal.get('id'), review.get('id')}):
        raise ValueError('replacement requires a fresh valid plan ID')
    moves = []
    review_moves = {move['logical_app']: move for move in review['moves']}
    for logical in sorted(specs):
        move = review_moves[logical]
        child_id = 'lossapp-' + sha256(
            (plan_id + '\0' + logical + '\0' + review['plan_sha256']).encode())[:24]
        normalized, digest, appname = spec_identity(specs[logical])
        moves.append({
            'logical_app': logical,
            'source': copy.deepcopy(move['source']),
            'replacement': copy.deepcopy(move['replacement']),
            'spec': normalized,
            'spec_sha256': digest,
            'appname': appname,
            'app_run_id': child_id,
        })
    snapshots = [_record_digest(_control_binding(first)), _record_digest(binding)]
    plan = {
        'schema_version': 1,
        'operation': 'worker-loss-replacement-plan',
        'id': plan_id,
        'review_plan': copy.deepcopy(review),
        'review_plan_id': review['id'],
        'review_plan_sha256': review['plan_sha256'],
        'source': {
            'cleanup_run_id': cleanup_journal['id'],
            'cleanup_plan_category': cleanup_plan_category,
            'cleanup_plan_sha256': cleanup_journal['plan_sha256'],
            'cleanup_plan_record_sha256': _record_digest(cleanup_plan),
            'cleanup_journal_sha256': _record_digest(cleanup_journal),
            'reconciliation_sha256': _record_digest(reconciliation),
        },
        'target': copy.deepcopy(review['target']),
        'fence': copy.deepcopy(review['fence']),
        'destinations': destinations,
        'original_stale_workload_ids': original_ids,
        'moves': moves,
        'baseline': {
            'snapshot': binding,
            'snapshot_sha256': snapshots[-1],
            'stable_snapshot_sha256': snapshots,
            'node_static_sha256': _node_static_digest(second),
            'workloads': _workload_binding(second),
            'target_resource_usage_sha256': usage['sha256'],
            'target_resource_usage_nonzero': usage['nonzero'],
        },
        'preflight': [first_summary, second_summary],
        'decision': 'ready', 'blockers': [], 'executable': True,
        'execution_implemented': True,
        'steps': [
            'Recheck the source cleanup journal, target fence, zero quota, and full workload identities',
            'For each app, build a fresh ERU-012 child plan against the latest snapshot',
            'Execute each child once and require exact replica identity plus HTTP readiness',
            'Recheck every replacement and stop without node removal, target resume, or resource --fix',
        ],
        'failure_policy': [
            'A wrapper or child plan with a journal is never replayed',
            'Desired-spec, snapshot, fence, quota, destination, identity, or readiness drift stops the run',
        ],
    }
    plan['plan_sha256'] = plan_digest(plan)
    return plan


class _ReplacementAppAPI:
    def __init__(self, api, target, destinations):
        self.api = api
        self.target = target
        self.destinations = destinations

    def snapshot(self):
        return self.api.snapshot()

    def preflight(self, snapshot):
        return self.api.preflight(snapshot, self.target, self.destinations)

    def deploy(self, plan):
        return self.api.deploy(plan)

    def list_revision(self, appname):
        return self.api.list_revision(appname)

    def probe(self, row, desired):
        return self.api.probe(row, desired)


class WorkerLossReplacementExecutor:
    def __init__(self, root, api, app_root=None):
        self.root = Path(root)
        self.api = api
        self.app_root = Path(app_root) if app_root else self.root.parent / 'apps'

    def run_path(self, run_id):
        if not isinstance(run_id, str) or not PLAN_ID.fullmatch(run_id):
            raise ValueError('invalid worker loss replacement run ID')
        return self.root / 'replacement-runs' / (run_id + '.json')

    def _save(self, path, journal):
        journal['updated_at'] = _now()
        atomic_json(path, journal)

    def _stage(self, path, journal, stage):
        journal['stage'] = stage
        journal.setdefault('events', []).append({'at': _now(), 'event': stage})
        self._save(path, journal)

    @staticmethod
    def _expected_workloads(journal):
        rows = list(journal['baseline']['workloads']) + list(
            journal.get('staged_revisions', []))
        if len({row['id'] for row in rows}) != len(rows):
            raise ValueError('replacement workload identities collide')
        return sorted(rows, key=lambda row: row['id'])

    def _live_check(self, journal):
        first = self.api.snapshot()
        clean, summary = _preflight(
            self.api, first, journal['target']['node'], journal['destinations'])
        if not clean:
            raise ValueError('replacement live preflight is not clean')
        second = self.api.snapshot()
        clean, second_summary = _preflight(
            self.api, second, journal['target']['node'], journal['destinations'])
        if not clean or _control_binding(first) != _control_binding(second):
            raise ValueError('replacement live state is not stable and clean')
        _target_fenced(second, journal['target']['node'])
        if _node_static_digest(second) != journal['baseline']['node_static_sha256']:
            raise ValueError('worker identity or target fence changed')
        usage = _usage_state(second, journal['target']['node'])
        if (usage['nonzero'] is not False
                or usage['sha256'] !=
                   journal['baseline']['target_resource_usage_sha256']):
            raise ValueError('target quota is not the planned known-zero state')
        if _workload_binding(second) != self._expected_workloads(journal):
            raise ValueError('workload identities changed outside replacement stages')
        return second, second_summary

    def _validate(self, plan, expected_sha256, desired_specs):
        if (not isinstance(plan, dict) or plan.get('plan_sha256') != plan_digest(plan)
                or expected_sha256 != plan.get('plan_sha256')
                or plan.get('operation') != 'worker-loss-replacement-plan'
                or plan.get('decision') != 'ready' or plan.get('executable') is not True
                or plan.get('execution_implemented') is not True or plan.get('blockers')):
            raise ValueError('worker loss replacement plan is corrupt or blocked')
        specs = _validated_specs(plan.get('review_plan'), desired_specs)
        if (plan.get('review_plan_id') != plan['review_plan']['id']
                or plan.get('review_plan_sha256') != plan['review_plan']['plan_sha256']
                or plan.get('target') != plan['review_plan'].get('target')
                or plan.get('fence') != plan['review_plan'].get('fence')
                or plan.get('destinations') != sorted({
                    move['replacement']['node']
                    for move in plan['review_plan']['moves']})
                or plan.get('original_stale_workload_ids') != sorted(
                    plan['review_plan'].get('target_stale_state', {}).get(
                        'workload_ids', []))
                or plan.get('baseline', {}).get('target_resource_usage_nonzero') is not False
                or not isinstance(
                    plan.get('baseline', {}).get('target_resource_usage_sha256'), str)
                or not SHA256.fullmatch(
                    plan['baseline']['target_resource_usage_sha256'])
                or not isinstance(
                    plan.get('baseline', {}).get('node_static_sha256'), str)
                or not SHA256.fullmatch(plan['baseline']['node_static_sha256'])
                or plan.get('baseline', {}).get('snapshot_sha256') !=
                   _record_digest(plan.get('baseline', {}).get('snapshot'))
                or plan.get('baseline', {}).get('stable_snapshot_sha256') != [
                    plan.get('baseline', {}).get('snapshot_sha256'),
                    plan.get('baseline', {}).get('snapshot_sha256')]
                or plan.get('baseline', {}).get('workloads') !=
                   plan.get('baseline', {}).get('snapshot', {}).get('workloads')
                or not isinstance(plan.get('moves'), list)
                or len(plan['moves']) != len(specs)
                or any(not isinstance(move, dict) for move in plan['moves'])
                or [move.get('logical_app') for move in plan['moves']] !=
                   sorted(specs)):
            raise ValueError('worker loss replacement bindings are malformed')
        expected_moves = {}
        review_moves = {
            move['logical_app']: move for move in plan['review_plan']['moves']}
        for logical, spec in specs.items():
            normalized, digest, appname = spec_identity(spec)
            expected_moves[logical] = (
                normalized, digest, appname, review_moves[logical])
        for move in plan['moves']:
            expected = expected_moves.get(move.get('logical_app'))
            expected_child_id = 'lossapp-' + sha256(
                (plan['id'] + '\0' + str(move.get('logical_app')) + '\0'
                 + plan['review_plan_sha256']).encode())[:24]
            if (expected is None or move.get('spec') != expected[0]
                    or move.get('spec_sha256') != expected[1]
                    or move.get('appname') != expected[2]
                    or move.get('source') != expected[3].get('source')
                    or move.get('replacement') != expected[3].get('replacement')
                    or move.get('app_run_id') != expected_child_id
                    or move.get('replacement', {}).get('spec_sha256') != expected[1]
                    or move.get('replacement', {}).get('appname') != expected[2]):
                raise ValueError('worker loss replacement desired spec binding changed')
        source = plan.get('source')
        if (not isinstance(source, dict)
                or not isinstance(source.get('cleanup_run_id'), str)
                or source.get('cleanup_plan_category') not in {
                    'execution-plans', 'recovery-cleanup-plans'}
                or any(not isinstance(source.get(key), str)
                       or not SHA256.fullmatch(source[key])
                       for key in ('cleanup_plan_sha256',
                                   'cleanup_plan_record_sha256',
                                   'cleanup_journal_sha256',
                                   'reconciliation_sha256'))):
            raise ValueError('worker loss replacement source binding is malformed')
        loss_executor = WorkerLossExecutor(self.root, self.api)
        source_journal = loss_executor._load_record(
            'runs', source['cleanup_run_id'])
        source_plan = loss_executor._load_record(
            source['cleanup_plan_category'], source['cleanup_run_id'])
        if (_record_digest(source_journal) != source['cleanup_journal_sha256']
                or source_journal.get('id') != source['cleanup_run_id']
                or source_plan.get('id') != source['cleanup_run_id']
                or source_journal.get('operation') != (
                    'worker-loss-stale-cleanup'
                    if source['cleanup_plan_category'] == 'execution-plans'
                    else 'worker-loss-recovery-cleanup')
                or source_plan.get('operation') != (
                    'worker-loss-stale-cleanup-plan'
                    if source['cleanup_plan_category'] == 'execution-plans'
                    else 'worker-loss-recovery-cleanup-plan')
                or source_journal.get('plan_sha256') != source['cleanup_plan_sha256']
                or source_plan.get('plan_sha256') != source['cleanup_plan_sha256']
                or plan_digest(source_plan) != source['cleanup_plan_sha256']
                or _record_digest(source_plan) != source['cleanup_plan_record_sha256']
                or _record_digest(source_journal.get('reconciliation')) !=
                   source['reconciliation_sha256']
                or source_journal.get('status') != 'complete'
                or source_journal.get('stage') != 'stale_state_cleared'
                or source_journal.get('replacement_plan_allowed') is not True
                or source_journal.get('final_resource_usage', {}).get('nonzero')
                   is not False
                or source_journal.get('reconciliation', {}).get(
                    'replacement_plan_allowed') is not True
                or source_journal.get('reconciliation', {}).get('read_only')
                   is not True
                or source_journal.get('reconciliation', {}).get(
                    'dissociate_replayed') is not False
                or source_journal.get('reconciliation', {}).get(
                    'target_resource_usage', {}).get('nonzero') is not False
                or source_journal.get('targets') != source_plan.get('targets')
                or source_journal.get('baseline') != source_plan.get('baseline')
                or source_journal.get(
                    'review_plan_id',
                    source_journal.get(
                        'origin_run_id', source_journal.get('id')))
                   != plan['review_plan_id']
                or source_journal.get('review_plan_sha256') !=
                   plan['review_plan_sha256']
                or source_journal.get('target') != plan.get('target')
                or source_journal.get('fence') not in (None, plan.get('fence'))
                or source_journal.get('destinations') != plan.get('destinations')
                or source_plan.get('review_plan_sha256') !=
                   plan['review_plan_sha256']
                or source_plan.get('target') != plan.get('target')
                or source_plan.get('fence') != plan.get('fence')
                or source_plan.get('destinations') != plan.get('destinations')):
            raise ValueError('worker loss cleanup source changed after replacement planning')
        source_review = loss_executor._validate_provenance_chain(
            source_plan, source_journal)
        if source_review != plan.get('review_plan'):
            raise ValueError('worker loss replacement review provenance changed')
        for workload_id in plan['original_stale_workload_ids']:
            try:
                row = self.api.get_workload(workload_id)
            except Exception as exc:
                raise ValueError('original stale workload query failed') from exc
            if row is not None:
                raise ValueError('an original stale workload is still present or changed')
        return specs

    def execute(self, plan, expected_sha256, desired_specs):
        with ClusterLock(self.root.parents[2]):
            return self._execute_locked(plan, expected_sha256, desired_specs)

    def _execute_locked(self, plan, expected_sha256, desired_specs):
        self._validate(plan, expected_sha256, desired_specs)
        path = self.run_path(plan['id'])
        if path.exists() or path.is_symlink():
            raise ValueError('worker loss replacement journal already exists; recover and create a fresh plan')
        journal = {
            'id': plan['id'], 'operation': 'worker-loss-replacement',
            'status': 'running', 'stage': 'created', 'started_at': _now(),
            'plan_sha256': plan['plan_sha256'], 'plan': copy.deepcopy(plan),
            'source': copy.deepcopy(plan['source']),
            'target': copy.deepcopy(plan['target']),
            'destinations': list(plan['destinations']),
            'baseline': copy.deepcopy(plan['baseline']),
            'moves': [{**copy.deepcopy(move), 'replacement_state': 'not_started'}
                      for move in plan['moves']],
            'staged_revisions': [], 'events': [], 'all_replacements_ready': False,
        }
        self._save(path, journal)
        app_api = _ReplacementAppAPI(
            self.api, journal['target']['node'], journal['destinations'])
        executor = AppExecutor(self.app_root, app_api)
        try:
            self._stage(path, journal, 'preflight')
            live, summary = self._live_check(journal)
            if _control_binding(live) != plan['baseline']['snapshot']:
                raise ValueError('replacement baseline changed before deployment')
            journal['preflight_recheck'] = summary
            self._save(path, journal)

            for move in journal['moves']:
                self._stage(path, journal, 'replacement_plan')
                snapshot, _ = self._live_check(journal)
                child_plan = app_execution_plan(
                    move['spec'], snapshot, True, (), plan_id=move['app_run_id'])
                if (child_plan.get('executable') is not True
                        or child_plan.get('action') not in {
                            'deploy_revision', 'no_op'}
                        or child_plan.get('spec_sha256') != move['spec_sha256']
                        or child_plan.get('appname') != move['appname']
                        or child_plan.get('older_owned_revisions')):
                    raise ValueError('fresh ERU-012 child plan differs from replacement intent')
                move['app_plan_sha256'] = child_plan['plan_sha256']
                move['replacement_state'] = 'running'
                self._save(path, journal)
                child = executor._execute_locked(child_plan, child_plan['plan_sha256'])
                if child.get('status') != 'complete':
                    raise RuntimeError('ERU-012 replacement child did not complete')
                move['replacement_state'] = 'ready'
                move['replacement_workload_ids'] = list(child['observed_workload_ids'])
                if child_plan['action'] == 'deploy_revision':
                    journal['staged_revisions'] = sorted(
                        journal['staged_revisions'] + [
                        {'id': workload_id, 'nodename': move['spec']['node'],
                         'labels': {'owner': OWNER,
                                    'logical_app': move['logical_app'],
                                    'spec_sha256': move['spec_sha256']}}
                        for workload_id in child['observed_workload_ids']],
                        key=lambda row: row['id'])
                self._save(path, journal)
                self._live_check(journal)

            self._stage(path, journal, 'all_replacements_ready')
            readiness = []
            for move in journal['moves']:
                rows = self.api.list_revision(move['appname'])
                valid, reason, ids = _safe_revision_rows(rows, {
                    'appname': move['appname'], 'logical_app': move['logical_app'],
                    'spec_sha256': move['spec_sha256'], 'spec': move['spec'],
                })
                if (not valid or ids != sorted(move['replacement_workload_ids'])):
                    raise RuntimeError(reason or 'replacement identity changed')
                probes = []
                for row in rows:
                    result = self.api.probe(row, move['spec'])
                    passed = (isinstance(result, dict)
                              and result.get('status') ==
                              move['spec']['service']['expected_status']
                              and result.get('body_match') is True)
                    probes.append({'workload_id': row['id'], 'passed': passed,
                                   'http_status': result.get('status')
                                   if isinstance(result, dict) else None})
                    if not passed:
                        raise RuntimeError('replacement HTTP readiness failed')
                readiness.append({'logical_app': move['logical_app'], 'probes': probes})
            self._live_check(journal)
            journal.update(
                status='complete', stage='replacement_ready', completed_at=_now(),
                result='all_replacements_exact_and_http_ready',
                all_replacements_ready=True, replacement_readiness=readiness,
                next_step='Keep the lost node fenced; node removal and target recovery are outside this slice')
            self._save(path, journal)
            return journal
        except BaseException as exc:
            if journal.get('status') == 'running':
                journal.update(status=('uncertain' if any(
                    move.get('replacement_state') != 'not_started'
                    for move in journal['moves']) else 'failed'),
                    reason=type(exc).__name__)
                self._save(path, journal)
            raise

    def reconcile(self, run_id):
        with ClusterLock(self.root.parents[2]):
            return self._reconcile_locked(run_id)

    def _reconcile_locked(self, run_id):
        path = self.run_path(run_id)
        if not path.is_file() or path.is_symlink():
            raise FileNotFoundError('worker loss replacement journal missing')
        journal = json.loads(path.read_text())
        plan = journal.get('plan')
        if (journal.get('id') != run_id
                or journal.get('operation') != 'worker-loss-replacement'
                or not isinstance(plan, dict)
                or journal.get('plan_sha256') != plan_digest(plan)
                or journal.get('source') != plan.get('source')
                or journal.get('target') != plan.get('target')
                or journal.get('destinations') != plan.get('destinations')
                or journal.get('baseline') != plan.get('baseline')
                or not isinstance(journal.get('moves'), list)
                or len(journal['moves']) != len(plan.get('moves', []))):
            raise ValueError('worker loss replacement journal is corrupt')
        plan_moves = {
            move.get('logical_app'): move for move in plan['moves']
            if isinstance(move, dict)}
        static_fields = {
            'logical_app', 'source', 'replacement', 'spec', 'spec_sha256',
            'appname', 'app_run_id'}
        if (len(plan_moves) != len(plan['moves'])
                or any(
                    move.get('logical_app') not in plan_moves
                    or {key: move.get(key) for key in static_fields} !=
                       {key: plan_moves[move.get('logical_app')].get(key)
                        for key in static_fields}
                    for move in journal['moves'])):
            raise ValueError('worker loss replacement journal moves are corrupt')
        observations = []
        all_ready = True
        for move in journal.get('moves', []):
            try:
                rows = self.api.list_revision(move['appname'])
                valid, reason, ids = _safe_revision_rows(rows, {
                    'appname': move['appname'], 'logical_app': move['logical_app'],
                    'spec_sha256': move['spec_sha256'], 'spec': move['spec'],
                })
                ready = (valid and move.get('replacement_state') == 'ready'
                         and ids == sorted(move.get('replacement_workload_ids', [])))
                observations.append({'logical_app': move['logical_app'],
                                     'state': 'ready_exact' if ready else 'not_ready',
                                     'reason': reason, 'workload_count': len(ids)})
                all_ready = all_ready and ready
            except Exception as exc:
                observations.append({'logical_app': move.get('logical_app'),
                                     'state': 'query_failed',
                                     'error_type': type(exc).__name__})
                all_ready = False
        journal['reconciliation'] = {
            'at': _now(), 'read_only': True, 'deploy_replayed': False,
            'apps': observations,
            'all_replacement_identities_exact': all_ready,
            'replacement_completion_previously_proven': (
                journal.get('status') == 'complete'
                and journal.get('all_replacements_ready') is True
                and all_ready),
            'http_readiness_reprobed': False,
        }
        if journal.get('status') != 'complete':
            journal.update(status='needs_review', stage='reconciled_read_only')
        self._save(path, journal)
        return journal
