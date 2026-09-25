"""Read-only verification of a replacement worker before any bootstrap."""
import ipaddress
import json
from pathlib import Path
import subprocess

from reimage_receipt import verify_local_hostkeys


WORKER_ALIASES = {"ckc-disposable-02", "ckc-disposable-03", "ckc-disposable-04"}
REQUIRED_FACTS = {
    "schema_version", "machine_id", "boot_id", "os_release", "tailscale_ipv4",
    "services", "core_config_present", "etcd_data_present", "eru_agent_binary_present",
    "eru_agent_config_present", "eru_agent_unit_present", "runtime_counts",
    "docker_version", "containerd_version",
}
REMOTE_FACTS = r'''import ipaddress, json, pathlib, shlex, subprocess, sys

def run(argv):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise RuntimeError("required read-only worker command failed")
    return result.stdout.strip()

try:
    def present(name):
        path = pathlib.Path(name)
        return path.exists() or path.is_symlink()

    os_release = {}
    for line in pathlib.Path('/etc/os-release').read_text().splitlines():
        key, sep, value = line.partition('=')
        if sep and key in {'PRETTY_NAME'}:
            parsed = shlex.split(value)
            os_release[key] = parsed[0] if parsed else ''
    addresses = [line.strip() for line in run(['tailscale', 'ip', '-4']).splitlines() if line.strip()]
    if len(addresses) != 1 or ipaddress.ip_address(addresses[0]).version != 4:
        raise RuntimeError('expected one Tailscale IPv4 address')
    services = {}
    for unit in ['ssh.service', 'tailscaled.service', 'docker.service', 'containerd.service']:
        services[unit] = run(['systemctl', 'show', '--property=ActiveState', '--value', unit])
    containers = run(['ctr', '--namespace', 'eru', 'containers', 'list', '-q']).splitlines()
    tasks = run(['ctr', '--namespace', 'eru', 'tasks', 'list', '-q']).splitlines()
    facts = {
        'schema_version': 1,
        'machine_id': pathlib.Path('/etc/machine-id').read_text().strip(),
        'boot_id': pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
        'os_release': os_release.get('PRETTY_NAME', ''),
        'tailscale_ipv4': addresses[0],
        'services': services,
        'core_config_present': present('/etc/eru/core.yaml'),
        'etcd_data_present': present('/var/lib/etcd-eru-mvp'),
        'eru_agent_binary_present': present('/usr/local/bin/eru-agent'),
        'eru_agent_config_present': present('/etc/eru/agent.yaml'),
        'eru_agent_unit_present': (present('/etc/systemd/system/eru-agent.service')
                                   or present('/lib/systemd/system/eru-agent.service')),
        'runtime_counts': {'containers': len(containers), 'tasks': len(tasks)},
        'docker_version': run(['docker', '--version']),
        'containerd_version': run(['containerd', '--version']),
    }
    print(json.dumps(facts, sort_keys=True))
except Exception:
    print(json.dumps({'error': 'replacement worker read-only preflight failed'}))
    sys.exit(1)
'''


def _run(runner, argv, *, input_text=None, timeout=60):
    try:
        result = runner(argv, input=input_text, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError("replacement worker read-only preflight command failed") from exc
    if result.returncode:
        raise ValueError("replacement worker read-only preflight command failed")
    return result.stdout


def _ssh_config(output, alias):
    config = {}
    for line in output.splitlines():
        fields = line.split(None, 1)
        if len(fields) == 2:
            config.setdefault(fields[0].lower(), fields[1].strip())
    if (config.get("user") != "ckc" or not config.get("hostname")
            or config.get("hostname") == alias or config.get("port") != "22"):
        raise ValueError("replacement worker SSH alias configuration is not the reviewed ckc alias")
    return config


def validate_facts(facts, expected):
    if (not isinstance(expected, dict)
            or not isinstance(facts, dict) or set(facts) != REQUIRED_FACTS
            or type(facts.get("schema_version")) is not int or facts["schema_version"] != 1):
        raise ValueError("replacement worker facts do not match the reviewed schema")
    for name in ("machine_id", "boot_id", "os_release"):
        if not isinstance(facts.get(name), str) or not facts[name] or facts[name] != expected.get(name):
            raise ValueError("replacement worker " + name.replace("_", " ") + " differs from the owner receipt")
    if not isinstance(facts["tailscale_ipv4"], str):
        raise ValueError("replacement worker has no valid Tailscale IPv4 address")
    try:
        address = ipaddress.ip_address(facts["tailscale_ipv4"])
    except (TypeError, ValueError) as exc:
        raise ValueError("replacement worker has no valid Tailscale IPv4 address") from exc
    if address.version != 4 or address not in ipaddress.ip_network("100.64.0.0/10"):
        raise ValueError("replacement worker Tailscale address is outside the reviewed tailnet range")
    required_services = {"ssh.service", "tailscaled.service", "docker.service", "containerd.service"}
    if facts["services"] != {name: "active" for name in required_services}:
        raise ValueError("replacement worker SSH, Tailscale, Docker, and containerd must all be active")
    for field in ("core_config_present", "etcd_data_present", "eru_agent_binary_present",
                  "eru_agent_config_present", "eru_agent_unit_present"):
        if facts[field] is not False:
            raise ValueError("replacement worker contains control-plane or ERU agent state: " + field)
    counts = facts["runtime_counts"]
    if (not isinstance(counts, dict) or set(counts) != {"containers", "tasks"}
            or any(type(counts[name]) is not int or counts[name] != 0 for name in counts)):
        raise ValueError("replacement worker ERU runtime must be empty before bootstrap")
    for field in ("docker_version", "containerd_version"):
        if not isinstance(facts[field], str) or not facts[field].strip():
            raise ValueError("replacement worker runtime version is unavailable: " + field)
    return {key: facts[key] for key in sorted(REQUIRED_FACTS)}


def inspect_replacement_host(alias, replacement, known_hosts_dir, *, runner=subprocess.run):
    """Verify an owner-attested worker identity over strict, read-only SSH."""
    if alias not in WORKER_ALIASES:
        raise ValueError("replacement host must use ckc-disposable-02, -03, or -04")
    if not isinstance(replacement, dict):
        raise ValueError("replacement identity must be a validated receipt object")
    trust_check = verify_local_hostkeys(alias, replacement.get("host_key_fingerprints"), known_hosts_dir)
    _ssh_config(_run(runner, ["ssh", "-G", alias]), alias)
    trust_path = str((Path(known_hosts_dir) / alias.removeprefix("ckc-")).resolve())
    argv = [
        "ssh", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
        "-o", "UpdateHostKeys=no", "-o", "UserKnownHostsFile=" + trust_path,
        "-o", "GlobalKnownHostsFile=/dev/null", "-o", "ConnectTimeout=10",
        "-o", "PermitLocalCommand=no", alias, "sudo -n python3 -",
    ]
    raw = _run(runner, argv, input_text=REMOTE_FACTS, timeout=90)
    try:
        facts = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ValueError("replacement worker returned invalid read-only preflight data") from exc
    normalized = validate_facts(facts, replacement)
    normalized["ssh_verified_by_strict_host_key_check"] = True
    normalized["host_key_file_check"] = trust_check
    return normalized
