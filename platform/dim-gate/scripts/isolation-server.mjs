import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

// Local acceptance fixture only: the sibling document and API are real server
// responses, so a SPA fallback cannot masquerade as isolation evidence.
const root = resolve(process.argv[2])
const port = Number(process.argv[3])
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  response.setHeader('Cache-Control', 'no-store')
  if (pathname === '/sibling/api/v1/session') {
    response.writeHead(200, { 'Content-Type': types['.json'], 'X-Isolation-Fixture': 'sibling-server' })
    response.end(JSON.stringify({ application: 'sibling', source: 'real-local-server' }))
    return
  }
  if (pathname === '/sibling/' || pathname === '/sibling') {
    response.writeHead(200, { 'Content-Type': types['.html'] })
    response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Sibling application</title></head><body><h1>Sibling application</h1><output id="result">Loading</output><script>fetch("/sibling/api/v1/session").then(response => response.json()).then(data => document.querySelector("#result").textContent = JSON.stringify(data))</script></body></html>')
    return
  }
  if (!pathname.startsWith('/dim-gate/')) { response.writeHead(404); response.end('Not found'); return }
  const target = resolve(root, decodeURIComponent(pathname.slice('/dim-gate/'.length)))
  if (target !== root && !target.startsWith(root + sep)) { response.writeHead(403); response.end('Forbidden'); return }
  try {
    const file = (await stat(target).catch(() => null))?.isFile() ? target : extname(target) ? null : resolve(root, 'index.html')
    if (!file) { response.writeHead(404); response.end('Not found'); return }
    const content = await readFile(file)
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
    response.end(content)
  } catch {
    response.writeHead(404); response.end('Not found')
  }
})
server.listen(port, '127.0.0.1', () => process.stdout.write(`Isolation fixture listening on http://127.0.0.1:${port}\n`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
