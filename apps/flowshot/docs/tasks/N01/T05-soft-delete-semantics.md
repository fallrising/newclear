---
document_type: task
id: T05
node_id: N01
title: Implement transactional soft delete
status: todo
depends_on:
  - T03
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
  - crates/db/src/repository.rs
  - crates/db/src/repositories/**
  - crates/db/src/transaction.rs
  - crates/db/src/types.rs
  - crates/db/src/test_support/**
  - crates/db/tests/repository.rs
  - crates/db/tests/soft_delete.rs
  - contracts/locks/N01.json
  - docs/tasks/N01/**
forbidden_paths:
  - SPEC.md
  - hard delete or purge APIs
  - UI or Tauri commands
expected_duration: 90m
---

# T05 — Implement transactional soft delete

## 單一交付結果

Typed repositories create/read/mutate canonical records and implement the only
supported delete primitives: annotation delete tombstones its full comment
thread at one timestamp, while comment delete preserves replies.

## 執行步驟

1. Write RED repository tests using fixed IDs/clock.
2. Implement parameterized row mapping and only the methods needed by N01.
3. Apply explicit transactions to every mutation and binding operation.
4. Implement annotation and comment tombstone behavior from §9.4.
5. Update `updated_at` and only schema-defined version tokens.
6. Prove desired-set/no-op operations do not invent version increments.
7. Verify DB/internal errors never include bodies or full anchor exact.
8. Update and re-freeze the unfinished N01 lock only if the public API changed.

## 首個失敗測試

- Command: `cargo test -p flowshot-db --test soft_delete annotation_delete_tombstones_thread`
- Expected failure: frozen interfaces have no persistence implementation.

## 完成驗證

- Soft-delete BDD tests pass with exact deterministic timestamps.
- Direct hard delete remains rejected.
- Replies to a deleted parent remain queryable with the parent tombstone.
- Transaction failure leaves every related row unchanged.

## Handoff

T06 supplies bounded execution and optimistic conflict behavior around these
repository transactions.
