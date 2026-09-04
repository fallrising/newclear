---
id: N10
title: Orphan 列表與手動恢復
kind: core
milestone: M3
status: todo
depends_on: 
  - N09
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread unmatched annotation list and manual reanchor
allowed_paths: 
  - crates/db/src/repositories/orphans*
  - crates/core/src/contracts/N10*
  - src-tauri/src/commands/orphans*
  - src/features/orphans/**
  - contracts/locks/N10.json
  - docs/tasks/N10/**
  - docs/verification/N10.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N10 — Orphan 列表與手動恢復

## 目標

讓所有自動重錨失敗的 annotation 可被發現、理解與人工恢復，完成「永不靜默丟失」閉環。

## 輸入與前置條件

- N09 orphan status/event。
- N05 可建立新 AnchorV1。
- N06 sidebar/highlight。

## 範圍與交付物

- 全局 orphan list，按 workspace/document 分組。
- 顯示凍結 exact 的安全摘要、prefix/suffix 摘要、最後 known path、reason/event。
- 重選模式：開啟文件，使用 N05 選新 range，提交 manual reanchor。
- Manual reanchor 寫 outcome=recovered、method=manual event，持久 status=attached。
- Convert to document note：anchor null、kind/document status 更新、body 保留。
- Missing document orphan 仍可見；文件恢復後可操作。
- 批量刪除與批量轉換均不在 v1；所有恢復操作逐項執行。
- E2E：製造 orphan → 手動重錨 → 高亮恢復。

## Contract

新增：

```text
list_orphans({ workspace_id, cursor?, limit? })
manual_reanchor({
  annotation_id,
  expected_row_version,
  snapshot: DocumentSnapshotRef,
  new_anchor
})
convert_to_document_note({
  annotation_id,
  expected_row_version
})
```

Manual mutation 必須 transaction 並寫 anchor event。

## 實作約束

- Orphan 不 hard delete。
- UI 不得把 fuzzy 建議自動提交；使用者必須選取。
- Manual reanchor 必須驗證 snapshot revision/hash/model version與 current stable file hash，並確認 new anchor hashes一致。
- Convert to document note 後 body 必須非空；若原 range annotation body 空，先要求輸入內容。
- Frozen exact 可顯示，但日誌不得記錄。
- Recovered 是 event outcome；持久 status 回 attached。

## BDD 場景

### 場景 1：列出 orphan

**Given** 3 個 orphan 分屬兩文件  
**When** 開啟 orphan list  
**Then** 可見文件、凍結內容摘要、reason、最後 event。

### 場景 2：手動重錨

**Given** orphan 所屬文件仍存在  
**When** 使用者進入重選模式並選新 range  
**Then** status=attached，event=recovered/manual，高亮恢復。

### 場景 3：轉文件筆記

**Given** orphan 有非空 body  
**When** 轉為 document note  
**Then** anchor=null、status=document、離開 orphan list、內容保留。

## 測試計畫

- Repository orphan query/pagination。
- Manual reanchor revision/row-version conflict。
- State transition table。
- Convert note validation。
- React reselect mode component。
- E2E #2。
- INV-2 regression checklist/test。

## 驗收標準

- 三個 BDD 全過。
- E2E #2 綠。
- 所有 N09 orphan 都可由列表追溯。
- Manual conflict 不覆蓋新版。
- 零 hard delete 路徑。

## 性能與觀測

- 1000 orphan 分頁首屏 `< 100 ms` DB+UI。
- 日誌只記 count、reason code、IDs。

## 非範圍

- 自動語義推薦。
- 永久 purge。
- 跨文件重新綁定（v1 只允許同 document）。

## 建議衍生任務

1. `T01-orphan-query-contract`
2. `T02-orphan-list-ui`
3. `T03-reselect-mode`
4. `T04-manual-reanchor-transaction`
5. `T05-convert-document-note`
6. `T06-e2e-and-invariant-review`

## Legacy 移植規則

可移植 legacy UX 概念；狀態與 audit 必須按新模型重寫。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N10.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

