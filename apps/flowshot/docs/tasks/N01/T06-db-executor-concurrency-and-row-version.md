---
document_type: task
id: T06
node_id: N01
title: Add bounded DB execution and optimistic concurrency
status: done
depends_on:
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

Development acceptance: [N01/M0 verification](../../verification/N01.md), final complete Docker gate and independent T-006 ACCEPT. Historical RED/rework remains in the evidence; task-board merge closure is separate.
