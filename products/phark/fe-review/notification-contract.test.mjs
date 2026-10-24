import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const result = JSON.parse(await readFile(new URL(process.env.FE_REVIEW_NOTIFICATION_RECEIPT || './runs/final-001/result.json', import.meta.url)));
for (const entry of result.sharedCapture.records.filter(entry => entry.page === 'notifications')) {
  test('actual shared notification overflow ' + entry.viewport, () => assert.equal(entry.horizontalOverflow, false));
}
