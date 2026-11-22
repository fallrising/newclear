// One-off T048 browser receipt. Run from repository root; see T048.acceptance.md.
import {createServer} from 'node:http';
import {readFile, writeFile, mkdtemp, rm, mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const executable = process.env.NAV_CHROMIUM_EXECUTABLE;
assert.ok(executable, 'Set NAV_CHROMIUM_EXECUTABLE to an existing Chromium binary');
const web = join(process.cwd(), 'platform/fanzloud/apps/control-plane/web');
const out = join(process.cwd(), 'platform/fanzloud/docs/acceptance/evidence/T048');
const diff = '--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-old\n+修正\n';
const finished = id => ({id, state: 'succeeded', state_version: 5, cleanup_state: 'confirmed', result: {diff, verification: {status: 'passed'}}});
let authenticated = true, hold = true, held;
const requests = [], errors = [], downloads = [], progress = new Map();
const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0]; requests.push({method: req.method, path});
  const send = value => {res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(value));};
  if (path === '/api/v1/session') {
    if (req.method === 'DELETE') authenticated = false;
    if (req.method === 'POST') authenticated = true;
    send({authenticated, csrf_token: 'synthetic-csrf'}); return;
  }
  if (path.startsWith('/api/')) {
    if (!authenticated) {res.writeHead(401); res.end('{}'); return;}
    if (path.endsWith('/result.diff')) {
      if (hold) {assert.equal(held, undefined); held = res;}
      else {res.writeHead(200, {'Content-Type': 'text/plain'}); res.end(diff);}
      return;
    }
    if (path.endsWith('/submissions')) send({blocked: false, items: [{key: 'synthetic-key', state: 'confirmed', receipt: {run: {id: 'A'}}}]});
    else if (path.endsWith('/projects')) send({items: [{id: 'project', canonical_repo: 'repo', name: 'fixture'}]});
    else if (path.endsWith('/agent-profiles')) send({items: [{id: 'claude', name: 'synthetic profile', backend: 'claude-subscription'}]});
    else if (path.endsWith('/runtime')) send({repositories: [{canonical_repo: 'repo', base_sha: 'a'.repeat(40)}]});
    else if (path.endsWith('/tasks')) send({items: ['A', 'B'].map(id => ({title: id, run_id: id, state: 'succeeded'}))});
    else if (/\/runs\/[AB]$/.test(path)) send(finished(path.at(-1)));
    else {res.writeHead(404); res.end('{}');}
    return;
  }
  const file = path === '/' ? 'isolated.html' : path.replace('/assets/', '');
  if (!['isolated.html', 'isolated.js', 'candidate.js', 'p0.css', 'favicon.ico'].includes(file)) {res.writeHead(404); res.end(); return;}
  const types = {html: 'text/html', js: 'text/javascript', css: 'text/css', ico: 'image/x-icon'};
  res.writeHead(200, {'Content-Type': types[file.split('.').at(-1)]}); res.end(await readFile(join(web, file)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const scratch = await mkdtemp(join(tmpdir(), 'fz-diff-browser-'));
const downloadPath = join(scratch, 'downloads'); await mkdir(downloadPath);
const chrome = spawn(executable, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${join(scratch, 'profile')}`, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
let socket, sequence = 0, eventFailure;
const pending = new Map();
const until = async fn => {for (let i = 0; i < 200; i++) {if (eventFailure) throw eventFailure; const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 25));} throw Error('inspection timeout');};
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''; chrome.stderr.on('data', data => {output += data; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]);});
    chrome.on('exit', code => reject(Error(`Chrome exit ${code}`)));
    setTimeout(() => reject(Error('Chrome startup timeout')), 10000).unref();
  });
  socket = new WebSocket(endpoint); await new Promise(resolve => {socket.onopen = resolve;});
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {const id = ++sequence; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));});
  socket.onmessage = ({data}) => {
    try {
      const event = JSON.parse(data);
      if (event.id) {const task = pending.get(event.id); pending.delete(event.id); if (event.error) task.reject(Error(JSON.stringify(event.error))); else task.resolve(event.result); return;}
      if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.text);
      if (event.method === 'Browser.downloadWillBegin') downloads.push(event.params);
      if (event.method === 'Browser.downloadProgress') progress.set(event.params.guid, event.params.state);
    } catch (error) {eventFailure = error;}
  };
  await call('Browser.setDownloadBehavior', {behavior: 'allowAndName', downloadPath, eventsEnabled: true});
  const {targetId} = await call('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await call('Target.attachToTarget', {targetId, flatten: true});
  await call('Page.enable', {}, sessionId); await call('Runtime.enable', {}, sessionId);
  // Completion-only instrumentation: native input still invokes the unchanged shipped handler.
  await call('Page.addScriptToEvaluateOnNewDocument', {source: `window.__diffDone = 0; window.__diffErrors = []; const original = EventTarget.prototype.addEventListener; EventTarget.prototype.addEventListener = function(type, listener, options) {if (this.id === 'download-diff' && type === 'click') {return original.call(this, type, function(event) {Promise.resolve(listener.call(this, event)).then(() => window.__diffDone++, error => window.__diffErrors.push(String(error)));}, options);} return original.call(this, type, listener, options);};`}, sessionId);
  const evaluate = async expression => {const result = await call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}, sessionId); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value;};
  const click = async selector => {
    const point = await evaluate(`(() => {const node = document.querySelector(${JSON.stringify(selector)}); node.scrollIntoView(); const r = node.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2};})()`);
    await call('Input.dispatchMouseEvent', {type: 'mousePressed', button: 'left', clickCount: 1, ...point}, sessionId);
    await call('Input.dispatchMouseEvent', {type: 'mouseReleased', button: 'left', clickCount: 1, ...point}, sessionId);
  };
  const ready = async id => until(() => evaluate(`document.getElementById('run-id')?.textContent === '${id}' && !document.getElementById('download-diff').disabled && !document.getElementById('task-panel').hidden`));
  const logout = async () => {await click('#logout'); await until(() => evaluate('!document.getElementById("login-panel").hidden'));};
  const login = async id => {await evaluate('document.getElementById("username").value="synthetic"; document.getElementById("password").value="synthetic"'); await click('#login'); await ready(id);};
  const startHeld = async () => {await click('#download-diff'); await until(() => held);};
  const finishHeld = async (count, status = 200) => {const response = held; held = undefined; response.writeHead(status, {'Content-Type': 'text/plain'}); response.end(status === 200 ? diff : 'synthetic failure'); await until(() => evaluate(`window.__diffDone === ${count}`)); assert.equal(downloads.length, 0);};
  await call('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/`}, sessionId); await ready('A');
  await startHeld(); await logout(); await finishHeld(1);
  await login('A'); await startHeld();
  await click('#recent-tasks li:nth-child(2) button'); await ready('B');
  await click('#recent-tasks li:nth-child(1) button'); await ready('A'); await finishHeld(2);
  await startHeld(); await logout(); await login('A'); await finishHeld(3);
  await startHeld(); await click('#recent-tasks li:nth-child(2) button'); await ready('B');
  await evaluate('document.getElementById("error-message").textContent="current view error"'); await finishHeld(4, 500);
  assert.equal(await evaluate('document.getElementById("error-message").textContent'), 'current view error');
  hold = false; await click('#download-diff'); await until(() => downloads.length === 1);
  const downloaded = downloads[0]; await until(() => progress.get(downloaded.guid) === 'completed');
  assert.equal(downloaded.suggestedFilename, 'run-B.diff');
  const bytes = await readFile(join(downloadPath, downloaded.guid)); assert.deepEqual(bytes, Buffer.from(diff));
  await until(() => evaluate('window.__diffDone === 5')); assert.deepEqual(await evaluate('window.__diffErrors'), []);
  assert.deepEqual(errors, []); assert.deepEqual(requests.filter(r => r.method !== 'GET' && r.path !== '/api/v1/session'), []);
  assert.equal(requests.filter(r => r.path.endsWith('/result.diff')).length, 5);
  const hashes = {}; for (const file of ['isolated.html', 'p0.css', 'isolated.js', 'candidate.js']) hashes[file] = createHash('sha256').update(await readFile(join(web, file))).digest('hex');
  await writeFile(join(out, 'browser.json'), JSON.stringify({status: 'passed', date: new Date().toISOString(), scope: 'Actual shipped HTML/CSS/JS, synthetic local session/catalog/results. Native input and download; completion-only click instrumentation. No Rust/AP/provider/live acceptance.', browser: await call('Browser.getVersion'), scenarios: ['logout stale success suppressed', 'A-B-A stale success suppressed', 'logout/login stale success suppressed', 'stale HTTP500 preserves current error', 'current exact UTF8 diff downloads once'], download: {filename: downloaded.suggestedFilename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}, requests, page_errors: errors, source_hashes: hashes, inspection_sha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')}, null, 2) + '\n');
  console.log('PASS: 4 stale completions suppressed; one exact native UTF8 download; no non-session mutation; zero page errors');
  await call('Browser.close');
} finally {
  socket?.close(); held?.destroy(); if (chrome.exitCode === null) chrome.kill('SIGTERM');
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => {if (chrome.exitCode !== null) resolve(); else chrome.once('exit', resolve);});
  await rm(scratch, {recursive: true, force: true});
}
