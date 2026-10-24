# R26 Phark independent final review

Final verdict: ACCEPT for the original R2 M1–M3 candidate; necessary CI/publication remain root-owned. The following checkpoint preserves the initial REQUIRES CHANGES cleanup finding, now resolved below. Final003 functional evidence is accepted as observed; this is not a request to repeat the green matrix/native suites. Review is read-only, author-other, with only this local report written. No tests/services/network/Git mutations performed.

## P1: cancellation can finish cleanup before an in-flight browser launch

`products/phark/fe-review/run-review.mjs` launches Chromium without an explicit timeout. On interruption, finally waits only35s for `running` before enumerating browser/children cleanup. Locked Playwright launch can remain pending beyond35s. If the browser is not yet assigned, the browser cleanup action passes vacuously; after finally writes its receipt a late launch can assign browser and hit the cancelled check, without another cleanup. Thus positive inner cleanup can precede actual acquisition termination. Existing normal-run/outer-container cleanup remains valid evidence but does not establish this branch.

Minimum remedy: bound acquisition inside the drain budget, register ownership before cancellation check, and ensure finally cannot finish while an acquisition can still produce an owned resource. Browser close also needs a bounded timeout/failure receipt. Focused delayed-acquisition/rejected-close tests suffice; do not rerun accepted captures or product native gates for this harness-only fix. Parent notified with exact scenario.

## Functional/source evidence read

- Product diff: App data-view/roles/grid sizing; Column min-height; Composer region/description/alert; PostCard containing block/min-width/wrapping; ReplyThread wrapping; notification-only CSS. No auth/API/pagination/optimistic mutation logic or backend/dependency changes observed. These match measured M2/M3 targets.
- Real API fixture: two generated accounts, register-not-login, refreshed/rotated CSRF, dynamic IDs/author/content binding, four posts/one PNG/cross-account reply+social/notifications/opaque limit1 paging/profile/search/report. Redirects disabled, actual origin/status checked, 429 stops without quota reset. Secrets excluded from public JSON.
- final003 `result.json` SHA256 `c0b00cbbe1c6695d397452ef2a25425965125d4863c719c1563bca5e86e04084`: passed;12 journey receipts and3 explicitly mocked keyboard paging receipts. True Tab focus-visible checks, pending no-resend, controlled500 recovery, real mutation response IDs, logout session-null. All5 inner cleanup stages true. Four journey PNG hashes and dimensions independently verified.
- Immutable prerequisites independently hashed: baseline005 `355407fb...`, mobile003 `3794ecc1...`, final002 `9c5a31e8...`; final003 points to exact final002. Final002 selected12 unique shared keys are9original green +3notification repairs; all12 PNG hashes/dimensions verified. The failed original notification matrix is preserved.
- Nine supplemental routes report actual loaded identity and zero measured route health errors; notification22/search23/profile28 color-contrast incomplete nodes remain at each viewport. Search moderate landmark-unique remains. Shared capture axe is first viewport only. No contrast/fullR3 claim is justified.
- final003 all recorded product/config/jar hashes match current source; run-review/journey hashes now differ because a parent/author followup is in progress. Those deltas must be disclosed and tied to new focused evidence, not treated as already run.

## Interactive health precision pending

final003 observed consoleErrors2, requestFailures1, pageErrors0/external0/unexpectedHTTP0. Exactly two controlled500 responses are recorded. The old requestfailed listener recorded only a count, so the one failure cannot be attributed to navigation/teardown from that receipt. Preserve this unknown in final docs; do not infer healthzero. Parent/author is adding precise classification under a separate bounded followup; that newer helper has not yet received final review/runtime evidence.

## Handoff still pending

At first read component report still said keyboard continuation pending and result.json was absent; parent explicitly said author is updating final docs, so this is not filed as a frozen-doc defect. Native frontend final lint/build PASS were reported by root (0.214s/2.633s); direct raw closeout still to be read. Await cleanup source/test fix, actual classified-health receipt if run, and final docs freeze for narrow reread. Product mainline incomplete/AC04 pending/usable none must remain. Necessary CI/publication/owner decision are root-owned.

## Focused P1 reread

P1 resolved in frozen source: Chromium launch timeout30000ms is below35000ms cancellation settlement; acquireOwned registers browser before cancelled check; browser.close uses bounded5000ms; main deadline210000 reserves cleanup under outer300s. Read actual late-cleanup-green.log:6PASS (4originalguards+2 meaningful late-resource/stalled-close tests), no reviewer rerun.

Health helper source now projects safe known paths and classifies only same-origin GET ERR_ABORTED associated with an observed bounded navigation or completed teardown; console500 consumes one exact observed controlled response per event. Unknowns still fail. Await actual final004 classified receipt and final docs/source-hash mapping before final ACCEPT. Original final003 health count1 remains historically unclassified.

## Final evidence gate — ACCEPT

Frozen author report SHA256 `be3ef2bec086a458948ae949ba15760e912fe0c61c632999d8c2c0d83dc140ad`; result index SHA256 `4e131768fa7aec199261e38367cb0213dbbc6b569148edd35b998e463ca224cc`. Final docs/readme/prompt/runner/targets/scoped SUCCESS agree: verified applies only to approved R2 M1–M3, not full R3 or mainline/AC04/usable/owner completion. No unresolved P1/P2 remains in this bounded review.

- P1 cleanup source and `late-cleanup-green.log` six focused tests — passed. Existing complete-run and failure cleanup receipts remain; no reviewer runtime rerun.
- Health source plus `health-guards-final-green.log` four negative tests — passed. Actual `final005` receipt SHA256 `a78851f821216f81e218f85b2aa3d2b794d244204770bfc42d875b8f95bacbce` proves exact same Playwright Request POST/logout,204, subsequent session GET200/account null and signed-out UI. Root outer receipt exit0/13.386s/containerRemoved true. This focused result resolves the new observer classification; it does not rewrite final003's historical unknown1 or final004's strict FAIL.
- Required functional evidence — passed as the explicit bounded union: final002 strict9+3 capture selection and9 loaded route guards; final004 completed12 keyboard steps; final003 three controlled paging channels; final005 precise logout proof. Original source-pinned prerequisites and their failures remain immutable.
- Independent read-only hash audit — passed:13 run receipts,49 PNG SHA256/dimensions,12 unique selected keys,23 runtime source hashes,6 focused-test source hashes and34 final frontend native hashes match actual files. No tests/services/Git/network were executed by this review.
- Native receipts — passed: backend Maven exit0/37.289s (610 tests as retained native evidence); final frontend lint exit0/0.214s and build exit0/2.633s. CI is a distinct root gate, not inferred from these local checks.

Residual limitations remain explicit: shared axe only first viewport; contrast incomplete Home95/source-specific and notifications22/search23/profile28 per size; Search moderate landmark-unique each size; light-only. No complete contrast/fullR3 claim, real production-data qualification or restoration of dormant product investment. Historical failures are preserved and individually explained, rather than removed from the evidence index. Aggregate provider/tool/active cost remains unknown. This review accepts the original scoped candidate, not overall delivery before root CI/publication.
