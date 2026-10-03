# Desktop session recovery

Status: implementation specification, 2026-10-04. The existing session-store library is not yet connected to desktop startup at this document's initial revision. This slice connects it without changing frozen contracts or source-of-truth assignments.

## User-visible behavior

- The desktop opens a per-vault `.loom/sessions.db` before accepting terminal commands. Terminal cwd, original command, resolved shell, state and last activity survive app restart.
- On a fresh process, rows that claimed to be spawning/active/detached become restartable tombstones. Exited rows retain their exit status. Opening the app never reruns a saved command.
- A session-history panel lists stored metadata and offers explicit **Restart** and **Forget history** for sessions absent from the live manager. Restart creates a new session ID and terminal node, preserving the original history row. Repeated clicks while a request is pending cannot create duplicate sessions.
- Existing canvas restoration is unchanged: sidecar nodes restore in their recorded positions as documents or terminal tombstones. Session history is a separate view, not an automatic source of new canvas nodes. Opening history never duplicates/replaces canvas topology. Forgetting a history entry does not delete its existing canvas node or files.
- Storage failure is visible: the app remains usable with in-memory session metadata and a warning that history will not survive restart. A later persistence failure is also surfaced rather than silently claiming durability. Restart/forget failures remain visible and retryable.
- A saved command's working directory may no longer exist. Restart failure preserves the history row and does not remove or rewrite the canvas. Successful restart attaches the new terminal through the same cleanup/active-route path as a normal spawn; unmount/cancellation must not leave an unseen child running.

## Authority and limits

Markdown content remains filesystem-only; `.loom/canvas.json` remains authoritative for layout/edges. SQLite is authoritative only for session metadata. No dirty editor snapshots, PTY output, scrollback, OS process reattachment, or automatic process resurrection are promised. Existing frozen v1 sidecar and generated Rust/TS contracts are unchanged; new commands use nonfrozen runtime DTOs and existing `SessionMeta`.

DB corruption/unreadability must preserve the original database and sidecar. Do not delete or replace corrupt files automatically. Avoid symlink descendants for the database and its SQLite companion/guard files using the existing trusted-vault path policy. These remain preflight checks, not protection against hostile concurrent path replacement.

One persistent runtime owns a vault at a time. A second app opening the same vault must not tombstone the first app's live sessions. Use a process-lifetime SQLite lock in a separate per-vault guard database, or an equivalent tested OS-released lease without new dependencies; a contending instance degrades visibly to in-memory history and must not run recovery against the shared session database. The OS must release ownership on process termination so an ordinary restart recovers successfully.

## Runtime and IPC

Boot completes store open/fallback and reconciliation before terminal IPC becomes available. A reusable runtime service, called by the actual Tauri setup/commands, owns the PTY manager and store integration. All lifecycle state transitions are ordered: a fast child exit cannot race ahead of the insert and leave a permanent active row; subscribe/detach cannot overwrite a known exit. Failed spawn creates no misleading durable active row. Restart accepts only a stored, non-live exited/tombstone session, never arbitrary caller-supplied replacement metadata.

State changes are persisted for spawn, subscribe/detach, exit/kill and explicit restart. Last activity updates on accepted user input/lifecycle operations; it is not a promise of per-byte output activity tracking. Close/dismiss does not silently erase history; explicit Forget does, and rejects live-manager IDs. Shutdown terminates owned PTYs and completes pending state writes where practical; abrupt termination is covered by next-boot reconciliation.

Commands (camelCase invocation arguments, snake_case DTO fields):

| Command | Result / behavior |
| --- | --- |
| `session_history` | `{ sessions: SessionMeta[], live_session_ids: SessionId[], persistent: boolean, warning: string | null }`; read errors are surfaced or produce an explicit degraded snapshot |
| `session_restart` | `{ origin, sessionId, cols?, rows? }` → fresh `SessionId`; reject live or missing IDs |
| `session_forget` | `{ origin, sessionId }` → void; history only, reject live IDs; idempotent missing history is acceptable |
| Existing `pty_*` | Preserve invocation compatibility; route lifecycle mutations through the runtime; `pty_session_meta` may fall back to stored metadata when no live entry exists |

Emit the nonfrozen `session:changed` notification after history/status changes; frontend registers before its initial read, refreshes on notification and manual retry, and ignores stale refreshes after disposal. Notification is a refresh hint, not the authoritative payload. The history UI filters live IDs from actionable rows, displays both tombstones and exited rows, and communicates that Restart reruns the saved command.

## Verification and delivery

1. Write failing regression tests before implementation. Cover durable close/reopen, fast exit, subscribe/detach/kill ordering, recovery idempotence, restart metadata/new ID/history retention, failed restart, live forget rejection, corrupt/unwritable/symlink paths, contention and release of the per-vault guard.
2. Test UI fetch/error/degraded/notification/order handling, duplicate restart clicks and canceled restart cleanup. Preserve all existing sidecar and document regressions.
3. Run the complete Rust workspace, formatting, contract Clippy/drift, frontend tests, both typechecks and build. Use real PTYs and an on-disk DB in native Linux integration tests.
4. Run the actual Tauri binary under Linux/Xvfb against a disposable vault, confirm it creates the store, seed a claimed-live history row while the app is closed, relaunch and verify it becomes a tombstone without running the saved command. Record the distinction between this native boot/recovery smoke and mocked browser UI flows.
5. Use independent review and staged PRs. Windows/macOS and live AI provider acceptance are deferred; OpenCode provider selection does not affect SQLite recovery.
