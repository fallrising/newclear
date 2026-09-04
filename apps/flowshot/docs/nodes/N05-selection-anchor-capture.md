---
id: N05
title: DOM Selection 到 Anchor Capture
kind: core
milestone: M2
status: todo
depends_on: 
  - N03
size: L
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread TextQuoteSelector capture
allowed_paths: 
  - src/features/annotations/selection/**
  - crates/core/src/anchor/capture.rs
  - crates/core/src/contracts/N05*
  - src-tauri/src/commands/anchor*
  - contracts/locks/N05.json
  - docs/tasks/N05/**
  - docs/verification/N05.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N05 — DOM Selection 到 Anchor Capture

## 目標

把瀏覽器 DOM Range 可靠映射為 canonical UTF-8 byte range，並由 Rust core 建立 AnchorV1；CJK、emoji、跨 block 與 code selection 必須正確。

## 輸入與前置條件

- N03 的 `DocumentModel`、segment metadata 與 deterministic DOM。
- `SPEC.md` §5、§6.1。
- N00 contract generation。

## 範圍與交付物

- Selection listener 只接受 reader root 內的 selection。
- DOM text-node local offset（UTF-16）轉 Unicode scalar，再轉 canonical UTF-8 byte offset。
- 支援跨 paragraph/list/code block selection。
- 移除 selection 邊界中由 UI 插入、但不屬 canonical text 的節點。
- collapsed 或 canonical exact 全空白時不顯示「建立批注」。
- 浮動建立入口，鍵盤可操作。
- `build_anchor` command 呼叫 `core::anchor::capture`。
- Anchor prefix/suffix 各最多 32 Unicode scalar。
- source span 由 intersected segments 合併為 best-effort hint。

## Contract

新增：

```text
build_anchor({
  canonical_text,
  start_byte,
  end_byte,
  source_hash,
  canonical_hash,
  document_model_version,
  source_span_hint?
}) -> AnchorV1
```

Command 必須重算 canonical text SHA-256，並驗證 byte boundary、range、hash 格式、model version 與 exact 非空。若 frontend model hash 與 command input 不一致，回 `RENDER_MODEL_MISMATCH`；未知 model version 回 `UNSUPPORTED_MODEL_VERSION`。

## 實作約束

- DOM 不得成為持久 anchor。
- Offset unit 一律 UTF-8 byte；禁止混用 JS UTF-16 index。
- Anchor capture core 為純函數。
- Prefix/suffix 不保證唯一；建立 anchor 不得假裝唯一，歧義由 N09 保守處理。
- 任何 highlight/search UI wrapper 不得改變 canonical mapping。
- Selection 跨越 reader 外部或兩個文件時拒絕。
- Source span 錯誤不得影響 exact/prefix/suffix。

## BDD 場景

### 場景 1：跨 block

**Given** selection 從段落 A 跨到列表 B  
**When** 建立 anchor  
**Then** exact 等於 canonical text 對應聯合區間，range 為有效 UTF-8 boundary。

### 場景 2：CJK 與 emoji

**Given** selection 包含中文、emoji surrogate pair、combining mark  
**When** 轉換 offset  
**Then** exact 與視覺選區一致，無 byte slicing panic 或錯一字符。

### 場景 3：重複文字

**Given** exact 在文件出現三次  
**When** 建立 anchor  
**Then** anchor 保存 context 與 position hint；不宣稱已唯一識別。

### 場景 4：無效 selection

**Given** collapsed、全空白或跨 reader root selection  
**When** selectionchange  
**Then** 不顯示入口且不呼叫 command。

## 測試計畫

- Rust capture table test至少 20 cases：文首/尾、短 exact、CJK、emoji、combining、code、重複。
- TS DOM Range mapping test：nested inline elements、links、code span、跨 block。
- UTF-16 → UTF-8 conversion property test。
- Model segment boundary fuzz test。
- Keyboard/accessibility component test。
- 10 次本機 CJK 手動抽測記錄。

## 驗收標準

- 四個 BDD 場景全過。
- 至少 20 個 table case 全綠。
- 無任何 offset unit 未標注的公開型別。
- `AnchorV1` JSON 與 `SPEC.md` 完全一致，含 `document_model_version=1`。
- N06 可直接消費 anchor，無需再讀 source/DOM。

## 性能與觀測

- Selection mapping 在一般文件 `< 16 ms`。
- `build_anchor` 純函數 `< 2 ms`（1 MiB text、單 range）。
- 日誌只記 range 長度與 hash，不記 exact。

## 非範圍

- 保存 annotation（N06）。
- Reanchor（N09）。
- Source editor 跳轉。

## 建議衍生任務

1. `T01-selection-boundary-contract`
2. `T02-dom-segment-mapper`
3. `T03-utf16-to-utf8-offset`
4. `T04-rust-anchor-capture`
5. `T05-floating-action-ui`
6. `T06-edge-case-property-tests`
7. `T07-manual-cjk-verification`

## Legacy 移植規則

Legacy selector 可作測試資料來源，不直接複製 offset/DOM 實作；新 mapping 以 N03 segment model 為唯一基礎。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N05.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

