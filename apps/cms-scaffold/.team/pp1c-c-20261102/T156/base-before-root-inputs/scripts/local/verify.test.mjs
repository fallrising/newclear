import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verify } from './verify.mjs';
const runId = 'e'.repeat(32); const project = `cms-pp1-local-${runId}`;
const sha = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'pp1-verify-')); t.after(() => rm(cwd, { recursive: true, force: true }));
  const root = join(cwd, 'local/pp1', runId); await mkdir(join(root, 'secrets'), { recursive: true, mode: 0o700 });
  await mkdir(join(root, 'tls'), { mode: 0o700 });
  const secret = 'local-canary-that-must-never-escape-logs';
  const images = { api: `sha256:${'a'.repeat(64)}`, node: `sha256:${'b'.repeat(64)}`, postgres: `sha256:${'c'.repeat(64)}` };
  const imageRefs = Object.fromEntries(Object.keys(images).map(k => [k, `${project}-${k}:verified`]));
  const apiBuild = { sourceCommit: 'd'.repeat(40), jarSha256: sha('test-local-bootjar'), baseImage: `sha256:${'f'.repeat(64)}` };
  const receipt = { version: 1, environment: 'local-isolated', runId, project, sourceCommit: 'd'.repeat(40), apiBuild, images, imageRefs, apiOrigin: 'https://api.cms.test:8443', phase: 'PREPARED' };
  await writeFile(join(root, 'receipt.json'), JSON.stringify(receipt), { mode: 0o600 });
  await writeFile(join(root, 'secrets/spring.datasource.password'), secret, { mode: 0o600 });
  for (const name of ['ca.crt', 'leaf.crt', 'leaf.key']) await writeFile(join(root, 'tls', name), 'test certificate', { mode: 0o600 });
  await writeFile(join(root, 'ingress.json'), '{}', { mode: 0o600 });
  const binary = join(cwd, 'node'); await writeFile(binary, 'test-node');
  const script = join(cwd, 'scripts/local/ingress.mjs'); await mkdir(join(cwd, 'scripts/local'), { recursive: true }); await writeFile(script, 'test-tool');
  const dist = {};
  for (const surface of ['front', 'back', 'admin']) {
    const dir = join(cwd, 'apps', `web-${surface}`, 'dist'); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), surface); dist[surface] = { 'index.html': sha(surface) };
  }
  await writeFile(join(root, 'artifacts.json'), JSON.stringify({ version: 1, sourceCommit: receipt.sourceCommit, apiBuild, apiOrigin: receipt.apiOrigin, dist, ingressScriptSha256: sha('test-tool'), nodeBinarySha256: sha('test-node') }), { mode: 0o600 });
  const labels = service => ({ 'com.docker.compose.project': project, 'com.docker.compose.service': service });
  const bind = (source, destination) => ({ Type: 'bind', Source: source, Destination: destination, RW: false });
  const volume = (name, destination) => ({ Type: 'volume', Name: `${project}_${name}`, Destination: destination, RW: true });
  const networks = Object.fromEntries(['web', 'data'].map((name, index) => [`${project}_${name}`, { NetworkID: String(index + 4).repeat(64) }]));
  const env = {
    SPRING_PROFILES_ACTIVE: 'prod', CMS_RUNTIME_PRODUCTION_REQUIRED: 'true', CMS_SITE_DOMAIN: 'cms.test', CMS_API_ORIGIN: receipt.apiOrigin,
    CMS_CORS_ORIGINS: 'https://front.cms.test:8443,https://back.cms.test:8443,https://admin.cms.test:8443',
    CMS_SURFACE_ORIGINS: 'https://front.cms.test:8443:front,https://back.cms.test:8443:back,https://admin.cms.test:8443:admin',
    CMS_IDENTITY_SEED_ENABLED: 'false', CMS_IDENTITY_COOKIE_SECURE: 'true', SPRING_DATASOURCE_URL: 'jdbc:postgresql://postgres:5432/cms',
    SPRING_DATASOURCE_USERNAME: 'cms_local', SPRING_CONFIG_IMPORT: 'configtree:/run/secrets/', CMS_MEDIA_ROOT: '/data/media', SERVER_PORT: '8080',
  };
  const containers = ['postgres', 'cms-api', 'ingress'].map((service, index) => ({
    Id: String(index + 1).repeat(64), Image: images[['postgres', 'api', 'node'][index]],
    Config: { Labels: labels(service), Env: service === 'cms-api' ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : [] },
    State: { Running: true, Health: { Status: 'healthy' } },
    HostConfig: { NetworkMode: `${project}_${index === 0 ? 'data' : 'web'}`, RestartPolicy: { Name: 'no' }, Privileged: false, PortBindings: {} },
    NetworkSettings: { Networks: index === 1 ? networks : { [`${project}_${index === 0 ? 'data' : 'web'}`]: networks[`${project}_${index === 0 ? 'data' : 'web'}`] } },
    Mounts: index < 2 ? [volume(index === 0 ? 'db-data' : 'media-data', index === 0 ? '/var/lib/postgresql/data' : '/data/media'), bind(join(root, 'secrets/spring.datasource.password'), '/run/secrets/spring.datasource.password')] : [
      bind(binary, '/opt/pp1-node'), bind(script, '/tool/ingress.mjs'), bind(join(root, 'ingress.json'), '/config/ingress.json'),
      bind(join(root, 'tls/leaf.crt'), '/tls/leaf.crt'), bind(join(root, 'tls/leaf.key'), '/tls/leaf.key'),
      ...['front', 'back', 'admin'].map(k => bind(join(cwd, 'apps', `web-${k}`, 'dist'), `/dist/${k}`)),
    ],
  }));
  const state = { containers, counts: { principal: 0, credential: 0, permission: 0, session: 0, entry: 0, media: 0, navigation: 0, types: 12, roles: 5, failedMigrations: 0, migrations: 10, serverVersion: 160000 }, health: { status: 'UP' }, logs: '', failSql: false, emptySql: false,
    apiLabels: { 'org.cms.pp1.source-commit': apiBuild.sourceCommit, 'org.cms.pp1.jar-sha256': apiBuild.jarSha256, 'org.cms.pp1.base-image': apiBuild.baseImage },
    jarOutput: `${apiBuild.jarSha256}  /app/app.jar\n` };
  const command = async (file, argv) => {
    assert.equal(file, 'docker'); const a = argv.slice(2);
    if (a[0] === 'ps') return { stdout: containers.map(c => c.Id).join('\n') };
    if (a[0] === 'inspect') return { stdout: JSON.stringify(containers) };
    if (a[0] === 'image') {
      const kind = Object.keys(imageRefs).find(k => imageRefs[k] === a.at(-1));
      return { stdout: JSON.stringify([{ Id: images[kind], Config: { Labels: kind === 'api' ? state.apiLabels : {} } }]) };
    }
    if (a[0] === 'network') return { stdout: JSON.stringify(Object.entries(networks).map(([name, info]) => ({ Name: name, Id: info.NetworkID, Internal: true, Labels: { 'com.docker.compose.project': project } }))) };
    if (a[0] === 'volume') return { stdout: JSON.stringify(['db-data', 'media-data'].map(k => ({ Name: `${project}_${k}`, Driver: 'local', Labels: { 'com.docker.compose.project': project } }))) };
    if (a[0] === 'exec') {
      if (a[2] === 'sha256sum') { assert.deepEqual(a, ['exec', containers[1].Id, 'sha256sum', '/app/app.jar']); return { stdout: state.jarOutput }; }
      if (state.failSql) throw new Error(secret); return { stdout: state.emptySql ? '' : JSON.stringify(state.counts) };
    }
    if (a[0] === 'logs') return { stdout: state.logs, stderr: '' };
    throw new Error('unexpected command');
  };
  return { root, cwd, state, secret, apiBuild, deps: { command, fetchHealth: async () => state.health, environment: {} } };
}
test('PP1aFM07 verifies only a healthy owned isolated no-demo runtime', async t => {
  const f = await fixture(t); const result = await verify(f.root, f.deps);
  assert.equal(result.environment, 'local-isolated'); assert.equal(result.project, project);
  assert.equal(result.checks.privatePorts, true); assert.equal(result.checks.noDemo, true); assert.equal(result.checks.health, true);
  assert.equal(result.counts.migrations, 10); assert.deepEqual(result.apiBuild, f.apiBuild);
  assert.ok(!JSON.stringify(result).includes(f.secret));
});

for (const [name, mutate] of [
  ['missing API labels', f => { f.state.apiLabels = {}; }],
  ['stale API source label', f => { f.state.apiLabels['org.cms.pp1.source-commit'] = 'a'.repeat(40); }],
  ['wrong API jar label', f => { f.state.apiLabels['org.cms.pp1.jar-sha256'] = 'a'.repeat(64); }],
  ['wrong API base label', f => { f.state.apiLabels['org.cms.pp1.base-image'] = `sha256:${'a'.repeat(64)}`; }],
  ['runtime jar mismatch', f => { f.state.jarOutput = `${'a'.repeat(64)}  /app/app.jar\n`; }],
  ['malformed runtime jar output', f => { f.state.jarOutput = f.secret; }],
  ['migration eight excludes Java migrations', f => { f.state.counts.migrations = 8; }],
  ['extra migration', f => { f.state.counts.migrations = 11; }],
]) test(`PP1a provenance rejects ${name} with a fixed error`, async t => {
  const f = await fixture(t); mutate(f);
  await assert.rejects(verify(f.root, f.deps), { message: 'PP1_LOCAL_VERIFICATION_FAILED' });
});

test('PP1a provenance rejects mismatched receipt artifacts and modified mounted ingress', async t => {
  for (const mode of ['missing receipt build', 'missing artifact build', 'artifact mismatch', 'source mismatch', 'ingress changed', 'missing ingress hash']) {
    const f = await fixture(t);
    const path = join(f.root, mode === 'missing receipt build' || mode === 'source mismatch' ? 'receipt.json' : 'artifacts.json');
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (mode.startsWith('missing') && mode.includes('build')) delete data.apiBuild;
    if (mode === 'artifact mismatch') data.apiBuild.jarSha256 = 'a'.repeat(64);
    if (mode === 'source mismatch') data.apiBuild.sourceCommit = 'a'.repeat(40);
    if (mode === 'missing ingress hash') delete data.ingressScriptSha256;
    if (mode === 'ingress changed') await writeFile(join(f.cwd, 'scripts/local/ingress.mjs'), 'modified-tool');
    await writeFile(path, JSON.stringify(data), { mode: 0o600 });
    await assert.rejects(verify(f.root, f.deps), { message: 'PP1_LOCAL_VERIFICATION_FAILED' });
  }
});
for (const [name, mutate] of [
  ['declared ingress port', f => { f.state.containers[2].HostConfig.PortBindings = { '8443/tcp': [{ HostIp: '127.0.0.1', HostPort: '8443' }] }; }],
  ...[0, 1, 2].map(index => [`actual published port on service ${index}`, f => { f.state.containers[index].NetworkSettings.Ports = { '8443/tcp': [{ HostIp: '0.0.0.0', HostPort: '8443' }] }; }]),
  ['published DB', f => { f.state.containers[0].HostConfig.PortBindings = { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5432' }] }; }],
  ['wrong image', f => { f.state.containers[1].Image = `sha256:${'f'.repeat(64)}`; }],
  ['foreign project', f => { f.state.containers[0].Config.Labels['com.docker.compose.project'] = 'foreign'; }],
  ['extra network', f => { f.state.containers[1].NetworkSettings.Networks.foreign = { NetworkID: 'bad' }; }],
  ['seed principal', f => { f.state.counts.principal = 1; }],
  ['unhealthy', f => { f.state.health.status = 'DOWN'; }],
  ['SQL error', f => { f.state.failSql = true; }],
  ['empty SQL output', f => { f.state.emptySql = true; }],
  ['secret in logs', f => { f.state.logs = f.secret; }],
]) test(`PP1aFM07 rejects ${name} without disclosing the secret`, async t => {
  const f = await fixture(t); mutate(f);
  await assert.rejects(verify(f.root, f.deps), error => /^PP1_LOCAL_[A-Z_]+$/.test(error.message) && !error.message.includes(f.secret));
});
