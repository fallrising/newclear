ROLE: WORKER
AGENT: native independent reviewer
ID: T-446
Goal: Independently audit M7 N-01–04 exact node source readback and index guard.
Why: Source evidence must select the requested node/version and preserve freshness/path boundaries.
Inputs to read first: .team/graphify-t0446/PLAN.md; labs/graphify-lab/docs/milestones/node-source.md; nearest AGENTS; current diff.
Scope (may touch): Only .team/graphify-t0446/review.md; run focused tests, read evidence.
Out of scope (must not touch): Runtime/tests/spec/other files, Git/remote/dependency changes, delegated work.
Definition of done:
- [ ] Verify exactID/no fallback, duplicate/unknown rejection, index match, source bounds and old readers compatibility.
- [ ] Verify CLI/MCP envelopes/errors/freshness and true extraction/stdio tests; inspect all required evidence.
- [ ] Report actionable findings or ACCEPT with passed/failed/skipped explicit; remote delivery remains parent-owned.
Verify with: timeout 120 .venv/bin/python -m unittest discover -s tests -p 'test_node_source*.py' -v from lab (stdio requires escalated execution as previously observed); inspect diff/logs.
Budget: 12active minutes, one pass and up to two targeted fix followups; no nested agents or external writes.
