"""Strict current network-stage evidence. Importing performs no host IO."""
import copy
from datetime import datetime, timedelta, timezone
import ipaddress
import re

from fresh_execution import exact, identifier, sha256, timestamp
from fresh_network_access import MANAGEMENT_PORTS
from fresh_network_directory import HOST_FIELDS
import fresh_network_firewall as firewall
from fresh_observation import ALIASES, public_key
from fresh_rebuild import plan_digest

ERROR = 'network readiness probes rejected'
SERVICES = ('etcd.service', 'eru-core.service', 'eru-agent.service')


def firewall_action(render, index):
    plan = {'id': 'probe', 'run_id': 'probe', 'execution_sha256': '0' * 64, 'render': render}
    return firewall.action(plan, '0' * 64, {'sha256': '0' * 64}, index, '0' * 64, '0' * 64)


def validate_setup(setup, render):
    """The manual profile is data, never an arbitrary command, key path or target."""
    try:
        firewall._bounded(setup)
        for i in range(4):
            firewall_action(render, i)
        exact(setup, {'schema_version', 'hosts', 'core_key', 'worker_authorized_keys_path',
                     'core_known_hosts_path', 'worker_helper_path', 'worker_helper_sha256', 'controller_egress'})
        if type(setup['schema_version']) is not int or setup['schema_version'] != 1:
            raise ValueError(ERROR)
        fixed = {'worker_authorized_keys_path': '/home/ckc/.ssh/authorized_keys',
                 'core_known_hosts_path': '/etc/eru/known_hosts',
                 'worker_helper_path': '/usr/local/libexec/eru-ssh-command'}
        if any(setup[k] != v for k, v in fixed.items()):
            raise ValueError(ERROR)
        sha256(setup['worker_helper_sha256'])
        exact(setup['core_key'], {'path', 'public_key_sha256'})
        if setup['core_key']['path'] != '/root/.ssh/eru-fresh-core':
            raise ValueError(ERROR)
        client_keys = []
        for h in render['hosts'][1:]:
            line = h['files'][1]['content'].strip().split()
            client_keys.append(public_key(' '.join(line[-2:])))
        if client_keys != [sha256(setup['core_key']['public_key_sha256'])] * 3:
            raise ValueError(ERROR)
        if type(setup['hosts']) is not list or len(setup['hosts']) != 4:
            raise ValueError(ERROR)
        for i, row in enumerate(setup['hosts']):
            exact(row, {'host_index', 'public_ipv4', 'public_ipv6', 'console_action_ref', 'authorized_keys_sha256'})
            address = ipaddress.IPv4Address(row['public_ipv4'])
            if (type(row['host_index']) is not int or row['host_index'] != i
                    or str(address) != row['public_ipv4'] or not address.is_global or address.is_multicast):
                raise ValueError(ERROR)
            identifier(row['console_action_ref'])
            if i == 0:
                if row['authorized_keys_sha256'] is not None:
                    raise ValueError(ERROR)
            else:
                sha256(row['authorized_keys_sha256'])
            if row['public_ipv6'] is not None:
                v6 = ipaddress.IPv6Address(row['public_ipv6'])
                if str(v6) != row['public_ipv6'] or not v6.is_global or v6.is_multicast:
                    raise ValueError(ERROR)
        for field in ('public_ipv4', 'console_action_ref'):
            if len({h[field] for h in setup['hosts']}) != 4:
                raise ValueError(ERROR)
        egress = setup['controller_egress']
        exact(egress, {'interface', 'source_ipv4', 'source_ipv6'})
        targets6 = [h['public_ipv6'] for h in setup['hosts'] if h['public_ipv6'] is not None]
        if len(set(targets6)) != len(targets6):
            raise ValueError(ERROR)
        if targets6 or egress['source_ipv6'] is not None:
            v6 = ipaddress.IPv6Address(egress['source_ipv6'])
            if str(v6) != egress['source_ipv6'] or not v6.is_global or v6.is_multicast:
                raise ValueError(ERROR)
        address = ipaddress.IPv4Address(egress['source_ipv4'])
        if (str(address) != egress['source_ipv4'] or address.is_unspecified or address.is_multicast
                or address.is_loopback or address.is_link_local
                or type(egress['interface']) is not str
                or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{0,14}', egress['interface'])
                or egress['interface'] in ('lo', render['private_interface'])):
            raise ValueError(ERROR)
        return copy.deepcopy(setup)
    except Exception:
        raise ValueError(ERROR) from None


def auth_record(render, setup, index):
    core, h = render['hosts'][0], render['hosts'][index]
    return {'source_alias': core['alias'], 'target_alias': h['alias'], 'source_ipv4': core['ip'],
            'target_ipv4': h['ip'], 'client_key_sha256': setup['core_key']['public_key_sha256'],
            'host_key_sha256': h['host_key_sha256'], 'machine_id': h['machine_id'], 'boot_id': h['boot_id'],
            'authentication': 'publickey', 'trust': 'pinned'}


def controller_record(host):
    return {'alias': host['alias'], 'ip': host['ip'], 'host_key_sha256': host['host_key_sha256'],
            'authentication': 'ssh', 'trust': 'pinned'}


def validate_host(value, render, setup, index):
    exact(value, {'host', 'private_interface', 'private_ipv4', 'global_ipv6', 'services',
                  'effective_access', 'current_files', 'firewall_ruleset'})
    host = render['hosts'][index]
    if (value['host'] != {k: host[k] for k in HOST_FIELDS}
            or value['private_interface'] != render['private_interface']
            or value['private_ipv4'] != host['ip']
            or value['global_ipv6'] != ([setup['hosts'][index]['public_ipv6']] if setup['hosts'][index]['public_ipv6'] else [])):
        raise ValueError(ERROR)
    exact(value['services'], SERVICES)
    if any(v not in ('inactive', 'absent') for v in value['services'].values()):
        raise ValueError(ERROR)
    expected_files = [{k: f[k] for k in ('path', 'sha256')} |
                      {'uid': 0, 'gid': 0, 'mode': '0600', 'nlink': 1, 'kind': 'regular'} for f in host['files']]
    if plan_digest(value['current_files']) != plan_digest(expected_files):
        raise ValueError(ERROR)
    access = {'role': 'core', 'client_key_sha256': setup['core_key']['public_key_sha256'],
              'known_hosts_sha256': host['files'][1]['sha256']} if index == 0 else {
              'role': 'worker', 'helper_sha256': setup['worker_helper_sha256'],
              'authorized_keys_sha256': setup['hosts'][index]['authorized_keys_sha256']}
    if value['effective_access'] != access:
        raise ValueError(ERROR)
    firewall.validate_ruleset(value['firewall_ruleset'], firewall_action(render, index))


def validate_network_evidence(value, render, now, *, setup=None):
    try:
        setup = validate_setup(setup, render)
        firewall._bounded(value)
        exact(value, {'schema_version', 'operation', 'observed_at', 'render_sha256', 'setup_sha256',
                      'hosts', 'core_worker_ssh', 'controller_private_ssh', 'public_denials'})
        if (type(value['schema_version']) is not int or value['schema_version'] != 1
                or value['operation'] != 'fresh-network-ready-probes'
                or value['render_sha256'] != plan_digest(render) or value['setup_sha256'] != plan_digest(setup)
                or not timedelta(0) <= now - timestamp(value['observed_at']) <= timedelta(minutes=15)):
            raise ValueError(ERROR)
        if type(value['hosts']) is not list or len(value['hosts']) != 4:
            raise ValueError(ERROR)
        for i, row in enumerate(value['hosts']):
            validate_host(row, render, setup, i)
        if value['core_worker_ssh'] != [auth_record(render, setup, i) for i in range(1, 4)]:
            raise ValueError(ERROR)
        if value['controller_private_ssh'] != [controller_record(h) for h in render['hosts']]:
            raise ValueError(ERROR)
        rows = value['public_denials']
        targets = public_targets(render, setup)
        if type(rows) is not list or len(rows) != len(targets):
            raise ValueError(ERROR)
        for row, expected in zip(rows, targets):
            exact(row, set(expected) | {'outcome'})
            if (type(row['port']) is not int or row != {**expected, 'outcome': row['outcome']}
                    or row['outcome'] not in ('refused', 'timed-out')):
                raise ValueError(ERROR)
        return copy.deepcopy(value)
    except Exception:
        raise ValueError(ERROR) from None


def collect_network_evidence(render, host_keys, *, setup=None, transport=None, runner=None, now=None):
    from fresh_network_probe_ssh import collect
    return collect(render, host_keys, setup=setup, transport=transport, runner=runner, now=now)


def public_targets(render, setup):
    return [{'alias': h['alias'], 'ip': setup['hosts'][i]['public_ipv' + str(version)], 'port': port,
             'source_ip': setup['controller_egress']['source_ipv' + str(version)],
             'interface': setup['controller_egress']['interface']}
            for i, h in enumerate(render['hosts']) for version in (4, 6)
            if setup['hosts'][i]['public_ipv' + str(version)] is not None for port in MANAGEMENT_PORTS]
