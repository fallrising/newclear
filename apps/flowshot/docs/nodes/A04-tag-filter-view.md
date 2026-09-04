---
id: A04
title: Tag AND Filter View
kind: auxiliary
milestone: M4
status: todo
depends_on: 
  - N08
size: S
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: []
allowed_paths: 
  - crates/db/src/repositories/tag_query*
  - crates/core/src/contracts/A04*
  - src-tauri/src/commands/tag_query*
  - src/features/tag-filter/**
  - contracts/locks/A04.json
  - docs/tasks/A04/**
  - docs/verification/A04.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A04 — Tag AND Filter View

## 目標

以多標籤 AND 語義查詢 document 與 annotation target，分頁展示並可跳轉到文件或 anchor。

## 輸入與前置條件

- N08 tag/binding。
- N04/N06 navigation target。

## 範圍與交付物

- `query_tagged_targets`，文件與 annotation 分別查詢。
- SQL 使用 GROUP BY/HAVING COUNT(DISTINCT tag_id)=N。
- 排除 archived root 與 deleted annotation；missing document 仍回傳並標記 status，以保留可追溯性。
- Annotation 結果依 document 分組，回 anchor status/position。
- Multi-select tag UI、cursor pagination。
- 點 document 開 tab；點 annotation 開 tab 並定位，orphan 則開 sidebar/orphan context。

## Contract

```text
query_tagged_targets({
  tag_ids,
  target_types: ["document"|"annotation"],
  cursor?,
  limit?
}) -> { documents, annotations, next_cursor }
```

## 實作約束

- AND 對同一 target 成立，不把 document tag 與其 annotation tag混算。
- tag_ids 空集合顯示空/提示，不等同全庫。
- deterministic sort。
- 查詢必須使用 index，不做 application-side全量 filter。

## BDD 場景

**Given** 選擇 `terraform` + `rds`
**When** 查詢
**Then** 只回同一 target 同時具有兩 tag 的結果。

**Given** annotation orphan
**When** 點結果
**Then** 開文件與 orphan context，不假裝可高亮。

## 測試計畫

- SQL result semantics。
- Duplicate tag input normalization。
- Deleted annotation 排除；missing document 保留並標記。
- Cursor determinism。
- 10,000 bindings benchmark。
- Navigation component。

## 驗收標準

- AND 語義準確。
- 10,000 bindings `< 50 ms`。
- document/annotation 跳轉閉環。

## 性能與觀測

- Query plan入verification report。
- 日誌只記 tag count/result count。

## 非範圍

- OR/NOT、saved queries、tag hierarchy。

## 建議衍生任務

1. `T01-query-contract`
2. `T02-document-and-annotation-sql`
3. `T03-pagination`
4. `T04-filter-ui`
5. `T05-navigation-and-benchmark`

## Legacy 移植規則

全新實作。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A04.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

