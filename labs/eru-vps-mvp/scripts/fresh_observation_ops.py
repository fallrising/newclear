"""Immutable private baseline collection; no remote mutation or automatic reserve."""
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import os

from fresh_execution import context, exact, identifier
from fresh_rebuild import plan_digest
from labops import ClusterLock
from fresh_observation import (ALIASES, HOST_LIMIT, capture, decode, public_key, script, trust_keys,
                               validate_observation)

AREA = 'private/operations/fresh-rebuild/observations'


def _raw(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


class SSHReader:
    """No user SSH config, arbitrary command, trust update, forwarding or retry."""
    def __call__(self, host, source, key):
        if host['alias'] not in ALIASES or str(ipaddress.IPv4Address(host['ip'])) != host['ip']:
            raise ValueError('invalid observation SSH endpoint')
        public_key(key)
        fd = os.memfd_create('eru-observation-known-hosts', os.MFD_CLOEXEC)
        try:
            os.write(fd, (host['alias'] + ' ' + key + '\n').encode())
            os.lseek(fd, 0, os.SEEK_SET)
            argv = ['ssh', '-F', '/dev/null', '-T', '-o', 'BatchMode=yes',
                    '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no',
                    '-o', 'HostKeyAlgorithms=ssh-ed25519', '-o', 'HostKeyAlias=' + host['alias'],
                    '-o', 'UserKnownHostsFile=/proc/self/fd/' + str(fd),
                    '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=10',
                    '-o', 'ConnectionAttempts=1', '-o', 'PermitLocalCommand=no',
                    '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none',
                    '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
                    '-o', 'ControlPersist=no', '-o', 'ClearAllForwardings=yes',
                    '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
                    '-o', 'RemoteCommand=none', '-o', 'RequestTTY=no',
                    '-p', '22', '-l', 'ckc', '--', host['ip'], 'sudo -n python3 -']
            return capture(argv, HOST_LIMIT, 90, input_bytes=source.encode(), pass_fds=(fd,))
        finally:
            os.close(fd)


def _publish(files, directory, name, value):
    raw = _raw(value)
    if len(raw) > files.max_bytes:
        raise ValueError('observation record too large')
    temporary = '.' + name + '.tmp'
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW,
                 0o600, dir_fd=directory)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    files.recheck()
    os.link(temporary, name, src_dir_fd=directory, dst_dir_fd=directory,
            follow_symlinks=False)
    os.unlink(temporary, dir_fd=directory)
    os.fsync(directory)
    return hashlib.sha256(raw).hexdigest()


def _directory_check(files, observation_id, fd):
    current = files.directory(files.parts(AREA) + (observation_id,))
    try:
        if (os.fstat(fd).st_dev, os.fstat(fd).st_ino) != (os.fstat(current).st_dev, os.fstat(current).st_ino):
            raise ValueError('observation publication directory changed')
    finally:
        os.close(current)


def collect_observation(project, plan_id, review_sha, run_id, observation_id, *,
                        reader=None, now=None, source_state=None):
    from fresh_execution_ops import PrivateFiles, _review
    identifier(observation_id)
    identifier(run_id)
    current = now or datetime.now(timezone.utc)
    with ClusterLock(project) as lock:
        files = PrivateFiles(project)
        directory = None
        try:
            plan, source = _review(files, plan_id, review_sha, current, source_state)
            binding = context(plan, review_sha, run_id)
            manifest, _, _ = files.read('private/verified-host-public-keys.json')
            trusted = trust_keys(manifest)
            inventory = files.binding(plan['bindings']['inventory'])
            parent = files.directory(files.parts(AREA), create=True)
            try:
                os.mkdir(observation_id, 0o700, dir_fd=parent)
                os.fsync(parent)
                directory = files.directory(files.parts(AREA) + (observation_id,))
            finally:
                os.close(parent)
            captures = []
            transport = reader if reader is not None else SSHReader()
            for index, host in enumerate(inventory):
                files.recheck()
                lock.check_private_root()
                _directory_check(files, observation_id, directory)
                source_script = script(inventory[0]['ip'], index == 0)
                raw = transport(host, source_script, trusted[host['alias']])
                if type(raw) is not bytes or len(raw) > HOST_LIMIT:
                    raise ValueError('observation transport result invalid or oversized')
                outputs = decode(raw)
                captures.append({'alias': host['alias'], 'ip': host['ip'],
                    'script_sha256': hashlib.sha256(source_script.encode()).hexdigest(),
                    'outputs': outputs})
            completed = now or datetime.now(timezone.utc)
            # Rebuild against current time, not only against collection start time.
            _review(files, plan_id, review_sha, completed, source_state)
            record = {'schema_version': 1, 'operation': 'fresh-baseline-observation',
                      'binding': binding, 'observed_at': current.isoformat(),
                      'completed_at': completed.isoformat(), 'source': source,
                      'private_identity': files.identity, 'trust_manifest': manifest.decode(),
                      'captures': captures, 'remote_mutation_performed': False}
            envelope = {'observation': record, 'sha256': plan_digest(record)}
            baseline = validate_observation(envelope, plan, binding, completed)
            prefix = AREA + '/' + observation_id + '/'
            obs_sha = _publish(files, directory, 'observation.json', envelope)
            ref = {'path': prefix + 'observation.json', 'sha256': obs_sha}
            baseline = {**baseline, 'schema_version': 2, 'observation': ref}
            baseline_sha = _publish(files, directory, 'host-baseline.json', baseline)
            files.recheck()
            lock.check_private_root()
            _directory_check(files, observation_id, directory)
            if sorted(os.listdir(directory)) != ['host-baseline.json', 'observation.json']:
                raise ValueError('observation publication has unexpected files')
            summary = {'status': 'observed', 'id': observation_id,
                       'sha256': envelope['sha256'], 'host_count': 4,
                       'executable': False, 'remote_mutation_performed': False,
                       'generation_changed': False}
            return summary, {'observation': ref,
                'host_baseline': {'path': prefix + 'host-baseline.json', 'sha256': baseline_sha}}
        except BaseException:
            if directory is not None:
                try:
                    marker = os.open('.collection-failed', os.O_CREAT | os.O_EXCL | os.O_WRONLY
                                     | os.O_NOFOLLOW, 0o600, dir_fd=directory)
                    os.close(marker)
                    os.fsync(directory)
                except OSError:
                    pass
            raise
        finally:
            if directory is not None:
                os.close(directory)
            files.close()


def _load_observation(files, ref, plan, binding, now):
    """Rederive schema-v1 baseline only from a complete bound observation directory."""
    exact(ref, {'path', 'sha256'})
    parts = files.parts(ref['path'])
    expected = files.parts(AREA)
    if len(parts) != len(expected) + 2 or parts[:-2] != expected or parts[-1] != 'observation.json':
        raise ValueError('observation reference is outside immutable area')
    identifier(parts[-2])
    directory = files.directory(parts[:-1])
    try:
        if sorted(os.listdir(directory)) != ['host-baseline.json', 'observation.json']:
            raise ValueError('observation collection is incomplete')
        envelope = files.binding(ref)
        record = envelope['observation']
        if record['private_identity'] != files.identity or record['source'] != plan['bindings']['current_source']:
            raise ValueError('observation source or private root changed')
        manifest, _, _ = files.read('private/verified-host-public-keys.json')
        if manifest.decode() != record['trust_manifest']:
            raise ValueError('observation trusted manifest changed')
        inventory = files.binding(plan['bindings']['inventory'])
        if [(c['alias'], c['ip']) for c in record['captures']] != [(h['alias'], h['ip']) for h in inventory]:
            raise ValueError('observation transport endpoints differ from review')
        derived = validate_observation(envelope, plan, binding, now)
        sibling_path = ref['path'].rsplit('/', 1)[0] + '/host-baseline.json'
        sibling, _, _ = files.json(sibling_path)
        if plan_digest(sibling) != plan_digest({**derived, 'schema_version': 2, 'observation': ref}):
            raise ValueError('observation derived baseline differs')
        files.recheck()
        _directory_check(files, parts[-2], directory)
        if sorted(os.listdir(directory)) != ['host-baseline.json', 'observation.json']:
            raise ValueError('observation collection changed')
        return derived
    finally:
        os.close(directory)


def load_observation(files, ref, plan, binding, now):
    try:
        return _load_observation(files, ref, plan, binding, now)
    except (KeyError, TypeError, AttributeError, IndexError, OverflowError, RecursionError):
        raise ValueError('malformed observation reference') from None
