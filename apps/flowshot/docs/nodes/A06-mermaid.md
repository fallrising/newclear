---
id: A06
title: 安全 Mermaid 渲染
kind: auxiliary
milestone: M4+
status: todo
depends_on: 
  - N03
size: S
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread Mermaid rendering
allowed_paths: 
  - src/features/mermaid/**
  - src/lib/document-model/plugins/mermaid*
  - docs/tasks/A06/**
  - docs/verification/A06.md
  - contracts/locks/A06.json
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# A06 — 安全 Mermaid 渲染

## 目標

將 `lang=mermaid` code block 以本地、安全、局部失敗的方式渲染為可縮放圖形。

## 輸入與前置條件

- N03 code block AST與安全 HTML。

## 範圍與交付物

- 偵測 Mermaid code block。
- Lazy render：進入 viewport 或展開時才初始化。
- 使用本地 bundle、strict security。
- 成功顯示 SVG；失敗保留原始 code與錯誤。
- 縮放、平移、reset。
- 主題與應用 light/dark 同步，但輸出 deterministic snapshot不以時間/random id。

## Contract

無 Tauri command。凍結前端 `MermaidBlock` props與error type。

## 實作約束

- 禁止外部資源、HTML label、script、click callback。
- 單 block錯誤不得中止全文。
- SVG sanitize後插入。
- 不把 diagram source寫日誌。

## BDD 場景

**Given** 合法 diagram
**When** block進入 viewport
**Then** 顯示可縮放圖。

**Given** 非法 diagram
**When** render
**Then** 局部錯誤+source fallback，文件其他部分正常。

## 測試計畫

- 合法/非法diagram fixtures。
- Security corpus。
- Lazy render component。
- Zoom/pan/reset。
- Deterministic ID snapshot。

## 驗收標準

- 兩個 BDD全過。
- 無網路 request。
- 錯誤隔離。

## 性能與觀測

- 未進 viewport不初始化。
- 單圖render duration可觀測，不記source。

## 非範圍

- PlantUML。
- 編輯器、server rendering。

## 建議衍生任務

1. `T01-mermaid-block-contract`
2. `T02-secure-renderer`
3. `T03-lazy-ui-and-controls`
4. `T04-error-fallback`
5. `T05-security-tests`

## Legacy 移植規則

可移植 legacy UI；安全設定與 deterministic ID需重新驗證。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/A06.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

