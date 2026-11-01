// Dependency-free, offline build. Only the verified upstream core enters the artifact.
import { createHash } from 'node:crypto';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const upstreamSHA = '257856e3b221140acb4cc4460626b850c0bd4ff1';
const coreDigest = '75da2a13f39720e34b1e440533460435ead0af9a88fccad8c94e94a816dafa21';
const licenseDigest = '55d5c9c20065b2aa66887036f6741ee5ef12c7a72cd4ad96034889867d436824';

function verify(bytes, expected, label) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error(`Upstream ${label} SHA-256 mismatch; expected Handwired ${upstreamSHA}`);
  }
  return bytes.toString('utf8');
}

function withoutExports(source) {
  return source.replace(/^export (?=(?:function|class|const)\s)/gm, '');
}

export async function buildPage(output, upstreamRoot) {
  if (typeof output !== 'string' || !isAbsolute(output) || !output.endsWith('.html')) {
    throw new Error('Output must be an explicit absolute .html path outside the repository');
  }
  // Resolve parent symlinks as well as lexical paths; generated code stays outside source.
  const outputParent = await realpath(dirname(output));
  const relativeParent = relative(await realpath(repoRoot), outputParent);
  if (relativeParent === '' || (!relativeParent.startsWith(`..${sep}`) && relativeParent !== '..' && !isAbsolute(relativeParent))) {
    throw new Error('Output must be outside the repository');
  }
  if (!upstreamRoot) throw new Error('Set HANDWIRED_ROOT to the pinned upstream source directory');
  const core = verify(await readFile(resolve(upstreamRoot, 'src/runtime/numeric-ui-core.ts')), coreDigest, 'core');
  const license = verify(await readFile(resolve(upstreamRoot, 'LICENSE')), licenseDigest, 'license');
  const stripped = withoutExports(stripTypeScriptTypes(core, { mode: 'strip' }));
  const forward = withoutExports(await readFile(resolve(webRoot, 'forward.mjs'), 'utf8'));
  const template = await readFile(resolve(webRoot, 'index.html'), 'utf8');
  const code = `(() => {\n'use strict';\nconst Circuit = (() => {\n${stripped}\nreturn Circuit;\n})();\n${forward}\nconst forwardPage = bindForwardPage(document, createForwardEvaluator(Circuit));\nbindLearningPage(document, createLearningEvaluator(Circuit), forwardPage);\n})();`;
  const html = template.replace('<!-- HANDWIRED_LICENSE -->', license)
    .replace('<!-- HANDWIRED_SCRIPT -->', `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`);
  // Exclusive creation also prevents overwriting through an existing symlink.
  await writeFile(output, html, { flag: 'wx' });
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/build.mjs <absolute-output.html>');
    console.log(await buildPage(process.argv[2], process.env.HANDWIRED_ROOT));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
