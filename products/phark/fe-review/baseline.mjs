import assert from 'node:assert/strict';

export async function baseline(browser, AxeBuilder, origin, seed, evidence, screenshot) {
  const storageState = await seed.a.context.storageState(); // In memory only; never publish cookies.
  const viewports = process.env.FE_REVIEW_PHASE === 'mobile-diagnostic' ? [{width: 390, height: 844}] : [{width: 390, height: 844}, {width: 834, height: 1112}, {width: 1440, height: 900}];
  for (const viewport of viewports) {
    evidence.baselineProgress = {viewport, step: 'new-context'};
    const step = name => {evidence.baselineProgress.step = name;};
    const context = await browser.newContext({viewport, colorScheme: 'light', storageState});
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const health = {externalRequests: 0, pageErrors: 0, consoleErrors: 0, httpErrors: [], requestFailures: 0};
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) {health.externalRequests++; return route.abort('blockedbyclient');}
      return route.continue();
    });
    page.on('pageerror', () => health.pageErrors++);
    page.on('console', message => {if (message.type() === 'error') health.consoleErrors++;});
    page.on('requestfailed', () => health.requestFailures++);
    page.on('response', response => {if (response.status() >= 400) {
      const path = new URL(response.url()).pathname;
      health.httpErrors.push({path: /^\/(?:api\/|favicon\.ico$)/.test(path) ? path : 'other-local-path', status: response.status()});
    }});
    try {
      step('document');
      const response = await page.goto(origin, {waitUntil: 'domcontentloaded'}); assert.equal(response.status(), 200, 'REVIEW_DOCUMENT_STATUS');
      step('authenticated');
      await page.getByRole('button', {name: 'Sign out', exact: true}).waitFor();
      step('channel-headings');
      for (const heading of ['Home', 'Tech', 'Ops']) await page.getByRole('heading', {name: heading, exact: true}).waitFor();
      step('home-fixture');
      await page.getByText(seed.texts.home, {exact: true}).waitFor();
      step('tech-original-and-repost');
      const tech = page.locator('section').filter({has: page.getByRole('heading', {name: 'Tech', exact: true})}).getByText(seed.texts.tech, {exact: true});
      await tech.first().waitFor();
      evidence.baselineProgress.techCopies = await tech.count();
      // The existing timeline deliberately renders both stable original/repost entries.
      assert.equal(evidence.baselineProgress.techCopies, 2, 'REVIEW_TECH_ENTRY_COUNT');
      step('image');
      const image = page.getByAltText('Post image by ' + seed.a.displayName);
      await image.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.images].some(img => img.complete && img.naturalWidth === 16));
      step('reply');
      await page.getByRole('button', {name: '1 reply', exact: true}).click();
      await page.getByText(seed.reply.content, {exact: true}).waitFor();
      step('measure');
      const measurement = await page.evaluate(() => {
        const deck = document.querySelector('main .overflow-x-auto');
        if (!deck) throw Error('REVIEW_DECK_SELECTOR');
        const metrics = el => ({width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight});
        return {page: {scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth}, deck: metrics(deck), columns: [...deck.querySelectorAll(':scope > section')].map(metrics), overflowingText: [...document.querySelectorAll('p,button,span')].filter(el => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0).slice(0, 20).map(el => ({tag: el.tagName, width: el.clientWidth, scrollWidth: el.scrollWidth, textLength: el.textContent.length}))};
      });
      evidence.baselineProgress.measurement = measurement;
      if (process.env.FE_REVIEW_PHASE === 'mobile-diagnostic') evidence.mobileDiagnostic = await page.evaluate(() => {
        const describe = el => {const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return {tag: el.tagName, id: el.id, class: typeof el.className === 'string' ? el.className : '', left: r.left, right: r.right, width: r.width, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, overflowX: s.overflowX, position: s.position, minWidth: s.minWidth, display: s.display};};
        const deck = document.querySelector('main .overflow-x-auto');
        const details = el => {const ancestors = []; for (let parent = el.parentElement; parent; parent = parent.parentElement) ancestors.push(describe(parent)); return {element: describe(el), offsetParent: el.offsetParent ? describe(el.offsetParent) : null, ancestors};};
        const all = [...document.querySelectorAll('*')];
        const overflow = all.filter(el => {const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);});
        const positioned = all.filter(el => ['absolute', 'fixed'].includes(getComputedStyle(el).position));
        return {window: {innerWidth, scrollX, visualWidth: visualViewport.width, visualOffset: visualViewport.offsetLeft}, roots: [document.documentElement, document.head, document.body, document.querySelector('#root'), deck].filter(Boolean).map(describe), totalOverflow: overflow.length, clippedDeckCandidates: overflow.filter(el => deck.contains(el)).length, outsideDeck: overflow.filter(el => !deck.contains(el)).map(details), positioned: positioned.map(details), widestScroll: all.filter(el => el.scrollWidth > el.clientWidth + 1).map(describe).sort((a,b) => b.scrollWidth-a.scrollWidth).slice(0,20)};
      });
      assert.equal(measurement.columns.length, 3, 'REVIEW_COLUMN_COUNT');
      step('screenshot');
      await screenshot(page, 'baseline-home-' + viewport.width, {viewport, controlled: false});
      step('axe'); const axe = process.env.FE_REVIEW_PHASE === 'mobile-diagnostic' ? {violations: [], incomplete: [], skipped: 'geometry-only; baseline-005 retains actual axe'} : await new AxeBuilder({page}).analyze();
      evidence.baseline.push({viewport, loaded: {channels: 3, chineseLength: seed.texts.home.length, unbrokenLength: seed.texts.tech.length, authorLength: seed.a.displayName.length, imageDecoded: true, replyLoaded: true}, measurement, axe: {skipped: axe.skipped ?? null, violations: axe.violations.map(v => ({id: v.id, impact: v.impact, count: v.nodes.length, targets: v.nodes.map(n => n.target)})), incomplete: axe.incomplete.map(v => ({id: v.id, impact: v.impact, count: v.nodes.length}))}, health, passed: true});
      assert.equal(health.externalRequests, 0, 'REVIEW_EXTERNAL_REQUEST');
      assert.equal(health.pageErrors, 0, 'REVIEW_PAGE_ERROR');
    } catch (error) {
      evidence.baselineProgress.health = health;
      throw error;
    } finally {await context.close();}
  }
}
