"""Fail-closed native Grok arguments and OS isolation for a zero-inference startup."""
import json
from pathlib import Path
import uuid


def native_args(args, workspace, socket):
    expected = ['--no-alt-screen', '--trust', '--leader-socket',
                str(workspace / '.agent-office/grok-leader.sock'), '--session-id']
    if len(args) != 6 or args[:5] != expected:
        raise ValueError('Unexpected native Grok launch')
    if str(uuid.UUID(args[5])) != args[5]:
        raise ValueError('Invalid new session')
    # Trust only this newly generated synthetic workspace. No tool auto-approval.
    return ['--no-alt-screen', '--trust', '--leader-socket', str(socket), '--session-id', args[5],
            '--no-subagents', '--disable-web-search', '--max-turns', '1', '--tools', '',
            '--permission-mode', 'default']


def sandbox_profile(out, socket_dir):
    quote = lambda p: json.dumps(str(p))
    return ('(version 1)(allow default)(deny network*)'
            '(allow network-outbound (remote ip "localhost:*"))'
            '(allow network-inbound network-bind (local ip "localhost:*"))'
            '(allow network* (local unix-socket) (remote unix-socket))'
            '(deny file-write*)'
            f'(allow file-write* (subpath {quote(out)}) (subpath {quote(socket_dir)}))'
            '(allow file-write* (regex #"^/dev/"))'
            '(deny process-exec (literal "/usr/bin/open"))')
