import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localOnly } from './local_office_policy.mjs';

function fixture() {
  const floor = { project: {}, workers: { officeDefault: { provider: 'opencode' }, spawn: (...args) => ({ args }) } };
  localOnly(floor, 'strata/local');
  return floor;
}
test('only the local provider appears on the demo floor', () => {
  assert.deepEqual(fixture().project.agentProviders, ['opencode']);
});
test('native OpenCode arguments including account ownership pass through', () => {
  const args = ['desk-1', 'Lab', 'task', false, 'agent', 'opencode', 'strata/local', undefined, undefined, 'account-id', []];
  assert.deepEqual(fixture().workers.spawn(...args), { args });
});
test('explicit cloud providers and shell workers fail before native spawn', () => {
  for (const provider of ['codex', 'grok', 'pi', 'custom', 'claude']) {
    assert.equal(typeof fixture().workers.spawn('desk-1', 'Lab', '', false, 'agent', provider), 'string');
  }
  assert.equal(typeof fixture().workers.spawn('desk-1', 'Lab', '', false, 'shell'), 'string');
});
test('changing the default provider cannot create a cloud worker', () => {
  const floor = fixture();
  floor.workers.officeDefault.provider = 'codex';
  assert.equal(typeof floor.workers.spawn('desk-1', 'Lab'), 'string');
});
test('other models, worktrees and extra repos are refused', () => {
  const spawn = fixture().workers.spawn;
  assert.equal(typeof spawn('desk-1', 'Lab', '', false, 'agent', 'opencode', 'other/model'), 'string');
  assert.equal(typeof spawn('desk-1', 'Lab', '', true), 'string');
  assert.equal(typeof spawn('desk-1', 'Lab', '', false, 'agent', 'opencode', undefined, undefined, undefined, undefined, [{}]), 'string');
});
