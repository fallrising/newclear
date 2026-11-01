ROLE: WORKER
AGENT: native
ID: T-001
Goal: Implement validated live workspace snapshot state.
Why: L-01/L-02 must never return stale results or swap on failed refresh.
Inputs to read first: Parent .team/graphify-t0441/PLAN.md and labs/graphify-lab/docs/milestones/live-workspace.md; existing workspace/cache/source helpers; local AGENTS.
Out of scope (must not touch): Other tracked files, Git mutations, dependencies, external writes, nested agents.
Scope (may touch): graphify_lab/live_state.py and tests/test_live_state.py under labs/graphify-lab in assigned worktree only.
Definition of done:
- [ ] Class LiveWorkspace(source, cache) initializes via open_workspace; index property active dict; status() returns status current/stale/error plus index provenance, validates source/context/runtime and graph digest WITHOUT indexing; refresh() builds+validates candidate then atomic assignment, returns provenance; execute(callback) validates before and after callback(index), rejects stale/errors with LiveWorkspaceError, RLock serializes methods.
- [ ] Runtime identity captured at opening/refresh; graph symlink/digest corruption and removedsource fail closed; oldpointer retained after refreshfailure, no swallowed exceptions; race tested via focused fault injection only after true graph extraction.
- [ ] Real Graphify tests cover cold/warm, edits/config changes, corruption, failure/recovery and before/after race; RED before implementation.
Verify with: shared parent .venv/bin/python -m unittest discover -s tests -p test_live_state.py -v from worker lab; report exact outputs and git diff --check.
Budget: 15 active minutes; 2 justified fixes/problem; no delegation.
