"""Build the locked, worker-only install payload shared by deploy and reimage flows."""
import ipaddress
import json
import re


WORKERS = {
    "ckc-disposable-02": ("worker-2", 2),
    "ckc-disposable-03": ("worker-3", 3),
    "ckc-disposable-04": ("worker-4", 4),
}
WORKER_REPOSITORIES = {"projecteru2/agent", "containernetworking/plugins"}


def _entry(path, content, mode=0o644):
    return {"path": path, "content": content, "mode": mode}


def _tailnet_ipv4(value, label):
    if not isinstance(value, str):
        raise ValueError(label + " must be a Tailscale IPv4 address")
    try:
        address = ipaddress.ip_address(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(label + " must be a Tailscale IPv4 address") from exc
    if address.version != 4 or address not in ipaddress.ip_network("100.64.0.0/10"):
        raise ValueError(label + " must be a Tailscale IPv4 address")
    return str(address)


def build_worker_payload(host, core_ip, lock):
    """Create one worker's scoped files and locked artifact mappings; no I/O occurs."""
    if not isinstance(host, dict) or host.get("alias") not in WORKERS:
        raise ValueError("worker payload requires a reviewed ckc-disposable worker alias")
    node, index = WORKERS[host["alias"]]
    if host.get("node") != node or type(host.get("index")) is not int or host["index"] != index:
        raise ValueError("worker alias, node and index identity do not match")
    worker_ip = _tailnet_ipv4(host.get("ip"), "worker address")
    core_ip = _tailnet_ipv4(core_ip, "core address")
    if not isinstance(lock, dict) or lock.get("architecture") != "linux/amd64":
        raise ValueError("worker artifact architecture must be linux/amd64")
    rows = lock.get("artifacts")
    if not isinstance(rows, list):
        raise ValueError("worker artifact lock is malformed")
    selected = [row for row in rows if isinstance(row, dict) and row.get("repository") in WORKER_REPOSITORIES]
    if ({row["repository"] for row in selected} != WORKER_REPOSITORIES
            or len(selected) != len(WORKER_REPOSITORIES)):
        raise ValueError("worker artifact lock must include agent and CNI plugins exactly once")
    if any(not isinstance(row.get("tag"), str) or not row["tag"].strip()
           or not isinstance(row.get("url"), str) or not row["url"].startswith("https://")
           or not isinstance(row.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"])
           for row in selected):
        raise ValueError("worker artifact lock has invalid tag, HTTPS URL, or SHA-256 metadata")

    destinations = {
        "projecteru2/agent": {"eru-agent": "/usr/local/bin/eru-agent"},
        "containernetworking/plugins": {
            name: "/opt/cni/bin/" + name for name in ("bridge", "host-local", "loopback")
        },
    }
    artifacts = [{**row, "files": destinations[row["repository"]]} for row in selected]
    configs = [
        _entry("/usr/local/libexec/eru-ssh-command", '''#!/bin/sh
set -eu
# This forced command is attached only to the source-restricted ERU core key.
# ckc already has NOPASSWD sudo; root SSH remains disabled.
[ -n "${SSH_ORIGINAL_COMMAND:-}" ] || exit 64
case "$SSH_ORIGINAL_COMMAND" in
  internal-sftp) exec sudo -n -- /usr/lib/openssh/sftp-server ;;
  *) exec sudo -n -- /bin/sh -c "$SSH_ORIGINAL_COMMAND" ;;
esac
''', 0o755),
        _entry("/etc/eru/agent.yaml", f'''pid: /run/eru-agent.pid
core: ["{core_ip}:5001"]
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
'''),
    ]
    cni = {"cniVersion": "1.0.0", "name": "eru", "plugins": [
        {"type": "bridge", "bridge": "eru0", "isGateway": True, "ipMasq": True,
         "ipMasqBackend": "nftables", "hairpinMode": True,
         "ipam": {"type": "host-local", "ranges": [[{"subnet": f"10.66.{index}.0/24"}]],
                  "routes": [{"dst": "0.0.0.0/0"}]}}
    ]}
    configs.append(_entry("/etc/cni/net.d/10-eru.conflist", json.dumps(cni, indent=2) + "\n"))
    definitions = {
        "eru-containerd-proxy.socket": '''[Unit]
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
        "eru-containerd-proxy.service": '''[Unit]
Description=ERU containerd Unix socket bridge
After=containerd.service
Requires=containerd.service
[Service]
ExecStart=/usr/lib/systemd/systemd-socket-proxyd /run/containerd/containerd.sock
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
''',
        "eru-agent.service": f'''[Unit]
Description=ERU lab agent
After=network-online.target containerd.service eru-containerd-proxy.socket
Requires=eru-containerd-proxy.socket
[Service]
Environment=ERU_HOSTNAME={node}
ExecStart=/usr/local/bin/eru-agent --config /etc/eru/agent.yaml
Restart=on-failure
RestartSec=5
RestartKillSignal=SIGUSR1
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
''',
    }
    configs.extend(_entry("/etc/systemd/system/" + name, content)
                   for name, content in definitions.items())
    return {
        "alias": host["alias"],
        "ip": worker_ip,
        "node": node,
        "index": index,
        "core_ip": core_ip,
        "role": "worker",
        "artifacts": artifacts,
        "files": configs,
        "start_units": ["eru-containerd-proxy.socket"],
        "verify_units": ["/etc/systemd/system/" + name for name in definitions],
    }
