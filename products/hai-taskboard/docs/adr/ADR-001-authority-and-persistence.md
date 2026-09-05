# ADR-001: State-first authority with transactional audit

Status: Accepted at G0 for P0-A
Date: 2026-09-05

## Context

HAI Taskboard must resume without chat history, preserve accountability and recover external work.
The reviewed draft mixed immutable Git specifications, operational state, event-style audit and
rebuildable UI projections without closing their transaction boundaries.

## Decision

Use normalized SQLite current state as the operational authority. Store accepted bindings to
immutable Git specification bytes in SQLite. Commit aggregate mutation, idempotency result, audit
entry and outbox intent atomically. Dispatch external work after commit. Store large immutable
artifacts in a digest-addressed filesystem store and bind them from SQLite only after atomic
publication. Treat projections as rebuildable.

Audit is an append-only accountability ledger, not the state source for arbitrary event replay.
Backup/restore uses SQLite plus the artifact manifest. Bootstrap status uses `.team/PLAN.md` until a
single explicit authority migration; Markdown and SQLite are never bidirectionally synchronized.

## Consequences

- Command invariants have one transactional boundary.
- Git import and artifact publication are explicit multi-step protocols with recoverable orphans.
- Full time travel and event-sourced replay are not promised.
- Driver, engine version, WAL/concurrency and online backup behavior still require ADR-005 evidence.

## Rejected alternatives

- Full event sourcing in P0-A: complexity without a current product requirement.
- Git/Markdown operational state: poor concurrency, leases and idempotency semantics.
- Dual mutable task status in `docs/tasks` and `.team/tasks`: creates split authority.
