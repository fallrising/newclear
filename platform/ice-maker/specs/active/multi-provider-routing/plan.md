# Multi-provider routing implementation plan

## Scope and design

First add concrete adapter boundaries for OpenCode and read-only Claude/Grok
review. In parallel, add a pure deterministic router and immutable usage ledger
driven by alias-only JSON configuration. After both are accepted, compose them
behind a sequential builder/gate/reviewer pipeline. All tests use fake local
executables and synthetic data.

## Requirement-to-evidence mapping

| Requirement | Change | Verification | Rollback |
|---|---|---|---|
| FR-1, FR-2 | adapter implementations | fake-CLI doctor/invocation tests | revert T-011 |
| FR-3, FR-4, FR-5 | routing policy and usage ledger | deterministic selection/budget tests | revert T-012 |
| FR-6 | sequential pipeline | builder/gate/reviewer contract tests | revert T-013 |

## Risks and dependencies

- CLI flags vary: keep exact argv construction in each adapter and fail doctor
  closed on unknown version output.
- Fallback can silently weaken policy: config names only allowed aliases, and
  runtime selection requires equal data permission and a distinct bounded attempt.
- Review may accidentally gain write access: the review adapter receives an
  input artifact and output path, never a writable source workspace.
- Real provider calls are intentionally not used; external auth/model/rate-limit
  integration remains explicitly pending.

## Migration and rollout

The new configuration and modules are opt-in. No existing provider policy,
workflow, credential, or production process changes. Rollback is the Phase 3
checkpoint revert.

## Review gate

The orchestrator reviews each worker diff, reruns focused and repository gates,
confirms two fake adapter paths execute the same fixture, then records external
provider evidence as pending.
