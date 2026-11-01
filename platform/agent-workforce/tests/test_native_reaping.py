"""Real-process stop proof and durable admission regression oracles."""
import hashlib
import json
import os
import subprocess
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from agent_workforce.native_reaping import ReapingProcessSupervisor
from agent_workforce.native_process import ProcessError, ProcessSupervisor


class ReapingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.s = ReapingProcessSupervisor(self.root / 'journal')
        self.addCleanup(self.s.close)

    def run_child(self, code, op='operation', timeout=2, limit=2097152):
        return self.s.execute(op, [sys.executable, '-c', code], str(self.root),
                              binding={'trusted': 'binding'}, timeout_seconds=timeout,
                              max_output_bytes=limit)

    def directory(self, op='operation'):
        return self.root / 'journal' / hashlib.sha256(op.encode()).hexdigest()

    def test_normal_proof_reopen_dedupe(self):
        code = "from pathlib import Path; p=Path('calls'); p.write_text(p.read_text()+'x' if p.exists() else 'x'); print('result')"
        r = self.run_child(code)
        self.assertTrue(r['stopped'])
        self.assertTrue(r['leader_stopped'])
        self.assertEqual(r['exit_code'], 0)
        self.assertFalse(r['effects_resolved'])
        self.assertEqual(Path(r['stdout_path']).read_text(), 'result\n')
        self.assertEqual(r['containment_proof']['protocol'], 'subreaper-v1')
        with ReapingProcessSupervisor(self.root / 'journal') as other:
            self.assertTrue(other.inspect('operation')['stopped'])
            self.assertTrue(other.execute('operation',[sys.executable,'-c',code],str(self.root),binding={'trusted':'binding'},timeout_seconds=2)['stopped'])
        self.assertEqual((self.root/'calls').read_text(),'x')
        with self.assertRaises(ProcessError): self.run_child('pass')

    def test_immediate_detach_and_stdio_close(self):
        r = self.run_child("import os,time; from pathlib import Path; p=os.fork();\nif p==0:\n os.setsid(); Path('descendant').write_text(str(os.getpid())); os.close(1); os.close(2); time.sleep(30)\nelse:\n time.sleep(.05)")
        self.assertTrue(r['stopped'])
        pid=int((self.root/'descendant').read_text())
        self.assertFalse(Path('/proc',str(pid)).exists())

    def test_timeout_and_output_limit(self):
        r=self.run_child('import time; time.sleep(30)', timeout=.1)
        self.assertTrue(r['stopped']); self.assertTrue(r['timed_out'])
        r=self.run_child("import os;\nwhile True: os.write(1,b'x'*8192)",op='flood',limit=1024)
        self.assertTrue(r['stopped']);self.assertTrue(r['output_limited'])
        self.assertLessEqual(Path(r['stdout_path']).stat().st_size+Path(r['stderr_path']).stat().st_size,1024)

    def test_concurrent_stop(self):
        result=[]
        thread=threading.Thread(target=lambda: result.append(self.run_child('import time; time.sleep(30)',timeout=3)))
        thread.start()
        try:
            deadline=time.monotonic()+3
            while time.monotonic()<deadline:
                if (self.directory()/'go.json').exists(): break
                time.sleep(.01)
            with ReapingProcessSupervisor(self.root/'journal') as other:
                r=other.stop('operation')
            self.assertTrue(r['stopped'])
        finally: thread.join(5)
        self.assertFalse(thread.is_alive());self.assertTrue(result[0]['stopped'])

    def test_receipt_gap_before_admission_never_spawns(self):
        self.s._fault=lambda point: (_ for _ in ()).throw(OSError('fault')) if point=='before_go' else None
        with self.assertRaises(ProcessError):self.run_child("from pathlib import Path; Path('forbidden').touch()")
        self.s._fault=None
        self.assertFalse(self.s.inspect('operation')['stopped'])
        self.assertFalse((self.root/'forbidden').exists())
        self.assertFalse(self.run_child("from pathlib import Path; Path('forbidden').touch()")['stopped'])
        self.assertFalse((self.root/'forbidden').exists())

    def test_proof_mismatch_or_missing_fails_closed(self):
        self.run_child('pass')
        p=self.directory()/'closure.json'; original=p.read_text(); proof=json.loads(original);proof['nonce']='0'*32;p.write_text(json.dumps(proof))
        self.assertFalse(self.s.inspect('operation')['stopped'])
        p.write_text(original);self.assertTrue(self.s.inspect('operation')['stopped'])
        p.unlink();self.assertFalse(self.s.inspect('operation')['stopped'])

    def test_payload_stdout_cannot_forge_proof(self):
        r=self.run_child("print('{\"wait_echild\":true,\"stopped\":true}'); import time; time.sleep(30)",timeout=.1)
        self.assertTrue(r['timed_out']);self.assertEqual(r['containment_proof']['reason'],'timeout')

    def test_old_uncontained_operation_not_promoted(self):
        old=ProcessSupervisor(self.root/'legacy')
        self.addCleanup(old.close)
        r=old.execute('old',[sys.executable,'-c','pass'],str(self.root),binding={},timeout_seconds=1)
        self.assertFalse(r['stopped'])
        with ReapingProcessSupervisor(self.root/'legacy') as newer:
            self.assertFalse(newer.inspect('old')['stopped'])
            with self.assertRaises(ProcessError): newer.execute('old',[sys.executable,'-c','pass'],str(self.root),binding={},timeout_seconds=1)

    def test_after_go_fault_reconciles_without_reexecution(self):
        self.s._fault=lambda point: (_ for _ in ()).throw(OSError('fault')) if point=='after_go' else None
        with self.assertRaises(ProcessError): self.run_child('import time; time.sleep(1)')
        self.s._fault=None
        self.assertTrue(self.s.inspect('operation')['stopped'])
        self.assertTrue(self.run_child('import time; time.sleep(1)')['stopped'])

    def test_wrong_ready_identity_cannot_request_stop(self):
        result=[]
        thread=threading.Thread(target=lambda: result.append(self.run_child('import time; time.sleep(.4)',timeout=1)))
        thread.start()
        try:
            deadline=time.monotonic()+2
            p=self.directory()/'helper-ready.json'
            while time.monotonic()<deadline:
                if (self.directory()/'go.json').exists(): break
                time.sleep(.01)
            original=p.read_text(); ready=json.loads(original)
            ready['helper_identity']['start_ticks']+=1;p.write_text(json.dumps(ready))
            self.assertFalse(self.s.stop('operation')['stopped'])
            self.assertFalse((self.directory()/'stop.json').exists())
            p.write_text(original)
        finally: thread.join(4)
        self.assertFalse(thread.is_alive());self.assertTrue(result[0]['stopped'])

    def test_native_bridge_keeps_effects_unknown_after_real_closure(self):
        from agent_workforce.native import NativeProfile, NativeRunner, NativeError, configuration_digest
        binary=str(Path(sys.executable).resolve())
        profile=NativeProfile(provider='codex',binary=binary,
            binary_sha256=hashlib.sha256(Path(binary).read_bytes()).hexdigest(),
            model='synthetic',role='writer',harness_version='fixture',
            config_digest=configuration_digest('codex',str(self.root)),account_ref='account-example',
            route_id='route-example',route_revision=1,profile_revision=1,
            workspace=str(self.root),workspace_binding_key='workspace-example',timeout_seconds=2)
        runner=NativeRunner(self.root/'native',supervisor=self.s)
        binding=dict(worker_id='worker-example',job_id='job-example',session_binding_id='session-example',
                     session_binding_key='session-example',input_revision=1,ac_revision=1)
        events=[{'type':'thread.started','thread_id':'native-example'},
                {'type':'item.completed','item':{'type':'agent_message','text':'fixture result'}},
                {'type':'turn.completed'}]
        code='print('+repr('\n'.join(json.dumps(e) for e in events))+')'
        with patch.object(NativeProfile,'command',return_value=[sys.executable,'-c',code]):
            receipt=runner.run('native-operation',profile,'synthetic',binding)
            self.assertEqual(receipt['status'],'complete')
            self.assertTrue(receipt['stopped']);self.assertFalse(receipt['effects_resolved'])
            self.assertEqual(runner.inspect('native-operation'),receipt)
            with self.assertRaises(NativeError):
                runner.run('replacement',profile,'synthetic',binding)
            self.assertFalse((self.root/'native'/'processes').exists())

    def test_fifo_output_inspection_is_bounded(self):
        self.run_child('pass')
        path=self.directory()/'stdout'; path.unlink(); os.mkfifo(path,0o600)
        code="from agent_workforce.native_reaping import ReapingProcessSupervisor; import sys; s=ReapingProcessSupervisor(sys.argv[1]); print(s.inspect('operation')['stopped'])"
        try:
            checked=subprocess.run([sys.executable,'-c',code,str(self.root/'journal')],capture_output=True,text=True,timeout=1)
        except subprocess.TimeoutExpired:
            self.fail('inspection blocked on non-regular output')
        self.assertEqual(checked.returncode,0,checked.stderr)
        self.assertEqual(checked.stdout.strip(),'False')

    def test_receipt_sync_failure_cannot_prove_durable_stop(self):
        self.run_child('pass')
        with patch('agent_workforce.native_reaping.os.fsync',side_effect=OSError('sync fault')):
            self.assertFalse(self.s.inspect('operation')['stopped'])
        self.assertTrue(self.s.inspect('operation')['stopped'])
