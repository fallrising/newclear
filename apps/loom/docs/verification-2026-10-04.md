# Reliability repair verification — 2026-10-04

This records the bounded maintenance repair against [reliability.md](reliability.md). It does not certify the entire desktop product. Documentation baseline: `152bc2c`; backend repair: `8c97116`; frontend repair: `230704c`.

## Executed checks

| Check | Observed result | Scope |
| --- | --- | --- |
| `cargo test --locked --workspace --no-fail-fast` | 140 passed: 37 contracts, 103 core/unit/integration | Linux native dependencies, pinned Rust 1.88; original watcher failure repaired |
| `cargo fmt --all -- --check` | Passed | Rust workspace |
| `cargo clippy --locked -p loom-contracts --all-targets -- -D warnings` | Passed | Contract crate only; no claim of whole-core Clippy |
| Generated contract comparison | All 26 generated TypeScript file hashes unchanged | No frozen contract/schema change |
| `npm test` | 75 passed in 8 files | Parsers, sidecar validation/preservation, lifecycle, editor origin, AI event ordering |
| `npm run typecheck:contracts` / `npm run typecheck:app` | Both passed | Frozen contract consumers and application |
| `npm run build` | Passed | Production frontend; existing Vite API deprecation and bundle-size warnings remain |
| `git diff --check` | Passed | Integrated changes |
| Chromium actual-app integration harness | Five flows passed | Built UI with mocked Tauri IPC, not native IPC |
| Native Linux startup under Xvfb | Alive for the 20-second smoke window; frontend HTML/JS/CSS returned HTTP 200; no startup crash observed | Test-only WebKit sandbox override in disposable container; process ended by timeout |

The browser flows cover unsafe sidecars without writes, two canonical external reloads without dirty state, edits during a delayed save, one-attempt Keep behavior, and document-local creation preserving another dirty buffer.

Regressions were observed failing before repairs. Independent backend and frontend reviewers inspected the implementation and evidence. The frontend review found a non-string edge-kind acceptance bug, which received a failing regression and strict-string fix before acceptance. The orchestrator reran integrated checks after importing the worker changes.

## Automation

The root [Loom CI workflow](../../../.github/workflows/loom-ci.yml) runs the workspace tests, contract drift check, formatting, contract Clippy, both typechecks, frontend tests and build for Loom changes. It installs Linux Tauri prerequisites, uses Rust 1.88 and locked Cargo/npm dependency resolution, and does not require provider credentials. CI does not run GUI or live-provider acceptance. Check the delivery PR for hosted run status; defining a workflow is not itself evidence of a successful hosted run.

## Remaining acceptance gaps

- Full native interactive acceptance: restart restoration, Run/Pin, terminal deletion/spawn races and multi-document interactions in the actual WebKit/Tauri shell. Startup smoke and mocked IPC do not establish these.
- Live Anthropic/OpenAI/DeepSeek credentials, billing and provider behavior; current provider integration tests use loopback HTTP.
- Windows/macOS behavior and workload/performance acceptance.
- SQLite session/recovery is still a tested library, not wired into desktop startup. MCP, plugin runtime, capability gate and inbox remain unimplemented and outside this maintenance task.
- Hash checks do not offer cross-process compare-and-swap; symlink preflight does not offer confinement against hostile concurrent path replacement.

Unsupported sidecar variants and additive data that cannot round-trip are preserved by blocking autosave with visible recovery feedback. Group metadata is preserved; no new grouping/layout interaction is claimed.
