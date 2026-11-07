ROLE: WORKER
AGENT: native implementation worker
ID: T-002
Goal: Implement a repeatable real Graphify-assisted development investigation for the source helper refactor, with honest measurable evidence.
Why: T-0437 M2 tests whether graph navigation helps a concrete maintenance task beyond synthetic fixtures.
Inputs to read first: root and labs/graphify-lab AGENTS; labs/graphify-lab/docs/milestones/development-pilot.md; graphify_lab/__main__.py, cache.py, scenarios.py; tests/test_cli.py. Baseline source commit c31f0de93ddfdd5113f8db2e0a5e16fc206b2ca7. Existing Graphify 0.9.97 only.
Scope (may touch): In your isolated worktree ONLY labs/graphify-lab/graphify_lab/pilot.py and labs/graphify-lab/tests/test_pilot.py. Ignored work/ output is allowed. Return report to parent (do not write shared report).
Out of scope (must not touch): All other tracked files including source.py, __main__.py, Makefile, docs, CI, AGENTS, locks. No git commits/pushes/PRs, global config, new dependencies, model APIs, services or recursive delegation.
Definition of done:
- [ ] `python -m graphify_lab.pilot --baseline <full commit SHA> --out <new-run-dir>` freezes ONLY publicly tracked Python implementation and tests of graphify-lab from that exact commit through Git read operations. It never executes baseline code. Source manifest includes hashes and baseline SHA. Snapshot source and index separated.
- [ ] True Graphify code-only extraction/query and stdio MCP initialize/list/query run on that frozen real code; find node_at and source_excerpt definitions, relevant caller/test context, then read and verify exact source lines against AST. Do not silently count absent graph relationships as passed. Record limitations if parser lacks a relationship.
- [ ] Run bounded rg/source lookup on identical source; report command elapsed/output bytes and correctness separately. No agent productivity/causal speed claims. Token/provider request/cost null; include coverage/snapshot time. Full graph/source output must sanitize run/local absolute paths before tracked reports.
- [ ] Preserve existing output dirs, reject destination overlapping live source/tests or cache, validate full SHA, deterministic pure validation tests plus at least one true extraction/MCP execution. No mocked graph/MCP success.
- [ ] Return exact commands and results; concise failures and remaining issues; test-first when practical. Shared interpreter is /home/ckc/test/codex/wt/newclear/graphify-pilot-20261029/labs/graphify-lab/.venv/bin/python. Workdir must be your lab, imports use your code. Parent will integrate and run complete suite/CI.
Verify with: shared-interpreter -m unittest discover -s tests -p test_pilot.py -v; shared-interpreter -m graphify_lab.pilot --baseline c31f0de93ddfdd5113f8db2e0a5e16fc206b2ca7 --out work/pilot-worker; git diff --check.
Budget: 20 active minutes target; report checkpoint if implementation cannot finish. At most two justified fixes for same failure. Native tools only. No nested workers. Do not broaden design into benchmark platform. Parent owns integration/refactor/docs/CI/delivery.
