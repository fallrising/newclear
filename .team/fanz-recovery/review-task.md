ROLE: WORKER
AGENT: native inherited-model reviewer
ID: T-442
Goal: Under desk T-0442, independently review M3 recovery readiness documents and authorization boundaries.
Why: Fresh-context acceptance is required; original unknown and credential handling must remain truthful.
Inputs to read first: platform/fanzloud/AGENTS.md, SDD.md §§3,5,6; docs/specs/PROPOSAL-M3-recovery.md; docs/acceptance/M3-recovery-readiness.md; docs/isolated-operator.md; SUCCESS.md final section; docs/tasks/BOARD.md final section. Source anchors: platform/agent-platform/src/agent_platform/{api,store,domain}.py; platform/fanzloud/apps/control-plane/src/isolated/persistence.rs; crates/codebox-event-store/src/submission.rs. Use exact named files only.
Scope (may touch): No files; return a concise review to parent.
Out of scope (must not touch): All private .local/backup/config/auth files and all files outside this checkout; all runtime/DB/network/provider calls, mutation, tests, Git changes, delegation. Do not independently search for private evidence; parent supplied sanitized observations are attributed as such.
Definition of done:
- [ ] Assess source-backed recovery design, missing evidence, safety/rollback, no claims beyond source or supplied observations.
- [ ] Report ACCEPT_READINESS or concrete findings with file/line anchors; no product acceptance.
Verify with: Read only the exact docs and source; git diff within this worktree. No test replay needed for documentation.
Budget: One review <=10min, response <=1500words; at most one parent-requested correction follow-up. No children.
