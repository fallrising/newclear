import assert from 'node:assert/strict';
import {tabTo} from './keyboard.mjs';

export async function mockLoadMore(browser, origin, evidence, screenshot) {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, colorScheme: 'light'});
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const requests = []; let external = 0;
  const post = (channel, id) => ({id, timelineEntryId: 'post:' + id, author: 'Synthetic paging', authorHandle: null, content: 'controlled ' + channel + ' post ' + id, channel, createdAt: '2026-10-24T00:00:00Z', replyCount: 0, likeCount: 0, likedByViewer: false, repostCount: 0, repostedByViewer: false, repostedBy: null, repostedByHandle: null, repostedAt: null, image: null});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {external++; return route.abort('blockedbyclient');}
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let body;
    if (url.pathname === '/api/auth/csrf') body = {headerName: 'X-CSRF-TOKEN', token: 'controlled-browser-paging'};
    else if (url.pathname === '/api/auth/session') body = {account: null};
    else if (url.pathname === '/api/posts') {
      const channel = url.searchParams.get('channel');
      if (!['home', 'tech', 'ops'].includes(channel)) {external++; return route.abort('blockedbyclient');}
      const id = {home: 101, tech: 201, ops: 301}[channel];
      const before = url.searchParams.get('before');
      if (before !== null && before !== 'controlled-cursor-' + channel) {external++; return route.abort('blockedbyclient');}
      requests.push({channel, continuation: before !== null});
      body = before ? {items: [post(channel, id), post(channel, id + 1)], nextCursor: null} : {items: [post(channel, id)], nextCursor: 'controlled-cursor-' + channel};
    } else {external++; return route.abort('blockedbyclient');}
    await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
  });
  try {
    await page.goto(origin);
    evidence.mockPaging = [];
    for (const name of ['Home', 'Tech', 'Ops']) {
      const channel = name.toLowerCase(); const id = {home: 101, tech: 201, ops: 301}[channel];
      const column = page.locator('section').filter({has: page.getByRole('heading', {name, exact: true})});
      const focus = await tabTo(page, column.getByRole('button', {name: 'Load more', exact: true}));
      const deckBefore = await page.locator('main .overflow-x-auto').evaluate(el => ({scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth}));
      await page.keyboard.press('Enter'); await column.getByText('controlled ' + channel + ' post ' + (id + 1), {exact: true}).waitFor();
      assert.equal(await column.getByText('controlled ' + channel + ' post ' + id, {exact: true}).count(), 1);
      assert.equal(await column.getByRole('button', {name: 'Load more', exact: true}).count(), 0);
      assert.equal(requests.filter(request => request.channel === channel && request.continuation).length, 1);
      evidence.mockPaging.push({channel, focus, controlled: true, stableIdentityDeduped: true, continuationRequests: 1, deck: deckBefore});
    }
    assert.equal(external, 0);
    assert(evidence.mockPaging[2].deck.scrollLeft > 0, 'REVIEW_KEYBOARD_DECK_SCROLL');
    await screenshot(page, 'mock-keyboard-load-more-mobile', {controlled: true});
  } finally {await context.close();}
}
