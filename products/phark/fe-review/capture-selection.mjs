import assert from 'node:assert/strict';
const key = item => item.page + '/' + item.viewport + '/' + item.colorScheme;
const viewports = ['mobile', 'tablet', 'desktop'];
const expected = new Set(['home','notifications','search','profile'].flatMap(page => viewports.map(viewport => page + '/' + viewport + '/light')));
export function selectNotificationRepair(previous, repair) {
  assert.equal(previous.length, 12, 'REVIEW_ORIGINAL_KEY_COUNT');
  assert.equal(new Set(previous.map(key)).size, 12, 'REVIEW_ORIGINAL_DUPLICATE');
  assert(previous.every(item => expected.has(key(item))), 'REVIEW_ORIGINAL_UNEXPECTED_KEY');
  assert.equal(repair.length, 3, 'REVIEW_REPAIR_KEY_COUNT');
  assert.equal(new Set(repair.map(key)).size, 3, 'REVIEW_REPAIR_DUPLICATE');
  assert(repair.every(item => item.page === 'notifications' && expected.has(key(item))), 'REVIEW_REPAIR_UNEXPECTED_KEY');
  const kept = previous.filter(item => item.page !== 'notifications');
  assert(kept.every(item => !item.error && item.status === 200 && !item.horizontalOverflow && item.consoleErrors === 0 && item.pageErrors === 0 && item.failedRequests === 0), 'REVIEW_RETAINED_NOT_GREEN');
  assert(previous.filter(item => item.page === 'notifications').every(item => item.horizontalOverflow === true), 'REVIEW_REPLACE_ONLY_FAILED');
  assert(repair.every(item => !item.error && item.status === 200 && !item.horizontalOverflow && item.consoleErrors === 0 && item.pageErrors === 0 && item.failedRequests === 0), 'REVIEW_REPAIR_NOT_GREEN');
  return [...kept.map(item => ({...item, sourceRun: 'final-001'})), ...repair];
}
