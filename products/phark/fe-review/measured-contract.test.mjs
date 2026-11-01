import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {assertLayout, assertStateSemantics} from './layout-contract.mjs';

const geometry = JSON.parse(await readFile(new URL(process.env.FE_REVIEW_LAYOUT_RECEIPT || './runs/baseline-004-real-only/result.json', import.meta.url)));
const states = JSON.parse(await readFile(new URL(process.env.FE_REVIEW_MOCK_RECEIPT || './runs/baseline-003/result.json', import.meta.url)));
for (const entry of geometry.baseline) test('measured geometry ' + entry.viewport.width, () => assertLayout(entry.measurement));
test('observed loading/errors expose status and alert semantics', () => assertStateSemantics(states.mocks));
