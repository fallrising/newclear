---
document_id: PROTOCOL-DOCUMENT-CHANGE
version: 1.0.1
status: approved
authority: documentation-governance
---

# 文檔變更、派生與 Drift 管理

## 1. 單一權威原則

「SSOT」不表示所有內容必須塞在一個檔案；它表示同一事實只能由一個檔案擁有。

- 全局事實由 `SPEC.md` 擁有。
- Node 事實由對應 node spec 擁有。
- Command/DTO 由 Rust contract 擁有。
- Task doc 只能引用，不得創造產品需求。
- Verification doc 只能記證據，不得改驗收標準。

## 2. 修改分類

| 變更 | 必改文件 | 版本影響 |
|---|---|---|
| 文句澄清、無行為改變 | 原權威文件 | PATCH |
| 新增向後相容能力 | SPEC/node/contract/tests | MINOR |
| Canonicalization、schema、anchor 或 breaking API | ADR + SPEC + affected nodes | MAJOR |
| 實作細節、無 contract/行為改變 | implementation plan/task | 不改 SPEC |
| 測試 oracle 修正 | node spec/test plan，記 test defect | 視行為影響 |
| Dependency 前提改變 | graph + affected nodes | 至少 PATCH |

## 3. Source Hash

所有衍生文檔 front matter：

```yaml
derived_from:
  - ../../SPEC.md
  - ../../nodes/N09-reanchor-engine.md
source_version: {SPEC_VERSION}
source_sha256:
  SPEC.md: ...
  N09: ...
generated_at: RFC3339
```

CI 計算實際 hash。任一不符：

- 文檔狀態改為 `stale`。
- 對應 task 不得進入 implementation。
- 重新生成後必須人工確認差異，不得盲目覆蓋執行記錄。

## 4. Node Spec 變更

Node 開始前可直接修訂，但必須：

1. 說明原因。
2. 更新 version 或 `revision`。
3. 更新 contract/test plan。
4. 重新凍結 lock。

Node `implementing` 後修改 requirement：

- 記錄 `specification` rework。
- 暫停受影響 task。
- 保留舊版本 diff。
- 重新驗證所有受影響已完成 task。

Node `done` 後修改 requirement：

- 建立新 node 或 ADR。
- 不覆寫原 verification report。
- 需要 migration/backfill 時另建節點。

## 5. ADR 觸發條件

以下必須 ADR：

- 改 canonicalization/pipeline version。
- 改 AnchorV1 schema、threshold、margin、offset unit。
- 改 document identity/rename policy。
- 改 soft-delete/hard-delete policy。
- 改 SQLite schema 破壞性語義。
- 新增網路、權限、background service。
- Breaking command contract。
- 修改 v1 非目標或 Bonus Gate。

ADR 狀態：`proposed → accepted/rejected → superseded`。Rejected ADR 保留，防止相同問題反覆討論。

## 6. Contract Drift

- Rust source 是權威。
- Generated TypeScript、wrapper、manifest 必須可重現。
- 生成物 header 包含 generator version 與 source hash。
- 手動編輯生成物由 CI 阻斷。
- Lock file 只由 contract freeze 流程更新。
- Downstream node pin dependency contract hash；hash 變動即 stale。

## 7. Migration Drift

每個 migration：

- 單調版本。
- 不可修改已發布 migration；修正以新 migration。
- 有 checksum。
- 有空庫與逐版升級 test。
- 破壞性 migration 必須 backup/recovery plan。
- Schema 文檔與 migration 差異由 test/inspection 阻斷。

## 8. 狀態與歷史

禁止刪除或重寫：

- 已接受 ADR。
- 已完成 verification report。
- `node-outcomes.jsonl` 歷史行。
- 已發布 migration。
- Anchor event audit。

修正以新記錄追加，保留可追溯性。

## 9. PR/Commit 規則

每個 node PR 至少包含：

- Node/task ID。
- Requirement/BDD mapping。
- Contract hash。
- Red → green 證據。
- Verification 命令。
- Spec/test/execution defect 記錄。
- 無 scope expansion 聲明。

Commit 可按 task 切分。不要把多個無依賴 node 混在同一 PR。
