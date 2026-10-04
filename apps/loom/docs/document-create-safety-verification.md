# Missing document creation verification

Date: 2026-10-04. Specification: [document-create-safety.md](document-create-safety.md), committed before implementation. This is a maintenance repair of the existing missing-file action.

## Result

Missing-file creation now uses the nonfrozen `doc_create` command and an atomic no-replace filesystem publication. A file that appears after the missing banner is preserved. Creation acknowledges its submitted bytes/hash directly; no extra read can adopt unrelated external content as the saved version.

The document retains unsaved edits on failure and offers visible retry or explicit reload. Creation and reload cannot overlap, repeated create clicks are ignored, and newer typing stays dirty. Initial creation and explicit reload both mount an editor; an old document lifetime cannot update its replacement after close. Normal document saves retain their existing optimistic hash behavior.

## Executed checks

| Check | Result |
| --- | --- |
| `cargo test --locked --workspace --no-fail-fast` | 199 passed: 37 contract tests and 162 core/unit/integration tests |
| Creation regressions (included above) | 9 integration cases and 3 atomic-publication/cleanup unit cases |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --locked -p loom-contracts --all-targets -- -D warnings` | Passed |
| Regenerated contract path/SHA256 inventory | All 26 TypeScript files and `.gitkeep` unchanged; no additional/missing files |
| `npm test` | 128 tests in 15 files passed |
| `npm run typecheck:contracts` and `npm run typecheck:app` | Passed |
| `npm run build` | Passed; existing large-chunk advisory remains |
| `git diff --check` | Passed |

Rust ran in Linux Docker with the pinned Rust 1.88 toolchain and native Tauri libraries. Real temporary directories and racing independent `DocumentService` instances verify one complete filesystem winner. A shared-service publication mutex additionally orders echo-guard updates; the filesystem operation supplies no-replace safety across independent services.

A Chromium run against the actual production frontend with mocked Tauri IPC passed five flows:

1. Initial missing creation mounts an editor without an acknowledgement re-read; the next save uses the created hash.
2. A stale missing banner cannot overwrite an external winner; explicit reload mounts the editor and preserves another document's dirty buffer.
3. Pending recreation blocks duplicate clicks/reload and preserves typing made after submission.
4. A collision retains unsaved content and shows an error; an explicit retry succeeds when the destination is absent.
5. Completion after closing the document leaves the other dirty document intact.

Before implementation, backend regressions reproduced an overwritten destination and two successful competing creators. Four browser regression flows failed on the baseline, including direct assertions that the external file had been cleared or overwritten. Review found pending-reload admission and invalidated-save-state problems; failing regressions preceded both corrections. Independent review and orchestrator integration checks were used.

## Limits

Browser flows mock IPC and do not constitute native Tauri GUI acceptance. Windows/macOS remain deferred. Filesystems that reject hard links fail creation safely without an overwrite fallback. Temporary-name removal and directory synchronization remain best-effort under operating-system errors; failed cleanup is logged and does not turn a successfully published file into a reported failure.

Path/symlink checks remain preflight checks, not protection against hostile concurrent ancestor replacement. An external process may change a file after publication; the returned hash identifies the submitted version and normal saves perform their existing optimistic check, without a cross-process compare-and-swap guarantee. Watcher events during pending creation are ignored; explicit reload remains available in the missing-file error state, and no watcher-triggered reload discards that buffer. Closing a document cannot undo a create already sent to the backend.

No frozen contracts, schemas, fixtures, manifests, dependencies, or lockfiles changed. This slice made no live provider calls.
