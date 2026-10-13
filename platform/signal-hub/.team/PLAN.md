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
2. Contract/design and worker scopes: design committed before workers (2b3cd3ce); all three task validators passed.
3. Worker Red evidence observed: permanent dedup after hot deletion, maintenance CLI dispatch, restored UI marker. All three scoped implementations integrated and root diff-reviewed; original failures remain in worker reports/capsules.
4. Root command race (3.616s), actual recovery (0.265s), vet/build/format, 28 frontend tests/types/format/build, contracts (64 fixtures), existing HTTP (34+39+69) and M5 HTTP (61 plus17 CLI outcomes) passed. Full Go race running; Chromium remains CI-owned (local missing libnspr4). Exact commands in design.
5. Independent review and correction verification: pending.
6. Evidence gate, normal PR/required CI/merge/remote readback/post-merge checks: pending.
7. Durable evidence preservation and cleanup: pending.

No completion claim until checks have observed results. Failures/skips remain visible with the next action. No runtime dependency, real data/notification account, preexisting backup overwrite, offsite integration, M6, release or deployment.

Design clarification: “projection scans exclude restored” means delivery only. Normal rule evaluation and new-version backfill preserve existing hot-data semantics, including restored rows; otherwise a later tick could erase manual-backfilled current-window results. Worker notified before evaluator edits.

Early root review required two preservation details: reject recomputation over unimported archived gaps so retained rollups cannot become false zeros, and sync newly created archive-root parent directory links before committing purge. Backup review also requested rejecting unrelated existing SQLite files in maintenance OpenExisting. All three protections now have regression coverage; focused archive suite and root integration pass.
