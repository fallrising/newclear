# Source of Truth — main data vs cache

> A0-4 deliverable. Frozen. Any change requires a Contract Change RFC.

This table is the authoritative answer to "if X is corrupted, do I rebuild
from Y or do I lose work?" — both crash recovery and the fs echo loop (D-7)
depend on getting this right.

| Data | Main source | Nature | On corruption / loss |
|---|---|---|---|
| Document content (`*.md`) | **Filesystem** | main | **Never** rebuild from DB. Editor surfaces a tombstone if the file is gone. |
| Canvas layout (node x/y/w/h, groups) | **`.loom/canvas.json` sidecar** (+ SQLite mirror) | main | Restore from sidecar. SQLite `canvas_nodes` is a cache. |
| Edges (`triggers` / `feeds-output-to` / `context-for`) | **`.loom/canvas.json` sidecar** (+ SQLite mirror) | main | Same as above. SQLite `canvas_edges` is a cache. |
| `^block-id` index, backlinks | SQLite `block_index` | **cache** | Rescan vault, regenerate. |
| Session metadata (cwd / cmd / shell / state / last activity) | SQLite `sessions` | main (degradable) | Best-effort re-attach; on failure produce a tombstone node with one-click restart (§7.1). |
| Agent status snapshot | SQLite `agent_status` (optional) | cache | Recomputed from live `agent_status` events. |
| PTY ring buffer (in-memory) | Backend per-PTY ring buffer | **transient** | Lost on app exit — ring buffer survives detach within the same process only. |

## Why a sidecar at all? (D-4)

Three reasons, in priority order:

1. **Vault portability** — canvas layout is human-readable and version-controllable (`git diff` on `.loom/canvas.json` is meaningful).
2. **Crash resilience** — SQLite corruption does not lose the workspace topology.
3. **Obsidian coexistence** — Loom metadata lives in `.loom/` and never touches the user's notes (D-9).

The sidecar is the contract. SQLite mirrors it for query performance only.

## Two non-obvious consequences

- **Writes are sidecar-first**: a canvas write updates `canvas.json` first, then refreshes the SQLite mirror. A failed mirror update is recoverable; a failed sidecar write is not.
- **`block_index` may be stale right after a fs change** — that is acceptable. Consumers (link chip rendering, AI context assembly) must tolerate a one-tick lag while the indexer catches up.
