# ADR-006: Product placement and document/worker authority

Status: Accepted at G0 for P0-A
Date: 2026-09-05

## Context

The monorepo contains products, apps, platforms, labs and specs with adjacent agent/canvas ideas.
HAI Taskboard also needs durable product task contracts and temporary multi-agent execution envelopes
without creating two editable task-status systems.

## Decision

Place the component at `products/hai-taskboard`: it is a user-facing delivery control plane with its
own web UI, service and durable data. Existing Fanzloud, Loom, Bee Swarm and Fleet code is not copied
until a review records a compatible ownership/license/test boundary.

`docs/tasks/HTB-P0A-*.md` holds immutable product task contracts and acceptance oracles.
Current bootstrap execution status is recorded only in `docs/tasks/BOARD.md`. Root `.team/PLAN.md`
records routing, review and acceptance rationale; root-scoped worker envelopes/reports support
that routing. The archived product ledger remains immutable. A worker cannot accept its own report.
A future migration of execution-status authority to SQLite requires an explicit decision.

Amendment 2026-10-30: owner approved C01 in the [M0 decision record](../plans/m0-contract-decisions-20261029.md).
Original G0 acceptance is retained; this does not claim dogfooding or an authority migration occurred.

## Consequences

- A stopped session resumes from BOARD, accepted ADRs, traceability and HANDOFF rather than chat.
- Product contracts can be versioned without competing mutable status fields.
- Shared abstractions are extracted only after demonstrated compatible use, not pre-emptively.
