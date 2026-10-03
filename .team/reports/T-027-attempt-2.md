STATUS: DONE

## Summary

Second bounded M5 candidate is `043a13aba3f74de2d3dd14aa2481024a68e2f6b2`, compared with accepted M4 `d83560de014742ece363d481d2c40483120a2676`. Lead accepts M5 AC-26–30 after complete local gates, independent review and exact product-head CI. The evidence-only head still requires its own CI before the authorized merge. User explicitly authorized commit, SSH push and PR merge; deployment and real cloud remain excluded. Draft PR23 targets main.

Product changes retain all accepted M0–M4 behavior: public lazy feature exports and lazy Guide, precise Zod constructor imports, demo-only runtime import and unchanged MSW/cookie semantics with one shared suffix constant. A serializer failure now receives the existing atomic 507 DEMO_STORAGE_FULL response at both snapshot and saved-envelope boundaries. No dependency or lockfile changes; all original47 Chromium regressions are retained unchanged.

## Verification

- Exact candidate frozen install, lint, typecheck,211 unit tests, docs/contracts/CI/architecture and fresh production demo build — passed
- Exact candidate Firefox/WebKit shell and complete visible Guide4/4, including14 light/dark axe scans per Guide and strict browser-health evidence — passed
- Exact candidate Firefox environment-only CJK correction: shell and complete visible Guide2/2,385 successful network responses,14 axe scans, no console/page/failed-request/unexpected HTTP errors; independent reviewer visually inspected all14 readable PNGs — passed
- Exact candidate `pnpm test:e2e`:52/52 Chromium,18.6min; original47 plus keyboard and4 reliability cases — passed
- Exact candidate `pnpm benchmark`: fresh demo build and3/3 browser cases, all5/100/100 samples retained — passed
- Exact candidate `pnpm test:isolation`: separate fresh demo/live builds,2/2 actual sibling/live cases — passed
- Root actionlint and `git diff --check` — passed
- Product-head [CI35718464916](https://github.com/fallrising/newclear/actions/runs/35718464916), head043a13a / synthetic merge585dced93a8ef547a634020c0960860908902f67,211 tests/52 Chromium/4 Firefox-WebKit/3 benchmark/2 isolation; artifact10691481213 downloaded and inspected — passed
- Final independent fixed-candidate [T-028 attempt2](T-028-attempt-2.md): no remaining blocker/high/medium; F-01/02/03 closed — passed

Measured initial required JavaScript is297,794bytes (**290.814KiB**), including all four actually loaded boot scripts and registered MSW. Five cold 1440×900 Chromium navigations at4×CPU with cache disabled produced LCP[724,692,708,712,692]ms, median**708ms**. All100 real queries over5,000CI gave p95**0.500ms**, excluding HTTP delay. All100 baseline persisted HTTP commands gave p95**167.200ms**, including150ms delay and+100 clock/command/audit/event/receipt counts. Machine: AMD Ryzen7 PRO8700GE,16 logical CPUs, Linux6.8.0-139-generic x64. Complete samples and source/asset hashes: `/tmp/dim-gate-m5-evidence/043a13a-performance/` and component `test-results/performance-results.json`. No fastest-sample selection.

Keyboard proof records155 actions,6 initial dialog-focus checks,14 actual light/dark axe scans and386 responses, with zero page/console/failed-request/unexpected HTTP errors. Seven major page types retain PNG and DOM evidence. Lead visually inspected fixed-candidate dark topology text alternative and completed light Guide; independent reviewer inspected all14 corrected Firefox PNGs. The1,000-command test completed in411.801s; snapshot1,195,164bytes held1,000 audit/events/receipts and remained byte-identical after the expected429 and reload. The deliberate quota test retains its expected507. These explicit fault responses are not erased or described as zero raw errors. No page errors or failed requests occurred in these M5 cases. Parsed main and isolation raw reports: `/tmp/dim-gate-m5-evidence/043a13a-chromium-parsed/` and `043a13a-isolation-parsed/`.

Full runner manifest: `/tmp/dim-gate-m5-evidence/043a13a-20260922T105403Z/results.json`. Runtime Node24.18.0, pnpm11.18.0, Chromium153.0.8010.12, Firefox155.0 and WebKit26.6. Main browser port4173; benchmark4175; actual isolation hosts4176/4177; isolated local Firefox font recheck4178. Local browsers use temporary extracted Linux libraries and Noto CJK fonts, without global package installation. Normal sandbox commands fail at bwrap network setup; required scoped commands use approved escalation. After13 successful commands the local runner constructed an actionlint log filename containing a slash and stopped before invoking actionlint. The two remaining commands were run separately on the same candidate and both passed; the complete15-command manifest records this harness issue. No passed product test was repeated to hide a failure.

## Documentation

[DEMO-GUIDE](../../platform/dim-gate/docs/DEMO-GUIDE.md) describes reset and all three provider stories, roles, keyboard operation, error recovery, hosting and explicit live unavailability. CI runs the native gates,52 Chromium cases,4 additional-browser cases,3 benchmark cases and2 isolation cases; HTML/PNG/DOM/raw health/trace/sample artifacts are retained30days.

Historical attempt1 and its failed artifacts remain. This candidate closes independent F-01 serializer error mapping and F-02 new test-driver persona/navigation synchronization. F-03 was an environment evidence defect: Firefox's content sandbox could not read temporary CJK fonts. The local-only recheck adds only `security.sandbox.content.read_path_whitelist=/tmp/dim-gate-m3-fonts-kaBaS8/`; the sandbox remains enabled and product/test source is unchanged. Its config, manifest and complete report are under `/tmp/dim-gate-m5-evidence/`; original tofu screenshots are archived in `043a13a-smoke-before-firefox-font.tar.gz`. The corrected report is `firefox-font-report/`, with decoded raw data in `firefox-font-parsed/`.

T-026's immutable worker report remains PARTIAL because its own unchanged engine intentionally retains the reproduced serializer regression. The integrated lead candidate owns the source correction and all211 passing unit tests; do not reinterpret the worker result as a local green test. Original1000-command timeout at885 successful commands remains preserved; the final browser test retains every UI click and150ms HTTP delay, using25ms assertion polling and a15min deadline.

## Risks and Follow-ups

All product acceptance gates have passed. Final evidence-head CI, Ready/merge and owner release remain administrative closeout, recorded on PR23 without an infinite self-reference commit. Original29 worktrees remain present. Their accepted/source/worker/review HEAD and dirty state are preserved; unrelated agent-platform m3-cancel work advanced independently, and main gained b252d4e touching only that component. M5 will normally incorporate that main ancestry without changing tested dim-gate source. All added M5 worker/review worktrees remain preserved as well.


Lead remote verification: CI on AMD EPYC7763 produced the identical297,794gzip bytes. All5 cold LCP samples[1256,1184,1120,1104,1148]ms give median1148ms;100 queries p95 1.1ms;100 persisted HTTP commands p95 184.9ms. Standard CI Firefox CJK form screenshot was visually inspected and readable without the local font workaround. Downloaded artifact: `/tmp/dim-gate-m5-evidence/ci-35718464916/`; complete local archive: `/tmp/dim-gate-m5-evidence/043a13a-final-local.tar.gz`.

Latest main b252d4e62c8380803af1854997d95c4b242bc18a was normally merged as2464b5283b8c1a168a073220a316d78e404397dc after acceptance checks. Git diff confirms zero dim-gate, dim-gate CI or ledger changes from the reviewed043a13a before this documentation-only checkpoint. Product/spec/test implementation remains043a13a. M3/M4 post-merge CI35715757530/35716558999 both succeeded. No worktree or branch was deleted.
