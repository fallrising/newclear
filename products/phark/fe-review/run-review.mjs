import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {mkdir, readFile, writeFile, open} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {connect} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {claimState, category, cleanupStages, loopbackOrigin, acquireOwned, boundedOperation} from './guards.mjs';
import {seedAPI} from './api-fixture.mjs';
import {mockBaseline} from './mock-baseline.mjs';
import {baseline} from './baseline.mjs';
import {captureRoutes} from './routes.mjs';
import {journey} from './journey.mjs';
import {mockLoadMore} from './load-more.mjs';
import {sharedCapture} from './shared-capture.mjs';

const component = fileURLToPath(new URL('../', import.meta.url));
const review = join(component, 'fe-review');
const id = process.env.FE_REVIEW_RUN_ID;
assert(/^[a-z0-9][a-z0-9-]{1,70}$/.test(id ?? ''), 'REVIEW_RUN_ID');
const state = process.env.FE_REVIEW_STATE_DIR;
assert(state && resolve(state) !== component && !resolve(state).startsWith(component + '/'), 'REVIEW_EXTERNAL_STATE_REQUIRED');
const output = join(review, 'runs', id);
const origin = loopbackOrigin('http://127.0.0.1:5173', 5173);
const finalPhase = ['final', 'final-repair', 'journey-only', 'logout-only'].includes(process.env.FE_REVIEW_PHASE);
const evidence = {schema: 1, id, phase: finalPhase ? 'remaining-routes-and-journeys' : 'baseline-only', status: 'running', startedAt: new Date().toISOString(), controlledMockBeforeSpring: true, api: [], steps: [], mocks: [], baseline: [], captures: [], sourceHashes: {}, cleanup: []};
const children = []; const contexts = []; const secrets = [];
let browser; let timeout; let cancel; let cancelled = false; let outputCreated = false;
const interrupted = new Promise((_, reject) => {cancel = code => {cancelled = true; reject(Error(code));};});
const onSignal = () => cancel('REVIEW_INTERRUPTED');
process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function start(name, command, args, env) {
  if (cancelled) throw Error('REVIEW_INTERRUPTED');
  const log = await open(join(state, name + '.log'), 'wx', 0o600);
  const child = spawn(command, args, {cwd: component, detached: true, env, stdio: ['ignore', log.fd, log.fd]});
  const owned = {name, child, log, exit: null, forcedKill: false};
  owned.ended = new Promise(resolveExit => {
    child.once('error', () => {owned.exit = {code: null, signal: null, spawnError: true}; resolveExit();});
    child.once('exit', (code, signal) => {owned.exit = {code, signal, spawnError: false}; resolveExit();});
  });
  children.push(owned); return owned;
}
async function ready(url, owned) {
  for (let count = 0; count < 100; count++) {
    if (owned.exit) throw Error('REVIEW_SERVICE_EXIT');
    try {const response = await fetch(url, {redirect: 'manual', signal: AbortSignal.timeout(1000)}); await response.arrayBuffer(); if (response.status === 200) return;}
    catch {}
    await delay(200);
  }
  throw Error('REVIEW_SERVICE_READY_TIMEOUT');
}
function absent(port) {
  return new Promise((resolveAbsent, reject) => {
    const socket = connect({host: '127.0.0.1', port});
    socket.setTimeout(1000);
    socket.once('connect', () => {socket.destroy(); reject(Error('REVIEW_LISTENER_PRESENT'));});
    socket.once('timeout', () => {socket.destroy(); reject(Error('REVIEW_LISTENER_UNKNOWN'));});
    socket.once('error', error => {socket.destroy(); error.code === 'ECONNREFUSED' ? resolveAbsent() : reject(Error('REVIEW_LISTENER_UNKNOWN'));});
  });
}
function groupExists(pid) {
  try {process.kill(-pid, 0); return true;} catch (error) {if (error.code === 'ESRCH') return false; throw error;}
}
async function stop(owned) {
  const pid = owned.child.pid;
  if (pid && groupExists(pid)) process.kill(-pid, 'SIGTERM');
  await Promise.race([owned.ended, delay(8000, undefined, {ref: false})]);
  if (pid && groupExists(pid)) {owned.forcedKill = true; process.kill(-pid, 'SIGKILL');}
  await Promise.race([owned.ended, delay(3000, undefined, {ref: false})]);
  await owned.log.close();
  evidence.steps.push({name: 'owned-service-exit', service: owned.name, ...owned.exit, forcedKill: owned.forcedKill});
  assert(owned.exit && (!pid || !groupExists(pid)), 'REVIEW_CHILD_CLEANUP');
  assert(!owned.forcedKill, 'REVIEW_FORCED_KILL');
}
async function screenshot(page, name, metadata) {
  const path = join(output, 'screenshots', name + '.png');
  await page.screenshot({path, fullPage: true});
  const bytes = await readFile(path);
  evidence.captures.push({name, path: 'screenshots/' + name + '.png', sha256: hash(bytes), bytes: bytes.length, ...metadata});
}
async function main() {
  evidence.stage = 'claim-fresh-state'; await claimState(state, id);
  await mkdir(join(review, 'runs'), {recursive: true});
  await mkdir(output, {recursive: false}); outputCreated = true; await mkdir(join(output, 'screenshots'));
  for (const file of ['frontend/src/App.tsx', 'frontend/src/components/Column.tsx', 'frontend/src/components/PostCard.tsx', 'frontend/src/components/ReplyThread.tsx', 'frontend/src/components/Composer.tsx', 'frontend/src/components/AccountControls.tsx', 'frontend/src/index.css', 'frontend/vite.config.ts', 'backend/target/deck-1.0.0.jar', 'fe-review/run-review.mjs', 'fe-review/api-fixture.mjs', 'fe-review/guards.mjs', 'fe-review/mock-baseline.mjs', 'fe-review/baseline.mjs', 'fe-review/serve-web.mjs']) evidence.sourceHashes[file] = hash(await readFile(join(component, file)));
  for (const name of ['routes.mjs', 'journey.mjs', 'keyboard.mjs', 'load-more.mjs', 'layout-contract.mjs', 'shared-capture.mjs', 'capture-selection.mjs', 'health.mjs']) evidence.sourceHashes['fe-review/' + name] = hash(await readFile(join(review, name)));
  const compatibleHashes = {...evidence.sourceHashes};
  if (['final-repair', 'journey-only', 'logout-only'].includes(process.env.FE_REVIEW_PHASE)) {
    const app = await readFile(join(component, 'frontend/src/App.tsx'), 'utf8');
    const attr = ' data-view={route.kind}'; assert.equal(app.split(attr).length, 2, 'REVIEW_APP_DELTA');
    const css = await readFile(join(component, 'frontend/src/index.css'), 'utf8');
    const suffix = '\n\n/* Notification previews retain whitespace while wrapping long post/reply text. */\n[data-view="notifications"] main .whitespace-pre-wrap {\n  overflow-wrap: anywhere;\n}\n';
    assert(css.endsWith(suffix), 'REVIEW_CSS_DELTA');
    compatibleHashes['frontend/src/App.tsx'] = hash(app.replace(attr, ''));
    compatibleHashes['frontend/src/index.css'] = hash(css.slice(0, -suffix.length));
    evidence.exactNotificationStyleDelta = {appAttribute: 'data-view={route.kind}', cssSelector: '[data-view="notifications"] main .whitespace-pre-wrap', appBeforeSHA256: compatibleHashes['frontend/src/App.tsx'], cssBeforeSHA256: compatibleHashes['frontend/src/index.css']};
  }
  const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/review-tools/node_modules/playwright/index.mjs').href);
  const {default: AxeBuilder} = await import(pathToFileURL(process.env.AXE_MODULE || '/review-tools/node_modules/@axe-core/playwright/dist/index.mjs').href);
  evidence.stage = 'browser-launch';
  browser = await acquireOwned(() => pw.chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE || '/opt/browsers/chromium-1243/chrome-linux64/chrome', timeout: 30000, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']}), resource => {browser = resource;}, () => cancelled);
  evidence.tools = {node: process.version, browser: browser.version()};
  const env = {PATH: process.env.PATH, LANG: 'C.UTF-8', FE_REVIEW_STATE_DIR: state};
  evidence.stage = 'vite-ready'; const web = await start('vite', process.execPath, [join(review, 'serve-web.mjs')], env);
  await ready(origin, web);
  if (['real-only', 'mobile-diagnostic', 'final', 'final-repair', 'journey-only', 'logout-only'].includes(process.env.FE_REVIEW_PHASE)) {
    const prerequisite = process.env.FE_REVIEW_PHASE !== 'real-only' ? {id: 'baseline-005', sha: '355407fba4d8e182d71747b9336f70d6cdb0273d0c2bab01fbea380e231defcb'} : {id: 'baseline-003', sha: '4dd13e2958a6fc002ceaa9a56611578dc178a65c5eae4e2e84459700f97ad4c7'};
    const previousBytes = await readFile(join(review, 'runs', prerequisite.id, 'result.json'));
    const receiptSHA = hash(previousBytes);
    assert.equal(receiptSHA, prerequisite.sha, 'REVIEW_MOCK_RECEIPT_CHANGED');
    const previous = JSON.parse(previousBytes);
    assert.deepEqual(previous.mocks.map(mock => [mock.state, mock.passed]), ['loading', 'empty', '401', '403', '429', '500'].map(state => [state, true]));
    for (const file of ['frontend/src/App.tsx', 'frontend/src/components/AccountControls.tsx', 'fe-review/mock-baseline.mjs']) assert.equal(compatibleHashes[file], previous.sourceHashes[file], 'REVIEW_MOCK_SOURCE_CHANGED');
    evidence.controlledMockBeforeSpring = false;
    evidence.mockPrerequisite = {run: prerequisite.id, sha256: receiptSHA, passed: 6, rerun: false};
    if (finalPhase) {
      const mobileBytes = await readFile(join(review, 'runs/mobile-003/result.json'));
      assert.equal(hash(mobileBytes), '3794ecc1f8331ee93b25740f704db319200e17979e0b547f044ebb9c6087ccad', 'REVIEW_MOBILE_RECEIPT_CHANGED');
      const mobile = JSON.parse(mobileBytes);
      assert.equal(mobile.status, 'passed');
      for (const file of ['frontend/src/App.tsx', 'frontend/src/components/Column.tsx', 'frontend/src/components/PostCard.tsx', 'frontend/src/components/ReplyThread.tsx', 'frontend/src/components/Composer.tsx']) assert.equal(compatibleHashes[file], mobile.sourceHashes[file], 'REVIEW_HOME_SOURCE_CHANGED');
      evidence.homePrerequisites = {mobile: {run: 'mobile-003', sha256: hash(mobileBytes), viewport: 390}, tabletDesktop: {run: 'baseline-005', sha256: receiptSHA, viewports: [834,1440], laterDelta: 'PostCard relative containing block; covered by mobile-003 and new route captures'}, rerun: false};
      if (['journey-only', 'logout-only'].includes(process.env.FE_REVIEW_PHASE)) {
        const capturedBytes = await readFile(join(review, 'runs/final-002/result.json'));
        assert.equal(hash(capturedBytes), '9c5a31e84597ebbac5410279fe06505260c9ab02555ead2376a809a9a88c5820', 'REVIEW_FINAL_CAPTURE_CHANGED');
        const captured = JSON.parse(capturedBytes);
        assert.equal(captured.sharedCapture.records.length, 12);
        assert.equal(new Set(captured.sharedCapture.records.map(item => [item.page,item.viewport,item.colorScheme].join('/'))).size, 12);
        assert(captured.sharedCapture.records.every(item => !item.error && !item.horizontalOverflow && item.status === 200 && item.consoleErrors === 0 && item.pageErrors === 0 && item.failedRequests === 0));
        assert.equal(captured.routes.length, 9);
        assert(captured.routes.every(item => item.loadedIdentity && item.geometry.scrollWidth <= item.geometry.clientWidth + 1 && Object.values(item.health).every(value => value === 0)));
        for (const file of Object.keys(captured.sourceHashes).filter(file => file.startsWith('frontend/'))) assert.equal(evidence.sourceHashes[file], captured.sourceHashes[file], 'REVIEW_CAPTURE_SOURCE_CHANGED');
        evidence.capturePrerequisite = {run: 'final-002', sha256: hash(capturedBytes), sharedUnique: 12, supplementalRoutes: 9, rerun: false};
        if (process.env.FE_REVIEW_PHASE === 'logout-only') {
          const workflowsBytes = await readFile(join(review, 'runs/final004/result.json'));
          const pagingBytes = await readFile(join(review, 'runs/final003/result.json'));
          assert.equal(hash(workflowsBytes), 'fad374fe96ff98dac21497e9de0b37d5969e68b8c314efc23e5e2ed72969bfc0');
          assert.equal(hash(pagingBytes), 'c0b00cbbe1c6695d397452ef2a25425965125d4863c719c1563bca5e86e04084');
          const workflows = JSON.parse(workflowsBytes); const paging = JSON.parse(pagingBytes);
          assert.equal(workflows.journey.length, 12); assert.equal(workflows.failure, 'REVIEW_UNCLASSIFIED_REQUEST');
          assert.equal(paging.mockPaging.length, 3); assert(paging.mockPaging.every(item => item.stableIdentityDeduped && item.continuationRequests === 1));
          for (const file of Object.keys(workflows.sourceHashes).filter(file => file.startsWith('frontend/'))) assert.equal(evidence.sourceHashes[file], workflows.sourceHashes[file]);
          evidence.workflowPrerequisite = {journey: {run: 'final004', sha256: hash(workflowsBytes), completedSteps: 12, originalHealthFailureRetained: true}, paging: {run: 'final003', sha256: hash(pagingBytes), channels: 3}, rerun: false};
        }
      }
    }
  } else {
    assert(!process.env.FE_REVIEW_PHASE, 'REVIEW_UNKNOWN_PHASE');
    evidence.stage = 'mock-baseline'; await mockBaseline(browser, origin, evidence, screenshot);
  }
  const secret = randomBytes(32).toString('base64url'); secrets.push(secret);
  evidence.stage = 'spring-ready';
  const backend = await start('spring', 'java', ['-jar', join(component, 'backend/target/deck-1.0.0.jar'), '--server.address=127.0.0.1', '--server.port=8080'], {...env, APP_DB_PATH: join(state, 'deck.db'), APP_MEDIA_PATH: join(state, 'media'), APP_ABUSE_IP_HMAC_SECRET: secret, SESSION_COOKIE_SECURE: 'false'});
  await ready('http://127.0.0.1:8080/api/auth/csrf', backend);
  evidence.stage = 'real-api-seed'; const seed = await seedAPI(pw, origin, evidence, secrets, process.env.FE_REVIEW_PHASE === 'logout-only' ? 'logout-only' : 'full'); contexts.push(...seed.contexts);
  if (finalPhase) {
    if (!['journey-only', 'logout-only'].includes(process.env.FE_REVIEW_PHASE)) {
      evidence.stage = 'shared-four-route-captures'; await sharedCapture({origin, seed, evidence, state, output, start, hash, env, compatibleHashes});
      evidence.stage = 'remaining-route-captures'; await captureRoutes(browser, AxeBuilder, origin, seed, evidence, screenshot);
    }
    evidence.stage = 'real-keyboard-journey'; await journey(browser, origin, seed, evidence, screenshot);
    if (process.env.FE_REVIEW_PHASE !== 'logout-only') {evidence.stage = 'mock-keyboard-paging'; await mockLoadMore(browser, origin, evidence, screenshot);}
  } else {
    evidence.stage = 'real-responsive-baseline'; await baseline(browser, AxeBuilder, origin, seed, evidence, screenshot);
  }
  evidence.status = 'passed';
}
let running;
try {
  timeout = setTimeout(() => cancel('REVIEW_DEADLINE'), 210000);
  running = main();
  await Promise.race([running, interrupted]);
} catch (error) {
  evidence.status = 'failed'; evidence.failure = category(error);
  // Only an allowlisted own-module location; never serialize Playwright messages,
  // raw URLs, source snippets, cookies or arbitrary exception text.
  evidence.failureSite = error?.stack?.match(/(?:baseline|mock-baseline|api-fixture|run-review|guards|routes|journey|load-more|keyboard|shared-capture)\.mjs:\d+:\d+/)?.[0] ?? null;
}
finally {
  clearTimeout(timeout);
  // Cancellation closes in-flight browser work and allows bounded launch/fetch
  // operations to settle before enumerating the owned children for cleanup.
  if (cancelled) {
    if (browser) await boundedOperation(() => browser.close(), 5000).catch(() => {});
    if (running) await Promise.race([running.catch(() => {}), delay(35000, undefined, {ref: false})]);
  }
  evidence.cleanup = await cleanupStages([
    ['api-contexts', async () => {const results = await Promise.allSettled(contexts.map(context => context.dispose())); assert(results.every(result => result.status === 'fulfilled'));}],
    ['browser', async () => {if (browser) await boundedOperation(() => browser.close(), 5000);}],
    ...children.toReversed().map(owned => [owned.name, () => stop(owned)]),
    ['listeners-absent', async () => {await absent(5173); await absent(8080);}]
  ]);
  if (evidence.cleanup.some(item => !item.passed)) evidence.status = 'failed';
  evidence.endedAt = new Date().toISOString();
  const safe = JSON.stringify(evidence, null, 2) + '\n';
  assert(secrets.every(secret => !safe.includes(secret)), 'REVIEW_SECRET_OUTPUT');
  // Existing output is exclusive per run; raw child logs and SQLite remain in private state.
  if (outputCreated) await writeFile(join(output, 'result.json'), safe, {flag: 'wx'});
  console.log(JSON.stringify({id, status: evidence.status, stage: evidence.stage, failure: evidence.failure ?? null, mocks: evidence.mocks.length, baseline: evidence.baseline.length, cleanup: evidence.cleanup}));
  process.exitCode = evidence.status === 'passed' ? 0 : 1;
  process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal);
}
