import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {preview} from '../bin/office-preview.mjs';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
test('preview exposes only allowlisted assets and readonly bounded backend', async () => {
  let fail = false;
  const backend = createServer((req, res) => { res.writeHead(fail ? 503 : 200, {'content-type': 'application/json'}); res.end('{"mode":"live"}'); });
  await listen(backend);
  const server = preview(`http://127.0.0.1:${backend.address().port}`); await listen(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/app.mjs', '/style.css', '/presentation.mjs']) assert.equal((await fetch(origin + path)).status, 200);
    assert.equal((await fetch(origin + '/AGENTS.md')).status, 404);
    assert.equal((await fetch(origin + '/report', {method: 'POST'})).status, 405);
    const state = await fetch(origin + '/state'); assert.equal(state.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await state.json(), {mode: 'live'});
    fail = true; assert.equal((await fetch(origin + '/state')).status, 502);
  } finally { await close(server); await close(backend); }
});
test('preview refuses remote backends and credentials', () => {
  for (const endpoint of ['https://example.com', 'http://example.com', 'http://user@localhost', 'http://localhost/path']) assert.throws(() => preview(endpoint));
});
