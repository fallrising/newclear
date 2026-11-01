import test from 'node:test';
import assert from 'node:assert/strict';
import { observed, unwrap, errorCategory } from './pending.mjs';
test('pending browser rejection is handled immediately when the action fails first', async () => {
  const original = new Error('strict mode violation: private locator details');
  const pending = observed(Promise.reject(new Error('Target page, context or browser has been closed')));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errorCategory(original), 'REVIEW_LOCATOR_AMBIGUOUS');
  await assert.rejects(unwrap(pending), /closed/);
});
test('pending success and unknown errors retain no raw payload', async () => {
  assert.equal(await unwrap(observed(Promise.resolve(303))), 303);
  assert.equal(errorCategory(new Error('private-token')), 'REVIEW_FAILED');
});
