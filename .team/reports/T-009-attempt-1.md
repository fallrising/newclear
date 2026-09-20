STATUS: DONE

# T-009 attempt 1 — Ops CMDB slice

## Summary

Implemented the bounded Ops CMDB slice on dispatch HEAD `73771958d93d405a877886a4805d667a67b67d8c` (accepted product dependency `888d81203d01aab8781c42ac47138e053bf2c487`). The work remains uncommitted for orchestrator review and integration.

- Added schema-validated CI list/detail/create/patch methods to the CMDB feature client with canonical query serialization.
- Added a scoped CI inventory page with 60-total and 20-per-provider summaries, provider/freshness/health/search filters, pagination, deep links, and explicit loading/error/empty states.
- Added manual compute onboarding for AWS, Aliyun, and on-prem with provider-specific attributes, real POST state changes, committed-only invalidation, actionable field-level 422 feedback, and canonical-identity 409 feedback.
- Added CI detail and expected-version metadata editing. The edit surface exposes only name/tags, displays the locked identity tuple, preserves the draft on failure, and provides an explicit refetch action on 409.
- Distinguished fresh/stale/unknown observation state, health unknown, successful empty results, and numeric zero in both list and detail projections.
- Added typed-client and component tests covering the three baseline provider counts, provider-specific fields, create count changes, duplicate/validation errors, identity preservation, stale versions, filters, zero/unknown/stale rendering, and mutation dialogs.

## Changed files

- `platform/dim-gate/src/api/clients/cmdb.ts`
- `platform/dim-gate/src/api/clients/cmdb.test.ts`
- `platform/dim-gate/src/features/cmdb/ci/CiDetailPage.tsx`
- `platform/dim-gate/src/features/cmdb/ci/CiMetadataDialog.tsx`
- `platform/dim-gate/src/features/cmdb/ci/CiOnboardingDialog.tsx`
- `platform/dim-gate/src/features/cmdb/ci/CmdbListPage.tsx`
- `platform/dim-gate/src/features/cmdb/ci/CmdbPages.test.tsx`
- `platform/dim-gate/src/features/cmdb/ci/ci-view.ts`
- `platform/dim-gate/src/features/cmdb/ci/index.ts`
- `platform/dim-gate/src/features/cmdb/ci/query-invalidation.ts`
- `.team/reports/T-009-attempt-1.md`

## Verification

- `pnpm exec vitest run src/api/clients/cmdb.test.ts src/features/cmdb/ci/CmdbPages.test.tsx` (2 files, 7 tests) — passed
- `pnpm lint` — passed
- `pnpm typecheck` — passed
- `pnpm test` (9 files, 103 tests) — passed
- `pnpm check:architecture` (feature import boundaries) — passed
- `git diff --check` — passed

## Documentation

This attempt report records the exact dispatch/base, paths, commands, outcomes, and integration needs. No product contract or central status/PLAN file was modified.

## Risks and Follow-ups

- The orchestrator must add `./ci` exports to the central `src/features/cmdb/index.ts`, register `/ops/cmdb` and `/ops/cmdb/:ciId`, and supply global styles; these paths were intentionally outside T-009.
- Onboarding options map to the fixed M1 demo seed IDs because no M1 reference-data endpoint for accounts/locations/pools is implemented. The form still permits editing those identity fields so server-side 422 compatibility errors remain visible and actionable.
- Cross-slice invalidation predicates follow the fixed identity-prefix position and M1 families; the orchestrator should verify them after all slices and global search are composed.
- Exact inherited model ID was not exposed to this worker and is therefore not guessed.
