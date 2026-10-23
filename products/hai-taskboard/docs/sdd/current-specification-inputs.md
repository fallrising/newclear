# Mini-SDD: Current specification and immutable Run inputs

Status: HAI-INPUT001..004 accepted locally, 2026-10-23, after T-988 implementation,
HAI-local T-004 independent review/adversarial probes and root full/race/vet/build gate
`input-browser-backend-20261023`. HAI-INPUT005 readiness/dispatch and its 007 tests are
accepted locally after T001, independent T008 ACCEPT and root pinned
`ready-dispatch-integrated-20261023` full/race/vet/build. HAI-INPUT006 publication/Done and its 007 oracle are accepted locally after T002,
independent T016 ACCEPT and root pinned current-output-directory-integrated-20261023.
Output association, activation and full product Done remain separate.
Parents: accepted-spec-admission HAI-ADMISSION-007, initial-specification-command,
domain-and-gates, persistent-fake-runtime and ordered-migrations. T-987 is static design input.
Storage/codec and service-consumer changes are separately bounded assignments. No runtime bypass
flag may turn historical fixture revisions into accepted authority.

## Storage and canonical input prerequisite

**HAI-INPUT-001**: Append compiled migration `0003_run_inputs.sql`. Freeze V1/V2 SQL/checksums,
their immutable history and V1 Identity compatibility value. Add exactly one STRICT table
`run_input_envelopes` with nonnull columns: project_id TEXT, run_id TEXT, work_item_id TEXT
(each nonempty), codec_version INTEGER CHECK=1, input_digest TEXT (64 lowercase hex),
canonical_content BLOB (length 1..1048576). PK(project_id,run_id); immediate NO ACTION FKs to
runs(project_id,run_id) and work_items(project_id,work_item_id). Unconditional UPDATE/DELETE
abort and BEFORE INSERT duplicate-PK abort protect history from REPLACE, IGNORE and UPSERT.
No backfill, Run rewrite, head update or inferred input. Existing missing envelopes denote legacy
history, not corruption of an otherwise promised envelope or authority for a new dispatch.

**HAI-INPUT-002**: Canonical schema-1 input binds project/WorkItem, dispatch-time Ready version,
exact normative WorkItem binding digest, accepted graph revision, sorted complete AC revisions,
policy revision, recipe, full per-AC verification rules (class, independence, prohibited actor/role,
environment), ApprovalRequired, explicit integration-base applicability and digest, Fake adapter
ID/version and scenario. Environments must have concrete nonzero trusted digests for newly enabled
dispatch. Integration base is explicitly `absent` with null digest or `present` with nonzero digest;
unknown has no automatic match. Runtime Fake environment is the explicit deterministic profile
`local-fake-environment-v1`, hashed with the existing domain SHA helper. It is a fixture profile,
not a claim about a real external executor environment.

The input codec uses strict known fields, schema/version validation, sorted unique AC/rule sets,
exact set equality and SHA-256 of canonical bytes. IDs/digests/positive versions and supported
fake/v1 adapter/scenario are validated; decoder re-encodes and compares bytes. Input maximum is
1 MiB, with 256 ACs as for initial acceptance. Return defensive copies. Preserve old Run digests;
the new digest applies only to new dispatches. Capture Ready version before Developing transition.
Semantic-current comparison excludes that captured lifecycle version: normal Review/QA version
increments do not make the Run stale. It includes every semantic dimension listed above, so
changing policy fields under an unchanged policy revision still invalidates current use.

**HAI-INPUT-003**: Add optional application-owned current-input transaction ports, leaving the
mandatory Transaction unchanged. Verified current specification reads join project and WorkItem
heads, immutable accepted revision/binding, complete current requirements and AC bytes. Reuse
the accepted-record decoder/proposal provenance checks; verify normalized identities/digests,
same-project/current-revision relationships, positive head versions, exact full requirement sets
and content hashes. Missing heads fail closed; malformed present material is StorageCorruption.
Never fall back to legacy work_item_ac_requirements, latest dependency row or client graph.
Initial-revision support is sufficient for this prerequisite; unsupported accepted kinds reject
explicitly until the impact codec is separately implemented.

Run-input write/read verifies canonical hash plus normalized project/Run/WorkItem, codec version,
input digest and existing Run adapter/version/scenario. At write time the Run already exists in
the same transaction; outbox is created by execute afterward. Read/claim additionally verifies
the existing outbox payload equals that same Run input digest. Byte reads are bounded in SQL
before materialization. Replay selects and verifies exact existing bytes; no conflict-ignore SQL.
History-only Run reads remain available without an envelope. This prerequisite alone changes no
existing command or dispatcher behavior.

**HAI-INPUT-004**: Preserve compiling Red `TestRunInput_V2UpgradePreservesLegacyHistory` before
V3 production. Cover populated V2→V3 history preservation/empty envelope table, exact bytes of
V1/V2, reopen, unknown-newer, actual V3 write/cancel rollback, concurrent startup and all immutable
replacement routes. Preserve actual-V2 tests with explicit frozen V1+V2 fixtures where needed;
advance public latest expectations to3 and future/synthetic steps consistently, retaining failures
and full snapshots. New codec/current-reader tests cover mutations of every input dimension,
normalized/canonical mismatch, missing/partial current requirements, cross-project/item scope,
oversize stored bytes, exact copy behavior and legacy absence. No service acceptance follows yet.

## Service authority successor

**HAI-INPUT-005**: MarkReady loads verified current heads in its command transaction and derives
specification validity from their exact requirements plus trusted policy/recipe/rules. The legacy
boolean SpecificationPolicy cannot grant authority. DispatchRun uses the same view, supported Fake
declaration and expected-version guards, then writes Run, immutable input, outbox, result, audit,
projection and Developing transition atomically. Every postwrite error is rollback-only.

ClaimDispatch verifies the persisted input against current semantic inputs and adapter before any
dispatchable lease. Pending discovery excludes legacy Runs without envelopes and rows already
needing reconciliation; expired claimed legacy recovery remains available. A stale-but-well-formed
pending input is not a fatal storage error: in the same checked transaction mark only its
reconciliation_state as NeedsReconcile, preserve Pending/Unknown/NotApplicable lifecycle facts,
append audit/projection and return a typed nonfatal stale-input outcome after commit. The poller
continues without dispatch or automatic retry, and those rows cannot starve later Pending work.
This bounded CAS applies only before a lease is claimed and must lose to a concurrent claim.
Corrupt canonical state remains a fatal integrity error. Legacy Pending history is not automatically
reclassified.
Fenced lifecycle observations can record old Run truth even when its input is stale; success alone
still grants no current Candidate or Done authority.

**HAI-INPUT-006**: SubmitCandidate, review/evidence, ApproveSubject, RequestQA and CompleteWorkItem
must validate Candidate→Run→immutable input against current semantic heads/policy before publication
or completion. Replace historical graph/AC authority with the verified view, while retaining the
historical LoadCompletionMaterial query for history-only consumers. Caller subjects select intent,
never authority. Preserve preparationSubject's prospective QA version while in Review and actual
version in QA; neither equals the dispatch-time version in general. Exact committed replay runs
before new-authority validation and external artifact reads, including legacy recorded results.

Artifact byte checks remain outside SQLite write locks. The metadata snapshot and final transaction
must include and compare accepted binding/input identities as well as existing candidate/artifact
metadata. Recheck semantic currentness in the final transaction. Preserve immutable history and
all existing artifact TOCTOU, independent verifier, approval scope/expiry/one-use and unknown-Run
guards. No historical input may be silently upgraded or reused as current.

**HAI-INPUT-007**: Preserve named Red `TestAdmission_CurrentHeadsOwnReadinessAndDispatch` and
`TestAdmission_StalePublicationAndReusePreserveHistory`. Positive real-Store flow uses empty Draft,
approved proposal, explicit first acceptance, Ready, dispatch, one Fake claim and normal phase
progression; reopen/replay retains identities. Mutate every semantic dimension and test missing
heads/partial requirements, legacy input, corruption, stale publication and every write rollback.
Migrate existing service/SQLite/integration/runtime fixture prerequisites to lawful acceptance
or explicitly modeled verified test inputs; preserve their named negative predicates. Do not
weaken failures, add a runtime bypass, or relabel synthetic storage fixtures as end-to-end proof.
Full product completion, activation/reuse, browser and restore still need their own evidence.
