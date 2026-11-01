import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRecords } from './capture-selection.mjs';
const a = { key: 'a', value: { status: 200 } };
const b = { key: 'b', value: { status: 200, error: 'retained first failure' } };
const fixed = { key: 'b', value: { status: 200 } };
const expected = ['a','b'];
const replacements = ['b'];
test('only explicit failed key is replaced, with source attempt provenance', () => {
  const result=selectRecords([a,b],[fixed],expected,replacements);
  assert.equal(result.length,2);
  assert.equal(result[0].attempt,'original');
  assert.equal(result[1].attempt,'repair');
  assert.equal(result[1].value.error,undefined);
});
for (const [name, original, repair] of [
 ['duplicate original',[a,b,b],[fixed]],
 ['missing original',[b],[fixed]],
 ['duplicate repair',[a,b],[fixed,fixed]],
 ['missing repair',[a,b],[]],
 ['unexpected repair',[a,b],[fixed,{key:'secret-path',value:{}}]],
 ['replace green',[a,fixed],[fixed]],
 ['failed repair',[a,b],[b]],
 ['unrepaired failure',[{...a,value:{error:'failed'}},b],[fixed]],
]) test(`reject ${name} with fixed diagnostic`, () => {
 assert.throws(()=>selectRecords(original,repair,expected,replacements),/^Error: REVIEW_[A-Z_]+$/);
});
