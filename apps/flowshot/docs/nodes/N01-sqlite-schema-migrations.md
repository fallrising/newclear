---
id: N01
title: SQLite Schema、Migration 與 Repository
kind: core
milestone: M0
status: todo
depends_on: 
  - N00
size: M
revision: 1
source_spec: ../../SPEC.md
source_version: 1.0.1
source_sha256: dd79293480f237ee9ff881f9b5a661d320cd65dfda66e70a256cd9309ac29b2e
contract_status: draft
legacy_reference: 
  - mdread SQLite schema and migration patterns
allowed_paths: 
  - crates/db/**
  - crates/core/src/contracts/N01*
  - src-tauri/src/db*
  - contracts/locks/N01.json
  - docs/tasks/N01/**
  - docs/verification/N01.md
forbidden_paths: 
  - SPEC.md（除非本節點明確是治理變更）
---

# N01 — SQLite Schema、Migration 與 Repository

## 目標

實作 `SPEC.md` §9 的完整 SQLite 基線、migration framework、資料不變量、transaction policy 與 typed repository，使所有上層節點不需直接接觸 SQL。

## 輸入與前置條件

- N00 已完成，contract/CI 可用。
- `SPEC.md` §3、§6、§9。
- DB path 由 Tauri platform app-data directory 提供。

## 範圍與交付物

- 建立 migration runner、`schema_migrations(version, checksum, applied_at)`。
- 實作 `SPEC.md` §9.2 全部資料表、index 與 §9.3 triggers。
- 每個 connection 設定 foreign keys、WAL、synchronous、busy timeout。
- 使用 UUIDv7 字串 ID、UTC epoch milliseconds。
- 建立 blocking DB executor：單一 write actor、有界 read connections；測試可注入 fixed clock/ID。
- 建立 typed repository 與 transaction boundary；禁止上層寫 raw SQL。
- 建立 soft-delete API primitive。
- 建立測試 DB factory：in-memory 與 tempfile WAL 兩種。
- 建立 seed/benchmark helper，產生 10,000 annotation 與 10,000 bindings。

## Contract

本節點不新增使用者可見 Tauri command，但需凍結 repository-facing domain types：

```rust
pub struct RowVersion(pub u64);
pub struct DocumentId(pub Uuid);
pub struct AnnotationId(pub Uuid);
pub struct TagId(pub Uuid);

pub trait TransactionRunner {
    fn transaction<T>(&self, f: impl FnOnce(&mut Transaction) -> Result<T>) -> Result<T>;
}
```

Repository interface 只暴露 typed method；SQL row 不得跨出 `db` crate。

## 實作約束

- DDL 語義必須與 `SPEC.md` §9 一致。
- `documents`、`annotations`、`comments` hard delete 必須由 trigger 阻斷。
- Comment parent trigger 必須同時驗證同 annotation 與最多一層。
- System tag trigger 必須保護 `pin`。
- Migration 不提供 down，不允許跳號、重複 version 或 checksum 變更。
- Application migration 執行失敗時不得啟動到主 UI。
- Mutation 必須在 transaction 內更新該 table 的 `updated_at`。只有具
  `row_version` 的 annotation/comment mutation 遞增該 token；document
  version commit 遞增 `revision`；app-state compare-and-set 使用
  `expected_updated_at`。Create、idempotent desired-set 與 tag merge 不新增
  schema 未定義的 row version。
- 禁止在 Tauri async runtime thread 直接執行 rusqlite blocking query。

## BDD 場景

### 場景 1：空庫升級

**Given** 空 DB  
**When** migration runner 執行  
**Then** 升到 latest version，checksum 與 applied_at 完整。

### 場景 2：冪等啟動

**Given** 已是 latest schema  
**When** migration runner 再次執行  
**Then** 無 DDL 重跑、無資料變更、結果成功。

### 場景 3：禁止 hard delete

**Given** document 下存在 annotation/comment  
**When** 任意 raw `DELETE` 嘗試刪除 document、annotation 或 comment  
**Then** SQLite trigger 拒絕，原資料完整。

### 場景 4：一層引用

**Given** comment B 回覆 comment A  
**When** 嘗試建立 comment C 回覆 B  
**Then** transaction 失敗並回傳 validation error。

## 測試計畫

- `db/tests/migrations.rs`：空庫、逐版升級、latest 重跑、checksum tamper。
- `db/tests/invariants.rs`：hard delete、annotation kind/anchor check、document model version、system pin、comment parent。
- `db/tests/soft_delete.rs`：annotation tombstone 同步 comments；comment tombstone 保留 replies。
- `db/tests/concurrency.rs`：row_version conflict。
- WAL tempfile integration test。
- 10,000 row migration/seed benchmark。

## 驗收標準

- 所有 DDL、trigger、index 有自動測試。
- SQLite foreign key violations 無法由 repository 繞過。
- 10,000 annotation 的初始 migration/seed 操作 `< 1 s`（release build，記錄硬體）。
- DB 檔案位於 platform app-data directory。
- 上層 crate 無 raw SQL。

## 性能與觀測

- migration、transaction、busy retry 皆輸出結構化 duration。
- DB error 日誌不得包含 annotation/comment body。
- 建立 index query plan snapshot，避免後續 schema 漂移。

## 非範圍

- Workspace command。
- Anchor 演算法。
- Tag UI。
- 永久 purge、down migration、雲端備份。

## 建議衍生任務

1. `T01-migration-runner`
2. `T02-base-schema`
3. `T03-integrity-triggers`
4. `T04-repository-interfaces`
5. `T05-soft-delete-semantics`
6. `T06-db-executor-concurrency-and-row-version`
7. `T07-schema-benchmarks`

## Legacy 移植規則

可閱讀 legacy schema 取得命名與 query 經驗，但 DDL 必須按新 schema 重寫；不得帶入 polymorphic tag binding、hard delete cascade 或舊 annotation state。


## 完成定義

除本節點特定驗收外，尚須同時符合：

- Contract lock 已建立且 drift check 為零。
- 測試先行證據已寫入 implementation plan 或 PR 描述。
- 本節點 BDD、unit/component/integration test 全綠。
- `make ci` 全綠。
- 無違反 `SPEC.md` INV-1～INV-8。
- `docs/verification/N01.md` 已附可重現命令與結果。
- `docs/metrics/node-outcomes.jsonl` 已追加結果。
- 沒有未記錄的規格偏差或未處理 blocker。
