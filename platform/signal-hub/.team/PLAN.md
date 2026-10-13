# M5 delivery plan

Objective: AC-10–14 archive, consistent backup and isolated restore while preserving M1–M4. Baseline 7e854f26ef66dd8e0aa6583011ef65ed35951ad7. Contract: [M5 design](../docs/m5-design.md), written before implementation. M4 records remain in reports and STATUS.

## Ownership and dependencies

Root owns this plan, design/contracts, integration, native checks, evidence gate, CI/publication and acceptance. Built-in workers inherit the session model; no external CLI routing or recursive delegation. Each has an isolated source-HEAD worktree, disjoint writable scope and bounded retries.

- T-501: durable identities, archive/verify/import and migration/policy/projection invariants.
- T-502: SQLite consistent backup/exclusive isolated restore, CLI and optional daily runtime maintenance. Depends on frozen T-501 interfaces.
- T-503: restored presentation plus genuine HTTP/archive/restore and Chromium journey. Depends on frozen CLI/metadata.
- T-504: independent read-only review of integrated code and adversarial probes, after implementation.

## Gates

1. Latest authorization/dependency/claim and conflict check: passed; claim published/read back before product edits.
2. Design/contracts and bounded worker scopes: design committed at2b3cd3ce before dispatch; all task/report validators passed. Three implementation leaves plus independent T-504 and bounded T-506/T-507 correction/closure.
3. Actual diff/scope and root evidence gate: accepted as integrated at corrected product e4d4cbca92096d2b8028246b6e6cdd61872e7324. Original PARTIAL/failure reports remain historical; central observed checks close their integration limits.
4. Native gates:10 Go race packages (root store356.341s), vet/format/build,28 frontend tests/types/format/build,64 contract fixtures, existing HTTP34+39+70 and M5 HTTP61/CLI17, real TLS process recovery, actionlint and validators passed.
5. Independent review: T-504 R1 rejected initial candidate; T-506 fixes it and T-507 repeats all seven unchanged probes successfully. No remaining blocker.
6. Product CI38397285845: all gates passed on e4d4cbca, including9 sandboxed Chromium journeys, desktop/390px artifacts and browser-health assertions. Final documentation preserves product bytes. Normal integration and final-head/postmerge checks are reconciled through [PR #352](https://github.com/fallrising/newclear/pull/352); never use this product acceptance as a merge/CI bypass.
7. Durable evidence: root preserves original Red/failures, worker source capsules, unchanged independent probes, native/CI logs and screenshots with README/SHA256 manifest before worktree cleanup; final integration receipts remain in the owner handoff.

No completion claim until checks have observed results. Failures/skips remain visible with the next action. No runtime dependency, real data/notification account, preexisting backup overwrite, offsite integration, M6, release or deployment.

Design clarification: “projection scans exclude restored” means delivery only. Normal rule evaluation and new-version backfill preserve existing hot-data semantics, including restored rows; otherwise a later tick could erase manual-backfilled current-window results. Worker notified before evaluator edits.

Early root review required two preservation details: reject recomputation over unimported archived gaps so retained rollups cannot become false zeros, and sync newly created archive-root parent directory links before committing purge. Backup review also requested rejecting unrelated existing SQLite files in maintenance OpenExisting. All three protections now have regression coverage; focused archive suite and root integration pass.

Independent review T-504 R1 rejected the first candidate despite all first CI gates passing (CI38395539540,9 Chromium/28 frontend/10 race packages). A partial events table with user_version5 could pass maintenance recognition and change its journal header; unsupported/incomplete snapshots also passed. T-506 is the bounded backup-only correction, requiring complete version-specific read-only preflight before writer initialization and snapshot validation. Original probes/report remain immutable; independent closure and new exact-head checks remain mandatory.

T-506/T-507 closure: complete required version-specific sqlite_schema is derived from embedded migrations and checked in one read transaction before writer initialization; live-source reads include committed WAL, snapshots remain immutable/read-only. Unsupported/incomplete/mutated required schemas reject without publishing restore output. Original seven independent probes pass5.374s; focused native race9.088s. Genuine v1–v5 upgrade→backup→restore, original bytes/high-water/audit and extra non-shadowing diagnostic objects remain supported. Final product CI passes; original first-candidate rejection is retained above.
