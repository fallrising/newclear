---
document_type: task
id: T01
node_id: N01
title: Build the deterministic migration runner
status: done
depends_on:
  - N00
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
  - Cargo.lock
  - crates/db/Cargo.toml
  - crates/db/src/lib.rs
  - crates/db/src/connection.rs
  - crates/db/src/migrations/**
  - crates/db/tests/connections.rs
  - crates/db/tests/migrations.rs
  - contracts/locks/N01.json
  - docs/tasks/N01/**
forbidden_paths:
  - SPEC.md
  - canonical product tables beyond schema_migrations
  - Tauri commands
expected_duration: 90m
---

# T01 — Build the deterministic migration runner

## 單一交付結果

A configured SQLite connection and embedded up-only migration registry upgrade
a blank database deterministically and reject gaps, duplicates, database-ahead
state, checksum tampering, and partial application.

## Start Gate

Do not start RED until N00 is `done` and SD-N01-001 authorizes the generated
root `Cargo.lock` update required by direct DB dependencies.

## 執行步驟

1. Record dependency readiness and exact pinned SQLite/hash dependencies.
2. Add the smallest RED tests for blank/latest/tampered/gapped registries.
3. Configure every opened connection with foreign keys, WAL, NORMAL sync, and
   5000 ms busy timeout; verify values rather than assuming PRAGMA success.
4. Represent migrations as ordered version/SQL/checksum values and validate
   the full registry before applying SQL.
5. Bootstrap `schema_migrations` idempotently inside serialized startup transaction.
6. Apply each pending migration plus its metadata row atomically with an
   injected clock.
7. Emit structured duration/result metadata without SQL values or user bodies.

## 首個失敗測試

- Command: `cargo test -p flowshot-db --test migrations blank_database_upgrades_to_latest`
- Expected failure: no migration or connection implementation exists.

## 完成驗證

- Focused migration and connection integration tests pass.
- Registry failure variants leave schema and metadata unchanged.
- `cargo fmt --all --check` and strict DB Clippy pass.
- N01 lock remains planned; no repository API is frozen in this task.

## Handoff

T02 receives a migration runner that can accept the canonical v1 schema as
version 1. No product table or trigger is introduced early.

Development acceptance: [N01/M0 verification](../../verification/N01.md), final complete Docker gate and independent T-006 ACCEPT. Historical RED/rework remains in the evidence; task-board merge closure is separate.
