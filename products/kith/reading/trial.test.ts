import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readlink, chmod, symlink, unlink, access, utimes } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, URL } from 'node:url';
import { preflight, prepareRelease, readConfig, verifyRelease } from './trial.ts';
import type { TrialConfig } from './trial.ts';

const git = (repo: string, ...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } }).trim();
const web = async (_appDir: string, assets: string) => {
  await mkdir(join(assets, 'assets'), { recursive: true });
  await writeFile(join(assets, 'index.html'), '<script type="module" src="/assets/main.js"></script><link rel="stylesheet" href="/assets/main.css">');
  await writeFile(join(assets, 'assets/main.js'), 'console.log("synthetic");');
  await writeFile(join(assets, 'assets/main.css'), 'body { color: black }');
};
async function fixture() {
  const root = await mkdtemp(join(process.env.AGENT_BUILD_DIR ?? tmpdir(), 'trial-'));
  const repo = join(root, 'content'); const remote = join(root, 'remote.git'); const exportRepo = join(root, 'export'); const appDir = join(root, 'app'); const releaseRoot = join(root, 'releases'); const tokenFile = join(root, 'token');
  await mkdir(repo); await mkdir(join(appDir, 'web'), { recursive: true }); await mkdir(releaseRoot, { mode: 0o700 });
  await writeFile(join(appDir, 'web/package.json'), JSON.stringify({ engines: { node: '24.18.0' }, scripts: { build: 'vite build' } }));
  git(repo, 'init', '-b', 'main'); git(repo, 'init', '--bare', remote);
  await writeFile(join(repo, 'body.md'), '# Synthetic body');
  await writeFile(join(repo, 'articles.json'), JSON.stringify({ version: 1, articles: [{ id: 'A', title: 'Synthetic A', path: 'body.md' }] }));
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'synthetic'); git(repo, 'remote', 'add', 'origin', remote); git(repo, 'push', '-u', 'origin', 'main');
  git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(root, 'clone', remote, exportRepo);
  await writeFile(tokenFile, 'kith_export_synthetic\n', { mode: 0o600 });
  const config: TrialConfig = { version: 1, appDir, contentRepo: repo, contentCommit: git(repo, 'rev-parse', 'HEAD'), registry: 'articles.json', contentBranch: 'main', contentRemote: remote, exportRepo, exportBranch: 'main', exportRemote: remote, baseUrl: 'http://127.0.0.1:8787', tokenFile, releaseRoot };
  return { root, repo, config };
}

test('offline preflight checks local checkout without contacting unreachable remote and does not read token bytes', async () => {
  const { repo, config } = await fixture();
  git(repo, 'remote', 'set-url', 'origin', 'https://unreachable.invalid/private.git');
  git(config.exportRepo, 'remote', 'set-url', 'origin', 'https://unreachable.invalid/private.git');
  config.contentRemote = config.exportRemote = 'https://unreachable.invalid/private.git';
  await writeFile(config.tokenFile, 'canary-credential-never-output');
  assert.equal((await preflight(config)).offline, true);
});

test('complete candidate uses immutable bundle; failed build preserves current byte for byte', async () => {
  const { repo, config } = await fixture();
  const first = await prepareRelease(config, { buildWeb: web });
  const current = join(config.releaseRoot, 'current'); const link = await readlink(current);
  const before = await readFile(join(current, 'assets/_reading/current.json'), 'utf8');
  assert.equal((await verifyRelease(first.releaseDir, config.contentCommit)).articles, 1);
  await writeFile(join(repo, 'body.md'), '# New body'); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'update');
  const next = { ...config, contentCommit: git(repo, 'rev-parse', 'HEAD') };
  await assert.rejects(prepareRelease(next, { buildWeb: async (_app, assets) => { await web(_app, assets); throw new Error('canary-private-build'); } }), /Web build failed/u);
  assert.equal(await readlink(current), link); assert.equal(await readFile(join(current, 'assets/_reading/current.json'), 'utf8'), before);
  await prepareRelease(next, { buildWeb: web }); assert.notEqual(await readlink(current), link);
  assert.match(await readFile(join(current, 'assets/_reading/current.json'), 'utf8'), /New body/u);
  assert.equal(await readFile(join(first.releaseDir, 'assets/_reading/current.json'), 'utf8'), before);
});

test('empty or broken registry cannot switch a previously usable release', async () => {
  const { repo, config } = await fixture(); await prepareRelease(config, { buildWeb: web });
  const original = await readlink(join(config.releaseRoot, 'current'));
  for (const articles of [[], [{ id: 'A', title: 'A', path: 'missing.md' }]]) {
    await writeFile(join(repo, 'articles.json'), JSON.stringify({ version: 1, articles })); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'bad registry');
    await assert.rejects(prepareRelease({ ...config, contentCommit: git(repo, 'rev-parse', 'HEAD') }, { buildWeb: web }));
    assert.equal(await readlink(join(config.releaseRoot, 'current')), original);
  }
});

test('artifact verification rejects missing/modified/extra assets and wrong content commit', async () => {
  const { config } = await fixture(); const release = await prepareRelease(config, { buildWeb: web });
  const js = join(release.releaseDir, 'assets/assets/main.js'); const original = await readFile(js);
  await assert.rejects(verifyRelease(release.releaseDir, 'b'.repeat(40)));
  await assert.rejects(verifyRelease(release.releaseDir, config.contentCommit, 'another-registry.json'));
  await writeFile(js, 'tampered'); await assert.rejects(verifyRelease(release.releaseDir, config.contentCommit));
  await writeFile(js, original); await unlink(js); await assert.rejects(verifyRelease(release.releaseDir, config.contentCommit));
  await writeFile(js, original); await writeFile(join(release.releaseDir, 'assets/extra'), 'unmanifested'); await assert.rejects(verifyRelease(release.releaseDir, config.contentCommit));
});

test('web-only, missing referenced asset, empty bundle, symlink artifacts and altered manifest are rejected', async () => {
  const { config } = await fixture();
  for (const faulty of [
    async (_app: string, assets: string) => { await mkdir(assets); },
    async (app: string, assets: string) => { await web(app, assets); await unlink(join(assets, 'assets/main.js')); },
    async (app: string, assets: string) => { await web(app, assets); await symlink(config.tokenFile, join(assets, 'secret')); },
  ]) await assert.rejects(prepareRelease(config, { buildWeb: faulty }));
  const release = await prepareRelease(config, { buildWeb: web });
  const manifest = join(release.releaseDir, 'manifest.json'); const before = await readFile(manifest, 'utf8');
  await writeFile(manifest, before.replace(config.contentCommit, 'c'.repeat(40))); await assert.rejects(verifyRelease(release.releaseDir, config.contentCommit));
  await writeFile(manifest, before); await writeFile(join(release.releaseDir, 'assets/_reading/current.json'), JSON.stringify({ version: 1, commit: config.contentCommit, articles: [] }));
  await assert.rejects(verifyRelease(release.releaseDir, config.contentCommit));
});

test('preflight rejects mismatched branch/remote, dirty checkout, unsafe credentials and nested private paths', async () => {
  const { repo, config } = await fixture();
  for (const wrong of [{ contentBranch: 'other' }, { exportRemote: '/unexpected' }, { registry: '../secret' }, { contentCommit: 'HEAD' }, { releaseRoot: join(repo, 'release') }, { tokenFile: join(repo, 'body.md') }, { baseUrl: 'http://outside.invalid' }]) await assert.rejects(preflight({ ...config, ...wrong }));
  await chmod(config.tokenFile, 0o644); await assert.rejects(preflight(config)); await chmod(config.tokenFile, 0o600);
  await writeFile(join(repo, 'body.md'), 'dirty'); await assert.rejects(preflight(config));
});

test('preflight rejects symlink private files, unsafe release root and mismatched push URL', async () => {
  const { root, repo, config } = await fixture(); const link = join(root, 'token-link'); await symlink(config.tokenFile, link);
  await assert.rejects(preflight({ ...config, tokenFile: link }));
  await chmod(config.releaseRoot, 0o755); await assert.rejects(preflight(config)); await chmod(config.releaseRoot, 0o700);
  git(repo, 'remote', 'set-url', '--push', 'origin', '/wrong-target'); await assert.rejects(preflight(config));
});

test('private config is exact and CLI errors never expose private paths, token, remote or child output', async () => {
  const { root, config } = await fixture(); const path = join(root, 'private-config.json');
  await writeFile(path, JSON.stringify(config), { mode: 0o600 }); assert.deepEqual(await readConfig(path), config);
  await writeFile(path, JSON.stringify({ ...config, secret: 'canary-secret' })); await assert.rejects(readConfig(path));
  await writeFile(path, JSON.stringify({ ...config, contentRemote: 'https://canary-secret@invalid/private' }));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./trial.ts', import.meta.url)), 'preflight', '--config', path], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.doesNotMatch(result.stdout + result.stderr, /canary|private-config|trial-[a-z0-9]/iu);
  assert.match(result.stdout + result.stderr, /\(config\)/u);
  await writeFile(path, JSON.stringify(config)); await chmod(config.tokenFile, 0o644);
  const credentialError = spawnSync(process.execPath, [fileURLToPath(new URL('./trial.ts', import.meta.url)), 'preflight', '--config', path], { encoding: 'utf8' });
  assert.equal(credentialError.status, 1); assert.match(credentialError.stdout + credentialError.stderr, /\(credentials\)/u);
  assert.doesNotMatch(credentialError.stdout + credentialError.stderr, /canary|private-config|trial-[a-z0-9]/iu);
  await chmod(path, 0o644); await assert.rejects(readConfig(path));
});

test('preparation refuses an existing unsafe current pointer instead of replacing user work', async () => {
  const { config } = await fixture(); await writeFile(join(config.releaseRoot, 'current'), 'operator work');
  await assert.rejects(prepareRelease(config, { buildWeb: web }));
  assert.equal(await readFile(join(config.releaseRoot, 'current'), 'utf8'), 'operator work');
});

test('preflight refuses shared content/export checkout and common Git metadata', async () => {
  const { root, repo, config } = await fixture();
  await assert.rejects(preflight({ ...config, exportRepo: repo }));
  const worktree = join(root, 'shared-worktree'); git(repo, 'worktree', 'add', '-b', 'exports', worktree);
  await assert.rejects(preflight({ ...config, exportRepo: worktree, exportBranch: 'exports' }));
});

test('private files and releases must remain outside the entire application Git root', async () => {
  const { root, config } = await fixture(); git(root, 'init', '-b', 'app');
  await assert.rejects(preflight(config), /paths/u);
});

test('concurrent preparation cannot replace an in-progress candidate', async () => {
  const { config } = await fixture();
  let releaseBuild!: () => void; let started!: () => void;
  const entered = new Promise<void>(yes => { started = yes; }); const barrier = new Promise<void>(yes => { releaseBuild = yes; });
  const first = prepareRelease(config, { buildWeb: async (app, assets) => { started(); await barrier; await web(app, assets); } });
  await entered;
  try { await assert.rejects(prepareRelease(config, { buildWeb: web }), /already running/u); } finally { releaseBuild(); }
  const result = await first; assert.deepEqual(await verifyRelease(result.releaseDir, config.contentCommit, config.registry), { commit: config.contentCommit, articles: 1 });
});

test('offline preflight rejects checkout attributes before Git status can execute clean filters', async () => {
  for (const kind of ['contentRepo', 'exportRepo'] as const) {
    const { root, config } = await fixture(); const repo = config[kind]; const marker = join(root, 'filter-invoked'); const script = join(root, 'filter.py');
    await writeFile(script, `import sys,pathlib\npathlib.Path(${JSON.stringify(marker)}).write_text('invoked')\nsys.stdout.write(sys.stdin.read())\n`);
    await writeFile(join(repo, '.gitattributes'), 'body.md filter=canary\n'); git(repo, 'add', '.gitattributes'); git(repo, 'commit', '-m', 'attribute fixture');
    git(repo, 'config', 'filter.canary.clean', `python3 ${script}`);
    await writeFile(join(repo, 'body.md'), '# synthetic body'); await utimes(join(repo, 'body.md'), new Date(0), new Date(0));
    await assert.rejects(preflight(config));
    await assert.rejects(access(marker), { code: 'ENOENT' });
  }
});

test('offline preflight rejects partial/promisor clones before any content object access', async () => {
  for (const [kind, key] of [['contentRepo', 'extensions.partialClone'], ['contentRepo', 'remote.origin.promisor'], ['exportRepo', 'remote.origin.promisor']] as const) {
    const { config } = await fixture(); git(config[kind], 'config', key, key.startsWith('extensions.') ? 'origin' : 'true');
    await assert.rejects(preflight(config), /checkout/u);
  }
});

test('metadata-only credential preflight accepts an empty private bootstrap placeholder without asserting authentication', async () => {
  const { config } = await fixture(); await writeFile(config.tokenFile, '');
  const result = await preflight(config); assert.equal(result.remoteAccessVerified, false);
});

test('local Git replacement refs cannot alter the pinned content commit bytes', async () => {
  const { repo, config } = await fixture();
  await writeFile(join(repo, 'body.md'), '# Replacement body');
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'later article body');
  const replacement = git(repo, 'commit-tree', git(repo, 'rev-parse', 'HEAD^{tree}'), '-m', 'synthetic replacement root');
  git(repo, 'replace', config.contentCommit, replacement);
  const release = await prepareRelease(config, { buildWeb: web });
  const bundle = JSON.parse(await readFile(join(release.releaseDir, 'assets/_reading/current.json'), 'utf8'));
  assert.equal(bundle.commit, config.contentCommit);
  assert.equal(bundle.articles[0].body, '# Synthetic body');
});
