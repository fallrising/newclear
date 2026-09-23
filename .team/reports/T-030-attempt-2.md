STATUS: DONE

## Summary

T-030 integration attempt2, run DG-W1-20260923-01. Lead integrated the released worker scope and corrected the strict RD workOwner projection under contractrev3. Domain/API implementation is03a7ee59c63dbe81d026116bac46058431744451 and unchanged in product candidate5cf495f60e22789b482b578b06e0ea64d135b177 and test-only continuation4ab62327b47c5924a22c84e99bab9c79e1dfbb0a. Canonical PR33/branch agent/dim-gate/mainline/w1-workspaces; sole lead owns integration. Worker worktree and original uncommitted handback remain preserved; worker ownership released.

Dashboard adds scoped RD/Ops/Admin discriminated projections, safe canonical references, dataAsOf and strict center-specific query filters. RD all/mine changes Request/Release work only; service visibility remains grant-based. Request approvals keep project/pool intersection; Release/Incident preserve project/stage policy. Domain snapshot/schemaVersion/seedVersion/IDs and business commands remain unchanged. Admin does not gain execution rights.

## Verification

- Fixed5cf495f `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`245/245 in23files — passed
- Fixed5cf495f `pnpm check:contracts`73operations/173schemas; generated OpenAPI matches common schemas/Mock contracts — passed
- Focused domain/HTTP W1 coverage34 tests: scope before counts, foreign empty, missing/stale health, request-vs-release approval scope, mine/all, readonly snapshot invariant, strict unsupported filters — passed
- Fixed5cf495f docs/ci/architecture/demo build and6/6 Firefox/WebKit smoke — passed
- Uninvolved T-032 attempt2/3 confirms F01–03 closed; final domain/source inspection found no blocker/high/medium — passed

## Documentation

Commands and timestamps: `/tmp/dim-gate-w1-evidence/5cf495f-20260923T064215Z/results.json`. Node24.18.0/pnpm11.18.0, lock SHA2560da752e9e75f7b22902ba601583d1979e0a0d63b34275bcc445c4286dec7a32b. Contractrev3 was fixedabd4b6c before corrections; taskrevision3. Earlier PARTIAL checkpoint remains in Git at5cf495f; T-030 attempt1 remains separate, including standalone integration typing limitation. Later Shell/tablet/scope fixes and M4 readiness test repair belong to T-031, not this domain handback.

## Risks and Follow-ups

DONE applies to T-030 domain/API scope only, not W1 product acceptance or PR merge. T-031 must finish full browser/performance/isolation evidence, latest final-head CI and authorized merge. Original03a full E2E failure is preserved in T-031 attempt2 and corrected by4ab test assertions; no failed gate is relabeled. W2–W5 are not implemented. No live adapters or deployment.
