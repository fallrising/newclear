// HW-0 API probe, not the HW-1 page or HW-2 trainer. No installed dependencies.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const upstreamSHA = '257856e3b221140acb4cc4460626b850c0bd4ff1';
const coreDigest = '75da2a13f39720e34b1e440533460435ead0af9a88fccad8c94e94a816dafa21';

export async function loadCircuit(upstreamRoot) {
  if (!upstreamRoot) throw new Error('Set HANDWIRED_ROOT to the pinned upstream source directory');
  const file = resolve(upstreamRoot, 'src/runtime/numeric-ui-core.ts');
  const bytes = await readFile(file);
  if (createHash('sha256').update(bytes).digest('hex') !== coreDigest) {
    throw new Error('Upstream core SHA-256 mismatch; expected Handwired ' + upstreamSHA);
  }
  // Node 24 strips erasable TypeScript; upstream core has no runtime imports.
  return (await import(pathToFileURL(file).href)).Circuit;
}

export function probe(Circuit, x, a, b) {
  const circuit = new Circuit(3);
  const xWire = circuit.source(0);
  const aWire = circuit.source(1);
  const bWire = circuit.source(2);
  // a and b are cells, not compile-time coefficients, so backward returns them.
  const product = circuit.multiply(aWire, xWire);
  const yWire = circuit.affine([[product, 1], [bWire, 1]]);
  const source = new Float32Array([x, a, b]);
  const tensor = circuit.createTensorEvaluator([yWire])(source)[0];
  // Backward needs every wire, not the compact tensor output array.
  const values = circuit.evaluateReference(source);
  const seeds = new Float32Array(values.length);
  seeds[yWire] = 1; // dy/dy
  const gradients = circuit.backpropagateReference(values, seeds);
  return { x, a, b, js: a * x + b, tensor, reference: values[yWire],
    da: gradients[aWire], db: gradients[bWire], dx: gradients[xWire] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const Circuit = await loadCircuit(process.env.HANDWIRED_ROOT);
  const rows = [-20, -10, 0, 10, 20, 30, 40, 50, 60].map(x => probe(Circuit, x, 1.25, -2));
  console.log(JSON.stringify({ upstreamSHA, rows }, null, 2));
}
