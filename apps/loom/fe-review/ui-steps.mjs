import assert from 'node:assert/strict';
import { observeStableHandles } from './geometry.mjs';
import { actualDragConfiguration } from './drag-configuration.mjs';
import { defaultAriaLabelConfig } from '@xyflow/system';
export const controls = { fit: defaultAriaLabelConfig['controls.fitView.ariaLabel'], zoomOut: defaultAriaLabelConfig['controls.zoomOut.ariaLabel'] };
/** Real bounded keyboard traversal. No HTMLElement.focus / programmatic action. */
export async function tabActivate(page, target) {
  await target.waitFor({ state: 'visible' });
  let reached = false, tabs = 0;
  for (; tabs < 100; tabs++) {
    if (await target.evaluate((element) => element === document.activeElement)) { reached = true; break; }
    await page.keyboard.press('Tab');
  }
  assert.equal(reached, true, 'REVIEW_KEYBOARD_TARGET');
  const focus = await target.evaluate((element) => ({ active: element === document.activeElement, focusVisible: element.matches(':focus-visible'), outlineStyle: getComputedStyle(element).outlineStyle, outlineWidth: getComputedStyle(element).outlineWidth }));
  await page.keyboard.press('Enter');
  return { tabs, ...focus };
}
export async function addDocument(page, progress = () => {}) {
  progress('DOCUMENT_TAB');
  const activation = await tabActivate(page, page.getByRole('button', { name: '+ document', exact: true }));
  progress('DOCUMENT_PROMPT');
  const input = page.locator('.open-doc-prompt input');
  await input.waitFor(); assert.equal(await input.evaluate((element) => element === document.activeElement), true, 'REVIEW_PROMPT_FOCUS');
  await page.keyboard.press('Control+A'); await page.keyboard.type('notes.md'); await page.keyboard.press('Enter');
  progress('DOCUMENT_EDITOR');
  await page.locator('.react-flow__node-document .cm-content').waitFor();
  progress('DOCUMENT_REGISTERED');
  await page.waitForFunction(() => window.__LOOM_REVIEW__.snapshot().openDocuments === 1);
  return activation;
}
export async function addTerminal(page, progress = () => {}) {
  progress('TERMINAL_TAB');
  const activation = await tabActivate(page, page.getByRole('button', { name: '+ terminal', exact: true }));
  progress('TERMINAL_NODE');
  await page.locator('.react-flow__node-terminal .xterm').waitFor();
  progress('TERMINAL_SUBSCRIPTION');
  await page.waitForFunction(() => window.__LOOM_REVIEW__.snapshot().subscriptions === 1);
  return activation;
}
export async function fit(page) { await page.getByRole('button', { name: controls.fit, exact: true }).click(); }
export async function connect(page, from, to, receipt) {
  const observed = await page.evaluate(observeStableHandles);
  if (receipt) receipt.edgeGeometry = { before: observed };
  assert.equal(observed.stable, true, 'REVIEW_GEOMETRY_UNSTABLE');
  assert.equal(observed.last.source.centerHit, true, 'REVIEW_SOURCE_HANDLE_OCCLUDED');
  assert.equal(observed.last.target.centerHit, true, 'REVIEW_TARGET_HANDLE_OCCLUDED');
  // Use the same stable sample that proved hit testing, not independently timed boxes.
  const source = observed.last.source.box, target = observed.last.target.box;
  assert.ok(source && target, 'REVIEW_HANDLE_BOUNDS');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
  if (receipt) receipt.edgeGeometry.afterDrag = await page.evaluate(observeStableHandles);
}
export async function separateNodes(page, receipt, configuration = actualDragConfiguration) {
  assert.ok(Number.isInteger(configuration.threshold) && configuration.threshold >= 1 && configuration.threshold <= 16, 'REVIEW_DRAG_CONFIG_RANGE');
  const before = await page.evaluate(observeStableHandles);
  if (receipt) receipt.nodeSeparation = { before, configuration };
  assert.equal(before.stable, true, 'REVIEW_GEOMETRY_UNSTABLE');
  const doc = before.last.document, terminal = before.last.terminal;
  assert.ok(doc && terminal, 'REVIEW_NODE_BOUNDS');
  // Screen-space displacement from actual nodes, preserving 48 CSS px before fit.
  const screenDelta = Math.max(0, doc.x + doc.width + 48 - terminal.x);
  if (receipt) receipt.nodeSeparation.screenDelta = screenDelta;
  if (screenDelta > 0) {
    const header = page.locator('.react-flow__node-terminal .loom-canvas-node-header strong');
    const bounds = await header.boundingBox(); assert.ok(bounds, 'REVIEW_NODE_BOUNDS');
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    try {
      // The component override is parsed from actual source, never a library default.
      // The first threshold-crossing event anchors XYDrag; the next 1px must
      // produce visible node translation before spending the remaining gap.
      const activationPixels = configuration.threshold + 1, activationX = x + activationPixels;
      await page.mouse.move(activationX, y);
      const activated = await page.evaluate(observeStableHandles);
      if (receipt) receipt.nodeSeparation.activated = activated;
      assert.equal(activated.stable, true, 'REVIEW_GEOMETRY_UNSTABLE');
      assert.ok(activated.last.document && activated.last.terminal, 'REVIEW_NODE_BOUNDS');
      const witnessX = activationX + 1;
      await page.mouse.move(witnessX, y);
      const witnessed = await page.evaluate(observeStableHandles);
      if (receipt) receipt.nodeSeparation.witnessed = witnessed;
      assert.equal(witnessed.stable, true, 'REVIEW_GEOMETRY_UNSTABLE');
      assert.ok(witnessed.last.document && witnessed.last.terminal, 'REVIEW_NODE_BOUNDS');
      assert.deepEqual(witnessed.last.document, activated.last.document, 'REVIEW_DRAG_WITNESS_DOCUMENT');
      assert.equal(witnessed.last.transform, activated.last.transform, 'REVIEW_DRAG_WITNESS_VIEWPORT');
      const a = activated.last.terminal, b = witnessed.last.terminal;
      assert.deepEqual({ y: b.y, width: b.width, height: b.height }, { y: a.y, width: a.width, height: a.height }, 'REVIEW_DRAG_WITNESS_SHAPE');
      const witnessDelta = b.x - a.x;
      assert.ok(witnessDelta >= 0.75 && witnessDelta <= 1.25, 'REVIEW_DRAG_WITNESS_TRANSLATION');
      const remainingDelta = Math.max(0, witnessed.last.document.x + witnessed.last.document.width + 48 - b.x);
      if (receipt) receipt.nodeSeparation.activation = { pixels: activationPixels, witnessPixels: 1, witnessDelta, remainingDelta };
      await page.mouse.move(witnessX + remainingDelta, y, { steps: 12 });
    } finally {
      await page.mouse.up();
    }
  }
  await fit(page);
  const after = await page.evaluate(observeStableHandles);
  if (receipt) receipt.nodeSeparation.after = after;
  assert.equal(after.stable, true, 'REVIEW_GEOMETRY_UNSTABLE');
  assert.ok(after.last.terminal.x > after.last.document.x + after.last.document.width, 'REVIEW_NODE_SEPARATION');
  assert.equal(after.last.source.centerHit, true, 'REVIEW_SOURCE_HANDLE_OCCLUDED');
  assert.equal(after.last.target.centerHit, true, 'REVIEW_TARGET_HANDLE_OCCLUDED');
}
export async function editDocument(page, text = '\nSynthetic keyboard edit') {
  const editor = page.locator('.react-flow__node-document .cm-content');
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(text);
  await page.locator('.document-dirty').waitFor();
  await page.waitForFunction(() => window.__LOOM_REVIEW__.snapshot().dirtyDocuments === 1);
}
export async function assertPreserved(page, id, edgeIds) {
  assert.equal(await page.locator('.react-flow__node-document').getAttribute('data-id'), id, 'REVIEW_DOCUMENT_PRESERVED');
  assert.deepEqual((await page.locator('.react-flow__edge').evaluateAll((elements) => elements.map((e) => e.getAttribute('data-id')))).sort(), [...edgeIds].sort(), 'REVIEW_EDGES_PRESERVED');
  assert.equal(await page.locator('.document-dirty').count(), 1, 'REVIEW_DIRTY_PRESERVED');
}
