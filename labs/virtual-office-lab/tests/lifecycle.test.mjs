import test from 'node:test';
import assert from 'node:assert/strict';
import {run, parse} from '../bin/office-run.mjs';

const command = code => ['codex', '--', process.execPath, '-e', code];
test('explicit command boundary is mandatory', () => {
  for (const args of [[], ['codex', 'echo'], ['../secret', '--', 'echo']]) assert.throws(() => parse(args));
});
test('real successful child reports terminal then done without command text', async () => {
  const calls = [];
  const result = await run(command('process.exit(0)'), process.env, async args => calls.push(args));
  assert.deepEqual(result, {exitCode: 0, reported: true, started: true});
  assert.deepEqual(calls.map(args => args[1]), ['terminal', 'done']);
  assert.ok(!JSON.stringify(calls).includes('process.exit'));
});
test('real failing child preserves exit and reports error', async () => {
  const calls = [];
  const result = await run(command('process.exit(7)'), process.env, async args => calls.push(args));
  assert.equal(result.exitCode, 7);
  assert.deepEqual(calls.map(args => args[1]), ['terminal', 'error']);
});
test('reporter settings are absent from real child environment', async () => {
  const result = await run(command("process.exit(Object.keys(process.env).some(k => k.startsWith('OFFICE_')) ? 1 : 0)"),
    {...process.env, OFFICE_TOKEN: 'test-only', OFFICE_TOKEN_FILE: '/not/a/real/token', OFFICE_AGENT: 'grok'},
    async (args, env) => { assert.equal(env.OFFICE_AGENT, undefined); assert.equal(args[0], 'codex'); });
  assert.equal(result.exitCode, 0);
});
test('initial reporting failure prevents command launch', async () => {
  let launched = false;
  const result = await run(command(''), {}, async () => { throw new Error('private error'); }, async () => { launched = true; });
  assert.equal(launched, false);
  assert.deepEqual(result, {exitCode: 125, reported: false, started: false});
});
test('final reporting failure never returns overall success', async () => {
  let count = 0;
  const result = await run(command('process.exit(0)'), process.env, async () => { if (++count === 2) throw new Error('offline'); });
  assert.deepEqual(result, {exitCode: 125, reported: false, started: true});
});
test('missing executable reports error without exposing spawn details', async () => {
  const states = [];
  const result = await run(['codex', '--', '/nonexistent-office-command'], process.env, async args => states.push(args[1]));
  assert.equal(result.exitCode, 127);
  assert.deepEqual(states, ['terminal', 'error']);
});
