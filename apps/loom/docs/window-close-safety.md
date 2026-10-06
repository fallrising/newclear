# Native window close protection

Status: specification before implementation, 2026-10-05.

## Scope

The existing document-node guard does not intercept closing the native application window. Normal window-manager close must protect all open document buffers. This repair covers the main window's ordinary close request, not OS force-kill, browser reload, crashes or guaranteed shutdown during logout. Existing PTY shutdown on application exit remains intact.

## Decisions

- Intercept native close before destroying the window, including before frontend listeners or document participants are ready. An unready or failed listener must not silently permit close. Repeated requests share one decision.
- Once canvas hydration and every document participant are ready, a clean idle workspace may close directly. Otherwise show one accessible window-level prompt: **Save all and exit**, **Discard and exit**, **Cancel**. The prompt must not remove any document node, incident edge or runtime routing.
- Cancel dismisses the prompt and revokes the pending exit intent, including during saving. Already submitted writes cannot be undone. Explicit Discard permits exit without extra document writes; pending native writes cannot be reversed.
- Save all uses each dirty document's existing optimistic serialized save. Never silently recreate missing files or bypass a conflict. Pending create/save/AI work or unready participants cannot be treated as saveable. A failure must remain visible and retryable.
- Exit after Save all only if every original participant is still current, membership has not changed, all relevant revisions are unchanged since submission, every participant is clean and idle, and all saves have completed including metadata acknowledgements. Changes to a document already saved while another save is pending must prevent exit. Independent documents may already have saved when a later one fails; retain all nodes and report failure.
- Old callbacks, replacement/unmounted participants, duplicate save clicks and cancelled/superseded attempts must not exit. Registration cleanup is identity-owned. Save all does not reuse document-node removal callbacks.
- Immediately before the approved native close dispatch, prevent further workspace editing/actions until success or visible failure. A failed close returns control to the user. The final approved dispatch is the commit point; Cancel is available while saving but is not promised to undo a dispatched native destruction.
- Existing per-document close, keyboard deletion, AI cancellation and terminal/session shutdown remain supported. Do not claim that window close provides unsaved buffer recovery.

## Integration contract

Add optional `registerWindowCloseParticipant?: (participant: WindowCloseParticipant) => () => void` to DocumentSurface and DocumentNode data. Define the nonfrozen frontend interface in `src/surfaces/document/window_participant.ts`:

- `snapshot(): { revision: string; dirty: boolean; busy: boolean; canSave: boolean } | null`; null means stale/unready. The revision identifies the current document lifetime, reload revision and editor version. Busy spans full save/create acknowledgements and active AI work.
- `save(): Promise<boolean>`; invokes the ordinary document save without removal and rejects stale lifetime use.

Canvas owns expected document IDs, participant registrations and one window-close coordinator. Native plumbing emits `loom:window-close-requested` after preventing default native closure. A nonfrozen `window_close_approved` command destroys only the calling main window after frontend approval. Frontend listener failure is visible. Do not change frozen contracts or storage schemas.

## Verification

Use failing regressions for the decision controller, actual document/canvas wiring and native interception boundary. Cover clean close, dirty Cancel/Discard/Save all, partial save failure/conflict/missing, edits during saves, busy AI/create/save, listener/registration races, added/removed participants, duplicate requests, cancelled save completion, and native close failure. Run frontend tests, both typechecks, build, Rust workspace tests/fmt/clippy and contract-drift checks. Independently review integrated changes.

Exercise the built frontend with mocked IPC separately from a real Linux Tauri window under Docker/Xvfb where available. Follow official Tauri test guidance for native WebDriver/OS requirements; Linux Docker does not prove Windows WebView2 or macOS WKWebView behavior. Record exact native tests and any unavailable platforms, and document the remaining prioritized development/acceptance gaps without implementing extra stages. No new runtime dependencies or paid provider calls. Deliver specification then implementation PRs; stop after CI and Desk review publication.
