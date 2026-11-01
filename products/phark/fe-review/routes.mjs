import assert from 'node:assert/strict';

export async function captureRoutes(browser, AxeBuilder, origin, seed, evidence, screenshot) {
  const storageState = await seed.a.context.storageState();
  evidence.routes = [];
  for (const viewport of [{width: 390, height: 844}, {width: 834, height: 1112}, {width: 1440, height: 900}]) {
    const context = await browser.newContext({viewport, colorScheme: 'light', storageState});
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
    try {
      for (const [name, path] of [['notifications', '/notifications'], ['search', '/search?q=fe-review'], ['profile', '/profiles/' + seed.a.handle]]) {
        const page = await context.newPage(); page.setDefaultTimeout(10000);
        const health = {pageErrors: 0, consoleErrors: 0, requestFailures: 0, httpErrors: 0};
        page.on('pageerror', () => health.pageErrors++); page.on('console', message => {if (message.type() === 'error') health.consoleErrors++;});
        page.on('requestfailed', () => health.requestFailures++); page.on('response', response => {if (response.status() >= 400) health.httpErrors++;});
        evidence.routeProgress = {name, viewport};
        try {
          const response = await page.goto(origin + path); assert.equal(response.status(), 200, 'REVIEW_ROUTE_DOCUMENT');
          await page.getByRole('button', {name: 'Sign out', exact: true}).waitFor();
          await page.getByRole('heading', {name: name === 'profile' ? seed.a.displayName : name === 'search' ? 'Search' : 'Notifications', exact: true}).waitFor();
          const homeText = page.getByText(seed.texts.home, {exact: true});
          await homeText.first().waitFor();
          assert.equal(await homeText.count(), name === 'notifications' ? 2 : 1, 'REVIEW_ROUTE_IDENTITY_COUNT');
          assert.equal(page.url(), origin + path, 'REVIEW_ROUTE_FINAL_URL');
          if (name === 'notifications') {await page.getByText(seed.texts.tech, {exact: true}).waitFor(); assert.equal(await page.getByText('Unread', {exact: true}).count(), 3); assert.equal(await page.getByRole('button', {name: seed.b.displayName, exact: true}).count(), 3);}
          const geometry = await page.evaluate(() => ({scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth}));
          // Required PNG inventory is produced once by the unchanged shared
          // capture tool; this supplemental pass checks identities and axe
          // incomplete results at every viewport without duplicate PNGs.
          const axe = await new AxeBuilder({page}).analyze();
          evidence.routes.push({name, path, viewport, loadedIdentity: true, geometry, health, axe: {violations: axe.violations.map(v => ({id: v.id, impact: v.impact, count: v.nodes.length})), incomplete: axe.incomplete.map(v => ({id: v.id, impact: v.impact, count: v.nodes.length}))}});
        } finally {await page.close();}
      }
    } finally {await context.close();}
  }
  for (const entry of evidence.routes) {
    assert(entry.geometry.scrollWidth <= entry.geometry.clientWidth + 1, 'REVIEW_ROUTE_OVERFLOW');
    assert(Object.values(entry.health).every(count => count === 0), 'REVIEW_ROUTE_HEALTH');
    assert(entry.axe.violations.every(v => !['critical', 'serious'].includes(v.impact)), 'REVIEW_ROUTE_AXE');
  }
}
