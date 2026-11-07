"""Real process crash and lost HTTP response boundaries; local control-plane fixture."""
import copy
import json
from contextlib import closing
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import test_runner as helpers

r = helpers.r
FIXTURE = Path(__file__).parent / 'fixtures/recovery_runner.py'


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.children = []
        self.addCleanup(self.reap)
        self.reports = []
        self.claims = 0
        self.completed = False
        self.drop = None
        self.assignment = helpers.assignment(helpers.config('unused'))
        now = int(time.time())
        c = self.assignment['command']
        c.update(not_before=r.utc(now-1), dispatch_deadline=r.utc(now+60), execution_deadline=r.utc(now+120))
        self.assignment['attempt']['lease_expires_at'] = r.utc(now+15)
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if self.path.endswith('/claim'):
                    owner.claims += 1
                    response = dict(assignment=None if owner.completed else copy.deepcopy(owner.assignment), request_id='claim')
                else:
                    owner.reports.append(body)
                    if owner.drop != 'before':
                        owner.completed = body['owner_outcome'] == 'succeeded'
                    if owner.drop:
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                        return
                    response = dict(command={'command_id':owner.assignment['command_id']}, request_id='report')
                self.send_response(200)
                self.send_header('Content-Type','application/json')
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())
            def log_message(self,*args):
                pass
        self.server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.config = self.root / 'runner.json'
        self.journal = self.root / 'journal.sqlite'
        self.marker = self.root / 'collector.log'
        self.config.write_text(json.dumps(dict(base_url=f'http://127.0.0.1:{self.server.server_port}',
            audience='cloud-lab',credential_id='runner-1',generation=1,secret_hex='ab'*32,
            journal_path=str(self.journal),workspace_id=c['workspace_id'],resource_ref=c['resource_ref'],recipe_ref=c['recipe_ref'])))
        self.config.chmod(0o600)

    def reap(self):
        for p in self.children:
            if p.poll() is None:
                p.kill()
            p.communicate(timeout=5)

    def start(self, block=False):
        p = subprocess.Popen([sys.executable,str(FIXTURE),'--config',str(self.config),
            '--collector-log',str(self.marker),*(['--block-collector'] if block else [])],
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.children.append(p)
        return p

    def finish(self, p, expected=0):
        out, err = p.communicate(timeout=8)
        self.assertEqual(p.returncode,expected,(out,err))

    def snapshot(self):
        with closing(sqlite3.connect(self.journal.as_uri()+'?mode=ro',uri=True)) as db:
            return db.execute('SELECT * FROM executions').fetchall()

    def fence(self):
        self.assignment['attempt'].update(mode='reconcile_only',fence=2,attempt_id='attempt-2',lease_expires_at=r.utc(time.time()+15))

    def test_sigkill_after_started_never_recollects_or_invents_success(self):
        p = self.start(block=True)
        deadline = time.monotonic()+5
        while p.poll() is None and time.monotonic()<deadline:
            if self.marker.exists() and self.marker.read_text() == 'collect\n':
                break
            time.sleep(.01)
        self.assertTrue(self.marker.exists(),'collector barrier not reached')
        self.assertEqual(self.marker.read_text(),'collect\n')
        before = self.snapshot()
        self.assertEqual((before[0][3],before[0][4]),('started',None))
        p.kill()
        self.finish(p,-signal.SIGKILL)
        self.fence()
        self.finish(self.start())
        self.assertEqual(self.snapshot(),before)
        self.assertEqual(self.marker.read_text().splitlines(),['collect'])
        self.assertEqual(self.reports,[dict(command_id=self.assignment['command_id'],attempt_id='attempt-2',fence=2,**r.UNKNOWN)])
        self.assertFalse(self.completed)

    def test_report_lost_before_apply_replays_exact_completion_with_new_fence(self):
        self.drop = 'before'
        self.finish(self.start(),1)
        before = self.snapshot()
        self.assertEqual(before[0][3],'completed')
        self.assertFalse(self.completed)
        first = self.reports[0]
        self.drop = None
        self.fence()
        self.finish(self.start())
        self.assertEqual(self.snapshot(),before)
        self.assertEqual(self.marker.read_text().splitlines(),['collect'])
        self.assertEqual(self.reports[1],dict(first,attempt_id='attempt-2',fence=2))
        self.assertTrue(self.completed)

    def test_ack_lost_after_apply_restart_is_idle_and_does_not_report_again(self):
        self.drop = 'after'
        self.finish(self.start(),1)
        before = self.snapshot()
        self.assertTrue(self.completed)
        self.drop = None
        self.finish(self.start())
        self.assertEqual(self.snapshot(),before)
        self.assertEqual(self.marker.read_text().splitlines(),['collect'])
        self.assertEqual((self.claims,len(self.reports)),(2,1))


if __name__ == '__main__':
    unittest.main()
