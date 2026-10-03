# Persistent Fake runtime slice

Status: implementation contract under the accepted P0-A authority and execution ADRs.

This closes the T-040 local runtime gap without adding a real executor or an accepted-spec importer.
The existing specification admission policy remains fail-closed. Runtime tests seed accepted inputs
through the established synthetic fixture APIs; they do not claim an end-user import workflow.

## Contract

- **HAI-RUNTIME-101**: A bounded read enumerates Pending dispatch intents in stable order.
  The application `ClaimDispatch` is the only claim authority. Concurrent readers may race;
  exactly one claim wins. A claim commits before Fake dispatch. The scan cannot mutate state.
- **HAI-RUNTIME-102**: The process polls the durable queue, invokes only the registered `fake/v1`
  scenario, and publishes validated observations through `PublishRunObservation` with the complete
  persisted fence. A terminal success supplies digest-checked synthetic artifact bytes. It never
  creates Done, reviews or approvals. Adapter errors cannot cause another dispatch of a claimed Run.
- **HAI-RUNTIME-103**: Restart discovers Pending work. Already claimed work is never redispatched.
  Expired claimed leases transfer through `ClaimExpiredRunForReconciliation`, producing visible
  NeedsReconcile/OutcomeUnknown once. Live old leases are left alone until expiry. No automatic
  retry of unknown effects and no restore-generation invention are permitted.
- **HAI-RUNTIME-104**: Shutdown cancels and joins the poller before closing SQLite/artifact resources.
  Polling is bounded and cancellation-aware. Storage or dispatch failures terminate the worker and
  are surfaced by runtime shutdown rather than being silently retried in an infinite loop.
  Caller cancellation, worker failure and Serve termination share cancellation and bounded HTTP
  shutdown. Request contexts are canceled, admission closes, and all admitted handlers join even
  after forced socket closure. Shared resources cannot close while any such handler still runs.
- **HAI-RUNTIME-105**: Board snapshots and SSE replay read authoritative SQLite within a consistent
  read transaction, with project scope and a matching durable stream epoch/high-water cursor.
  Snapshot serialization follows the existing OpenAPI BoardSnapshot schema. Replay verifies payload
  digests and contiguous event identities; malformed/missing rows fail closed or cause an explicit
  projection reset through the existing HTTP adapter. Reads never allocate audit/event positions.
- **HAI-RUNTIME-106**: Missing projects remain not-found. Authentication precedes all HTTP reads.
  Snapshot after restart includes committed WorkItems and replay includes committed events; no
  mutable in-memory fixture is substituted. Events are bounded by the existing replay limits.

## Named checks

- `TestPersistentRuntime_ExecutesPendingFakeOnce`
- `TestPersistentRuntime_RestartPendingAndClaimed`
- `TestPersistentRuntime_ShutdownJoinsWorker`
- `TestPersistentRuntime_WorkerFailureDrainsHandlers`
- `TestPersistedProjection_SnapshotAndRestart`
- `TestPersistedProjection_ReplayIntegrityAndProjectScope`
- Existing application fencing, unknown cancellation, HTTP authorization, full backend and race gates.

Backup/restore, browser acceptance, external ledger import and real-provider execution remain later
gates. Native Go 1.27.1 verification in this environment must be identified separately from historical
digest-pinned-container evidence; unavailable verification must remain explicit.

## Projection availability details

Global sequence gaps caused by another project require an explicit reset/fresh snapshot.
No event identity is synthesized; reset metadata does not mutate durable retention.
`effective_satisfied=false` and `covered_ac_count=0` indicate that verified current-policy
coverage is unavailable in this slice, not computed evidence absence. Done rehydration still
requires its persisted CompletionRecord.
