"""Deterministic staged Profile A networking, without host mutation or admission."""
import hashlib
import ipaddress

from fresh_execution import exact, sha256
from fresh_observation import public_key
from fresh_rebuild import plan_digest

PRIVATE_NETWORKS = tuple(ipaddress.IPv4Network(value) for value in
                         ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10'))
MANAGEMENT_PORTS = (22, 80, 2375, 2376, 2379, 2380, 5001, 12345)


def private_ip(value):
    if type(value) is not str:
        raise ValueError('network access requires an explicit private IPv4')
    address = ipaddress.IPv4Address(value)
    if str(address) != value or not any(address in network for network in PRIVATE_NETWORKS):
        raise ValueError('network access requires a canonical approved private IPv4')
    return value


def _file(path, content):
    return {'path': path, 'mode': '0600', 'content': content,
            'sha256': hashlib.sha256(content.encode()).hexdigest()}


def _firewall(hosts, index, controller, interface):
    target, core = hosts[index]['ip'], hosts[0]['ip']
    rules = ['table inet eru_fresh_access {', '  chain input {',
             '    type filter hook input priority -20; policy accept;',
             '    iifname "lo" accept']
    allow = [(22, [controller] if index == 0 else [controller, core])]
    if index == 0:
        allow.append((5001, [controller] + [host['ip'] for host in hosts]))
    else:
        allow.append((80, [controller, core]))
    for port, sources in allow:
        for source in sources:
            rules.append('    iifname "' + interface + '" ip saddr ' + source
                         + ' ip daddr ' + target + ' tcp dport ' + str(port) + ' accept')
    rules.append('    tcp dport { ' + ', '.join(map(str, MANAGEMENT_PORTS)) + ' } drop')
    return '\n'.join(rules + ['  }', '}', ''])


def render(request, admission_request, replacement_request, receipts, core_client_key_document):
    """Render only after callers have validated all linked admission evidence."""
    exact(request, {'schema_version', 'binding', 'admission_request', 'admission_sha256',
                    'controller_ip', 'private_interface', 'core_client_key'})
    if type(request['schema_version']) is not int or request['schema_version'] != 1:
        raise ValueError('unsupported network access request')
    if plan_digest(request['binding']) != plan_digest(admission_request['binding']):
        raise ValueError('network access admission binding mismatch')
    sha256(request['admission_sha256'])
    interface = request['private_interface']
    if type(interface) is not str or interface not in ('tailscale0', 'wg0'):
        raise ValueError('unsupported network access interface')
    controller = private_ip(request['controller_ip'])
    exact(core_client_key_document, {'public_key'})
    key = core_client_key_document['public_key']
    key_digest = public_key(key)
    hosts = replacement_request['hosts']
    if type(hosts) is not list or len(hosts) != 4 or len(receipts) != 4:
        raise ValueError('network access requires four verified replacement hosts')
    addresses, host_keys = {controller}, set()
    for host in hosts:
        ip = private_ip(host['ip'])
        host_key = public_key(host['public_key'])
        if ip in addresses or host_key in host_keys or host_key == key_digest:
            raise ValueError('network access requires distinct endpoints and client key')
        addresses.add(ip)
        host_keys.add(host_key)
    known_hosts = lambda rows: ''.join(host['ip'] + ' ' + host['public_key'] + '\n' for host in rows)
    result = []
    for index, (host, receipt) in enumerate(zip(hosts, receipts)):
        files = [_file('/etc/eru/fresh-access.nft', _firewall(hosts, index, controller, interface))]
        if index == 0:
            files.append(_file('/etc/eru/known_hosts', known_hosts(hosts[1:])))
        else:
            candidate = ('from="' + hosts[0]['ip'] + '",command="/usr/local/libexec/eru-ssh-command",'
                         'no-agent-forwarding,no-X11-forwarding,no-pty,no-port-forwarding,no-user-rc '
                         + key + '\n')
            files.append(_file('/etc/eru/fresh-core-authorized-key', candidate))
        result.append({'alias': host['alias'], 'node': host['node'], 'ip': host['ip'],
            'machine_id': receipt['replacement']['machine_id'], 'boot_id': receipt['replacement']['boot_id'],
            'host_key_sha256': public_key(host['public_key']), 'files': files})
    return {'profile': 'A', 'private_interface': interface, 'controller_ip': controller,
            'controller_known_hosts': known_hosts(hosts), 'hosts': result}
