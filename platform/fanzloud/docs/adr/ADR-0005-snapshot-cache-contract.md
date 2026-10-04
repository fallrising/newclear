---
id: ADR-0005
title: Bounded verified snapshot caches and atomic SQLite schema extension
status: accepted
date: 2026-10-04
deciders: [project]
---

# Context

TD §4.6 names `save_snapshot(snapshot, expected_seq)` but supplies no value shape, concurrency,
retry, provenance or crash-visibility contract. T030A/B have accepted event persistence/replay;
Before this decision, T030D, dependent T030C and the parent were blocked. The recovered A/B store strictly identifies
application ID `0x43425831`, user version 1 and exact event-table DDL. A snapshot table cannot be
silently added and called that same version. T020 projections have private fields and are produced
by a reducer, but an arbitrary caller can reduce invented legal envelopes. Private shape proves
legal domain construction, not persisted-history provenance.

# Decision

This ADR is **accepted for design** after a fresh-context GPT-6 Astra review and R1 repair.
T030D may become Ready for implementation; no runtime acceptance is granted. The detailed normative clauses and planned tests live in
[SPEC-T030D](../specs/SPEC-T030D-sqlite-snapshot-save.md).

1. Compare expected sequence with durable event head under `BEGIN IMMEDIATE`; require candidate
   sequence equals expected head and is nonzero. Current-head saves can become stale after append.
2. Validate persisted provenance by replaying the complete durable prefix on the same connection
   and transaction, from an empty accepted reducer, then comparing every projection field.
   Load returns the replayed projection; stored bytes never initialize a reducer or bypass T020.
3. Explicitly arbitrate equal-sequence cache rows: identical canonical bytes succeed without a
   rewrite, different bytes conflict, lower rows may advance and newer rows never regress. Since
   cache writes do not advance event head, head CAS alone cannot pick one saver. With valid fixed
   history two legitimate projections at the same sequence are equal; different candidates fail
   provenance first. Different-content conflict is reachable through a wrong stored cache row.
4. Make changing save E1, read E0, and distinguish malformed/unsupported **cache values** (load miss; save InvalidSnapshotCache)
   from malformed/unsupported durable **history** (typed error). Unknown completion is old or
   complete new row only; no automatic retry. Explicit exact-input reconciliation can be idempotent
   at unchanged head; head advancement conflicts even if identical bytes already exist.
5. Use a fixed versioned 96-byte cache codec and `[NEW-SPEC]` prefix limit of 4096 events, each page
   at most 256 accepted bounded envelopes. Load's budget applies to cache S, not current head H;
   an older S<=4096 behind H>4096 remains usable. Larger history keeps normal bounded A/B replay.
6. Upgrade only exact owned v1 or empty unowned v0 to exact version2, with one snapshots table,
   unchanged event DDL/codec and the same application ID. Identity selection happens after the
   writer lock, with recheck on concurrent opens; DDL/version are atomic. Never unlink a failed
   opener's file while another opener could own it. No other migration or automatic downgrade.
7. Keep cache value corruption out of A/B compatibility decisions by using nullable ANY only for
   `seq`, `codec_version` and `body`, bounded by fixed SQL/codec before allocation. Production saves
   always emit canonical non-NULL typed values. Preserve the fixed BLOB lookup key and exact
   authoritative event DDL; full CHECK-enabled integrity validation remains mandatory on open.
   Cache key/schema/index/physical failures are store errors; wrong decoded body stream identity
   is a value miss/save InvalidSnapshotCache. Never suppress event CHECK/type/NOT NULL validation. Fresh upgraded connections
   check v1/v2 identities. Legacy fresh opens reject v2; already-open legacy handles can continue
   A/B because their source lacks per-operation version checks. Deployment quiesces legacy
   processes before upgrading; this is not a mixed-version rolling-upgrade protocol.

# Consequences and Tradeoffs

The accepted initial cache verifies the whole prefix and therefore
**does not accelerate reducer startup**. Its bounded verification can hold the sole writer lock
longer than another writer's five-second busy wait. One maximum-size page holds up to 16 MiB of
event bodies plus bounded overhead; at the 4096 cap the operation can scan up to 256 MiB. These
explicit `[NEW-SPEC]` bounds prefer correctness over performance; they are not existing TD
requirements. Future trusted checkpoint/provenance optimization requires its own accepted design,
not a public projection constructor or invented hash guarantee.

The candidate must be current-head at save, and cannot be created for a stream beyond 4096 events
under this design. An older cache is loadable after head advances. No event is truncated, compacted,
rewritten or hidden. The load method exposes no internal reducer. A caller needing one must replay or reuse its own
validated reducer state and
apply the suffix; returned cache metadata alone grants no restore authority.

Exact equal-sequence bytes cannot be repaired by overwrite. An invalid existing cache can block
snapshot saves while ordinary A/B access remains available; explicit future cleanup is separate.
Cache lookup-key, schema, index and physical corruption still fail closed, as does every accepted
event CHECK/type/NOT NULL/key/index invariant at reopen. Historical A/B acceptance and version1 runtime
remain unchanged until implementation; future initialization assertions must explicitly adopt
version2 while retaining all A/B behavior tests.

# Alternatives Considered

- Prior-cache-sequence CAS: would not establish durable head or prevent ahead-of-history candidates.
- Durable-head CAS alone: leaves both same-head snapshot writers admissible indefinitely.
- Blind deserialize/import into private T020 projection: weakens reducer trust and does not prove
  persisted history, even with structural validation or a caller-supplied hash.
- Unbounded full-prefix replay: correctness possible, resource and lock duration unbounded.
- Trusted signed/digest checkpoint or actor-only capability: adds new provenance, secret/process
  or history-immutability machinery beyond this minimal slice.
- General schema migration framework or changing version1 in place: broadens scope or contradicts
  exact accepted schema identity and legacy constructor behavior.

# Review and Acceptance

All S01–S16 clauses map to future machine names and concrete oracles in SPEC-T030D. None are
implemented or run. [T030D design acceptance](../acceptance/T030D-design.acceptance.md) records
the initial R1 rejection and accepted repair. T030D is Ready for test-first implementation.
The matrix separates D save/codec/schema evidence from dependent C public-load evidence;
D acceptance never requires implementing C first. T030C still needs its own E0 spec, test skeletons, implementation and acceptance;
the parent still requires all four child acceptances and composition review.
