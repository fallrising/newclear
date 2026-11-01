"""Pure deterministic fresh payloads. All returned bytes are private wire data."""
import base64
import copy
import hashlib
import ipaddress
import json
import re

from worker_payload import build_worker_payload

SAFE_CORE_VALIDATION = 'patches/core-v0.1.5-safe-node-add.validation.json'
HOST_FIELDS = ('alias', 'node', 'ip', 'machine_id', 'boot_id', 'host_key_sha256')
TAGS = {'projecteru2/core': 'v0.1.5', 'projecteru2/cli': 'v0.1.5',
        'projecteru2/resource-extend': 'v0.1.5', 'etcd-io/etcd': 'v3.6.14',
        'projecteru2/agent': 'v0.1.3', 'containernetworking/plugins': 'v1.9.1'}
BINARY_LIMIT = 64 * 1024 * 1024


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def _hash(value):
    if type(value) is not str or not re.fullmatch('[0-9a-f]{64}', value):
        raise ValueError('invalid digest')
    return value


def _exact(value, fields):
    if type(value) is not dict or set(value) != set(fields):
        raise ValueError('invalid fields')


def decode_binary(value):
    if type(value) is not str or len(value) > 4 * ((BINARY_LIMIT + 2) // 3):
        raise ValueError('invalid binary')
    raw = base64.b64decode(value, validate=True)
    if not raw or len(raw) > BINARY_LIMIT or base64.b64encode(raw).decode() != value:
        raise ValueError('invalid binary')
    return raw


def _file(path, content, mode='0600'):
    return {'path': path, 'content': content, 'mode': mode,
            'sha256': digest(content.encode())}


def _payload(files, artifacts=(), binaries=()):
    return {'files': files, 'artifacts': list(artifacts), 'binaries': list(binaries)}


def build_render(access_render, artifact_lock, token_bytes, *, run_id,
                 target_token_sha256, prior_token_sha256, safe_core,
                 core_key_path='/root/.ssh/eru-fresh-core', capacities=None):
    """Requires loader-verified safe-core selection and explicit reviewed capacities."""
    if type(run_id) is not str or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_-]{0,63}', run_id):
        raise ValueError('invalid run')
    if (type(token_bytes) is not bytes or not re.fullmatch(rb'[A-Za-z0-9_-]{16,256}', token_bytes)
            or digest(token_bytes) != _hash(target_token_sha256)
            or _hash(prior_token_sha256) == target_token_sha256):
        raise ValueError('requires exact new raw token')
    if core_key_path != '/root/.ssh/eru-fresh-core':
        raise ValueError('unreviewed core key path')
    _exact(safe_core, {'selection', 'binary_base64'})
    selected = safe_core['selection']
    if (type(selected) is not dict or selected.get('validation_file') != SAFE_CORE_VALIDATION
            or selected.get('repository') != 'projecteru2/core'
            or selected.get('architecture') != 'linux/amd64'
            or selected.get('source_tag') != 'v0.1.5' or selected.get('target_version') != 'v0.1.5'
            or selected.get('patch_file') != 'core-v0.1.5-safe-node-add.patch'
            or digest(decode_binary(safe_core['binary_base64'])) != _hash(selected.get('artifact_sha256'))):
        raise ValueError('requires verified safe AddNode core')
    _hash(selected.get('validation_sha256'))
    if type(artifact_lock) is not dict or artifact_lock.get('architecture') != 'linux/amd64':
        raise ValueError('invalid artifact architecture')
    rows = artifact_lock.get('artifacts')
    if type(rows) is not list or len(rows) != len(TAGS):
        raise ValueError('invalid artifact set')
    artifacts = {}
    for row in rows:
        if type(row) is not dict or row.get('repository') not in TAGS or row['repository'] in artifacts:
            raise ValueError('invalid artifact set')
        repo = row['repository']
        if (row.get('tag') != TAGS[repo] or type(row.get('url')) is not str
                or not row['url'].startswith('https://github.com/' + repo + '/releases/download/' + TAGS[repo] + '/')):
            raise ValueError('unreviewed artifact source')
        _hash(row.get('sha256'))
        artifacts[repo] = copy.deepcopy(row)
    hosts = access_render.get('hosts') if type(access_render) is dict else None
    if type(hosts) is not list or len(hosts) != 4:
        raise ValueError('requires four reviewed hosts')
    addresses, identities, keys = set(), set(), set()
    for i, host in enumerate(hosts):
        if (type(host) is not dict or host.get('alias') != 'ckc-disposable-%02d' % (i + 1)
                or host.get('node') != 'worker-%d' % (i + 1)):
            raise ValueError('host identity mismatch')
        ip = ipaddress.IPv4Address(host['ip'])
        if str(ip) != host['ip'] or not any(ip in ipaddress.IPv4Network(n) for n in
                ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10')):
            raise ValueError('invalid private address')
        if type(host['machine_id']) is not str or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}', host['machine_id']):
            raise ValueError('invalid machine identity')
        if type(host['boot_id']) is not str or not re.fullmatch('[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', host['boot_id']):
            raise ValueError('invalid boot identity')
        addresses.add(host['ip']); identities.add(host['machine_id']); keys.add(_hash(host['host_key_sha256']))
    if any(len(s) != 4 for s in (addresses, identities, keys)):
        raise ValueError('duplicate host identity')
    if type(capacities) is not list or len(capacities) != 3:
        raise ValueError('requires exact reviewed capacities')
    workers = []
    for host, capacity in zip(hosts[1:], capacities):
        _exact(capacity, {'node', 'resource_capacity', 'labels'})
        resources, labels = capacity['resource_capacity'], capacity['labels']
        if (capacity['node'] != host['node'] or type(resources) is not dict or not resources
                or any(type(k) is not str or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{0,63}', k)
                       or type(v) is not dict or not v for k, v in resources.items())
                or type(labels) is not dict or labels.get('owner') != 'eru-vps-mvp'
                or labels.get('role') != 'worker' or any(type(k) is not str or not re.fullmatch('[A-Za-z0-9_.-]{1,64}', k)
                   or type(v) is not str or not re.fullmatch('[A-Za-z0-9_.:-]{1,128}', v) for k, v in labels.items())):
            raise ValueError('invalid worker capacity/identity')
        if len(canonical(resources)) > 16384:
            raise ValueError('capacity too large')
        workers.append({**{k: host[k] for k in HOST_FIELDS}, 'podname': 'eru',
            'endpoint': 'containerd://ckc@' + host['ip'] + ':22',
            'resource_capacity': copy.deepcopy(resources), 'labels': copy.deepcopy(labels)})
    data_root = '/var/lib/eru-fresh-etcd/' + run_id
    etcd_conf = ('name: eru-fresh-etcd0\ndata-dir: ' + data_root + '\n'
        'listen-peer-urls: http://127.0.0.1:2380\nlisten-client-urls: http://127.0.0.1:2379\n'
        'initial-advertise-peer-urls: http://127.0.0.1:2380\nadvertise-client-urls: http://127.0.0.1:2379\n'
        'initial-cluster: eru-fresh-etcd0=http://127.0.0.1:2380\ninitial-cluster-token: '
        + token_bytes.decode() + '\ninitial-cluster-state: new\n')
    etcd_files = [_file('/etc/etcd/etcd.conf', etcd_conf), _file('/etc/systemd/system/etcd.service',
        '[Unit]\nDescription=Fresh ERU etcd\nAfter=network-online.target\n[Service]\nType=notify\n'
        'ExecStart=/usr/local/bin/etcd --config-file /etc/etcd/etcd.conf\nLimitNOFILE=40000\n')]
    core_conf = ('bind: "' + hosts[0]['ip'] + ':5001"\nstore: etcd\n'
        'lock_timeout: 30s\nglobal_timeout: 300s\nconnection_timeout: 10s\n'
        'etcd:\n  machines: ["http://127.0.0.1:2379"]\n  prefix: /eru\n  lock_prefix: __lock__/eru\n'
        'ssh:\n  private_key: ' + core_key_path + '\n  known_hosts: /etc/eru/known_hosts\n  user: ckc\n'
        'containerd:\n  socket: /run/eru/containerd.sock\n  namespace: eru\n'
        'process:\n  root: /var/lib/eru/process\n  stop_timeout: 10s\n'
        'scheduler:\n  maxshare: -1\n  sharebase: 100\n  max_deploy_count: 20\n'
        'resource_plugin:\n  dir: /etc/eru/plugins\n  call_timeout: 30s\n')
    core_files = [_file('/etc/eru/core.yaml', core_conf), _file('/etc/eru/plugins/storage.yaml',
        'etcd:\n  machines: ["http://127.0.0.1:2379"]\n  prefix: /eru-storage\nscheduler:\n  max_deploy_count: 20\n'),
        _file('/etc/systemd/system/eru-core.service', '[Unit]\nDescription=Fresh ERU core\nAfter=network-online.target etcd.service\nRequires=etcd.service\n'
        '[Service]\nExecStart=/usr/local/bin/eru-core --config /etc/eru/core.yaml\nLimitNOFILE=65536\n')]
    mapping = {'etcd-io/etcd': {n: '/usr/local/bin/' + n for n in ('etcd', 'etcdctl', 'etcdutl')},
               'projecteru2/cli': {'eru-cli': '/usr/local/bin/eru-cli'},
               'projecteru2/resource-extend': {'resource-storage': '/etc/eru/plugins/resource-storage'}}
    def artifact(repo):
        return {**artifacts[repo], 'files': mapping[repo]}
    rendered_hosts = []
    for i, host in enumerate(hosts):
        row = {k: host[k] for k in HOST_FIELDS}
        if i == 0:
            row['etcd_install'] = _payload(etcd_files, [artifact('etcd-io/etcd')])
            row['core_install'] = _payload(core_files, [artifact('projecteru2/cli'), artifact('projecteru2/resource-extend')],
                [{'path': '/usr/local/bin/eru-core', 'mode': '0755', 'sha256': selected['artifact_sha256'],
                  'source': 'safe-core'}])
        else:
            # Reuse established worker units/CNI, while accepting reviewed RFC1918 endpoints.
            old = build_worker_payload({'alias': host['alias'], 'node': host['node'], 'index': i + 1,
                                        'ip': '100.64.0.' + str(i + 1)}, '100.64.0.1', artifact_lock)
            files = [_file(f['path'], f['content'].replace('100.64.0.1:5001', hosts[0]['ip'] + ':5001'),
                           '%04o' % f['mode']) for f in old['files']
                     if f['path'] != '/usr/local/libexec/eru-ssh-command']
            row['agent_install'] = _payload(files, old['artifacts'])
        rendered_hosts.append(row)
    return {'schema_version': 1, 'operation': 'fresh-bootstrap-render', 'run_id': run_id,
        'target_token_sha256': target_token_sha256, 'safe_core_sha256': selected['artifact_sha256'],
        'data_root': data_root, 'core_key_path': core_key_path, 'hosts': rendered_hosts, 'workers': workers,
        'inputs': {'access_render': copy.deepcopy(access_render), 'artifact_lock': copy.deepcopy(artifact_lock),
                  'token_base64': base64.b64encode(token_bytes).decode(), 'prior_token_sha256': prior_token_sha256,
                  'safe_core': copy.deepcopy(safe_core), 'capacities': copy.deepcopy(capacities)}}


def validate_render(value):
    _exact(value, {'schema_version', 'operation', 'run_id', 'target_token_sha256', 'safe_core_sha256',
                   'data_root', 'core_key_path', 'hosts', 'workers', 'inputs'})
    i = value['inputs']
    _exact(i, {'access_render', 'artifact_lock', 'token_base64', 'prior_token_sha256', 'safe_core', 'capacities'})
    token = decode_binary(i['token_base64'])
    rebuilt = build_render(i['access_render'], i['artifact_lock'], token, run_id=value['run_id'],
        target_token_sha256=value['target_token_sha256'], prior_token_sha256=i['prior_token_sha256'],
        safe_core=i['safe_core'], core_key_path=value['core_key_path'], capacities=i['capacities'])
    if canonical(value) != canonical(rebuilt):
        raise ValueError('bootstrap render not deterministic derivation')
    return rebuilt
