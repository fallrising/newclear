---
document_type: task
id: T07
node_id: N00
title: Establish Make and CI gates
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
  N00: 47754e767664fc4dd86cb2abcaa512317af42663f49546520838f5a7ce691d1a
  plan: 1502abf90d2cdcf0ee9081043241c95243f9d8919c73e4d13dc2d8ea2b68608d
  test_plan: d869268f6a67de3c4303a14b3e2aa34486ec50a3c7f85179dc187742befc5c63
owner: codex
allowed_paths:
  - Makefile
  - package.json
  - package-lock.json
  - .github/**
  - README.md
forbidden_paths:
  - product features
  - SPEC.md
expected_duration: 90m
---

# T07 — Establish Make and CI gates

## 單一交付結果

`make bootstrap`, `make gen-contracts`, `make check-contracts`, and `make ci`
own a reproducible local/CI workflow, and GitHub Actions calls the same gates.

## 前置事實與證據

T05 supplies the vertical slice; T06 supplies boundary enforcement.

## 輸入

SPEC CI command list, selected toolchain versions, and existing SDD verifier.

## 修改範圍

Makefile, package scripts/lock metadata, GitHub Actions workflows, and verified
README bootstrap instructions.

## 禁止事項

No duplicated weaker CI command list, floating unrecorded toolchain, more than
five bootstrap commands, or claim that unavailable GUI E2E runs in sandbox CI.

## 執行步驟

1. Save the missing-Make-target failure.
2. Implement focused Make targets with strict shell failure behavior.
3. Make contract check regenerate into isolation and compare.
4. Add Linux CI for full non-GUI gates.
5. Add macOS build/smoke preparation appropriate to N00.
6. Update README with verified commands only.

## 首個失敗測試

- Command: `make ci`
- Expected failure: no Makefile/target.
- Requirement: one complete mechanical gate.

## 完成驗證

- Command: `make bootstrap && make ci`
- Expected result: all local platform-appropriate gates pass; Actions workflows
  invoke the same targets.

## Handoff

- Changed files: Makefile, workflows, package scripts, README.
- Evidence: `evidence/T07-make-and-ci.md`.
- Risks: target-Mac interactive timing remains T08.
- Next task: T08.
