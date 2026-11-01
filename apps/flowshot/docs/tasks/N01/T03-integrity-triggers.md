---
document_type: task
id: T03
node_id: N01
title: Enforce SQLite integrity triggers
status: done
depends_on:
  - T02
derived_from:
  - 00-implementation-plan.md
  - 01-test-plan.md
source_version: 1.0.2
source_sha256:
  SPEC.md: b569c2181559270221de3e81ce1d59fad136932299629f805fb10155938357b0
  N01: b50452419cf658893fb76bbb28b891cd5377eeb79971e2933f61150a6a430fd4
  plan: bb0b2dd670cd5e088357aa0b8226c318e2c316d50317f03f47a3aff03a6bad5f
  test_plan: 10f0262ca61257d2a4730676d86eeb6f94d6356f752a158a5162e1509b7643a8
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

Development acceptance: [N01/M0 verification](../../verification/N01.md), final complete Docker gate and independent T-006 ACCEPT. Historical RED/rework remains in the evidence; task-board merge closure is separate.
