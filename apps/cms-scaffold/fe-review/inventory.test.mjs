import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const component = new URL('../', import.meta.url);
const targets = JSON.parse(readFileSync(new URL('targets.json', import.meta.url), 'utf8'));
test('targets map to actual current routes with explicit loaded and final URL contracts', () => {
  const counts = [];
  for (const app of targets.apps) {
    const source = readFileSync(new URL(`apps/${app.name}/src/routes.tsx`, component), 'utf8');
    const routes = [...source.matchAll(/path: "([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(app.pages.map((p) => p.id)).size, app.pages.length);
    for (const page of app.pages) {
      assert.ok(routes.includes(page.review.route), `${app.name}/${page.id} has an actual route`);
      const request = new URL(page.path, app.baseUrl);
      const pattern = page.review.route === '*' ? /^\/.*$/ : new RegExp('^'+page.review.route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[a-zA-Z]+/g, '[^/]+')+'$');
      assert.match(request.pathname, pattern);
      assert.ok(page.review.loaded.length > 0);
      assert.ok(page.review.loaded.includes(page.waitFor));
      if (page.review.identity) assert.equal(request.searchParams.get('mockUser'), page.review.identity);
      assert.equal(new URL(page.review.finalPath, app.baseUrl).origin, app.baseUrl);
    }
    counts.push(app.pages.length);
  }
  assert.deepEqual(counts, [18,15,18]);
});
test('concrete public and member fixture IDs remain present', () => {
  const publicEntries = JSON.parse(readFileSync(new URL('packages/mocks/fixtures/public-entries.json', component), 'utf8'));
  for (const slug of ['coast-light-2026','coast-harbour','james-carter','cms-scaffold','m1-specs']) assert.ok(publicEntries.some((entry) => entry.slug === slug));
  const members = readFileSync(new URL('packages/mocks/fixtures/member-entries.json', component), 'utf8');
  assert.ok(members.includes('43000000-0000-4000-8000-000000000001'));
  assert.ok(members.includes('seed-member-clinic'));
});
