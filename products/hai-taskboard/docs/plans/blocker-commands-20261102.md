# Proposed AddBlocker / ResolveBlocker commands

Status: **Proposed, awaiting Claude plan review and owner D1.** T-0339 / BOARD HBLKP. Proposal source `0c5177fd`.
Nothing here changes behavior until the owner approves it and a normative entry is written.

## Why this is the next bounded slice

Delivered slices made the WorkItem lifecycle complete (rework, reopen, second completion). Blockers are enforced on
that lifecycle but can never be created or cleared through the product.

| Finding | Source | Consequence |
| --- | --- | --- |
| Blockers are enforced | domain `transitionRejection` (Ready→Developing and Developing redispatch → `active_blocker`); `EvaluateCompletionEligibility` (`active_blocker`, SDD Done predicate term 1 "unblocked"); board `Blocked` lane and `active_blocker_count` (persisted.go); detail `blockers` with `resolved_at` (work_item_detail.go); material-index blocker preflight | A blocked item is correctly stuck |
| No command reaches them | `AddBlocker` and `ResolveBlocker` are in the OpenAPI operation enum with `AddBlockerPayload` / `ResolveBlockerPayload`, and SDD §8 lists "add/remove blocker" in the minimum command surface. Domain `AddBlocker`/`RemoveBlocker` and non-transactional `Store.AddBlocker`/`ResolveBlocker` exist, but there is no command type, canonicalizer, service, `port.Transaction` method, result validator or HTTP branch. Every blocker test today inserts rows with raw SQL (rework_loop_test.go, verified_coverage_test.go) | An operator cannot record "waiting on X" or clear it; HAI-DOMAIN-003 and v0.2 AC-18 have no reachable path |
| Declared payload exceeds storage | `Blocker` schema requires `kind`, `required_input`, `resolver_id`, client `created_at`, optional `due_at`; `ResolveBlockerPayload` requires `resolution_ref`. `work_item_blockers` stores only `blocker_id`, `reason`, `resolved_at_ns` | Implementing the declared shape as-is would accept fields that are dropped or need a migration |
| Readers are stricter than the domain | detail and material-index readers treat a blocker as corrupt unless `blocker_id` is 1..80 bytes and `reason` 1..2000 bytes of valid UTF-8 with no control characters (tab and newline included), and cap detail at 1024 blocker rows and active blocker bytes at 2 MiB. Domain `AddBlocker` checks only non-empty, and silently replaces an existing active id | A write path built on the domain check alone could make detail return `storage_corruption` or capacity errors |

Not chosen: M3 completion UI (needs owner approval as UI), Done validity / `effective_satisfied` (needs M4), M4 Impact
activation (migration contract), M5a checkpoint resume (larger; touches executor and restart), Question/Decision
(HAI-DEC, Proposed design; this slice is its prerequisite because HAI-DEC-002 adds and clears blockers).

## Concrete contract (BLK-01..04)

### BLK-01 — AddBlocker

- Existing submitCommand route, operation `AddBlocker`, `expected_version` 1..MaxInt64−1. Payload narrowed to what
  storage holds (D1 includes this amendment): closed `work_item_id`, `blocker_id`, `reason`. `blocker_id` follows the
  detail reader: 1..80 bytes, valid UTF-8, no control characters. `reason`: 1..2000 bytes, valid UTF-8, no control
  characters (stricter than rework reasons because the existing readers reject tab and newline). Stored byte-exact.
- Only the authenticated operator session reaches it (session, Origin, project.write, idempotency and result lookup as
  for every command). No executor, fixture or worker path is added.
- Guards in order after authorization: WorkItem exists in project (masked 404); expected version (409
  `version_conflict`); phase not Done or Canceled (422 `lifecycle_rejected` / `invalid_transition`); `blocker_id` never
  used on this WorkItem, active or resolved (422 `lifecycle_rejected` / `blocker_exists`; ids are not reused so a
  resolved row keeps its meaning); capacity: total blocker rows < 1024 and active `blocker_id`+`reason` bytes after
  insert ≤ 2 MiB (422 `lifecycle_rejected` / `blocker_capacity`).
- Effect in one transaction: insert the active row, phase unchanged, version+1. Result `BlockerAdded`
  (`project_id`, `work_item_id`, `version`, `phase`, `blocker_id`, `reason`). Audit/change-event subject is the
  canonical request digest (as ReopenWorkItem). A blocker does not stop an active Run; it blocks the next dispatch and
  completion only (HAI-EXEC-008: no automatic restart or stop).

### BLK-02 — ResolveBlocker

- Operation `ResolveBlocker`, same metadata bounds; closed payload `work_item_id`, `blocker_id`, `resolution_ref`
  (1..200 bytes, valid UTF-8, no control characters; stored byte-exact in the result only).
- Guards: masked 404 for a missing WorkItem; `version_conflict`; unknown `blocker_id` on this WorkItem → 404
  `not_found`; already resolved → 422 `lifecycle_rejected` / `blocker_not_active`. Any phase is allowed, so a blocker
  left on a Done or Canceled item can still be cleared.
- Effect in one transaction: set `resolved_at_ns` to the command clock, phase unchanged, version+1, every other
  blocker unchanged (HAI-DOMAIN-003). Result `BlockerResolved` (`project_id`, `work_item_id`, `version`, `phase`,
  `blocker_id`, `resolution_ref`). Resolving does not dispatch, resume or complete anything.

### BLK-03 — Domain and storage seams

Domain `AddBlocker` rejects an id already active (today it overwrites). The transactional port gains
`AddBlocker`/`ResolveBlocker` (one SQLite transaction with the command result, CAS on version); the existing
non-transactional Store methods and their tests stay. Readers, board, detail and material index are unchanged; they
already read `work_item_blockers`.

### BLK-04 — Boundaries and authorized document amendments

New normative entry `docs/sdd/blocker-commands.md`; amend the domain-and-gates command table with `AddBlocker` /
`ResolveBlocker` rows. Public OpenAPI amendments: `AddBlockerPayload` becomes `work_item_id`, `blocker_id`, `reason`
with the bounds above (the unused `Blocker` schema is removed; `kind`, `required_input`, `resolver_id`, `due_at` belong
to the Proposed Question/Decision design); `ResolveBlockerPayload` gains the `resolution_ref` character rule;
`expected_version` 1..MaxInt64−1 on both request branches; new closed `BlockerAddedResult` and `BlockerResolvedResult`
with matching `CommandSuccess` branches, and other operations forbid `blocker_id` and `resolution_ref` in results.
No migration, dependency, UI, Attention endpoint (`getProjectAttention` stays unimplemented), Question/Decision,
executor-raised blocker, due-date expiry, provider, release or deploy.

## Fixed acceptance (BLK-AC-01..04)

| AC | Observable outcome / named oracle | Status |
| --- | --- | --- |
| BLK-AC-01 | `TestAddBlocker_GuardsAndHistory`: add in Draft/Ready/Developing/Review/QA → version+1, phase unchanged, closed `BlockerAdded` result with byte-exact reason, identical on replay; Done and Canceled refused; duplicate active id and resolved id refused (`blocker_exists`); 1024th-row and byte capacity refused; invalid id/reason (empty, 81/2001 bytes, invalid UTF-8, tab, newline), unknown field, wrong version, cross-project masked 404, idempotency conflict; refusals change no domain rows | NotRun |
| BLK-AC-02 | `TestResolveBlocker_GuardsAndHistory`: resolve sets `resolved_at` from the command clock, version+1, phase unchanged, closed `BlockerResolved` result with byte-exact `resolution_ref`, identical on replay; unknown id 404, resolved id `blocker_not_active`, wrong version, invalid `resolution_ref`; resolve allowed on Done and Canceled items | NotRun |
| BLK-AC-03 | `TestBlockers_ResolveOneOfTwoKeepsBlocked` (v0.2 AC-18; real SQLite/Fake/HTTP): two blockers on a Ready item → `Blocked` lane, DispatchRun `active_blocker`; resolve one → still Blocked, phase Ready, count 1, dispatch refused; resolve the other → dispatch succeeds; a blocker added in QA makes CompleteWorkItem fail with `active_blocker` and completion succeeds after resolve; detail lists both rows with `resolved_at`; restart preserves rows and replay | NotRun |
| BLK-AC-04 | Pinned backend full/race/vet/build with no existing test modified except where a raw-SQL blocker fixture is kept as-is, web gate, pinned Redocly lint, contracts/index/links; Claude code review dispositions; exact-head CI, normal merge, remote readback, BOARD/desk/handoff | NotRun |

Traceability after delivery would move HAI-DOMAIN-003 and v0.2 AC-18 to passing for the command path; AC-17
(Question response) stays NotRun until HAI-DEC.

## Decision requested

- **D1:** Approve BLK-01..04 and BLK-AC-01..04 as the next backend slice, including the public OpenAPI amendment that
  narrows `AddBlockerPayload` to stored fields and adds the two result schemas.

## Limits

This proposal changes no behavior. Completion UI (M3), Done validity, whole-M2, Question/Decision and SUCCESS
AC-02..04 remain open after this slice.
