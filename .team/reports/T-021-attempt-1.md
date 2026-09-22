STATUS: PARTIAL

## Summary

Task: T-021, dim-gate/mainline M4, revision 1, attempt 1. Worker implementation is ready for lead integration; this report does not accept the task or milestone.

- Worktree: `/home/ckc/test/codex/newclear-m4-domain`; branch: `agent/dim-gate/task/t021-observation-domain`.
- Tested base commit: `157605bfb32d818a4b09e5bf17d3f21b6f3c3cbe` plus the listed uncommitted implementation files and the lead-synchronized schema navigation enum. No worker commits, pushes, merges, network or cloud operations.
- Final implementation aggregate SHA-256: `4647dc08593695160416d8e72592f04087354b8976bdc50c883b36b68116a31c`. Computed by concatenating each ordered relative path, NUL, its exact bytes, NUL in the deliverable order below.
- Implemented one-minute RED telemetry, correlated trace/log projections, sustained threshold evaluation, dedupe/reopen, reasoned/versioned Ops incident writes and authorization before replay, deterministic 60/120/180-tick rollback recovery, stale-release and new-anomaly cancellation, demo integrations, scoped incident search/audit/dashboard/notifications, coherent Guide business selectors and restore integrity.
- Explicit observation scenarios advance the same transaction scheduler by 180 ticks. Receipts/audit describe only their authorized target while other in-flight work progresses atomically. Quota failures retain the entire prior snapshot.
- Successful release supersession resets a still-active incident's stale recovery count; the new release and incident changes share the existing delivery event/audit transaction. Historical breach evidence remains append-only.

Deliverables (relative to `platform/dim-gate/`):

- `src/domain/engine.ts`
- `src/domain/engine.test.ts`
- `src/domain/delivery.ts`
- `src/domain/integrity.ts`
- `src/domain/observation.ts`
- `src/domain/observation-views.ts`
- `src/domain/observation-integrity.ts`
- `src/domain/m4.test.ts`
- `src/demo/seed.ts`
- `src/demo/seed/observations.ts`
- `src/demo/controller.test.ts`

The worker did not edit shared schemas. The lead copied the current `src/domain/schemas.ts` into this worktree solely to unblock testing against the registered M4 navigation keys; exclude it from the worker handoff. The lead explicitly authorized the narrow existing `engine.test.ts` expectation change from unimplemented 501 to implemented scoped 404, and rejection of unrelated `environmentId` on existing delivery-fault inputs.

## Verification

All commands ran in the component directory with `PATH=/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin`. Actual runtime: Node v24.18.0, pnpm 11.18.0. Lockfile SHA-256: `0da752e9e75f7b22902ba601583d1979e0a0d63b34275bcc445c4286dec7a32b`.

The local `node_modules` symlink points to the lead's installed dependency directory. The first plain `pnpm typecheck` tried pnpm's automatic dependency verification/install and aborted before module changes (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`). Subsequent invocations explicitly disable that implicit install using `--config.verify-deps-before-run=false`; no dependency or lockfile edits were made.

- `pnpm --config.verify-deps-before-run=false run test src/domain src/demo/controller.test.ts` at 09:37:05, 2026-09-22; 6 files, 131/131 tests, exit 0. — passed
- `pnpm --config.verify-deps-before-run=false run test` at 09:37:53, 2026-09-22; 18 files passed, 1 file failed; 190/191 tests passed. Sole failure: lead-owned `src/demo/handlers.test.ts:143` still expects 501 for the now-implemented incident investigate endpoint; RD receives the correct 403. Lead notified and owns that HTTP-fixture update. — failed
- `pnpm --config.verify-deps-before-run=false run typecheck` at 09:37:53, 2026-09-22; sole diagnostic TS2739 in lead-owned `src/app/App.test.tsx:32`, whose DashboardView fixture lacks `activeIncidentCount` and `pendingItems`. No T-021 TypeScript diagnostics remain. — failed
- `pnpm --config.verify-deps-before-run=false exec eslint` with all 11 deliverable source/test paths; exit 0. — passed
- `git diff --check`; exit 0. — passed
- Pinned kernel report validation using `agents/codex-team-superpowers/scripts/teamctl.py validate-report .team/reports/T-021-attempt-1.md` — passed

New domain coverage contains 19 tests, including parameterized null/gap/threshold interruptions and release supersession after 1/2 healthy samples. Assertions cover actual window timestamps, unrelated in-flight scheduler progress, replay and revoked grants, acknowledge/investigate/takeover, rollback failure, recovery 1/2/3, explicit fallback, reopen after resolution, preservation of partially renewed abnormal episodes, project/stage/Admin raw-data denial, CI reference redaction, integration pool/audit filtering, strict query/target validation, pagination, persistence atomicity and corrupt persisted references/windows/tasks. The Guide test completes one Aliyun request/environment/release/incident chain after creating unrelated history and verifies that unrelated history cannot complete its steps. Controller coverage adds valid minute-work reload, intact corrupt recovery bytes, explicit memory/reset recovery, no ghost samples, and M3 seed rejection.

Early runs before the lead schema sync failed on the missing M4 route-key enum; that integration blocker was resolved by the lead's byte-for-byte schema copy. A new test initially assumed provisioning notifications used job as their primary entity; the actual existing domain event uses request. It now verifies the emitted request's accessible RD route. These early failures are not represented as final passing evidence.

## Documentation

Read T-021, applicable component AGENTS, SDD, STATUS, M4 integration contract, workflow, permissions, API/mock and acceptance specifications plus current domain/persistence conventions. The lead owns SDD/API/schema/route documentation; worker notified the lead that the old workflow's recovery wording said one sample per tick, and implemented the frozen M4 rule of one sample per 60 ticks. The lead confirmed and corrected that wording.

This report is the worker handoff. At handoff, the lead reported integrating the stable files and passing native typecheck plus 207 integration tests. Those are lead-reported results, not worker-executed evidence; the lead owns their commit binding. Worker source remains local and uncommitted. The parent must bind final full-gate evidence to the resulting implementation commit.

## Risks and Follow-ups

- The lead must update the two existing shared test fixtures identified above, then rerun native/full integration gates. This worktree therefore reports PARTIAL despite all assigned domain/controller tests passing.
- The eight Guide business steps are complete, coherent domain selectors. As requested by the lead, Admin navigation preparation, Ops inventory/topology preparation and final audit/reset access remain explicit lead integration/UI follow-ups; read-only visits are not marked falsely complete.
- HTTP wire/client/router/UI composition, full browser evidence and independent review belong to the lead/T-022/T-023. No worker browser or milestone acceptance claim is made.
- Registered scenario window endpoints treat their required app/environment pair as a scoped target: missing, mismatched or unauthorized pairs return 404; Admin without an explicit scoped RD/Ops grant gets 404 for raw trace/log access. Incident list filters remain scoped empty lists. This behavior was coordinated with the lead.
- Existing session limits retain append-only observation history: 1,000 commands and 3 MiB persistence. Hitting the limit fails the entire transaction instead of silently truncating incident proof.
