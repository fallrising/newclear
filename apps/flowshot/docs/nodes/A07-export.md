---
id: A07
title: Annotation/Tag 匯出
kind: auxiliary
milestone: M4+
status: todo
depends_on: 
  - N02
  - N06
  - N07
  - N08
size: S
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: []
allowed_paths: 
  - crates/core/src/export/**
  - crates/core/src/contracts/A07*
  - src-tauri/src/commands/export*
  - src/features/export/**
  - docs/export-schema/**
  - contracts/locks/A07.json
  - docs/tasks/A07/**
  - docs/verification/A07.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A07 — Annotation/Tag 匯出

## 目標

將 annotation、comment、tag 與 AnchorV1 安全匯出為 Markdown 或版本化 JSON，使用 workspace 外目的地與 atomic write。

## 輸入與前置條件

- N06 annotation/comment資料。
- N08 tag資料。
- N02 PathGuard/root清單。

## 範圍與交付物

- 篩選：workspace、documents、tags。
- Format：Markdown、JSON。
- JSON schema version 1，含 document UUID/path/status、committed document model version、annotation/comment/tag/anchor/event可選。
- 選項 include_deleted。
- Markdown以document分組，range annotation含quoted exact與comment thread。
- 使用系統save dialog。
- Export destination guard。
- temp file + fsync（平台可行時）+ atomic rename。
- 建立JSON parser/round-trip contract test，雖v1不提供import UI。

## Contract

新增：

```text
export_data({
  selection,
  format: "markdown" | "json",
  destination_path,
  include_deleted: false,
  include_anchor_events: false
}) -> { bytes_written, item_counts, schema_version }
```

## 實作約束

- 目的地在任何workspace root內即拒絕。
- 不修改source Markdown。
- Export失敗不得留下看似完整的目標檔；暫存檔要清理。
- JSON field與enum stable。
- 絕對path預設可選擇redact為workspace-relative；預設不輸出root abs path。

## BDD 場景

**Given** destination在workspace內
**When** export
**Then** 回 `EXPORT_PATH_FORBIDDEN`，workspace零變更。

**Given** export JSON完成
**When** 用schema parser讀回
**Then** annotation/comment/tag/anchor無損。

**Given** 中途寫入失敗
**When** command結束
**Then** 無部分完成的target file。

## 測試計畫

- PathGuard export reverse containment。
- JSON schema/golden/round-trip parser。
- Markdown snapshot。
- Failure injection atomic write。
- include_deleted semantics。
- E2E #6。

## 驗收標準

- 三個BDD全過。
- E2E #6綠。
- JSON可未來無損import。
- Workspace git diff/mtime證明零寫入。

## 性能與觀測

- 10000 annotation export應串流或有界內存；verification記peak memory。
- 日誌只記counts/bytes/path相對摘要。

## 非範圍

- Import UI。
- 自動備份排程。
- 雲端上傳。

## 建議衍生任務

1. `T01-export-contract-and-schema`
2. `T02-export-query`
3. `T03-json-serializer-parser`
4. `T04-markdown-renderer`
5. `T05-safe-atomic-write`
6. `T06-ui-and-e2e`

## Legacy 移植規則

全新實作。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A07.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。
