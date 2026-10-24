# Open Compute technical tasks

## T-0077 — Issue #548 M4 kernel closure

Contract: [SDD-M4](../SDD-M4.md#m4-kernel-closure-amendment-t077).
Scope and acceptance: [SUCCESS](../../SUCCESS.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0077.1 | Register M4 launches and prove kernel closure | AC-K1 | done | 2026-10-24T11:28:54Z | 2026-10-24T17:16:38Z | 2026-10-24T17:41:22Z |
| T-0077.2 | Enforce snapshot and deletion authority | AC-K2 | done | 2026-10-24T11:28:54Z | 2026-10-24T17:16:38Z | 2026-10-24T17:41:22Z |
| T-0077.3 | Project bounded lifecycle evidence | AC-K3 | done | 2026-10-24T11:28:54Z | 2026-10-24T17:16:38Z | 2026-10-24T17:41:22Z |
| T-0077.4 | Verify focused, offline and original-runtime behavior | AC-K4 | done | 2026-10-24T11:28:54Z | 2026-10-24T17:16:38Z | 2026-10-24T17:41:22Z |

Implementation, independent review,332 offline tests and one original M4
qualification have passed. PR613 exact-head hosted CI passed and normal merge
completed at 2026-10-24T17:16:38Z (merge `07934581`).
Historical exact attribution and whole-mainline acceptance remain incomplete.

## T-0081 — Issue #548 M5 kernel closure

PR613 initial required checkpoint-crash failed before any SIGKILL at durable_wait;
that failure remains retained separately from the corrected-source qualification.
Contract: [SDD-M5](../SDD-M5.md); acceptance: [SUCCESS](../../SUCCESS.md).
Design/review and committed contract precede implementation; M4 accepted evidence
remains separate. Historical attribution and whole-mainline acceptance stay open.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0081.1 | Design and independently review M5 lifecycle authority | AC-M5K1, M5-01, M5-02 | done | 2026-10-24T16:15:57Z | 2026-10-24T17:16:38Z | 2026-10-24T17:41:22Z |
| T-0081.2 | Preserve strict crash stimulus and GET-only original readback | AC-M5K2, M5-02, M5-03 | done | 2026-10-24T16:31:28Z | 2026-10-24T17:16:38Z | 2026-10-24T17:41:22Z |
| T-0081.3 | Prove normal final closure and exact cleanup | AC-M5K3, M5-04 | done | 2026-10-24T16:31:28Z | 2026-10-24T17:16:38Z | 2026-10-24T17:41:22Z |
| T-0081.4 | Verify bounded evidence, original runtime and required CI | AC-M5K4, M5-05 | done | 2026-10-24T17:09:04Z | 2026-10-24T17:16:38Z | 2026-10-24T17:41:22Z |

T-0081 design independently accepted; contract baseline `00d38812` committed
before implementation. Focused causal/adversarial checks and independent final
review accepted corrected source `d27e1207`. Historical RED remains preserved.

M5 corrected-source353 offline tests, independent review and one original26.747s
qualification passed. All six required checks on head `83e51d3f` passed:
[Open Compute CI](https://github.com/fallrising/newclear/actions/runs/40114998185)
and [Project success contracts](https://github.com/fallrising/newclear/actions/runs/40114998154).
[PR613](https://github.com/fallrising/newclear/pull/613) merged normally at
2026-10-24T17:16:38Z, merge `0793458167a7e63dbb263b8c7de95ab1efe581fb`.
The bounded M4/M5 tasks are done; #548 historical attribution and whole-mainline
acceptance remain open. This board closeout does not change their scope.

## T-0084 — Issue #548 acceptance reconciliation

Contract and evidence: [AC matrix](../ACCEPTANCE-548.md). Existing seven CI reports
and exact checkout/source bridge; no new runtime or changed acceptance criteria.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0084.1 | Reconcile source-bound evidence | AC-01 | in_progress | 2026-10-24T19:41:51Z | | 2026-10-24T19:41:51Z |
| T-0084.2 | Reconcile source-bound evidence | AC-02 | in_progress | 2026-10-24T19:41:51Z | | 2026-10-24T19:41:51Z |
| T-0084.3 | Reconcile source-bound evidence | AC-03 | in_progress | 2026-10-24T19:41:51Z | | 2026-10-24T19:41:51Z |
| T-0084.4 | Reconcile source-bound evidence | AC-04 | in_progress | 2026-10-24T19:41:51Z | | 2026-10-24T19:41:51Z |
| T-0084.5 | Reconcile source-bound evidence | AC-05 | in_progress | 2026-10-24T19:41:51Z | | 2026-10-24T19:41:51Z |
