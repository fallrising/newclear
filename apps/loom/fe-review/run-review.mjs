import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { installLoomFixture } from './preload.mjs';
import { actualDragConfiguration } from './drag-configuration.mjs';
import { runOwned, baseURL, viewports, capture, sha256 } from '../../flowshot/fe-review/browser-runtime.mjs';
import { assertRuntimeHealth } from '../../flowshot/fe-review/runtime-guards.mjs';
import { tabActivate, addDocument, addTerminal, fit, connect, separateNodes, editDocument, assertPreserved, controls } from './ui-steps.mjs';

await runOwned({
  component: fileURLToPath(new URL('../', import.meta.url)), unit: 'loom',
  sourceFiles: ['fe-review/preload.mjs', 'fe-review/preload.node.mjs', 'fe-review/run-review.mjs', 'fe-review/ui-steps.mjs', 'fe-review/drag-configuration.mjs', 'fe-review/geometry.mjs', 'fe-review/vite-review-config.mjs', 'vite.config.ts', '../flowshot/fe-review/browser-runtime.mjs', '../flowshot/fe-review/runtime-guards.mjs', 'src/ipc.ts', 'src/App.tsx', 'src/main.tsx', 'src/Terminal.tsx', 'src/surfaces/canvas/CanvasSurface.tsx', 'src/surfaces/canvas/persistence.ts', 'src/surfaces/canvas/history.ts', 'src/surfaces/canvas/window_close_ipc.ts', 'src/surfaces/document/DocumentSurface.tsx', 'src/surfaces/document/doc_ipc.ts', 'src/surfaces/document/ai_ipc.ts', 'package-lock.json'],
  async execute({ open, close, output, receipt, AxeBuilder }) {
    assert.equal(actualDragConfiguration.sourceSha256, receipt.sourceHashes['src/surfaces/canvas/CanvasSurface.tsx'], 'REVIEW_DRAG_CONFIG_SOURCE_DRIFT');
    const diagnostic = process.env.LOOM_REVIEW_DIAGNOSTIC;
    if (diagnostic && diagnostic !== 'first-populated') throw new Error('REVIEW_DIAGNOSTIC_MODE');
    if (diagnostic) receipt.diagnosticOnly = 'first-populated';
    async function start(options = {}, fixtureOptions = {}) {
      const owned = await open({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', locale: 'en-US', ...options }, installLoomFixture, fixtureOptions);
      owned.response = await owned.page.goto(`${baseURL}/`);
      await owned.page.locator('.app-header').waitFor();
      await owned.page.waitForFunction(() => window.__LOOM_REVIEW__ && window.__LOOM_REVIEW__.snapshot().counts.canvas_read > 0);
      return owned;
    }
    async function shot(owned, id) {
      const fixture = await owned.page.evaluate(() => window.__LOOM_REVIEW__.snapshot());
      assert.equal(fixture.unknownCommands, 0, 'REVIEW_UNKNOWN_COMMAND'); assert.equal(fixture.rejectedArguments, 0, 'REVIEW_ARGUMENT_REJECTION');
      const measured = await capture({ page: owned.page, output, id, response: owned.response, health: owned.health, AxeBuilder });
      receipt.captures.push({ ...measured, fixture }); assertRuntimeHealth(owned.health);
    }
    async function dispose(owned, id) {
      const beforeForcedDispose = await owned.page.evaluate(() => window.__LOOM_REVIEW__.snapshot());
      await owned.page.evaluate(() => window.__LOOM_REVIEW__.dispose());
      const afterForcedDispose = await owned.page.evaluate(() => window.__LOOM_REVIEW__.snapshot());
      assert.equal(afterForcedDispose.callbacks + afterForcedDispose.listeners + afterForcedDispose.subscriptions + afterForcedDispose.pending, 0);
      receipt.steps.push({ id: `${id}-fixture-disposal`, passed: true, beforeForcedDispose, afterForcedDispose });
      await close(owned);
    }
    const journeyOnly = process.env.LOOM_REVIEW_RESUME === 'journey-only';
    if (journeyOnly) {
      const bytes = await readFile(new URL('./runs/loom-002/capture.json', import.meta.url));
      assert.equal(sha256(bytes), '09906953c7b8ee8a9c24859bcd10fcfffecf9f2a7d2f59d746c7dc07ca1c9058', 'REVIEW_MATRIX_RECEIPT_DRIFT');
      const prior = JSON.parse(bytes);
      const keys = viewports.flatMap((viewport) => ['light', 'dark'].flatMap((scheme) => ['empty', 'populated'].map((state) => `${state}__${viewport.name}__${scheme}`))).sort();
      assert.deepEqual(prior.captures.map((item) => item.id).sort(), keys);
      for (const item of prior.captures) { assert.equal(item.status, 200); assert.equal(item.finalUrl, `${baseURL}/`); assertRuntimeHealth(item.health); }
      for (const [file, hash] of Object.entries(prior.sourceHashes)) if (file.startsWith('src/') || ['package-lock.json', 'vite.config.ts', 'fe-review/preload.mjs', '../flowshot/fe-review/runtime-guards.mjs'].includes(file)) assert.equal(receipt.sourceHashes[file], hash, 'REVIEW_MATRIX_SOURCE_DRIFT');
      receipt.matrixPrerequisite = { run: 'loom-002', sha256: sha256(bytes), uniqueCaptures: 12, rerun: false, healthAndLoadedIdentity: true };
    }
    receipt.stage = 'NETWORK_REFUSAL';
    if (process.env.LOOM_REVIEW_RESUME === 'after-canary' || journeyOnly) {
      const previousBytes = await readFile(new URL('./runs/loom-001/capture.json', import.meta.url));
      assert.equal(sha256(previousBytes), 'f542c65fbb337db0b5feb0eed08adf1de01f1bea29b38d5e24aca15eb3b59aa2', 'REVIEW_CANARY_RECEIPT_DRIFT');
      const previous = JSON.parse(previousBytes);
      const canary = previous.steps.find((item) => item.id === 'external-http-websocket-refused');
      assert.deepEqual(canary, { id: 'external-http-websocket-refused', passed: true, blockedHttp: 1, blockedWebSocket: 1 });
      assert.equal(previous.sourceHashes['fe-review/preload.mjs'], receipt.sourceHashes['fe-review/preload.mjs']);
      assert.equal(previous.sourceHashes['../flowshot/fe-review/runtime-guards.mjs'], receipt.sourceHashes['../flowshot/fe-review/runtime-guards.mjs']);
      receipt.networkPrerequisite = { run: 'loom-001', sha256: sha256(previousBytes), passed: true, rerun: false };
    } else {
      if (process.env.LOOM_REVIEW_RESUME) throw new Error('REVIEW_RESUME_MODE');
    const probe = await start();
    await probe.page.evaluate(async () => {
      await fetch('http://external.invalid/review-canary').catch(() => undefined);
      await new Promise((resolve) => { const socket = new WebSocket('ws://external.invalid/review-canary'); socket.onclose = resolve; socket.onerror = resolve; setTimeout(() => { socket.close(); resolve(); }, 1000); });
    });
    assert.equal(probe.health.blockedHttp, 1); assert.equal(probe.health.blockedWebSocket, 1);
    receipt.steps.push({ id: 'external-http-websocket-refused', passed: true, blockedHttp: 1, blockedWebSocket: 1 });
    await dispose(probe, 'network-canary');
    }
    receipt.stage = 'MATRIX';
    if (!journeyOnly) for (const viewport of viewports) for (const colorScheme of ['light', 'dark']) {
      const key = `${viewport.name}__${colorScheme}`; receipt.stage = `MATRIX_${key}`;
      const owned = await start({ viewport: { width: viewport.width, height: viewport.height }, colorScheme });
      const { page } = owned; await page.locator('.canvas-empty').waitFor();
      await shot(owned, `empty__${key}`);
      const progress = (step) => { receipt.stage = `MATRIX_${key}_${step}`; };
      const terminal = await addTerminal(page, progress), document = await addDocument(page, progress);
      progress('FIT_VIEW'); await fit(page);
      progress('EDITOR_TYPING');
      // Long existing editor content, entered through the real keyboard, stays synthetic.
      await editDocument(page, '\n' + 'Synthetic long metadata and narrow canvas content. '.repeat(12));
      receipt.steps.push({ id: `keyboard-populate-${key}`, passed: true, terminal, document });
      await shot(owned, `populated__${key}`);
      await dispose(owned, key);
      if (diagnostic) { receipt.steps.push({ id: 'first-populated-only', passed: true, remainingMatrixAndJourneys: 'not-run' }); return; }
    }
    receipt.stage = 'EDGE_RUN_PIN';
    const owned = await start(), { page } = owned;
    await page.locator('.canvas-empty').waitFor(); await addTerminal(page); await addDocument(page); await separateNodes(page, receipt);
    const doc = page.locator('.react-flow__node-document'), terminal = page.locator('.react-flow__node-terminal');
    const docId = await doc.getAttribute('data-id');
    await connect(page, doc.locator('[data-handleid="out"]'), terminal.locator('[data-handleid="in"]'), receipt);
    receipt.stage = 'EDGE_PERSISTENCE';
    await page.waitForFunction(() => window.__LOOM_REVIEW__.exportSeed().canvas?.edges.length === 1);
    receipt.edgeGeometry.persisted = await page.evaluate(() => ({ domEdges: document.querySelectorAll('.react-flow__edge').length, persistedEdges: window.__LOOM_REVIEW__.exportSeed().canvas?.edges.length, canvasWrites: window.__LOOM_REVIEW__.snapshot().counts.canvas_write }));
    const edgeIds = await page.locator('.react-flow__edge').evaluateAll((elements) => elements.map((e) => e.getAttribute('data-id')));
    const beforeRun = await page.evaluate(() => window.__LOOM_REVIEW__.snapshot().counts.pty_write_stdin ?? 0);
    assert.equal(beforeRun, 0, 'REVIEW_EDGE_MUST_NOT_RUN');
    await doc.getByRole('button', { name: '▶ run  (bash)', exact: true }).click();
    await page.waitForFunction(() => window.__LOOM_REVIEW__.snapshot().exactRunPayloads === 1);
    await doc.getByText('Synthetic command output', { exact: false }).waitFor();
    await doc.getByRole('button', { name: '📌 Pin', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('Synthetic command output'));
    await page.getByRole('button', { name: controls.zoomOut, exact: true }).click();
    await shot(owned, 'edge-run-pin');
    receipt.steps.push({ id: 'edge-run-pin', passed: true, beforeRun, exactPayloadCount: 1, edgeCount: edgeIds.length });
    receipt.stage = 'EDITOR_DELETE';
    await editDocument(page); await page.keyboard.press('Backspace'); await page.keyboard.press('Delete');
    await assertPreserved(page, docId, edgeIds);
    receipt.stage = 'CLOSE_CANCEL';
    await doc.getByRole('button', { name: 'close', exact: true }).click();
    let dialog = page.getByRole('alertdialog', { name: /Close document/ }); await dialog.waitFor();
    const cancel = await tabActivate(page, dialog.getByRole('button', { name: 'Cancel', exact: true }));
    await dialog.waitFor({ state: 'hidden' }); await assertPreserved(page, docId, edgeIds); await shot(owned, 'dirty-cancel');
    receipt.steps.push({ id: 'close-cancel-keeps-node-edges', passed: true, keyboard: cancel });
    for (const mode of ['error', 'conflict']) {
      receipt.stage = `CLOSE_SAVE_${mode}`;
      await page.evaluate((value) => window.__LOOM_REVIEW__.setWriteMode(value), mode);
      await doc.getByRole('button', { name: 'close', exact: true }).click();
      dialog = page.getByRole('alertdialog', { name: /Close document/ }); await dialog.waitFor();
      const count = await page.evaluate(() => window.__LOOM_REVIEW__.snapshot().counts.doc_write ?? 0);
      await dialog.getByRole('button', { name: 'Save and close', exact: true }).click();
      await page.waitForFunction((previous) => (window.__LOOM_REVIEW__.snapshot().counts.doc_write ?? 0) > previous, count);
      await dialog.getByRole('button', { name: 'Save and close', exact: true }).waitFor();
      await page.waitForFunction(() => { const button = document.querySelector('[role="alertdialog"] button[aria-busy]'); return button !== null && button.getAttribute('aria-busy') === 'false' && button.disabled === false; });
      await assertPreserved(page, docId, edgeIds); assert.equal(await dialog.count(), 1); await shot(owned, `close-save-${mode}`);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      if (mode === 'conflict') await doc.getByRole('button', { name: 'Keep editing', exact: true }).click();
    }
    receipt.stage = 'WINDOW_CANCEL';
    await page.evaluate(() => window.__LOOM_REVIEW__.emit('loom:window-close-requested', null));
    const windowDialog = page.getByRole('dialog', { name: 'Close Loom?', exact: true }); await windowDialog.waitFor();
    await tabActivate(page, windowDialog.getByRole('button', { name: 'Cancel', exact: true }));
    await windowDialog.waitFor({ state: 'hidden' }); await assertPreserved(page, docId, edgeIds);
    assert.equal(await page.evaluate(() => window.__LOOM_REVIEW__.snapshot().closeApproved), 0);
    receipt.stage = 'SAVE_RELOAD';
    await page.evaluate(() => window.__LOOM_REVIEW__.setWriteMode('normal'));
    await doc.getByRole('button', { name: 'save', exact: true }).click(); await page.locator('.document-dirty').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__LOOM_REVIEW__.exportSeed().canvas?.edges.length === 1);
    const seed = await page.evaluate(() => window.__LOOM_REVIEW__.exportSeed());
    receipt.steps.push({ id: 'explicit-sidecar-export', passed: true, nodeIds: seed.canvas.nodes.map((n) => n.id), edgeIds: seed.canvas.edges.map((e) => e.id), terminalPersistedAsTombstone: seed.canvas.nodes.some((n) => n.kind.type === 'tombstone') });
    const reloaded = await start({}, { seed }); await reloaded.page.locator('.react-flow__node-document .cm-content').waitFor();
    await reloaded.page.locator('.react-flow__node-tombstone').waitFor(); await fit(reloaded.page);
    assert.deepEqual((await reloaded.page.locator('.react-flow__node').evaluateAll((items) => items.map((e) => e.getAttribute('data-id')))).sort(), seed.canvas.nodes.map((n) => n.id).sort());
    assert.equal(await reloaded.page.locator('.react-flow__edge').count(), 1);
    const resetCounts = await reloaded.page.evaluate(() => window.__LOOM_REVIEW__.snapshot().counts);
    assert.equal(resetCounts.pty_spawn ?? 0, 0); assert.equal(resetCounts.session_restart ?? 0, 0); assert.equal(resetCounts.pty_write_stdin ?? 0, 0);
    await shot(reloaded, 'sidecar-reloaded'); await dispose(reloaded, 'sidecar');
    receipt.stage = 'DISCARD_AND_CLEANUP';
    await editDocument(page); await doc.getByRole('button', { name: 'close', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes', exact: true }).click();
    await doc.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__LOOM_REVIEW__.snapshot().openDocuments === 0 && window.__LOOM_REVIEW__.snapshot().closedDocuments > 0);
    assert.equal(await page.locator('.react-flow__edge').count(), 0);
    await terminal.getByRole('button', { name: 'close', exact: true }).click(); await terminal.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__LOOM_REVIEW__.snapshot().subscriptions === 0 && window.__LOOM_REVIEW__.snapshot().detached > 0);
    receipt.steps.push({ id: 'actual-node-disposal', passed: true, fixture: await page.evaluate(() => window.__LOOM_REVIEW__.snapshot()) });
    await dispose(owned, 'focused-lifecycle');
    for (const history of ['loading', 'error', 'empty', 'memory']) {
      receipt.stage = `HISTORY_${history}`;
      const item = await start({}, { history }); const p = item.page;
      await p.getByRole('button', { name: /^Session history/ }).click();
      if (history === 'loading') await p.getByText('Loading history…', { exact: true }).waitFor();
      if (history === 'error') await p.getByRole('alert').filter({ hasText: 'Session history could not be read' }).waitFor();
      if (history === 'empty') await p.getByText('No session history yet.', { exact: true }).waitFor();
      if (history === 'memory') await p.getByText('History will not survive app restart.', { exact: false }).waitFor();
      const initial = await p.evaluate(() => window.__LOOM_REVIEW__.snapshot().counts);
      assert.equal(initial.session_restart ?? 0, 0); assert.equal(initial.pty_write_stdin ?? 0, 0);
      await shot(item, `history-${history}`);
      if (history === 'memory') {
        await p.getByRole('button', { name: 'Restart', exact: true }).click();
        await p.locator('.react-flow__node-terminal .xterm').waitFor();
        await p.getByRole('button', { name: 'Forget history', exact: true }).click();
        await p.waitForFunction(() => window.__LOOM_REVIEW__.snapshot().counts.session_forget === 1);
        assert.equal(await p.locator('.react-flow__node-terminal').count(), 1);
        receipt.steps.push({ id: 'explicit-history-restart-forget', passed: true, counts: await p.evaluate(() => window.__LOOM_REVIEW__.snapshot().counts) });
      }
      if (history === 'loading') await p.evaluate(() => window.__LOOM_REVIEW__.setHistoryMode('empty'));
      await dispose(item, `history-${history}`);
    }
    receipt.steps.push({ id: 'approved-synthetic-ui-scenarios', passed: true });
  },
});
