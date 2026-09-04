# Fixtures

> A0-5/A0-7 deliverable. Each subdirectory is a fake-data source for one
> downstream track to develop against before B/C/D wire to real backends.

| Directory | Consumers | Shape source |
|---|---|---|
| `pty_stream/` | B1, C1 | `contracts::PtyBatch` (JSONL frame batches) |
| `fs_events/` | B2 | `contracts::Event::FsChanged` (echo-loop + rename storm scenarios) |
| `canvas/` | C3, E0 | `.loom/canvas.json` sidecar — `basic.json` and `stress-12-nodes.json` |
| `documents/` | C2 | `*.md` with frontmatter, runnable block, `^block-id`, `[[#^id]]` ref |
| `edges/` | B4, C4 | `contracts::Edge[]` — one example of each `EdgeKind` |
| `plugin_manifest/` | D1, D2 | `contracts::PluginManifest` |

## Loader contract (A0-7)

Each fixture set ships with a JSON file (or `.md` / `.jsonl`) plus an example
that demonstrates the load path:

- **Rust side**: `contracts/tests/fixtures_load.rs` — proves each JSON
  fixture deserializes into the contracts types without loss.
- **TS side**: `src/contracts/` is the source of truth for the TS types each
  loader will use. (No JS runtime in repo yet — frontend loaders join in C-tracks.)

Run `cargo test -p loom-contracts` from the repo root; fixture-load tests
will run alongside the type-export tests.

## Drift policy

If a contract changes (RFC accepted), the fixtures must be updated **in the
same PR** as the contract change. Out-of-date fixtures break the load test
and block all downstream tracks — that is by design.
