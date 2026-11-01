import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, symlink, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectTarget, mediaProbeCommand } from './maintenance-target.mjs';
import { isEmpty } from './maintenance-media-probe.mjs';
import { spawnSync } from 'node:child_process';
const sha = value => createHash('sha256').update(value).digest('hex');
const runId = 'a'.repeat(32), project = `cms-pp1-local-${runId}`, commit = 'b'.repeat(40);
const services = ['postgres', 'cms-api', 'ingress'], kinds = ['postgres', 'api', 'node'];
const full = n => String(n).repeat(64), image = n => `sha256:${full(n)}`;
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
  const calls = [], state = { containers, networks, volumes, apiLabels, oid: '16384\n' };
  const save = async () => { for (const [name, data] of [['receipt', receipt], ['artifacts', artifacts]]) await writeFile(join(root, `${name}.json`), JSON.stringify(data), { mode: 0o600 }); }; await save();
  const command = async (file, args, options) => {
    assert.equal(file, 'docker'); assert.deepEqual(args.slice(0, 2), ['--host', 'unix:///var/run/docker.sock']);
    assert.equal(options.shell, false); assert.equal(options.timeout, 30000); calls.push(args);
    const a = args.slice(2); let result;
    if (a[0] === 'ps') result = containers.map(c => c.Id).join('\n');
    else if (a[0] === 'inspect') result = JSON.stringify(containers);
    else if (a[0] === 'network') result = JSON.stringify(networks);
    else if (a[0] === 'volume') result = JSON.stringify(volumes);
    else if (a[0] === 'image') { const kind = kinds.find(k => a.at(-1) === receipt.imageRefs[k]) ?? kinds.find(k => images[k] === a.at(-1)); result = JSON.stringify([{ Id: kind ? images[kind] : apiBuild.baseImage, Os: 'linux', Config: { Labels: kind === 'api' ? state.apiLabels : {} } }]); }
    else if (a[0] === 'exec') { assert.deepEqual(a, ['exec', full(1), 'psql', '-X', '-q', '-t', '-A', '-U', 'cms_local', '-d', 'cms', '-c', 'SELECT oid FROM pg_database WHERE datname = current_database();']); result = state.oid; }
    else assert.fail(`unexpected mutation ${a[0]}`);
    return { stdout: result, stderr: '' };
  };
  return { cwd, root, jar, node, script, probe, receipt, artifacts, state, calls, save, deps: { command, environment: {} } };
}
test('PP1FM04_targetProvenanceMustMatch', async t => {
  const f = await fixture(t), result = await inspectTarget(f.root, f.deps, { apiState: 'running' });
  assert.equal(result.target.targetId, `pp1-local:${runId}`); assert.equal(result.target.databaseOid, 16384);
  assert.equal(result.jdbcUrl, 'jdbc:postgresql://172.31.0.2:5432/cms'); assert.equal(result.dataGateway, '172.31.0.1');
  assert.deepEqual(result.target.apiBuild, f.receipt.apiBuild); assert.equal(result.target.mediaProbeSha256, sha('probe'));
  for (const mutate of [() => { f.state.apiLabels['org.cms.pp1.source-commit'] = 'c'.repeat(40); },
    () => { f.state.apiLabels['org.cms.pp1.jar-sha256'] = full(0); }, () => { f.state.apiLabels['org.cms.pp1.base-image'] = image(0); }]) {
    const original = structuredClone(f.state.apiLabels); mutate();
    await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), { message: 'QUIESCENCE_NOT_PROVEN' }); f.state.apiLabels = original;
  }
  assert.ok(f.calls.every(args => !['stop', 'start', 'run', 'rm'].includes(args[2])));
});
test('PP1FM04 artifact drift and malformed source fail closed', async t => {
  for (const artifact of ['jar', 'node', 'script']) { const f = await fixture(t); await writeFile(f[artifact], 'changed');
    await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), { message: 'QUIESCENCE_NOT_PROVEN' }); }
  for (const mutate of [f => { f.receipt.sourceCommit = 'bad'; }, f => { f.artifacts.apiBuild.jarSha256 = full(0); },
    f => { f.receipt.images.api = 'mutable'; }, f => { f.state.oid = ''; }, f => { f.state.oid = 'false'; }]) {
    const f = await fixture(t); mutate(f); await f.save(); await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/);
  }
});
test('PP1FM04 target never publishes DB ports or changes topology', async t => {
  for (const mutate of [f => { f.state.containers[0].HostConfig.PortBindings = { '5432/tcp': [{}] }; },
    f => { f.state.containers[1].NetworkSettings.Ports = { '8080/tcp': [{}] }; }, f => { f.state.containers[0].HostConfig.NetworkMode = 'host'; },
    f => { f.state.containers[0].Id = 'short'; }, f => { f.state.networks[0].Id = 'short'; },
    f => { f.state.networks[0].Containers[full(0)] = {}; }, f => { f.state.containers[0].Mounts.push({}); },
    f => { f.state.volumes[0].Labels['com.docker.compose.project'] = 'foreign'; },
    f => { f.state.containers[0].NetworkSettings.Networks[`${project}_data`].Aliases.push('other'); },
    f => { f.state.containers[0].NetworkSettings.Networks[`${project}_data`].IPAddress = '8.8.8.8'; }]) {
    const f = await fixture(t); mutate(f); await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/);
  }
});
test('PP1FM04 private metadata/ancestor safety rejects before Docker', async t => {
  for (const kind of ['root mode', 'file mode', 'hardlink', 'symlink', 'ancestor', 'json', 'remote']) {
    const f = await fixture(t), path = join(f.root, 'receipt.json'); let root = f.root;
    if (kind === 'root mode') await chmod(f.root, 0o755);
    if (kind === 'file mode') await chmod(path, 0o644);
    if (kind === 'hardlink') await link(path, join(f.root, 'other'));
    if (kind === 'symlink') { await rm(path); await symlink(f.jar, path); }
    if (kind === 'ancestor') { await mkdir(join(f.cwd, 'alias')); await symlink(join(f.cwd, 'local'), join(f.cwd, 'alias/local')); root = join(f.cwd, 'alias/local/pp1', runId); }
    if (kind === 'json') await writeFile(path, 'false');
    if (kind === 'remote') f.deps.environment = { DOCKER_HOST: 'tcp://remote:2375' };
    await assert.rejects(inspectTarget(root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/); assert.equal(f.calls.length, 0);
  }
});
test('PP1FM04 persistent metadata exact schema/generation and mode', async t => {
  const f = await fixture(t), inspection = await inspectTarget(f.root, f.deps, { apiState: 'running' });
  const directory = join(f.root, 'maintenance'), path = join(directory, 'target.json'); await mkdir(directory, { mode: 0o700 });
  for (const target of [false, {}, { ...inspection.target, jdbcUrl: inspection.jdbcUrl }, { ...inspection.target, containerIds: { ...inspection.target.containerIds, postgres: full(0) } }]) {
    await writeFile(path, JSON.stringify(target), { mode: 0o600 }); await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/);
  }
  await writeFile(path, JSON.stringify(inspection.target)); assert.deepEqual((await inspectTarget(f.root, f.deps, { apiState: 'running' })).target, inspection.target);
  await chmod(directory, 0o755); await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/); await chmod(directory, 0o700);
  await chmod(path, 0o644); await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/);
});
test('PP1FM04 derives fresh PG IP and verifies stopped API plus unknown writers', async t => {
  const f = await fixture(t), pg = f.state.containers[0], data = f.state.networks[1], api = f.state.containers[1];
  pg.NetworkSettings.Networks[data.Name].IPAddress = '172.31.0.19'; data.Containers[pg.Id].IPv4Address = '172.31.0.19/16';
  assert.equal((await inspectTarget(f.root, f.deps, { apiState: 'running' })).jdbcUrl, 'jdbc:postgresql://172.31.0.19:5432/cms');
  await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'stopped' }), /QUIESCENCE_NOT_PROVEN/);
  api.State.Running = false; for (const n of f.state.networks) { delete n.Containers[api.Id]; api.NetworkSettings.Networks[n.Name].IPAddress = ''; }
  assert.equal((await inspectTarget(f.root, f.deps, { apiState: 'stopped' })).target.containerIds['cms-api'], api.Id);
  const stranger = { Id: full(0), Config: { Labels: {} }, NetworkSettings: { Networks: {} }, Mounts: [{ Name: `${project}_media-data` }] }; f.state.containers.push(stranger);
  await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'stopped' }), /QUIESCENCE_NOT_PROVEN/);
  stranger.Mounts = []; stranger.NetworkSettings.Networks[data.Name] = {}; await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'stopped' }), /QUIESCENCE_NOT_PROVEN/);
});
test('PP1FM04 malformed output/env/dist and all service ports fail closed', async t => {
  for (const mutate of [f => { f.state.containers[1].Config.Env.push('SPRING_DATASOURCE_PASSWORD=canary'); },
    f => { f.state.containers[0].Config.Env[0] = 'POSTGRES_DB=other'; }, f => { f.state.networks[1].IPAM.Config[0].Gateway = '8.8.8.8'; },
    f => { f.state.containers[2].Image = image(0); }, f => { f.state.containers[2].HostConfig.RestartPolicy.Name = 'always'; },
    f => { f.state.containers[2].NetworkSettings.Ports = { '8443/tcp': [{}] }; },
    f => { f.state.containers[2].HostConfig.PortBindings = { '8443/tcp': [{}] }; }]) {
    const f = await fixture(t); mutate(f); await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/);
  }
  const f = await fixture(t); await writeFile(join(f.cwd, 'apps/web-front/dist/index.html'), 'changed'); await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/);
  for (const output of ['false', '[]', '', '{broken']) await assert.rejects(inspectTarget(f.root, { ...f.deps, command: async () => ({ stdout: output }) }, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/);
});
test('PP1FM04 media probe uses exact owned no-network readonly pinned tuple', async t => {
  const f = await fixture(t), inspection = await inspectTarget(f.root, f.deps, { apiState: 'running' }), operationId = '12345678-1234-4234-8234-123456789abc';
  const command = mediaProbeCommand(inspection, operationId); assert.equal(command.file, 'docker');
  assert.deepEqual(command.args, ['--host', 'unix:///var/run/docker.sock', 'run', '--rm', '--pull', 'never', '--name', `${project}-media-probe-${operationId}`,
    '--label', `org.cms.pp1.run-id=${runId}`, '--label', `org.cms.pp1.operation-id=${operationId}`, '--label', 'org.cms.pp1.role=media-probe',
    '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', `type=volume,src=${project}_media-data,dst=/media,readonly`, '--mount', `type=bind,src=${f.node},dst=/opt/pp1-node,readonly`,
    '--mount', `type=bind,src=${f.probe},dst=/tool/probe.mjs,readonly`, '--entrypoint', '/opt/pp1-node', f.receipt.images.node, '/tool/probe.mjs']);
  assert.equal(command.options.timeout, 30000); assert.equal(command.options.shell, false);
  assert.throws(() => mediaProbeCommand(structuredClone(inspection), operationId), /QUIESCENCE_NOT_PROVEN/);
  assert.throws(() => mediaProbeCommand(inspection, '--host'), /QUIESCENCE_NOT_PROVEN/); assert.ok(Object.isFrozen(inspection.target.images));
  await mkdir(join(f.root, 'maintenance'), { mode: 0o700 });
  await writeFile(join(f.root, 'maintenance/target.json'), JSON.stringify(inspection.target), { mode: 0o600 });
  await writeFile(f.probe, 'changed'); await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/);
});
test('PP1FM04 owner UID and dependency errors use fixed rejection', async t => {
  const f = await fixture(t), uid = process.getuid(); t.mock.method(process, 'getuid', () => uid + 1);
  await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/); assert.equal(f.calls.length, 0); t.mock.restoreAll();
  await assert.rejects(inspectTarget(f.root, { ...f.deps, command: async () => { throw new Error('canary'); } }, { apiState: 'running' }), { message: 'QUIESCENCE_NOT_PROVEN' });
});
test('PP1FM04 full mounts reject Source mismatch and overlapping foreign sources', async t => {
  for (const index of [0, 1]) { const wrong = await fixture(t); wrong.state.containers[index].Mounts[0].Source = '/foreign';
    await assert.rejects(inspectTarget(wrong.root, wrong.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/); }
  for (const type of ['bind', 'volume']) for (const source of [`/var/lib/docker/volumes/${project}_db-data/_data`, `/var/lib/docker/volumes/${project}_media-data/_data/sub`, '/var/lib/docker/volumes', '/']) {
    const f = await fixture(t); f.state.containers.push({ Id: full(0), Config: { Labels: {} }, NetworkSettings: { Networks: {} },
      Mounts: [{ Type: type, Name: 'foreign-volume', Source: source, Destination: '/writer', RW: true }] });
    await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/);
  }
  for (const mountpoint of ['relative', '', '/var/lib/docker/volumes/../escaped']) {
    const f = await fixture(t); f.state.volumes[0].Mountpoint = mountpoint;
    await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/);
  }
  const f = await fixture(t); f.state.containers.push({ Id: full(0), Config: { Labels: {} }, NetworkSettings: { Networks: {} },
    Mounts: [{ Type: 'bind', Source: `/var/lib/docker/volumes/${project}_db-data_extra/_data`, Destination: '/unrelated', RW: true }] });
  assert.equal((await inspectTarget(f.root, f.deps, { apiState: 'running' })).target.databaseOid, 16384);
});
test('PP1FM04 media tree permits empty directories and rejects file/symlink/read errors', async t => {
  const f = await fixture(t), media = join(f.cwd, 'media'); await mkdir(join(media, 'nested/empty'), { recursive: true });
  assert.equal(await isEmpty(media), true); await writeFile(join(media, 'file'), 'canary'); assert.equal(await isEmpty(media), false); await rm(join(media, 'file'));
  await symlink(join(media, 'nested'), join(media, 'link')); assert.equal(await isEmpty(media), false); await rm(join(media, 'link'));
  assert.equal(await isEmpty(join(media, 'missing')), false); assert.equal(await isEmpty(f.jar), false);
  await chmod(join(media, 'nested'), 0o000); assert.equal(await isEmpty(media), false); await chmod(join(media, 'nested'), 0o755);
  const cli = spawnSync(process.execPath, [new URL('./maintenance-media-probe.mjs', import.meta.url).pathname, '--root', media], { encoding: 'utf8' });
  assert.equal(cli.status, 6); assert.equal(cli.stdout, 'NOT_EMPTY\n'); assert.equal(cli.stderr, '');
});

test('PP1FM04 internal endpoints without default routes bind only the verified IPAM gateway', async t => {
  const f = await fixture(t);
  for (const c of f.state.containers) for (const endpoint of Object.values(c.NetworkSettings.Networks)) endpoint.Gateway = '';
  const inspection = await inspectTarget(f.root, f.deps, { apiState: 'running' });
  assert.equal(inspection.dataGateway, '172.31.0.1');
  for (const gateway of ['172.31.0.99', '8.8.8.8', null, undefined]) {
    f.state.containers[0].NetworkSettings.Networks[`${project}_data`].Gateway = gateway;
    await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/);
  }
  f.state.containers[0].NetworkSettings.Networks[`${project}_data`].Gateway = '';
  for (const mutate of [() => { f.state.networks[1].Internal = false; },
    () => { f.state.networks[1].Driver = 'overlay'; },
    () => { f.state.networks[1].IPAM.Config[0].Gateway = '8.8.8.8'; },
    () => { f.state.networks[1].IPAM.Config[0].Gateway = '172.30.0.1'; }]) {
    const original = structuredClone(f.state.networks[1]); mutate();
    await assert.rejects(inspectTarget(f.root, f.deps, { apiState: 'running' }), /QUIESCENCE_NOT_PROVEN/);
    f.state.networks[1] = original;
  }
});
