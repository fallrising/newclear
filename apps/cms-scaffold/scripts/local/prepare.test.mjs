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
test('T146 private network allocator requires an original prepared receipt', async t => {
  const {createPreparedNetworks}=await import('./prepare.mjs'); assert.equal(typeof createPreparedNetworks,'function');
  const f=await fixture(t),receipt=await prepare(parseArgs(args),f.deps);
  await assert.rejects(createPreparedNetworks(structuredClone(receipt),f.deps),{code:'ADAPTER_UNSEALED'});
});
const routeHeader='Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n';
async function networkFixture(t) {
  const f=await fixture(t),original=f.deps.command,state={networks:[],creates:[],routes:routeHeader+'eth0 00000000 01011FAC 0003 0 0 100 00000000 0 0 0\n'};
  f.deps.readRoutes=async()=>state.routes;
  f.deps.command=async(file,argv)=>{
    const a=argv.slice(2);
    if(file==='docker'&&a[0]==='network'&&a[1]==='ls'&&!a.includes('--filter'))return{stdout:state.networks.map(n=>n.Id).join('\n')};
    if(file==='docker'&&a[0]==='network'&&a[1]==='inspect')return{stdout:JSON.stringify(state.networks.filter(n=>a.includes(n.Id)))};
    if(file==='docker'&&a[0]==='network'&&a[1]==='create'){
      state.creates.push(a);if(state.failAt===state.creates.length)throw Error('private-canary');
      const labels={};for(let i=0;i<a.length;i++)if(a[i]==='--label'){const value=a[++i],at=value.indexOf('=');labels[value.slice(0,at)]=value.slice(at+1);}
      const n={Id:String(state.creates.length+3).repeat(64),Name:a.at(-1),Driver:'bridge',Internal:true,Scope:'local',EnableIPv6:false,Attachable:false,Ingress:false,
        Labels:labels,Containers:{},Options:{},IPAM:{Driver:'default',Options:null,Config:[{Subnet:a[a.indexOf('--subnet')+1],Gateway:a[a.indexOf('--gateway')+1]}]}};
      state.mutateCreated?.(n);state.networks.push(n);return{stdout:n.Id+'\n'};
    }
    return original(file,argv);
  };
  f.networkState=state;return f;
}
test('T146 original prepare creates exactly two private /26s once and keeps CLI receipt shape',async t=>{
  const f=await networkFixture(t),{createPreparedNetworks}=await import('./prepare.mjs'),receipt=await prepare(parseArgs(args),f.deps);
  assert.equal(f.networkState.creates.length,0);const shape=Object.keys(receipt),result=await createPreparedNetworks(receipt,f.deps);
  assert.equal(result.web.subnet,'192.168.240.0/26');assert.equal(result.data.subnet,'192.168.240.64/26');
  assert.equal(result.web.gateway,'192.168.240.1');assert.equal(result.data.gateway,'192.168.240.65');assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.web));
  assert.deepEqual(Object.keys(receipt),shape);assert.equal(f.networkState.creates.length,2);
  const root=join(f.cwd,'local/pp1',id);for(const name of ['network-attempt.json','created-network-web.json','created-network-data.json','prepared-networks.json'])assert.equal((await stat(join(root,name))).mode&0o777,0o600);
  assert.equal(JSON.parse(await readFile(join(root,'prepared-networks.json'),'utf8')).networks.data.id,result.data.id);
  await assert.rejects(createPreparedNetworks(receipt,f.deps),{code:'ADAPTER_UNSEALED'});assert.equal(f.networkState.creates.length,2);
});
test('T146 receipt mutation crosscwd and replaced private receipt reject before network create',async t=>{
  const {createPreparedNetworks}=await import('./prepare.mjs');
  for(const fault of ['mutation','cwd','file','runner']){
    const f=await networkFixture(t),receipt=await prepare(parseArgs(args),f.deps),deps={...f.deps};
    if(fault==='mutation')receipt.project='other';if(fault==='cwd')deps.cwd='/tmp';if(fault==='runner')deps.command=async()=>({stdout:''});
    if(fault==='file')await writeFile(join(f.cwd,'local/pp1',id,'receipt.json'),'{}');
    await assert.rejects(createPreparedNetworks(receipt,deps),{code:'ADAPTER_UNSEALED'});assert.equal(f.networkState.creates.length,0);
  }
});
test('T146 private allocation fails closed on routes capacity and partial second create',async t=>{
  const {createPreparedNetworks}=await import('./prepare.mjs');
  for(const fault of ['route','mask','capacity','single','partial','identity']){
    const f=await networkFixture(t),s=f.networkState,receipt=await prepare(parseArgs(args),f.deps);
    if(fault==='route')s.routes='malformed';
    if(fault==='mask')s.routes=routeHeader+'eth0 0000A8C0 00000000 0001 0 0 0 00F0FF00 0 0 0\n';
    if(fault==='capacity'||fault==='single')for(let i=0;i<(fault==='single'?63:64);i++)s.networks.push(occupiedNetwork(i,`192.168.${240+Math.floor(i/4)}.${(i%4)*64}/26`));
    if(fault==='partial')s.failAt=2;if(fault==='identity')s.mutateCreated=n=>{n.Internal=false;};
    await assert.rejects(createPreparedNetworks(receipt,f.deps),{code:'ADAPTER_UNSEALED'});
    assert.equal(s.creates.length,fault==='partial'?2:fault==='identity'?1:0);
    if(fault==='partial')assert.equal(s.networks.length,1);
    await assert.rejects(createPreparedNetworks(receipt,f.deps),{code:'ADAPTER_UNSEALED'});
  }
});
test('T146 main-table overlap handles default then /24 and nested host routes',async t=>{
  const {createPreparedNetworks}=await import('./prepare.mjs');
  for(const row of ['br0 00F0A8C0 00000000 0001 0 0 0 00FFFFFF 0 0 0','eth0 80F0A8C0 00000000 0001 0 0 0 80FFFFFF 0 0 0']){
    const f=await networkFixture(t);f.networkState.routes+=row+'\n';const receipt=await prepare(parseArgs(args),f.deps);
    const result=await createPreparedNetworks(receipt,f.deps),third=row.includes('80F0A8C0')?240:241;
    assert.equal(result.web.subnet,`192.168.${third}.0/26`);assert.equal(result.data.subnet,`192.168.${third}.64/26`);
  }
  const f=await networkFixture(t);f.networkState.routes+='eth0 0000A8C0 00000000 0001 0 0 0 0000FFFF 0 0 0\n';
  const receipt=await prepare(parseArgs(args),f.deps);await assert.rejects(createPreparedNetworks(receipt,f.deps),{code:'ADAPTER_UNSEALED'});assert.equal(f.networkState.creates.length,0);
});
test('T146 race consumes receipt and retains prior creation without selecting replacement',async t=>{
  const {createPreparedNetworks}=await import('./prepare.mjs');
  for(const raceAt of [2,3]){
    const f=await networkFixture(t);let reads=0;
    f.deps.readRoutes=async()=>++reads===raceAt?routeHeader+'br0 00F0A8C0 00000000 0001 0 0 0 00F0FFFF 0 0 0\n':routeHeader;
    const receipt=await prepare(parseArgs(args),f.deps);await assert.rejects(createPreparedNetworks(receipt,f.deps),{code:'ADAPTER_UNSEALED'});
    assert.equal(f.networkState.creates.length,raceAt===2?0:1);assert.equal(f.networkState.networks.length,raceAt===2?0:1);
    await assert.rejects(createPreparedNetworks(receipt,f.deps),{code:'ADAPTER_UNSEALED'});
    await assert.rejects(readFile(join(f.cwd,'local/pp1',id,'prepared-networks.json')),{code:'ENOENT'});
  }
});
test('T146 parallel calls share one consumption and never create four networks',async t=>{
  const f=await networkFixture(t),{createPreparedNetworks}=await import('./prepare.mjs'),receipt=await prepare(parseArgs(args),f.deps);
  const results=await Promise.allSettled([createPreparedNetworks(receipt,f.deps),createPreparedNetworks(receipt,f.deps)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='ADAPTER_UNSEALED').length,1);
  assert.equal(f.networkState.creates.length,2);
});
test('T146 unknown global IPAM routes and preexisting namespace are never silently ignored',async t=>{
  const {createPreparedNetworks}=await import('./prepare.mjs');
  for(const fault of ['name','label','ipv6','noncanonical','gateway','driver','route-flags','route-columns']){
    const f=await networkFixture(t),receipt=await prepare(parseArgs(args),f.deps);
    const n={Id:'f'.repeat(64),Name:'foreign',Driver:'bridge',Labels:{},IPAM:{Driver:'default',Config:[{Subnet:'172.17.0.0/16',Gateway:'172.17.0.1'}]}};
    if(fault==='name')n.Name=`cms-pp1-local-${id}_web`;if(fault==='label')n.Labels['com.docker.compose.project']=receipt.project;
    if(fault==='ipv6')n.IPAM.Config[0].Subnet='fd00::/64';if(fault==='noncanonical')n.IPAM.Config[0].Subnet='192.168.240.1/24';
    if(fault==='gateway')n.IPAM.Config[0].Gateway='192.168.240.1';if(fault==='driver')n.Driver='overlay';
    f.networkState.networks.push(n);
    if(fault==='route-flags')f.networkState.routes=routeHeader+'eth0 0000A8C0 00000000 0009 0 0 0 0000FFFF 0 0 0\n';
    if(fault==='route-columns')f.networkState.routes=routeHeader+'eth0 0000A8C0\n';
    await assert.rejects(createPreparedNetworks(receipt,f.deps),{code:'ADAPTER_UNSEALED'});assert.equal(f.networkState.creates.length,0);
  }
});
test('T146 created network security and final pair drift retain partial evidence',async t=>{
  const {createPreparedNetworks}=await import('./prepare.mjs');
  for(const fault of ['id','name','labels','containers','options','scope','ipam','ipv6','attachable','ingress','final-first-drift']){
    const f=await networkFixture(t),s=f.networkState;
    s.mutateCreated=n=>{
      if(fault==='id')n.Id='short';if(fault==='name')n.Name='other';if(fault==='labels')n.Labels.extra='other';
      if(fault==='containers')n.Containers.foreign={};if(fault==='options')n.Options.extra='unsafe';if(fault==='scope')n.Scope='swarm';
      if(fault==='ipam')n.IPAM.Config[0].Subnet='192.168.255.0/24';if(fault==='ipv6')n.EnableIPv6=true;
      if(fault==='attachable')n.Attachable=true;if(fault==='ingress')n.Ingress=true;
      if(fault==='final-first-drift'&&s.creates.length===2)s.networks[0].Internal=false;
    };
    const receipt=await prepare(parseArgs(args),f.deps);await assert.rejects(createPreparedNetworks(receipt,f.deps),{code:'ADAPTER_UNSEALED'});
    assert.equal(s.creates.length,fault==='final-first-drift'?2:1);assert.equal(s.networks.length,s.creates.length);
    await assert.rejects(readFile(join(f.cwd,'local/pp1',id,'prepared-networks.json')),{code:'ENOENT'});
  }
});
test('T146 unknown IPAM driver is refused instead of assuming default allocator semantics',async t=>{
  const f=await networkFixture(t),{createPreparedNetworks}=await import('./prepare.mjs'),receipt=await prepare(parseArgs(args),f.deps);
  f.networkState.networks.push({Id:'f'.repeat(64),Name:'foreign',Driver:'bridge',IPAM:{Driver:'unknown',Config:[{Subnet:'172.17.0.0/16'}]}});
  await assert.rejects(createPreparedNetworks(receipt,f.deps),{code:'ADAPTER_UNSEALED'});assert.equal(f.networkState.creates.length,0);
});
test('T146 supplied auxiliary IPAM addresses outside subnet are not ignored',async t=>{
  const f=await networkFixture(t),{createPreparedNetworks}=await import('./prepare.mjs'),receipt=await prepare(parseArgs(args),f.deps);
  f.networkState.networks.push({Id:'f'.repeat(64),Name:'foreign',Driver:'bridge',IPAM:{Driver:'default',Config:[{Subnet:'172.17.0.0/16',AuxiliaryAddresses:{other:'192.168.240.2'}}]}});
  await assert.rejects(createPreparedNetworks(receipt,f.deps),{code:'ADAPTER_UNSEALED'});assert.equal(f.networkState.creates.length,0);
});
function occupiedNetwork(index,subnet) {
  return {Id:(1000+index).toString(16).padStart(64,'0'),Name:`retained-${index}`,Driver:'bridge',IPAM:{Driver:'default',Config:[{Subnet:subnet}]}};
}
test('T153 retained twelve /24s still permit C four plus D six fresh private /26s',async t=>{
  const {createPreparedNetworks}=await import('./prepare.mjs');
  const retained=Array.from({length:12},(_,i)=>occupiedNetwork(i,`192.168.${240+i}.0/24`));
  const oldBytes=JSON.stringify(retained),networks=[...retained],allocated=[];
  for(let attempt=0;attempt<5;attempt++){
    const f=await networkFixture(t);f.networkState.networks=networks;
    f.networkState.mutateCreated=n=>{n.Id=(2000+attempt*2+f.networkState.creates.length).toString(16).padStart(64,'0');};
    const options={...parseArgs(args),runId:(attempt+2).toString(16).repeat(32)},receipt=await prepare(options,f.deps);
    const result=await createPreparedNetworks(receipt,f.deps);
    for(const network of Object.values(result))allocated.push(network.subnet);
    assert.equal(f.networkState.creates.length,2);
    await assert.rejects(createPreparedNetworks(receipt,f.deps),{code:'ADAPTER_UNSEALED'});
  }
  assert.equal(JSON.stringify(networks.slice(0,12)),oldBytes);assert.equal(networks.length,22);
  assert.deepEqual(allocated,['192.168.252.0/26','192.168.252.64/26','192.168.252.128/26','192.168.252.192/26',
    '192.168.253.0/26','192.168.253.64/26','192.168.253.128/26','192.168.253.192/26','192.168.254.0/26','192.168.254.64/26']);
});

test('T153 last two /26 slots have typed gateways and both durable creation receipts',async t=>{
  const f=await networkFixture(t),{createPreparedNetworks}=await import('./prepare.mjs');
  f.networkState.networks=Array.from({length:62},(_,i)=>occupiedNetwork(i,`192.168.${240+Math.floor(i/4)}.${(i%4)*64}/26`));
  const receipt=await prepare(parseArgs(args),f.deps),result=await createPreparedNetworks(receipt,f.deps);
  assert.equal(result.web.subnet,'192.168.255.128/26');assert.equal(result.web.gateway,'192.168.255.129');
  assert.equal(result.data.subnet,'192.168.255.192/26');assert.equal(result.data.gateway,'192.168.255.193');
  for(const role of ['web','data']){
    const recorded=JSON.parse(await readFile(join(f.cwd,'local/pp1',id,`created-network-${role}.json`),'utf8'));
    for(const key of ['id','name','subnet','gateway'])assert.equal(recorded[key],result[role][key]);
    assert.equal(recorded.phase,'CREATED_UNVERIFIED');
  }
});
test('T153 enclosing and nested Docker IPAM block only overlapping fixed /26 candidates',async t=>{
  const {createPreparedNetworks}=await import('./prepare.mjs');
  for(const [occupied,expected] of [['192.168.240.0/24','192.168.241.0/26'],['192.168.240.32/27','192.168.240.64/26']]){
    const f=await networkFixture(t);f.networkState.networks.push(occupiedNetwork(0,occupied));
    const receipt=await prepare(parseArgs(args),f.deps),result=await createPreparedNetworks(receipt,f.deps);
    assert.equal(result.web.subnet,expected);assert.equal(f.networkState.creates.length,2);
  }
});
