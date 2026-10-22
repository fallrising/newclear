import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCircuit } from '../examples/api-probe.mjs';
import { validateInputs, parseNumericInput, compareForward, createForwardEvaluator } from '../web/forward.mjs';

const Circuit = await loadCircuit(process.env.HANDWIRED_ROOT);

test('HW-A01: real pinned graph matches nine points, bounds and fractional coefficients', () => {
  const evaluate = createForwardEvaluator(Circuit);
  for (const x of [-20, -10, 0, 10, 20, 30, 40, 50, 60, 12.34567]) {
    for (const a of [0.5, 1.25, 1.333333, 2]) {
      for (const b of [-10, -2, 0.1234567, 10]) {
        const result = compareForward({ x, a, b }, evaluate);
        assert.equal(result.reference, a * x + b);
        assert.equal(result.tolerance, 1e-5 + 1e-5 * Math.abs(result.reference));
        assert.ok(Number.isFinite(result.graph));
        assert.ok(result.passed, JSON.stringify({ x, a, b, result }));
      }
    }
  }
});

test('HW-A02: every invalid class is rejected before the evaluator is called', () => {
  let calls = 0;
  const evaluate = () => { calls += 1; return 0; };
  for (const key of ['x', 'a', 'b']) {
    for (const value of [NaN, Infinity, -Infinity, '', '1', null, undefined, true, false, [], {}, 1n]) {
      assert.throws(() => compareForward({ x: 0, a: 1.25, b: -2, [key]: value }, evaluate));
    }
  }
  for (const input of [{ x: -20.01, a: 1, b: 0 }, { x: 60.01, a: 1, b: 0 },
    { x: 0, a: 0.49, b: 0 }, { x: 0, a: 2.01, b: 0 },
    { x: 0, a: 1, b: -10.01 }, { x: 0, a: 1, b: 10.01 }, null, undefined, {}]) {
    assert.throws(() => compareForward(input, evaluate));
  }
  assert.equal(calls, 0);
});

test('DOM decimal parsing is explicit while the domain only accepts finite numbers', () => {
  for (const value of ['', ' ', 'NaN', 'Infinity', '1x', '0x10', '1,2', null, 1]) {
    assert.throws(() => parseNumericInput(value, 'x'));
  }
  for (const [value, expected] of [['0', 0], [' -2.5 ', -2.5], ['.125', 0.125], ['1e-2', 0.01]]) {
    assert.equal(parseNumericInput(value, 'x'), expected);
  }
  assert.throws(() => validateInputs({ x: '0', a: 1, b: 0 }));
});

test('one real graph accepts repeated source updates without stale results', () => {
  const evaluate = createForwardEvaluator(Circuit);
  const first = compareForward({ x: 60, a: 2, b: 10 }, evaluate);
  const second = compareForward({ x: -20, a: 0.5, b: -10 }, evaluate);
  assert.equal(first.graph, 130);
  assert.equal(second.graph, -20);
  assert.equal(first.graph, 130);
});

test('fixed tolerance boundary and nonfinite graph failures are observable', () => {
  const input = { x: 0, a: 1, b: 0 };
  assert.equal(compareForward(input, () => 1e-5).passed, true);
  assert.equal(compareForward(input, () => 1.00001e-5).passed, false);
  for (const invalid of [NaN, Infinity, -Infinity, undefined, '0']) {
    assert.throws(() => compareForward(input, () => invalid), /有限數值/);
  }
});
