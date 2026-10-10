import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs, prepare } from './prepare.mjs';

const id = '1'.repeat(32);
const images = { api: `sha256:${'a'.repeat(64)}`, node: `sha256:${'b'.repeat(64)}`, postgres: `sha256:${'c'.repeat(64)}` };
const args = ['--run-id', id, '--api-image', images.api, '--node-image', images.node, '--postgres-image', images.postgres];
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceCommit = 'd'.repeat(40);
const baseImage = `sha256:${'e'.repeat(64)}`;
const jarBytes = 'test-local-bootjar';
const apiBuild = { sourceCommit, jarSha256: sha(jarBytes), baseImage };
const buildLabels = () => ({ 'org.cms.pp1.source-commit': sourceCommit, 'org.cms.pp1.jar-sha256': apiBuild.jarSha256, 'org.cms.pp1.base-image': baseImage });
async function fixture(t, changes = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'pp1-prepare-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const surface of ['front', 'back', 'admin']) {
    const dist = join(cwd, 'apps', `web-${surface}`, 'dist');
    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'index.html'), `<html>${surface}</html>`);
    await writeFile(join(dist, 'assets', 'app.js'), 'const api="https://api.cms.test:8443";');
  }
  await mkdir(join(cwd, 'services/cms-api/build/libs'), { recursive: true });
  await writeFile(join(cwd, 'services/cms-api/build/libs/app.jar'), jarBytes);
  await mkdir(join(cwd, 'scripts/local'), { recursive: true });
  await writeFile(join(cwd, 'scripts/local/ingress.mjs'), 'test-ingress-script');
  const tags = new Map(); const mutations = [];
  const command = async (file, argv) => {
    if (file === 'git') return { stdout: argv.includes('rev-parse') ? `${'d'.repeat(40)}\n` : '' };
    if (file === 'openssl') {
      if (changes.tlsFail) throw new Error('secret-canary should not escape');
      for (const flag of ['-out', '-keyout']) {
        const index = argv.indexOf(flag);
        if (index >= 0) await writeFile(argv[index + 1], flag === '-keyout' ? 'private-test-key' : 'public-test-certificate', { mode: 0o600 });
      }
      return { stdout: '' };
    }
    assert.equal(file, 'docker');
    const a = argv[0] === '--host' ? argv.slice(2) : argv;
    if (a[0] === 'compose' && a[1] === 'version') return { stdout: '5.6.0\n' };
    if (a[0] === 'image' && a[1] === 'inspect') {
      const ref = a.at(-1);
      if (ref.startsWith('sha256:')) {
        if (changes.missingImage) throw new Error('missing image');
        if (ref === baseImage && changes.missingBase) throw new Error('missing base');
        const labels = ref === images.api ? { ...buildLabels(), ...changes.labels } : {};
        return { stdout: JSON.stringify([{ Id: ref, Os: ref === baseImage && changes.nonLinuxBase ? 'windows' : 'linux', Architecture: 'amd64', Config: { Labels: changes.noLabels && ref === images.api ? {} : labels } }]) };
      }
      if (changes.existingTag || tags.has(ref)) return { stdout: JSON.stringify([{ Id: tags.get(ref) ?? images.api }]) };
      const error = new Error('No such image'); error.code = 1; throw error;
    }
    if (a[0] === 'image' && a[1] === 'tag') { mutations.push(a); tags.set(a[3], a[2]); return { stdout: '' }; }
    if (['ps', 'network', 'volume'].includes(a[0])) return { stdout: changes.existingResource ? 'foreign-resource\n' : '' };
    throw new Error(`Unexpected command: ${a.join(' ')}`);
  };
  return { cwd, mutations, tags, deps: { cwd, command, portAvailable: async () => !changes.portBusy, environment: changes.environment ?? {}, nodeVersion: 'v24.18.0', nodeBinary: process.execPath, now: () => new Date('2026-10-09T00:00:00Z') } };
}

test('PP1aFM06 exact flags and canonical image IDs', () => {
  assert.deepEqual(parseArgs(args), { runId: id, images });
  for (const invalid of [[], [...args, '--password', 'secret-canary'], [...args, '--run-id', id], args.slice(0, -1), args.map(x => x === id ? '../escape' : x), args.map(x => x === images.api ? 'mutable:latest' : x)]) {
    assert.throws(() => parseArgs(invalid), { message: 'PP1_LOCAL_INPUT_INVALID' });
  }
});

test('PP1aFM06 prepares private new run and bound image references without exposing secrets', async t => {
  const f = await fixture(t); const result = await prepare(parseArgs(args), f.deps);
  const root = join(f.cwd, 'local', 'pp1', id);
  assert.equal(result.phase, 'PREPARED'); assert.equal(result.environment, 'local-isolated');
  assert.deepEqual(result.images, images); assert.equal(result.project, `cms-pp1-local-${id}`);
  assert.deepEqual(result.apiBuild, apiBuild);
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  const secret = await readFile(join(root, 'secrets', 'spring.datasource.password'), 'utf8');
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
  for (const path of ['secrets/spring.datasource.password', 'ingress.json', 'compose.env', 'receipt.json', 'tls/leaf.key']) {
    assert.equal((await stat(join(root, path))).mode & 0o777, 0o600);
  }
  const receipt = await readFile(join(root, 'receipt.json'), 'utf8');
  const env = await readFile(join(root, 'compose.env'), 'utf8');
  assert.ok(!receipt.includes(secret)); assert.ok(!env.includes(secret));
  assert.ok(!JSON.stringify(f.mutations).includes(secret));
  assert.equal(f.tags.size, 3);
  const config = JSON.parse(await readFile(join(root, 'ingress.json'), 'utf8'));
  assert.equal(config.upstream, 'http://cms-api:8080');
  assert.equal(config.origins.api, 'https://api.cms.test:8443');
  assert.deepEqual(config.dist, { front: '/dist/front', back: '/dist/back', admin: '/dist/admin' });
  assert.ok(env.includes('NODE_BINARY='));
  const artifacts = JSON.parse(await readFile(join(root, 'artifacts.json'), 'utf8'));
  assert.equal(Object.keys(artifacts.dist).length, 3);
  assert.deepEqual(artifacts.apiBuild, apiBuild);
  assert.equal(artifacts.ingressScriptSha256, sha('test-ingress-script'));
  await assert.rejects(prepare(parseArgs(args), f.deps), { message: 'PP1_LOCAL_TARGET_EXISTS' });
  assert.equal(await readFile(join(root, 'secrets', 'spring.datasource.password'), 'utf8'), secret);
});

for (const [name, changes] of [
  ['missing build labels', { noLabels: true }],
  ['stale source commit', { labels: { 'org.cms.pp1.source-commit': 'f'.repeat(40) } }],
  ['malformed source label', { labels: { 'org.cms.pp1.source-commit': 'not-a-commit' } }],
  ['mismatched jar bytes', { labels: { 'org.cms.pp1.jar-sha256': 'f'.repeat(64) } }],
  ['missing jar label', { labels: { 'org.cms.pp1.jar-sha256': undefined } }],
  ['mutable base label', { labels: { 'org.cms.pp1.base-image': 'base:latest' } }],
  ['missing local base', { missingBase: true }],
  ['non Linux base', { nonLinuxBase: true }],
]) test(`PP1a provenance rejects ${name} before any image tag`, async t => {
  const f = await fixture(t, changes);
  await assert.rejects(prepare(parseArgs(args), f.deps), { message: 'PP1_LOCAL_IMAGE_INVALID' });
  assert.equal(f.mutations.length, 0);
  await assert.rejects(readFile(join(f.cwd, 'local/pp1', id, 'receipt.json')), { code: 'ENOENT' });
});

test('PP1a provenance requires one regular non symlink local jar and ingress script', async t => {
  for (const mode of ['missing', 'multiple', 'symlink', 'directory', 'ingress symlink']) {
    const f = await fixture(t); const jar = join(f.cwd, 'services/cms-api/build/libs/app.jar');
    if (mode === 'missing') await rm(jar);
    if (mode === 'multiple') await writeFile(join(f.cwd, 'services/cms-api/build/libs/second.jar'), jarBytes);
    if (mode === 'symlink') { await rm(jar); await symlink(process.execPath, jar); }
    if (mode === 'directory') { await rm(jar); await mkdir(jar); }
    if (mode === 'ingress symlink') { const script = join(f.cwd, 'scripts/local/ingress.mjs'); await rm(script); await symlink(process.execPath, script); }
    await assert.rejects(prepare(parseArgs(args), f.deps), error => /^PP1_LOCAL_(ARTIFACT|PATH)_INVALID$/.test(error.message));
    assert.equal(f.mutations.length, 0);
  }
});

for (const [name, changes, code] of [
  ['existing resource', { existingResource: true }, 'PP1_LOCAL_TARGET_EXISTS'],
  ['existing reference', { existingTag: true }, 'PP1_LOCAL_TARGET_EXISTS'],
  ['missing image', { missingImage: true }, 'PP1_LOCAL_IMAGE_INVALID'],
  ['busy ingress port', { portBusy: true }, 'PP1_LOCAL_PORT_BUSY'],
  ['remote daemon', { environment: { DOCKER_HOST: 'tcp://outside.invalid:2375' } }, 'PP1_LOCAL_DOCKER_NOT_LOCAL'],
]) test(`PP1aFM06 ${name} refuses before any tag mutation`, async t => {
  const f = await fixture(t, changes);
  await assert.rejects(prepare(parseArgs(args), f.deps), { message: code });
  assert.equal(f.mutations.length, 0);
});

test('PP1aFM06 symlink and stale localhost build are refused', async t => {
  const f = await fixture(t);
  await mkdir(join(f.cwd, 'local'));
  await symlink(tmpdir(), join(f.cwd, 'local', 'pp1'));
  await assert.rejects(prepare(parseArgs(args), f.deps), { message: 'PP1_LOCAL_PATH_INVALID' });
  assert.equal(f.mutations.length, 0);
  const other = await fixture(t);
  await writeFile(join(other.cwd, 'apps/web-front/dist/assets/app.js'), 'fetch("http://localhost:8080")');
  await assert.rejects(prepare(parseArgs(args), other.deps), { message: 'PP1_LOCAL_ARTIFACT_INVALID' });
  assert.equal(other.mutations.length, 0);
});

test('PP1aFM06 TLS failure leaves no successful receipt and sanitizes child failure', async t => {
  const f = await fixture(t, { tlsFail: true });
  await assert.rejects(prepare(parseArgs(args), f.deps), { message: 'PP1_LOCAL_PREPARE_FAILED' });
  await assert.rejects(readFile(join(f.cwd, 'local/pp1', id, 'receipt.json')), { code: 'ENOENT' });
});
