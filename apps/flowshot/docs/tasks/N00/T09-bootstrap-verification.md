---
document_type: task
id: T09
node_id: N00
title: Verify and close N00
status: todo
depends_on:
  - T08
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
target-macOS minimal-window launch, and governance state is updated atomically.

## 前置事實與證據

T08 reports a real target-Mac window launch, cold-start timing, structured
command metadata, and a frozen N00 contract.

## 輸入

N00 test plan, completed task evidence, GitHub Actions results, and target-Mac
launch/performance evidence.

## 修改範圍

Verification report, task status/evidence, README corrections, graph status,
node outcome, and final lock inspection.

## 禁止事項

No weakened oracle, unrecorded failure, fabricated macOS result, product feature
addition, or overwrite of append-only history.

## 執行步驟

1. Re-run all BDD and negative tests from clean state.
2. Inspect architecture, capability, generated files, and contract lock.
3. Capture macOS build/launch and cold-start evidence.
4. Write `docs/verification/N00.md`.
5. Append the G2 outcome.
6. Mark N00 done only if every gate passes and evaluate downstream readiness.

## 首個失敗測試

- Command: verification checklist before evidence collection.
- Expected failure: N00 lacks a verification report and target-Mac launch proof.
- Requirement: node DoD and independent verification.

## 完成驗證

- Command: `make ci && python3 scripts/sdd.py verify`
- Expected result: zero exit plus a passed verification report, frozen lock,
  appended outcome, and graph state consistent with evidence.

## Handoff

- Changed files: verification/governance artifacts only.
- Evidence: commands, Actions URLs, macOS hardware/OS/timing record.
- Risks: any unmet dogfood or platform gate keeps N00 in verifying/blocked state.
- Next task: N01 and N03 become candidates only after graph/gate rules allow.
