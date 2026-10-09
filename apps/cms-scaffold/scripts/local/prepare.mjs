import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { lstat, mkdir, readFile, readdir, writeFile, chmod } from 'node:fs/promises';
import { resolve, join, dirname, parse as parsePath } from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
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
export async function prepare(options, deps = {}) {
  const environment = deps.environment ?? process.env;
  const childEnvironment = { ...environment };
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete childEnvironment[key];
  const command = deps.command ?? ((file, args) => exec(file, args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: childEnvironment, shell: false }));
  const docker = async args => command('docker', ['--host', 'unix:///var/run/docker.sock', ...args]);
  const privateWrite = (path, data) => writeFile(path, data, { flag: 'wx', mode: 0o600 });
  try {
    parseArgs(['--run-id', options.runId, ...Object.entries(options.images).flatMap(([k, v]) => [`--${k}-image`, v])]);
    if ((deps.nodeVersion ?? process.version) !== 'v24.18.0') fail('PP1_LOCAL_INPUT_INVALID');
    if ((environment.DOCKER_HOST && environment.DOCKER_HOST !== 'unix:///var/run/docker.sock') ||
        (environment.DOCKER_CONTEXT && environment.DOCKER_CONTEXT !== 'default') || environment.DOCKER_TLS_VERIFY) fail('PP1_LOCAL_DOCKER_NOT_LOCAL');
    const cwd = await safePath(deps.cwd ?? process.cwd());
    const nodeBinary = await safePath(deps.nodeBinary ?? process.execPath);
    if (!(await lstat(nodeBinary)).isFile()) fail('PP1_LOCAL_PATH_INVALID');
    const root = await safePath(join(cwd, 'local', 'pp1', options.runId), true);
    if (await exists(root)) fail('PP1_LOCAL_TARGET_EXISTS');
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
    if (!await (deps.portAvailable ?? portAvailable)()) fail('PP1_LOCAL_PORT_BUSY');
    const dist = {}; const distPaths = {};
    for (const surface of surfaces) {
      distPaths[surface] = join(cwd, 'apps', `web-${surface}`, 'dist');
      dist[surface] = await digestTree(distPaths[surface]);
    }
    const sourceCommit = (await command('git', ['-C', cwd, 'rev-parse', 'HEAD'])).stdout.trim();
    if (!/^[a-f0-9]{40}$/.test(sourceCommit)) fail('PP1_LOCAL_ARTIFACT_INVALID');
    const worktreeDirty = Boolean((await command('git', ['-C', cwd, 'status', '--porcelain'])).stdout.trim());
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
    await mkdir(dirname(root), { recursive: true, mode: 0o700 });
    await mkdir(root, { mode: 0o700 });
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
