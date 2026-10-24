import assert from 'node:assert/strict';
import {tabTo, observeResponse} from './keyboard.mjs';
import {requireID} from './guards.mjs';
import {safePath, expectedAbort, classifyConsoles, expectedLogoutAbort} from './health.mjs';

export async function journey(browser, origin, seed, evidence, screenshot) {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, colorScheme: 'light'});
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  evidence.journey = []; let release = () => {};
  const health = {external: 0, pageErrors: 0, consoleErrors: 0, requestFailures: 0, controlledFailures: [], unexpectedHTTP: [], consoleEvents: [], failedRequestEvents: [], navigations: []};
  const started = performance.now(); const time = () => Math.round(performance.now() - started);
  let activeNavigation = null; let teardown = false; let teardownComplete = false; let workflowPassed = false;
  let logoutRequest = null;
  const failedRequests = [];
  const logoutProof = {status204: false, session200: false, accountNull: false, signedOutUI: false};
  async function navigate(kind, action) {
    const record = {id: health.navigations.length + 1, kind, startedMs: time(), endedMs: null, observed: false};
    health.navigations.push(record); activeNavigation = record;
    try {return await action();} finally {record.endedMs = time(); activeNavigation = null;}
  }
  page.on('framenavigated', frame => {if (frame === page.mainFrame() && activeNavigation) {activeNavigation.observed = true; activeNavigation.destination = safePath(frame.url(), origin);}});
  const controlled = new Set();
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) {health.external++; return route.abort('blockedbyclient');}
    return route.continue();
  });
  page.on('pageerror', () => health.pageErrors++);
  page.on('console', message => {if (message.type() === 'error') {
    health.consoleErrors++;
    const match = message.text().match(/server responded with a status of (\d{3})/);
    health.consoleEvents.push({...safePath(message.location().url, origin), status: match ? Number(match[1]) : null, stage: evidence.journeyProgress, timeMs: time()});
  }});
  page.on('requestfailed', request => {
    health.requestFailures++;
    failedRequests.push(request);
    const error = request.failure()?.errorText;
    health.failedRequestEvents.push({...safePath(request.url(), origin), method: ['GET','POST','PUT','DELETE'].includes(request.method()) ? request.method() : 'OTHER', errorCode: /^net::ERR_[A-Z_]+$/.test(error ?? '') ? error : 'unknown', stage: evidence.journeyProgress, timeMs: time(), navigationId: activeNavigation?.id ?? null, teardown});
  });
  page.on('response', response => {
    if (response.status() < 400) return;
    const url = new URL(response.url()); const key = response.request().method() + ' ' + url.pathname;
    const item = {method: response.request().method(), ...safePath(response.url(), origin), status: response.status()};
    if (controlled.has(key) && response.status() === 500) health.controlledFailures.push(item);
    else health.unexpectedHTTP.push(item);
  });
  const step = name => {evidence.journeyProgress = name;};
  const activate = async (locator, direction) => {const focus = await tabTo(page, locator, direction); await page.keyboard.press('Enter'); return focus;};
  const cardFor = text => page.locator('[class~="bg-card/95"]').filter({has: page.getByText(text, {exact: true})});
  async function performLogout() {
    step('logout'); const loggedOut = observeResponse(page, origin, 'POST', '/api/auth/logout', response => {logoutRequest = response.request(); logoutProof.status204 = response.status() === 204;});
    const logoutFocus = await activate(page.getByRole('button', {name: 'Sign out', exact: true})); await loggedOut(204);
    await page.getByLabel('Handle', {exact: true}).waitFor(); logoutProof.signedOutUI = true;
    const session = await context.request.get(origin + '/api/auth/session'); assert.equal(session.status(), 200); logoutProof.session200 = true;
    assert.equal((await session.json()).account, null); logoutProof.accountNull = true;
    await navigate('anonymous-notifications-document', async () => {await page.goto(origin + '/notifications'); await page.getByText('Sign in to view notifications', {exact: true}).waitFor();});
    await screenshot(page, 'flow-logged-out-notifications', {controlled: false});
    evidence.journey.push({name: 'keyboard-logout-anonymous', focus: logoutFocus, real: true, proof: {...logoutProof}});
  }
  async function holdFailure(path, method = 'POST') {
    let count = 0; let released; let entered;
    const pending = new Promise(resolve => {released = resolve;}); release = released;
    const received = new Promise(resolve => {entered = resolve;});
    const key = method + ' ' + path; controlled.add(key);
    const handler = async route => {
      if (route.request().method() !== method) return route.fallback();
      count++; entered(); await pending;
      await route.fulfill({status: 500, contentType: 'application/problem+json', body: JSON.stringify({type: 'about:blank', title: 'Controlled failure', status: 500, detail: 'Controlled failure.', instance: path, code: 'REVIEW_CONTROLLED', requestId: 'review-pending-500'})});
    };
    await page.route(origin + path, handler);
    return {count: () => count, received, release: released, remove: () => page.unroute(origin + path, handler)};
  }
  try {
    step('keyboard-login'); await navigate('initial-document', () => page.goto(origin));
    await tabTo(page, page.getByLabel('Handle', {exact: true})); await page.keyboard.insertText(seed.a.handle);
    await tabTo(page, page.getByLabel('Password', {exact: true})); await page.keyboard.insertText(seed.a.password);
    const login = observeResponse(page, origin, 'POST', '/api/auth/login');
    const loginFocus = await activate(page.locator('form').filter({has: page.locator('#auth-password')}).getByRole('button', {name: 'Sign in', exact: true}));
    assert.equal((await login(200)).account.handle, seed.a.handle);
    await page.getByRole('button', {name: 'Sign out', exact: true}).waitFor();
    evidence.journey.push({name: 'keyboard-login', focus: loginFocus, real: true});
    if (process.env.FE_REVIEW_PHASE === 'logout-only') {
      await performLogout();
      assert.equal(health.external, 0); assert.equal(health.pageErrors, 0); assert.equal(health.unexpectedHTTP.length, 0);
      workflowPassed = true; return;
    }

    step('composer-pending-error');
    const content = 'fe-review keyboard-created post';
    await tabTo(page, page.getByLabel('Content', {exact: true})); await page.keyboard.insertText(content);
    const held = await holdFailure('/api/posts');
    const failed = observeResponse(page, origin, 'POST', '/api/posts');
    const postingFocus = await activate(page.getByRole('button', {name: 'Post', exact: true}), 'Shift+Tab');
    await page.getByRole('button', {name: 'Posting...', exact: true}).waitFor();
    assert(await page.getByRole('button', {name: 'Posting...', exact: true}).isDisabled());
    assert(await page.getByLabel('Content', {exact: true}).isDisabled());
    await held.received;
    await page.keyboard.press('Enter'); assert.equal(held.count(), 1, 'REVIEW_PENDING_DUPLICATE');
    await screenshot(page, 'flow-composer-pending', {controlled: true});
    held.release(); await failed(500);
    await page.getByRole('alert').filter({hasText: 'review-pending-500'}).waitFor();
    assert.equal(await page.getByLabel('Content', {exact: true}).inputValue(), content);
    assert(await page.getByRole('button', {name: 'Post', exact: true}).isEnabled());
    assert.equal(await page.getByLabel('Content', {exact: true}).getAttribute('aria-describedby'), 'content-feedback');
    await screenshot(page, 'flow-composer-error', {controlled: true}); await held.remove();
    evidence.journey.push({name: 'composer-pending-error-no-resend', focus: postingFocus, count: held.count(), retainedInput: true, controlled: true});

    step('composer-real'); const created = observeResponse(page, origin, 'POST', '/api/posts');
    const createdFocus = await activate(page.getByRole('button', {name: 'Post', exact: true}));
    const post = await created(201); requireID(post.id); assert.equal(post.authorHandle, seed.a.handle); assert.equal(post.content, content);
    const card = cardFor(content); await card.waitFor(); assert.equal(await card.count(), 1);
    evidence.journey.push({name: 'keyboard-composer', id: post.id, focus: createdFocus, real: true});

    step('reply-real'); await activate(card.getByRole('button', {name: '0 replies', exact: true}));
    const thread = page.locator('#reply-thread-' + post.id);
    await tabTo(page, thread.getByLabel('Reply', {exact: true})); await page.keyboard.insertText('fe-review keyboard reply');
    const replyResponse = observeResponse(page, origin, 'POST', '/api/posts/' + post.id + '/replies');
    const replyFocus = await activate(thread.getByRole('button', {name: 'Reply', exact: true}));
    const reply = await replyResponse(201); requireID(reply.id); assert.equal(reply.postId, post.id); assert.equal(reply.authorHandle, seed.a.handle);
    await thread.getByText('fe-review keyboard reply', {exact: true}).waitFor();
    evidence.journey.push({name: 'keyboard-reply', postId: post.id, replyId: reply.id, focus: replyFocus, real: true});

    step('like-optimistic-rollback');
    const heldLike = await holdFailure('/api/posts/' + post.id + '/like', 'PUT');
    const failedLike = observeResponse(page, origin, 'PUT', '/api/posts/' + post.id + '/like');
    await activate(card.getByRole('button', {name: '0 likes', exact: true}));
    const optimistic = card.getByRole('button', {name: '1 like', exact: true});
    await optimistic.waitFor(); assert.equal(await optimistic.getAttribute('aria-pressed'), 'true'); assert(await optimistic.isDisabled());
    await heldLike.received; await page.keyboard.press('Enter'); assert.equal(heldLike.count(), 1);
    heldLike.release(); await failedLike(500);
    await card.getByRole('alert').filter({hasText: 'review-pending-500'}).waitFor();
    const restored = card.getByRole('button', {name: '0 likes', exact: true});
    assert.equal(await restored.getAttribute('aria-pressed'), 'false'); assert(await restored.isEnabled());
    await heldLike.remove();
    evidence.journey.push({name: 'like-optimistic-rollback-no-resend', count: heldLike.count(), controlled: true});

    step('like-real'); const liked = observeResponse(page, origin, 'PUT', '/api/posts/' + post.id + '/like');
    const likeFocus = await activate(card.getByRole('button', {name: '0 likes', exact: true}));
    const like = await liked(200); assert.equal(like.postId, post.id); assert.equal(like.likedByViewer, true);
    assert.equal(await card.getByRole('button', {name: '1 like', exact: true}).getAttribute('aria-pressed'), 'true');
    evidence.journey.push({name: 'keyboard-like', id: post.id, focus: likeFocus, real: true});

    step('report-real'); const reportResponse = observeResponse(page, origin, 'POST', '/api/posts/' + post.id + '/reports');
    const reportFocus = await activate(card.locator('form').filter({has: page.locator('#report-reason-post-' + post.id)}).getByRole('button', {name: 'Report', exact: true}));
    const report = await reportResponse(201); requireID(report.id); assert.equal(report.targetId, post.id); assert.equal(report.status, 'RECEIVED');
    await card.getByRole('status').filter({hasText: 'Report submitted.'}).waitFor();
    evidence.journey.push({name: 'keyboard-report', reportId: report.id, targetId: post.id, focus: reportFocus, real: true});

    step('repost-real'); const reposted = observeResponse(page, origin, 'PUT', '/api/posts/' + post.id + '/repost');
    const repostFocus = await activate(card.getByRole('button', {name: '0 reposts', exact: true}));
    const repost = await reposted(200); assert.equal(repost.postId, post.id); assert.equal(repost.repostedByViewer, true);
    evidence.journey.push({name: 'keyboard-repost', id: post.id, focus: repostFocus, real: true});

    step('notifications-read'); await navigate('notifications', async () => {await activate(page.getByRole('button', {name: /^Notifications/})); await page.getByRole('heading', {name: 'Notifications', exact: true}).waitFor();});
    assert.equal(new URL(page.url()).pathname, '/notifications');
    const read = observeResponse(page, origin, 'PUT', '/api/notifications/read');
    const readFocus = await activate(page.getByRole('button', {name: 'Mark all read', exact: true}));
    assert.equal((await read(200)).unreadCount, 0);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Mark all read' && button.disabled));
    evidence.journey.push({name: 'keyboard-notifications-read', focus: readFocus, real: true});

    step('profile-navigation'); await navigate('profile', async () => {await activate(page.getByRole('button', {name: seed.a.displayName + ' @' + seed.a.handle, exact: true})); await page.getByRole('heading', {name: seed.a.displayName, exact: true}).waitFor();});
    assert.equal(new URL(page.url()).pathname, '/profiles/' + seed.a.handle);
    await navigate('history-back', async () => {await page.goBack(); await page.getByRole('heading', {name: 'Notifications', exact: true}).waitFor();});
    await navigate('history-forward', async () => {await page.goForward(); await page.getByRole('heading', {name: seed.a.displayName, exact: true}).waitFor();});
    evidence.journey.push({name: 'keyboard-profile-back-forward', real: true});

    step('search-navigation'); await tabTo(page, page.locator('#header-search-query')); await page.keyboard.insertText('fe-review');
    await navigate('search', async () => {await page.keyboard.press('Enter'); await page.getByRole('heading', {name: 'Search', exact: true}).waitFor();});
    assert.equal(new URL(page.url()).pathname, '/search'); assert.equal(new URL(page.url()).searchParams.get('q'), 'fe-review');
    await page.getByText(content, {exact: true}).first().waitFor();
    evidence.journey.push({name: 'keyboard-search', query: 'fe-review', real: true});

    await performLogout();
    assert.equal(health.external, 0); assert.equal(health.pageErrors, 0); assert.equal(health.unexpectedHTTP.length, 0);
    workflowPassed = true;
  } finally {
    release(); teardown = true; evidence.journeyHealth = health; await context.close(); teardownComplete = true;
    health.consoleEvents = classifyConsoles(health.consoleEvents, health.controlledFailures);
    health.failedRequestEvents = health.failedRequestEvents.map((event, index) => {
      const proof = {...logoutProof, sameRequest: failedRequests[index] === logoutRequest};
      return {...event, ...(proof.sameRequest ? {logoutProof: proof} : {}), classification: expectedLogoutAbort(event, proof) ? 'completed-logout-204-browser-abort' : expectedAbort(event, health.navigations, teardownComplete) ? 'observed-navigation-or-teardown-abort' : 'unclassified'};
    });
    evidence.journeyHealth = health;
    if (workflowPassed) {
      assert(health.consoleEvents.every(event => event.classification !== 'unclassified'), 'REVIEW_UNCLASSIFIED_CONSOLE');
      assert(health.failedRequestEvents.every(event => event.classification !== 'unclassified'), 'REVIEW_UNCLASSIFIED_REQUEST');
    }
  }
}
