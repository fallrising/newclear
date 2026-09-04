---
document_type: test-plan
node_id: N01
status: blocked
derived_from:
  - ../../../SPEC.md
  - ../../nodes/N01-sqlite-schema-migrations.md
  - 00-implementation-plan.md
source_version: 1.0.1
source_sha256:
  SPEC.md: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
  N01: 13de68ca196fd1d302ca4df0bff5d4633cfee1a106656a43e220967f0cc660fc
  plan: d1e72feb1a8aab1d80873c1890b6e9761cb85463eabf2c19c385bd8100585372
generated_at: 2026-07-30T18:26:45+02:00
owner: codex
---

# N01 Test Plan

## 1. Readiness Gate

N01 tests may be authored as RED only after:

1. N00 is `done` with executed dependency evidence;
2. SD-N01-001 permits the generated root `Cargo.lock` change;
3. exact new production dependencies are reviewed and pinned.

This plan does not change N01 from `todo` or claim that a planned lock is
frozen.

## 2. BDD and Acceptance Mapping

| ID | Scenario | Level | Fixture | Oracle | Planned command |
|---|---|---|---|---|---|
| N01-BDD-01 | blank DB upgrades to latest | integration | in-memory blank DB + fixed clock | every migration recorded once with checksum/time; catalog matches v1 | `cargo test -p flowshot-db --test migrations blank_database_upgrades_to_latest` |
| N01-BDD-02 | latest DB starts idempotently | integration | already migrated DB | no DDL/data/timestamp change | `cargo test -p flowshot-db --test migrations latest_database_is_idempotent` |
| N01-BDD-03 | hard delete is forbidden | invariant | document + annotation + comments | each raw delete fails and rows remain | `cargo test -p flowshot-db --test invariants hard_delete_is_rejected` |
| N01-BDD-04 | comment replies are one level | invariant | root comment A, reply B | reply-to-B and cross-annotation parent fail atomically | `cargo test -p flowshot-db --test invariants comment_parent_is_one_level` |
| N01-MIG-01 | migration registry rejects drift | negative integration | gap, duplicate, tampered, database-ahead variants | typed migration error; no pending version partially applies | `cargo test -p flowshot-db --test migrations migration_registry_rejects_drift` |
| N01-CON-01 | every connection is configured | component | writer + every read-pool connection | FK ON, WAL, NORMAL, busy timeout 5000 | `cargo test -p flowshot-db --test connections required_pragmas_apply_to_every_connection` |
| N01-INV-01 | canonical row checks hold | invariant | invalid annotation/tag/document/root rows | SQLite rejects every invalid matrix case | `cargo test -p flowshot-db --test invariants canonical_checks_reject_invalid_rows` |
| N01-INV-02 | system pin is protected | invariant | system `pin`, user tag, bindings | pin rename/delete and annotation binding fail; document binding succeeds | `cargo test -p flowshot-db --test invariants system_pin_is_protected` |
| N01-SOFT-01 | annotation tombstones its thread | repository integration | annotation with root/reply comments | one timestamp on all rows; no hard delete | `cargo test -p flowshot-db --test soft_delete annotation_delete_tombstones_thread` |
| N01-SOFT-02 | comment tombstone preserves replies | repository integration | root comment with reply | only target is tombstoned; reply remains readable | `cargo test -p flowshot-db --test soft_delete comment_delete_preserves_replies` |
| N01-CONC-01 | stale row version conflicts | repository integration | two writers from same version | first commits; second returns conflict without mutation | `cargo test -p flowshot-db --test concurrency stale_row_version_conflicts` |
| N01-CONC-02 | stale document revision rolls back batch | transaction integration | document + multiple annotations/events | zero partial hashes, annotations or events | `cargo test -p flowshot-db --test concurrency stale_document_revision_rolls_back` |
| N01-WAL-01 | tempfile WAL survives restart | integration | tempfile DB + multiple connections | journal is WAL; committed rows survive reopen | `cargo test -p flowshot-db --test wal committed_data_survives_restart` |
| N01-BND-01 | raw SQL stays in DB crate | architecture/negative | workspace source/metadata inspection | non-DB crate with `rusqlite` or SQL macro/string is named and rejected | `cargo test -p flowshot-db --test boundaries` |
| N01-TAU-01 | app DB uses platform path | adapter integration | injected test app-data directory | resolved DB is inside app-data; no home path constant | `cargo test -p flowshot-tauri db_path` |
| N01-PERF-01 | 10k seed meets budget | release benchmark | 10k annotations + 10k bindings | `< 1 s`, count/integrity correct, hardware JSON emitted | release benchmark command defined in T07 |

## 3. RED Evidence

| Test group | Expected first failure |
|---|---|
| migrations/connections | `rusqlite`, migration registry and connection factory do not exist |
| schema/invariants | canonical tables/triggers do not exist |
| repository/soft delete | typed repository API does not exist |
| concurrency/WAL | DB runtime, actor and tempfile factory do not exist |
| boundaries | DB crate has no policy test and planned lock is not frozen |
| Tauri path | no app-data DB constructor exists |
| performance | no deterministic seed or release benchmark exists |

Each task records the exact first failing test and confirms it fails for the
missing behavior, not a missing tool or stale dependency.

## 4. Migration Tests

- blank database applies all versions in order;
- latest database is byte/logically unchanged on rerun;
- registry rejects version zero, gaps, duplicates and unsorted definitions;
- database-ahead state fails before any SQL;
- changed checksum for an applied version fails before pending migration;
- SQL failure rolls back its DDL and migration metadata row;
- fixed clock writes exact `applied_at`;
- concurrent startup cannot apply one migration twice;
- an existing non-Flowshot SQLite file is handled according to explicit
  empty/unknown-schema detection, never silently overwritten.

Catalog assertions read `sqlite_master`, `PRAGMA table_info`,
`PRAGMA foreign_key_list` and `PRAGMA index_list`; they do not merely assert a
hard-coded schema version.

## 5. Constraint and Trigger Matrix

Minimum negative cases:

- blank workspace name;
- duplicate canonical root in one workspace;
- unknown root/document/annotation/tag foreign keys;
- invalid root/document/annotation/tag status/kind/color/resolution;
- invalid JSON fields;
- negative document revision;
- document annotation with anchor, range annotation without anchor;
- blank document annotation body and blank comment body;
- hard delete of document, annotation and comment;
- missing, cross-annotation or depth-two comment parent on insert and update;
- rename/delete system tag;
- bind system `pin` to annotation.

Every rejection test also verifies pre-existing rows remain unchanged.

## 6. Repository and Transaction Tests

- typed IDs never bind interchangeably at compile time;
- fixed UUIDv7/clock values reach persisted records exactly;
- create paths set timestamps/version defaults without hidden increments;
- mutation updates `updated_at` and only schema-defined version tokens;
- idempotent desired-set produces no token/timestamp change;
- annotation delete uses one timestamp for its comments;
- comment delete preserves descendants;
- tag merge and binding are transactional;
- not-found and stale-version errors are distinguishable;
- DB errors exposed above the adapter contain no body or complete anchor exact.

Compile-fail coverage may use a small fixture if it can run without adding a
heavy test framework; otherwise type separation is proved through public API
tests and review.

## 7. Executor and Concurrency Tests

- write requests execute in submission order on one actor;
- queue capacity is bounded and overload has an explicit typed result;
- read connection count never exceeds the configured bound;
- reader/writer behavior is exercised against a tempfile WAL DB;
- busy timeout uses the configured 5000 ms value and does not spin;
- actor shutdown rejects new work and joins cleanly;
- panic/error in one request does not commit partial transaction;
- deterministic test executor accepts fixed clock and ID generator;
- no Tauri async test calls `rusqlite` directly.

Avoid wall-clock sleeps where a barrier, channel or controlled lock can prove
ordering.

## 8. Property Tests

Property coverage is added only where it proves rules better than a table:

- tag normalization is idempotent and never returns untrimmed output;
- generated UUIDv7 IDs remain unique and timestamp ordered for deterministic
  sequences;
- non-negative `u64` row versions round-trip SQLite without signed overflow;
- migration registry accepts only exactly contiguous positive versions.

Random values use fixed seeds in reproducible CI failures.

## 9. Performance and Query Plans

The release harness:

1. opens a tempfile WAL database;
2. applies migrations outside the timed seed interval but reports both times;
3. inserts deterministic 10k annotation and 10k binding data through the
   intended transaction/repository path;
4. validates counts, foreign keys and tombstone/version defaults;
5. emits one JSON record containing hardware, build profile, SQLite version,
   dataset, migration duration, seed duration and result.

`EXPLAIN QUERY PLAN` snapshots normalize unstable addresses but retain
table/index/scan decisions. Required queries must use:

- `idx_documents_root_status`;
- `idx_documents_last_opened`;
- `idx_annotations_document_active`;
- `idx_comments_annotation`;
- tag reverse indexes;
- `idx_anchor_events_annotation`.

## 10. Security and Data Integrity

- migration/repository error logs use IDs, codes and duration only;
- tests assert logs exclude annotation/comment bodies and full anchor exact;
- SQL values are parameterized; dynamic table/column names are not accepted
  from callers;
- workspace files are never touched by DB tests;
- temp databases and benchmark output contain synthetic data only;
- no network or HTTP capability is introduced.

## 11. Regression Scope

During each task:

- focused `flowshot-db` test target;
- `cargo fmt --all --check`;
- `cargo clippy -p flowshot-db --all-targets -- -D warnings`;
- contract lock/drift check once T04 freezes it.

Before N01 closure:

- `make ci`;
- all `flowshot-db` unit/integration tests;
- Tauri app-data path integration on supported Mac runners;
- release benchmark on recorded target hardware;
- `python3 scripts/sdd.py verify`;
- zero unexpected contract or generated-file diff.

## 12. Exit Criteria

- Every scenario in §2 has red/green evidence.
- All §9.2 DDL, indexes and §9.3 triggers are catalog-tested.
- In-memory and tempfile WAL factories pass.
- Typed repository contract is frozen and drift-protected.
- Optimistic concurrency and soft delete are atomic.
- DB executor is bounded and no async thread runs blocking SQLite.
- Raw SQL boundary test passes.
- 10k release acceptance passes on recorded hardware.
- Full CI, N01 verification report and G2 outcome pass.
