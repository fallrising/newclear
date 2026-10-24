import test from 'node:test';
import assert from 'node:assert/strict';
import { temporaryDirectory, validateIsolation, cleanEnvironment, assertLoopback } from './launch.mjs';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('runtime refuses host networking and invalid origins', () => {
  assert.throws(() => validateIsolation(['lo', 'eth0']), /loopback/);
  assert.throws(() => validateIsolation([]), /loopback/);
  assert.doesNotThrow(() => validateIsolation(['lo']));
  for (const url of ['https://example.com', 'http://localhost:5174', 'http://127.0.0.1.evil:5174', 'http://user:pass@127.0.0.1:5174']) assert.throws(() => assertLoopback(url));
  assert.equal(assertLoopback('http://127.0.0.1:5174'), 'http://127.0.0.1:5174');
});

test('children do not inherit credentials or development environment', () => {
  const env = cleanEnvironment({ PATH: '/bin', HOME: '/private', XAI_API_KEY: 'secret', CLOUDFLARE_API_TOKEN: 'secret', KITH_API_ORIGIN: 'https://prod', npm_config_cache: '/shared' });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, undefined);
  assert.equal(env.XAI_API_KEY, undefined);
  assert.equal(env.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(env.KITH_API_ORIGIN, undefined);
  assert.equal(env.npm_config_cache, '/shared');
});

test('fresh run ownership rejects reusing an existing path', () => {
  const root = mkdtempSync(join(tmpdir(), 'kith-fe-contract-'));
  try {
    const dir = temporaryDirectory(root, 'one');
    assert.equal(dir, join(root, 'one'));
    assert.throws(() => temporaryDirectory(root, 'one'));
    assert.throws(() => temporaryDirectory(root, '../escape'));
    mkdirSync(join(root, 'existing'));
    assert.throws(() => temporaryDirectory(root, 'existing'));
  } finally { rmSync(root, { recursive: true }); }
});

// Run this suite in the same loopback-only namespace as the launcher. The fixture
// deliberately lacks e2e modules, so no worker/provider/browser can be started.
test('CLI releases its owned lock when the first harness import fails', () => {
  validateIsolation();
  const root = mkdtempSync(join(tmpdir(), 'kith-fe-import-'));
  try {
    mkdirSync(join(root, 'web'));
    const review = join(root, 'fe-review'); mkdirSync(review);
    const cli = join(review, 'launch.mjs');
    writeFileSync(cli, readFileSync(new URL('./launch.mjs', import.meta.url)));
    const result = spawnSync(process.execPath, [cli], { encoding: 'utf8', timeout: 10000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/);
    assert.equal(existsSync(join(review, 'runs', '.state', 'launcher.lock')), false, 'failed import must release owned lock');
  } finally { rmSync(root, { recursive: true }); }
});
