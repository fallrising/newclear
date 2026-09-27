"""Private review-plan storage for the ERU-010 worker-loss planner."""
import json
import os
from pathlib import Path

from labops import atomic_json
from worker_loss import INPUT_FIELDS, PLAN_ID, build_plan


AREA = Path('private/operations/worker-loss/review-plans')
MAX_INPUT_BYTES = 16 * 1024 * 1024


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


def _record_path(project, plan_id):
    if not isinstance(plan_id, str) or not PLAN_ID.fullmatch(plan_id):
        raise ValueError('invalid worker loss plan ID')
    root = Path(project).absolute()
    directory = root / AREA
    current = root
    for part in AREA.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('worker loss record directories may not be symlinks')
        current.mkdir(exist_ok=True, mode=0o700)
        if not current.is_dir():
            raise ValueError('worker loss record path is not a directory')
    path = directory / (plan_id + '.json')
    _private_path(root, path, must_exist=False)
    if path.is_symlink():
        raise ValueError('worker loss record may not be a symlink')
    return path


def save_review_plan(project, target, input_path, plan_id=None):
    """Build and save one immutable, non-executable private review plan."""
    path = _private_path(project, input_path)
    document = json.loads(path.read_text())
    if not isinstance(document, dict) or set(document) != INPUT_FIELDS:
        raise ValueError('input must contain exactly: ' + ', '.join(sorted(INPUT_FIELDS)))
    plan = build_plan(
        target, document['snapshot'], document['apps'], document['destinations'],
        document['detection'], document['fence'], document['control_plane_health_ok'],
        document['healthy_workers_ok'], document['unexpected_consistency_issues'],
        plan_id)
    output = _record_path(project, plan['id'])
    if output.exists():
        raise FileExistsError('worker loss plan already exists; use a fresh plan ID')
    atomic_json(output, plan)
    return plan, output
