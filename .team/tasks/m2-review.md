ROLE: WORKER
AGENT: native independent reviewer
ID: T-003
Goal: Audit complete M2 source helper extraction and real-development pilot against P-01–P-05.
Why: Ensure graph and cost evidence substantiate only the actual bounded experiment.
Inputs to read first: .team/graphify-t0437/PLAN.md; labs/graphify-lab/docs/milestones/development-pilot.md; current git diff and untracked pilot/source/tests; docs/evidence/development-pilot. Desk T-0437 and owner authorize PR/merge, no release.
Scope (may touch): Read-only all relevant files, run focused tests and inspect existing evidence; return report to parent, no files written except ignored test scratch.
Out of scope (must not touch): Tracked files, Git mutations, external writes, dependencies, nested workers. Do not rerun full extraction/MCP without specific evidentiary need.
Definition of done:
- [ ] Verify extracted helpers preserve behavior and legacy imports, regression meaning, public-source boundaries.
- [ ] Verify true graph/MCP evidence, correctness oracle, absent edges and benchmark limits; source SHA/hashes and sanitization.
- [ ] Inspect runner negative paths and no-overwrite behavior; identify must-fix bugs without expanding into benchmark platform.
- [ ] Return ACCEPT or concrete findings, required-check map, exact commands and passed/failed status. CI/merge pending must remain explicit.
Verify with: .venv/bin/python -m unittest discover -s tests -v; python3 scripts/check_indexes.py; git diff --check; inspect reports and code.
Budget: 10 active minutes, one focused follow-up for actual changes; no recursive delegation. Use existing environment.
