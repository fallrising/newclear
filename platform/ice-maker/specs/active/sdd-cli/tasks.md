# Deterministic SDD lifecycle CLI executable tasks

- [x] T-005 Implement constrained front matter and SDD validation
  - Depends on: Phase 0
  - Allowed paths: `pyproject.toml`, `src/ice_maker/**`, `tests/test_sdd_validation.py`
  - Acceptance: valid templates pass; malformed fields and unsafe paths fail with deterministic diagnostics.
  - Suggested role: builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_sdd_validation -v`

- [x] T-006 Implement `init/new/validate/status`
  - Depends on: T-005
  - Allowed paths: `src/ice_maker/**`, `tests/test_sdd_cli.py`, `README.md`
  - Acceptance: a temporary repository completes the four-command lifecycle and overwrite/path failures are tested.
  - Suggested role: builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_sdd_cli -v`

- [x] T-007 Wire active-SDD validation into CI-equivalent checks
  - Depends on: T-006
  - Allowed paths: `Makefile`, `.github/workflows/ci.yml`, `scripts/check_repo.py`, `tests/test_phase1_ci.py`
  - Acceptance: `make check` validates all active SDDs and an invalid fixture exits non-zero.
  - Suggested role: builder
  - Max attempts: 2
  - Required commands: `python3 -m unittest tests.test_phase1_ci -v && make check`

## Task-to-requirement mapping

| Task | Requirements | Acceptance evidence |
|---|---|---|
| T-005 | FR-3 | validator unit tests |
| T-006 | FR-1, FR-2, FR-3, FR-4 | lifecycle CLI tests |
| T-007 | FR-5 | CI contract tests and full gate |
