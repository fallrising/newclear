ROLE: WORKER
AGENT: native independent reviewer
ID: T-003
Goal: Audit W-01–W-05 implementation, boundaries and evidence for T-0439.
Why: Independent acceptance before normal PR/CI/merge.
Inputs to read first: .team/graphify-t0439/PLAN.md; labs/graphify-lab/docs/milestones/local-workspace.md; current diff plus new workspace/trial/tests and evidence.
Scope (may touch): Read-only code/docs/evidence, focused tests; only ignored test output. Return report to parent, no file edits.
Out of scope (must not touch): Tracked files, Git mutations, dependency changes, external writes, nested agents. Do not rerun long complete suites without a concrete concern.
Definition of done:
- [ ] Local workspace wrappers correctly reuse cache, propagate Graphify ambiguity/no-match, validate parameters before indexing, verify source/context after excerpt.
- [ ] Snapshot MCP limitation is explicit; actual larger-component chain/source and mutation trial substantiated, not mocked success.
- [ ] No unrelated source changes; all assertions/metrics/unknowns and public evidence are honest; regression tests cover meaningful risk.
- [ ] Return ACCEPT or bounded must-fix findings and required-check evidence map. CI/merge remain parent-owned.
Verify with: .venv/bin/python -m unittest discover -s tests -p test_workspace.py -v; trial report/code inspection; python3 scripts/check_indexes.py; git diff --check.
Budget: 8 active minutes plus one focused follow-up for actual repairs. No delegation.
