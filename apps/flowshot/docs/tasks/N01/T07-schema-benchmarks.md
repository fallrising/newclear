---
document_type: task
id: T07
node_id: N01
title: Verify and close the SQLite foundation
status: done
depends_on:
  - T05
  - T06
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
  - crates/db/Cargo.toml
  - crates/db/benches/**
  - crates/db/src/benchmark/**
  - crates/db/src/test_support/**
  - crates/db/tests/query_plans.rs
  - src-tauri/src/db*
  - src-tauri/src/lib.rs
  - src-tauri/tauri.conf.json
  - scripts/linux-db-smoke.py
  - src-tauri/Cargo.toml
  - docs/graph.yaml
  - docs/metrics/node-outcomes.jsonl
  - docs/tasks/N01/**
  - docs/verification/N01.md
  - contracts/locks/N01.json
forbidden_paths:
  - SPEC.md
  - UI or unrelated product features
expected_duration: 120m
---

# T07 — Verify and close the SQLite foundation

## 單一交付結果

Independent evidence proves N01 schema, migration, repositories, executor,
app-data location, query plans, and 10k release performance, after which
governance state is updated atomically.

## Start Gate

SD-N01-006 resolved in node revision 2: orchestrator may update graph/outcome after independent acceptance.

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
- Release migration plus seed is under 1 second with hardware/SQLite dataset record.
- Query plans use the specified indexes.
- Production DB path is under platform app-data.
- Lock drift is zero; verification, graph and append-only outcome agree.

## Handoff

N01 unlocks the remainder of M0 and makes N02 persistence work eligible only
according to graph and milestone rules.

Startup barrier implementation: set the configured main window `create:false`, resolve the DB path using Tauri `app_data_dir`, initialize/migrate via DbRuntime, then construct the configured WebView. Real Linux smoke verifies app-data creation, restart preservation and corrupted migration rejection before any visible window/IPC. No raw SQL enters the native production adapter.

Development acceptance: [N01/M0 verification](../../verification/N01.md), final complete Docker gate and independent T-006 ACCEPT. Historical RED/rework remains in the evidence; task-board merge closure is separate.
