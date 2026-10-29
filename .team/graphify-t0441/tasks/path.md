ROLE: WORKER
AGENT: native
ID: T-002
Goal: Implement deterministic bounded directed calls-only paths.
Why: L-03 native shortest path mixes containment.
Inputs to read first: Parent .team/graphify-t0441/PLAN.md and labs/graphify-lab/docs/milestones/live-workspace.md; existing workspace/cache/source helpers; local AGENTS.
Out of scope (must not touch): Other tracked files, Git mutations, dependencies, external writes, nested agents.
Scope (may touch): graphify_lab/call_paths.py and tests/test_call_paths.py under labs/graphify-lab in assigned worktree only.
Definition of done:
- [ ] calls_path(graph:dict, source:str,target:str,max_hops:int=32,max_visited:int=10000)->dict using exactID then unique exactlabel, ValueError for unknown/ambiguous/invalid bounds. Real directed calls only; output status found/not_found/limit_reached, path nodes and edges for found, hops and direction/relation metadata.
- [ ] Bounds1..100hops,1..100000visited, rejectbool/nonints; cycle-safe deterministic BFS, no false not_found when bounded; source==target0hop.
- [ ] Tests real extracted Graphify graph including chain, reversed, contains-only, ambiguous label, cycle, limits; small hand-built graph only supplementary algorithm edges, not parser substitute. RED then GREEN.
Verify with: shared parent .venv/bin/python -m unittest discover -s tests -p test_call_paths.py -v from worker lab; git diff --check.
Budget: 12 active minutes;2 justified fixes/problem; no delegation.
