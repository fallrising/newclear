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

Known gap kept open: the advisory lock lives on one PG session. If that session is lost after
the last `verifyOwned` and before or during the Kafka alter, a competing mutation can take the
freed key. Next slice replaces it with a durable DB lease bounded by the reset deadline.

AC-09 remains partial, AC-05 remains FAIL, `usable_tag: none`, owner acceptance pending.
