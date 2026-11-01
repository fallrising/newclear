---
id: SPEC-T030C
title: SQLite verified snapshot cache load
status: verified
contract_unit: CU-EVT-03
module: codebox-event-store
milestone: P1
archetype: B
atomicity: E0
invariants: [INV-003, INV-004]
depends_on: [SPEC-T020, SPEC-T030A, SPEC-T030B, SPEC-T030D]
td_sections: [4.4-4.6, 8.1-8.10, 9.3, 10.3-10.6, 11.1-11.4, 14]
adr_refs: [ADR-0005, ADR-0006]
risk: medium
---

# Intent

Specify the public `load_snapshot` boundary independently of the accepted D save/schema boundary.
The [independent design review](../acceptance/T030C-design.acceptance.md) accepts this contract
for test-first implementation. The [T030C task](../tasks/T030C.task.md) is now Accepted by a
separate [runtime review](../acceptance/T030C.acceptance.md); design alone does not grant runtime
or parent acceptance. [ADR-0005](../adr/ADR-0005-snapshot-cache-contract.md) and
[SPEC-T030D](SPEC-T030D-sqlite-snapshot-save.md), especially S02/S04/S09–S16, are the accepted
design authority. This document projects those requirements onto CU-EVT-03; it does not reopen
D save arbitration or the version-2 schema transition. Every normative C clause below traces
to those sources or a marked local derivation.

# Responsibility

## Does

Read one optional cache, classify disposable values separately from store damage, verify its
bounded persisted prefix through the accepted reducer, and return an immutable wrapper of that
replayed projection through an E0 boundary. Specify consistency, cancellation, restart,
resource limits, safe errors and public-load acceptance.

## Does Not

Save or produce cache rows; initialize, migrate, repair, delete, compact or upcast history;
add an actor, provider, network, lease, audit table or authentication boundary; expose the
internal reducer; or add a projection import/deserialization/restore API. Public event replay
and caller-owned suffix reduction remain separate operations.

# Public Boundary

The implemented method is the sole production boundary owned by this child:

```rust
impl SqliteEventStore {
    pub async fn load_snapshot(&self, stream: SessionId)
        -> Result<Option<SessionSnapshot>, EventStoreError>;
}
```

Existing D-owned types are reused without expanding their authority:

```rust
pub const MAX_SNAPSHOT_BYTES: usize = 96;
pub const MAX_SNAPSHOT_PREFIX_EVENTS: u64 = 4096;
pub struct SessionSnapshot { /* private SessionProjection; no Deserialize */ }
impl SessionSnapshot {
    pub fn from_projection(projection: SessionProjection) -> Result<Self, EventStoreError>;
    pub fn projection(&self) -> &SessionProjection;
}
```

`from_projection` proves only legal shape and sequence bounds. Persisted provenance comes from
C06, not from a typed wrapper. No new public parameter supplies a path, SQL, codec choice,
page limit, reducer, projection fields or repair policy. Trace: TD §4.6; D S01/S09/S10/S14.

# Inputs and Outputs

`SessionId` is an accepted non-nil T010 identifier. The store contains an administrator-chosen
path admitted by `open`; callers cannot select it per load. Let `H` be the committed selected
stream head in the pinned read view, zero if absent, and `S` the selected cache sequence.
Both use full-u64 big-endian event sequence representation; only usable cache S is bounded.

`Ok(Some(snapshot))` contains the prefix projection at S: session ID, last sequence, status,
optional active turn, pending approval and sandbox, and exact last activity. It does not contain
event bodies, conversation messages, provider output, secrets or an internal reducer.
`Ok(None)` is a cache miss: absent, malformed, unsupported, out of budget, ahead of history, or
different from verified history. It is not an empty session result or a history-validity claim.
`Err` preserves a bounded structural, storage, worker or observed-history failure. Trace: D
S01/S02/S09/S10/S14/S15; TD §§4.4–4.6/8.2.

# Preconditions and Disposition

| ID | Condition | Type / Checked / Internal | Disposition and trace |
|---|---|---|---|
| P01 | Non-nil selected stream | Type | T010 `SessionId`; nil cannot enter this method |
| P02 | Private configured database path | Type/construction invariant | Accepted A/D `open` policy; no per-load path construction or file creation, C01 |
| P03 | File can be read and blocking worker joined | Checked | Bounded `Storage`/`Busy`/`WorkerUnavailable`; C01/C09 |
| P04 | Exact owned schema version2 and structural keys/indexes | Checked | Unsupported identity or store corruption error; C02 |
| P05 | Durable head has correct type and exact width | Checked | `CorruptStore { stage: Sequence }`; C03 |
| P06 | Cache exists and has supported canonical values | Checked as optional cache disposition | Miss rather than public cache-validation error; C04 |
| P07 | Cache sequence is nonzero, <=4096 and <=H | Checked as optional cache disposition | Miss, no prefix reduction; C05 |
| P08 | Observed durable prefix decodes and reduces exactly to S | Checked | Typed history error, never miss; C06 |
| P09 | Every cache field matches the replayed projection | Checked as optional cache disposition | Miss on difference, otherwise replayed wrapper; C07 |
| P10 | Test seams cannot change production policy or SQL | Internal | Private test-only barriers/faults; D S11/S15, C11 |

# Numbered Normative Contract

**C01 — E0 admission and cleanup.** The method MUST execute SQLite I/O off the async reactor
on a blocking worker using a read-only connection with no create flags and the accepted
five-second SQLite busy timeout. It MUST NOT call path preparation, schema initialization or
the write-connection helper. It MUST perform no DDL, DML, mutating pragma, journal/sync
configuration, migration, repair or file recreation. One explicit deferred read transaction
MUST cover identity, structural checks, head, cache and every verification page; its first read
pins the view. All statements, rows, transaction and connection MUST be released on success,
miss, checked failure and worker unwind. No writer lock is required. Trace: D S09/S10/S13–S15;
TD §§8.5–8.7. Connection-local busy-timeout configuration is allowed; it changes no application
state. Read-only identity/index pragmas are allowed; `BEGIN`/read-transaction close are not
application writes.

**C02 — Structural trust before cache disposition.** Within C01's pinned transaction, load
MUST require application ID `0x43425831` (1128421425), user version2, exact D-owned event and
snapshot DDL/object inventory, and the accepted internal PK/unique index identities. Version1
is valid only for A/B during transition; load MUST reject it and MUST NOT upgrade it. Wrong
application ID/unsupported database version yields `UnsupportedDatabaseSchema`; supported IDs
with drifted/missing/extra objects or malformed lookup keys yield `CorruptStore { stage: Schema }`.
The fixed `stream_id` lookup key remains non-NULL BLOB length16 with its CHECK/STRICT/PK
constraints. Inspect all existing lookup keys through fixed metadata-only SQL so a damaged key
cannot disappear behind an absent selected row. A valid key with the wrong stream inside its
body is instead C04's value miss. Physical/index corruption surfaced by SQLite MUST remain a
bounded store error. No integrity suppression or SQLite-diagnostic-string filtering is allowed.
Trace: ADR-0005 decisions6/7; D S09/S11/S13/S14.

The accepted full CHECK-enabled `PRAGMA integrity_check(1)` is mandatory at D-owned `open`/
reopen, including authoritative event integrity outside selected pages. C MUST preserve that
gate; it MUST NOT claim to run a new full-database integrity scan on every load. Per-operation
identity/index/key checks and errors from pages actually read are distinct from reopen integrity
validation. Unobserved post-open history damage has C08's explicit limitation. Trace: D S09–S14.

**C03 — Ordered durable-head inspection.** After structural checks, load MUST read H from
the selected stream using fixed bound SQL and gate head sequence type BLOB/length8 before
copying it into Rust. An absent stream yields H=0; a malformed stored head yields
`CorruptStore { stage: Sequence }`, even if the selected cache is absent or malformed. A
valid high head is not by itself a proof of a contiguous or reducible prefix. Load MUST NOT
cap H at4096, convert it through SQLite signed sequence integers, or advance it. Trace: D
S09/S10/S14; `[NEW-SPEC]` This operation orders head inspection before optional cache
disposition to keep its observed durable metadata errors deterministic.

**C04 — Cache value gating and misses.** Only after C02/C03, query the selected row using
fixed parameterized SQL. SQL MUST project sequence only for BLOB length8, codec_version only
for INTEGER in `0..=65535`, and body only for BLOB length96; NULL/wrong-type/wrong-width values
MUST NOT be copied as unchecked content. Cache columns `seq`, `codec_version`, `body` remain
nullable ANY exactly as accepted in D. The SQL codec version must be1 and agree with the body.
An absent row, value-gate failure, unsupported value version or malformed body yields `Ok(None)`.
Only `InvalidSnapshotCache { reason }` from the existing private value reader may be converted
to None; `Busy`, `Storage`, `CorruptStore` and all other errors MUST propagate. Structural lookup
key/schema/physical damage MUST NOT be caught as a value miss. Trace: D S02/S06/S09/S11/S14.

Supported body syntax is the exact D S02 canonical96 layout: `CBS1`, big-endian u16 codec1,
u16 event-schema1, non-nil16-byte stream,8-byte sequence, status0–8, three17-byte option-ID
slots (zero tag/zero UUID or one tag/non-nil UUID), signed8-byte UTC timestamp seconds and
4-byte nanoseconds. Body stream and sequence MUST agree with selected stream/SQL metadata.
All accepted Chrono timestamps, including valid leap-second representations, retain exact
precision; bad status/option/time/header/identity is a value miss. No public domain object is
constructed from these bytes. Trace: D S01/S02/S09/S10.

**C05 — Cache sequence, not head, bounds work.** A supported S MUST satisfy `1<=S<=4096`
and `S<=H` before verification. Otherwise load MUST return None without decoding prefix events.
H=0 therefore cannot yield a usable cache. H may exceed4096 or reach `u64::MAX`; S at or below4096
remains eligible. A stale S<H is valid if its prefix verifies; equality to H is not required.
Load MUST NOT convert an over-budget cache into `SnapshotPrefixTooLarge` or assume an ahead
cache proves corrupt history. Trace: ADR-0005 decision5; D S01/S09/S10/S14.

| Cached S | Durable H | Disposition before provenance |
|---|---|---|
| Absent | 0 or any valid H | None |
| 0 | Any valid H | None |
| 1 | 0 | None (ahead) |
| 1 | 1 | Verify exactly1 event |
| 1 | 4097 or u64::MAX | Verify exactly1 event |
| 4096 | 4095 | None (ahead) |
| 4096 | 4096 | Verify exactly4096 events |
| 4096 | 4097 or u64::MAX | Verify exactly4096 events; older cache eligible |
| 4097 | 4096,4097 or u64::MAX | None (budget); zero prefix decodes |

**C06 — Persisted-prefix provenance.** For an eligible cache, load MUST create
`SessionReducer::new(stream)` and decode/reduce exactly sequences `1..=S` in ascending contiguous
order on C01's connection/transaction. Each page is at most256 accepted A/B envelopes; each
event payload is gated to at most65,536 bytes, timestamp to1..=64 bytes, IDs/sequences to exact
accepted widths/types and schema to accepted version1 before allocation/decoding. Validate all
accepted envelope fields and reducer creation/transition/turn/approval identities. Retain at
most one bounded page and one reducer, never collect the prefix or call public `load_after`
which opens another connection. Existing `verify_prefix` streams row-by-row within those pages.
Counters MUST use checked advancement, stop exactly at S and never wrap or advance beyond S.
At most4096 event decodes and16 pages are permitted for an eligible valid prefix. Missing,
gapped, out-of-order, unsupported or malformed observed durable rows, including premature EOF
before S, MUST return `CorruptStore { stage }`; no early EOF may become success or miss. Legal
decoding followed by reducer failure returns `InvalidEventHistory { seq, reason }` using the
existing closed safe reason enum. Trace: ADR-0005 decision2/5; D S04/S09/S10/S14.

**C07 — Compare every field; return replayed state.** After successful C06, load MUST compare
all decoded cache fields against that replayed projection, including last activity seconds/nanos,
stream, sequence, lifecycle status and every optional identifier. Canonically encoding a wrapper
of the replayed projection and comparing all96 bytes is permitted and matches existing helpers;
no unchecked decoded projection constructor is needed. Difference yields None, not
`SnapshotHistoryMismatch`. Equality yields `Some(SessionSnapshot)` wrapping the freshly replayed
projection. Stored bytes MUST never initialize or restore a reducer. Trace: D S02/S04/S09/S10/S15.

**C08 — Continuation and meaning of a miss.** None MUST make no claim that any history
is absent, valid, reducible or safe. The caller MUST replay durable history from sequence0 to
obtain a reducer after a miss. Some proves only prefix `1..=S` in the pinned view, not the current
head projection or validity after S. A caller needing mutable reduction MUST rebuild or reuse
its own reducer already verified against durable history at S, then apply events `S+1..` through
accepted durable replay and T020 reduction. This method exposes no internal reducer and grants
no restore authority. Structural decoding failures in suffix replay and semantic reducer errors
remain errors; the cache MUST NOT hide either. It may return Some when later history is invalid
but not observed by this load. Trace: TD §§4.4–4.6; D S09/S10.

**C09 — Concurrency, cancellation, timeout and retry.** All reads within one operation MUST
see the same pinned SQLite view. A concurrent save/append after that view is pinned may commit;
this reader sees its original head/cache/prefix, while a later reader may see the complete new
state. Never mix an old head with a new cache or verification page. No partial saved body may
be visible. Repeated reads on unchanged state MUST be equal; separate calls during writes need
not return equal results. There is no whole-operation deadline, internal retry or rate limiter.
The five-second busy timeout bounds SQLite lock waiting, not prefix work or blocking-worker
queue delay. Dropping a future or timing it out does not stop its blocking worker; it may finish
reading, but cannot mutate application state. A lost load reply requires no E1/E3 write
reconciliation: a caller may perform a bounded E0 retry, obtaining a new pinned view. Every
retry still runs C02–C07. Worker join failure is `WorkerUnavailable`. Trace: TD §§8.5–8.8;
D S07–S10/S14/S15; `[NEW-SPEC]` Load-only lost-reply/retry projection follows E0 and does not
inherit save's unknown-write-completion rule.

**C10 — Exit invariants, restart and security.** On success, miss, failure, cancellation,
deadline and process crash, load MUST leave Codebox events, all cache rows including the
selected row, schema, indexes, application ID and user version unchanged. Close/rollback of
read resources is sufficient; no compensating application write is allowed. Reopening after
load interruption MUST observe the same logical application state except independent concurrent
writes. Missing files MUST remain missing after a failed load. Restart of the store uses D-owned
open validation, not load-triggered initialization. OS access times and SQLite-owned transient
WAL shared memory are excluded from the E0 fingerprint. Errors, Debug and any diagnostics MUST
omit paths, raw SQLite/SQL strings, IDs, timestamps, payloads and secret canaries; payloads contain
only accepted bounded enums, schema integers and safe sequence integers. Snapshot Debug stays
redacted. No HTTP/model authority, log, metric label or audit table is added. Trace: TD §§8.1–8.8;
D S09/S11–S15.

**C11 — Resource scope and non-guarantees.** The96-byte body gate and4096-event total cap
MUST remain independent of database/history size. One maximum page accounts for up to16MiB
of payload bytes plus metadata/decoder overhead; total prefix input can approach256MiB.
Actual row-streaming can retain less. These are application input/retention bounds, not a total
process-memory or SQLite page-cache limit. Fixed metadata key scans can inspect all existing
snapshot keys with constant application allocation; identity/index inventory checks are not
bounded by S. There is no total operation latency guarantee. Cache verification does not
accelerate reducer startup. Same-UID post-validation filesystem replacement and dishonest
filesystem sync behavior remain inherited non-guarantees; load introduces no extra containment
promise. Fixed parameterized SQL, no extensions and no repository/browser/model-selected paths
MUST remain. Private test seams may observe phase/page/allocation/cancellation and inject bounded
faults but MUST NOT be production APIs or policy bypasses. Trace: D S02/S04/S11/S14/S15 and its
Non-Guarantees; TD §§8.5/8.8.

**C12 — Independent acceptance and phase truth.** Before C production implementation,
fresh-context independent review MUST accept this draft, archetype answers and every planned
oracle. T030C stays blocked until then. Every named C-owned/shared-C test below MUST first
run as a compiling fixed-failure skeleton and then pass with substantive assertions. C runtime
acceptance additionally requires focused/workspace/regression/security/fault gates, current
rustdoc/signature projection and traceability, and a separate fresh-context implementation
acceptance report. D design/runtime and historical A/B acceptance MUST remain historical and
unchanged; update only current phase-aware assertions that public load was previously absent.
Parent T030 acceptance MUST separately require accepted A/B/C/D children and independent
append/replay/save/load composition review. Design acceptance does not imply runtime or parent
acceptance. Trace: D S16/Acceptance ownership; TD §§9.3/10.3–10.6/11.1–11.4.

# Success Postconditions

C07 Some equals fresh durable-prefix reduction at S in C01's view, with every projection field
preserved. C04/C05/C07 None conveys only unusable/absent cache. C08 gives the caller's subsequent
work; C10 guarantees no application mutation for either successful result.

# Non-Guarantees

C08/C11 define the limits: no current-head/suffix-validity claim, no restore capability, no
reducer startup acceleration, no operation deadline/overall memory bound, no per-load full
integrity scan, and no protection against inherited same-UID path replacement. Cache S<=4096
does not limit H or normal A/B replay. Appends made after the pinned view may make the result
stale before its future resolves.

# Exit Invariants

C10 applies at every exit. Some additionally satisfies C07 provenance; None leaves the caller
responsible for full replay; no result repairs a cache or weakens private T020 fields.

# Side Effects

C01 permits connection/statement/read-transaction allocation and SQLite-owned read bookkeeping
only. There is no durable application side effect, authorization ledger, provider call, write
intent or write outcome. C10 defines the E0 fingerprint and excludes OS/SQLite transients.

# Idempotency

C09: unchanged logical data under the same successful read conditions yields equal cache
dispositions and projections, including repeat misses. Deterministic observed corruption remains
typed; environmental lock, storage and worker availability can differ between calls. Concurrent
writes can make independently pinned calls differ. A load retry has no idempotency key and does
not retry or reconcile a preceding save on the caller's behalf.

# Concurrency and Ordering

C01/C09 own read consistency; C02→C03→C04→C05→C06→C07 is the required disposition order.
Structural and observed-head errors precede even absent/malformed cache values. Malformed,
ahead, zero and over-budget values stop before prefix verification; no history claim follows.
For an eligible cache, prefix error precedes projection difference. Caller-controlled IDs cannot
change this precedence. D alone owns concurrent writer admission and cache arbitration.

# Streaming Semantics

No stream escapes this API; the result is one optional immutable snapshot. Internal C06 pages
are ordered by full-u64 sequence, terminate exactly at S, and obey256-event backpressure by
processing/releasing a page before the next. Partitioning a valid prefix at1/255/256/257/4096
boundaries MUST produce the same projection and error semantics. Cancellation behavior is C09;
there is no consumer channel or public continuation token. Trace: D S04/S10/S14; TD §8.5-D.

# Cancellation and Timeout

C09 applies to future drop, caller deadline and lost reply; workers release resources when they
finish. C10 holds even while a cancelled load worker remains alive. A busy lock is a bounded
error, not an empty cache; no code assumes WAL `BEGIN IMMEDIATE` alone blocks a reader.

# Failure Atomicity

E0 applies to all outcomes per C01/C10. Before/after proof compares logical event rows and
their metadata, every snapshot row with raw SQLite types/values, exact schema/index inventory,
application ID and version. Fixtures deliberately contain other streams and malformed nullable
cache values so equality cannot be established by decoding only selected valid rows. Fingerprint
reads use a separate observer and a quiescent fixture; concurrent-writer tests distinguish the
writer's permitted delta from the load's empty delta. Process-restart proof includes load pinned
and after verification/lost-reply exits, with no application commit point to invent. Trace: TD
§§8.6/8.7/11.1; D S09/S15.

# Failure Modes and Error Contract

The existing `EventStoreError` enum is reused. Only observed C-reachable variants are promised;
save-only validation/conflict/mismatch errors MUST NOT leak through cache disposition.

| Case | Error/result | Retriable | Caller action / required safe payload | Trace |
|---|---|---:|---|---|
| Absent or invalid cache value, S0/ahead/>4096, projection difference | `Ok(None)` | E0 read allowed | Replay from0; no validity claim; no error payload | C04/C05/C07/C08 |
| Wrong app ID, v1 or unsupported DB version | `UnsupportedDatabaseSchema` | No until configuration changes | Select validated v2/open explicitly; expected/actual u32 identity fields | C02 |
| Drifted schema/object/index/key or surfaced physical corruption | `CorruptStore { stage: Schema }` | No until operator repair | Stop/repair separately; bounded stage only | C02/C10 |
| Malformed durable head or observed prefix gap/EOF | `CorruptStore { stage: Sequence }` | No until operator repair | Preserve history; no cache fallback | C03/C06 |
| Malformed observed envelope/schema/payload | `CorruptStore { stage }` | No until operator repair | Existing EventId/StreamId/SchemaVersion/Timestamp/CausationId/CorrelationId/Payload stages | C06 |
| Decoded prefix fails reducer | `InvalidEventHistory { seq, reason }` | No until operator repair | Existing WrongStream/Sequence/SchemaVersion/MissingCreation/Transition/TurnIdentity/ApprovalIdentity/Overflow enum; no body/ID | C06 |
| SQLite lock wait expires | `Busy` | Bounded E0 retry | Re-read a new view; no internal retry | C01/C09 |
| SQLite open/configure/read failure | `Storage { operation, kind }` | Bounded E0 retry if transient | Existing safe operation and ReadOnly/Full/Io/Constraint/Other kind; no raw source text | C01/C10 |
| Blocking worker cannot join | `WorkerUnavailable` | Bounded E0 retry | New read, preserve completed reader cleanup; no write uncertainty | C09/C10 |

Operations preserve existing helper mapping: Open/Configure/Begin, Initialize for identity pragma
reads, ReadHighWater, SnapshotRead for key/value SQL and SnapshotVerify for prefix SQL. SQLite
corrupt/not-a-database codes map to Schema corruption; busy/locked codes map to Busy. Private
cache reader `InvalidSnapshotCache` becomes None only in C04. Public load does not emit
`InvalidSnapshot`, `SnapshotPrefixTooLarge`, `SnapshotHistoryMismatch`, `SnapshotConflict`,
`InvalidSnapshotCache`, append admission failures or `InvalidReplayLimit`. Pure defensive
mapping guards may test unreachable reducer reason variants without manufacturing public
domain state. Trace: D S04/S09/S10/S14; actual `error.rs`/`map_sqlite`/`history_reason` helpers.

# Security Contract

C02/C04/C06 partition disposable cache values from structural/authoritative state. C01/C11
keep resource access local and administrator-admitted, SQL fixed and allocation gated. C07/C08
preserve reducer provenance rather than deserialize trusted-looking state. C10 redacts outward
errors/Debug. D-owned private path admission and full integrity-enabled reopen tests remain
mandatory regressions; load does not call writable preparation to repeat them.

# Observability and Audit Contract

C10 provides typed Some/miss/error and safe stage/operation fields without new logs, metrics or
audit persistence. A cache timestamp is event data, not a freshness/authorization claim. No
payload/path/ID/time enters error Debug. Private test phase observations are not public telemetry.

# Test Specification

All names below now have substantive passing C oracles; exact executed commands and results
are recorded in [runtime acceptance](../acceptance/T030C.acceptance.md). Shared names repeat
D's exact executable names in a separate public-load suite; D's existing raw-SQL/
save assertions remain in their own module. Each test MUST call the public `load_snapshot`
for its public oracle; private seams supply deterministic fault/barrier/allocation observations.
The implemented `snapshot_load_tests` module is separate from D's `snapshot_tests`.
Test data uses public accepted reducer construction; no domain forgery
or production corruption interface is introduced. Trace: C12; TD §11.1.

## Contract mapping: all C-owned and shared-C D matrix rows

| C clause / D clause | Executable name (ownership) | Substantive C oracle |
|---|---|---|
| C04/C05 / S01 | `snapshot_value_bounds_precede_database_access` (D then C) | Raw selected S0 and S4097 yield None with0 verification pages; S1/S4096 are eligible; cache policy never truncates normal full-u64 A/B replay. D's constructor-before-I/O oracle remains D-owned. |
| C04/C11 / S02/S14 | `snapshot_body_gated_before_allocation` (D then C) | For NULL/INTEGER/REAL/TEXT and bodies0/95/97/1,000,000 bytes, public load None; instrument fixed SELECT projection to prove wrong/oversized body is NULL before Rust allocation; valid96 bytes proceeds. Check logical fingerprint unchanged. |
| C06/C07 / S04/S10 | `snapshot_all_projection_fields_match_persisted_prefix` (D then C) | Mutate each encoded stream/seq/status/turn/approval/sandbox/time seconds/nanos field, using syntactically valid alternatives where possible; load None; matching states across all9 statuses/options and accepted time extrema/leap seconds equal independent fresh reduction. |
| C03/C06 / S04/S10 | `snapshot_corrupt_history_never_becomes_cache_miss` (D then C) | Eligible valid cache plus prefix gap, missing final target, unsupported schema, malformed each envelope metadata/payload, missing creation and illegal transition/turn/approval: exact CorruptStore stage or InvalidEventHistory seq/reason, never None. Keep H>=S when testing missing target (valid higher row) so ahead-cache disposition cannot mask the oracle. Fingerprint unchanged. |
| C05/C06/C11 / S04/S14 | `snapshot_verification_has_page_and_total_bounds` (D then C) | S4096 visits exactly16 pages <=256 on one pinned connection and never retains total prefix; S4097 miss with0 prefix work; S4096/H4097 and S4096/Hu64::MAX remain Some with exactly4096 decodes; S1/Hhigh, S>H, zero and endpoints use table above. Instrument counters and SQL payload/timestamp gates; checked terminal arithmetic and no suffix decode. |
| C01/C09 / S07/S09 | `snapshot_read_transaction_sees_old_or_complete_new` (D then C) | Public-load barrier after pin: concurrent writer pauses after whole cache write/before commit then commits save+append between >=2 verification pages. Reader returns old verified S with original H/pages; fresh reader returns complete new cache; no partial body/hybrid. Include initially absent cache. |
| C01–C07/C10 / S09 | `snapshot_load_absent_stale_corrupt_unsupported_is_e0` (C) | Empty/absent row None; fresh and stale verified Some; zero/ahead/wrong body stream/bad version/body/projection mismatch None; compare every application-state fingerprint component on each outcome. |
| C08 / S09/S10 | `snapshot_load_prefix_does_not_hide_corrupt_suffix` (C) | Cache at valid S yields Some while later syntactically corrupt event makes load_after fail; separate decoded illegal transition suffix makes caller-owned reducer fail. Repeat malformed cache->None then replay from0 exposes same failures; cache never claims complete session. |
| C06–C08 / S10 | `snapshot_load_returns_replayed_projection_without_restore` (C) | Public Some equals independently reduced1..S including last_activity. Compile/source inspection guard proves domain private fields, no Deserialize/setter/import/restore, no exposed reducer and no public load_after invocation inside verifier. Demonstrate caller-owned verified reducer continuation separately. |
| C02/C04/C10 / S09/S11/S13/S14 | `snapshot_malformed_value_columns_preserve_open_and_event_access` (D then C) | For each ANY column separately inject NULL/INTEGER/REAL/TEXT/BLOB wrong types/widths, seq0/wrong8bytes/4097, version negative/>u16/future/mismatch, body truncated/oversized/header/wrong stream. CHECK-enabled integrity/open and ordinary append/replay retain exact behavior; public load None, verified-head save InvalidSnapshotCache, and snapshot attempts leave raw values/history unchanged. |
| C01/C10/C11 / S14 | `snapshot_paths_and_debug_remain_private_and_bounded` (D then C) | Preserve private path-admission regressions; public load errors/Some Debug omit path/SQL/payload/ID/time/secret canaries and bounded errors stay safe. Fixed SQL inspection and no write helper call. Deleted-file public load error leaves path absent. |
| C07/C09/C10 / S15 | `snapshot_model_never_changes_history_or_regresses_cache` (D then C) | Deterministic generated multi-stream append/save/public-load schedules against independent reducer/cache model; every Some equals pinned prefix, every miss expected, loads cause zero table/schema delta, save monotonicity/equal-byte immutability remain D truths. Include unchanged-state repeated reads. |
| C12 / S16 | `snapshot_design_and_runtime_acceptance_are_distinct` (D then C) | Phase-aware document/source guard distinguishes D accepted boundary from draft/Ready C and later accepted C; C design alone never marks runtime/parent accepted. Replace current D absence-of-load source assertion only when C is introduced; keep historical acceptance documents unchanged. Assert C/parent own required reports/gates, no synthetic pass claims. |

## Additional C-only public evidence

| Clause | Executable name / layer | Substantive oracle |
|---|---|---|
| C02–C07 | `snapshot_load_disposition_order_preserves_observed_store_errors` / contract/security | Unsupported/v1/DDL/index/key damage with absent or malformed selected value returns structural error first; malformed head with absent/malformed cache returns Sequence error; valid H plus malformed value and corrupt unread prefix returns None with0 prefix pages; eligible value plus corruption and field mismatch returns history error first. Invalid key in another stream remains Schema error with constant metadata-only allocation; valid key/wrong body stream is None. |
| C01/C09/C10 | `snapshot_load_busy_storage_and_worker_failures_are_e0` / fault | Induce actual incompatible SQLite reader lock (not just normal WAL writer), measure bounded Busy; private bounded read faults at pinned/cache/page/verified phases preserve exact operation/kind and application fingerprint. Drive join failure through public await with test-only worker fault, assert WorkerUnavailable rather than merely testing a disconnected await helper. No internal retry; healthy subsequent load proves resources released. |
| C01/C09/C10 | `snapshot_load_cancelled_or_timed_out_future_is_e0` / fault | Public load worker barriers before pin/after pin/between pages/after verification; drop or caller-timeout future, allow worker to finish, then release/observe resource cleanup. Application fingerprint identical, later healthy load works, no extra load spawned internally. Explicit repeated E0 read may see newly committed writer state. |
| C01/C02/C10 | `snapshot_load_missing_file_does_not_recreate_or_upgrade` / security/integration | Open valid handle, remove file with all observer connections closed, public load returns Storage(Open,Io), path remains absent; replace fixture with exact v1 under admitted handle, load UnsupportedDatabaseSchema and raw schema/version/event fingerprint unchanged. No implicit create/migration or mutable pragmas. |
| C07/C09/C10 | `snapshot_load_restart_and_process_interruption_preserve_state` / integration/fault | Real close/reopen returns equal fresh/stale Some and equal malformed/absent None; child invokes public load then process exits after pin, between pages and after verification/before reply. Parent validates raw application fingerprint, exact v2 identity, healthy reopen/load and released resources. Reopen rejects pre-existing physical/event-integrity damage as D specifies; interrupted load performs no repair. |
| C06/C10/C11 | `snapshot_load_page_partition_and_repeated_reads_are_equal` / model/contract | Valid public-load fixtures around1/255/256/257/4096 events and private equivalent page partitions give same projection/error. Repeated unchanged public reads equal; encoded status/option/leap-time coverage does not weaken D codec. Per-result fingerprint and <=4096/16/256 work oracle remain. |

The first table contains exactly the three C-only and ten shared-C D-matrix names; the second
adds six C public behavior names. These19 names are C skeleton/runtime obligations. D-only
names remain regression obligations through the focused store suite, not duplicated C acceptance
claims. A test name without its substantive oracle does not satisfy a clause.

## Unit

C04/C07 canonical-body comparison, safe cache-error selection and reducer-error projection
guards; retain D exact codec tests. Public oracles stay in the named contract tests. Invalid
type-invariant identifiers are tested at their constructors rather than forged for load.

## Contract

Public absent/present/stale/malformed/ahead/out-of-budget and observed-store error precedence;
all prefix/projection fields; full-u64 H and cache-only bounds. Table names map every precondition,
postcondition, error and non-guarantee to a violation, normal path or inspection guard.

## Property / Model

Generated deterministic multi-stream schedules, repeated reads and page partition invariance
with an independent model and substantive application-state/provenance assertions.

## Integration

Real SQLite open/reopen, cache-value faults preserving append/replay, old/new pinned concurrency,
actual child-process interruption and caller-owned suffix continuation.

## Fault Injection

Public busy/worker/storage failures, dropped/timed-out futures and killed children. Faults and
barriers are private test-only and identify exact phases; cancellation tests await worker release
before checking final cleanup. No sleeps used as a substitute for transaction barriers.

## Security

SQL-before-allocation gates, structural-key/schema/index/physical fail-closed tests, D reopen
integrity regression, no recreation/migration, redaction canaries and private-domain source guards.

## Regression

Preserve accepted T010/T020/A/B/D behavior, schema-v2-aware assertions, full-u64 append/replay,
`regression_ephemeral_not_persisted`, the10 Node P0 tests and private fake-provider P0 E2E.
Required current workspace gates ran from the component root (offline with the locked dependency set):

```bash
cargo test --offline --locked -p codebox-event-store --all-features
cargo test --offline --locked -p codebox-domain --all-features
node --test --test-isolation=none apps/control-plane/web/p0-client.test.mjs
cargo test --offline --locked -p codebox-control-plane --test p0_subscription_e2e
cargo fmt --all -- --check
cargo clippy --offline --locked --workspace --all-targets --all-features -- -D warnings
cargo test --offline --locked --workspace --all-targets --all-features
cargo build --offline --locked --workspace --bins --all-features
cargo deny --offline --locked check
git diff --check
```

The `p0_subscription_e2e` command is the existing private fake-provider P0 E2E runner and also
runs within the workspace test gate. Any required gate's absence/unavailability is a skipped
gate, not permission to substitute live provider calls or claim complete acceptance. These
commands have been run; exact results and limitations are recorded in the runtime report.

## Common partition applicability

| TD §11.2 partition | Applicability |
|---|---|
| Empty/one/many/limit/plus-one; zero/one/N/N+one | Applicable: absent stream/cache,1/256/257/4096/4097, H vs S table |
| Ordered/out-of-order/duplicate/interleaved | Applicable: prefix gaps/sequence/reducer checks and multi-stream model; global duplicate event-ID enforcement remains A/open regression |
| Concurrent/replayed/same idempotency key | Concurrent/repeated reads applicable; no public load idempotency key |
| Timeout/cancellation/process kill/disk full | Applicable E0 phases; storage Full via bounded test-only mapping/fault if direct read-full fault cannot be produced |
| Network loss | Not applicable: no network; local lost reply modeled as cancellation/interruption |
| Absolute/../symlink/NUL/overlong/invalid UTF-8 paths | No path input to load; preserve accepted administrator-open tests, missing-file load proof and inherited same-UID limitation |
| Partial JSON/unknown tool/wrong argument/excessive nesting | No tool/JSON caller input; malformed persisted payload goes through accepted bounded A/B decoder with Payload error |
| Crash before/after side-effect boundary | No load application write boundary; pin/page/verified/lost-reply exits tested with E0 fingerprints |

# Acceptance Evidence

| Command or check | Result | Evidence artifact |
|---|---|---|
| Independent C design review | Accepted for design only | [T030C-design.acceptance.md](../acceptance/T030C-design.acceptance.md) |
| All19 C executable compiling fixed-failure skeletons | Compiled and failed before production; root independently confirmed | [RED evidence](../acceptance/T030C.acceptance.md#test-first-evidence) |
| Substantive C tests and listed gates | Passed; 99 store, 295 workspace, 10 Node tests and all gates | [T030C.acceptance.md](../acceptance/T030C.acceptance.md) |
| Rustdoc/spec signature/error/behavior projection and traceability | Explicit independent source/document review passed | [Runtime review](../acceptance/T030C.acceptance.md#independent-review-and-limits) |
| Independent T030 composition acceptance | Accepted after all four children | [T030.acceptance.md](../acceptance/T030.acceptance.md) |

The existing repository automatic rustdoc/spec drift checker is a documented broader delivery
gap. This acceptance does not claim that such a checker exists or project-wide TD compliance.
Current C API/contract projection must be inspected explicitly and its limitations recorded in
runtime acceptance; no missing gate may be labeled passed. Trace: TD §§10.5/10.6; C12.

# Timestamp Compatibility Repair

The C public extrema test exposed an inherited event codec mismatch: the writer emits canonical
Chrono extended years, but the existing strict RFC3339 decoder rejects them. See
[ADR-0006](../adr/ADR-0006-canonical-extended-timestamps.md) for the independently accepted narrow design repair. The existing append path verifies rows
before commit, so the exposed failure rolls back rather than committing an unreadable event.
C06 must preserve the existing strict parser, admit fallback only by exact existing encoder
roundtrip, and retain SQL bounds/error behavior. Add the named
`canonical_extended_timestamp_roundtrip_preserves_legacy_rfc3339` compiling RED regression before
codec changes; it supplements the 19 C and three parent obligations and does not replace the
failing C extrema test. Historical acceptance remains unchanged. Runtime acceptance must record
this discovery, independent amendment review, RED and complete repaired gates.

# Implementation Alignment and TD Gaps

The implementation reuses `open_read_connection` (READ_ONLY/no
CREATE, busy_timeout only), `identity_transaction`/`validate_identity(snapshot=true)` (exact v2
identity/indexes), `validate_snapshot_keys` (global metadata-only scan), `read_high_water`
(gated8-byte BLOB), `read_snapshot_row` (fixed96-byte SQL gates, syntactic validation and private
InvalidSnapshotCache), `verify_prefix` (same borrowed connection, bounded row pages and accepted
reducer), `encode_snapshot` (canonical96 bytes) and the redacted private `SessionSnapshot`.
Public `load_snapshot` composes these helpers in one pinned read-only transaction without a
public domain restore API. Per-handle `LoadPoint` hooks exist only under `cfg(test)` and observe
the public future at bounded phases without adding production fault-selection semantics.

The phase guard `snapshot_design_and_runtime_acceptance_are_distinct` now requires public load
and accepted C design, plus distinct accepted runtime/parent reports when tasks are Accepted;
historical D acceptance is not rewritten. Error helper mappings described above
are existing mappings, not newly invented error phases. No unresolved load architecture
`[TD-GAP]` was found from the accepted ADR/D contract and these helpers. New implementation
discoveries that contradict C01–C12 must be reported as a concrete TD-GAP/ADR repair before
continuing, rather than weakening a test or inventing behavior. This conclusion does not resolve
the broader automatic drift-check tooling gap. Runtime acceptance is recorded separately.

# Traceability

CU-EVT-03 → C01–C12; INV-003/INV-004 → C02/C06–C08/C10; TD §§4.4–4.6 → durable events
remain authoritative; accepted T010/T020/A/B → typed IDs/private fields, reducer legality,
strict bounded envelopes/full-u64 replay; ADR-0005/D S09/S10 → value misses versus observed
history errors, pinned E0 read, replayed projection, S-only budget and caller-owned continuation.
D S02/S04/S11–S15 → codec/provenance/identity/path/error/exit bounds; D S16 and TD §§10/11 →
separate C design/runtime and parent gates. Each C clause is mapped to named tests above;
existing [D acceptance](../acceptance/T030D.acceptance.md) establishes only its own boundary.

# Self-Check

| Archetype question | Answer / clauses |
|---|---|
| B: containment? | Administrator-admitted private path, READ_ONLY/no CREATE, no per-call path or write helpers; C01/C10/C11 |
| B: malicious inputs? | SQL type/width gates before copying, canonical96 codec, structural/value partition, bounded prefix/reducer, safe errors; C02–C07/C10 |
| B: not protected here? | Same-UID replacement, filesystem honesty, total-memory/latency, current-head/suffix validity; C08/C11 |
| B: resources/cleanup? | One connection/read transaction, one bounded page/reducer, drop/close on all exits, worker completion after future drop; C01/C06/C09/C10 |
| D: order/termination/chunks/backpressure? | Internal ascending pages <=256, total <=4096/exact endpoint, partition invariance and no public stream; C06/Streaming Semantics |
| D: cancellation? | Blocking worker may finish; E0 remains; C09/C10 |
| F: error mapping/idempotency/limits/redaction? | Disposable values None, observed store/history typed errors; deterministic unchanged reads, no automatic retry/rate/deadline;96/4096/256 and five-second lock wait; C03–C11 |
| A: total/deterministic/replay laws? | Whole method performs I/O (A not primary); comparison/codec helpers deterministic, unchanged-state equality and partition tests; C04/C07/C09 |
| C: side-effect ledger/duplicates/unknown crash outcome? | Not applicable to E0 load; no durable write, no OutcomeUnknown invented; cancelled/lost read safely retryable, crash fingerprints; C01/C09/C10 |
| E: legal transitions/winners/loser reread/commit order? | No load state transition; concurrent writers governed by D, pinned old/new reader consistency; C09/C10 |
| All: precondition/error precedence and EOF? | Typed/check/internal table; structural→head→value→budget→history→comparison; exact prefix EOF error; C02–C07 |
| All: observable outcome/exit invariants/non-guarantees? | Typed Some/None/error, no logs/audit, application-state E0 fingerprint on every path; C08–C11 |
| All: machine evidence/readiness? |19 C names with substantive public oracles, RED before production, independent design/runtime/parent review; C12 |
