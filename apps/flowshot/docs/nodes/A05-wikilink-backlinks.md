---
id: A05
title: Wikilink 與 Incremental Backlinks
kind: auxiliary
milestone: M4+
status: todo
depends_on: 
  - N02
  - N03
  - A02
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread wikilink/backlinks
allowed_paths: 
  - src/lib/document-model/plugins/wikilink*
  - crates/db/migrations/*document_links*
  - crates/db/src/repositories/links*
  - crates/core/src/contracts/A05*
  - src-tauri/src/commands/links*
  - src/features/backlinks/**
  - contracts/locks/A05.json
  - docs/tasks/A05/**
  - docs/verification/A05.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A05 — Wikilink 與 Incremental Backlinks

## 目標

解析 `[[target]]` 與 `[[target|alias]]`，保守解析文件目標並維護增量 backlink index；歧義不得自動選擇。

## 輸入與前置條件

- N02 document identity/path。
- N03 AST pipeline。
- A02 change notification。

## 範圍與交付物

- Markdown AST plugin 解析 wikilink，不以 regex 直接改 HTML。
- 新 migration `document_links`：source_document_id、raw_target、alias、target_document_id nullable、resolution、source range、source revision。
- Resolution 順序：
  1. current document directory relative exact path（補常見 extension）。
  2. root-relative exact path。
  3. workspace 內唯一 basename。
  4. 無或多候選 → broken/ambiguous。
- 開啟/變更文件只重建該 source document 的 links。
- Backlinks panel。
- Broken/ambiguous 樣式與候選提示。

## Contract

新增：

```text
reindex_document_links({ document_id, expected_revision, links })
list_backlinks({ document_id, cursor?, limit? })
```

Link parser output使用 canonical/source ranges與raw target。

## 實作約束

- 不全量掃 workspace 來更新單文件。
- Ambiguous 不自動選。
- ignored/missing document 不作可開啟 target。
- Link reindex transaction replaces one source document snapshot。
- 不執行 URI 或任意 HTML。

## BDD 場景

**Given** `[[notes/foo]]` 有唯一相對路徑
**When** render
**Then** 可點開正確 document並建立 backlink。

**Given** `[[foo]]` 有兩個 basename候選
**When** render
**Then** 標為 ambiguous，不自動選。

**Given** source document外部修改刪除 link
**When** A02觸發增量 reindex
**Then** backlink移除，其他文件不重掃。

## 測試計畫

- AST parser fixtures。
- Resolution table tests。
- Ambiguity tests。
- Incremental replace transaction。
- Rename/missing integration。
- Backlink UI。

## 驗收標準

- 無錯誤自動解析 ambiguous link。
- A02增量更新成立。
- Backlink查詢分頁與 deterministic。

## 性能與觀測

- 單文件 reindex隨該文件 link數線性。
- 不因一文件變更全庫掃描。

## 非範圍

- Graph visualization。
- Heading/block reference。
- Transclusion/embed。

## 建議衍生任務

1. `T01-link-ast-plugin`
2. `T02-document-links-migration`
3. `T03-resolver`
4. `T04-incremental-reindex`
5. `T05-backlink-panel`
6. `T06-rename-and-ambiguity-tests`

## Legacy 移植規則

可移植 legacy resolver案例；資料表與 incremental transaction按本規格重寫。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A05.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

