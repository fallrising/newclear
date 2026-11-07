# Initial trace v3 — successful completion sample semantics

Scope: T-0380, R2-AC-14/E, T006R and CU-WEB-P0-01 review diagnostics only.
Owner accepted continuation of the concrete clock correction, implementation and
pure tests on 2026-10-26. This is a normative diagnostic completeness change;
it does not change production protocol/product acceptance, retroactively pass006,
or grant a browser attempt. V1/v2 and every historical FAIL remain immutable.

## Evidence and chosen boundary

Exact-version Chromium153.0.8010.12 sources at commit
971a7443b0c9b0a9b2860529b33331b76077ec62 show response timestamp sampled with Now
and successful completion timestamp separately supplied (Blink falls back to Now
only for null). T103–T106 and the reviewed Claude opinion support revising the
assumption that these samples follow callback arrival order. Binary/patch/executed
producer path and historical ERR_ABORTED remain unproven.

Choose the conservative supported scope: relax only successful completion against
response, retaining the request lower bound and all other previous comparisons.
The request lower bound is a retained fail-closed acceptance policy, not a claim
that source analysis proves all valid upstream paths satisfy it. A future violation
stops for a new reviewed decision. Do not adopt Claude R2's finish-before-request
acceptance, arbitrary CDP permutations, epsilon, sorting or clamping.

## Clauses and acceptance

C01 — Keep callback arrival order and original millisecond-scaled CDP samples.
CDP_REQUEST and CDP_RESPONSE retain their v2 nondecreasing sample checks. Once a
valid request has been recorded, CDP_FINISHED is compared with that request sample,
not with response. A successful finish in [request,response) is retained unchanged;
equality/increasing samples and numeric zero remain valid. Finish before request
still records CLOCK_REGRESSION and cannot complete. CDP_FAILED retains its existing
last-CDP-sample comparison. No new cross-domain timestamp subtraction.

C02 — Every timestamp still must be present, numeric, finite, nonnegative, with
finite seconds-to-ms scaling. Missing/invalid request time never creates an anchor.
If no validated request observation was successfully recorded, refuse to record
CDP_FINISHED even when its timestamp is valid. Retain the original request clock
failure, record MISSING_PHASE at stageCDP/eventCDP_REQUEST, and remain incomplete;
never coerce a missing anchor to zero/null/default. A later response cannot create
an anchor. Zero is a valid anchor only when actually observed and validated.
Use the existing finite safe reason vocabulary and CDP_TIMESTAMP clock path for
CDP comparisons. Preserve host/page clocks and host-arrival field validation.

C03 — Preserve unique target/identity correlation, phase cardinality/completeness,
missing/duplicate terminal refusal and ignored unrelated CDP IDs. A recorded sample
is not evidence of body EOF or accepted product health. Preserve immutable redacted
snapshots and the combined128-record/32-failure limits. Existing invalid precedence,
exception handling, body-read count, fetch/promise/error identity and owned cleanup
remain unchanged. No credential/header/body/raw error logging or additional request.

C04 — Separately named v3 observer/page/baseline/test files; v3 page is byte-identical
to v2, baseline only changes observer/page/self import names. Driver assertion order,
health-first handling, one body read and cleanup remain byte-equivalent. Snapshot
metadata explicitly describes arrival order versus sampled time and the retained
request bound; do not call sampled CDP events globally monotonic.

C05 — Red before implementation: the exact006 triple765538.2013629999,
765538.220203,765538.217717 must fail on v2, then produce14 observations, exactlyone
CDP terminal and unchanged sample values in v3. Also test equal/increasing/zero;
finish before request; response before request; regressing CDP_FAILED; every invalid
value at all three CDP slots; valid-looking response/finish after an invalid or
missing request sample must not produce an accepted terminal; overflow;
missing/duplicate/correlation; host/page
regression; caps/redaction; v1/v2 hashes and page/baseline inverse equivalence.
Existing v2 tests are retained unchanged; copy/reuse relevant cases for changed v3,
not rerun unchanged green product/native/browser suites. Run v3 pure suite, four
new-file syntax checks, scoped project-success and diff checks; independently review
exact candidate and current-head required CI before source checkpoint acceptance.

## Inherited archetype and safety answers

This is T006R's review-only scaffolding, not a new production contract unit. Errors
remain typed bounded diagnostic enums. Atomicity, identity and retry semantics stay
inherited and unchanged; no side effects, persistence or network in pure tests.
No new retry, runtime, dependency, permission or recovery operation. Output bounds
and redaction are C03; cleanup C04. No new TD-GAP in product behavior. Actual browser
acceptance remains NOT_RUN for v3 and requires a separate bounded owner decision.

## Delivery boundary

Root owns documentation, integration, Git and handoff. A bounded leaf author writes
only four new v3 files in a separate source-HEAD worktree. Fresh independent document
review precedes implementation; exact-source review follows verification. Existing
PR604 remains Draft until full acceptance. Canonical8/27, delivery18/19, mainline
incomplete, targetsfalse and usable_tag:none are unchanged.
