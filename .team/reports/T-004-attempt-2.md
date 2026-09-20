STATUS: DONE

## Summary

T-004, attempt 2, revision 2: bounded independent follow-up of the three recorded M0 findings. Both product findings and the committed-diff whitespace failure are closed at the immutable correction below. No new blocking finding was found in this correction. This is a completed scoped review, not an orchestrator acceptance or milestone/merge decision.

- Reviewed/tested local commit: `63e8136bc70e42190b5bbd212a487886a5b862a6`.
- Durable equivalent: `a608a94efc601c9affce554ca64bd4d733ee6839`; independently resolved and compared locally, with no full-tree difference.
- Identical complete tree: `5752b65fd9fe759a788d2af3780510f12e88c3da`.
- Correction diff base: `e7d74275b1bbf157ab8d1888e3d482e95fb647b2`, equivalent to initial reviewed local `56ca8d0b1f1445f1473ccf3725ec53e0b4a9d45a`.
- Product specification remains source `1117d297aa3efef9472d847c9dfa5714eb6c4460` plus M0-CONTRACT revision 2 and ADR-012–014; private kernel instruction revision remains `7cddad13f965d579b218579609c7f64e1ecf35b2`.
- Worktree `/workspace/scratch/ac0bbec7578c/t-004-review` is detached at the exact local correction. Task revision 2 and the new attempt-report path were explicitly authorized by the lead's bounded follow-up dispatch; the task-file revision is to be reconciled in the final metadata checkpoint.
- Same independent built-in collaboration reviewer, inherited model ID not exposed. No implementation edits, commits, pushes, delegation, acceptance decision, or private-source copy.

[Attempt 1](T-004-attempt-1.md) preserves the full initial source/spec review, original failing reproductions, visual assessment and recovery probe. Its SHA-256 remains `04ba949bf30a0bb1061a8509a0f1ff3a56d76059a286876d452067afd254a9fd`.

## Verification

Runtime remains Node 24.18.0 / pnpm 11.18.0. Reviewer commands run in `platform/dim-gate` with `PATH=/workspace/scratch/ac0bbec7578c/toolchain/node_modules/.bin:$PATH`, except Git/report commands from the root.

- Confirmed `git rev-parse HEAD HEAD^{tree}` against the assigned correction and read the relevant complete delta, T-002 attempt-2 report and correction metadata — passed
- Independent `pnpm test`: 6 files, 82 tests, exit 0 at 2026-09-20 16:18:14 UTC; includes valid immediate lost-response replay, subsequent work, both new obsolete-replay regressions, and existing domain/HTTP/UI checks — passed
- Independent `pnpm exec vitest run --config /workspace/scratch/ac0bbec7578c/reviewer-diagnostics/followup.vitest.config.mjs`: 3 targeted diagnostics, exit 0; both identity cases use the real shared HTTP handlers; sorting checks both implemented lists over HTTP against the generated OpenAPI default — passed
- Root `git diff --check 1117d297aa3efef9472d847c9dfa5714eb6c4460..HEAD`: exit 0, including the formerly failing committed preflight report — passed
- `git diff --exit-code 63e8136bc70e42190b5bbd212a487886a5b862a6 a608a94efc601c9affce554ca64bd4d733ee6839 --`: exit 0; both commits resolve to tree `5752b65fd9fe759a788d2af3780510f12e88c3da` — passed
- Inspected lead's `evidence-correction/results.json` and all nine corresponding logs: frozen install, lint, typecheck, test, docs, contracts, CI policy, production demo build and E2E all exit 0 at local `63e8136`; 82 tests and 7 production Chromium E2E checks — passed
- Confirmed app/components, controller/handlers/domain/seed, package/lockfile and workflow are unchanged by the correction; prior full scope and visual review remains applicable — passed
- Original diagnostic source and failure log retained unchanged; new diagnostic source/output are separate `reviewer-diagnostics/followup.test.ts` and `attempt-2-probe.log` — passed

The correction frozen-install log says “Already up to date”; it is an inspected successful frozen install, not a second claimed fresh dependency installation. Initial fresh-install provenance is recorded in attempt 1 and the lead integration evidence.

### Finding closure

| Finding | Correction and independent result |
| --- | --- |
| F-01, high, AC-02 / INV-08 | `src/api/client.ts:106` checks the retained original `requestIdentity`, current identity and returned identity. Both lost-reset and lost-persona interleavings now reject with non-retryable `STALE_RESPONSE` before replacing session state. Fresh probes confirm Admin identity/epoch remain current, no identity notification or domain change occurs, and subsequent `getSession()` succeeds as Admin. Existing immediate replay and preserved-later-work cases still pass. Closed. |
| F-02, medium, M0 DTO/OpenAPI alignment | `src/api/contracts.ts:22` now defaults name-sortable lists to `name`; generated query parameters/schemas match. Independent HTTP requests for `/api/v1/cis` and `/api/v1/applications`, as Ops, produce equal data for omitted `sort` and explicit `sort=name` taken from OpenAPI. Runtime behavior and declared defaults now agree. Closed. |
| Committed EOF whitespace failure | Removed only the extra blank line in the preflight report. Full source-to-correction diff check exits 0. Closed. |

The three diagnostic checks supplement the committed tests: the F-02 follow-up traverses the actual shared HTTP handlers and reads the default from OpenAPI, rather than comparing only controller projections. No product/test/config source was altered by the reviewer.

## Documentation

Reviewed the 13-file correction inventory and implementation/generated-contract delta. The two code corrections remain within the recorded findings; additional changes are regressions, generated defaults and existing task/report/progress metadata. No M1–M5 business flow was introduced or silently accepted.

The full initial seven-image visual verdict is preserved in attempt 1. No UI or CSS changed. Fresh correction E2E logs again pass the three-width/dark guide axe checks, focus/Escape/return, persona navigation, reset/reload, copied tabs, subpath isolation and corrupt-storage recovery. There is no basis for claiming a wider M5 accessibility or performance audit.

Only this new report and the canonical T-004 report were written during the follow-up. Attempt 1, its original temporary probe and its failure log remain intact. The task revision/update and canonical acceptance metadata remain lead-owned.

## Risks and Follow-ups

No unresolved blocking finding remains within this bounded correction review. AC-02's reproduced stale-response failure is corrected; AC-01/AC-03 baseline evidence and the unaffected domain/HTTP/visual scope from attempt 1 remain applicable, with the full 82-test suite and correction E2E logs supporting the result.

The previously recorded limitations remain: local browser evidence uses Chromium 153 with Noto CJK and normal web security; long mobile persona names truncate in the closed select; initial JS gzip is 325.13 decimal kB (approximately 317.5 KiB), above the future M5 300 KiB budget. These are not new M0 failures. Future business flows, 60-CI seed, wider browser coverage and M5 performance acceptance are outside this review.

At handoff, the lead reports correction remote CI run `35513061081` / job `106084265604` succeeded with 82 tests and 7 E2E checks. That run tested synthetic merge `5f68e0c4941aa4edc0f74015b485f7eecc56df87` against newer main `a330237860b3002d68fec3f853a6d1deb44a8e9a`; its complete merge tree differs from this implementation tree. The lead is reconciling the intervening main paths. This report does not assert whole-tree equality between that merge and the reviewed candidate or independently accept those main changes. Final integration reconciliation, the T-004 revision-2 task/checkpoint update, source/evidence durability and the M0 acceptance/PR decision remain with the lead.

Concrete next action: preserve both attempt reports, use durable implementation `a608a94efc601c9affce554ca64bd4d733ee6839` and tree `5752b65fd9fe759a788d2af3780510f12e88c3da`, complete remote CI provenance reconciliation and metadata-only checks, then record the orchestrator's acceptance decision on the existing T-004/T-005 and PR #7. Do not restart M0 or discard the initial failed review evidence.
