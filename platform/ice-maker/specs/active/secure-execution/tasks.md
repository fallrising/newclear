# Secure single-agent execution executable tasks

- [x] T-008 Implement contract, bounded process, redaction, and path policy
  - Depends on: Phase 1
  - Allowed paths: `src/ice_maker/execution.py`, `tests/test_execution.py`, `.team/reports/T-008.md`
  - Acceptance: malformed contracts, timeout, output/secret leakage, forbidden paths, symlinks, and stale base SHA fail closed.
  - Suggested role: architect/security builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_execution -v`

- [x] T-009 Add disposable worktree, sandbox command, and Codex adapter
  - Depends on: T-008
  - Allowed paths: `src/ice_maker/runner.py`, `src/ice_maker/adapters.py`, `runner/**`, `tests/test_runner.py`, `docs/runbooks/runner.md`
  - Acceptance: temporary Git jobs are isolated/cleaned; sandbox is deny-by-default and adapter doctor/argv are verified without secrets.
  - Suggested role: primary builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_runner -v`

- [x] T-010 Orchestrate gates and build safe PR evidence
  - Depends on: T-009
  - Allowed paths: `src/ice_maker/orchestrator.py`, `src/ice_maker/publisher.py`, `tests/test_orchestration.py`, `.github/workflows/agent.yml`, `orchestration/policies/protected-paths.json`, `docs/verification/phase-2.md`
  - Acceptance: a synthetic job reaches publish-ready only after gates; failures cannot target main, merge, deploy, or retain a dirty worktree.
  - Suggested role: primary builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_orchestration -v && make check`

## Task-to-requirement mapping

| Task | Requirements | Acceptance evidence |
|---|---|---|
| T-008 | FR-1, FR-2, FR-5 | execution security tests |
| T-009 | FR-3, FR-4 | isolated runner and adapter tests |
| T-010 | FR-5, FR-6 | synthetic orchestration and workflow gate |
