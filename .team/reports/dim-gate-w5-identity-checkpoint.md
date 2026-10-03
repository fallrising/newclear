STATUS: PARTIAL

## Summary

Run `DG-W5-20260923-01` implements the first W5 identity slice in product commit `ace27ff833de58541236b44b9b410cf58f7a8f17` on draft [PR61](https://github.com/fallrising/newclear/pull/61). v5 snapshots add User/Team `source: seed | demo`; strict v1–v4 migration validates the original snapshot before adding source metadata in one atomic storage write. Admin can list/detail/create/update Demo Users and Teams through typed API and `/admin/users`. Creation gives no role grant or Demo persona; the domain actor allowlist also blocks direct engine authentication using a new User ID. Current Admin authorization, version, reason, idempotency, audit/event and `policyVersion` remain enforced. The existing `/admin/access` and PATCH user behavior are compatible.

## Verification on product commit

- Native Vitest 409/409 in 40 files; focused W5 domain, actual HTTP and v4 migration tests include team-without-grant, no-login, replay, self-disable, stale version, invalid references, strict corrupt/identity collision and quota-byte preservation.
- `pnpm lint`, `pnpm typecheck`, `pnpm check:docs` (216 Markdown/486 links), `pnpm check:contracts` (168 operations/324 schemas), `pnpm check:ci`, `pnpm check:architecture`, demo build and `git diff --check` passed.
- Focused production-build Chromium W5 identity journey 1/1 passed: create/read back, refresh, no persona, edit, unauthorized RD deep link, light/dark at 1440/768/390 with axe serious/critical and document overflow checks.
- Unchanged benchmark 3/3 passed after supplying the existing local browser library/font environment. First attempt failed before any browser launch because `LD_LIBRARY_PATH` omitted `libasound.so.2`; no source change was made between attempts. Initial JS stayed under the test's 307200-byte limit, and LCP/query/HTTP p95 checks passed. The successful result is local to this partial product commit; full W5 final fixed-commit gates remain required.

## Open W5 work

T045 domain and T046 API/migration are PARTIAL: feature registry/cohort, registered PlatformRoute and recipient-specific notification models, commands, integrity, API and strict v5 defaults remain. T047 UI/browser is PARTIAL: identity page is present; Admin feature/route/notification and RD/Ops subscription/attempt flows remain. T048 full integration gates and uninvolved T049 fixed-commit review have not begun. The draft PR remains open; there is no W5 acceptance, merge or deployment. Continue from the fixed W5 contract, preserve W4 histories and keep the unchanged performance budget.
