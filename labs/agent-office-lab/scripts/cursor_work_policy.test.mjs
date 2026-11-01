import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oneCursorTask } from './cursor_work_policy.mjs';
function fixture() {
  const floor = { project: {}, workers: { officeDefault: { provider: 'cursor' }, spawn: (...args) => ({ args }) } };
  oneCursorTask(floor, 'composer-2.5', 'fixed prompt'); return floor;
}
test('only one exact Cursor prompt/model and no follow-up or input', () => {
  const floor=fixture();
  assert.equal(typeof floor.workers.spawn('desk','Lab','other',false,'agent','cursor','composer-2.5'),'string');
  const args=['desk','Lab','fixed prompt',false,'agent','cursor','composer-2.5'];
  assert.deepEqual(floor.workers.spawn(...args),{args});
  assert.equal(typeof floor.workers.spawn(...args),'string');
  for (const method of ['resume','prompt','station','write','drop','rebuild']) assert.equal(typeof floor.workers[method](),'string');
});
test('extra worktrees, repos, models and providers are rejected',()=>{
  const valid=['desk','Lab','fixed prompt',false,'agent','cursor','composer-2.5'];
  for(const [i,v] of [[3,true],[4,'shell'],[5,'grok'],[6,'auto'],[7,'high'],[8,{}],[9,'account'],[10,[{}]]]) {
    const args=[...valid];args[i]=v;assert.equal(typeof fixture().workers.spawn(...args),'string');
  }
});
