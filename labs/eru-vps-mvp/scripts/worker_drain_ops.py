"""Private-file and operation helpers for the ERU-009 labctl commands."""
import json
import os
from pathlib import Path
import re
import uuid

from app_cleanup import AppRevisionCleanup
from app_desired import canonical_bytes, sha256, snapshot_binding
from labops import ClusterLock, atomic_json
from worker_drain import PLAN_ID, build_plan as build_drain_plan
from worker_drain import plan_digest as review_plan_digest
from worker_drain_executor import (WorkerDrainExecutor,
                                   execution_plan as build_execution_plan)

AREA = Path('private/operations/worker-drain')
MAX_INPUT_BYTES = 16 * 1024 * 1024
SHA256 = re.compile(r'^[0-9a-f]{64}$')


def _private_path(project, value, *, must_exist=True):
    root = Path(project).absolute()
    private = root / 'private'
    requested = Path(value)
    if not requested.is_absolute():
        requested = root / requested
    candidate = Path(os.path.abspath(requested))
    if not candidate.is_relative_to(private):
        raise ValueError('worker drain inputs and records must stay inside project private/')

    current = root
    for part in candidate.relative_to(root).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('worker drain private paths may not contain symlinks')
    if must_exist:
        if not candidate.is_file() or candidate.stat().st_size > MAX_INPUT_BYTES:
            raise ValueError('private input must be a regular JSON file no larger than 16 MiB')
    return candidate


def _read_private_json(project, value):
    path = _private_path(project, value)
    return json.loads(path.read_text())


def _ensure_operation_directories(project, *, create):
    root = Path(project).absolute()
    relative_paths = (
        Path('private/operations'),
        AREA,
        AREA / 'runs',
        AREA / 'recovery-cleanup-plans',
        Path('private/operations/apps'),
        Path('private/operations/apps/runs'),
    )
    for relative in relative_paths:
        target = root / relative
        _private_path(root, target, must_exist=False)
        current = root
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError('worker drain operation directories may not be symlinks')
            if current.exists():
                if not current.is_dir():
                    raise ValueError('worker drain operation path is not a directory')
            elif create:
                current.mkdir(mode=0o700)


def _record_path(project, category, plan_id, *, create=False):
    if not isinstance(plan_id, str) or not PLAN_ID.fullmatch(plan_id):
        raise ValueError('invalid worker drain plan ID')
    root = Path(project).absolute()
    directory = root / AREA / category
    if create:
        for path in (root / 'private', root / 'private/operations',
                     root / AREA, directory):
            if path.is_symlink():
                raise ValueError('worker drain record directories may not be symlinks')
            path.mkdir(parents=False, exist_ok=True, mode=0o700)
            if not path.is_dir():
                raise ValueError('worker drain record path is not a directory')
    path = directory / (plan_id + '.json')
    _private_path(root, path, must_exist=False)
    if path.is_symlink():
        raise ValueError('worker drain record may not be a symlink')
    return path


def _write_plan(project, category, plan):
    path = _record_path(project, category, plan.get('id'), create=True)
    if path.exists():
        raise FileExistsError('worker drain plan already exists; use a fresh plan ID')
    atomic_json(path, plan)
    return path


def _load_plan(project, category, plan_id, expected_sha256):
    if not isinstance(expected_sha256, str) or not SHA256.fullmatch(expected_sha256):
        raise ValueError('worker drain plan SHA-256 must be 64 lowercase hex digits')
    path = _record_path(project, category, plan_id)
    path = _private_path(project, path)
    document = json.loads(path.read_text())
    if not isinstance(document, dict) or document.get('id') != plan_id:
        raise ValueError('saved worker drain plan identity mismatch')
    if document.get('plan_sha256') != expected_sha256:
        raise ValueError('worker drain plan hash does not match --sha256')
    return document


def save_review_plan(project, target, input_path, plan_id=None):
    """Build and privately save the offline, non-executable review plan."""
    document = _read_private_json(project, input_path)
    allowed = {'snapshot', 'apps', 'destinations', 'health_ok', 'consistency_issues'}
    if not isinstance(document, dict) or set(document) != allowed:
        raise ValueError('input must contain exactly: ' + ', '.join(sorted(allowed)))
    plan = build_drain_plan(
        target, document['snapshot'], document['apps'], document['destinations'],
        document['health_ok'], document['consistency_issues'], plan_id)
    path = _write_plan(project, 'review-plans', plan)
    return plan, path


def prepare_execution_plan(project, plan_id, expected_sha256, apps_path, api):
    """Read live state and privately save a hash-bound execution plan."""
    review = _load_plan(project, 'review-plans', plan_id, expected_sha256)
    if review.get('plan_sha256') != review_plan_digest(review):
        raise ValueError('saved worker drain review plan is corrupt')
    desired_specs = _read_private_json(project, apps_path)
    if not isinstance(desired_specs, list):
        raise ValueError('private desired specs input must be a JSON array')
    plan = build_execution_plan(review, desired_specs, api)
    path = _write_plan(project, 'execution-plans', plan)
    return plan, path


def execute_saved_plan(project, plan_id, expected_sha256, apps_path, api_factory):
    """Execute once while holding the controller lock before reading inputs."""
    with ClusterLock(project):
        _ensure_operation_directories(project, create=True)
        plan = _load_plan(project, 'execution-plans', plan_id, expected_sha256)
        desired_specs = _read_private_json(project, apps_path)
        if not isinstance(desired_specs, list):
            raise ValueError('private desired specs input must be a JSON array')
        root = Path(project).absolute() / AREA
        executor = WorkerDrainExecutor(root, api_factory())
        return executor._execute_locked(plan, expected_sha256, desired_specs)


def recover_run(project, run_id, api_factory):
    """Reconcile while locked; adapter calls are read-only and never replay."""
    with ClusterLock(project):
        _ensure_operation_directories(project, create=False)
        root = Path(project).absolute() / AREA
        executor = WorkerDrainExecutor(root, api_factory())
        return executor._reconcile_locked(run_id)


def _seal_recovery_cleanup_plan(plan):
    unsigned = dict(plan)
    unsigned.pop('plan_sha256', None)
    plan['plan_sha256'] = sha256(canonical_bytes(unsigned))
    return plan


def prepare_fresh_cleanup(project, run_id, api_factory):
    """Reconcile read-only, then plan one fresh exact-ID cleanup for review."""
    with ClusterLock(project):
        _ensure_operation_directories(project, create=True)
        root = Path(project).absolute() / AREA
        executor = WorkerDrainExecutor(root, api_factory())
        journal = executor._reconcile_locked(run_id)
        observation = journal.get('reconciliation')
        if (journal.get('status') == 'complete'
                or not isinstance(observation, dict)
                or observation.get('fresh_cleanup_plan_allowed') is not True):
            raise ValueError('read-only recovery state does not permit a fresh cleanup plan')

        expected = executor._expected_observed_workloads(journal, observation)
        app_by_name = {row.get('logical_app'): row
                       for row in observation.get('apps', [])
                       if isinstance(row, dict)}
        remaining = []
        for move in journal.get('moves', []):
            app = app_by_name.get(move['logical_app'])
            sources = app.get('sources') if isinstance(app, dict) else None
            if (not isinstance(sources, list)
                    or any(not isinstance(row, dict)
                           or not isinstance(row.get('workload_id'), str)
                           or row.get('state') not in {'present_exact', 'absent'}
                           for row in sources)):
                raise ValueError('read-only recovery source observations are malformed')
            ids = sorted(row['workload_id'] for row in sources
                         if row['state'] == 'present_exact')
            if ids:
                remaining.append((move, ids))
        if not remaining:
            return {
                'operation': 'worker-drain-recovery-cleanup-result',
                'worker_drain_run_id': run_id, 'decision': 'no_work',
                'fresh_cleanup_plan_allowed': False,
                'component_reinstall_allowed':
                    observation.get('component_reinstall_allowed') is True,
                'reconciliation_at': observation.get('at'),
            }, None

        # Plan only one logical app at a time. After its exact-ID cleanup, the
        # operator must reconcile again before planning the next app.
        move, remaining_ids = sorted(remaining, key=lambda item: item[0]['logical_app'])[0]
        recovery_id = 'drainrec-' + uuid.uuid4().hex[:24]
        cleanup_id = 'drainrmfresh-' + uuid.uuid4().hex[:24]
        cleanup = AppRevisionCleanup(executor.app_root, executor.api)
        child_plan = cleanup.plan(move['app_run_id'], cleanup_id)
        expected_targets = executor._source_targets(move)
        expected_targets = [row for row in expected_targets
                            if row['id'] in set(remaining_ids)]
        if (child_plan.get('executable') is not True
                or child_plan.get('blockers')
                or child_plan.get('targets') != expected_targets):
            raise ValueError('fresh cleanup plan is blocked or differs from reconciled exact IDs')

        snapshot, _, target = executor._live_check(
            journal, expected, require_fenced=True)
        if (snapshot_binding(snapshot) != child_plan.get('snapshot')
                or target.get('available') is not True
                or target.get('bypass') is not True):
            raise ValueError('live state changed after fresh cleanup planning')

        plan = _seal_recovery_cleanup_plan({
            'schema_version': 1,
            'operation': 'worker-drain-recovery-cleanup-plan',
            'id': recovery_id,
            'worker_drain_run_id': run_id,
            'worker_drain_plan_sha256': journal['plan_sha256'],
            'reconciliation_sha256': sha256(canonical_bytes(observation)),
            'reconciliation_at': observation['at'],
            'logical_app': move['logical_app'],
            'source_workload_ids': remaining_ids,
            'cleanup_plan': child_plan,
            'cleanup_plan_sha256': child_plan['plan_sha256'],
            'decision': 'ready', 'blockers': [], 'executable': False,
            'steps': [
                'Review the exact remaining source IDs in the private cleanup plan',
                'Execute this fresh cleanup plan once; the ERU-012 executor rechecks snapshot, readiness, and exact IDs',
                'Run read-only worker-drain recovery again before another cleanup plan or component reinstall',
            ],
        })
        path = _write_plan(project, 'recovery-cleanup-plans', plan)
        return plan, path


def execute_fresh_cleanup(project, recovery_plan_id, expected_sha256,
                          expected_cleanup_sha256, api_factory):
    """Execute the child ERU-012 exact-ID plan bound to its recovery proof."""
    with ClusterLock(project):
        _ensure_operation_directories(project, create=True)
        plan = _load_plan(project, 'recovery-cleanup-plans',
                          recovery_plan_id, expected_sha256)
        if (plan.get('plan_sha256') != _sealed_digest(plan)
                or plan.get('operation') != 'worker-drain-recovery-cleanup-plan'
                or plan.get('decision') != 'ready' or plan.get('executable') is not False
                or plan.get('blockers')):
            raise ValueError('fresh cleanup recovery plan is corrupt or not reviewable')
        child_plan = plan.get('cleanup_plan')
        if (not isinstance(child_plan, dict)
                or child_plan.get('plan_sha256') != expected_cleanup_sha256
                or plan.get('cleanup_plan_sha256') != expected_cleanup_sha256):
            raise ValueError('fresh exact-ID cleanup hash does not match the recovery plan')
        root = Path(project).absolute() / AREA
        parent_path = _private_path(
            project, root / 'runs' / (plan['worker_drain_run_id'] + '.json'))
        parent = json.loads(parent_path.read_text())
        observation = parent.get('reconciliation')
        if (parent.get('plan_sha256') != plan.get('worker_drain_plan_sha256')
                or not isinstance(observation, dict)
                or observation.get('fresh_cleanup_plan_allowed') is not True
                or sha256(canonical_bytes(observation))
                   != plan.get('reconciliation_sha256')):
            raise ValueError('worker-drain reconciliation changed; create a fresh cleanup plan')
        child_id = child_plan.get('id')
        targets = child_plan.get('targets')
        if (not isinstance(child_id, str)
                or not child_id.startswith('drainrmfresh-')
                or not isinstance(targets, list)
                or any(not isinstance(item, dict)
                       or not isinstance(item.get('id'), str) for item in targets)
                or child_plan.get('source_run_id') != next(
                    (move.get('app_run_id') for move in parent.get('moves', [])
                     if move.get('logical_app') == plan.get('logical_app')), None)
                or sorted(item['id'] for item in targets)
                   != plan.get('source_workload_ids')):
            raise ValueError('fresh cleanup plan is not bound to the recovered app IDs')
        executor = WorkerDrainExecutor(root, api_factory())
        return AppRevisionCleanup(executor.app_root, executor.api)._execute_locked(
            child_plan, expected_cleanup_sha256)


def _sealed_digest(plan):
    unsigned = dict(plan)
    unsigned.pop('plan_sha256', None)
    return sha256(canonical_bytes(unsigned))
