STATUS: PARTIAL

## Summary

Third bounded M4 validation cycle, initial fixed candidate `ef016688bc94e0ac249f3ef9757576c6c198209d`. Production source remains `c0ff3fc`; this checkpoint preserves the full regression failures before a test/evidence-only refinement. M4 is not accepted.

## Verification

- Frozen install, lint, typecheck, all207 unit/component tests, docs/contracts/CI/architecture, fresh demo build, actionlint and diff whitespace at ef01668 — passed
- Full local production Chromium47:42passed/5failed. One old M1 expectation forbids a now-authorized scoped read-only CI deep link; four browser-health assertions reject legitimate retired-identity application GET responses across reset — failed
- Exact-head CI35702280664:43passed/4failed, same legacy route assertion and three nondeterministically overlapping retired reads; all native gates pass — failed
- Raw trace response inspection:409 STALE_IDENTITY, no domain data, old X-Demo identity; independent static reviewer confirms identity captured before delayed GET and rechecked before reading domain data — passed
- Focused readonly-CI/scope transition and reset/timer regression after test refinement:2/2 at ef01668 plus explicitly uncommitted test/docs delta, product bytes unchanged — passed
- Final complete candidate gates, fixed-commit independent closure and latest-head CI — skipped

## Documentation

Initial full-gate logs and commit binding: `/tmp/dim-gate-m4-evidence/ef01668-20260922T075743Z/results.json`. Preserved browser HTML/trace/DOM/PNG archive: `/tmp/dim-gate-m4-evidence/ef01668-full-browser-attempt-3-initial.tar.gz`. Remote failure log: `/tmp/dim-gate-m4-evidence/ef01668-ci35702280664-failed.log`. Focused log: `/tmp/dim-gate-m4-evidence/health-classification-focused.log`. These are local artifacts, not portable remote evidence.

Test refinement records raw error envelopes, request identities/times and actual successful reset/persona old-to-new identities. Only overlapping obsolete-identity application GET409 with strict STALE_IDENTITY error envelope and no domain data is classified. Current-identity conflicts, command failures and other409s remain failures. Generic console409 messages are bounded by the number of classified reads. All raw evidence remains attached. Existing snapshot/timer/reset and in-flight scope-leak assertions remain. M1 now verifies scoped readonly shared CI detail, absence of Data/management fields and edit action, and continued denial of Ops CMDB list. M4 integration page now has both actual themes at all three widths, plus untouched initial focus, Tab containment, Escape and return focus.

## Risks and Follow-ups

No production behavior is weakened to satisfy old expectations. Independent review must assess the narrow error classification at the next fixed commit. The final full47 Chromium suite and current-head CI are still required. SSH-fetched main `eb2023f81d02ad5e9a7419a0b8bf67751e135758` has no delta under dim-gate, its root CI or `.team` versus the previously reconciled7bb80d0; keep stacked PR20 based on unchanged accepted M3 parent7d20bbc. No merge/deploy.

### Candidate231cb87 follow-up

All local gates and47/47Chromium passed, with independent artifact inspection recorded in T-023-attempt-3-checkpoint. RemoteCI35704063594 passed46/47: one pre-existing M1test's `pendingAtSwitch` assumption raced the actual150msresponse; it recordedfalse and noleak. AllM3andM4journeys passed. Preserve the original log/artifact; do not rerun blindly to manufacturegreen. A test-only refinement now holds the real successful Data searchresponse (assert200andcontainsdata-worker), switchesviaUI, releases the original bytes, completes a current Commerce search and assertsnoDOMleaks. Three repeated focused Chromiumruns passed; lint/typecheck passed. Initial command from repositoryroot hit Corepackpnpm12.5.1 mismatch before running; corrected component-directory invocation used pinned11.18.0. Final fullgates/CI remain required. Production code has no new delta.
