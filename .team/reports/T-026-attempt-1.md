STATUS: PARTIAL

## Summary

T-026 attempt 1 adds scoped M5 reliability and runtime-isolation acceptance evidence. Local tested base is `01ee259e6c1c9791469a0c00ad8979bf0cfe69d1` plus the uncommitted files below; task input cites the earlier `36415c54b4a65726e5a3507231e1c5ee81f9c948`. The new snapshot-serialization regression reproduced a real error-classification defect: the engine serialization size check ran outside its persistence catch and leaked TypeError instead of 507 DEMO_STORAGE_FULL. Lead moved that size check into the existing persistence try/catch in its owned engine.ts and reported 19/19 focused tests passing (6.17 s) plus native typecheck. No worker production controller/browser change was needed. This report does not accept M5 or substitute for lead integration and fixed-commit independent review.

Files:
- `platform/dim-gate/src/demo/controller.test.ts`: real 3 MiB UTF-8 overflow through legitimate domain commands; envelope serialization failure with running work; combined persona/domain 1,000-command budget and replay/reset.
- `platform/dim-gate/e2e/m5-reliability.spec.ts`: visible request creation/approval/provision; exact queued/running reload, quota write failure and retry, no old work after reset, corrupt bytes through memory/reload/cancel/explicit reset, 1,000 genuine visible clock commands plus rejected command 1,001.
- `platform/dim-gate/e2e/m5-isolation.spec.ts`: production deep refresh/MSW scope, actual same-origin sibling document and API, explicit live unavailability without demo fallback.
- `platform/dim-gate/scripts/isolation-server.mjs`: localhost static production acceptance fixture with real sibling document/API responses and history fallback only within the app.
- `platform/dim-gate/scripts/isolation.mjs`: fresh separate production demo/live builds and dedicated browser run.
- `platform/dim-gate/playwright.isolation.config.ts`: ports 4176/4177 and isolated reports.

All successful browser business setup uses visible UI. Only storage-write failure and malformed saved bytes are injected; persisted snapshots are otherwise read-only observations. No dependencies/lockfile, PLAN, other worktrees, commits, pushes, merges, deploys or real cloud operations changed. Source-only worker skill read from the assigned pinned kernel checkout; no skill/plugin installation.

## Verification

Runtime: Node 24.18.0, pnpm 11.18.0; Playwright 1.63.0 / Chromium 153.0.8010.12, cached build 1243. Local browser environment:
`PATH=/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin`,
`LD_LIBRARY_PATH=/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu`,
`FONTCONFIG_FILE=/tmp/dim-gate-m3-fonts-kaBaS8/fonts.conf`.
Normal sandbox execution failed with bwrap loopback `Failed RTM_NEWADDR: Operation not permitted`; subsequent scoped reads/writes/tests used separately approved narrow escalation. No rejected escalation was bypassed.

- Component `pnpm install --frozen-lockfile`, warm cache, unchanged manifest/lockfile — passed
- Initial `pnpm exec vitest run src/demo/controller.test.ts`: 18/18, 5.01 s — passed
- Added snapshot-boundary regression, `pnpm exec vitest run src/demo/controller.test.ts -t 'serialization failure'`: worker base returns TypeError instead of the required 507; 1 failed, 1 passed, 17 filtered out — failed
- Lead-reported corrected engine run of all 19 controller tests: 19/19, 6.17 s; native typecheck also passed. This is attributed lead evidence, not a locally repeated patched-engine run — passed
- `pnpm typecheck` after final browser setup correction — passed
- `pnpm exec eslint src/demo/controller.test.ts e2e/m5-reliability.spec.ts e2e/m5-isolation.spec.ts scripts/isolation.mjs scripts/isolation-server.mjs playwright.isolation.config.ts` — passed
- `git diff --check` — passed
- Pinned `teamctl.py validate-report .team/reports/T-026-attempt-1.md` — passed
- `node scripts/isolation.mjs`: fresh demo/live production builds; both AC-29 Chromium tests, 2/2, 3.3 s — passed
- `pnpm exec playwright test --config /tmp/dim-gate-m5-reliability-recheck.config.ts --grep-invert '1000 actual'`: exact-step reload/quota, running reset/no revival, corrupt recovery; 3/3, 26.8 s — passed
- `pnpm exec playwright test --config /tmp/dim-gate-m5-reliability-limit.config.ts --grep '1000 actual'`: 1/1, 6.9 minutes; all 1,000 visible UI commands, rejected command 1,001 preserving full bytes/audit/events/receipts, reload and reset/resume — passed

Authoring corrections: first unit size scenario incorrectly switched to Ops before RD-only pipeline creation; corrected setup order and all 18 unit tests then passed. First short browser setup navigated immediately after selecting Ops and interrupted the 150 ms persona save; corrected to wait for visible Ops navigation, then all 3 short cases passed. Initial failed artifacts remain preserved rather than counted as acceptance evidence. The original long browser attempt reached 885 persisted commands but hit the 12-minute test deadline while awaiting command 886. Assertion polling changed from Playwright default backoff to 25 ms and the test budget to 15 minutes; business actions and HTTP delay were not accelerated.

## Documentation

Artifacts:
- `/tmp/dim-gate-m5-evidence/reliability/isolation-report/`: AC-29 HTML report, browser health, DOM and screenshots.
- `/tmp/dim-gate-m5-evidence/reliability/recheck-report/` and `recheck-browser/`: corrected short AC-28 suite, browser health, screenshots (including quota error), DOM and state evidence.
- `/tmp/dim-gate-m5-evidence/reliability/report/` and `browser/`: original failed browser authoring run, including the 12-minute timeout after 885 successful commands.
- `/tmp/dim-gate-m5-evidence/reliability/limit-report/` and `limit-browser/`: final optimized assertion-polling run; all 1,000 real UI clicks and normal HTTP delay remain unchanged.
- `/tmp/dim-gate-m5-evidence/reliability/source-sha256.json`: exact final scoped source hashes.

No API, domain contract or user behavior changed. This task report records verification and integration requirements; lead owns delivery documentation, shared configuration and PLAN.

Lead integration, preserving this worker worktree:
1. Copy the six scoped source/test/config files above to the lead integration worktree and retain the lead-owned engine serialization catch correction. The new 19th controller regression deliberately remains red on the unchanged worker engine.
2. Add package script `"test:isolation": "node scripts/isolation.mjs"`.
3. Exclude `**/m5-isolation.spec.ts` from normal `playwright.config.ts` test discovery; dedicated isolation config owns its two local hosts.
4. Include `playwright.isolation.config.ts` in the lead-owned tsconfig include if config typechecking is desired.
5. Run `pnpm build --mode demo`, `pnpm exec playwright test e2e/m5-reliability.spec.ts`, `pnpm test:isolation`, and full lead gates at the integrated fixed commit. Do not run a build that clears `dist/` concurrently with the isolation browser host.
6. Retain HTML report directories as CI artifacts. The 1,000-command UI test has a 15-minute individual timeout; CI job timeout must accommodate it.

## Risks and Follow-ups

All six assigned browser cases have now passed: three short AC-28 cases, the genuine 1,000-command AC-28 case, and two AC-29 isolation cases. Worker report remains PARTIAL because the new regression fails against its intentionally unchanged engine; the correction and its passing 19-test verification are lead-owned. Final lead integration, full regressions, fixed-commit independent review and CI artifacts remain lead-owned. Scoped evidence does not establish Firefox/WebKit or the AC-26/27/30 milestones.


Automatic approval review rejected the requested byte-for-byte engine.ts synchronization into this worker because it would overwrite an out-of-scope shared source file from another worktree. The copy was not retried or bypassed; git diff confirmed engine.ts remains untouched. The safe alternative is the lead-owned correction and its separately attributed validation, followed by integrated fixed-commit checks.
