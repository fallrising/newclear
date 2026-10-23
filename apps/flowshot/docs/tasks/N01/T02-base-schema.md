---
document_type: task
id: T02
node_id: N01
title: Create the canonical v1 schema
status: done
depends_on:
  - T01
derived_from:
  - 00-implementation-plan.md
  - 01-test-plan.md
source_version: 1.0.2
source_sha256:
  SPEC.md: b569c2181559270221de3e81ce1d59fad136932299629f805fb10155938357b0
  N01: b50452419cf658893fb76bbb28b891cd5377eeb79971e2933f61150a6a430fd4
  plan: bb0b2dd670cd5e088357aa0b8226c318e2c316d50317f03f47a3aff03a6bad5f
  test_plan: 4f76ee9a4f5edfb38949f92f6a775682370ac11d9d60b38a5abce4f9f16f8c09
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

Development acceptance: [N01/M0 verification](../../verification/N01.md), final complete Docker gate and independent T-006 ACCEPT. Historical RED/rework remains in the evidence; task-board merge closure is separate.
