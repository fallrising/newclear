# HTB-P0A-004: Reconciliation, restore and durable handoff

## Goal

Complete spec import/ImpactPlan activation, backup/restore fencing, projection rebuild and bounded
ContextPack/HANDOFF generation so a fresh context resumes safely without old chat.

## Inputs

- Accepted ADR-001/003/004/005
- `docs/spec-graph.yaml`
- reconciliation and persistence mini-SDDs
- verified HTB-P0A-003 slice

## Scope

Spec import, impact, backup/restore, projection rebuild, ContextPack generation, UI integration and
tests explicitly named by the worker envelope.

## Acceptance

- Unapproved/import-crashed candidates cannot change accepted graph.
- Old+new reverse closure invalidates exactly declared consumers with explainable cause paths.
- Stale ImpactPlan/in-flight Candidate cannot activate, publish or complete.
- Restore verifies materials, advances restore generation/stream epoch and fences old callbacks.
- Fresh-context acceptance identifies the next allowed action from durable state and refuses a stale
  ContextPack until refreshed.

## Forbidden

No semantic equivalence, AI-accepted edges, real provider, cross-project graph or production restore.
