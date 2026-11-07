ROLE: WORKER
AGENT: native bounded implementation
ID: T-001
Goal: Implement a local mutable-workspace CLI reusing the existing Graphify cache and source helpers.
Why: T-0439 adds practical local use beyond registered immutable references.
Inputs to read first: root/lab AGENTS; parent's labs/graphify-lab/docs/milestones/local-workspace.md and .team/graphify-t0439/PLAN.md (absolute parent worktree path given in message); existing cache.py, source.py, __main__.py, tests.
Scope (may touch): Only labs/graphify-lab/graphify_lab/workspace.py and labs/graphify-lab/tests/test_workspace.py in your isolated worktree; ignored scratch allowed. Return report in message.
Out of scope (must not touch): All other tracked files, Git commits/push/PR, dependencies, global config, external services, nested delegation.
Definition of done:
- [ ] `python -m graphify_lab.workspace --source <explicit dir> --cache <outside path> locate|query <symbol>|explain <id>|source <label> [--file] [--lines]|serve` works; use same default cache as existing CLI. No implicit source or fetch. Locate JSON is the ensure_index dict at top level (source,graph,index_id,cache_hit,source_fingerprint,source_commit...), optionally additive provenance fields.
- [ ] Reuse ensure_index and source helpers. Stable source ID derived canonical path; mutable source allowed, fresh per-operation source/context identity. Never modify source. Bad options checked before indexing. Missing/non-directory source, nested cache, corrupt graph fail clearly.
- [ ] source operation validates fingerprint AND context after excerpt read before printing; concurrent change fails. Query uses real isolated Graphify command; serve execs true graphify.serve in existing env, documents frozen startup snapshot in help.
- [ ] Meaningful RED/GREEN regressions for real extraction/shared hit/rename invalidation and option/containment/ambiguity bounds; failure injection permitted only to exercise race path, not fake Graphify success.
- [ ] Return exact commands, results, failures and limits. Root integrates/trials/CI/docs.
Verify with: shared interpreter -m unittest discover -s tests -p test_workspace.py -v; CLI locate/query/source on tiny real Python fixture; git diff --check.
Budget: 15 active minutes target; at most two justified attempts per failure; stop/report if new scope required. No nested workers.
