import assert from 'node:assert/strict';
import {lstat, mkdir, readdir, writeFile, realpath} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';

export function loopbackOrigin(value, port) {
  const u = new URL(value);
  assert.equal(u.protocol, 'http:');
  assert.equal(u.hostname, '127.0.0.1');
  assert.equal(u.port, String(port));
  assert.equal(u.pathname, '/');
  assert(!u.username && !u.password && !u.search && !u.hash);
  return u.origin;
}
export function requireID(value) {
  assert(Number.isSafeInteger(value) && value > 0, 'REVIEW_RESPONSE_ID');
  return value;
}
export function requirePost(post, handle, content, channel) {
  requireID(post.id);
  assert.equal(post.authorHandle, handle);
  assert.equal(post.content, content);
  assert.equal(post.channel, channel);
  assert(typeof post.timelineEntryId === 'string' && post.timelineEntryId.length > 0);
  return post;
}
export function csrfValue(body) {
  assert.equal(body.headerName, 'X-CSRF-TOKEN');
  assert(typeof body.token === 'string' && body.token.length > 0, 'REVIEW_CSRF');
  return body.token;
}
export function requireRotated(before, after) {
  assert(before && after && before !== after, 'REVIEW_CSRF_NOT_ROTATED');
}
export async function claimState(directory, id) {
  assert(isAbsolute(directory), 'REVIEW_PRIVATE_STATE_REQUIRED');
  await mkdir(directory, {recursive: true, mode: 0o700});
  assert.equal(await realpath(directory), resolve(directory), 'REVIEW_PRIVATE_STATE_SYMLINK');
  const st = await lstat(directory);
  assert(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid() && (st.mode & 0o077) === 0, 'REVIEW_PRIVATE_STATE');
  assert.deepEqual(await readdir(directory), [], 'REVIEW_STATE_NOT_FRESH');
  await writeFile(join(directory, 'owner.json'), JSON.stringify({id}) + '\n', {flag: 'wx', mode: 0o600});
}
export async function cleanupStages(actions) {
  const results = [];
  for (const [name, action] of actions) {
    try {await action(); results.push({name, passed: true});}
    catch {results.push({name, passed: false});}
  }
  return results;
}
export async function acquireOwned(acquire, own, cancelled) {
  const resource = await acquire();
  own(resource);
  assert(!cancelled(), 'REVIEW_INTERRUPTED');
  return resource;
}
export async function boundedOperation(operation, milliseconds) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {timer = setTimeout(() => reject(Error('REVIEW_OPERATION_TIMEOUT')), milliseconds);})]);
  } finally {clearTimeout(timer);}
}
export function category(error) {
  return /^REVIEW_[A-Z_]+$/.test(error?.message ?? '') ? error.message : error?.name === 'TimeoutError' ? 'REVIEW_BROWSER_TIMEOUT' : 'REVIEW_ASSERTION';
}
