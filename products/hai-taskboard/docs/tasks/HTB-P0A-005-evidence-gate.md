# HTB-P0A-005: P0-A independent evidence gate

## Goal

Audit the complete candidate against every required P0-A clause and check without implementing fixes
or hiding failed/skipped/NotRun evidence.

## Inputs

- `.team/PLAN.md`, accepted SDD/ADRs/mini-SDDs
- `docs/traceability.md`
- all task/report evidence and actual repository diff

## Scope

Evidence report and orchestrator-authorized status updates only.

## Acceptance

- Actual diff is within authorized product/root-CI scope and contains no credentials/external effects.
- Every required traceability row names the executed command, environment, exit and report digest.
- Backend, frontend, E2E, failure-injection, backup/restore and fresh-context checks are independently
  reproduced or remain explicitly failed/skipped/NotRun.
- P0-A claim excludes real Codex, channel, production and deployment evidence.

## Forbidden

No self-fix, weakened test/policy, status laundering, commit, push, PR, release or deployment.
