import assert from 'node:assert/strict';

export function assertLayout(measurement) {
  assert(measurement.page.scrollWidth <= measurement.page.clientWidth + 1, 'REVIEW_PAGE_OVERFLOW');
  assert.equal(measurement.columns.length, 3, 'REVIEW_COLUMN_COUNT');
  assert(measurement.columns.every(column => column.height <= measurement.deck.height + 1), 'REVIEW_COLUMN_HEIGHT');
  assert.equal(measurement.overflowingText.length, 0, 'REVIEW_TEXT_OVERFLOW');
}
export function assertStateSemantics(mocks) {
  for (const state of ['loading', '401', '429', '500']) {
    const entry = mocks.find(mock => mock.state === state);
    assert(entry?.passed, 'REVIEW_MOCK_MISSING');
    assert.equal(entry.semantics.role, state === 'loading' ? 'status' : 'alert', 'REVIEW_STATE_SEMANTICS');
  }
}
