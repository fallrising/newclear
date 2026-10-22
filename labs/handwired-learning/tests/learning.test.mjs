import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCircuit } from '../examples/api-probe.mjs';
import * as learning from '../web/forward.mjs';

const Circuit = await loadCircuit(process.env.HANDWIRED_ROOT);
const points = [-20, -10, 0, 10, 20, 30, 40, 50, 60];
const close = (actual, expected) => assert.ok(Number.isFinite(actual)
  && Math.abs(actual - expected) <= 1e-4 + 1e-4 * Math.abs(expected), `${actual} vs ${expected}`);

test('HW-A03: real fixed CPU loss/backward matches independent analytic gradients', () => {
  const evaluate = learning.createLearningEvaluator(Circuit);
  for (const [alpha, b] of [[40, 0], [50, -2], [20, -10], [80, 10], [31.2345, -3.4567]]) {
    const errors = points.map(x => alpha * (x / 40) + b - (1.25 * x - 2));
    const metrics = evaluate({ alpha, b });
    close(metrics.loss, errors.reduce((sum, error) => sum + error * error, 0) / 9);
    close(metrics.dAlpha, errors.reduce((sum, error, i) => sum + 2 * error * points[i] / 40, 0) / 9);
    close(metrics.dB, errors.reduce((sum, error) => sum + 2 * error, 0) / 9);
    close(metrics.maxError, Math.max(...errors.map(Math.abs)));
  }
});

test('HW-A04: immutable single-step and run-to-500 converge with fixed 0.05', () => {
  const evaluate = learning.createLearningEvaluator(Circuit);
  const initial = learning.startLearning(evaluate);
  assert.deepEqual([initial.step, initial.alpha, initial.a, initial.b, initial.status], [0, 40, 1, 0, 'ready']);
  assert.ok(Object.isFrozen(initial));
  assert.equal(initial.history.length, 1);
  const first = learning.stepLearning(initial, evaluate);
  assert.equal(first.step, 1);
  assert.equal(first.alpha, initial.alpha - 0.05 * initial.dAlpha);
  assert.equal(first.b, initial.b - 0.05 * initial.dB);
  assert.equal(initial.step, 0);
  const final = learning.runLearning(first, evaluate);
  assert.equal(final.step, 500);
  assert.equal(final.status, 'complete');
  assert.equal(final.history.length, 501);
  assert.ok(Object.isFrozen(final.history));
  assert.ok(final.history.every(Object.isFrozen));
  assert.deepEqual(final.history.map(row => row.step), Array.from({ length: 501 }, (_, i) => i));
  assert.ok(final.maxError <= 0.05, JSON.stringify(final));
  const forward = learning.createForwardEvaluator(Circuit);
  for (const x of points) assert.ok(Math.abs(forward({ x, a: final.a, b: final.b }) - (1.25 * x - 2)) <= 0.05);
  assert.strictEqual(learning.runLearning(final, evaluate), final);
  assert.strictEqual(learning.stepLearning(final, evaluate), final);
  let repeated = learning.startLearning(evaluate);
  for (let i = 0; i < 500; i++) repeated = learning.stepLearning(repeated, evaluate);
  assert.deepEqual(repeated, final);
});

test('HW-A05: learning rate 2 genuinely proposes an out-of-bounds coefficient and stops', () => {
  const evaluate = learning.createLearningEvaluator(Circuit);
  const initial = learning.startLearning(evaluate);
  const attemptedA = (initial.alpha - 2 * initial.dAlpha) / 40;
  const attemptedB = initial.b - 2 * initial.dB;
  assert.ok(attemptedA < 0.5 || attemptedA > 2 || attemptedB < -10 || attemptedB > 10);
  const stopped = learning.stepLearning(initial, evaluate, 2);
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual([stopped.step, stopped.a, stopped.b], [0, 1, 0]);
  assert.ok(stopped.reason.includes(String(attemptedA)));
  assert.ok(stopped.reason.includes(String(attemptedB)));
  assert.strictEqual(learning.stepLearning(stopped, evaluate), stopped);
  assert.strictEqual(learning.runLearning(stopped, evaluate), stopped);
  assert.deepEqual(learning.startLearning(evaluate), initial);
  assert.equal(learning.startLearning(evaluate).history.length, 1);
});

test('nonfinite boundary metrics stop without zero replacement or stale success', () => {
  const real = learning.createLearningEvaluator(Circuit);
  const initial = learning.startLearning(real);
  for (const key of ['loss', 'dAlpha', 'dB', 'maxError']) {
    for (const value of [NaN, Infinity, -Infinity, '0', undefined]) {
      const bad = () => ({ ...real({ alpha: 40, b: 0 }), [key]: value });
      const stopped = learning.startLearning(bad);
      assert.equal(stopped.status, 'stopped');
      assert.match(stopped.reason, /有限數值/);
      assert.equal(stopped.loss, null);
      const after = learning.stepLearning(initial, bad);
      assert.equal(after.status, 'stopped');
      assert.deepEqual([after.step, after.a, after.b], [0, 1, 0]);
      assert.equal(after.loss, null);
    }
  }
  const huge = () => ({ loss: 1, dAlpha: Number.MAX_VALUE, dB: Number.MAX_VALUE, maxError: 1 });
  const stopped = learning.stepLearning(learning.startLearning(huge), huge, 2);
  assert.equal(stopped.status, 'stopped');
  assert.match(stopped.reason, /Infinity/);
  assert.deepEqual(learning.startLearning(real), initial);
});

test('learning evaluator rejects illegal coefficient types and bounds before executing', () => {
  const evaluate = learning.createLearningEvaluator(Circuit);
  for (const alpha of ['40', NaN, Infinity, null, 19.99, 80.01]) assert.throws(() => evaluate({ alpha, b: 0 }));
  for (const b of ['0', NaN, Infinity, null, -10.01, 10.01]) assert.throws(() => evaluate({ alpha: 40, b }));
  const initial = learning.startLearning(evaluate);
  for (const rate of [NaN, Infinity, '0.05', -1, 0, 0.1]) assert.throws(() => learning.stepLearning(initial, evaluate, rate));
});
