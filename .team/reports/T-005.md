STATUS: DONE

## Summary

T-005 revision 2 / attempt 2, run DG-M0-20260920-01. Orchestrator accepts M0 AC-01–03 only (decision DG-D008). Implementation and local tested commit `63e8136bc70e42190b5bbd212a487886a5b862a6` has durable equivalent `a608a94efc601c9affce554ca64bd4d733ee6839`, identical full tree `5752b65fd9fe759a788d2af3780510f12e88c3da`. Initial source/spec `1117d297aa3efef9472d847c9dfa5714eb6c4460`, branch ADR-012–014 and M0-CONTRACT rev2; kernel `7cddad13f965d579b218579609c7f64e1ecf35b2`. Built-in collaboration agents were used; exact inherited model IDs unavailable, no Claude or verified multi-model claim. Private skills were read, not installed or copied.

AC-01: working three-center authorized foundation, subpath isolation, production build and CI. AC-02: four personas, persistent demo banner, clock/reload/reset/recovery and isolation, including obsolete lost-response protection. AC-03: shared typed domain/API/mock contracts, atomic guarded/idempotent mutations, explicit failed-write invariants and generated OpenAPI. Minimal seed has one CI per source; future business workflows remain unavailable.

## Verification

Node24.18.0 / pnpm11.18.0. All following native commands exited 0 on the fixed local correction. Frozen install reported Already up to date; the initial fresh-worktree installation is documented in [attempt 1](T-005-attempt-1.md), and remote CI performs its own clean installation.

| Command | Result | Process seconds |
| --- | --- | --- |
| pnpm install --frozen-lockfile | passed | 1.26 |
| pnpm lint | passed | 4.93 |
| pnpm typecheck | passed | 8.59 |
| pnpm test | 6 files / 82 tests passed | 6.51 |
| pnpm check:docs | passed | 1.44 |
| pnpm check:contracts | passed | 1.97 |
| pnpm check:ci | passed | 1.39 |
| pnpm build --mode demo | passed | 10.50 |
| pnpm test:e2e | 7 passed | 47.42 |

- Independent [T-004 attempt 2](T-004-attempt-2.md): 82 tests plus three separate HTTP diagnostics; F-01 obsolete reset/persona replay, F-02 default-sort mismatch and full-PR whitespace finding all closed — passed
- Full source-to-correction `git diff --check`; actionlint1.7.12 on scoped workflow — passed
- Production browser checks: center/persona guards and banner; clock/reload/reset; 1440/768/390 layout and light/dark axe serious/critical; dialog focus/Escape/return; copied-tab independence including reset; deep-refresh/subpath isolation; explicit corrupt-storage recovery — passed
- Lead and independent reviewer inspected actual guide and center screenshots; CJK text readable, no blocking clipping — passed
- [Remote CI run35513061081](https://github.com/fallrising/newclear/actions/runs/35513061081), [job106084265604](https://github.com/fallrising/newclear/actions/runs/35513061081/job/106084265604): clean install, native gates, 82 tests and 7 standard Playwright Chromium E2E — passed
- Remote branch a608a94 and existing [PR #7](https://github.com/fallrising/newclear/pull/7) verified; no merge/deployment — passed

CI artifact `dim-gate-m0-5f68e0c4941aa4edc0f74015b485f7eecc56df87`, ID10606068767, 1172396 bytes, SHA256 `2e2bc9c7bdab822d1a4c0fc7b8b2aadca767b761b5a233bfecc4ca74c5acd934`, expires2026-10-20. Contains browser results/screenshots. Local logs were inspected in `evidence-correction/results.json` and its nine command logs; durable equivalent evidence is the linked CI log/artifact. Local browser used isolated Chromium153.0.8010.0 and Noto CJK with normal web security because CDN download failed; exact environment provenance remains in attempt1. CI used standard Playwright Chromium.

### Target reconciliation and evidence validity

During this run main advanced to `a330237860b3002d68fec3f853a6d1deb44a8e9a`. CI tested synthetic merge `5f68e0c4941aa4edc0f74015b485f7eecc56df87`, parents newer main and a608a94; its whole tree `206e7918790b19dc67b1d64d4b70ef8ebf24033f` differs from the implementation tree. Full scoped diff for `platform/dim-gate`, `.team`, and `.github/workflows/dim-gate-ci.yml` exited 0. No ancestor AGENTS/override was added. Intervening changes concern other components, root index/migration and CI documentation.

The updated root README and complete `docs/specs/monorepo-ci.md` were read at a330237; CI spec blob `30138e166afddff232e771ea7a7567fe016b7cec` broadens component coverage without changing dim-gate's required paths/permissions/pins/toolchain/timeouts/concurrency. Existing workflow remains compliant. No product/spec gate was silently invalidated. Metadata-only final report/PLAN/STATUS changes preserve the accepted product/config/lock/workflow tree; final checkpoint CI is discoverable from the PR head.

## Documentation

[PLAN](../PLAN.md) records ACCEPTED separately from OPEN integration, releases the run owner and preserves the continuation branch. [STATUS](../../platform/dim-gate/docs/STATUS.md) summarizes scope and next milestone. Tasks T-004/T-005 revision2 and canonical reports are reconciled; all attempt1 failures remain visible. [Commit map](dim-gate-commit-map.md) preserves exact-tree API transport provenance. Final metadata commit identifies itself through Git history; no self-referential commit SHA is fabricated.

Recovery exercises: the fresh-context T-004 reviewer recovered the existing run/task/branch from repository files and continued the assigned review, rather than creating duplicate M0 work. Lead continuation reconciled the same run/tasks/PR7 and active owner before writes. Initial green 79-test/7-E2E evidence was rejected after independent findings; changed code was committed and revalidated with 82 tests, new diagnostics and new remote CI. This demonstrates fresh-session review handoff and duplicate-start reconciliation, not an unperformed full orchestrator takeover.

## Risks and Follow-ups

No unresolved M0 blocker. M1–M5, full 60-CI seed, completed business flows, real cloud/authentication and Firefox/WebKit are not accepted. Initial JS gzip325.13 decimal kB (~317.5KiB) exceeds the future M5 300KiB budget; LCP/5000-CI/p95 remain unmeasured. Closed mobile persona selector truncates long labels; full options and accessible names remain available. Artifact retention is 30 days; preserve/export evidence before expiry if longer audit retention is needed.

Next action: review PR7 without auto-merging. Next orchestrator must fetch current main and PR head, reconcile integration, reuse accepted M0 evidence where unchanged, then select M1 AC-04–08,20. Do not restart M0, overwrite another owner or duplicate PR7.
