#!/usr/bin/env python3
"""Source-closed crash fixture. Executable mode only blocks on synthetic input."""
import fcntl
import http.server
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import sys
import threading

IMAGE = 'sha256:' + 'a' * 64


def identity(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return {'pid': pid, 'birth': fields[19], 'state': fields[0]}
    except (OSError, IndexError):
        return None


def alive(item):
    now = identity(item['pid'])
    return now is not None and now['birth'] == item['birth'] and now['state'] != 'Z'


def rows(directory):
    path = directory / 'thinrouter.db'
    if not path.is_file() or path.is_symlink():
        raise ValueError('owned_database_missing')
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        return [dict(r) for r in db.execute('SELECT * FROM usage_events ORDER BY id')]


def witness(directory, model):
    selected = [r for r in rows(directory) if r['public_model'] == model and r['finalized_at'] is None]
    if len(selected) != 1:
        raise ValueError('dispatch_without_committed_pending')
    return {k: selected[0][k] for k in ('id', 'request_id', 'attempt_id', 'public_model', 'usage_source')}


def receipt(root, kind, model, **extra):
    record = {'kind': kind, 'model': model, 'process': identity(os.getpid()),
              'pending': witness(root.parent, model), **extra}
    with (root / 'receipts.jsonl').open('a+') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        stream.seek(0)
        record['sequence'] = sum(1 for _ in stream) + 1
        stream.write(json.dumps(record) + '\n'); stream.flush(); os.fsync(stream.fileno())


def read_receipts(root):
    path = root / 'receipts.jsonl'
    if not path.exists():
        return []
    with path.open() as stream:
        fcntl.flock(stream, fcntl.LOCK_SH)
        return [json.loads(line) for line in stream]


def cli_main():
    root = Path(__file__).resolve().parent
    args = sys.argv[1:]
    name = Path(__file__).name
    if name == 'runtime':
        host = '--host=unix:///var/run/docker.sock'
        if len(args) == 4 and args[:3] == [host, 'rm', '-f'] and re.fullmatch(r'thinrouter-cursor-[0-9a-f-]{36}', args[3]):
            return 0  # synthetic runtime cleanup; never invokes Docker
        if args[:2] != [host, 'run']:
            raise ValueError('runtime_command')
        index = args.index(IMAGE)
        entry = args[args.index('--entrypoint') + 1]
        target = root / 'cursor-agent'
        if entry != str(target) or target.is_symlink() or not target.is_file():
            raise ValueError('runtime_entry')
        if not {'--read-only', '--pull=never'}.issubset(args[:index]) or any('type=bind' in x for x in args[:index]):
            raise ValueError('runtime_security')
        for flag, value in (('--network', 'bridge'), ('--user', '1000:1000')):
            if not any(args[i:i+2] == [flag, value] for i in range(index)):
                raise ValueError('runtime_security')
        cli = args[index+1:]
        for flag, value in (('--mode', 'ask'), ('--sandbox', 'disabled'), ('--output-format', 'stream-json')):
            if not any(cli[i:i+2] == [flag, value] for i in range(len(cli))):
                raise ValueError('cli_security')
        if '--stream-partial-output' not in cli or any(x in cli for x in ('--yolo', '--force', '--approve-mcps')):
            raise ValueError('cli_security')
        receipt(root, 'spawn', 'buffered_cursor', provider='cursor')
        os.execve(entry, [entry, *cli], {'PATH': '/usr/bin:/bin', 'HOME': str(root)})
    model = args[args.index('--model') + 1]
    expected = 'buffered_cursor' if name == 'cursor-agent' else 'buffered_claude'
    if model != expected:
        raise ValueError('fixture_model')
    if name == 'cursor-agent':
        if not args[-1] or args[-1].startswith('--'):
            raise ValueError('cursor_prompt_absent')
        receipt(root, 'input', model, provider='cursor', input_basis='validated_prompt_argv')
    elif name == 'claude':
        if '--mcp-config' in args or '--resume' in args:
            raise ValueError('fixture_capability')
        receipt(root, 'spawn', model, provider='claude')
        line = sys.stdin.readline(262145)
        if len(line) > 262144 or json.loads(line).get('type') != 'user':
            raise ValueError('claude_input')
        receipt(root, 'input', model, provider='claude', input_basis='stdin_json_user')
    else:
        raise ValueError('fixture_executable')
    # The durable receipt is the barrier. Never emit a result or a terminal event.
    while True:
        signal.pause()


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_):
        pass

    def setup(self):
        self.request.settimeout(2)
        super().setup()

    def send_error(self, *_):
        self.deny()

    def deny(self):
        with self.server.fixture._lock:
            self.server.fixture.denials += 1
        self.send_response(403); self.send_header('Content-Length', '0')
        self.send_header('Connection', 'close'); self.end_headers(); self.close_connection = True

    def do_GET(self):
        self.deny()

    do_CONNECT = do_GET

    def do_POST(self):
        f = self.server.fixture
        expected = f.base_url + '/chat/completions' if self.server.proxy else '/v1/chat/completions'
        if self.path != expected or self.headers.get('Authorization') != 'Bearer synthetic-crash-key':
            self.deny(); return
        n = int(self.headers.get('Content-Length', '0'))
        if not 0 < n <= 262144:
            self.deny(); return
        body = json.loads(self.rfile.read(n))
        model = body.get('model')
        if model not in ('history', 'buffered_http') or body.get('stream', False) is not False or not body.get('messages'):
            self.deny(); return
        receipt(f.directory / 'fake', 'http_inference', model,
                destination=f.base_url + '/chat/completions', method='POST', auth_valid=True)
        if model == 'history':
            b = json.dumps({'id':'synthetic-history', 'object':'chat.completion', 'model':'history',
                'choices':[{'index':0,'message':{'role':'assistant','content':'synthetic history'},'finish_reason':'stop'}],
                'usage':{'prompt_tokens':5,'completion_tokens':0,'total_tokens':5}}).encode()
            self.send_response(200); self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);self.wfile.flush()
        else:
            # Keep the response unfinished until after the gateway has been killed.
            self.send_response(200);self.send_header('Content-Type','application/json')
            self.send_header('Content-Length','4096');self.end_headers();self.wfile.write(b'{');self.wfile.flush()
            f._stopping.wait(30)
        self.close_connection = True


class Fixture:
    """Reuse only the unchanged owned socket/thread lifecycle, never forwarding."""
    def __init__(self, directory):
        self.directory = directory
        self._stopping = threading.Event(); self._lock = threading.Lock()
        self._servers = []; self._threads = []; self.denials = 0; self.closed = False
        self.base_url = ''; self.proxy_url = ''

    def start(self):
        from offline_fixture import _Server
        for proxy in (False, True):
            server = _Server(self, proxy=proxy);server.RequestHandlerClass = Handler
            self._servers.append(server)
        self.base_url = f'http://127.0.0.1:{self._servers[0].server_port}/v1'
        self.proxy_url = f'http://127.0.0.1:{self._servers[1].server_port}'
        for s in self._servers:
            t = threading.Thread(target=s.serve_forever, kwargs={'poll_interval':.05}, daemon=True)
            t.start();self._threads.append(t)

    def close(self):
        import time
        if self.closed:return
        self._stopping.set();deadline=time.monotonic()+4
        for s in self._servers[:len(self._threads)]:s.shutdown()
        for s in self._servers:s.server_close();s.close_owned_connections(deadline)
        for t in self._threads:t.join(max(0,deadline-time.monotonic()))
        if any(t.is_alive() for t in self._threads):raise ValueError('fixture_thread_cleanup')
        self.closed = True


if __name__ == '__main__':
    try:
        raise SystemExit(cli_main())
    except (ValueError, OSError, IndexError, sqlite3.Error):
        sys.stderr.write('synthetic_fixture_rejected\n');raise SystemExit(2)
