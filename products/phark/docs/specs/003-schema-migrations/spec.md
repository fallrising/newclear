# 003：版本化 Schema Migrations

> 狀態：Completed
> 日期：2026-07-29

## 問題

目前 production 與 tests 會在每次啟動執行同一份 `schema.sql`。這種初始化方式沒有
版本歷史、checksum 或明確的升級順序；未來加入 accounts、likes 等資料表時，
無法可靠回答某個資料庫已套用哪些變更，也難以在部署前驗證升級路徑。

既有 SQLite volume 已經包含 `posts`，部分環境也包含 `replies`，但沒有 migration
history。本輪必須同時支援空資料庫和原地升級，不得要求清空 production volume。

## 目標

- 使用 Flyway 在應用啟動時執行 forward-only migrations。
- 將現有 schema 拆成可追蹤的 `V1`、`V2`、`V3` 歷史。
- 空資料庫可從零建立完整 schema。
- 可辨識的既有 Phark 資料庫自動建立 baseline，再套用缺少的 migrations。
- 升級保留文章、回覆、IDs 與 SQLite autoincrement state。
- migration 或 checksum 驗證失敗時，應用啟動失敗，不提供流量。
- 提供部署前備份、升級確認與失敗復原 runbook。

## 非目標

- 不建立自動 down migrations。
- 不在本輪改變任何 REST API 或資料模型。
- 不支援多 replica 同時執行 migration。
- 不實作排程備份或遠端備份保存；這仍屬 SDD-012。
- 不自動執行 `flyway repair` 或 `clean`。

## 使用者故事

1. 作為開發者，我可從空 SQLite 檔案啟動並得到最新 schema。
2. 作為維運者，我可用新版 image 啟動既有 volume，資料不會遺失。
3. 作為維運者，我可查詢 `flyway_schema_history` 確認目前版本。
4. 作為維運者，我可在升級前建立一致備份，失敗時還原。
5. 作為開發者，若已發布 migration 被修改，CI 或應用啟動會因 checksum 不符而失敗。

## 功能需求

- **FR-001**：migration 檔案位於 `classpath:db/migration`，命名遵循
  `V<version>__<description>.sql`。
- **FR-002**：Spring Boot 使用 primary `DataSource`，在 repositories 與 seed
  logic 之前呼叫 Flyway。
- **FR-003**：全新資料庫依序執行 `V1`、`V2`、`V3`。
- **FR-004**：沒有 history、但具有預期 `posts` table signature 的既有資料庫，
  baseline 為 version `1`，再執行 `V2`、`V3`。
- **FR-005**：沒有 history 且無法辨識為 Phark 的非空資料庫不得自動 baseline。
- **FR-006**：`V2` 將舊 timeline indexes 升級為 cursor pagination indexes。
- **FR-007**：`V3` 建立 replies table 與 conversation index；對已存在的 current
  schema 必須可安全執行。
- **FR-008**：`clean` 維持 disabled，`validateOnMigrate` 維持 enabled。
- **FR-009**：已發布的 versioned migration 視為 immutable；修正使用新版本。
- **FR-010**：production upgrade 前必須先停止 app 並用 SQLite backup command
  建立可驗證的備份。

## 安全不變量

- Migration 成功之前 HTTP server 不得進入 ready 狀態。
- 自動 baseline 只接受具有 `id`、`author`、`content`、`channel`、`created_at`
  欄位的 `posts` table。
- 不因 upgrade 刪除 posts 或 replies rows。
- 不把資料庫或備份打包進 container image。
- 回滾 image 不代表回滾 schema；不相容失敗必須依 runbook 還原資料庫備份。

## 驗收條件

- [x] 空資料庫啟動後存在 posts、replies、最新 indexes 與成功的 V1–V3 history。
- [x] 只有 legacy posts schema 的資料庫可 baseline 並升級，原資料與 ID 保留。
- [x] 已含 replies、但沒有 history 的 current schema 可 baseline 並保留回覆。
- [x] 不相關的非空 SQLite database 不會被自動 baseline。
- [x] 舊 indexes 被移除，cursor/conversation indexes 存在。
- [x] `schema.sql` 與 `spring.sql.init.*` 不再負責 schema 管理。
- [x] 既有 backend controller/repository tests 全部通過。
- [x] 備份、驗證、復原 runbook 可按 production 路徑操作。
- [x] Docker build、production runtime smoke 與 GitHub Actions 全部通過。

## 參考

- [Spring Boot database initialization](https://docs.spring.io/spring-boot/how-to/data-initialization.html)
- [Flyway SQLite support](https://documentation.red-gate.com/flyway/reference/database-driver-reference/sqlite)
- [Flyway baseline-on-migrate safety](https://documentation.red-gate.com/flyway/reference/configuration/flyway-namespace/flyway-baseline-on-migrate-setting)
