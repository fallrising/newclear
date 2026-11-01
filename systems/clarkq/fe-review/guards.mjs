import assert from 'node:assert/strict';
import {lstat, realpath, readdir, writeFile} from 'node:fs/promises';
import {isAbsolute, resolve, join} from 'node:path';

export const ORIGIN = 'http://127.0.0.1:8080';
export function childEnvironment(key, directory) {
  assert(/^[a-f0-9]{64}$/.test(key), 'REVIEW_FRESH_KEY');
  return {TMPDIR: directory, LANG: 'C.UTF-8',
    CLARKQ_ADDR: '127.0.0.1:8080', CLARKQ_API_KEY: key, CLARKQ_REPLICATION_FACTOR: '1'};
}
export async function claimState(directory, id) {
  assert(isAbsolute(directory), 'REVIEW_PRIVATE_STATE');
  assert.equal(await realpath(directory), resolve(directory), 'REVIEW_STATE_SYMLINK');
  const st = await lstat(directory);
  assert(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid() && (st.mode & 0o077) === 0, 'REVIEW_PRIVATE_STATE');
  assert((await readdir(directory)).length === 0, 'REVIEW_STATE_NOT_FRESH');
  await writeFile(join(directory, 'owner.json'), JSON.stringify({id}), {flag: 'wx', mode: 0o600});
}
export function ownedPID(child, owned) {
  assert(owned.has(child) && Number.isSafeInteger(child?.pid) && child.pid > 1 && child.pid !== process.pid, 'REVIEW_FOREIGN_PROCESS');
  return child.pid;
}
export function safeJSON(value, secrets) {
  const text = JSON.stringify(value, null, 2) + '\n';
  assert(secrets.every(secret => secret && !text.includes(secret)), 'REVIEW_SECRET_IN_RECEIPT');
  return text;
}
export function allowedURL(value) {
  try {const u = new URL(value); return u.origin === ORIGIN && !u.username && !u.password && !u.hash &&
    (['/ui/', '/health', '/api/v1/queues', '/api/v1/metrics', '/api/v1/cluster', '/favicon.ico'].includes(u.pathname) || /^\/api\/v1\/queue\/[a-zA-Z0-9_-]{1,64}$/.test(u.pathname)) && (!u.search || u.search === '?peek=true');}
  catch {return false;}
}
export async function bounded(operation, milliseconds) {
  let timer;
  try {return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {timer = setTimeout(() => reject(Error('REVIEW_TIMEOUT')), milliseconds);})]);}
  finally {clearTimeout(timer);}
}
export function failureCode(error) {
  return /^REVIEW_[A-Z_]+$/.test(error?.message ?? '') ? error.message : error?.name === 'TimeoutError' ? 'REVIEW_BROWSER_TIMEOUT' : 'REVIEW_ASSERTION';
}
export function signalCancellation(emitter, onCancel) {
  let reject, received = null;
  const promise = new Promise((_,fail)=>{reject=fail;});
  // Observe rejection immediately, including a signal before the caller installs its race.
  promise.catch(()=>{});
  const handlers = ['SIGTERM','SIGINT'].map(signal=>[signal,()=>{
    if(received)return;
    received=signal;onCancel();reject(Error('REVIEW_INTERRUPTED'));
  }]);
  for(const [signal,handler] of handlers)emitter.on(signal,handler);
  return {promise, signal:()=>received, dispose(){for(const [signal,handler] of handlers)emitter.off(signal,handler);}};
}
export async function acquireOwned(acquire, own, cancelled) {
  const resource=await acquire();own(resource);
  assert(!cancelled(),'REVIEW_INTERRUPTED');
  return resource;
}
export async function cleanupStages(actions) {
  const result=[];
  for(const [name,action,timeout] of actions) {
    try {await bounded(action,timeout);result.push({name,passed:true});}
    catch {result.push({name,passed:false});}
  }
  return result;
}
