STATUS: PARTIAL

## Summary

T-034 taskrevision2/attempt1, W2 contractrevision2 (shared-change scope clarification read from lead; migration ownership unchanged), run DG-W2-20260923-01, project/variant dim-gate/mainline. Bounded fixture/migration worker owns only demo seed/controller/migration/new tests and this report. Worktree `/home/ckc/test/codex/newclear-dim-gate-w2-migration`, branch `agent/dim-gate/task/t034-resource-migration`, base/tested source `7086a443416fbc9876612e66bac889e83c8200ad` (W1 product content is accepted merge `b4ef57f1e15082f3e980b2eb0d8451b1f1f4433d`). No worker commit/push/delegation/self-acceptance.

Captured genuine W1 serialized storage using canonical controller commands before source changes: reset; stable deployment; next candidate through packaging; environment Request create/submit/independent Ops approval/provision; one clock tick; persona changes. Fixture contains a deploying Release, running ProvisionJob, two scheduler tasks, completed stable Release/history, idempotency receipts, three persona receipts, reset tombstone and generation1. No snapshot fields were invented or patched. Capture recipe is stored beside the fixture as a nonexecuted `.capture.ts.txt` file.

Fixture `platform/dim-gate/src/demo/seed/fixtures/w1-active-session.json`: 96,157 bytes, SHA256 `55c21bb325f3d8f5f45a4cc53326125420c90e08b884129b54de6b6d82f1abc6`.

Implemented deterministic fresh63CI fixture, five canonical objects, seven explicit bindings with shared Placement reuse, three per-parent quota ledgers, typed Redis/Kafka catalogs, second Ops/multigrant/no-grant personas, and strict metadata-only legacy migration. Migration validates original relationships before additions, then validates final schema/integrity; selected persona is validated by the controller before its single atomic write. All legacy business collections and identities are preserved. No migration infers Binding from legacy Placement.

Read-only T033 schema dependencies consumed with lead approval: schemas.ts SHA256 `707177f2d70e675f326f28227c8b3fd599a0f91a9a4b63dd9ebbcad64db68f3a`; integrity.ts SHA256 `721ee1b305ab81da1da532ce047931e4066ff77a97d45a4d3842d9e318d774c9`. These copied domain files remain T033-owned and are excluded from T034's handback.

Final owned source/test/fixture digest: `ba1c1b0aefc30cc4ff05e140cd01f817b0ce4a7143ee61c5c630afc7c7396a77`. SHA256 is over sorted `path + NUL + fileSHA256 + newline`; full reproducible manifest is `/tmp/t034-owned-final-manifest.json`. All code remains uncommitted in worker tree; tested_commit remains base7086a443 plus this exact local diff, not an invented implementation SHA.

Additional final read-only dependency snapshot `/tmp/t034-domain-dependencies-2.json` contains11 T033 modules; domain engine SHA256 `ab2bd040ad7c655a7c3f301bcfb50c44c9f84366504663acc31f22a397f12ea4`, schemas `93706a867db94011f97b9da41d3beb2c335ed62946625185361197ac1df0178b`, integrity `fe2b4d86e4e03a4ffa8c6a50764235cfe44ed36be3c6ebacef507e1aa439adea`, resource-integrity `097f48b0d4169bd67db49f7b5263c3dc16a98daf6129cc36f6f73c33885bad81`. Copies were expressly authorized by lead; never edited by T034.

## Verification

- Component `pnpm install --frozen-lockfile` with Node24.18.0/pnpm11.18.0 at base7086a443 — passed
- `pnpm test -- src/demo/seed/capture-w1.test.ts` at original W1 product source plus one temporary capture test: actual command ran all24 test files,246 tests, all passed in6.93s; capture test subsequently retained as nonexecuted recipe — passed

- `pnpm exec vitest run src/demo/migrations.test.ts src/demo/seed/resources.test.ts`:23/23 focused migration/fixture cases at local T034 diff and published T033 dependencies — passed
- `pnpm exec eslint src/demo/controller.ts src/demo/migrations.ts src/demo/migrations.test.ts src/demo/seed.ts src/demo/seed/core.ts src/demo/seed/resources.ts src/demo/seed/resources.test.ts` — passed
- `pnpm exec vitest run src/demo`:53/58 pass;5 failures are unchanged baseline expected60CI/oldm4seed and checkoutIDC count1 assertions, reported to lead for additive fixture update; full log `/tmp/t034-demo-first.log` — failed
- `pnpm typecheck`: expected pending catalog-union narrowing in T033 engine/m2test and T035 Admin/SelfService UI; no errors in T034 owned files; log `/tmp/t034-typecheck-first.log` — failed
- `git diff --check` and pinned `teamctl.py validate-report .team/reports/T-034-attempt-1.md` — passed

- Final `pnpm exec vitest run src/demo/migrations.test.ts src/demo/seed/resources.test.ts src/demo/resource-persistence.test.ts`:33/33 cases,3files,656ms; log `/tmp/t034-focused-final.log`, Node24.18.0/pnpm11.18.0 — passed
- Final ESLint on all8 owned TypeScript files plus `git diff --check` — passed
- Final requested `pnpm typecheck` after stable T033 engine integration: fails only unconsumed baseline m2test compute narrowing and lead-owned Admin/SelfService UI narrowing; no T034 source/test or T033 product-file errors — failed

Final33 cases include exact W1 identity/history/counters/receipts preservation, active original Release+ProvisionJob completion once, two-layer legacy/final integrity rejection, quota-limited migration without writes, original60CI preservation plus63fresh, explicit shared bindings/Placement/quota uniqueness and fresh persona scope. Eight new persistence cases drive actual Redis/Kafka commands through controller approval/execution and verify refresh, reserved quota before success, release on failure/success, observed usage remaining unknown, atomic507 terminal-write rejection, failedattempt preservation/new decision/retry stableIDs, corrupt scheduler rejection, and reset generation preventing ghost execution.

## Documentation

Read applicable AGENTS/task/W2 contract/protocol/SDD persistence and role/resource requirements. Root owns all product specs, PLAN, STATUS, canonical report and acceptance. T033 owns schemas/integrity exclusively; migration consumes their strict legacy exports after lead confirms handoff.

## Risks and Follow-ups

T034 bounded implementation is ready for lead integration; final report remains PARTIAL solely because task's requested full-demo/typecheck checks include other owners' still-unconsumed baseline count and UI narrowing updates. All33 owned focused cases and lint/diff checks pass with the wired resource engine. This does not waive those remaining checks or claim W2 acceptance. Earlier53/58 demo and typecheck failures remain recorded above as actual intermediate observations.

Handback owns these files only: `src/demo/controller.ts`, `src/demo/seed.ts`, `src/demo/seed/core.ts`, `src/demo/seed/resources.ts`, `src/demo/seed/resources.test.ts`, `src/demo/migrations.ts`, `src/demo/migrations.test.ts`, `src/demo/resource-persistence.test.ts`, `src/demo/seed/fixtures/w1-active-session.json`, `src/demo/seed/fixtures/w1-active-session.capture.ts.txt`, and this attempt report. Exclude every copied `src/domain/**` file from T034's patch; root consumes T033's canonical files separately. No existing worktree was removed or reset, and no worker commit/push occurred.

Next executable step: lead copies this bounded slice, integrates final T033 domain and its own intentional baseline fixture assertions/UI narrowing, runs `pnpm exec vitest run src/demo` and `pnpm typecheck`, then binds acceptance/review to a real implementation commit. Correct expected recovery counts60→63/seedm4→w2 in controller.test.ts and scoped checkout/dev IDC count1→2 in w1-handlers.test.ts; preserve failure branches and all original stories. Domain test count changes remain T033-owned. Fixture/migration browser business acceptance and wholeW2 regression/review/CI/Git delivery remain lead-owned gates. Worker source/report are LOCAL_ONLY until lead confirms integration and SSH save.
