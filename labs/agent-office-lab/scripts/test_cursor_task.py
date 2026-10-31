import json
from pathlib import Path
import tempfile
import unittest
from cursor_task_hook import MODEL, PROMPT, evaluate
from run_cursor_work import credential_path


class CursorTaskBoundary(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve(); self.workspace = self.root / 'workspace'; self.workspace.mkdir()
        (self.workspace / 'input.json').write_text('{"values":[7,11,-2,9]}')
        self.state = {}

    def call(self, event, **payload):
        return evaluate(event, {'conversation_id': 'fixture-session', 'model': MODEL, **payload},
                        self.state, self.workspace, True, 100, 1)

    def start(self):
        self.assertTrue(self.call('beforeSubmitPrompt', prompt=PROMPT)[0]['continue'])

    def test_exact_single_prompt_and_two_tools(self):
        self.start()
        self.assertEqual(self.call('preToolUse', tool_name='Read', tool_input={'path':'input.json'})[0], {'permission':'allow'})
        self.call('postToolUse', tool_name='Read')
        self.assertEqual(self.call('preToolUse', tool_name='Write', tool_input={'path':'result.json','contents':'{}'})[0], {'permission':'allow'})
        self.call('postToolUse', tool_name='Write')
        result, record = self.call('stop', status='completed', loop_count=0, output_tokens=9, user_email='PRIVATE', text='PRIVATE')
        self.assertEqual(result, {}); self.assertNotIn('PRIVATE', json.dumps(record))
        self.assertEqual(self.state['completed_tools'], ['Read','Write'])
        self.assertFalse(self.state.get('failed',False))
        self.assertFalse(self.call('beforeSubmitPrompt', prompt=PROMPT)[0]['continue'])

    def test_wrong_prompt_model_session_children_deadline_and_dry_run_rejected(self):
        for payload in [{'prompt':'different'}, {'prompt':PROMPT,'model':'auto'}, {'prompt':PROMPT,'subagent_id':'child'}, {'prompt':PROMPT,'attachments':[{}]}]:
            self.state={};self.assertFalse(self.call('beforeSubmitPrompt', **payload)[0]['continue'])
        for remote,deadline,now in [(False,100,1),(True,1,1)]:
            r,_=evaluate('beforeSubmitPrompt',{'conversation_id':'id','model':MODEL,'prompt':PROMPT},{},self.workspace,remote,deadline,now)
            self.assertFalse(r['continue'])
        self.state={};self.start()
        self.assertEqual(self.call('preToolUse',conversation_id='other',tool_name='Read',tool_input={'path':'input.json'})[0]['permission'],'deny')

    def test_paths_symlinks_writes_before_reads_and_shell_are_rejected(self):
        for tool,params in [('Read',{'path':'../input.json'}),('Read',{'path':'input.json','file_path':'input.json'}),
                            ('Read',{'path':str(self.root/'secret')}),('Write',{'path':'result.json','content':'{}'}),
                            ('Shell',{'command':'anything'}),('Task',{})]:
            self.state={};self.start()
            self.assertEqual(self.call('preToolUse',tool_name=tool,tool_input=params)[0]['permission'],'deny')
        (self.workspace/'input.json').unlink();(self.workspace/'input.json').symlink_to(self.root/'missing')
        self.state={};self.start()
        self.assertEqual(self.call('preToolUse',tool_name='Read',tool_input={'path':'input.json'})[0]['permission'],'deny')

    def test_duplicate_tool_excess_output_and_context_file_reads_fail(self):
        self.start();self.call('preToolUse',tool_name='Read',tool_input={'path':'input.json'})
        self.assertEqual(self.call('preToolUse',tool_name='Read',tool_input={'path':'input.json'})[0]['permission'],'deny')
        self.state={};self.start();self.call('preToolUse',tool_name='Read',tool_input={'path':'input.json'})
        self.assertEqual(self.call('preToolUse',tool_name='Write',tool_input={'path':'result.json','content':'x'*4097})[0]['permission'],'deny')
        self.assertEqual(self.call('beforeReadFile',file_path=str(self.root/'private'))[0]['permission'],'deny')

    def test_native_stop_errors_are_not_success_and_usage_remains_unknown(self):
        _,record=self.call('stop',status='error',loop_count=0)
        self.assertTrue(self.state['failed']);self.assertIsNone(record['output_tokens'])
        self.state={};self.call('stop',status='completed',loop_count=1)
        self.assertTrue(self.state['failed'])

    def test_credentials_reject_public_permissions_and_symlink_parents(self):
        auth=self.root/'.local/remote/cursor-home/.cursor/auth.json';auth.parent.mkdir(parents=True)
        auth.write_text('{}');auth.chmod(0o600)
        self.assertEqual(credential_path(self.root),auth)
        auth.chmod(0o644)
        with self.assertRaises(ValueError):credential_path(self.root)
        auth.unlink();auth.symlink_to(self.root/'missing')
        with self.assertRaises(ValueError):credential_path(self.root)


if __name__ == '__main__':unittest.main()
