---
id: A03
title: Command Palette
kind: auxiliary
milestone: M4
status: todo
depends_on: 
  - N02
  - N04
  - A02
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread command palette
allowed_paths: 
  - src/features/palette/**
  - src-tauri/src/path_index/**
  - src-tauri/src/commands/path_index*
  - crates/core/src/contracts/A03*
  - crates/db/src/repositories/documents*
  - docs/tasks/A03/**
  - docs/verification/A03.md
  - contracts/locks/A03.json
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A03 — Command Palette

## 目標

提供鍵盤優先的文件快速開啟入口，並建立可擴充但不過度抽象的 action registry。

## 輸入與前置條件

- N02 workspace/document identity。
- A02 tree change event。
- N04 tab open action（整合時）。

## 範圍與交付物

- `rebuild_path_index` 以背景 traversal 只讀取 path/metadata、遵守 ignore/PathGuard，upsert document identity；不得阻塞 tree 首屏。
- `load_path_index` 一次載入已建立的本地 path index；支援 index version。
- A02 tree event 增量更新/標記 index stale。
- `⌘K` 開啟 palette。
- 文件名、相對路徑模糊匹配。
- deterministic subsequence scorer；同分以最近開啟、路徑排序。
- 鍵盤上/下、Enter、Esc。
- Action registry 僅定義 `id/title/keywords/execute`，v1 先註冊 open file。
- 5000 文件本地索引；index 未完成時顯示進度並仍可搜尋已發現文件。

## Contract

新增：

```text
rebuild_path_index({ workspace_id }) -> { index_version, indexed_files, duration_ms }
load_path_index({
  workspace_id,
  index_version?,
  cursor?,
  limit?
}) -> { index_version, entries, next_cursor }
```

`limit` 預設 5,000、最大 10,000；v1 workspace hard limit 100,000 indexed Markdown entries，超過時回明確錯誤並要求縮小 roots。載入多頁期間若 index version 改變，frontend 丟棄舊頁並重新開始。Contract 同時鎖定前端 action interface。

## 實作約束

- 不掃描未授權/ignored 路徑。
- 每次 keystroke 不觸發 filesystem IO。
- Background index 不能改變 N02 tree 的 lazy 行為，且可取消。
- 只有完整掃描成功後才能以本輪 seen-set 標記未見 documents 為 missing；取消/失敗不得批量改狀態。
- Index traversal 不讀正文、不跟隨 symlink。
- 不引入完整 plugin system。
- 搜尋結果 deterministic。

## BDD 場景

**Given** 5000 文件索引
**When** 連續輸入查詢
**Then** 每次響應 `< 30 ms`，Enter 開啟正確文件。

**Given** ignored 文件
**When** 查詢其名稱
**Then** 不出現在結果。

**Given** path index 尚在建立
**When** 使用者開啟 palette
**Then** 可搜尋已完成部分並看到進度，不阻塞主 UI。

## 測試計畫

- Scorer table tests。
- Tie-break determinism。
- Keyboard/a11y component。
- 5000 item benchmark。
- Open action integration。
- Background traversal cancellation、ignore、symlink、A02 stale update tests。

## 驗收標準

- `< 30 ms`。
- 全鍵盤可用。
- 不產生 IO burst。

## 性能與觀測

- 記錄 index size與查詢 duration，不記 query 原文。

## 非範圍

- 任意腳本、plugin、自然語言命令。

## 建議衍生任務

1. `T01-path-index-contract`
2. `T02-background-index-builder`
3. `T03-action-interface-and-scorer`
4. `T04-palette-ui`
5. `T05-watcher-incremental-update`
6. `T06-performance-a11y`

## Legacy 移植規則

可移植 legacy palette UI；scorer與 registry需符合本節點最小接口。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A03.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。
