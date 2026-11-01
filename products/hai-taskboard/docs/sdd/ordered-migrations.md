# Mini-SDD: Ordered migration prerequisite

Status: bounded runner accepted by root after independent T-131 PASS and integrated local gates.
Final exact-head PR CI is a separate delivery check recorded in desk T-0184.
Parent: accepted-spec-admission HAI-ADMISSION-008; ADR-005; persistence-and-recovery startup checks.
Bounded scope: ordered runner mechanics, initially accepted with production V1. The subsequent
V2 storage child is governed by `acceptance-persistence-schema.md`; its current implementation
is accepted as bounded storage/migration after T-142 and root local gates.
Full H06 command authority and durable admission remain Specified/NotRun. Existing T-130/T-131 reports bind the original V1 checkpoint.

## Inspected boundary

At merged baseline `5bb6cd10`, `migrate` creates `schema_migrations` before the transaction, checks
only version 1 and returns if its checksum matches. It does not inspect unknown applied versions,
gaps or `instance_state.schema_version`. Migration SQL and its one history insertion are otherwise
transactional. Existing V1 history rows have immutable UPDATE/DELETE triggers.

## Required behavior

- **HAI-MIGRATION-001**: Preserve exact `0001_v1.sql` bytes and SHA-256
  `57d96955d3351de47b1a81696398cf9ddb843394eb5c004c6f79841117c7745c`. Keep V1 checksum/Identity
  compatibility and application history, versions, restore generation, stream epoch and timestamps.
  Registry is private trusted configuration, nonempty, ordered contiguous versions 1..N with exact
  byte checksums; malformed/duplicate/gapped registry rejects before schema mutation. Initial
  production contained only V1; subsequent steps require their own reviewed contract and oracles.
  Do not accept registry or SQL from requests/DB/repository instructions.
- **HAI-MIGRATION-002**: Startup obtains the bounded immediate writer transaction before reading
  history and deciding which steps to apply. Inspect every applied row in ascending version order,
  bounded to registry length plus one; reject gaps, unknown newer versions, malformed rows or any
  checksum mismatch. Never infer acceptance or migrate backward. A recorded V1 checksum is not
  permission to ignore later rows. Preserve immutable history triggers; no repair/reset fallback.
- **HAI-MIGRATION-003**: Applied history must be a complete prefix of the trusted registry and agree
  with the unique `instance_state` row's schema version. Missing state, malformed history and empty
  history accompanying preexisting application schema reject. An empty/new database may create the
  migration ledger and apply trusted steps; no existing rows are silently adopted or guessed.
  Reopen with a valid complete applied registry performs no step or timestamp/history mutation;
  trusted pending steps follow HAI-MIGRATION-004. SQL metadata consistency does not verify
  every physical schema object against its original DDL or to defend a hostile DB writer.
- **HAI-MIGRATION-004**: Apply pending embedded SQL steps in registry order inside the same immediate
  transaction, record exact version/checksum/application time and advance instance schema version
  atomically. Ledger creation, all pending DDL/data, history and schema-version changes commit together.
  Any SQL failure, cancellation or commit error rolls back the complete pending batch, including
  new-ledger creation. Rollback uses an uncanceled cleanup context; no partial applied schema remains.
  Every statement error is checked. No swallowing busy/cancel errors, indefinite retry or lock leak.
- **HAI-MIGRATION-005**: Concurrent startup of separate Store/connection instances cannot decide
  from an unprotected stale history or duplicate a migration. Both new and existing databases
  converge to exactly one immutable row per compiled step; writer conflict stays within existing
  timeout/error rules.
  Existing full transaction, guarded Done, exact replay and runtime shutdown/no-redispatch behavior
  remains unchanged. Migration integrity failure prevents Store/runtime startup.
- **HAI-MIGRATION-006**: Tests for unimplemented future step mechanics use clearly synthetic private registry
  SQL after the actual compiled prefix, never counterfeit admission commands, exported
  configuration or bypassed migration-history triggers. Actual V2 migration/storage oracles
  belong to the separately assigned schema child.
  Legitimate unknown-newer applied rows may be appended to a real V1 DB to model another binary;
  checksum/gap corruption may use a separately constructed malformed DB, explicitly labeled invalid
  input. Cancellation/failure tests must show real rolled-back DDL/history/state and released locks.
  No artificial assertion claiming actual V2 admission/restore or broad process-kill coverage.

## Named executable oracles

| Oracle | Required assertion | Status |
| --- | --- | --- |
| `TestAdmission_MigrationPreservesV1AndRejectsUnknownSchema` | Public Open on a valid complete prefix preserves rows/V1 checksum/applied time; appended unknown row, gap, checksum mismatch, state mismatch/missing reject; actual V1→V2 upgrade is tested by the schema child | Passing bounded; runner subset of H01 oracle only |
| `TestMigrationRunner_RegistryAndHistoryValidation` | Private registry malformed/duplicate/gap/checksum and nonprefix history reject; exact valid registry prefix accepted | Passing bounded |
| `TestMigrationRunner_AtomicUpgradeRollbackAndRestart` | Synthetic pending DDL/history/version failures roll back whole batch; baseline public reopen works, retry/restart with matching synthetic registry works without reapplication; production binary rejects that synthetic newer DB | Passing bounded |
| `TestMigrationRunner_ConcurrentStartup` | Independent public Store opens on new/existing DB preserve one row per compiled step and valid consistent state without partial schema | Passing bounded |
| `TestMigrationRunner_CancellationReleasesWriter` | Canceled migration rolls back DDL/history/version, releases writer and permits subsequent valid reopen | Passing bounded |

Root runs shared backend/full/race/vet/build plus web gates and binds exact file hashes; an independent
reviewer inspects Red lawfulness, immutable V1/history and actual semantic execution before acceptance.
The separately assigned V2 schema child uses this runner after its own ACKed schema contract;
its tests preserve these guards while advancing intentional production version expectations.
