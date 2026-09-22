"""Use real HTTP and subprocess streams; replace only the SSH transport locally."""
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from canaries import HTTPGuards, PROBE


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(503 if self.server.fail else 200)
        self.end_headers()
        self.wfile.write(b'Welcome to nginx!')
    def log_message(self, *args): pass


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = self.enterContext(tempfile.TemporaryDirectory())
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.fail = False
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        url = f'http://127.0.0.1:{self.server.server_port}/'
        self.targets = [{'alias': f'ckc-disposable-0{i}', 'id': f'fixture-{i}', 'url': url} for i in [2, 3]]
        real_popen = subprocess.Popen
        self.enterContext(patch('canaries.subprocess.Popen', side_effect=lambda argv, **kwargs:
            real_popen([sys.executable, '-u', '-c', PROBE] if argv[0] == 'ssh' else argv, **kwargs)))
        self.enterContext(redirect_stdout(io.StringIO()))

    def test_continuous_real_http_is_recorded_and_children_exit(self):
        guard = HTTPGuards(self.temp, 'guard-1', self.targets)
        with guard:
            guard.check()
        self.assertTrue(all(p.poll() is not None for p in guard.processes))
        self.assertEqual(guard.summary['failures'], [])
        self.assertTrue(all(row['samples'] >= 2 for row in guard.summary['hosts'].values()))
        saved = json.loads((guard.directory / 'summary.json').read_text())
        self.assertEqual(saved, guard.summary)

    def test_transient_http_failure_is_retained_even_after_recovery(self):
        guard = HTTPGuards(self.temp, 'guard-1', self.targets)
        with guard:
            self.server.fail = True
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and not guard.failures:time.sleep(.05)
            self.server.fail = False
            with self.assertRaisesRegex(ValueError, 'HTTP failure'):guard.check()
        self.assertTrue(guard.summary['failures'])

    def test_dead_or_stale_observer_cannot_look_healthy(self):
        guard = HTTPGuards(self.temp, 'guard-1', self.targets)
        with guard:
            with guard.lock:
                for rows in guard.samples.values(): rows[-1]['received_monotonic'] -= 10
            with self.assertRaisesRegex(ValueError, 'stale'):guard.check()

    def test_startup_readiness_precedes_the_no_failure_guard_window(self):
        from canaries import warmup
        from types import SimpleNamespace
        self.server.fail = True
        timer = threading.Timer(.5, lambda: setattr(self.server, 'fail', False))
        timer.start();self.addCleanup(timer.cancel)
        def command(alias, argv):
            return subprocess.run(argv, capture_output=True, text=True, check=True, timeout=35).stdout
        warmup(SimpleNamespace(command=command), self.targets)
        guard = HTTPGuards(self.temp, 'guard-ready', self.targets)
        with guard: guard.check()
        self.assertFalse(guard.summary['failures'])
