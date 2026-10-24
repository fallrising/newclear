import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {childEnvironment, claimState, ownedPID, safeJSON, allowedURL, signalCancellation, acquireOwned, cleanupStages} from './guards.mjs';

test('child environment cannot inherit config, persistence, credentials, exporters or peers', () => {
  const key = 'a'.repeat(64);
  const previous = process.env.CLARKQ_CONFIG;
  process.env.CLARKQ_CONFIG = '/not-a-review-config';
  try {assert.deepEqual(Object.keys(childEnvironment(key, '/private')).sort(), ['CLARKQ_ADDR','CLARKQ_API_KEY','CLARKQ_REPLICATION_FACTOR','LANG','TMPDIR'].sort());}
  finally {if (previous === undefined) delete process.env.CLARKQ_CONFIG; else process.env.CLARKQ_CONFIG = previous;}
});
test('SIGTERM/SIGINT cancel without throwing from signal callback and detach listeners', async () => {
  for(const signal of ['SIGTERM','SIGINT']) {
    const emitter = new EventEmitter();let cancelled=false;
    const control=signalCancellation(emitter,()=>{cancelled=true;});
    assert.doesNotThrow(()=>emitter.emit(signal));
    await assert.rejects(control.promise,/REVIEW_INTERRUPTED/);
    assert(cancelled);assert.equal(control.signal(),signal);
    control.dispose();assert.equal(emitter.listenerCount(signal),0);
  }
});
test('late acquired resource remains owned even when cancellation preceded acquisition', async () => {
  let release, owned;
  const pending = new Promise(resolve=>{release=resolve;});
  const operation=acquireOwned(()=>pending,resource=>{owned=resource;},()=>true);
  const resource={close(){}};release(resource);
  await assert.rejects(operation,/REVIEW_INTERRUPTED/);assert.equal(owned,resource);
});
test('stalled or rejecting browser close does not suppress service and receipt cleanup', async () => {
  for(const close of [()=>new Promise(()=>{}),()=>Promise.reject(Error('close failed'))]) {
    const called=[];
    const result=await cleanupStages([['browser',close,10],['service',async()=>called.push('service'),100],['receipt',async()=>called.push('receipt'),100]]);
    assert.deepEqual(result,[{name:'browser',passed:false},{name:'service',passed:true},{name:'receipt',passed:true}]);
    assert.deepEqual(called,['service','receipt']);
  }
});
test('state refuses reuse, unknown files and symlink boundary without deleting them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clarkq-review-test-'));
  try {
    await claimState(root, 'test');
    await assert.rejects(claimState(root, 'again'), /REVIEW_STATE_NOT_FRESH/);
    await writeFile(join(root, 'foreign'), 'untouched');
    await symlink(root, join(root, 'link'));
    await assert.rejects(claimState(join(root, 'link'), 'test'), /REVIEW_STATE_SYMLINK/);
  } finally {await rm(root, {recursive:true});}
});
test('cleanup refuses foreign process even when its PID looks valid', () => {
  const owned = {pid:12345};
  assert.equal(ownedPID(owned, new Set([owned])), 12345);
  assert.throws(() => ownedPID({pid:12345}, new Set([owned])), /REVIEW_FOREIGN_PROCESS/);
  assert.throws(() => ownedPID({pid:process.pid}, new Set()), /REVIEW_FOREIGN_PROCESS/);
});
test('receipt refuses secret values and route rejects external, credential and query variants', () => {
  assert.throws(() => safeJSON({note:'private-canary'}, ['private-canary']), /REVIEW_SECRET_IN_RECEIPT/);
  assert.equal(JSON.parse(safeJSON({status:200}, ['private-canary'])).status, 200);
  assert(allowedURL('http://127.0.0.1:8080/api/v1/queue/review?peek=true'));
  for (const url of ['http://foreign/ui/', 'http://x@127.0.0.1:8080/ui/', 'http://127.0.0.1:8080/ui/?key=canary', 'http://127.0.0.1:8080/ui/#canary']) assert(!allowedURL(url));
});
