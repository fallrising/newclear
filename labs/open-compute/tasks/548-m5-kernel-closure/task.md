# Issue548 M5 kernel owner closure

Phase: A design freeze; implementation and runtime not released.
Base: PR613 head `2fd145b13d6326df76f4b48e4bc8b825ec5527d1`.
Contract: [SDD-M5 amendment](../../docs/SDD-M5.md#m5-kernel-owner-amendment-t081-phase-a).
Acceptance: SUCCESS AC-M5K1 through AC-M5K4 and existing M5-01 through M5-05.

CI40109462879 failed durable_wait/observer/child_missing before stimulus; exact
candidate/role and historical causation remain unknown. Implement only after
independent contract review, root's contract commit and explicit Phase B release.
Phase A edits only SUCCESS, SDD/SDD-M5, this task and private worker artifacts.

Planned implementation: new M5-private crash_lifecycle.py and focused tests;
explicit M5-only lab.py routing/bindings and test_crash_integration adaptation.
Duplicate owner primitives intentionally; reuse unchanged strict crash/readback
projectors. Do not edit generic Process/command, crash.abrupt_shutdown,
storage_lifecycle/M4 behavior, other profiles, upstream/fixture/dependencies,
CI/AGENTS or historical reports. No implementation scope is granted here.

Required order: causal/adversarial RED evidence -> focused GREEN -> exact source
freeze -> independent source/adversarial review -> root full offline verification
-> explicit runtime release -> one bounded original-artifact M5 qualification
-> required exact-head CI/review and root delivery decision. All builds/tests
run from source via shared workspace launcher, unique task IDs, verified
Python3.11 SDK and absent PYTHONPATH. Preserve immutable evidence and original
deadlines; no blind rerun, production deployment or M4-proof substitution.

Phase A verification: static API/state/schema trace, scoped diff and task/report
validator only. Production/tests/runtime untouched. Board/publication/Git writes
remain root-owned. Ten-minute checkpoint and stop after freeze handoff.
