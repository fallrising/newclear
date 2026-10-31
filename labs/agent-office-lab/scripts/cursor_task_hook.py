#!/usr/bin/env python3
"""Fail-closed Cursor fixture hook; persist only allowlisted native event fields."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

MODEL = 'composer-2.5'
PROMPT = 'Read input.json with Read. Write result.json with Write containing exactly the input marker and the sum of input values as {"marker": "...", "total": 25}. Use only these two files and these two tools, once each. Do not use shell, search, subagents or other files. Then briefly confirm completion.'
EVENTS = ['sessionStart', 'beforeSubmitPrompt', 'preToolUse', 'postToolUse', 'postToolUseFailure',
          'beforeReadFile', 'beforeShellExecution', 'beforeMCPExecution', 'subagentStart', 'afterAgentResponse', 'stop']


def safe_path(value, workspace, target, exists):
    if not isinstance(value, str) or not value or '\0' in value: return False
    path = Path(value)
    if '..' in path.parts: return False
    if not path.is_absolute(): path = workspace / path
    expected = workspace / target
    if path != expected or path.is_symlink(): return False
    if exists and not path.is_file(): return False
    if path.exists() and not path.is_file(): return False
    return path.resolve() == expected


def evaluate(event, payload, state, workspace, remote, deadline, now):
    result = {}; record = {'event': event}
    if event not in EVENTS or not isinstance(payload, dict): raise ValueError('invalid_event')
    session = payload.get('conversation_id') or payload.get('session_id')
    model = payload.get('model')
    if isinstance(session, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', session): record['session'] = session
    if isinstance(model, str) and re.fullmatch(r'[A-Za-z0-9._-]{1,100}', model): record['model'] = model
    valid = (record.get('session') is not None and model == MODEL and now < deadline and
             not any(payload.get(k) for k in ['subagent_id', 'parent_conversation_id', 'agent_id', 'is_background_agent']))
    if state.get('session') and session != state['session']: valid = False
    if valid: state['session'] = session
    if event == 'beforeSubmitPrompt':
        allowed = valid and remote and not state.get('prompts') and payload.get('prompt') == PROMPT and not payload.get('attachments')
        if allowed: state['prompts'] = 1
        result = {'continue': bool(allowed)}; record['allowed'] = bool(allowed)
    elif event == 'preToolUse':
        tool = payload.get('tool_name'); params = payload.get('tool_input')
        allowed = valid and remote and state.get('prompts') == 1 and not state.get('failed') and isinstance(params, dict)
        target = 'input.json' if tool == 'Read' else 'result.json'
        if allowed:
            paths = [params[k] for k in ['path', 'file_path', 'target_file'] if k in params]
            allowed = tool in ['Read', 'Write'] and len(paths) == 1 and safe_path(paths[0], workspace, target, tool == 'Read')
            allowed = allowed and tool not in state.get('tools', [])
            if tool == 'Write':
                content = [params[k] for k in ['content', 'contents'] if k in params]
                allowed = allowed and state.get('tools') == ['Read'] and len(content) == 1 and isinstance(content[0], str) and len(content[0].encode()) <= 4096
        if allowed: state.setdefault('tools', []).append(tool)
        result = {'permission': 'allow' if allowed else 'deny'}
        record.update(tool=tool if tool in ['Read', 'Write'] else 'other', allowed=bool(allowed))
    elif event in ['beforeReadFile', 'beforeShellExecution', 'beforeMCPExecution', 'subagentStart']:
        result = {'permission': 'deny'}; record['allowed'] = False
    elif event == 'postToolUseFailure':
        state['failed'] = True; record['failed'] = True
    elif event == 'postToolUse':
        tool = payload.get('tool_name'); record['tool'] = tool if tool in ['Read', 'Write'] else 'other'
        if not valid or tool not in state.get('tools', []): state['failed'] = True
        state.setdefault('completed_tools', []).append(record['tool'])
    elif event == 'stop':
        record['status'] = payload.get('status') if payload.get('status') in ['completed', 'aborted', 'error'] else 'unknown'
        record['loop_count'] = payload.get('loop_count') if isinstance(payload.get('loop_count'), int) else None
        state['stop'] = record['status']
        if not valid or record['status'] != 'completed' or record['loop_count'] != 0: state['failed'] = True
    if event in ['stop', 'afterAgentResponse']:
        for key in ['input_tokens', 'output_tokens']:
            value = payload.get(key); record[key] = value if type(value) is int and value >= 0 else None
    if record.get('allowed') is False: state['failed'] = True
    if not valid and event not in ['sessionStart']: state['failed'] = True
    return result, record


def main():
    out = Path(os.environ['LAB_CURSOR_WORK_OUT']).resolve(strict=True)
    lab = Path(__file__).resolve().parents[1]
    if not out.is_relative_to(lab / 'runs'): raise ValueError('invalid_run')
    body = sys.stdin.buffer.read(32769)
    if len(body) > 32768: raise ValueError('oversize_hook')
    payload = json.loads(body); plan = json.loads((out / 'task-plan.json').read_text())
    fd = os.open(out / 'boundary-state.json', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as file:
        fcntl.flock(file, fcntl.LOCK_EX)
        text = file.read(); state = json.loads(text) if text else {}
        result, record = evaluate(sys.argv[1], payload, state, out / 'workspace', plan['allow_remote'], plan['deadline'], time.time())
        file.seek(0); file.truncate(); json.dump(state, file); file.flush()
        with (out / 'task-events.jsonl').open('a') as events: events.write(json.dumps(record) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    try: main()
    except Exception:
        # Cursor treats exit 2 as blocking; never echo hook content or arbitrary exceptions.
        print('{"permission":"deny","continue":false}')
        sys.exit(2)
