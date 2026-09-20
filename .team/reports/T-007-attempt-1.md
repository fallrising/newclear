STATUS: PARTIAL

## Scope and provenance

T-007 attempt 1 ran in the isolated worktree `/home/ckc/test/codex/newclear-t007` on branch `agent/dim-gate/task/t007-shared`. Dispatch base and current uncommitted HEAD are both `93568d0fa2026213e5a2c5f8457b6c6bedb478e8`; the fixed M1 contract revision is `9ea032f66daabf68350482bfedac81f63e5221ec`. The built-in collaboration worker's exact inherited model ID was not exposed and is not guessed.

All task-listed inputs were read completely before edits: `platform/dim-gate/AGENTS.md`, M1/M0 contracts, SDD, CMDB/permissions/API/delivery specifications, PLAN and the T-006 report. No delegation, commit, push, PLAN edit, generated OpenAPI edit, composition-root edit or acceptance decision occurred.

## Implemented shared foundation

- Added canonical domain input schemas for manual CI onboarding and relation create/delete. Relation creation carries both endpoint version guards. The wire registry consumes these schemas rather than maintaining a second DTO definition.
- Split deterministic seed ownership into application/environment, CMDB and topology builders. The seed now has 6 applications, 12 environments and exactly 60 baseline CIs: 20 AWS, 20 Aliyun and 20 on-prem.
- Preserved published stable IDs such as `ci-aws-checkout-01`, `ci-aliyun-worker-01` and `ci-idc-redis-01`. The shared Redis is one canonical CI referenced by both Commerce and Data placements.
- Added scoped application/environment detail, CI list/detail, global entity search, relation list, topology, capacity and audit reads to the common domain engine. Lists filter before total/pagination. Scope-out detail and graph roots return the same 404 as missing entities.
- Added explicit `fresh`, `stale` and observation-`unknown` handling. Seed fixtures also include health unknown, empty filters and a real numeric zero capacity sample.
- Added manual CI onboarding with provider/account/location/pool validation, canonical duplicate detection, capacity guard, deterministic identity, audit/event/idempotency and atomic persistence. Existing metadata patch remains strict and cannot carry identity fields.
- Added relation create/delete commands with authorization on both endpoints, endpoint/target version guards, duplicate prevention, `runs_on` cycle prevention, idempotent replay, changed endpoint references and audit.
- Added bounded visible-only BFS: dependency uses outgoing edges; impact uses reverse `runs_on`/`depends_on`; cycles terminate; depth is 1–3; visible output caps at 100 nodes/200 edges. Hidden nodes and incident edges are removed before traversal, counts and truncation.
- Narrowed audit scope snapshots to the actual changed CIs so a deleted cross-scope relation cannot fall back to the actor's broader grants.
- Added focused M1 domain and wire-contract tests for AC-04–08 and AC-20 while updating the pre-existing domain seed assertions to M1 counts.

## Changed files

- `platform/dim-gate/src/api/contracts.ts`
- `platform/dim-gate/src/api/contracts/cmdb-application-environment.ts`
- `platform/dim-gate/src/api/contracts/future.ts`
- `platform/dim-gate/src/api/contracts.test.ts`
- `platform/dim-gate/src/demo/seed.ts`
- `platform/dim-gate/src/demo/seed/applications.ts`
- `platform/dim-gate/src/demo/seed/cmdb.ts`
- `platform/dim-gate/src/demo/seed/topology.ts`
- `platform/dim-gate/src/domain/schemas.ts`
- `platform/dim-gate/src/domain/engine.ts`
- `platform/dim-gate/src/domain/engine.test.ts`
- `platform/dim-gate/src/domain/m1.test.ts`
- `.team/reports/T-007-attempt-1.md` (this report)

## Verification

Commands used workspace-local Node 24.18.0 and pnpm 11.18.0 via:

`PATH=/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin:$PATH COREPACK_HOME=/home/ckc/test/codex/.toolchains/corepack`

- `corepack pnpm lint` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm exec vitest run src/domain/engine.test.ts src/domain/m1.test.ts src/api/contracts.test.ts` — passed, 63/63 tests in 3 files.
- `corepack pnpm test` — 95/96 tests passed. The sole failure is the lead-owned `src/demo/handlers.test.ts:46`, which still asserts the M0 seed's `applicationCount === 1`; M1 correctly returns 3 scoped Commerce applications.
- `corepack pnpm check:contracts` — reached the expected OpenAPI drift failure. Domain/wire schemas and operation milestone metadata changed, while T-007 is explicitly forbidden to edit generated `docs/openapi.json`. The orchestrator must run `pnpm generate:contracts` after integration and commit the regenerated artifact.
- `git diff --check` — passed.
- Base/HEAD verification: `git rev-parse HEAD` and merge-base with the dispatch SHA both returned `93568d0fa2026213e5a2c5f8457b6c6bedb478e8`.

## Composition needs and risks

- The orchestrator must update the central demo handler route allowlist/composition for the new reads and commands; T-007 changed only the common engine as required.
- The orchestrator must regenerate `docs/openapi.json`, update the stale handler count assertion, then rerun the full suite and contract gate.
- API clients, query invalidation, routes and UI remain owned by T-008–T-011.
- The bounded graph implementation and domain tests prove visible-node and visible-edge caps separately. Browser table fallback and truncation presentation remain UI-owned.
- Capacity deliberately aggregates distinct canonical active compute CIs, never placements. The shared Redis is a cache CI and therefore does not invent compute capacity; the regression proves additional shared placements do not change capacity.
- No commit was created. The orchestrator must review and integrate the working tree before accepting T-007.
