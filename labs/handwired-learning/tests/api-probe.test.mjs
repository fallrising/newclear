import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadCircuit, probe } from '../examples/api-probe.mjs';

const upstream = process.env.HANDWIRED_ROOT;
assert.ok(upstream, 'Set HANDWIRED_ROOT to the pinned upstream source directory');
const Circuit = await loadCircuit(upstream);
const close = (actual, expected, absolute = 1e-5, relative = 1e-5) => {
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected),
    `${actual} differs from ${expected}`);
};

test('CPU tensor and reference evaluate all nine calibration points', () => {
  for (const x of [-20, -10, 0, 10, 20, 30, 40, 50, 60, 1.234567]) {
    const result = probe(Circuit, x, 1.25, -2);
    close(result.tensor, 1.25 * x - 2);
    close(result.reference, 1.25 * x - 2);
  }
});

test('upstream backward produces parameter derivatives, including negative and zero x', () => {
  for (const [x, a, b] of [[-20, 1.25, -2], [0, 1, 0], [60, 2, 10], [1.234567, 0.73, -1.4]]) {
    const result = probe(Circuit, x, a, b);
    close(result.da, x, 1e-4, 1e-4);
    close(result.db, 1, 1e-4, 1e-4);
    close(result.dx, a, 1e-4, 1e-4);
  }
});

test('parameters are source cells and remain adjustable without rebuilding the graph', () => {
  const circuit = new Circuit(3);
  const x = circuit.source(0), a = circuit.source(1), b = circuit.source(2);
  const y = circuit.affine([[circuit.multiply(a, x), 1], [b, 1]]);
  const evaluate = circuit.createTensorEvaluator([y]);
  assert.equal(evaluate(new Float32Array([10, 1.25, -2]))[0], 10.5);
  assert.equal(evaluate(new Float32Array([10, 0.5, 3]))[0], 8);
});

test('boolean backward rejects by default rather than silently inventing a derivative', () => {
  const circuit = new Circuit(1);
  const input = circuit.source(0);
  circuit.assumeRange(input, 0, 1);
  const output = circuit.boolean(input);
  const values = circuit.evaluateReference(new Float32Array([1]));
  const seeds = new Float32Array(values.length);
  seeds[output] = 1;
  assert.throws(() => circuit.backpropagateReference(values, seeds), /boolean atom/);
});

test('loader rejects drift before importing upstream code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'handwired-pin-'));
  try {
    await mkdir(join(root, 'src/runtime'), { recursive: true });
    const source = await readFile(join(upstream, 'src/runtime/numeric-ui-core.ts'), 'utf8');
    await writeFile(join(root, 'src/runtime/numeric-ui-core.ts'), source + '\n// drift\n');
    await assert.rejects(loadCircuit(root), /SHA-256 mismatch/);
  } finally {
    await rm(root, { recursive: true });
  }
});
