# Missing document creation safety

Status: specification before implementation (2026-10-04).

## Problem

The missing-file action currently sends `doc_write` without an expected hash. A document created by another program after the missing banner appeared is overwritten. A second read after creation can also adopt unrelated external bytes as the acknowledged local version.

## Required behavior

- Create empty file and recreate with current edits are create-only operations. If any destination entry exists at publication time, including a racing creator, fail without replacing it. A preliminary existence check followed by overwrite is insufficient.
- Publish fully written bytes using a same-directory temporary file and an atomic no-replace operation (for example a hard link). Sync the temporary file first, remove temporary names after success/failure, and best-effort sync the directory. If the filesystem cannot support this operation, report failure; never fall back to overwrite or expose a partially written destination.
- Preserve existing trusted-vault path and symlink checks. These remain preflight checks, not protection against hostile concurrent ancestor replacement. Existing normal saves and explicit hash-confirmed Keep semantics remain unchanged; no frozen contracts/schema change.
- Add nonfrozen `doc_create({ origin, path, content })` IPC, returning the same snapshot shape as `doc_read` (`path`, `content`, `on_disk_hash`) on success. The snapshot describes exactly the submitted bytes and their resolved identity; do not re-read disk to acknowledge creation. The backend API is `create_document(origin, path, content: &str) -> DocumentSnapshot`. Errors are surfaced as existing IPC string errors with actionable destination-exists wording.
- Register self-write suppression for a successful publication and remove failed-attempt suppression. Update editor tracking only on successful creation. Failure must preserve the original destination and tracked dirty state.
- A document allows at most one create/recreate request at a time. The action visibly indicates progress and ignores repeated clicks. Capture its content/version when submitted. Completion must not mark edits typed later as clean or replace them with the earlier snapshot.
- On failure retain the editor, missing banner, and unsaved content; display a persistent inline error with retry and explicit read-from-disk action. Reload explicitly discards the buffer; it must not occur automatically after an existing-file failure. Loading an initially missing document must mount an editor correctly.
- Success transitions only that document to ready. A closed/replaced document lifetime ignores stale completion, errors, and finalizers. The filesystem mutation already sent cannot be undone on close. Other documents and their dirty buffers are untouched.

## Verification

Use failing regressions before fixes. Backend cases cover absent/nested path creation, existing file preservation, two concurrent creators with exactly one complete winner, unusable destinations/failure temp cleanup, symlink/outside-vault rejection, returned snapshot/hash, and unchanged normal save behavior. Frontend cases cover create-only invocation, no acknowledgement re-read, double clicks, typing while pending, failure/retry, close/reopen isolation, and explicit reload after a collision.

Run Rust workspace tests, formatting, contract Clippy/drift, frontend tests, both typechecks and production build. Exercise the actual document UI with mocked IPC in a browser; distinguish these from native Tauri GUI acceptance. Linux filesystem behavior is exercised in Docker; Windows/macOS remain deferred. No API keys or live provider calls are needed.
