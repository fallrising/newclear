STATUS: DONE

## Summary

T-460 decision: **ACCEPT for a reviewable, unapproved documentation proposal only.** No blocking document finding. This review does not approve the new contract, merge it, qualify the repair candidate, or change any prior failure.

Reviewed against `874517a896b3be1695b8febb2a852f7e6c5f9307`. The SDD changes the AC-05 measurement from adjacent complete-request arrivals `A_(i+1)-A_i` to failed-response completion followed by the next complete-request arrival `A_(i+1)-R_i`. It explicitly discloses the excluded preceding HTTP cost and lack of equivalence. Numeric bounds, original four-503 fixture, first retry, no-warmup requirement, response-completion runtime deadline and durable/no-early gates remain. AC IDs stay AC-01 through AC-11; an independent section comparison found only AC-05 changed.

The old arrival contract remains effective until fresh owner agreement. The decision document identifies the approved original, reason, exact change and consequence; owner agreement to PR #472 is expressly not treated as approval of this amendment. Original FAIL `[199,311,607]` and diagnostic `[173,310,606]` are separated. The earlier `[703,350,639]` failure also remains a failure: its proposed first interval would still be about 566 ms.

Reviewed document SHA-256 values:

- `systems/ojbquay/SDD.md`: `c0ca2d850daf7021a1991553d671341b77a10d5bf44619f5359486f976ee8170`.
- `systems/ojbquay/docs/test-reports/retry-contract-decision-20261022.md`: `0f475ca71250f9596567669978c1f25ecfbac5c23c91a87c7b0d8a5b4c5036bc`.

## Verification

- Read assigned T-460 task, applicable AGENTS/worker/evidence-gate instructions, current desk N3/§6, T-455/T-459 reports, exact SDD/execution-plan diff and decision document; mapped both task checklist items to the checks below — passed
- `git diff` and script comparison against HEAD: tracked edits are SDD/execution-plan documentation; no runtime/test implementation changes in this proposal. Fixed AC ID set is unchanged; only the AC-05 section changes — passed
- Inspected `dual-observation.xml`, `dual-observation.log`, `result.json` and retained strict fixture source: one test, one failure, zero errors/skips; original assertion is still `<180` and fails at 199. Actual output records `[199,311,607]` and diagnostic `[173,310,606]`, matching the summary — passed
- Verified source snapshot SHA `738c4d3765369122032f922938696c2315a43698912b95186485398cc449f26a` matches `source-manifest.json`. Source records complete-body arrivals, records completion immediately after the actual JDK HTTP client returns, computes both lists using full `Instant`/`Duration.toMillis()`, retains all four attempts and all original numeric assertions, and has no new warmup request — passed
- Independently recomputed epoch-ms crosschecks from XML: original `[199,311,608]`, proposed `[173,310,607]`; each differs from the full-Instant result by at most one millisecond, as expected from separately truncating timestamps. Full-precision interval outputs are backed by the inspected source; the artifact does not separately print raw nanosecond timestamps — passed
- Read the retained historical `notification-final-build` XML: response +86 ms, client result +138 ms, first proposed interval 566 ms, original printed interval 703 ms. The decision report correctly limits its impossibility claim to that recorded sample and does not excuse late ingestion — passed
- Parsed `advancing-clock.xml`: six tests, zero failures/errors/skips, including `AC_05_preservesResponseCompletionAnchorWithAnAdvancingClock`; inspected source showing HTTP advances the clock by 86 ms and due is +236 ms. This protects the existing anchor rather than proving end-to-end timing — passed
- Inspected reference-build log and receipt: successful 44-task reference build, 25 executed and 19 from cache; restored XML counts 119 tests, zero failures/errors/skips. Receipt correctly states cached tests are not fresh execution and the broad main oracle is not current candidate qualification — passed
- `python3 scripts/check_project_success.py`: 41 contracts/navigation/index accepted; `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v`: 15 tests passed — passed
- Relative-link existence check for changed SDD and new decision report, plus initial `git diff --check`: local targets exist and tracked documentation had no whitespace errors. This initial command did not cover the then-untracked raw evidence; the publication-wide check failure and correction are recorded below — passed
- `teamctl.py validate-report .team/reports/T-0368-ojbquay-460.md`: report contract accepted — passed
- Bounded follow-up against initial proposal commit `a5996129f2bd575a05d56cfe8be535e23d37188a`: byte comparison confirms the three changed log/XML files differ only by per-line trailing whitespace removal; parsed XML tags/attributes, failure/counts, timing events and interval outputs are identical; SDD and decision-document hashes remain exactly as above — passed
- Follow-up `git diff --check HEAD`: exit 0 after normalization. New initial-failure receipt retains exit 2 and identifies that the first commit command continued after the staged check failed. The first failure is not relabeled as success — passed

## Documentation

Only this designated review report was written by the worker. The new decision report and SDD form a concrete owner-review packet, not a new accepted specification. Earlier proposal wording retained in historical execution-plan entries is superseded by the appended dated entry, which correctly distinguishes original approval from this pending amendment.

### Bounded publication follow-up

Initial PR #477 commit `a5996129f2bd575a05d56cfe8be535e23d37188a` included raw log/XML trailing spaces. The initial tracked-only review check could not establish cleanliness of those then-untracked evidence files. The later staged check actually exited 2, and the shell continued to the initial commit. This process failure remains preserved in `initial-staged-whitespace-failure.json`; `document-validation.json` now distinguishes it from the final follow-up check. The correction uses a new commit; it does not rewrite history.

The reviewed correction changes only `dual-observation.log`, `dual-observation.xml` and `reference-build.log` trailing whitespace, plus an honest validation receipt and this report. No test result, original failure, proposed AC text or decision-document content changed. ACCEPT remains limited to publication of the unapproved proposal. Root must retain a final staged-check pass before committing the follow-up. No additional heavy build was run by this reviewer.

## Risks and Follow-ups

A single diagnostic sample within proposed bounds does not establish reliable timing or satisfy any new AC. The new metric would exclude first-response cost and can accept samples the original metric rejects; this is a substantive product acceptance tradeoff requiring fresh owner agreement under desk N3/§6. Original failures must remain permanently reported against their original contract. An approval would still require executable amended assertions, full same-source verification, other AC evidence, independent review and necessary CI before product qualification. This review authorizes none of those claims.

No heavy build, container, fixture rerun, Git mutation, deployment, dependency/tag change, recursive delegation or external model call was performed by the reviewer. Tool/provider totals across sessions remain unknown. Product remains unqualified; usable tag none; owner product acceptance pending.
