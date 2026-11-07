# T-0439 local workspace

Owner: continue Graphify development with normal milestone PR/merge. Desk #301 claimed. Scope: docs/milestones/local-workspace.md W-01–05. Start 2026-10-29T17:33:47Z; estimated active 45–75min, checkpoint20min; native agents only, two justified retries/problem, CI15min/head. No dependency upgrades, provider calls, global config, tags/deployment.

- Parent: docs/spec/BOARD, CI, integration, delivery and ledger.
- Acceptance worker: workspace_trial.py + test_workspace_trial.py in separate worktree; real project source remains read-only.
- Worker: workspace.py + test_workspace.py only in isolated worktree. No nested workers.
- Independent reviewer: read-only final diff/evidence and focused tests.
- Gates: relevant regression RED/GREEN; true Graphify workspace trial including mutable-copy invalidation and real component calls/MCP; existing tests/7scenarios/M2pilot; index/workflow checks; independent review; normal PR/CI/merge/readback.
- Accounting: native launches counted; provider requests/tokens/cost unknown/null; full outer/nested historical tool counts unknown unless measured. Track real operation count in trial only.
- Status: claimed; design recorded before runtime edits. No milestone acceptance yet.

Preparation note: initial parent trial-file command used repo-relative paths from lab cwd, created no files; discovery found zero tests (exit 5). Corrected task routing to isolated acceptance worker; not counted as product test success.

## Integration observations

- Wrapper worker passed 12 true-engine tests. Parent accepted narrow two-file diff for integration; final independent review remains required.
- New llms local-workspace link initially failed before new docs were staged (validator uses Git index); staged explicit new files, native gate now passes. Not a runtime failure.
- Trial sandbox MCP initialization timed out as known environment constraint; native execution initializes successfully. Native whole-path shortest_path used file containment, not the known calls chain. Preserve failed report and actual route; validate calls chain using directed graph edges plus AST and MCP adjacent calls steps. This corrects the oracle without claiming native shortest_path filters calls; W-04's known call chain and real MCP query remain required.

## Parent verification

Integrated source accepted after inspecting worker diffs and true reports. `make check`:56 passed/38.460s; full:7 passed/0failed; M2 pilot:passed; parent workspace trial:passed,13CLI/6MCP/8.655174s. Native execution used because sandbox stdio handshake timed out; this is preserved, not hidden. Public compact evidence retains raw report digests and original containment-path observation. Independent final review and remote CI/merge pending.

Independent reviewer ACCEPT plus final evidence/doc follow-up ACCEPT: no must-fix;1,438 retained values/31 digests verified. Parent evidence gate accepts bounded worker results. Current W-05 pending remote CI/merge/readback, not local implementation.
