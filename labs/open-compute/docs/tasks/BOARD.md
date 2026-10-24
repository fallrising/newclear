# Open Compute technical tasks

## T-0077 — Issue #548 M4 kernel closure

Contract: [SDD-M4](../SDD-M4.md#m4-kernel-closure-amendment-t077).
Scope and acceptance: [SUCCESS](../../SUCCESS.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0077.1 | Register M4 launches and prove kernel closure | AC-K1 | in_progress | 2026-10-24T11:28:54Z | — | 2026-10-24T17:09:04Z |
| T-0077.2 | Enforce snapshot and deletion authority | AC-K2 | in_progress | 2026-10-24T11:28:54Z | — | 2026-10-24T17:09:04Z |
| T-0077.3 | Project bounded lifecycle evidence | AC-K3 | in_progress | 2026-10-24T11:28:54Z | — | 2026-10-24T17:09:04Z |
| T-0077.4 | Verify focused, offline and original-runtime behavior | AC-K4 | in_progress | 2026-10-24T11:28:54Z | — | 2026-10-24T17:09:04Z |

Implementation, independent review,332 offline tests and one original M4
qualification have passed. Exact-head hosted CI and normal merge remain pending.
Historical exact attribution and whole-mainline acceptance remain incomplete.

## T-0081 — Issue #548 M5 kernel closure

PR613 required checkpoint-crash failed before any SIGKILL at durable_wait.
Contract: [SDD-M5](../SDD-M5.md); acceptance: [SUCCESS](../../SUCCESS.md).
Design/review and committed contract precede implementation; M4 accepted evidence
remains separate. Historical attribution and whole-mainline acceptance stay open.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0081.1 | Design and independently review M5 lifecycle authority | M5-01, M5-02 | in_progress | 2026-10-24T16:15:57Z | — | 2026-10-24T17:09:04Z |
| T-0081.2 | Preserve strict crash stimulus and GET-only original readback | M5-02, M5-03 | in_progress | 2026-10-24T16:31:28Z | — | 2026-10-24T17:09:04Z |
| T-0081.3 | Prove normal final closure and exact cleanup | M5-04 | in_progress | 2026-10-24T16:31:28Z | — | 2026-10-24T17:09:04Z |
| T-0081.4 | Verify bounded evidence, original runtime and required CI | M5-05 | in_progress | 2026-10-24T17:09:04Z | — | 2026-10-24T17:09:04Z |

T-0081 design independently accepted; contract baseline `00d38812` committed
before implementation. Focused causal/adversarial implementation checks in progress.

M5 corrected-source353 offline tests, independent review and one original26.747s
qualification passed. PR613 required exact-head CI and normal merge remain pending.
