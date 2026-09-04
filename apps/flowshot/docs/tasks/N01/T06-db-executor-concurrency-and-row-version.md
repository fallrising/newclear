---
document_type: task
id: T06
node_id: N01
title: Add bounded DB execution and optimistic concurrency
status: todo
depends_on:
  - T04
derived_from:
  - 00-implementation-plan.md
  - 01-test-plan.md
source_version: 1.0.1
source_sha256:
  SPEC.md: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
  N01: 13de68ca196fd1d302ca4df0bff5d4633cfee1a106656a43e220967f0cc660fc
  plan: d1e72feb1a8aab1d80873c1890b6e9761cb85463eabf2c19c385bd8100585372
  test_plan: 6129ff514d939f8971527e9b215eeaedfa3f6e932b153cd3fead8c5814cb7ccd
owner: codex
allowed_paths:
  - crates/db/src/executor/**
  - crates/db/src/lib.rs
  - crates/db/src/repositories/**
  - crates/db/src/repository.rs
  - crates/db/src/transaction.rs
  - crates/db/src/types.rs
  - crates/db/src/test_support/**
  - crates/db/tests/concurrency.rs
  - crates/db/tests/wal.rs
  - contracts/locks/N01.json
  - docs/tasks/N01/**
forbidden_paths:
  - SPEC.md
  - unbounded queues or connection creation
  - Tauri async runtime blocking calls
  - UI or product commands
expected_duration: 120m
---

# T06 — Add bounded DB execution and optimistic concurrency

## 單一交付結果

A single bounded write actor and bounded read connections execute repository
work off async runtime threads, while stale row versions and document revisions
return `CONFLICT` without partial writes.

## 執行步驟

1. Write deterministic RED tests for ordering, bounds, shutdown, WAL and stale
   versions/revisions.
2. Implement a single owned writer connection behind a bounded request queue.
3. Implement a configured maximum number of read connections.
4. Route repository transactions through the executor boundary.
5. Add conditional row-version and document-revision updates with exact
   conflict mapping.
6. Prove batch revision conflict rolls back hashes, annotations, and events.
7. Prove tempfile WAL commits survive close/reopen and busy behavior does not
   spin or bypass timeout.
8. Re-freeze the unfinished lock only for necessary public changes.

## 首個失敗測試

- Command: `cargo test -p flowshot-db --test concurrency stale_row_version_conflicts`
- Expected failure: no executor or conditional mutation implementation exists.

## 完成驗證

- Queue/read bounds and write order are observable and deterministic.
- Actor shutdown joins and rejects new requests cleanly.
- Stale row/document updates return conflict with zero partial mutation.
- No public executor API exposes SQLite handles.

## Handoff

T07 uses the production execution path for app-data wiring, query-plan evidence
and the release dataset benchmark.
