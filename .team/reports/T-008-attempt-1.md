STATUS: DONE

# T-008 attempt 1 — RD application/environment slice

## Summary

- Task: `T-008`, attempt 1, worker role; built-in collaboration worker. The runtime did not expose an exact model ID, so none is guessed.
- Dispatch HEAD: `73771958d93d405a877886a4805d667a67b67d8c`; accepted product base: `888d81203d01aab8781c42ac47138e053bf2c487`.
- Worktree/branch: `/home/ckc/test/codex/newclear-t008`, `agent/dim-gate/task/t008-rd`.
- Implemented a typed application feature client for scoped list, application detail and environment detail reads using the fixed generated-contract Zod schemas.
- Implemented real RD application list, application detail and environment detail route components with loading, scoped empty, retryable error and non-disclosing 404 states.
- Environment placements retain canonical `ciId`, aggregate duplicate placement roles into one visible CI row, and provide the required `/ops/cmdb/:ciId` deep link. Successful zero placements are explicitly distinguished from unknown data.
- Left all changes uncommitted and made no PLAN/STATUS, central composition, global CSS, E2E, schema/domain/seed, commit, push, PR or acceptance changes.

Changed files:

- `platform/dim-gate/src/api/clients/application.ts`
- `platform/dim-gate/src/api/clients/application.test.ts`
- `platform/dim-gate/src/features/cmdb/application/index.ts`
- `platform/dim-gate/src/features/cmdb/application/routes.tsx`
- `platform/dim-gate/src/features/cmdb/application/routes.test.tsx`
- `.team/reports/T-008-attempt-1.md`

## Verification

- `pnpm exec vitest run src/api/clients/application.test.ts src/features/cmdb/application/routes.test.tsx` (2 files, 8 tests) — passed
- `pnpm test` (9 files, 104 tests, including accepted M0 and T-007 regression coverage) — passed
- `pnpm lint` — passed
- `pnpm typecheck` — passed
- `pnpm check:architecture` (no cross-feature private imports) — passed
- `git diff --check` (rerun after report creation for final worktree evidence) — passed

Focused tests cover stable client URLs/schema parsing, loading without a fake zero, RD Commerce scoped empty behavior without Data identifiers, application/environment canonical deep links, shared-CI deduplication, explicit zero-placement semantics and the same non-disclosing 404 presentation for missing/scope-out details.

## Documentation

- No product or contract documentation changed. Implementation follows `M1-INTEGRATION-CONTRACT` revision 1 at `9ea032f66daabf68350482bfedac81f63e5221ec` and the T-008 task revision 1.
- This attempt report is the only task metadata written by the worker.

## Risks and Follow-ups

- The orchestrator must add `createApplicationClient(request)` to the central API facade, re-export the application subtree through `src/features/cmdb/index.ts`, and register `/rd/apps`, `/rd/apps/:appId`, and `/rd/apps/:appId/environments/:environmentId` with their required actions and center guards.
- The orchestrator owns global styling for the list/detail table and search controls and must verify responsive widths, both themes, keyboard/focus behavior, and integrated browser journeys.
- AC-20 in-flight response/cache clearing remains central AppSession/E2E ownership. These components use identity-prefixed query keys and render only policy-filtered API projections; their focused tests do not replace the required persona-switch browser test.
- Importing `wireSchemas` keeps DTO validation sourced from the contract registry but may affect bundle composition once the factory is wired into the central client; the orchestrator should observe the production build size during integration.
