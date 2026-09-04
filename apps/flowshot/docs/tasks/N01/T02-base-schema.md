---
document_type: task
id: T02
node_id: N01
title: Create the canonical v1 schema
status: todo
depends_on:
  - T01
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
  - crates/db/tests/migrations.rs
  - crates/db/tests/schema.rs
  - docs/tasks/N01/**
forbidden_paths:
  - SPEC.md
  - trigger semantics assigned to T03
  - repository APIs
  - Tauri commands
expected_duration: 90m
---

# T02 — Create the canonical v1 schema

## 單一交付結果

Migration version 1 creates every §9.2 table, column, foreign key, check, unique
constraint, and index with catalog-level and invalid-row evidence.

## 執行步驟

1. Write a catalog RED test for all canonical tables and declared indexes.
2. Add table-by-table invalid-row tests for status, kind, JSON, body, revision,
   annotation shape, uniqueness, and foreign keys.
3. Add the canonical version-1 SQL without triggers assigned to T03.
4. Build deterministic in-memory and tempfile test DB factories.
5. Verify migration rerun remains idempotent and the stored checksum matches
   the exact embedded SQL.
6. Compare catalog metadata, not only a schema-version integer.

## 首個失敗測試

- Command: `cargo test -p flowshot-db --test schema canonical_v1_catalog_is_complete`
- Expected failure: migration version 1 has no canonical product tables.

## 完成驗證

- All §9.2 tables/indexes and row checks have positive/negative tests.
- Every foreign key is enforced on both factory kinds.
- Latest rerun produces no DDL or data change.
- No trigger or repository behavior is claimed.

## Handoff

T03 receives a stable schema on which every required trigger can be tested
through direct invalid SQL.
