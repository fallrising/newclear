---
document_type: task
id: T05
node_id: N01
title: Implement transactional soft delete
status: done
depends_on:
  - T03
  - T04
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

Development acceptance: [N01/M0 verification](../../verification/N01.md), final complete Docker gate and independent T-006 ACCEPT. Historical RED/rework remains in the evidence; task-board merge closure is separate.
