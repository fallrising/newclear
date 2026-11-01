#!/usr/bin/env python3
"""Grok native hooks: explicit deny, bounded file task and allowlisted evidence.
Native Grok hook crashes/timeouts fail open; this is not a provider spending cap.
"""
import fcntl
import json
import os
from pathlib import Path
import re
import sys
import time
from cursor_task_hook import safe_path
from grok_native_evidence import selected_model

MODEL = 'grok-4.6'
PROMPT = 'Read input.json using read_file. Read result.json, then use search_replace to replace its empty JSON object with exactly the input marker and sum as {"marker":"...","total":25}. Use only these two files and read_file/search_replace, at most four tool calls and one edit. No shell, web, subagents or other files. Then briefly confirm completion.'
EVENTS = ['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionDenied','Stop','StopFailure','StopCancelled','SubagentStart']


def task_prompt(multiplier=1):
    if type(multiplier) is not int or multiplier not in (1,2):raise ValueError('invalid_budget')
    return PROMPT if multiplier==1 else PROMPT.replace('at most four tool calls','at most eight tool calls')


def evaluate(event, payload, state, workspace, plan, now):
    if event not in EVENTS or not isinstance(payload, dict): raise ValueError('invalid_event')
    multiplier=plan.get('budget_multiplier',1)
    expected_prompt=task_prompt(multiplier)
    payload=dict(payload)
    for camel, aliases in {'sessionId':['session_id'],'modelId':['model_id','model'],'toolName':['tool_name'],'toolUseId':['tool_use_id'],'toolInput':['tool_input'],'toolResult':['tool_response'],'toolInputTruncated':['tool_input_truncated'],'toolResultTruncated':['tool_result_truncated'],'stopHookActive':['stop_hook_active']}.items():
        values=[payload[k] for k in [camel,*aliases] if k in payload]
        if values and any(v!=values[0] for v in values):raise ValueError('conflicting_aliases')
        if values:payload[camel]=values[0]
    session = payload.get('sessionId')
    valid = (isinstance(session,str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}',session) is not None and
             session == plan['session'] and now < plan['deadline'] and not state.get('failed') and
             not any(payload.get(k) for k in ['subagentType','subagentId','agent_id','isBackgrounded']))
    record = {'event':event, 'session':session if valid else None}
    reply = {}
    if plan.get('cleanup') and event in ['Stop','StopCancelled','StopFailure']:
        return {'continue':False}, {'event':event,'cleanup_event':True}
    if event == 'SessionStart':
        valid = valid and ('modelId' not in payload or payload['modelId']==MODEL)
        if valid:state['started']=True
        record['model_field_present']='modelId' in payload
    elif event == 'UserPromptSubmit':
        valid = valid and plan['allow_remote'] and state.get('started') and plan.get('native_model') == MODEL and not state.get('prompts') and payload.get('prompt') == expected_prompt
        if valid: state['prompts'] = 1
        reply = {} if valid else {'decision':'block','reason':'Lab task boundary'}
    elif event == 'PreToolUse':
        tool = payload.get('toolName'); params = payload.get('toolInput'); tool_id=payload.get('toolUseId')
        target='other';path_field='missing'
        if isinstance(params,dict):
            fields=[k for k in ['target_file','file_path','path'] if k in params]
            path_field=fields[0] if len(fields)==1 else 'ambiguous' if fields else 'missing'
            if len(fields)==1:
                for name in ['input.json','result.json']:
                    if safe_path(params[fields[0]],workspace,name,True):target=name
        pending=state.get('pending',{})
        valid = valid and plan['allow_remote'] and state.get('prompts')==1 and plan.get('native_model')==MODEL and isinstance(tool_id,str) and 0<len(tool_id)<=160 and tool_id not in state.get('tool_ids',[]) and not payload.get('toolInputTruncated') and len(state.get('calls',[]))<4*multiplier
        done=state.get('completed',[]);calls=state.get('calls',[])
        if tool=='read_file':
            # Independent fixture reads may share one native tool batch and finish in either order.
            valid = valid and target!='other' and not any(v['tool']=='search_replace' for v in pending.values())
            count=calls.count('read_file:'+target)
            valid = valid and (multiplier==2 or count==0 or (target=='result.json' and count==1 and 'search_replace:result.json' in done))
        elif tool=='search_replace':
            new=params.get('new_string') if isinstance(params,dict) else None
            valid = valid and not pending and target=='result.json' and all(x in done for x in ['read_file:input.json','read_file:result.json']) and not state.get('edited') and isinstance(new,str) and len(new.encode())<=4096 and params.get('old_string') in ['{}','{}\n'] and params.get('replace_all',False) is False
            if valid: state['edited']=True
        else: valid=False
        if valid:
            state.setdefault('pending',{})[tool_id]={'tool':tool,'target':target}
            state.setdefault('tool_ids',[]).append(tool_id)
            state.setdefault('calls',[]).append(tool+':'+target)
        record['path_field']=path_field
        record.update(tool=tool if tool in ['read_file','search_replace'] else 'other',target=target)
        reply={'decision':'allow' if valid else 'deny','reason':'Lab task boundary'}
    elif event=='PostToolUse':
        tool_id=payload.get('toolUseId')
        pending=state.get('pending',{}).get(tool_id,{})
        valid = valid and bool(pending) and pending.get('tool')==payload.get('toolName') and not payload.get('toolResultTruncated')
        result=payload.get('toolResult')
        expected=('ReadFile','FileContent') if pending.get('tool')=='read_file' else ('SearchReplace','EditsApplied')
        valid = valid and isinstance(result,dict) and result.get('type')==expected[0] and isinstance(result.get(expected[1]),dict)
        record['tool_succeeded']=bool(valid)
        if valid:
            state.setdefault('completed',[]).append(pending['tool']+':'+pending['target']);state['pending'].pop(tool_id)
    elif event=='Stop':
        valid = valid and plan.get('native_model')==MODEL and payload.get('reason')=='end_turn' and payload.get('stopHookActive') is False and not payload.get('backgroundTasks') and not payload.get('sessionCrons')
        record['reason_present']='reason' in payload
        record['stop_hook_active_present']='stopHookActive' in payload
        record['reason']='end_turn' if payload.get('reason')=='end_turn' else 'other'
        state['stop']=bool(valid)
        # Never request another model continuation from Stop.
        reply={'continue':False,'stopReason':'Single lab task finished'}
    else:valid=False
    if event in ['UserPromptSubmit','PreToolUse','PostToolUse','Stop']:
        record['model']=MODEL if plan.get('native_model')==MODEL else 'unverified'
    record['allowed']=bool(valid)
    if not valid:state['failed']=True
    return reply,record


def main():
    lab=Path(__file__).resolve().parents[1];out=Path(os.environ['LAB_GROK_WORK_OUT']).resolve(strict=True)
    if not out.is_relative_to(lab/'runs'):raise ValueError('scope')
    body=sys.stdin.buffer.read(131073)
    if len(body)>131072:raise ValueError('oversize')
    plan=json.loads((out/'task-plan.json').read_text());payload=json.loads(body)
    plan['cleanup']=(out/'cleanup-started').is_file()
    plan['native_model']=selected_model(out/'workspace/.agent-office/grok-home/logs/unified.jsonl',plan['session'])
    fd=os.open(out/'boundary-state.json',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'r+') as f:
        fcntl.flock(f,fcntl.LOCK_EX);raw=f.read();state=json.loads(raw) if raw else {}
        reply,record=evaluate(sys.argv[1],payload,state,out/'workspace',plan,time.time())
        f.seek(0);f.truncate();json.dump(state,f);f.flush()
        with (out/'task-events.jsonl').open('a') as log:log.write(json.dumps(record)+'\n')
    print(json.dumps(reply))


if __name__=='__main__':
    try:main()
    except Exception:
        if len(sys.argv)>1 and sys.argv[1]=='Stop':print('{"continue":false}')
        else:
            print('{"decision":"deny"}')
            sys.exit(2)
