---
id: SPEC-T030D
title: SQLite snapshot cache save and dependent load trust boundary
status: verified
contract_units: [CU-EVT-04, CU-EVT-03]
module: codebox-event-store
milestone: P1
archetypes: [E, D, B]
atomicity: E1-save-and-open/E0-load
invariants: [INV-003, INV-004]
depends_on: [SPEC-T020, SPEC-T030A, SPEC-T030B]
td_sections: [4.4-4.6, 7.4, 8.1-8.10, 9.3, 11.1-11.4, 14]
adr_refs: [ADR-0005]
risk: high
---

# Intent

Specify the snapshot cache contract. The D-owned save/value/schema boundary is implemented and
verified in [runtime acceptance](../acceptance/T030D.acceptance.md), following accepted design
review and compiling RED skeletons. T030C public load and its shared assertions are separately
verified by [C runtime acceptance](../acceptance/T030C.acceptance.md); the
[parent composition](../acceptance/T030.acceptance.md) is also Accepted. The store uses schema version2 while
preserving A/B append/replay behavior. Verified status applies to the D-owned boundary only.

# Responsibility

## Does

Define bounded cache values, durable-head comparison, equal-sequence arbitration, persisted-history
verification, E1 save/open, E0 load, and one additive version-1-to-2 database transition.

## Does Not

Define actors, leases, command receipts, provider side effects, history deletion, event upcasting,
a general migration framework, cache repair/deletion, encryption, or P0 durable sessions.

# Public Boundary

Implemented save/value signatures, with dependent `load_snapshot` owned and separately
implemented/accepted by [SPEC-T030C](SPEC-T030C-sqlite-snapshot-load.md):

```rust
pub const MAX_SNAPSHOT_BYTES: usize = 96;
pub const MAX_SNAPSHOT_PREFIX_EVENTS: u64 = 4096;
pub struct SessionSnapshot { /* private owned SessionProjection; no Deserialize */ }
impl SessionSnapshot {
    pub fn from_projection(projection: SessionProjection) -> Result<Self, EventStoreError>;
    pub fn projection(&self) -> &SessionProjection;
}
impl SqliteEventStore {
    pub async fn save_snapshot(&self, snapshot: SessionSnapshot, expected_seq: EventSeq)
        -> Result<(), EventStoreError>;
    pub async fn load_snapshot(&self, stream: SessionId)
        -> Result<Option<SessionSnapshot>, EventStoreError>;
}
```

`from_projection` reads only accepted T020 getters and checks bounds. It preserves T020 private
fields; it does **not** establish persisted provenance. Callers can reduce invented envelopes into
a perfectly legal projection. Only the durable-history check below establishes store-relative
truth. Load constructs the returned snapshot from its freshly replayed reducer projection,
never from decoded cache fields. No domain constructor, setter, serde derive or reducer restore
operation is added. T030C projected these load clauses into its own specification before code.

# Inputs and Outputs

Snapshot stream, sequence, status, optional active turn/approval/sandbox and last activity are the
exact T020 projection fields. All identifier slots use T010 non-nil values when present. Sequence
is in `1..=4096`. The whole cache contains no event bodies, prompt, diff, path, tool output,
credential, provider text, timestamp of save, writer ID, hash, or authentication claim.

# Preconditions and Disposition

| Condition | Disposition | Clause |
|---|---|---|
| Store opened by private administrator path | Construction invariant; per-connection identity recheck | S12–S14 |
| Typed projection and supported cache version | Type plus checked `InvalidSnapshot` | S01–S02 |
| Nonzero sequence within replay budget | Checked before DB access | S01, S04 |
| Candidate sequence equals expected durable head | Checked before DB access | S03 |
| Actual committed head equals expected | Checked under writer lock | S03 |
| Candidate equals reducer result of persisted prefix | Checked inside same transaction | S04 |
| Existing equal/newer row arbitration | Checked under writer lock | S05–S06 |

# Numbered Normative Contract

These clauses own all requirements in this design. The later descriptive sections expand their
oracles without adding implementation evidence. Choices marked `[NEW-SPEC]` are adopted by accepted ADR-0005.

**S01 — Value and budget.** A snapshot MUST be a private wrapper of a valid T020 projection, with
sequence in `1..=4096` and encoded length exactly 96 bytes. T020 public projections are already nonzero; a private sequence-policy helper defensively
returns `InvalidSnapshot { reason: Empty }` for zero without manufacturing a domain projection; above 4096 returns `SnapshotPrefixTooLarge { max: 4096, actual }`, before file access.
No public deserialization or projection import constructor is permitted. `[NEW-SPEC]` The prefix
limit bounds total verification work, not event-store size; append/replay retain full `u64` support.

**S02 — Versioned codec.** The cache MUST use this fixed binary layout, in the listed order:
4 magic bytes ASCII `CBS1`; big-endian `u16` cache version 1; big-endian `u16` event schema 1;
16 stream UUID bytes; 8 big-endian sequence bytes; 1 status byte; three 17-byte optional-ID slots
(active turn, pending approval, sandbox); 8 big-endian signed Unix timestamp seconds (two's
complement); 4 big-endian nanoseconds. Total: `4+2+2+16+8+1+51+8+4 = 96`.
Status bytes 0–8 map in order to Provisioning, Ready, Running, WaitingApproval, Cancelling, Idle,
Failed, Archiving, Archived. Each option uses tag 0 plus sixteen zero bytes, or tag 1 plus a
non-nil UUID; other tags/noncanonical null bytes fail. Seconds/nanos MUST reproduce the exact supported T020/Chrono UTC timestamp, including valid
leap-second representations (nanoseconds may be in `1_000_000_000..2_000_000_000` only at a valid
Chrono leap-second seconds value). Reject only values the accepted timestamp type cannot
represent; preserve every value accepted by T020, with no silent narrowing. Header, SQL version/stream/sequence,
all widths, supported versions and flags MUST agree. The canonical encoder writes no padding
or variable allocation. Reader SQL MUST gate BLOB length/type before copying the body; malformed,
oversized or unsupported cache bytes are discardable under S09, never unchecked serde input.
`[NEW-SPEC]` No checksum is a trust mechanism; S04/S10 verify history instead.

**S03 — Durable-head CAS.** `expected_seq` MUST compare with the committed **event stream head**,
not the old cache sequence. Candidate sequence MUST equal `expected_seq`; disagreement returns
`InvalidSnapshot { reason: ExpectedSequenceMismatch }` before DB access. Save MUST acquire
`BEGIN IMMEDIATE` before reading head `H` (zero for absent stream). If `H != expected_seq`, return
`SequenceConflict { expected, actual: H }` and change nothing, including when an identical cache
already exists. It MUST NOT save ahead of history or an old candidate behind a changed head.
Events appended after a successful save may make that cache stale; this is allowed. `[NEW-SPEC]`

**S04 — Save provenance.** Under that same transaction, save MUST decode and reduce exactly the
persisted prefix `1..=H` from `SessionReducer::new(stream)`, checking every contiguous sequence,
stream, event schema, accepted A/B envelope field, and T020 legal transition/identity rule.
Read at most 256 events per page, with accepted 65,536-byte payload and 64-byte timestamp gates;
retain one page and one reducer, never the entire prefix. All pages MUST use the same
connection/transaction; calling public `load_after` would open an independent connection and is
forbidden for this verification. Count verified events with checked arithmetic, starting at zero
and stopping exactly at the bounded target; never increment beyond the target or use unchecked
sequence arithmetic. End-of-prefix must equal `H`, even if
a missing final row would otherwise resemble EOF. Compare **every** projection field to the
candidate, including last activity. A mismatch returns `SnapshotHistoryMismatch { seq }` with no
write. Malformed/gapped/unsupported durable rows return accepted `CorruptStore { stage }`;
semantic reducer failure returns `InvalidEventHistory { seq, reason }` (a closed safe enum, no
payload). Neither may be downgraded to a cache miss. The transaction prevents changes between
verification and cache commit. Identical retries also verify history; typed values alone never
prove provenance. `[NEW-SPEC]`

**S05 — Equal-sequence arbitration.** After S03/S04, a well-formed existing row at the same
sequence with the identical 96 canonical bytes MUST return `Ok(())` without a row write. With
different canonical bytes it MUST return `SnapshotConflict { candidate_seq, stored_seq,
reason: DifferentContent }` without replacement. The first committed bytes at each sequence
remain immutable; head CAS alone does not select a winner because snapshot writes do not advance
head. Serialized writers explicitly inspect the row under their writer lock. In unmodified
valid history, two different candidates cannot both pass S04: fabricated-but-legal contenders
fail provenance, and identical legitimate contenders both succeed with only one row insertion.
A syntactically valid but wrong existing cache remains conflicting; no implicit repair is allowed.
`[NEW-SPEC]`

**S06 — Monotonicity.** With no old row or an old valid row at lower sequence, verified save MUST
insert/replace one complete row. A stored sequence greater than candidate returns
`SnapshotConflict { reason: Regression, candidate_seq, stored_seq }`; it MUST NOT move backward.
Malformed/unsupported old cache **value** sequence, version, body or decoded body identity
returns `InvalidSnapshotCache { reason }`
without mutation, rather than inventing an ordering or overwriting it. A damaged lookup key, schema, index or
physical database is a `CorruptStore`/bounded storage error under S11, never InvalidSnapshotCache. Cache cleanup is a future
explicit operation. S03 precedes S04, then S05/S06; malformed old rows are classified only after
candidate/history verification. `[NEW-SPEC]`

**S07 — E1 write and visibility.** The fixed parameterized upsert MUST change only the named
stream's `snapshots` row, never `events`, identities, other streams, or schema. Use WAL, FULL sync
and the accepted five-second busy timeout, off the async reactor. SQLite commit is the only
success boundary for a changing save. Validation, conflict, codec, decode, reducer, busy or
statement failure MUST explicitly roll back the whole transaction (or drop a transaction guard
that guarantees rollback); SQLite statement rollback alone is insufficient. Before commit,
concurrent load sees the old row/absence; after commit it sees the complete new row. No partial
body may become visible. I/O/commit ambiguity may leave old or complete new cache, but never
partial cache or altered history; no error promises absence of a committed whole row.

**S08 — Cancellation, unknown completion and retry.** Dropping a save future or exceeding a
caller deadline does not stop a blocking worker. Completion is unobserved: old or complete new
row may be visible, and events MUST be unchanged. There is no added whole-operation deadline or
internal retry. Caller MUST NOT automatically retry an unknown completion. An explicit caller
reconciliation may repeat the exact snapshot and original expected head: success either writes
once or is S05 idempotent; head advancement returns S03 conflict; corrupt state/different equal
bytes fail closed. Conflict requires re-read/re-decide, never blind advancement of expected head.
A crash before commit leaves old/absence; after commit leaves complete row on restart. No separate
side-effect ledger is invented for this internal E1 cache transaction. Intent is the validated
snapshot, authorization is trusted in-process admission to the already configured store, started
is transaction admission, and outcome is typed committed/no-change/unobserved completion.

**S09 — Load disposition.** Dependent E0 load MUST open read-only, pin one explicit read
transaction for head, cache and verification pages, and perform no DDL/DML/pragma mutation or
repair. Absence, malformed/unsupported cache **values**, cache beyond 4096, zero/ahead-of-head value
sequence, wrong stream identity **inside the decoded body**, or decoded projection mismatch after S10 yields `Ok(None)` with no mutation.
A well-formed older row may be used; equality with current head is not required. The 4096 cap
applies to cached sequence S, not current head H: a cache at S=4096 behind H=4097 (or a higher
full-u64 head) remains loadable; a cache at S=4097 is a miss without prefix verification. Storage/Busy,
unsupported **database** identity or structural corruption is an error, not a cache miss.
A malformed cache **value** is a miss only when lookup key, SQL schema, indexes and physical
structure remain valid. Lookup-key CHECK/type/NOT NULL violations are store errors, including
when the body is otherwise readable; they are not discardable cache-value errors. None means caller must
replay durable history from zero; it makes no claim that history is valid. Corruption in history
not read by load (including after cache sequence) is detected by subsequent durable replay/reducer,
and MUST never be hidden by treating a cache as the authoritative session state. `[NEW-SPEC]`

**S10 — Load provenance and continuation.** For a supported candidate at `S <= H`, load MUST
replay and validate exactly `1..=S` in the same pinned transaction, with S04 page/resource/error
rules, and compare every decoded field. On equality return a snapshot wrapping the replayed
T020 projection, not decoded bytes. No reducer is initialized from stored fields. A caller that
needs a reducer must rebuild or reuse its **own** reducer verified by durable replay and then
apply durable events
`S+1..`; this method returns no reducer and cannot expose or let a caller retain its internal reducer;
this design does not introduce a public restore API. Cache verification does not prove
that history after `S` reduces; caller-owned continuation remains required. T030C must document
this limitation explicitly. Repeated E0 reads on unchanged state are equal. `[NEW-SPEC]`

**S11 — Schema identity.** New version-2 stores MUST retain application ID `0x43425831`
(decimal 1128421425) and the **exact** accepted `EVENTS_SCHEMA_SQL` identity, types, constraints,
indexes and event codec. User version becomes 2. The sole additional object is this exact DDL
identity (SQLite stores `CREATE TABLE` through `WITHOUT ROWID`, without trailing semicolon):

```sql
CREATE TABLE snapshots (
    stream_id BLOB NOT NULL PRIMARY KEY
        CHECK (typeof(stream_id) = 'blob' AND length(stream_id) = 16),
    seq ANY,
    codec_version ANY,
    body ANY
) STRICT, WITHOUT ROWID
```

Compare exact `sqlite_schema.sql` identities and exact user-object inventory: version 1 contains
only accepted `events`, version 2 contains only `events` and `snapshots`; verify SQLite's expected
internal PK/unique indexes separately, no extra triggers/views/tables/indexes. Matching IDs with
missing/drifted DDL is `CorruptStore { stage: Schema }`; wrong application ID, unknown nonzero
version, or nonempty unowned version 0 is `UnsupportedDatabaseSchema`. A foreign cache table is
not evidence of compatibility. Every successful v1/v2 open MUST run full
`PRAGMA integrity_check(1)` with CHECK evaluation enabled, preserving **all** accepted event
CHECK/type/NOT NULL/key/index invariants and physical/schema/index/lookup-key validation. It MUST
NOT disable CHECK validation or filter SQLite diagnostic strings to admit corrupt authoritative
events. Any integrity failure is a store error, not a cache miss.

Only disposable cache **value** columns `seq`, `codec_version`, and `body` are nullable ANY with
no value CHECK constraints. Their intentionally permissive SQL storage admits NULL, wrong type,
wrong width/version or malformed/oversized body without an integrity failure; SQL/application
codec validates each value separately. This concession MUST NOT apply to `events` or the fixed
BLOB lookup key. Production save emits only non-NULL, canonical correctly typed values: 8-byte
sequence BLOB, INTEGER codec version1 and 96-byte body BLOB. Bounds and version agreement are
unchanged. Cache lookup-key CHECK/type/NOT NULL damage, unexpected DDL/objects/indexes and
physical page/index corruption are store errors. A valid lookup key selecting a body with a
wrong decoded stream ID is instead a discardable value: load None, save InvalidSnapshotCache.
Test-only faults are injected after validation; no writable_schema or integrity-suppression
surface exists in production.
`[NEW-SPEC]`

**S12 — Narrow open transition.** Upgraded `open` MUST validate private path first, then lock
with `BEGIN IMMEDIATE`, then re-read application ID, user version and full object inventory;
pre-lock observations MUST NOT choose initialization or migration. An empty ID=0/version=0
object-free database creates exact events+snapshots+IDs/version2 in one transaction. Exact owned
version1 validates event schema/integrity, adds only snapshots and sets version2 atomically;
no event row is rewritten. Exact owned version2 validates and returns without schema DML.
Every other state fails closed with no migration. Concurrent openers re-read under the lock:
one initializes/upgrades, later ones validate version2, or return bounded Busy if lock expires.
On failure/crash before commit, reopening sees original exact v1 or empty v0 and may explicitly
retry open; after commit sees exact v2. No half-schema becomes usable. Rollback/close must finish
before any cleanup; existing files are never unlinked, and a newly created file must not be
unlinked after another opener could own it. Leave safe private empty files after failed new open
for later validated open. Open remains E1 and inherits S07 sync/worker rules. `[NEW-SPEC]`

**S13 — Compatibility and downgrade.** Upgraded append/replay MUST preserve their signatures,
full-u64 sequence order, bounded A/B codecs, E1 append and E0 replay; their fresh connections
MUST validate supported identity before accessing application tables. An already admitted v1
append/replay may finish while additive upgrade occurs; migration is writer-serialized, touches
no event row, and WAL readers keep their pinned event view. Upgraded handles accept exact v1
for append/replay during transition, exact v2 thereafter; snapshot methods require v2 and never
migrate implicitly. Legacy binaries reject v2 on a fresh `open` under their existing contract.
Legacy already-open handles lack per-connection version checks: they may still append/replay
unchanged events after upgrade, but provide no snapshots. Deployment MUST quiesce legacy processes
before switching; mixed-version operation is not a promised rollout protocol. Downgrade MUST
stop and restore an operator backup/select a v1 database; never reset user_version, strip the
cache table or copy history automatically. Historical A/B acceptance stays historical; future
schema-aware regression tests must update version assertions explicitly and prove preserved
A/B behavior, not claim unchanged test oracles. `[NEW-SPEC]`

**S14 — Security and bounded errors.** Snapshot methods inherit accepted administrator-only
canonical private directory/file ownership/mode/symlink policy, fixed SQL, bound parameters,
no extensions, and no browser/model/repository-selected path. No secret/path/payload/SQLite
message/SQL appears in errors, Debug, logs or metrics. Error payloads contain only bounded enums,
safe sequence integers and limits; Debug for snapshot MUST redact identifiers/time/content.
Every head/cache metadata query MUST gate SQLite type and exact 8-byte sequence/16-byte stream
width before copying into Rust; invalid durable head is CorruptStore, invalid cache **value** metadata is S09 miss or S06 save InvalidSnapshotCache; damaged lookup
key is a store error under S11. Codec version MUST be an INTEGER in u16 and exactly version1. SQL gates cache body to 96 bytes before allocation; prefix work is at most 4096 event decodes
and 16 pages, each at most 256 bounded events. Same-UID post-validation path replacement and
filesystem sync honesty remain accepted non-guarantees, not expanded protections.

**S15 — Observability and exit invariants.** No new persisted audit, provider effect, fanout,
internal retry, or log emission is introduced. Save success/error supplies safe typed outcome;
load returns verified projection or miss/error. On every exit, durable events and their metadata,
other-stream cache rows and domain trust boundary MUST remain unchanged by snapshot operations.
E0 concerns Codebox application tables/schema; OS access times and SQLite-owned transient WAL
shared memory remain outside the fingerprint. A usable returned snapshot MUST always equal its
validated persisted prefix.

**S16 — Acceptance gate.** Before runtime code, independent fresh-context review MUST accept
ADR, TD projection, this contract, all archetype answers and matrix below; until then tasks stay
blocked. Every named future test must first run as a compiling fixed-failure skeleton, then pass
with substantive assertions, followed by focused/workspace/security/fault/regression gates and
independent implementation acceptance. Design acceptance is not runtime or parent acceptance.

# Success Postconditions

S03/S04 prove head/projection equality at write time; S05–S07 prove one complete monotonic cache
row or identical no-op. S10 proves every returned projection equals durable-prefix replay.
Append/replay/history remain the sources of truth.

# Non-Guarantees

Save also checks all existing cache lookup keys through a fixed metadata-only SQL query.
This uses constant application allocation but may scan all cache keys; the 4096 bound applies
to event-prefix decoding, not this structural-key scan.

This correctness-first v1 cache replays its complete prefix to verify provenance. It holds the writer lock while verifying up to 4096 events, so competing append latency can
exceed lock timeout and return Busy; the five-second timeout bounds lock waiting, not transaction
duration. At the maximum, one page may hold 256×65,536 bytes (16 MiB) of payload plus bounded
metadata and decoder overhead; the total input scanned can approach 256 MiB. It does not
accelerate reducer startup and cannot snapshot beyond 4096 events. Ordinary A/B replay remains
available on larger streams; extending the budget or introducing trusted resumable reducer state
requires a later accepted contract. Cached last activity reflects highest event sequence, not save
time or monotonic wall clock. A cache does not establish tenant authorization or runtime sandbox
existence. No cryptographic tamper resistance, encryption, history compaction, automatic cache
repair, live fanout or mixed-version rolling deployment is claimed (S01/S04/S10/S13/S14).

# Exit Invariants

S07–S10/S15 cover success, checked failure, Busy, cancellation, lost completion and crash. No partial
cache or changed history; usable snapshots come exclusively from persisted-history replay.

# Side Effects

Only explicit upgraded open creates the version-2 table/identity and private SQLite sidecars.
Save performs one atomic cache transaction or identical no-op; load is read-only. Lifecycle and
ambiguous-outcome disposition are S07/S08/S12, without an extra ledger.

# Idempotency

S03 wins error precedence even over an existing identical row. At unchanged head an exact retry
verifies history and returns success without rewriting equal bytes. At changed head it conflicts.
Automatic unknown-completion retry is forbidden; explicit same-input reconciliation is bounded by
the caller, with no retry loop in this adapter (S05/S08).

# Concurrency and Ordering

S03–S07 serialize saver row arbitration with SQLite's writer lock; saves never advance event head.
A racing append either advances head before save's lock (conflict) or after save's commit (stale but
valid cache). Read transactions pin head/cache/prefix consistently; a reader sees old or new row,
never a hybrid (S09/S10). Timestamps do not order writes.

# Streaming Semantics

No live output or stream API. Verification uses bounded internal pages and returns only a complete
snapshot or error/miss; partial projections are not exposed (S04/S10/S14).

# Cancellation and Timeout

S07/S08 specify the five-second SQLite lock bound, blocking-worker continuation, no full-operation
deadline, no internal retry and explicit same-input reconciliation. Read cancellation discards
results and leaves E0 state; open cancellation may leave old/complete schema per S12.

# Failure Atomicity

Save and schema open are E1. Load is E0. Commit error can be unobserved whole-row visibility, never
partial state; statement failure must roll back the transaction (S07/S09/S12).

# Failure Modes and Error Contract

The D-owned variants are implemented; load dispositions remain T030C requirements. Validation precedes DB access; after that,
identity check → lock/head CAS → durable-prefix decode/reduce → existing-row arbitration → write/commit.

| Failure | Typed error/disposition | Caller action |
|---|---|---|
| Empty/out-of-range/mismatched sequence | `InvalidSnapshot { reason }` / `SnapshotPrefixTooLarge { max, actual }` | Correct input; no I/O occurred |
| Changed durable head | Existing `SequenceConflict { expected, actual }` | Replay and re-decide; no blind retry |
| Candidate differs from stored prefix | `SnapshotHistoryMismatch { seq }` | Rebuild from durable events |
| Semantically invalid durable history | `InvalidEventHistory { seq, reason }` | Stop projection; investigate; never cache fallback |
| Malformed/gapped/unsupported durable row | Existing `CorruptStore { stage }` | Stop projection; investigate |
| Equal different/regressing cache | `SnapshotConflict { candidate_seq, stored_seq, reason }` | Investigate or re-decide; no overwrite |
| Invalid old cache values during save | `InvalidSnapshotCache { reason }` | Explicit future cleanup/operator action |
| Invalid/unsupported cache values during load | `Ok(None)` | Replay from zero; no repair or deletion |
| Identity/schema incompatible | Existing `UnsupportedDatabaseSchema` / `CorruptStore { stage: Schema }` | Operator repair; no automatic migration beyond exact v1 |
| Lock timeout | Existing `Busy` | Bounded explicit same-input retry; no mutation from this transaction |
| Worker/storage failure or lost completion | Existing `WorkerUnavailable` / `Storage { operation, kind }` | Reconcile first; exact input only after explicit decision |

`InvalidSnapshot` reasons are Empty and ExpectedSequenceMismatch; cache reasons are Type, Width,
Version, Identity, Sequence, Status, Option, Timestamp; conflict reasons are DifferentContent and
Regression. `InvalidEventHistory` reasons map T020 reducer failures to WrongStream, Sequence,
SchemaVersion, MissingCreation, Transition, TurnIdentity, ApprovalIdentity, Overflow without body
or ID payload. Add safe `SnapshotRead`, `SnapshotWrite`, `SnapshotVerify`, `SchemaUpgrade` operation
classifications to existing storage errors; keep all old variants and A/B error mappings (S14).

# Security Contract

S02/S04/S11–S14 bound persisted input and preserve private domain projection fields. Untrusted
stored bytes never become reducer state. All identities are compared within one transaction;
Malformed cache values are discardable only with valid structural lookup key/schema/indexes;
key/physical corruption and corrupt durable history fail closed. No HTTP or model authority is
added.

# Observability and Audit Contract

S08/S14/S15 define safe typed phase/outcome, redacted Debug, no implicit logs or new audit tables.
Timestamps/identifiers remain data rather than authentication, actor leases, or idempotency keys.

# Test Specification

**D-owned and C-owned assertions are implemented and separately verified.**
The 29 D/D-shared names execute in the save suite; three C-only names and C portions of the ten
shared rows execute in T030C. Separate runtime reports record each evidence boundary. Names alone
do not establish coverage; the concrete oracles below remain normative.

| Clause | Layer / executable test | Concrete oracle | Acceptance owner |
|---|---|---|---|
| S01 | contract `snapshot_value_bounds_precede_database_access` | Delete database; seq4097 projection from public reducer fails before I/O; private pure sequence-policy helper rejects0 without domain forger; raw zero cache misses;1 and4096 encode; full-u64 A/B replay unaffected | D then C |
| S01/S02 | unit `snapshot_codec_is_exact_canonical_96_bytes` | All nine statuses/options/timestamp extrema including valid leap seconds round-trip to exact layout; unknown status/tag/nil ID/extra bytes fail | D |
| S02/S14 | security `snapshot_body_gated_before_allocation` | Raw wrong types and oversized blobs return load miss; SQL projects no oversized body into Rust | D then C |
| S03 | contract `snapshot_expected_sequence_is_durable_head` | Candidate/expected mismatch fails before I/O; absent stream/head0 fails; behind/ahead actual yields exact SequenceConflict; history/cache unchanged | D |
| S03 | concurrency `snapshot_append_race_obeys_writer_order` | Barrier runs both lock orders: save then append leaves valid stale cache; append then save conflicts; no event mutation by save | D |
| S04 | contract `snapshot_fabricated_legal_projection_is_rejected` | Invent legal envelopes at same stream/seq with different sandbox/time/turn; private typed projection rejected vs persisted prefix | D |
| S04/S10 | contract `snapshot_all_projection_fields_match_persisted_prefix` | Change each encoded field in cache/candidate; load None or save mismatch; accepted result equals fresh reducer including last_activity | D then C |
| S04/S10 | fault `snapshot_corrupt_history_never_becomes_cache_miss` | Gap, missing end, unsupported schema, malformed metadata/payload, illegal transition/turn/approval produce typed history errors, no writes | D then C |
| S04/S14 | boundary `snapshot_verification_has_page_and_total_bounds` | Sequence4096 reads 16 pages max256 on one connection/transaction, one page retained;4097 rejected/miss;cached4096 behind head4097 succeeds; checked endpoint/overflow counters; every event uses A/B size gates | D then C |
| S05 | concurrency `snapshot_same_head_identical_savers_are_idempotent` | Two connections same head: both Ok; one logical insertion; bytes unchanged by second; head unchanged | D |
| S05 | concurrency `snapshot_same_head_different_savers_do_not_overwrite` | Valid and fabricated candidate race: valid commits, fabricated fails provenance; raw test-only post-validation cache update creates valid-shape wrong equal row, then verified candidate yields DifferentContent after successful history validation; no replacement | D |
| S05/S08 | contract `snapshot_identical_retry_rechecks_head_and_history` | Same bytes at unchanged head verify and no-op; appended head conflicts; corrupted prefix returns error rather than idempotent success | D |
| S06 | contract `snapshot_regression_and_invalid_old_row_fail_closed` | Newer raw row yields Regression; malformed/unsupported existing yields InvalidSnapshotCache; lower row replaced only by verified newer candidate | D |
| S07/S15 | fault `snapshot_statement_failure_rolls_back_complete_row` | Test-only fault after write/before commit; fresh connection sees original/absent cache, byte-identical events and other streams | D |
| S07/S09 | concurrency `snapshot_read_transaction_sees_old_or_complete_new` | Reader pinned before write sees old head/cache/prefix through all pages; new reader sees complete new; no hybrid | D then C |
| S07/S08 | fault `snapshot_busy_storage_and_worker_failures_preserve_history` | Controlled lock, I/O/commit/worker faults yield bounded errors and old/complete cache only; history fingerprint unchanged | D |
| S08 | fault `snapshot_cancelled_future_requires_explicit_reconciliation` | Barriers before/after commit then drop future; worker may complete; no automatic retry; exact input reconciles or head conflicts | D |
| S08 | integration `snapshot_lost_reply_and_crash_restart_are_atomic` | Child process exits before commit/after commit; reopen sees old/new complete row; lost reply same-input no-op; history unchanged | D |
| S09 | contract `snapshot_load_absent_stale_corrupt_unsupported_is_e0` | Absent None; stale verified Some; ahead/zero/wrongstream/badversion/body None; all cache/event/schema fingerprints unchanged | C |
| S09/S10 | integration `snapshot_load_prefix_does_not_hide_corrupt_suffix` | Verified cache at S with invalid later history: load Some; required caller replay/reducer after S reports corruption; malformed cache values force full replay | C |
| S10 | contract `snapshot_load_returns_replayed_projection_without_restore` | Returned wrapper equals freshly reduced prefix; inspection/compile guard no Deserialize/setter/import/restore added to domain | C |
| S11 | security `snapshot_schema_identity_rejects_spoof_and_drift` | Wrong ID/version, missing/drifted DDL, extra table/index/view/trigger fail; no mutation; exact internal indexes accepted; cache value ANY columns admit malformed values while key CHECK/type/NOT NULL and schema/index/physical damage fail reopen/access as store errors | D |
| S09/S11/S13/S14 | integration `snapshot_malformed_value_columns_preserve_open_and_event_access` | For each nullable ANY value column independently: inject NULL, INTEGER, REAL, TEXT, BLOB wrong types/widths; seq zero/wrong8bytes, version negative/out-of-u16/future/mismatch, body oversized/truncated/header/body-stream mismatch. With CHECK enabled integrity is ok, exact open succeeds, ordinary append/replay remain exact; load None, verified-head save InvalidSnapshotCache, no snapshot write or history change from snapshot attempt; SQL copies no oversized value | D then C |
| S11/S13 | security `snapshot_event_integrity_still_rejects_reopen` | Scratch/test-only relaxed-schema injection restores exact event DDL, then corrupt event CHECK widths, STRICT types and NOT NULL separately; full enabled integrity rejects v1 upgrade/v2 reopen as store error even if corrupt event is outside a selected replay page; no cache fallback, migration or automatic repair | D |
| S12 | integration `snapshot_open_new_and_exact_v1_upgrade_to_v2` | New file private mode; v1 event rows/DDL identical; sole new table+version2; v2 reopen no DML | D |
| S12 | concurrency `snapshot_concurrent_open_rechecks_identity_under_lock` | New-new and v1-v1 barriers select one initializer/upgrader; later validates v2 or Busy; no unlink of another opener's DB | D |
| S12 | fault `snapshot_schema_upgrade_fault_and_crash_leave_old_or_complete` | Fault between DDL/version/commit and child crash: exact v0/v1 or v2 only; reopen explicitly retries; foreign/nonempty0 unchanged | D |
| S13 | regression `snapshot_v2_preserves_append_replay_and_rejects_downgrade` | Schema-aware A/B assertions preserve all operations/full-u64/errors; archived binary fresh open rejects v2; no reset/delete automatic downgrade | D |
| S13 | concurrency `snapshot_legacy_inflight_event_io_survives_additive_upgrade` | Pinned legacy reader keeps same rows; admitted append serializes safely; upgraded handles check exact v1/v2; deployment quiescence documented | D |
| S14 | security `snapshot_paths_and_debug_remain_private_and_bounded` | Relative/symlink/permissive/foreign path policy retained; path/body/secret canaries absent in every error and Debug; fixed SQL review | D then C |
| S15 | model `snapshot_model_never_changes_history_or_regresses_cache` | Generated multi-stream save/load/append schedules preserve history and per-stream monotonic committed cache, equal-seq immutable bytes | D then C |
| S16 | review `snapshot_design_and_runtime_acceptance_are_distinct` | Statuses match the delivery phase: accepted design permits D Ready but not runtime acceptance; skeleton failure evidence precedes code; reports and gates contain actual results | D then C |


## Acceptance ownership and execution order

The 32-name matrix spans **T030D and dependent T030C**, not 32 prerequisites for T030D.
`D` owns save, value/codec, schema/open and preserved A/B behavior. `C` owns public
`load_snapshot` and its E0/provenance behavior after D runtime acceptance and its own accepted
SPEC-T030C. `D then C` splits the stated oracle by public boundary: D tests save/private codec or
raw-SQL observers; C later tests public load and the complete shared CU-EVT-03 oracle. The same
name may appear in separate save/load test modules. D MUST NOT implement public load or claim
C's deferred assertions as passed to satisfy its own gate. D's acceptance report enumerates its
owned assertions and leaves C assertions explicitly planned, outside D acceptance.

In particular, D observes committed/old rows and pinned visibility through test-only raw SQL;
C repeats that evidence through `load_snapshot`. D's model uses save/append and raw row observation;
C adds public load. Value bounds, corrupt history, metadata allocation, field comparison, malformed
value columns, paths/errors and acceptance-stage checks split the same way. This avoids a circular
dependency and preserves one production Contract Unit per child. Each child's own named tests
must run as fixed-failure skeletons before that child's implementation (S16).

## Unit

Codec and safe error projection rows above; pure reducer trust compile/source guard.

## Contract

Exact-head, fabricated-projection, field-equality, equal retry, regression and E0-load rows above.

## Property / Model

Bounded generated interleavings against explicit S03–S06 state model; all assertions substantive.

## Integration

Restart and schema/new/v1/v2 compatibility rows above.

## Fault Injection

Barrier-controlled SQLite worker/commit/cancellation and subprocess crash rows above. Fault seams
are private test-only, cannot select SQL, event IDs, repair policy or cache values in production.

## Security

Schema spoof, allocation gates, typed-projection provenance, private paths and diagnostic canaries.

## Regression

Retain all accepted T010/T020/A/B behavior and `regression_ephemeral_not_persisted`, 10 Node P0 tests,
private P0 fake-provider E2E, Rust workspace fmt/clippy/test/build, locked cargo-deny and diff checks.
Update old initialization-version assertions only through the accepted schema transition; keep
historical acceptance unchanged. Runtime gates from component root, executed for T030D; exact results are in runtime acceptance:

```bash
cargo test --locked -p codebox-event-store --all-features
cargo test --locked -p codebox-domain --all-features
node --test --test-isolation=none apps/control-plane/web/p0-client.test.mjs
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace --all-targets --all-features
cargo build --locked --workspace --bins --all-features
cargo deny --locked check
git diff --check
```

# Acceptance Evidence

The historical [design review](../acceptance/T030D-design.acceptance.md) remains unchanged.
Separate [runtime acceptance](../acceptance/T030D.acceptance.md) records compiling RED, substantive
D-owned tests, regression gates, independent review and residual limitations. C-only and shared C
assertions are not claimed as runtime evidence.

# Traceability

CU-EVT-04 → S01–S08/S11–S16 (E1); dependent CU-EVT-03 → S02/S04/S09–S16 (E0).
TD §§4.4–4.6/INV-003/INV-004 → history remains authoritative; accepted T020/A/B → strict codec and
private projection preserved. [Traceability](../traceability.md) distinguishes separate D and C runtime evidence.

# TD Gaps

The prior snapshot concurrency/failure gap is resolved by accepted ADR-0005 and this design.
The initial independent review rejected global CHECK suppression; R1 was repaired with nullable
ANY cache values, full enabled integrity validation and an explicit value/structural corruption
partition. No unresolved high-risk design gap remains. D runtime, T030C runtime and parent
composition passed separate gates. The C extrema discovery was resolved by accepted ADR-0006
before codec repair; new discoveries must become an ADR or concrete TD-GAP rather than improvised behavior.

# Self-Check

| Archetype question | Answer / clauses |
|---|---|
| E: legal transition? | Verified candidate at exact durable head; first bytes immutable; newer row only, S03–S06 |
| E: concurrent winner and ordering? | Writer lock plus explicit row arbitration; identical both succeed, fabricated different rejected; append ordering S03/S05/S07 |
| E: failure, retry, recovery? | Whole row or old, rollback, explicit reconciliation, subprocess restart S07/S08/S12 |
| D: result ordering/limits/consistency? | No streamed result; internal ordered pages<=256,total<=4096; pinned read/write transaction S04/S09/S10/S14 |
| D: corruption and EOF? | Exact prefix endpoint; durable errors never misses; bad cache values None; key/physical corruption errors; suffix replay required S04/S09/S10 |
| B: containment/path malicious input? | Inherited private administrator path, non-symlink owner/mode, fixed SQL, no imported reducer state S11–S14 |
| B: allocation, cleanup, cancellation? | 96-byte gates, bounded total work, read E0; no unsafe unlink of shared new DB; worker may finish S02/S08/S12/S14 |
| All: preconditions/error precedence? | Type/checked table, S01/S03 then schema/head/history/old-row/write; bounded error enums |
| All: observability/side effects/non-guarantees? | Typed phase/outcome, no secret logs/new ledger, correctness-first full replay and explicit cap S08/S14/S15 |
| All: contract proof/readiness? | Every S clause maps to names/oracles; D and C runtime plus parent composition separately accepted |
