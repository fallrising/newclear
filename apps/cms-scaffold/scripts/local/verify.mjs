import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request } from 'node:https';
import { readFile, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const exec = promisify(execFile);
const fail = () => { throw new Error('PP1_LOCAL_VERIFICATION_FAILED'); };
const ensure = condition => { if (!condition) fail(); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function regular(path, privateFile = false) {
  const info = await lstat(path); ensure(info.isFile() && !info.isSymbolicLink());
  if (privateFile) ensure((info.mode & 0o777) === 0o600 && info.nlink === 1);
  return readFile(path);
}
async function tree(root) {
  const result = {}; ensure((await lstat(root)).isDirectory());
  async function walk(relative = '') {
    for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      ensure(!entry.isSymbolicLink());
      if (entry.isDirectory()) await walk(name);
      else { ensure(entry.isFile()); result[name] = digest(await readFile(join(root, name))); }
    }
  }
  await walk(); return result;
}
async function fetchHealth(root) {
  const ca = await regular(join(root, 'tls/ca.crt'), true);
  return new Promise((resolveHealth, reject) => {
    const req = request({ hostname: '127.0.0.1', port: 8443, path: '/actuator/health', servername: 'api.cms.test', ca,
      headers: { Host: 'api.cms.test:8443' }, timeout: 5000 }, response => {
      let body = ''; response.on('data', data => { body += data; if (body.length > 16384) req.destroy(new Error('PP1_LOCAL_HEALTH_FAILED')); });
      response.on('end', () => { try { ensure(response.statusCode === 200); resolveHealth(JSON.parse(body)); } catch { reject(new Error('PP1_LOCAL_HEALTH_FAILED')); } });
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('PP1_LOCAL_HEALTH_FAILED'))); req.on('error', reject); req.end();
  });
}
export async function verify(runRoot, deps = {}) {
  try {
    const root = resolve(runRoot); const info = await lstat(root);
    ensure(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o700);
    for (let parent = dirname(root); parent !== dirname(parent); parent = dirname(parent)) ensure(!(await lstat(parent)).isSymbolicLink());
    const receipt = JSON.parse(await regular(join(root, 'receipt.json'), true));
    const artifacts = JSON.parse(await regular(join(root, 'artifacts.json'), true));
    const secret = (await regular(join(root, 'secrets/spring.datasource.password'), true)).toString();
    ensure(secret.length >= 32 && receipt.version === 1 && receipt.environment === 'local-isolated' && receipt.phase === 'PREPARED');
    ensure(/^[a-f0-9]{32}$/.test(receipt.runId) && receipt.project === `cms-pp1-local-${receipt.runId}`);
    ensure(/^[a-f0-9]{40}$/.test(receipt.sourceCommit) && receipt.apiOrigin === 'https://api.cms.test:8443');
    ensure(artifacts.sourceCommit === receipt.sourceCommit && artifacts.apiOrigin === receipt.apiOrigin);
    const apiBuild = receipt.apiBuild;
    ensure(apiBuild && artifacts.apiBuild && Object.keys(apiBuild).length === 3 && Object.keys(artifacts.apiBuild).length === 3);
    ensure(apiBuild.sourceCommit === receipt.sourceCommit && /^[a-f0-9]{64}$/.test(apiBuild.jarSha256) && /^sha256:[a-f0-9]{64}$/.test(apiBuild.baseImage));
    ensure(['sourceCommit', 'jarSha256', 'baseImage'].every(key => artifacts.apiBuild[key] === apiBuild[key]));
    const project = receipt.project;
    for (const kind of ['api', 'node', 'postgres']) {
      ensure(/^sha256:[a-f0-9]{64}$/.test(receipt.images[kind])); ensure(receipt.imageRefs[kind] === `${project}-${kind}:verified`);
    }
    const env = { ...(deps.environment ?? process.env) };
    ensure(!env.DOCKER_HOST || env.DOCKER_HOST === 'unix:///var/run/docker.sock'); ensure(!env.DOCKER_CONTEXT || env.DOCKER_CONTEXT === 'default'); ensure(!env.DOCKER_TLS_VERIFY);
    for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key];
    const command = deps.command ?? ((file, args) => exec(file, args, { env, shell: false, timeout: 30000, maxBuffer: 16 * 1024 * 1024 }));
    const docker = args => command('docker', ['--host', 'unix:///var/run/docker.sock', ...args]);
    const ids = (await docker(['ps', '-a', '--no-trunc', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'])).stdout.trim().split('\n');
    ensure(ids.length === 3 && new Set(ids).size === 3 && ids.every(id => /^[a-f0-9]{64}$/.test(id)));
    const containers = JSON.parse((await docker(['inspect', ...ids])).stdout); ensure(containers.length === 3);
    const services = new Map(containers.map(c => [c.Config.Labels['com.docker.compose.service'], c]));
    ensure(services.size === 3 && ['postgres', 'cms-api', 'ingress'].every(name => services.has(name)));
    for (const [name, c] of services) {
      ensure(ids.includes(c.Id) && c.Config.Labels['com.docker.compose.project'] === project && c.State.Running);
      const kind = { postgres: 'postgres', 'cms-api': 'api', ingress: 'node' }[name]; ensure(c.Image === receipt.images[kind]);
      const resolved = JSON.parse((await docker(['image', 'inspect', receipt.imageRefs[kind]])).stdout); ensure(resolved.length === 1 && resolved[0].Id === c.Image);
      if (name === 'cms-api') {
        const labels = resolved[0].Config?.Labels;
        ensure(labels && labels['org.cms.pp1.source-commit'] === apiBuild.sourceCommit &&
          labels['org.cms.pp1.jar-sha256'] === apiBuild.jarSha256 && labels['org.cms.pp1.base-image'] === apiBuild.baseImage);
      }
      ensure(c.HostConfig.RestartPolicy.Name === 'no' && !c.HostConfig.Privileged && c.HostConfig.NetworkMode !== 'host');
      ensure(Object.keys(c.HostConfig.PortBindings ?? {}).length === 0);
      ensure(Object.values(c.NetworkSettings.Ports ?? {}).every(bindings => bindings === null || Array.isArray(bindings) && bindings.length === 0));
      if (name !== 'ingress') ensure(c.State.Health?.Status === 'healthy');
      const expected = name === 'cms-api' ? ['data', 'web'] : [name === 'postgres' ? 'data' : 'web'];
      ensure(JSON.stringify(Object.keys(c.NetworkSettings.Networks).sort()) === JSON.stringify(expected.map(n => `${project}_${n}`).sort()));
    }
    const networks = JSON.parse((await docker(['network', 'inspect', `${project}_web`, `${project}_data`])).stdout); ensure(networks.length === 2);
    for (const network of networks) {
      ensure([`${project}_web`, `${project}_data`].includes(network.Name) && network.Internal && network.Labels['com.docker.compose.project'] === project);
      ensure(Object.keys(network.Containers ?? {}).every(id => ids.includes(id)));
      for (const c of containers) if (c.NetworkSettings.Networks[network.Name]) ensure(c.NetworkSettings.Networks[network.Name].NetworkID === network.Id);
    }
    const api = services.get('cms-api'); const pg = services.get('postgres'); const ingress = services.get('ingress');
    const expectedEnv = { SPRING_PROFILES_ACTIVE: 'prod', CMS_RUNTIME_PRODUCTION_REQUIRED: 'true', CMS_SITE_DOMAIN: 'cms.test', CMS_API_ORIGIN: receipt.apiOrigin,
      CMS_CORS_ORIGINS: 'https://front.cms.test:8443,https://back.cms.test:8443,https://admin.cms.test:8443',
      CMS_SURFACE_ORIGINS: 'https://front.cms.test:8443:front,https://back.cms.test:8443:back,https://admin.cms.test:8443:admin',
      CMS_IDENTITY_SEED_ENABLED: 'false', CMS_IDENTITY_COOKIE_SECURE: 'true', SPRING_DATASOURCE_URL: 'jdbc:postgresql://postgres:5432/cms',
      SPRING_DATASOURCE_USERNAME: 'cms_local', SPRING_CONFIG_IMPORT: 'configtree:/run/secrets/', CMS_MEDIA_ROOT: '/data/media', SERVER_PORT: '8080' };
    const apiEnv = Object.fromEntries(api.Config.Env.map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
    ensure(Object.entries(expectedEnv).every(([k, v]) => apiEnv[k] === v));
    ensure(Object.keys(apiEnv).filter(k => /^(CMS_|SPRING_)/.test(k)).every(k => Object.hasOwn(expectedEnv, k)));
    const mounts = c => new Map(c.Mounts.map(m => [m.Destination, m]));
    for (const c of [pg, api]) {
      const m = mounts(c); ensure(m.size === 2 && c.Mounts.length === 2);
      const secretMount = m.get('/run/secrets/spring.datasource.password'); ensure(secretMount?.Type === 'bind' && !secretMount.RW && secretMount.Source === join(root, 'secrets/spring.datasource.password'));
      const data = m.get(c === pg ? '/var/lib/postgresql/data' : '/data/media');
      ensure(data?.Type === 'volume' && data.RW && data.Name === `${project}_${c === pg ? 'db-data' : 'media-data'}`);
    }
    const volumes = JSON.parse((await docker(['volume', 'inspect', `${project}_db-data`, `${project}_media-data`])).stdout);
    ensure(volumes.length === 2 && new Set(volumes.map(v => v.Name)).size === 2);
    ensure(volumes.every(v => [`${project}_db-data`, `${project}_media-data`].includes(v.Name) && v.Driver === 'local' && v.Labels['com.docker.compose.project'] === project));
    const im = mounts(ingress); ensure(im.size === 8 && ingress.Mounts.length === 8 && ingress.Mounts.every(m => m.Type === 'bind' && !m.RW));
    for (const [dest, file] of [['/config/ingress.json', 'ingress.json'], ['/tls/leaf.crt', 'tls/leaf.crt'], ['/tls/leaf.key', 'tls/leaf.key']]) ensure(im.get(dest)?.Source === join(root, file));
    for (const surface of ['front', 'back', 'admin']) {
      const source = im.get(`/dist/${surface}`)?.Source; ensure(source);
      const hashes = await tree(source); ensure(JSON.stringify(hashes) === JSON.stringify(artifacts.dist[surface]));
    }
    ensure(im.has('/tool/ingress.mjs') && im.has('/opt/pp1-node'));
    ensure(/^[a-f0-9]{64}$/.test(artifacts.ingressScriptSha256));
    ensure(digest(await regular(im.get('/tool/ingress.mjs').Source)) === artifacts.ingressScriptSha256);
    ensure(digest(await regular(im.get('/opt/pp1-node').Source)) === artifacts.nodeBinarySha256);
    const runtimeJar = (await docker(['exec', api.Id, 'sha256sum', '/app/app.jar'])).stdout;
    ensure(runtimeJar === `${apiBuild.jarSha256}  /app/app.jar\n` || runtimeJar === `${apiBuild.jarSha256}  /app/app.jar`);
    const countsSql = "SELECT json_build_object('principal',(SELECT count(*) FROM cms_principal),'credential',(SELECT count(*) FROM cms_credential),'permission',(SELECT count(*) FROM cms_permission),'session',(SELECT count(*) FROM cms_session),'entry',(SELECT count(*) FROM cms_entry),'media',(SELECT count(*) FROM cms_media),'navigation',(SELECT count(*) FROM cms_navigation_menu),'types',(SELECT count(*) FROM cms_content_type),'roles',(SELECT count(*) FROM cms_role),'failedMigrations',(SELECT count(*) FROM flyway_schema_history WHERE NOT success),'migrations',(SELECT count(*) FROM flyway_schema_history),'serverVersion',current_setting('server_version_num')::int)::text";
    const counts = JSON.parse((await docker(['exec', pg.Id, 'psql', '-X', '-q', '-t', '-A', '-U', 'cms_local', '-d', 'cms', '-c', countsSql])).stdout);
    for (const key of ['principal', 'credential', 'permission', 'session', 'entry', 'media', 'navigation', 'failedMigrations']) ensure(counts[key] === 0);
    ensure(counts.types === 12 && counts.roles === 5 && counts.migrations === 10 && counts.serverVersion >= 160000 && counts.serverVersion < 170000);
    for (const c of containers) {
      ensure(!c.Config.Env.some(value => value.includes(secret)));
      const logs = await docker(['logs', c.Id]); ensure(!`${logs.stdout}${logs.stderr ?? ''}`.includes(secret));
    }
    ensure((await (deps.fetchHealth ?? fetchHealth)(root)).status === 'UP');
    return { version: 1, environment: 'local-isolated', project, runId: receipt.runId, sourceCommit: receipt.sourceCommit,
      images: receipt.images, apiBuild, containerIds: Object.fromEntries([...services].map(([name, c]) => [name, c.Id])),
      networkIds: Object.fromEntries(networks.map(n => [n.Name, n.Id])), counts,
      checks: { privatePorts: true, ownership: true, noDemo: true, health: true, artifacts: true, secretAbsentFromLogs: true }, verifiedAt: new Date().toISOString() };
  } catch { fail(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--run-root') throw new Error('PP1_LOCAL_INPUT_INVALID');
    process.stdout.write(JSON.stringify(await verify(process.argv[3])) + '\n');
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 3; }
}
