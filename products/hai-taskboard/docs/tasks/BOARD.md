# HAI Taskboard current development board

Planning navigation: [remaining work and proposed designs](../plans/remaining-work-20261029.md).
This is documentation-only planning; existing implementation rows below retain their status.

This board is the current work-status authority under the owner-invoked
START_DEVELOPMENT_PROMPT and root technical-task contract. The archived class A ledger
remains immutable historical evidence. Root `.team/PLAN.md` records routing and review
decisions only; it does not create a second product status board. Earlier product task
contracts and their acceptance criteria are retained unchanged.

## T-0980 — Resume P0-A mainline

Baseline: `b7f2a4311d1135977ba273efba8e77702b908036`; existing documentation branch and
unrelated uncommitted work preserved. Scope remains deterministic Fake, existing Go/React
stack, local single operator. The initial implementation turn did not authorize Git publication. The owner subsequently
authorized commit, PR and merge on2026-10-23; deployment remains outside scope.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| H01 | Reconcile source, accepted slices and historical failures; rerun baseline | AC-01 | in_progress | 2026-10-22T18:04:29Z | — | 2026-10-22T18:04:29Z |
| H02 | Proposal HTTP/runtime and first acceptance accepted locally (T-986/989/999 after retained rework); current input storage T-988 accepted locally; HAI-local T-001 Ready/dispatch accepted locally; T-007 initial HTTP accepted locally; T-002 current subjects/Done and corrected output storage T-009 accepted locally; T-012 output consumer / T-020 completion HTTP / T-021 preparation accepted locally after independent reviews and root full gates | AC-02 | in_progress | 2026-10-22T18:12:00Z | — | 2026-10-23T12:45:15Z |
| H03 | Browser session/static prerequisite accepted locally after T-005 rework/T-006 closure; T-015 project directory accepted locally; T-014/T-019 connected foundation corrected; T-024 timestamps and T-028 keyboard accessibility corrected; actual foundation browser flow passed; full detail/attention/impact remain | AC-03 | in_progress | 2026-10-23T07:12:02Z | — | 2026-10-23T12:45:15Z |
| H04 | Durable activation, backup/restore, ContextPack resume and failure evidence | AC-04 | todo | — | — | 2026-10-22T18:04:29Z |

Dependency order: audit/baseline → durable proposal and acceptance → current-head
readiness/dispatch/completion → connected UI → activation/restore/resume → independent
review and evidence gate. Independent work may proceed where it does not assume missing
authority. A passing kernel or historical report never accepts a full product AC.

Current evidence: pinned backend full/race/vet/build PASS, fresh two-process proposal replay PASS,
UID0 ownership rejection PASS, pinned OpenAPI lint PASS and pinned web8fixture tests/build PASS.
T-982 service and T-985 HTTP/runtime independent review accepted locally after retained rework.
First acceptance now has root final full/race/vet/build PASS and independent T-989 closure;
the discovered two-key immutable AC conflict and its Red/Green regression remain in T-999 evidence.
T-984/T-987 are read-only design audits, not implementation acceptance. Historical failures and
this run's module/socket/SSE/schema diagnostics are retained. No row is done until the repository
merge condition is met.

Current-input storage/verified reads passed independent HAI-local T-004 review and integrated
backend gates. Browser transport passed independent T-006 closure, final pinned backend
full/race/vet/build and ten actual Chromium runtime checks. Both FIFO startup race findings
and the initial wrong-Host harness diagnostic remain retained. The browser probe used a
public fixture shell; connected React workflows and full product AC remain pending.

Latest bounded backend gate: completion-integrated-20261023 passed unmodified full/race/vet/build
on141 unchanged inputs after T012/T020/T021 integration; independent T027/T026/T023 accepted.
Connected web pinned30tests/type/lint/format/build and actual integrated Chromium foundation
workflow pass. T018 reset/session, timestamp and accessibility failures remain retained alongside
the reviewed corrections. Full AC02/03/04 remain pending.

### Recovery checkpoint — 2026-10-23

No work was discarded by the interruption. T022 independently closed T018 reset/session races;
T025 accepted the canonical timestamp correction after named Red. Root pinned30 frontend tests,
typecheck/lint/format/build pass. Actual connected-browser-accessible-20261023 passes two fresh
runtime processes through real login/project/Draft/proposal/acceptance/Ready/Fake/SSE, response-loss
original-result lookup, disconnect/reconnect, board focus and axe light/dark; full UI remains pending.
T029 independently verified actual Tab focus, ArrowRight scrolling and visible outline. T012/T020/T021
have independent ACCEPT reviews T027/T026/T023 and are accepted locally after full diff review and
root completion-integrated-20261023 full/race/vet/build on141 stable inputs, zero-warning API lint
and completion-connected-browser-20261023 actual integrated browser rerun.

Remaining implementation is explicit: (1) completion preparation/output/artifact/report HTTP reads
and writes, current-policy detail/coverage, then connected candidate→human review/evidence→QA→Done;
(2) full detail/attention/impact and required responsive/keyboard/coarse-pointer behavior;
(3) durable ImpactPlan activation and invalidation, verified backup/restore fencing, bounded
ContextPack fresh-context resume; (4) complete HAI-DONE/UX/ops negative and recovery acceptance.
Whole-product independent acceptance follows only after those pass. The owner separately
authorized publishing the current bounded checkpoint before restart, as recorded below.

## Reboot publication checkpoint

The owner authorized committing this bounded implementation, opening a PR and merging after
required checks. Delivery is isolated on a branch from current main; only HAI Taskboard paths
are included. The PR preserves the current incomplete product status. H01..H04 remain
in_progress/todo until their full AC are fulfilled; merging this checkpoint does not close them.
The next implementation remains the completion/artifact/report API and connected completion flow.

## T-0380 — approved FE round2 slice

This bounded review slice does not complete or change the P0-A product rows above. Authority: approved root ROUND2-SDD R2-AC-3/E and current ConnectedApp DESIGN items1–4. Detailed scope: [task](../../fe-review/tasks/round2/task.md). Root campaign board links this same slice; no new product acceptance.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| HFE2-1 | True same-origin ConnectedApp review harness and observed presentation corrections only | R2-AC-3/E | done | 2026-10-24T07:35:27Z | 2026-10-24T08:31:49Z | 2026-10-24T08:34:14Z |

## T-1029 — Kanzo-inspired usability documentation

Authority: direct owner request on 2026-10-29 (Asia/Singapore): document useful Kanzo
capabilities for later HAI implementation and clarify whether HAI is usable today.
This is one documentation-only task. Runtime, API, dependencies, CI, credentials and
deployment are outside its writable scope. P0-A remains Fake-only; H01..H04 and all
existing acceptance criteria retain their status.

Writable scope: product README/SUCCESS, docs/quickstart.md, docs/SDD.md navigation,
docs/sdd/kanzo-inspired-usability.md, this board, and a bounded document-review report
under docs/evidence/. Source baseline: `0111908492c32d0b01d561b24b6024737cb4f641`.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| KD01 | Clarify the runnable Fake slice, remaining P0-A gates and future real-agent readiness | DOC-01 | done | 2026-10-28T17:34:03Z | 2026-10-28T18:00:58Z | 2026-10-28T18:02:00Z |
| KD02 | Specify selected Kanzo-inspired workflows, invariants, ordered follow-ups and measurable acceptance | DOC-02 | done | 2026-10-28T17:34:03Z | 2026-10-28T18:00:58Z | 2026-10-28T18:02:00Z |
| KD03 | Connect entry documents, validate scope/links/contracts and obtain independent document review | DOC-03 | done | 2026-10-28T17:34:03Z | 2026-10-28T18:00:58Z | 2026-10-28T18:02:00Z |

Acceptance: DOC-01 separates current observations from historical runtime evidence;
DOC-02 marks every future capability and named oracle unimplemented/NotRun and preserves
commands, evidence/Done, authorization and unknown-outcome handling; DOC-03 records actual
document checks and review with no product acceptance claim. The documentation turn initially
stopped at Draft PR #727. The owner subsequently authorized its merge; [PR #727](https://github.com/fallrising/newclear/pull/727)
merged at `2026-10-28T18:00:58Z` as `f15058bdc4fce552e90b186f88b573677b7ae834`, after the
reviewed head `91ff6d964467552cebc4863f26a62c001a274fa2` passed HAI backend/web
and project-success CI. Both independent document reviews were accepted after retained rework.
KD01..KD03 are now done with that actual merge time; this board-only follow-up records the closure
under the root technical-task contract. H01..H04 and all product AC/statuses remain unchanged.
The merge does not enable any HAI-KZ feature, real agent, release or deployment.

## T-0339 — remaining-work planning

Owner requested a plan for unfinished P0-A and unimplemented designs, reviewed by Claude and
revised before documentation delivery. The desk claim is merged. Scope: the plan, its evidence
report, this board and README/SUCCESS/HANDOFF navigation; no production implementation or SDD changes.
Source: `a2c0b5116018160d5e5c24c10fa49c81adff806e`. H01..H04 and product acceptance stay unchanged.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| HP01 | Inventory unfinished mainline and existing proposed designs | PLAN-01 | done | 2026-10-29T17:03:00Z | 2026-10-29T17:26:03Z | 2026-10-29T17:27:17Z |
| HP02 | Define bounded sequence/acceptance and revise after Claude review | PLAN-02 | done | 2026-10-29T17:03:00Z | 2026-10-29T17:26:03Z | 2026-10-29T17:27:17Z |
| HP03 | Verify documents, deliver and retain review/evidence | PLAN-03 | done | 2026-10-29T17:03:00Z | 2026-10-29T17:26:03Z | 2026-10-29T17:27:17Z |

Plan: [remaining-work-20261029](../plans/remaining-work-20261029.md).
Evidence and bounded review: [report](../evidence/remaining-work-plan-20261029.md).
Future M/U/D slices are unstarted planning references, not separately claimed tasks.
This documentation milestone stops before product implementation; the overall T-0339 remains incomplete.

Delivery: [PR #781](https://github.com/fallrising/newclear/pull/781) merged at
`2026-10-29T17:26:03Z` as `2c73caf464bec1281f037aca3f2281aae60b0362`.
The reviewed head was `99ad6c304a36ba3fbd8be8fbdb36b54108037f91`;
[HAI backend/web CI](https://github.com/fallrising/newclear/actions/runs/40920283358)
and [project success CI](https://github.com/fallrising/newclear/actions/runs/40920283158)
completed successfully. Remote plan blob `eb4c38f2993489cd69f3ee34c6ef8fc6440bbf61`
matched the reviewed local file; all product paths matched the merged checkpoint.
Claude Opus 5.5 returned REWORK then ACCEPT; the [report](../evidence/remaining-work-plan-20261029.md)
retains findings, revisions, limits and actual document checks. HP01..HP03 close only this
planning milestone. H01..H04, SUCCESS product ACs, mainline incomplete and usable tag none stay unchanged.
The next proposed task is M0 baseline reconciliation, awaiting owner instruction; no implementation
was started. The accepted SDD/bootstrap authority conflict remains a future explicit decision.
