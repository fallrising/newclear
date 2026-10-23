# Flowshot task board

## T-20261023 — Owner-authorized mainline resumption

Authority: [START_DEVELOPMENT_PROMPT](../../START_DEVELOPMENT_PROMPT.md). Source: `b7f2a4311d1135977ba273efba8e77702b908036`. Node requirements and graph remain authoritative; local completion is not merged acceptance.

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | Repair N00 build/launch paths, CI entry and reproducibility checks | AC-01 | done | 2026-10-22T18:05:10Z | 2026-10-23T03:24:25Z | 2026-10-23T03:26:42Z |
| F02 | Target Mac launch: awaiting accessible controlled Mac; preserve <1500 ms | AC-02 | in_progress | 2026-10-22T18:05:10Z | | 2026-10-23T01:35:15Z |
| F03 | Reading → annotation → restart → reanchor; gated by N00/M0 | AC-03 | todo | | | 2026-10-23T01:35:15Z |
| F04 | Search, tags, links, Mermaid and export; follow graph/milestone gates | AC-04 | todo | | | 2026-10-23T01:35:15Z |

## Initial diagnosis (superseded by verified results below)

- Missing implementation: DB is a marker, App is a build-info shell; N01–N10/A01–A07 are not delivered.
- Existing implementation without current verification: Rust/React foundation and frozen N00 contract.
- Known failures: historical hosted Mac timings exceed the unchanged oracle; current `scripts/sdd.py verify` fails stale MANIFEST; local `make ci` cannot start because make is absent. Rust/Cargo are also absent; Node is 24.14.0 versus project 24.18.0.
- Concrete harness defects: launch binary hardcodes source `target/release` despite CARGO_TARGET_DIR; Vite/check-launch-entry/Tauri assume source `dist`; nested CI is not an executable monorepo workflow.
- No target Mac discovered in configured SSH aliases. Access requested; no downstream gate inferred from waiting.

## Delivery order

N00 Linux Docker native/window/IPC development acceptance → N01 migrations (M0) → N02/N03/N04 reading (M1, three-day real KB gate) → N05/N06/N07 annotations (M2, 30 annotations/10 comments and restart) → N09/N10/A02 durable reanchor (M3, real git replay) → N08/A01/A03/A04 retrieval (M4) → A05/A06/A07. Requirements remain as specified; no plugin platform or architecture rewrite.

## Earlier 2026-10-23 portable delivery evidence

F01 implementation and available Linux verification complete; independent review accepts the bounded foundation repair. [Executed results](N00/evidence/T10-foundation-resumption.md). Merged in [PR #512](https://github.com/fallrising/newclear/pull/512) at `2026-10-23T03:24:25Z`, commit `f7d7c6a146b663cebbebe26aee2c42f78ed12653`. F02 remains a separate release gate awaiting controlled target-Mac access. F03/F04 follow development dependencies and retain all missing product implementation.

No target-Mac result, dogfood result, node done outcome or usable release was inferred from the portable pass.

## T-20261024 — Linux development gate and M0

Direct owner instruction: change documents first, continue implementation, commit and merge milestone PRs. SPEC §13.1 separates Linux development from Mac release acceptance; other dogfood requirements remain unchanged. Work is isolated from unrelated project edits.

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | Separate development/release gates and complete real Linux native verification | AC-01, AC-02 | done | 2026-10-23T02:01:51Z | 2026-10-23T03:24:25Z | 2026-10-23T03:26:42Z |
| D02 | N01 SQLite schema, migrations, typed repositories and M0 acceptance | AC-03 | done | 2026-10-23T02:10:00Z | 2026-10-23T03:24:25Z | 2026-10-23T03:26:42Z |

N00 development is now done with [native verification](../verification/N00.md) and independent ACCEPT. D01 and D02 are merged in [PR #512](https://github.com/fallrising/newclear/pull/512), with [N01/M0 evidence](../verification/N01.md), full root native rerun and independent ACCEPT. Ubuntu 24.04, macOS 15 Apple Silicon, macOS 15 Intel and project-success CI all passed on reviewed head `8cd27fc9b16c54fbf6f9626978159b279dfa2cbc` before merge. Hosted Mac CI does not establish the separate controlled-Mac launch oracle. Controlled Mac remains a release gate; no usable tag.

## T-20261025 — M1 reading workspace

Direct owner continuation instruction; M0 development evidence accepted, PR #512 merged at `2026-10-23T03:24:25Z`. M1 retains all path/security/performance and real-data gates.

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | Resolve M1 contracts and implement N03 deterministic safe reading model | AC-03 | in_progress | 2026-10-23T03:02:54Z | | 2026-10-23T06:52:00Z |
| R02 | N02 workspace, PathGuard and lazy tree | AC-03 | in_progress | 2026-10-23T03:12:00Z | | 2026-10-23T07:04:45Z |
| R03 | N04 tabs, persistence, native reading and three-day real-KB gate | AC-03 | todo | | | 2026-10-23T03:02:54Z |

M1 current blocker: N03 is blocked by the unchanged 1MiB/<300ms gate (actual WebKit 7975/9139ms on the measured optimized candidate). Functional review corrections passed root frontend checks; T012 profiles the parser without changing the fixture/oracle. N02 targeted repairs passed independent review and integrated Linux checks; the real picker/tree/open/asset WebView journey passed at179ms for500 rendered rows from5000 files. Product composition and Mac-specific checks remain. N04 remains gated; no three-day KB trial or M1 merge is claimed.

Owner-authorized partial-code checkpoint: publish and merge the current N02/N03 implementation with passing regression checks. This checkpoint does not complete R01/R02, unlock N04, revise the300ms contract or satisfy M1. The original performance failure and missing real-KB/platform evidence remain explicit.
