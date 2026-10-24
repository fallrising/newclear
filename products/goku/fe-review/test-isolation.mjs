import assert from 'node:assert/strict';
import {mkdtemp, mkdir, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {claimState, requireOrigin} from './isolation.mjs';

const scratch = await mkdtemp(join(tmpdir(), 'goku-review-guards-'));
try {
  assert.equal(requireOrigin('http://127.0.0.1:5173', 5173), 'http://127.0.0.1:5173');
  for (const value of ['http://0.0.0.0:5173', 'http://localhost:5173', 'http://example.com:5173', 'http://127.0.0.1:3001', 'http://user@127.0.0.1:5173']) {
    assert.throws(() => requireOrigin(value, 5173));
  }
  const state = join(scratch, 'state');
  await claimState(state, 'first');
  await assert.rejects(claimState(state, 'second'), /existing state rejected/);
  await symlink(state, join(scratch, 'link'));
  await assert.rejects(claimState(join(scratch, 'link'), 'third'));
  await mkdir(join(scratch, 'public'), {mode: 0o755});
  await assert.rejects(claimState(join(scratch, 'public'), 'fourth'), /state must be private/);
  console.log(JSON.stringify({passed: 9, cases: 'valid origin; five invalid origins; existing state; symlink; non-private state'}));
} finally {
  await rm(scratch, {recursive: true});
}
