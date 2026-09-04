---
document_type: task
id: T03
node_id: N01
title: Enforce SQLite integrity triggers
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
  - crates/db/src/migrations/**
  - crates/db/src/test_support/**
  - crates/db/tests/invariants.rs
  - crates/db/tests/migrations.rs
  - docs/tasks/N01/**
forbidden_paths:
  - SPEC.md
  - repository implementation
  - UI or Tauri commands
expected_duration: 90m
---

# T03 — Enforce SQLite integrity triggers

## 單一交付結果

Raw SQL cannot bypass §9.3: user data cannot be hard-deleted, comments cannot
cross annotations or exceed one reply level, and the system `pin` tag cannot be
renamed, deleted, or bound to annotations.

## 執行步驟

1. Seed minimal valid rows and record RED for each prohibited operation.
2. Add hard-delete triggers for documents, annotations, and comments.
3. Add comment-parent validation for both insert and parent/annotation update.
4. Add system-tag rename/delete protection.
5. Seed/protect the system `pin` tag and reject annotation binding.
6. Assert each failed statement preserves all pre-existing rows.
7. Catalog-test trigger names and migration checksum drift.

## 首個失敗測試

- Command: `cargo test -p flowshot-db --test invariants hard_delete_is_rejected`
- Expected failure: raw deletes currently succeed because triggers do not exist.

## 完成驗證

- Every §9.3 trigger has insert/update/delete negative evidence as applicable.
- BDD hard-delete and one-level reply scenarios pass.
- Failed operations are atomic and expose a typed validation category later
  mappable by repositories.

## Handoff

T05 may rely on DB-level protection while implementing the only supported
delete path: tombstones.
