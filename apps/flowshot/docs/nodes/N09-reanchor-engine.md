---
id: N09
title: 純函數 Reanchor Engine 與批量交易
kind: core
milestone: M3
status: todo
depends_on: 
  - N05
  - N06
size: L
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread anchor recovery prototype
allowed_paths: 
  - crates/core/src/anchor/reanchor.rs
  - crates/core/src/anchor/scoring.rs
  - crates/db/src/repositories/reanchor*
  - crates/core/src/contracts/N09*
  - src-tauri/src/commands/reanchor*
  - scripts/drill-reanchor.sh
  - contracts/locks/N09.json
  - docs/tasks/N09/**
  - docs/verification/N09.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N09 — 純函數 Reanchor Engine 與批量交易

## 目標

實作保守、可測、可審計的 AnchorV1 重錨引擎，並以 document revision transaction 防止 watcher/open 競態造成 lost update。

## 輸入與前置條件

- N05 AnchorV1/canonical offset。
- N06 annotation repository/UI。
- N01 anchor event table。
- `SPEC.md` §6。

## 範圍與交付物

- `reanchor(anchor, new_text)` 純函數與所有 result/reason enum。
- Unchanged fast path、唯一 exact、具固定公式與 margin 的 context rank、fuzzy generation/scoring。
- 固定 threshold 0.82、margin 0.08、短 exact 禁 fuzzy。
- 更新 anchor context/hash/position/source-span hint；source map 無完整覆蓋時清空過期 source span；舊值寫 audit。
- `reanchor_document` 批量 command。
- 單 transaction 更新 document revision、hash、annotations、events。
- expected revision conflict。
- 開檔 trigger source 與 watcher trigger source。
- `scripts/drill-reanchor.sh`：對指定 git workspace 的相鄰 revision 回放並輸出 JSON/Markdown report。
- 真實 KB 本機回放至少 20 文件，不提交正文。

## Contract

新增：

```text
reanchor_document({
  document_id,
  expected_document_revision,
  observed_source_hash,
  canonical_hash,
  document_model_version,
  canonical_text,
  source_map_segments,
  trigger_source: "open" | "watcher" | "replay"
}) -> {
  new_revision,
  unchanged,
  shifted_exact,
  shifted_context,
  shifted_fuzzy,
  orphaned
}
```

Core public API 與 enum 必須序列化 stable code，不以 human message 作分支。

## 實作約束

- Core 零 IO/clock/DB。
- 多候選、超時、分數不足全部 orphan。
- Fuzzy 對 exact < 4 Unicode scalar 禁用；短 exact 唯一匹配仍須 context 或 256-byte position guard。
- 一份 document 一個 transaction；不得 annotation-by-annotation commit。即使 annotation count=0，source/canonical hash 的新版本也只能由此 transaction 提交。
- Conflict 時不得寫部分 event。
- 失敗不得改寫 frozen anchor。
- Adapter 必須重算 canonical hash，並在 transaction 前以 stable read 驗證 current file hash 等於 `observed_source_hash`。
- Source-map segment range 無效時回 `RENDER_MODEL_MISMATCH`，不得提交部分結果。
- Anchor/document model version 不支援或不一致時回 `UNSUPPORTED_MODEL_VERSION`；不得跨版本直接匹配。
- 性能不得以降低保守性換取。
- Algorithm threshold 變更需要 ADR + replay evidence。

## BDD 場景

### 場景 1：前方插入

**Given** annotation 錨於句 S  
**When** S 前方插入兩段，S 不變  
**Then** attached，method exact/context，range 正確平移。

### 場景 2：輕微修改

**Given** S 被小幅修改且 top score 過門檻  
**When** reanchor  
**Then** attached、outcome shifted、method fuzzy、anchor exact 更新、舊 anchor 留 audit。

### 場景 3：刪除

**Given** S 被完全刪除  
**When** reanchor  
**Then** orphaned，anchor 原樣凍結。

### 場景 4：並列候選

**Given** 兩個候選同分或 margin 不足  
**When** reanchor  
**Then** orphaned，不猜測。

### 場景 5：Revision conflict

**Given** job A/B 同時基於 revision 5  
**When** A 先提交成 6，B 再提交  
**Then** B 回 CONFLICT 且無任何部分寫入。

## 測試計畫

- Table-driven ≥ 30 cases：exact/context/fuzzy/short/duplicate/CJK/code。
- Property：在 exact 前後隨機插入/刪除且保持 exact 唯一時仍 attached。
- Mutation tests 或等價負向 corpus，確認模糊誤配被拒絕。
- Performance benchmark：1 MiB × 100 annotations `< 100 ms` core。
- Stable file-hash mismatch、DB revision conflict與 failure injection。
- Source span refresh/clear tests。
- Model version mismatch tests。
- Replay harness synthetic corpus。
- 本機真實 git history 20 文件人工抽核與統計。

## 驗收標準

- 五個 BDD 全過。
- Table/property/transaction tests 全綠。
- Core benchmark `< 100 ms`。
- 真實 replay attached（含 shifted）比例 `>= 90%`，誤配為 0；orphan 可追溯。
- Audit event 完整，無正文進日誌。
- `drill-reanchor.sh` 可重現。

## 性能與觀測

- Core benchmark獨立於 IPC/DB。
- Command 另記 core、transaction、total duration。
- 超時/候選數作 metrics；不記 exact。

## 非範圍

- Manual orphan recovery（N10）。
- Watcher event ingestion（A02）。
- 機器學習語義匹配。

## 建議衍生任務

1. `T01-result-and-error-contract`
2. `T02-exact-context-matcher`
3. `T03-fuzzy-candidate-generator`
4. `T04-conservative-scoring`
5. `T05-property-and-performance-tests`
6. `T06-batch-transaction`
7. `T07-replay-drill-and-audit`

## Legacy 移植規則

Legacy code只可作候選演算法參考。先建立新 corpus 與 property tests，再決定逐函數移植或重寫；舊 threshold/state 不具權威。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N09.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

