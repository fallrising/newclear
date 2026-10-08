"""Nonexecuting immutable preparation and read-only pending-run inspection.

Local operator attestations are checked for linkage, freshness and readable bytes.
They do not authenticate the owner or prove that an external fence is effective.
No preparation reserves a generation; no inspection releases a barrier.
"""
from datetime import datetime, timezone
import hashlib
import json
import math
import os
import re
from pathlib import Path
import stat
import subprocess

from fresh_execution import (KINDS, context, exact, identifier, public_summary,
                             sha256, timestamp, validate_evidence)
from fresh_rebuild import build_plan, plan_digest
from fresh_rebuild_ops import _current_bindings, _previous_accepted
from labops import ClusterLock
from reimage_review import load_intent
import pending_generation

MAX_BYTES = 16 * 1024 * 1024
AREA = 'private/operations/fresh-rebuild/executions'
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate execution JSON field')
        result[key] = value
    return result


def _constant(_value):
    raise ValueError('invalid execution JSON number')


def _validate_json(value, depth=0):
    if depth > 64:
        raise ValueError('execution JSON nesting exceeds limit')
    if type(value) is float and not math.isfinite(value):
        raise ValueError('execution JSON requires finite numbers')
    if type(value) is dict:
        for item in value.values():
            _validate_json(item, depth + 1)
    elif type(value) is list:
        for item in value:
            _validate_json(item, depth + 1)


def _decode(raw):
    try:
        value = json.loads(raw, object_pairs_hook=_unique, parse_constant=_constant)
        _validate_json(value)
        return value
    except (UnicodeError, ValueError, RecursionError):
        raise ValueError('invalid execution JSON') from None


def _identity(info):
    return [info.st_dev, info.st_ino]


def _safe(info, directory=False):
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if (not kind(info.st_mode) or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) & 0o077
            or (not directory and info.st_nlink != 1)):
        raise ValueError('unsafe execution private entry')


class PrivateFiles:
    """Pinned trusted private root; descendants are descriptor-relative no-follow."""
    def __init__(self, project, *, max_bytes=MAX_BYTES):
        if type(max_bytes) is not int or not 0 < max_bytes <= 128 * 1024 * 1024:
            raise ValueError('execution input limit is invalid')
        self.max_bytes = max_bytes
        self.project = Path(project).absolute()
        self.path = self.project / 'private'
        self.fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            _safe(os.fstat(self.fd), directory=True)
            self.identity = _identity(os.fstat(self.fd))
            self.seen = {}
            self.public_seen = None
            self.source_expected = None
        except BaseException:
            os.close(self.fd)
            raise

    def close(self):
        os.close(self.fd)

    def check(self):
        if _identity(self.path.stat()) != self.identity:
            raise ValueError('execution private root changed')

    def parts(self, value):
        if type(value) is not str or '..' in Path(value).parts:
            raise ValueError('invalid execution private path')
        path = Path(value)
        if path.is_absolute():
            try:
                path = path.relative_to(self.project)
            except ValueError:
                raise ValueError('execution path must be private') from None
        if not path.parts or path.parts[0] != 'private' or len(path.parts) < 2:
            raise ValueError('execution path must be private')
        return path.parts[1:]

    def directory(self, parts, create=False):
        fd = os.dup(self.fd)
        try:
            for part in parts:
                if create:
                    try:
                        os.mkdir(part, 0o700, dir_fd=fd)
                    except FileExistsError:
                        pass
                    os.fsync(fd)
                next_fd = os.open(part, DIR_FLAGS, dir_fd=fd)
                try:
                    _safe(os.fstat(next_fd), directory=True)
                except BaseException:
                    os.close(next_fd)
                    raise
                os.close(fd)
                fd = next_fd
            self.check()
            result, fd = fd, None
            return result
        finally:
            if fd is not None:
                os.close(fd)

    def read(self, value):
        # A deeply verified generation-history context supplies only the
        # canonical sealed before snapshots; ordinary reads stay strict.
        from fresh_generation import historical_read
        historical = historical_read(self, value)
        if historical is not None:
            if len(historical[0]) > self.max_bytes:
                raise ValueError('execution historical input too large')
            self.check()
            return historical
        parts = self.parts(value)
        parent = self.directory(parts[:-1])
        try:
            fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            try:
                before = os.fstat(fd)
                _safe(before)
                if before.st_size > self.max_bytes:
                    raise ValueError('execution input too large')
                with os.fdopen(fd, 'rb', closefd=False) as stream:
                    raw = stream.read(self.max_bytes + 1)
                after = os.fstat(fd)
                current = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
                if (len(raw) != before.st_size or len(raw) > self.max_bytes
                        or _identity(current) != _identity(after)
                        or before.st_mtime_ns != after.st_mtime_ns
                        or before.st_ctime_ns != after.st_ctime_ns):
                    raise ValueError('execution input changed')
                self.check()
                # Reopen the entire descendant route, detecting renamed parents.
                check = self.directory(parts[:-1])
                try:
                    if _identity(os.fstat(check)) != _identity(os.fstat(parent)):
                        raise ValueError('execution input directory changed')
                finally:
                    os.close(check)
                relative = 'private/' + '/'.join(parts)
                sha = hashlib.sha256(raw).hexdigest()
                if relative in self.seen and self.seen[relative] != sha:
                    raise ValueError('execution input changed between reads')
                self.seen[relative] = sha
                return raw, relative, sha
            finally:
                os.close(fd)
        finally:
            os.close(parent)

    def json(self, value):
        raw, relative, sha = self.read(value)
        return _decode(raw), relative, sha

    def binding(self, binding):
        exact(binding, {'path', 'sha256'})
        sha256(binding['sha256'])
        value, relative, sha = self.json(binding['path'])
        if sha != binding['sha256'] or relative != binding['path']:
            raise ValueError('execution file binding mismatch')
        return value

    def recheck(self):
        if self.public_seen is not None and _public_snapshot(self.project) != self.public_seen:
            raise ValueError('execution public source inputs changed')
        if self.source_expected is not None and _git_source(self.project) != self.source_expected:
            raise ValueError('execution source changed')
        for path in list(self.seen):
            self.read(path)
        self.check()

    def publish(self, run_id, envelope):
        parts = self.parts(AREA)
        parent = self.directory(parts, create=True)
        try:
            # The directory itself is the permanent claim, even on failed fsync.
            os.mkdir(run_id, 0o700, dir_fd=parent)
            os.fsync(parent)
            run = os.open(run_id, DIR_FLAGS, dir_fd=parent)
            try:
                raw = json.dumps(envelope, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
                if len(raw) > self.max_bytes:
                    raise ValueError('execution envelope too large')
                fd = os.open('.execution.tmp', os.O_CREAT | os.O_EXCL | os.O_WRONLY
                             | os.O_NOFOLLOW, 0o600, dir_fd=run)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                self.recheck()
                os.link('.execution.tmp', 'execution.json', src_dir_fd=run,
                        dst_dir_fd=run, follow_symlinks=False)
                os.unlink('.execution.tmp', dir_fd=run)
                os.fsync(run)
                current = self.directory(parts + (run_id,))
                try:
                    if _identity(os.fstat(current)) != _identity(os.fstat(run)):
                        raise ValueError('execution publication directory changed')
                finally:
                    os.close(current)
                self.recheck()
            except BaseException:
                # Keep a visible stop marker if a late publication check/fsync fails.
                # Never erase complete bytes or reuse a partially published run.
                try:
                    failed = os.open('.publication-failed', os.O_CREAT | os.O_EXCL
                                     | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=run)
                    os.close(failed)
                    os.fsync(run)
                except OSError:
                    pass
                raise
            finally:
                os.close(run)
        finally:
            os.close(parent)


def _git_source(project):
    """Read Git identity without optional index-refresh writes or lock files."""
    prefix = ['git', '--no-optional-locks', '-C', str(project)]
    revision = subprocess.run(prefix + ['rev-parse', 'HEAD'], capture_output=True,
                              text=True, timeout=15, check=False)
    status = subprocess.run(prefix + ['status', '--porcelain', '--', '.'],
                            capture_output=True, text=True, timeout=15, check=False)
    commit = revision.stdout.strip()
    if (revision.returncode or status.returncode
            or not re.fullmatch(r'[0-9a-f]{40}', commit)):
        raise ValueError('execution source cannot be verified')
    return {'commit': commit, 'project_clean': not status.stdout.strip()}


def _public_snapshot(project):
    """Bound code reads before legacy code_inputs, including newly added files."""
    paths = []
    for directory, patterns in [('scripts', ('*.py',)),
                                 ('patches', ('*.patch', '*.validation.json'))]:
        parent = project / directory
        if parent.is_symlink() or not parent.is_dir():
            raise ValueError('unsafe execution source directory')
        for pattern in patterns:
            paths.extend(parent.glob(pattern))
    paths.extend(project / name for name in ('artifacts.amd64.lock.json', 'upstream.lock.json'))
    result = {}
    for path in paths:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > MAX_BYTES:
                raise ValueError('unsafe execution source file')
            with os.fdopen(fd, 'rb', closefd=False) as stream:
                raw = stream.read(MAX_BYTES + 1)
            after = os.fstat(fd)
            if (len(raw) != before.st_size or len(raw) > MAX_BYTES
                    or _identity(after) != _identity(path.stat(follow_symlinks=False))
                    or before.st_mtime_ns != after.st_mtime_ns
                    or before.st_ctime_ns != after.st_ctime_ns):
                raise ValueError('execution source file changed')
            result[path.relative_to(project).as_posix()] = hashlib.sha256(raw).hexdigest()
        finally:
            os.close(fd)
    return result


def _review(files, plan_id, expected_sha256, now, source_state):
    identifier(plan_id)
    sha256(expected_sha256)
    review_path = 'private/operations/fresh-rebuild/review-plans/' + plan_id + '.json'
    envelope, _, _ = files.json(review_path)
    exact(envelope, {'plan', 'sha256'})
    plan = envelope['plan']
    if (type(plan) is not dict or envelope['sha256'] != expected_sha256
            or plan_digest(plan) != expected_sha256 or plan.get('id') != plan_id):
        raise ValueError('execution review hash mismatch')
    try:
        original_time = timestamp(plan['created_at'])
        if original_time > now:
            raise ValueError('execution review is future')
        bindings = plan['bindings']
        for name, expected in [('inventory', 'private/deployment-plan.json'),
                               ('cluster_record', 'private/operations/cluster.json')]:
            if bindings[name]['path'] != expected:
                raise ValueError('execution requires canonical current cluster inputs')
        for name, directory in [('fresh_input', 'fresh-rebuild-intents'),
                                ('controller_report', 'controller-preflight')]:
            parts = files.parts(bindings[name]['path'])
            if len(parts) != 2 or parts[0] != directory or not parts[-1].endswith('.json'):
                raise ValueError('execution review input directory mismatch')
        document = files.binding(bindings['fresh_input'])
        inventory_document = files.binding(bindings['inventory'])
        cluster = files.binding(bindings['cluster_record'])
        report = files.binding(bindings['controller_report'])
        inventory = [{k: row[k] for k in ('alias', 'node', 'role', 'ip')}
                     for row in inventory_document]
        hosts = []
        for ref in document['host_intents']:
            raw = files.binding({'path': ref['path'], 'sha256': ref['sha256']})
            record = load_intent(files.project, ref['path'], node=ref['node'],
                alias=ref['alias'], machine_id=raw['target']['machine_id'], now=now)
            if record['sha256'] != ref['sha256']:
                raise ValueError('execution host intent changed')
            hosts.append(record)
        # Securely read all private code bindings before existing code_inputs.
        for path in bindings['code_inputs']:
            if path.startswith('private/'):
                files.read(path)
        source = source_state if source_state is not None else _git_source(files.project)
        files.source_expected = source if source_state is None else None
        files.public_seen = _public_snapshot(files.project)
        # Validate newly enumerated private inputs before code_inputs can read them.
        files.read('private/deployment-plan.json')
        files.read('private/verified-host-public-keys.json')
        preflight = files.directory(('preflight',))
        try:
            for name in os.listdir(preflight):
                if name.endswith('.json'):
                    files.read('private/preflight/' + name)
        finally:
            os.close(preflight)
        try:
            files.read('private/operations/core-revision.json')
        except FileNotFoundError:
            pass
        current = _current_bindings(files.project,
            bindings['fresh_input']['path'], bindings['fresh_input']['sha256'],
            bindings['inventory']['path'], bindings['inventory']['sha256'],
            bindings['cluster_record']['path'], bindings['cluster_record']['sha256'],
            bindings['controller_report']['path'], bindings['controller_report']['sha256'], source)
        if {p: sha for p, sha in current['code_inputs'].items() if not p.startswith('private/')} != files.public_seen:
            raise ValueError('execution code inputs changed during validation')
        # Check newly added private paths too, not just the review's old map.
        for path in current['code_inputs']:
            if path.startswith('private/'):
                files.read(path)
        previous_ref = document['series']['previous_accepted_run']
        if previous_ref is not None:
            files.binding(previous_ref['acceptance'])
            files.json('private/operations/fresh-rebuild/review-plans/'
                       + identifier(previous_ref['id']) + '.json')
        previous = _previous_accepted(files.project, document['series'])
        rebuilt = build_plan(document, inventory=inventory, cluster=cluster,
            host_intents=hosts, controller_report=report, bindings=current,
            plan_id=plan_id, now=original_time, previous_accepted=previous)
        if plan_digest(rebuilt) != expected_sha256 or rebuilt['decision'] != 'reviewable':
            raise ValueError('execution review no longer matches current inputs')
        # Freshness is independently checked at current time, never creation time.
        build_plan(document, inventory=inventory, cluster=cluster, host_intents=hosts,
            controller_report=report, bindings=current, plan_id=plan_id,
            now=now, previous_accepted=previous)
        files.recheck()
        if source_state is None and _git_source(files.project) != source:
            raise ValueError('execution source changed')
        return plan, source
    except (KeyError, TypeError, IndexError, AttributeError, RecursionError):
        raise ValueError('malformed execution review inputs') from None


def _inputs(files, input_file, plan, review_sha, run_id, now):
    document, relative, sha = files.json(input_file)
    exact(document, {'schema_version', 'binding'} | KINDS)
    evidence = {kind: files.binding(document[kind]) for kind in KINDS}
    binding = context(plan, review_sha, run_id)
    baseline = evidence['host_baseline']
    if type(baseline) is dict and type(baseline.get('schema_version')) is int and baseline['schema_version'] == 2:
        exact(baseline, {'schema_version', 'kind', 'binding', 'observed_at', 'hosts', 'observation'})
        from fresh_observation_ops import load_observation
        derived = load_observation(files, baseline['observation'], plan, binding, now)
        declared = {key: value for key, value in baseline.items() if key != 'observation'}
        declared['schema_version'] = 1
        if plan_digest(declared) != plan_digest(derived):
            raise ValueError('host baseline differs from observation')
        evidence['host_baseline'] = derived
    validate_evidence(document, evidence, plan, binding, now)
    for material in evidence['external_materials']['materials'].values():
        raw, relative_material, actual = files.read(material['path'])
        if (actual != material['sha256'] or len(raw) != material['size']
                or relative_material != material['path']):
            raise ValueError('execution material bytes differ from evidence')
    return document, {'path': relative, 'sha256': sha}, binding


def _record(files, plan, review_sha, run_id, input_file, now, source):
    document, input_binding, binding = _inputs(files, input_file, plan, review_sha, run_id, now)
    return {'schema_version': 1, 'operation': 'fresh-execution-preparation',
            'created_at': now.isoformat(), 'binding': binding,
            'input': input_binding, 'evidence': {kind: document[kind] for kind in KINDS},
            'source': source, 'private_identity': files.identity,
            'cluster_sha256': plan['bindings']['cluster_record']['sha256'],
            'executable': False, 'execution_implemented': False,
            'remote_mutation_performed': False, 'generation_changed': False,
            'evidence_authority': 'operator-attestation-not-live-verification'}


def prepare_execution(project, plan_id, expected_sha256, input_file, run_id, *,
                      now=None, source_state=None):
    """Validate and save one preparation; never reserve or perform remote actions."""
    identifier(run_id)
    current = now or datetime.now(timezone.utc)
    with ClusterLock(project) as lock:
        files = PrivateFiles(project)
        try:
            plan, source = _review(files, plan_id, expected_sha256, current, source_state)
            record = _record(files, plan, expected_sha256, run_id, str(input_file), current, source)
            envelope = {'execution': record, 'sha256': plan_digest(record)}
            files.recheck()
            lock.check_private_root()
            files.publish(run_id, envelope)
            return envelope, Path(AREA) / run_id / 'execution.json'
        finally:
            files.close()


def inspect_execution(project, run_id, expected_sha256, *, now=None, source_state=None):
    """Observe local preparation and barrier linkage without any write or replay."""
    identifier(run_id)
    sha256(expected_sha256)
    base = {'status': 'blocked', 'id': run_id, 'sha256': expected_sha256,
            'executable': False, 'remote_mutation_performed': False, 'generation_changed': False}
    files = None
    try:
        pending_before = pending_generation.inspect(project)
        files = PrivateFiles(project)
        try:
            run = files.directory(files.parts(AREA) + (run_id,))
        except FileNotFoundError:
            files.check()
            pending_after = pending_generation.inspect(project)
            if pending_before == pending_after and pending_after['status'] == 'absent':
                return {**base, 'status': 'absent'}
            return base
        try:
            if os.listdir(run) != ['execution.json']:
                return base
        finally:
            os.close(run)
        envelope, _, _ = files.json(AREA + '/' + run_id + '/execution.json')
        exact(envelope, {'execution', 'sha256'})
        record = envelope['execution']
        if envelope['sha256'] != expected_sha256 or plan_digest(record) != expected_sha256:
            return base
        current = now or datetime.now(timezone.utc)
        binding = record['binding']
        plan, source = _review(files, binding['plan_id'], binding['review_sha256'], current, source_state)
        rebuilt = _record(files, plan, binding['review_sha256'], run_id,
                          record['input']['path'], current, source)
        created = timestamp(record['created_at'])
        if created > current:
            return base
        rebuilt['created_at'] = record['created_at']
        if plan_digest(rebuilt) != expected_sha256:
            return base
        files.recheck()
        after = pending_generation.inspect(project)
        files.check()
        if after != pending_before:
            return base
        final_run = files.directory(files.parts(AREA) + (run_id,))
        try:
            if os.listdir(final_run) != ['execution.json']:
                return base
        finally:
            os.close(final_run)
        result = public_summary(envelope)
        if after['status'] == 'absent':
            return result
        if after['status'] != 'pending':
            return base
        expected = {key: binding[key] for key in (
            'cluster_id', 'run_id', 'generation_before', 'target_generation',
            'review_sha256', 'scope_sha256')}
        expected.update(execution_sha256=expected_sha256,
                        cluster_sha256=record['cluster_sha256'],
                        fence_sha256=record['evidence']['writer_fence']['sha256'])
        reservation = after['reservation']
        if (plan_digest(reservation['bindings']) != plan_digest(expected)
                or reservation['private_identity'] != files.identity):
            return base
        return {**result, 'status': 'reserved'}
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, IndexError,
            AttributeError, RecursionError, subprocess.SubprocessError):
        return base
    finally:
        if files is not None:
            files.close()
