# Phase 0 Verification

- Date: 2026-09-02 (Europe/Berlin)
- Status: `CODE_COMPLETE_EXTERNAL_PENDING`
- Specification: `SDD-FULL-BUILD`, FR-0
- Decision owner: repository owner (`fallrising`)

## Acceptance

| Requirement | Status | Evidence |
|---|---|---|
| Private repository, seed-only `main`, integration branch, and one draft PR | pass | GitHub reports a private repository; PR #1 is draft from `build/full-sdd` to `main` |
| Branch protection | external-pending | GitHub returned HTTP 403 because private-repository protection requires a paid plan; repository visibility was not weakened |
| Runner, storage, credential/data, and provider decisions | pass | ADR-0001 through ADR-0004 are accepted and identify `fallrising` as owner |
| Root instructions, templates, task/result schemas | pass | repository files exist; JSON parsing is enforced by `make check` |
| Provider/data classification matrix and protected-path controls | pass | deny-by-default policy, matching CODEOWNERS files, and path coverage checks |
| Critical development risks treated | pass | synthetic-only data, fail-closed external routing, secret scanning, immutable SDD hashes, and local review controls are active |
| Model CLI identifiers and non-interactive access observed | pass | timestamped, non-secret doctor matrix in `docs/execution/preflight.md` |

## Deterministic verification

- `python3 -m unittest tests.test_phase0_contracts -v` — passed, 7 tests.
- `make check` — passed; repository checks and 7 tests.
- `git diff --check` — passed.
- `diff -qr <knowledge-pipeline-sdd-checkout> docs/sdd` — passed.
- `sha256sum -c docs/execution/sdd-source.sha256` — passed, 11 files.
- `docker ps --format ...` — passed; local daemon reachable. Running containers
  are unrelated and were not modified.
- `gh repo view` and `gh pr view 1` — passed; private repository and draft PR
  topology confirmed without exposing credentials.

## Threat review

| Risk | Severity | Treatment | Remaining gate |
|---|---|---|---|
| Credential or private-data disclosure | critical | secret-like content gate, deny-by-default provider matrix, synthetic fixtures only | production secret injection and rights approval |
| Agent modification outside task scope | critical | per-task allowlists, isolated worktrees, orchestrator diff review | runtime enforcement arrives in Phase 2 |
| Source/specification tampering | high | immutable copy plus checked SHA-256 manifest | remote enforcement unavailable |
| Direct changes to `main` or protected paths | high | integration-only workflow, CODEOWNERS, local policy gate, human merge | server-side branch protection unavailable on current plan |
| Host or network escape | critical | no production credentials, local-only development, deny-by-default decision | disposable runner and egress evidence in Phases 2 and 7 |

No untreated critical risk is accepted for local synthetic development. The
external gates above block real data, production credentials, deployment, and a
`PRODUCTION_READY` claim; they do not block the independent deterministic work in
Phase 1.
