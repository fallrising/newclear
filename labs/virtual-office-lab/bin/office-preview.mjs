#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {boundedJson} from '../src/core.mjs';
const assets = new Map([
  ['/', ['../web/index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['../web/style.css', 'text/css']],
  ['/app.mjs', ['../web/app.mjs', 'text/javascript']],
  ['/presentation.mjs', ['../src/presentation.mjs', 'text/javascript']]
]);
export function preview(endpoint = 'http://127.0.0.1:8787') {
  const origin = new URL(endpoint);
  if (origin.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('preview backend must be a loopback HTTP origin');
  return createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (![ `127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`, `[::1]:${req.socket.localPort}` ].includes(req.headers.host)) { res.writeHead(403); res.end(); return; }
    // Exact paths only: never serve repository files via user-provided paths.
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    try {
      if (req.url === '/state') {
        const response = await fetch(`${origin.origin}/state`, {signal: AbortSignal.timeout(5000), redirect: 'error', headers: {accept: 'application/json'}});
        if (!response.ok) throw new Error('backend unavailable');
        const state = await boundedJson(response, 65536);
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(state)); return;
      }
      const asset = assets.get(req.url);
      if (!asset) { res.writeHead(404); res.end(); return; }
      res.setHeader('content-type', asset[1]);
      res.end(await readFile(new URL(asset[0], import.meta.url)));
    } catch { res.writeHead(502); res.end('preview unavailable'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = preview(process.env.OFFICE_PREVIEW_BACKEND);
  server.listen(8790, '127.0.0.1', () => console.log('Virtual Office preview: http://127.0.0.1:8790'));
}
