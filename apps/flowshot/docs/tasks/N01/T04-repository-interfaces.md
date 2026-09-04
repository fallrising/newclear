---
document_type: task
id: T04
node_id: N01
title: Freeze typed repository interfaces
status: todo
depends_on:
  - T02
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
  - crates/db/src/lib.rs
  - crates/db/src/types.rs
  - crates/db/src/repository.rs
  - crates/db/src/transaction.rs
  - crates/db/tests/boundaries.rs
  - crates/db/tests/repository_contract.rs
  - contracts/locks/N01.json
  - docs/tasks/N01/**
forbidden_paths:
  - SPEC.md
  - generated TypeScript
  - Tauri commands
  - feature-specific methods not needed by N01 acceptance
expected_duration: 90m
---

# T04 — Freeze typed repository interfaces

## 單一交付結果

Upper layers can express N01 persistence operations through typed IDs, records,
mutations, errors, and transaction boundaries without receiving SQL rows,
connections, statements, or raw SQL.

## 執行步驟

1. Write compile/public-behavior RED tests for typed IDs and repository inputs.
2. Define the minimal ID, version, timestamp, record, input, error, repository,
   and transaction types required by N01 tests.
3. Keep SQL row conversion private to the DB crate.
4. Add a workspace boundary test that names any non-DB `rusqlite` dependency
   or product SQL occurrence.
5. Verify error formatting excludes user bodies and full anchor exact.
6. Confirm the planned lock source list, calculate its canonical digest, set it
   frozen, and add a zero-drift test.

## 首個失敗測試

- Command: `cargo test -p flowshot-db --test repository_contract`
- Expected failure: only the N00 `DbAdapter` marker exists.

## 完成驗證

- Public repository consumers compile without importing `rusqlite`.
- Typed IDs are not interchangeable at repository signatures.
- Boundary negative fixture names the offending crate/file.
- N01 lock is frozen, command list remains empty, and source drift fails.

## Handoff

T05 and T06 implement semantics behind the frozen API; additions require an
explicit lock update while N01 remains unfinished.
