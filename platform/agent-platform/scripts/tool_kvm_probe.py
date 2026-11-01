"""Non-destructive UID 2000 guest checks for the opt-in tool KVM acceptance.

Only the SDK terminal may execute GUEST_PROBE. Host unit tests validate the
contract, not isolation. Connection failure to documentation addresses is a
bounded reachability observation; the driver must also verify the node's sealed
deny-all policy. No public API or live credential is used by this probe.
"""

PROOF_PATH = "/home/agentprobe/workspace/tool-isolation-proof.json"
CHECKS = (
    "terminal_uid_gid_2000",
    "no_supplementary_groups",
    "no_capabilities",
    "no_new_privileges",
    "clean_environment",
    "terminal_workspace",
    "control_processes_present",
    "control_environment_unreadable",
    "control_signal_denied",
    "control_directory_unreadable",
    "sdk_state_unreadable",
    "sdk_policy_unreadable",
    "mailbox_unreadable",
    "sdk_policy_write_denied",
    "mailbox_write_denied",
    "helper_write_denied",
    "client_write_denied",
    "launcher_write_denied",
    "attestation_write_denied",
    "socket_parent_protected",
    "socket_metadata_change_denied",
    "relay_missing_key_denied",
    "relay_wrong_key_denied",
    "direct_ipv4_connection_blocked",
    "direct_ipv6_connection_blocked",
)


def validate_proof(value):
    """Return a sanitized copy only when every required observation is true."""
    if (
        type(value) is not dict
        or set(value) != set(CHECKS)
        or any(value[key] is not True for key in CHECKS)
    ):
        raise ValueError("tool_isolation_proof_invalid")
    return value.copy()


GUEST_PROBE = (
    f"PROOF_PATH = {PROOF_PATH!r}\nCHECKS = {CHECKS!r}\n"
    + r"""
import http.client
import json
import os
import socket
import stat
from pathlib import Path

CONTROL = Path('/var/lib/agent-platform/control')
CODE = Path('/opt/agent-platform')
SOCKET = Path('/var/lib/agent-platform/tools/request.sock')


def permission_denied(action):
    try:
        action()
    except PermissionError:
        return True
    except OSError:
        return False
    return False


def open_only(path, flags):
    # Never create, truncate or write: unexpected permission must not corrupt a VM.
    descriptor = os.open(path, flags | os.O_NOFOLLOW | os.O_NONBLOCK)
    os.close(descriptor)


def relay_denied(key):
    connection = http.client.HTTPConnection('127.0.0.1', 18081, timeout=2)
    try:
        headers = {} if key is None else {'X-Session-API-Key': key}
        connection.request('GET', '/mailbox', headers=headers)
        response = connection.getresponse()
        body = response.read(256)
        return response.status == 401 and json.loads(body) == {
            'error': 'tool_authentication_required'
        }
    except (OSError, ValueError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def connection_blocked(family, address):
    with socket.socket(family, socket.SOCK_STREAM) as connection:
        connection.settimeout(1)
        try:
            connection.connect(address)
        except OSError:
            return True
    return False


def main():
    checks = dict.fromkeys(CHECKS, False)
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines())
    checks['terminal_uid_gid_2000'] = (
        os.getresuid() == (2000,) * 3 and os.getresgid() == (2000,) * 3
    )
    checks['no_supplementary_groups'] = os.getgroups() == []
    checks['no_capabilities'] = all(int(status[name], 16) == 0
                                  for name in ('CapInh', 'CapPrm', 'CapEff', 'CapAmb'))
    checks['no_new_privileges'] = status['NoNewPrivs'].strip() == '1'
    checks['clean_environment'] = not any(
        name.startswith(('SESSION_API', 'OH_', 'MODEL_', 'TOOL_', 'GITHUB_', 'GH_TOKEN'))
        for name in os.environ
    )
    checks['terminal_workspace'] = os.getcwd() == '/home/agentprobe/workspace'
    controls = {}
    markers = {b'/usr/local/bin/openhands-agent-server', b'/opt/agent-platform/guest_tool.py'}
    found = set()
    for path in Path('/proc').glob('[0-9]*'):
        try:
            arguments = set((path / 'cmdline').read_bytes().split(bytes([0])))
            matched = arguments & markers
            if matched:
                controls[int(path.name)] = path
                found.update(matched)
        except (FileNotFoundError, PermissionError):
            pass
    checks['control_processes_present'] = found == markers and len(controls) >= 2
    checks['control_environment_unreadable'] = bool(controls) and all(
        permission_denied(lambda path=path: open_only(path / 'environ', os.O_RDONLY))
        for path in controls.values()
    )
    checks['control_signal_denied'] = bool(controls) and all(
        permission_denied(lambda pid=pid: os.kill(pid, 0)) for pid in controls
    )
    for name, path in (
        ('control_directory', CONTROL),
        ('sdk_state', CONTROL / 'state'),
        ('sdk_policy', CONTROL / 'state/config.json'),
        ('mailbox', CONTROL / 'tool-mailbox.json'),
    ):
        checks[name + '_unreadable'] = permission_denied(
            lambda path=path: open_only(path, os.O_RDONLY)
        )
    for name, path in (
        ('sdk_policy', CONTROL / 'state/config.json'),
        ('mailbox', CONTROL / 'tool-mailbox.json'),
        ('helper', CODE / 'guest_tool.py'),
        ('client', CODE / 'guest_tool_client.py'),
        ('launcher', CODE / 'terminal'),
        ('attestation', CODE / 'guest_control.py'),
    ):
        checks[name + '_write_denied'] = permission_denied(
            lambda path=path: open_only(path, os.O_WRONLY)
        )
    directory = SOCKET.parent.stat()
    checks['socket_parent_protected'] = (
        directory.st_uid == 2001 and directory.st_gid == 2001
        and stat.S_IMODE(directory.st_mode) == 0o755
        and not os.access(SOCKET.parent, os.W_OK, effective_ids=True)
    )
    socket_info = SOCKET.lstat()
    checks['socket_metadata_change_denied'] = (
        stat.S_ISSOCK(socket_info.st_mode) and socket_info.st_uid == 2001
        and permission_denied(lambda: os.chmod(SOCKET, stat.S_IMODE(socket_info.st_mode)))
    )
    checks['relay_missing_key_denied'] = relay_denied(None)
    checks['relay_wrong_key_denied'] = relay_denied('tool-kvm-public-wrong-key')
    checks['direct_ipv4_connection_blocked'] = connection_blocked(
        socket.AF_INET, ('198.51.100.1', 443)
    )
    checks['direct_ipv6_connection_blocked'] = connection_blocked(
        socket.AF_INET6, ('2001:db8::1', 443, 0, 0)
    )
    Path(PROOF_PATH).write_text(json.dumps(checks, sort_keys=True) + '\n')
    # The workspace file contains only boolean observations; stdout is also secret-free.
    print(json.dumps(checks, sort_keys=True))


if __name__ == '__main__':
    main()
"""
)
GUEST = GUEST_PROBE
