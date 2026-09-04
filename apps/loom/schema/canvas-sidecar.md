# `.loom/canvas.json` Sidecar Format

> A0-4 deliverable. Frozen. Source of truth for canvas layout + edges (D-4).

## Why this file exists

SQLite stores a mirror of this for query performance; this JSON file is the
authoritative copy. If SQLite is deleted or corrupted, the canvas can be
fully restored from this file alone.

Three properties drive the format:

- **Human-readable** — `git diff` produces meaningful output.
- **Stable ordering** — deterministic so VCS diffs stay small (sort by `id`).
- **Forward-compatible** — `version` field at the root for future migrations.

## Location

```
<vault root>/.loom/canvas.json
```

One file per vault. The whole `.loom/` directory is intended to be checked
in alongside the vault.

## v1 schema

```jsonc
{
  "version": 1,
  "nodes": [
    {
      "id": "n-d8f3...",
      "kind": {
        "type": "document",
        "path": "10-projects/loom/notes.md"
      },
      "x": 240.0, "y": 120.0, "w": 480.0, "h": 320.0,
      "group": null
    },
    {
      "id": "n-7b2a...",
      "kind": {
        "type": "terminal",
        "session_id": "s-2026-..."
      },
      "x": 760.0, "y": 120.0, "w": 600.0, "h": 320.0,
      "group": "experiments"
    },
    {
      "id": "n-c1e9...",
      "kind": {
        "type": "tombstone",
        "reason": "PTY exited (code 0); re-attach failed on boot",
        "was": {
          "type": "terminal",
          "cwd": "/Users/me/work/loom",
          "cmd": "claude code",
          "shell": "zsh"
        }
      },
      "x": 1380.0, "y": 120.0, "w": 320.0, "h": 160.0,
      "group": null
    }
  ],
  "edges": [
    {
      "id": "e-...",
      "from": "n-d8f3...",
      "to": "n-7b2a...",
      "kind": "triggers"                   // "triggers" | "feeds_output_to" | "context_for"
    }
  ]
}
```

### Node `kind` is a tagged enum

The inner discriminator is `type` (not `kind`) so the JSON stays readable
when `Node.kind` wraps `NodeKind`.

| `type` | extra fields |
|---|---|
| `document` | `path: string` (vault-relative) |
| `terminal` | `session_id: SessionId` — joins `sessions` table |
| `tombstone` | `reason: string`, `was: TombstoneSubject` |

`TombstoneSubject` carries enough metadata to one-click restart (§7.1):

- `{ "type": "document", "path": "..." }`
- `{ "type": "terminal", "cwd": "...", "cmd": "...", "shell": "..." }`

### `run_in:` frontmatter is **not** stored here (D-6)

`run_in: <node-id>` lives in the document's own frontmatter. The document
loader materializes it into a synthetic `Edge { kind: "triggers", from: <doc>,
to: <node-id> }` at load time. The materialized edge is **not** persisted to
`canvas.json` — it is recomputed on every load, so frontmatter remains the
single source of truth for `run_in`.

This means: edges in `canvas.json` are the user-drawn ones; runtime sees a
union of stored edges + materialized `run_in` edges.

## Atomicity

Writers must:

1. Compose the full new JSON in memory.
2. Write to `.loom/canvas.json.tmp`.
3. `fsync` then atomic rename to `.loom/canvas.json`.

This avoids leaving a half-written file on crash. Backups (`.loom/canvas.json.bak`)
are optional and not part of the contract.

## Versioning

Bumping `version` requires:

- A Contract Change RFC (`01-collaboration-protocol.md` §6).
- A migration step documented here.

v1 is the first frozen version. Future migrations should additively extend
fields rather than rename existing ones.
