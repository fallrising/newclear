ROLE: WORKER
AGENT: native independent reviewer
ID: T-003
Goal: Audit M4 L-01–05 implementation and evidence.
Why: Freshness and refresh failures must never masquerade as current queries.
Inputs to read first: .team/graphify-t0441/PLAN.md; labs/graphify-lab/docs/milestones/live-workspace.md; current diff/new runtime/tests; parent logs when ready.
Scope (may touch): Read-only integrated worktree and focused tests/ignored outputs only.
Out of scope (must not touch): Tracked writes, Git mutations, dependencies, external changes, recursive delegation.
Definition of done:
- [ ] Check exact source/context/runtime/graph freshness, failure retention, before/after race and serialized pointer changes.
- [ ] Check directed calls path bounds/ambiguity/determinism; genuine graph tests.
- [ ] Check true MCP schema/error wiring and same-session edit/stale/refresh/recovery; original serve compatibility.
- [ ] Return ACCEPT or bounded must-fix with actual tests and evidence; root owns CI/merge/ledger.
Verify with: focused new test modules using lab .venv; source inspection; git diff --check; index gate once docs staged. Avoid rerunning full suite without a finding.
Budget: 10 active minutes plus one focused repair follow-up. No delegation.
