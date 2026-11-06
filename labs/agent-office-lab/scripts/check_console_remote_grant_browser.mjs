#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtempSync} from 'node:fs';
import {readFile, writeFile, readdir, stat, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (key.startsWith('--')) {
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args.set(key, next); i += 1; }
    else args.set(key, true);
  }
}

const harnessRoot = path.resolve(String(args.get('--harness-root') || mkdtempSync(path.join(tmpdir(), 'office-remote-grant-browser-'))));
const harnessPython = String(args.get('--harness-python') || process.env.PYTHON || 'python3');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const harnessScript = path.join(scriptDir, 'console_grant_harness.py');
const totalDeadline = Date.now() + 180_000;
const report = {ok: false, harness_root: harnessRoot, scenarios: {}, external_requests: [], failures: []};
await mkdir(harnessRoot, {recursive: true});
const children = new Set();

function remaining() { return Math.max(1, totalDeadline - Date.now()); }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function timeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), Math.min(ms, remaining())); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function sleep(ms) { await timeout(new Promise(resolve => setTimeout(resolve, ms)), ms + 500, 'sleep'); }
async function waitFor(fn, label, ms = 15_000) {
  const end = Date.now() + Math.min(ms, remaining());
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await sleep(150);
  }
  throw new Error(`${label}${last ? `: ${last.message}` : ''}`);
}

async function closeProcess(child) {
  if (!child) return;
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  if (!exited()) {
    const done = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    let timer;
    await Promise.race([done, new Promise(resolve => {timer=setTimeout(resolve, 6000);})]);
    clearTimeout(timer);
    if (!exited()) { child.kill('SIGKILL'); await timeout(done, 5000, 'owned process exit'); }
  }
  assert(exited(), 'owned child did not exit');
  children.delete(child);
}
async function closeAll() {
  await Promise.all([...children].map(child => closeProcess(child)));
}

function harnessJsonPath(directory) { return path.join(directory, 'harness.json'); }
async function readHarnessJson(directory) {
  return JSON.parse(await readFile(harnessJsonPath(directory), 'utf8'));
}
async function startHarness(scenario, directory) {
  assert(existsSync(harnessScript), 'backend harness is not present yet');
  const child = spawn(harnessPython, [harnessScript, '--harness', '--directory', directory, '--scenario', scenario], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  const firstLine = await timeout(new Promise((resolve, reject) => {
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      const index = buffer.indexOf('\n');
      if (index !== -1) resolve(buffer.slice(0, index).trim());
    });
    child.on('exit', code => reject(new Error(`harness exited early (${code}): ${stderr.slice(0, 400)}`)));
  }), 15_000, `${scenario} harness url`);
  assert(/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(firstLine), 'harness did not print a loopback login URL');
  return {child, url: firstLine, directory, stderr: () => stderr};
}

function chromePath() {
  const candidates = [
    process.env.CHROME, process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find(candidate => existsSync(candidate));
  assert(found, 'Chrome/Chromium not found; set CHROME or CHROME_BIN');
  return found;
}
async function httpJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {signal: controller.signal});
    return await response.json();
  } finally { clearTimeout(timer); }
}

class Cdp {
  constructor(ws) { this.ws = ws; this.next = 1; this.pending = new Map(); this.handlers = new Map(); }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    const cdp = new Cdp(ws);
    ws.onmessage = event => cdp._message(event.data);
    await timeout(new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP websocket failed')); }), 5_000, 'cdp connect');
    return cdp;
  }
  _message(raw) {
    const message = JSON.parse(raw);
    if (message.id && this.pending.has(message.id)) {
      const {resolve, reject} = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result || {});
      return;
    }
    if (message.method && this.handlers.has(message.method)) {
      for (const handler of this.handlers.get(message.method)) handler(message.params || {});
    }
  }
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }
  send(method, params = {}) {
    const id = this.next++;
    this.ws.send(JSON.stringify({id, method, params}));
    return timeout(new Promise((resolve, reject) => this.pending.set(id, {resolve, reject})), 8_000, method);
  }
  close() { try { this.ws.close(); } catch {} }
}

async function startBrowser() {
  const port = 35_000 + Math.floor(Math.random() * 10_000);
  const profile = mkdtempSync(path.join(tmpdir(), 'office-remote-grant-chrome-'));
  const child = spawn(chromePath(), [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', 'about:blank',
  ], {stdio: ['ignore', 'ignore', 'pipe']});
  children.add(child);
  const version = await waitFor(() => httpJson(`http://127.0.0.1:${port}/json/version`).catch(() => null), 'chrome devtools', 10_000);
  const list = await httpJson(`http://127.0.0.1:${port}/json/list`);
  const target = list.find(item => item.type === 'page') || list[0];
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl);
  const requests = [];
  const responses = [];
  const requestBodies = [], errors = [];
  const bodies = new Map();
  cdp.on('Network.requestWillBeSent', event => {requests.push(event.request.url); if(event.request.postData)requestBodies.push(event.request.postData);});
  cdp.on('Runtime.exceptionThrown', () => errors.push('page_exception'));
  cdp.on('Network.responseReceived', event => responses.push({requestId: event.requestId, url: event.response.url, status: event.response.status}));
  cdp.on('Network.loadingFinished', event => {
    cdp.send('Network.getResponseBody', {requestId: event.requestId}).then(body => bodies.set(event.requestId, body.body || '')).catch(() => {});
  });
  cdp.on('Fetch.requestPaused', event => {
    const url = new URL(event.request.url);
    const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if (!local) report.external_requests.push({host:url.hostname});
    cdp.send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest',
      local ? {requestId:event.requestId} : {requestId:event.requestId,errorReason:'BlockedByClient'}).catch(() => {});
  });
  await cdp.send('Fetch.enable', {patterns:[{urlPattern:'http*'}]});
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {source: 'window.confirm = () => true;'});
  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
    return result.result?.value;
  }
  async function navigate(url) {
    await cdp.send('Page.navigate', {url});
    await waitFor(() => evaluate('document.readyState === "complete" && !!document.querySelector("[data-provider=pi]") && typeof state!=="undefined" && state!==null'), 'page load', 15_000);
  }
  return {child, cdp, requests, requestBodies, errors, responses, bodies, evaluate, navigate};
}

async function selectPiTask(browser) {
  await browser.evaluate(`document.querySelector('[data-provider="pi"]').click(); document.getElementById('mode').value='task'; document.getElementById('mode').dispatchEvent(new Event('change')); true`);
}
async function plan(browser) {
  const before = browser.responses.length;
  await browser.evaluate(`document.getElementById('plan').click(); true`);
  await waitFor(() => browser.responses.slice(before).some(r=>r.url.endsWith('/api/plan') && r.status===200), 'plan response');
  await waitFor(() => browser.evaluate(`!document.getElementById('plan-card').hidden`), 'plan card');
}
async function pageText(browser) {
  return await browser.evaluate('document.body.innerText');
}
async function domHtml(browser) {
  return await browser.evaluate('document.documentElement.outerHTML');
}
async function currentHref(browser) {
  return await browser.evaluate('location.href');
}
function latestPlanId(browser) {
  for (const response of [...browser.responses].reverse()) {
    if (!response.url.includes('/api/plan')) continue;
    const body = browser.bodies.get(response.requestId);
    if (!body) continue;
    try { const parsed = JSON.parse(body); if (parsed.plan_id) return parsed.plan_id; } catch {}
  }
  return null;
}
async function executePlanAgain(browser, planId) {
  return await browser.evaluate(`fetch('/api/execute',{method:'POST',headers:{Authorization:'Bearer '+sessionStorage.getItem('office-token'),'Content-Type':'application/json'},body:JSON.stringify({plan_id:${JSON.stringify(planId)}})}).then(async r=>({ok:r.ok,status:r.status,body:await r.json().catch(()=>null)}))`);
}
async function collectGrantSecrets(root) {
  const secrets = [];
  async function walk(dir) {
    let entries = [];
    try { entries = await readdir(dir); } catch { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry);
      const info = await stat(file).catch(() => null);
      if (!info) continue;
      if (info.isDirectory()) await walk(file);
      else if (info.isFile() && info.size <= 16_384) {
        const text = await readFile(file, 'utf8').catch(() => '');
        for (const match of text.matchAll(/\b[0-9a-f]{32}\b/g)) secrets.push(match[0]);
      }
    }
  }
  await walk(root);
  return [...new Set(secrets)];
}
function secretNeedles(url, secrets) {
  const token = new URL(url).hash.match(/token=([^&]+)/)?.[1];
  return [token, ...secrets].filter(Boolean);
}
async function assertDomNoLeaks(browser, url, secrets) {
  const html = await domHtml(browser);
  for (const needle of secretNeedles(url, secrets)) assert(!html.includes(needle), 'secret leaked in DOM');
}
function assertNoLeaks(browser, url, secrets) {
  assert(browser.errors.length===0,'browser page exception');
  const needles = secretNeedles(url, secrets);
  const haystacks = [
    ...browser.requests, ...browser.requestBodies,
    ...browser.responses.map(response => response.url),
    ...[...browser.bodies.values()],
  ];
  for (const needle of needles) {
    assert(!haystacks.some(text => String(text).includes(needle)), 'secret leaked in browser-observed request or response');
  }
  for (const raw of browser.requests) {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) continue;
    const host = parsed.hostname;
    const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (!loopback) report.external_requests.push({host, url: raw});
  }
}

async function runNoExecutionScenario(scenario) {
  const directory = path.join(harnessRoot, scenario);
  const harness = await startHarness(scenario, directory);
  const browser = await startBrowser();
  try {
    await browser.navigate(harness.url);
    await selectPiTask(browser);
    await waitFor(async () => (await pageText(browser)).includes('CLI') || (await pageText(browser)).includes('授權'), `${scenario} cli guidance`);
    await plan(browser);
    const text = await pageText(browser);
    assert(text.includes('CLI') || text.includes('授權'), `${scenario} did not show CLI authorization guidance`);
    const disabled = await browser.evaluate('document.getElementById("execute").disabled');
    assert(disabled, `${scenario} execute button should be disabled`);
    assert(!(await currentHref(browser)).includes('token='), `${scenario} token fragment was not removed`);
    const secrets = await collectGrantSecrets(directory);
    await assertDomNoLeaks(browser, harness.url, secrets);
    assertNoLeaks(browser, harness.url, secrets);
    report.scenarios[scenario] = {ok: true};
  } finally {
    browser.cdp.close(); await closeProcess(browser.child); await closeProcess(harness.child);
  }
}

async function runGrantScenario() {
  const scenario = 'grant';
  const directory = path.join(harnessRoot, scenario);
  const harness = await startHarness(scenario, directory);
  const browser = await startBrowser();
  try {
    await browser.navigate(harness.url);
    await selectPiTask(browser);
    await waitFor(async () => (await pageText(browser)).includes('一次性授權'), 'grant guidance');
    await plan(browser);
    const planned = await pageText(browser);
    assert(planned.includes('請求上限') && planned.includes('輸出 token') && !planned.includes('未記錄') && planned.includes('無金額上限'), 'grant plan limits are incomplete');
    const planId = await waitFor(() => latestPlanId(browser), 'plan id');
    await browser.evaluate('document.getElementById("execute").click(); true');
    await waitFor(async () => (await readHarnessJson(directory)).spawn_count === 1, 'spawn once', 20_000);
    const duplicate = await executePlanAgain(browser, planId);
    assert(duplicate.status===409 && ['execution_busy','plan_expired_or_used'].includes(duplicate.body.error), 'duplicate execute did not reach the one-shot guard');
    for (let i=0;i<2;i++) {
      await browser.cdp.send('Page.reload');
      await waitFor(() => browser.evaluate('typeof state!=="undefined" && state?.jobs?.length===1 && !!document.querySelector("[data-job]")'), 'reloaded job');
    }
    const counts = await readHarnessJson(directory);
    assert(counts.spawn_count === 1 && counts.consumed_count === 1, 'refresh caused replacement spawn or grant consumption');
    const beforeStop=browser.responses.length;
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('停止')).click(); true`);
    await waitFor(() => browser.responses.slice(beforeStop).some(r=>r.url.endsWith('/api/stop')&&r.status===200), 'stop accepted');
    await waitFor(async () => !(await readHarnessJson(directory)).active, 'stub exited after stop', 6000);
    await waitFor(async () => (await pageText(browser)).includes('失敗'), 'failure result rendered');
    const afterStop=await executePlanAgain(browser,planId);
    assert(afterStop.status===409&&afterStop.body.error==='plan_expired_or_used','finished plan could be reused');
    const text = await pageText(browser);
    assert(text.includes('授權已使用') || text.includes('失敗') || text.includes('stub'), 'grant job/result state did not show consumed failure/stub status');
    assert(!text.includes('完成且產物已核對'), 'stub run was styled or labelled as success');
    const secrets = await collectGrantSecrets(directory);
    await assertDomNoLeaks(browser, harness.url, secrets);
    assertNoLeaks(browser, harness.url, secrets);
    report.scenarios[scenario] = {ok: true, spawn_count: counts.spawn_count, consumed_count: counts.consumed_count};
  } finally {
    browser.cdp.close(); await closeProcess(browser.child); await closeProcess(harness.child);
  }
}

async function runRevokeAfterPlan() {
  const scenario = 'revoke_after_plan';
  const directory = path.join(harnessRoot, scenario);
  const harness = await startHarness(scenario, directory);
  const browser = await startBrowser();
  try {
    await browser.navigate(harness.url);
    await selectPiTask(browser);
    await plan(browser);
    const beforeExecute=browser.responses.length;
    await browser.evaluate('document.getElementById("execute").click(); true');
    await waitFor(() => browser.responses.slice(beforeExecute).some(r=>r.url.endsWith('/api/execute')&&r.status===409), 'revoked execute rejected');
    const harnessState = await readHarnessJson(directory);
    assert(harnessState.spawn_count === 0, 'revoked grant still spawned');
    const secrets = await collectGrantSecrets(directory);
    await assertDomNoLeaks(browser, harness.url, secrets);
    assertNoLeaks(browser, harness.url, secrets);
    report.scenarios[scenario] = {ok: true};
  } finally {
    browser.cdp.close(); await closeProcess(browser.child); await closeProcess(harness.child);
  }
}

async function runRestartScenario() {
  const scenario = 'restart';
  const directory = path.join(harnessRoot, scenario);
  let harness = await startHarness('grant', directory);
  let browser = await startBrowser();
  try {
    await browser.navigate(harness.url);
    await selectPiTask(browser);
    await waitFor(async () => (await pageText(browser)).includes('一次性授權'), 'initial restart grant');
    browser.cdp.close(); await closeProcess(browser.child);
    await closeProcess(harness.child);
    await sleep(500);
    harness = await startHarness('grant', directory);
    children.add(harness.child);
    browser = await startBrowser();
    await browser.navigate(harness.url);
    await selectPiTask(browser);
    await waitFor(async () => (await pageText(browser)).includes('一次性授權'), 'restarted grant visible');
    const harnessState = await readHarnessJson(directory);
    assert(harnessState.spawn_count === 0 && harnessState.consumed_count === 0, 'restart auto-started or consumed grant');
    const secrets = await collectGrantSecrets(directory);
    await assertDomNoLeaks(browser, harness.url, secrets);
    assertNoLeaks(browser, harness.url, secrets);
    await plan(browser);
    await browser.evaluate('document.getElementById("execute").click(); true');
    await waitFor(async () => (await readHarnessJson(directory)).consumed_count===1, 'restart grant consumed');
    browser.cdp.close(); await closeProcess(browser.child); await closeProcess(harness.child);
    harness=await startHarness('grant',directory); browser=await startBrowser();
    await browser.navigate(harness.url); await selectPiTask(browser); await plan(browser);
    assert(await browser.evaluate('document.getElementById("execute").disabled'), 'spent grant was recreated after restart');
    assert((await readHarnessJson(directory)).consumed_count===1, 'consumed tombstone was not preserved');
    assert((await readHarnessJson(directory)).spawn_count===1, 'restart caused an extra spawn');
    report.scenarios[scenario] = {ok: true, pending_survives:true, consumed_survives:true};
  } finally {
    if (browser) { browser.cdp?.close(); await closeProcess(browser.child); }
    if (harness) { await closeProcess(harness.child); }
  }
}

try {
  assert(args.has('--local-acceptance'), 'pass --local-acceptance to run the local browser harness');
  await runNoExecutionScenario('no_optin');
  await runNoExecutionScenario('no_grant');
  await runGrantScenario();
  await runRevokeAfterPlan();
  await runRestartScenario();
  assert(report.external_requests.length === 0, 'external browser requests were observed');
  report.ok = true;
} catch (error) {
  report.failures.push(error.message);
  process.exitCode = 1;
} finally {
  await closeAll();
  await writeFile(path.join(harnessRoot, 'browser.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ok: report.ok, browser_json: path.join(harnessRoot, 'browser.json')}));
}
