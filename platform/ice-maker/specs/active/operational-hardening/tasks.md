# Operational hardening executable tasks

- [x] T-024 Add observability, quotas, and evidence semantics
  - Depends on: Phase 6
  - Allowed paths: `src/ice_maker/operations.py`, `tests/test_operations.py`, `ops/observability/*.json`, `.team/reports/T-024.md`
  - Acceptance: strict metric/dashboard configuration yields bounded deterministic snapshots, fail-closed quotas, and immutable local evidence that cannot claim production readiness.
  - Suggested role: security-sensitive builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_operations -v`

- [x] T-025 Add hardening contracts and local drill primitives
  - Depends on: Phase 6
  - Allowed paths: `src/ice_maker/hardening.py`, `tests/test_hardening.py`, `ops/hardening/*.json`, `.team/reports/T-025.md`
  - Acceptance: ephemeral/OIDC/egress contracts and restore, rotation, compromise, egress, and cost controls fail closed under adversarial local tests.
  - Suggested role: security-sensitive builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_hardening -v`

- [x] T-026 Prove the local Phase 7 journey
  - Depends on: T-024, T-025
  - Allowed paths: `tests/test_hardening_e2e.py`, `docs/runbooks/operational-hardening.md`, `.team/reports/T-026.md`
  - Acceptance: tracked contracts compose all local drills and return only `DEVELOPMENT_COMPLETE`, with exact external production gates documented.
  - Suggested role: routine builder
  - Max attempts: 2
  - Required commands: `PYTHONPATH=src python3 -m unittest tests.test_hardening_e2e -v && make check`

## Task-to-requirement mapping

| Task | Requirements | Acceptance evidence |
|---|---|---|
| T-024 | FR-2, FR-4 | strict metrics, quota, evidence, and readiness tests |
| T-025 | FR-1, FR-3 | config validation and adversarial local drill tests |
| T-026 | FR-5 | complete local hardening journey and runbook |
