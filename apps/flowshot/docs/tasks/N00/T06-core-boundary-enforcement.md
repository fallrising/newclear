---
document_type: task
id: T06
node_id: N00
title: Enforce the core dependency boundary
status: done
depends_on:
  - T02
  - T04
derived_from:
  - 00-implementation-plan.md
  - 01-test-plan.md
source_version: 1.0.2
source_sha256:
  SPEC.md: b569c2181559270221de3e81ce1d59fad136932299629f805fb10155938357b0
  N00: 47754e767664fc4dd86cb2abcaa512317af42663f49546520838f5a7ce691d1a
  plan: 1502abf90d2cdcf0ee9081043241c95243f9d8919c73e4d13dc2d8ea2b68608d
  test_plan: d869268f6a67de3c4303a14b3e2aa34486ec50a3c7f85179dc187742befc5c63
owner: codex
allowed_paths:
  - crates/xtask/**
  - crates/core/**
  - Cargo.toml
forbidden_paths:
  - src-tauri/**
  - DB product schema
  - SPEC.md
expected_duration: 60m
---

# T06 — Enforce the core dependency boundary

## 單一交付結果

An executable repository check rejects Tauri, rusqlite, filesystem adapter, and
other forbidden dependencies from `flowshot-core`.

## 前置事實與證據

T02 establishes the workspace; T04 establishes allowed contract dependencies.

## 輸入

SPEC INV-8 and the explicit core dependency allow/deny policy.

## 修改範圍

Xtask boundary command and its disposable-fixture tests.

## 禁止事項

No committed mutation of the real core manifest during negative tests and no
name-only check that ignores transitive dependencies.

## 執行步驟

1. Save the missing-boundary-check failure.
2. Define the allow/deny policy.
3. Inspect Cargo metadata including transitive edges.
4. Test a valid graph and disposable forbidden dependency graphs.
5. Emit actionable package/dependency paths.

## 首個失敗測試

- Command: `cargo xtask check-boundaries`
- Expected failure: boundary subcommand is absent.
- Requirement: machine-enforced pure core.

## 完成驗證

- Command: `cargo test -p xtask && cargo xtask check-boundaries`
- Expected result: valid workspace passes; injected Tauri/rusqlite cases fail in
  tests with named dependency paths.

## Handoff

- Changed files: xtask boundary implementation/tests.
- Evidence: `evidence/T06-core-boundary.md`.
- Risks: policy updates must be deliberate as dependencies grow.
- Next task: T07.
