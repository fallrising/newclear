STATUS: DONE

## Summary

Independent attempt 2 reviewed immutable correction commit `784f771a040be72fedf2f1521912900990c09dbf` (tree `365e621f8491865fd0f6760e607c4524a2ea4ad6`, parent evidence checkpoint `aaab04958df923a9b92ddd71fb209c1bf735e67a`). The reviewer did not implement or integrate this correction. Exact runtime model ID remains unexposed and is not guessed.

Review verdict: ACCEPTED. F-01 and F-02 are independently closed in both code and executable behavior, no new blocking regression was found, and the prior browser evidence limitation was independently exercised. Milestone/PR acceptance remains the orchestrator's decision.

## Verification

- Complete `aaab049..784f771` correction diff, contract revision 2, Zod changes, generated OpenAPI delta, and focused regressions were inspected — passed
- `pnpm install --frozen-lockfile` with Node 24.18.0 and pnpm 11.18.0 — passed
- `pnpm exec vitest run src/domain/m1.test.ts src/demo/controller.test.ts` completed 25 of 25 tests — passed
- Independent F-01 create/delete reproduction returned zero Commerce audit events for both unfiltered and entity-filtered reads, while Ops received both `relation.create` and `relation.delete` — passed
- Independent F-01 fail-closed reproduction returned zero events to scoped Commerce and Ops when one retained endpoint ID was missing; org Admin retained its intentional enterprise-wide audit visibility — passed
- Independent F-02 reproduction kept the stable `dim-gate.demo.v1` key, raised `DEMO_SNAPSHOT_INCOMPATIBLE`, performed zero writes, and preserved the legacy raw bytes exactly before recovery — passed
- Explicit F-02 reset recovery produced seed `dim-gate-m1-v1`, a new session, exactly 60 CIs, and exactly 20 AWS, 20 Aliyun, and 20 on-prem CIs — passed
- `pnpm lint`, `pnpm typecheck`, and full `pnpm test` completed 122 of 122 tests in 14 files — passed
- `pnpm check:docs` reported 63 Markdown files and 141 repository links; `pnpm check:contracts` reported 72 operations and 166 schemas — passed
- `pnpm check:ci`, `pnpm check:architecture`, actionlint 1.7.12, and immutable correction `git diff --check` — passed
- `VITE_DATA_MODE=demo pnpm build --mode demo` completed with a 413.17 kB gzip JavaScript bundle — passed
- `LD_LIBRARY_PATH=/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu pnpm test:e2e` completed 11 of 11 production Chromium tests — passed
- Independent browser check at 390px confirmed onboarding-dialog initial focus inside the dialog, tab containment, Escape close, trigger focus restoration, and zero serious/critical axe findings — passed
- Independent 1440px dark-theme topology check confirmed the accessible table alternative and zero serious/critical axe findings — passed

## Documentation

M1 integration contract revision 2 explicitly records historical relation endpoint authorization and `dim-gate-m1-v1` compatibility behavior without duplicating DTO definitions. `02-cmdb-model.md`, Zod schemas, seed/guide types, tests, and generated OpenAPI agree. The wire shape adds optional `scopeSnapshot.relationEndpointCiIds` and changes the seed-version constants; OpenAPI remains generated from Zod.

F-01 closure is at `platform/dim-gate/src/domain/engine.ts:159-170` and `:530-540`: relation audits retain exactly two endpoint CI IDs, historical scoped reads require every current endpoint projection to be visible, and missing endpoint metadata fails closed. The regression at `src/domain/m1.test.ts:83-94` verifies Commerce denial and Ops visibility after create/delete.

F-02 closure is at `platform/dim-gate/src/domain/schemas.ts:181-195`, `:210-213`, and `src/demo/seed.ts:13-20`: M1 uses `dim-gate-m1-v1` while the controller's existing stable key and parse-before-write recovery flow preserve incompatible data. The regression at `src/demo/controller.test.ts:118-130` verifies rejection, byte preservation, and explicit 60-CI recovery.

No product, specification, PLAN, task, commit, push, PR, merge, or milestone acceptance state was changed by the reviewer. Only this attempt report and the canonical T-012 report were written in the isolated review worktree.

## Risks and Follow-ups

The earlier browser evidence limitation is closed for this review by independent executable checks of the new Ops onboarding dialog and topology route. Those targeted checks are not yet repository-persisted browser tests, so adding them later would improve automatic regression durability but is not a remaining M1 blocker.

The production JavaScript bundle is 413.17 kB gzip and remains above the future M5 300 kB budget. No performance acceptance is inferred. The new endpoint-ID authorization projection intentionally fails closed for scoped users if an endpoint disappears; Admin's org-wide audit visibility remains consistent with the permission specification.
