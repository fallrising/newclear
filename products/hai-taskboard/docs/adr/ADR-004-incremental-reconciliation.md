# ADR-004: Deterministic declared-dependency invalidation

Status: Accepted at G0 for P0-A
Date: 2026-09-05

## Context

Reusing work after a specification change is valuable, but semantic inference in P0 would make
staleness difficult to explain and verify. Considering only the new graph can miss nodes affected by
removed or redirected edges.

## Decision

Use operator-accepted typed DAG edges. Build each ImpactPlan from direct binding/byte changes plus
the union of the old and proposed graphs' reverse transitive closures. Bind the plan to both graph
revisions, ordered impacted nodes and algorithm version. Activation uses optimistic base revision
and exact plan digest.

Reuse requires identity across candidate/input, required AC set, dependency revision, policy,
recipe/environment, adapter version and verifier class. Overrides are reasoned, subject-bound audit
decisions; they cannot create evidence or bypass completion.

## Consequences

- P0 invalidation is deterministic, explainable and testable.
- Changes in graph topology invalidate correctly even when an edge disappears.
- Semantic equivalence and AI-suggested accepted edges remain deferred.
