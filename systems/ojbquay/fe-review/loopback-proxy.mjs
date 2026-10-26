import http from 'node:http';
import {pathToFileURL} from 'node:url';

export const upstreamOrigin = 'http://console-api:8080';
export const frontendOrigin = 'http://127.0.0.1:5173';
const bodyLimit = 8 * 1024 * 1024;
const responseLimit = 16 * 1024 * 1024;
const hop = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

export function validateOrigin(value) {
  if (value !== frontendOrigin) throw new Error('REVIEW_FRONTEND_ORIGIN');
  return value;
}

export function upstreamPath(value, upstream = upstreamOrigin) {
  if (upstream !== upstreamOrigin) throw new Error('REVIEW_PROXY_UPSTREAM');
  if (typeof value !== 'string' || value.length > 8192 || !/^\/(api|internal)\//.test(value) || /[\\\r\n#]/.test(value)) throw new Error('REVIEW_PROXY_PATH');
  const parsed = new URL(value, frontendOrigin);
  if (parsed.origin !== frontendOrigin || !/^\/(api|internal)\//.test(parsed.pathname)) throw new Error('REVIEW_PROXY_PATH');
  return parsed.pathname + parsed.search;
}

export function forwardedHeaders(headers) {
  const excluded = new Set([...hop, ...String(headers.connection ?? '').toLowerCase().split(',').map(s => s.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !excluded.has(name.toLowerCase())));
}

export function createProxy() {
  const pending = new Set();
  const server = http.createServer({requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 32768}, (req, res) => {
    let route;
    try { route = upstreamPath(req.url); }
    catch {res.writeHead(400);res.end();return;}
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
    const size = Number(req.headers['content-length'] ?? 0);
    if (!Number.isSafeInteger(size) || size < 0 || size > bodyLimit) {res.writeHead(413);res.end();return;}
    // Preserve host/origin/cookie/CSRF; only standard hop-by-hop headers are removed.
    const upstream = http.request(upstreamOrigin + route, {method: req.method, headers: forwardedHeaders(req.headers), timeout: 15000});
    pending.add(upstream);
    const finish = () => pending.delete(upstream);
    upstream.once('close', finish);
    upstream.once('timeout', () => upstream.destroy());
    upstream.once('error', () => {if (!res.headersSent) res.writeHead(502);res.end();});
    req.once('aborted', () => upstream.destroy());
    res.once('close', () => {if (!res.writableFinished) upstream.destroy();});
    let received = 0;
    req.on('data', chunk => {received += chunk.length;if (received > bodyLimit) {upstream.destroy();req.destroy();}});
    upstream.on('response', incoming => {
      res.writeHead(incoming.statusCode, forwardedHeaders(incoming.headers));
      let sent = 0;
      incoming.on('data', chunk => {sent += chunk.length;if (sent > responseLimit) {incoming.destroy();res.destroy();upstream.destroy();}});
      incoming.once('error', () => res.destroy());
      incoming.pipe(res);
    });
    req.pipe(upstream);
  });
  server.on('connect', (_, socket) => socket.destroy());
  server.on('upgrade', (_, socket) => socket.destroy());
  return {server, close: async () => {
    const closed = new Promise(resolve => server.close(resolve));
    for (const request of pending) request.destroy();
    server.closeAllConnections();
    await closed;
  }};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateOrigin(process.env.FE_REVIEW_ORIGIN);
  const proxy = createProxy();
  proxy.server.listen(8080, '127.0.0.1', () => process.stdout.write('REVIEW_PROXY_READY\n'));
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
    if (closing) return;
    closing = true;
    try {await proxy.close();process.stdout.write('REVIEW_PROXY_CLOSED\n');}
    catch {process.exitCode = 1;}
  });
}
