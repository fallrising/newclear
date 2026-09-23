STATUS: DONE

## Summary

T-039 attempt4, continuation DG-W3-20260923-02. Fixed product46e3a557fcd1ff40221ce6881a7565b73c5daa7e is SSH-saved on existing PR37. Admin callback regression and independent T040-F1 traffic-history corruption defect are repaired. All product gates pass, including terminal exact-head product CI and final independent T040attempt4 DONE/no open findings. Lead accepts fixed46 as the complete W3 product; final evidence-head CI and PR merge remain separate integration gates. Full source bindings, AC matrix, historical failures, model-route correction and measurements are in [W3 validation](dim-gate-w3-validation.md). The original attempt4 checkpoint is preserved verbatim in [resume checkpoint](dim-gate-w3-resume-checkpoint.md), so this update discards no evidence.

## Verification

- Fixed46 lint/typecheck/375native tests/34files/docs/contracts127operations259schemas/CI/architecture;46-native.json and46-*.log — passed
- Fixed25 frozen offline install/native/demo build,20focused native and2original failing M4 browser journeys; original regression first reproduced red — passed
- Fixed25 untouched dist: complete89Chromium and10Firefox/WebKit,0failed/flaky/skipped; actual browser-health summary and screenshots inspected — passed
- Fresh840 callback delta: all18M3Chromium; independent full source audit plus372native/11W3Chromium/2W3Firefox-WebKit; confirmed F1 then corrected in46 — passed
- Fixed46 F1 three regression cases first red then29focused domain/migration tests green; independent original reproducer now rejects corruption,60/120/180window matrix passes,375native and4affectedChromium/2FFWK pass — passed
- Fresh46 unchanged benchmark3/3:306447gzipbytes,752msmedianLCP,0.6msqueryp95,170.4msHTTPp95; attachments bind46 with empty product diff — passed
- Fresh46 demo/live isolation2/2; preserved HTML evidence and zero browser-health errors — passed
- Pinned actionlint on unchanged root dim-gate workflow — passed
- Exact product-head CI35862758449 SUCCESS:375native/89Chromium/10Firefox-WebKit/3benchmark/2isolation, all other gates and artifact upload passed. Actual synthetic checkout928b563 has the same complete component tree f4dc14f9ecafa926cab771a5c068979d1dd16766 as46; artifact10751674277 decoded and inspected — passed
- Final independent T040attempt4 DONE, SHA2569274658eb769ff1a2273c3a7e9cd3761ffc39840c308f2cff7e6194201431825; F1 closed and no open findings; report/CI provenance independently verified — passed

Logs/HTML/JSON are in /tmp/dim-gate-w3-resume-evidence. Source-bound detail and portable test references are in the validation report; older full browser builds are not relabeled as46. Node24.18.0/pnpm11.18.0 component cwd. No reduced gates, timeout changes or retries.

## Documentation

SDD05 documents explicit callback arguments; W3 contract documents eager traffic prefix proof. README/SDD/09–14/DEMO-GUIDE/STATUS/HANDOFF reconcile W1/W2 accepted, W3 product accepted pending integration, W4/W5 unstarted. Task IDs/revision3/DoD remain unchanged; PLAN DG-D084–086 preserves ownership, model-route reassignment and rework. Claude attempt2 genuinely ran but was PARTIAL; uninvolved builtin reviewer completes attempts3/4, exact runtime slug unexposed. No private kernel source published. Pinned237aa277 validator remains local.

## Risks and Follow-ups

Fixed46 product acceptance is recorded in PLAN DG-D088. Push this evidence-only checkpoint, verify code/test/config/lockfile/workflow identity and latest PR-head CI, then perform the authorized merge and actual merge/tree/post-merge CI closeout before releasing ownership. Later CI/merge/owner-release facts belong in PR37 closeout, avoiding an endless self-referencing metadata commit cycle. InitialJS leaves753bytes under307200; future eager additions need measurement. W4/W5 remain separate next increments. Raw /tmp evidence is local; versioned summaries and CI30-day artifacts provide remote reviewability. Preserve all worktrees; no deployment, main/force push or real external product effects.
