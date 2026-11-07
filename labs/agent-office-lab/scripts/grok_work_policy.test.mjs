import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oneGrokTask } from './grok_work_policy.mjs';
function fixture() {
  const floor = { project: {}, workers: { officeDefault: { provider: 'grok' }, spawn: (...args) => ({ args }) } };
  oneGrokTask(floor, 'grok-4.6', 'fixed prompt'); return floor;
}
test('only one exact Grok prompt/model and no follow-up or input', () => {
  const floor=fixture();
  assert.equal(typeof floor.workers.spawn('desk','Lab','other',false,'agent','grok','grok-4.6'),'string');
  const args=['desk','Lab','fixed prompt',false,'agent','grok','grok-4.6'];
  assert.deepEqual(floor.workers.spawn(...args),{args});
  assert.equal(typeof floor.workers.spawn(...args),'string');
  for (const method of ['resume','prompt','station','write','drop','rebuild']) assert.equal(typeof floor.workers[method](),'string');
});
test('extra worktrees, repos, models and providers are rejected',()=>{
  const valid=['desk','Lab','fixed prompt',false,'agent','grok','grok-4.6'];
  for(const [i,v] of [[3,true],[4,'shell'],[5,'cursor'],[6,'auto'],[7,'high'],[8,{}],[9,'account'],[10,[{}]]]) {
    const args=[...valid];args[i]=v;assert.equal(typeof fixture().workers.spawn(...args),'string');
  }
});
