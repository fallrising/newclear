# ADR-004 — Versioned tab sessions and close-time persistence

Status: specification decision, 2026-10-23. Authority: N04 and SPEC §§7/10/13. Implementation remains gated on accepted N02 and N03; this document does not bypass their outstanding checks. N04 must derive plans, executable oracles and its initial lock before code.

## State and identity

Persist one versioned session envelope at scope `application`, key `reader-session`. Schema version 1 contains the active workspace ID and a list of workspace sessions; each session contains ordered tabs, its active document ID or null, and each tab's document UUID, last known root-relative path, finite nonnegative scroll offset and decimal-string last-active timestamp. Workspace/document identities are UUIDs, never path-derived keys. Reject duplicate workspace/document entries, invalid IDs, mismatched active IDs and invalid numeric values. Missing/detached documents remain represented by the same tab and known path.

The initial v1 reader accepts only its specified schema. No previous session schema has shipped, so do not invent a legacy migration. An unknown newer version produces an explicit incompatible-state result and preserves the exact stored JSON and token; normal saves are disabled until the incompatibility is resolved. Malformed stored data likewise remains intact and produces a recoverable UI error. Never silently replace either with an empty persisted state. A later backward-compatible migration needs versioned fixtures before it is introduced.

The pure reducer owns open, activate, close and close-others. Reopening a UUID activates its existing tab. Closing the active tab selects the preceding surviving tab, or the following one when closing the first; no tabs means null active ID. Closing an inactive tab preserves the active ID. Workspace switching preserves each workspace's tab list and active choice. Caller-supplied timestamps keep reducer tests deterministic. Scroll updates must target the document UUID, including when activation races a delayed scroll event.

## Transaction and version tokens

Keep the two-command surface `load_app_state` and `save_app_state`. Freeze a per-key compare-and-swap map in the initial N04 DTOs: `expected_updated_at` maps every entry key to its decimal-string SQLite timestamp or explicit null for creation. Never use one timestamp for multiple keys. Reject missing/extra expected keys, duplicate keys, empty scope/keys and invalid tokens. Return authoritative per-key tokens after commit. Bound keys, entry count and serialized JSON size in the DTO/service validation before invoking SQLite; exact limits and boundary tests belong in the implementation plan and initial lock.

Load all requested keys in one existing owned DB transaction for a consistent view. Save all entries in one existing owned transaction, composing `compare_set_app_state`; one stale key aborts the entire batch. No raw SQL outside the DB crate, new schema, immutable migration change or generic SQL escape is needed. Use explicit null for absent records; do not confuse absence with an empty JSON value. Unknown newer session versions are protected by the native service as well as the frontend, so a stale client cannot overwrite them.

The UI serializes saves with a 250ms debounce. A newer dirty snapshot supersedes queued snapshots, never the in-flight request. After success, install returned tokens before sending the next snapshot. Failure retains the current reducer state and dirty snapshot, shows a nonblocking error and retries only by an explicit bounded policy/user action. A CAS conflict requires reloading and presenting the competing state; do not retry by silently adopting its token and overwriting it. LocalStorage is never authoritative.

## Close and application exit

Async browser `beforeunload` is insufficient. Native code intercepts both window close and application exit, prevents destruction and issues a unique close-request token to the main frontend. The frontend first cancels the debounce, serializes any in-flight write, then saves its latest dirty session and acknowledges that token through an optional field on `save_app_state`. Native code may release that exact close/exit barrier only after the DB transaction completes successfully. A failed/stale/mismatched acknowledgement leaves the window alive and current UI state intact. Repeated close requests coalesce; no timeout force-exits and loses dirty state.

Subscribe to the native close event before loading/restoring the session. Native startup must retain a pending close request until the frontend is ready; readiness is established through the existing state-load request, not guessed from window visibility. Only the main application window may acknowledge its pending token. Scope/key restrictions and close-token matching are part of native tests, not merely TypeScript types.

For a clean session, acknowledge without writing after verifying the saved generation is still authoritative. For an incompatible newer stored schema, closing may acknowledge without mutation; the UI must already show that restoration/saving is unavailable. The implementation plan must distinguish these explicit no-write cases from dirty-session flush. Never manufacture a successful save result for a rejected write. Exit tests cover window close, application quit, an in-flight save, failed save and stale acknowledgement; actual process restart must observe the last acknowledged session.

## Lazy restoration and composition

Restore metadata first and request only the active tab body. Other tabs load on activation; initial restoration does not eagerly preload them. Use generation/request identities to discard stale asynchronous results after tab changes without losing scroll metadata. Missing, ignored or detached documents render an unavailable placeholder and retain the saved identity/path. Do not delete their tabs or DB records as a side effect of opening.

Restore scroll only after the matching document model has rendered, then clamp to the actual scrollable extent. An explicit user-followed heading fragment takes precedence over a saved offset for that navigation; subsequent scroll events update the tab normally. Model/source mismatches and delayed responses must never apply one tab's offset to another. Loading, empty, incompatible, missing and write-failure states have explicit accessible presentations.

Root owns App composition, shared native lifecycle/command registration, contract generator integration, capabilities and styling after the N02/N03 workers finish. N04 uses their accepted public interfaces only. Product verification retains three-tab close/restart, ten-tab active-first traces, reducer action <16ms, and the unchanged three-consecutive-day real-KB trial. Synthetic fixtures cannot substitute for that trial.
