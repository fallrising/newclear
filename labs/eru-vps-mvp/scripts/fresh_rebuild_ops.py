"""Strict private lifecycle for the ERU-015 review-only fresh rebuild plan."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

from fresh_rebuild import ALIASES, IDENTIFIER, TOP_FIELDS, build_plan, plan_digest
from labctl import code_inputs, load_inventory
from labops import atomic_json, digest
from reimage_review import load_intent


MAX_INPUT_BYTES = 16 * 1024 * 1024
RECORD_AREA = Path('private/operations/fresh-rebuild/review-plans')


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('fresh rebuild JSON contains a duplicate field')
        result[key] = value
    return result


def _nonstandard_constant(value):
    raise ValueError('fresh rebuild JSON contains a non-standard number: ' + value)


def _private_file(project, value, *, directory=None):
    """Allow the trusted private root symlink, but never a symlink below it."""
    root = Path(project).absolute()
    private_link = root / 'private'
    requested = Path(value)
    if not requested.is_absolute():
        requested = root / requested
    candidate = Path(os.path.abspath(requested))
    try:
        relative = candidate.relative_to(private_link)
    except ValueError as exc:
        raise ValueError('fresh rebuild inputs must stay under project private/') from exc
    if directory is not None and (relative.parent != Path(directory)
                                  or relative.suffix != '.json'):
        raise ValueError('fresh rebuild input is outside its exact private directory')
    if not private_link.exists() or not private_link.resolve().is_dir():
        raise ValueError('project private directory is unavailable')
    current = private_link.resolve()
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('fresh rebuild private paths may not contain symlinks')
    resolved = current.resolve()
    if (not resolved.is_relative_to(private_link.resolve())
            or not resolved.is_file()
            or resolved.stat().st_size > MAX_INPUT_BYTES):
        raise ValueError('fresh rebuild input must be a bounded regular private file')
    return candidate, resolved


def _read_json(project, binding, *, directory, label):
    if not isinstance(binding, dict) or set(binding) != {'path', 'sha256'}:
        raise ValueError(label + ' must contain exactly path and sha256')
    logical, resolved = _private_file(project, binding['path'], directory=directory)
    raw = resolved.read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    if binding['sha256'] != actual:
        raise ValueError(label + ' changed or does not match its reviewed SHA-256')
    try:
        value = json.loads(
            raw, object_pairs_hook=_unique_object,
            parse_constant=_nonstandard_constant)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(label + ' is not valid JSON') from exc
    return value, logical.relative_to(Path(project).absolute()).as_posix(), actual


def _strict_local_json(project, relative, label):
    logical, resolved = _private_file(project, relative)
    raw = resolved.read_bytes()
    try:
        value = json.loads(
            raw, object_pairs_hook=_unique_object,
            parse_constant=_nonstandard_constant)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(label + ' is not valid JSON') from exc
    return value, logical.relative_to(Path(project).absolute()).as_posix(), hashlib.sha256(raw).hexdigest()


def _record_path(project, plan_id):
    root = Path(project).absolute()
    private_link = root / 'private'
    directory = private_link.resolve()
    for part in RECORD_AREA.parts[1:]:
        directory = directory / part
        if directory.is_symlink():
            raise ValueError('fresh rebuild record directories may not be symlinks')
        directory.mkdir(exist_ok=True, mode=0o700)
        if not directory.is_dir():
            raise ValueError('fresh rebuild record path is not a directory')
    path = directory / (plan_id + '.json')
    if path.is_symlink():
        raise ValueError('fresh rebuild plan record may not be a symlink')
    return path


def _write_once(path, value):
    """Reserve the final name exclusively, then replace only that reservation."""
    try:
        descriptor = os.open(
            path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError as exc:
        raise FileExistsError(
            'fresh rebuild plan already exists; use a fresh plan ID') from exc
    os.close(descriptor)
    # If serialization or replacement fails, retain the empty reservation.  A
    # fresh ID is safer than treating an interrupted plan write as reusable.
    atomic_json(path, value)


def _current_bindings(project, input_path, input_sha, inventory_path, inventory_sha,
                      cluster_path, cluster_sha, report_path, report_sha,
                      source_state):
    project = Path(project)
    artifacts = project / 'artifacts.amd64.lock.json'
    upstream = project / 'upstream.lock.json'
    validation = project / 'patches/core-v0.1.5-lock-context.validation.json'
    for path, label in ((artifacts, 'artifact lock'), (upstream, 'upstream lock'),
                        (validation, 'core validation')):
        if path.is_symlink() or not path.is_file():
            raise ValueError(label + ' is missing or unsafe')
    inputs = code_inputs(project)
    from fresh_generation import historical_code_inputs
    inputs = historical_code_inputs(project, inputs)
    return {
        'fresh_input': {'path': input_path, 'sha256': input_sha},
        'inventory': {'path': inventory_path, 'sha256': inventory_sha},
        'cluster_record': {'path': cluster_path, 'sha256': cluster_sha},
        'controller_report': {'path': report_path, 'sha256': report_sha},
        'current_source': source_state,
        'code_inputs_sha256': digest(inputs),
        'code_inputs': inputs,
        'artifacts_lock_sha256': hashlib.sha256(artifacts.read_bytes()).hexdigest(),
        'upstream_lock_sha256': hashlib.sha256(upstream.read_bytes()).hexdigest(),
        'core_validation_sha256': hashlib.sha256(validation.read_bytes()).hexdigest(),
    }


def _git_source(project):
    revision = subprocess.run(
        ['git', '-C', str(project), 'rev-parse', 'HEAD'],
        capture_output=True, text=True, timeout=15, check=False)
    status = subprocess.run(
        ['git', '-C', str(project), 'status', '--porcelain', '--', '.'],
        capture_output=True, text=True, timeout=15, check=False)
    commit = revision.stdout.strip()
    if (revision.returncode or status.returncode
            or not re.fullmatch(r'[0-9a-f]{40}', commit)):
        raise ValueError('current project source commit or cleanliness cannot be verified')
    return {'commit': commit, 'project_clean': not status.stdout.strip()}


def _previous_accepted(project, series):
    if not isinstance(series, dict):
        return None
    previous = series.get('previous_accepted_run')
    if previous is None:
        return None
    if (not isinstance(previous, dict)
            or set(previous) != {'id', 'plan_sha256', 'generation', 'acceptance'}
            or not isinstance(previous['id'], str)
            or not IDENTIFIER.fullmatch(previous['id'])):
        raise ValueError('previous accepted run reference is malformed')
    review_relative = (
        'private/operations/fresh-rebuild/review-plans/'
        + previous['id'] + '.json')
    review, review_path, _review_file_sha = _strict_local_json(
        project, review_relative, 'previous fresh rebuild review plan')
    acceptance, acceptance_path, acceptance_sha = _read_json(
        project, previous['acceptance'],
        directory='operations/fresh-rebuild/accepted-runs',
        label='previous accepted run evidence')
    # Claimed PASS fields and a digest require their actual sealed backing
    # evidence, exact local commit and durable completion to be verified.
    from fresh_generation_ops import verify_accepted_lineage
    verify_accepted_lineage(project, previous['acceptance'])
    return {
        'review_plan': review,
        'review_path': review_path,
        'acceptance': acceptance,
        'acceptance_path': acceptance_path,
        'acceptance_sha256': acceptance_sha,
    }


def save_review_plan(project, input_file, plan_id=None, *, now=None,
                     source_state=None):
    """Save one immutable local review plan; never invokes Operator or SSH."""
    project = Path(project).absolute()
    current = now or datetime.now(timezone.utc)
    source_before = source_state if source_state is not None else _git_source(project)
    input_path, input_resolved = _private_file(
        project, input_file, directory='fresh-rebuild-intents')
    input_raw = input_resolved.read_bytes()
    try:
        document = json.loads(
            input_raw, object_pairs_hook=_unique_object,
            parse_constant=_nonstandard_constant)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('fresh rebuild input is not valid JSON') from exc
    if not isinstance(document, dict) or set(document) != TOP_FIELDS:
        raise ValueError('fresh rebuild input must contain exactly the reviewed schema fields')
    input_relative = input_path.relative_to(project).as_posix()
    input_sha = hashlib.sha256(input_raw).hexdigest()

    inventory_document, inventory_path, inventory_sha = _strict_local_json(
        project, 'private/deployment-plan.json', 'private inventory')
    inventory = load_inventory(project)
    if not isinstance(inventory_document, list) or any(
            not isinstance(row, dict) for row in inventory_document):
        raise ValueError('private inventory must contain host objects')
    try:
        inventory_projection = [
            {key: row[key] for key in ('alias', 'node', 'role', 'ip')}
            for row in inventory_document
        ]
    except KeyError as exc:
        raise ValueError('private inventory is missing a reviewed host field') from exc
    if inventory_projection != inventory:
        raise ValueError('private inventory projection differs from reviewed topology')
    if document['inventory'] != {'path': inventory_path, 'sha256': inventory_sha}:
        raise ValueError('fresh rebuild inventory binding differs from current private inventory')
    cluster, cluster_path, cluster_sha = _strict_local_json(
        project, 'private/operations/cluster.json', 'cluster record')

    report, report_path, report_sha = _read_json(
        project, document['controller_report'], directory='controller-preflight',
        label='controller report')

    refs = document['host_intents']
    if not isinstance(refs, list) or len(refs) != 4:
        raise ValueError('host_intents must enumerate exactly four hosts')
    host_intents = []
    for expected_alias, expected_node, _role in (
            (alias, f'worker-{index}', 'core' if index == 1 else 'worker')
            for index, alias in enumerate(ALIASES, 1)):
        ref = refs[len(host_intents)]
        if not isinstance(ref, dict) or set(ref) != {'alias', 'node', 'path', 'sha256'}:
            raise ValueError('host intent reference must contain exact identity, path and SHA-256')
        if (ref['alias'], ref['node']) != (expected_alias, expected_node):
            raise ValueError('host intent references must follow the reviewed four-host topology')
        raw_intent, logical_path, actual_sha = _read_json(
            project, {'path': ref['path'], 'sha256': ref['sha256']},
            directory='reimage-intents', label='host reimage intent')
        target = raw_intent.get('target') if isinstance(raw_intent, dict) else None
        machine_id = target.get('machine_id') if isinstance(target, dict) else None
        if not isinstance(machine_id, str) or not machine_id:
            raise ValueError('host reimage intent target machine identity is missing')
        record = load_intent(
            project, logical_path, node=expected_node, alias=expected_alias,
            machine_id=machine_id, now=current)
        if record['sha256'] != actual_sha or record['path'] != logical_path:
            raise ValueError('host reimage intent changed during validation')
        host_intents.append(record)

    plan_id = plan_id or ('fresh-' + uuid.uuid4().hex[:24])
    bindings = _current_bindings(
        project, input_relative, input_sha, inventory_path, inventory_sha,
        cluster_path, cluster_sha, report_path, report_sha,
        source_before)
    previous_accepted = _previous_accepted(project, document['series'])
    if source_state is None:
        source_after = _git_source(project)
        if source_after != source_before:
            raise ValueError('current project source changed during fresh rebuild planning')
    plan = build_plan(
        document, inventory=inventory, cluster=cluster,
        host_intents=host_intents, controller_report=report,
        bindings=bindings, plan_id=plan_id, now=current,
        previous_accepted=previous_accepted)
    envelope = {'plan': plan, 'sha256': plan_digest(plan)}
    output = _record_path(project, plan_id)
    _write_once(output, envelope)
    relative_output = Path('private/operations/fresh-rebuild/review-plans') / output.name
    return envelope, relative_output
