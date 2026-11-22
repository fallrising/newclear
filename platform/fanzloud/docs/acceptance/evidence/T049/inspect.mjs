// One-off T049 browser receipt. Run from repository root; see T049.acceptance.md.
import {createServer} from 'node:http';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const executable = process.env.NAV_CHROMIUM_EXECUTABLE;
assert.ok(executable, 'Set NAV_CHROMIUM_EXECUTABLE to an existing Chromium binary');
const web = join(process.cwd(), 'platform/fanzloud/apps/control-plane/web');
const out = join(process.cwd(), 'platform/fanzloud/docs/acceptance/evidence/T049');
const diff = '--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-old\n+修正\n';
const finished = id => ({id, state: 'succeeded', state_version: 5, cleanup_state: 'confirmed', result: {diff, verification: {status: 'passed'}}});
let authenticated = true, holdNext = false, held;
const state = {A: 'succeeded', B: 'succeeded'};
const running = id => ({id, state: 'running', state_version: 3, cleanup_state: 'pending'});
const requests = [], errors = [];
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
    if (path.endsWith('/submissions')) send({blocked: false, items: [{key: 'synthetic-key', state: 'confirmed', receipt: {run: {id: 'B'}}}]});
    else if (path.endsWith('/projects')) send({items: [{id: 'project', canonical_repo: 'repo', name: 'fixture'}]});
    else if (path.endsWith('/agent-profiles')) send({items: [{id: 'claude', name: 'synthetic profile', backend: 'claude-subscription'}]});
    else if (path.endsWith('/runtime')) send({repositories: [{canonical_repo: 'repo', base_sha: 'a'.repeat(40)}]});
    else if (path.endsWith('/tasks')) send({items: ['A', 'B'].map(id => ({title: id, run_id: id, state: 'succeeded'}))});
    else if (/\/runs\/[AB]$/.test(path)) {
      if (holdNext) {holdNext = false; assert.equal(held, undefined); held = {res, id: path.at(-1)};}
      else send(state[path.at(-1)] === 'running' ? running(path.at(-1)) : finished(path.at(-1)));
    }
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
    } catch (error) {eventFailure = error;}
  };
  const {targetId} = await call('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await call('Target.attachToTarget', {targetId, flatten: true});
  await call('Page.enable', {}, sessionId); await call('Runtime.enable', {}, sessionId);
  // Observe response consumption without changing returned JSON or the shipped controller.
  await call('Page.addScriptToEvaluateOnNewDocument', {source: `sessionStorage.setItem('fanz-current-run', 'A'); window.__observedBodies = 0; window.__runFailures = 0; const originalFetch = window.fetch; window.fetch = async (...args) => {const response = await originalFetch(...args); if (/\\/runs\\/[AB]$/.test(args[0])) {if (!response.ok) window.__runFailures++; const json = response.json.bind(response); response.json = async () => {try {return await json();} finally {window.__observedBodies++;}};} return response;};`}, sessionId);
  const evaluate = async expression => {const result = await call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}, sessionId); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value;};
  const click = async selector => {
    const point = await evaluate(`(() => {const node = document.querySelector(${JSON.stringify(selector)}); node.scrollIntoView(); const r = node.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2};})()`);
    await call('Input.dispatchMouseEvent', {type: 'mousePressed', button: 'left', clickCount: 1, ...point}, sessionId);
    await call('Input.dispatchMouseEvent', {type: 'mouseReleased', button: 'left', clickCount: 1, ...point}, sessionId);
  };
  const frame = async () => evaluate('new Promise(resolve => requestAnimationFrame(() => resolve(true)))');
  const bodyCount = () => evaluate('window.__observedBodies');
  const consumed = async before => {await until(async () => (await bodyCount()) > before); await frame();};
  const ready = async id => until(() => evaluate(`document.getElementById('run-id')?.textContent === '${id}' && document.getElementById('run-status').textContent === '完成' && !document.getElementById('task-panel').hidden`));
  const snapshot = () => evaluate(`({id: document.getElementById('run-id').textContent, status: document.getElementById('run-status').textContent, diff: document.getElementById('diff-output').textContent, checks: document.getElementById('verification').textContent, cancelDisabled: document.getElementById('cancel-run').disabled})`);
  const checkFinished = async id => assert.deepEqual(await snapshot(), {id, status: '完成', diff, checks: '檢查通過', cancelDisabled: true});
  const logout = async () => {await click('#logout'); await until(() => evaluate('!document.getElementById("login-panel").hidden'));};
  const login = async id => {const before = await bodyCount(); await evaluate('document.getElementById("username").value="synthetic"; document.getElementById("password").value="synthetic"'); await click('#login'); await consumed(before); await ready(id);};
  const startHeld = async () => {holdNext = true; await click('#refresh'); await until(() => held);};
  const refresh = async () => {const before = await bodyCount(); await click('#refresh'); await consumed(before);};
  const select = async (index, id) => {const before = await bodyCount(); await click(`#recent-tasks li:nth-child(${index}) button`); await consumed(before); await ready(id);};
  const release = async (status = 200) => {
    const before = await evaluate(status === 200 ? 'window.__observedBodies' : 'window.__runFailures');
    const response = held; held = undefined; response.res.writeHead(status, {'Content-Type': 'application/json'}); response.res.end(JSON.stringify(status === 200 ? running(response.id) : {error: 'synthetic failure'}));
    await until(async () => (await evaluate(status === 200 ? 'window.__observedBodies' : 'window.__runFailures')) > before); await frame();
  };
  await call('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/`}, sessionId); await ready('A');
  await startHeld(); await refresh(); await release(); await checkFinished('A');
  await startHeld(); await select(2, 'B'); await select(1, 'A'); await release(); await checkFinished('A');
  await startHeld(); await logout(); await login('A'); await release(); await checkFinished('A');
  await startHeld(); await refresh(); await evaluate('document.getElementById("error-message").textContent="current view error"'); await release(500);
  assert.equal(await evaluate('document.getElementById("error-message").textContent'), 'current view error');
  await startHeld(); await refresh(); const beforeFallback = requests.filter(r => r.path === '/api/v1/runs/B').length; await release(404);
  await checkFinished('A'); assert.equal(requests.filter(r => r.path === '/api/v1/runs/B').length, beforeFallback);
  await startHeld(); await release(500); assert.match(await evaluate('document.getElementById("error-message").textContent'), /500/);
  await startHeld(); await release(404); await ready('B'); await checkFinished('B');
  state.B = 'running'; await refresh(); assert.equal(await evaluate('document.getElementById("run-status").textContent'), 'Agent 執行中');
  const beforePoll = await bodyCount(); state.B = 'succeeded'; await consumed(beforePoll); await ready('B'); await checkFinished('B');
  assert.deepEqual(errors, []); assert.deepEqual(requests.filter(r => r.method !== 'GET' && r.path !== '/api/v1/session'), []);
  const hashes = {}; for (const file of ['isolated.html', 'p0.css', 'isolated.js', 'candidate.js']) hashes[file] = createHash('sha256').update(await readFile(join(web, file))).digest('hex');
  await writeFile(join(out, 'browser.json'), JSON.stringify({status: 'passed', date: new Date().toISOString(), scope: 'Actual shipped HTML/CSS/JS, synthetic local session/catalog/results. Native mouse input and completion-only response instrumentation. No Rust/AP/provider/live acceptance.', browser: await call('Browser.getVersion'), scenarios: ['newer same-run observation preserved', 'A-B-A old observation suppressed', 'logout/login old observation suppressed', 'stale HTTP500 preserves current error', 'stale404 cannot trigger fallback', 'current500 remains visible', 'current404 follows confirmed fallback', 'current500ms poll updates result'], final_view: await snapshot(), requests, page_errors: errors, source_hashes: hashes, inspection_sha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')}, null, 2) + '\n');
  console.log('PASS: stale same-run/selection/login/error/404 suppressed; current error/fallback/poll preserved; no non-session mutation');
  await call('Browser.close');
} finally {
  socket?.close(); held?.res.destroy(); if (chrome.exitCode === null) chrome.kill('SIGTERM');
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => {if (chrome.exitCode !== null) resolve(); else chrome.once('exit', resolve);});
  await rm(scratch, {recursive: true, force: true});
}
