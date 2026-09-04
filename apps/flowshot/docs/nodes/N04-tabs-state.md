---
id: N04
title: 多分頁與狀態持久化
kind: core
milestone: M1
status: todo
depends_on: 
  - N02
  - N03
size: S
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread open_tabs persistence
allowed_paths: 
  - src/features/tabs/**
  - src-tauri/src/commands/app_state*
  - crates/core/src/contracts/N04*
  - contracts/locks/N04.json
  - docs/tasks/N04/**
  - docs/verification/N04.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N04 — 多分頁與狀態持久化

## 目標

提供多文件 tab、每 tab 獨立捲動位置與重啟恢復；恢復過程必須 lazy，missing 文件不得造成崩潰。

## 輸入與前置條件

- N02 可安全開啟 document。
- N03 可 render document model。
- N01 app_state schema 可用。

## 範圍與交付物

- Tab state machine：open、activate、close、close others。
- Tab identity 使用 document UUID。
- 每 tab 保存 scroll offset、last active time。
- 持久化 active workspace、open tabs、active tab。
- save debounce，app close 前 flush。
- 啟動時只立即載入 active tab，其餘 tab lazy restore。
- missing document tab 顯示占位與 known path。

## Contract

新增：

```text
load_app_state({ scope, keys })
save_app_state({ scope, entries, expected_updated_at? })
```

State JSON 必須帶 schema version；未知較新版本不得崩潰，回明確錯誤並保留 DB 原值。

## 實作約束

- localStorage 不得作權威來源。
- 任何 tab action 必須由純 reducer 測試。
- scroll restore 必須在 document model 完成後執行，且 clamp 到有效範圍。
- 啟動恢復不得同時讀取所有 tab 正文。
- State write 失敗顯示非阻斷提示，不得丟失當前 UI state。

## BDD 場景

### 場景 1：重啟恢復

**Given** 3 個 tab，各自位於不同 scroll offset  
**When** 關閉並重啟  
**Then** tab、active tab、各自 scroll 恢復。

### 場景 2：Missing 文件

**Given** 某 tab 對應文件外部刪除  
**When** 重啟  
**Then** tab 保留並顯示 missing 占位，不崩潰。

### 場景 3：Lazy restore

**Given** 保存 10 個 tab  
**When** 啟動  
**Then** active tab 先可讀，其餘只在 activation 或 idle preload 時讀取。

## 測試計畫

- Pure reducer table test。
- app_state serialization/version test。
- React component：close/activate/close others。
- scroll restore with delayed render。
- missing document integration。
- 10 tabs load trace，確認無 burst open。

## 驗收標準

- 三個 BDD 場景全過。
- 10 tab 切換無可感知卡頓。
- app close 前 state flush 可重現。
- state schema 有版本與 backward-compatible reader。

## 性能與觀測

- Tab action UI budget `< 16 ms`（不含文件載入）。
- State write debounce 建議 250 ms。
- 日誌只記 tab count/document ID，不記正文。

## 非範圍

- Tab reorder、跨視窗 tab。
- 雲端同步。
- 任意 layout/workspace restore。

## 建議衍生任務

1. `T01-tab-state-machine`
2. `T02-app-state-contract`
3. `T03-persistence-adapter`
4. `T04-lazy-restore`
5. `T05-scroll-restoration`
6. `T06-integration-verification`

## Legacy 移植規則

可參考 legacy open_tabs 資料形態，但須改用 document UUID、schema version 與 lazy restore。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N04.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

