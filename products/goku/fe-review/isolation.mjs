import assert from 'node:assert/strict';
import {mkdir, lstat, readdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';

export function requireOrigin(value, expectedPort) {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, String(expectedPort));
  assert.equal(url.pathname, '/');
  assert(!url.username && !url.password && !url.search && !url.hash);
  return url.origin;
}

export async function claimState(directory, runId) {
  assert(directory && isAbsolute(directory), 'explicit absolute private state required');
  await mkdir(directory, {recursive: true, mode: 0o700});
  const stat = await lstat(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'state must be a directory, not a symlink');
  assert.equal(stat.mode & 0o077, 0, 'state must be private');
  assert.deepEqual(await readdir(directory), [], 'existing state rejected');
  await writeFile(join(directory, 'owner.json'), JSON.stringify({runId}) + '\n', {flag: 'wx', mode: 0o600});
}
