# HAI Taskboard current development board

Planning navigation: [remaining work and proposed designs](../plans/remaining-work-20261029.md).
Planning, M0 and the owner-approved M1a milestone are delivered below. Existing full-product implementation rows retain their status.

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
At planning closeout, the next proposed task was M0 baseline reconciliation, awaiting owner instruction; no implementation
was started in that planning turn. The following M0 entry records the subsequent owner instruction. The accepted SDD/bootstrap authority conflict remains a future explicit decision.


## T-0339 — M0 baseline reconciliation

Owner explicitly continued development after HP planning delivery. This activates M0 only, linked to H01; M1a requires a separate accepted contract/task. Scope: source/spec/test inventory, actual pinned gates and connected-browser foundation, precise conflict proposals. No production or accepted-spec changes. Source `1e70824e24161bafacfc1eca33bb31ba7045df5a`.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| HM0 | Complete clause/code/test/gap inventory, rerun baseline and record conflicts | M0-01..03; H01 support | done | 2026-10-29T17:47:11Z | 2026-10-29T18:18:01Z | 2026-10-29T18:19:18Z |

M0-01: all SUCCESS/v0.2/AC-P0A/main SDD/mini-SDD/ADR/OpenAPI obligations mapped with accepted/proposed distinctions. M0-02: same-source pinned backend/web and real ConnectedApp login/admission/Fake/reconnect baseline, successful Fake remains Developing. M0-03: exact conflicts/proposals, independent review, document checks, required CI/merge/readback. This does not close H01..H04 or product AC-02..04.

Local evidence: [M0 report](../evidence/m0-baseline-20261029.md), full matrices and [Proposed contract decisions](../plans/m0-contract-decisions-20261029.md). Independent T-003 ACCEPT covers local M0 only; pinned backend/full/race/build,web30+safety8 and true browser13steps/30captures pass. Product AC/status unchanged; required PR CI/merge/readback pending.

M0 delivery: [PR #798](https://github.com/fallrising/newclear/pull/798) merged at
`2026-10-29T18:18:01Z` as `946636df32be6d2c140cb31b744ea75e51e7e9a3`.
Reviewed/integrated head `de9a3548bb2d7f4d374cc5feefbdeef37be111bb` passed
[HAI backend/web CI](https://github.com/fallrising/newclear/actions/runs/40928493612)
and [project success CI](https://github.com/fallrising/newclear/actions/runs/40928493585).
Remote evidence JSON blob `dcce749ae35d93ef5c51516a6ebe8c9a0fc87448` and Proposed
contract document blob `f566d37c3ff20dc91ead8da5a3d04223dd406c84` matched the reviewed
local files; all HAI product paths matched the merged checkpoint. HM0 closes only the
baseline audit, not H01..H04 or SUCCESS AC-02..04. Proposed C01/C02/C06 remain unadopted;
M1a has not started. Next: owner decision on the concrete contract proposals, followed by
a separate accepted M1a task. No usable tag, real adapter, release or deployment.

## T-0339 — M1a completion preparation

Owner approved C01/C02/C06 on2026-10-30 and requested latest design as authority. Intake remote HAI
product tree remains PR799; current plan includes Proposed Kanzo follow-ups without enabling them.
One Ready bounded task: [contract and fixed cases](../sdd/completion-preparation.md).
Writable scope: owner-approved SDD/ADR/HANDOFF authority wording, M1a spec/OpenAPI, preparation
application/HTTP Go implementation and tests, documentation/evidence/BOARD. No dependency, migration,
UI, artifact/report API, arbitrary policy or provider expansion. H01..H04 and product ACs retain status.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| HM1A | Adopt approved contracts; expose authenticated exact completion preparation read | PREP-AC-01..04; H02 support | done | 2026-10-30T03:58:51Z | 2026-10-30T04:32:43Z | 2026-10-30T04:33:38Z |

M1a local gates and independent contract/implementation review ACCEPT; [evidence](../evidence/m1a-completion-preparation-20261030.md)
retains exact snapshot/no-write, negative cases, frozen hashes and original failures. Required PR CI/merge/readback pending; full product ACs unchanged.

M1a delivery: [PR #812](https://github.com/fallrising/newclear/pull/812) merged at
`2026-10-30T04:32:43Z` as `1a681bc65783e717931390ec325fe6ac2d997010`.
Reviewed/integrated head `3e805090dac57c8723a35a562c73493455d9c281` passed
[HAI backend/web CI](https://github.com/fallrising/newclear/actions/runs/41002679073) and
[project success CI](https://github.com/fallrising/newclear/actions/runs/41002679027).
Post-merge remote readback matches every reviewed HAI product path. C01/C02/C06 are now adopted;
PREP-AC-01..04 and both independent reviews pass. The local JSON receipt retains its pre-delivery
snapshot; this BOARD entry records the subsequent actual delivery. Original Red, environment failures
and superseded runs remain in the evidence. Full H01..H04 and SUCCESS AC-02..04 remain incomplete.
Next planned slice is M1b (Run outputs and artifact reads); it has not started. No usable tag,
real adapter, release or deployment. This final board-only follow-up records the actual merge end.

## T-0339 — M1b scoped output access

Owner continued development and requested Claude Code plan/code review. Source `e00866434e856d164a59516bc9c7de2f4770020b`.
One Ready task: [M1b plan and fixed acceptance cases](../plans/m1b-output-access-20261030.md).
Scope: bounded output/artifact read port, SQLite read adapter, service, HTTP, focused tests and docs/API.
No migrations, dependency, UI, report writes or later slice. H01..H04 and full product ACs retain status.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| HM1B | Expose scoped historical Run outputs and verified artifact downloads | ACCESS-AC-01..04; H02 support | done | 2026-10-30T10:10:44Z | 2026-10-30T10:57:34Z | 2026-10-30T10:58:00Z |

M1b local implementation/gates and Claude plan/code review ACCEPT after retained REWORK.
[Evidence](../evidence/m1b-output-access-20261030.md) preserves original failures and exact
fullgate/assertion-delta source boundaries. Local evidence receipts retain their pre-delivery snapshot;
the following records subsequent final-head CI and actual delivery.

M1b delivery: [PR #824](https://github.com/fallrising/newclear/pull/824) merged at
`2026-10-30T10:57:34Z` as `02ba79b6770bc20582b9f99175af24c572dc3c78`.
Reviewed/integrated head `e04c21ae9092b08ade86bedf247d4bd5301916d0` passed
[HAI backend/web CI](https://github.com/fallrising/newclear/actions/runs/41043345746) and
[project success CI](https://github.com/fallrising/newclear/actions/runs/41043345828).
Remote readback matches every reviewed HAI product and task-report path, including the plan and
JSON receipt. ACCESS-AC-01..04 and Claude plan/code follow-ups are accepted; original REWORK and
failed diagnostics remain retained. No new browser acceptance or full-product completion is claimed.
Full H01..H04 and SUCCESS AC-02..04 retain their prior status. Next planned slice is M1c human
report persistence/submission; it has not started. No usable tag, real adapter, release or deployment.
This board-only follow-up records the actual primary merge end.

## T-1030 — Session control-room design and provider critical-path audit

Authority: direct owner request on 2026-10-30 to integrate the Session-first agent control-room
design into HAI and explain the continued absence of a real provider. One Ready documentation-only
task, claimed by the lead assistant before design edits. Baseline:
`1181db123f108ab096bbc1ae9a4e804097d939ca`. Delivery branch:
`docs/hai-session-control-room-20261030`.

Writable scope: README.md, SUCCESS.md, this BOARD, docs/sdd/session-control-room.md,
docs/plans/provider-critical-path-20261030.md and docs/evidence/session-control-room-20261030.md.
No AGENTS/accepted-SDD/ADR changes, runtime, API, migrations, dependencies, provider credentials,
real execution, merge, release or deployment. Existing H01..H04, M1c next-step and product ACs
remain unchanged. A proposed alternative dependency path is not accepted execution authority.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| SC-D01 | Integrate Session identity, telemetry, role projection and capability-gated control with existing HAI contracts | SC-DOC-01 | in_progress | 2026-10-30T11:37:01Z | — | 2026-10-30T11:37:01Z |
| SC-D02 | Separate documented provider blockers, process diagnosis and a bounded alternative critical path | SC-DOC-02 | in_progress | 2026-10-30T11:37:01Z | — | 2026-10-30T11:37:01Z |
| SC-D03 | Verify scoped documents, preserve existing acceptance, publish Draft PR and read back Git objects | SC-DOC-03 | in_progress | 2026-10-30T11:37:01Z | — | 2026-10-30T11:37:01Z |

SC-DOC-01 requires exact mapping to WorkItem/Run/Candidate/Review/Evidence/Approval/CompletionRecord,
observation versus control, metric provenance and named future oracles. SC-DOC-02 requires a factual
baseline, current versus proposed dependencies and an explicit authorization change list; no invented
root-cause effort statistics. SC-DOC-03 requires exact baseline blob checks, scoped link/contract/diff
checks and actual remote delivery receipts. CI and independent review remain separately reported;
self-review is not independent acceptance. Rows stay in_progress until the authorized merge and
subsequent board closure; future feature oracles remain Proposed/NotRun.
