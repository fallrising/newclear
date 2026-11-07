import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, symlink, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectTarget } from './maintenance-target.mjs';
import { parseArgs, verifyAccounts } from './verify-accounts.mjs';
import { spawnSync } from 'node:child_process';
const sha = value => createHash('sha256').update(value).digest('hex');
const runId = 'a'.repeat(32), project = `cms-pp1-local-${runId}`, commit = 'b'.repeat(40);
const services = ['postgres', 'cms-api', 'ingress'], kinds = ['postgres', 'api', 'node'];
const full = n => String(n).repeat(64), image = n => `sha256:${full(n)}`;
const operationId = '12345678-1234-4234-8234-123456789abc', principalId = '23456789-2345-4345-8345-23456789abcd';
const failure = { message: 'PP1_ACCOUNT_VERIFICATION_FAILED' };
const goodAggregate = { principal: 1, credential: 1, roleAssignment: 1, permission: 13, session: 0, audit: 1, roles: 5, types: 12,
  migrations: 10, failedMigrations: 0, serverVersion: 160004, contentRows: 0, roleCatalog: true, typeCatalog: true,
  migrationCatalog: true, principalGraph: true, permissionGraph: true, auditGraph: true };
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'pp1-target-')), root = join(cwd, 'local/pp1', runId);
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(join(cwd, 'services/cms-api/build/libs'), { recursive: true });
  await mkdir(join(cwd, 'scripts/local'), { recursive: true });
  const jar = join(cwd, 'services/cms-api/build/libs/app.jar'), node = join(cwd, 'node');
  const script = join(cwd, 'scripts/local/ingress.mjs'), probe = join(cwd, 'scripts/local/maintenance-media-probe.mjs');
  for (const [path, bytes] of [[jar, 'jar'], [node, 'node'], [script, 'ingress'], [probe, 'probe']]) await writeFile(path, bytes);
  const images = { postgres: image(4), api: image(5), node: image(6) };
  const apiBuild = { sourceCommit: commit, jarSha256: sha('jar'), baseImage: image(7) };
  const receipt = { version: 1, environment: 'local-isolated', phase: 'PREPARED', runId, project, sourceCommit: commit,
    images, imageRefs: Object.fromEntries(kinds.map(k => [k, `${project}-${k}:verified`])), apiBuild, apiOrigin: 'https://api.cms.test:8443' };
  const artifacts = { version: 1, sourceCommit: commit, apiBuild, apiOrigin: receipt.apiOrigin,
    ingressScriptSha256: sha('ingress'), nodeBinarySha256: sha('node'), dist: {} };
  const bind = (Source, Destination) => ({ Type: 'bind', Source, Destination, RW: false });
  const volume = (name, Destination) => ({ Type: 'volume', Name: `${project}_${name}`, Source: `/var/lib/docker/volumes/${project}_${name}/_data`, Destination, RW: true });
  const networks = ['web', 'data'].map((name, index) => ({ Id: full(index + 8), Name: `${project}_${name}`, Driver: 'bridge', Internal: true,
    Labels: { 'com.docker.compose.project': project, 'com.docker.compose.network': name },
    IPAM: { Config: [{ Subnet: `172.${30 + index}.0.0/16`, Gateway: `172.${30 + index}.0.1` }] }, Containers: {} }));
  const containers = services.map((service, index) => {
    const names = service === 'cms-api' ? ['web', 'data'] : [service === 'postgres' ? 'data' : 'web'];
    const endpoints = Object.fromEntries(names.map(name => {
      const network = networks.find(n => n.Name === `${project}_${name}`), ip = `${network.IPAM.Config[0].Gateway.slice(0, -1)}${index + 2}`;
      network.Containers[full(index + 1)] = { IPv4Address: `${ip}/16` };
      return [network.Name, { NetworkID: network.Id, IPAddress: ip, IPPrefixLen: 16, Gateway: network.IPAM.Config[0].Gateway,
        Aliases: [`${project}-${service}-1`, service, ...(service === 'ingress' ? ['front.cms.test', 'back.cms.test', 'admin.cms.test', 'api.cms.test'] : [])] }];
    }));
    return { Id: full(index + 1), Name: `/${project}-${service}-1`, Image: images[kinds[index]],
      Config: { Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': service }, Env: [] },
      State: { Running: true, Health: { Status: 'healthy' } },
      HostConfig: { RestartPolicy: { Name: 'no' }, Privileged: false, NetworkMode: `${project}_${names[0]}`, PortBindings: {} },
      NetworkSettings: { Ports: { '5432/tcp': null }, Networks: endpoints }, Mounts: [] };
  });
  const apiEnv = { SPRING_PROFILES_ACTIVE: 'prod', CMS_RUNTIME_PRODUCTION_REQUIRED: 'true', CMS_SITE_DOMAIN: 'cms.test', CMS_API_ORIGIN: receipt.apiOrigin,
    CMS_CORS_ORIGINS: 'https://front.cms.test:8443,https://back.cms.test:8443,https://admin.cms.test:8443',
    CMS_SURFACE_ORIGINS: 'https://front.cms.test:8443:front,https://back.cms.test:8443:back,https://admin.cms.test:8443:admin',
    CMS_IDENTITY_SEED_ENABLED: 'false', CMS_IDENTITY_COOKIE_SECURE: 'true', SPRING_DATASOURCE_URL: 'jdbc:postgresql://postgres:5432/cms',
    SPRING_DATASOURCE_USERNAME: 'cms_local', SPRING_CONFIG_IMPORT: 'configtree:/run/secrets/', CMS_MEDIA_ROOT: '/data/media', SERVER_PORT: '8080' };
  containers[0].Config.Env = ['POSTGRES_DB=cms', 'POSTGRES_USER=cms_local', 'POSTGRES_PASSWORD_FILE=/run/secrets/spring.datasource.password'];
  containers[1].Config.Env = Object.entries(apiEnv).map(([k, v]) => `${k}=${v}`);
  for (let i = 0; i < 2; i++) containers[i].Mounts = [volume(i ? 'media-data' : 'db-data', i ? '/data/media' : '/var/lib/postgresql/data'),
    bind(join(root, 'secrets/spring.datasource.password'), '/run/secrets/spring.datasource.password')];
  containers[2].Mounts = [bind(node, '/opt/pp1-node'), bind(script, '/tool/ingress.mjs'), bind(join(root, 'ingress.json'), '/config/ingress.json'),
    bind(join(root, 'tls/leaf.crt'), '/tls/leaf.crt'), bind(join(root, 'tls/leaf.key'), '/tls/leaf.key')];
  for (const surface of ['front', 'back', 'admin']) {
    const dist = join(cwd, 'apps', `web-${surface}`, 'dist'); await mkdir(dist, { recursive: true });
    await writeFile(join(dist, 'index.html'), surface); artifacts.dist[surface] = { 'index.html': sha(surface) };
    containers[2].Mounts.push(bind(dist, `/dist/${surface}`));
  }
  const volumes = ['db-data', 'media-data'].map(name => ({ Name: `${project}_${name}`, Mountpoint: `/var/lib/docker/volumes/${project}_${name}/_data`, Driver: 'local',
    Labels: { 'com.docker.compose.project': project, 'com.docker.compose.volume': name }, Options: {} }));
  const apiLabels = { 'org.cms.pp1.source-commit': commit, 'org.cms.pp1.jar-sha256': apiBuild.jarSha256, 'org.cms.pp1.base-image': apiBuild.baseImage };
  const calls = [], state = { containers, networks, volumes, apiLabels, oid: '16384\n', health: 'healthy\n', sql: JSON.stringify(goodAggregate) };
  const save = async () => { for (const [name, data] of [['receipt', receipt], ['artifacts', artifacts]]) await writeFile(join(root, `${name}.json`), JSON.stringify(data), { mode: 0o600 }); }; await save();
  const command = async (file, args, options) => {
    assert.equal(file, 'docker'); assert.deepEqual(args.slice(0, 2), ['--host', 'unix:///var/run/docker.sock']);
    assert.equal(options.shell, false); assert.equal(options.timeout, 30000); calls.push(args);
    const a = args.slice(2); let result;
    if (a[0] === 'ps') result = containers.map(c => c.Id).join('\n');
    else if (a[0] === 'inspect') result = a[1] === '--format' ? state.health : JSON.stringify(containers);
    else if (a[0] === 'network') result = JSON.stringify(networks);
    else if (a[0] === 'volume') result = JSON.stringify(volumes);
    else if (a[0] === 'image') { const kind = kinds.find(k => a.at(-1) === receipt.imageRefs[k]) ?? kinds.find(k => images[k] === a.at(-1)); result = JSON.stringify([{ Id: kind ? images[kind] : apiBuild.baseImage, Os: 'linux', Config: { Labels: kind === 'api' ? state.apiLabels : {} } }]); }
    else if (a[0] === 'exec') { assert.deepEqual(a.slice(0, 12), ['exec', full(1), 'psql', '-X', '-q', '-t', '-A', '-U', 'cms_local', '-d', 'cms', '-c']); result = a[12].startsWith('SELECT oid') ? state.oid : state.sql; }
    else assert.fail(`unexpected mutation ${a[0]}`);
    return { stdout: result, stderr: '' };
  };
  const deps = { command, environment: {} }, inspection = await inspectTarget(root, deps, { apiState: 'running' });
  const target = inspection.target, releaseId = `sha256:${apiBuild.jarSha256}`, at = '2026-10-09T00:00:00.000Z';
  const common = { operationId, operation: 'FRESH_INIT', releaseId, targetId: target.targetId };
  const metadata = { 'target.json': target, 'lease.json': { ...target, ...common, phase: 'COMPLETE', createdAt: at,
    connection: { jdbcUrl: inspection.jdbcUrl, dataGateway: inspection.dataGateway }, boundBackend: { pid: 123, backendStartEpoch: '1791504000.123456', db: 'cms', role: 'cms_local', clientAddr: inspection.dataGateway, applicationName: operationId } },
    [`operations/${operationId}.json`]: { ...common, phase: 'COMPLETE', at, failureCode: null },
    [`operations/${operationId}.result.json`]: { ...common, principalId, completedAt: '2026-10-09T00:00:00.123456789Z' } };
  await mkdir(join(root, 'maintenance/operations'), { recursive: true, mode: 0o700 });
  const saveMetadata = async () => { for (const [name, data] of Object.entries(metadata)) await writeFile(join(root, 'maintenance', name), JSON.stringify(data), { mode: 0o600 }); }; await saveMetadata(); calls.length = 0;
  return { cwd, root, jar, node, script, probe, receipt, artifacts, state, calls, save, deps, metadata, saveMetadata };
}
test('PP1-AC02 initialized graph is exact', async t => {
  const f = await fixture(t); assert.deepEqual(await verifyAccounts(f.root, operationId, f.deps), { stage: 'initialized', verified: true });
  const query = f.calls.find(a => a.at(-1).startsWith('WITH expected'))?.at(-1); assert.ok(query);
  assert.ok(f.calls.some(a => JSON.stringify(a.slice(2)) === JSON.stringify(['inspect', '--format', '{{.State.Health.Status}}', full(2)])));
  assert.ok(f.calls.every(a => ['ps', 'inspect', 'network', 'volume', 'image', 'exec'].includes(a[2])));
  assert.ok(!query.includes('SELECT * FROM cms_credential'));
});
test('PP1-AC02 strict flags and canonical IDs reject CLI bypass', () => {
  const args = ['--run-root', '/fixture/local/pp1/' + runId, '--stage', 'initialized', '--operation-id', operationId];
  assert.deepEqual(parseArgs(args), { runRoot: args[1], stage: 'initialized', operationId });
  for (const bad of [[], args.slice(0, -1), [...args, '--command', 'canary'], [...args, '--stage', 'initialized'],
    args.map(v => v === 'initialized' ? 'fresh' : v), args.map(v => v === operationId ? operationId.toUpperCase() : v),
    args.map(v => v === operationId ? "' OR true --" : v), args.map(v => v === args[1] ? '' : v)]) assert.throws(() => parseArgs(bad), failure);
  const cli = spawnSync(process.execPath, [new URL('./verify-accounts.mjs', import.meta.url).pathname, ...args, '--command', 'canary'], { encoding: 'utf8' });
  assert.notEqual(cli.status, 0); assert.equal(cli.stdout, ''); assert.equal(cli.stderr, failure.message + '\n');
});
test('PP1-AC02 rejects every aggregate mismatch including same-count graph failures', async t => {
  const f = await fixture(t);
  for (const key of Object.keys(goodAggregate)) {
    f.state.sql = JSON.stringify({ ...goodAggregate, [key]: typeof goodAggregate[key] === 'boolean' ? false : goodAggregate[key] + 1 });
    if (key === 'serverVersion') f.state.sql = JSON.stringify({ ...goodAggregate, serverVersion: 170000 });
    await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure, key);
  }
  for (const value of ['', 'null', '[]', '{bad', JSON.stringify({ ...goodAggregate, extra: true }), JSON.stringify({ ...goodAggregate, principal: '1' })]) {
    f.state.sql = value; await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure);
  }
});
test('PP1-AC02 SQL fixes same-count FK role matrix surface type predicate anonymous status and audit predicates', async t => {
  const f = await fixture(t); await verifyAccounts(f.root, operationId, f.deps);
  const sql = f.calls.find(a => a.at(-1).startsWith('WITH expected')).at(-1);
  for (const fragment of ['c.principal_id=p.id', 'pr.principal_id=p.id', 'r.id=pr.role_id', "r.code='admin'", 'p.content_type_code IS NULL', 'p.predicate_json IS NULL',
    'SELECT * FROM actual EXCEPT SELECT * FROM expected', 'SELECT * FROM expected EXCEPT SELECT * FROM actual', "r.code<>'admin'", "p.status='active'", 'p.email IS NULL',
    'p.failed_login_count=0', 'p.locked_until IS NULL', 'p.last_login_at IS NULL', 'p.deleted_at IS NULL', "c.type='password'", "c.algo='argon2id'", 'c.secret_hash',
    'pr.content_type_codes=ARRAY[]::text[]', 'a.actor_principal_id IS NULL', "a.category='AUTH'", "a.action='PRODUCTION_ADMIN_INITIALIZED'", "a.target_type='principal'",
    "a.surface='admin'", "a.outcome='ok'", 'jsonb_object_keys(a.detail_json)', "ARRAY['mode','operationId','releaseId','targetId']", operationId, principalId,
    "'pp1-local:" + runId, "'sha256:" + sha('jar'), "'FRESH_INIT'", 'flyway_schema_history', "'JDBC'", "'SQL'"]) assert.ok(sql.includes(fragment), fragment);
  const pairs = [...sql.matchAll(/\('([a-z_]+)', ARRAY\[([^\]]+)\]::text\[\]\)/g)].map(m => [m[1], m[2].replaceAll("'", '').split(',')]);
  assert.deepEqual(pairs, [['read_published', ['front','back','admin']], ...['read_draft','create','update','publish','unpublish','delete','archive','manage_media'].map(a => [a, ['back','admin']]), ...['manage_types','manage_principals','manage_settings','read_audit'].map(a => [a, ['admin']])]);
  for (const table of ['cms_entry','cms_entry_revision','cms_entry_ref','cms_entry_index','cms_navigation_menu','cms_media','cms_media_variant','cms_media_attachment']) assert.ok(sql.includes('count(*) FROM ' + table + ')'));
});
test('PP1-AC02 complete metadata cannot be forged by mismatched fields or missing records', async t => {
  const f = await fixture(t), original = structuredClone(f.metadata);
  for (const [name, record] of Object.entries(original)) {
    for (const key of Object.keys(record)) {
      f.metadata[name] = { ...record, [key]: record[key] === null ? "invalid" : null }; await f.saveMetadata();
      await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure, name + ':' + key);
    }
    f.metadata[name] = { ...record, extra: true }; await f.saveMetadata(); await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure);
    f.metadata[name] = record; await f.saveMetadata(); await rm(join(f.root, 'maintenance', name));
    await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure); await f.saveMetadata();
  }
});
test('PP1-AC02 rejects wrong operation release target mode schema and backend tuple', async t => {
  const f = await fixture(t), original = structuredClone(f.metadata);
  for (const [name, key, value] of [ ['lease.json','phase','BOUND'], ['lease.json','operation','RECOVER_ADMIN'], ['lease.json','operationId',principalId],
    ['lease.json','releaseId','sha256:' + full(0)], ['lease.json','targetId','pp1-local:' + 'f'.repeat(32)],
    ['lease.json','connection',{ jdbcUrl: 'jdbc:postgresql://172.31.0.99:5432/cms', dataGateway: '172.31.0.1' }],
    ...['pid','backendStartEpoch','db','role','clientAddr','applicationName'].map(key => ['lease.json','boundBackend',{ ...original['lease.json'].boundBackend, [key]: null }])]) {
    f.metadata[name] = { ...original[name], [key]: value }; await f.saveMetadata(); await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure);
    f.metadata[name] = original[name];
  }
});
test('PP1-AC02 private metadata real filesystem rejects modes links owners and remaining lock', async t => {
  for (const kind of ['directory', 'file', 'hardlink', 'symlink', 'ancestor', 'lock', 'uid']) {
    const f = await fixture(t), path = join(f.root, 'maintenance/lease.json');
    if (kind === 'directory') await chmod(join(f.root, 'maintenance/operations'), 0o755);
    if (kind === 'file') await chmod(path, 0o644);
    if (kind === 'hardlink') await link(path, join(f.root, 'copy'));
    if (kind === 'symlink') { await rm(path); await symlink(join(f.root, 'receipt.json'), path); }
    if (kind === 'ancestor') { const dir = join(f.root, 'maintenance/operations'); await rm(dir, { recursive: true }); await symlink(f.root, dir); }
    if (kind === 'lock') await mkdir(join(f.root, 'maintenance/operation.lock'), { mode: 0o700 });
    if (kind === 'uid') { const uid = process.getuid(); t.mock.method(process, 'getuid', () => uid + 1); }
    await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure); t.mock.restoreAll();
  }
});
test('PP1-AC02 actual target inspector rejects ports seed provenance stopped API and unhealthy output', async t => {
  for (const mutate of [f => { f.state.containers[0].HostConfig.PortBindings = { '5432/tcp': [{}] }; },
    f => { f.state.containers[1].State.Running = false; }, f => { f.state.apiLabels['org.cms.pp1.jar-sha256'] = full(0); },
    f => { f.state.containers[1].Config.Env = f.state.containers[1].Config.Env.map(s => s.replace('CMS_IDENTITY_SEED_ENABLED=false', 'CMS_IDENTITY_SEED_ENABLED=true')); },
    ...['unhealthy', 'starting', '', 'healthy\ncanary'].map(health => f => { f.state.health = health; })]) {
    const f = await fixture(t); mutate(f); await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure);
  }
  const f = await fixture(t), command = f.deps.command;
  for (const bad of [async () => { throw new Error('private-canary'); }, async () => ({ stdout: 'private-canary', code: 1 })]) {
    f.deps.command = async (...args) => args[1].at(-1).startsWith('WITH expected') ? bad() : command(...args);
    await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure);
  }
});
test('PP1-AC02 all metadata files reject unsafe file identity and all private directory modes', async t => {
  const f = await fixture(t);
  for (const name of Object.keys(f.metadata)) {
    const path = join(f.root, 'maintenance', name);
    await chmod(path, 0o644); await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure); await chmod(path, 0o600);
    await link(path, join(f.root, 'hardlink')); await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure); await rm(join(f.root, 'hardlink'));
    await rm(path); await symlink(join(f.root, 'receipt.json'), path); await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure); await rm(path); await f.saveMetadata();
    await writeFile(path, '[]'); await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure); await f.saveMetadata();
  }
  for (const path of [f.root, join(f.root, 'maintenance'), join(f.root, 'maintenance/operations')]) {
    await chmod(path, 0o755); await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure); await chmod(path, 0o700);
  }
  await symlink(join(f.root, 'absent'), join(f.root, 'maintenance/operation.lock')); await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure);
});
test('PP1-AC02 canonical metadata rejects SQL interpolation and nested schemas', async t => {
  const f = await fixture(t), original = structuredClone(f.metadata), result = `operations/${operationId}.result.json`;
  for (const [name, key, value] of [[result,'principalId',"' OR true --"], [result,'completedAt','invalid'], ['lease.json','createdAt','2026-10-09'],
    ['lease.json','connection',{ ...original['lease.json'].connection, extra: true }], ['lease.json','boundBackend',{ ...original['lease.json'].boundBackend, extra: true }],
    ['lease.json','boundBackend',{ ...original['lease.json'].boundBackend, backendStartEpoch: 1791504000.123456 }]]) {
    f.metadata[name] = { ...original[name], [key]: value }; await f.saveMetadata(); f.calls.length = 0;
    await assert.rejects(verifyAccounts(f.root, operationId, f.deps), failure);
    assert.ok(!f.calls.some(a => a.at(-1).startsWith('WITH expected'))); f.metadata[name] = original[name];
  }
  for (const [root, operation] of [[f.root, "' OR true --"], [f.root + '/..', operationId], ['relative', operationId]]) {
    f.calls.length = 0; await assert.rejects(verifyAccounts(root, operation, f.deps), failure); assert.equal(f.calls.length, 0);
  }
});
test('PP1-AC02 fixed migration tuples include scripts and both comparison directions', async t => {
  const f = await fixture(t); await verifyAccounts(f.root, operationId, f.deps);
  const sql = f.calls.find(a => a.at(-1).startsWith('WITH expected')).at(-1);
  const names = ['wave_a_baseline','identity','content','media','type_settings_and_field_metadata','entry_index_scope','backfill_entry_index','publish_request_and_audit_indexes','audit_retention','index_ref_fields'];
  for (const [index, name] of names.entries()) {
    const version = index + 1, java = [7,10].includes(version), script = java ? `db.migration.V${version}__${name}` : `V${version}__${name}.sql`;
    assert.ok(sql.includes(`(${version},'${version}','${java ? 'JDBC' : 'SQL'}','${script}')`));
  }
  assert.ok(sql.includes('SELECT * FROM actual_migrations EXCEPT SELECT * FROM expected_migrations'));
  assert.ok(sql.includes('SELECT * FROM expected_migrations EXCEPT SELECT * FROM actual_migrations'));
  assert.ok(sql.includes('array_agg(type_key::text ORDER BY type_key)')); assert.ok(sql.includes('WHERE NOT success'));
});
