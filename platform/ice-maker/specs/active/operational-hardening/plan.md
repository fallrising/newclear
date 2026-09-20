# Operational hardening implementation plan

## Scope and design

T-024 defines strict observability, quota, and local/external evidence values.
T-025 independently defines tracked runner/identity/egress contracts and safe
local drill primitives. After both are accepted, T-026 composes them into the
Phase 7 journey and operator runbook. No task changes protected paths or invokes
real infrastructure.

## Requirement-to-evidence mapping

| Requirement | Change | Verification | Rollback |
|---|---|---|---|
| FR-2, FR-4 | metrics, quotas, evidence/readiness | operations unit tests | revert T-024 |
| FR-1, FR-3 | hardening configs and drill primitives | adversarial hardening tests | revert T-025 |
| FR-5 | composed local journey and runbook | subprocess-free E2E test | revert T-026 |

## Risks and dependencies

- Evidence overclaim: the local evaluator has no `PRODUCTION_READY` outcome;
  the runbook enumerates separately attested gates.
- Secret leakage: rotation works only with opaque credential metadata and
  rejects values or secret-like labels.
- Restore corruption: validate all source bytes and publish the destination
  atomically without following symlinks or replacing existing state.
- Network escape: validation is pure and deny-by-default; real proxy enforcement
  is explicitly external-pending.
- Dependency growth: standard library and tracked JSON only; no scheduler or
  observability package is added.

## Migration and rollback

There is no production migration. Revert the Phase 7 checkpoint to remove local
contracts and drills. Never delete external backups or credentials as rollback.

## Review gate

The orchestrator reviews every diff, runs focused and full tests, probes forged
evidence and unsafe configuration, validates source hashes, then runs the whole
journey from a clean checkout. Real operational evidence remains pending.
