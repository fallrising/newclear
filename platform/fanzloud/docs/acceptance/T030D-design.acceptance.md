---
id: ACCEPT-T030D-DESIGN
subject: T030D-design
reviewer_context: fresh-context-gpt-6-astra
decision: accepted
date: 2026-10-04
---

# Normative Inputs Reviewed

[TD](../TD.md), [ADR-0005](../adr/ADR-0005-snapshot-cache-contract.md),
[SPEC-T030D](../specs/SPEC-T030D-sqlite-snapshot-save.md),
[T030D](../tasks/T030D.task.md), [T030C](../tasks/T030C.task.md),
[T030 parent](../tasks/T030.task.md), accepted T020/T030A/T030B contracts and current
private reducer/projection, SQLite schema, codec and transaction implementation.

# Scope

Design-only CU-EVT-04 E1 save, narrow additive SQLite schema evolution and dependent CU-EVT-03
E0 load/provenance boundary. GPT-6.1 Sol drafted the documents; fresh-context GPT-6 Astra reviewed
the actual contracts and current code. The orchestrator independently inspected the full diff,
ran document checks and scratch SQLite experiments, and recorded acceptance after repair.

# Clause-to-Evidence Review

| Clauses | Design finding | Result |
|---|---|---|
| S01–S02 | Private value, exact 96-byte codec, full accepted timestamps including leap seconds; fixed-width allocation gates | Accepted design |
| S03–S06 | Durable-head CAS, persisted-prefix verification, equal-content idempotency, explicit different-content conflict and monotonicity | Accepted design |
| S07–S08 | Explicit rollback, old/complete visibility, cancellation/lost completion and explicit same-input reconciliation | Accepted design |
| S09–S10 | Pinned E0 read, cache-value miss versus authoritative-history error, replayed projection without restore bypass | Accepted design |
| S11–S13 | Exact additive schema, locked initialization/migration, legacy quiescence and preserved event integrity after R1 | Accepted design |
| S14–S16 | Bounded resources and diagnostics, explicit side-effect boundary, separate D/C test ownership and runtime gates | Accepted design |

The 32 named future tests map all 16 clauses to concrete oracles. **Every future snapshot test is
unimplemented and unrun.** The matrix spans two tasks: D owns save/codec/schema and raw-SQL observer
assertions; C owns public load/E0 and dependent shared assertions after D runtime acceptance.
D acceptance does not require implementing C first. Neither design review nor test names establish
runtime correctness.

# Initial Rejection and Repair

The first independent review returned REWORK for R1. Global CHECK suppression during v2 integrity
validation would admit event rows that accepted v1 rejects, while STRICT/NOT NULL cache value
failures could still reject the database before the promised cache miss.

The repaired exact schema uses nullable ANY only for disposable `seq`, `codec_version`, and `body`.
Full CHECK-enabled integrity validation remains mandatory. Event constraints and the bounded BLOB
lookup key are preserved; key/schema/index/physical corruption is a store error. Malformed cache
values and decoded body identity use bounded SQL/codec disposition. No diagnostic-string filtering
or production integrity bypass is permitted. Independent recheck accepted the repair with no
remaining architectural blocker.

# Current Design Verification

Checks actually run on the ten-document change:

- `git diff --check`: passed.
- Local Markdown link and scope validation: 40 links resolve; only the ten authorized documents
  changed; runtime source, tests, dependencies, workflow and historical acceptances unchanged.
- Clause/status validation: S01–S16 each mapped; 32 unique planned names; design/runtime evidence
  kept distinct. Final statuses are ADR accepted, spec ready (not verified), D ready, C/parent blocked.
- SQLite 3.46.1 scratch DDL experiment: exact documented SQL identity; transactional DDL/version
  rollback preserves v1; commit preserves accepted event DDL and introduces complete v2.
- SQLite 3.46.1 scratch corruption experiment: 15 nullable-ANY type/NULL cases preserve integrity;
  an oversized body is gated before copying; damaged lookup key and authoritative event
  CHECK/type/NOT NULL cases fail enabled integrity validation.
- Worker/reviewer report contract validators and fresh-context design review: passed.

These scratch experiments establish feasibility of the written SQL policy only. They do not run
future Rust snapshot methods, fault seams, crash recovery or concurrent snapshot tests. Existing
A/B runtime hosted evidence remains the recovery [PR #242](https://github.com/fallrising/newclear/pull/242)
checks, including [merged-main CI](https://github.com/fallrising/newclear/actions/runs/37148875720).

# Public API, Security and Recovery

Only proposed implementation signatures and safe errors are specified. No domain field, serde,
restore API, event taxonomy, runtime database schema or P0 behavior changed. Persisted bytes cannot
manufacture reducer state; usable snapshots must equal verified durable-prefix replay. Unknown
completion does not trigger automatic retry. Schema upgrade requires quiescent legacy processes.

# Traceability and Limitations

[Traceability](../traceability.md) separates accepted design from absent runtime evidence.
The 4096-event save ceiling, full-prefix verification without startup acceleration, writer-lock
cost and future explicit cache cleanup are deliberate documented limits. Large streams retain
ordinary A/B replay; stale cache S<=4096 may remain loadable behind larger H. No live provider
operation, deployment, general migration framework or optimized trusted checkpoint is accepted.

# Decision

**Accepted for design only.** ADR-0005 is accepted and SPEC-T030D is ready for test-first
implementation. T030D is Ready, not Accepted; its future runtime acceptance must prove its owned
assertions. T030C remains blocked on D runtime acceptance and its own complete specification.
T030 parent remains blocked pending all child acceptances and fresh composition review.

# Required Follow-up

Generate D-owned fixed-failure test skeletons, implement the accepted save/codec/schema contract,
run focused and full regression gates, and obtain fresh runtime acceptance. Then execute T030C
through its own specification, tests and acceptance before parent composition. New high-risk
implementation gaps must return to the normative design process.
