# Unsaved document close protection

Status: implemented, 2026-10-04. This specification was committed before implementation; see [verification](document-close-safety-verification.md).

## Scope and behavior

Previously, the document Close button and canvas Delete/Backspace node removal destroyed an editor without checking unsaved changes. SQLite history does not store those buffers. This repair protects document-node removal; native application/window quit, browser reload and crash recovery are separate work and must not be claimed as covered.

- Clean idle documents close directly. Dirty documents show an inline accessible confirmation with **Save and close**, **Discard changes**, and **Cancel**. Repeated close/delete requests do not stack prompts or duplicate writes. Closing the prompt does not change the buffer, node, connected edges, or `run_in` mapping.
- Save and close uses the existing serialized optimistic save operation, including its hash/Keep rules. Remove the node only when save succeeded and the same document lifetime is still current, no newer edits occurred during the action, the current buffer is clean, and no creation/save/AI operation is pending. Any I/O failure, conflict, missing target, or newer edit keeps the document and shows persistent feedback. Do not silently overwrite or recreate a missing file to close it.
- A close requested while document creation, saving, or AI work is pending must preserve the node and offer Cancel or explicit Discard. Save and close remains unavailable until the operation permits a normal save. Discard explicitly removes that document and triggers existing cleanup; already submitted filesystem writes cannot be undone by close. Cancel during a pending Save and close revokes the close intent, even if its write later succeeds.
- Discard removes only the chosen document node and its incident edges/routing, never its file. Existing AI cancellation on unmount remains intact. Other dirty documents, terminals and their sessions remain unaffected unless independently selected for deletion.
- Canvas keyboard deletion and Close share the document's decision handler. Canvas cannot remove a document before its handler is registered or while confirmation is pending. Replacing/unregistering a handler must be ownership-safe: an old cleanup cannot remove a newer registration for the same node.
- Multi-selection deletion requests each selected document independently. A refused/pending close preserves that document's edges, including when React Flow also emits edge-removal changes in the same deletion gesture. Confirmed removal performs cleanup once. Terminal/tombstone deletion keeps its existing behavior.
- Backspace/Delete inside the document editor or prompt controls is text/control interaction, not canvas node removal. Direct deletion of an independently selected edge remains supported.
- Close intent belongs to a mounted document lifetime. Unmount/path replacement, Cancel, or a superseding decision prevents old asynchronous save completion from closing a different document. Read the latest buffer state instead of stale React closures.

## Integration contract

Add an optional `registerCloseGuard?: (requestClose: () => void) => () => void` prop to `DocumentSurface` and to runtime `DocumentNodeData`. Canvas provides a registration function tied to each hydrated/new document node ID; `DocumentNode` forwards it. The surface registers its close-request handler and unregisters on lifetime cleanup. The existing `onClose` callback represents **approved** removal and must bypass the request guard to avoid recursion. Its Close button invokes the same registered request handler rather than calling `onClose` directly.

Canvas owns the registry and routes external node removal through it. Missing document registrations fail closed (retain node). Registry callbacks and confirmation state are runtime-only; preserve the frozen sidecar schema. No backend, dependency or contract changes are required.

## Verification and delivery

Write failing regressions before implementation. Cover clean/dirty close, Cancel, Discard, save success, I/O/conflict/missing failure, typing while saving, duplicate requests, Cancel while saving, busy create/AI work, stale lifetimes/registration cleanup, per-document multi-selection and incident-edge preservation, and editor Delete/Backspace behavior.

Run the full frontend suite, both typechecks, production build and diff checks. Exercise the actual built document/canvas UI in Chromium with mocked IPC, including keyboard deletion; unit tests alone are insufficient for the node/edge interaction. GitHub Loom CI verifies Rust/contract compatibility. Report mocked browser evidence separately from native GUI/cross-platform acceptance. Use independent review and staged documentation/implementation PRs.
