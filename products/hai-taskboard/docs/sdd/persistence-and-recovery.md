# Mini-SDD: Persistence, dispatch and recovery

Status: Accepted at G0 for P0-A
Parent: `../SDD.md` clauses HAI-AUTH, HAI-EXEC, HAI-API and HAI-OPS

## Transaction envelope

Each command uses an idempotency scope of principal, project, operation and key, then writes in order
constrained by foreign keys:

1. idempotency claim or validates an existing canonical request digest;
2. current aggregate rows using the expected version;
3. immutable append-only records such as Candidate/Evidence/CompletionRecord;
4. one audit group with before/after identity and actor;
5. zero or more outbox intents;
6. the canonical command result and final idempotency status.

Any failure rolls back all six. Response loss after commit is recovered by command/idempotency lookup.
No network, Git traversal, artifact hashing or executor invocation occurs inside the write transaction.

## Dispatch state

```text
dispatch: Pending -> Claimed -> Sent -> Acknowledged | FailedToDispatch
lease:    Unclaimed -> Held(epoch N) -> Expired -> Reconciliation
observed: Unknown -> Starting -> Running -> terminal observation
intent:   None | CancelRequested
effect:   NotApplicable | Confirmed | OutcomeUnknown
```

The concrete Run projection derives labels such as Queued, Claimed, Running, Recovering and
CancelRequested without erasing these dimensions. Claim uses a conditional SQL update. Every
subsequent publisher supplies Run ID, lease holder and epoch.

## Startup recovery

1. assert SQLite pragmas, schema checksums and artifact root safety;
2. mark expired held leases as requiring reconciliation in one bounded transaction;
3. inspect unacknowledged dispatches through adapter lookup when capability exists;
4. never resend a possibly mutating dispatch whose handle/outcome is unknown;
5. rebuild/verify projections to an audit high-water mark;
6. start commands disabled if integrity or artifact manifest verification fails.

P0 Fake lookups are deterministic from persisted scripted handles. Injected clock controls lease,
deadline, expiry and retention tests; production tests do not sleep to create timing behavior.

## SSE delivery

Committed audit/projection events receive a cursor `(stream_epoch, event_sequence)`. A query snapshot
returns its consistent cursor. Subscription begins after that cursor in the same epoch. Each
connection has a bounded queue; overflow closes it with a resumable/reset indication and never blocks
an application transaction. Retention expiry or an epoch mismatch yields
`projection_reset_required { current_epoch, minimum_sequence, snapshot_url }`.

## Backup/restore

Backup captures a consistent SQLite snapshot, schema version, audit high-water mark, restore
generation, stream epoch and artifact manifest. Restore starts with dispatch disabled, advances the
restore generation, rotates the stream epoch, checks database integrity and every referenced artifact
digest, runs only approved forward migrations, rebuilds projections, then requires an explicit enable
action. Pre-restore callbacks must carry the old generation and are fenced/quarantined. Missing
objects create attention/corruption state and invalidate coverage.

## Test oracles

- `TestCommandTransaction_FailureInjectionRollsBackAllWrites`
- `TestCommand_IdempotencySameRequestAndConflict`
- `TestDispatch_ResponseLossDoesNotDuplicateRun`
- `TestRunLease_RejectsStaleEpochPublication`
- `TestRunRecovery_ExpiryDoesNotImplyStoppedOrRetry`
- `TestCancel_UnknownStopIsNotCanceled`
- `TestSSE_SnapshotGapReplayAndRetentionReset`
- `TestSSE_RestoreEpochMismatchRequiresReset`
- `TestSSE_SlowConsumerCannotBlockCommand`
- `TestRestore_VerifiesArtifactDigestAndRebuildsProjection`
- `TestRestore_FencesPreRestoreCallbacksAndDispatch`
