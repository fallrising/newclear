import { OpsError, canonicalBytes, sha256 } from './recovery-protocol.mjs';
import { mkdir, lstat, readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
const ensure = value => { if (!value) throw new OpsError('SMOKE_FAILED'); };
const digest = value => sha256(canonicalBytes(value));

export async function prepareBrowserMaterial(context, input, channel, {fileStamp, treeStamp, writePrivateNew}) {
  const worktreeRoot = join(context.helperRoot, 'browser-worktree'); await mkdir(worktreeRoot, {mode: 0o700});
  const lock = JSON.parse(await readFile(join(context.cwd, 'package-lock.json')));
  async function copy(source, target) {
    const info = await lstat(source);
    if (info.isDirectory()) {
      await mkdir(target, {recursive: true, mode: 0o700});
      for (const name of (await readdir(source)).sort()) await copy(join(source, name), join(target, name));
    } else {
      const before = await fileStamp(source), bytes = await readFile(source); ensure(sha256(bytes) === before.sha256);
      await mkdir(dirname(target), {recursive: true, mode: 0o700}); await writePrivateNew(target, bytes);
      ensure(digest(before) === digest(await fileStamp(source)));
    }
  }
  for (const path of ['package.json', 'package-lock.json', 'playwright.pp1-local.config.ts', 'e2e-pp1-local/recovery.spec.ts',
    'scripts/ops/local-restore-smoke.mjs', 'scripts/ops/local-restore-browser-material.mjs', 'scripts/ops/recovery-protocol.mjs']) await copy(join(context.cwd, path), join(worktreeRoot, path));
  for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
    const path = `node_modules/${name}`, actual = JSON.parse(await readFile(join(context.cwd, path, 'package.json')));
    ensure(lock.packages[path]?.version === actual.version); await copy(join(context.cwd, path), join(worktreeRoot, path));
  }
  const material = Object.freeze({worktreeRoot, chromiumRoot: join(homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64'),
    nssToolsRoot: join(homedir(), '.cache/devbox/cms-pp1-tooling-20261101/nss/usr/bin'), caFile: join(context.root, 'tls/ca.crt'),
    inputFile: join(context.helperRoot, 'browser.json'), socketFile: channel.path});
  await writePrivateNew(material.inputFile, canonicalBytes(input));
  ensure((await fileStamp(context.nodeBinary)).sha256 === context.target.nodeBinarySha256
    && (await fileStamp(join(material.chromiumRoot, 'chrome'))).sha256 === '8c599d43aec53f2460a31ae2f4af6bd863f8258b34ff519564bc5d4726bfaa1e'
    && (await fileStamp(join(material.nssToolsRoot, 'certutil'))).sha256 === '2bd9deab438d1a76b0406a648c762dfe3255c0423b7ed8eac6de95df1efb4faf');
  const stamps = {worktree: await treeStamp(worktreeRoot), chromium: await treeStamp(material.chromiumRoot), nss: await treeStamp(material.nssToolsRoot),
    ca: await fileStamp(material.caFile), input: await fileStamp(material.inputFile, true), node: await fileStamp(context.nodeBinary)};
  return {material, stamps};
}
