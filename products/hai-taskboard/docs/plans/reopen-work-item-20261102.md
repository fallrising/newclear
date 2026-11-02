# Proposed ReopenWorkItem: leaving Done without losing history

Status: **Proposed, awaiting Claude plan review and owner D1**. T-0339 / BOARD HROPP. Proposal source `973f2e2a`.
No behavior changes until D1 is approved and a normative entry is added.

## Why this is the next bounded slice

Delivered M2 slices fix AC identity, policy, verified coverage, material discovery, the rework loop and the truthful
WorkItem detail. One accepted lifecycle command is still missing: **a Done WorkItem can never move again.**

| Finding | Source | Consequence |
| --- | --- | --- |
| `ReopenWorkItem` is accepted but unimplemented | [domain-and-gates](../sdd/domain-and-gates.md) command table ("human, reason and new work revision → Draft or Ready; old completion retained"); `ReopenWorkItemPayload` and the `ReopenWorkItem` operation in [OpenAPI](../../api/openapi.yaml); [executor-and-security](../sdd/executor-and-security.md) "Approve/complete/reopen: human-only". The pure domain transition exists (workitem.go Done→Draft/Ready with `ReopenReason`, `TestWorkItemTransitions_Table`, `TestCompleteWorkItem_PreservesHistoryOnReopenAndStale`). No command type, canonicalizer, service, result validator or HTTP branch exists; M0 recorded it as "No durable reopen command" | Done is a dead end. SDD §5 says a Done item's phase "remains Done until a new explicit transition starts rework"; no such transition can be submitted |
| Ready dispatch assumes no Run history | service.go `redispatchAllowed` returns early for Ready; the settled and strict-clock guards (HAI-STATE-007, [rework loop](../sdd/rework-loop.md) RWK-02) apply only in Developing | After a reopen to Ready the item has Runs. Without the guard a new Run could be created with `created_at_ns` not after the latest Run, which breaks the RWK-03 "latest Run" order that every subject consumer relies on |
| Storage already permits a second completion | completion_records `UNIQUE(project_id, work_item_id, result_work_item_version)`; trigger `work_items_done_requires_completion` fires only when the new phase is Done; `loadDone` reads the record for the current version only; approval consumption is unique per approval | Reopen needs no migration: version+1 makes the next CompletionRecord distinct, and the old one stays readable through detail |

Also confirmed: every subject consumer (`preparationSubject`) requires phase Review or QA, so in Draft/Ready the old
Candidate cannot gather Review/Evidence/Approval or complete; after the next DispatchRun it is non-current by RWK-03.
`AcceptInitialSpecification` refuses a project that already has an accepted specification, so a reopened Draft item
can only return to Ready through `MarkReady` on its existing accepted inputs until M4 Impact activation exists.

Not chosen: M3 completion UI (needs owner approval as UI work, and a complete lifecycle first), Done validity /
`effective_satisfied` (needs a separate projection contract and is only meaningful once accepted inputs can change,
which is M4), M4 Impact activation (needs a migration contract), M5a checkpoint resume (independent; can follow).

## Concrete contract (ROP-01..04)

### ROP-01 — ReopenWorkItem command

- Existing submitCommand route, operation `ReopenWorkItem`, `expected_version` 1..MaxInt64−1, closed payload
  `work_item_id`, `target_phase` (`Draft` or `Ready`), `reason`. The reason uses the RequestRework validator
  (`ValidReworkReason`: valid UTF-8, 1..2000 code points, ≤8000 bytes, no NUL/controls except tab and newline),
  stored byte-exact. Existing session, Origin, project.write authorization, idempotency and result lookup apply.
  The command is only reachable through the authenticated operator session, which satisfies "human-only";
  no executor or fixture path is added.
- Guards, in order after authorization: WorkItem exists in project (masked 404); expected version matches
  (409 `version_conflict`); phase is Done (else 422 `lifecycle_rejected` / `invalid_transition`). For
  `target_phase: Ready` only, the current accepted inputs must still resolve exactly as `MarkReady` requires
  (`currentRunInput`; existing classifications for missing policy, stale input and corruption). Blockers do not
  prevent reopening (HAI-DOMAIN-003); they still block the next DispatchRun.
- Effect in one transaction: phase `target_phase`, version+1, result type `WorkItemReopened` whose stored command
  result carries `reason` byte-exact (the immutable result is the durable record, as for `ReworkRequested`).
  No CompletionRecord, Review, Evidence, Approval, approval consumption, Candidate or Run row is inserted, updated
  or deleted. Recordable refusals store exactly one failure result and idempotency record, as for every command.

"New work revision" in the domain-and-gates row is the version increment; no separate revision entity is added.

### ROP-02 — DispatchRun from Ready with Run history

When the WorkItem is Ready and has at least one Run, DispatchRun applies the RWK-02 guards: every Run settled
(else 422 `lifecycle_rejected`) and the service clock strictly after the latest Run `created_at_ns` (else 422
`lifecycle_rejected`, `retryable: true`). Ready with no Run history keeps today's bytes and order. The new Run is
independent (`attempt` 1, `retry_of_run_id` still unsupported). Check order: executor/scenario/retry check;
active/unknown Run; for Ready-with-history the settled then clock checks; the domain transition (version, blockers,
explicit start); current input.

### ROP-03 — Second completion

After reopen → (MarkReady) → DispatchRun → Candidate B → Review → QA, the existing Done predicate applies unchanged.
Only B's own Review/Evidence/Approval satisfy it, because the new subject carries a new version and B is the latest
Run's Candidate. Explicit completion creates a second CompletionRecord with a higher `result_work_item_version`;
the first keeps its subject, joins and approval consumptions and both appear in WorkItem detail. Load of the Done item
reads the record of the current version only (unchanged).

### ROP-04 — Boundaries and authorized document amendments

Add `docs/sdd/reopen-work-item.md` as the normative entry; amend the domain-and-gates `ReopenWorkItem` and
`DispatchRun` rows, SDD §5 with one HAI-STATE clause for Done → Draft/Ready, and OpenAPI descriptions plus
`expected_version` 1..MaxInt64−1 in the `ReopenWorkItem` branch. No new route, schema, migration, dependency, UI,
provider, Done-Stale / `effective_satisfied` projection, Impact, release or deploy. Board, detail, material-index,
coverage and preparation reads are unchanged; they already read phase and history from storage.

## Fixed acceptance (ROP-AC-01..05)

| AC | Observable outcome / named oracle | Status |
| --- | --- | --- |
| ROP-AC-01 | `TestReopenWorkItem_GuardsAndHistory`: Done → Ready and Done → Draft with a reason → version+1, stored reason; wrong phase (Ready/QA/Canceled), wrong version, invalid target, missing/oversized/control-character reason, unknown field, cross-project masked 404, replay and idempotency conflict; refusals change no domain rows; CompletionRecord, its joins and approval consumptions byte-identical after success | NotRun |
| ROP-AC-02 | `TestDispatchRun_FromReadyWithRunHistory`: after reopen to Ready a new Run dispatches once; equal or regressed clock refused (retryable, replays under the same key, new key succeeds after the clock advances); blocker refused; Ready without Runs unchanged | NotRun |
| ROP-AC-03 | `TestReopen_SecondCompletionUsesOnlyNewCandidate` (real SQLite/Fake/HTTP): complete A, reopen, dispatch, Candidate B; A-bound Review/Evidence/Approval do not satisfy B (`subject_stale` for A-named commands; `evidence_missing` in QA with only A evidence); B's own independent material completes; two CompletionRecords with distinct versions in detail; Draft target requires MarkReady before dispatch; restart preserves history and replay | NotRun |
| ROP-AC-04 | Existing domain transition tests, rework-loop, completion, detail and material-index suites pass unchanged | NotRun |
| ROP-AC-05 | Pinned backend full/race/vet/build, web gate, pinned Redocly lint, contracts/index/links; Claude code review dispositions; exact-head CI, normal merge, remote readback, BOARD/desk/handoff | NotRun |

Traceability after delivery would move only the HAI-STATE reopen subset and the `ReopenWorkItem` row; HAI-DONE stays
partially NotRun, and Done-Stale (`TestDoneStale_PreservesCompletionAndBlocksDownstreamReadiness`) stays M4.

## Decision requested

- **D1:** Approve ROP-01..04 and ROP-AC-01..05 as the next backend slice: implement ReopenWorkItem as above,
  with Ready-target input validation, and extend the settled/strict-clock dispatch guard to Ready items with Run history.

## Limits

This proposal changes no behavior. Completion UI (M3), Done validity, whole-M2 acceptance and SUCCESS AC-02..04
remain open after this slice.
