import {createServer} from '../frontend/node_modules/vite/dist/node/index.js';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root = fileURLToPath(new URL('../frontend/', import.meta.url));
assert(process.env.FE_REVIEW_STATE_DIR, 'REVIEW_PRIVATE_STATE_REQUIRED');
// baseline-001: runner config loading cannot evaluate the source __dirname.
// Mirror only the hash-pinned existing plugins/alias/proxy; no product config edit.
assert.equal(createHash('sha256').update(await readFile(join(root, 'vite.config.ts'))).digest('hex'), '49687e45d1891dee0580e4996c554abe158fa69b2de6e15ff960f9dbe0a28ef4', 'REVIEW_CONFIG_CHANGED');
const requireFrontend = createRequire(join(root, 'package.json'));
const {default: react} = await import(pathToFileURL(requireFrontend.resolve('@vitejs/plugin-react')).href);
const {default: tailwindcss} = await import(pathToFileURL(requireFrontend.resolve('@tailwindcss/vite')).href);
const server = await createServer({root, configFile: false, plugins: [react(), tailwindcss()], resolve: {alias: {'@': join(root, 'src')}}, cacheDir: join(process.env.FE_REVIEW_STATE_DIR, 'vite-cache'), server: {host: '127.0.0.1', port: 5173, strictPort: true, proxy: {'/api': 'http://localhost:8080'}}});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {await server.close(); console.log('REVIEW_VITE_CLOSED');}
  catch {process.exitCode = 1; console.error('REVIEW_VITE_CLOSE_FAILED');}
}
process.once('SIGTERM', stop); process.once('SIGINT', stop);
await server.listen(); console.log('REVIEW_VITE_READY');
