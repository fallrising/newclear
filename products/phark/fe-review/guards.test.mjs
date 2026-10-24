import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loopbackOrigin, requireID, requirePost, csrfValue, requireRotated, claimState, cleanupStages, category} from './guards.mjs';

test('loopback origin excludes credentials, other origins, ports and URL suffixes', () => {
  assert.equal(loopbackOrigin('http://127.0.0.1:5173', 5173), 'http://127.0.0.1:5173');
  for (const u of ['http://example.com:5173', 'http://0.0.0.0:5173', 'http://127.0.0.1:8080', 'http://u@127.0.0.1:5173', 'http://127.0.0.1:5173/x', 'http://127.0.0.1:5173/?x=1', 'http://127.0.0.1:5173/#x']) assert.throws(() => loopbackOrigin(u, 5173));
});
test('fresh private state rejects repeat and symlink but independent fresh run is accepted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phark-guards-'));
  try {
    await claimState(join(root, 'a'), 'a');
    await assert.rejects(claimState(join(root, 'a'), 'again'));
    await symlink(join(root, 'a'), join(root, 'link'));
    await assert.rejects(claimState(join(root, 'link'), 'link'));
    await claimState(join(root, 'b'), 'b');
  } finally {await rm(root, {recursive: true});}
});
test('CSRF and response identities are actual validated values', () => {
  assert.equal(csrfValue({headerName: 'X-CSRF-TOKEN', token: 'synthetic-a'}), 'synthetic-a');
  assert.throws(() => csrfValue({headerName: 'Cookie', token: 'synthetic-a'}));
  assert.throws(() => requireRotated('same', 'same'));
  requireRotated('before', 'after');
  for (const id of [0, -1, '1', NaN]) assert.throws(() => requireID(id));
  const p = {id: 37, authorHandle: 'review', content: 'synthetic', channel: 'home', timelineEntryId: 'post:37'};
  assert.equal(requirePost(p, 'review', 'synthetic', 'home').id, 37);
  for (const patch of [{authorHandle: 'other'}, {content: 'other'}, {channel: 'ops'}, {id: 0}]) assert.throws(() => requirePost({...p, ...patch}, 'review', 'synthetic', 'home'));
});
test('cleanup continues after rejected close and failure categories redact payloads', async () => {
  let stopped = false;
  const result = await cleanupStages([['browser', async () => {throw Error('private payload');}], ['server', async () => {stopped = true;}] ]);
  assert(stopped); assert.deepEqual(result, [{name: 'browser', passed: false}, {name: 'server', passed: true}]);
  assert.equal(category(Error('private payload')), 'REVIEW_ASSERTION');
});
