# Document close protection verification

Date: 2026-10-04. Specification: [document-close-safety.md](document-close-safety.md), committed before implementation.

## Result

Document Close and canvas Delete/Backspace share a document-owned decision. Clean idle documents close directly; dirty or busy documents offer Save and close, Discard changes, and Cancel. Saving closes only the unchanged, clean document after its complete save acknowledgement. Errors, conflicts, newer typing and pending operations keep it open. Cancel revokes a pending close even when its write later succeeds.

Canvas retains each pending document and its incident edges. Multi-selection decisions are independent, missing guards retain documents, and registration cleanup cannot remove a replacement guard. Direct selected-edge deletion and terminal cleanup keep their existing behavior. Editor Delete/Backspace edits text without deleting its node.

## Executed checks

The orchestrator ran `npm test` (181 tests in 18 files passed), `npm run typecheck:contracts`, `npm run typecheck:app`, `npm run build` and `git diff --check`; all passed. The production build retains its existing large-chunk advisory.

A Chromium run against the actual production frontend, with mocked Tauri IPC, passed these 14 flows:

1. Clean idle Close removes only its document without writing.
2. Dirty Close focuses Cancel; Cancel preserves buffer, node and incident edge.
3. Discard removes only the chosen node and leaves file bytes unchanged.
4. Save and close persists the submitted content before removing its node.
5. A failed save keeps the prompt and buffer; explicit retry succeeds.
6. A hash conflict retains the document without a forced overwrite.
7. Typing during saving remains dirty; duplicate save requests do not duplicate writes.
8. Cancel during saving revokes close even when the write succeeds.
9. Canvas Delete preserves a dirty node and its edge pending confirmation.
10. Multi-selection Backspace supports independent Cancel/Discard decisions and preserves the shared edge until approved removal.
11. Backspace/Delete within the editor edits text without removing its selected node.
12. Active AI work disables Save and close; Discard cancels the owned AI request.
13. An ordinary save remains busy through backend metadata synchronization; failed synchronization retains the document with feedback.
14. Pending file recreation disables Save and close; Cancel keeps the document after creation completes.

Browser regressions failed on the original implementation: 11 of the initial 13 flows, plus the separately added metadata synchronization case. Clean close and editor keyboard behavior already passed. Unit regressions preceded implementation, including immediate queued-save admission. Independent review additionally checked React Flow's edge-before-node removal order, full save/create acknowledgement ownership and stale document lifetimes. Four further failing regressions reproduced old request, Discard, save initiation and save completion callbacks acting after a replacement render but before passive effect cleanup; a rendered-path ownership guard now rejects all four.

## Limits

Browser IPC is mocked; this is not native Tauri GUI or Windows/macOS acceptance. Native window quit, reload and crash recovery remain outside this feature. Discard cannot undo a filesystem write already submitted. Existing AI cancellation runs when the document unmounts.

No backend, frozen contracts, schemas, fixtures, manifests, dependencies or lockfiles changed. This slice made no live provider calls. GitHub Loom CI supplies the Rust and generated-contract compatibility gate for the delivery.
