ROLE: WORKER
AGENT: independent native acceptance reviewer
ID: T-448
Goal: Independently review T-0447 implementation against the approved external-workspace contract and its safety/authority boundaries.
Why: Real subscription CLI must never expose host credentials or create a second execution/retry authority.
Inputs to read first: platform/agent-platform/docs/EXTERNAL-WORKSPACE.md; Fanzloud SDD and SPEC-M1-qualification; current diffs in root and runtime worker isolated worktrees; relevant existing contracts/tests; codex-evidence-gate skill.
Scope (may touch): Only .team/fanz-executor-t0447/review-report.md in root tree. Read any relevant code/evidence; run bounded read-only/local tests if useful.
Out of scope (must not touch): Product implementation; host/provider operations; commits; delegation; broad unrelated suites.
Definition of done:
- [ ] Identify blocking defects with concrete path/scenario and minimal fix, separating claims from actual evidence.
- [ ] Review AP committed job lease, external operation journal/unknown, unprivileged tools, secrets, deadline/cancel/release, bounded capacity, CLI exact version/auth/tools and failed result handling.
- [ ] Confirm final integrated diff and live evidence when root supplies it; partial initial report is acceptable, not final acceptance.
Verify with: Focused existing tests and exact diffs; native venv $WORKSPACE/.local/fanz-executor-20261031/native-venv. Root logs live evidence under .local/fanz-executor-20261031; no secret output.
Budget: One independent review assignment, about30min plus final evidence followup; no provider calls or recursive delegation. Report early blockers immediately. Do not claim live acceptance until evidence exists.
