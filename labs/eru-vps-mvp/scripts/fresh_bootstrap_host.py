"""Fixed fresh bootstrap helper; create-only installation and observation-only recovery."""
import base64
import copy
from datetime import datetime, timezone
import io
import gzip
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import tarfile
import urllib.request

import fresh_bootstrap_render as render
import fresh_network_staging_host as support
from fresh_network_firewall_host import _run_process

ERROR = 'fresh bootstrap unavailable'
LIMIT = 4 * 1024 * 1024
WIRE_LIMIT = 128 * 1024 * 1024
PROGRAM_LIMIT = 192 * 1024 * 1024
ARCHIVE_LIMIT = 128 * 1024 * 1024
ARCHIVE_MEMBERS = 4096
ARCHIVE_SCAN_LIMIT = 1024 * 1024 * 1024
ARCHIVE_METADATA_LIMIT = 1024 * 1024
STEPS = ('etcd-install', 'etcd-start', 'empty-accept', 'core-install', 'core-start', 'pod-create') + tuple(
    s for _ in range(3) for s in ('worker-install', 'worker-proxy-start', 'worker-register', 'worker-agent-start', 'worker-up')) + ('cluster-accept',)
READONLY = ('empty-accept', 'cluster-accept')
INSTALLS = {'etcd-install': 'etcd_install', 'core-install': 'core_install', 'worker-install': 'agent_install'}
UNITS = {'etcd-start': 'etcd.service', 'core-start': 'eru-core.service',
         'worker-proxy-start': 'eru-containerd-proxy.socket', 'worker-agent-start': 'eru-agent.service'}
SERVICE = ('/usr/bin/systemctl', 'show', '--property=LoadState,ActiveState,SubState,MainPID,InvocationID')
ETCD = ('/usr/local/bin/etcdctl', '--endpoints=http://127.0.0.1:2379', '--write-out=json')
ETCD_COMMANDS = (ETCD + ('endpoint', 'health'), ETCD + ('endpoint', 'status'),
                 ETCD + ('member', 'list'), ETCD + ('get', '', '--from-key'))


def _time(now):
    value = now() if callable(now) else now
    value = value or datetime.now(timezone.utc)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(ERROR)
    return value.astimezone(timezone.utc).isoformat()


def _decode(raw, limit=WIRE_LIMIT):
    if type(raw) is not bytes or len(raw) > limit:
        raise ValueError(ERROR)
    def unique(pairs):
        result = {}
        for k, v in pairs:
            if k in result:
                raise ValueError(ERROR)
            result[k] = v
        return result
    def invalid(_):
        raise ValueError(ERROR)
    return json.loads(raw.decode(), object_pairs_hook=unique, parse_constant=invalid)


def validate_action(action):
    render._exact(action, {'schema_version', 'operation', 'plan_id', 'plan_sha256', 'run_id',
        'execution_sha256', 'pending_sha256', 'bootstrap_sha256', 'step_index', 'step',
        'host_index', 'host', 'worker_index', 'render'})
    if type(action['schema_version']) is not int or action['schema_version'] != 1 or action['operation'] != 'fresh-bootstrap-action':
        raise ValueError(ERROR)
    for field in ('plan_id', 'run_id'):
        support._match(action[field], '[A-Za-z0-9][A-Za-z0-9_-]{0,63}')
    for field in ('plan_sha256', 'execution_sha256', 'pending_sha256', 'bootstrap_sha256'):
        render._hash(action[field])
    index = action['step_index']
    if type(index) is not int or not 0 <= index < len(STEPS) or action['step'] != STEPS[index]:
        raise ValueError(ERROR)
    worker = None if index < 6 or index == len(STEPS) - 1 else 1 + (index - 6) // 5
    if type(action['worker_index']) is not type(worker) or action['worker_index'] != worker:
        raise ValueError(ERROR)
    host_index = worker if action['step'] in ('worker-install', 'worker-proxy-start', 'worker-agent-start') else 0
    if type(action['host_index']) is not int or action['host_index'] != host_index:
        raise ValueError(ERROR)
    rendered = render.validate_render(action['render'])
    if rendered['run_id'] != action['run_id'] or any(action['host'].get(k) != rendered['hosts'][host_index][k] for k in render.HOST_FIELDS):
        raise ValueError(ERROR)
    render._exact(action['host'], set(render.HOST_FIELDS) | {'files'})
    if len(render.canonical(action)) > WIRE_LIMIT:
        raise ValueError(ERROR)
    return copy.deepcopy(action)


def validate_request(request):
    fields = {'schema_version', 'operation', 'action'}
    if type(request) is dict and request.get('operation') == 'dispatch':
        fields.add('intent_sha256')
    render._exact(request, fields)
    if type(request['schema_version']) is not int or request['schema_version'] != 1 or request['operation'] not in ('observe', 'dispatch'):
        raise ValueError(ERROR)
    validate_action(request['action'])
    if request['operation'] == 'dispatch':
        render._hash(request['intent_sha256'])
        if request['action']['step'] in READONLY:
            raise ValueError(ERROR)
    return copy.deepcopy(request)


def _slot(action):
    return 'etc/eru/.fresh-bootstrap/' + action['run_id'] + '/%02d-%s' % (action['step_index'], action['step'])


def _payload(action):
    return action['render']['hosts'][action['host_index']][INSTALLS[action['step']]]


def _cli(action, *parts):
    return ('/usr/local/bin/eru-cli', '--eru', action['render']['hosts'][0]['ip'] + ':5001', '--output', 'json') + parts


def _register(action):
    w = action['render']['workers'][action['worker_index'] - 1]
    argv = _cli(action, 'node', 'add', 'eru', '--nodename', w['node'], '--endpoint', w['endpoint'],
                '--extra-resources', render.canonical(w['resource_capacity']).decode())
    for k, v in sorted(w['labels'].items()):
        argv += ('--label', k + '=' + v)
    return argv


def _allowed(action):
    allowed = {SERVICE + (unit,) for unit in ('etcd.service', 'eru-core.service', 'eru-agent.service',
        'eru-containerd-proxy.socket', 'containerd.service', 'docker.service')}
    allowed.add(('/usr/bin/ps', '-eo', 'comm='))
    allowed.add(('/usr/bin/containerd', '--version'))
    allowed.update(ETCD_COMMANDS)
    allowed.update((_cli(action, 'pod', 'nodes', 'eru'), _cli(action, 'pod', 'list')))
    step = action['step']
    if step in UNITS:
        allowed.add(('/usr/bin/systemctl', 'start', UNITS[step]))
    if step in INSTALLS:
        allowed.add(('/usr/bin/systemctl', 'daemon-reload'))
        allowed.add(('/usr/bin/systemd-analyze', 'verify') + tuple(f['path'] for f in _payload(action)['files'] if f['path'].endswith(('.service', '.socket'))))
    if step == 'pod-create':
        allowed.add(_cli(action, 'pod', 'add', 'eru'))
    elif step == 'worker-register':
        allowed.add(_register(action))
    elif step == 'worker-up':
        allowed.add(_cli(action, 'node', 'up', action['render']['workers'][action['worker_index'] - 1]['node']))
    return allowed


def _runner(argv, input_bytes=None):
    if input_bytes is not None:
        raise ValueError(ERROR)
    return _run_process(argv, timeout=90, output_limit=LIMIT)


def _artifact_reader(artifact):
    request = urllib.request.Request(artifact['url'], headers={'User-Agent': 'eru-fresh-bootstrap'})
    with urllib.request.urlopen(request, timeout=30) as source:
        raw = source.read(ARCHIVE_LIMIT + 1)
    if len(raw) > ARCHIVE_LIMIT:
        raise ValueError(ERROR)
    return raw


class _Session(support._Session):
    def __init__(self, root, uid, gid, action):
        super().__init__(root, uid, gid, action)
        self.mode = {}

    def ensure(self, path, create=False, private=False):
        current = ''
        for name in path.split('/'):
            parent, current = current, (current + '/' if current else '') + name
            if current in self.dirs:
                continue
            if create:
                try:
                    os.mkdir(name, 0o700 if private or current.startswith('etc/eru/.fresh-bootstrap') else 0o755,
                             dir_fd=self.dirs[parent])
                    os.fsync(self.dirs[parent])
                except FileExistsError:
                    pass
            self.directory(current)
            if current.startswith('etc/eru/.fresh-bootstrap'):
                self._directory(self.dirs[current], True)
        return self.dirs[current]

    def exists(self, path):
        parent, _, name = path.rpartition('/')
        try:
            self.ensure(parent)
            os.stat(name, dir_fd=self.dirs[parent], follow_symlinks=False)
            return True
        except FileNotFoundError:
            return False

    def data(self, path, expected_mode=None):
        parent, _, name = path.rpartition('/')
        self.ensure(parent)
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.dirs[parent])
        try:
            before = os.fstat(fd)
            if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                    or (before.st_uid, before.st_gid) != (self.uid, self.gid)
                    or before.st_mode & 0o022 or (expected_mode is not None and stat.S_IMODE(before.st_mode) != expected_mode)):
                raise ValueError(ERROR)
            chunks, size = [], 0
            while True:
                block = os.read(fd, 65536)
                if not block:
                    break
                size += len(block)
                if size > (WIRE_LIMIT if path.endswith('/intent.json') else render.BINARY_LIMIT):
                    raise ValueError(ERROR)
                chunks.append(block)
            linked = os.stat(name, dir_fd=self.dirs[parent], follow_symlinks=False)
            if support._identity(before) != support._identity(os.fstat(fd)) or support._identity(before) != support._identity(linked):
                raise ValueError(ERROR)
            raw = b''.join(chunks)
            binding = (support._identity(before), render.digest(raw), expected_mode)
            previous = self.mode.get(path)
            if previous is not None and previous != binding:
                raise ValueError(ERROR)
            self.mode[path] = binding
            return raw
        finally:
            os.close(fd)

    def check(self):
        super().check()
        for path, (_, _, mode) in list(getattr(self, 'mode', {}).items()):
            self.data(path, mode)

    def publish_file(self, path, raw, mode):
        parent, _, name = path.rpartition('/')
        self.ensure(parent, create=True)
        self.check()
        directory = self.dirs[parent]
        temporary = '.bootstrap-' + secrets.token_hex(16)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=directory)
        try:
            view = memoryview(raw)
            while view:
                count = os.write(fd, view)
                if count <= 0:
                    raise ValueError(ERROR)
                view = view[count:]
            os.fchmod(fd, mode)
            os.fsync(fd)
            self.check()
            os.link(temporary, name, src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
        finally:
            os.close(fd)
            os.unlink(temporary, dir_fd=directory)
            os.fsync(directory)


def _invoke(action, runner, evidence, argv):
    if tuple(argv) not in _allowed(action):
        raise ValueError(ERROR)
    raw = runner(tuple(argv))
    if type(raw) is not bytes or len(raw) > LIMIT:
        raise ValueError(ERROR)
    evidence['commands'].append({'argv': list(argv), 'stdout_base64': base64.b64encode(raw).decode()})
    return raw


def _service(session, action, runner, evidence, unit):
    raw = _invoke(action, runner, evidence, SERVICE + (unit,))
    fields = dict(line.split('=', 1) for line in raw.decode().strip().splitlines())
    if set(fields) != {'LoadState', 'ActiveState', 'SubState', 'MainPID', 'InvocationID'}:
        raise ValueError(ERROR)
    pid = int(fields['MainPID'])
    digest = None
    if fields['ActiveState'] == 'active' and unit.endswith('.service'):
        if fields['LoadState'] != 'loaded' or fields['SubState'] != 'running' or pid <= 0 or not re.fullmatch('[0-9a-f]{32}', fields['InvocationID']):
            raise ValueError(ERROR)
        # /proc/PID/exe is the one intentionally followed kernel link; bounded IO.
        procfd = session.ensure('proc/' + str(pid))
        exefd = os.open('exe', os.O_RDONLY, dir_fd=procfd)
        try:
            with os.fdopen(exefd, 'rb') as source:
                binary = source.read(render.BINARY_LIMIT + 1)
        except BaseException:
            raise
        if not binary or len(binary) > render.BINARY_LIMIT:
            raise ValueError(ERROR)
        digest = render.digest(binary)
        after = _invoke(action, runner, evidence, SERVICE + (unit,))
        if after != raw:
            raise ValueError(ERROR)
    row = {'unit': unit, 'active_state': fields['ActiveState'], 'sub_state': fields['SubState'],
           'main_pid': pid, 'invocation_id': fields['InvocationID'], 'runtime_sha256': digest}
    existing = next((r for r in evidence['services'] if r['unit'] == unit), None)
    if existing is not None and existing != row:
        raise ValueError(ERROR)
    if existing is None:
        evidence['services'].append(row)
    return row


def _stopped(session, action, runner, evidence, units=('etcd.service', 'eru-core.service', 'eru-agent.service')):
    for unit in units:
        row = _service(session, action, runner, evidence, unit)
        if row['active_state'] != 'inactive' or row['sub_state'] != 'dead' or row['main_pid'] != 0:
            raise ValueError(ERROR)
    tasks = _invoke(action, runner, evidence, ('/usr/bin/ps', '-eo', 'comm=')).decode().split()
    denied = {'resource-storage'} | {u.removesuffix('.service') for u in units}
    if set(tasks) & denied:
        raise ValueError(ERROR)


def _runtime(session, action, runner, evidence):
    for unit in ('containerd.service', 'docker.service'):
        if _service(session, action, runner, evidence, unit)['active_state'] != 'active':
            raise ValueError(ERROR)
    if 'v2.3.5 ' not in _invoke(action, runner, evidence, ('/usr/bin/containerd', '--version')).decode():
        raise ValueError(ERROR)


def _install_manifest(session, action, step=None):
    install = step or action['step']
    idx = {'etcd-install': 0, 'core-install': 3}.get(install, 6 + 5 * (action['worker_index'] - 1) if action['worker_index'] else -1)
    a = {**action, 'step': install, 'step_index': idx}
    path = _slot(a)
    complete = _decode(session.data(path + '/complete.json', 0o600), LIMIT)
    intent = _decode(session.data(path + '/intent.json', 0o600), WIRE_LIMIT)
    if (intent['action']['render'] != action['render'] or complete['action_sha256'] != render.digest(render.canonical(intent['action']))
            or complete['intent_sha256'] != intent['intent_sha256']):
        raise ValueError(ERROR)
    if install == 'etcd-install':
        _data_root(session, action, complete['data_root'])
    elif complete['data_root'] is not None:
        raise ValueError(ERROR)
    return complete['files']


def _data_root(session, action, expected=None):
    path = action['render']['data_root'][1:]
    fd = session.ensure(path)
    info = session._directory(fd, private=True)
    actual = {'path': '/' + path, 'device': info.st_dev, 'inode': info.st_ino,
              'uid': info.st_uid, 'gid': info.st_gid, 'mode': '0700'}
    if expected is not None and actual != expected:
        raise ValueError(ERROR)
    return actual


def _file_evidence(session, manifest, evidence):
    for row in manifest:
        render._exact(row, {'path', 'sha256', 'mode'})
        raw = session.data(row['path'].lstrip('/'), int(row['mode'], 8))
        if render.digest(raw) != row['sha256']:
            raise ValueError(ERROR)
        evidence['files'].append(copy.deepcopy(row))


def _binary_expected(session, action, unit):
    step = {'etcd.service': 'etcd-install', 'eru-core.service': 'core-install',
            'eru-agent.service': 'worker-install'}[unit]
    path = {'etcd.service': '/usr/local/bin/etcd', 'eru-core.service': '/usr/local/bin/eru-core',
            'eru-agent.service': '/usr/local/bin/eru-agent'}[unit]
    manifest = _install_manifest(session, action, step)
    return next(r['sha256'] for r in manifest if r['path'] == path)


def _active(session, action, runner, evidence, unit):
    row = _service(session, action, runner, evidence, unit)
    if row['active_state'] != 'active':
        raise ValueError(ERROR)
    if unit in ('etcd.service', 'eru-core.service', 'eru-agent.service') and row['runtime_sha256'] != _binary_expected(session, action, unit):
        raise ValueError(ERROR)
    started = {'etcd.service': ('etcd-start', 1), 'eru-core.service': ('core-start', 4),
               'eru-agent.service': ('worker-agent-start', 9 + 5 * ((action['worker_index'] or 1) - 1))}.get(unit)
    if started is not None and action['step'] != started[0]:
        prior = {**action, 'step': started[0], 'step_index': started[1]}
        complete = _decode(session.data(_slot(prior) + '/complete.json', 0o600), LIMIT)
        if complete['service'] != row:
            raise ValueError(ERROR)
    return row


def _collect(session, action, runner, before=False):
    evidence = {'files': [], 'commands': [], 'services': []}
    step = action['step']
    if step in INSTALLS:
        if before:
            if step == 'etcd-install':
                _stopped(session, action, runner, evidence)
                parent = action['render']['data_root'][1:].rpartition('/')[0]
                if session.exists(parent) and os.listdir(session.ensure(parent)):
                    raise ValueError(ERROR)
                if any(session.exists(p) for p in (action['render']['data_root'][1:], 'var/lib/etcd-eru-mvp', 'var/lib/etcd')):
                    raise ValueError(ERROR)
            elif step == 'worker-install':
                if any(session.exists(p) for p in ('var/lib/eru-agent', 'run/eru/workloads', 'etc/eru/core.yaml', 'var/lib/etcd-eru-mvp')):
                    raise ValueError(ERROR)
                _runtime(session, action, runner, evidence)
                _stopped(session, action, runner, evidence, ('eru-agent.service',))
            else:
                if session.exists('var/lib/eru/process'):
                    raise ValueError(ERROR)
                _stopped(session, action, runner, evidence, ('eru-core.service',))
                _etcd_collect(session, action, runner, evidence, empty=True)
                if not session.data(action['render']['core_key_path'][1:], 0o600):
                    raise ValueError(ERROR)
            p = _payload(action)
            for path in [f['path'] for f in p['files'] + p['binaries']] + [path for a in p['artifacts'] for path in a['files'].values()]:
                if session.exists(path[1:]):
                    raise ValueError(ERROR)
        else:
            _file_evidence(session, _install_manifest(session, action), evidence)
            if step == 'worker-install':
                _runtime(session, action, runner, evidence)
    elif step in UNITS:
        install = 'etcd-install' if step == 'etcd-start' else 'core-install' if step == 'core-start' else 'worker-install'
        _file_evidence(session, _install_manifest(session, action, install), evidence)
        if step.startswith('worker-'):
            _runtime(session, action, runner, evidence)
        if before:
            _stopped(session, action, runner, evidence, ('eru-core.service', 'eru-agent.service') if step == 'etcd-start' else (UNITS[step],))
            if step == 'etcd-start':
                if not session.exists(action['render']['data_root'][1:]) or os.listdir(session.ensure(action['render']['data_root'][1:])):
                    raise ValueError(ERROR)
                _stopped(session, action, runner, evidence, ('etcd.service',))
        else:
            _active(session, action, runner, evidence, UNITS[step])
    else:
        if step in READONLY:
            _etcd_collect(session, action, runner, evidence, empty=step == 'empty-accept')
        if step != 'empty-accept':
            _active(session, action, runner, evidence, 'eru-core.service')
            pods_raw = _invoke(action, runner, evidence, _cli(action, 'pod', 'list'))
            if not (step == 'pod-create' and before and _decode(pods_raw, LIMIT) in (None, [])):
                _invoke(action, runner, evidence, _cli(action, 'pod', 'nodes', 'eru'))
    session.check()
    return evidence


def _etcd_collect(session, action, runner, evidence, empty):
    _file_evidence(session, _install_manifest(session, action, 'etcd-install'), evidence)
    _active(session, action, runner, evidence, 'etcd.service')
    if empty:
        _stopped(session, action, runner, evidence, ('eru-core.service', 'eru-agent.service'))
    for argv in ETCD_COMMANDS:
        _invoke(action, runner, evidence, argv)


def _outputs(evidence):
    out = {}
    for row in evidence['commands']:
        render._exact(row, {'argv', 'stdout_base64'})
        if type(row['argv']) is not list or not all(type(a) is str for a in row['argv']):
            raise ValueError(ERROR)
        raw = base64.b64decode(row['stdout_base64'], validate=True)
        if len(raw) > LIMIT or base64.b64encode(raw).decode() != row['stdout_base64']:
            raise ValueError(ERROR)
        key = tuple(row['argv'])
        if key in out and out[key] != raw:
            raise ValueError(ERROR)
        out[key] = raw
    return out


def validate_evidence(action, observation, *, before=False):
    """Independently derive facts from bounded raw command bytes and file manifests."""
    validate_action(action)
    render._exact(observation, {'schema_version', 'action_sha256', 'observed_at', 'host', 'state', 'provenance', 'evidence'})
    evidence = observation['evidence']
    render._exact(evidence, {'files', 'commands', 'services'})
    if any(type(evidence[k]) is not list for k in evidence):
        raise ValueError(ERROR)
    if observation['action_sha256'] != render.digest(render.canonical(action)) or observation['host'] != {k: action['host'][k] for k in ('machine_id', 'boot_id', 'host_key_sha256')}:
        raise ValueError(ERROR)
    if observation['state'] not in ('absent', 'complete', 'uncertain'):
        raise ValueError(ERROR)
    outputs = _outputs(evidence)
    if any(argv not in _allowed(action) for argv in outputs):
        raise ValueError(ERROR)
    facts = {'etcd': None, 'workers': [], 'core': None, 'agent': None, **copy.deepcopy(evidence)}
    services = {}
    for row in evidence['services']:
        render._exact(row, {'unit', 'active_state', 'sub_state', 'main_pid', 'invocation_id', 'runtime_sha256'})
        if row['unit'] in services or type(row['main_pid']) is not int or row['main_pid'] < 0:
            raise ValueError(ERROR)
        raw = outputs.get(SERVICE + (row['unit'],))
        if raw is None:
            raise ValueError(ERROR)
        f = dict(line.split('=', 1) for line in raw.decode().strip().splitlines())
        if (f.get('ActiveState') != row['active_state'] or f.get('SubState') != row['sub_state']
                or f.get('InvocationID') != row['invocation_id'] or int(f['MainPID']) != row['main_pid']):
            raise ValueError(ERROR)
        if row['runtime_sha256'] is not None:
            render._hash(row['runtime_sha256'])
        services[row['unit']] = row
    for row in evidence['files']:
        render._exact(row, {'path', 'sha256', 'mode'})
        render._hash(row['sha256'])
        if row['mode'] not in ('0600', '0644', '0755'):
            raise ValueError(ERROR)
    readonly = action['step'] in READONLY
    if readonly and (observation['state'] != 'complete' or observation['provenance'] is not None):
        raise ValueError(ERROR)
    if observation['state'] == 'uncertain':
        if before or any(evidence[k] for k in evidence) or observation['provenance'] is None:
            raise ValueError(ERROR)
        return facts
    if observation['state'] != ('complete' if readonly else 'absent' if before else 'complete'):
        raise ValueError(ERROR)
    step = action['step']
    install = step if step in INSTALLS else 'etcd-install' if step == 'etcd-start' else 'core-install' if step == 'core-start' else 'worker-install' if step in ('worker-proxy-start', 'worker-agent-start') else None
    if install is not None and not (step in INSTALLS and before):
        payload = action['render']['hosts'][action['host_index']][INSTALLS[install]]
        expected_paths = {f['path'] for f in payload['files'] + payload['binaries']} | {p for a in payload['artifacts'] for p in a['files'].values()}
        filemap = {f['path']: f for f in evidence['files']}
        if len(filemap) != len(evidence['files']) or set(filemap) != expected_paths:
            raise ValueError(ERROR)
        for f in payload['files'] + payload['binaries']:
            if any(filemap[f['path']][k] != f[k] for k in ('sha256', 'mode')):
                raise ValueError(ERROR)
    def require_stopped(units):
        if any(unit not in services or services[unit]['active_state'] != 'inactive'
               or services[unit]['sub_state'] != 'dead' or services[unit]['main_pid'] != 0 for unit in units):
            raise ValueError(ERROR)
        tasks = outputs.get(('/usr/bin/ps', '-eo', 'comm='))
        if tasks is None or set(tasks.decode().split()) & ({u.removesuffix('.service') for u in units} | {'resource-storage'}):
            raise ValueError(ERROR)
    if step == 'etcd-install' and before:
        require_stopped(('etcd.service', 'eru-core.service', 'eru-agent.service'))
    if step == 'empty-accept' or step == 'core-install' and before:
        require_stopped(('eru-core.service', 'eru-agent.service'))
    if step in UNITS and before:
        require_stopped((UNITS[step],))
    if step.startswith('worker-') and step in ('worker-install', 'worker-proxy-start', 'worker-agent-start'):
        if any(unit not in services or services[unit]['active_state'] != 'active'
               for unit in ('containerd.service', 'docker.service')) or b'v2.3.5 ' not in outputs.get(('/usr/bin/containerd', '--version'), b''):
            raise ValueError(ERROR)
    if step in UNITS and not before:
        unit = UNITS[step]; row = services.get(unit)
        if row is None or row['active_state'] != 'active':
            raise ValueError(ERROR)
        binary = {'etcd.service': '/usr/local/bin/etcd', 'eru-core.service': '/usr/local/bin/eru-core', 'eru-agent.service': '/usr/local/bin/eru-agent'}.get(unit)
        if binary is not None and row['runtime_sha256'] != next(f['sha256'] for f in evidence['files'] if f['path'] == binary):
            raise ValueError(ERROR)
    def jsonout(argv):
        if argv not in outputs:
            raise ValueError(ERROR)
        return _decode(outputs[argv], LIMIT)
    step = action['step']
    if step in ('empty-accept', 'cluster-accept') or (step == 'core-install' and before):
        health, status, members, keys = [jsonout(argv) for argv in ETCD_COMMANDS]
        if type(health) is not list or len(health) != 1 or health[0].get('health') is not True or health[0].get('endpoint') != 'http://127.0.0.1:2379':
            raise ValueError(ERROR)
        if type(status) is not list or len(status) != 1 or status[0].get('Endpoint') != 'http://127.0.0.1:2379':
            raise ValueError(ERROR)
        st = status[0]['Status']; header = st['header']
        cluster, member = header['cluster_id'], header['member_id']
        if any(type(v) is not int or not 0 < v < 2**64 for v in (cluster, member)):
            raise ValueError(ERROR)
        # Separate readonly queries may have different revisions. Their cluster
        # and member identities must agree, with JSON booleans rejected as IDs.
        for queried_header in (members.get('header'), keys.get('header')):
            if (type(queried_header) is not dict
                    or type(queried_header.get('cluster_id')) is not int
                    or type(queried_header.get('member_id')) is not int
                    or queried_header['cluster_id'] != cluster or queried_header['member_id'] != member):
                raise ValueError(ERROR)
        member_rows = members.get('members')
        if (type(member_rows) is not list or len(member_rows) != 1
                or type(member_rows[0].get('ID')) is not int or member_rows[0].get('ID') != member
                or member_rows[0].get('name') != 'eru-fresh-etcd0' or member_rows[0].get('isLearner', False) is not False
                or member_rows[0].get('peerURLs') != ['http://127.0.0.1:2380']
                or member_rows[0].get('clientURLs') != ['http://127.0.0.1:2379']
                or type(st.get('leader')) is not int or st.get('leader') != member
                or members['header']['cluster_id'] != cluster or keys['header']['cluster_id'] != cluster
                or keys['header']['member_id'] != member or keys.get('more', False) is not False):
            raise ValueError(ERROR)
        kvs = keys.get('kvs', [])
        if type(kvs) is not list or type(keys.get('count', 0)) is not int or keys.get('count', 0) != len(kvs):
            raise ValueError(ERROR)
        if step != 'cluster-accept' and kvs:
            raise ValueError(ERROR)
        wanted = action['render']['hosts'][0]['etcd_install']['files'][0]
        if {'path': wanted['path'], 'sha256': wanted['sha256'], 'mode': wanted['mode']} not in evidence['files']:
            raise ValueError(ERROR)
        facts['etcd'] = {'cluster_id': str(cluster), 'member_id': str(member), 'member_ids': [str(member)],
            'healthy': True, 'keys': copy.deepcopy(kvs), 'token_sha256': action['render']['target_token_sha256'],
            'data_root': action['render']['data_root']}
    nodes_argv, pods_argv = _cli(action, 'pod', 'nodes', 'eru'), _cli(action, 'pod', 'list')
    if nodes_argv in outputs or step == 'pod-create' and before:
        nodes, pods = ((jsonout(nodes_argv) or []) if nodes_argv in outputs else []), (jsonout(pods_argv) or [])
        if type(nodes) is not list or type(pods) is not list:
            raise ValueError(ERROR)
        if step == 'pod-create':
            if before and (nodes or pods) or not before and (nodes or len(pods) != 1 or pods[0].get('name') != 'eru'):
                raise ValueError(ERROR)
        elif step != 'core-start':
            if len(pods) != 1 or pods[0].get('name') != 'eru':
                raise ValueError(ERROR)
            wanted = {w['node']: w for w in action['render']['workers']}
            seen = set()
            for node in nodes:
                name = node.get('name', node.get('node'))
                if name not in wanted or name in seen:
                    raise ValueError(ERROR)
                seen.add(name); w = wanted[name]
                capacity = node.get('resource_capacity')
                if type(capacity) is str:
                    capacity = _decode(capacity.encode(), LIMIT)
                normalized = {'node': name, 'podname': node.get('podname'), 'endpoint': node.get('endpoint'),
                    'resource_capacity': capacity, 'labels': node.get('labels'),
                    'available': node.get('available', False), 'bypass': node.get('bypass', False)}
                if any(normalized[k] != w[k] for k in ('podname', 'endpoint', 'resource_capacity', 'labels')) or any(type(normalized[k]) is not bool for k in ('available', 'bypass')):
                    raise ValueError(ERROR)
                facts['workers'].append(normalized)
            if step == 'worker-register':
                target = action['render']['workers'][action['worker_index'] - 1]['node']
                if before and target in seen or not before and (target not in seen or next(n for n in facts['workers'] if n['node'] == target)['bypass'] is not True):
                    raise ValueError(ERROR)
            if step == 'worker-up':
                target = action['render']['workers'][action['worker_index'] - 1]['node']
                node = next((n for n in facts['workers'] if n['node'] == target), None)
                if node is None or node['available'] is not True or node['bypass'] is not before:
                    raise ValueError(ERROR)
            if step == 'cluster-accept' and (len(nodes) != 3 or any(not n['available'] or n['bypass'] for n in facts['workers'])):
                raise ValueError(ERROR)
    for unit, fact in (('eru-core.service', 'core'), ('eru-agent.service', 'agent')):
        row = services.get(unit)
        if row and row['active_state'] == 'active':
            if row['runtime_sha256'] is None:
                raise ValueError(ERROR)
            facts[fact] = {'runtime_sha256': row['runtime_sha256'], 'invocation_id': row['invocation_id']}
            if fact == 'core':
                if row['runtime_sha256'] != action['render']['safe_core_sha256']:
                    raise ValueError(ERROR)
                facts[fact]['readable'] = nodes_argv in outputs
    return facts


def _observation(action, evidence, state, provenance, now):
    return {'schema_version': 1, 'action_sha256': render.digest(render.canonical(action)),
        'observed_at': _time(now), 'host': {k: action['host'][k] for k in ('machine_id', 'boot_id', 'host_key_sha256')},
        'state': state, 'provenance': provenance, 'evidence': evidence}


def _observe(session, action, runner, now):
    slot = _slot(action)
    if action['step'] in READONLY:
        value = _observation(action, _collect(session, action, runner), 'complete', None, now)
        validate_evidence(action, value)
        return value
    if not session.exists(slot):
        value = _observation(action, _collect(session, action, runner, before=True), 'absent', None, now)
        validate_evidence(action, value, before=True)
        return value
    fd = session.ensure(slot)
    names = set(os.listdir(fd))
    if names not in ({'intent.json'}, {'intent.json', 'complete.json'}):
        raise ValueError(ERROR)
    intent = _decode(session.data(slot + '/intent.json', 0o600))
    render._exact(intent, {'schema_version', 'action', 'intent_sha256', 'started_at'})
    if render.canonical(intent['action']) != render.canonical(action):
        raise ValueError(ERROR)
    provenance = {'intent_sha256': intent['intent_sha256'], 'action_sha256': render.digest(render.canonical(action)),
                  'started_at': intent['started_at'], 'completed_at': None}
    if 'complete.json' not in names:
        return _observation(action, {'files': [], 'commands': [], 'services': []}, 'uncertain', provenance, now)
    complete = _decode(session.data(slot + '/complete.json', 0o600), LIMIT)
    render._exact(complete, {'schema_version', 'action_sha256', 'intent_sha256', 'started_at', 'completed_at', 'files', 'data_root', 'service'})
    if any(complete[k] != provenance[k] for k in ('intent_sha256', 'action_sha256', 'started_at')):
        raise ValueError(ERROR)
    provenance['completed_at'] = complete['completed_at']
    evidence = _collect(session, action, runner)
    if action['step'] in UNITS:
        current_service = next(r for r in evidence['services'] if r['unit'] == UNITS[action['step']])
        if complete['service'] != current_service:
            raise ValueError(ERROR)
    elif complete['service'] is not None:
        raise ValueError(ERROR)
    _file_evidence(session, complete['files'], {'files': [], 'commands': [], 'services': []})
    value = _observation(action, evidence, 'complete', provenance, now)
    validate_evidence(action, value)
    session.check()
    if set(os.listdir(fd)) != names:
        raise ValueError(ERROR)
    return value


class _ArchiveScan:
    """Forward-only gzip scan; bound decompression and extended-header allocation.

    TarFile reads extended headers while constructing its first member, so the
    read/seek boundary must exist before TarFile is opened, not after iteration.
    Seek skips through small bounded reads instead of materializing large gaps.
    """
    def __init__(self, source):
        self.source, self.position = source, 0

    def tell(self):
        return self.position

    def read(self, count):
        if type(count) is not int or not 0 <= count <= ARCHIVE_METADATA_LIMIT:
            raise ValueError(ERROR)
        if self.position + count > ARCHIVE_SCAN_LIMIT:
            raise ValueError(ERROR)
        raw = self.source.read(count)
        self.position += len(raw)
        return raw

    def seek(self, target, whence=0):
        if whence != 0 or type(target) is not int or not self.position <= target <= ARCHIVE_SCAN_LIMIT:
            raise ValueError(ERROR)
        while self.position < target:
            if not self.read(min(65536, target - self.position)):
                raise ValueError(ERROR)
        return self.position


def _archive_contents(raw, destinations):
    """Validate each header before advancing; never call getmembers/extractall."""
    selected = {}
    with gzip.GzipFile(fileobj=io.BytesIO(raw), mode='rb') as source:
        scan = _ArchiveScan(source)
        with tarfile.open(fileobj=scan, mode='r:') as archive:
            for index, member in enumerate(archive, 1):
                if index > ARCHIVE_MEMBERS:
                    raise ValueError(ERROR)
                name = member.name
                if (type(name) is not str or not 1 <= len(name) <= 4096
                        or any(ord(c) < 32 or ord(c) > 126 for c in name) or '\\' in name
                        or name.startswith('/') or '..' in name.split('/')
                        or not (member.isfile() or member.isdir())
                        or type(member.size) is not int or not 0 <= member.size <= render.BINARY_LIMIT
                        or member.isdir() and member.size != 0
                        or member.offset_data + ((member.size + 511) // 512) * 512 > ARCHIVE_SCAN_LIMIT):
                    raise ValueError(ERROR)
                binary = name.rstrip('/').rsplit('/', 1)[-1]
                if binary not in destinations:
                    continue
                if binary in selected or not member.isfile() or not member.size:
                    raise ValueError(ERROR)
                chunks, size = [], 0
                with archive.extractfile(member) as stream:
                    while True:
                        block = stream.read(65536)
                        if not block:
                            break
                        size += len(block)
                        if size > render.BINARY_LIMIT:
                            raise ValueError(ERROR)
                        chunks.append(block)
                if size != member.size:
                    raise ValueError(ERROR)
                selected[binary] = b''.join(chunks)
    if set(selected) != set(destinations):
        raise ValueError(ERROR)
    return [(destinations[name], selected[name], 0o755) for name in destinations]


def _install(session, action, artifact_reader, evidence):
    payload, manifest = _payload(action), []
    # Read/verify all artifact bytes before the first target write.
    contents = [(f['path'], f['content'].encode(), int(f['mode'], 8)) for f in payload['files']]
    contents += [(f['path'], render.decode_binary(action['render']['inputs']['safe_core']['binary_base64']), int(f['mode'], 8)) for f in payload['binaries']]
    for artifact in payload['artifacts']:
        raw = artifact_reader(copy.deepcopy(artifact))
        if type(raw) is not bytes or len(raw) > ARCHIVE_LIMIT or render.digest(raw) != artifact['sha256']:
            raise ValueError(ERROR)
        contents.extend(_archive_contents(raw, artifact['files']))
    if len({p for p, _, _ in contents}) != len(contents):
        raise ValueError(ERROR)
    for path, raw, mode in contents:
        if session.exists(path[1:]):
            raise ValueError(ERROR)
    for path, raw, mode in contents:
        session.publish_file(path[1:], raw, mode)
        manifest.append({'path': path, 'sha256': render.digest(raw), 'mode': '%04o' % mode})
    if action['step'] == 'etcd-install':
        data = action['render']['data_root'][1:]
        if session.exists(data):
            raise ValueError(ERROR)
        parent, _, name = data.rpartition('/')
        session.ensure(parent, create=True)
        os.mkdir(name, 0o700, dir_fd=session.dirs[parent])
        os.fsync(session.dirs[parent])
    _file_evidence(session, manifest, evidence)
    return manifest


def handle(request, *, root='/', owner_uid=0, owner_gid=0, now=None, runner=None, artifact_reader=None):
    """Local fixture seams cannot be selected through the wire protocol."""
    session = None
    try:
        request = validate_request(request)
        action = request['action']; runner = runner or _runner
        session = _Session(root, owner_uid, owner_gid, action)
        if request['operation'] == 'observe':
            return _observe(session, action, runner, now)
        before = _observe(session, action, runner, now)
        if before['state'] != 'absent':
            raise ValueError(ERROR)
        slot = _slot(action); parent, _, name = slot.rpartition('/')
        session.ensure(parent, create=True, private=True)
        os.mkdir(name, 0o700, dir_fd=session.dirs[parent]); os.fsync(session.dirs[parent])
        session.ensure(slot)
        started = _time(now)
        session.publish_file(slot + '/intent.json', render.canonical({'schema_version': 1,
            'action': action, 'intent_sha256': request['intent_sha256'], 'started_at': started}), 0o600)
        # Recheck exact identity/preconditions after intent fsync, before dispatch.
        current = _observation(action, _collect(session, action, runner, before=True), 'absent', None, now)
        validate_evidence(action, current, before=True)
        evidence = {'files': [], 'commands': [], 'services': []}; manifest = []
        step = action['step']
        if step in INSTALLS:
            manifest = _install(session, action, artifact_reader or _artifact_reader, evidence)
            _invoke(action, runner, evidence, ('/usr/bin/systemd-analyze', 'verify') + tuple(f['path'] for f in _payload(action)['files'] if f['path'].endswith(('.service', '.socket'))))
            _invoke(action, runner, evidence, ('/usr/bin/systemctl', 'daemon-reload'))
        elif step in UNITS:
            _invoke(action, runner, evidence, ('/usr/bin/systemctl', 'start', UNITS[step]))
        elif step == 'pod-create':
            _invoke(action, runner, evidence, _cli(action, 'pod', 'add', 'eru'))
        elif step == 'worker-register':
            _invoke(action, runner, evidence, _register(action))
        elif step == 'worker-up':
            _invoke(action, runner, evidence, _cli(action, 'node', 'up', action['render']['workers'][action['worker_index'] - 1]['node']))
        session.check()
        # Installation postconditions are checked without requiring unpublished completion.
        if step in INSTALLS:
            _file_evidence(session, manifest, {'files': [], 'commands': [], 'services': []})
        else:
            value = _observation(action, _collect(session, action, runner), 'complete', None, now)
            validate_evidence(action, value)
        completed = _time(now)
        session.publish_file(slot + '/complete.json', render.canonical({'schema_version': 1,
            'action_sha256': render.digest(render.canonical(action)), 'intent_sha256': request['intent_sha256'],
            'started_at': started, 'completed_at': completed, 'files': manifest,
            'data_root': _data_root(session, action) if step == 'etcd-install' else None,
            'service': next(r for r in value['evidence']['services'] if r['unit'] == UNITS[step]) if step in UNITS else None}), 0o600)
        return _observe(session, action, runner, now)
    except Exception:
        raise ValueError(ERROR) from None
    finally:
        if session is not None:
            session.close()


def main(encoded):
    try:
        if type(encoded) is not str or len(encoded) > 4 * ((WIRE_LIMIT + 2) // 3):
            raise ValueError(ERROR)
        raw = base64.b64decode(encoded, validate=True)
        if base64.b64encode(raw).decode() != encoded:
            raise ValueError(ERROR)
        result = handle(_decode(raw))
        output = render.canonical(result)
        if len(output) > LIMIT:
            raise ValueError(ERROR)
        sys.stdout.write(output.decode())
    except Exception:
        sys.stderr.write(ERROR + '\n')
        raise SystemExit(1) from None
