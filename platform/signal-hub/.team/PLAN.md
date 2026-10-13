# M5 delivery plan

Objective: AC-10–14 archive, consistent backup and isolated restore while preserving M1–M4. Baseline 7e854f26ef66dd8e0aa6583011ef65ed35951ad7. Contract: [M5 design](../docs/m5-design.md), written before implementation. M4 records remain in reports and STATUS.

## Ownership and dependencies

Root owns this plan, design/contracts, integration, native checks, evidence gate, CI/publication and acceptance. Built-in workers inherit the session model; no external CLI routing or recursive delegation. Each has an isolated source-HEAD worktree, disjoint writable scope and bounded retries.

- T-501: durable identities, archive/verify/import and migration/policy/projection invariants.
- T-502: SQLite consistent backup/exclusive isolated restore, CLI and optional daily runtime maintenance. Depends on frozen T-501 interfaces.
- T-503: restored presentation plus genuine HTTP/archive/restore and Chromium journey. Depends on frozen CLI/metadata.
- T-504: independent read-only review of integrated code and adversarial probes, after implementation.

## Gates

1. Latest authorization/dependency/claim and scope conflict check: passed, claim published/read back before product edits.
2. Contract/design and worker scopes: design written; task validation pending.
3. Worker Red/Green evidence and scope review: pending.
4. Root Go/frontend/contracts/HTTP/Chromium/M5 drills: pending, exact commands in design.
5. Independent review and correction verification: pending.
6. Evidence gate, normal PR/required CI/merge/remote readback/post-merge checks: pending.
7. Durable evidence preservation and cleanup: pending.

No completion claim until checks have observed results. Failures/skips remain visible with the next action. No runtime dependency, real data/notification account, preexisting backup overwrite, offsite integration, M6, release or deployment.
