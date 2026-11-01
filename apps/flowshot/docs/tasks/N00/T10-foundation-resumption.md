---
document_type: task
id: T10
node_id: N00
title: Resume reproducible foundation checks
status: done
depends_on:
  - T07
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
  - scripts/**
  - crates/xtask/src/contracts.rs
  - package.json
  - .gitignore
  - Makefile
  - src-tauri/tauri.conf.json
  - .github/**
  - ../../.github/workflows/flowshot-ci.yml
  - README.md
  - docs/tasks/N00/**
forbidden_paths:
  - SPEC.md
  - contracts/locks/N00.json
  - src/generated/**
expected_duration: 90m
---

# T10 — Reproducible foundation continuation

Owner-authorized continuation independent of T08 target-Mac acceptance. Fix shared build paths, bounded launch observation/cleanup, frozen-lock metadata validation and monorepo CI. Keep all original product gates; no downstream implementation or new platform.

Verification: launcher runs Node regressions, frontend lint/test/build, Rust contract/test/lint and make ci; SDD regenerated then verified. Evidence: [resumption](evidence/T10-foundation-resumption.md). Independent audit/review required; native/Mac absence stays explicit.

Development acceptance: [N01/M0 verification](../../verification/N01.md), final complete Docker gate and independent T-006 ACCEPT. Historical RED/rework remains in the evidence; task-board merge closure is separate.
