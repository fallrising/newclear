# Proposed rework loop: RequestRework, redispatch and current Candidate

Status: **Proposed; owner decision pending**. T-0339 / BOARD HRWK. Source `caad3c3a811456da767872aa6fc02d859955011c`.
This document is a reviewable contract proposal, revised after Claude review ([dispositions](../evidence/rework-loop-plan-20261101.md)).
It changes no production code, OpenAPI, accepted SDD, migration or dependency, and merging it does not approve
RWK-01..05 or run RWK-AC-01..05. The accepted-document amendments that approval would authorize are listed in RWK-05.

## Why this is the next bounded slice

Delivered M2 slices fix AC identity, immutable project policy, verified coverage and material discovery.
Comparing [remaining-work M2](remaining-work-20261029.md#m2--ac-identitypolicy-與目前有效證據h02successac-02)
with current source shows one gap that blocks both the remaining M2 Done acceptance and any M3 completion UI:
**a WorkItem cannot leave Review/QA except by Done, and cannot start a second Run.**

| Finding | Source | Consequence |
| --- | --- | --- |
| `RequestRework` is accepted but unimplemented | [SDD](../SDD.md) HAI-STATE-005; [domain-and-gates](../sdd/domain-and-gates.md) command table; `RequestReworkPayload` in [OpenAPI](../../api/openapi.yaml); domain `Transition` already guards Review/QA→Developing with a reason (workitem.go:209). No command, service or HTTP route exists | A `ChangesRequested` Review leaves the item permanently in Review |
| `DispatchRun` starts only from Ready | service.go:157 transitions Ready→Developing; Developing→Developing is `invalid_transition` (workitem.go:226) | A Failed Fake Run, or work returned by rework, can never be executed again |
| "Current Candidate" is implicit | Subject consumers select by the request's Candidate or Run; accepted-workflow `RunInput.SemanticallyEqual` ignores `ReadyVersion`, so an older Run stays input-current after a version change; `LoadCompletionMaterial` without a selector uses `QueryRow` without `ORDER BY` (store.go:478) | Once a WorkItem has two Candidates, an older Candidate could gather new Review/Evidence for the new item version and complete, defeating rework |
| v0.2 AC-02 and lawful HAI-DONE-004 are unreachable | [traceability](../traceability.md) AC-02 "Candidate B cannot use Candidate A evidence; history remains"; HAI-DONE-001..004 NotRun | M2 Done acceptance can only be shown with injected rows |

Canceled work is not a gap: CancelAcknowledged moves the WorkItem to terminal Canceled and domain-and-gates says
"no new dispatch". A Failed Run that also carries CancelRequested stays in Developing until a future FinalizeCancellation;
that existing limitation is retained, not decided here.

Not chosen: a full historical WorkItemDetail. It needs new immutable provenance for blocker/review/evidence/
approval/audit fields (see [material-index](work-item-material-index-20261101.md#full-detail-gaps-that-cannot-be-fabricated)),
which means a migration and a separate owner decision; it is not a prerequisite for the completion loop.
A Done-gate test matrix alone is also not chosen: without a lawful second Candidate it can only repeat existing
domain/injected coverage. ReopenWorkItem (Done→Draft/Ready), retry lineage, WIP/retry budgets, Question/Blocker
commands, nonpassing Evidence writers, Impact, UI and providers stay out of scope.

## Concrete contract (RWK-01..05)

### RWK-01 — RequestRework command

- Existing submitCommand route, operation `RequestRework`, `expected_version` 1..MaxInt64−1, payload exactly
  `work_item_id`, `subject_digest`, `reason` (closed; unknown fields 400). Reason: valid UTF-8, no NUL or control
  characters except tab/newline, 1..2000 code points and ≤8000 bytes, stored byte-exact. Existing session, Origin,
  project.write authorization, idempotency (same key+bytes replays; different bytes conflict) and result lookup apply.
- Guards, in order after authorization: WorkItem exists in project (masked 404); expected version matches
  (409 `version_conflict`; the domain `Transition` checks version first); phase is Review or QA (else 409
  `lifecycle_rejected`, reason `invalid_transition`); the current Candidate exists (RWK-03) and `subject_digest`
  equals its preparation subject (Review prospective version, QA current version), else 409 `stale_subject`.
  Active blockers do not prevent rework (blockers are orthogonal, HAI-DOMAIN-003).
- Effect in one transaction: phase Developing, version+1, result type `ReworkRequested`; audit and the canonical
  command record hold the reason and subject. No Review/Evidence/Approval/Candidate/Run/CompletionRecord row is
  inserted, updated or deleted (HAI-STATE-005, HAI-DONE-004). Their subject digests no longer match any new
  subject because the item version changed and RWK-03 makes their Candidate non-current; no verdict is rewritten.

### RWK-02 — DispatchRun from Developing (decision D2)

Recommended: `DispatchRun` additionally accepts phase Developing when the WorkItem already has at least one Run and
every Run of the item is **settled**: `observed_state` Succeeded|Failed, `reconciliation_state` None,
`side_effect_outcome` Confirmed, `desired_action` ≠ CancelRequested. Existing current-input, executor/scenario and
blocker guards also pass. Refusals: an active/unknown/NeedsReconcile/OutcomeUnknown Run keeps the existing
`active_or_unknown_run`; any other unsettled Run (for example CancelRequested+terminal) is 409 `lifecycle_rejected`.
No automatic dispatch or retry is introduced. The domain gains one guarded Developing→Developing redispatch
transition (version+1, explicit start required, no blockers), mirroring Ready→Developing; Ready→Developing behavior
and bytes are unchanged. `retry_of_run_id` stays unsupported (nonempty still rejected); the new Run is an
independent Run with `attempt` 1 and its own input envelope. Redispatching while a Succeeded Run has no Candidate
explicitly abandons that Run; it stays in history.

**Strict order:** DispatchRun refuses with 409 `lifecycle_rejected` (`retryable: true`) when the service clock's
`now.UnixNano()` is not greater than every existing `created_at_ns` of the item's Runs, so lawful Run history is
strictly ordered even with a wall clock that steps backwards. Like every recorded failure, the refusal is stored
under its idempotency key and replays unchanged; a later attempt uses a new `command_id` and `idempotency_key`.
Tests use a steppable deterministic clock.

**Check order** for DispatchRun: existing executor/scenario check, then phase (Ready, or Developing; any other phase
including Canceled → `lifecycle_rejected` / `invalid_transition`), active/unknown Run, settled predicate, strict order,
version/blocker transition guards, current input.

Alternative D2-b: also let `SubmitCandidate` reuse an older succeeded Run after rework. Not recommended:
rework then would not require new execution, and Candidate currency would need a second rule.

### RWK-03 — Current Candidate

The WorkItem's **latest Run** is the Run with the greatest `created_at_ns`, ties broken by `run_id` byte order
(ties occur only in injected rows given RWK-02's strict order). Its Candidate, if any, is the current Candidate.

- One new port/store read, "latest Run of item and its Candidate, if any", runs in the same transaction or snapshot
  as each consumer's existing subject checks. This is a port and store change with no schema change. RequestRework
  resolves its subject through it; every other consumer compares its selected Run with it. `LoadCompletionMaterial`
  without a Candidate/Run selector remains allowed only where the Candidate is irrelevant (DispatchRun's active-Run
  and phase checks). The rule is a separate predicate, not folded into `ActiveOrUnknownRun` (coverage clears that flag).
- `SubmitCandidate` accepts only the latest Run, and only if that Run has no Candidate (409 `lifecycle_rejected`
  otherwise). With RWK-02 this yields at most one Candidate per Run in lawful history.
- Consumers that treat a non-latest-Run Candidate as stale: RequestQA, fixture Review and Evidence publication,
  ApproveSubject, human report submission, CompleteWorkItem (snapshot and transaction), RequestRework → 409
  `stale_subject` with reason `subject_stale` and no writes; completion preparation and verified coverage → their
  existing stale classification. Run-output, artifact, human-report and material-index history reads, and
  RequestCancellation (already refused for terminal Runs), are unchanged.
- Existing single-Run histories are unaffected. The injected two-Run fixture in verified_coverage_test.go
  (`another-run`, same timestamp) must stay green without modification.

### RWK-04 — Completion consequences (HAI-DONE-002/004, v0.2 AC-01/02/04)

After Candidate A receives `ChangesRequested`, rework, Run 2 and Candidate B:

- Any command naming A or Run 1 → 409 `stale_subject` / `subject_stale`, no domain writes.
- B in Review: CompleteWorkItem → `done_gate_unsatisfied` including `phase_not_qa`; RequestQA needs B's own approving Review.
- B in QA with B's approving Review and, where the project policy requires it, B's Approval, but only A-bound
  Evidence → `done_gate_unsatisfied` with exactly `evidence_missing` (the test asserts the full reason set).
- Producer or self verifier on B → existing refusal (fixture `permission_denied`, human report denial) with no domain writes.
- After B's own independent human Review and Evidence, explicit completion succeeds; its CompletionRecord joins only
  B's material. A's Review/Evidence keep their original verdicts and remain readable through existing history reads.

### RWK-05 — Boundaries and authorized document amendments

If D1/D2 are approved, the implementation PR also amends accepted documents to match: the domain-and-gates
DispatchRun row (Ready **or** settled Developing), an SDD §5 clause for Developing redispatch, a definition of
"current Candidate" next to Done predicate term 2, a normative mini-SDD for this slice, and OpenAPI descriptions for
the RequestRework guards/result and DispatchRun from Developing, plus `expected_version` 1..MaxInt64−1 in the
RequestRework branch. The domain-and-gates RequestRework row is aligned to "reason and exact
current-Candidate subject → version+1 + Developing", and HAI-STATE-005 gains one sentence: inapplicability of
non-current material is computed (subject mismatch or non-current Candidate), never stored. No new route or schema, migration, dependency, UI, provider, ReopenWorkItem, retry lineage,
budgets, release or deploy. Missing-policy/corruption precedence and all existing command, read and fence guards are unchanged.

"No writes" / "no domain writes" in this document means no domain or history row is inserted, updated or deleted.
Recordable refusals keep the existing behavior of storing exactly one failure command result and idempotency
record; oracles snapshot every other table and assert those two rows exactly.

## Fixed acceptance (RWK-AC-01..05)

| AC | Observable outcome / named oracle | Status |
| --- | --- | --- |
| RWK-AC-01 | `TestRequestRework_GuardsAndHistory`: Review and QA rework with exact subject → Developing, version+1, reason stored; wrong phase, version, subject, non-current Candidate, missing/oversized/invalid reason, unknown field, cross-project, replay and idempotency conflict; no domain writes on refusal; prior Review/Evidence/Approval rows byte-identical | NotRun |
| RWK-AC-02 | `TestDispatchRun_RedispatchFromDeveloping`: after rework and after a Failed Run a new Run dispatches once; Succeeded-without-Candidate abandonment; Ready path unchanged; unknown/active/NeedsReconcile/CancelRequested+terminal Run, Canceled item, blocker, stale input, nonempty retry_of_run_id and equal or regressed clock refused with the codes above and no domain writes; clock refusal replays under the same key and a new key succeeds after the clock advances | NotRun |
| RWK-AC-03 | `TestCurrentCandidate_LatestRunOnly`: an older-Run Candidate is stale for every RWK-03 consumer; SubmitCandidate on an older Run or a second Candidate refused; history reads return both; existing two-Run coverage fixture unchanged and green | NotRun |
| RWK-AC-04 | `TestReworkLoop_CandidateBCannotUseCandidateAEvidence` (real SQLite/Fake/HTTP): every RWK-04 step with exact codes and `details.reasons`, including missing one of two required ACs and producer/self verifier refusal; explicit completion of B succeeds; restart preserves all history and replay results | NotRun |
| RWK-AC-05 | Pinned backend full/race/vet/build, web gate, pinned OpenAPI lint, contracts/index/links; Claude code review dispositions; exact-head CI, normal merge, remote readback, BOARD/desk/handoff | NotRun |

Traceability after delivery would move only executed lawful cases (HAI-STATE-005, HAI-DONE-002/004 subset,
v0.2 AC-01/02/04 lawful boundary). Failing/Inconclusive/Error/Skipped/NotRun/Unknown Evidence (v0.2 AC-05) stays
domain-only: no lawful writer emits nonpassing Evidence (fixture Evidence must be Passing, human Evidence is stored
Passed). AC-03/29/30/47/48 need accepted-input or policy change over time, which only Impact activation (M4) can
produce under immutable project policy; AC-06 Missing/Quarantined is M6. Full M2, full detail/history, completion UI
and SUCCESS AC-02..04 stay incomplete.

## Decisions requested

- **D1**: approve RWK-01..05 and fixed RWK-AC-01..05 as the next backend slice (recommended), or defer.
- **D2**: redispatch semantics — recommended RWK-02/RWK-03 (new Run from Developing only when every Run is settled;
  strictly ordered Runs; only the latest Run's single Candidate is current), or D2-b.

Not asked again: policy, coverage, material-index decisions and Git delivery authorization.

## Limits

Planning: root 45–75 active minutes, 20-minute checkpoints; one Claude Code exact claude-opus-5-5/high
read-only review of 600 s plus at most one follow-up on actual revisions. If approved, implementation 120–180
active minutes, same review bounds for code, CI 20-minute rounds, same failure initial plus two new-hypothesis
diagnoses. Provider requests, tokens, billing and aggregate tool counts are unknown/null unless measured.
