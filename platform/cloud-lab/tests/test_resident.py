"""Resident lifecycle tests: fake time for policy, real processes for OS boundaries."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import test_runner as helpers

r = helpers.r


class ClockStop:
    def __init__(self):
        self.now = 1000
        self.stopped = False
        self.delays = []

    def is_set(self):
        return self.stopped

    def wait(self, seconds):
        self.delays.append(seconds)
        self.now += seconds


class ResidentTests(unittest.TestCase):
    def run_loop(self, outcomes, duration=1000):
        clock = ClockStop()
        events = []
        items = iter(outcomes)
        class Runner:
            def run_once(self):
                item = next(items, 'stop')
                if item == 'stop':
                    clock.stopped = True
                    return False
                if isinstance(item, Exception):
                    raise item
                return item
        code = r.resident_loop(Runner(), clock, stop_at=1000 + duration,
            poll_seconds=30, clock=lambda: clock.now, monotonic=lambda: clock.now,
            emit=lambda **event: events.append(event))
        return code, clock, events

    def test_backoff_caps_and_success_resets(self):
        error = r.RetryableError('secret must not appear')
        code, clock, events = self.run_loop([error] * 4 + [True, error])
        self.assertEqual(code, 0)
        self.assertEqual(clock.delays, [30, 60, 120, 120, 30, 30])
        self.assertNotIn('secret', json.dumps(events))

    def test_fatal_errors_do_not_retry(self):
        for error in (r.AuthenticationError('private'), r.ProtocolError('private'),
                      OSError('private'), r.sqlite3.OperationalError('private')):
            with self.subTest(error=type(error)):
                code, clock, events = self.run_loop([error])
                self.assertEqual(code, 1)
                self.assertEqual(clock.delays, [])
                self.assertEqual(events[-1]['event'], 'fatal')
                self.assertNotIn('private', json.dumps(events))

    def test_expiry_bounds_wait_and_prevents_next_cycle(self):
        code, clock, events = self.run_loop([False, False, AssertionError()], duration=31)
        self.assertEqual((code, clock.delays), (0, [30, 1]))
        self.assertEqual(events[-1]['reason'], 'deadline')

    def test_expired_window_never_calls_runner(self):
        code, clock, events = self.run_loop([AssertionError()], duration=0)
        self.assertEqual((code, clock.delays), (0, []))

    def test_backward_wall_clock_cannot_extend_window(self):
        stop = ClockStop()
        runner = type('Runner', (), {'run_once': lambda self: False})()
        self.assertEqual(r.resident_loop(runner, stop, stop_at=1031, poll_seconds=30,
            clock=lambda: 1000, monotonic=lambda: stop.now, emit=lambda **kw: None), 0)
        self.assertEqual(stop.delays, [30, 1])


class ResidentHttpTests(unittest.TestCase):
    setUp = helpers.HttpTests.setUp
    stop = helpers.HttpTests.stop

    def test_http_status_classification(self):
        for status in (401, 403, 408, 409, 429, 500, 503, 400, 404):
            expected = (r.AuthenticationError if status in (401, 403) else
                        r.RetryableError if status in (408, 409, 429) or status >= 500 else r.ProtocolError)
            self.reply_status = status
            with self.subTest(status=status), self.assertRaises(expected):
                self.client.post('/api/runner/claim', b'{}')


class ProcessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.processes = []
        self.addCleanup(self.reap)

    def reap(self):
        for proc in self.processes:
            if proc.poll() is None:
                proc.kill()
            proc.communicate(timeout=5)

    def spawn(self, args):
        proc = subprocess.Popen([sys.executable, *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.processes.append(proc)
        return proc

    def test_single_instance_release_and_symlink_alias(self):
        journal = self.root / 'journal.sqlite'
        journal.touch()
        alias = self.root / 'alias.sqlite'
        alias.symlink_to(journal)
        with r.InstanceLock(journal):
            proc = self.spawn(['-c', 'import sys;sys.path.insert(0,sys.argv[1]);import runner;'
                'lock=runner.InstanceLock(sys.argv[2]);lock.__enter__()', str(Path(r.__file__).parent), str(alias)])
            _, err = proc.communicate(timeout=5)
            self.assertNotEqual(proc.returncode, 0)
        lock_path = Path(str(journal) + '.lock')
        inode = lock_path.stat().st_ino
        with r.InstanceLock(alias):
            self.assertEqual(lock_path.stat().st_ino, inode)
        self.assertEqual(lock_path.stat().st_mode & 0o777, 0o600)

    def test_lock_symlink_rejected_without_touching_target(self):
        target = self.root / 'target'
        target.write_text('retain')
        journal = self.root / 'journal'
        Path(str(journal) + '.lock').symlink_to(target)
        with self.assertRaises((OSError, r.ProtocolError)):
            with r.InstanceLock(journal):
                self.fail('symlink accepted')
        self.assertEqual(target.read_text(), 'retain')

    def test_sigterm_interrupts_wait_and_releases_lock(self):
        requested = threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"assignment":null,"request_id":"test"}')
                requested.set()
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        config = self.root / 'runner.json'
        config.write_text(json.dumps(dict(base_url=f'http://127.0.0.1:{server.server_port}',
            audience='test', credential_id='test', generation=1, secret_hex='ab' * 32,
            journal_path='journal.sqlite', workspace_id='test',
            resource_ref=dict(resource_id='test', generation=1),
            recipe_ref=dict(recipe_id='node-health', version='1.0.0', digest='sha256:' + 'a' * 64))))
        config.chmod(0o600)
        args = [r.__file__, '--config', str(config), '--allow-loopback-http',
                '--poll-seconds', '60', '--stop-at', r.utc(time.time() + 120)]
        proc = self.spawn(args)
        self.assertTrue(requested.wait(5))
        proc.send_signal(signal.SIGTERM)
        out, err = proc.communicate(timeout=5)
        self.assertEqual(proc.returncode, 0, err)
        self.assertIn('signal', out)
        with r.InstanceLock(self.root / 'journal.sqlite'):
            pass
        once = self.spawn([r.__file__, '--config', str(config), '--allow-loopback-http', '--once'])
        out, err = once.communicate(timeout=5)
        self.assertEqual(once.returncode, 0, err)


if __name__ == '__main__':
    unittest.main()
