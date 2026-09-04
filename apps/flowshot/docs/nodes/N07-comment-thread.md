---
id: N07
title: Comment Thread 與 Tombstone 引用
kind: core
milestone: M2
status: todo
depends_on: 
  - N06
size: S
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread annotation reply thread
allowed_paths: 
  - crates/db/src/repositories/comments*
  - crates/core/src/contracts/N07*
  - src-tauri/src/commands/comments*
  - src/features/comments/**
  - contracts/locks/N07.json
  - docs/tasks/N07/**
  - docs/verification/N07.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N07 — Comment Thread 與 Tombstone 引用

## 目標

在 annotation 下提供最多一層引用的留言串，使用 row-version concurrency 與 tombstone 保留引用結構。

## 輸入與前置條件

- N06 annotation lifecycle。
- N01 comment table/trigger。
- `SPEC.md` §9.4、§11.4。

## 範圍與交付物

- list/create/update/delete comment。
- parent_id 可 null 或指向同 annotation 的 root comment。
- UI 展開/折疊。
- Deleted comment 顯示 tombstone，回覆保留。
- Update/delete 使用 row_version。
- Annotation soft delete 時 comments 同步 tombstone。

## Contract

新增：

```text
list_comments({ annotation_id, include_deleted?: true })
create_comment({ annotation_id, parent_id?, body })
update_comment({ comment_id, expected_row_version, body })
delete_comment({ comment_id, expected_row_version })
```

預設 list 必須包含 tombstone metadata，以便保留 thread。

## 實作約束

- 最多一層；DB trigger 與 application validation 雙重保證。
- parent 必須同 annotation。
- body trim 後不可空。
- delete 不清空 child 的 parent_id。
- UI 不得顯示 tombstone 原 body。
- thread deterministic sort：created_at、ID tie-break。

## BDD 場景

### 場景 1：一層回覆

**Given** A、B、C 三條留言，C 回覆 A  
**When** 展開 thread  
**Then** 引用關係清楚且順序穩定。

### 場景 2：Parent 刪除

**Given** C 回覆 A  
**When** 刪除 A  
**Then** A 顯示「原留言已刪除」，C 仍存在。

### 場景 3：禁止二層

**Given** C 已回覆 A  
**When** 嘗試讓 D 回覆 C  
**Then** 回 validation error，DB 無部分寫入。

## 測試計畫

- DB parent trigger tests。
- Repository CRUD/row_version/tombstone。
- Contract serialization。
- Thread projection pure function。
- React component：expand、reply、edit、delete、tombstone。
- Annotation delete cascade-to-tombstone integration。

## 驗收標準

- 三個 BDD 場景全過。
- 無 hard delete。
- Conflict 不覆蓋留言。
- Thread UI 鍵盤可操作。

## 性能與觀測

- 100 comments list/render 無可感知延遲。
- 日誌不記 body。

## 非範圍

- 無限巢狀。
- Mention、reaction、多人身份、同步。

## 建議衍生任務

1. `T01-comment-contracts`
2. `T02-repository-and-trigger`
3. `T03-thread-projection`
4. `T04-comment-ui`
5. `T05-tombstone-and-conflict-tests`

## Legacy 移植規則

Legacy reply UI 可參考；持久化必須改成 tombstone 與一層 DB constraint。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N07.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。

