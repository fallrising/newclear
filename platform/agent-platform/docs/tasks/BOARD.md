# Agent Platform task board

## T-0380

Approved root ROUND2-SDD R2-AC-4/E; [bounded task](../../fe-review/tasks/round2/task.md). This is the FE review slice, not complete product/VM/provider acceptance.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| AFE2-1 | Isolated true API/fake-backend capture and approved presentation fixes (PR588 merged) | R2-AC-4/E | done | 2026-10-24T08:34:14Z | 2026-10-24T09:14:44Z | 2026-10-24T09:23:07Z |

## T-0087 — Issue #379 manual event retention

[Contract](../EVENT-RETENTION.md), [bounded task](../../tasks/379-event-retention/task.md).
Independent Phase A review accepted after replay/lock/bounds/schema corrections;
implementation follows this committed baseline. Whole AT13/M4 remains incomplete.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0087.1 | Bound approved retention and ownership | EVT-01 | done | 2026-10-25T06:42:53Z | 2026-10-25T09:59:13Z | 2026-10-25T10:00:38Z |
| T-0087.2 | Preserve event identity and concurrency | EVT-02 | done | 2026-10-25T06:42:53Z | 2026-10-25T09:59:13Z | 2026-10-25T10:00:38Z |
| T-0087.3 | Verify CLI/API/browser expired-history flow | EVT-03 | done | 2026-10-25T06:42:53Z | 2026-10-25T09:59:13Z | 2026-10-25T10:00:38Z |
| T-0087.4 | Preserve schema and native backup compatibility | EVT-04 | done | 2026-10-25T06:42:53Z | 2026-10-25T09:59:13Z | 2026-10-25T10:00:38Z |

T0087 delivery: [PR633](https://github.com/fallrising/newclear/pull/633) merged
`ce81af8aef6e0faa4ef10d64d17b8d438c5d69a4` at2026-10-25T09:59:13Z;
head `fa3b1b68f8ba9a37380c04ede453b4590ccd8a39` passed all four required checks.
[Agent Platform CI40182333825](https://github.com/fallrising/newclear/actions/runs/40182333825)
passed45 base tests and700 control-plane tests; [contract CI40182333859](https://github.com/fallrising/newclear/actions/runs/40182333859) passed.
Merged component bytes match the reviewed candidate. This supersedes pre-merge CI-pending
statements in the local [delivery snapshot](../../tasks/379-event-retention/report.md);
original local failures remain historical, not erased or reattributed.
Only EVT01–04 are delivered. Audit retention, stale cleanup, integrated/live acceptance
and whole AT13/M4 remain open under#379; no usable tag, release or deployment.

## T-0089 — Issue #379 manual audit retention

[Contract](../AUDIT-RETENTION.md), [bounded task](../../tasks/379-audit-retention/task.md).
T090 independently accepted the policy/dependency/guard design before implementation.
Whole AT13/M4 remains incomplete.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0089.1 | Bound explicit90-day approvals | AUD-01 | done | 2026-10-25T11:55:18Z | 2026-10-25T13:19:39Z | 2026-10-25T15:31:47Z |
| T-0089.2 | Guard atomic audit removal and replay | AUD-02 | done | 2026-10-25T11:55:18Z | 2026-10-25T13:19:39Z | 2026-10-25T15:31:47Z |
| T-0089.3 | Preserve authoritative control state | AUD-03 | done | 2026-10-25T11:55:18Z | 2026-10-25T13:19:39Z | 2026-10-25T15:31:47Z |
| T-0089.4 | Verify native backup and compatibility | AUD-04 | done | 2026-10-25T11:55:18Z | 2026-10-25T13:19:39Z | 2026-10-25T15:31:47Z |

T0089 delivery: [PR641](https://github.com/fallrising/newclear/pull/641) merged
`234daf32cad60af231abf35fb44cfdd75bbe2a6c` at2026-10-25T13:19:39Z;
head `9e052ff6935b7121c108be5e5c230f4fd14d6165` passed all four required checks.
[Agent Platform CI40196623154](https://github.com/fallrising/newclear/actions/runs/40196623154)
passed45 base tests and724 platform tests; [contract CI40196623122](https://github.com/fallrising/newclear/actions/runs/40196623122) passed.
Merged component bytes match the reviewed candidate. T090 independently accepted
AUD01–04 focused22/native3 and the additional pause fixture correction19 tests.
The initial hosted723 run had722pass/1pause-helper failure. A deterministic real
row-lock RED demonstrated that helper's immediate-claim assumption; bounded waiting
fixed the fixture without changing production or outcome assertions. The original
CI lock owner/interleaving remains unrecorded. Earlier focused21pass/1fail and
older event-regression failures remain preserved in the [dated report](../../tasks/379-audit-retention/report.md).
This delivery record supersedes that snapshot's pending-CI status. T0087 done rows
were also delivered by PR641; its standalone board candidate needs no duplicate PR.
Only the bounded audit/event slices are delivered. Stale runtime cleanup, integrated
fake/live acceptance and whole AT13/M4 remain open under#379; no usable tag, release or deployment.

## T-0092 — Issue #379 stale runtime cleanup contract

Source/ownership contract first; implementation awaits independent/root acceptance.
SDD13.2, INV-12 and AT-13 preserve unknown resources and active recovery state.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0092.1 | Trace owned stale resources and define safe cleanup | STALE-01 | in_progress | 2026-10-25T15:39:34Z | | 2026-10-25T15:39:34Z |
| T-0092.2 | Specify durable effects, fencing and replay | STALE-02 | in_progress | 2026-10-25T15:39:34Z | | 2026-10-25T15:39:34Z |
| T-0092.3 | Verify protected states and native compatibility | STALE-03 | in_progress | 2026-10-25T15:39:34Z | | 2026-10-25T15:39:34Z |
