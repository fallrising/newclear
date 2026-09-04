# SQLite Concept Schema

> A0-4 deliverable. Concept-level only — not DDL. Final column types and
> indexes are B-track implementation detail. Every table is annotated with
> its **role** per `source-of-truth.md`.

WAL mode is assumed (TDD §3.1 single db_writer task). All writes serialize
through one task.

---

## `sessions` — **main (degradable)**

PTY session metadata persisted across app restarts. On boot, the core reads
this and tries to re-attach each row; on failure it produces a `Tombstone`
node (§7.1).

| Field | Type / range | Notes |
|---|---|---|
| `id` | text, PK | Stable across detach/re-attach. Maps to `SessionId` in contracts. |
| `cwd` | text | Working directory at spawn. Used by tombstone restart. |
| `cmd` | text? | Original command (may be null for default shell). |
| `shell` | text | `bash`, `zsh`, `fish`, etc. |
| `state` | text (enum tag) | `spawning` / `active` / `detached` / `exited` / `tombstone` — see `SessionState` in contracts. |
| `exit_code` | int? | Set when `state = exited`. |
| `last_activity_ms` | int | Unix millis. Used for LRU / stale-session pruning. |

Indexes: `state`, `last_activity_ms`.

---

## `canvas_nodes` — **cache** (mirror of `.loom/canvas.json` `nodes[]`)

Reflects the sidecar 1:1. Rebuilt from the sidecar on boot or DB corruption.

| Field | Notes |
|---|---|
| `id` | `NodeId`, PK. |
| `kind` | tagged enum: `document` / `terminal` / `tombstone`. |
| `ref` | tag-dependent: file path for `document`, `SessionId` for `terminal`, JSON for `tombstone.was`. |
| `x`, `y`, `w`, `h` | float; canvas coords. |
| `group` | text?, free-form. |

Indexes: `kind`, `group`.

---

## `canvas_edges` — **cache** (mirror of `.loom/canvas.json` `edges[]`)

| Field | Notes |
|---|---|
| `id` | `EdgeId`, PK. |
| `from_node` | `NodeId`, FK → `canvas_nodes.id`. |
| `to_node` | `NodeId`, FK → `canvas_nodes.id`. |
| `kind` | `triggers` / `feeds_output_to` / `context_for`. |

Indexes: `(from_node, kind)`, `(to_node, kind)` — both directions are queried
by the Edge Router (D-6).

---

## `block_index` — **cache**

Maps each `^block-id` back to its source file and line range. Rebuilt by
scanning vault files. Consumers (link chip rendering, AI context assembly)
must tolerate momentary staleness during reindex.

| Field | Notes |
|---|---|
| `file_path` | text. |
| `block_id` | text (the literal after `^`, e.g. `result-2026-q1`). PK = `(file_path, block_id)`. |
| `line_start` | int. |
| `line_end` | int. |

Indexes: `block_id` (for `[[#^id]]` global resolution), `file_path`.

---

## `agent_status` — **cache** (optional)

Last-seen status per agent / terminal session, as derived from `AgentStatus`
events. Purely a denormalization for UI. Live source is the event stream.

| Field | Notes |
|---|---|
| `session_id` | `SessionId`, PK. |
| `status_kind` | `idle` / `busy` / `error`. |
| `last_heartbeat_ms` | int. |
| `task_label` | text?, free-form (only when `busy`). |
| `error_message` | text? (only when `error`). |

---

## What is **not** in SQLite

- `.md` content — filesystem only.
- Canvas layout / edges as authoritative — sidecar only; this DB mirrors.
- PTY output frames — backend ring buffer (in-memory).
- Plugin manifests — `.loom/plugins/<id>/manifest.*`, scanned on boot.
- Plugin event bus messages — transient pub/sub; persistence is each plugin's job (Inbox uses `inbox.jsonl`).
