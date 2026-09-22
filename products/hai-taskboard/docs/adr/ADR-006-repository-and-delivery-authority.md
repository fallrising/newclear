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

`docs/tasks` holds immutable product task contracts and acceptance oracles. `.team/tasks` holds
orchestrator-owned one-run worker envelopes; `.team/reports` holds evidence. Only `.team/PLAN.md`
contains mutable bootstrap execution status. A worker cannot accept its own report. Once dogfooding
is deliberately activated, execution-state authority migrates once to SQLite.

## Consequences

- A stopped session resumes from PLAN, accepted ADRs, traceability and HANDOFF rather than chat.
- Product contracts can be versioned without competing mutable status fields.
- Shared abstractions are extracted only after demonstrated compatible use, not pre-emptively.
