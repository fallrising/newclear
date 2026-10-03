---
id: SPEC-T030B
title: Bounded SQLite event replay after sequence
status: verified
contract_units: [CU-EVT-02]
module: codebox-event-store
milestone: P1
archetypes: [D, B]
atomicity: E0
invariants: [INV-003]
depends_on: [SPEC-T030A]
td_sections: [4.4-4.6, 7.2, 8.1-8.10, 11.1-11.4, 14, 15.1-15.2]
adr_refs: []
risk: medium
---

# Intent

Expose immutable, bounded replay of one committed session event stream after an exact sequence.
The result is one ordered statement-snapshot page that callers can feed to deterministic
projections without observing another stream, an uncommitted batch, or unbounded persisted data.

# Responsibility

## Does

- Reads at most one caller-bounded page from the Accepted T030A version-1 SQLite row codec.
- Selects only the named stream and sequences strictly greater than `after`.
- Returns envelopes in strict, contiguous sequence order with every stored field decoded.
- Fails closed on an invalid limit, malformed row, unsupported persisted event version, sequence
  gap, or bounded storage failure.
- Performs SQLite work off the async executor and returns no durable mutation.

## Does Not

- Append events, load/save snapshots, apply a reducer, build projections, fan out live events,
  upcast event schemas, repair corrupt rows, return a stable end-of-stream marker, or expose SQL.
- Promise that an empty page remains empty after a concurrent append.
- Detect a corrupted stream identity when every row that once belonged to the requested stream has
  been rerouted and no later sequence remains to reveal a gap.

# Public Boundary

```rust
pub const MAX_REPLAY_EVENTS: usize = 256;

impl SqliteEventStore {
    pub async fn load_after(
        &self,
        stream: SessionId,
        after: EventSeq,
        limit: usize,
    ) -> Result<Vec<DomainEventEnvelope>, EventStoreError>;
}
```

This is the exact `CU-EVT-02` signature from TD §4.6. A bounded vector is the P1 page/chunk for the
Archetype D boundary; it does not expose a connection, iterator, or SQLite lifetime.

# Inputs and Outputs

- `stream` is one validated non-nil T010 `SessionId`.
- `after` is the last sequence the caller has already processed. Zero starts at the first event.
- `limit` is in `1..=MAX_REPLAY_EVENTS`.
- Success returns zero to `limit` complete envelopes for `stream`, ordered by ascending sequence,
  beginning at `after + 1` when any later event exists.

`MAX_REPLAY_EVENTS = 256` is a reversible `[NEW-SPEC]` P1 resource limit aligned with the accepted
append batch ceiling. Combined with T030A's 65,536-byte payload ceiling, it bounds a page's
persisted payload bytes before Rust allocation. Stored timestamps are limited internally to 64
UTF-8 bytes, which contains every canonical Chrono UTC RFC3339 value written by T030A; this is a
reversible `[NEW-SPEC]` decoder bound.

# Preconditions and Disposition

| ID | Condition | Type / Checked / Internal | Trace |
|---|---|---|---|
| P1 | Stream ID is non-nil | T010 type invariant | TD §§4.1, 8.3 |
| P2 | Store was opened through the Accepted T030A constructor | Type/construction invariant | SPEC-T030A |
| P3 | `limit` is at least one | Checked `InvalidReplayLimit` before database access | TD §§8.3, 11.2; `[NEW-SPEC]` |
| P4 | `limit` is at most 256 | Checked `InvalidReplayLimit` before database access | TD §§8.5, 11.2; `[NEW-SPEC]` |
| P5 | Persisted fixed fields have exact SQLite types/widths; payload is at most 65,536 bytes; timestamp is 1–64 UTF-8 bytes | Checked `CorruptStore` during bounded row decode before variable bodies are copied into Rust | TD §§4.4, 8.2, 11.2; SPEC-T030A; `[NEW-SPEC]` timestamp bound |
| P6 | Persisted event schema is exactly version 1 | Checked `CorruptStore { stage: SchemaVersion }` | TD §4.4; SPEC-T030A |
| P7 | Returned sequences start at `after + 1` and remain contiguous | Checked `CorruptStore { stage: Sequence }` | INV-003; TD §4.6 |

When `after == u64::MAX`, success is an empty page without sequence arithmetic. It is not an
overflow error because no event can exist strictly after the domain maximum. This interpretation
is a reversible `[NEW-SPEC]` boundary detail.

The bounded row projection classifies fields as follows:

| Stored field | Gate before body copy | Failure stage |
|---|---|---|
| `event_id` | BLOB, exactly 16 bytes, decoded UUID is non-nil | `EventId` |
| `stream_id` | BLOB, exactly 16 bytes, decoded non-nil `SessionId` equal to requested stream | `StreamId` |
| `seq` | BLOB, exactly 8 bytes, decodes to the next contiguous `EventSeq` | `Sequence` |
| `schema_version` | INTEGER in `u16`, then exactly version 1 | `SchemaVersion` |
| `occurred_at` | TEXT represented as 1–64 bytes, valid UTF-8 and RFC3339 | `Timestamp` |
| `causation_id` | NULL or BLOB of exactly 16 bytes | `CausationId` |
| `correlation_id` | BLOB, exactly 16 bytes | `CorrelationId` |
| `payload` | BLOB of at most 65,536 bytes, valid strict version-1 JSON | `Payload` |

# Success Postconditions

1. The vector length is at most `limit`.
2. Every envelope has the requested `stream_id`.
3. Every sequence is strictly greater than `after`, ascending, unique, and contiguous.
4. Every event ID, schema version, timestamp, causation ID, correlation ID, and payload equals the
   accepted persisted semantic value.
5. The query represents one SQLite statement snapshot: each concurrent T030A commit is fully
   visible or fully invisible to the statement. `limit` may return a prefix of the snapshot,
   including a prefix ending within an already committed multi-event batch.
6. No event row, schema value, append high-water, or snapshot state is changed.

# Non-Guarantees

- A page shorter than `limit`, including an empty page, is not a durable end-of-stream declaration;
  a later call may observe a concurrent or subsequent append.
- T030B does not validate lifecycle transitions or prove the complete stream reduces successfully.
- The method returns no total count, next-page token, snapshot, or live subscription.
- Corruption beyond the selected page is reported only when a later page reaches it.
- Filesystem access metadata and SQLite-owned transient WAL shared-memory behavior are deployment
  concerns; E0 covers Codebox event-store application state.
- T030A's explicit same-UID post-validation path-replacement non-guarantee remains unchanged.

# Side Effects

The method opens one bounded read-only SQLite connection, installs the accepted five-second busy
timeout, executes one fixed parameterized `SELECT`, decodes at most `limit` rows, and closes the
connection. It does not execute DDL, DML, journal-mode changes, or snapshot writes.

SQLite may read the main database, WAL, and shared-memory files. The private administrator
directory remains the containment boundary established by T030A.

# Idempotency

For unchanged committed database state, repeating the same `(stream, after, limit)` call returns
the same envelopes. Under concurrent commits, a repeat may return a longer or newly non-empty page
but never changes persisted state. A checked failure may be retried after repairing storage or
corruption; no reconciliation is required for this E0 boundary.

# Concurrency and Ordering

The fixed query filters by exact stream bytes, `seq > after`, orders by the accepted fixed-width
big-endian sequence key, and applies the validated limit. SQLite holds one statement snapshot
while rows are stepped. A concurrent append's commit is therefore fully visible or fully
invisible to the statement. The page may end within an already committed batch when `limit` is
smaller than the remaining snapshot; it never exposes uncommitted rows.

The decoder independently rechecks stream identity, supported schema, the first expected sequence,
and every subsequent contiguous sequence. SQL ordering is not treated as sufficient evidence when
persisted data is corrupt.

# Streaming, Termination, and Backpressure

The call terminates with one complete bounded vector or one typed error. It emits no progressive
chunks, owns no queue, and requires no consumer backpressure protocol. The maximum page count and
per-row byte bounds are the backpressure/resource mechanism for P1.

The caller continues by using the last returned `EventSeq` as the next `after`. An empty vector
terminates only the caller's current catch-up observation.

# Cancellation and Timeout

SQLite work runs through `spawn_blocking`. Dropping or cancelling the Rust future may allow the
bounded read to finish in the worker, but the result is discarded and no application state
changes. Lock acquisition uses `SQLITE_BUSY_TIMEOUT`; expiration returns `Busy`.

T030B defines no broader operation deadline. A caller may impose one without reconciliation
because the boundary is E0.

# Failure Atomicity

E0. Invalid limits fail before database access. Query, decode, cancellation, busy, and worker
failure do not change Codebox event-store application state. A partially decoded vector is never
returned: the complete selected page succeeds or the method returns one error.

# Failure Modes and Error Contract

| Case | Error | Retriable | Caller action | Required payload | Trace |
|---|---|---:|---|---|---|
| Limit is zero or above 256 | `InvalidReplayLimit` | After caller repair | Choose `1..=max` | max, actual | TD §§8.3, 11.2; `[NEW-SPEC]` |
| SQLite lock timeout | `Busy` | Yes, bounded | Back off and retry the same read | None | TD §§8.6, 16.2 |
| Invalid field shape/encoding | `CorruptStore` | No automatic retry | Stop replay and restore/investigate | bounded stage | TD §§8.2, 11.2 |
| Unsupported persisted event version | `CorruptStore { stage: SchemaVersion }` | No | Run an explicit future migration/upcaster or restore | bounded stage | TD §4.4 |
| Missing/noncontiguous selected sequence | `CorruptStore { stage: Sequence }` | No | Stop replay and restore/investigate | bounded stage | INV-003 |
| Read-only open/query failure | `Storage` | Depends on bounded kind | Repair storage; retry only if classified transient | operation, kind | TD §§8.2, 8.6 |
| Blocking worker cannot complete/join | `WorkerUnavailable` | Yes | Reopen/retry the read | None | TD §§8.2, 8.7 |

No error contains a filesystem path, SQL text, raw row, serialized payload, SQLite diagnostic,
prompt, secret, or provider output.

# Security Contract

- The caller supplies only typed stream/sequence values and a bounded count, never a path or SQL.
- SQL is fixed and all values are bound parameters.
- The query first checks SQLite type and byte length and conditionally projects each body:
  `event_id`, `stream_id`, and `correlation_id` are exactly 16-byte BLOBs; `seq` is exactly an
  8-byte BLOB; `causation_id` is null or a 16-byte BLOB; `occurred_at` is 1–64 UTF-8 bytes; and
  `payload` is a BLOB no larger than 65,536 bytes. Invalid fields map to their bounded
  `CorruptStoreStage` without copying an oversized body into Rust.
- Exact stream filtering and post-decode identity checks prevent cross-stream disclosure.
- Unsupported schema and malformed persisted content fail closed; no payload is rendered, logged,
  or included in an error.
- The private path and read-only connection preserve T030A's administrator-owned local trust
  boundary.

# Observability and Audit Contract

T030B emits no log, metric, or audit record. Success returns typed envelopes whose existing
identifiers support caller-owned structured observability. Errors contain only bounded
classification enums and safe counts.

# Test Specification

The following exact tests must first exist as compiling fixed-failure skeletons.

## Contract and Limits

- `load_after_rejects_zero_limit_without_database_access`
- `load_after_rejects_limit_above_max_without_database_access`
- `load_after_empty_stream_and_after_high_water_return_empty`
- `empty_replay_is_not_stable_end_of_stream`
- `load_after_returns_one_and_many_in_strict_sequence_order`
- `load_after_limit_pages_without_duplicates_or_gaps`

## Isolation, Restart, and Model

- `load_after_isolates_streams`
- `load_after_preserves_every_envelope_field_across_restart`
- `load_after_page_model_matches_committed_history`
- `canonical_timestamp_encoding_fits_replay_bound`

## Corruption and Security

- `load_after_rejects_unsupported_persisted_schema`
- `load_after_rejects_corrupt_rows_by_bounded_stage`
- `load_after_rejects_oversize_payload_and_timestamp_before_body_allocation`
- `load_after_rejects_gap_or_noncontiguous_page`
- `load_after_error_and_debug_do_not_expose_persisted_bytes_or_path`

## E0, Concurrency, and Cancellation

- `load_after_statement_snapshot_never_exposes_uncommitted_rows`
- `load_after_does_not_mutate_committed_events`
- `load_after_busy_timeout_is_retriable_and_non_mutating`
- `load_after_missing_database_returns_bounded_storage_without_recreation`
- `load_after_cancellation_has_no_effect`
- `load_after_worker_join_failure_maps_to_bounded_error`

`load_after_page_model_matches_committed_history` varies the page limit and concatenates successive
pages, proving Archetype D chunk/page invariance against the committed model. The worker-join test
uses an internal test seam to trigger Tokio join failure; no caller-controlled input can make the
production read closure panic. Public API/source inspection proves that total count, snapshot,
live subscription, repair, reducer, and upcast surfaces are absent.

All Accepted T030A tests remain green, including schema identity, restart, busy, cancellation,
rollback, full-`u64` ordering, private path, and error-redaction evidence.

# Acceptance Evidence

| Command or check | Result | Evidence URI or hash |
|---|---|---|
| Dependency | T030A Accepted; final accepted tree CI passed | `ACCEPT-T030A`; commit `0ddba62` |
| Fresh design review | `T030B DESIGN ACCEPTED` after statement-snapshot, bounded-allocation, and error-test blockers were repaired | Fresh read-only Grok rerun, 2026-07-30 |
| Failing test skeleton | Failed before production implementation with fixed `T030B skeleton: not implemented` panic; 1 failed, 20 filtered | Exact `load_after_rejects_zero_limit_without_database_access` run |
| Focused suite | Passed: 8 unit, 17 retained append, 19 replay/property/concurrency/corruption/E0 tests | Local 2026-07-30 run |
| Workspace gates | Passed: 240 Rust, Clippy, build, fmt, dependency policy, diff check; retained base Node P0 suite 10/10 because Node is unavailable locally and no Web/JS changed | Local 2026-07-30 runs; accepted base commit `0ddba62` |
| Fresh implementation review | `T030B IMPLEMENTATION ACCEPTED`; no blocker | Fresh read-only Cursor Agent, 2026-07-30 |
| Hosted CI | Passed: pinned Node, fmt, Clippy, 240 Rust tests, build, and dependency policy on implementation commit `a4ecbf8` | [GitHub Actions run 31325149204](https://github.com/fallrising/fanzloud/actions/runs/31325149204) |
| Acceptance | Accepted | [`ACCEPT-T030B`](../acceptance/T030B.acceptance.md) |

# Traceability

- `CU-EVT-02` → TD §§4.4–4.6, 8.5–8.7, 14 → this specification → T030B replay,
  corruption, ordering, isolation, restart, cancellation, and E0 tests.
- `INV-003` → contiguous persisted sequence invariant → first/subsequent page checks and gap
  corruption tests.
- T030B → TD §§9.3, 15.1–15.2 → one E0 replay child of T030.
