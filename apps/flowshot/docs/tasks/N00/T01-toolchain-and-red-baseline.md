---
document_type: task
id: T01
node_id: N00
title: Establish toolchain and red baseline
status: done
depends_on: []
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
  - docs/tasks/N00/**
forbidden_paths:
  - production source
expected_duration: 45m
---

# T01 — Establish toolchain and red baseline

## 單一交付結果

A reproducible toolchain evidence record identifies installed versions,
platform limitations, and the initial failing N00 commands.

## 前置事實與證據

The repository and SDD are clean. Rust 1.83 is present; Node/npm, Tauri CLI,
`pkg-config`, and local WebKit/GTK development packages are absent. The host is
Linux rather than the target macOS platform.

## 輸入

N00 plan/test plan, official Tauri prerequisites, supported Rust stable, and a
supported Node LTS release.

## 修改範圍

Only N00 planning/evidence documents. Tool installation is an environment
operation and must not silently alter project scope.

## 禁止事項

No scaffold, product code, database, generated TypeScript, or false macOS
launch claim.

## 執行步驟

1. Record initial failing commands.
2. Select and record supported Rust/Node versions.
3. Install or expose required tools with explicit approval where needed.
4. Record Linux platform packages or the selected isolated build environment.
5. Define the macOS verification route.

## 首個失敗測試

- Command: `node --version && npm --version && cargo tauri --version`
- Expected failure: Node/npm/Tauri are unavailable.
- Requirement: N00 toolchain precondition.

## 完成驗證

- Command: `rustc --version && cargo --version && node --version && npm --version`
- Expected result: pinned/supported versions are available and recorded; local
  Tauri prerequisites or an explicit remote-platform route are documented.

## Handoff

- Changed files: N00 evidence, task status, and local-tool ignore rule.
- Evidence: `evidence/T01-toolchain.md`.
- Risks: macOS launch remains a final verification gate.
- Next task: T02 and T03.
