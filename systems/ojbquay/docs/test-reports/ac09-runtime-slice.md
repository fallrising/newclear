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

AC-09 remains partial, AC-05 remains FAIL, `usable_tag: none`, owner acceptance pending.
