# Flowshot task board

## T-20261023 — Owner-authorized mainline resumption

Authority: [START_DEVELOPMENT_PROMPT](../../START_DEVELOPMENT_PROMPT.md). Source: `b7f2a4311d1135977ba273efba8e77702b908036`. Node requirements and graph remain authoritative; local completion is not merged acceptance.

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | Repair N00 build/launch paths, CI entry and reproducibility checks | AC-01 | in_progress | 2026-10-22T18:05:10Z | | 2026-10-23T02:57:19Z |
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

F01 implementation and available Linux verification complete; independent review accepts the bounded foundation repair. [Executed results](N00/evidence/T10-foundation-resumption.md). Board remains in_progress because repository task completion requires merge; owner now explicitly authorizes milestone commit/push/PR/merge after checks and review. F02 remains a separate release gate awaiting controlled target-Mac access. F03/F04 follow development dependencies and retain all missing product implementation.

No target-Mac result, dogfood result, node done outcome or usable release was inferred from the portable pass.

## T-20261024 — Linux development gate and M0

Direct owner instruction: change documents first, continue implementation, commit and merge milestone PRs. SPEC §13.1 separates Linux development from Mac release acceptance; other dogfood requirements remain unchanged. Work is isolated from unrelated project edits.

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | Separate development/release gates and complete real Linux native verification | AC-01, AC-02 | in_progress | 2026-10-23T02:01:51Z | | 2026-10-23T02:57:19Z |
| D02 | N01 SQLite schema, migrations, typed repositories and M0 acceptance | AC-03 | in_progress | 2026-10-23T02:10:00Z | | 2026-10-23T02:57:19Z |

N00 development is now done with [native verification](../verification/N00.md) and independent ACCEPT. D01 implementation is complete, awaiting milestone merge. D02 development acceptance is complete with [N01/M0 evidence](../verification/N01.md), full root native rerun and independent ACCEPT; both rows await the milestone PR merge. Controlled Mac remains a release gate; no usable tag.
