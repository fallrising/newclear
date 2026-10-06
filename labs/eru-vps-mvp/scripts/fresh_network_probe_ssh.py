"""Fixed read-only SSH and TCP probes; explicit invocation only, never mutation."""
import base64
import copy
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
from pathlib import Path
import sys
import shlex

from fresh_observation import CAPTURE_SOURCE, capture, decode, public_key
from fresh_observation_ops import SSHReader
from fresh_network_probe import (ERROR, SERVICES, auth_record, controller_record, public_targets,
                                 validate_host, validate_network_evidence, validate_setup, service_expectations)
from fresh_network_directory import HOST_FIELDS
from fresh_rebuild import plan_digest
import fresh_network_staging_host as support

LIMIT = 256 * 1024

IDENTITY_SOURCE = """import base64,hashlib,json,pathlib
p=pathlib.Path
key=p('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()
assert key[0]=='ssh-ed25519'
print(json.dumps({'machine_id':p('/etc/machine-id').read_text().strip(),
'boot_id':p('/proc/sys/kernel/random/boot_id').read_text().strip(),
'host_key_sha256':hashlib.sha256(base64.b64decode(key[1],validate=True)).hexdigest()}))
"""
IDENTITY_COMMAND = '/usr/bin/python3 -I -c ' + shlex.quote(IDENTITY_SOURCE)

# This source is bundled verbatim with the reviewed standard-library capture and
# safe file/identity helpers. Requests enter only as base64 JSON data.
HOST_SOURCE = r'''
import hashlib, ipaddress, json, os, re, stat
from datetime import datetime, timezone

def _output(runner, argv, **kw):
    raw = runner(argv, 262144, 20, **kw)
    if type(raw) is not bytes or len(raw) > 262144:
        raise ValueError('invalid bounded output')
    return raw

def _json(runner, argv, **kw):
    return support._decode(_output(runner, argv, **kw))

def _authenticated(runner, argv, worker, key_sha, key_fd, trust_fd):
    # OpenSSH's bounded verbose log states the negotiated method; command success
    # alone could also occur on an sshd accepting the initial "none" request.
    raw = _output(runner, argv, pass_fds=(key_fd, trust_fd)).decode()
    lines = raw.splitlines()
    wanted = 'Authenticated to ' + worker['ip'] + ' ([' + worker['ip'] + ']:22) using "publickey".'
    authenticated = [line for line in lines if line.startswith('Authenticated to ')]
    fingerprint = 'SHA256:' + base64.b64encode(bytes.fromhex(key_sha)).decode().rstrip('=')
    accepted = 'debug1: Server accepts key: /proc/self/fd/' + str(key_fd) + ' ED25519 ' + fingerprint + ' explicit'
    if authenticated != [wanted] or lines.count(accepted) != 1:
        raise ValueError('effective publickey authentication not observed')
    records = [line for line in lines if line.startswith('{')]
    if len(records) != 1:
        raise ValueError('ambiguous authenticated identity')
    return support._decode(records[0].encode())

def _key_hash(raw):
    parts = raw.decode().strip().split()
    if len(parts) < 2 or parts[0] != 'ssh-ed25519':
        raise ValueError('invalid key')
    blob = base64.b64decode(parts[1], validate=True)
    if len(blob) != 51 or blob[:19] != b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20':
        raise ValueError('invalid key')
    return hashlib.sha256(blob).hexdigest()

def _open_file(root, path, uid, gid, mode, *, user_uid=None):
    """Open all path components without following symlinks; never read secret bytes."""
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parts = path.strip('/').split('/')
        for part in parts[:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            info = os.fstat(fd)
            if info.st_uid not in (uid, user_uid) or info.st_mode & 0o022:
                raise ValueError('unsafe directory')
        result = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        info = os.fstat(result)
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                or info.st_uid not in (uid, user_uid) or stat.S_IMODE(info.st_mode) != mode
                or (info.st_uid == uid and info.st_gid != gid)):
            os.close(result)
            raise ValueError('unsafe file')
        return result
    finally:
        os.close(fd)

def _read_public_file(root, path, uid, gid, mode, *, user_uid=None):
    fd = _open_file(root, path, uid, gid, mode, user_uid=user_uid)
    try:
        before = os.fstat(fd)
        raw = os.read(fd, 262145)
        if len(raw) > 262144 or support._identity(before) != support._identity(os.fstat(fd)):
            raise ValueError('unsafe public file')
        linked_fd = _open_file(root, path, uid, gid, mode, user_uid=user_uid)
        try:
            if support._identity(before) != support._identity(os.fstat(linked_fd)):
                raise ValueError('public path changed')
        finally:
            os.close(linked_fd)
        return raw
    finally:
        os.close(fd)

def _route(runner, target, source, interface):
    version = ipaddress.ip_address(target).version
    rows = _json(runner, ['/usr/sbin/ip', '-' + str(version), '-j', 'route', 'get', target, 'from', source])
    if (type(rows) is not list or len(rows) != 1 or rows[0].get('dev') != interface
            or rows[0].get('type', 'unicast') != 'unicast'
            or rows[0].get('prefsrc', rows[0].get('src', rows[0].get('from'))) != source
            or rows[0].get('dst') != target):
        raise ValueError('unexpected route')


def observe_host(request, *, root='/', uid=0, gid=0, runner=None, now=None, user_uid=None):
    runner = capture if runner is None else runner
    render, setup, index = request['render'], request['setup'], request['host_index']
    host = render['hosts'][index]
    action = {'host': host}
    with_session = support._Session(root, uid, gid, action)
    try:
        session = with_session
        files = []
        for f in host['files']:
            raw = session.read(f['path'].lstrip('/'), True)
            if hashlib.sha256(raw).hexdigest() != f['sha256']:
                raise ValueError('staged file changed')
            files.append({'path': f['path'], 'sha256': hashlib.sha256(raw).hexdigest(),
                          'uid': 0, 'gid': 0, 'mode': '0600', 'nlink': 1, 'kind': 'regular'})
        links = _json(runner, ['/usr/sbin/ip', '-j', 'address', 'show'])
        if type(links) is not list:
            raise ValueError('unknown interfaces')
        private = [a for link in links if link.get('ifname') == render['private_interface']
                   for a in link.get('addr_info', []) if a.get('family') == 'inet' and a.get('local') == host['ip']]
        if len(private) != 1 or private[0].get('scope') not in ('global',):
            raise ValueError('private address absent')
        global6 = sorted(str(ipaddress.IPv6Address(a['local'])) for link in links
                         for a in link.get('addr_info', []) if a.get('family') == 'inet6'
                         and ipaddress.IPv6Address(a['local']).is_global)
        wanted6 = [setup['hosts'][index]['public_ipv6']] if setup['hosts'][index]['public_ipv6'] else []
        if global6 != wanted6:
            raise ValueError('unreviewed public IPv6')
        services = {}
        phase = request.get('expected_services', {unit: 'stopped' for unit in ('etcd.service', 'eru-core.service', 'eru-agent.service')})
        support._exact(phase, {'etcd.service', 'eru-core.service', 'eru-agent.service'})
        forbidden = ('eru-agent.service',) if index == 0 else ('etcd.service', 'eru-core.service')
        if (any(type(state) is not str or state not in ('active', 'stopped') for state in phase.values())
                or any(phase[unit] != 'stopped' for unit in forbidden)):
            raise ValueError('unsupported service phase')
        for unit in ('etcd.service', 'eru-core.service', 'eru-agent.service'):
            text = _output(runner, ['/usr/bin/systemctl', 'show', '--property=LoadState,ActiveState,SubState', unit]).decode()
            fields = dict(line.split('=', 1) for line in text.strip().splitlines())
            active = phase[unit] == 'active'
            if (set(fields) != {'LoadState', 'ActiveState', 'SubState'}
                    or fields['ActiveState'] != ('active' if active else 'inactive')
                    or fields['SubState'] != ('running' if active else 'dead')
                    or fields['LoadState'] not in (('loaded',) if active else ('loaded', 'not-found'))):
                raise ValueError('service differs from bootstrap phase')
            services[unit] = 'active' if active else ('absent' if fields['LoadState'] == 'not-found' else 'inactive')
        # A foreign unmanaged ERU process cannot hide behind an absent unit.
        tasks = _output(runner, ['/usr/bin/ps', '-eo', 'comm='])
        wanted = {unit.removesuffix('.service') for unit, state in phase.items() if state == 'active'}
        if set(tasks.decode().split()) & {'etcd', 'eru-core', 'eru-agent'} != wanted:
            raise ValueError('ERU tasks differ from bootstrap phase')
        rules = _json(runner, ['/usr/sbin/nft', '-j', '-n', '-a', 'list', 'table', 'inet', 'eru_fresh_access'])
        authentications = []
        if index == 0:
            key_fd = _open_file(root, setup['core_key']['path'], uid, gid, 0o600)
            trust_fd = None
            try:
                trust_fd = _open_file(root, setup['core_known_hosts_path'], uid, gid, 0o600)
                key_identity = support._identity(os.fstat(key_fd))
                key_sha = _key_hash(_output(runner, ['/usr/bin/ssh-keygen', '-y', '-f', '/proc/self/fd/' + str(key_fd)], pass_fds=(key_fd,)))
                if key_sha != setup['core_key']['public_key_sha256']:
                    raise ValueError('wrong effective key')
                trust_raw = os.read(trust_fd, 262145)
                trust_sha = hashlib.sha256(trust_raw).hexdigest()
                if trust_sha != host['files'][1]['sha256']:
                    raise ValueError('wrong effective trust')
                for worker in render['hosts'][1:]:
                    _route(runner, worker['ip'], host['ip'], render['private_interface'])
                    argv = ['/usr/bin/ssh', '-v', '-E', '/dev/stdout', '-F', '/dev/null', '-T', '-i', '/proc/self/fd/' + str(key_fd),
                        '-b', host['ip'], '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
                        '-o', 'PreferredAuthentications=publickey', '-o', 'PasswordAuthentication=no',
                        '-o', 'KbdInteractiveAuthentication=no', '-o', 'BatchMode=yes',
                        '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no',
                        '-o', 'HostKeyAlgorithms=ssh-ed25519', '-o', 'GlobalKnownHostsFile=/dev/null',
                        '-o', 'UserKnownHostsFile=/proc/self/fd/' + str(trust_fd),
                        '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1',
                        '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none', '-o', 'ControlMaster=no',
                        '-o', 'ControlPath=none', '-o', 'ControlPersist=no', '-o', 'PermitLocalCommand=no',
                        '-o', 'ClearAllForwardings=yes', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
                        '-o', 'RemoteCommand=none', '-p', '22', '-l', 'ckc', '--', worker['ip'], IDENTITY_COMMAND]
                    observed = _authenticated(runner, argv, worker, key_sha, key_fd, trust_fd)
                    expected = {k: worker[k] for k in ('machine_id', 'boot_id', 'host_key_sha256')}
                    if observed != expected:
                        raise ValueError('authentication identity mismatch')
                    authentications.append({'source_alias': host['alias'], 'target_alias': worker['alias'],
                        'source_ipv4': host['ip'], 'target_ipv4': worker['ip'], 'client_key_sha256': key_sha,
                        **observed, 'authentication': 'publickey', 'trust': 'pinned'})
                    _route(runner, worker['ip'], host['ip'], render['private_interface'])
                if key_identity != support._identity(os.fstat(key_fd)):
                    raise ValueError('key changed during authentication')
                linked_key = _open_file(root, setup['core_key']['path'], uid, gid, 0o600)
                try:
                    if key_identity != support._identity(os.fstat(linked_key)):
                        raise ValueError('key path changed during authentication')
                finally:
                    os.close(linked_key)
                access = {'role': 'core', 'client_key_sha256': key_sha, 'known_hosts_sha256': trust_sha}
            finally:
                os.close(key_fd)
                if trust_fd is not None:
                    os.close(trust_fd)
        else:
            if user_uid is None:
                import pwd
                user_uid = pwd.getpwnam('ckc').pw_uid
            config = _output(runner, ['/usr/sbin/sshd', '-T', '-C',
                'user=ckc,addr=' + render['hosts'][0]['ip'] + ',host=' + render['hosts'][0]['ip']
                + ',laddr=' + host['ip'] + ',lport=22']).decode()
            effective = {}
            for line in config.splitlines():
                field, _, value = line.partition(' ')
                if field in ('authorizedkeysfile', 'authorizedkeyscommand', 'pubkeyauthentication'):
                    if field in effective:
                        raise ValueError('ambiguous SSH configuration')
                    effective[field] = value
            if (effective.get('authorizedkeysfile') not in ('.ssh/authorized_keys', setup['worker_authorized_keys_path'])
                    or effective.get('authorizedkeyscommand') != 'none' or effective.get('pubkeyauthentication') != 'yes'):
                raise ValueError('unsupported effective authorized key path')
            helper_sha = hashlib.sha256(_read_public_file(root, setup['worker_helper_path'], uid, gid, 0o755)).hexdigest()
            authorized = _read_public_file(root, setup['worker_authorized_keys_path'], uid, gid, 0o600, user_uid=user_uid)
            authorized_sha = hashlib.sha256(authorized).hexdigest()
            candidate = host['files'][1]['content'].strip()
            core_public = candidate.split()[-1]
            active_lines = [line for line in authorized.decode().splitlines() if core_public in line.split()]
            if active_lines != [candidate]:
                raise ValueError('constrained core key missing or duplicated')
            if helper_sha != setup['worker_helper_sha256'] or authorized_sha != setup['hosts'][index]['authorized_keys_sha256']:
                raise ValueError('effective worker access changed')
            access = {'role': 'worker', 'helper_sha256': helper_sha, 'authorized_keys_sha256': authorized_sha}
        session.check()
        return {'observation': {'host': {k: host[k] for k in ('alias', 'node', 'ip', 'machine_id', 'boot_id', 'host_key_sha256')},
                'private_interface': render['private_interface'], 'private_ipv4': host['ip'], 'global_ipv6': global6,
                'services': services, 'effective_access': access, 'current_files': files, 'firewall_ruleset': rules},
                'core_worker_ssh': authentications}
    finally:
        with_session.close()


def host_main(encoded):
    try:
        request = support._decode(base64.b64decode(encoded, validate=True))
        result = observe_host(request)
        sys.stdout.write(json.dumps(result, sort_keys=True, separators=(',', ':'), allow_nan=False))
    except Exception:
        sys.stderr.write('network readiness probes rejected\n')
        raise SystemExit(1) from None
'''
exec(HOST_SOURCE)

CONNECT_SOURCE = r'''import errno, ipaddress, json, socket, sys
ip, source, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
family = socket.AF_INET if ipaddress.ip_address(ip).version == 4 else socket.AF_INET6
with socket.socket(family, socket.SOCK_STREAM) as s:
 s.settimeout(2)
 s.bind((source, 0))
 try:
  s.connect((ip, port))
  outcome='open'
 except socket.timeout:
  outcome='timed-out'
 except OSError as exc:
  outcome='refused' if exc.errno == errno.ECONNREFUSED else 'error'
 print(json.dumps({'outcome':outcome,'source_ip':s.getsockname()[0]}))
'''


def build_program(render, setup, index, *, expected_services=None):
    setup = validate_setup(setup, render)
    if type(index) is not int or not 0 <= index < 4:
        raise ValueError(ERROR)
    request = {'render': render, 'setup': setup, 'host_index': index,
               'expected_services': service_expectations(expected_services)[index]}
    helper = Path(__file__).with_name('fresh_network_staging_host.py').read_bytes()
    return ("import base64, sys, types\nsupport = types.ModuleType('support')\n"
            "exec(compile(base64.b64decode(" + repr(base64.b64encode(helper).decode())
            + "), '<fixed-safe-files>', 'exec'), support.__dict__)\n" + CAPTURE_SOURCE + '\nIDENTITY_COMMAND = ' + repr(IDENTITY_COMMAND) + '\n' + HOST_SOURCE
            + '\nhost_main(' + repr(base64.b64encode(json.dumps(request).encode()).decode()) + ')\n')


def collect(render, host_keys, *, setup=None, transport=None, runner=None, now=None, expected_services=None):
    try:
        setup = validate_setup(setup, render)
        phases = service_expectations(expected_services)
        render, host_keys = copy.deepcopy(render), copy.deepcopy(host_keys)
        if type(host_keys) is not dict or set(host_keys) != {h['alias'] for h in render['hosts']}:
            raise ValueError(ERROR)
        for host in render['hosts']:
            if public_key(host_keys[host['alias']]) != host['host_key_sha256']:
                raise ValueError(ERROR)
        transport = SSHReader() if transport is None else transport
        runner = capture if runner is None else runner
        started = now or datetime.now(timezone.utc)
        hosts, auth, private = [], [], []
        for index, host in enumerate(render['hosts']):
            _route(runner, host['ip'], render['controller_ip'], render['private_interface'])
            raw = transport({k: host[k] for k in HOST_FIELDS}, build_program(render, setup, index, expected_services=phases), host_keys[host['alias']])
            reply = support._decode(raw)
            support._exact(reply, {'observation', 'core_worker_ssh'})
            validate_host(reply['observation'], render, setup, index, expected_services=phases[index])
            expected_auth = [auth_record(render, setup, i) for i in range(1, 4)] if index == 0 else []
            if reply['core_worker_ssh'] != expected_auth:
                raise ValueError(ERROR)
            hosts.append(reply['observation'])
            auth.extend(reply['core_worker_ssh'])
            private.append(controller_record(host))
            _route(runner, host['ip'], render['controller_ip'], render['private_interface'])
        denials = []
        for target in public_targets(render, setup):
            _route(runner, target['ip'], target['source_ip'], target['interface'])
            outcome = _json(runner, [sys.executable, '-I', '-c', CONNECT_SOURCE,
                                    target['ip'], target['source_ip'], str(target['port'])])
            support._exact(outcome, {'outcome', 'source_ip'})
            if outcome['source_ip'] != target['source_ip'] or outcome['outcome'] not in ('refused', 'timed-out'):
                raise ValueError(ERROR)
            _route(runner, target['ip'], target['source_ip'], target['interface'])
            denials.append({**target, 'outcome': outcome['outcome']})
        evidence = {'schema_version': 1, 'operation': 'fresh-network-ready-probes', 'observed_at': started.isoformat(),
            'render_sha256': plan_digest(render), 'setup_sha256': plan_digest(setup), 'hosts': hosts,
            'core_worker_ssh': auth, 'controller_private_ssh': private, 'public_denials': denials}
        return validate_network_evidence(evidence, render, now or datetime.now(timezone.utc), setup=setup, expected_services=phases)
    except Exception:
        raise ValueError(ERROR) from None
