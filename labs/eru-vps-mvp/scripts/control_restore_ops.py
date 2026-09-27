"""Strict private lifecycle for ERU-016 restore-control review plans."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import uuid

from control_restore import IDENTIFIER, TOP_FIELDS, build_plan, plan_digest
from labctl import code_inputs
from labops import digest


MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024 * 1024
RECORD_AREA = Path('private/operations/restore-control/review-plans')


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('control restore JSON contains a duplicate field')
        result[key] = value
    return result


def _nonstandard_constant(value):
    raise ValueError('control restore JSON contains a non-standard number: ' + value)


def _private_relative(project, value, *, directory=None, suffix=None):
    root = Path(project).absolute()
    private_link = root / 'private'
    requested = Path(value)
    if not requested.is_absolute():
        requested = root / requested
    candidate = Path(os.path.abspath(requested))
    try:
        relative = candidate.relative_to(private_link)
    except ValueError as exc:
        raise ValueError('control restore inputs must stay under project private/') from exc
    if directory is not None and relative.parent != Path(directory):
        raise ValueError('control restore input is outside its exact private directory')
    if suffix is not None and relative.suffix != suffix:
        raise ValueError('control restore input has an unexpected file type')
    if not relative.parts or any(part in ('', '.', '..') for part in relative.parts):
        raise ValueError('control restore private path is invalid')
    return candidate, relative


def _open_private(project, value, *, private_root_fd=None, directory=None,
                  suffix=None, maximum=MAX_JSON_BYTES):
    """Open through anchored dirfds; only the top-level private link may resolve."""
    logical, relative = _private_relative(
        project, value, directory=directory, suffix=suffix)
    flags = os.O_RDONLY | os.O_DIRECTORY
    try:
        directory_fd = (os.dup(private_root_fd) if private_root_fd is not None
                        else os.open(Path(project).absolute() / 'private', flags))
    except OSError as exc:
        raise ValueError('project private directory is unavailable') from exc
    try:
        for part in relative.parts[:-1]:
            try:
                child_fd = os.open(
                    part, flags | os.O_NOFOLLOW, dir_fd=directory_fd)
            except OSError as exc:
                raise ValueError('control restore private paths may not contain symlinks') from exc
            os.close(directory_fd)
            directory_fd = child_fd
        try:
            descriptor = os.open(
                relative.parts[-1], os.O_RDONLY | os.O_NOFOLLOW,
                dir_fd=directory_fd)
        except OSError as exc:
            raise ValueError(
                'control restore private paths may not contain symlinks and must end in a file') from exc
    finally:
        os.close(directory_fd)
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > maximum:
        os.close(descriptor)
        raise ValueError('control restore input must be a bounded regular private file')
    return logical, descriptor, metadata


def _read_stable(descriptor, before, *, label):
    chunks = []
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            break
        chunks.append(chunk)
    after = os.fstat(descriptor)
    identity = lambda value: (
        value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)
    if identity(before) != identity(after):
        raise ValueError(label + ' changed while it was being reviewed')
    return b''.join(chunks)


def _load_json_path(project, value, *, private_root_fd=None, directory=None,
                    label, expected_sha=None):
    logical, descriptor, metadata = _open_private(
        project, value, private_root_fd=private_root_fd, directory=directory,
        suffix='.json', maximum=MAX_JSON_BYTES)
    try:
        raw = _read_stable(descriptor, metadata, label=label)
    finally:
        os.close(descriptor)
    actual = hashlib.sha256(raw).hexdigest()
    if expected_sha is not None and expected_sha != actual:
        raise ValueError(label + ' changed or does not match its reviewed SHA-256')
    try:
        document = json.loads(
            raw, object_pairs_hook=_unique_object,
            parse_constant=_nonstandard_constant)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(label + ' is not valid JSON') from exc
    return document, logical.relative_to(Path(project).absolute()).as_posix(), actual


def _load_binding(project, binding, *, private_root_fd=None, directory, label):
    if not isinstance(binding, dict) or set(binding) != {'path', 'sha256'}:
        raise ValueError(label + ' must contain exactly path and sha256')
    return _load_json_path(
        project, binding['path'], private_root_fd=private_root_fd,
        directory=directory, label=label,
        expected_sha=binding['sha256'])


def _snapshot_binding(project, value, expected_sha, expected_size, *,
                      private_root_fd=None):
    logical, descriptor, before = _open_private(
        project, value, private_root_fd=private_root_fd,
        directory='control-metadata-snapshots', suffix='.db',
        maximum=MAX_SNAPSHOT_BYTES)
    try:
        hasher = hashlib.sha256()
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            hasher.update(chunk)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    if before.st_size < 1 or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise ValueError('snapshot changed while it was being reviewed')
    actual = hasher.hexdigest()
    if actual != expected_sha or before.st_size != expected_size:
        raise ValueError('snapshot bytes or size differ from the reviewed binding')
    return logical.relative_to(Path(project).absolute()).as_posix(), actual, before.st_size


def _write_once(project, plan_id, value, *, private_root_fd=None):
    flags = os.O_RDONLY | os.O_DIRECTORY
    try:
        directory_fd = (os.dup(private_root_fd) if private_root_fd is not None
                        else os.open(Path(project).absolute() / 'private', flags))
    except OSError as exc:
        raise ValueError('project private directory is unavailable') from exc
    try:
        for part in RECORD_AREA.parts[1:]:
            try:
                os.mkdir(part, mode=0o700, dir_fd=directory_fd)
            except FileExistsError:
                pass
            try:
                child_fd = os.open(
                    part, flags | os.O_NOFOLLOW, dir_fd=directory_fd)
            except OSError as exc:
                raise ValueError('control restore record directories may not be symlinks') from exc
            os.close(directory_fd)
            directory_fd = child_fd
        temporary_name = '.' + plan_id + '.' + uuid.uuid4().hex + '.tmp'
        descriptor = os.open(
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600, dir_fd=directory_fd)
        raw = (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()
        try:
            offset = 0
            while offset < len(raw):
                written = os.write(descriptor, raw[offset:])
                if written < 1:
                    raise OSError('short write while saving control restore plan')
                offset += written
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        try:
            os.link(
                temporary_name, plan_id + '.json',
                src_dir_fd=directory_fd, dst_dir_fd=directory_fd,
                follow_symlinks=False)
            os.fsync(directory_fd)
        except FileExistsError as exc:
            raise FileExistsError(
                'control restore plan already exists; use a fresh plan ID') from exc
        finally:
            try:
                os.unlink(temporary_name, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
    finally:
        os.close(directory_fd)
    return RECORD_AREA / (plan_id + '.json')


def _git_source(project):
    revision = subprocess.run(
        ['git', '-C', str(project), 'rev-parse', 'HEAD'],
        capture_output=True, text=True, timeout=15, check=False)
    status_result = subprocess.run(
        ['git', '-C', str(project), 'status', '--porcelain', '--', '.'],
        capture_output=True, text=True, timeout=15, check=False)
    commit = revision.stdout.strip()
    if (revision.returncode or status_result.returncode
            or not re.fullmatch(r'[0-9a-f]{40}', commit)):
        raise ValueError('current project source commit or cleanliness cannot be verified')
    return {'commit': commit, 'project_clean': not status_result.stdout.strip()}


def _git_committed_trust_sha256(project):
    top = subprocess.run(
        ['git', '-C', str(project), 'rev-parse', '--show-toplevel'],
        capture_output=True, text=True, timeout=15, check=False)
    if top.returncode:
        raise ValueError('repository root cannot be verified for restore trust')
    try:
        relative = (Path(project) / 'control-restore-trust.json').relative_to(
            Path(top.stdout.strip())).as_posix()
    except ValueError as exc:
        raise ValueError('restore trust index is outside the current repository') from exc
    blob = subprocess.run(
        ['git', '-C', str(project), 'show', 'HEAD:' + relative],
        capture_output=True, timeout=15, check=False)
    if blob.returncode:
        raise ValueError('restore trust index is not committed at current HEAD')
    return hashlib.sha256(blob.stdout).hexdigest()


def _fd_identity(descriptor):
    metadata = os.fstat(descriptor)
    return metadata.st_dev, metadata.st_ino


def _current_private_identity(project):
    try:
        descriptor = os.open(Path(project) / 'private', os.O_RDONLY | os.O_DIRECTORY)
    except OSError as exc:
        raise ValueError('project private directory is unavailable') from exc
    try:
        return _fd_identity(descriptor)
    finally:
        os.close(descriptor)


def _current_bindings(project, source_state, records):
    project = Path(project)
    artifacts = project / 'artifacts.amd64.lock.json'
    upstream = project / 'upstream.lock.json'
    validation = project / 'patches/core-v0.1.5-lock-context.validation.json'
    restore_trust = project / 'control-restore-trust.json'
    for path, label in ((artifacts, 'artifact lock'), (upstream, 'upstream lock'),
                        (validation, 'core validation'),
                        (restore_trust, 'control restore trust index')):
        if path.is_symlink() or not path.is_file():
            raise ValueError(label + ' is missing or unsafe')
    inputs = code_inputs(project)
    return {
        **records, 'current_source': source_state,
        'code_inputs': inputs, 'code_inputs_sha256': digest(inputs),
        'artifacts_lock_sha256': hashlib.sha256(artifacts.read_bytes()).hexdigest(),
        'upstream_lock_sha256': hashlib.sha256(upstream.read_bytes()).hexdigest(),
        'core_validation_sha256': hashlib.sha256(validation.read_bytes()).hexdigest(),
        'restore_trust_sha256': hashlib.sha256(restore_trust.read_bytes()).hexdigest(),
    }


def _restore_trust(project):
    path = Path(project) / 'control-restore-trust.json'
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as exc:
        raise ValueError('control restore trust index is missing or unsafe') from exc
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_JSON_BYTES:
            raise ValueError('control restore trust index must be a bounded regular file')
        raw = _read_stable(descriptor, metadata, label='control restore trust index')
    finally:
        os.close(descriptor)
    try:
        value = json.loads(
            raw, object_pairs_hook=_unique_object,
            parse_constant=_nonstandard_constant)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('control restore trust index is not valid JSON') from exc
    if (not isinstance(value, dict) or set(value) != {
            'schema_version', 'operation', 'status_receipts',
            'catalog_receipts', 'toolchains', 'core_key_records'}
            or value['schema_version'] != 1
            or value['operation'] != 'control-restore-trust-index'):
        raise ValueError('control restore trust index has an unsupported schema')
    sha_pattern = re.compile(r'^[0-9a-f]{64}$')
    schemas = {
        'status_receipts': {
            'receipt_sha256', 'snapshot_sha256',
            'source_cluster_snapshot_sha256',
            'source_endpoint_evidence_sha256', 'capture_method',
            'full_keyspace', 'etcdutl_sha256'},
        'catalog_receipts': {
            'receipt_sha256', 'snapshot_sha256', 'object_sha256',
            'object_id_sha256'},
        'toolchains': {
            'etcd_version', 'artifact_release_sha256', 'etcd_sha256',
            'etcdctl_sha256', 'etcdutl_sha256'},
        'core_key_records': {
            'recovery_mode', 'evidence_sha256', 'revoke_set_sha256'},
    }
    for name, fields in schemas.items():
        rows = value[name]
        if not isinstance(rows, list) or any(
                not isinstance(row, dict) or set(row) != fields for row in rows):
            raise ValueError('control restore trust index ' + name + ' is malformed')
        for row in rows:
            for field, item in row.items():
                if field == 'etcd_version':
                    if not isinstance(item, str) or not re.fullmatch(r'v3\.6\.\d+', item):
                        raise ValueError('trusted etcd version is invalid')
                elif field == 'capture_method':
                    if item != 'etcdctl-snapshot-save':
                        raise ValueError('trusted snapshot capture method is invalid')
                elif field == 'full_keyspace':
                    if item is not True:
                        raise ValueError('trusted snapshot must cover the full keyspace')
                elif field == 'recovery_mode':
                    if item not in {'restore-verified-external-key', 'rotate-and-revoke'}:
                        raise ValueError('trusted core key recovery mode is invalid')
                elif not isinstance(item, str) or not sha_pattern.fullmatch(item):
                    raise ValueError('control restore trust digest is invalid')
        if len({json.dumps(row, sort_keys=True) for row in rows}) != len(rows):
            raise ValueError('control restore trust index contains duplicate records')
    return value, hashlib.sha256(raw).hexdigest()


def _etcd_release(project):
    path = Path(project) / 'artifacts.amd64.lock.json'
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_JSON_BYTES:
        raise ValueError('artifact lock is missing or unsafe')
    try:
        value = json.loads(
            path.read_bytes(), object_pairs_hook=_unique_object,
            parse_constant=_nonstandard_constant)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('artifact lock is not valid JSON') from exc
    artifacts = value.get('artifacts') if isinstance(value, dict) else None
    matches = [item for item in artifacts or []
               if isinstance(item, dict) and item.get('repository') == 'etcd-io/etcd']
    if len(matches) != 1 or set(matches[0]).issuperset({'tag', 'sha256'}) is False:
        raise ValueError('artifact lock must contain one pinned etcd release')
    return {'tag': matches[0]['tag'], 'sha256': matches[0]['sha256']}


def _save_review_plan(project, input_file, plan_id=None, *, private_root_fd,
                      private_root_identity,
                      now=None, source_state=None,
                      committed_trust_sha256=None):
    """Save one immutable local plan without invoking Operator or etcd tools."""
    project = Path(project).absolute()
    current = now or datetime.now(timezone.utc)
    source_before = source_state if source_state is not None else _git_source(project)
    document, input_path, input_sha = _load_json_path(
        project, input_file, private_root_fd=private_root_fd,
        directory='restore-control-intents',
        label='control restore input')
    if not isinstance(document, dict) or set(document) != TOP_FIELDS:
        raise ValueError('control restore input must contain exactly the reviewed schema fields')

    inventory_document, inventory_path, inventory_sha = _load_json_path(
        project, 'private/deployment-plan.json', private_root_fd=private_root_fd,
        label='private inventory')
    try:
        projection = [{key: row[key] for key in ('alias', 'node', 'role', 'ip')}
                      for row in inventory_document]
    except (TypeError, KeyError) as exc:
        raise ValueError('private inventory is missing a reviewed host field') from exc
    inventory = projection
    cluster, cluster_path, cluster_sha = _load_json_path(
        project, 'private/operations/cluster.json',
        private_root_fd=private_root_fd, label='cluster record')
    report, report_path, report_sha = _load_binding(
        project, document['controller_report'], private_root_fd=private_root_fd,
        directory='controller-preflight',
        label='controller report')
    source_snapshot, source_path, source_sha = _load_binding(
        project, document['source_cluster_snapshot'], private_root_fd=private_root_fd,
        directory='control-restore-sources', label='source cluster snapshot')
    status_document, status_path, status_sha = _load_binding(
        project, document['snapshot']['status_evidence'],
        private_root_fd=private_root_fd,
        directory='control-restore-status', label='snapshot status evidence')
    catalog_document, catalog_path, catalog_sha = _load_binding(
        project, document['snapshot']['external_copy']['catalog_receipt'],
        private_root_fd=private_root_fd,
        directory='backup-catalog', label='external snapshot catalog receipt')
    snapshot_path, snapshot_sha, snapshot_size = _snapshot_binding(
        project, document['snapshot']['path'], document['snapshot']['sha256'],
        document['snapshot']['size_bytes'], private_root_fd=private_root_fd)
    trust_index, trust_sha = _restore_trust(project)
    if _current_private_identity(project) != private_root_identity:
        raise ValueError('project private root changed during restore planning')
    committed_trust = (_git_committed_trust_sha256(project)
                       if source_state is None else committed_trust_sha256)
    if committed_trust != trust_sha:
        raise ValueError('control restore trust index differs from committed HEAD')

    records = {
        'restore_input': {'path': input_path, 'sha256': input_sha},
        'inventory': {'path': inventory_path, 'sha256': inventory_sha},
        'cluster_record': {'path': cluster_path, 'sha256': cluster_sha},
        'controller_report': {'path': report_path, 'sha256': report_sha},
        'source_cluster_snapshot': {'path': source_path, 'sha256': source_sha},
    }
    if document['inventory'] != records['inventory']:
        raise ValueError('inventory binding differs from current private inventory')
    if document['cluster_record'] != records['cluster_record']:
        raise ValueError('cluster record binding differs from current private cluster record')
    bindings = _current_bindings(project, source_before, records)
    if bindings['restore_trust_sha256'] != trust_sha:
        raise ValueError('control restore trust index changed during validation')
    bindings['restore_trust_committed_sha256'] = committed_trust
    loaded = {
        'snapshot_path': snapshot_path, 'snapshot_sha256': snapshot_sha,
        'snapshot_size': snapshot_size,
        'status': status_document,
        'status_binding': {'path': status_path, 'sha256': status_sha},
        'catalog': catalog_document,
        'catalog_binding': {'path': catalog_path, 'sha256': catalog_sha},
        'etcd_release': _etcd_release(project),
        'trust_index': trust_index,
        'source_cluster_snapshot_sha256': source_sha,
    }
    if document['snapshot']['status_evidence'] != loaded['status_binding']:
        raise ValueError('snapshot status binding changed during validation')
    if document['snapshot']['external_copy']['catalog_receipt'] != loaded['catalog_binding']:
        raise ValueError('external catalog binding changed during validation')

    chosen_id = plan_id or ('restore-' + uuid.uuid4().hex[:24])
    if not isinstance(chosen_id, str) or not IDENTIFIER.fullmatch(chosen_id):
        raise ValueError('control restore plan id must be a bounded identifier')
    if source_state is None:
        source_after = _git_source(project)
        if source_after != source_before:
            raise ValueError('current project source changed during restore planning')
    plan = build_plan(
        document, inventory=inventory, cluster=cluster,
        controller_report=report, source_snapshot=source_snapshot,
        loaded=loaded, bindings=bindings, plan_id=chosen_id, now=current)
    envelope = {'plan': plan, 'sha256': plan_digest(plan)}
    if _current_private_identity(project) != private_root_identity:
        raise ValueError('project private root changed during restore planning')
    output = _write_once(
        project, chosen_id, envelope, private_root_fd=private_root_fd)
    return envelope, output


def save_review_plan(project, input_file, plan_id=None, *, now=None,
                     source_state=None, committed_trust_sha256=None):
    """Pin one private-root identity for the complete read/validate/write transaction."""
    project = Path(project).absolute()
    try:
        private_root_fd = os.open(project / 'private', os.O_RDONLY | os.O_DIRECTORY)
    except OSError as exc:
        raise ValueError('project private directory is unavailable') from exc
    try:
        private_root_identity = _fd_identity(private_root_fd)
        result = _save_review_plan(
            project, input_file, plan_id, private_root_fd=private_root_fd,
            private_root_identity=private_root_identity,
            now=now, source_state=source_state,
            committed_trust_sha256=committed_trust_sha256)
        if _current_private_identity(project) != private_root_identity:
            raise ValueError('project private root changed during restore planning')
        return result
    finally:
        os.close(private_root_fd)
