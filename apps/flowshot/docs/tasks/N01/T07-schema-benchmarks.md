---
document_type: task
id: T07
node_id: N01
title: Verify and close the SQLite foundation
status: todo
depends_on:
  - T05
  - T06
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
  - crates/db/benches/**
  - crates/db/src/benchmark/**
  - crates/db/src/test_support/**
  - crates/db/tests/query_plans.rs
  - src-tauri/src/db*
  - docs/tasks/N01/**
  - docs/verification/N01.md
  - contracts/locks/N01.json
forbidden_paths:
  - SPEC.md
  - graph/outcome files until SD-N01-006 is resolved
  - UI or unrelated product features
expected_duration: 120m
---

# T07 — Verify and close the SQLite foundation

## 單一交付結果

Independent evidence proves N01 schema, migration, repositories, executor,
app-data location, query plans, and 10k release performance, after which
governance state is updated atomically.

## Start Gate

Resolve SD-N01-006 before closure so graph status and append-only G2 outcome
can be updated without exceeding node ownership.

## 執行步驟

1. Add query-plan snapshots for every required index-backed query.
2. Add deterministic 10k annotation/10k binding seed support.
3. Run the release harness on controlled hardware and record one structured
   result; fail at `>= 1 s`.
4. Construct the production DB path only from Tauri platform app-data API.
5. Re-run all BDD, negative, WAL, concurrency, boundary and contract drift
   tests from a clean state.
6. Inspect the frozen N01 lock and produce `docs/verification/N01.md`.
7. Append the G2 outcome and mark graph/node done only when every gate passes.

## 首個失敗測試

- Command: verification checklist before benchmark/app-data evidence.
- Expected failure: N01 has no controlled release result, path integration, or
  verification report.

## 完成驗證

- `make ci` and every N01 test target pass.
- Release seed is under 1 second with hardware/SQLite dataset record.
- Query plans use the specified indexes.
- Production DB path is under platform app-data.
- Lock drift is zero; verification, graph and append-only outcome agree.

## Handoff

N01 unlocks the remainder of M0 and makes N02 persistence work eligible only
according to graph and milestone rules.
