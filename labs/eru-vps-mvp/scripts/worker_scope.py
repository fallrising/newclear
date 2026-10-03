#!/usr/bin/env python3
"""Read-only ownership audit for a future ERU worker component reinstall.

No stop, unlink, rename, network change or package operation is implemented.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys


def mount_points(root):
    """Include bind mounts, which os.path.ismount can miss on the same device."""
    result = set()
    for line in (Path(root) / 'proc/self/mountinfo').read_text().splitlines():
        target = line.split()[4]
        for escaped, char in [('\\040', ' '), ('\\011', '\t'), ('\\012', '\n'), ('\\134', '\\')]:
            target = target.replace(escaped, char)
        result.add(target)
    return result

OWNER = 'eru-vps-mvp'
REINSTALL_FILES = (
    '/usr/local/bin/eru-agent',
    '/etc/eru/agent.yaml',
    '/etc/cni/net.d/10-eru.conflist',
    '/etc/systemd/system/eru-agent.service',
    '/etc/systemd/system/eru-containerd-proxy.service',
    '/etc/systemd/system/eru-containerd-proxy.socket',
)
SHARED_FILES = (
    '/opt/cni/bin/bridge', '/opt/cni/bin/host-local', '/opt/cni/bin/loopback',
    '/usr/local/libexec/eru-ssh-command',
)
STATE_DIRS = ('/var/lib/eru-agent', '/run/eru/workloads', '/var/lib/cni/networks/eru')
MANIFEST = '/var/lib/eru-mvp/owner.json'
PRESERVE = (
    'OS and installed packages', 'SSH configuration, host keys and authorized_keys',
    'Tailscale identity and connectivity', 'Docker/containerd binaries, services, sockets and data roots',
    'All containerd image caches and snapshots; moby namespace',
    'Shared CNI binaries and the eru0 bridge', 'Core, etcd and resource-plugin metadata',
    'Existing Eru node registration and capacity; re-enable only after verification',
    'Ownership manifest and recovery journal outside cleared directories',
)


def audit(root=Path('/'), owner_uid=0, expected_node=None):
    """Return candidate paths plus blocking findings, without changing any file.

    root/owner_uid are injectable for filesystem tests. Production uses /, uid 0.
    State files may change while agent runs; this is a scope audit, not a snapshot
    backup. The future executor must stop the agent then hash and recheck them.
    """
    root = Path(root)
    mounts = mount_points(root) if root == Path('/') or (root / 'proc/self/mountinfo').exists() else set()
    result = {'profile': 'component-reinstall', 'audit_only': True,
              'files_to_reinstall': [], 'state_to_quarantine': [],
              'preserve': list(PRESERVE), 'blockers': []}

    def checked(name, directory=False, optional=False):
        target = root / name.lstrip('/')
        parts = target.relative_to(root).parts
        current = root
        for part in parts:
            current = current / part
            if current.is_symlink():
                raise ValueError('symlink in cleanup path: ' + name)
            if current.exists() and current != target:
                parent_stat = current.lstat()
                if parent_stat.st_uid != owner_uid or parent_stat.st_mode & 0o022:
                    raise ValueError('unsafe path ancestor ownership/write permissions: ' + name)
            if current == target and current.exists() and (os.path.ismount(current) or name in mounts):
                raise ValueError('mount boundary in cleanup path: ' + name)
        if not target.exists():
            if optional:
                return None
            raise ValueError('missing owned path: ' + name)
        st = target.lstat()
        expected_type = stat.S_ISDIR if directory else stat.S_ISREG
        if not expected_type(st.st_mode) or st.st_uid != owner_uid or st.st_mode & 0o022:
            raise ValueError('unexpected type/ownership/write permissions: ' + name)
        if not directory and st.st_nlink != 1:
            raise ValueError('hard-linked cleanup path: ' + name)
        return target

    try:
        manifest_path = checked(MANIFEST)
        manifest = json.loads(manifest_path.read_text())
        if manifest.get('owner') != OWNER:
            raise ValueError('ownership manifest has a different owner')
        result['manifest_sha256'] = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
        for forbidden in ('/etc/eru/core.yaml', '/var/lib/etcd-eru-mvp'):
            candidate = root / forbidden.lstrip('/')
            if candidate.exists() or candidate.is_symlink():
                raise ValueError('control-plane state present on worker: ' + forbidden)
        files = manifest['files']
        if set(files) != set(REINSTALL_FILES + SHARED_FILES):
            raise ValueError('manifest paths differ from the reviewed worker allowlist')
        result['preserved_owned_files'] = list(SHARED_FILES)
        if expected_node is not None:
            if expected_node not in ('worker-2', 'worker-3', 'worker-4'):
                raise ValueError('unsupported worker identity')
            service = checked('/etc/systemd/system/eru-agent.service').read_text()
            hostname = [line.split('=', 2)[-1] for line in service.splitlines()
                        if line.startswith('Environment=ERU_HOSTNAME=')]
            if hostname != [expected_node]:
                raise ValueError('agent unit worker identity differs from selected target')
            result['node'] = expected_node
        for name in REINSTALL_FILES + SHARED_FILES:
            target = checked(name)
            actual = hashlib.sha256(target.read_bytes()).hexdigest()
            if actual != files[name]:
                raise ValueError('owned file changed outside installer: ' + name)
            if name in REINSTALL_FILES:
                result['files_to_reinstall'].append({'path': name, 'sha256': actual})
        for name in STATE_DIRS:
            directory = checked(name, directory=True, optional=True)
            item = {'path': name, 'exists': directory is not None, 'entries': []}
            if directory is not None:
                for parent, dirs, names in os.walk(directory, followlinks=False):
                    for entry in sorted(dirs + names):
                        child = Path(parent) / entry
                        relative = '/' + str(child.relative_to(root))
                        isdir = entry in dirs
                        checked(relative, directory=isdir)
                        item['entries'].append({'path': relative, 'type': 'directory' if isdir else 'file'})
                        if len(item['entries']) > 1000:
                            raise ValueError('state tree exceeds reviewed 1000-entry bound: ' + name)
                item['entries'].sort(key=lambda entry: entry['path'])
            result['state_to_quarantine'].append(item)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        result['blockers'].append(str(exc))
    result['scope_verified'] = not result['blockers']
    return result


if __name__ == '__main__':
    print(json.dumps(audit(expected_node=sys.argv[1] if len(sys.argv) == 2 else None), indent=2))
