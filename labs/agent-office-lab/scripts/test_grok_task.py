import json
from pathlib import Path
import tempfile
import unittest
from grok_task_hook import MODEL, PROMPT, evaluate

class GrokTaskBoundary(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.workspace=Path(self.tmp.name).resolve();(self.workspace/'input.json').write_text('{}');(self.workspace/'result.json').write_text('{}')
        self.plan={'session':'fixture-session','allow_remote':True,'deadline':100,'native_model':MODEL};self.state={}
    def call(self,event,**payload):
        return evaluate(event,{'sessionId':'fixture-session',**payload},self.state,self.workspace,self.plan,1)
    def start(self):
        self.assertTrue(self.call('SessionStart',modelId=MODEL)[1]['allowed'])
        self.assertTrue(self.call('UserPromptSubmit',prompt=PROMPT)[1]['allowed'])
    def tool(self,name,target,ident,**params):
        reply,record=self.call('PreToolUse',toolName=name,toolUseId=ident,toolInput={'file_path':target,**params})
        self.assertEqual(reply['decision'],'allow')
        self.call('PostToolUse',toolName=name,toolUseId=ident,toolResult={'type':'ReadFile','FileContent':{}} if name=='read_file' else {'type':'SearchReplace','EditsApplied':{}})
        return record
    def test_native_read_read_edit_stop(self):
        self.start();self.tool('read_file','input.json','a');self.tool('read_file','result.json','b')
        self.tool('search_replace','result.json','c',old_string='{}',new_string='{"total":25}')
        response,record=self.call('Stop',reason='end_turn',stopHookActive=False)
        self.assertEqual(response['continue'],False);self.assertTrue(record['allowed']);self.assertFalse(self.state.get('failed',False))
        self.assertEqual(self.state['completed'],self.state['calls'])
    def test_startup_and_extra_prompts_block(self):
        self.plan['allow_remote']=False;self.call('SessionStart',modelId=MODEL)
        self.assertEqual(self.call('UserPromptSubmit',prompt=PROMPT)[0]['decision'],'block')
        self.plan['allow_remote']=True;self.state={};self.start()
        self.assertEqual(self.call('UserPromptSubmit',prompt=PROMPT)[0]['decision'],'block')
    def test_wrong_model_session_deadline_and_subagent_fail(self):
        for payload in [{'modelId':'auto'},{'modelId':MODEL,'sessionId':'other'},{'modelId':MODEL,'subagentType':'child'}]:
            self.state={};self.assertFalse(self.call('SessionStart',**payload)[1]['allowed'])
        self.state={};self.plan['deadline']=1;self.assertFalse(self.call('SessionStart',modelId=MODEL)[1]['allowed'])
    def test_paths_unread_edit_and_other_tools_rejected(self):
        for tool,path in [('read_file','../input.json'),('read_file','secret'),('search_replace','result.json'),('run_terminal_command','input.json')]:
            self.state={};self.start();self.assertEqual(self.call('PreToolUse',toolName=tool,toolUseId='a',toolInput={'file_path':path})[0]['decision'],'deny')
        (self.workspace/'input.json').unlink();(self.workspace/'input.json').symlink_to(self.workspace/'result.json')
        self.state={};self.start();self.assertEqual(self.call('PreToolUse',toolName='read_file',toolUseId='a',toolInput={'file_path':'input.json'})[0]['decision'],'deny')
    def test_budget_and_duplicate_write_and_content_bound(self):
        self.start();self.tool('read_file','input.json','a');self.tool('read_file','result.json','b')
        before=json.loads(json.dumps(self.state))
        self.assertEqual(self.call('PreToolUse',toolName='search_replace',toolUseId='c',toolInput={'file_path':'result.json','old_string':'{}','new_string':'x'*4097})[0]['decision'],'deny')
        self.state=before;self.tool('search_replace','result.json','c',old_string='{}',new_string='{} ')
        after=json.loads(json.dumps(self.state))
        self.assertEqual(self.call('PreToolUse',toolName='search_replace',toolUseId='d',toolInput={'file_path':'result.json','old_string':'{}','new_string':'[]'})[0]['decision'],'deny')
        self.state=after;self.tool('read_file','result.json','d')
        self.assertEqual(self.call('PreToolUse',toolName='read_file',toolUseId='e',toolInput={'file_path':'result.json'})[0]['decision'],'deny')
    def test_failed_cancelled_stop_and_mismatched_completion(self):
        for event,payload in [('StopFailure',{}),('StopCancelled',{}),('Stop',{'reason':'end_turn','stopHookActive':True}),('PostToolUseFailure',{})]:
            self.state={};self.start();self.assertFalse(self.call(event,**payload)[1]['allowed'])
        self.state={};self.start();self.call('PreToolUse',toolName='read_file',toolUseId='a',toolInput={'file_path':'input.json'})
        self.assertFalse(self.call('PostToolUse',toolName='read_file',toolUseId='foreign')[1]['allowed'])
    def test_logical_tool_error_is_not_success(self):
        self.start();self.call('PreToolUse',toolName='read_file',toolUseId='a',toolInput={'file_path':'input.json'})
        self.assertFalse(self.call('PostToolUse',toolName='read_file',toolUseId='a',toolResult={'type':'ReadFile','FileNotFound':'private'})[1]['allowed'])

    def test_native_missing_model_and_aliases_require_log_evidence(self):
        self.assertTrue(self.call('SessionStart')[1]['allowed'])
        self.plan['native_model']=None
        self.assertEqual(self.call('UserPromptSubmit',prompt=PROMPT)[0]['decision'],'block')
        self.state={};self.plan['native_model']=MODEL
        _,record=evaluate('SessionStart',{'session_id':'fixture-session'},self.state,self.workspace,self.plan,1)
        self.assertTrue(record['allowed'])
        with self.assertRaises(ValueError):
            self.call('SessionStart',session_id='foreign')

    def test_model_log_is_session_and_version_scoped(self):
        from grok_native_evidence import selected_model
        log=self.workspace/'native.jsonl'
        rows=[{'ver':'1.0.70','sid':'fixture-session','msg':'model changed','ctx':{'model':MODEL}},
              {'ver':'1.0.70','sid':'foreign','msg':'model changed','ctx':{'model':'other'}}]
        log.write_text(''.join(json.dumps(r)+'\n' for r in rows)+'partial')
        self.assertEqual(selected_model(log,'fixture-session'),MODEL)
        rows.append({'ver':'1.0.70','sid':'fixture-session','msg':'model changed','ctx':{'model':'other'}})
        log.write_text(''.join(json.dumps(r)+'\n' for r in rows))
        self.assertEqual(selected_model(log,'fixture-session'),'other')
        log.unlink();log.symlink_to(self.workspace/'input.json')
        self.assertIsNone(selected_model(log,'fixture-session'))

    def test_cleanup_stop_is_never_task_completion(self):
        self.plan['cleanup']=True
        reply,record=self.call('Stop',reason='end_turn',stopHookActive=False)
        self.assertTrue(record['cleanup_event']);self.assertFalse(reply['continue']);self.assertNotIn('stop',self.state)

    def test_observed_target_file_batch_and_reverse_completion(self):
        self.start()
        for ident,target in [('a','input.json'),('b','result.json')]:
            reply,record=self.call('PreToolUse',toolName='read_file',toolUseId=ident,toolInput={'target_file':target})
            self.assertEqual(reply['decision'],'allow');self.assertEqual(record['path_field'],'target_file')
        for ident in ['b','a']:
            self.assertTrue(self.call('PostToolUse',toolName='read_file',toolUseId=ident,toolResult={'type':'ReadFile','FileContent':{}})[1]['allowed'])
        self.tool('search_replace','result.json','c',old_string='{}',new_string='{"total":25}')
        self.assertFalse(self.state['pending']);self.assertCountEqual(self.state['calls'],self.state['completed'])
        self.assertTrue(self.call('Stop',reason='end_turn',stopHookActive=False)[1]['allowed'])

    def test_ambiguous_paths_duplicate_id_and_edit_during_read_rejected(self):
        for params in [{'target_file':'input.json','file_path':'input.json'}, {'target_file':'../input.json'}]:
            self.state={};self.start()
            self.assertEqual(self.call('PreToolUse',toolName='read_file',toolUseId='a',toolInput=params)[0]['decision'],'deny')
        self.state={};self.start();self.tool('read_file','input.json','a')
        self.assertEqual(self.call('PreToolUse',toolName='read_file',toolUseId='a',toolInput={'target_file':'result.json'})[0]['decision'],'deny')
        self.state={};self.start();self.call('PreToolUse',toolName='read_file',toolUseId='a',toolInput={'target_file':'input.json'})
        self.assertEqual(self.call('PreToolUse',toolName='search_replace',toolUseId='b',toolInput={'file_path':'result.json','old_string':'{}','new_string':'[]'})[0]['decision'],'deny')

    def test_payload_content_and_private_paths_not_logged(self):
        self.start();_,record=self.call('PreToolUse',toolName='other',toolUseId='a',toolInput={'file_path':'/PRIVATE','secret':'PRIVATE'})
        self.assertNotIn('PRIVATE',json.dumps(record))

if __name__=='__main__':unittest.main()
