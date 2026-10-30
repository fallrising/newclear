ROLE: WORKER
AGENT: native independent reviewer
ID: T-443
Goal: Independently audit Graphify M5 I-01–05 against code, real tests and evidence.
Why: Bounded traversal and hints must not overclaim completeness or leak stale results.
Inputs to read first: .team/graphify-t0443/PLAN.md; labs/graphify-lab/docs/milestones/change-impact.md; nearest AGENTS; current diff.
Scope (may touch): Only review report at .team/graphify-t0443/review.md; execute focused tests without changing source.
Out of scope (must not touch): Runtime, tests, spec, unrelated files, Git/remote writes, dependencies, credentials, recursive delegation.
Definition of done:
- [ ] Review directional traversal, completeness/truncation, ID ambiguity, hints, provenance, freshness and compatibility with M4.
- [ ] Run focused tests and inspect full-suite/regression evidence; report actionable findings with locations or ACCEPT.
- [ ] Report passed/failed/skipped checks truthfully using the report contract.
Verify with: .venv/bin/python -m unittest discover -s tests -p 'test_change_impact*.py' -v from labs/graphify-lab; inspect git diff and recorded gates.
Budget: 12 active minutes; one review pass and up to two targeted follow-ups for concrete fixes; no nested delegation or external/model calls.
