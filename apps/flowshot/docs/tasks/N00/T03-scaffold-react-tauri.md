---
document_type: task
id: T03
node_id: N00
title: Scaffold React, Vite, and Tauri
status: done
depends_on:
  - T01
  - T02
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
  - package.json
  - package-lock.json
  - tsconfig*.json
  - vite.config.ts
  - vitest.config.ts
  - eslint.config.js
  - index.html
  - src/**
  - src-tauri/**
forbidden_paths:
  - product features
  - SPEC.md
expected_duration: 90m
---

# T03 — Scaffold React, Vite, and Tauri

## 單一交付結果

A minimal React 19/Vite frontend and Tauri 2 adapter compile without product
features or broad capabilities.

## 前置事實與證據

T01 has a working Node/npm toolchain and Tauri prerequisite route. T02 supplies
the Rust workspace.

## 輸入

N00 stack, CSP, capability, and offline constraints.

## 修改範圍

Frontend root configuration, `src/`, and the minimal `src-tauri/` crate/config.

## 禁止事項

No filesystem/HTTP capability, remote assets, product schema, Markdown parser,
annotation UI, or legacy command surface.

## 執行步驟

1. Save the failing frontend build.
2. Create locked package metadata and TypeScript/Vite configuration.
3. Add a minimal accessible application shell and component test.
4. Add the minimal Tauri adapter/configuration with strict capabilities.
5. Build frontend and platform-appropriate Rust targets.

## 首個失敗測試

- Command: `npm run build`
- Expected failure: no `package.json`.
- Requirement: reproducible React/Tauri shell.

## 完成驗證

- Command: `npm run test && npm run build`
- Expected result: shell test passes and production frontend builds.

## Handoff

- Changed files: frontend and `src-tauri` scaffold.
- Evidence: `evidence/T03-react-tauri.md`.
- Risks: target-macOS launch remains T08 evidence.
- Next task: T05 after T04.
