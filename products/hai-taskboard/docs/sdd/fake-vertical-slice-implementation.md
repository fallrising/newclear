# Implementation Contract: Fake Vertical Slice

Status: Candidate implementation/decomposition contract for T-041; no G1 implementation claim.

Parent: `../SDD.md` HAI-BOUNDARY, HAI-AUTH, HAI-DONE, HAI-EXEC, HAI-API and HAI-OPS;
ADR-001, ADR-002, ADR-003 and ADR-005; `persistence-and-recovery.md` and
`executor-and-security.md`.

## 1. Ownership and dependency direction

1. `internal/domain` owns value invariants, phase guards, completion evaluation and the only
   constructors for domain values. It imports only the Go standard library and its nested
   `internal/domain/internal/rehydrationcap` authority package.
2. `internal/application` owns command canonicalization, authorization decisions, transaction
   orchestration, repositories as ports, policy evaluation and projection/event construction. It
   imports `domain` and its own port definitions, never a concrete adapter.
3. `internal/application/port` defines narrow interfaces for `UnitOfWork`, `Repository`,
   `ArtifactStore`, `Executor`, `Clock`, `IDSource` and `ProjectionSink`. Port methods use domain
   values or application DTOs, never HTTP or SQLite types.
4. `internal/domain/sqlite` owns migrations, connection setup, SQLite implementations of the
   persistence port and row-to-domain rehydration. It imports `application/port`, `domain` and the
   nested rehydration capability; it cannot decide a command, alter a projection, or invoke an executor.
5. `internal/executor/fake` owns only the deterministic `fake/v1` port implementation and its
   in-memory/test-clock scenario store. It imports `application/port` and `domain`, not SQLite,
   HTTP, files outside its supplied staging writer, shell, network or a real provider.
6. `internal/transport/httpapi` owns `/api/v1` authentication extraction, same-origin checks,
   request-size/schema decoding, route/path canonicalization, response encoding and SSE framing.
   It calls application services only; it imports neither SQLite nor Fake.
7. `cmd/taskboard` is the sole composition root. It constructs SQLite, artifact storage, Fake,
   application services and HTTP handlers. No adapter imports another adapter; no package except
   the composition root imports both a concrete adapter and application service.
8. Architectural tests MUST reject `domain -> application|adapter|transport` except its named
   nested authority import, `application -> sqlite|fake|httpapi`, `httpapi -> sqlite|fake`, and
   `sqlite <-> fake` imports. They MUST also reject every import of
   `domain/internal/rehydrationcap` except `domain` and `domain/sqlite`.

## 2. SQLite V1 rules and tables

`schema_migrations(version INTEGER PRIMARY KEY CHECK(version>0), checksum TEXT NOT NULL UNIQUE,
applied_at_ns INTEGER NOT NULL)` is append-only; each migration runs in one transaction and its
checksum mismatch is startup-fatal. All IDs are `TEXT NOT NULL`, timestamps are UTC integer
nanoseconds, and every domain/SQLite digest column is bare lowercase 64-hex
`TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*')`, matching
`domain.Digest.String`/`ParseDigest`. Mutable rows have `version INTEGER NOT NULL CHECK(version>0)`.
Every foreign key is declared and enforced; immutable tables have `BEFORE UPDATE OR DELETE` triggers
that abort.

| Table(s) | Key and required invariant |
| --- | --- |
| `instance_state` | singleton `id=1`; `restore_generation>=1`, `stream_epoch>=1`, `next_event_sequence>=0`, `schema_version`; only controlled recovery/stream transactions update it. |
| `projects` | `project_id` PK; unique canonical name; repository binding/ref and `version`; cross-project joins are forbidden by composite FKs below. |
| `work_items`, `work_item_blockers` | `(project_id,work_item_id)` unique, `phase` CHECK Draft/Ready/Developing/Review/QA/Done/Canceled, title/goal/owner nonempty; blockers PK `(work_item_id,blocker_id)`, unresolved rows have `resolved_at_ns IS NULL`; a blocker never changes phase. |
| `ac_revisions`, `work_item_ac_requirements`, `dependency_revisions`, `dependency_edges` | immutable revision/content rows; AC binding PK `(work_item_id,ac_id,revision_digest)`; edge PK `(graph_revision_digest,from_id,to_id,kind)` and kind CHECK `specifies|depends_on|verifies|produces`. |
| `runs`, `run_leases` | run PK and immutable `input_digest`, adapter id/version, scenario id and attempt; independent CHECKed dimensions `desired_action`, `dispatch_state`, `observed_state`, `reconciliation_state`, `side_effect_outcome`; lease PK `run_id`, `epoch>=0`, holder/deadline nullable only when unclaimed. |
| `candidates`, `candidate_artifacts` | candidate PK, unique `(run_id,candidate_digest)`, immutable input-subject digest; each artifact binding is immutable and candidate publication requires the current Run input and confirmed lease/generation. |
| `reviews`, `evidence`, `approvals`, `approval_consumptions` | immutable PK rows bound to `completion_subject_digest`; evidence has AC/revision, verdict, applicability, availability, verifier class/actor, recipe and environment; approvals never carry `consumed_at_ns`. `approval_consumptions` is INSERT-only with PK `approval_consumption_id`, UNIQUE `approval_id`, approval/command FKs, exact subject digest, consuming actor and timestamp. |
| `completion_records`, `completion_record_evidence`, `completion_record_reviews`, `completion_record_approvals` | immutable completion PK; unique `work_item_id` plus `result_work_item_version`; nonempty subject digest and completed actor/time; join rows are immutable and reference exact immutable inputs. |
| `artifacts` | digest PK, immutable media type/length/storage key; `availability` CHECK Present/Missing/Quarantined; a bound Present row must name only a verified digest-addressed object. |
| `command_results`, `idempotency_records` | command id PK; idempotency PK `(principal_id,project_id,operation,key)` with canonical request digest, result command id and expiry/tombstone state; the same scope+digest replays exactly one stored result, different digest conflicts. |
| `audit_groups`, `audit_entries` | group id PK; entry sequence PK, group FK, actor/operation/subject/before-after digest; INSERT-only and committed with its command. |
| `outbox` | intent id PK, command/audit/run FKs, immutable payload digest; state CHECK Pending/Claimed/Sent/Acknowledged/FailedToDispatch, claim epoch and timestamps; payload is never executed in the command transaction. |
| `projection_events`, `stream_retention` | PK `(stream_epoch,event_sequence)`, project FK, event payload digest/bytes and audit sequence; sequence is assigned only with the command audit; retention records the inclusive minimum retained sequence per project/epoch. |

V1 migration enables `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL` and
`busy_timeout=5000`; startup reads each back as `1`, `wal`, `2`, `5000`, records SQLite/module
identity, rejects engine `<3.51.3`, uses an absolute controlled URI, and rejects request-supplied
DSN/PRAGMA fragments. Writers use bounded `BEGIN IMMEDIATE`; typed `SQLITE_BUSY` is not an infinite
retry. Triggers additionally reject a `work_items.phase='Done'` update unless, in the same
transaction, the row has its matching immutable CompletionRecord at the resulting version.

HTTP codecs alone translate the OpenAPI `SHA256` wire form: decode accepts exactly
`sha256:` plus 64 lowercase hex and passes the bare suffix to `domain.ParseDigest`; encode prefixes
only `domain.Digest.String()`. The codec rejects a bare/missing prefix, `sha256:sha256:...`, an
uppercase prefix, or uppercase/non-hex suffix. SQLite, domain values, canonical subjects, artifact
object names and all idempotency/audit/event comparisons use bare hex. T-043-owned
`TestSQLiteDigestStorageDomainRoundTrip` proves only bare SQLite storage <-> `domain.Digest`
fidelity. T-046-owned production `httpapi` codec test
`TestHTTPDigestCodec_WireRoundTripAndRejectsInvalidSpellings` proves wire
`sha256:<64-hex>` -> bare domain/storage -> identical wire output and rejection of missing, double
or uppercase spellings.

## 3. Guarded Done rehydration

The ordinary `NewWorkItem` constructor and `Transition(..., Done, ...)` remain rejecting paths.
`sqlite.LoadWorkItem` reads the WorkItem plus blockers and, for a stored Done phase, exactly one
immutable CompletionRecord where `work_item_id`, `result_work_item_version`, and nonzero subject
digest match the row. It also verifies every record join FK and referenced artifact availability.

`internal/domain/internal/rehydrationcap` is a nested Go `internal` package. It exposes opaque
`Capability` and `CompletedLoad` values with private fields and valid values only from its SQLite-load
constructor; its path is importable only by the `internal/domain` subtree. `domain/sqlite` is the
sole permitted importer that obtains a Capability and CompletedLoad. Application, transport, command
root and external domain callers cannot name or construct either type; an architecture import test
enforces the sole-importer rule. `domain.RehydrateCompletedWorkItem(Capability, CompletedLoad)` accepts
no raw phase, validates the capability plus item/record identity, result version and subject digest,
and returns `(WorkItem, CompletionRecord)` together. Missing, duplicate, mismatched or corrupt rows
yield typed `storage_corruption`, no partially rehydrated aggregate and commands disabled for the
affected project. Non-Done rows use the ordinary constructor and cannot smuggle a CompletionRecord
into a phase transition. Tests MUST prove raw Done construction, direct Done transition, missing-record
load, wrong-item/version/subject load, external-import denial and corrupt join denial.

## 4. Command transaction and failure seams

For every state-changing request the HTTP adapter authenticates and canonicalizes before project or
body-sensitive lookup; application scopes idempotency by `(principal, project, operation, key)` and
hashes the canonical V1 request. The write unit of work is:

1. begin immediate and claim/find idempotency; exact recorded request returns its stored result,
   mismatched bytes conflict, and expired state returns `idempotency_expired` rather than reuse;
2. load aggregate/read-set, verify project route/target, authorization, expected version and current
   subject; any guard failure writes the specified recorded failure only if the command contract
   requires it, otherwise rolls back with no partial mutation;
3. mutate mutable rows and append immutable Candidate/Review/Evidence/Approval records as applicable;
4. for `CompleteWorkItem`, re-read the complete current subject and all required immutable inputs,
   evaluate HAI-DONE, insert the immutable unique `approval_consumptions` row when approval is used,
   insert CompletionRecord joins and change QA to Done in this same transaction;
5. append one audit group and ordered audit entries, allocate `(epoch,sequence)`, append projection
   events, append zero or more outbox intents, persist the canonical command result/idempotency row;
6. commit, then publish the retained event to the in-process hub and let an outbox worker claim work.

No adapter dispatch, filesystem hashing/publication, Git traversal or SSE socket write occurs before
commit. Artifact bytes are staged/fsynced/hashed/renamed before a later binding transaction; orphan
objects are recoverable and a missing bound object is corruption. The first bounded checkpoint is
the committed `runs + outbox + audit + command result` transaction: a returned/recorded Run is never
missing its dispatch intent, and response loss recovers solely by command-id/idempotency lookup.
Failure injection at each statement and between commit/HTTP response must show all-or-nothing writes;
failure after commit must show one durable replay and no second Run.

## 5. Fake lifecycle and recovery fence

`fake/v1` accepts an immutable scenario `{scenario_id, capabilities, ordered observations}` driven
only by an injected fake clock or explicit tick. Supported declared capabilities are `start_ack`,
`heartbeat`, `lookup`, `cancel_ack` and `durable_checkpoint`; an absent capability returns
`capability_unsupported` without mutation. Observations include dispatch receipt, acknowledged or
lost start, heartbeat, checkpoint, terminal success/failure, timeout, late/stale publication,
lookup, cancellation acknowledgement and unknown outcome. Scenario data is data only: no executable
code, network location, shell, provider credential or path outside its supplied per-Run staging root.

The outbox worker conditionally claims Pending work and increments `lease_epoch`; it records holder,
deadline and current `restore_generation` before invoking Fake. Every callback supplies Run ID,
input digest, lease holder/epoch and restore generation. The application rejects/audits stale epoch,
wrong generation, wrong input, unsupported operation and non-current Run observations before any
state change. `DispatchRequested` becomes started/running only on validated start acknowledgement.

Lost start acknowledgement is looked up if declared; unknown handle/effect becomes
`NeedsReconcile`/`OutcomeUnknown`, never a redispatch. Lease expiry is ownership uncertainty, moves
to reconciliation and never proves stopped. `RequestCancellation` persists intent; only a fenced
cancel acknowledgement establishes Canceled. Timeout/lost contact stays unconfirmed. Unknown side
effects, terminal publication after expiry, and pre-restore callbacks never auto-retry; an explicit,
audited operator reconciliation/new Run is required. Fake writes sealed artifacts only through the
application artifact port and records its observable calls for deterministic assertions.

## 6. HTTP and resumable SSE

All routes remain under `/api/v1`; the router rejects noncanonical/duplicate path encodings, route
project mismatch, unknown JSON fields/operations and invalid ID/cursor syntax. Session identity is
the only actor identity, authorization occurs before sensitive body/cross-project resolution, and
state changes require same-origin validation. OpenAPI supplies wire validation; application repeats
canonical request digest, authorization, lifecycle, version, subject and persistence checks.

A snapshot reads the projection and `instance_state(stream_epoch,next_event_sequence)` in one
consistent read transaction and returns that high-water cursor. On subscribe, parse `Last-Event-ID`
and `cursor` as `epoch:sequence`; if both are present they must match. With no cursor, begin after
the current high-water (clients needing consistency snapshot first). For a current epoch, a supplied
sequence below `minimum_retained_sequence-1` emits `projection_reset_required` then closes; a wrong
epoch does the same with reason `epoch_mismatch`. Otherwise serialize per-project `durable replay of
sequence > cursor`, subscriber attachment, and post-commit publication under one hub mutex; each
connection records next sequence and discards duplicate replay/live events. This closes the snapshot
gap without holding any SQLite write transaction or command path on a client socket.

Each connection permits at most 128 queued events or 1,048,576 queued payload bytes. Enqueue never
blocks: overflow attempts one reset event with `slow_consumer`, then closes; revoked sessions close
with `authorization_revoked`. Retention expiry/wrong epoch sends `{current_epoch, minimum_sequence,
snapshot_url}` and closes. A restored database increments `restore_generation`, rotates stream epoch,
persists sequence reset before serving, and all old cursors/callbacks require reset or reconciliation.

## 7. Serial child implementation scopes

| Child | Depends on | Writable scope (non-overlapping) | Independently useful acceptance |
| --- | --- | --- | --- |
| T-043 SQLite foundation | T-041 | `backend/go.mod`, `backend/go.sum`, `backend/internal/application/port/persistence.go`, `backend/internal/domain/rehydration.go`, `backend/internal/domain/rehydration_test.go`, `backend/internal/domain/internal/rehydrationcap/**`, `backend/internal/domain/sqlite/**` | Adds `modernc.org/sqlite@v1.58.0`, V1 migrate/startup PRAGMA assertions, the persistence port, Project/WorkItem/blocker persistence and guarded Done rehydration; `TestSQLiteV1_MigrationPragmasAndConstraints`, `TestSQLiteLoad_DoneRequiresMatchingCompletionRecord`, `TestSQLiteDigestStorageDomainRoundTrip`. |
| T-044 application commands | T-043 | `backend/internal/application/command/**`, `backend/internal/application/service/**`, `backend/internal/application/port/{clock.go,id_source.go,executor.go,artifact.go,projection.go}` | Transactional command service for Create/MarkReady/Dispatch/Complete/idempotency; it MUST NOT edit T-043-owned module files, persistence port or SQLite/rehydration paths; `TestCommandTransaction_FailureInjectionRollsBackAllWrites`, `TestCommand_IdempotencySameRequestAndConflict`, `TestCompleteWorkItem_PersistentAtomicity`. |
| T-045 deterministic Fake | T-044 | `backend/internal/executor/fake/**` | Capability-declaring, clock-driven Fake and fenced worker seam; `TestFakeAdapter_CapabilitiesFailClosed`, `TestFakeAdapter_ScriptedStartHeartbeatCheckpointAndUnknown`, `TestRunRecovery_ExpiryDoesNotImplyStoppedOrRetry`. |
| T-046 HTTP/SSE composition | T-045 | `backend/internal/transport/httpapi/**`, `backend/cmd/taskboard/**` | `/api/v1` auth/canonicalization, production SHA256 wire codec, command-result lookup and bounded resumable SSE; `TestHTTP_AuthorizationAndCanonicalRouteBeforeSensitiveLookup`, `TestHTTPDigestCodec_WireRoundTripAndRejectsInvalidSpellings`, `TestSSE_SnapshotGapReplayAndRetentionReset`, `TestSSE_SlowConsumerCannotBlockCommand`. |
| T-047 vertical integration evidence | T-046 | `backend/integration/**` | Deterministic Fake create→dispatch→candidate→review/evidence→approval→Done plus response-loss, stale epoch and cancel-unknown cases; `TestVerticalFake_CompletionAndResponseLoss`, `TestRunLease_RejectsStaleEpochPublication`, `TestCancel_UnknownStopIsNotCanceled`. |

Each child may add tests only beneath its own writable scope, consumes prior public interfaces without
editing them, and reports every unexecuted broader oracle as NotRun. T-043 is deliberately useful
without claiming the T-040 vertical slice: it establishes the crash-safe schema/startup and makes an
invalid historical Done state impossible to load.

## 8. Required evidence inventory

The following remain NotRun until their owning child executes: AC-01..06, AC-07..16, AC-35..37,
AC-40..42, AC-45..46 and AC-53; the G1 skeletons AC-P0A-005, 006, 009, 010, 011, 014, 015 and 016.
Passing T-024 pure value-domain tests remain limited to in-memory behavior; passing T-033 fixture
tests remain limited to static UI behavior. No item in this contract changes their status.
