# HTB-P0A-001: Deterministic domain kernel

## Goal

Implement typed IDs, WorkItem/Run state, blockers, immutable completion subjects, transition commands,
idempotency semantics and deterministic graph/impact logic as pure Go packages with no database,
network, filesystem, clock or executor dependency.

## Inputs

- `docs/SDD.md`
- ADR-002, ADR-004
- `docs/sdd/domain-and-gates.md`, `docs/sdd/reconciliation.md`
- HAI-DOMAIN, HAI-STATE, HAI-DONE and HAI-RECON traceability clauses

## Scope

`backend/internal/domain/**`, `backend/internal/reconcile/**`, related tests and generated contract
fixtures explicitly named by the worker envelope.

## Acceptance

- Table/property tests cover legal and illegal transitions without a duplicate production oracle.
- Completion subject canonicalization and every non-passing evidence state are tested.
- Blockers remain an orthogonal set; retry creates a new Run identity.
- Graph cycle diagnostics, old+new closure, deterministic ordering, stale plan and reuse fingerprint
  cases pass with injected input only.
- `go test`, `go test -race` and `go vet` for the module pass in the pinned Go 1.27.1 container.

## Forbidden

No SQLite, HTTP, React, provider, shell, network, credential, merge/deploy/release or external mutation.
