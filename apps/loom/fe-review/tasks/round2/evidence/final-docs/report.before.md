# T018 paired R2 — first proof checkpoint

Status: PARTIAL. Product/native/runtime acceptance not claimed; targets remains false.

- Focused preload tests — passed, 12/12, actual Node24.18 and locked Loom Tauri SDK2.11.0. Both fixtures were empty at the preserved RED attempt; implementation then passed. Exact command: `node --test apps/flowshot/fe-review/preload.test.mjs apps/loom/fe-review/preload.test.mjs` from repo root. [RED](evidence/proof-red.log), [GREEN](evidence/proof-green.log).
- Flowshot paired runtime guards — passed, 3/3; external origin refusal, safe exception classification, all owned closers attempted despite rejection/hang. Evidence lives in Flowshot `tasks/round2/evidence/guards.log`.
- Flowshot runtime entry syntax — passed (`node --check` on browser-runtime.mjs and run-review.mjs); no server/browser was launched.
- Actual browser, complete Loom M2 scenarios, root native checks and required CI — pending/not run by worker.

Flowshot uses the real eager launch source transpiled by existing TypeScript for the pure seam proof. Loom tests import the actual locked SDK invoke/listen/unlisten; separate event and callback IDs are released. Negative command/Origin/path, save conflict/error, reset, explicit restart/forget, pending-history disposal and no-key AI are covered. This is not native IPC proof.

Both SUCCESS files now contain the scoped plan; SCENARIOS.md maps remaining browser evidence. Runtime files and 19-capture Flowshot entry prepared for root review/launch only. Loom browser driver not yet built. Only assigned review paths and scoped SUCCESS changed. Frozen contract/product/dependency/CI/shared capture unchanged.

Raw proof logs remain ignored in Loom runs; published logs only redact worktree paths to `<worktree>`. All initial failures remain visible. Source hashes at this checkpoint are in result.json. No full Round3/mainline/usable/provider claim.

## Test discovery correction

Root native npm test found Vitest collecting review node:test files under *.test.mjs, while original Flowshot 7 files/29 tests and N03 9 tests passed. Root preserved that native failure. Review tests renamed to *.node.mjs without altering Vitest configuration or original tests. Historical commands/logs above retain the names actually used at the time; current focused command is `node --test apps/flowshot/fe-review/preload.node.mjs apps/flowshot/fe-review/runtime-guards.node.mjs apps/loom/fe-review/preload.node.mjs`.

Flowshot root runtime flowshot001 passed 19 captures and owned cleanup before this rename. Runtime source hash manifest stays immutable; the only post-runtime executable delta is the sourceFiles manifest test-name string. No product or fixture behavior changed, and green browser evidence is not rerun. Contrast incomplete is retained; no full contrast or Round3 acceptance is claimed.

## Approved extra drag activation attempt — preparation

Owner approved one additional targeted Loom attempt on 2026-10-24. T022 only adjusts the real pointer sequence to account for locked XYFlow activation consuming the first threshold-crossing event; then observes stable post-activation node geometry and derives the remaining displacement. Original loom002/003/004 failures and the 12 accepted matrix keys remain unchanged. Root alone launches the journey-only attempt after source review. Pure regression must expose the actual lost-distance failure before repair; runtime remains pending. No product, fixture, dependency, Flowshot helper or semantic acceptance changes.

T022 preparation: initial external-contract regression 2 pass / 3 fail, then affected ui+geometry 7 pass / 0 fail / 0 skipped on Node24.18.0. Only ui-steps.mjs executable changed: real 2px threshold activation, stable geometry observation, full recomputed remaining delta, pointer release in finally. Existing post-fit geometry, center-hit, edge DOM/sidecar and all workflow assertions unchanged. Source/provenance and exact deltas: evidence/activation-005/source.json. Browser attempt remains NOT_RUN pending root review. Initial cwd/redirection and unavailable Node selector failures retained; they launched no test/browser.

## loom005 actual failure — STOP, prior assumption corrected

Root actual loom005 exited1 in3.376s at EDGE_RUN_PIN / REVIEW_NODE_SEPARATION; all four inner cleanup flags true and outer containerRemoved true. Capture SHA256 `e4eeabbbbd52ea64fe47bb6c93e8a38223702f47d1bc72fc48d9e1b9b133463a`. The approved one extra attempt is CONSUMED; no new source/test/runtime work is authorized by this diagnosis.

Cause supported by current unchanged source and receipt: `src/surfaces/canvas/CanvasSurface.tsx:1019` explicitly sets `nodeDragThreshold={4}`. T022 author incorrectly relied on the library default1px and failed to inspect the application override before proposing2px. The pure simulator also hardcoded1px, so its7green checks do not establish the actual configured drag behavior. Earlier default1 statements and source manifest remain historical artifacts, superseded by this correction; they must not be cited as application configuration.

Locked XYDrag only calls startDrag when distance is strictly greater than the configured threshold and anchors lastPos at that same event; the following no-movement check consumes it. Thus2px cannot activate this4px configuration. loom005 records identical pre/activation node boxes (document x140,width560; terminal x60; scale1), remaining688px, and after-fit terminal672.053711 versus documentright681.952934, overlap9.899223; source-hitfalse. This is consistent with losing the first688/12px segment again. No browser-internal dragStarted flag was measured, so the causal explanation is source-backed inference plus matching geometry, not a claim of direct internal-state observation.

Concrete OPTIONAL next proposal, NOT implemented or authorized: allow one final correction/attempt with10min active pure preparation and at most4min runtime. Read the exact ReactFlow nodeDragThreshold numeric attribute from the already-hashed CanvasSurface source using the existing TypeScript parser; reject absent/duplicate/nonliteral/out-of-range values rather than assume a library default. Derive activation threshold+1 (=5px today), then one additional1px movement to make activation observable as actual terminal translation with unchanged document/viewport. Require that witness before computing the remaining gap from stable actual geometry; unknown/no movement fails. No synthetic event dispatch, app/store mutation, product/fixture/dependency/acceptance change. Parameterize pure input-contract regression with source-derived4px: original2px sequence must fail, corrected5px+1px and changed4→larger configuration must follow the supplied threshold; unsupported source shape must reject. Root independently reviews exact source/delta before ONE fresh journey-only invocation, reusing all12matrix/canary evidence. Any new failure stops; no further retry or renamed issue budget. Alternatively retain PARTIAL indefinitely with all original failures.

This follow-up only read configuration/receipt and appended this correction/proposal to the two reports. No source edits, tests, browser, service or Git action. Aggregate active/provider/token/cost remains unknown.

## T026 configured activation — frozen preparation

Owner separately approved10min active preparation and one4min runtime after loom005. Actual component override4px is now read with the existing TypeScript parser, associated with ReactFlow import from @xyflow/react; absent/duplicate/dynamic/out-of-range/spread configurations reject. Source SHA is explicitly compared with runtime receipt. New5px activation plus1px witness must move terminal about1 CSS px while actual document, viewport and terminal shape remain unchanged; stable-but-unmoved refuses. Remaining gap is recomputed from witnessed geometry. Original geometry/fit/center-hit/edge/workflow gates unchanged. No product/fixture/dependency edit.

Configured4px RED reproduces original2px failure; final focused UI+geometry14PASS/0FAIL/0SKIP, including source-derived4/8px and refusal cases. Source snapshots/deltas/checks: evidence/configured-activation-006/source.json. Old tests/failures retained. Root browser attempt NOT_RUN by worker; freeze for independent review, then at most one journey-only invocation using retained matrix/canary. Preparation path error happened before writes/tests and is recorded. No fullR2 acceptance claim.
