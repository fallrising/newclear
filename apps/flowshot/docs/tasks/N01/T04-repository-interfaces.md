---
document_type: task
id: T04
node_id: N01
title: Freeze typed repository interfaces
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
  test_plan: 4f76ee9a4f5edfb38949f92f6a775682370ac11d9d60b38a5abce4f9f16f8c09
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

Development acceptance: [N01/M0 verification](../../verification/N01.md), final complete Docker gate and independent T-006 ACCEPT. Historical RED/rework remains in the evidence; task-board merge closure is separate.
