---
document_type: task
id: T01
node_id: N01
title: Build the deterministic migration runner
status: blocked
depends_on:
  - N00
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
  - Cargo.lock until SD-N01-001 is resolved
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
4. Bootstrap `schema_migrations` idempotently.
5. Represent migrations as ordered version/SQL/checksum values and validate
   the full registry before applying SQL.
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
