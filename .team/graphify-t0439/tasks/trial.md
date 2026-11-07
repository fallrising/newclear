ROLE: WORKER
AGENT: native acceptance worker
ID: T-002
Goal: Add repeatable real-component acceptance for local workspace CLI/MCP.
Why: W-04 needs evidence on larger real tools/codex-usage, not only a small fixture.
Inputs to read first: parent docs/milestones/local-workspace.md; source helpers and pilot.py; tools/codex-usage/codex_usage.py; workspace worker interface below. Read parent's documents by absolute path if absent in your base.
Scope (may touch): ONLY labs/graphify-lab/graphify_lab/workspace_trial.py and labs/graphify-lab/tests/test_workspace_trial.py in your isolated worktree; ignored work output. No nested workers or Git mutations.
Out of scope (must not touch): workspace.py (other worker owns), existing modules/tests, docs/CI/AGENTS/dependencies, external services, real codex-usage source; never execute it.
Definition of done:
- [ ] `python -m graphify_lab.workspace_trial --out <new-dir>` uses actual REPO/tools/codex-usage through CLI `python -m graphify_lab.workspace --source <path> --cache <outside> locate/query/explain/source/serve`. Locate JSON is ensure_index dict top level. New workspace module will arrive from other worker; use parent's interpreter and PYTHONPATH/temporary untracked copy for integration if needed, never alter worker's files.
- [ ] Two consumers share physical graph/index id; helpers normalize_rates → norm_window → remaining_percent have directed calls edges, AST verified source lines via CLI, query/explain context. True wrapper serve MCP initialize/list/query/shortest_path confirms chain. Existing source fingerprint before/after equal.
- [ ] Copy codex_usage.py to output/mutable, index it, rename remaining_percent to remaining_quota only in copy, open again; new index, new symbol/old absent, old graph retained. Do not execute project source. Source/index/cache separate.
- [ ] Compact portable report with corpus fingerprint/Git commit, counts/hash, exact real checks, per-operation time/bytes; provider/tokens/cost null, no speed/token claims. Retain errors in failed report. Guard new output: no overwrite/overlap with code/tests/fixtures/env/target source, including symlinks.
- [ ] At least meaningful deterministic output-boundary tests; real trial passes once workspace.py available. Bounded command timeouts/MCP overall timeout. Report known snapshot-at-start limitation, no global configuration.
Verify with: shared interpreter -m unittest discover -s tests -p test_workspace_trial.py -v; shared interpreter -m graphify_lab.workspace_trial --out work/workspace-trial; git diff --check. Parent integrates full tests and CI.
Budget: 15 active minutes target, 2 justified repairs/problem. No nested delegation. Ask parent if wrapper not available before integration; continue static tests in meantime.
