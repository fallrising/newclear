---
document_type: evidence
node_id: N00
task_id: T06
title: Core dependency-boundary evidence
recorded_at: 2026-07-29
result: pass
---

# T06 core dependency-boundary evidence

## Red

Before implementation:

```text
$ cargo run -p flowshot-xtask -- check-boundaries
xtask: unknown command `check-boundaries`
```

## Policy and graph inspection

The checker invokes locked Cargo metadata and identifies `flowshot-core` by
package identity. It enforces both:

- a direct allow-list: `serde`, `serde_json`, and `ts-rs`;
- a reachable-graph deny policy for Tauri, SQLite/ORM, async/network, watcher,
  database/desktop adapters, and their named package families.

The complete resolved graph is traversed from the core package. Violations show
the shortest discovered package path, such as:

```text
flowshot-core -> serde -> tauri
```

The check runs `cargo metadata --locked --offline`; `cargo fetch --locked` is
therefore a bootstrap prerequisite, preventing the policy gate from silently
changing the dependency solution or requiring network access during CI checks.

## Negative fixtures

Tests create isolated temporary Cargo workspaces and never mutate the committed
core manifest:

1. a direct `flowshot-core -> rusqlite` path;
2. a transitive `flowshot-core -> serde -> tauri` path.

Both produce a non-zero policy result containing the forbidden package path.
The fixture directories are removed after each test.

## Green

```text
$ cargo fetch --locked
success

$ cargo test -p flowshot-xtask
6 passed; 0 failed

$ cargo run -p flowshot-xtask -- check-boundaries
flowshot-core dependency boundary is valid

$ cargo clippy -p flowshot-xtask --all-targets -- -D warnings
success
```

## Result

T06 passes. Core purity is now executable, transitive, offline after bootstrap,
and covered by positive plus disposable negative graph tests.
