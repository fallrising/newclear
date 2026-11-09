import { OpsError } from '../ops/recovery-protocol.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { lstat, open, readdir, mkdtemp, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, parse, isAbsolute } from 'node:path';
const fail = () => { throw new Error('QUIESCENCE_NOT_PROVEN'); };
const ensure = condition => { if (!condition) fail(); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const image = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => object(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const keys = (value, expected) => object(value) && equal(Object.keys(value).sort(), [...expected].sort());
const capabilities = new WeakMap(), execute = promisify(execFile);
const absolutePath = path => typeof path === 'string' && isAbsolute(path) && resolve(path) === path && !/[\r\n\0]/.test(path);
const overlaps = (a, b) => a === b || a.startsWith(b === '/' ? b : `${b}/`) || b.startsWith(a === '/' ? a : `${a}/`);
function privateIp(ip) {
  if (!isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}
function within(ip, subnet) {
  const [base, bits] = subnet.split('/');
  if (!isIPv4(base) || !/^(?:[1-9]|[12][0-9]|3[0-2])$/.test(bits)) return false;
  const number = address => address.split('.').reduce((n, v) => (n * 256 + Number(v)) >>> 0, 0);
  const mask = (0xffffffff << (32 - Number(bits))) >>> 0;
  return ((number(ip) & mask) >>> 0) === ((number(base) & mask) >>> 0);
}
async function ancestors(path) {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split('/')) { current = join(current, part); ensure(!(await lstat(current)).isSymbolicLink()); }
}
async function regular(path, privateFile = false) {
  await ancestors(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat(); ensure(stat.isFile() && stat.nlink === 1);
    if (privateFile) ensure((stat.mode & 0o7777) === 0o600 && stat.uid === process.getuid());
    ensure(stat.size <= (privateFile ? 1048576 : 268435456));
    return await handle.readFile();
  } finally { await handle.close(); }
}
async function tree(root) {
  await ancestors(root); ensure((await lstat(root)).isDirectory()); const files = {};
  async function walk(relative = '') {
    for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      ensure(!entry.isSymbolicLink());
      if (entry.isDirectory()) await walk(name);
      else { ensure(entry.isFile()); files[name] = digest(await regular(join(root, name))); }
    }
  }
  await walk(); ensure(files['index.html']); return files;
}
function freeze(value) { for (const child of Object.values(value)) if (object(child)) freeze(child); return Object.freeze(value); }
export async function inspectTarget(runRoot, deps = {}, { apiState, workflow, observation } = {}) {
  try {
    ensure(!(workflow && observation));
    ensure(apiState === 'running' || apiState === 'stopped'); ensure(typeof runRoot === 'string' && runRoot.length > 0);
    const root = resolve(runRoot), runId = root.split('/').at(-1), cwd = dirname(dirname(dirname(root)));
    ensure(hex(runId, 32) && root === join(cwd, 'local/pp1', runId)); await ancestors(root);
    const rootStat = await lstat(root); ensure(rootStat.isDirectory() && (rootStat.mode & 0o7777) === 0o700 && rootStat.uid === process.getuid());
    const workflowContext=observation ? await (await import('./maintenance-observation.mjs')).observationInspectionContext(observation,root,deps)
      : workflow ? await (await import('./maintenance-workflow.mjs')).workflowInspectionContext(workflow,root,deps) : null;
    const restore=workflowContext?.restoreRoot===root;
    try { await lstat(join(root,'restore-target.json')); ensure(restore&&apiState===workflowContext.apiState); } catch(error) { if(error.code!=='ENOENT')throw error; }
    if(restore)ensure(apiState===workflowContext.apiState&&['running','stopped'].includes(workflowContext.ingressState));
    const receipt = JSON.parse(await regular(join(root, 'receipt.json'), true));
    const artifacts = JSON.parse(await regular(join(root, 'artifacts.json'), true));
    const project = `cms-pp1-local-${runId}`, build = receipt.apiBuild;
    ensure(receipt.version === 1 && receipt.environment === 'local-isolated' && receipt.phase === 'PREPARED' && receipt.runId === runId && receipt.project === project);
    ensure(hex(receipt.sourceCommit, 40) && receipt.apiOrigin === 'https://api.cms.test:8443');
    ensure(keys(build, ['sourceCommit', 'jarSha256', 'baseImage']) && build.sourceCommit === receipt.sourceCommit && hex(build.jarSha256, 64) && image(build.baseImage));
    ensure(artifacts.version === 1 && artifacts.sourceCommit === receipt.sourceCommit && equal(artifacts.apiBuild, build) && artifacts.apiOrigin === receipt.apiOrigin);
    ensure(keys(receipt.images, ['api', 'node', 'postgres']) && Object.values(receipt.images).every(image));
    ensure(keys(receipt.imageRefs, ['api', 'node', 'postgres']) && Object.entries(receipt.imageRefs).every(([kind, ref]) => ref === `${project}-${kind}:verified`));
    const libs = join(cwd, 'services/cms-api/build/libs'); await ancestors(libs);
    const jars = (await readdir(libs)).filter(name => name.endsWith('.jar')); ensure(jars.length === 1);
    ensure(digest(await regular(join(libs, jars[0]))) === build.jarSha256);
    const script = join(cwd, 'scripts/local/ingress.mjs'), probe = join(cwd, 'scripts/local/maintenance-media-probe.mjs');
    ensure(hex(artifacts.ingressScriptSha256, 64) && digest(await regular(script)) === artifacts.ingressScriptSha256);
    const mediaProbeSha256 = digest(await regular(probe));
    const env = { ...(deps.environment ?? process.env) };
    ensure(!env.DOCKER_HOST || env.DOCKER_HOST === 'unix:///var/run/docker.sock'); ensure(!env.DOCKER_CONTEXT || env.DOCKER_CONTEXT === 'default'); ensure(!env.DOCKER_TLS_VERIFY);
    for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key];
    const options = { env, shell: false, timeout: 30000, maxBuffer: 16 * 1024 * 1024 };
    const command = deps.command ?? execute;
    const docker = async args => { const result = await command('docker', ['--host', 'unix:///var/run/docker.sock', ...args], options); ensure(result.code === undefined || result.code === 0); return result.stdout; };
    const list = async args => { const value = JSON.parse(await docker(args)); ensure(Array.isArray(value) && value.every(object)); return value; };
    const ids = (await docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}}'])).trim().split('\n');
    ensure(ids.length >= 3 && new Set(ids).size === ids.length && ids.every(id => hex(id, 64)));
    const all = await list(['inspect', ...ids]); ensure(all.length === ids.length && new Set(all.map(c => c.Id)).size === ids.length && all.every(c => ids.includes(c.Id)));
    ensure(all.every(c => object(c.Config?.Labels) && object(c.NetworkSettings?.Networks) && Array.isArray(c.Mounts)));
    let permitted=null;
    if(workflowContext?.helper) {
      const {helper,policy,expected}=workflowContext;permitted=all.find(c=>c.Id===helper.fullContainerId);ensure(permitted);
      const state=workflowContext.profileTransition ? permitted.State?.Status : workflowContext.allowExited&&permitted.State?.Status==='exited'?'exited':
        {CREATED:'created',RUNNING:'running',READY:'running',PERMITTED:'running',EXITED:'exited'}[helper.state];
      if(state==='exited'&&(workflowContext.allowExited||workflowContext.profileTransition))ensure(permitted.State.ExitCode===0);
      (await import('./maintenance-helper.mjs')).assertHelperPolicy(permitted,policy,{...expected,state});
      if(state==='running'&&helper.endpoint) {
        const endpoints=Object.values(permitted.NetworkSettings.Networks);
        ensure(endpoints.length===1&&endpoints[0].NetworkID===helper.endpoint.networkId&&endpoints[0].IPAddress===helper.endpoint.address);
      }
    }
    const owned = all.filter(c => c!==permitted && c.Config?.Labels?.['com.docker.compose.project'] === project);
    const allowed=permitted?[...owned,permitted]:owned;
    const service = new Map(owned.map(c => [c.Config.Labels['com.docker.compose.service'], c]));
    ensure(owned.length === 3 && service.size === 3 && ['postgres', 'cms-api', 'ingress'].every(name => service.has(name)));
    const networkNames = ['web', 'data'].map(n => `${project}_${n}`), volumeNames = ['db-data', 'media-data'].map(n => `${project}_${n}`);
    for (const c of all.filter(c => !allowed.includes(c))) ensure(!Object.entries(c.NetworkSettings.Networks).some(([n, e]) => networkNames.includes(n) || networksOwnedId(e.NetworkID)) && !c.Mounts.some(m => volumeNames.includes(m.Name)));
    const networks = await list(['network', 'inspect', ...networkNames]); ensure(networks.length === 2 && new Set(networks.map(n => n.Name)).size === 2 && new Set(networks.map(n => n.Id)).size === 2);
    const networkMap = new Map();
    function networksOwnedId(id) { return hex(id, 64) && owned.some(c => Object.values(c.NetworkSettings.Networks).some(e => e.NetworkID === id)); }
    for (const n of networks) {
      const name = ['web', 'data'].find(k => n.Name === `${project}_${k}`);
      ensure(name && hex(n.Id, 64) && n.Internal === true && n.Driver === 'bridge' && n.Labels?.['com.docker.compose.project'] === project && n.Labels['com.docker.compose.network'] === name);
      ensure(n.IPAM?.Config?.length === 1 && privateIp(n.IPAM.Config[0].Gateway) && within(n.IPAM.Config[0].Gateway, n.IPAM.Config[0].Subnet));
      ensure(object(n.Containers) && Object.keys(n.Containers).every(id => allowed.some(c => c.Id === id)));
      const members = allowed.filter(c => c.State?.Running && Object.hasOwn(c.NetworkSettings?.Networks ?? {}, n.Name));
      ensure(equal(Object.keys(n.Containers).sort(), members.map(c => c.Id).sort()));
      networkMap.set(name, n);
    }
    const containerIds = {}, mounts = new Map(); let sessionMetadata;
    for (const [name, c] of service) {
      const kind = { postgres: 'postgres', 'cms-api': 'api', ingress: 'node' }[name]; containerIds[name] = c.Id;
      ensure(c.Name === `/${project}-${name}-1` && c.Image === receipt.images[kind] && c.State?.Running === (name==='postgres'||name==='cms-api'&&apiState==='running'||name==='ingress'&&(!restore||workflowContext.ingressState==='running')));
      if(restore&&name==='cms-api'&&apiState==='running'&&workflowContext.apiHealthy)ensure(c.State.Health?.Status==='healthy');
      const expectedEnv = name === 'postgres' ? { POSTGRES_DB: 'cms', POSTGRES_USER: 'cms_local', POSTGRES_PASSWORD_FILE: '/run/secrets/spring.datasource.password' } : name === 'cms-api' ? {
        SPRING_PROFILES_ACTIVE: 'prod', CMS_RUNTIME_PRODUCTION_REQUIRED: 'true', CMS_SITE_DOMAIN: 'cms.test', CMS_API_ORIGIN: receipt.apiOrigin,
        CMS_CORS_ORIGINS: 'https://front.cms.test:8443,https://back.cms.test:8443,https://admin.cms.test:8443',
        CMS_SURFACE_ORIGINS: 'https://front.cms.test:8443:front,https://back.cms.test:8443:back,https://admin.cms.test:8443:admin',
        CMS_IDENTITY_SEED_ENABLED: 'false', CMS_IDENTITY_COOKIE_SECURE: 'true', SPRING_DATASOURCE_URL: 'jdbc:postgresql://postgres:5432/cms',
        SPRING_DATASOURCE_USERNAME: 'cms_local', SPRING_CONFIG_IMPORT: 'configtree:/run/secrets/', CMS_MEDIA_ROOT: '/data/media', SERVER_PORT: '8080' } : {};
      ensure(Array.isArray(c.Config.Env)); const variables = new Map(c.Config.Env.map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
      ensure(variables.size === c.Config.Env.length && Object.entries(expectedEnv).every(([k, v]) => variables.get(k) === v));
      ensure([...variables.keys()].filter(k => /^(CMS_|SPRING_|POSTGRES_)/.test(k)).every(k => Object.hasOwn(expectedEnv, k)));
      ensure(c.HostConfig?.RestartPolicy?.Name === 'no' && c.HostConfig.Privileged === false && networkNames.includes(c.HostConfig.NetworkMode));
      ensure(object(c.HostConfig.PortBindings) && Object.keys(c.HostConfig.PortBindings).length === 0);
      ensure(object(c.NetworkSettings?.Ports) && Object.values(c.NetworkSettings.Ports).every(v => v === null || Array.isArray(v) && v.length === 0));
      const names = name === 'cms-api' ? ['web', 'data'] : [name === 'postgres' ? 'data' : 'web'];
      ensure(names.map(n => `${project}_${n}`).includes(c.HostConfig.NetworkMode));
      ensure(keys(c.NetworkSettings.Networks, names.map(n => `${project}_${n}`)));
      for (const n of names) {
        const network = networkMap.get(n), endpoint = c.NetworkSettings.Networks[network.Name];
        const inactive=name==='cms-api'&&apiState==='stopped'||restore&&name==='ingress'&&workflowContext.ingressState==='stopped';
        ensure(endpoint.NetworkID === network.Id||restore&&inactive&&endpoint.NetworkID==='');
        const aliases = [`${project}-${name}-1`, name, ...(name === 'ingress' ? ['front.cms.test', 'back.cms.test', 'admin.cms.test', 'api.cms.test'] : [])];
        ensure(Array.isArray(endpoint.Aliases) && equal([...endpoint.Aliases].sort(), aliases.sort()));
        // Docker internal bridges omit a default route; the host connection still binds to verified IPAM.
        const internalWithoutDefaultRoute = network.Internal === true && network.Driver === 'bridge'
          && endpoint.Gateway === '' && privateIp(network.IPAM.Config[0].Gateway)
          && within(network.IPAM.Config[0].Gateway, network.IPAM.Config[0].Subnet);
        if (inactive) {
          ensure(!network.Containers[c.Id]&&!endpoint.IPAddress);
          if(restore){for(const key of ['EndpointID','Gateway','MacAddress','IPv6Gateway','GlobalIPv6Address'])ensure((endpoint[key]??'')==='');
            ensure((endpoint.IPPrefixLen??0)===0&&(endpoint.GlobalIPv6PrefixLen??0)===0);}
        }
        else ensure(privateIp(endpoint.IPAddress) && within(endpoint.IPAddress, network.IPAM.Config[0].Subnet)
          && (endpoint.Gateway === network.IPAM.Config[0].Gateway || internalWithoutDefaultRoute)
          && endpoint.IPPrefixLen === Number(network.IPAM.Config[0].Subnet.split('/')[1])
          && network.Containers[c.Id]?.IPv4Address === `${endpoint.IPAddress}/${endpoint.IPPrefixLen}`);
      }
      const resolved = await list(['image', 'inspect', receipt.imageRefs[kind]]); ensure(resolved.length === 1 && resolved[0].Id === c.Image && resolved[0].Os === 'linux');
      if(restore){const command=name==='ingress'?{Entrypoint:['/opt/pp1-node'],Cmd:['/tool/ingress.mjs','--config','/config/ingress.json']}:resolved[0].Config;
        ensure(equal(c.Config.Entrypoint??null,command.Entrypoint??null)&&equal(c.Config.Cmd??null,command.Cmd??null));}
      if (name === 'cms-api') { sessionMetadata = structuredClone({ config: c.Config, imageConfig: resolved[0].Config, expectedEnv, lifecycle: { created: c.Created, started: c.State.StartedAt, finished: c.State.FinishedAt, restarts: c.RestartCount, status: c.State.Status } }); const labels = resolved[0].Config?.Labels; ensure(labels && labels['org.cms.pp1.source-commit'] === build.sourceCommit && labels['org.cms.pp1.jar-sha256'] === build.jarSha256 && labels['org.cms.pp1.base-image'] === build.baseImage); }
      ensure(Array.isArray(c.Mounts)); const m = new Map(c.Mounts.map(v => [v.Destination, v])); ensure(m.size === c.Mounts.length); mounts.set(name, m);
      if (name !== 'ingress') {
        ensure(m.size === 2); const secret = m.get('/run/secrets/spring.datasource.password');
        ensure(secret?.Type === 'bind' && secret.RW === false && secret.Source === join(root, 'secrets/spring.datasource.password'));
        const data = m.get(name === 'postgres' ? '/var/lib/postgresql/data' : '/data/media'); ensure(data?.Type === 'volume' && data.RW === true && data.Name === `${project}_${name === 'postgres' ? 'db-data' : 'media-data'}`);
      }
    }
    const base = await list(['image', 'inspect', build.baseImage]); ensure(base.length === 1 && base[0].Id === build.baseImage && base[0].Os === 'linux');
    const volumes = await list(['volume', 'inspect', ...volumeNames]); ensure(volumes.length === 2 && new Set(volumes.map(v => v.Name)).size === 2);
    for (const v of volumes) {
      const name = ['db-data', 'media-data'].find(k => v.Name === `${project}_${k}`);
      ensure(name && v.Driver === 'local' && absolutePath(v.Mountpoint) && v.Labels?.['com.docker.compose.project'] === project && v.Labels['com.docker.compose.volume'] === name && (!v.Options || Object.keys(v.Options).length === 0));
      const data = mounts.get(name === 'db-data' ? 'postgres' : 'cms-api').get(name === 'db-data' ? '/var/lib/postgresql/data' : '/data/media');
      ensure(data.Source === v.Mountpoint);
    }
    ensure(!overlaps(volumes[0].Mountpoint, volumes[1].Mountpoint));
    for (const c of all.filter(c => !allowed.includes(c))) for (const mount of c.Mounts) {
      if (['bind', 'volume'].includes(mount.Type)) ensure(absolutePath(mount.Source));
      if (typeof mount.Source === 'string' && mount.Source) ensure(!volumes.some(v => overlaps(mount.Source, v.Mountpoint)));
    }
    const ingress = mounts.get('ingress'); ensure(ingress.size === 8 && [...ingress.values()].every(m => m.Type === 'bind' && m.RW === false));
    for (const [destination, source] of [['/tool/ingress.mjs', script], ['/config/ingress.json', join(root, 'ingress.json')], ['/tls/leaf.crt', join(root, 'tls/leaf.crt')], ['/tls/leaf.key', join(root, 'tls/leaf.key')]]) ensure(ingress.get(destination)?.Source === source);
    for (const surface of ['front', 'back', 'admin']) { const dist = join(cwd, 'apps', `web-${surface}`, 'dist'); ensure(ingress.get(`/dist/${surface}`)?.Source === dist && equal(await tree(dist), artifacts.dist?.[surface])); }
    const nodeBinary = ingress.get('/opt/pp1-node')?.Source; ensure(typeof nodeBinary === 'string' && hex(artifacts.nodeBinarySha256, 64) && digest(await regular(nodeBinary)) === artifacts.nodeBinarySha256);
    const databaseOidText = (await docker(['exec', service.get('postgres').Id, 'psql', '-X', '-q', '-t', '-A', '-U', 'cms_local', '-d', 'cms', '-c', 'SELECT oid FROM pg_database WHERE datname = current_database();'])).trim();
    ensure(/^[1-9][0-9]*$/.test(databaseOidText)); const databaseOid = Number(databaseOidText); ensure(Number.isSafeInteger(databaseOid) && databaseOid <= 4294967295);
    const target = { version: 1, runId, targetId: `pp1-local:${runId}`, project, sourceCommit: receipt.sourceCommit, apiBuild: build, images: receipt.images,
      containerIds, networkIds: Object.fromEntries([...networkMap].map(([name, n]) => [name, n.Id])), volumeNames: { 'db-data': volumeNames[0], 'media-data': volumeNames[1] },
      databaseOid, ingressScriptSha256: artifacts.ingressScriptSha256, nodeBinarySha256: artifacts.nodeBinarySha256, mediaProbeSha256 };
    const maintenance = join(root, 'maintenance'), metadata = join(maintenance, 'target.json');
    try { await ancestors(maintenance); const info = await lstat(maintenance); ensure(info.isDirectory() && (info.mode & 0o7777) === 0o700 && info.uid === process.getuid()); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await lstat(metadata); const stored = JSON.parse(await regular(metadata, true)); ensure(keys(stored, Object.keys(target)) && Object.keys(target).every(k => equal(stored[k], target[k]))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const endpoint = service.get('postgres').NetworkSettings.Networks[`${project}_data`];
    const inspection = freeze({ target, jdbcUrl: `jdbc:postgresql://${endpoint.IPAddress}:5432/cms`, dataGateway: networkMap.get('data').IPAM.Config[0].Gateway });
    capabilities.set(inspection, { nodeBinary, probe, env, apiState, runRoot: root, workflow, jar: join(libs, jars[0]), sessionMetadata,
      apiDataAddress:service.get('cms-api').NetworkSettings.Networks[`${project}_data`].IPAddress,
      ingressWebAddress:service.get('ingress').NetworkSettings.Networks[`${project}_web`].IPAddress }); return inspection;
  } catch { fail(); }
}
export function mediaProbeCommand(inspection, operationId) {
  const capability = capabilities.get(inspection); ensure(capability && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operationId));
  const { target } = inspection, name = `${target.project}-media-probe-${operationId}`;
  for (const path of [capability.nodeBinary, capability.probe]) ensure(!/[,\r\n\0]/.test(path));
  return { file: 'docker', args: ['--host', 'unix:///var/run/docker.sock', 'run', '--rm', '--pull', 'never', '--name', name,
    '--label', `org.cms.pp1.run-id=${target.runId}`, '--label', `org.cms.pp1.operation-id=${operationId}`, '--label', 'org.cms.pp1.role=media-probe',
    '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', `type=volume,src=${target.volumeNames['media-data']},dst=/media,readonly`,
    '--mount', `type=bind,src=${capability.nodeBinary},dst=/opt/pp1-node,readonly`, '--mount', `type=bind,src=${capability.probe},dst=/tool/probe.mjs,readonly`,
    '--entrypoint', '/opt/pp1-node', target.images.node, '/tool/probe.mjs'], options: { env: { ...capability.env }, shell: false, timeout: 30000, maxBuffer: 1024 } };
}

export function inspectionDetails(inspection) {
  const details=capabilities.get(inspection);ensure(details);
  return Object.freeze({nodeBinary:details.nodeBinary,apiState:details.apiState,runRoot:details.runRoot,apiDataAddress:details.apiDataAddress,ingressWebAddress:details.ingressWebAddress});
}

// This observation is valid for the controlled fresh local lifecycle. Its caller
// must establish that external configuration was not loaded and removed earlier.
const inheritedApiEnv = [
  'PATH=/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  'JAVA_HOME=/opt/java/openjdk', 'LANG=en_US.UTF-8', 'LANGUAGE=en_US:en',
  'LC_ALL=en_US.UTF-8', 'JAVA_VERSION=jdk-25.0.5+8'
];
function sessionMetadataProven(capability) {
  const { config, imageConfig, expectedEnv, lifecycle } = capability.sessionMetadata;
  ensure(capability.apiState === 'running' ? lifecycle.status === 'running' : ['created', 'exited'].includes(lifecycle.status));
  ensure(['created', 'started', 'finished'].every(k => typeof lifecycle[k] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(lifecycle[k])));
  ensure(lifecycle.restarts === 0);
  for (const value of [config, imageConfig]) {
    ensure(equal(value.Entrypoint, ['java', '-jar', '/app/app.jar']));
    ensure((value.Cmd ?? null) === null && value.WorkingDir === '/app');
  }
  ensure(Array.isArray(imageConfig.Env) && equal([...imageConfig.Env].sort(), [...inheritedApiEnv].sort()));
  const expected = [...inheritedApiEnv, ...Object.entries(expectedEnv).map(([k, v]) => `${k}=${v}`)];
  ensure(Array.isArray(config.Env) && equal([...config.Env].sort(), expected.sort()));
}
export async function observedSessionConfig(inspection, deps = {}) {
  try {
    const capability = capabilities.get(inspection); ensure(capability);
    sessionMetadataProven(capability);
    const fresh = async () => {
      const value = await inspectTarget(capability.runRoot, deps, { apiState: capability.apiState, workflow: capability.workflow });
      ensure(equal(value, inspection)); const current = capabilities.get(value); sessionMetadataProven(current);
      ensure(equal(current.sessionMetadata, capability.sessionMetadata)); return current;
    };
    await fresh();
    const settings = await readSessionSettings(inspection, capability, deps);
    await fresh(); ensure(digest(await regular(capability.jar)) === inspection.target.apiBuild.jarSha256);
    ensure(keys(settings, ['sessionAbsoluteSeconds', 'sessionMaxSeconds']));
    ensure(Object.values(settings).every(v => typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n));
    return Object.freeze(settings);
  } catch { throw new OpsError('ADAPTER_UNSEALED'); }
}
function configTar(bytes, limit) {
  ensure(Buffer.isBuffer(bytes) && bytes.length <= limit + 65536 && bytes.length % 512 === 0);
  const entries = new Map(); let offset = 0, ended = false, payload = 0;
  const field = bytes => { const end = bytes.indexOf(0); return bytes.subarray(0, end < 0 ? bytes.length : end).toString('utf8'); };
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) {
      ensure(offset + 512 <= bytes.length && bytes.subarray(offset).every(byte => byte === 0)); ended = true; break;
    }
    ensure(field(header.subarray(257, 263)) === 'ustar');
    const stored = field(header.subarray(148, 156)).trim(); ensure(/^[0-7]+$/.test(stored));
    const checksum = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
    ensure(parseInt(stored, 8) === checksum && field(header.subarray(345, 500)) === '');
    const name = field(header.subarray(0, 100)), type = String.fromCharCode(header[156]);
    ensure(/^[a-zA-Z0-9._/-]+$/.test(name) && !name.startsWith('/') && !name.split('/').some(p => p === '.' || p === '..'));
    ensure(entries.size < 32 && !entries.has(name) && ['0', '5', '\0'].includes(type) && field(header.subarray(157, 257)) === '');
    const octal = field(header.subarray(124, 136)).trim(); ensure(/^[0-7]+$/.test(octal));
    const size = parseInt(octal, 8); payload += size; ensure(Number.isSafeInteger(size) && payload <= limit && (type !== '5' || size === 0));
    const next = offset + Math.ceil(size / 512) * 512; ensure(next <= bytes.length);
    ensure(bytes.subarray(offset + size, next).every(byte => byte === 0));
    entries.set(name, { directory: type === '5', bytes: bytes.subarray(offset, offset + size) }); offset = next;
  }
  ensure(ended); return entries;
}
async function readSessionSettings(inspection, capability, deps) {
  const command = deps.command ?? execute, id = inspection.target.containerIds['cms-api'];
  const copy = async (path, limit, absent = false) => {
    const options = { env: { ...capability.env }, shell: false, timeout: 30000, maxBuffer: limit + 65536, encoding: 'buffer' };
    let result;
    try { result = await command('docker', ['--host', 'unix:///var/run/docker.sock', 'cp', `${id}:${path}`, '-'], options); }
    catch (error) { result = error; }
    ensure(Buffer.isBuffer(result.stdout) && Buffer.isBuffer(result.stderr) && !result.signal && !result.killed);
    if (absent) {
      ensure(result.code === 1 && result.stdout.length === 0 && result.stderr.equals(Buffer.from(`Error response from daemon: Could not find the file ${path} in container ${id}\n`)));
      return null;
    }
    ensure((result.code === undefined || result.code === 0) && result.stderr.length === 0);
    return configTar(result.stdout, limit);
  };
  const inspectFiles = async () => {
  const jar = await copy('/app/app.jar', 268435456);
  ensure(jar.size === 1 && jar.get('app.jar')?.directory === false && digest(jar.get('app.jar').bytes) === inspection.target.apiBuild.jarSha256);
  for (const base of ['/app', '']) {
    await copy(`${base}/config`, 1048576, true);
    for (const profile of ['', '-prod']) for (const extension of ['yaml', 'yml', 'properties']) await copy(`${base}/application${profile}.${extension}`, 1048576, true);
  }
  const secrets = await copy('/run/secrets', 1048576), directory = secrets.get('secrets') ?? secrets.get('secrets/');
  ensure(secrets.size === 2 && directory?.directory === true && secrets.get('secrets/spring.datasource.password')?.directory === false);
  };
  await inspectFiles();
  const settings = await probeSessionJar(capability, inspection.target.apiBuild.jarSha256, command);
  await inspectFiles(); return settings;
}
const sessionProbeSource = String.raw`import java.net.URLClassLoader;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import java.util.jar.*;
import java.util.zip.*;
public final class SessionSettingsProbe {
  static final Map<String,String> CONFIG = Map.of(
    "BOOT-INF/classes/application.yaml", "7e10f4aacf8ec01d11a976cc113e5c1e830b45bfbac753aa1d86fe52046ac25f",
    "BOOT-INF/classes/application-prod.yaml", "20569e43b73f2780e9746337bc87a7550a095eaa93015983dbf7390c020fe137");
  static final List<String> CLASSES = List.of("com/fallrising/cms/identity/IdentityProperties.class", "com/fallrising/cms/identity/domain/Surface.class");
  static void require(boolean condition) { if (!condition) throw new IllegalStateException(); }
  static String sha(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
  static boolean config(String name) {
    String base = name.substring(name.lastIndexOf('/') + 1);
    return (base.startsWith("application") || base.startsWith("bootstrap")) && (base.endsWith(".yaml") || base.endsWith(".yml") || base.endsWith(".properties"));
  }
  static byte[] bounded(java.io.InputStream input) throws Exception {
    byte[] value = input.readNBytes(1048577); require(value.length <= 1048576); return value;
  }
  public static void main(String[] args) throws Exception {
    require(args.length == 3 && Runtime.version().feature() == 25);
    Path source = Path.of(args[0]), output = Path.of(args[2]);
    require(sha(Files.readAllBytes(source)).equals(args[1]));
    Set<String> names = new HashSet<>(), configs = new HashSet<>(), classes = new HashSet<>();
    try (JarFile jar = new JarFile(source.toFile())) {
      var entries = jar.entries();
      while (entries.hasMoreElements()) {
        JarEntry entry = entries.nextElement(); String name = entry.getName(); require(names.add(name));
        if (config(name)) {
          require(CONFIG.containsKey(name));
          try (var input = jar.getInputStream(entry)) { require(sha(bounded(input)).equals(CONFIG.get(name))); }
          configs.add(name);
        }
        if (name.startsWith("BOOT-INF/lib/") && name.endsWith(".jar")) {
          try (var nested = new ZipInputStream(jar.getInputStream(entry))) {
            ZipEntry item; int count = 0;
            while ((item = nested.getNextEntry()) != null) { require(++count < 100000 && !config(item.getName())); nested.closeEntry(); }
          }
        }
        for (String type : CLASSES) if (name.equals("BOOT-INF/classes/" + type)) {
          Path file = output.resolve(type), directory = output;
          for (Path part : output.relativize(file.getParent())) {
            directory = directory.resolve(part);
            if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) Files.createDirectory(directory, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            require(Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS));
          }
          try (var input = jar.getInputStream(entry)) {
            Files.createFile(file, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            Files.write(file, bounded(input));
          }
          classes.add(type);
        }
      }
    }
    require(configs.equals(CONFIG.keySet()) && classes.equals(new HashSet<>(CLASSES)));
    try (var loader = new URLClassLoader(new java.net.URL[]{output.toUri().toURL()}, ClassLoader.getPlatformClassLoader())) {
      Class<?> type = Class.forName("com.fallrising.cms.identity.IdentityProperties", true, loader);
      Object properties = type.getConstructor().newInstance();
      Duration absolute = (Duration) type.getMethod("getSessionAbsolute").invoke(properties);
      Duration maximum = (Duration) type.getMethod("getSessionMax").invoke(properties);
      require(!absolute.isNegative() && !absolute.isZero() && absolute.getNano() == 0 && !maximum.isNegative() && !maximum.isZero() && maximum.getNano() == 0);
      require(sha(Files.readAllBytes(source)).equals(args[1]));
      System.out.println("{\"sessionAbsoluteSeconds\":\"" + absolute.getSeconds() + "\",\"sessionMaxSeconds\":\"" + maximum.getSeconds() + "\"}");
    }
  }
}
`;
async function probeSessionJar(capability, expectedHash, command) {
  ensure(digest(await regular(capability.jar)) === expectedHash);
  const directory = await mkdtemp(join(capability.runRoot, 'session-config-'));
  const stat = await lstat(directory); ensure(stat.isDirectory() && (stat.mode & 0o7777) === 0o700 && stat.uid === process.getuid());
  const source = join(directory, 'SessionSettingsProbe.java');
  await writeFile(source, sessionProbeSource, { mode: 0o600, flag: 'wx' });
  const result = await command('/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8/bin/java', [source, capability.jar, expectedHash, directory],
    { env: { LANG: 'C.UTF-8', TZ: 'UTC' }, shell: false, timeout: 30000, maxBuffer: 4096 });
  ensure((result.code === undefined || result.code === 0) && !result.signal && !result.killed && result.stderr === '' && typeof result.stdout === 'string');
  const match = /^\{"sessionAbsoluteSeconds":"([1-9][0-9]{0,18})","sessionMaxSeconds":"([1-9][0-9]{0,18})"\}\n$/.exec(result.stdout);
  ensure(match); return { sessionAbsoluteSeconds: match[1], sessionMaxSeconds: match[2] };
}
