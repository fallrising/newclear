---
id: N08
title: 扁平 Tag 系統與 System Pin
kind: core
milestone: M4
status: todo
depends_on: 
  - N01
  - N04
  - N06
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: []
allowed_paths: 
  - crates/core/src/tags/**
  - crates/db/src/repositories/tags*
  - crates/core/src/contracts/N08*
  - src-tauri/src/commands/tags*
  - src/features/tags/**
  - contracts/locks/N08.json
  - docs/tasks/N08/**
  - docs/verification/N08.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N08 — 扁平 Tag 系統與 System Pin

## 目標

建立文件與 annotation 的全局扁平標籤系統，具 Unicode normalization、rename/merge transaction、autocomplete 與不可變 system tag `pin`。

## 輸入與前置條件

- N01 tags/document_tags/annotation_tags schema。
- N04 document header/tab UI 掛點。
- N06 annotation sidebar 掛點。
- `SPEC.md` §9.5、§11.5。

## 範圍與交付物

- Tag normalization：trim → NFKC → Unicode case fold → trim。
- create/list/rename/merge/delete user tag。
- set document tags、set annotation tags，輸入完整 desired set，操作冪等。
- Autocomplete 顯示 display_name，按 normalized key 搜尋。
- document tree/context/header 與 annotation sidebar 的 tag picker。
- System tag `pin` seed migration；不可 rename/delete，只可綁 document。
- Merge 在單一 transaction 更新兩種 binding 並去重。
- 10,000 binding query/index benchmark。
- 作為 G2 無 legacy 節點的獨立覆盤樣本。

## Contract

新增：

```text
list_tags({ query?, cursor?, limit? })
create_tag({ display_name })
rename_tag({ tag_id, display_name })
merge_tags({ source_tag_id, target_tag_id })
delete_tag({ tag_id })
set_document_tags({ document_id, tag_ids })
set_annotation_tags({ annotation_id, tag_ids })
```

所有 response 回傳 canonical tag DTO：id、display_name、normalized_name、kind。

## 實作約束

- 不使用 SQLite `COLLATE NOCASE` 作 Unicode 唯一性。
- 不使用 polymorphic target_id table。
- `/` 不具 hierarchy。
- rename/merge 必須 transaction。
- 重複 binding 冪等。
- system pin 只能 document。
- Deleted annotation 不應出現在一般 tag result；binding 可保留供 backup。
- Tag max 64 Unicode scalar；空或 normalization 後空字串拒絕。

## BDD 場景

### 場景 1：Normalization

**Given** `Terraform`、` terraform ` 與大小寫等價輸入  
**When** create  
**Then** 只存在一個 normalized tag，UI 回現有 tag。

### 場景 2：Merge

**Given** `tf` 與 `terraform` 分別綁定多個 document/annotation  
**When** merge `tf` → `terraform`  
**Then** 全部 binding 移轉、重複去除、source tag 刪除，transaction 不留中間態。

### 場景 3：Pin

**Given** system tag `pin`  
**When** 嘗試 rename/delete 或綁 annotation  
**Then** transaction 被拒絕。

### 場景 4：冪等 set

**Given** target 已有指定 tags  
**When** 重送相同 desired set  
**Then** DB 無重複 row，結果相同。

## 測試計畫

- Unicode normalization table/property test。
- DB create/rename/merge/delete transaction tests。
- System pin trigger tests。
- set desired state idempotency。
- 10,000 bindings benchmark。
- Autocomplete component。
- Document/annotation tag picker integration。

## 驗收標準

- 四個 BDD 全過。
- 10,000 bindings 基礎查詢 `< 50 ms`。
- 無 polymorphic FK。
- Merge 可在失敗注入時完整 rollback。
- 完成單獨 G2 verification report。

## 性能與觀測

- list/autocomplete query `< 30 ms` at 10,000 tags（本地 benchmark）。
- binding query `< 50 ms`。
- 日誌只記 tag IDs/count，不記私人 display name（debug 模式除外且預設關）。

## 非範圍

- Tag hierarchy、namespace、顏色、權限。
- A04 跨 target 結果頁。
- 自動推薦 tag。

## 建議衍生任務

1. `T01-tag-normalization`
2. `T02-tag-contracts`
3. `T03-repository-crud`
4. `T04-transactional-merge`
5. `T05-system-pin`
6. `T06-tag-pickers`
7. `T07-benchmark-and-g2-review`

## Legacy 移植規則

本節點無 legacy implementation。不得以 Pin 舊碼替代完整 tag model；只能參考 pin UX。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N08.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

