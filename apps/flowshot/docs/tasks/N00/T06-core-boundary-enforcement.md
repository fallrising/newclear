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
source_version: 1.0.1
source_sha256:
  SPEC.md: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
  N00: df7ce22a67b3262bc0324b04025fc11723065c03dd8345748f601083a60622be
  plan: bb4a5bdc4a1a100739c266cd342127a5e5dbac93675fae0a2490e65e2a8c5422
  test_plan: 15c20c961703b928ba3b0e5170f58f7004a5eb8eb0307fe9332bee09bca8246c
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
