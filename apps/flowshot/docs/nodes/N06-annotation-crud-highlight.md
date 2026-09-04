---
id: N06
title: Annotation CRUD、Sidebar 與重疊高亮
kind: core
milestone: M2
status: todo
depends_on: 
  - N01
  - N04
  - N05
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread annotation CRUD, sidebar, highlight
allowed_paths: 
  - crates/db/src/repositories/annotations*
  - crates/core/src/contracts/N06*
  - src-tauri/src/commands/annotations*
  - src/features/annotations/**
  - contracts/locks/N06.json
  - docs/tasks/N06/**
  - docs/verification/N06.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N06 — Annotation CRUD、Sidebar 與重疊高亮

## 目標

完成 range annotation 與 document note 的建立、讀取、更新、軟刪除、sidebar 呈現與可重疊高亮，形成第一條完整 dogfood 旅程。

## 輸入與前置條件

- N01 schema/repository。
- N05 AnchorV1。
- N03 DocumentModel segment。
- N04 tabs 可用於 E2E。

## 範圍與交付物

- Commands：list/create/update/delete annotation。
- Range annotation 可 body 空白；document note body 必須非空。
- color 限定五色 enum。
- mutation 使用 row_version。
- delete 為 tombstone，並在同 transaction tombstone comments。
- Sidebar：document note 頂部、range 依位置、orphan 分區。
- 高亮：interval segmentation 支援 overlap；leaf span 帶多 annotation IDs。
- 點 sidebar item 捲動到 range；點 highlight 選中 sidebar item。
- 100 annotation 文件的 render/update。
- E2E：選字 → 建批注 → 重開 → 仍可見。

## Contract

新增：

```text
list_annotations({ document_id, include_deleted?: false })
create_annotation({
  document_id, kind, body, color, anchor?,
  snapshot?: DocumentSnapshotRef
})
update_annotation({
  annotation_id, expected_row_version, body?, color?
})
delete_annotation({
  annotation_id, expected_row_version
})
```

Response 必須含 `row_version`, `anchor_status`, `last_resolution`, timestamps。

## 實作約束

- Annotation 不 hard delete。
- `kind=document` 時 anchor 必須 null；`kind=range` 時 anchor 與 snapshot 必須存在。
- UI 不得從 DOM 推測排序；以 current anchor start hint/重錨結果為基礎。
- 重疊 range 不得產生非法交錯 DOM。
- Search highlight 未完成前，renderer API 仍須支援多 layer interval。
- Mutation conflict 不得覆蓋別的更新。
- Range create 必須由 adapter 驗證 current stable file hash，並由 DB 驗證 snapshot revision/source/canonical/model version；stale model 不得建立。
- 刪除後 UI 即時隱藏，但資料保留。

## BDD 場景

### 場景 1：Range annotation

**Given** 使用者選中文字建立批注  
**When** 關閉再開該文件  
**Then** 高亮與 sidebar body/顏色一致。

### 場景 2：Document note

**Given** 無 selection，建立文件級筆記  
**When** 顯示 sidebar  
**Then** 位於頂部分區且正文沒有高亮。

### 場景 3：重疊

**Given** annotation A 與 B range 部分重疊  
**When** render  
**Then** 兩者都可點選，DOM mapping 仍可供新 selection 使用。

### 場景 4：Stale snapshot

**Given** 使用者選字後文件在外部被修改  
**When** 以舊 snapshot 建立 range annotation  
**Then** 回 CONFLICT，DB 無 annotation，UI refresh 後要求重新選取。

### 場景 5：軟刪除

**Given** annotation 有 comments  
**When** 使用者刪除 annotation  
**Then** UI 隱藏 annotation/comments，DB 只設 tombstone，不 hard delete。

## 測試計畫

- Repository CRUD/row_version/soft-delete tests。
- Range snapshot/file-hash conflict integration test。
- Contract serialization tests。
- Interval segmentation table/property test：disjoint、nested、crossing、same boundary。
- Sidebar ordering/component tests。
- Highlight → sidebar 和 sidebar → scroll integration。
- E2E #1。
- 100 annotation render benchmark。

## 驗收標準

- 五個 BDD 全過。
- E2E #1 綠。
- 100 annotations 無明顯卡頓。
- DB 查詢不回已刪資料（除非 include_deleted）。
- Overlap 不破壞 N05 selection mapping。

## 性能與觀測

- 100 annotation interval segmentation `< 20 ms`。
- list query 有 index plan。
- 日誌不記 body/exact，只記 count、duration、IDs。

## 非範圍

- Comment thread（N07）。
- Automatic reanchor（N09）。
- Tag（N08）。
- Rich text annotation body。

## 建議衍生任務

1. `T01-annotation-contracts`
2. `T02-repository-crud`
3. `T03-soft-delete-and-conflict`
4. `T04-interval-segmentation`
5. `T05-highlight-renderer`
6. `T06-sidebar-and-navigation`
7. `T07-e2e-and-benchmark`

## Legacy 移植規則

可按新測試移植 legacy CRUD/樣式；hard delete、單一高亮巢狀策略與舊 state 不得移植。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N06.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。
