STATUS: DONE

# T-020 — independent M3 review, attempt 3

## Summary

Independent review completed for fixed candidate `04d6646a2a325bb4efc18c44b463e0e6fd1747f3` in unchanged checkout `/home/ckc/test/codex/newclear-m3-review-final`. **No blocking, high, or medium findings remain.** The review retained the broader M3 inspection against `e760d8e988c0e2a837b226c600805a659a362c10` and examined the final correction from `f7905bb`.

The four original findings are closed: scoped clock receipts/replay, invalid persisted scheduler positions, missing playback and premature completion feedback. Subsequent pause and route-remount concurrency findings are also closed. This is independent static review with inspection of lead-produced runtime evidence, not an independent execution of tests/browser code.

## Verification

- Final commit identity, correction diff, applicable contracts and unchanged review checkout — passed
- Shared pending ownership survives pause and SPA remounts; playback, delivery and Guide use the same mutation key and remain pending through refresh — passed
- Timer cleanup and current-identity checks prevent an old playback invocation from rearming after pause/unmount — passed
- Delayed-response regressions preserve genuine responses and cover pause/manual/resume and detail→list→detail→Guide, asserting maxPending=1 — passed
- Prior review of authorization before replay, stage scope/audit, artifacts, locks, health activation, actor separation, cancellation, retry/rollback history and persistence remains applicable; those implementations are unchanged by the final correction — passed
- Inspected completed lead evidence bound to final SHA: 170 tests, frozen install, lint, typecheck, docs/contracts/CI/architecture, build, actionlint and diff check — passed
- Inspected completed lead production Chromium output: 40/40 journeys including both adversarial concurrency regressions — passed

Fixed references: [playback.ts](https://github.com/fallrising/newclear/blob/04d6646a2a325bb4efc18c44b463e0e6fd1747f3/platform/dim-gate/src/features/delivery/playback.ts#L13), [delivery controls](https://github.com/fallrising/newclear/blob/04d6646a2a325bb4efc18c44b463e0e6fd1747f3/platform/dim-gate/src/features/delivery/shared.tsx#L64), [Guide](https://github.com/fallrising/newclear/blob/04d6646a2a325bb4efc18c44b463e0e6fd1747f3/platform/dim-gate/src/features/foundation/routes.tsx#L44), [pause regression](https://github.com/fallrising/newclear/blob/04d6646a2a325bb4efc18c44b463e0e6fd1747f3/platform/dim-gate/e2e/m3-delivery.spec.ts#L514), [remount regression](https://github.com/fallrising/newclear/blob/04d6646a2a325bb4efc18c44b463e0e6fd1747f3/platform/dim-gate/e2e/m3-delivery.spec.ts#L564).

Lead runtime manifest and browser log inspected at `/tmp/dim-gate-m3-resume-evidence/final/results.json` and `pnpm-test:e2e.log`.

## Documentation

Contract revision 2 describes shared pending ownership and view-local timer cleanup. [Attempt 2](T-020-attempt-2.md) REWORK and intermediate `30b8d04` remount failure remain historical evidence; this verdict applies only to the final candidate. The intermediate candidate passed 39/39 ordinary browser tests, but a genuine-response-delay route round-trip still produced maxPending=2; source/result are preserved as `probe-playback-remount.mjs` and `.json` in the local evidence directory.

The reviewer modified no files, dependencies, commits or external services. The inherited runtime was used without claiming a separate model identity. Lead normalized this report's headings and links without upgrading its verdict.

## Risks and Follow-ups

At review completion, current-head remote CI and the orchestrator milestone decision remained outstanding. The 445.65 kB gzip bundle remains an existing M5 performance risk. This completes the independent review; it does not itself accept M3 or authorize merge/deployment.
