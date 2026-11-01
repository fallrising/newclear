import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pinnedOptions, loadReviewViteConfig } from './vite-review-config.mjs';
test('original exact config is accepted; drift refuses instead of silently ignoring a future alias/plugin', async () => {
  const bytes = await readFile(new URL('../vite.config.ts', import.meta.url));
  const plugin = { name: 'synthetic-react-marker' };
  const options = pinnedOptions(bytes, () => plugin);
  assert.equal(options.configFile, false); assert.equal(options.plugins[0], plugin);
  assert.deepEqual(options.resolve.alias, []); assert.deepEqual(options.server.watch.ignored, ['**/src-tauri/**']);
  assert.throws(() => pinnedOptions(Buffer.concat([bytes, Buffer.from('\n// config changed')]), () => plugin), { message: 'REVIEW_VITE_CONFIG_DRIFT' });
});
test('locked actual React plugin loads without a Vite server or adjacent config emission', async () => {
  const options = await loadReviewViteConfig(fileURLToPath(new URL('../', import.meta.url)));
  assert.equal(options.configFile, false);
  assert.ok(options.plugins.flat().some((plugin) => plugin.name === 'vite:react-babel'));
});
