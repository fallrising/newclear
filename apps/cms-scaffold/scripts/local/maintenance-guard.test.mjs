import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, symlink, link, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { inspectTarget } from './maintenance-target.mjs';
import { acquire, assertQuiesced, bindBackend, finish } from './maintenance-guard.mjs';
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
  const calls = [], state = { containers, networks, volumes, apiLabels, nodeLabels: {'org.opencontainers.image.ref.name':'ubuntu','org.opencontainers.image.version':'24.04'}, oid: '16384\n' };
  const save = async () => { for (const [name, data] of [['receipt', receipt], ['artifacts', artifacts]]) await writeFile(join(root, `${name}.json`), JSON.stringify(data), { mode: 0o600 }); }; await save();
  const command = async (file, args, options) => {
    assert.equal(file, 'docker'); assert.deepEqual(args.slice(0, 2), ['--host', 'unix:///var/run/docker.sock']);
    assert.equal(options.shell, false); assert.equal(options.timeout, 30000); calls.push(args);
    const a = args.slice(2); let result;
    if (a[0] === 'ps') result = containers.map(c => c.Id).join('\n');
    else if (a[0] === 'inspect') result = JSON.stringify(containers);
    else if (a[0] === 'network') result = JSON.stringify(networks);
    else if (a[0] === 'volume') result = JSON.stringify(volumes);
    else if (a[0] === 'image') { const kind = kinds.find(k => a.at(-1) === receipt.imageRefs[k]) ?? kinds.find(k => images[k] === a.at(-1)); result = JSON.stringify([{ Id: kind ? images[kind] : apiBuild.baseImage, Os: 'linux', Config: { Labels: kind === 'api' ? state.apiLabels : kind === 'node' ? state.nodeLabels : {} } }]); }
    else if (a[0] === 'exec') { assert.deepEqual(a, ['exec', full(1), 'psql', '-X', '-q', '-t', '-A', '-U', 'cms_local', '-d', 'cms', '-c', 'SELECT oid FROM pg_database WHERE datname = current_database();']); result = state.oid; }
    else assert.fail(`unexpected mutation ${a[0]}`);
    return { stdout: result, stderr: '' };
  };
  return { cwd, root, jar, node, script, probe, receipt, artifacts, state, calls, save, deps: { command, environment: {} } };
}
const firstOp = '11111111-1111-4111-8111-111111111111', secondOp = '22222222-2222-4222-8222-222222222222';
async function owned(t) {
  const f = await fixture(t), original = f.deps.command;
  f.deps.cwd = f.cwd; f.state.backends = []; f.state.dirty = false;
  const initialNetworks = structuredClone(f.state.containers[1].NetworkSettings.Networks);
  const rows = structuredClone(f.state.networks.map(n => n.Containers[f.state.containers[1].Id]));
  f.deps.command = async (file, args, options) => {
    assert.equal(file, 'docker'); const a = args.slice(2), api = f.state.containers[1];
    if (a[0] === 'create') {
      f.calls.push(args); const labels = {};
      a.forEach((value,i) => { if (value==='--label') { const [k,v]=a[i+1].split('='); labels[k]=v; } });
      const mounts=[]; a.forEach((value,i)=>{ if (value==='--mount') {
        const m=Object.fromEntries(a[i+1].split(',').filter(v=>v.includes('=')).map(v=>v.split('=')));
        mounts.push({Type:m.type,Name:m.type==='volume'?m.src:undefined,Source:m.type==='volume'?f.state.volumes[1].Mountpoint:m.src,Destination:m.dst,RW:false});
      } });
      f.state.probe={Id:full(0),Name:'/'+a[a.indexOf('--name')+1],Image:a.at(-2),State:{Running:false},
        Config:{Labels:{...f.state.nodeLabels,...labels},Entrypoint:['/opt/pp1-node'],Cmd:['/tool/probe.mjs']},
        HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,RestartPolicy:{Name:'no'},CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],PortBindings:{}},
        NetworkSettings:{Networks:{none:{}},Ports:{}},Mounts:mounts};
      f.state.changeProbe?.(f.state.probe); return {stdout:full(0)+'\n'};
    }
    if (a[0]==='inspect' && a[1]==='--format') { f.calls.push(args); if (f.state.healthFault) throw new Error('private-canary'); return {stdout:'healthy\n'}; }
    if (a[0]==='inspect' && a[1]===full(0)) { f.calls.push(args); return {stdout:JSON.stringify([f.state.probe])}; }
    if (['start','wait','logs','rm'].includes(a[0]) && a.at(-1)===full(0)) {
      f.calls.push(args); if (f.state.failCommand===a[0]) throw new Error('private-canary');
      if (a[0]==='wait') { f.state.afterProbe?.(); return {stdout:'0\n'}; }
      if (a[0]==='logs') return {stdout:f.state.notEmpty?'NOT_EMPTY\n':'EMPTY\n'};
      if (a[0]==='rm') f.state.probe=null;
      return {stdout:full(0)+'\n'};
    }
    if (a[0]==='volume' && a.length===3) return {stdout:JSON.stringify([f.state.volumes[1]])};
    if (a[0] === 'stop') {
      assert.deepEqual(a, ['stop', '--time', '30', api.Id]); f.calls.push(args); api.State.Running = false;
      for (const n of f.state.networks) { delete n.Containers[api.Id]; api.NetworkSettings.Networks[n.Name].IPAddress = ''; }
      return { stdout: api.Id + '\n' };
    }
    if (a[0] === 'start' && a[1] === api.Id) {
      f.calls.push(args); api.State.Running = true; api.NetworkSettings.Networks = structuredClone(initialNetworks);
      f.state.networks.forEach((n, i) => { n.Containers[api.Id] = structuredClone(rows[i]); }); return { stdout: api.Id + '\n' };
    }
    if (a[0] === 'exec' && a[2] === 'psql' && !a.at(-1).startsWith('SELECT oid')) {
      f.calls.push(args); return { stdout: a.at(-1).includes('pg_stat_activity') ? JSON.stringify(f.state.backends) : f.state.dirty ? 't\n' : 'f\n' };
    }
    return original(file, args, options);
  };
  f.inspection = await inspectTarget(f.root, f.deps, { apiState: 'running' }); f.calls.length = 0;
  f.operation = { operationId: firstOp, operation: 'FRESH_INIT' };
  return f;
}
const tuple = (f, changes = {}) => ({ pid: 101, backend_start_epoch: '1791540000.000001', usename: 'cms_local', datname: 'cms',
  application_name: firstOp, client_addr: f.inspection.dataGateway, state: 'idle', ...changes });
test('PP1FM04_lockAndReservationAreExclusive', async t => {
  const f = await owned(t), lease = await acquire(f.inspection, f.operation, f.deps);
  assert.equal(lease.phase, 'PRE_CONNECTION'); assert.equal(lease.boundBackend, null);
  await assert.rejects(acquire(f.inspection, { operationId: secondOp, operation: 'FRESH_INIT' }, f.deps), /MAINTENANCE_BUSY/);
  await assertQuiesced(lease, f.deps); assert.equal(f.state.containers[1].State.Running, false);
});
test('PP1FM04_recoverRequiresVerifiedRollbackBeforeStop', async t => {
  const f = await owned(t);
  await assert.rejects(acquire(f.inspection, { operationId: firstOp, operation: 'RECOVER_ADMIN' }, f.deps), /RECOVERY_BACKUP_REQUIRED/);
  assert.ok(!f.calls.some(a => a[2] === 'stop'));
});
test('PP1FM04_acquireBackendPinIsExact', async t => {
  const f = await owned(t), lease = await acquire(f.inspection, f.operation, f.deps);
  f.state.backends = [tuple(f)]; await bindBackend(lease, 101, '1791540000.000001', f.deps);
  await assertQuiesced(lease, f.deps); await assert.rejects(bindBackend(lease, 101, '1791540000.000001', f.deps), /QUIESCENCE_NOT_PROVEN/);
  for (const records of [[], [tuple(f, { pid: 102 })], [tuple(f, { backend_start_epoch: '1791540000.000002' })],
    [tuple(f), tuple(f, { pid: 102 })], [tuple(f, { client_addr: null })], [tuple(f, { client_addr: f.inspection.dataGateway + '/32' })]]) {
    f.state.backends = records; await assert.rejects(assertQuiesced(lease, f.deps), /QUIESCENCE_NOT_PROVEN/);
  }
});
test('PP1FM04_writerRestartAndIdleBackendReject', async t => {
  for (const change of [f => { f.state.backends = [tuple(f)]; }, f => { f.state.containers[1].State.Running = true; },
    f => { f.state.containers[1].HostConfig.RestartPolicy.Name = 'always'; }]) {
    const f = await owned(t), lease = await acquire(f.inspection, f.operation, f.deps); change(f);
    await assert.rejects(assertQuiesced(lease, f.deps), /QUIESCENCE_NOT_PROVEN/);
  }
});
test('PP1FM04_unknownFailureNeverRestartsOrReleases', async t => {
  const f = await owned(t), lease = await acquire(f.inspection, f.operation, f.deps);
  await finish(lease, 5, f.deps); assert.equal(f.state.containers[1].State.Running, false);
  await assert.rejects(acquire(f.inspection, { operationId: secondOp, operation: 'FRESH_INIT' }, f.deps), /MAINTENANCE_BUSY/);
  const journal = JSON.parse(await readFile(join(f.root, 'maintenance/operations', firstOp + '.json')));
  assert.equal(journal.phase, 'FAILED_OR_UNKNOWN');
});
test('PP1FM04_concurrentReservationNeverStopsSecondOperation', async t => {
  const f = await owned(t), command = f.deps.command; let release, reached;
  const entered = new Promise(resolve => { reached = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  f.deps.command = async (...args) => { if (args[1][2] === 'stop') { reached(); await blocked; } return command(...args); };
  const first = acquire(f.inspection, f.operation, f.deps);
  // Scaffold rejection must be observable without hanging the deferred command.
  let timer;
  try {
    await Promise.race([entered, first, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deferred deadline')), 2000); })]);
    await assert.rejects(acquire(f.inspection, { operationId: secondOp, operation: 'FRESH_INIT' }, f.deps), /MAINTENANCE_BUSY/);
  } finally { clearTimeout(timer); release(); }
  const lease = await first; assert.equal(lease.operationId, firstOp);
  assert.equal(f.calls.filter(a => a[2] === 'stop').length, 1);
});
async function installed(t) {
  const f = await owned(t); await f.deps.command('docker', ['--host','unix:///var/run/docker.sock','stop','--time','30', f.inspection.target.containerIds['cms-api']], {});
  const base = join(f.root, 'maintenance'); for (const dir of [base, join(base,'operations'), join(base,'operation.lock')]) await mkdir(dir, { mode: 0o700 });
  f.lease = { ...f.inspection.target, connection: { jdbcUrl: f.inspection.jdbcUrl, dataGateway: f.inspection.dataGateway }, ...f.operation,
    releaseId: 'sha256:' + f.inspection.target.apiBuild.jarSha256, phase: 'PRE_CONNECTION', boundBackend: null, createdAt: '2026-10-09T00:00:00.000Z' };
  await writeFile(join(base,'target.json'), JSON.stringify(f.inspection.target), { mode: 0o600 });
  await writeFile(join(base,'lease.json'), JSON.stringify(f.lease), { mode: 0o600 });
  await writeFile(join(base,'operations',firstOp+'.json'), JSON.stringify({ ...f.operation, targetId: f.lease.targetId, releaseId: f.lease.releaseId,
    phase: f.lease.phase, at: f.lease.createdAt, failureCode: null }), { mode: 0o600 }); return f;
}
test('metadata live and backend primitive core', async t => {
  const f = await installed(t); await assertQuiesced(f.lease, f.deps);
  f.state.backends = [tuple(f)]; await bindBackend(f.lease, 101, '1791540000.000001', f.deps); await assertQuiesced(f.lease, f.deps);
  await assert.rejects(bindBackend(f.lease, 101, '1791540000.000001', f.deps), /QUIESCENCE_NOT_PROVEN/);
  for (const changes of [{ datname:'other' }, { usename:'other' }, { application_name:secondOp }, { state:null }, { state:'invented' },
    { pid:102 }, { backend_start_epoch:'1791540000.000002' }, { client_addr:null }, { client_addr:f.inspection.dataGateway+'/32' }]) {
    f.state.backends = [tuple(f, changes)]; await assert.rejects(assertQuiesced(f.lease, f.deps), /QUIESCENCE_NOT_PROVEN/);
  }
  for (const rows of [[], [tuple(f),tuple(f,{pid:102})]]) { f.state.backends=rows; await assert.rejects(assertQuiesced(f.lease,f.deps), /QUIESCENCE_NOT_PROVEN/); }
});
test('metadata private input and live destination are immutable', async t => {
  for (const vector of ['key','connection','mode','hardlink','symlink','uid','ip']) {
    const f=await installed(t), path=join(f.root,'maintenance/lease.json');
    if (vector==='key') await writeFile(path, JSON.stringify({...f.lease,extra:true}));
    if (vector==='connection') await writeFile(path, JSON.stringify({...f.lease,connection:{...f.lease.connection,extra:true}}));
    if (vector==='mode') await chmod(path,0o644);
    if (vector==='hardlink') await link(path,join(f.root,'maintenance/alias'));
    if (vector==='symlink') { await rm(path); await symlink(f.jar,path); }
    if (vector==='uid') { const uid=process.getuid(); t.mock.method(process,'getuid',()=>uid+1); }
    if (vector==='ip') { f.state.containers[0].NetworkSettings.Networks[`${project}_data`].IPAddress='172.31.0.19'; f.state.networks[1].Containers[full(1)].IPv4Address='172.31.0.19/16'; }
    await assert.rejects(assertQuiesced(f.lease,f.deps), /QUIESCENCE_NOT_PROVEN/); t.mock.restoreAll();
  }
});
test('helper CLI has fixed readonly inspect and rejects unknown inputs', async t => {
  const f=await installed(t), script=new URL('./maintenance-guard.mjs',import.meta.url).pathname;
  const result=spawnSync(process.execPath,[script,'inspect','--run-id',runId],{cwd:f.cwd,encoding:'utf8',timeout:2000});
  assert.equal(result.status,0); assert.deepEqual(JSON.parse(result.stdout),{operationId:firstOp,phase:'PRE_CONNECTION'});
  for (const args of [['inspect','--run-id',runId,'--force','true'],['assert','--run-id',runId,'--operation-id',firstOp,'--phase','other'],['bind-backend','--run-id',runId,'--operation-id',firstOp,'--pid','0','--backend-start-epoch','1.0001']]) {
    const fail=spawnSync(process.execPath,[script,...args],{cwd:f.cwd,encoding:'utf8',timeout:2000}); assert.equal(fail.status,6); assert.equal(fail.stdout,''); assert.equal(fail.stderr,'QUIESCENCE_NOT_PROVEN\n');
  }
});
test('PP1FM04_existingRegistryNeverReplaysOrStops', async t => {
  const f = await owned(t), operations = join(f.root, 'maintenance/operations'); await mkdir(operations, { recursive: true, mode: 0o700 });
  await writeFile(join(operations, firstOp + '.json'), JSON.stringify({ operationId: firstOp, operation: 'FRESH_INIT', targetId: f.inspection.target.targetId,
    releaseId: 'sha256:' + f.inspection.target.apiBuild.jarSha256, phase: 'FAILED_OR_UNKNOWN', at: '2026-10-09T00:00:00.000Z', failureCode: 'QUIESCENCE_NOT_PROVEN' }), { mode: 0o600 });
  await assert.rejects(acquire(f.inspection, f.operation, f.deps), /DUPLICATE_OPERATION/);
  assert.ok(!f.calls.some(a => a[2] === 'stop')); assert.equal(f.state.containers[1].State.Running, true);
});
test('PP1FM04_privateLeaseMetadataFailsClosed', async t => {
  for (const vector of ['unknown key', 'missing key', 'false', 'mode', 'hardlink', 'symlink', 'parent mode']) {
    const f = await owned(t), lease = await acquire(f.inspection, f.operation, f.deps), path = join(f.root, 'maintenance/lease.json');
    const original = await readFile(path, 'utf8'), value = JSON.parse(original);
    if (vector === 'unknown key') { value.extra = true; await writeFile(path, JSON.stringify(value)); }
    if (vector === 'missing key') { delete value.operationId; await writeFile(path, JSON.stringify(value)); }
    if (vector === 'false') await writeFile(path, 'false');
    if (vector === 'mode') await chmod(path, 0o644);
    if (vector === 'hardlink') await link(path, join(f.root, 'maintenance/alias.json'));
    if (vector === 'symlink') { await rm(path); await symlink(f.jar, path); }
    if (vector === 'parent mode') await chmod(join(f.root, 'maintenance'), 0o755);
    await assert.rejects(assertQuiesced(lease, f.deps), /QUIESCENCE_NOT_PROVEN/);
  }
});
test('PP1FM04_pgTargetAndEpochDriftNeverRebind', async t => {
  const f = await owned(t), lease = await acquire(f.inspection, f.operation, f.deps), pg = f.state.containers[0], network = f.state.networks[1];
  const endpoint = pg.NetworkSettings.Networks[network.Name]; endpoint.IPAddress = '172.31.0.19'; network.Containers[pg.Id].IPv4Address = '172.31.0.19/16';
  await assert.rejects(assertQuiesced(lease, f.deps), /QUIESCENCE_NOT_PROVEN/);
  endpoint.IPAddress = '172.31.0.2'; network.Containers[pg.Id].IPv4Address = '172.31.0.2/16';
  for (const epoch of [null, '', '0.000001', '1791540000', '1791540000.0000010']) {
    f.state.backends = [tuple(f)]; await assert.rejects(bindBackend(lease, 101, epoch, f.deps), /QUIESCENCE_NOT_PROVEN/);
  }
});
test('probe exact inherited image labels and ownership reject before start', async t => {
  for (const mutate of [p=>{p.Config.Labels.extra='bad';},p=>{p.Config.Labels['org.opencontainers.image.version']='other';},
    p=>{p.HostConfig.ReadonlyRootfs=false;},p=>{p.HostConfig.SecurityOpt=[];},p=>{p.HostConfig.NetworkMode='host';},
    p=>{p.Image=image(9);},p=>{p.Id='short';},p=>{p.Mounts[0].Source='/wrong';},p=>{p.Mounts[1].RW=true;},p=>{p.Config.Cmd=['other'];}]) {
    const f=await owned(t); f.state.changeProbe=mutate;
    await assert.rejects(acquire(f.inspection,f.operation,f.deps), /QUIESCENCE_NOT_PROVEN/);
    assert.ok(!f.calls.some(a=>a[2]==='start')); assert.ok(!f.calls.some(a=>a[2]==='rm')); await lstat(join(f.root,'maintenance/operation.lock'));
  }
});
test('probe bounded failures clean only verified ID and preserve API lock', async t => {
  for (const command of ['start','wait','logs','rm']) {
    const f=await owned(t); f.state.failCommand=command;
    await assert.rejects(acquire(f.inspection,f.operation,f.deps), {message:'QUIESCENCE_NOT_PROVEN'});
    assert.ok(f.calls.some(a=>sameArgs(a.slice(2),['rm','--force',full(0)])));
    assert.equal(f.state.containers[1].State.Running,false); await lstat(join(f.root,'maintenance/operation.lock'));
  }
  for (const vector of ['notempty','writer']) {
    const f=await owned(t); if (vector==='notempty') f.state.notEmpty=true;
    else f.state.afterProbe=()=>{f.state.containers.push({Id:full(9),Config:{Labels:{}},NetworkSettings:{Networks:{}},Mounts:[{Type:'volume',Name:`${project}_media-data`,Source:f.state.volumes[1].Mountpoint}]});};
    await assert.rejects(acquire(f.inspection,f.operation,f.deps), /QUIESCENCE_NOT_PROVEN/); assert.equal(f.state.probe,null);
  }
});
const sameArgs=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
test('probe signals abort own wait cleanup and restore listener counts', async t => {
  for (const signal of ['SIGINT','SIGTERM']) for (const stage of ['wait','rm']) {
    const before=process.listenerCount(signal), f=await owned(t), original=f.deps.command;
    f.deps.command=async (file,args,options)=>{
      if (args[2]===stage) { process.emit(signal); if (stage==='wait') { assert.equal(options.signal.aborted,true); throw new Error('canary abort'); } }
      if (args[2]==='rm') assert.equal(options.signal,undefined);
      return original(file,args,options);
    };
    await assert.rejects(acquire(f.inspection,f.operation,f.deps), /QUIESCENCE_NOT_PROVEN/);
    assert.ok(f.calls.some(a=>a[2]==='rm'&&a.at(-1)===full(0))); assert.equal(f.state.containers[1].State.Running,false);
    assert.equal(process.listenerCount(signal),before); await lstat(join(f.root,'maintenance/operation.lock'));
  }
});
async function committed(t) {
  const f=await owned(t); f.lease=await acquire(f.inspection,f.operation,f.deps); f.state.backends=[tuple(f)];
  await bindBackend(f.lease,101,'1791540000.000001',f.deps); f.state.backends=[];
  f.result={operationId:firstOp,operation:'FRESH_INIT',principalId:'33333333-3333-4333-8333-333333333333',completedAt:'2026-10-09T12:00:00Z',releaseId:f.lease.releaseId,targetId:f.lease.targetId};
  f.resultPath=join(f.root,'maintenance/operations',firstOp+'.result.json'); await writeFile(f.resultPath,JSON.stringify(f.result),{mode:0o600}); return f;
}
test('commit receipt plus zero alone restarts same API and readonly COMPLETE survives release', async t => {
  const f=await committed(t); const complete=await finish(f.lease,0,f.deps); assert.equal(complete.phase,'COMPLETE'); assert.equal(f.state.containers[1].State.Running,true);
  await assert.rejects(lstat(join(f.root,'maintenance/operation.lock')),{code:'ENOENT'});
  assert.ok(f.calls.some(a=>sameArgs(a.slice(2),['start',full(2)])));
  const script=new URL('./maintenance-guard.mjs',import.meta.url).pathname;
  const output=spawnSync(process.execPath,[script,'inspect','--run-id',runId],{cwd:f.cwd,encoding:'utf8',timeout:2000}); assert.equal(output.status,0); assert.equal(JSON.parse(output.stdout).phase,'COMPLETE');
  await assert.rejects(acquire(f.inspection,f.operation,f.deps),/DUPLICATE_OPERATION/); await assert.rejects(lstat(join(f.root,'maintenance/operation.lock')),{code:'ENOENT'});
});
test('commit nonzero invalid receipt and health failures never release or replay', async t => {
  const failed=await committed(t); await assert.rejects(finish(failed.lease,5,failed.deps),/COMMITTED_HOST_RESTORE_FAILED/);
  assert.equal(JSON.parse(await readFile(join(failed.root,'maintenance/lease.json'))).phase,'COMMITTED'); assert.equal(failed.state.containers[1].State.Running,false);
  for (const vector of ['wrongtarget','unknownkey','mode','health']) {
    const f=await committed(t);
    if (vector==='wrongtarget') {f.result.targetId='other'; await writeFile(f.resultPath,JSON.stringify(f.result));}
    if (vector==='unknownkey') {f.result.extra=true; await writeFile(f.resultPath,JSON.stringify(f.result));}
    if (vector==='mode') await chmod(f.resultPath,0o644);
    if (vector==='health') f.state.healthFault=true;
    await assert.rejects(finish(f.lease,0,f.deps),/QUIESCENCE_NOT_PROVEN|COMMITTED_HOST_RESTORE_FAILED/);
    assert.equal(f.state.containers[1].State.Running,false); await lstat(join(f.root,'maintenance/operation.lock'));
    assert.equal(JSON.parse(await readFile(join(f.root,'maintenance/lease.json'))).phase,vector==='health'?'COMMITTED':'FAILED_OR_UNKNOWN');
  }
});
test('missing registry and corrupt journal never repair or unlock', async t => {
  for (const vector of ['missingjournal','unknownfailure']) {
    const f=await installed(t), path=join(f.root,'maintenance/operations',firstOp+'.json');
    if (vector==='missingjournal') await rm(path);
    else {const value=JSON.parse(await readFile(path)); value.failureCode='canary'; await writeFile(path,JSON.stringify(value));}
    await assert.rejects(assertQuiesced(f.lease,f.deps),/QUIESCENCE_NOT_PROVEN/); await lstat(join(f.root,'maintenance/operation.lock'));
  }
});
test('probe execution deadline aborts before extra command and cleanup remains bounded', async t => {
  const f=await owned(t), original=f.deps.command; let now=1000; f.deps.clock=()=>now;
  f.deps.command=async (file,args,options)=>{ const result=await original(file,args,options); if (args[2]==='start'&&args.at(-1)===full(0)) now+=30001; return result; };
  await assert.rejects(acquire(f.inspection,f.operation,f.deps),/QUIESCENCE_NOT_PROVEN/);
  assert.ok(!f.calls.some(a=>a[2]==='wait')); assert.ok(f.calls.some(a=>sameArgs(a.slice(2),['rm','--force',full(0)])));
  assert.equal(f.state.containers[1].State.Running,false); await lstat(join(f.root,'maintenance/operation.lock'));
});
test('health shared deadline rejects delayed start or healthy inspect without extra command', async t => {
  for (const stage of ['start','inspect']) {
    const f=await committed(t), original=f.deps.command; let now=1000; f.deps.clock=()=>now;
    f.deps.command=async (file,args,options)=>{ const result=await original(file,args,options);
      if (args.at(-1)===full(2) && (stage==='start' ? args[2]==='start' : args[2]==='inspect'&&args[3]==='--format')) now+=30001;
      if (args[2]==='stop') assert.equal(options.timeout,30000); return result;
    };
    await assert.rejects(finish(f.lease,0,f.deps),{message:'COMMITTED_HOST_RESTORE_FAILED'});
    assert.equal(f.state.containers[1].State.Running,false); await lstat(join(f.root,'maintenance/operation.lock'));
    assert.equal(JSON.parse(await readFile(join(f.root,'maintenance/lease.json'))).phase,'COMMITTED');
    assert.equal(f.calls.filter(a=>a[2]==='inspect'&&a[3]==='--format').length,stage==='start'?0:1);
  }
});
