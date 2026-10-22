import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, readFile, readlink, realpath, rename, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { argumentsFor, buildReading } from './build.ts';
import { COMMIT, SAFE_ID, exactKeys, object, parseBundle, safePath, validText } from './bundle.ts';
import { blob, git } from './git.ts';

export type TrialConfig = {
  version: 1; appDir: string; contentRepo: string; contentCommit: string; registry: string;
  contentBranch: string; contentRemote: string; exportRepo: string; exportBranch: string;
  exportRemote: string; baseUrl: string; tokenFile: string; releaseRoot: string;
};
type Asset = { path: string; size: number; sha256: string };
type Manifest = { version: 1; contentCommit: string; registry: string; articles: number; files: Asset[] };
const execute = promisify(execFile);
const CONFIG_KEYS = ['version', 'appDir', 'contentRepo', 'contentCommit', 'registry', 'contentBranch', 'contentRemote', 'exportRepo', 'exportBranch', 'exportRemote', 'baseUrl', 'tokenFile', 'releaseRoot'];
const inside = (parent: string, path: string) => path === parent || path.startsWith(parent + sep);
type CheckStage = 'config' | 'runtime' | 'paths' | 'credentials' | 'content-checkout' | 'export-checkout' | 'registry' | 'artifact';
class TrialFailure extends Error {
  stage: CheckStage;
  constructor(stage: CheckStage) { super(`Private trial check failed (${stage})`); this.stage = stage; }
}
async function appRoot(appDir: string) {
  try { return (await git(appDir, ['rev-parse', '--show-toplevel'])).trim(); }
  catch { return appDir; } // Non-Git synthetic app directories support isolated unit fixtures.
}

function configValue(value: unknown): TrialConfig {
  if (!object(value) || !exactKeys(value, CONFIG_KEYS) || value.version !== 1 || CONFIG_KEYS.slice(1).some(key => typeof value[key] !== 'string' || !value[key] || /[\0\r\n]/u.test(value[key] as string))) throw new Error('Invalid trial configuration');
  const config = value as TrialConfig;
  if (!COMMIT.test(config.contentCommit) || !safePath(config.registry) || ['appDir', 'contentRepo', 'exportRepo', 'tokenFile', 'releaseRoot'].some(key => !isAbsolute(config[key as keyof TrialConfig] as string))) throw new Error('Invalid trial paths or immutable source');
  for (const remote of [config.contentRemote, config.exportRemote]) {
    if (remote.startsWith('https://') || remote.startsWith('ssh://')) {
      let url: URL; try { url = new URL(remote); } catch { throw new Error('Invalid trial remote'); }
      if (url.password || url.search || url.hash || url.protocol === 'https:' && url.username) throw new Error('Remote credentials must remain outside configuration');
    } else if (!isAbsolute(remote) && !/^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:[A-Za-z0-9_./-]+$/u.test(remote)) throw new Error('Invalid trial remote');
  }
  let url: URL; try { url = new URL(config.baseUrl); } catch { throw new Error('Invalid trial endpoint'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) throw new Error('Invalid trial endpoint');
  return config;
}

async function regular(path: string, privateMode = false, max = 32 * 1024 * 1024) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > max || privateMode && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)) throw new Error('Unsafe trial file');
  return stat;
}
async function directory(path: string, privateMode = false) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== resolve(path) || privateMode && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)) throw new Error('Unsafe trial directory');
}
export async function readConfig(path: string): Promise<TrialConfig> {
  try {
    await regular(path, true, 16384);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 16384) throw new Error('Unsafe config');
      const config = configValue(JSON.parse(await handle.readFile('utf8')));
      const canonical = await realpath(path);
      if ([await appRoot(config.appDir), config.contentRepo, config.exportRepo, config.releaseRoot].some(root => inside(resolve(root), canonical))) throw new Error('Configuration must remain outside checkouts and releases');
      return config;
    } finally { await handle.close(); }
  } catch { throw new TrialFailure('config'); }
}

async function checkout(repo: string, branch: string, remote: string) {
  await directory(repo);
  const configKeys = await git(repo, ['config', '--list', '--name-only', '-z']);
  if (configKeys.split('\0').some(key => /^(extensions\.partialclone|remote\..*\.promisor)$/iu.test(key))) throw new Error('Offline preflight requires a complete non-promisor clone');
  await git(repo, ['check-ref-format', '--branch', branch]);
  if ((await git(repo, ['rev-parse', '--show-toplevel'])).trim() !== repo || (await git(repo, ['symbolic-ref', '--short', 'HEAD'])).trim() !== branch) throw new Error('Unexpected trial checkout or branch');
  // Match the exporter's guard before status: repository attributes can run
  // configured clean/process filters. ls-files itself does not apply filters;
  // omitting exclude rules also includes ignored/untracked attributes files.
  const localTree = await git(repo, ['ls-files', '--cached', '--others', '-z']);
  if (localTree.split('\0').some(path => path === '.gitattributes' || path.endsWith('/.gitattributes'))) throw new Error('Checkout attributes require operator resolution');
  const attributesPath = resolve(repo, (await git(repo, ['rev-parse', '--git-path', 'info/attributes'])).trim());
  try {
    const attributes = await lstat(attributesPath);
    if (!attributes.isFile() || attributes.isSymbolicLink() || attributes.size !== 0) throw new Error('Checkout attributes require operator resolution');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if ((await git(repo, ['status', '--porcelain=v1', '--untracked-files=all'])).trim()) throw new Error('Dirty trial checkout; preserve work before continuing');
  if ((await git(repo, ['remote', 'get-url', '--all', 'origin'])).trim() !== remote || (await git(repo, ['remote', 'get-url', '--push', '--all', 'origin'])).trim() !== remote) throw new Error('Unexpected trial remote');
  // Cached tracking state is informative only. It does not prove remote access,
  // and an absent ref is allowed before the owner's first explicit fetch.
  let cachedTracking: { ahead: number; behind: number } | null = null;
  try {
    const counts = (await git(repo, ['rev-list', '--left-right', '--count', `HEAD...refs/remotes/origin/${branch}`])).trim().split(/\s+/u).map(Number);
    cachedTracking = { ahead: counts[0]!, behind: counts[1]! };
  } catch { /* Offline checkout may not yet have a tracking ref. */ }
  if (cachedTracking && cachedTracking.ahead > 0 && cachedTracking.behind > 0) throw new Error('Cached Git divergence requires operator resolution');
  return cachedTracking;
}

/** Local reads only: no fetch, HTTP, credential-content reads or artifact writes. */
export async function preflight(input: TrialConfig) {
  let stage: CheckStage = 'config';
  try {
  const config = configValue(input);
  stage = 'runtime';
  if (process.version !== 'v24.18.0' || process.platform !== 'linux') throw new Error('Trial preparation requires Linux and Node 24.18.0');
  stage = 'paths';
  await directory(config.appDir); await directory(config.releaseRoot, true);
  const roots = [await appRoot(config.appDir), config.contentRepo, config.exportRepo];
  if (roots.some(root => inside(resolve(root), resolve(config.releaseRoot)) || inside(resolve(config.releaseRoot), resolve(root)) || inside(resolve(root), resolve(config.tokenFile))) || inside(config.releaseRoot, config.tokenFile)) throw new Error('Private paths must remain outside checkouts and releases');
  stage = 'credentials';
  await regular(config.tokenFile, true, 1024);
  if (await realpath(config.tokenFile) !== resolve(config.tokenFile)) throw new Error('Unsafe credential path');
  stage = 'runtime';
  await regular(join(config.appDir, 'web/package.json'), false, 65536);
  const pkg = JSON.parse(await readFile(join(config.appDir, 'web/package.json'), 'utf8'));
  if (pkg?.engines?.node !== '24.18.0' || typeof pkg?.scripts?.build !== 'string') throw new Error('Unexpected web build contract');
  stage = 'content-checkout'; const contentTracking = await checkout(config.contentRepo, config.contentBranch, config.contentRemote);
  stage = 'export-checkout'; const exportTracking = await checkout(config.exportRepo, config.exportBranch, config.exportRemote);
  stage = 'paths';
  const contentCommon = await realpath((await git(config.contentRepo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
  const exportCommon = await realpath((await git(config.exportRepo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
  if (inside(config.contentRepo, config.exportRepo) || inside(config.exportRepo, config.contentRepo) || contentCommon === exportCommon) throw new Error('Content and export require separate clones');
  stage = 'runtime'; const gitVersion = (await git(config.appDir, ['--version'], 128)).trim();
  if (!/^git version [0-9.]+(?:[ .][A-Za-z0-9.-]+)*$/u.test(gitVersion)) throw new Error('Unexpected Git version');
  stage = 'registry';
  if ((await git(config.contentRepo, ['rev-parse', '--verify', `${config.contentCommit}^{commit}`], 128)).trim() !== config.contentCommit) throw new Error('Pinned content commit unavailable locally');
  const registry: unknown = JSON.parse(await blob(config.contentRepo, config.contentCommit, config.registry, 256 * 1024));
  if (!object(registry) || !exactKeys(registry, ['version', 'articles']) || registry.version !== 1 || !Array.isArray(registry.articles) || registry.articles.length < 1 || registry.articles.length > 200) throw new Error('A nonempty article registry is required');
  const ids = new Set<string>();
  for (const article of registry.articles) {
    if (!object(article) || !exactKeys(article, ['id', 'title', 'path']) || typeof article.id !== 'string' || !SAFE_ID.test(article.id) || ids.has(article.id) || !validText(article.title, 200) || !safePath(article.path)) throw new Error('Invalid article registry');
    ids.add(article.id);
  }
  return { offline: true as const, node: process.version, git: gitVersion, commit: config.contentCommit, articles: registry.articles.length, contentTracking, exportTracking, remoteAccessVerified: false as const };
  } catch { throw new TrialFailure(stage); }
}

async function inventory(assetsDir: string): Promise<Asset[]> {
  await directory(assetsDir); const files: Asset[] = []; let total = 0;
  async function visit(path: string, depth: number) {
    if (depth > 32) throw new Error('Artifact depth exceeds bound');
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name); const name = relative(assetsDir, full).split(sep).join('/');
      if (!safePath(name)) throw new Error('Unsafe asset path');
      if (entry.isDirectory()) { await directory(full); await visit(full, depth + 1); continue; }
      const stat = await regular(full); total += stat.size;
      if (files.length >= 10000 || total > 256 * 1024 * 1024) throw new Error('Artifact size exceeds bound');
      files.push({ path: name, size: stat.size, sha256: createHash('sha256').update(await readFile(full)).digest('hex') });
    }
  }
  await visit(assetsDir, 0); return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

async function webAssets(assetsDir: string, files: Asset[]) {
  if (!files.some(file => file.path === 'index.html') || !files.some(file => /^assets\/.+\.js$/u.test(file.path)) || !files.some(file => /^assets\/.+\.css$/u.test(file.path))) throw new Error('Incomplete web assets');
  const html = await readFile(join(assetsDir, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gu)) {
    const target = match[1]!;
    if (target.startsWith('#') || target.startsWith('data:')) continue;
    if (!target.startsWith('/') || target.startsWith('//') || !files.some(file => file.path === target.slice(1).split(/[?#]/u)[0])) throw new Error('Missing or external web entry asset');
  }
}

export async function verifyRelease(releaseDir: string, expectedCommit: string, expectedRegistry?: string): Promise<{ commit: string; articles: number }> {
  if (!COMMIT.test(expectedCommit)) throw new Error('Invalid expected content commit');
  const canonical = await realpath(releaseDir); await directory(canonical);
  const manifestPath = join(canonical, 'manifest.json'); await regular(manifestPath, false, 4 * 1024 * 1024);
  const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!object(manifest) || !exactKeys(manifest, ['version', 'contentCommit', 'registry', 'articles', 'files']) || manifest.version !== 1 || manifest.contentCommit !== expectedCommit || !safePath(manifest.registry) || !Number.isInteger(manifest.articles) || Number(manifest.articles) < 1 || Number(manifest.articles) > 200 || !Array.isArray(manifest.files)) throw new Error('Invalid release manifest');
  if (expectedRegistry !== undefined && manifest.registry !== expectedRegistry) throw new Error('Unexpected release registry');
  const files = await inventory(join(canonical, 'assets'));
  if (JSON.stringify(manifest.files) !== JSON.stringify(files)) throw new Error('Release asset integrity failed');
  await webAssets(join(canonical, 'assets'), files);
  const bundle = parseBundle(JSON.parse(await readFile(join(canonical, 'assets/_reading/current.json'), 'utf8')));
  if (!bundle || bundle.commit !== expectedCommit || bundle.articles.length !== manifest.articles || !bundle.articles.length) throw new Error('Release bundle rejected');
  return { commit: bundle.commit, articles: bundle.articles.length };
}

async function buildWeb(appDir: string, assetsDir: string) {
  // Use the npm shipped beside this pinned Node; do not resolve npx/install.
  const npm = resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
  await execute(process.execPath, [npm, '--prefix', join(appDir, 'web'), 'run', 'build', '--', '--outDir', assetsDir, '--emptyOutDir'], {
    env: { ...process.env, PATH: dirname(process.execPath) + ':' + (process.env.PATH ?? ''), npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' }, timeout: 300_000, maxBuffer: 4 * 1024 * 1024,
  });
}

async function activeTarget(root: string): Promise<string | null> {
  const current = join(root, 'current');
  try {
    const stat = await lstat(current);
    if (!stat.isSymbolicLink()) throw new Error('Current release is not a managed pointer');
    const target = await readlink(current);
    if (!/^releases\/[a-f0-9-]{36}$/u.test(target)) throw new Error('Unsafe current release pointer');
    const full = join(root, target); await directory(full); return full;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

async function acquire(root: string) {
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((yes, no) => { server.once('error', () => no(new Error('Trial preparation already running'))); server.listen('\0kith-trial-' + createHash('sha256').update(root).digest('hex'), yes); });
  return () => new Promise<void>(yes => server.close(() => yes()));
}

export async function prepareRelease(config: TrialConfig, hooks: { buildWeb?: (appDir: string, assetsDir: string) => Promise<void> } = {}) {
  await preflight(config);
  const releaseLock = await acquire(config.releaseRoot);
  try {
    await activeTarget(config.releaseRoot);
    const releases = join(config.releaseRoot, 'releases');
    await mkdir(releases, { recursive: true, mode: 0o700 }); await directory(releases, true);
    const id = randomUUID(); const releaseDir = join(releases, id); const assetsDir = join(releaseDir, 'assets');
    await mkdir(releaseDir, { mode: 0o700 });
    try { await (hooks.buildWeb ?? buildWeb)(config.appDir, assetsDir); } catch { throw new Error('Web build failed; current release preserved'); }
    await directory(assetsDir); await chmod(assetsDir, 0o700);
    // Do not allow an inherited or symlinked private asset directory.
    const readingDir = join(assetsDir, '_reading');
    await mkdir(readingDir, { recursive: true, mode: 0o700 }); await directory(readingDir);
    const bundle = await buildReading({ repo: config.contentRepo, commit: config.contentCommit, registry: config.registry, output: join(readingDir, 'current.json') });
    if (!bundle.articles.length) throw new Error('Empty private content cannot activate');
    const files = await inventory(assetsDir);
    const manifest: Manifest = { version: 1, contentCommit: config.contentCommit, registry: config.registry, articles: bundle.articles.length, files };
    const handle = await open(join(releaseDir, 'manifest.json'), 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(manifest) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await verifyRelease(releaseDir, config.contentCommit, config.registry);
    // Finish all fallible durability work before the activation commit point.
    // A sudden host power loss can retain either pointer; both target complete
    // retained releases. Atomic activation is not a filesystem backup policy.
    for (const file of files) { const handle = await open(join(assetsDir, file.path), 'r'); try { await handle.sync(); } finally { await handle.close(); } }
    for (const path of [...new Set(files.map(file => dirname(join(assetsDir, file.path))))].sort((a, b) => b.length - a.length).concat([assetsDir, releaseDir, releases])) {
      const dir = await open(path, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    }
    await activeTarget(config.releaseRoot);
    const temporary = join(config.releaseRoot, `.current-${id}`);
    await symlink(`releases/${id}`, temporary);
    const dir = await open(config.releaseRoot, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    await rename(temporary, join(config.releaseRoot, 'current'));
    return { releaseDir, commit: bundle.commit, articles: bundle.articles.length };
  } finally { await releaseLock(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const command = process.argv[2];
    if (!['preflight', 'prepare', 'verify'].includes(command ?? '')) throw new Error('Invalid command');
    const args = argumentsFor(process.argv.slice(3), ['--config']); const config = await readConfig(args['--config']!);
    if (command === 'preflight') console.log(JSON.stringify(await preflight(config)));
    else if (command === 'prepare') { const result = await prepareRelease(config); console.log(JSON.stringify({ prepared: true, commit: result.commit, articles: result.articles })); }
    else { await directory(config.releaseRoot, true); const target = await activeTarget(config.releaseRoot); if (!target) throw new Error('No active release'); console.log(JSON.stringify({ verified: true, ...await verifyRelease(target, config.contentCommit, config.registry) })); }
  } catch (error) { console.error(`Private trial operation failed (${error instanceof TrialFailure ? error.stage : 'artifact'}); inspect local configuration and preserve previous release.`); process.exitCode = 1; }
}
