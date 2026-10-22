# AC-09 runtime lifecycle slice

Scope: T-0368 repair of T461 review blockers R1 (failed worker stop terminated the
config bus) and R2 (mandatory roster broke K8s/standalone startup). Only runtime,
common and startup sources were extracted from the uncommitted
`agent/ojbquay-reset-gate` candidate (base `874517a896b3be1695b8febb2a852f7e6c5f9307`);
console preview/group workflow/PG fence changes were left out.

## Change

- `PushWorkerOrchestrator`: lifecycle runs on a 250 ms fixed-delay reconciler; stop
  failures are recorded, the worker and unconfirmed revision are kept, and later
  reconciles retry until the handler terminates. Pause status confirms only when
  the applied revision matches and no worker remains.
- `KafkaConfigBusClient`: failure listeners; readiness and running drop when polling ends.
- `GatewayConsumeRuntime`: fatal config failure lowers readiness and bootstrap state;
  close attempts every owned resource and aggregates failures. An empty roster starts
  normally but reports pause status as not stopped, so reset stays fail-closed.
- Last candidate regression (`startsReplacesAndStopsWorkersFromSubscriptionRevisions`,
  `expected 4 but was 0`): `onDeleted` cleared the revision even when the store still
  held the subscription. It now forgets the revision only once the store holds the
  tombstone. No assertion, sleep or timeout was changed.

## Evidence

- `./gradlew :modules:gateway-consume:test :modules:common:test`: 65 tests, 0 failures,
  0 skipped, including real-Kafka `RuntimeRecoveryAc09IntegrationTest` (failed stop →
  later config event read → confirmation after real termination; unconfigured standalone
  start cannot confirm; fatal config failure lowers readiness).
- `./gradlew build --no-daemon --no-parallel` (CI command): BUILD SUCCESSFUL; 120 JUnit cases
  in regenerated reports, 0 failures/errors/skips. `make validate-deploy`: PASS (model check only).
- Not run: K8s runtime, real two-runtime reset, preview/UI, AC-05 timing.

## Reconcile robustness follow-up

Closes two non-blocking notes from the PR #480 review:

- The scheduled reconcile catches failures, so one exception no longer cancels every later
  reconcile; the failure shows in `lastError` until the next clean pass.
- After config-bus loss, reconcile still retries stops for workers the store no longer wants
  running. It never starts, replaces or records a revision without a live bus, and pause
  status stays unconfirmed.

Evidence: `PauseLifecycleAc09Test` adds `AC_09_reconcileFailureDoesNotCancelLaterReconciles`
and `AC_09_failedStopIsRetriedAfterConfigBusLossWithoutConfirming`; both failed on main
(`ac09-reconcile-robust-red.log`) and pass after the fix. `./gradlew build --no-daemon
--no-parallel`: BUILD SUCCESSFUL, gateway-consume 44 tests, 0 failures/skips.
Still open from that review: the status endpoint can wait up to 5 s on a worker close.

## Console reset gate

Extracted from the same candidate (console-api only; files and SHA-256 in the PR):
`RuntimePauseVerifier` (every roster runtime must report the exact paused revision,
stopped fetch, settled inflight, same boot and roster; bounded HTTP), `GroupMaintenanceFence`
(PG advisory key shared by ordinary subscription mutations and the reset workflow),
deadline-bounded group quiet wait, retained-range check and alter readback in
`DefaultGroupOperations`, and restoration of the paused subscription in `GroupWorkflowService`.

Evidence: `./gradlew build --no-daemon --no-parallel` BUILD SUCCESSFUL; console-api 42 tests,
0 failures/skips, including `RuntimePauseVerifierAc09Test` 7, `DefaultGroupOperationsAc09Test` 4,
`GroupMaintenanceFenceAc09Test` 1 (real PG) and `TopicApiIntegrationTest` 22.

Review rework: if the maintenance session is lost mid-reset, restoring the paused subscription
under the lost gate failed with 409, leaving it paused and hiding the original error. Restoration
is now retried after the gate is released, as an ordinary fenced mutation; a failed retry is
logged and attached to the original failure. `AC_09_lostMaintenanceSessionStillRestoresSubscription`
terminates the advisory session during the quiet wait on real PG: it failed before the fix
(`ac09-restore-lost-fence-red.log`, state 0) and passes after it (state 1, no Kafka alter).

Lease fence (C1b): reset also commits a `group_maintenance_lease` row (V2 migration) that ordinary
mutations check under their advisory lock; it survives loss of the advisory session and is removed
on a fresh session when the gate closes, or expires 5 min after the reset deadline.
`AC_09_sessionLostDuringKafkaAlterStillFencesCompetingMutation` terminates the session inside the
Kafka alter and races a resume: it succeeded before the fix (`ac09-lease-fence-red.log`) and is
rejected with GROUP_MAINTENANCE_IN_PROGRESS after it; console-api 44/0, `./gradlew build` and
`make validate-deploy` pass. This proves a bounded session-loss path using real PostgreSQL and mocked
Kafka/runtime services, not full cross-system safety.

C1b takeover (T-0374, previously T-0368): independent review found that a rejected lease INSERT
returned a still-lock-owning physical connection to the pool. The real-PG constraint-failure
regression observed one residual advisory lock (expected zero). Failed acquisition now releases
the key; if unlocking fails it aborts the physical session before pool return. The companion
fault-injection unit test checks that cleanup ordering. See `.team/reports/T-486.md` and
`.team/evidence/c1b-takeover/` at the repository root for review and local execution receipts.

Still open: the Kafka future's local timeout does not prove the alter operation has terminated.
The inherited workflow can restore consumers and release protection while that outcome is unknown.
A five-minute lease margin also does not prevent a process suspended beyond expiry from submitting
late work after losing its PG session. Neither is settled by this regression; full AC-09 safety
requires explicit uncertain-outcome reconciliation and stale-owner prevention. Mixed old/new console
binaries were not validated. Preview/confirm, whole-group coordination and real two-runtime reset
remain separate gaps.

AC-09 remains partial, AC-05 remains FAIL, `usable_tag: none`, owner acceptance pending.

Takeover verification: `./gradlew :modules:console-api:test --no-daemon --no-parallel` passed46/0/0/0;
`./gradlew build --no-daemon --no-parallel` succeeded (140 current XML cases including cached unchanged
modules); `make validate-deploy`,15 project-contract tests and41 project contracts passed. T486
follow-up accepts the bounded correction; initial REWORK and RED are retained.
