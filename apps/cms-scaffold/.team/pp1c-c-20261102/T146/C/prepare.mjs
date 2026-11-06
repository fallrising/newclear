import { constants } from 'node:fs';
import { OpsError, canonicalBytes } from '../ops/recovery-protocol.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { lstat, mkdir, readFile, readdir, writeFile, chmod, open } from 'node:fs/promises';
import { resolve, join, dirname, parse as parsePath } from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const preparedNetworks = new WeakMap();
const fail = code => { throw new Error(code); };
const surfaces = ['front', 'back', 'admin'];
const imagePattern = /^sha256:[a-f0-9]{64}$/;
export function parseArgs(argv) {
  const flags = new Map(); const allowed = new Set(['--run-id', '--api-image', '--node-image', '--postgres-image']);
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || flags.has(argv[i]) || !argv[i + 1]) fail('PP1_LOCAL_INPUT_INVALID');
    flags.set(argv[i], argv[i + 1]);
  }
  if (flags.size !== 4 || !/^[a-f0-9]{32}$/.test(flags.get('--run-id'))) fail('PP1_LOCAL_INPUT_INVALID');
  const images = Object.fromEntries(['api', 'node', 'postgres'].map(k => [k, flags.get(`--${k}-image`)]));
  if (!Object.values(images).every(v => imagePattern.test(v))) fail('PP1_LOCAL_INPUT_INVALID');
  return { runId: flags.get('--run-id'), images };
}
async function safePath(path, allowMissing = false) {
  const full = resolve(path);
  if (/[\r\n\0']/.test(full)) fail('PP1_LOCAL_PATH_INVALID');
  let current = parsePath(full).root;
  for (const part of full.slice(current.length).split('/')) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) fail('PP1_LOCAL_PATH_INVALID'); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return full; throw error; }
  }
  return full;
}
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function digestFile(path) {
  try {
    await safePath(path);
    if (!(await lstat(path)).isFile()) fail('PP1_LOCAL_ARTIFACT_INVALID');
    return createHash('sha256').update(await readFile(path)).digest('hex');
  } catch { fail('PP1_LOCAL_ARTIFACT_INVALID'); }
}
async function digestTree(root) {
  const files = {};
  async function walk(relative = '') {
    for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) fail('PP1_LOCAL_ARTIFACT_INVALID');
      if (entry.isDirectory()) { await walk(name); continue; }
      if (!entry.isFile()) fail('PP1_LOCAL_ARTIFACT_INVALID');
      const bytes = await readFile(join(root, name));
      if (bytes.includes(Buffer.from('http://localhost:8080'))) fail('PP1_LOCAL_ARTIFACT_INVALID');
      files[name] = createHash('sha256').update(bytes).digest('hex');
    }
  }
  await safePath(root); await walk();
  if (!files['index.html']) fail('PP1_LOCAL_ARTIFACT_INVALID');
  return files;
}
async function portAvailable() {
  return new Promise(resolvePort => {
    const server = createServer(); server.once('error', () => resolvePort(false));
    server.listen(8443, '127.0.0.1', () => server.close(() => resolvePort(true)));
  });
}
export async function prepare(options, deps = {}) { return prepareInternal(options,deps,null); }
async function prepareInternal(options, deps, restore) {
  const environment = deps.environment ?? process.env;
  const childEnvironment = { ...environment };
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete childEnvironment[key];
  const command = deps.command ?? ((file, args) => exec(file, args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: childEnvironment, shell: false }));
  const docker = async args => command('docker', ['--host', 'unix:///var/run/docker.sock', ...args]);
  const privateWrite = async (path, data) => {
    if(!restore)return writeFile(path,data,{flag:'wx',mode:0o600});
    const file=await open(path,'wx',0o600);try{await file.writeFile(data);await file.sync();}finally{await file.close();}
  };
  try {
    parseArgs(['--run-id', options.runId, ...Object.entries(options.images).flatMap(([k, v]) => [`--${k}-image`, v])]);
    if ((deps.nodeVersion ?? process.version) !== 'v24.18.0') fail('PP1_LOCAL_INPUT_INVALID');
    if ((environment.DOCKER_HOST && environment.DOCKER_HOST !== 'unix:///var/run/docker.sock') ||
        (environment.DOCKER_CONTEXT && environment.DOCKER_CONTEXT !== 'default') || environment.DOCKER_TLS_VERIFY) fail('PP1_LOCAL_DOCKER_NOT_LOCAL');
    const cwd = await safePath(deps.cwd ?? process.cwd());
    const nodeBinary = await safePath(deps.nodeBinary ?? process.execPath);
    if (!(await lstat(nodeBinary)).isFile()) fail('PP1_LOCAL_PATH_INVALID');
    const root = await safePath(join(cwd, 'local', 'pp1', options.runId), true);
    if(restore) {
      if(root!==restore.root||(await readdir(root)).join(',')!=='restore-target.json')fail('PP1_LOCAL_TARGET_EXISTS');
    }else if (await exists(root)) fail('PP1_LOCAL_TARGET_EXISTS');
    const project = `cms-pp1-local-${options.runId}`;
    const composePath = environment.CMS_DOCKER_COMPOSE;
    if (composePath && (!composePath.startsWith('/') || !(await lstat(await safePath(composePath))).isFile())) fail('PP1_LOCAL_PATH_INVALID');
    const composeVersion = (await (composePath ? command(composePath, ['version', '--short']) : docker(['compose', 'version', '--short']))).stdout.trim();
    if (!/^[v]?[0-9]+\.[0-9]+\.[0-9]+/.test(composeVersion)) fail('PP1_LOCAL_INPUT_INVALID');
    const imageRefs = Object.fromEntries(['api', 'node', 'postgres'].map(k => [k, `${project}-${k}:verified`]));
    const imageInfo = new Map();
    for (const id of Object.values(options.images)) {
      let info;
      try { info = JSON.parse((await docker(['image', 'inspect', id])).stdout); } catch { fail('PP1_LOCAL_IMAGE_INVALID'); }
      if (!Array.isArray(info) || info.length !== 1 || info[0].Id !== id || info[0].Os !== 'linux') fail('PP1_LOCAL_IMAGE_INVALID');
      imageInfo.set(id, info[0]);
    }
    for (const ref of Object.values(imageRefs)) {
      try { await docker(['image', 'inspect', ref]); fail('PP1_LOCAL_TARGET_EXISTS'); }
      catch (error) {
        if (error.message === 'PP1_LOCAL_TARGET_EXISTS') throw error;
        if (error.code !== 1 || !/No such image/.test(error.stderr ?? error.message)) throw error;
      }
    }
    for (const prefix of [['ps', '-a'], ['network', 'ls'], ['volume', 'ls']]) {
      for (const filter of [`label=com.docker.compose.project=${project}`, `name=${project}`]) {
        if ((await docker([...prefix, '--filter', filter, '--format', prefix[0] === 'volume' ? '{{.Name}}' : '{{.ID}}'])).stdout.trim()) fail('PP1_LOCAL_TARGET_EXISTS');
      }
    }
    if (!restore&&!await (deps.portAvailable ?? portAvailable)()) fail('PP1_LOCAL_PORT_BUSY');
    const dist = {}; const distPaths = {};
    for (const surface of surfaces) {
      distPaths[surface] = join(cwd, 'apps', `web-${surface}`, 'dist');
      dist[surface] = await digestTree(distPaths[surface]);
    }
    const sourceCommit = restore?restore.source.sourceCommit:(await command('git', ['-C', cwd, 'rev-parse', 'HEAD'])).stdout.trim();
    if (!/^[a-f0-9]{40}$/.test(sourceCommit)) fail('PP1_LOCAL_ARTIFACT_INVALID');
    const worktreeDirty = restore?Boolean(restore.receipt.worktreeDirty):Boolean((await command('git', ['-C', cwd, 'status', '--porcelain'])).stdout.trim());
    const libs = await safePath(join(cwd, 'services/cms-api/build/libs'));
    const jars = (await readdir(libs)).filter(name => name.endsWith('.jar'));
    if (jars.length !== 1) fail('PP1_LOCAL_ARTIFACT_INVALID');
    const jarSha256 = await digestFile(join(libs, jars[0]));
    const labels = imageInfo.get(options.images.api)?.Config?.Labels;
    const baseImage = labels?.['org.cms.pp1.base-image'];
    if (!labels || labels['org.cms.pp1.source-commit'] !== sourceCommit ||
        labels['org.cms.pp1.jar-sha256'] !== jarSha256 || !imagePattern.test(baseImage)) fail('PP1_LOCAL_IMAGE_INVALID');
    let base;
    try { base = JSON.parse((await docker(['image', 'inspect', baseImage])).stdout); } catch { fail('PP1_LOCAL_IMAGE_INVALID'); }
    if (!Array.isArray(base) || base.length !== 1 || base[0].Id !== baseImage || base[0].Os !== 'linux') fail('PP1_LOCAL_IMAGE_INVALID');
    const apiBuild = { sourceCommit, jarSha256, baseImage };
    const ingressScriptSha256 = await digestFile(join(cwd, 'scripts/local/ingress.mjs'));
    if(restore&&JSON.stringify({apiBuild,dist,ingressScriptSha256,nodeBinarySha256:await digestFile(nodeBinary)})!==JSON.stringify({
      apiBuild:restore.artifacts.apiBuild,dist:restore.artifacts.dist,ingressScriptSha256:restore.artifacts.ingressScriptSha256,nodeBinarySha256:restore.artifacts.nodeBinarySha256}))fail('PP1_LOCAL_ARTIFACT_INVALID');
    await mkdir(dirname(root), { recursive: true, mode: 0o700 });
    if(!restore)await mkdir(root, { mode: 0o700 });
    for (const dir of ['secrets', 'tls']) await mkdir(join(root, dir), { mode: 0o700 });
    await privateWrite(join(root, 'secrets', 'spring.datasource.password'), randomBytes(32).toString('base64url'));
    const tls = join(root, 'tls');
    await privateWrite(join(tls, 'leaf.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:front.cms.test,DNS:back.cms.test,DNS:admin.cms.test,DNS:api.cms.test\n');
    await command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2', '-subj', '/CN=PP1 Local Test CA', '-keyout', join(tls, 'ca.key'), '-out', join(tls, 'ca.crt')]);
    await command('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=api.cms.test', '-keyout', join(tls, 'leaf.key'), '-out', join(tls, 'leaf.csr')]);
    await command('openssl', ['x509', '-req', '-in', join(tls, 'leaf.csr'), '-CA', join(tls, 'ca.crt'), '-CAkey', join(tls, 'ca.key'), '-CAcreateserial', '-days', '2', '-sha256', '-extfile', join(tls, 'leaf.ext'), '-out', join(tls, 'leaf.crt')]);
    for (const name of await readdir(tls)) await chmod(join(tls, name), 0o600);
    for (const [kind, ref] of Object.entries(imageRefs)) {
      await docker(['image', 'tag', options.images[kind], ref]);
      const resolved = JSON.parse((await docker(['image', 'inspect', ref])).stdout);
      if (resolved[0]?.Id !== options.images[kind]) fail('PP1_LOCAL_IMAGE_INVALID');
    }
    const origins = Object.fromEntries([...surfaces, 'api'].map(k => [k, `https://${k}.cms.test:8443`]));
    await privateWrite(join(root, 'ingress.json'), JSON.stringify({ version: 1, origins, dist: Object.fromEntries(surfaces.map(k => [k, `/dist/${k}`])), certPath: '/tls/leaf.crt', keyPath: '/tls/leaf.key', upstream: 'http://cms-api:8080' }, null, 2));
    const variables = { CMS_PP1_PROJECT: project, CMS_PP1_RUN_ROOT: root, CMS_PP1_API_IMAGE: imageRefs.api, CMS_PP1_NODE_IMAGE: imageRefs.node, CMS_PP1_POSTGRES_IMAGE: imageRefs.postgres, CMS_PP1_INGRESS_SCRIPT: join(cwd, 'scripts/local/ingress.mjs'), NODE_BINARY: nodeBinary, CMS_API_ORIGIN: origins.api, ...Object.fromEntries(surfaces.map(k => [`CMS_PP1_${k.toUpperCase()}_DIST`, distPaths[k]])) };
    await privateWrite(join(root, 'compose.env'), Object.entries(variables).map(([k, v]) => `${k}='${v}'`).join('\n') + '\n');
    await privateWrite(join(root, 'artifacts.json'), JSON.stringify({ version: 1, sourceCommit, worktreeDirty, apiBuild, ingressScriptSha256, apiOrigin: origins.api, dist, nodeBinarySha256: createHash('sha256').update(await readFile(nodeBinary)).digest('hex') }, null, 2));
    const receipt = { version: 1, environment: 'local-isolated', runId: options.runId, project, sourceCommit, worktreeDirty, apiBuild, images: options.images, imageRefs, apiOrigin: origins.api, composeVersion, preparedAt: (deps.now?.() ?? new Date()).toISOString(), phase: 'PREPARED' };
    await privateWrite(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2));
    preparedNetworks.set(receipt, { root, cwd, project, docker, command, deps: { ...deps },
      receiptBytes: JSON.stringify(receipt, null, 2), snapshot: JSON.stringify(receipt),
      rootIdentity: await lstat(root), receiptIdentity: await lstat(join(root, 'receipt.json')),
      readRoutes: deps.readRoutes ?? (() => readFile('/proc/net/route', 'utf8')), used: false });
    return receipt;
  } catch (error) {
    if (/^PP1_LOCAL_[A-Z_]+$/.test(error.message)) throw error;
    fail('PP1_LOCAL_PREPARE_FAILED');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await prepare(parseArgs(process.argv.slice(2))); process.stdout.write(JSON.stringify(result) + '\n'); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = error.message === 'PP1_LOCAL_INPUT_INVALID' ? 2 : 3; }
}

export async function prepareRestore(token,deps={}) {
  const {restoreTargetContext,assertWorkflow}=await import('./maintenance-workflow.mjs');
  const context=await restoreTargetContext(token,deps);
  const receipt=await prepareInternal({runId:context.target.runId,images:context.source.images},
    {...deps,nodeBinary:context.nodeBinary},context);
  const {syncDirectory}=await import('./maintenance-store.mjs');
  for(const name of await readdir(join(context.root,'tls'))){const handle=await open(join(context.root,'tls',name),'r');try{await handle.sync();}finally{await handle.close();}}
  for(const dir of ['secrets','tls',''])await syncDirectory(join(context.root,dir));
  await assertWorkflow(token,{},deps);preparedNetworks.get(receipt).workflow=token;return receipt;
}
const networkEnsure = value => { if (!value) throw new OpsError('ADAPTER_UNSEALED'); };
const fullNetworkId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function ipv4Number(value) {
  networkEnsure(typeof value === 'string' && /^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$/.test(value));
  const parts=value.split('.').map(Number);networkEnsure(parts.every(n=>n<=255));
  return parts.reduce((n,v)=>n*256+v,0);
}
function networkRange(value) {
  networkEnsure(typeof value==='string'&&/^[0-9.]+\/(0|[1-9]|[12][0-9]|3[0-2])$/.test(value));
  const [address,bits]=value.split('/'),start=ipv4Number(address),size=2**(32-Number(bits));
  networkEnsure(start%size===0);return[start,start+size-1];
}
const rangesOverlap=(a,b)=>a[0]<=b[1]&&b[0]<=a[1];
function routeRanges(text) {
  networkEnsure(typeof text==='string'&&Buffer.byteLength(text)<=1048576);
  const lines=text.trim().split('\n');networkEnsure(lines.length<=10000&&lines.shift().trim().split(/\s+/).join(' ')==='Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT');
  return lines.map(line=>{
    const c=line.trim().split(/\s+/);networkEnsure(c.length===11&&/^[a-zA-Z0-9_.:-]+$/.test(c[0]));
    networkEnsure([c[1],c[2],c[7]].every(v=>/^[a-fA-F0-9]{8}$/.test(v))&&/^[0-9a-fA-F]{4}$/.test(c[3]));
    networkEnsure([1,3,5,7].includes(parseInt(c[3],16))&&[4,5,6,8,9,10].every(i=>/^[0-9]+$/.test(c[i])));
    const decode=value=>Buffer.from(value,'hex').readUInt32LE(),start=decode(c[1]),mask=decode(c[7]),size=2**32-mask;
    networkEnsure(Number.isInteger(Math.log2(size))&&start%size===0);
    if(mask===0){networkEnsure(start===0&&parseInt(c[3],16)===3);return null;}
    return[start,start+size-1];
  }).filter(Boolean);
}
async function privateNetworkEvidence(root,name,value) {
  const file=await open(join(root,name),'wx',0o600);
  try{await file.writeFile(canonicalBytes(value));await file.sync();}finally{await file.close();}
  const directory=await open(root,'r');try{await directory.sync();}finally{await directory.close();}
}
async function preparedIdentity(receipt,capability,deps) {
  networkEnsure(JSON.stringify(receipt)===capability.snapshot&&(deps.cwd??process.cwd())===capability.cwd);
  networkEnsure(!deps.command||deps.command===capability.command);await safePath(capability.root);
  const root=await lstat(capability.root);networkEnsure(root.isDirectory()&&(root.mode&0o7777)===0o700&&root.uid===process.getuid());
  networkEnsure(root.dev===capability.rootIdentity.dev&&root.ino===capability.rootIdentity.ino);
  const file=await open(join(capability.root,'receipt.json'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=await file.stat();networkEnsure(stat.isFile()&&stat.nlink===1&&(stat.mode&0o7777)===0o600&&stat.uid===process.getuid()&&stat.size<=1048576);
    networkEnsure(stat.dev===capability.receiptIdentity.dev&&stat.ino===capability.receiptIdentity.ino);
    networkEnsure((await file.readFile('utf8'))===capability.receiptBytes);
  }finally{await file.close();}
  if(capability.workflow)await(await import('./maintenance-workflow.mjs')).assertWorkflow(capability.workflow,{},capability.deps);
}
export async function createPreparedNetworks(receipt,deps={}) {
  try{
    const cap=preparedNetworks.get(receipt);networkEnsure(cap&&!cap.used);cap.used=true;
    await preparedIdentity(receipt,cap,deps);
    const docker=async args=>{
      const result=await cap.docker(args);networkEnsure((result.code===undefined||result.code===0)&&!result.signal&&!result.killed&&typeof result.stdout==='string'&&Buffer.byteLength(result.stdout)<=8388608);
      return result.stdout;
    };
    const created={};
    const inspectCreated=async(role,{id,name,subnet,gateway})=>{
      const labels={'com.docker.compose.project':cap.project,'com.docker.compose.network':role,'com.docker.compose.version':receipt.composeVersion};
      const rows=JSON.parse(await docker(['network','inspect',id]));networkEnsure(Array.isArray(rows)&&rows.length===1);const n=rows[0];
      networkEnsure(n.Id===id&&n.Name===name&&n.Driver==='bridge'&&n.Internal===true&&n.Scope==='local'&&n.EnableIPv6===false&&n.Attachable===false&&n.Ingress===false);
      networkEnsure(n.Containers&&Object.keys(n.Containers).length===0&&n.Options&&Object.keys(n.Options).length===0);
      networkEnsure(n.Labels&&Object.keys(n.Labels).length===3&&Object.entries(labels).every(([k,v])=>n.Labels[k]===v));
      networkEnsure(n.IPAM?.Driver==='default'&&(!n.IPAM.Options||Object.keys(n.IPAM.Options).length===0)&&n.IPAM.Config?.length===1);
      const ipam=n.IPAM.Config[0];networkEnsure(ipam.Subnet===subnet&&ipam.Gateway===gateway&&(!ipam.IPRange)&&(!ipam.AuxiliaryAddresses||Object.keys(ipam.AuxiliaryAddresses).length===0));
    };
    const inventory=async()=>{
      const text=(await docker(['network','ls','--no-trunc','--format','{{.ID}}'])).trim(),ids=text?text.split('\n'):[];
      networkEnsure(ids.length<=4096&&ids.every(fullNetworkId)&&new Set(ids).size===ids.length);
      const networks=ids.length?JSON.parse(await docker(['network','inspect',...ids])):[];
      networkEnsure(Array.isArray(networks)&&networks.length===ids.length&&new Set(networks.map(n=>n.Id)).size===ids.length&&networks.every(n=>ids.includes(n.Id)));
      const ranges=[];
      for(const network of networks){
        networkEnsure(typeof network.Name==='string'&&network.Name.length>0);
        const own=network.Labels?.['com.docker.compose.project']===cap.project||network.Name.includes(cap.project);
        if(own)networkEnsure(Object.values(created).some(n=>n.id===network.Id&&n.name===network.Name));
        if(['host','null'].includes(network.Driver)){
          networkEnsure(network.Name===(network.Driver==='host'?'host':'none')&&!(network.IPAM?.Config?.length));continue;
        }
        networkEnsure(network.Driver==='bridge'&&Array.isArray(network.IPAM?.Config)&&network.IPAM.Config.length>0);
        for(const config of network.IPAM.Config){
          const range=networkRange(config.Subnet);ranges.push(range);
          if(config.Gateway)networkEnsure(ipv4Number(config.Gateway)>=range[0]&&ipv4Number(config.Gateway)<=range[1]);
          if(config.IPRange){const r=networkRange(config.IPRange);networkEnsure(r[0]>=range[0]&&r[1]<=range[1]);}
        }
      }
      for(const prefix of [['ps','-a'],['volume','ls']])for(const filter of [`label=com.docker.compose.project=${cap.project}`,`name=${cap.project}`])
        networkEnsure((await docker([...prefix,'--filter',filter,'--format',prefix[0]==='ps'?'{{.ID}}':'{{.Name}}'])).trim()==='');
      return [...ranges,...routeRanges(await cap.readRoutes())];
    };
    const occupied=await inventory(),slots=Array.from({length:16},(_,i)=>`192.168.${240+i}.0/24`).filter(cidr=>!occupied.some(r=>rangesOverlap(networkRange(cidr),r)));
    networkEnsure(slots.length>=2);const selected={web:slots[0],data:slots[1]};
    await privateNetworkEvidence(cap.root,'network-attempt.json',{version:1,project:cap.project,subnets:selected});
    for(const role of ['web','data']){
      await preparedIdentity(receipt,cap,deps);const fresh=await inventory(),subnet=selected[role],gateway=subnet.replace('0/24','1'),name=`${cap.project}_${role}`;
      networkEnsure(!fresh.some(r=>rangesOverlap(networkRange(subnet),r)));
      const labels={'com.docker.compose.project':cap.project,'com.docker.compose.network':role,'com.docker.compose.version':receipt.composeVersion};
      const id=(await docker(['network','create','--driver','bridge','--internal','--subnet',subnet,'--gateway',gateway,
        ...Object.entries(labels).flatMap(([k,v])=>['--label',`${k}=${v}`]),name])).trim();networkEnsure(fullNetworkId(id));
      await privateNetworkEvidence(cap.root,`created-network-${role}.json`,{version:1,role,id,name,subnet,gateway,phase:'CREATED_UNVERIFIED'});
      await inspectCreated(role,{id,name,subnet,gateway});
      created[role]=Object.freeze({id,name,subnet,gateway});
    }
    await preparedIdentity(receipt,cap,deps);
    for(const role of ['web','data'])await inspectCreated(role,created[role]);
    await privateNetworkEvidence(cap.root,'prepared-networks.json',{version:1,project:cap.project,networks:created});
    return Object.freeze(created);
  }catch{throw new OpsError('ADAPTER_UNSEALED');}
}
