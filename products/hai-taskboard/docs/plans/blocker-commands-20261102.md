# Proposed AddBlocker / ResolveBlocker commands

Status: **Proposed, awaiting owner D1/D2.** T-0339 / BOARD HBLKP. Proposal source `0c5177fd`. Claude plan review
REWORK (2 blocker, 1 major, 4 minor) is disposed in this revision; see
[plan review evidence](../evidence/blocker-commands-plan-20261102.md). Nothing here changes behavior until the owner
approves it and a normative entry is written.

## Why this is the next bounded slice

Delivered slices made the WorkItem lifecycle complete (rework, reopen, second completion). Blockers are enforced on
that lifecycle but cannot be created or cleared through any product command.

| Finding | Source | Consequence |
| --- | --- | --- |
| Blockers are enforced | domain `transitionRejection` (Ready→Developing and Developing redispatch → `active_blocker`); `EvaluateCompletionEligibility` (`active_blocker`, SDD Done predicate term 1 "unblocked"); board `Blocked` lane and `active_blocker_count` (persisted.go); detail `blockers` with `resolved_at` (work_item_detail.go); material-index active-blocker count/byte preflight | A blocked item is correctly stuck |
| No command reaches them | `AddBlocker` and `ResolveBlocker` are in the OpenAPI operation enum with `AddBlockerPayload` / `ResolveBlockerPayload`, and SDD §8 lists "add/remove blocker" in the minimum command surface. Domain `AddBlocker`/`RemoveBlocker` and the non-transactional `Store.AddBlocker`/`ResolveBlocker` exist (exercised only by store tests), but there is no command type, canonicalizer, service, `port.Transaction` method, result validator or HTTP branch. Service-level blocker tests insert rows with raw SQL (rework_loop_test.go, verified_coverage_test.go) | An operator cannot record "waiting on X" or clear it; HAI-DOMAIN-003 and v0.2 AC-18 have no reachable command path |
| Declared payload exceeds storage | `Blocker` schema requires `kind`, `required_input`, `resolver_id`, client `created_at`, optional `due_at`; `ResolveBlockerPayload` requires `resolution_ref`. `work_item_blockers` stores only `blocker_id`, `reason`, `resolved_at_ns` | The declared shape would accept fields that are dropped, or need a migration |
| The detail reader is stricter than the domain | detail treats a blocker as corrupt unless `blocker_id` is 1..80 bytes and `reason` 1..2000 bytes of valid UTF-8 with no control characters (tab and newline included); detail caps at 1024 rows, material index at 1024 active rows and 2 MiB active bytes. Domain `AddBlocker` checks only non-empty and silently replaces an existing active id | A write path built on the domain check alone could make detail return `storage_corruption` |
| Blocker commands change the completion subject | The subject digest includes `work_item_version` (subject.go); QA uses the live version, Review version+1 (`preparationSubject`). Any version bump in Review/QA makes every bound Review/Evidence/Approval stale; the only way back is RequestRework. SubmitCandidate and RequestQA do not check blockers (only dispatch and completion do), so a blocker added in Developing can reach QA | Resolving or adding a blocker in Review/QA forces re-verification (D2) |
| Done items must keep their version | `loadDone` requires a CompletionRecord at the current version; any version bump on a Done item makes it unloadable | No blocker command may mutate a Done item |

Not chosen: M3 completion UI (needs owner approval as UI), Done validity / `effective_satisfied` (needs M4), M4 Impact
activation (migration contract), M5a checkpoint resume (larger; executor and restart), Question/Decision (HAI-DEC,
Proposed; this slice is its prerequisite because HAI-DEC-002 adds and clears blockers).

## Concrete contract (BLK-01..04)

### BLK-01 — AddBlocker

- Existing submitCommand route, operation `AddBlocker`, `expected_version` 1..MaxInt64−1. Payload flattened and
  narrowed to stored fields: closed `work_item_id`, `blocker_id`, `reason`. `blocker_id`: 1..80 bytes, valid UTF-8, no
  control characters. `reason`: 1..2000 bytes, valid UTF-8, no control characters (stricter than rework reasons
  because the detail reader rejects tab and newline). Stored byte-exact.
- Only the authenticated operator session reaches it (session, Origin, project.write, idempotency and result lookup as
  for every command). No executor, fixture or worker path is added.
- Guards in order after authorization: WorkItem exists in project (masked 404); expected version (409
  `version_conflict`); phase allowed by D2 (else 422 `lifecycle_rejected` / `invalid_transition`); `blocker_id` never
  used on this WorkItem, active or resolved (422 `lifecycle_rejected` / `blocker_exists`; the primary key
  `(project_id, work_item_id, blocker_id)` already forbids reuse); capacity: total blocker rows before insert < 1024 and
  active `blocker_id`+`reason` bytes after insert ≤ 2 MiB (422 `lifecycle_rejected` / `blocker_capacity`).
- Effect in one transaction: insert the active row, phase unchanged, version+1. Result `BlockerAdded`
  (`project_id`, `work_item_id`, `version`, `phase`, `blocker_id`, `reason`). Audit/change-event subject is the
  canonical request digest (as ReopenWorkItem). A blocker does not stop an active Run; it blocks the next dispatch and
  completion (HAI-EXEC-008: no automatic stop or restart).

### BLK-02 — ResolveBlocker

- Operation `ResolveBlocker`, same metadata bounds; closed payload `work_item_id`, `blocker_id`, `resolution_ref`
  (1..200 bytes, valid UTF-8, no control characters; stored byte-exact in the result only).
- Guards in order: masked 404 for a missing WorkItem; `version_conflict`; phase Done → 422 `lifecycle_rejected` /
  `invalid_transition` (a Done item cannot hold an active blocker and must keep its version); unknown `blocker_id` on
  this WorkItem → 404 `not_found` (not recordable, as the masked-404 precedent); already resolved → 422
  `lifecycle_rejected` / `blocker_not_active`. Draft, Ready, Developing, Review, QA and Canceled are allowed; Canceled
  so a blocked canceled card can leave the Blocked lane.
- Effect in one transaction: set `resolved_at_ns` to the command clock, phase unchanged, version+1, every other
  blocker unchanged (HAI-DOMAIN-003). Result `BlockerResolved` (`project_id`, `work_item_id`, `version`, `phase`,
  `blocker_id`, `resolution_ref`). Resolving does not dispatch, resume or complete anything. In Review/QA it makes the
  bound completion subject stale (see D2); recovery is RequestRework and new material.

### BLK-03 — Seams

- Domain `AddBlocker` rejects an id that is already active (today it overwrites).
- The transactional port gains `AddBlocker`/`ResolveBlocker` (same SQLite transaction as the command result, CAS on
  version). The resolve method reads the row including `resolved_at_ns` to tell unknown from already resolved. The
  existing non-transactional Store methods and their tests stay.
- Command result codec: `validOperation` lists both operations so `DecodeResultOwner` (used by detail audit
  attribution) accepts them; `validSuccessResult` allows `blocker_id` with `reason` for `AddBlocker` and `blocker_id`
  with `resolution_ref` for `ResolveBlocker`, and forbids both fields for every other operation;
  `validRejectionCode` gains `blocker_exists`, `blocker_not_active` and `blocker_capacity` so refusals are recordable.
- Command type, canonicalizer, `Service.AddBlocker`/`ResolveBlocker`, HTTP branches in the command dispatcher.
- Board, detail and material-index readers are unchanged; they already read `work_item_blockers`. The bounds above
  exclude corruption only. Detail capacity stays a shared, typed limit (4 MiB wire, 1024 audit entries, 1024 blocker
  rows); reaching it returns the existing capacity response, never corruption.

### BLK-04 — Boundaries and authorized document amendments

New normative entry `docs/sdd/blocker-commands.md`; amend the domain-and-gates command table with `AddBlocker` /
`ResolveBlocker` rows, and `docs/sdd/work-item-detail.md` where it says the `Blocker` payload schema is unchanged.
Public OpenAPI amendments: `AddBlockerPayload` becomes flat `work_item_id`, `blocker_id`, `reason` with the bounds above;
the unused `Blocker` schema is removed (`kind`, `required_input`, `resolver_id`, `due_at` are deferred and would need a
migration); `ResolveBlockerPayload` gains the `resolution_ref` character rule; `expected_version` 1..MaxInt64−1 on both
request branches; new closed `BlockerAddedResult` and `BlockerResolvedResult` with matching `CommandSuccess`
branches, other operations forbid `blocker_id` and `resolution_ref` in results; the three new reason codes wherever
OpenAPI enumerates rejection reasons. No web client, test or code consumes the removed shape. No migration,
dependency, UI, Attention endpoint (`getProjectAttention` stays unimplemented), Question/Decision, executor-raised
blocker, due-date expiry, provider, release or deploy.

## Fixed acceptance (BLK-AC-01..04)

Written for the recommended D2-a; under D2-b, BLK-AC-01 also accepts Review/QA and BLK-AC-03 adds a blocker in QA.

| AC | Observable outcome / named oracle | Status |
| --- | --- | --- |
| BLK-AC-01 | `TestAddBlocker_GuardsAndHistory`: add in Draft/Ready/Developing → version+1, phase unchanged, closed `BlockerAdded` result with byte-exact reason, identical on replay; Review, QA, Done and Canceled refused (`invalid_transition`); duplicate active id and resolved id refused (`blocker_exists`); the 1025th row and the byte cap refused (`blocker_capacity`); invalid id/reason (empty, 81/2001 bytes, invalid UTF-8, tab, newline), unknown field, wrong version, cross-project masked 404, idempotency conflict; recordable refusals change no domain rows | NotRun |
| BLK-AC-02 | `TestResolveBlocker_GuardsAndHistory`: resolve sets `resolved_at` from the command clock, version+1, phase unchanged, closed `BlockerResolved` result with byte-exact `resolution_ref`, identical on replay; unknown id 404, resolved id `blocker_not_active`, wrong version, invalid `resolution_ref`; allowed on Canceled; Done refused with no row changed | NotRun |
| BLK-AC-03 | `TestBlockers_ResolveOneOfTwoKeepsBlocked` (v0.2 AC-18; real SQLite/Fake/HTTP): two blockers on a Ready item → `Blocked` lane, DispatchRun `active_blocker`; resolve one → still Blocked, phase Ready, count 1, dispatch refused; resolve the other → dispatch succeeds. A blocker added in Developing during the Run survives SubmitCandidate and RequestQA (neither checks blockers today; unchanged); in QA CompleteWorkItem is refused with `active_blocker`; resolving it in QA makes the bound subject stale (`stale_subject` for the old subject), and RequestRework → new Run → new material completes. Detail returns 200 with both rows' `resolved_at` and every blocker audit entry attributed; restart preserves rows and replay | NotRun |
| BLK-AC-04 | Pinned backend full/race/vet/build with no existing test modified, web gate, pinned Redocly lint including the new result branches, contracts/index/links; Claude code review dispositions; exact-head CI, normal merge, remote readback, BOARD/desk/handoff | NotRun |

Traceability after delivery would move HAI-DOMAIN-003 and v0.2 AC-18 to passing for the command path; AC-17
(Question response) stays NotRun until HAI-DEC.

## Decisions requested

- **D1:** Approve BLK-01..04 and BLK-AC-01..04 as the next backend slice, including the public OpenAPI amendment that
  flattens and narrows `AddBlockerPayload` to stored fields and adds the two result schemas.
- **D2:** Phases where AddBlocker is allowed.
  - **D2-a (recommended):** Draft, Ready, Developing only. An item already in Review/QA that must be blocked goes
    through RequestRework first, so invalidating collected Review/Evidence/Approval is always an explicit, reasoned
    command. ResolveBlocker stays allowed in Review/QA for blockers carried from Developing, with the stated
    stale-subject consequence.
  - **D2-b:** also Review and QA. Adding there immediately stales the bound subject; recovery is RequestRework.

## Limits

This proposal changes no behavior. Completion UI (M3), Done validity, whole-M2, Question/Decision and SUCCESS
AC-02..04 remain open after this slice.
