import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewUrl, buildPlan, verifiedCaptureKeys } from './capture-plan.mjs';

test('review routes preserve base path and reject external or escaping navigation', () => {
  assert.equal(reviewUrl('/rd/apps'), 'http://127.0.0.1:5173/dim-gate/rd/apps');
  for (const route of ['https://example.org', '//example.org', '/../admin', '/dim-gate/../admin']) assert.throws(() => reviewUrl(route));
});
test('plan spans real personas, themes and viewports with dynamic details discovered from lists', () => {
  const plan = buildPlan();
  assert.equal(plan.length, 18);
  assert.equal(new Set(plan.map(p => p.persona)).size, 3);
  assert.deepEqual([...new Set(plan.map(p => p.theme))].sort(), ['dark', 'light']);
  assert(plan.every(p => p.pages.length && p.pages.every(r => r.path.startsWith('/'))));
  assert(plan.some(p => p.pages.some(r => r.discoverPrefix === '/ops/incidents/')));
});

test('resume excludes incomplete theme/persona evidence and combines prior successful runs', () => {
  const good = {persona:'user-rd-commerce',page:'alerts',viewport:'desktop',colorScheme:'light',theme:'light',selectedPersona:'user-rd-commerce',heading:'Alerts',screenshot:'screenshots/alerts.png',status:200};
  assert.equal(verifiedCaptureKeys([{...good,theme:null}]).size,0);
  assert.equal(verifiedCaptureKeys([{...good,selectedPersona:'user-ops'}]).size,0);
  assert.equal(verifiedCaptureKeys([{...good,heading:''}]).size,0);
  assert.deepEqual([...verifiedCaptureKeys([{...good,theme:null},good,{...good,page:'apps'}])],['user-rd-commerce|alerts|desktop|light','user-rd-commerce|apps|desktop|light']);
});
