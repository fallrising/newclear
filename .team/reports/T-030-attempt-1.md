STATUS: PARTIAL

## Summary

T-030 attempt 1 delivers the bounded W1 dashboard domain/API implementation for run DG-W1-20260923-01. Worker branch `agent/dim-gate/task/t030-workspace-domain`, worktree `/home/ckc/test/codex/newclear-dim-gate-w1-domain`, fixed base `02a8b9ac055a9696f381156079dea347d6f83a12` plus the eight uncommitted scoped source files hashed below. This report is worker evidence, not task or W1 acceptance. Lead owns integration, fixed-commit verification, independent review and delivery.

The existing GET `/dashboard` now returns its original counters/pendingItems/dataAsOf plus required authorized scope options/filters and a role-discriminated workspace. RD projects actual environment health/readiness, requests and release history. Ops projects incidents, failed jobs/releases, actionable requests/releases, physical pool capacity and CI staleness. Admin projects actual catalog drafts, safe integration status and access audit references. Sections carry exact filtered totals and at most 20 deterministic items; routes use canonical IDs and registered pages. The existing typed client accepts optional filters using URLSearchParams. No new operation, dependency, persisted field, snapshot/schema/seed version, ID or business command is introduced.

Contract clarification from the lead before handoff: revision 2 preserves legacy action-specific scope. Request approvals require Ops project/stage plus pool and non-self scope; release approval and incident work require Ops project/stage (release also non-self). Provider/pool filters still intersect related visible resources. The first local selector applied pool placement to all Ops work; this was corrected before handoff and covered by a new positive project-only Ops regression. Worker did not edit the lead-owned contract/task documents.

Owned files changed: `src/domain/schemas.ts`, `src/domain/engine.ts`, new `src/domain/workspace-home.ts`, new `src/domain/w1.test.ts`, `src/api/contracts/core-session.ts`, `src/api/clients/cmdb.ts`, generated `docs/openapi.json`, new `src/demo/w1-handlers.test.ts`. No UI, router, seed, policy, controller, manifest, lockfile, CI, PLAN or sibling component edits; no commit, push or delegation.

## Verification

Runtime: Node 24.18.0 and component-pinned pnpm 11.18.0, with `PATH=/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin:$PATH` for every pnpm command. Commands ran from `platform/dim-gate` unless stated otherwise.

- `pnpm install --frozen-lockfile`, 334 cached packages, 710 ms; manifest/lockfile unchanged. — passed
- Initial `pnpm test -- src/domain/w1.test.ts`, 234 tests / 22 files, 6.21 s. This pnpm/Vitest invocation actually discovers the full suite despite the trailing paths. — passed
- Initial `pnpm exec vitest run src/domain/w1.test.ts src/demo/w1-handlers.test.ts`, focused 28 tests / 2 files, 533 ms. — passed
- After the lead's action-specific scope clarification, the same focused command, 29 tests / 2 files, 558 ms. — passed
- Final prescribed `pnpm test -- src/domain/w1.test.ts src/demo/w1-handlers.test.ts`, full 240 tests / 23 files, 6.69 s. Previous pre-clarification full run also passed 239 tests / 23 files, 7.31 s. — passed
- `pnpm lint` after final source/test changes. — passed
- `pnpm generate:contracts`; 73 operations / 173 schemas, all local references resolved. — passed
- `pnpm check:contracts` against generated final wire schemas; 73 operations / 173 schemas. The subsequent clarification changed selector logic and tests only. — passed
- `pnpm typecheck` solely at existing lead-owned `src/app/App.test.tsx:34`, whose DashboardView fixture lacks the new required scope/workspace properties. No worker source/test TypeScript errors were reported. This same isolated error reproduced after the completed HTTP tests. Lead has separately updated that fixture and must run integrated typecheck; worker did not edit or copy the out-of-scope UI file. — failed
- `git diff --check` before report; repeated at handoff. — passed
- Pinned `/tmp/dim-gate-w1-evidence/teamctl.py validate-report .team/reports/T-030-attempt-1.md` after report formatting correction — passed
- First two pinned report validations: evidence entries had explanatory text after the status marker; report-only formatting corrected — failed

Regression coverage includes foreign/mismatched project/environment/provider/pool empty data and counts; strict unknown/duplicate/invalid/unsupported filters; authorized dependent options; project/stage and pool permission distinctions; non-self approvals; real draft/submission/approval/failure/release/incident projections; latest healthy/unknown/stale observations; canonical safe routes; physical capacity counted once; pool-only Ops consumer isolation; actual Admin drafts/access and safe integration data; exact totals/20-item bounds; typed full-filter HTTP transport/query keys; held successful old-identity response rejection; multi-grant and zero-grant cases created through existing Admin commands; unchanged old snapshot bytes and reload of running jobs/audit/receipts.

Sandbox note: apply_patch could not launch its filesystem helper because bwrap loopback setup failed with `Failed RTM_NEWADDR: Operation not permitted`. No edit occurred through that failed call. Narrow escalated shell reads/writes/tests then succeeded through the available approval route; no approval rejection was bypassed.

## Documentation

Exact tested source SHA-256 hashes relative to `platform/dim-gate`:

- `src/domain/schemas.ts`: `1784ace5eca8e84d639f56e2608152b984541fcebbee9ff25c047c47961ece06`
- `src/domain/engine.ts`: `cb76549a64ddffea97438772bea8bc3877bdd17afa56ea978b36d77eb2639440`
- `src/domain/workspace-home.ts`: `1da195df1ccd93e8c766e1004b8225daa20783e149c5da40472149d816443505`
- `src/domain/w1.test.ts`: `b24dc3171fda84bcfb9b613ded61989f9b676fa04efcd0f8d205f3931731e32f`
- `src/api/contracts/core-session.ts`: `09b6ffa9fb6e70b81aa83495f5703d1b3f5ffd4b165d05433e6c233344254a2e`
- `src/api/clients/cmdb.ts`: `17a89106d7bc949def9c4ad0afec79e0eb37b87e5848937015c5c54b3afdcf21`
- `docs/openapi.json`: `1890e70b5981715c4881878e9c65b849a867d4d5bd2577aa686732d2ed14a8b5`
- `src/demo/w1-handlers.test.ts`: `c14273522380cf9b9139f63ed44577f0fbfefe1438015800d2e54839f25f4766`

Lead can copy the eight scoped files and this report into its integration worktree. The worker report remains PARTIAL because the standalone worktree's full typecheck depends on the lead-owned App test fixture; implementation and the final 240-test suite are delivered for lead integration. No fixed product commit, browser evidence, performance budget result, CI or milestone acceptance is claimed here.

## Risks and Follow-ups

- Lead must rerun full integrated gates, including typecheck after its App fixture/UI changes, browser/axe/responsive/deep-link/old-response coverage and initial JS budget. This worker made no build or browser acceptance claim.
- RD latest observation older than 5 minutes is stale; CI/integration observation older than 24 hours is stale. Missing health samples remain unknown; stale never becomes healthy. Integration rows omit endpoint payloads, field mappings and raw test summary; access rows omit reasons/diffs.
- Legacy access audit scopeSnapshot captures actor scope rather than changed target scope. Filtered Admin access rows are attributed only through surviving canonical target assignments (including stage); revoked/unattributable historical rows remain in unfiltered recent access history. This avoids pretending broad actor scope identifies the changed project. No historical audit payload was rewritten.
- Pool/catalog/integration/audit rows use registered list pages with canonical selection query IDs. Lead owns honoring/highlighting those selections in existing pages and has reported implementing that UI support.
- Existing response epoch guards, action checks and business state transitions remain authoritative. Worker does not accept its own work or release shared-file ownership until this final report and handoff are returned.
