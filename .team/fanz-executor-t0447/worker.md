ROLE: WORKER
AGENT: native runtime implementation worker
ID: T-447
Goal: Implement the approved run-scoped external workspace connector contract.
Why: Actual Claude subscription must execute coding tools inside one owned VM.
Inputs to read first: Root and component AGENTS; platform/agent-platform/docs/EXTERNAL-WORKSPACE.md in orchestrator worktree; connector.py, connector_journal/fence/isolation/cancel/recovery/output; guest_control/workspace/quiescence; existing tests; codex-task-worker SKILL.md.
Scope (may touch): In your isolated worktree only platform/agent-platform/src/agent_platform and platform/agent-platform/tests_platform; your report at .team/fanz-executor-t0447/worker-report.md.
Out of scope (must not touch): docs/SUCCESS/BOARD/PLAN owned by root; Fanzloud; other components; dependencies; host changes; provider calls; git commit/push; delegation.
Definition of done:
- [ ] Explicit external mode and bounded workspace operation endpoint with durable once-only operation journal, all guards and unprivileged trusted guest helper.
- [ ] Preparation, completion/diff/check, real cancellation/release and inspection coherent without assuming OpenHands server exists.
- [ ] Focused RED/GREEN contract and guest boundary tests plus affected existing regressions; no lowering guards.
- [ ] Report exact interface, meaningful evidence, unresolved live checks and architecture constraints; do not claim live pass.
Verify with: Existing Python unittest/native tests and scoped ruff; discover current shared venv instead of adding dependencies. Run smallest tests that expose gates/replay/unknown/file escape/command bounds. Report exact commands.
Budget: One bounded implementation assignment, about60min; no recursive delegation or live providers; notify root early if existing lease authority needs a product decision. At most one evidenced repair per failing scenario; no repeated broad suite. Root integrates/reviews and owns live tests.
