ROLE: WORKER
AGENT: native independent reviewer
ID: T-444
Goal: Audit M6 CLI analysis C-01–04 against code, tests and evidence.
Why: Exit codes, stdout atomicity and freshness must be safe for scripts.
Inputs to read first: .team/graphify-t0444/PLAN.md; labs/graphify-lab/docs/milestones/cli-analysis.md; nearest AGENTS; current diff.
Scope (may touch): Only .team/graphify-t0444/review.md; execute focused tests, read artifacts.
Out of scope (must not touch): Runtime/tests/spec, other files, Git/remote changes, new dependencies, delegation.
Definition of done:
- [ ] Verify true CLI/provenance parity, exits and pre-index validation, fresh reads including callback errors, existing commands compatibility.
- [ ] Run focused tests and inspect final gate artifacts; report actionable findings or ACCEPT.
- [ ] Preserve failed/skipped checks; remote delivery remains orchestrator-owned.
Verify with: timeout 120 .venv/bin/python -m unittest discover -s tests -p test_workspace_analysis.py -v from lab; git diff; evidence artifacts.
Budget: 10 active minutes, one review and up to two targeted fix follow-ups; no nested agents or remote writes.
