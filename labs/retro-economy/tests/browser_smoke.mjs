// Real Chromium acceptance using Node 22+ built-ins and CDP; no packages.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = process.env.AGENT_BUILD_DIR || process.env.RUNNER_TEMP;
const evidenceRoot = process.env.AGENT_EVIDENCE_DIR || process.env.RUNNER_TEMP;
assert.ok(build && evidenceRoot, 'Set AGENT_BUILD_DIR and AGENT_EVIDENCE_DIR (or RUNNER_TEMP in CI)');
await mkdir(build, { recursive: true }); await mkdir(evidenceRoot, { recursive: true });
const evidence = await mkdtemp(join(evidenceRoot, 'browser-'));
const run = await mkdtemp(join(build, 'browser-'));
const profile = join(run, 'profile');
const db = join(run, 'game.sqlite3');
const pause = ms => new Promise(r => setTimeout(r, ms));
let server, browser, cdp, base, serverPort;
const serverLogs = [], browserLogs = [], errors = [], observations = [];
const characters = new Map();
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit'); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  try { await ended; } finally { clearTimeout(timer); }
}
async function startServer() {
  server = spawn(process.env.PYTHON || 'python3', [join(root, 'server.py'), '--port', String(serverPort || 0), '--db', db], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; server.stdout.on('data', b => { output += b; serverLogs.push(String(b)); });
  server.stderr.on('data', b => serverLogs.push(String(b)));
  server.on('error', e => { errors.push(String(e)); });
  for (let i = 0; i < 100; i++) {
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) { serverPort = Number(match[1]); base = match[0]; return; }
    if (server.exitCode !== null) throw new Error('Server failed: ' + serverLogs.join(''));
    await pause(50);
  }
  throw new Error('Server startup timed out');
}
class CDP {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const item = this.pending.get(message.id); if (!item) return;
        this.pending.delete(message.id); clearTimeout(item.timer);
        message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
      } else {
        for (const listener of this.listeners) Promise.resolve(listener(message)).catch(e => errors.push(String(e)));
      }
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async evaluate(session, expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
}
async function waitFor(session, expression, label = expression) {
  for (let i = 0; i < 160; i++) {
    if (await cdp.evaluate(session, expression)) return;
    await pause(50);
  }
  throw new Error('Browser assertion timed out: ' + label);
}
async function click(session, selector) {
  await cdp.send('Page.bringToFront', {}, session);
  await waitFor(session, `Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`);
  const point = await cdp.evaluate(session, `(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }, session);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }, session);
}
async function ready(session) { await waitFor(session, `document.querySelector('#connection')?.dataset.status === 'ready'`); }
async function move(session, direction, x, y) {
  await click(session, `[data-move="${direction}"]`);
  await waitFor(session, `document.querySelector('#coordinates').textContent === ${JSON.stringify(`${x}, ${y}`)}`);
  await ready(session);
}
async function publicSnapshot(session) {
  return cdp.evaluate(session, `(async()=>{const s=JSON.parse(localStorage.getItem('mistshore.session.v1'));return (await fetch('/api/state',{headers:{Authorization:'Bearer '+s.token}})).json();})()`);
}
async function publicState(session) { return (await publicSnapshot(session)).state; }
async function marketStatus(session, id, status) {
  await cdp.send('Page.bringToFront', {}, session);
  await waitFor(session, `document.querySelector('#market-list [data-listing-id="${id}"]')?.dataset.status === ${JSON.stringify(status)}`);
  await ready(session);
}
async function createListing(session, item, quantity = 1, price = 4) {
  const before = (await publicSnapshot(session)).listings.map(row => row.id);
  await cdp.evaluate(session, `document.querySelector('#list-item').value=${JSON.stringify(item)};document.querySelector('#list-quantity').value=${JSON.stringify(String(quantity))};document.querySelector('#list-price').value=${JSON.stringify(String(price))}`);
  await click(session, '#list-submit');
  await waitFor(session, `Array.from(document.querySelectorAll('#market-list > li')).some(row => !${JSON.stringify(before)}.includes(Number(row.dataset.listingId)))`);
  await ready(session);
  const created = (await publicSnapshot(session)).listings.filter(row => !before.includes(row.id));
  assert.equal(created.length, 1, 'One click creates one listing');
  assert.equal(created[0].item, item); assert.equal(created[0].quantity, quantity); assert.equal(created[0].price, price);
  return created[0].id;
}
async function replenish(session, profession) {
  const smith = profession === 'smith';
  const distance = smith ? 3 : 4, raw = smith ? 'ore' : 'herb', product = smith ? 'kit' : 'medicine';
  const quantity = smith ? 5 : 6; // Two crafted supplies, plus one ore left for a persistent open listing.
  for (let n = 1; n <= distance; n++) await move(session, smith ? 'west' : 'south', smith ? -n : 0, smith ? 0 : n);
  for (let n = 1; n <= quantity; n++) {
    await click(session, '#gather');
    await waitFor(session, `document.querySelector('#inventory-${raw}').textContent === '${n}'`); await ready(session);
  }
  for (let n = distance - 1; n >= 0; n--) await move(session, smith ? 'east' : 'north', smith ? -n : 0, smith ? 0 : n);
  for (let n = 1; n <= 2; n++) {
    await click(session, '#craft');
    await waitFor(session, `document.querySelector('#inventory-${product}').textContent === '${n}'`); await ready(session);
  }
}

async function screenshot(session, name) {
  await cdp.evaluate(session, 'window.scrollTo(0,0)');
  const { cssContentSize } = await cdp.send('Page.getLayoutMetrics', {}, session);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } }, session);
  await writeFile(join(evidence, name + '.png'), Buffer.from(shot.data, 'base64'));
}
async function restart(session, expected) {
  await stop(server); await startServer();
  await cdp.send('Page.reload', { ignoreCache: true }, session);
  await waitFor(session, `document.querySelector('#player-name')?.textContent === ${JSON.stringify(expected.name)}`);
  await ready(session);
  assert.deepEqual(await publicState(session), expected, 'SQLite and browser token restore exact state');
}

try {
  await startServer();
  browser = spawn(process.env.CHROME || 'google-chrome', ['--headless', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...(process.env.CHROME_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.CHROME_LIBRARY_PATH } : {}) } });
  browser.stderr.on('data', b => browserLogs.push(String(b)));
  browser.on('error', e => errors.push(String(e)));
  let address;
  // Hosted runners can take more than five seconds to cold-start Chromium.
  for (let i = 0; i < 400; i++) {
    try { const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); address = `ws://127.0.0.1:${port}${path}`; break; } catch (_) {}
    if (browser.exitCode !== null) throw new Error('Chromium failed: ' + browserLogs.join(''));
    await pause(50);
  }
  assert.ok(address, 'Chromium debugging endpoint started');
  const ws = new WebSocket(address); await once(ws, 'open'); cdp = new CDP(ws);
  const version = await cdp.send('Browser.getVersion'); observations.push({ browser: version.product, userAgent: version.userAgent });
  cdp.listeners.push(event => {
    if (event.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(event.params.exceptionDetails));
  });
  for (const profession of ['smith', 'herbalist']) {
    const { browserContextId } = await cdp.send('Target.createBrowserContext');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, session); await cdp.send('Runtime.enable', {}, session);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, session);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: profession === 'smith' ? 1360 : 390, height: 950, deviceScaleFactor: 1, mobile: profession === 'herbalist' }, session);
    await cdp.send('Page.navigate', { url: base }, session);
    await waitFor(session, `Boolean(document.querySelector('#join'))`); await ready(session);
    await screenshot(session, profession + '-start');
    const name = profession === 'smith' ? '<b>霧岸旅人</b>' : '潮林藥師';
    await cdp.evaluate(session, `document.querySelector('#name').value=${JSON.stringify(name)};document.querySelector('#profession').value=${JSON.stringify(profession)}`);
    await click(session, '#join');
    await waitFor(session, `document.querySelector('#player-name').textContent === ${JSON.stringify(name)} && !document.querySelector('#character-card').hidden`);
    await ready(session);
    assert.equal(await cdp.evaluate(session, `document.querySelector('#player-name').children.length`), 0, 'Names render as text, not HTML');
    assert.ok(await cdp.evaluate(session, 'document.documentElement.scrollWidth <= innerWidth + 1'), 'No horizontal overflow');
    const distance = profession === 'smith' ? 3 : 4;
    for (let step = 1; step <= distance; step++) await move(session, profession === 'smith' ? 'west' : 'south', profession === 'smith' ? -step : 0, profession === 'smith' ? 0 : step);
    const item = profession === 'smith' ? 'ore' : 'herb';
    const quantity = profession === 'smith' ? 2 : 3;
    for (let n = 1; n <= quantity; n++) {
      if (profession === 'smith' && n === 2) {
        let dropped = false;
        cdp.listeners.push(async event => {
          if (event.sessionId === session && event.method === 'Fetch.requestPaused' && !dropped) {
            dropped = true;
            await cdp.send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'Failed' }, session);
            await cdp.send('Fetch.disable', {}, session);
          }
        });
        await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/action', requestStage: 'Response' }] }, session);
        await click(session, '#gather');
        for (let i = 0; !dropped && i < 100; i++) await pause(50);
        assert.ok(dropped, 'Lost reply injected only after server response');
        await cdp.send('Page.reload', { ignoreCache: true }, session);
      } else await click(session, '#gather');
      await waitFor(session, `document.querySelector('#inventory-${item}')?.textContent === '${n}'`); await ready(session);
    }
    assert.equal((await publicState(session)).items[item], quantity, 'Lost response and reload did not duplicate gathering');
    for (let step = distance - 1; step >= 0; step--) await move(session, profession === 'smith' ? 'east' : 'north', profession === 'smith' ? -step : 0, profession === 'smith' ? 0 : step);
    await click(session, '#craft');
    await waitFor(session, `document.querySelector('#inventory-kit').textContent === '1' && document.querySelector('#inventory-medicine').textContent === '1'`); await ready(session);
    await move(session, 'east', 1, 0); await move(session, 'east', 2, 0);
    const midway = await publicState(session); assert.equal(midway.tower_stage, 1); assert.equal(midway.items.kit, 0);
    await restart(session, midway);
    await move(session, 'west', 1, 0); await move(session, 'east', 2, 0); // checkpoint does not charge again
    await move(session, 'east', 3, 0); await move(session, 'east', 4, 0);
    const complete = await publicState(session);
    assert.equal(complete.coins, 20); assert.equal(complete.tower_reward_claimed, true);
    assert.deepEqual(complete.items, { ore: 0, herb: 0, kit: 0, medicine: 0 });
    await restart(session, complete);
    assert.ok(await cdp.evaluate(session, `document.querySelector('#gather').disabled && Number(getComputedStyle(document.querySelector('#gather')).opacity) < 1`), 'Disabled gathering is visually distinct at the summit');
    await screenshot(session, profession + '-complete');
    await move(session, 'west', 3, 0); await move(session, 'east', 4, 0);
    assert.equal((await publicState(session)).coins, 20, 'No duplicate summit award');
    for (let x = 3; x >= 0; x--) await move(session, 'west', x, 0);
    assert.equal((await publicState(session)).tower_stage, 0);
    await move(session, 'east', 1, 0); await click(session, '[data-move="east"]');
    await waitFor(session, `document.querySelector('#message').textContent.includes('路障需要')`); await ready(session);
    assert.equal((await publicState(session)).x, 1, 'No free second round without repair kit');
    observations.push({ profession, nameRenderedSafely: true, viewport: profession === 'smith' ? 'desktop' : '390px mobile', midwayRestart: midway, completedRestart: complete, duplicateRewardRejected: true, missingKitRejected: true });
    await move(session, 'west', 0, 0);
    characters.set(profession, { session, browserContextId });
  }

  const smith = characters.get('smith').session;
  const herbalist = characters.get('herbalist').session;
  await replenish(smith, 'smith');
  await replenish(herbalist, 'herbalist');

  // List and cancel from outside town: trading has no location restriction.
  await move(smith, 'east', 1, 0);
  const cancelId = await createListing(smith, 'kit', 1, 5);
  const smithBeforeCancel = await publicState(smith);
  await click(smith, `[data-market-action="cancel"][data-listing-id="${cancelId}"]`);
  await marketStatus(smith, cancelId, 'cancelled');
  assert.deepEqual(await publicState(smith), smithBeforeCancel, 'Cancel never moves stock or coins');
  await move(smith, 'west', 0, 0);
  const kitId = await createListing(smith, 'kit');
  const openId = await createListing(smith, 'ore', 1, 2);
  assert.equal((await publicState(smith)).items.kit, 2, 'Listing does not reserve stock');

  // The other context learns about listings from polling, without refreshing or sending an action.
  await marketStatus(herbalist, kitId, 'open');
  assert.equal(await cdp.evaluate(herbalist, `document.querySelector('#market-list [data-listing-id="${kitId}"] .market-seller').textContent`), '<b>霧岸旅人</b>');
  assert.equal(await cdp.evaluate(herbalist, `document.querySelector('#market-list [data-listing-id="${kitId}"] .market-seller').children.length`), 0, 'Market seller names are safe text');
  assert.equal(await cdp.evaluate(herbalist, `document.querySelector('[data-market-action="cancel"][data-listing-id="${kitId}"]') === null`), true, 'Only owner can see cancel');
  assert.ok(await cdp.evaluate(herbalist, 'document.documentElement.scrollWidth <= innerWidth + 1'), 'Market fits 390px without overflow');
  await screenshot(herbalist, 'market-mobile-open');
  await click(herbalist, `[data-market-action="buy"][data-listing-id="${kitId}"]`);
  await marketStatus(herbalist, kitId, 'sold');
  assert.equal((await publicState(herbalist)).coins, 16);
  assert.equal((await publicState(herbalist)).items.kit, 1);
  await marketStatus(smith, kitId, 'sold');
  assert.equal((await publicState(smith)).coins, 24);

  const medicineId = await createListing(herbalist, 'medicine');
  await marketStatus(smith, medicineId, 'open');
  const buyBodies = [];
  let lostBuyReplies = 0;
  const dropBuy = async event => {
    if (event.sessionId !== smith || event.method !== 'Fetch.requestPaused') return;
    const body = JSON.parse(event.params.request.postData);
    assert.deepEqual(body.action, { type: 'buy', listing_id: medicineId });
    buyBodies.push(body);
    lostBuyReplies++;
    await cdp.send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'Failed' }, smith);
    if (lostBuyReplies === 2) await cdp.send('Fetch.disable', {}, smith);
  };
  cdp.listeners.push(dropBuy);
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/action', requestStage: 'Response' }] }, smith);
  await click(smith, `[data-market-action="buy"][data-listing-id="${medicineId}"]`);
  await waitFor(smith, `document.querySelector('#connection').dataset.status === 'offline'`);
  const pendingBuy = await cdp.evaluate(smith, `JSON.parse(localStorage.getItem('mistshore.session.v1')).pendingAction`);
  assert.deepEqual(pendingBuy.action, { type: 'buy', listing_id: medicineId });
  await cdp.send('Page.reload', { ignoreCache: true }, smith);
  for (let n = 0; lostBuyReplies < 2 && n < 160; n++) await pause(50);
  await waitFor(smith, `document.querySelector('#connection')?.dataset.status === 'offline'`);
  assert.equal(lostBuyReplies, 2, 'Both first reply and reload retry reply were lost after commit');
  await click(smith, '#retry');
  await marketStatus(smith, medicineId, 'sold');
  cdp.listeners = cdp.listeners.filter(listener => listener !== dropBuy);
  assert.deepEqual(buyBodies, [pendingBuy, pendingBuy], 'Reload retries identical buy ID and body');
  assert.equal(await cdp.evaluate(smith, `JSON.parse(localStorage.getItem('mistshore.session.v1')).pendingAction`), null);
  assert.equal((await publicState(smith)).coins, 20);
  assert.equal((await publicState(smith)).items.medicine, 1);
  await marketStatus(herbalist, medicineId, 'sold');
  assert.equal((await publicState(herbalist)).coins, 20);
  assert.equal((await publicState(herbalist)).items.medicine, 1);

  const beforeRestart = new Map();
  for (const [profession, { session }] of characters) {
    const snapshot = await publicSnapshot(session);
    beforeRestart.set(profession, { state: snapshot.state, listings: snapshot.listings });
  }
  assert.deepEqual(beforeRestart.get('smith').listings.map(row => row.status), ['cancelled', 'sold', 'open', 'sold']);
  await stop(server); await startServer();
  for (const [profession, { session }] of characters) {
    await cdp.send('Page.reload', { ignoreCache: true }, session);
    await waitFor(session, `document.querySelector('#player-name')?.textContent === ${JSON.stringify(beforeRestart.get(profession).state.name)}`);
    await marketStatus(session, openId, 'open');
    const snapshot = await publicSnapshot(session);
    assert.deepEqual({ state: snapshot.state, listings: snapshot.listings }, beforeRestart.get(profession), 'Restart preserves both characters and every listing status');
    await screenshot(session, profession + '-market-restarted');
  }

  for (const [profession, { session }] of characters) {
    for (let x = 1; x <= 4; x++) await move(session, 'east', x, 0);
    const second = await publicState(session);
    assert.equal(second.coins, 20, 'Second complete tower round grants no extra reward');
    assert.equal(second.tower_stage, 2);
    assert.equal(second.items.kit, 0); assert.equal(second.items.medicine, 0);
    assert.equal(second.tower_reward_claimed, true);
    assert.ok(await cdp.evaluate(session, `!document.querySelector('#guide-detail').textContent.includes('尚未開放')`));
    await screenshot(session, profession + '-second-round');
    observations.push({ profession, secondRound: second, acquiredOppositeSupplyThroughMarket: true });
  }
  const totalCoins = (await publicState(smith)).coins + (await publicState(herbalist)).coins;
  assert.equal(totalCoins, 40, 'Two initial grants plus two once-only awards; trading conserves all coins');
  observations.push({ trading: { cancelledListing: cancelId, soldKit: kitId, openListing: openId, soldMedicine: medicineId,
    lostBuyReplies, identicalReplayBodies: true, safeSellerName: true, pollingObserved: true,
    restartPreservedAllStatuses: true, totalCoins }, humanPlaytest: false });
  for (const { browserContextId } of characters.values()) await cdp.send('Target.disposeBrowserContext', { browserContextId });
  assert.deepEqual(errors, [], 'No uncaught browser/harness exceptions');
  await writeFile(join(evidence, 'browser-result.json'), JSON.stringify({ result: 'PASS', observations }, null, 2) + '\n');
  console.log('Evidence:', evidence);
  console.log('PASS: both profession routes and second rounds, real list/buy/cancel controls, market polling, safe names, lost gather/buy responses with replay, character/listing process restart, reward once-only, coin conservation, desktop/mobile screenshots.');
} finally {
  if (cdp) cdp.ws.close();
  await stop(browser); await stop(server);
  await writeFile(join(evidence, 'browser-stderr.log'), browserLogs.join(''));
  await writeFile(join(evidence, 'server.log'), serverLogs.join(''));
}
