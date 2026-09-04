---
document_type: task
id: T08
node_id: N00
title: Prove macOS launch and command observability
status: blocked
depends_on:
  - T07
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
  - Makefile
  - .github/**
  - index.html
  - scripts/macos-launch-smoke.mjs
  - scripts/macos-launch-smoke.node.mjs
  - scripts/macos-window-check.swift
  - scripts/check-launch-entry.mjs
  - src/main.ts
  - src/main.tsx
  - src/render.tsx
  - src/launch-build-info.ts
  - src/launch-build-info.test.ts
  - src-tauri/Cargo.toml
  - src-tauri/src/commands/build_info.rs
  - src-tauri/src/lib.rs
  - docs/tasks/N00/**
forbidden_paths:
  - crates/core/src/contracts/**
  - src/generated/contracts/**
  - contracts/locks/N00.json
  - product features
  - SPEC.md
expected_duration: 90m
---

# T08 — Prove macOS launch and command observability

## 單一交付結果

A release Flowshot binary launches a visible native window on both supported Mac
architectures, reaches the existing build-info vertical slice within the cold
start budget, and emits structured command completion metadata.

## 前置事實與證據

T07 proves clean-checkout builds and native tests on Ubuntu, Apple Silicon, and
Intel macOS, but it deliberately does not claim a window launch or interactive
timing result.

## 輸入

N00 performance/observability requirements, the frozen `get_build_info`
contract, and the existing React-to-Tauri invocation path.

## 修改範圍

The build-info adapter log, a Mac-only launch/window probe, its Make target, and
the macOS hosted workflow steps.

## 禁止事項

No new command, contract/lock change, telemetry, remote reporting, product
feature, weakened `< 1.5 s` budget, or process-only result presented as a
visible-window launch.

## 執行步驟

1. Save the missing launch target and missing command-log evidence.
2. Emit one JSON line with command, correlation ID, duration, result code, and
   build info for `get_build_info`.
3. Test the log record structure without capturing global process output.
4. Build a release binary on macOS and launch it as a child process.
5. Require both the frontend-originated command record and a CoreGraphics
   on-screen window owned by the child PID.
6. Measure spawn-to-command time and fail at `>= 1.5 s`.
7. Run the same oracle on Apple Silicon and Intel hosted Macs.
8. When a hosted run misses the acceptance budget, continue observing for up
   to 15 seconds without changing the result, and upload timestamps, native
   process output, and a best-effort screenshot for diagnosis.
9. If diagnostics prove frontend module startup is on the critical path,
   invoke the frozen build-info command before importing and rendering React.
10. If the split entry still starts after the acceptance boundary, invoke the
    same frozen command from Tauri's WebView document-start initialization
    script and let the typed frontend adapter consume that promise.
11. If hosted virtual Macs remain outside the product budget after the focused
    launch attempts, keep the exact oracle as a non-blocking hosted diagnostic
    and reserve T08 acceptance for controlled target-Mac evidence. Required
    hosted CI must still build and test both debug and optimized native
    application binaries on both architectures.

## 首個失敗測試

- Command: `make macos-launch-smoke`
- Expected failure: the target and launch probe do not exist.
- Requirement: real target-Mac launch, observability, and cold-start evidence.

## 完成驗證

- Command: `make macos-launch-smoke`
- Expected result: a release binary reports a structured successful
  `get_build_info` record, owns an on-screen native window, and reaches the
  signal in under 1.5 seconds.

## Handoff

- Changed files: adapter logging, launch/window probes, Makefile, macOS CI.
- Evidence: `evidence/T08-macos-launch-observability.md`.
- Risks: hosted measurements describe the recorded runner hardware, not every
  end-user Mac.
- Next task: T09.
