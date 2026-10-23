---
document_type: task
id: T02
node_id: N00
title: Scaffold the Rust workspace
status: done
depends_on:
  - T01
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
  - Cargo.toml
  - Cargo.lock
  - crates/core/**
  - crates/db/**
  - crates/xtask/**
forbidden_paths:
  - src-tauri/**
  - src/**
  - SPEC.md
expected_duration: 60m
---

# T02 — Scaffold the Rust workspace

## 單一交付結果

A compiling Rust workspace contains pure `core`, placeholder `db`, and `xtask`
crates with one discovered unit test.

## 前置事實與證據

T01 has recorded an available supported Rust toolchain.

## 輸入

N00 repository structure and core dependency restrictions.

## 修改範圍

Root Rust workspace configuration and the three non-Tauri crates.

## 禁止事項

No SQLite dependency/schema, Tauri dependency in core, filesystem logic,
business feature, or contract generation implementation.

## 執行步驟

1. Save the failing workspace command.
2. Create workspace manifests and minimal crate entry points.
3. Add a pure placeholder function and unit test.
4. Confirm format, compile, and test discovery.

## 首個失敗測試

- Command: `cargo metadata --no-deps`
- Expected failure: root `Cargo.toml` does not exist.
- Requirement: reproducible Rust workspace.

## 完成驗證

- Command: `cargo fmt --check && cargo test --workspace`
- Expected result: all three crates build and the placeholder test passes.

## Handoff

- Changed files: root Cargo files and `crates/{core,db,xtask}`.
- Evidence: `evidence/T02-rust-workspace.md`.
- Risks: adapter crate is added in T03.
- Next task: T04 after T01.
