# W3 validation — DG-W3-20260923-02

Product candidate: `46e3a557fcd1ff40221ce6881a7565b73c5daa7e`. Existing [PR37](https://github.com/fallrising/newclear/pull/37), W3 contract revision3, AC-WS-10/11/15–18. Lead ACCEPTED fixed46 in PLAN DG-D088 after the terminal product CI and independent DONE review. Final metadata-head CI, merge and actual closeout remain separately recorded in PR37. W4/W5 remain unimplemented.

## Corrections and provenance

- `25ba5ca`: fixes the actual Admin integrations AbortSignal/context regression by explicitly calling the zero-argument API; request creation passes only its typed input. The real deferred-client component regression failed before correction and passes for initial query/refetch after correction. Original two failing M4 journeys pass.
- `8408927`: wraps the remaining pipeline mutation callback with its typed input. Preferred Claude attempt2's deterministic QueryClient-clone HIGH claim was not substantiated: actual installed QueryClient context clones successfully and M3 flows pass. The explicit callback convention still warranted this bounded change. All18M3 flows then passed on a fresh840 build.
- `46e3a55`: fixes independent reviewer MEDIUM T040-F1. Eager integrity derives the first terminal traffic sample prefix, rejects inconsistent states/times or continued samples, and preserves health-success-before-timeout precedence. Three real-engine corruption regressions first failed, then passed. Original reproducer now rejects INVALID_SNAPSHOT without altering input bytes. The independent60/120/180window matrix accepts valid healthy/missing histories and incomplete healthy suffixes, rejects early/boundary contradictions atomically.

Historical T039attempt3 and T040attempts1–3 remain intact. The initial continuation report is preserved byte-for-byte in [resume checkpoint](dim-gate-w3-resume-checkpoint.md), SHA256 `4e0ca617c09b43182674e5942656abd4e79b04048b0b9014a4232478eed4685a`. That file is a historical PARTIAL observation, not the latest result. Claude Code2.1.278/runtime-confirmed claude-sonnet-5 actually ran, but CLI command permission mismatches and incomplete coverage required reassignment to an uninvolved builtin reviewer. Exact builtin model slug is not exposed. No completed Claude final acceptance is claimed.

## Source-bound local evidence

Commands use component cwd, Node24.18.0/pnpm11.18.0, pinned lockfile and the existing local browser/font environment. All listed completed gates have exit0, no retries/skips or relaxed budgets/health filters.

| Source | Gate | Result / evidence |
| --- | --- | --- |
| 25ba5ca | frozen offline install; lint/typecheck/test/docs/contracts/CI/architecture/demo build |372native/34files, all pass; fixed-*.log |
| 25ba5ca unchanged dist | complete Chromium |89/89,28.4min; test-e2e-report SHA256254dbd81dfac42261b5ae663cc82003e4643dbd3c19bfc68265a19704f49528b |
| 25ba5ca unchanged dist | complete Firefox/WebKit smoke |10/10,3.4min; test-smoke-report SHA2565a16c53878d2de218df8f8721635f5d25f37b9f4ab16d88e3ef840dd3c5ceb98 |
| 25ba5ca | callback focused20native and original M4 journeys |20/20 and2/2; m4-focused-report; actual1440light/768dark/390light screenshots inspected |
| 8408927 fresh build | root complete affected M3 |18/18,3.8min; final-m3-report SHA25680b0abece7c3ccfeb8882cfa1d746baed8de4b891adeeb47ad570dba65fa703f |
| 8408927 independent reviewer | full source audit, native/build/contracts/architecture, W3 browser |372native,11Chromium,2Firefox/WebKit; sole confirmed F1 required rework; T040attempt3 |
| 46e3a55 | lint/typecheck/test/docs/contracts/CI/architecture |375native/34files;127operations/259schemas;46-native.json/46-*.log |
| 46e3a55 independent reviewer | fixed source correction, original reproducer, window matrix, native/build and affected browser |375native,4W3Chromium,2W3Firefox/WebKit; F1 closed; T040attempt4 |
| 46e3a55 fresh build | unchanged benchmark |3/3; performance-results.json payloads bind46 with empty tracked product diff |
| 46e3a55 fresh demo/live builds | actual sibling/live isolation |2/2; test-isolation-report SHA2567b7034a6216126a608501307bba97975a159405b08b12a431e13a7a092b1186d |

Evidence base: `/tmp/dim-gate-w3-resume-evidence`. Runner fixed-gates.json starts at25; its top-level testedCommit applies only through smoke. source-bindings.json preserves baseline dist hashes and binds later fresh benchmark/isolation to46. No older build is relabeled46. [Product CI35862758449](https://github.com/fallrising/newclear/actions/runs/35862758449) completed SUCCESS, with375native/89Chromium/10Firefox-WebKit/3benchmark/2isolation and all remaining gates. Latest metadata-head CI is a separate integration prerequisite before merge.

Browser-health decoded from actual HTML attachments: full89 has55attachments/29,310responses,0pageErrors/failedRequests/unexpectedHTTP,42declarednegativeHTTP,0retiredreads; fullsmoke6attachments/2,007responses,zeroerrors; affectedM3 has18attachments/3,140responses,zeroerrors,5declarednegativeHTTP; reviewer840W3 has11attachments/3,142responses,zeroerrors,10declarednegativeHTTP; reviewer46affectedW3 has4attachments/1,530responses,zeroerrors,4declarednegativeHTTP; fresh46isolation3attachments/39responses,zeroerrors. Passing unchanged browser-health assertions also reject unexpected console errors. Counts cover instrumented journeys and are not represented as every response from every test.

Actual screenshot review includes definition1440light and traffic390/768dark, with readable controls and separate desired/verified weights. UI source remains unchanged through46. Independent review also reconciles the earlier config/Ops/run-dialog supplement (18axe/6keyboard checks at6c19fe7) only after verifying unchanged UI source. Automated route/theme/viewport and real confirmation focus/Tab/Escape/return assertions remain enabled.

Fresh46 performance: five isolated4×CPU cold samples each load306,447gzip bytes including required demo boot and MSW; medianLCP752ms (budget2500ms).100real filtered/sorted queries over5000CIs p95≈0.6ms (150msbudget).100persisted HTTP200commands including150msmockdelay p95≈170.4ms (500msbudget), each adding one clock/audit/event/idempotency result. InitialJS budget307,200bytes leaves753bytes; further eager code additions require care, not a relaxed budget.

## Product CI evidence

[CI35862758449](https://github.com/fallrising/newclear/actions/runs/35862758449) is bound to PR head46e3a55. Its actual checkout is synthetic merge `928b563aeabe909528bd6e16f355463a11d635d0` (parentsf4a233d and46e3a55). Both full dim-gate component trees are exactly `f4dc14f9ecafa926cab771a5c068979d1dd16766`, independently retrievable through SSH; this proves coverage without falsely labeling the synthetic checkout as46 itself. All375native/34files,89Chromium32.5min,10smoke4.3min,3benchmark/2isolation and other required steps passed with0flaky/skipped.

Formal [artifact10751674277](https://github.com/fallrising/newclear/actions/runs/35862758449/artifacts/10751674277),85,900,919bytes, SHA2560498b5cc2adc9ca6f9d61d5b041a438a3811bcad3ef8241790f8fefca1f80059; expires2026-10-23T13:27:47Z. Downloaded under local evidence `ci-35862758449/artifacts/`, alongside run.json/run.log/artifacts.json and decoded summaries. Actual CI Chromium HTML SHA2565547bd8c6e8100d65f05ab6f3bb8738e1a0149f65704eed26ac4ef13e2b4627f:89/89,55healthattachments/29,316responses,0pageErrors/failedRequests/unexpectedHTTP,42expectednegativeHTTP. Smoke10/10 has6healthattachments/2,008responses andzeroerrors; isolation2/2 has3attachments/39responses andzeroerrors.

CI performance attachments bind synthetic928b563 and empty product diff: allfivecoldstarts306447gzipbytes, medianLCP1324ms;5000CIquery100samplesp95≈1.1ms;100persistedHTTP200commands p95≈184.6ms. Budgets and measured asset set are unchanged; local andCI initialJS totals agree exactly.

## Requirement coverage

| ID | Behavior and durable test references |
| --- | --- |
| AC-WS-10 | Typed definition/config revisions; immutable run/retry snapshots; separate prod definition and Release approvals; active/proposed diff; failed apply retains active; restore creates new revision; secret references only. w3.test.ts, features/service-delivery/commands.test.tsx, w3-definitions/governance/service-delivery browser specs |
| AC-WS-11 | Actual same-env release pair; registered endpoint/match; ordered30-second samples;60/120/180windows; unknown/timeout;10/50/100proof; failed50retains10; activeReleaseId separate; shared locks; invalid weights/foreign targets denied. w3.test.ts, w3-service-delivery/governance browser specs |
| AC-WS-15 | Current requester/independent approver grants; Admin cannot execute business changes; all-affected-env scope; filtered list/detail/search/triage/history; held real old-persona200 never flashes; call-time identity/input capture. domain/w3.test.ts, demo/w3-handlers.test.ts and api/core/deferred-client.test.ts and browser governance/isolation |
| AC-WS-16 | Frozen strict W1/W2 legacy schemas; genuineW2 active Release/ProvisionJob/KafkaChange migration and once-only resume; eager integrity/corrupt-byte preservation; atomic persistence; serialized lazy command queue. demo/w3-migrations.test.ts, domain/engine-loading.test.ts and domain/w3.test.ts, w3-migration browser, completeM5baseline |
| AC-WS-17 | Keyboard/focus; two themes and1440/768/390 screens/axe; deep refresh; FF/WebKit; unchanged300KiB/LCP/query/HTTP budgets. Definition/service-delivery browser specs, T038supplement, benchmark |
| AC-WS-18 | Honest registered capabilities, persistent Mock banner, local deterministic probes/clock, no executor/cloud/external-notification claims. Contracts/checks, browser network evidence, independent review |

## Durability and limits

Versioned reports/contract/tests and the existing SSH branch are the durable source. `/tmp` raw logs/PNGs are local evidence only. GitHub CI uploads formal browser/performance/isolation artifacts with30-day retention; record actual artifact IDs/URLs in the PR closeout once terminal. No deployment, real cloud/notification/credential actions, force/main push or worktree removal. All historical failures remain available. Acceptance, PR merge and post-merge confirmation are separate events.
