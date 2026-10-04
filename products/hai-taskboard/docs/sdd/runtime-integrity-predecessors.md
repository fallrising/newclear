# Mini-SDD: Runtime integrity predecessors

Status: **Bounded H04/H05 implementation accepted by T-126 and orchestrator evidence gate (2026-10-04)**.
Parents: `../SDD.md` HAI-AUTH-001..004, HAI-DOMAIN-005, HAI-DONE-001..004,
HAI-EXEC-001..006 and `persistent-fake-runtime.md` HAI-RUNTIME-101..104.
This contract authorizes no implementation or acceptance by itself.

## Inspected baseline boundary (8f40f3e2)

`service.Service.DispatchRun` checks adapter identity but not scenario membership.
`port.ExecutorDeclaration` contains adapter/version/capabilities, with no scenario list.
`newLocalFakeAdapter` registers `local-success`; `persistentWorker.execute` rejects other scenarios
after `ClaimDispatch`. This is a reachable failure boundary, not an already rejected command.

`CompleteWorkItem` and `completionInput` use `port.CompletionMaterial.CandidateAvailable` and
artifact `Present` metadata. `sqlite.transaction.LoadCompletionMaterial` counts candidate bindings
and returns evidence artifact metadata; it does not read object bytes. Earlier submission/publication
verification does not prove later integrity. Existing `ArtifactStore.Open` and confined runtime
object reads are suitable byte boundaries; completion must actually use that boundary.

## Required behavior

- **HAI-INTEGRITY-001**: A new dispatch MUST validate scenario membership against trusted immutable
  configuration before WorkItem, Run, lease, dispatch outbox, audit or projection mutation. The local
  runtime admits only `local-success`; other independently configured Fake fixtures may declare other
  scenarios. The application owns rejection, using existing `lifecycle_rejected` classification.
  A recorded failure/result is permitted. Worker validation remains defense in depth. A Proposed
  declaration extension or admission seam must be application-owned and read without adapter calls
  inside a write transaction; no caller-supplied allow-list is trusted.
- **HAI-INTEGRITY-002**: For a new completion, authenticate, canonicalize and resolve exact replay
  before material reads. An unauthorized request MUST open no artifacts. Same-key/same-request replay
  returns recorded canonical bytes without reopening material, including after subsequent object
  loss; different request bytes retain idempotency conflict behavior.
- **HAI-INTEGRITY-003**: Load a bounded metadata snapshot of the named current Candidate, all its
  committed artifact bindings and policy-eligible evidence reports. Verify every required candidate
  object and each report used by completion through `ArtifactStore.Open`, matching SHA-256 and exact
  byte length with bounded reads and closed descriptors. Completion metadata collections and
  Candidate bindings admit at most 1024 records each; verify at most 1024 distinct objects,
  10 MiB per object and 50 MiB total. Valid zero-byte objects are permitted. Overflow rejects;
  no collection is silently truncated. Do all filesystem I/O outside the SQLite
  write transaction. Missing, corrupt, unreadable, oversized or non-Present material cannot authorize
  Done. Keep stable existing rejection classifications; report candidate/evidence unavailability or
  storage corruption as appropriate. An irrelevant historical report need not be opened.
- **HAI-INTEGRITY-004**: In the final transaction, repeat replay lookup, reload current metadata and
  recompute the subject. Compare the full candidate binding set, artifact locator metadata and selected
  evidence identity/subject/AC/verifier/recipe/environment/availability with the verified snapshot.
  Also recheck expected WorkItem version, policy, graph and required AC set. Any changed read invalidates
  the verification result; reject without completion, Approval consumption, phase, audit, dispatch
  or projection mutation. Unchanged metadata alone is never substituted for the prior byte check.
  Gate, CompletionRecord, Approval consumption, phase and canonical result remain atomic.
- **HAI-INTEGRITY-005**: Published objects remain immutable under the controlled artifact-store
  boundary. This bounded preflight closes corruption present when completion reads the bytes; it
  does not promise atomicity against an external host writer changing an open object after hashing.
  Rejection does not repair bytes, delete history or manufacture Passing evidence. Publication followed
  by database rollback may leave an immutable orphan; an orphan cannot become completion material.
- **HAI-INTEGRITY-006**: Preserve claim fencing, no redispatch of claimed work, no automatic retry of
  unknown outcomes, and worker/handler joins before resource close. Neither preflight failure nor an
  unsupported scenario changes shutdown or reconciliation semantics.

## Durable oracles and ownership

Names below pass the retained integrated and independent gates for this bounded slice. Future
admission oracles remain Proposed/NotRun in the admission contract. Each negative
completion checks persisted QA phase, zero new CompletionRecord/consumption/audit/projection rows;
dispatch checks no Run/outbox or phase change. Results may record a canonical rejection.

| Oracle | Durable fixture and negative case | Child scope |
| --- | --- | --- |
| `TestRuntime_RejectsUnsupportedScenarioBeforeDispatch` | Real SQLite/application ingress; unsupported scenario is rejected before polling/claim, while registered scenario still runs once | T-121 retained Red; T-124 accepted repair |
| `TestCompleteWorkItem_RejectsPostPublicationArtifactTamper` | Legal published QA subject; delete candidate object, corrupt candidate bytes, delete report, corrupt report, or change byte length after publication; each cannot complete; intact control completes | T-122 completion service, bounded persistence material read and tests |
| `TestCompleteWorkItem_MaterialVerificationOutsideWriteTransaction` | Instrument object opens/reads and real Store; none inside writer transaction; unauthorized and exact replay open none | T-122 |
| `TestCompleteWorkItem_RejectsMaterialSnapshotChange` | Pause after byte verification; lawfully commit version/binding changes or append subject-relevant Evidence/Review/Approval records; final transaction rejects stale preflight. SQLite locator/availability are immutable: prove UPDATE rejection separately and reject hostile persistence-port snapshot changes | T-122/T-125 |
| `TestCompleteWorkItem_MaterialObjectBudgets` | Public completion commands accept exact 10 MiB/object, 50 MiB total, 1024 distinct objects and zero bytes; overflow rejects within read/open budgets without durable mutation | T-125 |
| `TestArtifactMetadata_ImmutableLocatorAndAvailability` | Real SQLite rejects locator/availability UPDATE and retains original metadata | T-125 |
| `TestCompletionMaterial_BoundedCollectionsRejectOverflow` | Real SQLite rejects overflow and returns every row at the exact configured limit for all five collections | T-122/T-125 |

Regression references rerun by integrated full/race gates:
`TestVerticalAuthority_ArtifactVerificationOutsideWriteTransaction`,
`TestDispatchRun_UsesConstructionTimeExecutorDeclarationOutsideTransaction`,
`TestCommand_AuthenticatedPrincipalIsSoleActor`, `TestCommand_IdempotencySameRequestAndConflict`,
`TestPersistentRuntime_RestartPendingAndClaimed`, and
`TestPersistentRuntime_WorkerFailureDrainsHandlers`.
H06..H09 admission, durable activation, restore and resume remain **Specified/NotRun**.
