STATUS: BLOCKED

## Summary

Independent attempt 1 reviewed immutable M1 product commit `9b656f276ef9f5dd3b18f8ca698bea6496751839` from source main `50294b687d06f08e94290f6f327187e8f69248bc`, with evidence checkpoint `aaab04958df923a9b92ddd71fb209c1bf735e67a`. The reviewer did not implement or integrate the candidate; the runtime exposes the built-in collaboration reviewer role but not an exact model ID, so no model ID is guessed.

The candidate's ordinary gates pass, but the review is BLOCKED by two independently reproduced high-severity findings: deleted cross-scope relation audit events are disclosed to RD Commerce, and persisted M0 sessions are silently accepted as M1 despite containing only the M0 three-CI/two-application seed. These violate AC-20 non-disclosure and the M1 60-CI/reload contract respectively. Remote CI success cannot accept cases that its suite does not exercise.

## Verification

- Commit/tree inspection confirmed product `9b656f276ef9f5dd3b18f8ca698bea6496751839`, checkpoint `aaab04958df923a9b92ddd71fb209c1bf735e67a`, and the complete `50294b6..9b656f2` diff — passed
- Mandatory T-012 sources, applicable `AGENTS.md`, M1 contract, SDD chapters, PLAN, and canonical T-007 through T-011 reports were read in full — passed
- `pnpm install --frozen-lockfile` with Node 24.18.0 and pnpm 11.18.0 — passed
- `pnpm lint` and `pnpm typecheck` — passed
- `pnpm test` completed 120 of 120 tests in 14 files — passed
- `pnpm check:contracts` reported 72 operations and 166 schemas, and `pnpm check:architecture` passed feature boundaries — passed
- `VITE_DATA_MODE=demo pnpm build --mode demo` completed; bundle was 413.08 kB gzip — passed
- `LD_LIBRARY_PATH=/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu pnpm test:e2e` completed 11 of 11 Chromium tests, including seven M0 regressions — passed
- In-memory Vite SSR reproduction of deleted cross-scope relation audit visibility returned two audit events to RD Commerce — failed
- In-memory controller reproduction loaded an M0-shaped `dim-gate-v1` snapshot and returned three CIs and two applications without incompatibility recovery — failed
- `git diff --check 50294b687d06f08e94290f6f327187e8f69248bc..9b656f276ef9f5dd3b18f8ca698bea6496751839` — passed
- New target main `a5982bf4547bba85429fec50494751562b5fe7c6` differs from the reviewed source only in `gateways/pokercase/src/proxy.rs`, so it is disjoint from dim-gate findings — passed

## Documentation

The review used M1 integration contract revision 1 at `9ea032f66daabf68350482bfedac81f63e5221ec`, particularly the shared scope rule that list/detail/search/topology/capacity/audit reuse the same visibility predicates and the persistence rule that incompatible schema/seed data must require explicit recovery. Zod/OpenAPI remain the wire source of truth. No product, specification, PLAN, task, commit, push, PR, merge, or acceptance state was changed.

### F-01 — HIGH / BLOCKING — deleted relation audit leaks cross-scope activity

Expected: AC-20, INV-06, `04-permissions-admin.md` section 2, and the M1 contract require RD Commerce to receive empty audit results for Data-only entities and require audit to use the same visibility predicate as the underlying entity. A relation is readable only when both endpoints are visible.

Actual: create as `user-ops` a `depends_on` relation from shared Commerce/Data CI `ci-idc-redis-01` to Data-only `ci-aliyun-worker-01`, then delete it. Reading `/audit` as `user-rd-commerce` returns both `relation.create` and `relation.delete`, including the relation ID, actor, correlation IDs, reason, and a scope snapshot naming `project-data` and `pool-aliyun-sg`; reproduced total is `2`, not `0`.

Cause: `platform/dim-gate/src/domain/engine.ts:159` correctly requires both live endpoints while the relation exists, but the deleted-relation fallback at line 161 authorizes on any project or pool intersection. Audit scopes are the union of changed endpoint scopes at lines 524–531, so the shared endpoint makes both events visible after deletion.

Required closure: preserve enough endpoint visibility information for historical relation audits and require both endpoints to be readable, or produce an equivalently non-disclosing historical projection. Add a regression that creates and deletes a shared-to-Data-only relation and asserts Commerce audit is empty while authorized Ops can read it.

### F-02 — HIGH / BLOCKING — M0 persistence bypasses the M1 baseline seed

Expected: AC-04 requires exactly 60 baseline CIs (20 per provider), SDD INV-08 requires deterministic reset/reload behavior, and frontend architecture section 4 requires incompatible schema/seed versions to show explicit reset recovery instead of silently running stale data.

Actual: both M0 and M1 declare `schemaVersion: 1` and `seedVersion: "dim-gate-v1"`. An M0-shaped persisted record is accepted by M1's `savedSchema`; the independent controller reproduction reported `acceptedSeedVersion=dim-gate-v1`, `ciCount=3`, and `applicationCount=2` under the original session ID. Consequently an existing accepted M0 browser tab can reload the M1 build without ever receiving the required 60-CI/six-application seed.

Cause: the M1 seed still emits version 1/v1 at `platform/dim-gate/src/demo/seed.ts:19`; `snapshotSchema` accepts the same literals at `src/domain/schemas.ts:181-195`; and the controller accepts any structurally valid record at `src/demo/controller.ts:98-112`. Existing tests start fresh or test corrupt data, not an actual M0-to-M1 upgrade.

Required closure: bump the seed compatibility identifier (and related guide/schema typing) or implement a deliberate migration that yields the exact M1 invariants. Add controller/browser regression evidence that an M0 saved snapshot enters explicit recovery/reset or becomes a valid 60-CI M1 snapshot without silent data loss.

## Risks and Follow-ups

The M1 responsive/theme axe test at `e2e/m1-cmdb.spec.ts:132-147` exercises only `/rd/apps`; topology/table keyboard behavior has component coverage and Radix supplies dialog focus mechanics, but new Ops pages and dialogs do not have equivalent per-route browser axe/focus assertions. This is retained as an evidence limitation for the correction run, not a third independently demonstrated product defect.

The 413.08 kB gzip bundle exceeds the future M5 300 kB budget and remains a known non-M1 limitation. Review attempt 2 must use a new immutable correction commit, rerun focused F-01/F-02 regressions plus affected full gates, and must not treat the already-green remote CI run as closure of either finding.
