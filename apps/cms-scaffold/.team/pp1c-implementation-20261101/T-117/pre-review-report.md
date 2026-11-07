# T-117 — Recovery inventory

Status: DONE
Agent: inherited-native worker; no delegation
Task: T-117 / desk T-0351 / approved PP1c-A C03 → C04a → C04d → C04c → C04b
Worktree: `/home/ckc/test/codex/wt/newclear/cms-pp1c-a-inventory-20261101/apps/cms-scaffold`
Evidence snapshot: 2026-11-01 17:08 UTC; final test XML timestamps 17:06:28–17:06:30 UTC.

## Summary

Implemented immutable, null-preserving PostgreSQL/media inventory with exactly the approved 20-relation/column allowlist. It captures original catalog types and attributes, complete constraint/index definitions and flags, complete Flyway rows, nullable PG `::text` values, canonical ordering, and every specified schema/rows/table/DB/header hash. Unknown public or other user-schema relations, columns, and constraint types fail closed.

`prepare(Connection)` is package-private and idempotent for an already active read-only REPEATABLE_READ transaction. It never resets active isolation, reconnects, commits, or changes source data. Fixed transaction-local text settings include UTC, ISO YMD, ISO intervals, hex bytea, extra_float_digits=3 and deterministic search_path. `inspect(Connection,Path)` owns rollback/close; try-with-resources preserves a primary failure if cleanup also fails.

Media uses Linux unix identity/link-count attributes plus SecureDirectoryStream and NOFOLLOW opens. Full media-subtree stamps catch replacement, size/mtime/ctime, membership and link changes; ancestors are checked for identity/directory type without treating unrelated ancestor membership as media drift. All files, including orphan/deleted content, are preserved. Composition checks approved MIME types, variant/object-key uniqueness, original hash/size, aggregate stored bytes, decoded dimensions, exact original/thumbnail/web sets, and decoded JPEG fit320/1600 dimensions. PDF/decode-null permits only original with null dimensions. Final rescan checks the complete file set.

Package-private `canonicalBytes(Object)` and `sha256(byte[])` are available to the root-owned Main. Canonical bytes use codepoint key order, LF, lowercase JSON control escapes, and reject nonfinite numbers/unpaired surrogates. The shared Java/Node vector hash is `aedd61aa4377225296140bd0c166259a7aa94016ec6236cbc45562b7f894e0a8`.

Typed failure: `RecoveryInventory.Failure extends IOException`, public `code()`; exact parent codes `SCHEMA_UNSUPPORTED`, `UNSAFE_MEDIA_PATH`, `WRITER_NOT_QUIESCED`, `MISSING_MEDIA_OBJECT`, `MEDIA_HASH_MISMATCH`, `MEDIA_SIZE_MISMATCH`, `IMAGE_VARIANTS_INCOMPLETE`.

## Changed paths

- `services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventory.java`
- `services/cms-api/src/test/java/com/fallrising/cms/ops/RecoveryInventoryTests.java`
- `services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/RecoveryInventoryIntegrationTests.java`
- This report and `.team/pp1c-implementation-20261101/T-117/` evidence only.

The preexisting assigned `.team/tasks/T-117.md` is preserved. No Git mutations, dependency changes, migration changes, other-worktree writes, old runtime access, deployment, or delegation.

## Verification

- `JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900s ./gradlew test --tests '*RecoveryInventoryTests' integrationTest --tests '*RecoveryInventoryIntegrationTests' --no-daemon --no-parallel` — passed; final `final-green.log`, 21 seconds, 25 unit + 9 real PostgreSQL16 tests, zero failures/errors/skips. Final XML and source SHA-256 manifests are retained in the evidence directory.
- C03 compile-safe scaffold, 10 named behavioral assertions failed as intended — passed Red gate; `C03-red.log`. No compile/import failures.
- C04a fixed raw rows/nullable text, bytea/array/JSONB/large integer/microsecond timestamp, same active snapshot, read-only write rejection, unknown column/relation — passed; `C04a-green.log`, `C04a-final-green.log`, real PG16 4 tests + 1 focused unit test.
- C04d catalog/constraint/index/Flyway drift — passed; `C04d-red.log` retained four expected behavioral failures, then `C04d-green.log` passed 8 PG16 and 2 focused unit tests. Additional canonical/non-public relation Red is retained in `C04d-followup-red.log`, resolved by the final suite.
- C04c path/symlink/hardlink/file replacement/source drift — passed; eight expected Red cases in `C04c-red.log`, followed by eight Green. Added ancestor-sibling boundary failed as intended in `C04c-ancestor-red.log`; correction passed all nine focused cases in `C04c-final-green.log`.
- C04b PNG/PDF/decode-null/deleted/orphan, missing web, original checksum/size/stored bytes, non-JPEG derivatives/dimensions and duplicate/unknown/unsafe metadata — passed; `C04b-red.log` retained 12 expected behavioral failures among 23 tests; `C04b-green.log` passed 23 unit + 8 PG tests before final strict-canonical follow-up.
- Actual final source review and trailing-whitespace scan over all three source paths — passed; source manifest `final-source-sha256.json`; checkpoint patches retain each sequential change. No required worker check remains failed or skipped.

The initial sandbox-only Gradle invocation failed before compilation because the existing shared Gradle lock was read-only. `C03-environment-failure.log` retains that environmental failure. The exact approved test was then run with authorized shared-cache access; no copied cache/toolchain or new dependency was introduced. Expected Red exits above are historical test-first evidence, not unresolved failures.

## Card bounds

Counts are additions + deletions, including handwritten tests and blank/comment lines, from saved before/after snapshots using unified diffs. Evidence artifacts do not count as handwritten implementation. See `checkpoint-counts.json` and each `*-checkpoint.patch`.

| Card | Measured changed lines |
| --- | ---: |
| C03 | 171 |
| C04a | 247 |
| C04d initial + final review follow-up | 171 + 73 = 244 |
| C04c | 211 |
| C04b | 218 |

All remain below 400 without suppressing assertions. C04d follow-up was a root-requested canonical consistency review plus schema-boundary regression; it remains charged to C04d.

## Documentation impact

Approved wave/contracts and root plan were read but not edited, per worker scope. Root owns SUCCESS/PLAN/BOARD/ledger acceptance, full native gates, independent review and publication. The secondary report-contract link in the repository skill resolves to an absent `.agents/docs/specs/initial-plugin.md`; this report follows the explicit task-worker SKILL.md status, summary, verification, documentation and risks requirements. The evidence-gate skill was applied to the task checklist and actual outputs before this DONE handoff.

## Risks and follow-ups

This is the assigned pure inventory subwave, not local restore/offsite/RPO/RTO acceptance. Main/ready-permit orchestration and complete real media/DB restore are root/later-card responsibilities. PG tests exercise real migrations and populated raw identity/permission/session/settings rows; rich media composition is exercised with TempDir fixtures. No old-runtime or production data was accessed. Linux SecureDirectoryStream/unix link attributes are required and unsupported adapters reject; this does not claim resistance to a malicious same-UID/root actor.

No builds will be started after this handoff so the root can run serial performance/native checks. Root may copy the three final source files and this report/evidence; no commit was made by the worker.

## Call/time accounting

Coverage is this worker's T-117 turn only, through the above snapshot. Measured: 14 Gradle command attempts (one environment-only failure, six intentional Red invocations, seven Green invocations), 261 seconds summed Gradle-reported execution durations excluding the pre-start sandbox failure and orchestration overhead; each timeout ceiling was 900 seconds. Measured subagent launches by this worker: 0. Fixture logs/snapshots were first written at 16:53:29 UTC and final tests ended around 17:06 UTC; this is an evidence-file interval, not an estimate of provider active time. Outer orchestration call count, nested tool-call total, provider requests, provider retries and total execution/wait/active-time totals are unknown/null because the runner did not expose authoritative aggregate counters. They are not inferred from worker budget or Gradle attempts. There was one approved sandbox escalation retry and one reasoned ancestor-boundary correction; no issue exceeded the initial failure plus two corrections bound.
