STATUS: PARTIAL

## Summary

First immutable M5 candidate `5ec58f70555ec9b8ea9ce9d26912d449e0c147f2` was not accepted. It integrates bounded T-025/T-026 changes, complete keyboard/extra-browser Guide evidence and CI/documentation. Independent T-028 found a snapshot serialization error-contract gap and confirmed the new extra-browser test's persona navigation synchronization failure. Corrections will be bound to a new immutable candidate.

## Verification

- Exact candidate frozen install, lint, typecheck, 210 tests, docs/contracts/CI/architecture and fresh production demo build; manifest `/tmp/dim-gate-m5-evidence/5ec58f7-20260922T104707Z/results.json` — passed
- Exact candidate `pnpm test:smoke`: 2 shell cases passed, Firefox/WebKit story cases failed because the new pointer driver continued before the persona change completed its route transition — failed
- Full fixed-candidate Chromium, benchmark, isolation, actionlint and remote CI — skipped
- Independent read-only T-028: F-01 snapshot serialization escapes expected507; F-02 extra-browser proof synchronizes with old navigation — failed
- Correction development: wait actual selector value/enabled and expected new route before next action; Firefox/WebKit shell+complete visible Guide4/4, with strict original browser-health assertions — passed
- Correction development: parameterized snapshot/envelope serializer regression and lead-owned catch boundary,19/19 controller tests — passed

## Documentation

Fixed candidate artifacts `/tmp/dim-gate-m5-evidence/5ec58f7-smoke-failed.tar.gz`. Earlier development artifacts preserve all failed attempts: keyboard initial Redis direction and native radio-key corrections; extra-browser legacy hard navigations cancelled genuine in-flight GETs; native select keyboard automation differs across engines; smoke now uses the same complete SPA Guide story with a clearly separate visible-UI driver while Chromium keeps keyboard-only proof. Original M0–M4 tests were not altered. Initial keyboard complete story passed with14 light/dark page axe scans and actual focus/dialog evidence before fixed integration; it is not substituted for final fixed-candidate evidence.

Lint after browser failure also exposed new generated `playwright-report-smoke` trace code being scanned; the correction extends the existing artifact exclusions to the new report/result directory names without changing source rules. Native configuration and documentation source remain linted.

## Risks and Follow-ups

M5 remains NOT_ACCEPTED; Draft PR23 stores candidate on SSH. Independent final review, complete corrected candidate gates and latest-head CI are required before the user-authorized merge. No deployment/real cloud. All source, accepted, worker and fixed-review worktrees and prior artifacts are preserved. Worker1000 visible-command proof initially reached885 persisted commands before12min default polling overhead timeout; original failure retained,25ms assertion polling retains normal150ms HTTP and all1000 real UI operations, with15min maximum for CI.
