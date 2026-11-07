# ReopenWorkItem and dispatch from Ready with Run history

Status: Accepted by owner, 2026-11-02 (D1). T-0339 / HROP. Implements HAI-STATE-008 and the domain-and-gates
`ReopenWorkItem` row; extends the [rework loop](rework-loop.md) RWK-02 dispatch guards to Ready.

The owner approved the [Claude-reviewed proposal](../plans/reopen-work-item-20261102.md). Its ROP-01..04 clauses and
fixed ROP-AC-01..04 are the implementation acceptance criteria; this entry records the normative rules and seams.

## Rules

- **ROP-01 ReopenWorkItem.** submitCommand operation `ReopenWorkItem`, `expected_version` 1..MaxInt64−1, closed
  payload `work_item_id`, `target_phase` (`Draft`|`Ready`), `reason` (RequestRework rules: valid UTF-8, 1..2000 code
  points, ≤8000 bytes, no NUL or control characters except tab and newline, stored byte-exact). Only the
  authenticated operator session reaches it. After session, Origin and project.write: masked 404 for a missing item;
  `version_conflict`; phase not Done → `lifecycle_rejected`/`invalid_transition`; for target Ready, the current
  inputs resolve as for MarkReady (`currentRunInput` with the first declared scenario) or the existing input
  classification is returned. Blockers do not prevent reopening. Success: phase `target_phase`, version+1, result
  `WorkItemReopened` carrying `reason`; the audit subject is the canonical request digest. No CompletionRecord,
  approval consumption, Review, Evidence, Approval, Candidate or Run row changes.
- **ROP-02 dispatch from Ready with Run history.** `redispatchAllowed` returns early only for Ready with zero Runs.
  Otherwise one order applies to Ready and Developing: version → phase (Ready or Developing) → Developing needs a Run →
  every Run settled → clock strictly after the latest Run `created_at_ns` (retryable) → domain transition → current
  input. Ready with no Runs is byte-for-byte unchanged.
- **ROP-03 second completion.** The existing Done predicate applies unchanged. The new subject carries the new version
  and the latest Run's Candidate, so only new material satisfies it; completion inserts a second CompletionRecord at
  the higher `result_work_item_version`. Earlier records, joins and consumptions stay readable through WorkItem detail.

HTTP status follows the existing mapping: `version_conflict` and `idempotency_conflict` 409; `lifecycle_rejected` 422;
malformed payloads 400; unknown items masked 404. Recordable refusals store one failure result and idempotency record.

## Seams

`command.ReopenWorkItem` and `CanonicalReopenWorkItem` (reusing `ValidReworkReason`); `validSuccessResult` allows
`reason` for `ReopenWorkItem` with phase Draft|Ready and no `subject_digest`; `Service.ReopenWorkItem`; the HTTP
`ReopenWorkItem` branch in the completion command dispatcher. The domain `Transition` already guards Done→Draft/Ready.
OpenAPI: `ReopenWorkItemPayload` description, request `expected_version` bounds, `WorkItemReopenedResult` and its
`CommandSuccess` branch. No schema, migration or dependency.

Oracles: `TestReopenWorkItem_GuardsAndHistory`, `TestDispatchRun_FromReadyWithRunHistory`,
`TestReopen_SecondCompletionUsesOnlyNewCandidate`; ROP-AC-04 is the gate/review/delivery receipt.
