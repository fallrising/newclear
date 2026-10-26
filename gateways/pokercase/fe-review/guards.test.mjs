import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {childEnvironment,claimState,ownedPID,safeJSON,allowedURL,signalCancellation,acquireOwned,cleanupStages} from './guards.mjs';

test('child environment excludes HOME, proxies, provider/CLI/auth/bootstrap inherited settings',()=>{
  const env=childEnvironment('a'.repeat(64),'/state');
  assert.deepEqual(Object.keys(env).sort(),['LANG','THINROUTER_ADMIN_TOKEN','TMPDIR']);
  assert.equal(env.TMPDIR,'/state');assert(!('HOME'in env));
});
test('state refuses missing, occupied/reused, symlink and group-readable roots',async()=>{
  const root=await mkdtemp(join(tmpdir(),'poker-review-test-'));
  try {
    await assert.rejects(claimState(join(root,'missing'),'x'));
    await chmod(root,0o755);await assert.rejects(claimState(root,'x'),/REVIEW_PRIVATE_STATE/);await chmod(root,0o700);
    await writeFile(join(root,'foreign'),'retain');await assert.rejects(claimState(root,'x'),/REVIEW_STATE_NOT_FRESH/);
    await symlink(root,join(root,'link'));await assert.rejects(claimState(join(root,'link'),'x'),/REVIEW_STATE_SYMLINK/);
  } finally {await rm(root,{recursive:true});}
  const empty=await mkdtemp(join(tmpdir(),'poker-owned-test-'));
  try {await claimState(empty,'one');await assert.rejects(claimState(empty,'two'),/REVIEW_STATE_NOT_FRESH/);}finally{await rm(empty,{recursive:true});}
});
test('foreign process objects and private receipt contents are rejected',()=>{
  const child={pid:12345};assert.equal(ownedPID(child,new Set([child])),12345);
  assert.throws(()=>ownedPID({pid:12345},new Set([child])),/REVIEW_FOREIGN_PROCESS/);
  assert.throws(()=>safeJSON({x:'runtime-key-canary'},['runtime-key-canary']),/REVIEW_SECRET_IN_RECEIPT/);
});
test('allowed browser routes reject external/import/provider endpoints and secret query',()=>{
  assert(allowedURL('http://127.0.0.1:20128/admin/connections'));
  for(const url of ['http://foreign/admin','http://127.0.0.1:20128/admin/api/connections/oauth/import','http://127.0.0.1:20128/admin/login?token=canary','http://canary@127.0.0.1:20128/admin'])assert(!allowedURL(url));
});
test('signal cancellation, late acquisition and stalled close retain independent owned cleanup',async()=>{
  for(const signal of ['SIGTERM','SIGINT']) {
    const emitter=new EventEmitter();let cancelled=false;const control=signalCancellation(emitter,()=>{cancelled=true;});
    emitter.emit(signal);await assert.rejects(control.promise,/REVIEW_INTERRUPTED/);assert(cancelled);control.dispose();assert.equal(emitter.listenerCount(signal),0);
  }
  let release,owned;const pending=new Promise(resolve=>{release=resolve;});
  const acquired=acquireOwned(()=>pending,value=>{owned=value;},()=>true);const resource={};release(resource);
  await assert.rejects(acquired,/REVIEW_INTERRUPTED/);assert.equal(owned,resource);
  let stopped=false;const stages=await cleanupStages([['browser',()=>new Promise(()=>{}),10],['service',async()=>{stopped=true;},100]]);
  assert(stopped);assert.deepEqual(stages,[{name:'browser',passed:false},{name:'service',passed:true}]);
});
