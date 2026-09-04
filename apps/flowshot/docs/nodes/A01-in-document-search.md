---
id: A01
title: 檔內搜尋
kind: auxiliary
milestone: M4
status: todo
depends_on: 
  - N03
  - N06
size: S
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread in-document search
allowed_paths: 
  - crates/core/src/search/**
  - crates/core/src/contracts/A01*
  - src-tauri/src/commands/search*
  - src/features/search/**
  - contracts/locks/A01.json
  - docs/tasks/A01/**
  - docs/verification/A01.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A01 — 檔內搜尋

## 目標

在 canonical text 上提供安全、可預測的檔內搜尋，支援 literal/regex、大小寫、全字與上下跳轉，並與 annotation interval renderer 共存。

## 輸入與前置條件

- N03 canonical text/segments。
- N06 interval renderer 若已完成則整合；可先以 adapter 開發。

## 範圍與交付物

- 使用 Rust `regex` 類線性時間引擎執行 regex；不使用可 catastrophic backtracking 的主執行緒 JS RegExp。
- literal、case-sensitive、whole-word、regex。
- 結果回 UTF-8 byte ranges。
- UI 顯示結果數、current index、next/previous。
- 搜尋 layer 與 annotation layer共用 interval segmentation。
- 無效/不支援 regex 語法顯示錯誤。

## Contract

新增：

```text
search_text({
  canonical_text,
  query,
  mode: "literal" | "regex",
  case_sensitive,
  whole_word,
  max_results
}) -> { ranges, truncated }
```

`max_results` 預設 1000、最大 5000。

## 實作約束

- Search result 只對目前 canonical hash 有效；hash 變更即丟棄。
- Regex syntax 以選定 Rust engine 為準，UI 要說明不支援 backreference/lookaround（若 engine 不支援）。
- 不在 main UI thread 做無界限 regex。
- Range 必須 UTF-8 boundary。
- max_results 防止巨大 DOM。

## BDD 場景

**Given** invalid regex  
**When** 搜尋  
**Then** 顯示具體 pattern error，不崩潰、不當作零結果。

**Given** annotation 與 search range overlap  
**When** 切換結果  
**Then** annotation 仍可點選，DOM mapping 不失效。

## 測試計畫

- Literal/regex/case/whole-word table tests。
- Unicode/CJK boundary tests。
- Invalid pattern tests。
- 1 MiB benchmark。
- Overlap layer component test。

## 驗收標準

- 1 MiB 常見查詢 `< 50 ms`。
- Invalid regex 安全。
- Result navigation deterministic。

## 性能與觀測

- Command 記錄 pattern length、result count、duration，不記 pattern 原文。

## 非範圍

- 跨文件全文索引。
- Replace。

## 建議衍生任務

1. `T01-search-contract`
2. `T02-core-search-engine`
3. `T03-search-ui`
4. `T04-highlight-layer-integration`
5. `T05-performance-tests`

## Legacy 移植規則

可參考 legacy UX；搜尋語義與 offset 必須改用 canonical text。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A01.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。
