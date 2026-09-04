# SDD-011 Execution Tasks

## Phase 0 — Baseline and Contract

- [x] Fetch/prune origin and verify `master`/`origin/master`, clean tree, PRs, and issues.
- [x] Read architecture, API/security, migration, deployment, CI, and prior SDD patterns.
- [x] Run baseline backend/frontend quality gates.
- [x] Define BDD behavior, quotas, report lifecycle/auth, signal minimization,
  retention, proxy trust, migration, and rollback contracts.
- [x] Complete an independent adversarial review and incorporate accepted findings.
- [x] Pin report security matchers, fail-closed secret, forwarded-header trust,
  IPv6 /64 normalization, edge log redaction, and deterministic header rules.

## Phase 1 — Persistent Schema

- [x] RED: add V10 clean/populated migration and constraint tests.
- [x] GREEN: add the smallest additive V10 migration.
- [x] Verify clean V1→V10, populated V9→V10, FK/unique/CHECK behavior, FTS, images,
  history, and `PRAGMA integrity_check`.
- [x] Prove a failed V10 leaves V9 history/schema intact.

## Phase 2 — Rate Limiting and Privacy Boundary

- [x] RED: keyed hashing, canonicalization, fixed-window, atomic dual-policy,
  headers, 429, auth/CSRF ordering, and redaction tests.
- [x] GREEN: client signal boundary, persistent repository/service, MVC interceptor,
  RFC 9457 error, and config/deployment secret wiring.
- [x] Refactor with all focused tests green and adversarially review trust/concurrency.

## Phase 3 — Reports and Abuse Signals

- [x] RED: post/reply report success, duplicate, invalid reason/ID/target,
  authorization, isolation, redaction, and rollback tests.
- [x] GREEN: report model/DTO/repository/service/controller and security matcher.
- [x] RED/GREEN: atomically record post/reply/report signals, including image-post
  compensation and forced rollback failures.
- [x] Add startup/daily retention cleanup and prove live rows survive.

## Phase 4 — Frontend and Documentation

- [x] Add typed report API and accessible post/reply report controls.
- [x] Run frontend lint/build.
- [x] Update README, ROADMAP, architecture, development, migration, deployment,
  and verification docs to match final behavior.

## Phase 5 — Release Gate

These external delivery checks are recorded in the PR, CI runs, and final handoff
rather than as durable source checkboxes, because final-head and post-merge evidence
only exists after this branch version is committed:

- Full backend suite with test count; frontend lint/build.
- Clean and populated migration evidence.
- Docker image build, digest, and runtime moderation matrix including restart.
- Independent final review and evidence gate.
- Commit/push, open PR, wait for final-head CI, merge, wait for post-merge master CI.
- Confirm open issues/deployments, synchronized clean master, and no deploy.
