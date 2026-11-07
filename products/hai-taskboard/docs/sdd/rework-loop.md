# Rework loop: RequestRework, redispatch and current Candidate

Status: Accepted by owner, 2026-11-01 (D1 and recommended D2). T-0339 / HRWK. Refines HAI-STATE-005/007,
HAI-DONE-002/004 and Done predicate term 2.

The owner approved the [Claude-reviewed proposal](../plans/rework-loop-20261101.md). Its RWK-01..05 clauses and
fixed RWK-AC-01..05 are the implementation acceptance criteria; this entry records the normative rules and seams.

## Rules

- **RWK-01 RequestRework.** submitCommand operation `RequestRework`, `expected_version` 1..MaxInt64−1, closed
  payload `work_item_id`, `subject_digest`, `reason`. Reason is valid UTF-8, 1..2000 code points, ≤8000 bytes,
  no NUL or control characters except tab and newline, stored byte-exact. After the existing session, Origin and
  project.write checks: masked 404 for a missing item; `version_conflict`; phase not Review/QA →
  `lifecycle_rejected`/`invalid_transition`; no current Candidate or `subject_digest` different from its preparation
  subject → `stale_subject`/`subject_stale`. Blockers do not prevent rework. Success: phase Developing, version+1,
  result `ReworkRequested` whose stored command result also carries `reason` (byte-exact) and `subject_digest`;
  that immutable command result is the durable record, replayed by idempotency and command lookup. No Review,
  Evidence, Approval, Candidate, Run or CompletionRecord row changes.
- **RWK-02 redispatch.** DispatchRun from Developing requires at least one Run and every Run settled:
  `observed_state` Succeeded|Failed, `reconciliation_state` None, `side_effect_outcome` Confirmed, `desired_action`
  not CancelRequested. Check order: existing executor/scenario/retry check; active or unknown Run →
  `active_or_unknown_run`; outside Ready, `version_conflict` first, then any phase other than Developing (including
  Review/QA and Canceled) → `invalid_transition`; in Developing, no Run or an unsettled Run → `lifecycle_rejected`,
  then a service clock not strictly after every existing Run `created_at_ns` → `lifecycle_rejected` with
  `retryable: true`; then the domain transition (blockers → `active_blocker`, explicit start); then current input. Ready→Developing is unchanged. The new Run is independent (`attempt` 1, no retry lineage).
  Recordable refusals replay under the same idempotency key; a later attempt uses a new key.
- **RWK-03 current Candidate.** The latest Run is the Run with greatest `created_at_ns`, ties by `run_id` byte order.
  Its Candidate is current. SubmitCandidate accepts only the latest Run without a Candidate. Every subject consumer
  (RequestQA, fixture Review/Evidence, ApproveSubject, human reports, CompleteWorkItem, RequestRework, completion
  preparation, verified coverage) treats a Candidate of any other Run as stale. History reads are unchanged.
- **RWK-04.** After rework, A-named commands are stale; B's completion needs B-bound Review, Evidence and, where
  required, Approval. A's records keep their verdicts. CompleteWorkItem while B is in Review is `stale_subject`
  (the preparation subject is prospective, version+1, so the existing gate reports `subject_stale` with
  `phase_not_qa`); in QA with only A-bound Evidence it is `done_gate_unsatisfied` with exactly `evidence_missing`.

HTTP status follows the existing command mapping: `version_conflict`, `stale_subject` and `idempotency_conflict`
are 409; `lifecycle_rejected` and `done_gate_unsatisfied` are 422; malformed payloads are 400 and unknown items
masked 404. Human-report refusals occur before command bookkeeping, as for every existing human report.

"No domain writes" means no domain or history row changes; recordable refusals still store exactly one failure
result and idempotency record, as for every existing command.

## Seams

`port.CompletionMaterial.Runs` (latest Run identity/time, whether it has a Candidate, count, all-settled flag) is
loaded by the SQLite `LoadCompletionMaterial` in the same transaction as the rest of the material; no schema, index
or migration change. Only DispatchRun, SubmitCandidate (Run selector) and RequestRework read material without a
Candidate selector, and they use only `Runs`. The service compares the selected Run with `Runs.LatestRunID` in
`currentCompletionMaterial` and in the preparation reader, so every subject consumer shares one check. The domain
adds one guarded Developing→Developing transition. HTTP adds the `RequestRework` command branch.

Oracles: `TestRequestRework_GuardsAndHistory`, `TestDispatchRun_RedispatchFromDeveloping`,
`TestCurrentCandidate_LatestRunOnly`, `TestReworkLoop_CandidateBCannotUseCandidateAEvidence`; RWK-AC-05 is the
gate/review/delivery receipt. Results: [implementation evidence](../evidence/rework-loop-20261101.md).
