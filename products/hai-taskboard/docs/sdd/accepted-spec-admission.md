# Mini-SDD: Accepted specification admission

Status: **H01 design accepted by T-126 and orchestrator evidence gate (2026-10-04)**.
Parents: `../SDD.md` HAI-AUTH-001..006, HAI-STATE-001, HAI-DONE-004 and HAI-RECON-001..007;
ADR-001/004/005; `reconciliation.md` and `domain-and-gates.md`.
H01 is this accepted predecessor design. The ordered runner and separately assigned V2
storage/migration child are accepted in `ordered-migrations.md` and
`acceptance-persistence-schema.md`. Commands, ports and admission workflow oracles remain
**Proposed/NotRun**; full H06..H09 remains **Specified/NotRun**.

## Existing boundary and ownership

`port.ACRevision`, `ACRequirement`, `DependencyRevision`, `CompletionMaterial` and
`domain.CompletionSubject` exist. Migration `0001_v1.sql` has immutable revision history, but no
proposal, accepted project/WorkItem head or durable ImpactPlan tables. `LoadCompletionMaterial`
currently selects a requested historical graph or the latest dependency row; neither proves
acceptance. `service.SpecificationPolicy.ValidFor` is a boolean readiness seam, and runtime
`unavailableSpecification` returns false. Fixture revision writes are not operator acceptance.

| Owner | Proposed responsibility |
| --- | --- |
| `internal/domain` / `internal/reconcile` | Pure admission bindings, validation and subject/graph decisions; reuse existing `Graph`, `ImpactPlan`, `ReadVersion`, `ValidateActivation`, `ReuseFingerprint` |
| `internal/application/command` / `service` | Canonical `ProposeSpecification`, `AcceptInitialSpecification`, `PreviewSpecificationImpact`, `ActivateSpecificationImpact`; auth, policy, read-set and atomic command orchestration |
| `internal/application/port` | Bounded immutable Git-object reader, transactional admission records/heads, accepted-input read view; no SQL/HTTP or subprocess types |
| `internal/domain/sqlite` | Ordered migration, FK/immutability/CAS enforcement and durable read/write adapter |
| `internal/transport/httpapi` / `api/openapi.yaml` | Explicit operation/payload schemas under existing project command ingress, bounded parsing, session/Origin guards, exact results; no direct head writes |
| `cmd/taskboard` | Trusted local repository and policy wiring; keep admission unavailable until child gates pass |

## Records and identities

- **HAI-ADMISSION-001**: A Proposal is immutable imported data, not acceptance. Its SHA-256 identity
  binds schema version, approved repository-binding identity/version, Git object-format and commit
  OID, manifest path/blob OID/digest, sorted node IDs with source path/blob OID/content digest,
  typed edges and canonical required AC/recipe bindings. Git OIDs and application SHA-256 digests
  are separate fields. Store canonical content and verify its digest on read. Proposal replay
  deduplicates by this identity; correction creates another proposal.
- **HAI-ADMISSION-002**: An immutable accepted revision names the validated normative node/AC set
  and graph plus proposal provenance. Mutable current project head points to one accepted revision;
  current WorkItem heads point to exact required AC/spec subsets in that same project revision.
  Project/head and affected WorkItem versions advance together by compare-and-swap. Historical
  revisions, Runs, Evidence and completions remain immutable. Queries MUST resolve applicability
  from these heads, never timestamps, insertion order or a client-selected historical graph.

## Import and first acceptance

**HAI-ADMISSION-003**: Authenticate and authorize the project/repository binding, then resolve a
permitted local ref once to an immutable commit. Read commit/tree/blob objects outside SQLite write
locks, never working-tree bytes or a second moving-ref resolution. No fetch/network or execution of
repository instructions is implied. Reject unapproved repository, dirty-tree input, symlink/submodule
entries, absolute/traversal paths, malformed OIDs, digest mismatch, unsupported manifest schema,
duplicate/unmapped required nodes, dangling edges, cycles and unresolved required tombstones.
Proposed V1 limits: 1 MiB manifest, 10,000 nodes, 20,000 edges, 10 MiB per blob, 50 MiB total;
capacity excess rejects rather than truncates. Persist proposal with result/idempotency/audit
atomically after validating the captured repository-binding version; accepted heads stay unchanged.

**HAI-ADMISSION-004**: First acceptance is an explicit operator command with expected project and
WorkItem versions, proposal identity, policy revision, complete read-set and exact acceptance subject.
It requires the project to have no head and every named WorkItem to have no head; concurrent first
acceptances produce one winner. Validate the full required mappings and graph before the transaction.
Inside it recheck permissions, policy, repository binding and every read version, then atomically
insert accepted history, install project and WorkItem heads, current AC bindings, result, audit and
projection intent. It neither starts a Run nor makes Draft Ready. A later proposal cannot use this
path. Initial acceptance has no fake previously accepted graph: its subject explicitly names an
absent base head, distinct from an empty but accepted graph.

## Preview, activation and current inputs

**HAI-ADMISSION-005**: For an existing head, preview persists an immutable `reconcile.ImpactPlan`
encoding and digest plus proposal/base accepted-head IDs. Use `DiffGraphs` and old+new reverse
closures with bounded lexical cause paths. Bind policy, repository/head versions, every consulted
WorkItem version and relevant Run identities/state fingerprints. Existing `ReadVersion` and
`RelevantRuns` require an application-defined canonical mapping; a Run input digest alone cannot
detect changed lease/outcome state. Preview changes no heads or applicability.

**HAI-ADMISSION-006**: Activation carries exact plan digest, expected versions and a human decision
bound to operation, proposal, base head and read-set digest; Proposed activation approval is distinct
from completion Approval. Recompute/validate the captured plan, then in one transaction reload the
current base, policy, bindings, read-set and Run fingerprints and call `ValidateActivation`. Any
mismatch rejects the whole command. Insert accepted revision, move all heads and current requirement
bindings, record affected applicability/Done-Stale and durable follow-up work, result and audit
atomically. Follow-up work cannot silently dispatch a Run. A provenance/path-only equivalent proposal
may record an audited no-op after exact normative equality; it does not move semantic heads or claim
new evidence. Graph revision/reuse rules stay those of ADR-004.

**HAI-ADMISSION-007**: MarkReady, DispatchRun, Candidate publication and CompleteWorkItem must load
current heads in their command transaction. Missing acceptance fails closed. Caller graph/AC/policy
fields select a requested subject only and cannot choose authority. Dispatch persists a versioned
canonical envelope containing project/WorkItem/version, normative accepted binding digest, graph
revision, sorted full AC set, policy, recipe/environment, integration base applicability/digest,
adapter/version and scenario. `dispatchInputDigest` currently lacks several of these dimensions;
its replacement is Proposed and must retain old Run identity/version rather than rewrite history.
Candidate input must match its Run and current accepted subject. Changed inputs preserve history
but cannot publish as current or complete. Reuse uses every existing fingerprint dimension;
missing/unknown dimensions cannot produce an automatic match.

## Migration and publication sequence

**HAI-ADMISSION-008**: Freeze V1 migration bytes/checksum. First add an ordered checksummed
migration runner that verifies all applied versions and rejects gaps, altered checksums and unknown
newer schemas. Then apply a transactional V2 adding Proposed proposal/provenance, accepted revision,
project/WorkItem head, current requirement, ImpactPlan and activation-decision tables with scoped
FKs and immutable-history guards. Existing revision/requirement rows are history only: do not
backfill accepted heads from fixtures or latest-row guesses. Old databases remain admission-disabled
until explicit acceptance; old Runs keep their original input format. Only after migration/restart
tests pass add read ports, commands, then transport/runtime wiring. Publish any large immutable bytes
before binding them; a rejected SQLite commit leaves only collectible orphans, never visible accepted
material. Git/object I/O remains outside writer locks; SQLite normalized state plus transactional
audit remains authority, with no Markdown synchronization or event-sourced reconstruction.

## Durable oracle contract and child scopes

The migration oracle has bounded runner/V2 storage evidence in the separate mini-SDDs; it does
not prove operator acceptance. All other oracles here remain **Proposed/NotRun**, even where
pure-kernel tests already exist. Each child
must receive a separate bounded assignment and write its named Red test before production behavior.

| Oracle | Required positive/negative durable assertion | Child scope |
| --- | --- | --- |
| `TestAdmission_MigrationPreservesV1AndRejectsUnknownSchema` | Existing DB reopens with unchanged history/no inferred heads; checksum/gap/newer-schema and interrupted migration reject without partial V2 | migration/store/SQLite tests |
| `TestAdmission_ProposalProvenanceAndCrashIsolation` | Immutable commit import deduplicates; moving ref, bad blob, forbidden entry, scope/binding change and precommit crash leave heads unchanged | Git port/adapter, proposal service/tests |
| `TestAdmission_FirstAcceptAtomicAndSingleWinner` | No-head acceptance installs exact project/WorkItem heads; stale version, unauthorized actor, partial mapping and injected write failure install none; concurrent commands have one winner | domain/transaction ports/store/admission service/tests |
| `TestAdmission_CurrentHeadsOwnReadinessAndDispatch` | Historical/unaccepted revisions cannot ready/dispatch; current acceptance enables legal guarded command; graph/AC/policy/recipe/base changes alter input and reject stale subject | accepted read view/service/domain/tests |
| `TestAdmission_DurablePreviewActivationReadSet` | Preview leaves heads unchanged; removed edge invalidates old consumers; changed head/policy/WorkItem/Run or wrong plan/approval rejects; injected failure rolls back every head/result/audit/work row | durable plans/activation/store/service/tests |
| `TestAdmission_StalePublicationAndReusePreserveHistory` | In-flight old subject cannot become current/Done; historical completion survives but loses effective satisfaction; recipe/environment/base/adapter/verifier mismatch never reuses | publication/applicability/reuse/tests |
| `TestAdmission_HTTPReplayAndRestart` | Auth/Origin/scope/unknown-field denial; response-loss replay returns exact bytes with no duplicate acceptance; restart uses same heads/plan | OpenAPI/HTTP/runtime/integration tests |

Source anchors inspected: `service/service.go`, `service/policy.go`, `command/types.go`,
`port/persistence.go`, `sqlite/store.go`, `sqlite/migrations/0001_v1.sql`, and
`reconcile/{graph,impact,reuse}.go`. Existing pure tests
`TestImpactPlan_UsesOldAndNewReverseClosure`, `TestImpactActivation_RejectsStalePlan` and
`TestReuseFingerprint_RecipeEnvironmentAndBaseMatter` do not prove durable admission.
Acceptance of this document covers the H01 contract only. Separately accepted V2 tables are
storage capability, with durable outer plan identity distinct from the existing kernel plan digest.
Canonical verification, commands, ports and full admission oracle execution remain Proposed/NotRun;
no full H06..H09 implementation or completion follows.
