# Issue548 — M4 kernel-owned cold closure

Contract baseline: [SDD-M4 amendment](../../docs/SDD-M4.md#m4-kernel-closure-amendment-t077).
AC-K1–K4 are defined in SUCCESS. All implementation/runtime checks start not_run.

Phase A: root reviews and commits SUCCESS/SDD/schema/constants before code.
Worker must pause for root's explicit Phase B release after that commit.

Phase B: new M4-only same-PID exec runner and explicit lifecycle APIs, registry
from source_commit onward, checked subreaper/default SIGCHLD, closed epochs,
sole waiter/drained pipes/threads, actual ECHILD before snapshots/deletion,
single-use receipts, honest incomplete sampled liveness and strict public evidence.
Authority failure preserves scope; ordinary workload failure requires fresh
closure proof for cleanup and never becomes success. Preserve exact daemon PID,
exit status, all fixed workload/deadlines, storage.py and generic/other profiles.

Scope: storage_lifecycle.py/tests, M4-only lab wiring/storage integration tests,
SUCCESS/SDD-M4/SDD/STATUS/quickstart/task/report. No upstream, fixture, pin,
generic Process/command, M5/M7, workflow or dependency changes.

Verification: focused causal/adversarial RED/GREEN via shared launcher using
Python3.11 SDK, no PYTHONPATH; exact own-process cleanup/source hashes. Root owns
independent review, full offline gate, original M4 release, CI/publication.
No code/runtime before release; no automatic retries or historical role invention.
