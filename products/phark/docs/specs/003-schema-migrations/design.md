# 003：版本化 Schema Migrations 設計

## 啟動順序

```text
DatabaseConfig
  ├─ 建立 SQLite DataSource
  └─ 套用 WAL / foreign_keys / busy_timeout pragmas
         │
         ▼
FlywayMigrationStrategy
  ├─ 已有 flyway_schema_history ────────────────┐
  ├─ 空 database ───────────────────────────────┤
  ├─ 可辨識 legacy posts ─> baseline(version 1)│
  └─ 其他非空 database ─> fail                 │
                                                ▼
                                         flyway.migrate()
                                                │
                                                ▼
                                    repositories / PostService seed
```

Spring Boot 的 Flyway auto-configuration 使用 primary `DataSource`。不建立第二條
JDBC URL，確保 migration、repositories 與 runtime pragmas 指向同一個 SQLite
檔案。

## Migration 歷史

| Version | 檔案 | 內容 |
|---------|------|------|
| 1 | `V1__create_legacy_posts.sql` | posts table 與初代 channel/created indexes |
| 2 | `V2__add_cursor_timeline_indexes.sql` | 移除初代 indexes，加入 `(created_at,id)` 與 `(channel,created_at,id)` |
| 3 | `V3__add_post_replies.sql` | replies table、foreign key 與 `(post_id,created_at,id)` |

V1 刻意描述專案最初 schema，而不是把目前狀態壓成單一檔案。如此既有 database
baseline 在 version 1 後，仍會執行 idempotent V2/V3：

- pre-pagination database 得到 cursor indexes 與 replies。
- pagination-only database 保留 indexes 並得到 replies。
- current database 對 `IF NOT EXISTS` objects no-op，但會建立完整 history。
- empty database 完整執行 V1 → V2 → V3。

## Legacy baseline guard

全域 `baselineOnMigrate=true` 會移除 Flyway 對錯誤 database path 的一層防護，
因此維持預設 `false`，改由小型 `FlywayMigrationStrategy` 決策：

```text
if history table exists:
    migrate
else if posts table exists with exact required columns:
    baseline(version=1)
    migrate
else:
    migrate  // empty 成功；其他非空 schema 由 Flyway 拒絕
```

Guard 使用 connection metadata / SQLite `PRAGMA table_info(posts)`，不得依賴
application repository，因為此時 schema 可能尚未完成。

Inspection connection 必須在呼叫 `flyway.baseline()` / `flyway.migrate()` 之前
關閉。Production Hikari pool 大小為 1；若持有 inspection connection 再讓 Flyway
借用第二條 connection，啟動會因 pool timeout 失敗。Migration integration tests
使用相同的單連線 pool 防止回歸。

若 `replies` 已存在，V3 使用 `CREATE TABLE/INDEX IF NOT EXISTS`。若名稱相同但結構
不相容，migration integration test 與後續 repository queries 會使啟動失敗；
runbook 要求此時還原備份，不可自動 repair。

## 設定

共同設定：

```properties
spring.flyway.enabled=true
spring.flyway.locations=classpath:db/migration
spring.flyway.baseline-version=1
spring.flyway.validate-on-migrate=true
spring.flyway.validate-migration-naming=true
spring.flyway.clean-disabled=true
spring.sql.init.mode=never
```

Flyway 版本由 Spring Boot dependency management 管理，不單獨覆寫，以避免
auto-configuration 與 Flyway minor version 不相容。

## 測試策略

### 一般 application tests

既有 in-memory SQLite tests 改由 Flyway 建表，持續驗證 controller、repository、
cursor 與 validation 共 48 項行為。

### Migration integration tests

每個 case 使用獨立 temporary SQLite file：

1. **empty**：啟動後 history 包含 V1、V2、V3，最新 tables/indexes 存在。
2. **legacy posts**：預先建立 V1 schema 與指定 ID row；啟動後資料保留、V2/V3
   完成，history 第一筆為 baseline。
3. **current pre-Flyway**：預先建立現行 posts/replies 與 rows；升級後兩者保留。
4. **unknown non-empty**：只建立不相關 table；啟動必須失敗。

測試同時查詢 `sqlite_master`、`PRAGMA table_info` 與 `flyway_schema_history`，
不只依賴 application API 間接推論。

## 失敗與復原

- checksum mismatch、migration SQL failure 或 unknown non-empty schema 都阻止啟動。
- 不允許應用自動呼叫 `repair`。
- production 在部署前停止單一 app instance，使用 SQLite `.backup` 建立 snapshot，
  執行 `PRAGMA integrity_check` 後才部署。
- 若 migration 失敗，停止 app、保留 failed DB/WAL/SHM 作鑑識，再從 snapshot
  restore，最後切回舊 image。
