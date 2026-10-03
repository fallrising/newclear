"""Private plans and journals for ERU-010 worker-loss recovery."""
import json
import os
from pathlib import Path
import re

from labops import ClusterLock, atomic_json
from worker_loss import INPUT_FIELDS, PLAN_ID, build_plan, plan_digest
from worker_loss_executor import WorkerLossExecutor, execution_plan
from worker_loss_replacement import (
    WorkerLossReplacementExecutor, build_replacement_plan)


AREA = Path('private/operations/worker-loss')
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
        raise ValueError('worker loss inputs and records must stay inside project private/')
    current = root
    for part in candidate.relative_to(root).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('worker loss private paths may not contain symlinks')
    if must_exist and (not candidate.is_file()
                       or candidate.stat().st_size > MAX_INPUT_BYTES):
        raise ValueError('private input must be a regular JSON file no larger than 16 MiB')
    return candidate


def _record_path(project, category, plan_id, *, create=True):
    if not isinstance(plan_id, str) or not PLAN_ID.fullmatch(plan_id):
        raise ValueError('invalid worker loss plan ID')
    root = Path(project).absolute()
    relative = AREA / category
    directory = root / relative
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('worker loss record directories may not be symlinks')
        if create:
            current.mkdir(exist_ok=True, mode=0o700)
        if not current.is_dir():
            raise ValueError('worker loss record path is not a directory')
    path = directory / (plan_id + '.json')
    _private_path(root, path, must_exist=False)
    if path.is_symlink():
        raise ValueError('worker loss record may not be a symlink')
    return path


def _read_input(project, input_path):
    path = _private_path(project, input_path)
    document = json.loads(path.read_text())
    if not isinstance(document, dict) or set(document) != INPUT_FIELDS:
        raise ValueError('input must contain exactly: ' + ', '.join(sorted(INPUT_FIELDS)))
    return document


def _load_plan(project, category, plan_id, expected_sha256):
    if not isinstance(expected_sha256, str) or not SHA256.fullmatch(expected_sha256):
        raise ValueError('worker loss plan SHA-256 must be 64 lowercase hex digits')
    path = _record_path(project, category, plan_id, create=False)
    path = _private_path(project, path)
    plan = json.loads(path.read_text())
    if plan.get('id') != plan_id or plan.get('plan_sha256') != expected_sha256:
        raise ValueError('saved worker loss plan identity or hash does not match')
    return plan


def _write_plan(project, category, plan):
    path = _record_path(project, category, plan.get('id'))
    if path.exists():
        raise FileExistsError('worker loss plan already exists; use a fresh plan ID')
    atomic_json(path, plan)
    return path


def _validated_review_input(project, review_plan_id, review_plan_sha256, input_path):
    """Reload the immutable review plan and prove the private input still matches."""
    review = _load_plan(
        project, 'review-plans', review_plan_id, review_plan_sha256)
    if review.get('plan_sha256') != plan_digest(review):
        raise ValueError('saved worker loss review plan is corrupt')
    document = _read_input(project, input_path)
    rebuilt = build_plan(
        review['target']['node'], document['snapshot'], document['apps'],
        document['destinations'], document['detection'], document['fence'],
        document['control_plane_health_ok'], document['healthy_workers_ok'],
        document['unexpected_consistency_issues'], review['id'])
    if rebuilt.get('plan_sha256') != review['plan_sha256']:
        raise ValueError('private worker loss input differs from the saved review plan')
    return review, document


def save_review_plan(project, target, input_path, plan_id=None):
    """Build and save one immutable, non-executable private review plan."""
    document = _read_input(project, input_path)
    plan = build_plan(
        target, document['snapshot'], document['apps'], document['destinations'],
        document['detection'], document['fence'], document['control_plane_health_ok'],
        document['healthy_workers_ok'], document['unexpected_consistency_issues'],
        plan_id)
    output = _write_plan(project, 'review-plans', plan)
    return plan, output


def prepare_execution_plan(project, plan_id, expected_sha256, input_path, api):
    """Rebuild the private review input, then bind fresh live read-only state."""
    review, _ = _validated_review_input(
        project, plan_id, expected_sha256, input_path)
    plan = execution_plan(review, api)
    path = _write_plan(project, 'execution-plans', plan)
    return plan, path


def execute_saved_plan(project, plan_id, expected_sha256, api_factory):
    """Execute once while holding the shared controller mutation lock."""
    with ClusterLock(project):
        plan = _load_plan(project, 'execution-plans', plan_id, expected_sha256)
        executor = WorkerLossExecutor(Path(project).absolute() / AREA, api_factory())
        return executor._execute_locked(plan, expected_sha256)


def recover_run(project, run_id, api_factory):
    """Reconcile exact IDs and quota read-only; never replay dissociation."""
    with ClusterLock(project):
        executor = WorkerLossExecutor(Path(project).absolute() / AREA, api_factory())
        return executor._reconcile_locked(run_id)


def prepare_fresh_cleanup(project, run_id, api_factory, plan_id=None):
    """Create a new exact-ID subset plan from read-only recovery evidence."""
    with ClusterLock(project):
        executor = WorkerLossExecutor(Path(project).absolute() / AREA, api_factory())
        plan = executor._plan_fresh_cleanup_locked(run_id, plan_id)
        path = _write_plan(project, 'recovery-cleanup-plans', plan)
        return plan, path


def execute_fresh_cleanup(project, plan_id, expected_sha256, api_factory):
    """Execute one saved fresh subset plan; its source plan is never replayed."""
    with ClusterLock(project):
        plan = _load_plan(
            project, 'recovery-cleanup-plans', plan_id, expected_sha256)
        executor = WorkerLossExecutor(Path(project).absolute() / AREA, api_factory())
        return executor._execute_locked(plan, expected_sha256)


def _cleanup_plan_category(journal):
    operation = journal.get('operation')
    if operation == 'worker-loss-stale-cleanup':
        return 'execution-plans'
    if operation == 'worker-loss-recovery-cleanup':
        return 'recovery-cleanup-plans'
    raise ValueError('worker loss replacement source operation is invalid')


def prepare_replacement_plan(project, run_id, input_path, api_factory, plan_id=None):
    """Reconcile cleanup, then save a fresh all-app replacement wrapper plan."""
    with ClusterLock(project):
        api = api_factory()
        cleanup_executor = WorkerLossExecutor(Path(project).absolute() / AREA, api)
        cleanup = cleanup_executor._reconcile_locked(run_id)
        category = _cleanup_plan_category(cleanup)
        cleanup_plan = _load_plan(
            project, category, run_id, cleanup.get('plan_sha256'))
        cleanup_executor._validate_provenance_chain(cleanup_plan, cleanup)
        review_plan_id = cleanup.get(
            'review_plan_id', cleanup.get('origin_run_id', run_id))
        review, document = _validated_review_input(
            project, review_plan_id,
            cleanup.get('review_plan_sha256'), input_path)
        plan = build_replacement_plan(
            review, cleanup, cleanup_plan, document['apps'], api, plan_id)
        path = _write_plan(project, 'replacement-plans', plan)
        return plan, path


def execute_replacement_plan(
        project, plan_id, expected_sha256, input_path, api_factory):
    """Execute one saved replacement wrapper exactly once under the shared lock."""
    with ClusterLock(project):
        plan = _load_plan(
            project, 'replacement-plans', plan_id, expected_sha256)
        review, document = _validated_review_input(
            project, plan.get('review_plan_id'),
            plan.get('review_plan_sha256'), input_path)
        if review != plan.get('review_plan'):
            raise ValueError('saved replacement review binding changed')
        _record_path(project, 'replacement-runs', plan_id)
        app_root = Path(project).absolute() / 'private/operations/apps'
        for move in plan.get('moves', []):
            app_run = app_root / 'runs' / (str(move.get('app_run_id')) + '.json')
            _private_path(project, app_run, must_exist=False)
        executor = WorkerLossReplacementExecutor(
            Path(project).absolute() / AREA, api_factory(), app_root)
        return executor._execute_locked(
            plan, expected_sha256, document['apps'])


def recover_replacement_run(project, run_id, api_factory):
    """Reconcile replacement identities read-only; never replay deployment."""
    with ClusterLock(project):
        _record_path(project, 'replacement-runs', run_id, create=False)
        executor = WorkerLossReplacementExecutor(
            Path(project).absolute() / AREA, api_factory(),
            Path(project).absolute() / 'private/operations/apps')
        return executor._reconcile_locked(run_id)
