import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { assertRuntimeHealth } from './runtime-guards.mjs';
import { installFlowshotFixture } from './preload.mjs';
import { runOwned, baseURL, viewports, capture } from './browser-runtime.mjs';

await runOwned({
  component: fileURLToPath(new URL('../', import.meta.url)), unit: 'flowshot',
  sourceFiles: ['fe-review/preload.mjs', 'fe-review/preload.node.mjs', 'fe-review/runtime-guards.mjs', 'fe-review/browser-runtime.mjs', 'fe-review/run-review.mjs', 'src/main.ts', 'src/launch-build-info.ts', 'src/render.tsx', 'src/App.tsx', 'src/styles.css', 'package-lock.json'],
  async execute({ open, close, output, receipt, AxeBuilder }) {
    receipt.stage = 'NETWORK_REFUSAL';
    const probe = await open({ viewport: viewports[0] }, installFlowshotFixture);
    await probe.page.goto(`${baseURL}/`);
    await probe.page.evaluate(async () => {
      await fetch('http://external.invalid/review-canary').catch(() => undefined);
      await new Promise((resolve) => { const socket = new WebSocket('ws://external.invalid/review-canary'); socket.onclose = resolve; socket.onerror = resolve; setTimeout(() => { socket.close(); resolve(); }, 1000); });
    });
    assert.equal(probe.health.blockedHttp, 1); assert.equal(probe.health.blockedWebSocket, 1);
    receipt.steps.push({ id: 'external-http-websocket-refused', passed: true, blockedHttp: 1, blockedWebSocket: 1 });
    await close(probe);
    const scenarios = [];
    for (const viewport of viewports) for (const colorScheme of ['light', 'dark']) for (const state of ['loading', 'ready', 'error']) scenarios.push({ viewport, colorScheme, state, long: false });
    scenarios.push({ viewport: viewports[2], colorScheme: 'light', state: 'ready', long: true });
    for (const scenario of scenarios) {
      const id = `${scenario.long ? 'long-ready' : scenario.state}__${scenario.viewport.name}__${scenario.colorScheme}`;
      receipt.stage = id;
      const owned = await open({ viewport: { width: scenario.viewport.width, height: scenario.viewport.height }, colorScheme: scenario.colorScheme, locale: 'zh-TW' }, installFlowshotFixture);
      const { page, health } = owned;
      const response = await page.goto(`${baseURL}/`);
      await page.getByRole('heading', { name: 'Connecting to the desktop core', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => Boolean(window.__FLOW_REVIEW__ && window.__FLOWSHOT_BUILD_INFO_PROMISE__)), true);
      await page.evaluate(() => window.__FLOW_REVIEW__.observeLoading());
      if (scenario.state === 'ready') {
        await page.evaluate((long) => window.__FLOW_REVIEW__.ready(long), scenario.long);
        await page.getByRole('heading', { name: 'Foundation ready', exact: true }).waitFor();
        assert.deepEqual(await page.locator('.build-details dd').allTextContents(), ['0.0.0-review', scenario.long ? 'synthetic-long-revision-'.repeat(12) : 'synthetic-revision', 'review-only']);
      } else if (scenario.state === 'error') {
        await page.evaluate(() => window.__FLOW_REVIEW__.error());
        await page.getByRole('heading', { name: 'Build information unavailable', exact: true }).waitFor();
        assert.equal(await page.getByRole('alert').textContent(), 'Synthetic build information unavailable');
      }
      const fixture = await page.evaluate(() => window.__FLOW_REVIEW__.snapshot());
      assert.equal(fixture.state, scenario.state); assert.equal(fixture.unknownInvokes, 0); assert.equal(health.pageErrors, 0);
      const measured = await capture({ page, output, id, response, health, AxeBuilder });
      receipt.captures.push({ ...measured, fixture });
      assertRuntimeHealth(health);
      await page.evaluate(() => window.__FLOW_REVIEW__.dispose());
      await close(owned);
    }
    assert.equal(receipt.captures.length, 19);
    receipt.steps.push({ id: 'three-shell-states-and-long-metadata', passed: true, captures: 19 });
  },
});
