#!/usr/bin/env python3
"""Prepare/apply this four-node Debian lab via ckc-disposable SSH aliases.

The plan uses existing Docker containerd, a ckc-only socket proxy, and a
source-restricted core key with sudo forced commands. sshd/sudoers are unchanged.
Plan is default. --apply installs only the named ERU files/services; no resets.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

from labops import ClusterLock, lock_fds

PROJECT = Path(__file__).resolve().parent.parent
ALIASES = [f'ckc-disposable-{i:02d}' for i in range(1, 5)]


def ssh(host, command, stdin=None):
    print(f'[{host}] {command}', flush=True)
    p = subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                        '-o', 'ConnectTimeout=10', '-o', 'PermitLocalCommand=no', host, command],
                       input=stdin, capture_output=True, text=True, timeout=300, pass_fds=lock_fds())
    if p.returncode:
        if p.stdout:
            print(p.stdout, flush=True)
        raise RuntimeError(f'[{host}] exit {p.returncode}: {p.stderr}')
    return p.stdout


def file(path, content, mode=0o644):
    return {'path': path, 'content': content, 'mode': mode}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--core-artifact', help='Preserve the explicitly verified installed core patch')
    args = parser.parse_args()
    preserve_core = None
    if args.core_artifact:
        from patched_reapply import selection
        preserve_core = selection(PROJECT, args.core_artifact)
    os.umask(0o077)
    private = PROJECT / 'private'
    lock = json.loads((PROJECT / 'artifacts.amd64.lock.json').read_text())
    hosts = []
    for i, alias in enumerate(ALIASES, 1):
        records = sorted((private / 'preflight').glob(f'*-disposable-{i:02d}-*.json'))
        if not records:
            raise RuntimeError('missing preflight evidence')
        facts = json.loads(records[-1].read_text())['checks']
        addr = next(ip for ip in facts['tailscale']['TailscaleIPs'] if ':' not in ip)
        hosts.append({'alias': alias, 'ip': addr, 'node': f'worker-{i}', 'index': i})
    core = hosts[0]['ip']
    # Use the already trusted alias host keys, re-keyed by their private address.
    known_hosts = ''
    for host in hosts[1:]:
        trusted = Path.home() / '.ssh/hzd-vps/known_hosts' / host['alias'].removeprefix('ckc-')
        lines = [line.split() for line in trusted.read_text().splitlines() if line and not line.startswith('#')]
        keys = [line for line in lines if len(line) >= 3 and line[1] == 'ssh-ed25519']
        if len(keys) != 1:
            raise RuntimeError('expected one trusted Ed25519 host key')
        verified = json.loads((private / 'verified-host-public-keys.json').read_text())
        observed = verified[host['alias']]
        if f"{keys[0][1]} {keys[0][2]}" not in observed:
            raise RuntimeError('verified host keys do not match the trusted Ed25519 anchor')
        for public_key in observed:
            known_hosts += f"{host['ip']} {public_key}\n"

    plans = []
    for host in hosts:
        is_core = host == hosts[0]
        targets = ({'projecteru2/core': {'eru-core': '/usr/local/bin/eru-core'},
                    'projecteru2/cli': {'eru-cli': '/usr/local/bin/eru-cli'},
                    'projecteru2/resource-extend': {'resource-storage': '/etc/eru/plugins/resource-storage'},
                    'etcd-io/etcd': {x: '/usr/local/bin/' + x for x in ['etcd', 'etcdctl', 'etcdutl']}}
                   if is_core else
                   {'projecteru2/agent': {'eru-agent': '/usr/local/bin/eru-agent'},
                    'containernetworking/plugins': {x: '/opt/cni/bin/' + x for x in ['bridge', 'host-local', 'loopback']}})
        artifacts = [{**a, 'files': targets[a['repository']]} for a in lock['artifacts'] if a['repository'] in targets]
        configs = []
        units = []
        if is_core:
            configs.append(file('/etc/eru/known_hosts', known_hosts, 0o600))
            configs.append(file('/etc/etcd/etcd.conf', '''name: eru-mvp-etcd0
data-dir: /var/lib/etcd-eru-mvp
listen-peer-urls: http://127.0.0.1:2380
listen-client-urls: http://127.0.0.1:2379
initial-advertise-peer-urls: http://127.0.0.1:2380
advertise-client-urls: http://127.0.0.1:2379
initial-cluster: eru-mvp-etcd0=http://127.0.0.1:2380
initial-cluster-token: eru-mvp-debian-g1
initial-cluster-state: new
auto-compaction-retention: "1"
'''))
            configs.append(file('/etc/eru/core.yaml', f'''bind: "{core}:5001"
lock_timeout: 30s
global_timeout: 300s
connection_timeout: 10s
ha_keepalive_interval: 16s
max_concurrency: 100
store: etcd
log:
  level: info
grpc:
  max_concurrent_streams: 100
  max_recv_msg_size: 20971520
  service_discovery_interval: 15s
  service_heartbeat_interval: 15s
etcd:
  machines: ["http://127.0.0.1:2379"]
  prefix: /eru
  lock_prefix: __lock__/eru
ssh:
  private_key: /etc/eru/ssh_key
  known_hosts: /etc/eru/known_hosts
  user: ckc
containerd:
  socket: /run/eru/containerd.sock
  namespace: eru
process:
  root: /var/lib/eru/process
  stop_timeout: 10s
scheduler:
  maxshare: -1
  sharebase: 100
  max_deploy_count: 20
resource_plugin:
  dir: /etc/eru/plugins
  call_timeout: 30s
'''))
            configs.append(file('/etc/eru/plugins/storage.yaml', '''etcd:
  machines: ["http://127.0.0.1:2379"]
  prefix: /eru-storage
scheduler:
  max_deploy_count: 20
'''))
            configs.append(file('/etc/eru/mvp-firewall.nft', f'''add table inet eru_mvp
flush table inet eru_mvp
table inet eru_mvp {{
  chain input {{
    type filter hook input priority -10; policy accept;
    ip daddr {core} tcp dport 5001 ip saddr {{ {', '.join(h['ip'] for h in hosts)} }} accept
    ip daddr {core} tcp dport 5001 drop
  }}
}}
''', 0o600))
            definitions = {
                'eru-mvp-firewall.service': '''[Unit]
Description=ERU lab private API source restriction
After=network-online.target
Before=eru-core.service
[Service]
Type=oneshot
ExecStart=/usr/sbin/nft -f /etc/eru/mvp-firewall.nft
ExecStop=/usr/sbin/nft delete table inet eru_mvp
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
''',
                'eru-etcd.service': '''[Unit]
Description=ERU lab metadata store
After=network-online.target
Wants=network-online.target
[Service]
Type=notify
ExecStart=/usr/local/bin/etcd --config-file /etc/etcd/etcd.conf
Restart=on-failure
LimitNOFILE=40000
[Install]
WantedBy=multi-user.target
''',
                'eru-core.service': '''[Unit]
Description=ERU lab core
After=network-online.target eru-etcd.service eru-mvp-firewall.service
Requires=eru-etcd.service eru-mvp-firewall.service
[Service]
ExecStart=/usr/local/bin/eru-core --config /etc/eru/core.yaml
Restart=on-failure
RestartSec=5
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
'''}
            units = list(definitions)
        else:
            configs.append(file('/usr/local/libexec/eru-ssh-command', '''#!/bin/sh
set -eu
# This forced command is attached only to the source-restricted ERU core key.
# ckc already has NOPASSWD sudo; root SSH remains disabled.
[ -n "${SSH_ORIGINAL_COMMAND:-}" ] || exit 64
case "$SSH_ORIGINAL_COMMAND" in
  internal-sftp) exec sudo -n -- /usr/lib/openssh/sftp-server ;;
  *) exec sudo -n -- /bin/sh -c "$SSH_ORIGINAL_COMMAND" ;;
esac
''', 0o755))
            configs.append(file('/etc/eru/agent.yaml', f'''pid: /run/eru-agent.pid
core: ["{core}:5001"]
store: grpc
heartbeat_interval: 30
runtimes:
  containerd:
    socket: /run/eru/containerd.sock
    namespace: eru
meta_dir: /run/eru/workloads
state_dir: /var/lib/eru-agent
api:
  addr: 127.0.0.1:12345
metrics:
  step: 10
log:
  stdout: false
healthcheck:
  interval: 30
  timeout: 10
  cache_ttl: 300
global_connection_timeout: 15s
'''))
            cni = {'cniVersion': '1.0.0', 'name': 'eru', 'plugins': [
                {'type': 'bridge', 'bridge': 'eru0', 'isGateway': True, 'ipMasq': True,
                 'ipMasqBackend': 'nftables', 'hairpinMode': True,
                 'ipam': {'type': 'host-local', 'ranges': [[{'subnet': f"10.66.{host['index']}.0/24"}]],
                          'routes': [{'dst': '0.0.0.0/0'}]}}]}
            configs.append(file('/etc/cni/net.d/10-eru.conflist', json.dumps(cni, indent=2) + '\n'))
            definitions = {
                'eru-containerd-proxy.socket': '''[Unit]
Description=ERU ckc-only containerd proxy socket
[Socket]
ListenStream=/run/eru/containerd.sock
SocketUser=ckc
SocketGroup=ckc
SocketMode=0600
DirectoryMode=0711
RemoveOnStop=yes
[Install]
WantedBy=sockets.target
''',
                'eru-containerd-proxy.service': '''[Unit]
Description=ERU containerd Unix socket bridge
After=containerd.service
Requires=containerd.service
[Service]
ExecStart=/usr/lib/systemd/systemd-socket-proxyd /run/containerd/containerd.sock
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
''',
                'eru-agent.service': f'''[Unit]
Description=ERU lab agent
After=network-online.target containerd.service eru-containerd-proxy.socket
Requires=eru-containerd-proxy.socket
[Service]
Environment=ERU_HOSTNAME={host['node']}
ExecStart=/usr/local/bin/eru-agent --config /etc/eru/agent.yaml
Restart=on-failure
RestartSec=5
RestartKillSignal=SIGUSR1
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
'''}
            units = ['eru-containerd-proxy.socket']
        configs += [file('/etc/systemd/system/' + name, text) for name, text in definitions.items()]
        plan = {**host, 'core_ip': core, 'role': 'core' if is_core else 'worker', 'artifacts': artifacts,
                'files': configs, 'start_units': units,
                'verify_units': ['/etc/systemd/system/' + name for name in definitions]}
        plans.append(plan)

    (private / 'deployment-plan.json').write_text(json.dumps(plans, indent=2) + '\n')
    print(json.dumps({'plan': str(private / 'deployment-plan.json'), 'hosts': ALIASES,
        'apply': args.apply, 'preserves': ['root SSH prohibition', 'g1ops sudo allowlist', 'Docker/containerd units and socket permissions']}), flush=True)
    if not args.apply:
        return 0
    source = 'import types,sys\n'
    for name in ['labops', 'worker_scope', 'worker_reinstall', 'core_update']:
        code = (PROJECT / 'scripts' / (name + '.py')).read_text()
        source += f'm=types.ModuleType({name!r});sys.modules[{name!r}]=m;exec({code!r},m.__dict__)\n'
    source += (PROJECT / 'scripts/remote_install.py').read_text()
    for plan in plans:
        if plan['role'] == 'core' and preserve_core:
            plan = {**plan, 'preserve_core': preserve_core}
        if plan['role'] == 'worker':
            key = ssh(ALIASES[0], 'sudo -n cat /etc/eru/ssh_key.pub').strip()
            if not key.startswith('ssh-ed25519 ') or '\n' in key:
                raise RuntimeError('invalid core public key')
            plan['authorized_key'] = (f'from="{core}",command="/usr/local/libexec/eru-ssh-command",'
                                     'no-agent-forwarding,no-X11-forwarding,no-pty ' + key)
        output = ssh(plan['alias'], 'sudo -n python3 -', 'CONFIG=' + repr(plan) + '\n' + source)
        (private / f"install-{plan['alias']}.log").write_text(output)
        print(f"[{plan['alias']}] scoped installation complete", flush=True)
        if plan['role'] == 'worker':
            # New namespaces/pod/node records only; never clear existing records.
            commands = f'''set -eu
export ERU={core}:5001
if ! /usr/local/bin/eru-cli node get {plan['node']} >/dev/null 2>&1; then
  /usr/local/bin/eru-cli node add eru --nodename {plan['node']} --endpoint containerd://ckc@{plan['ip']}:22 --cpu 2 --memory 2G --storage 10G --label owner=eru-vps-mvp
fi
/usr/local/bin/eru-cli node get {plan['node']}
'''
            # Pod creation is performed once on core before the first registration.
            if plan == plans[1]:
                podcheck = f'''import subprocess,json
p=subprocess.run(['/usr/local/bin/eru-cli','--eru','{core}:5001','--output','json','pod','list'],capture_output=True,text=True,check=True)
print(p.stdout)
d=json.loads(p.stdout) or []
if not any(x.get('name')=='eru' for x in d):
 subprocess.run(['/usr/local/bin/eru-cli','--eru','{core}:5001','pod','add','eru'],check=True)
'''
                print(ssh(ALIASES[0], 'sudo -n python3 -', podcheck), flush=True)
            print(ssh(ALIASES[0], 'sudo -n sh -s', commands), flush=True)
            print(ssh(plan['alias'], 'sudo -n systemctl enable --now eru-agent.service'), flush=True)
    print('Install and registration completed; run smoke tests separately.', flush=True)
    return 0


if __name__ == '__main__':
    with ClusterLock(PROJECT):
        sys.exit(main())
