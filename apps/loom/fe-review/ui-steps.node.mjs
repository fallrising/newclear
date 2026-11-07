import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultAriaLabelConfig } from '@xyflow/system';
import { controls, fit, separateNodes } from './ui-steps.mjs';
import { actualDragConfiguration, parseDragConfiguration } from './drag-configuration.mjs';
const source = readFileSync(new URL('../src/surfaces/canvas/CanvasSurface.tsx', import.meta.url), 'utf8');
test('review locators use locked React Flow accessible control names', async () => {
  assert.equal(controls.fit, 'Fit View'); assert.equal(controls.zoomOut, 'Zoom Out');
  let clicked = false;
  await fit({ getByRole(role, options) { assert.equal(role, 'button'); assert.deepEqual(options, { name: defaultAriaLabelConfig['controls.fitView.ariaLabel'], exact: true }); return { async click() { clicked = true; } }; } });
  assert.equal(clicked, true);
});
test('configuration uses actual component override and hashes that exact source', () => {
  assert.equal(actualDragConfiguration.threshold, 4);
  assert.deepEqual(parseDragConfiguration(source), actualDragConfiguration);
  const larger = parseDragConfiguration(source.replace('nodeDragThreshold={4}', 'nodeDragThreshold={8}'));
  assert.equal(larger.threshold, 8); assert.notEqual(larger.sourceSha256, actualDragConfiguration.sourceSha256);
});
test('import association rejects other components and accepts the actual imported alias', () => {
  assert.throws(() => parseDragConfiguration('const view = <ReactFlow nodeDragThreshold={4}/>;'), /REVIEW_DRAG_CONFIG_IMPORT/);
  assert.throws(() => parseDragConfiguration("import { ReactFlow } from 'another-package'; const view = <ReactFlow nodeDragThreshold={4}/>;"), /REVIEW_DRAG_CONFIG_IMPORT/);
  assert.throws(() => parseDragConfiguration("import type { ReactFlow } from '@xyflow/react'; const view = <ReactFlow nodeDragThreshold={4}/>;"), /REVIEW_DRAG_CONFIG_IMPORT/);
  assert.equal(parseDragConfiguration("import { ReactFlow as Canvas } from '@xyflow/react'; const view = <Canvas nodeDragThreshold={4}/>;").threshold, 4);
});
test('ambiguous, missing, dynamic and out-of-range configuration is refused', () => {
  for (const invalid of ['<ReactFlow />', '<Other nodeDragThreshold={4} />', '<><ReactFlow nodeDragThreshold={4}/><ReactFlow nodeDragThreshold={4}/></>', '<ReactFlow nodeDragThreshold={4} nodeDragThreshold={5}/>', '<ReactFlow nodeDragThreshold={value}/>', '<ReactFlow nodeDragThreshold="4"/>', '<ReactFlow nodeDragThreshold={4} {...props}/>', ...[0,17,1.5,-1].map((v)=>`<ReactFlow nodeDragThreshold={${v}}/>`)]) {
    assert.throws(() => parseDragConfiguration("import { ReactFlow } from '@xyflow/react'; const view = " + invalid), /REVIEW_DRAG_CONFIG_/);
  }
});
// External input contract models the locked XYDrag threshold-consuming first event.
function thresholdDragPage({ threshold = actualDragConfiguration.threshold, fault, shiftAfterActivation = false } = {}) {
  let docX = 140, nodeX = 60, pointerX = 0, pressX = 0, anchorX = 0;
  let pressed = false, active = false, evaluations = 0, fits = 0, released = 0;
  return {
    async evaluate() {
      evaluations++;
      if (shiftAfterActivation && evaluations === 2) { docX += 20; nodeX += 8; }
      const witness = evaluations === 3;
      return { stable: !(fault === 'unstable' && pressed), last: {
        transform: witness && fault === 'viewport' ? 'changed' : 'scale(1)',
        document: { x: docX + (witness && fault === 'document' ? 1 : 0), y: 181, width: 560, height: 420 },
        terminal: { x: nodeX, y: 101, width: 640, height: witness && fault === 'shape' ? 361 : 360 },
        source: { centerHit: nodeX > docX + 560 }, target: { centerHit: true },
      } };
    },
    locator() { return { async boundingBox() { return { x: nodeX + 20, y: 100, width: 100, height: 20 }; } }; },
    mouse: {
      async move(x, _y, { steps = 1 } = {}) {
        const from = pointerX;
        for (let i = 1; i <= steps; i++) {
          const next = from + (x - from) * i / steps;
          if (pressed) {
            if (!active && Math.abs(next - pressX) > threshold) { active = true; anchorX = next; }
            if (active) { if (fault !== 'no-movement') nodeX += next - anchorX; anchorX = next; }
          }
          pointerX = next;
        }
      },
      async down() { pressed = true; pressX = pointerX; active = false; },
      async up() { pressed = false; released++; },
    },
    getByRole() { return { async click() { fits++; } }; },
    result() { return { gap: nodeX - docX - 560, evaluations, fits, released, pressed }; },
  };
}
for (const threshold of [actualDragConfiguration.threshold, 8]) test(`source-derived ${threshold}px threshold gets a real1px witness and full measured gap`, async () => {
  const configuration = parseDragConfiguration(source.replace('nodeDragThreshold={4}', `nodeDragThreshold={${threshold}}`));
  const page = thresholdDragPage({ threshold }), receipt = {};
  await separateNodes(page, receipt, configuration);
  assert.equal(page.result().gap, 48); assert.equal(page.result().released, 1); assert.equal(page.result().fits, 1);
  assert.equal(receipt.nodeSeparation.activation.witnessDelta, 1);
  assert.equal(receipt.nodeSeparation.activation.pixels, threshold + 1);
});
test('remaining distance uses witnessed geometry rather than pre-activation boxes', async () => {
  const page = thresholdDragPage({ shiftAfterActivation: true });
  await separateNodes(page, {});
  assert.equal(page.result().gap, 48); assert.equal(page.result().evaluations, 4);
});
for (const [fault, error] of [['unstable','GEOMETRY_UNSTABLE'], ['no-movement','DRAG_WITNESS_TRANSLATION'], ['document','DRAG_WITNESS_DOCUMENT'], ['viewport','DRAG_WITNESS_VIEWPORT'], ['shape','DRAG_WITNESS_SHAPE']]) test(`${fault} cannot qualify activation and always releases pointer`, async () => {
  const page = thresholdDragPage({ fault });
  await assert.rejects(separateNodes(page, {}), new RegExp(`REVIEW_${error}`));
  assert.equal(page.result().released, 1); assert.equal(page.result().fits, 0); assert.equal(page.result().pressed, false);
});
