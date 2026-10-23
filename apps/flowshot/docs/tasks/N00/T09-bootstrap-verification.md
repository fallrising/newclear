---
document_type: task
id: T09
node_id: N00
title: Verify and close N00
status: done
depends_on:
  - T10
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
  - README.md
  - docs/tasks/N00/**
  - docs/verification/N00.md
  - docs/metrics/node-outcomes.jsonl
  - docs/graph.yaml
  - contracts/locks/N00.json
forbidden_paths:
  - SPEC.md
  - new product code
expected_duration: 90m
---

# T09 — Verify and close N00

## 單一交付結果

Independent evidence shows every N00 requirement and BDD passes, including a
Linux Docker native-window and real frontend IPC smoke (SPEC §13.1), and governance state is updated atomically.

## 前置事實與證據

T10 provides the repaired foundation; Linux Docker must pass complete native gates and real window/IPC smoke. T08 controlled-Mac launch remains a separate release requirement.

## 輸入

N00 test plan, completed task evidence, GitHub Actions results, and Linux native evidence; separately record the pending target-Mac release evidence.

## 修改範圍

Verification report, task status/evidence, README corrections, graph status,
node outcome, and final lock inspection.

## 禁止事項

No weakened oracle, unrecorded failure, fabricated macOS result, product feature
addition, or overwrite of append-only history.

## 執行步驟

1. Re-run all BDD and negative tests from clean state.
2. Inspect architecture, capability, generated files, and contract lock.
3. Capture Linux Docker native build/test and window/IPC smoke evidence; retain Mac launch as pending release acceptance.
4. Write `docs/verification/N00.md`.
5. Append the G2 outcome.
6. Mark N00 done only if every gate passes and evaluate downstream readiness.

## 首個失敗測試

- Command: verification checklist before evidence collection.
- Expected failure: N00 lacks a verification report and Linux native launch proof.
- Requirement: node DoD and independent verification.

## 完成驗證

- Command: `make ci && python3 scripts/sdd.py verify`
- Expected result: zero exit plus a passed verification report, frozen lock,
  appended outcome, and graph state consistent with evidence.

## Handoff

- Changed files: verification/governance artifacts only.
- Evidence: commands, Actions URLs, Linux container/toolchain/window/IPC record, with Mac release evidence pending.
- Risks: any unmet development gate keeps N00 in verifying/blocked; the Mac release gate remains tracked in SUCCESS AC-02.
- Next task: N01 and N03 become candidates only after graph/gate rules allow.

Development acceptance: [N01/M0 verification](../../verification/N01.md), final complete Docker gate and independent T-006 ACCEPT. Historical RED/rework remains in the evidence; task-board merge closure is separate.
