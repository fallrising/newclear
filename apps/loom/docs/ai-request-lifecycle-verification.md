# AI cancellation and cleanup verification

Verified 2026-10-04 against the [request lifecycle specification](ai-request-lifecycle.md). Backend checks ran in Linux Docker with Rust 1.88; frontend checks ran on Linux. This maintenance task made no live provider calls and used no credentials.

## Delivered behavior

`ai_ask` admits requests before spawning execution and returning the ID. The owned registration is retained across cancellation until execution retires, rejects duplicate active IDs, and cleans up on drop or abort. Success is committed under the same lock used by cancellation before emitting Done; reusing an ID inside a completion callback cannot be undone by the older request's cleanup. Existing `AiService::run(...).await` callers remain compatible, with admission moved to future creation.

Each document effect owns its listener, event buffer and request state. Closing cancels its active request or a late returned ID. Completed requests release ownership; obsolete listeners, context preparation and late promises cannot activate a replacement effect lifetime. Explicit cancellation failures remain visible and retryable while open. Unmount cancellation catches IPC failures without touching unmounted UI; actual delivery still depends on an available IPC connection.

## Results

| Check | Result |
|---|---|
| `cargo test --locked --workspace --no-fail-fast` | 187 passed, including 10 new lifecycle regressions |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --locked -p loom-contracts --all-targets -- -D warnings` | Passed |
| Generated contract inventory | 26 TS files plus .gitkeep unchanged after tests; no extra files |
| `npm test` | 118 passed across 14 files, including 16 new lifecycle cases |
| `npm run typecheck:contracts` / `npm run typecheck:app` | Both passed |
| `npm run build` | Passed; existing large-chunk advisory remains |
| Frozen sources, fixtures, schemas, dependencies and lockfiles | Unchanged |
| `git diff --check` | Passed |

Backend regressions first failed for pre-poll cancellation and aborted-future cleanup. Independent review added a failing completion-callback cancellation/reuse case before the final repair. Tests also cover dropped admissions/unpolled futures, duplicate rejection, request isolation, configuration/HTTP errors, normal streamed text/usage and terminal cleanup.

Frontend regressions cover active and late-ID close, all three terminal kinds before and after ID return, failed cancellation, retained ownership until a terminal event, old effect lifetimes, context/listener readiness, bounded event-buffer overflow and serialized submission. The helper under test is the one used by `DocumentSurface`.

A browser smoke against the production build with mocked Tauri IPC passed five flows: active close cancels; late ID after close cancels; early completion avoids a spurious cancel; closing one of two active documents preserves the other; visible cancel failure can be retried to a cancelled terminal. Three of those assertions failed against the pre-repair build. This is frontend integration evidence, not native desktop acceptance.

## Scope and remaining acceptance

Separate model workers implemented backend and frontend changes, followed by independent review and orchestrator integration checks. README also corrects the stale blanket claim that all live providers are unverified, using the [previous Go acceptance evidence](opencode-verification.md); this task did not repeat that paid request.

Windows/macOS and full native GUI acceptance remain deferred. Provider-side computation after cancellation is outside the client's control; this repair stops local execution and drops its HTTP stream. A failed cleanup IPC call cannot be reported through an already unmounted document.
