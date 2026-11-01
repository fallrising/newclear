import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommand } from '../tools/browser_explore.mjs';

test('explorer accepts only visible UI operations and bounded inputs', () => {
  for (const command of [{op:'observe'}, {op:'click',id:0}, {op:'type',id:1,text:'旅人'}, {op:'select',id:2,option:1}, {op:'switch',actor:1}, {op:'scroll',dy:500}, {op:'finish'}]) assert.deepEqual(validateCommand(command),command);
});
test('explorer rejects script, URL, state and invalid input injection', () => {
  for (const command of [null, [], {op:'evaluate',expression:'fetch()'}, {op:'navigate',url:'/api/state'}, {op:'click',id:-1}, {op:'click',id:true}, {op:'click',id:1,script:'evil'}, {op:'type',id:1,text:'x'.repeat(101)}, {op:'select',id:1,option:1.1}, {op:'switch',actor:2}, {op:'scroll',dy:5000}, {op:'observe',token:'anything'}]) assert.throws(()=>validateCommand(command));
});
