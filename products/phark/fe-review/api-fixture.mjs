import assert from 'node:assert/strict';
import {randomBytes, createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {csrfValue, requireRotated, requirePost, requireID, loopbackOrigin} from './guards.mjs';

export function generatedPNG() {
  function chunk(type, data) {
    const raw = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of raw) {crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);}
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, raw, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(16, 0); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.concat(Array.from({length: 16}, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({length: 48}, (_, i) => [40, 120, 190][i % 3]))])));
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

export async function seedAPI(pw, origin, evidence, secrets, mode = 'full') {
  loopbackOrigin(origin, 5173);
  const contexts = [];
  const clients = [];
  let completed = false;
  async function account(label) {
    const context = await pw.request.newContext({baseURL: origin, timeout: 10000}); contexts.push(context);
    let csrf;
    const handle = 'r' + randomBytes(5).toString('hex');
    const password = randomBytes(18).toString('base64url'); secrets.push(password);
    const displayName = label === 'A' ? '長'.repeat(50) : 'Synthetic Reviewer B';
    async function call(method, route, data, expected = 200, multipart = false) {
      assert(route.startsWith('/api/') && !route.includes('://'));
      const response = await context.fetch(route, {method, maxRedirects: 0, ...(method === 'GET' ? {} : {headers: {'X-CSRF-TOKEN': csrf}}), ...(data === undefined ? {} : multipart ? {multipart: data} : {data})});
      evidence.lastAPI = {actor: label, method, path: route.split('?')[0], status: response.status(), expected};
      if (response.status() === 429) {
        evidence.rateLimit = {encountered: true, retryAfter: response.headers()['retry-after'] ?? null, action: 'stopped-no-retry'};
        throw Error('REVIEW_RATE_LIMIT');
      }
      if (response.status() !== expected || new URL(response.url()).origin !== origin) throw Error('REVIEW_API_STATUS');
      const requestId = response.headers()['x-request-id'];
      assert(typeof requestId === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(requestId));
      evidence.api.push({actor: label, method, path: route.split('?')[0], status: response.status(), requestId, controlled: false});
      return response.status() === 204 ? undefined : response.json();
    }
    async function refresh() {csrf = csrfValue(await call('GET', '/api/auth/csrf')); secrets.push(csrf); return csrf;}
    await refresh();
    const profile = await call('POST', '/api/accounts', {handle, displayName, password}, 201);
    assert.equal(profile.handle, handle); assert.equal(profile.displayName, displayName);
    assert.equal((await call('GET', '/api/auth/session')).account, null);
    await refresh();
    const before = csrf;
    const loggedIn = await call('POST', '/api/auth/login', {handle, password});
    assert.equal(loggedIn.account.handle, handle);
    await refresh(); requireRotated(before, csrf);
    assert.equal((await call('GET', '/api/auth/session')).account.handle, handle);
    evidence.steps.push({name: 'real-register-login-csrf', actor: label, handle, registerDoesNotLogin: true, csrfRotated: true});
    const client = {context, call, refresh, handle, displayName, password}; clients.push(client); return client;
  }
  try {
    const a = await account('A');
    if (mode === 'logout-only') {
      evidence.seedBudget = {registrations: 1, logins: 1, posts: 0, replies: 0, socialWrites: 0, reports: 0, rateLimitDisabled: false};
      completed = true; return {a, contexts};
    }
    assert.equal(mode, 'full');
    const b = await account('B');
    const texts = {home: 'fe-review ' + '文'.repeat(490), tech: 'W'.repeat(500), ops: 'fe-review generated image', second: 'fe-review second home post'};
    const posts = {};
    for (const channel of ['home', 'tech']) posts[channel] = requirePost(await a.call('POST', '/api/posts', {content: texts[channel], channel}, 201), a.handle, texts[channel], channel);
    const png = generatedPNG();
    posts.ops = requirePost(await a.call('POST', '/api/posts', {post: {name: 'post.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({content: texts.ops, channel: 'ops'}))}, image: {name: 'review.png', mimeType: 'image/png', buffer: png}}, 201, true), a.handle, texts.ops, 'ops');
    requireID(posts.ops.image.id); assert.equal(posts.ops.image.contentType, 'image/png'); assert.equal(posts.ops.image.width, 16); assert.equal(posts.ops.image.height, 16);
    assert.equal(posts.ops.image.url, '/api/media/' + posts.ops.image.id);
    const imageResponse = await a.context.get(posts.ops.image.url, {maxRedirects: 0}); assert.equal(imageResponse.status(), 200);
    const imageBytes = await imageResponse.body(); assert(imageBytes.equals(png));
    posts.second = requirePost(await a.call('POST', '/api/posts', {content: texts.second, channel: 'home'}, 201), a.handle, texts.second, 'home');
    const reply = await b.call('POST', '/api/posts/' + posts.home.id + '/replies', {content: 'fe-review reply ' + 'R'.repeat(180)}, 201);
    requireID(reply.id); assert.equal(reply.postId, posts.home.id); assert.equal(reply.authorHandle, b.handle);
    const like = await b.call('PUT', '/api/posts/' + posts.home.id + '/like'); assert.equal(like.postId, posts.home.id); assert.equal(like.likedByViewer, true);
    const repost = await b.call('PUT', '/api/posts/' + posts.tech.id + '/repost'); assert.equal(repost.postId, posts.tech.id); assert.equal(repost.repostedByViewer, true);
    const notifications = await a.call('GET', '/api/notifications');
    assert.equal(notifications.unreadCount, 3); assert.equal(notifications.items.length, 3);
    assert(notifications.items.every(item => item.actorHandle === b.handle));
    const page1 = await a.call('GET', '/api/posts?channel=home&limit=1');
    assert.equal(page1.items.length, 1); assert(typeof page1.nextCursor === 'string' && page1.nextCursor.length > 0);
    const page2 = await a.call('GET', '/api/posts?channel=home&limit=1&before=' + encodeURIComponent(page1.nextCursor));
    assert.equal(page2.items.length, 1); assert.notEqual(page1.items[0].timelineEntryId, page2.items[0].timelineEntryId);
    assert.deepEqual(new Set([page1.items[0].id, page2.items[0].id]), new Set([posts.home.id, posts.second.id]));
    const profile = await a.call('GET', '/api/profiles/' + a.handle); assert.equal(profile.handle, a.handle);
    const search = await a.call('GET', '/api/search?q=fe-review'); assert(search.items.some(item => item.id === posts.home.id));
    const report = await b.call('POST', '/api/posts/' + posts.home.id + '/reports', {reason: 'SPAM'}, 201);
    requireID(report.id); assert.equal(report.targetId, posts.home.id); assert.equal(report.status, 'RECEIVED');
    evidence.steps.push({name: 'real-api-seed', posts: Object.fromEntries(Object.entries(posts).map(([k,v]) => [k,v.id])), replyId: reply.id, channels: ['home','tech','ops'], image: {id: posts.ops.image.id, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex')}, notifications: 3, opaqueCursorPaging: true, reportId: report.id, controlled: false});
    evidence.seedBudget = {registrations: 2, logins: 2, posts: 4, replies: 1, socialWrites: 2, reports: 1, rateLimitDisabled: false};
    completed = true;
    return {a, b, posts, reply, notifications, texts, contexts};
  } finally {
    if (!completed) await Promise.allSettled(contexts.map(context => context.dispose()));
  }
}
