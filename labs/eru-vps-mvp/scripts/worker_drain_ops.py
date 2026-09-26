"""Private-file and operation helpers for the ERU-009 labctl commands."""
import json
import os
from pathlib import Path
import re

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
