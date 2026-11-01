"""Opt-in provenance with actual local child/reaper; synthetic Codex dialect."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from agent_workforce.native import NativeProfile, NativeRunner, NativeError, configuration_digest
from agent_workforce.native_reaping import ReapingProcessSupervisor
from agent_workforce.native_session_source import CodexSessionSource

SID='00000000-0000-4000-8000-000000000001'
TURN='synthetic-turn'


def trace(workspace, *, wrapper=False, failed=False):
    def e(kind,payload):return dict(timestamp='2026-01-01T00:00:00Z',type=kind,payload=payload)
    def event(kind,**kw):return e('event_msg',dict(type=kind,**kw))
    rows=[e('session_meta',dict(id=SID,cwd=workspace,cli_version='0.163.0',originator='codex_exec',source='exec')),
          event('task_started',turn_id=TURN,root_turn_id=TURN),
          e('turn_context',dict(turn_id=TURN,root_turn_id=TURN,cwd=workspace,model='fake-model')),
          event('item_completed',thread_id=SID,turn_id=TURN,item=dict(type='UserMessage',id='u',content=[dict(type='text',text='prompt')]))]
    if wrapper:
        rows += [e('response_item',dict(type='custom_tool_call',call_id='c1',name='exec',input='text({exit_code:0})')),
                 e('response_item',dict(type='custom_tool_call_output',call_id='c1',output=[dict(type='input_text',text='{"exit_code":0}')]))]
    if failed:
        rows += [event('item_completed',thread_id=SID,turn_id=TURN,item=dict(type='CommandExecution',id='cmd',status='completed',exit_code=7))]
    rows += [event('task_complete',turn_id=TURN,root_turn_id=TURN,last_agent_message='result')]
    return b''.join(json.dumps(x).encode()+b'\n' for x in rows)


class SessionIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.leaf=self.root/'sessions';self.leaf.mkdir(mode=0o700)
        binary=str(Path(sys.executable).resolve())
        self.profile=NativeProfile(provider='codex',role='writer',binary=binary,
            binary_sha256=hashlib.sha256(Path(binary).read_bytes()).hexdigest(),
            model='fake-model',harness_version='0.163.0',config_digest=configuration_digest('codex',str(self.root)),
            account_ref='synthetic-account',route_id='route',route_revision=1,profile_revision=1,
            workspace=str(self.root),workspace_binding_key='physical',timeout_seconds=3)
        self.binding=dict(session_binding_key='session',worker_id='worker',job_id='job')
        self.supervisor=ReapingProcessSupervisor(self.root/'processes');self.addCleanup(self.supervisor.close)
        self.runner=NativeRunner(self.root/'journal',supervisor=self.supervisor,
                                 session_source=CodexSessionSource(self.leaf))
        self.session=self.leaf/('rollout-fixture-'+SID+'.jsonl')

    def run_one(self,*,wrapper=False,failed=False,missing=False,file_mode=0o600):
        stdout=b'{"type":"thread.started","thread_id":"'+SID.encode()+b'"}\n'+b'{"type":"item.completed","item":{"type":"agent_message","text":"result"}}\n{"type":"turn.completed"}\n'
        code='import os;from pathlib import Path;'
        if not missing:
            code+=f'p=Path({str(self.session)!r});p.write_bytes({trace(str(self.root),wrapper=wrapper,failed=failed)!r});p.chmod({file_mode});'
        code+=f'os.write(1,{stdout!r})'
        with patch.object(NativeProfile,'command',return_value=[sys.executable,'-c',code]):
            return self.runner.run('operation',self.profile,'prompt',self.binding)

    def test_complete_and_sealed_reopen_without_execution(self):
        first=self.run_one();self.assertEqual(first['status'],'complete');self.assertTrue(first['stopped']);self.assertFalse(first['effects_resolved'])
        self.session.unlink();self.leaf.rmdir()
        reopened=NativeRunner(self.root/'journal',supervisor=self.supervisor)
        with patch.object(self.supervisor,'execute',side_effect=AssertionError('must not execute')):
            self.assertEqual(reopened.inspect('operation'),first)
            self.assertEqual(reopened.run('operation',self.profile,'prompt',self.binding),first)

    def test_opaque_wrapper_downgrades_stdout_complete(self):
        receipt=self.run_one(wrapper=True)
        self.assertEqual(receipt['status'],'unknown')
        self.assertIn('opaque_tool_call',receipt['result']['session']['coverage_gaps'])
        self.assertFalse(receipt['effects_resolved'])

    def test_typed_failure_sticky_and_holds_unresolved(self):
        receipt=self.run_one(wrapper=True,failed=True);self.assertEqual(receipt['status'],'failed')
        self.assertFalse(receipt['effects_resolved'])
        with self.assertRaises(NativeError): self.runner.run('replacement',self.profile,'prompt',self.binding)
        with self.assertRaises(NativeError): self.runner.run('resume',self.profile,'prompt',self.binding,resume_from='operation')

    def test_missing_source_is_unknown_and_never_reexecutes(self):
        receipt=self.run_one(missing=True);self.assertEqual(receipt['status'],'unknown')
        with patch.object(self.supervisor,'execute',side_effect=AssertionError('must not execute')):
            self.assertEqual(self.runner.inspect('operation')['status'],'unknown')

    def test_seal_corruption_never_falls_back_to_stdout(self):
        self.run_one();blob=next((self.root/'journal').glob('session-raw-*.jsonl'));blob.write_bytes(b'bad')
        self.assertEqual(self.runner.inspect('operation')['status'],'unknown')

    def test_deleted_seal_never_recaptures(self):
        self.run_one()
        for pattern in ('session-raw-*','session-seal-*'):
            for p in (self.root/'journal').glob(pattern):p.unlink()
        self.assertEqual(self.runner.inspect('operation')['status'],'unknown')
        self.assertFalse(list((self.root/'journal').glob('session-seal-*')))

    def test_large_baseline_never_overflows_durable_receipt(self):
        for index in range(380):
            (self.leaf / (str(index) + '-' + 'x' * 75)).touch()
        receipt = self.run_one()
        self.assertEqual(receipt['status'], 'unknown')
        self.assertTrue(receipt['stopped'])
        self.assertFalse(receipt['effects_resolved'])
        self.assertEqual(receipt['result']['parse_error'], 'metadata_limit')
        self.assertEqual(self.runner.inspect('operation'), receipt)

    def test_source_intent_precedes_spawn(self):
        original=self.supervisor.execute
        def inspect_before(*args,**kw):
            record=self.runner._read(self.runner._path('operation','operation'))
            self.assertIn('session_source',record['stable']);self.assertNotIn(self.session.name,record['stable']['session_source']['baseline'])
            self.assertEqual(kw['binding']['session_source'],record['stable']['session_source'])
            return original(*args,**kw)
        with patch.object(self.supervisor,'execute',side_effect=inspect_before): self.run_one()

    def test_explicit_private_ancestry_is_bound_before_native_capture(self):
        self.leaf.chmod(0o775)
        self.runner=NativeRunner(self.root/'journal',supervisor=self.supervisor,
            session_source=CodexSessionSource(self.leaf,private_ancestor=True))
        receipt=self.run_one(file_mode=0o664)
        self.assertEqual(receipt['status'],'complete')
        record=self.runner._read(self.runner._path('operation','operation'))
        self.assertEqual(record['stable']['session_source']['access_policy'],'owned-private-ancestor-v1')
        self.assertEqual(NativeRunner(self.root/'journal',supervisor=self.supervisor).inspect('operation'),receipt)

    def test_legacy_operation_is_not_promoted(self):
        self.runner=NativeRunner(self.root/'journal',supervisor=self.supervisor)
        receipt=self.run_one(wrapper=True)
        self.assertEqual(receipt['status'],'complete')
        upgraded=NativeRunner(self.root/'journal',supervisor=self.supervisor,session_source=CodexSessionSource(self.leaf))
        self.assertEqual(upgraded.inspect('operation'),receipt)
        self.assertFalse(list((self.root/'journal').glob('session-seal-*')))

if __name__=='__main__':unittest.main()
