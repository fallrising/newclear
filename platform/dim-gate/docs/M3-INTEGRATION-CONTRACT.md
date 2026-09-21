# M3 integration contract

Revision 2 · base `e760d8e988c0e2a837b226c600805a659a362c10` · AC-13–16、AC-24

## Scope and persistence

M3 implements the SDD's simulated delivery flow: ready environment → pipeline → artifact → candidate release → health gate → active release → rollback. M2 was accepted at `513e6cc` and merged by PR #13 at `29bed417`; post-merge CI 35591531196 passed. M4 observation samples and incident resolution remain a separate milestone.

The snapshot uses `dim-gate-m3-v1`, with empty `pipelines`, `releases`, `artifacts` and `deliveryLogs` collections in the baseline. M2 bytes are preserved until explicit recovery/reset. Existing 60 CIs and 12 environments remain unchanged; a newly provisioned environment has no invented release history.

## Delivery semantics

- Trigger requires scoped RD and a ready app/environment pair plus `environmentVersion`. A lock is derived from nonterminal runs and releases; a linked run/release is one operation. Trigger and rollback during an existing operation return `409 ENVIRONMENT_BUSY`. No separately mutable lock store is introduced.
- Build/test/package complete at logical ticks 1/2/3. Package creates an immutable artifact and a release. The artifact digest is a deterministic, explicitly synthetic digest of application, source revision and recipe; it is not a downloaded binary or cryptographic attestation. Reusing a digest requires identical source metadata.
- The release then enters deploying, verifying, and a terminal state on successive ticks. Only a healthy succeeded release updates `activeReleaseId`; its `previousReleaseId` captures the active release before this operation. Pipeline stages and bounded timestamped logs remain inspectable after reload.
- Prod pauses at `pending_approval` / `awaiting_approval` until another scoped Ops user approves. Persist approval actor/time/reason. Self-approval is 403 even with RD+Ops grants; Admin-only writes are 403. Rejection fails the run and releases the environment lock.
- Cancellation is allowed before deploy, including awaiting approval and a queued candidate; it skips unfinished stages, cancels the candidate and removes scheduled tasks. Deploying/verifying cancellation is 409. Retry creates a new run/correlation and retains `retryOfRunId` without rewriting prior history.
- Rollback requires path ID = current active, matching release/environment versions, a same-environment succeeded target with a different artifact still in the registry, and a free environment. It creates a new release with previous/target references and reason; prod uses the same approval rule. Failure leaves active unchanged; success points active at the new rollback release and emits a recovery-requested event for the future M4 observation engine. It does not resolve an incident in M3.
- One-shot demo faults are strictly targeted: `build-failure` requires a run whose build is unfinished; `health-failure` requires a run or its deploy release before verify completes; `rollback-failure` requires a nonterminal rollback release. Missing, unrelated, cross-scope or late targets are rejected. Failures remain visible in history and logs.
- The explicit playback control advances one tick per second without overlapping requests, stopping at approval/terminal state or on error. Leaving the view, persona/policy/reset changes and reload pause playback; resuming uses persisted steps without offline catch-up. Pausing stops future ticks; if a clock request is already in flight, manual stepping and resume remain disabled until that request and the affected query refresh settle. An in-flight guard survives playback effect cleanup. Manual stepping remains available while paused and idle. Completion feedback waits for affected queries to refresh.

## Authorization, audit and API

All commands use the existing serialized transaction, current authorization before idempotency replay, version checks, atomic persistence and receipts. Read scope includes environment stage. Pipeline logs require RD/Ops scope; Admin can read release/artifact metadata only. Hidden list/detail/search/audit results remain empty or 404. Each scheduled transition writes entity-scoped audit/event entries under its operation correlation, so advancing Commerce and Data operations together cannot expose the other operation's references.

Clock receipts and their replays/summary events name only the demo session, never the set of globally progressed operations. Revision notifications refresh scoped queries. Restored delivery tasks must match the exact run/release stage and next due tick; invalid positions trigger incompatible-snapshot recovery without rewriting the original bytes.

Existing M3 endpoints become implemented. Pipeline detail is `{run,logs}`; release detail is `{release,artifact,rollbackTargets}`. Release fields add health, reason, approval, failure code and execution timestamps. The environment detail exposes the actual active release. Search includes authorized release IDs/source revisions.

Routes: `/rd/pipelines`, `/rd/pipelines/:runId`, `/rd/releases/:releaseId`, `/ops/releases`, `/ops/releases/:releaseId`. Detail deep links accept the corresponding read action across centers. Navigation entries remain role/action guarded. Environment detail links to pipeline history and current release.

## Interface and evidence

Reuse the existing indigo console, semantic status tokens and accessible dialogs. Pipeline list has app/environment filters and a trigger dialog; detail has five stage controls, logs, artifact/release links, scoped cancel/retry and clearly marked demo clock/fault controls. Release detail separates current active from candidate/target, provides a reasoned rollback dialog and exposes approval, health and audit history. Ops release list provides pending-approval filtering. At 390px stages wrap and tables scroll locally; 768/1440px preserve the same controls. Dialogs use initial focus, Tab containment, Escape and focus restoration.

T-018 owns shared schema/domain/API integration and regression. T-019 owns bounded UI/client/browser work after this contract is fixed. T-020 is an independent read-only review of a fixed commit; final acceptance also requires all native gates, production Chromium evidence, current remote CI and the orchestrator's decision. No live runner/provider, deployment, paid service, dependency addition or global configuration is required.
