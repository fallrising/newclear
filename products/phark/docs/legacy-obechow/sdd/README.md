# Obechow SDD

This directory is the execution authority for new delivery phases.

The document order is:

1. the node spec defines observable behaviour and scope;
2. the implementation plan defines design, ownership, and rollback;
3. the test plan maps every behaviour to evidence;
4. task specs bound individual implementation changes;
5. a verification report records results without changing requirements.

`docs/TECH_SPEC.md` remains the product and architecture overview. An SDD node
may refine one delivery phase, but it must not silently expand the MVP product
scope. If implementation needs a different observable contract, update and
review the node spec before changing production files.

## Status lifecycle

`draft → ready → implementing → verifying → done`

No implementation task starts before its node is `ready`. A node is `done` only
after its verification report is committed with reproducible evidence.

## Delivery nodes

| Node | Status | Boundary |
|---|---|---|
| [P04](./P04-ci-cd.md) | done | GHCR publication and disabled-by-default SSH workflow |
| [P05](./P05-vps-deployment-bundle.md) | done | immutable single-VPS bundle without host mutation |
| [P06](./P06-rollout-readiness.md) | done | read-only host preflight and isolated local rehearsal; no live rollout |
