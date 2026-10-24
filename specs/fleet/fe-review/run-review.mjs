#!/usr/bin/env node
// Owned real fleetd + synthetic API state. Runtime launch is orchestrator-owned.
import { observed, unwrap, errorCategory } from './pending.mjs';
import { remainingChecks } from './remaining.mjs';
import { overflowDiagnostic } from './overflow-diagnostic.mjs';
import { healthCollector } from './health.mjs';
import { focusDiagnostic } from './focus-diagnostic.mjs';
import { finalFlow, stopCapture } from './flow.mjs';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';

const [mode, binary, out] = process.argv.slice(2);
if (!['baseline','final','control-child','focus','overflow','repair'].includes(mode) || !binary?.startsWith('/') || !/^\/evidence\/[a-z0-9-]+$/.test(out??'')) throw new Error('REVIEW_ARGUMENTS');
const require = createRequire('/review-tools/package.json');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:18765';
const result = { mode, startedAt: new Date().toISOString(), passed: false, node: process.version, playwright: require('playwright/package.json').version, binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), steps: [], cleanup: {} };
const sourcePaths = ['internal/ui/static/app.css','internal/ui/templates/layout.html','internal/ui/templates/login.html','internal/ui/templates/catalog.html','internal/ui/templates/node.html','internal/ui/templates/service.html','internal/ui/pages.go','internal/ui/pages_test.go','internal/api/server_test.go','fe-review/run-review.mjs','fe-review/flow.mjs','fe-review/pending.mjs','fe-review/guards.mjs','fe-review/health.mjs','fe-review/overflow-diagnostic.mjs','fe-review/remaining.mjs','fe-review/focus-diagnostic.mjs','fe-review/targets.json'];
result.sourceHashes = Object.fromEntries(sourcePaths.map(file => [file,createHash('sha256').update(readFileSync('/work/specs/fleet/'+file)).digest('hex')]));
const secrets = [];
let stage = 'INIT';
let child;
let browser;
let state;
let outputOwned=false;
let heartbeat;
let heartbeatRunning;
let agentToken;
let interrupted = false;
let exitCode = 0;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function check(ok, code) { if (!ok) throw new Error(`REVIEW_${code}`); }
function secret(prefix) { const value = prefix + randomBytes(16).toString('hex'); secrets.push(value); return value; }
const operator = secret('flt_op_');
const bootstrap = secret('flt_bs_');
async function api(method, route, token, payload, status = 200) {
  const response = await fetch(base + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) }, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(5000) });
  check(response.status === status, 'API_STATUS');
  return response.json();
}
async function reportHealthy() {
  await api('POST', '/api/v1/nodes/vps-fe-1/heartbeat', agentToken, { agent_instance_id: 'review-instance', agent_version: 'synthetic', facts: { ncpu: 2, memory_mb: 1024 } });
  const current = await api('GET', '/api/v1/services/hello', operator);
  await api('POST', '/api/v1/agent/actual', agentToken, { node_id: 'vps-fe-1', agent_instance_id: 'review-instance', services: [{ name: 'hello', applied_generation: current.generation, actual_state: current.desired_state, health: 'healthy', image: current.image, container_id: 'synthetic-no-container' }] });
}
function portOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 18765 });
    let done = false;
    const finish = (value) => { if (!done) { done = true; socket.destroy(); resolve(value); } };
    socket.setTimeout(500, () => finish(true));
    socket.once('connect', () => finish(true));
    socket.once('error', (error) => finish(error.code !== 'ECONNREFUSED'));
  });
}
async function bounded(promise, ms = 5000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('REVIEW_TIMEOUT')), ms); })]); } finally { clearTimeout(timer); }
}
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => {
  interrupted = true; exitCode = signal === 'SIGTERM' ? 143 : 130;
  child?.kill('SIGTERM');
  void browser?.close().catch(() => {});
  void stopCapture().catch(() => {});
});
try {
  const root = lstatSync('/state');
  check(root.isDirectory() && !root.isSymbolicLink() && root.uid === process.getuid() && (root.mode & 0o777) === 0o700, 'STATE_ROOT');
  process.umask(0o077);
  state = mkdtempSync('/state/fleet-review-');
  mkdirSync(out, { mode: 0o700 });outputOwned=true;
  check(!(await portOpen()), 'PORT_OCCUPIED');
  stage = 'SERVER_START';
  child = spawn(binary, [], { stdio: 'ignore', env: { PATH: process.env.PATH, FLEETD_LISTEN: '127.0.0.1:18765', FLEETD_DB: path.join(state, 'fleet.db'), FLEET_UI_HOSTNAME: 'fleet.invalid', FLEET_API_HOSTNAME: 'fleet-api.invalid', FLEET_BASE_DOMAIN: 'fleet.invalid', FLEETD_BOOTSTRAP_OPERATOR_TOKEN: operator, FLEETD_BOOTSTRAP_NODE_TOKEN: bootstrap } });
  let spawnFailed = false;
  child.on('error', () => { spawnFailed = true; });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    check(!interrupted && !spawnFailed && child.exitCode === null && child.signalCode === null, 'SERVER_EXIT');
    try { if ((await fetch(base + '/healthz', { signal: AbortSignal.timeout(500) })).status === 200) { ready = true; break; } } catch {}
    await pause(100);
  }
  check(ready, 'READY');
  result.steps.push({ stage, passed: true });
  stage = 'LOGIN';
  browser = await chromium.launch({ headless: true }); result.chromium = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await context.newPage();
  const health=healthCollector(base);health.attach(page);result.interactiveHealth=health.result;
  result.pageErrors = 0; page.on('pageerror', () => result.pageErrors++);
  const loginResponse = await page.goto(base + '/login'); check(loginResponse.status() === 200, 'LOGIN_GET');
  await page.locator('input[name="token"]').fill(operator);
  const submitted = observed(page.waitForResponse((response) => response.url() === base + '/login' && response.request().method() === 'POST'));
  const catalogResponse = observed(page.waitForResponse((response) => response.url() === base + '/' && response.request().method() === 'GET' && response.request().isNavigationRequest()));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  check((await unwrap(submitted)).status() === 303, 'LOGIN_POST');
  await page.waitForURL(base + '/');
  await page.locator('#catalog').waitFor();
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === 'fleet_op' && c.domain === '127.0.0.1' && c.path === '/');
  const authenticated = await unwrap(catalogResponse);
  result.cookieObservation = cookie ? { name: cookie.name, domain: cookie.domain, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, valueEqualsExpected: cookie.value === operator, authenticatedCatalogStatus: authenticated.status() } : { present: false, cookieCount: cookies.length, authenticatedCatalogStatus: authenticated.status() };
  check(cookie && cookie.value === operator && cookie.secure && cookie.httpOnly && cookie.sameSite === 'Lax' && authenticated.status() === 200, 'COOKIE');
  result.steps.push({ stage, passed: true, status: 303, secure: true, httpOnly: true, sameSite: 'Lax' });
  if (mode === 'control-child') { child.kill('SIGTERM'); throw new Error('REVIEW_CONTROL_CHILD'); }
  if (mode === 'final') {
    await page.getByText('No services yet.', { exact: true }).waitFor();
    await page.screenshot({path:path.join(out,'empty-catalog.png'),fullPage:true});
    result.steps.push({stage:'EMPTY_CATALOG',passed:true});
  }
  stage = 'SEED';
  const registration = await api('POST', '/api/v1/nodes/register', bootstrap, { id: 'vps-fe-1', display_name: 'Synthetic review node', agent_instance_id: 'review-instance' }, 201);
  agentToken = registration.agent_token; check(typeof agentToken === 'string' && agentToken.startsWith('flt_ag_'), 'AGENT_TOKEN'); secrets.push(agentToken);
  await api('POST', '/api/v1/services', operator, { apiVersion: 'fleet.catalog/v1', kind: 'Service', metadata: { name: 'hello', description: 'Synthetic review only' }, spec: { node: 'vps-fe-1', image: 'registry.invalid/review/hello:one', expose: { mode: 'public', hostname: 'hello.fleet.invalid', port: 8080, healthPath: '/healthz' } } }, 201);
  const older = await api('POST', '/api/v1/releases', operator, { service: 'hello', image: 'registry.invalid/review/hello:one', git_sha: 'a'.repeat(40), source: 'review' }, 201);
  const current = await api('POST', '/api/v1/releases', operator, { service: 'hello', image: 'registry.invalid/review/hello:two', git_sha: 'b'.repeat(40), source: 'review' }, 201);
  await api('POST', '/api/v1/services/hello/deploy', operator, { release_id: current.id }, 202);
  await reportHealthy();
  heartbeat = setInterval(() => { if (!heartbeatRunning) heartbeatRunning = reportHealthy().catch(() => { result.heartbeatFailed = true; }).finally(() => { heartbeatRunning = null; }); }, 10000);
  result.steps.push({ stage, passed: true });
  if(mode === 'repair') {
    await remainingChecks({context,browser,api,operator,bootstrap,older,state,out,result,reportHealthy,setStage:value=>{stage=value;}});
  } else if(mode === 'overflow') {
    stage='OVERFLOW_DIAGNOSTIC';await overflowDiagnostic({page,result});
  } else if(mode === 'focus') {
    stage='FOCUS_DIAGNOSTIC';await focusDiagnostic({page,result,api,operator});
  } else if (mode === 'final') {
    await finalFlow({ page, context, browser, api, operator, bootstrap, older, current, out, state, result, reportHealthy, setStage: value => { stage = value; } });
  } else {
  stage = 'BASELINE_ROLLBACK';
  await page.goto(base + '/services/hello');
  const rollback = page.locator('tr').filter({ has: page.locator('code').filter({ hasText: older.id }) }).getByRole('button', { name: 'Rollback', exact: true });
  result.releaseRowCount = await page.locator('table tbody tr').count();
  result.rollbackButtonCount = await page.getByRole('button', { name: 'Rollback', exact: true }).count();
  result.rollbackCandidateCount = await rollback.count();
  check(result.rollbackCandidateCount === 1, 'ROLLBACK_IDENTITY');
  const responsePending = observed(page.waitForResponse((response) => response.url() === base + '/api/v1/services/hello/deploy' && response.request().method() === 'POST'));
  stage = 'BASELINE_ROLLBACK_CLICK';
  await rollback.click();
  stage = 'BASELINE_ROLLBACK_RESPONSE';
  const response = await unwrap(responsePending);
  const request = response.request();
  const body = request.postData() || '';
  const malformedForm = body === new URLSearchParams({ release_id: older.id }).toString();
  const envelope = await response.json();
  const after = await api('GET', '/api/v1/services/hello', operator);
  check(response.status() === 400 && malformedForm && envelope.error?.code === 'invalid_json' && after.release_id === current.id, 'BASELINE_ORACLE');
  result.steps.push({ stage, passed: true, status: 400, declaredJSON: request.headers()['content-type']?.includes('application/json') === true, actualFormBody: malformedForm, invalidJSON: true, currentReleaseUnchanged: true });
  await page.screenshot({ path: path.join(out, 'baseline-rollback.png'), fullPage: true });
  }
  check(result.pageErrors === 0 && !result.heartbeatFailed && !interrupted, 'BROWSER_HEALTH');
  result.passed = true;
} catch (error) {
  result.error = errorCategory(error); result.failedStage = stage; exitCode ||= 1;
} finally {
  clearInterval(heartbeat);
  try {result.cleanup.captureExited=await bounded(stopCapture(),4000);} catch {result.cleanup.captureExited=false;}
  try { if (heartbeatRunning) await bounded(heartbeatRunning); result.cleanup.heartbeatStopped = true; } catch { result.cleanup.heartbeatStopped = false; }
  try { if (browser) await bounded(browser.close()); result.cleanup.browserClosed = true; } catch { result.cleanup.browserClosed = false; }
  if (child?.pid) {
    child.kill('SIGTERM');
    for (let i=0;i<60 && child.exitCode===null && child.signalCode===null;i++) await pause(100);
    if (child.exitCode===null && child.signalCode===null) { result.serverForcedKill = true; child.kill('SIGKILL'); }
    for (let i=0;i<20 && child.exitCode===null && child.signalCode===null;i++) await pause(100);
    result.serverExit = {code:child.exitCode,signal:child.signalCode,forcedKill:result.serverForcedKill===true};
    result.cleanup.serverExited = child.exitCode!==null || child.signalCode!==null;
  } else result.cleanup.serverExited = true;
  result.cleanup.listenerAbsent = !(await portOpen());
  if (state && result.cleanup.serverExited && result.cleanup.listenerAbsent) {try {rmSync(state, { recursive: true }); result.cleanup.privateStateRemoved = true;} catch {result.cleanup.privateStateRemoved=false;} }
  else result.cleanup.privateStateRemoved = !state;
  result.cleanupPassed = Object.values(result.cleanup).every((value) => value === true);
  if (!result.cleanupPassed) { result.passed = false; exitCode ||= 1; }
  result.finishedAt = new Date().toISOString();
  const serialized = JSON.stringify(result, null, 2)+'\n';
  check(secrets.every((value) => !serialized.includes(value)), 'RECEIPT_SECRET');
  if(outputOwned)writeFileSync(path.join(out, 'result.json'), serialized, { mode: 0o600 });
  process.stdout.write(JSON.stringify({ mode, passed: result.passed, failedStage: result.failedStage, error: result.error, cleanupPassed: result.cleanupPassed })+'\n');
}
process.exitCode = exitCode;
