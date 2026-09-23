STATUS: PARTIAL

## Summary

T-031 attempt2, runDG-W1-20260923-01; lead owns all correction paths following T-030 worker release. Original base7a7b41b, previous reviewed7d60786, contract revision3 committedabd4b6c before code. Correction worktree `/home/ckc/test/codex/newclear-dim-gate-w1-rework`, branch `agent/dim-gate/task/t031-workspace-rework`; same PR33 continuation branch `agent/dim-gate/mainline/w1-workspaces` will receive this containing candidate via SSH. NOT_ACCEPTED.

All three independent medium findings are corrected: legal project/environment retained into Admin; strict RD workOwner=all|mine controls actual Request.requesterId / Release.createdBy totals and rows; visible crossCenterRead diagnostic paths preserve source workspace/return for multi-grant users. URL, query keys, OpenAPI and docs updated together without snapshot/schema/seed/ID changes. Added shared-project two-initiator domain/HTTP/browser checks, full real-UI Pipeline→incident→observation→Back/reload, and repeatable nonempty Request→failed job→Admin draft/audit browser regression. All source entities remain canonical.

## Verification

- Isolated correction working diff: pinned component `pnpm install --frozen-lockfile`334 cached; lint/typecheck/demo build — passed
- `pnpm generate:contracts`73operations/173schemas, `pnpm exec vitest run src/domain/w1.test.ts src/demo/w1-handlers.test.ts`34/34 in560ms — passed
- `DIM_GATE_TEST_PORT=4215 pnpm exec playwright test e2e/w1-workspaces.spec.ts`9/9 in1.2m — passed
- After extending the diagnostic journey, focused `--grep 'multi-grant diagnostics'`1/1 in15.1s, all success transitions visible UI — passed
- `pnpm exec playwright test e2e/w1-home-data.spec.ts`1/1 in20.6s; canonical request/job/draft/audit IDs, failure branch and cross-role state, zero page errors — passed
- Original7d60786 native240 tests and6/6 Firefox/WebKit passed; full Chromium still running51/59 at checkpoint, none of that validates correction code — passed
- Full immutable candidate gates, independent T-032 attempt2 and latest-head CI pending — skipped

## Documentation

Revision3 contract and task revisions were fixed before corrections. Attempt1 and original T-032 findings are retained. Local preliminary logs `/tmp/dim-gate-w1-evidence/rework-focused-browser.log`, `rework-diagnostic-browser.log`, `rework-nonempty-browser.log`; prior screenshots in `rework-first-nine`. Node24.18.0/pnpm11.18.0, same lockfile. An initial install invoked via root `pnpm --dir` selected12.5.1 and refused; rerunning from component selected pinned11.18.0 without bypassing version checks.

## Risks and Follow-ups

Candidate not accepted/merged. Source and evidence must be remotely saved; full new candidate native/browser/performance/isolation and independent review are next. Original7d60786 gate checkout stays unchanged until its own runner completes; remote PR branch may advance to correction independently. Then fast-forward lead local branch, verify source equality and GitHub exact head; all gates required before merge. W2–W5 remain unimplemented, no deployment or external effects.

Fixed03a7ee5 completion addendum (2026-09-23): full Chromium finished61 passed/1 failed in22.3m. Aliyun Guide reached successful business assertions but afterEach timed out awaiting response body after immediate reload→goto started the old document session request during navigation. Raw trace and original browser-health failure remain in the rework checkout and `/tmp/dim-gate-w1-evidence/03a7ee5-20260923T062935Z`; this candidate is not accepted.5cf product fixes and4ab6232 narrowly strengthened reload-restoration assertions are separately reviewed/tested; no health check suppression or timeout increase.
