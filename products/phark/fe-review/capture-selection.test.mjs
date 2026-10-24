import test from 'node:test';
import assert from 'node:assert/strict';
import {selectNotificationRepair} from './capture-selection.mjs';
const original = ['home','notifications','search','profile'].flatMap(page => ['mobile','tablet','desktop'].map(viewport => ({page, viewport, colorScheme: 'light', status: 200, error: false, horizontalOverflow: page === 'notifications', consoleErrors: 0, pageErrors: 0, failedRequests: 0})));
const repair = original.filter(item => item.page === 'notifications').map(item => ({...item, horizontalOverflow: false, sourceRun: 'synthetic-repair'}));
test('nine immutable green keys plus exactly three failed notification replacements', () => {
  const selected = selectNotificationRepair(original, repair); assert.equal(selected.length, 12); assert.equal(selected.filter(item => item.sourceRun === 'final-001').length, 9);
});
test('missing duplicate unexpected or still-failing repair is rejected', () => {
  for (const bad of [repair.slice(1), [repair[0], repair[0], repair[2]], repair.map(item => ({...item, page: 'home'})), repair.map(item => ({...item, horizontalOverflow: true}))]) assert.throws(() => selectNotificationRepair(original, bad));
});
test('original green notification or changed retained failure cannot be silently replaced', () => {
  assert.throws(() => selectNotificationRepair(original.map(item => ({...item, horizontalOverflow: false})), repair));
  assert.throws(() => selectNotificationRepair(original.map(item => item.page === 'home' ? {...item, error: true} : item), repair));
});
