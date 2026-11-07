import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grokStartupOnly } from './grok_office_policy.mjs';
function fixture() {
  const floor = { project: {}, workers: { officeDefault: { provider: 'grok' }, spawn: (...args) => ({ args }) } };
  grokStartupOnly(floor); return floor;
}
test('one prompt-free Grok worker; invalid attempts do not consume it', () => {
  const floor = fixture();
  assert.equal(typeof floor.workers.spawn('desk-1', 'Lab', 'run task'), 'string');
  assert.deepEqual(floor.project.agentProviders, ['grok']);
  assert.equal(floor.workers.spawn('desk-1', 'Lab').args[5], 'grok');
  assert.equal(typeof floor.workers.spawn('desk-2', 'Lab'), 'string');
});
test('startup rejects model, worktree, shell, account and other providers', () => {
  const valid = ['desk-1', 'Lab', undefined, false, 'agent', 'grok'];
  for (const [index, value] of [[3, true], [4, 'shell'], [5, 'pi'], [6, 'model'], [7, 'high'], [8, {}], [9, 'account'], [10, [{}]], [11, 'herald']]) {
    const args = [...valid]; args[index] = value;
    assert.equal(typeof fixture().workers.spawn(...args), 'string');
  }
  const floor = fixture(); floor.workers.officeDefault.provider = 'pi';
  assert.equal(typeof floor.workers.spawn('desk-1', 'Lab'), 'string');
});
test('terminal input and all continuation entry points are blocked', () => {
  const floor = fixture();
  for (const method of ['write', 'prompt', 'resume', 'station', 'drop', 'rebuild']) {
    assert.equal(typeof floor.workers[method]('id', 'input'), 'string');
  }
  assert.equal(floor.workers.wakeAll(), undefined);
});
