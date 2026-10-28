"""Kernel-backed resident observations; fixtures never touch an installed service."""
import contextlib
import copy
import hashlib
import io
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
from unittest.mock import patch
import test_runner as helpers

r=helpers.r


def write_config(root, base_url='https://lab.example'):
    path=root/'runner.json'
    value=dict(base_url=base_url,audience='test',credential_id='runner-test',generation=1,secret_hex='ab'*32,
        journal_path=str(root/'journal.sqlite'),workspace_id='test',resource_ref={'resource_id':'node','generation':1},
        recipe_ref={'recipe_id':'node-health','version':'1.0.0','digest':'sha256:'+'a'*64})
    path.write_text(json.dumps(value));path.chmod(0o600);return path


class ObservationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.path=write_config(self.root);self.sock=self.root/'resident.sock'

    @contextlib.contextmanager
    def running(self):
        cfg=r.read_inspection_config(self.path);stop=threading.Event()
        with r.InstanceLock(cfg.journal_path) as lock:
            with r.ResidentObservation(self.sock,cfg,lock,time.time()+60,time.monotonic()+60,stop) as server:
                yield server,stop,lock

    def observe(self):return r.observe_resident(self.path,self.sock)

    def test_actual_lock_peer_and_config_produce_redacted_deadline(self):
        with self.running():
            out=self.observe();self.assertEqual(out['source'],'resident_process')
            self.assertFalse(out['deadline_complete']);self.assertLessEqual(r.timestamp(out['runner_stop_at']),r.timestamp(out['configured_stop_at']))
            self.assertEqual(self.sock.stat().st_mode&0o777,0o600)
            for value in [str(self.path),'runner-test','secret_hex','ab'*32,'pid','boot_id','config_sha256']:
                self.assertNotIn(value,json.dumps(out))
            self.assertFalse((self.root/'journal.sqlite').exists())
        self.assertFalse(self.sock.exists())

    def test_config_change_is_not_freshened_from_running_process(self):
        with self.running():
            data=json.loads(self.path.read_text());data['generation']=2;self.path.write_text(json.dumps(data))
            with self.assertRaises((r.ProtocolError,OSError)):self.observe()

    def test_stopped_event_and_expired_window_refused(self):
        with self.running() as (server,stop,lock):
            stop.set()
            with self.assertRaises((r.ProtocolError,OSError)):self.observe()
        cfg=r.read_inspection_config(self.path)
        with r.InstanceLock(cfg.journal_path) as lock,r.ResidentObservation(self.sock,cfg,lock,time.time()-1,time.monotonic()-1,threading.Event()):
            with self.assertRaises((r.ProtocolError,OSError)):self.observe()

    def test_changed_process_identity_challenge_and_lock_are_refused(self):
        with self.running() as (server,stop,lock):
            original=server.snapshot
            for key,value in [('challenge','00'*16),('start_ticks',1),('boot_id','00000000-0000-0000-0000-000000000000'),('pid',os.getpid()+1),('config_sha256','0'*64),('observed_at','2000-01-01T00:00:00Z')]:
                def changed(challenge):
                    result=original(challenge);result[key]=value;return result
                with self.subTest(key=key),patch.object(server,'snapshot',side_effect=changed),self.assertRaises((r.ProtocolError,OSError)):self.observe()
            def bad_lock(challenge):
                result=original(challenge);result['lock']['inode']+=1;return result
            with patch.object(server,'snapshot',side_effect=bad_lock),self.assertRaises((r.ProtocolError,OSError)):self.observe()
            lock.__exit__()
            with self.assertRaises((r.ProtocolError,OSError)):self.observe()

    def test_existing_file_symlink_unsafe_parent_never_overwritten(self):
        self.sock.write_text('retain')
        with self.assertRaises((r.ProtocolError,OSError)):
            with self.running():pass
        self.assertEqual(self.sock.read_text(),'retain');self.sock.unlink()
        self.sock.symlink_to(self.path)
        with self.assertRaises((r.ProtocolError,OSError)):
            with self.running():pass
        self.assertTrue(self.sock.is_symlink());self.sock.unlink();self.root.chmod(0o755)
        with self.assertRaises((r.ProtocolError,OSError)):
            with self.running():pass
        self.root.chmod(0o700)

    def test_shutdown_does_not_unlink_replacement_inode(self):
        with self.running():
            self.sock.unlink();self.sock.write_text('replacement')
        self.assertEqual(self.sock.read_text(),'replacement')

    def test_cli_observation_never_constructs_runner_or_journal(self):
        with self.running(),patch.object(r,'Journal',side_effect=AssertionError('journal')),patch.object(r,'Runner',side_effect=AssertionError('runner')),contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(r.main(['--config',str(self.path),'--observe-resident','--observation-socket',str(self.sock)]),0)
        self.assertEqual(json.loads(out.getvalue())['source'],'resident_process')

    def test_lock_path_replacement_and_midquery_config_drift_refused(self):
        with self.running() as (server,stop,lock):
            original=server.snapshot
            def drift(challenge):
                response=original(challenge)
                value=json.loads(self.path.read_text());value['generation']=2;self.path.write_text(json.dumps(value))
                return response
            with patch.object(server,'snapshot',side_effect=drift),self.assertRaises((r.ProtocolError,OSError)):self.observe()
            write_config(self.root)
            Path(lock.path).rename(self.root/'retained.lock')
            Path(lock.path).touch(mode=0o600)
            with self.assertRaises((r.ProtocolError,OSError)):self.observe()

    def test_private_parent_symlink_refused(self):
        alias=self.root/'alias';alias.symlink_to(self.root,target_is_directory=True)
        with self.running():
            with self.assertRaises((r.ProtocolError,OSError)):r.observe_resident(self.path,alias/'resident.sock')

    def test_slow_or_malformed_request_cannot_block_later_observation(self):
        import socket
        with self.running():
            parent,name=r.private_socket_parent(self.sock)
            try:
                with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as peer:
                    peer.settimeout(1)
                    peer.connect(f'/proc/self/fd/{parent}/{name}')
                    started=time.monotonic();peer.sendall(b'{')
                    self.assertEqual(peer.recv(1),b'');self.assertLess(time.monotonic()-started,.9)
                self.assertEqual(self.observe()['source'],'resident_process')
            finally:os.close(parent)

    def test_response_reader_enforces_total_time_against_trickle(self):
        import socket
        left,right=socket.socketpair();stop=threading.Event()
        def send():
            try:
                while not stop.wait(.03):right.sendall(b' ')
            except OSError:pass
        thread=threading.Thread(target=send);thread.start()
        try:
            started=time.monotonic()
            with self.assertRaises((r.ProtocolError,OSError)):
                r.receive_observation(left,time.monotonic()+.15)
            self.assertLess(time.monotonic()-started,.6)
        finally:stop.set();left.close();right.close();thread.join(1)

    def test_monotonic_remaining_caps_report_after_backward_wall_clock(self):
        with self.running() as (server,stop,lock):
            server.stop_at=time.time()+3600
            server.deadline=time.monotonic()+20
            out=self.observe()
            self.assertLessEqual(r.timestamp(out['runner_stop_at']),int(time.time())+20)
            self.assertGreater(r.timestamp(out['configured_stop_at']),int(time.time())+3000)

    def test_socket_mode_does_not_require_optional_nofollow_chmod(self):
        chmod=os.chmod
        def limited(path,mode,**kwargs):
            if kwargs.get('follow_symlinks') is False:
                raise NotImplementedError('platform does not support nofollow chmod')
            return chmod(path,mode,**kwargs)
        with patch.object(r.os,'chmod',side_effect=limited),self.running():
            self.assertEqual(self.sock.stat().st_mode&0o777,0o600)
            self.assertEqual(self.observe()['source'],'resident_process')

    def test_observation_mode_rejects_conflicting_flags(self):
        with contextlib.redirect_stderr(io.StringIO()):
            for flags in (['--once'],['--authorization-status'],['--stop-at','2030-01-01T00:00:00Z']):
                self.assertEqual(r.main(['--config',str(self.path),'--observe-resident','--observation-socket',str(self.sock),*flags]),1)


class ResidentProcessTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.sock=self.root/'resident.sock';self.calls=0;self.procs=[]
        outer=self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']));outer.calls+=1
                self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers()
                self.wfile.write(b'{"assignment":null,"request_id":"test"}')
            def log_message(self,*args):pass
        self.http=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        threading.Thread(target=self.http.serve_forever,daemon=True).start()
        self.path=write_config(self.root,f'http://127.0.0.1:{self.http.server_port}')
        self.addCleanup(self.cleanup)

    def cleanup(self):
        for proc in self.procs:
            if proc.poll() is None:proc.kill()
            proc.communicate(timeout=3)
        self.http.shutdown();self.http.server_close()

    def spawn(self):
        stop_at=r.utc(time.time()+45)
        proc=subprocess.Popen([sys.executable,r.__file__,'--config',str(self.path),'--allow-loopback-http','--poll-seconds','60','--stop-at',stop_at,'--observation-socket',str(self.sock)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.procs.append(proc)
        until=time.monotonic()+3
        while not self.sock.exists() and proc.poll() is None and time.monotonic()<until:time.sleep(.01)
        self.assertIsNone(proc.poll(),proc.communicate() if proc.poll() is not None else '')
        self.assertTrue(self.sock.exists());return proc,stop_at

    def test_real_resident_sigterm_and_same_journal_restart(self):
        proc,stop_at=self.spawn()
        out=r.observe_resident(self.path,self.sock,True);self.assertEqual(out['configured_stop_at'],stop_at)
        journal=self.root/'journal.sqlite';inode=journal.stat().st_ino
        proc.send_signal(signal.SIGTERM);_,err=proc.communicate(timeout=3);self.assertEqual(proc.returncode,0,err)
        self.assertFalse(self.sock.exists())
        with self.assertRaises((r.ProtocolError,OSError)):r.observe_resident(self.path,self.sock,True)
        second,_=self.spawn();self.assertEqual(journal.stat().st_ino,inode)
        self.assertEqual(r.observe_resident(self.path,self.sock,True)['source'],'resident_process')
        second.send_signal(signal.SIGTERM);second.communicate(timeout=3)

    def test_sigkill_stale_socket_is_not_live_and_not_overwritten(self):
        proc,_=self.spawn();proc.kill();proc.communicate(timeout=3)
        self.assertTrue(self.sock.exists())
        with self.assertRaises((r.ProtocolError,OSError)):r.observe_resident(self.path,self.sock,True)
        st=self.sock.stat()
        # Restart must fail closed instead of deleting a retained crash artifact.
        retry=subprocess.run([sys.executable,r.__file__,'--config',str(self.path),'--allow-loopback-http','--stop-at',r.utc(time.time()+45),'--observation-socket',str(self.sock)],capture_output=True,text=True,timeout=3)
        self.assertEqual(retry.returncode,1);self.assertEqual(self.sock.stat().st_ino,st.st_ino)
