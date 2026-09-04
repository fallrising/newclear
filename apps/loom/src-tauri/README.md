# `loom-core` (workspace crate `src-tauri/`)

Backend runtime shared by every B-track. A0 left this directory empty; **B1
populated it** as the first track to need it.

## Append-only rule (the only cross-track coordination point)

Two files are touched by multiple tracks:

| File | Rule |
|---|---|
| `Cargo.toml` | Each track appends its own `[dependencies]` lines **below the existing block**. Never reorder or modify another track's lines. |
| `src/lib.rs` | Each track appends its own `pub mod xxx;`. Never touch another track's line. |

Anything else lives under each track's owned subtree:

| Track | Owned path |
|---|---|
| B1 | `src/pty/**`, `src/session_store/**` |
| B2 | `src/fs/**` |
| B3 | `src/mcp/**`, `src/gate/**` |
| B4 | `src/ai/**` |
| D1 | `src/plugin/**` |
| E0 | `src/wiring/**` (cross-track glue; only E0 may import across tracks) |

A track that needs to call into another track's code does **not** import it
directly. It either (a) goes through `contracts/`, (b) hands a callback /
trait object to the other track at wiring time, or (c) escalates via E0.
This keeps the dependency graph between tracks empty by design.

## Platforms

v1 targets **macOS + Linux**. Windows support is future work — `portable-pty`
already ships ConPTY, but it has not been exercised.
