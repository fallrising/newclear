# Operational hardening verification

## Environment and source

- Spec: `specs/active/operational-hardening/spec.md`
- Base SHA: `9d0127a975cc8b5fed4c5de4adf1fc376885ed96`
- Checkpoint SHA: `f8fb2eae4dbe509b2dae83c88beca8a0274a180d`
- Verification time (UTC): `2026-09-03T05:53:04Z`
- Environment: local synthetic drill; no VPS or production credential

## Acceptance evidence

| Criterion | Status | Command or evidence | Exit code | Notes |
|---|---|---|---:|---|
| FR-2, FR-4 observability/evidence | pass | `PYTHONPATH=src python3 -m unittest tests.test_operations -v` | 0 | 8 strict metrics, quota, evidence, and readiness tests |
| FR-1, FR-3 hardening/drills | pass | `PYTHONPATH=src python3 -m unittest tests.test_hardening -v` | 0 | 19 contract, descriptor, restore, race, rotation, compromise, egress, and cost tests |
| FR-5 local hardening journey | pass | `PYTHONPATH=src python3 -m unittest tests.test_hardening_e2e -v` | 0 | repeated healthy journey returns only `DEVELOPMENT_COMPLETE`; failed controls cannot emit complete evidence |
| Repository regression gate | pass | `make check` | 0 | policy gate and 188 offline tests |
| Source SDD integrity | pass | `sha256sum -c docs/execution/sdd-source.sha256` | 0 | immutable source copy matched |

## Final assessment

- Gate: `CODE_COMPLETE_EXTERNAL_PENDING`
- External evidence still required: real ephemeral runner/VPS, OIDC broker,
  enforced egress proxy, telemetry collector/dashboard, backup restore,
  credential rotation, cost alerting, and compromise drill
- Risks and open questions: local configuration and simulation do not prove an
  operator or infrastructure enforced the controls
