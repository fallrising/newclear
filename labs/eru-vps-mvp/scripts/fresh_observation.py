"""Fixed, bounded, read-only observation protocol; never a fence or acceptance."""
import base64
import hashlib
import ipaddress
import json
import re

from fresh_execution import context, exact, timestamp
from fresh_rebuild import plan_digest

PROBE_LIMIT = 512 * 1024
HOST_LIMIT = 4 * 1024 * 1024
MAX_KEYS = 4096
ALIASES = tuple('ckc-disposable-%02d' % i for i in range(1, 5))


def decode(raw):
    # Lazy import prevents a cycle when preparation accepts observation references.
    from fresh_execution_ops import _decode
    return _decode(raw)


def public_key(value):
    if type(value) is not str:
        raise ValueError('invalid observation public key')
    parts = value.split()
    if len(parts) != 2 or parts[0] != 'ssh-ed25519':
        raise ValueError('observation requires canonical Ed25519 public key')
    try:
        raw = base64.b64decode(parts[1], validate=True)
    except ValueError:
        raise ValueError('invalid observation public key') from None
    if (len(raw) != 51 or raw[:19] != b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20'
            or base64.b64encode(raw).decode() != parts[1] or value != ' '.join(parts)):
        raise ValueError('invalid observation public key wire format')
    return hashlib.sha256(raw).hexdigest()


def trust_keys(raw):
    manifest = decode(raw)
    if type(manifest) is not dict or set(manifest) != set(ALIASES):
        raise ValueError('observation requires four reviewed host public keys')
    result = {}
    for alias, entries in manifest.items():
        if type(entries) is not list or any(type(k) is not str for k in entries):
            raise ValueError('invalid observation trust manifest')
        keys = [key for key in entries if key.startswith('ssh-ed25519 ')]
        if len(keys) != 1:
            raise ValueError('observation requires exactly one Ed25519 key per host')
        public_key(keys[0])
        result[alias] = keys[0]
    if len(set(result.values())) != 4:
        raise ValueError('observation host public keys must be distinct')
    return result


def commands(core_ip, core):
    ip = str(ipaddress.IPv4Address(core_ip))
    result = {'machine': ['cat', '/etc/machine-id'],
              'boot': ['cat', '/proc/sys/kernel/random/boot_id'],
              'public_key': ['cat', '/etc/ssh/ssh_host_ed25519_key.pub'],
              'containers': ['ctr', '--namespace', 'eru', 'containers', 'list', '-q'],
              'tasks': ['ctr', '--namespace', 'eru', 'tasks', 'list', '-q']}
    if core:
        etcd = ['/usr/local/bin/etcdctl', '--endpoints=http://127.0.0.1:2379',
                '--command-timeout=10s', '-w', 'json']
        cli = ['/usr/local/bin/eru-cli', '--eru', ip + ':5001', '--output', 'json']
        result.update(status_before=etcd + ['endpoint', 'status'],
                      members=etcd + ['member', 'list'],
                      keys=etcd + ['get', '--from-key', '', '--keys-only', '--limit=4097'],
                      nodes=cli + ['pod', 'nodes', 'eru'],
                      workloads=cli + ['workload', 'list'],
                      status_after=etcd + ['endpoint', 'status'])
    result.update(machine_after=['cat', '/etc/machine-id'],
                  boot_after=['cat', '/proc/sys/kernel/random/boot_id'],
                  public_key_after=['cat', '/etc/ssh/ssh_host_ed25519_key.pub'])
    return result


# Shared verbatim by local SSH capture and the fixed remote Python probe.
CAPTURE_SOURCE = '''import os, selectors, subprocess, time

def capture(argv, limit, timeout, input_bytes=None, pass_fds=()):
    p = subprocess.Popen(argv, stdin=subprocess.PIPE if input_bytes is not None else subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, pass_fds=pass_fds,
                         start_new_session=True)
    streams = selectors.DefaultSelector()
    chunks = {"stdout": bytearray(), "stderr": bytearray()}
    deadline = time.monotonic() + timeout
    try:
        if input_bytes is not None:
            os.set_blocking(p.stdin.fileno(), False)
            streams.register(p.stdin, selectors.EVENT_WRITE, "stdin")
        for name in chunks:
            streams.register(getattr(p, name), selectors.EVENT_READ, name)
        offset = 0
        while streams.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError("observation probe timed out")
            for key, _ in streams.select(min(remaining, 0.1)):
                if key.data == "stdin":
                    offset += os.write(key.fd, input_bytes[offset:offset + 4096])
                    if offset == len(input_bytes):
                        streams.unregister(key.fileobj)
                        key.fileobj.close()
                    continue
                data = os.read(key.fd, 65536)
                if not data:
                    streams.unregister(key.fileobj)
                else:
                    chunks[key.data].extend(data)
                    if sum(map(len, chunks.values())) > limit:
                        raise ValueError("observation probe exceeded byte limit")
        if p.wait(timeout=max(0.01, deadline - time.monotonic())) != 0:
            raise ValueError("observation probe failed")
        return bytes(chunks["stdout"])
    finally:
        import signal
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        p.wait()
        streams.close()
        for stream in (p.stdin, p.stdout, p.stderr):
            if stream is not None:
                stream.close()
'''
exec(CAPTURE_SOURCE)


def script(core_ip, core):
    return CAPTURE_SOURCE + '\n' + '''import json, sys

def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON field")
        result[key] = value
    return result

def invalid(value):
    raise ValueError("nonstandard JSON number")

try:
    outputs = {}
    for name, argv in COMMANDS.items():
        text = capture(argv, LIMIT, 10).decode("utf-8")
        if name in ("nodes", "workloads"):
            rows = json.loads(text, object_pairs_hook=unique, parse_constant=invalid)
            fields = ("name", "podname", "resource_capacity", "resource_usage") if name == "nodes" else ("id", "nodename")
            if type(rows) is not list:
                raise ValueError("metadata list unavailable")
            text = json.dumps([{field: row[field] for field in fields} for row in rows], allow_nan=False, sort_keys=True)
        elif name in ("public_key", "public_key_after"):
            fields = text.split()
            if len(fields) < 2:
                raise ValueError("public key unavailable")
            text = " ".join(fields[:2]) + "\\n"
        outputs[name] = text
    print(json.dumps(outputs, allow_nan=False, sort_keys=True))
except Exception:
    sys.exit(1)
'''.replace('COMMANDS', repr(commands(core_ip, core))).replace('LIMIT', str(PROBE_LIMIT))


def _ids(raw):
    values = raw.splitlines()
    if (len(values) > MAX_KEYS or len(set(values)) != len(values)
            or any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}', v) for v in values)):
        raise ValueError('invalid or duplicate runtime identity')
    return values


def _header(value):
    if type(value) is not dict:
        raise ValueError('missing etcd header')
    result = tuple(value.get(k) for k in ('cluster_id', 'member_id', 'revision'))
    if any(type(v) is not int or v < 1 for v in result):
        raise ValueError('invalid etcd identity or revision')
    return result


def _resources(value):
    if type(value) is not str:
        raise ValueError('resource metadata must be encoded JSON')
    parsed = decode(value)
    if type(parsed) is not dict:
        raise ValueError('resource metadata must be object')
    def walk(item):
        if type(item) is dict:
            for key, child in item.items():
                if not key:
                    raise ValueError('invalid resource name')
                walk(child)
        elif type(item) not in (int, float) or item < 0:
            raise ValueError('invalid resource amount')
    walk(parsed)


def _validate_observation(envelope, plan, binding, now):
    exact(envelope, {'observation', 'sha256'})
    row = envelope['observation']
    exact(row, {'schema_version', 'operation', 'binding', 'observed_at', 'completed_at',
                'source', 'private_identity', 'trust_manifest', 'captures', 'remote_mutation_performed'})
    if (type(row['schema_version']) is not int or row['schema_version'] != 1
            or row['operation'] != 'fresh-baseline-observation'
            or row['remote_mutation_performed'] is not False
            or plan_digest(row) != envelope['sha256']
            or plan_digest(row['binding']) != plan_digest(binding)
            or plan_digest(context(plan, binding['review_sha256'], binding['run_id'])) != plan_digest(binding)):
        raise ValueError('observation envelope binding mismatch')
    if (plan_digest(row['source']) != plan_digest(plan['bindings']['current_source'])
            or type(row['private_identity']) is not list or len(row['private_identity']) != 2
            or any(type(value) is not int or value < 0 for value in row['private_identity'])):
        raise ValueError('observation source or private identity invalid')
    start, end = timestamp(row['observed_at']), timestamp(row['completed_at'])
    if not 0 <= (now - start).total_seconds() <= 900 or not start <= end <= now or (end - start).total_seconds() > 360:
        raise ValueError('observation is stale, future, or exceeds duration')
    raw = row['trust_manifest']
    if type(raw) is not str or hashlib.sha256(raw.encode()).hexdigest() != plan['bindings']['code_inputs']['private/verified-host-public-keys.json']:
        raise ValueError('observation trust differs from review')
    trusted = trust_keys(raw)
    captures = row['captures']
    if type(captures) is not list or len(captures) != 4:
        raise ValueError('observation requires four complete captures')
    hosts, runtimes, boot_ids, keys = [], {}, set(), set()
    core_outputs = None
    for index, (capture_row, host) in enumerate(zip(captures, plan['scope']['hosts'])):
        exact(capture_row, {'alias', 'ip', 'script_sha256', 'outputs'})
        if capture_row['alias'] != ALIASES[index] or host['alias'] != ALIASES[index]:
            raise ValueError('observation alias order mismatch')
        outputs = capture_row['outputs']
        core_ip = captures[0]['ip']
        expected_script = hashlib.sha256(script(core_ip, index == 0).encode()).hexdigest()
        if capture_row['script_sha256'] != expected_script:
            raise ValueError('observation script mismatch')
        ipaddress.IPv4Address(capture_row['ip'])
        exact(outputs, commands(core_ip, index == 0))
        if any(type(v) is not str or len(v.encode()) > PROBE_LIMIT for v in outputs.values()):
            raise ValueError('observation command output invalid or too large')
        machine, boot, key = outputs['machine'].strip(), outputs['boot'].strip(), outputs['public_key'].strip()
        if (machine != host['current_machine_id'] or not machine or len(machine) > 256
                or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', boot)
                or key != trusted[host['alias']]):
            raise ValueError('observation host incarnation mismatch')
        for name in ('machine', 'boot', 'public_key'):
            if outputs[name].strip() != outputs[name + '_after'].strip():
                raise ValueError('observation host incarnation changed during probe')
        containers, tasks = _ids(outputs['containers']), _ids(outputs['tasks'])
        if not set(tasks) <= set(containers):
            raise ValueError('runtime tasks lack matching containers')
        runtimes[host['node']] = set(containers)
        boot_ids.add(boot)
        keys.add(public_key(key))
        hosts.append({'alias': host['alias'], 'node': host['node'], 'machine_id': machine,
                      'boot_id_sha256': hashlib.sha256(boot.encode()).hexdigest(),
                      'host_key_sha256': public_key(key)})
        if index == 0:
            core_outputs = outputs
    if len(boot_ids) != 4 or len(keys) != 4 or len({h['machine_id'] for h in hosts}) != 4 or len({r['ip'] for r in captures}) != 4:
        raise ValueError('observation host identities must be distinct')
    outputs = core_outputs
    statuses = [decode(outputs[name]) for name in ('status_before', 'status_after')]
    headers = []
    for status in statuses:
        if type(status) is not list or len(status) != 1 or status[0].get('Endpoint') != 'http://127.0.0.1:2379':
            raise ValueError('unexpected etcd endpoint status')
        value = status[0]['Status']
        if value.get('errors') or value.get('leader') != value['header'].get('member_id'):
            raise ValueError('etcd endpoint is not healthy single leader')
        headers.append(_header(value['header']))
    members, inventory = decode(outputs['members']), decode(outputs['keys'])
    headers.append(_header(inventory.get('header')))
    member_header = members.get('header')
    if (type(member_header) is not dict
            or any(type(member_header.get(k)) is not int for k in ('cluster_id', 'member_id'))
            or (member_header['cluster_id'], member_header['member_id']) != headers[0][:2]):
        raise ValueError('etcd member-list identity differs')
    if len(set(headers)) != 1:
        raise ValueError('etcd identity or revision changed during collection')
    member_rows = members.get('members')
    if type(member_rows) is not list or len(member_rows) != 1 or member_rows[0].get('ID') != headers[0][1] or member_rows[0].get('isLearner', False) is not False:
        raise ValueError('unexpected etcd membership')
    kvs = inventory.get('kvs', [])
    count = inventory.get('count', 0)
    if (type(kvs) is not list or type(count) is not int or not 0 <= count <= MAX_KEYS
            or count != len(kvs) or inventory.get('more', False) is not False):
        raise ValueError('etcd key inventory is partial or oversized')
    key_names = set()
    for kv in kvs:
        if type(kv) is not dict or kv.get('value', '') != '':
            raise ValueError('etcd observation contains forbidden key values')
        try:
            key = base64.b64decode(kv['key'], validate=True)
        except (ValueError, KeyError, TypeError):
            raise ValueError('invalid etcd key encoding') from None
        if not key or key in key_names or base64.b64encode(key).decode() != kv['key']:
            raise ValueError('duplicate or invalid etcd key')
        key_names.add(key)
    nodes, workloads = decode(outputs['nodes']), decode(outputs['workloads'])
    expected_nodes = {h['node'] for h in plan['scope']['hosts'][1:]}
    if type(nodes) is not list or len(nodes) != 3 or {n.get('name') for n in nodes} != expected_nodes:
        raise ValueError('observation requires exact three worker metadata rows')
    for node in nodes:
        exact(node, {'name', 'podname', 'resource_capacity', 'resource_usage'})
        if node['podname'] != 'eru':
            raise ValueError('unexpected ERU pod')
        _resources(node['resource_capacity'])
        _resources(node['resource_usage'])
    if type(workloads) is not list or len(workloads) > MAX_KEYS:
        raise ValueError('invalid workload inventory')
    workload_ids = set()
    for workload in workloads:
        exact(workload, {'id', 'nodename'})
        if (type(workload['id']) is not str or workload['id'] in workload_ids
                or workload['nodename'] not in expected_nodes
                or workload['id'] not in runtimes[workload['nodename']]):
            raise ValueError('workload identity or runtime differs')
        workload_ids.add(workload['id'])
    return {'schema_version': 1, 'kind': 'host_baseline', 'binding': binding,
            'observed_at': row['observed_at'], 'hosts': hosts}


def validate_observation(envelope, plan, binding, now):
    try:
        return _validate_observation(envelope, plan, binding, now)
    except (KeyError, TypeError, AttributeError, IndexError, OverflowError, RecursionError):
        raise ValueError('malformed observation evidence') from None
