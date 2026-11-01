"""Fixed bare-OS observation protocol, without runtime or network readiness claims."""
import base64
from datetime import timedelta
import hashlib
import ipaddress

from fresh_execution import exact, identifier, sha256, timestamp
from fresh_observation import public_key
from fresh_rebuild import plan_digest

MARKERS = ('/etc/eru', '/etc/etcd', '/var/lib/etcd-eru-mvp',
           '/usr/local/bin/eru-core', '/usr/local/bin/eru-agent') + tuple(
    prefix + unit for prefix in ('/etc/systemd/system/', '/lib/systemd/system/', '/usr/lib/systemd/system/')
    for unit in ('eru-core.service', 'eru-agent.service', 'eru-etcd.service', 'eru-mvp-firewall.service',
                 'eru-containerd-proxy.service', 'eru-containerd-proxy.socket'))

PROBE = r'''
import json
import os
import re
import shlex
import stat


def read(path):
    flags = os.O_RDONLY | os.O_NONBLOCK
    if path != '/etc/os-release':
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > 65536:
            raise ValueError('not a bounded regular identity file')
        chunks = []
        size = 0
        while True:
            chunk = os.read(fd, min(4096, 65537 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > 65536:
                raise ValueError('identity file too large')
        after = os.fstat(fd)
        current = os.stat(path, follow_symlinks=(path == '/etc/os-release'))
        signature = lambda info: (info.st_dev, info.st_ino, info.st_mtime_ns, info.st_ctime_ns)
        if signature(before) != signature(after) or signature(current) != signature(after):
            raise ValueError('identity file changed during read')
        return b''.join(chunks).decode('utf-8')
    finally:
        os.close(fd)


def os_release():
    values = {}
    for line in read('/etc/os-release').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or key in values:
            raise ValueError('invalid OS release')
        parsed = shlex.split(value, comments=False, posix=True)
        if len(parsed) != 1:
            raise ValueError('invalid OS release value')
        values[key] = parsed[0]
    return values['PRETTY_NAME']


def identity():
    raw_key = read('/etc/ssh/ssh_host_ed25519_key.pub').strip()
    if '\n' in raw_key or '\r' in raw_key:
        raise ValueError('invalid public key file')
    fields = raw_key.split()
    if len(fields) < 2:
        raise ValueError('missing public key')
    return {'machine_id': read('/etc/machine-id').strip(),
            'boot_id': read('/proc/sys/kernel/random/boot_id').strip(),
            'os_release': os_release(), 'public_key': ' '.join(fields[:2])}


before = identity()
markers = {}
for path in MARKERS:
    try:
        os.lstat(path)
    except FileNotFoundError:
        markers[path] = False
    else:
        markers[path] = True
architecture = os.uname().machine
after = identity()
print(json.dumps({'schema_version': 1, 'before': before, 'after': after,
                  'architecture': architecture, 'markers': markers}, allow_nan=False))
'''


def script():
    return 'MARKERS = ' + repr(MARKERS) + '\n' + PROBE


def validate_request(request, receipts, rows, run_id, execution_sha):
    exact(request, {'schema_version', 'run_id', 'execution_sha256', 'receipt_request',
                    'receipt_assessment_sha256', 'hosts'})
    if (type(request['schema_version']) is not int or request['schema_version'] != 1
            or request['run_id'] != run_id or request['execution_sha256'] != execution_sha):
        raise ValueError('replacement request binding mismatch')
    sha256(request['receipt_assessment_sha256'])
    if type(request['hosts']) is not list or len(request['hosts']) != 4 or len(receipts) != 4:
        raise ValueError('replacement request requires four hosts')
    ips, keys = set(), set()
    for host, row, receipt in zip(request['hosts'], rows, receipts):
        exact(host, {'alias', 'node', 'ip', 'public_key'})
        if (host['alias'], host['node']) != (row['alias'], row['node']):
            raise ValueError('replacement endpoint order mismatch')
        if type(host['ip']) is not str or str(ipaddress.IPv4Address(host['ip'])) != host['ip']:
            raise ValueError('replacement requires canonical IPv4')
        key = public_key(host['public_key'])
        expected = base64.b64decode(receipt['host_key_fingerprints']['ssh-ed25519'][7:] + '=', validate=True).hex()
        if key != expected or key in keys or host['ip'] in ips:
            raise ValueError('replacement OOB key or endpoint mismatch')
        ips.add(host['ip'])
        keys.add(key)


def validate_outputs(outputs, receipt, key):
    exact(outputs, {'schema_version', 'before', 'after', 'architecture', 'markers'})
    if type(outputs['schema_version']) is not int or outputs['schema_version'] != 1:
        raise ValueError('unsupported replacement facts')
    expected = {**receipt['replacement'], 'public_key': key}
    for phase in ('before', 'after'):
        exact(outputs[phase], {'machine_id', 'boot_id', 'os_release', 'public_key'})
        if plan_digest(outputs[phase]) != plan_digest(expected):
            raise ValueError('replacement identity does not match receipt or changed')
    if outputs['architecture'] != 'x86_64':
        raise ValueError('replacement architecture unsupported')
    exact(outputs['markers'], set(MARKERS))
    if any(value is not False for value in outputs['markers'].values()):
        raise ValueError('known ERU or etcd marker is present or unknown')


def validate_observation(envelope, request, receipts, observation_id, now):
    exact(envelope, {'observation', 'sha256'})
    record = envelope['observation']
    exact(record, {'schema_version', 'operation', 'id', 'run_id', 'execution_sha256',
                   'input', 'receipt_assessment_sha256', 'private_identity',
                   'observed_at', 'completed_at', 'captures'})
    if (type(record['schema_version']) is not int or record['schema_version'] != 1
            or record['operation'] != 'fresh-replacement-observation'
            or identifier(record['id']) != observation_id
            or record['run_id'] != request['run_id']
            or record['execution_sha256'] != request['execution_sha256']
            or record['receipt_assessment_sha256'] != request['receipt_assessment_sha256']
            or sha256(envelope['sha256']) != plan_digest(record)):
        raise ValueError('replacement observation binding mismatch')
    start, end = timestamp(record['observed_at']), timestamp(record['completed_at'])
    if not start <= end <= now or end - start > timedelta(seconds=360) or now - start > timedelta(minutes=15):
        raise ValueError('replacement observation time invalid or expired')
    if any(timestamp(receipt['owner_reviewed_at']) > start for receipt in receipts):
        raise ValueError('replacement observation precedes receipt review')
    captures = record['captures']
    if type(captures) is not list or len(captures) != 4:
        raise ValueError('replacement observation incomplete')
    for capture, host, receipt in zip(captures, request['hosts'], receipts):
        exact(capture, {'alias', 'node', 'ip', 'public_key', 'script_sha256', 'outputs'})
        if ({key: capture[key] for key in host} != host
                or capture['script_sha256'] != hashlib.sha256(script().encode()).hexdigest()):
            raise ValueError('replacement probe provenance changed')
        validate_outputs(capture['outputs'], receipt, host['public_key'])
    return record
