---
document_type: task
id: T05
node_id: N00
title: Complete the build-info vertical slice
status: done
depends_on:
  - T03
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
  - src-tauri/src/**
  - src/**
  - src/generated/contracts/**
forbidden_paths:
  - DB schema
  - filesystem capability
  - SPEC.md
expected_duration: 75m
---

# T05 — Complete the build-info vertical slice

## 單一交付結果

The frontend calls `get_build_info` through the generated wrapper and renders a
typed success/error state using the same Rust DTO registered by Tauri.

## 前置事實與證據

T03 supplies the shell. T04 supplies frozen generated contracts.

## 輸入

Frozen N00 contract lock and build metadata available to the Rust adapter.

## 修改範圍

Tauri build-info command/registration and the minimal frontend consumer/tests.

## 禁止事項

No duplicate DTO, raw string command in feature code, filesystem/DB access,
remote request, or generated-file hand edit.

## 執行步驟

1. Write failing Rust adapter and React loading/success/error tests.
2. Implement build metadata injection and the Tauri command.
3. Register the command using the shared DTO.
4. Consume it only through the generated wrapper.
5. Verify serialization matches the golden fixture.

## 首個失敗測試

- Command: targeted Rust command test and frontend build-info component test.
- Expected failure: command/consumer do not exist.
- Requirement: first contract-to-UI vertical slice.

## 完成驗證

- Command: targeted Rust tests plus `npm run test`
- Expected result: typed success/error tests pass and no duplicate contract is
  present.

## Handoff

- Changed files: build-info adapter and frontend consumer.
- Evidence: `evidence/T05-build-info-slice.md`.
- Risks: full repository gate awaits T07.
- Next task: T07 after T06.
