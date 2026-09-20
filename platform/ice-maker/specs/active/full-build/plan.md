# Full Build Plan

## Design

A Python standard-library CLI owns deterministic SDD and knowledge operations.
SQLite WAL stores local ledger/index state. Agent CLIs sit behind subprocess
adapters and a deny-by-default path/data policy. Synthetic fixtures exercise the
entire local flow. Publications are generated from source manifests.

## Requirement mapping

| Requirement | Change boundary | Evidence | Rollback |
|---|---|---|---|
| FR-0 | ADRs, schemas, policy, GitHub governance | schema/security tests | revert Phase 0 checkpoint |
| FR-1 | SDD CLI/templates | lifecycle tests and CI | revert Phase 1 checkpoint |
| FR-2 | executor/sandbox/gates/evidence | adversarial unit/integration tests | revert Phase 2 checkpoint |
| FR-3 | adapters/router/budget/reviewer | mocked contracts plus live doctor smoke | revert Phase 3 checkpoint |
| FR-4 | ingest/OCR/index/privacy | synthetic text/scanned PDF E2E | revert Phase 4 checkpoint |
| FR-5 | retrieval/promotion/reports | synthetic knowledge E2E | revert Phase 5 checkpoint |
| FR-6 | compiler/manifests | delete-and-rebuild test | revert Phase 6 checkpoint |
| FR-7 | ops controls/runbooks | local drills and static config tests | revert Phase 7 checkpoint |

## Constraints

- Protected paths are authorized only for Phase 0–2 task allowlists.
- No new production dependency without separate approval.
- No secret, real sensitive data, deployment, merge, or direct push to `main`.
- Phase gates must distinguish local pass from external operational evidence.

## Steps

Implement one independently tested vertical slice per phase, then run the broader
gate, review the diff, commit, push, confirm remote SHA, and update the one PR.

## Verification

`make check` is the evolving CI-equivalent gate. Phase verification files record
focused commands, exit codes, acceptance mappings, risks, and external gates.
