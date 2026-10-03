# ADR-003: Outbox dispatch, fencing leases and explicit unknown outcomes

Status: Accepted at G0 for P0-A
Date: 2026-09-05

## Context

The application cannot atomically commit SQLite state and an external executor action. A timeout,
process crash or expired lease does not prove whether side effects happened or stopped.

## Decision

Create Runs and dispatch intents transactionally, then claim and invoke them outside the transaction.
Every claim advances a monotonic lease epoch. Start acknowledgement, heartbeats, observations and
terminal results carry the epoch; stale publishers are rejected. Persist desired action, dispatch,
lease, observed outcome and reconciliation as separate dimensions.

Lease expiry moves a Run to reconciliation. It never establishes cancellation and never permits
automatic retry when side effects may be unknown. Cancellation is intent until the adapter confirms
it. P0-A uses a deterministic Fake adapter capable of generating all recovery states without host
shell or network access.

## Consequences

- Recovery is explicit and auditable rather than guessed from worker liveness.
- Some Runs require operator resolution (`OutcomeUnknown`).
- A real adapter remains behind a separate G2 authorization gate.
