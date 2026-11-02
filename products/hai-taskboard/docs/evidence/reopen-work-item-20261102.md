# ReopenWorkItem — implementation evidence

T-0339 / BOARD HROP. [Normative contract](../sdd/reopen-work-item.md); [proposal](../plans/reopen-work-item-20261102.md);
[plan review](reopen-work-item-plan-20261102.md). Base `19fdeb4f` (#976) plus BOARD closeout #987. Local runs use the
pinned images in [reproducibility](../reproducibility.md); logs are kept outside the repository with the session handoff.

## Acceptance

| AC | Oracle | Result |
| --- | --- | --- |
| ROP-AC-01 | `TestReopenWorkItem_GuardsAndHistory`: Done → Ready and Done → Draft over real SQLite/Fake/HTTP give version+1 and a closed `WorkItemReopened` result (exact key set) with a byte-exact reason (tab, newline, CJK); replay returns the same result and different bytes under the same key are `idempotency_conflict`. Eleven completion/verification/Run history tables are byte-identical after success. Refusals with domain snapshot and bookkeeping counts: Developing and Review (lawful), injected Ready, QA and Canceled → 422 `invalid_transition`; stale version 409; invalid target (Developing, Done, missing), empty/control/NUL/2001-code-point/missing reason, unknown field, `expected_version` 0 → 400 unrecorded; missing item and a full ReopenWorkItem envelope to another project → masked 404 unrecorded. A changed project policy refuses the Ready target with 422 and no row change; the Draft target then succeeds with a 2000-code-point reason | PASS |
| ROP-AC-02 | `TestDispatchRun_FromReadyWithRunHistory`: after reopen to Ready one new Run dispatches (`attempt` 1, Developing, version+1); a clock equal to the first Run is refused retryable, same-key replay returns the recorded refusal, a regressed clock is refused, a stale version with a regressed clock is `version_conflict`, and the dispatch succeeds after the clock advances; an injected blocker gives `active_blocker` | PASS |
| ROP-AC-03 | `TestReopen_SecondCompletionUsesOnlyNewCandidate`: complete A, reopen to Draft; dispatch refused until MarkReady; RequestQA naming A is `stale_subject`/`subject_stale`; SubmitCandidate on Run A refused; human Evidence on an impersonated A subject is `stale_subject`; with only A Evidence B's completion is `done_gate_unsatisfied`/`evidence_missing`; with B's own Evidence B completes. Two CompletionRecords at distinct versions, none of A's Evidence joined to B's record, WorkItem detail lists both; after Store restart the reopen result replays by command lookup and history is unchanged | PASS |
| ROP-AC-04 | Gates, review and delivery below | See below |

Red (`b8c80cac`): all three oracles failed with 400 `operation is unsupported in v1`. Mutation (reverted): restoring the
unconditional Ready early return in `redispatchAllowed` lets the equal-clock dispatch succeed, failing ROP-AC-02.
One Green assertion was corrected to the accepted AC: RequestQA naming A after reopen is `stale_subject` (ROP-AC-03), not
the `lifecycle_rejected` the first test draft assumed.

## Gates

- Backend `scripts/check-backend.sh` (pins, mod verify, gofmt, vet, full tests, race, build), pinned Go image: exit 0 in
  617 s. Production sources equal the final head; the run started on `b8d6f462` and the test-only commit `5fd329d9`
  landed during it, so the service test binary may have used either test revision. The three oracles pass separately on
  `5fd329d9`, and the final-head PR CI is the source-bound full run.
- Web `scripts/check-web.sh` (format, lint, 30 tests, type-check/build): exit 0; web is unchanged.
- Redocly 2.51.2 lint: valid, no warnings. jsonschema (Draft 2020-12): `PASS 9 CommandSuccess ReopenWorkItem schema
  fixtures` — Ready and Draft results accepted; Developing phase, `subject_digest`, missing or 2001-character reason and
  an extra field rejected; `reason` on another operation still rejected and that operation otherwise unaffected.
- Existing domain, rework-loop, completion, detail and material-index suites run unmodified inside the full gate.

## Review

Independent Claude Code (claude-opus-5-5, read-only tools) code review of `b8d6f462`: **ACCEPT**, 119.8 s, reported
list price USD 1.162 (not billing); no blocker or major. Verified guard order, request-digest audit subject, no history
writes, operator-only `execute`, single `CreateRun` call site, result validator not loosened for other operations,
replay/lookup decoding, OpenAPI branch and docs consistency. Three minors:

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | ROP-AC-01 names QA but QA was not exercised | Adopted: injected QA added to the wrong-phase loop |
| 2 | Cross-project check posted `{}` | Adopted: a full valid ReopenWorkItem envelope to another project, unrecorded 404 |
| 3 | No named assertion that Ready-without-Runs dispatch is unchanged | Recorded limitation: existing unmodified tests (`TestCommand_IdempotencySameRequestAndConflict`, the rework and accepted-workflow fixtures) pin successful first dispatch from Ready; none pins its refusal order. A subtest attempt failed only because the in-memory fixture helper reuses one idempotency key, and was removed. The code path is the unchanged early return |

Aggregate provider requests, tool counts and active-vs-wait time were not instrumented (unknown).
