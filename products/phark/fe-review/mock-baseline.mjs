import assert from 'node:assert/strict';

function problem(status, path) {
  return {type: 'about:blank', title: 'Controlled review failure', status,
    detail: 'Controlled review failure.', instance: path,
    code: status === 403 ? 'CSRF_TOKEN_INVALID' : 'REVIEW_CONTROLLED', requestId: 'review-mock-' + status};
}

// Browser-only responses; this phase finishes before the real Spring process starts.
export async function mockBaseline(browser, origin, evidence, screenshot) {
  for (const state of ['loading', 'empty', '401', '403', '429', '500']) {
    const context = await browser.newContext({viewport: {width: 834, height: 1112}, colorScheme: 'light'});
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    let release; const pending = new Promise(resolve => {release = resolve;});
    const exchanges = []; let unexpected = 0;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {unexpected++; return route.abort('blockedbyclient');}
      if (!url.pathname.startsWith('/api/')) return route.continue();
      let status = 200; let body;
      if (url.pathname === '/api/auth/csrf') {
        if (state === '403') {status = 403; body = problem(status, url.pathname);}
        else body = {headerName: 'X-CSRF-TOKEN', token: 'controlled-browser-only-token'};
      } else if (url.pathname === '/api/auth/session') body = {account: null};
      else if (url.pathname === '/api/posts') {
        if (state === 'loading') await pending;
        if (['401', '429', '500'].includes(state)) {status = Number(state); body = problem(status, url.pathname);}
        else body = {items: [], nextCursor: null};
      } else {unexpected++; return route.abort('blockedbyclient');}
      exchanges.push({path: url.pathname, status, controlled: true});
      await route.fulfill({status, contentType: status === 200 ? 'application/json' : 'application/problem+json', headers: {'X-Request-ID': 'review-mock-' + status, ...(status === 429 ? {'Retry-After': '60'} : {})}, body: JSON.stringify(body)});
    });
    try {
      await page.goto(origin, {waitUntil: 'domcontentloaded'});
      let target;
      if (state === 'loading') target = page.getByText('Loading columns...', {exact: true});
      else if (state === 'empty') target = page.getByText('No posts yet.', {exact: true}).first();
      else if (state === '403') target = page.getByRole('alert').filter({hasText: 'Controlled review failure. (Request ID: review-mock-403)'});
      else target = page.getByText('Request ID: review-mock-' + state, {exact: false}).first();
      await target.waitFor({state: 'visible'});
      if (state === '403') {
        await page.getByText('Secure actions are unavailable.', {exact: true}).waitFor();
        assert(await page.getByRole('button', {name: 'Retry', exact: true}).isEnabled());
        assert.equal(await page.locator('#auth-handle').count(), 0);
        assert(exchanges.some(item => item.path === '/api/auth/csrf' && item.status === 403));
      }
      const semantics = await target.evaluate(el => ({role: el.getAttribute('role'), live: el.getAttribute('aria-live'), textPresent: el.textContent.trim().length > 0}));
      await screenshot(page, 'mock-' + state, {controlled: true});
      assert.equal(unexpected, 0, 'REVIEW_MOCK_UNEXPECTED_REQUEST');
      evidence.mocks.push({state, passed: true, controlled: true, semantics, exchanges: structuredClone(exchanges)});
    } catch (error) {
      evidence.mocks.push({state, passed: false, controlled: true, exchanges: structuredClone(exchanges)});
      throw error;
    } finally {release(); await context.close();}
  }
}
