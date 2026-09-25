# BW2 施工圖 — 前端 W2／W4 的前置

[回 v2 索引](../README.md) ・ 框架：[02 §7 BW2](../02-backend-sdd.md#7-後端波次) ・ 契約：[contracts/BW2.openapi.yaml](../contracts/BW2.openapi.yaml) ・ 前一波：[BW1c](BW1c.md)

狀態：**DOC_READY**（本檔合併即生效）  
日期：2026-09-25  
讀者：實作 BW2 的 agent。只讀本檔、`contracts/BW2.openapi.yaml` 與本檔引用的檔案就能完成，不需要做任何設計決定。

> **預演紀錄。** 本檔的程式碼、YAML 與測試，已套用在「BW1c 施工圖完成後」的 `services/cms-api` 副本上，並逐張任務卡執行過（2026-09-25）。T02、T04、T06、T08、T10、T12、T14、T16 完成後，`./gradlew :services:cms-api:test` 依序是 197、199、202、205、208、210、214、217 個測試；`integrationTest` 依序是 70、72、72、72、72、72、72、72 個全綠。預演環境只有 JDK 21，所以 `test` 每次唯一失敗的是 `CmsApiApplicationTests.runtimeIsJava25`；`integrationTest` 用的是本機 PostgreSQL 16.13，不是 Testcontainers。各「測試先行」卡的預期紅燈清單也是實際跑出來的。

---

## 1. 範圍

### 1.1 解決的 ID

| ID | 來源 | 本波次做到什麼程度 |
| --- | --- | --- |
| B-07 | 02 §1.2 | 02 §4.6 列出的每個動作都寫審計，並與狀態變更在同一個交易；被拒的治理操作寫 `denied`；`GET /admin/audit` 分頁與多條件篩選；`GET /admin/audit/{id}` 含 `detail` |
| B-11（部分） | 02 §1.2 | 請求發布、可指派使用者、原子的批次更新（`/me` 在 BW3） |
| G-03 | 01 §9 | `POST`／`DELETE /entries/{id}/publish-request`；工作列表 `publishRequested=true` |
| G-04 | 01 §9 | `GET /principals/assignable` |
| G-09 | 01 §9 | `POST /entries:batch-patch` |
| G-10 | 01 §9 | 工作列表與 `GET /entries/{id}` 的 `include=refs` |
| BD-09、BD-11 | 02 §2 | 全部 |

稽核 ID：沒有新的稽核 ID。前端依賴本波次的是 W2（批次重排、請求發布、指派）與 W4（Admin 審計）。

### 1.2 不做

- 01 §1.2、AGENTS.md「不要做」全部。
- `/me` 端點與 `appointment_request`（BW3，G-08）。
- 02 BQ-06、BQ-07、BQ-08、BQ-10、BQ-11：沒有 owner 的決定，本波次不做。
- 審計保留期限與清理（BW4，02 BQ-03）。
- identity 事件（登入、帳號管理）的名稱與寫法不變（`LOGIN_SUCCESS`、`PRINCIPAL_CREATED` 等，02 §4.6「所有現有的 identity 事件」）；只有角色權限更新改名（§4.2）。
- 既有審計列不改名、不刪除（審計只能新增，surface-admin AC-J）。
- 批次更新不改 `slug`、不寫審計（與單筆 PATCH 相同，02 §4.6「一般的 entry.update 不寫」）。
- `include=refs` 只展開 `ref` 欄位；`media-ref`、`principal-ref` 不展開。
- 不新增依賴，所以 `gradle.lockfile` 不變。

---

## 2. 先決條件

### 2.1 前置波次

- **BW1c 必須已是 `VERIFIED`**。本檔所有 diff 都以「BW1c 施工圖完成後」的檔案為基準；不同時先停下來回報。
- **與前端的關係（[01 Q-10](../01-frontend-sdd.md#133-w0-細化時新增已決定owner2026-09-25)）。** 同 [BW1c §2.1](BW1c.md#21-前置波次)：W0 已合併時，`web` job 的 codegen 新鮮度測試會因契約改變而失敗；本波次不改前端，在 PR 說明列出，交給整合階段。

### 2.2 環境

與 [BW0 §2.2](BW0.md#22-環境) 相同：JDK 25、`./gradlew`、`integrationTest` 需要 Docker、沒有新的環境變數。

### 2.3 查證過的外部事實

沒有新的依賴。下列事實以預演執行查證（2026-09-25，Spring Boot 3.5.16 BOM）：

| 事實 | 用在哪裡 | 查證方式 |
| --- | --- | --- |
| spring-beans 6.2.19 的 `ObjectProvider.getIfAvailable()`：沒有該型別的 bean 時回 null | `TransactionRunner` 在 `test`（沒有 DataSource）與 `integrationTest` 都能建立 | 預演：`test` 與 `integrationTest` 都綠 |
| 同一個 `DataSource` 上，外層 `TransactionTemplate` 的交易會被 `JdbcContentStore`、`JdbcIdentityStore`、`JdbcMediaStore` 內部的 `JdbcTemplate`（與 `JdbcContentStore` 自己的 `TransactionTemplate`，預設傳播 `REQUIRED`）沿用 | 狀態變更與審計同一個交易（BD-09） | spring-jdbc 以 `DataSource` 為鍵綁定連線；預演 `integrationTest` 72 個綠。**沒有**專門的回滾測試，見 §7.8 |
| Spring MVC 6.2 的路徑樣式 `/entries:batch-patch`（冒號在路徑片段內）是字面比對，不與 `/entries/{id}` 衝突 | 批次端點 | 預演：`BatchPatchApiTests` 綠；`OpenApiContractTests` 的路徑比對綠 |
| OpenAPI 回應驗證（atlassian 3.0.0）對 `allOf` 內含 `additionalProperties: false` 的物件會回報「屬性未定義」 | `AuditEventDetail` 寫成獨立 schema，不用 `allOf` 繼承 `AuditEventSummary` | 預演：用 `allOf` 時 `B07_oneEventCarriesItsDetail` 紅，改成獨立 schema 後綠 |
| 同一個帳號在另一個 surface 登入，先前的 session 會失效 | 測試的步驟順序 | BW1c 預演已觀察（[BW1c §7.2](BW1c.md#72-entrywriterulesapitests)） |

---

## 3. 檔案清單

路徑相對於 `apps/cms-scaffold/services/cms-api/`，另有註明者除外。**實作者不得碰清單以外的檔案。**

| 路徑 | 動作 | 用途 | 任務卡 |
| --- | --- | --- | --- |
| `src/main/resources/db/migration/V8__publish_request_and_audit_indexes.sql` | 新增 | 請求發布欄位；審計查詢索引 | T02 |
| `src/main/java/com/fallrising/cms/content/domain/EntryRecord.java` | 修改（整檔取代） | `publishRequestedAt`、`publishRequestedBy` | T02 |
| `src/main/java/com/fallrising/cms/content/query/EntryQuery.java` | 修改 | `publishRequested` | T02 |
| `src/main/java/com/fallrising/cms/content/store/ContentStore.java` | 修改 | `findEntries` | T02 |
| `src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java` | 修改 | 同上；`publishRequested` 條件 | T02 |
| `src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java` | 修改 | 同上；讀寫新欄 | T02 |
| `src/main/java/com/fallrising/cms/content/service/EntryService.java` | 修改 | T02 保留請求；T06 交易與審計；T10 請求發布；T14 批次；T16 關聯摘要 | T02、T06、T10、T14、T16 |
| `src/main/java/com/fallrising/cms/identity/domain/AuditQuery.java` | 新增 | 審計查詢條件 | T04 |
| `src/main/java/com/fallrising/cms/identity/domain/AuditPage.java` | 新增 | 一頁審計 | T04 |
| `src/main/java/com/fallrising/cms/identity/store/IdentityStore.java` | 修改 | `queryAudits`、`findAudit` | T04 |
| `src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java` | 修改 | 同上 | T04 |
| `src/main/java/com/fallrising/cms/identity/store/JdbcIdentityStore.java` | 修改 | 同上 | T04 |
| `src/main/java/com/fallrising/cms/platform/TransactionRunner.java` | 新增 | 一個交易（BD-09） | T06 |
| `src/main/java/com/fallrising/cms/identity/service/AuditLog.java` | 新增 | 寫審計 | T06 |
| `src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java` | 修改 | 被拒的治理操作寫審計 | T06 |
| `src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java` | 修改 | T06 角色權限審計；T12 可指派使用者 | T06、T12 |
| `src/main/java/com/fallrising/cms/content/web/AdminContentController.java` | 修改 | T06 類型審計；T08 移除舊的審計端點 | T06、T08 |
| `src/main/java/com/fallrising/cms/content/service/NavigationService.java` | 修改 | 選單發布審計 | T06 |
| `src/main/java/com/fallrising/cms/media/service/MediaService.java` | 修改 | 媒體刪除審計 | T06 |
| `src/main/java/com/fallrising/cms/identity/service/AuditSearch.java` | 新增 | 審計查詢端點的邏輯 | T08 |
| `src/main/java/com/fallrising/cms/identity/web/AuditController.java` | 新增 | `/admin/audit`、`/admin/audit/{id}` | T08 |
| `src/main/java/com/fallrising/cms/api/error/ErrorCode.java` | 修改 | `AUDIT_EVENT_NOT_FOUND` | T08 |
| `src/main/java/com/fallrising/cms/identity/IdentityException.java` | 修改 | `auditNotFound()` | T08 |
| `src/main/java/com/fallrising/cms/content/query/ListQueryParser.java` | 修改 | `publishRequested` | T10 |
| `src/main/java/com/fallrising/cms/content/web/ContentProjection.java` | 修改 | 工作投影的請求欄位 | T10 |
| `src/main/java/com/fallrising/cms/content/web/EntryController.java` | 修改 | T10 請求發布；T14 批次；T16 `include=refs` | T10、T14、T16 |
| `src/main/java/com/fallrising/cms/identity/web/PrincipalController.java` | 修改 | `/principals/assignable` | T12 |
| `src/main/java/com/fallrising/cms/content/ContentException.java` | 修改 | `inBatchItem` | T14 |
| `src/main/resources/openapi/openapi.yaml` | 修改 | T08、T10、T12、T14、T16 各套一段 diff；T16 後等於 `docs/v2/contracts/BW2.openapi.yaml` | T08～T16 |
| `src/test/java/com/fallrising/cms/contract/ContentStoreContract.java` | 修改 | 請求發布、`findEntries` | T01 |
| `src/integrationTest/java/com/fallrising/cms/contract/ListQueryPerformanceTests.java` | 修改 | `EntryQuery` 多一個參數 | T02 |
| `src/test/java/com/fallrising/cms/contract/IdentityStoreContract.java` | 修改 | 審計查詢 | T03 |
| `src/test/java/com/fallrising/cms/AuditTrailApiTests.java` | 新增 | 審計寫入 | T05 |
| `src/test/java/com/fallrising/cms/WaveEAcceptanceTests.java` | 修改 | `ENTRY_PURGED` 改 `entry.purge` | T05 |
| `src/test/java/com/fallrising/cms/IdentityHardeningTests.java` | 修改 | `PrincipalAdminService` 建構子 | T06 |
| `src/test/java/com/fallrising/cms/support/ApiFixture.java` | 新增 | BW2 API 測試共用的 HTTP 輔助 | T07 |
| `src/test/java/com/fallrising/cms/AuditQueryApiTests.java` | 新增 | 審計查詢 | T07 |
| `src/test/java/com/fallrising/cms/PublishRequestApiTests.java` | 新增 | 請求發布 | T09 |
| `src/test/java/com/fallrising/cms/content/query/ListQueryParserTests.java` | 修改 | `Parsed` 多一個欄位 | T10 |
| `src/test/java/com/fallrising/cms/OpenApiResponseValidatorSelfTests.java` | 修改 | 樣本 `WorkEntry` 補新的必填欄位 | T10 |
| `src/test/java/com/fallrising/cms/AssignablePrincipalsApiTests.java` | 新增 | 可指派使用者 | T11 |
| `src/test/java/com/fallrising/cms/BatchPatchApiTests.java` | 新增 | 批次更新 | T13 |
| `src/test/java/com/fallrising/cms/IncludeRefsApiTests.java` | 新增 | `include=refs` | T15 |
| `apps/cms-scaffold/docs/v2/README.md` | 修改 | 路線圖 BW2 狀態改 `VERIFIED` | T17 |

不會碰：`build.gradle.kts`、`gradle.lockfile`、V1～V7、種子、上表以外的測試、前端、`e2e/`、workflow。

---

## 4. 契約

### 4.1 OpenAPI

完整契約是 [`docs/v2/contracts/BW2.openapi.yaml`](../contracts/BW2.openapi.yaml)，`info.version` 0.8.0，`ErrorCode` 38 個（BW1c 的 37 個加 `AUDIT_EVENT_NOT_FOUND`）。

**合併方式與前幾波不同：** `OpenApiContractTests`（BW0）要求契約的路徑與實作的路徑完全一致，而本波次的新端點分在四張卡上線，所以不能在一張卡整檔取代。T08、T10、T12、T14、T16 各自套用 §5 的一段 `openapi.yaml` diff；T16 之後以 `cmp` 確認與 `contracts/BW2.openapi.yaml` 相同。

| operation | 方法與路徑 | surface | action | 錯誤 | 卡 |
| --- | --- | --- | --- | --- | --- |
| `listAudit`（改） | `GET /api/v1/admin/audit` | Admin | `read_audit` | 400 `VALIDATION_FAILED`；403 `SURFACE_FORBIDDEN`、`FORBIDDEN` | T08 |
| `getAuditEvent`（新） | `GET /api/v1/admin/audit/{id}` | Admin | `read_audit` | 403；404 `AUDIT_EVENT_NOT_FOUND` | T08 |
| `requestPublish`（新） | `POST /api/v1/entries/{id}/publish-request` | Back、Admin | `update` | 403；404 `ENTRY_NOT_FOUND`；409 `INVALID_STATE_TRANSITION` | T10 |
| `cancelPublishRequest`（新） | `DELETE /api/v1/entries/{id}/publish-request` | Back、Admin | `update` | 403；404 | T10 |
| `listWorkEntries`（改） | 新參數 `publishRequested`、`include` | — | — | 400 `VALIDATION_FAILED`（值不合法） | T10、T16 |
| `getWorkEntry`（改） | 新參數 `include` | — | — | 同上 | T16 |
| `listAssignablePrincipals`（新） | `GET /api/v1/principals/assignable` | 呼叫者對該類型有 `update` 的 surface | `update`（該類型） | 400 `VALIDATION_FAILED`；403 `FORBIDDEN` | T12 |
| `batchPatchEntries`（新） | `POST /api/v1/entries:batch-patch` | Back、Admin | 每一筆 `update` | 400；403；404；409；422（`error.fields`）；428 | T14 |

schema 變更：`WorkEntry` 新增必填 `publishRequestedAt`、`publishRequestedBy`（nullable）與選填 `refs`；新增 `RefSummary`、`BatchPatchRequest`、`WorkEntryList`、`AssignablePrincipalList`、`AuditActor`、`AuditEventDetail`、`AuditEventPage`；`AuditEventSummary` 改為完整欄位；刪除 `AuditEventList`。

### 4.2 行為變更（API 可觀察）

| 項目 | 以前（BW1c） | 以後（BW2） |
| --- | --- | --- |
| `GET /admin/audit` 回應 | `{ items: [{ action, targetType, targetId, outcome, at }] }`，不分頁 | `{ items: [AuditEventSummary], total, page, size, offset, limit }`；每筆多 `id`、`actor`、`category`、`surface`；預設 20 筆 |
| `GET /admin/audit` 的 `action` | 完整比對 | 完整比對；以 `.` 結尾時是前綴 |
| `GET /admin/audit` 從 Back 呼叫 | 403 `SURFACE_FORBIDDEN`，`error.action` 是 `delete` | 403 `SURFACE_FORBIDDEN`，`error.action` 是 `read_audit`；並寫一筆 `denied` 審計 |
| 硬刪除的審計動作 | `ENTRY_PURGED` | `entry.purge`（舊列不改） |
| 角色權限更新的審計 | `PERMISSION_CHANGED`，`targetType=principal`（值其實是角色 id） | `role.permissions_update`，`targetType=role`，`detail: { roleCode, permissions }`（舊列不改） |
| 內容、類型、選單、媒體的狀態變更 | 除硬刪除外不寫審計 | §4.3 的每個動作都寫，與變更同一個交易 |
| 被拒的治理操作 | 不寫 | 寫一筆 `outcome=denied`（§4.3） |
| `WorkEntry` | 沒有請求發布欄位 | `publishRequestedAt`、`publishRequestedBy` 永遠存在（沒有請求時是 null） |
| PATCH、revert、軟刪除 | — | 保留進行中的發布請求；publish、unpublish、archive、restore 清除 |

### 4.3 審計動作

| 動作 | `category` | `targetType` | `detail` | 何時寫 |
| --- | --- | --- | --- | --- |
| `entry.create` | `CONTENT` | `entry` | — | 建立成功 |
| `entry.publish` | `CONTENT` | `entry` | `{ "revisionNo": n }` | 真的發布時（已發布且沒有變更時 publish 直接回傳，不寫） |
| `entry.unpublish`、`entry.archive`、`entry.restore`、`entry.soft_delete` | `CONTENT` | `entry` | — | 成功時 |
| `entry.purge` | `CONTENT` | `entry` | — | 硬刪除成功 |
| `entry.revert` | `CONTENT` | `entry` | `{ "revisionNo": n }` | 成功時 |
| `entry.publish_request`、`entry.publish_request_cancel` | `CONTENT` | `entry` | — | 真的設定／清除時（已經是該狀態時不寫） |
| `type.create`、`type.enable`、`type.disable` | `SCHEMA` | `content_type` | — | 成功時 |
| `navigation.publish` | `SETTINGS` | `navigation` | `{ "menuKey": … }` | 成功時 |
| `media.delete` | `MEDIA` | `media` | — | 成功時 |
| `role.permissions_update` | `AUTH` | `role` | `{ "roleCode": …, "permissions": n }` | 成功時 |
| `manage_types`、`manage_principals`、`manage_settings`、`read_audit` | `GOVERNANCE` | null | `{ "reason": "FORBIDDEN" \| "SURFACE_FORBIDDEN" }` | `AuthorizationService.require` 對這四個治理動作回拒絕時，`outcome=denied` |

- `actor` 是呼叫者（匿名時 null）；`surface` 是呼叫者的 surface；`ip` 只有既有的 identity 事件會記錄，本表的事件是 null。
- 交易：狀態變更與審計在同一個 `TransactionRunner` 區塊（§5.3）。被拒的事件在拋出 403 之前寫入，這時沒有外層交易，所以不會被回滾。

### 4.4 參數文法

`GET /admin/audit`（`AuditSearch`）：

| 參數 | 文法 | 錯誤（400 `VALIDATION_FAILED`，`message`） |
| --- | --- | --- |
| `page` | 整數 ≥ 1，預設 1 | `page must be a positive integer` |
| `size` | 整數 1～100，預設 20 | `size must be an integer from 1 to 100` |
| `from`、`to` | ISO-8601 含時區；`from` 含、`to` 不含 | `from must be an ISO-8601 date-time with offset` |
| `actor` | username；不存在時回空頁（`total` 0），不是錯誤 | — |
| `action` | 完整比對；以 `.` 結尾時是前綴（`LIKE`，`%`、`_`、`\` 先跳脫） | — |
| `category`、`targetType`、`outcome` | 完整比對 | — |
| `targetId` | UUID | `targetId must be a UUID` |
| 共同 | 空白值等於沒有條件；前後空白去掉；任何參數重複 | `<name> must not repeat` |
| 其他參數 | 忽略 | — |

排序：`at` 遞減，再依 id 文字遞增。`actor` 物件：`{ id, username, displayName }`；principal 已不存在時 `username`、`displayName` 是 null；同一頁的同一個 actor 只查一次。

工作列表新增（`ListQueryParser`，[BW1b §4.3](BW1b.md#43-查詢參數文法) 之外）：

| 參數 | 文法 | 錯誤 |
| --- | --- | --- |
| `publishRequested` | `true` 或 `false`；只在工作列表 | 其他值：`publishRequested must be true or false`；公開列表忽略 |
| `include`（工作列表與 `GET /entries/{id}`） | 逗號分隔，唯一的值是 `refs`；空段忽略 | 其他值：`include: unknown value <值>`；重複：`include must not repeat` |

`GET /principals/assignable`：`contentType` 必填，必須是啟用中的類型（否則 400 `contentType is required`／`unknown contentType`）；`q` 選填。

`POST /entries:batch-patch` 的 body：`{ "items": [ { "id", "version", "payload" } ] }`。400：`items must contain 1 to 100 entries`、`items[<i>].id is required`、`items[<i>].id is repeated`。

### 4.5 資料表：V8 全文

`src/main/resources/db/migration/V8__publish_request_and_audit_indexes.sql`：

```sql
-- BW2: publish requests (02 §3.3, G-03) and audit query indexes (02 §4.6, B-07).

ALTER TABLE cms_entry
    ADD COLUMN publish_requested_at TIMESTAMPTZ,
    ADD COLUMN publish_requested_by UUID;
CREATE INDEX cms_entry_publish_requested_idx ON cms_entry (content_type_id)
    WHERE publish_requested_at IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX cms_audit_event_target_idx   ON cms_audit_event (target_type, target_id);
CREATE INDEX cms_audit_event_action_at_idx ON cms_audit_event (action, at DESC);
```

- 與 02 §3.3 的 SQL 相同。兩個新欄都是 nullable，既有列不需要回填。
- 沒有 CHECK 或 UNIQUE。
- 向前修正：V8 合併後不能改；要調整索引就新增 `V<n>`。

### 4.6 範例

成功：`GET /api/v1/admin/audit?targetId=<album id>`（`seed-admin`，Admin；`seed-operator-album` 建立並發布了這本相簿），節錄：

```json
{
  "items": [
    { "id": "…", "at": "…", "actor": { "id": "…", "username": "seed-operator-album", "displayName": "Album operator" },
      "category": "CONTENT", "action": "entry.publish", "targetType": "entry", "targetId": "…", "surface": "back", "outcome": "ok" },
    { "id": "…", "at": "…", "actor": { "…": "…" }, "category": "CONTENT", "action": "entry.create", "targetType": "entry",
      "targetId": "…", "surface": "back", "outcome": "ok" }
  ],
  "total": 2, "page": 1, "size": 20, "offset": 0, "limit": 20
}
```

失敗：`POST /api/v1/entries:batch-patch`，第二筆的版本過期，`409`：

```json
{ "error": { "code": "VERSION_CONFLICT", "message": "items[1]: Entry version does not match" }, "requestId": "…" }
```

失敗：同一個端點，第二、三筆欄位不合法，`422`：

```json
{ "error": { "code": "FIELD_VALIDATION", "message": "2 invalid field(s); first: visibility is not a valid enum value",
             "fields": [ { "field": "items[1].payload.visibility", "code": "NOT_IN_ENUM", "message": "…" },
                         { "field": "items[2].payload.sortMode", "code": "WRONG_TYPE", "message": "…" } ] }, "requestId": "…" }
```

成功：`GET /api/v1/entries/{photo id}?include=refs`，呼叫者只有 `photo` 的 editor 權限，節錄：

```json
{ "id": "…", "title": "…", "refs": { "album": { "id": "…", "restricted": true } } }
```

### 4.7 授權矩陣

種子角色（`SeedService`）：editor 與 operator 的 grant 只在 Back、Admin，且只對分派時的類型清單（例如 `seed-operator-album` 是 `album`、`photo`）；admin 對所有類型，治理動作只在 Admin；member 只有 `read_published`。「清單內／外」指目標類型是否在該帳號的類型清單中。未登入呼叫任何一個都是 401 `UNAUTHENTICATED`（filter）。

| 端點 | Front | Back | Admin |
| --- | --- | --- | --- |
| `GET /admin/audit`、`/admin/audit/{id}` | 所有人 403 `SURFACE_FORBIDDEN`（寫 `denied`） | 所有人 403 `SURFACE_FORBIDDEN`（寫 `denied`） | admin 200；editor、operator、member 403 `FORBIDDEN`（寫 `denied`） |
| `POST`／`DELETE /entries/{id}/publish-request` | 所有人 403 `SURFACE_FORBIDDEN` | editor、operator 清單內 200，清單外 403 `FORBIDDEN`；admin 200；member 403 `FORBIDDEN` | 同 Back |
| `POST /entries:batch-patch` | 所有人 403 `SURFACE_FORBIDDEN` | 每一筆依上一列；第一筆被拒的決定結果 | 同 Back |
| `GET /principals/assignable?contentType=X` | 所有人 403 `FORBIDDEN`（`update` 的 grant 不含 Front） | editor、operator：X 在清單內 200，否則 403；admin 200；member 403 | 同 Back |
| `include=refs`（工作列表、`GET /entries/{id}`） | 所有人 403 `SURFACE_FORBIDDEN`（端點本身） | 能讀端點的人都能加；每個目標依呼叫者對目標類型的 `read_draft` 回完整摘要或 `restricted` | 同 Back |

測試覆蓋：審計的 Back 403 與 admin 200（`AuditQueryApiTests`）；請求發布的清單外 403（`G03_needsUpdateAndAValidFilterValue`）；批次的 Front 403（`G09_sizeAndIdRulesAndSurface`）；可指派的清單外 403（`G04_rejects…`）；`restricted`（`G10_targets…`）。其餘格子由既有的 surface 規則測試（`IdentitySurfaceHardeningTests`）與 `rejectFront` 共用的程式路徑保證。

---

## 5. 模組規格

### 5.1 請求發布欄位、`findEntries`（T02）

- `EntryRecord` 多兩個元件；舊的 15 參數建構子保留（兩個新欄為 null），所以既有呼叫點不用改。`withPublishRequest(at, by)` 只改這兩欄。
- `EntryQuery` 多 `publishRequested`（最後一個參數）；`true` 時兩種 store 都只留 `publishRequestedAt` 不是 null 的 entry（JDBC：`AND e.publish_requested_at IS NOT NULL`）。本卡 `EntryService` 一律傳 `false`，T10 才接參數。
- `findEntries(ids)`：一次讀多筆（JDBC 一個 `IN (…)` 查詢），含軟刪除，依 id 文字排序，重複與不存在的 id 略過，空集合不查資料庫。
- `EntryService`：`patch`、`revert`、`softDelete` 建立新 record 後加 `.withPublishRequest(current…)`，保留請求；其他轉換用舊建構子，所以清除。

`src/main/java/com/fallrising/cms/content/domain/EntryRecord.java`：

```java
package com.fallrising.cms.content.domain;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * An entry. publishRequestedAt and publishRequestedBy are set by a publish request (G-03) and cleared by publish,
 * unpublish, archive, restore and a cancelled request; both are null when there is no open request.
 */
public record EntryRecord(
        UUID id,
        UUID contentTypeId,
        String contentTypeKey,
        String slug,
        PublicationState publicationState,
        int version,
        Map<String, Object> payload,
        Map<String, Object> publishedPayload,
        Instant publishedAt,
        Instant archivedAt,
        Instant deletedAt,
        UUID createdBy,
        UUID updatedBy,
        Instant createdAt,
        Instant updatedAt,
        Instant publishRequestedAt,
        UUID publishRequestedBy) {

    /** Entry without an open publish request. */
    public EntryRecord(
            UUID id,
            UUID contentTypeId,
            String contentTypeKey,
            String slug,
            PublicationState publicationState,
            int version,
            Map<String, Object> payload,
            Map<String, Object> publishedPayload,
            Instant publishedAt,
            Instant archivedAt,
            Instant deletedAt,
            UUID createdBy,
            UUID updatedBy,
            Instant createdAt,
            Instant updatedAt) {
        this(id, contentTypeId, contentTypeKey, slug, publicationState, version, payload, publishedPayload, publishedAt,
                archivedAt, deletedAt, createdBy, updatedBy, createdAt, updatedAt, null, null);
    }

    /** Same entry with the publish request set (both non-null) or cleared (both null); nothing else changes. */
    public EntryRecord withPublishRequest(Instant at, UUID by) {
        return new EntryRecord(id, contentTypeId, contentTypeKey, slug, publicationState, version, payload,
                publishedPayload, publishedAt, archivedAt, deletedAt, createdBy, updatedBy, createdAt, updatedAt, at, by);
    }

    public boolean publishRequested() {
        return publishRequestedAt != null;
    }

    public boolean deleted() {
        return deletedAt != null;
    }

    public boolean dirty() {
        return publicationState == PublicationState.PUBLISHED && !payloadEqualsPublished();
    }

    private boolean payloadEqualsPublished() {
        Map<String, Object> left = payload == null ? Map.of() : payload;
        Map<String, Object> right = publishedPayload == null ? Map.of() : publishedPayload;
        return left.equals(right);
    }

    public Map<String, Object> payloadCopy() {
        return payload == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload);
    }
}
```

`src/main/java/com/fallrising/cms/content/query/EntryQuery.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/query/EntryQuery.java
+++ b/src/main/java/com/fallrising/cms/content/query/EntryQuery.java
@@ -21,6 +21,7 @@
  * @param sort              primary sort key; ties are broken by updatedAt descending, then id text ascending
  * @param page              1-based page
  * @param size              page size, 1..100
+ * @param publishRequested  WORK only: true keeps only entries with an open publish request (G-03); false = no condition
  */
 public record EntryQuery(
         UUID typeId,
@@ -35,7 +36,8 @@
         List<String> requiredRefs,
         SortKey sort,
         int page,
-        int size) {
+        int size,
+        boolean publishRequested) {
 
     public EntryQuery {
         states = List.copyOf(states);
```

`src/main/java/com/fallrising/cms/content/store/ContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/ContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/ContentStore.java
@@ -10,6 +10,7 @@
 import com.fallrising.cms.content.query.EntryPage;
 import com.fallrising.cms.content.query.EntryQuery;
 
+import java.util.Collection;
 import java.util.List;
 import java.util.Optional;
 import java.util.UUID;
@@ -41,6 +42,9 @@
 
     Optional<EntryRecord> findBySlug(UUID typeId, String slug);
 
+    /** Entries with these ids in one read (G-10), soft-deleted ones included, ordered by id text; unknown ids are skipped. */
+    List<EntryRecord> findEntries(Collection<UUID> ids);
+
     /** Evaluates a list query (02 BD-04). Soft-deleted entries never match. */
     EntryPage queryEntries(EntryQuery query);
 
```

`src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
@@ -19,6 +19,7 @@
 
 import java.time.Instant;
 import java.util.ArrayList;
+import java.util.Collection;
 import java.util.Comparator;
 import java.util.List;
 import java.util.Locale;
@@ -140,6 +141,13 @@
     }
 
     @Override
+    public List<EntryRecord> findEntries(Collection<UUID> ids) {
+        return ids.stream().distinct().map(entries::get).filter(Objects::nonNull)
+                .sorted(Comparator.comparing(e -> e.id().toString()))
+                .toList();
+    }
+
+    @Override
     public EntryPage queryEntries(EntryQuery query) {
         List<EntryRecord> matching = entries.values().stream()
                 .filter(e -> matches(e, query))
@@ -250,6 +258,7 @@
         IndexScope scope = query.scope();
         if (scope == IndexScope.WORK) {
             if (!query.states().contains(e.publicationState().wire())) return false;
+            if (query.publishRequested() && !e.publishRequested()) return false;
         } else {
             if (e.publicationState() != PublicationState.PUBLISHED || e.publishedPayload() == null) return false;
             if (query.visibilityField() != null) {
```

`src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
@@ -29,6 +29,7 @@
 import java.sql.Timestamp;
 import java.time.Instant;
 import java.util.ArrayList;
+import java.util.Collection;
 import java.util.LinkedHashMap;
 import java.util.List;
 import java.util.Map;
@@ -219,6 +220,17 @@
     }
 
     @Override
+    public List<EntryRecord> findEntries(Collection<UUID> ids) {
+        List<UUID> distinct = ids.stream().distinct().toList();
+        if (distinct.isEmpty()) return List.of();
+        return jdbc.query(
+                "SELECT e.*, t.type_key FROM cms_entry e JOIN cms_content_type t ON t.id = e.content_type_id WHERE e.id IN ("
+                        + String.join(", ", distinct.stream().map(id -> "?").toList()) + ") ORDER BY e.id::text COLLATE \"C\"",
+                entryMapper(),
+                distinct.toArray());
+    }
+
+    @Override
     public EntryPage queryEntries(EntryQuery query) {
         List<Object> args = new ArrayList<>();
         String where = where(query, args);
@@ -277,8 +289,9 @@
                 """
                 INSERT INTO cms_entry
                   (id, content_type_id, slug, publication_state, version, payload, published_payload,
-                   published_at, archived_at, deleted_at, created_by, updated_by, created_at, updated_at)
-                VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?, ?, ?, ?, ?, ?, ?)
+                   published_at, archived_at, deleted_at, created_by, updated_by, created_at, updated_at,
+                   publish_requested_at, publish_requested_by)
+                VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 """,
                 entry.id(),
                 entry.contentTypeId(),
@@ -293,7 +306,9 @@
                 entry.createdBy(),
                 entry.updatedBy(),
                 ts(entry.createdAt()),
-                ts(entry.updatedAt()));
+                ts(entry.updatedAt()),
+                ts(entry.publishRequestedAt()),
+                entry.publishRequestedBy());
     }
 
     @Override
@@ -310,7 +325,7 @@
                 """
                 UPDATE cms_entry SET slug = ?, publication_state = ?, version = ?, payload = CAST(? AS jsonb),
                   published_payload = CAST(? AS jsonb), published_at = ?, archived_at = ?, deleted_at = ?,
-                  updated_by = ?, updated_at = ?
+                  updated_by = ?, updated_at = ?, publish_requested_at = ?, publish_requested_by = ?
                 WHERE id = ?
                 """,
                 entry.slug(),
@@ -323,6 +338,8 @@
                 ts(entry.deletedAt()),
                 entry.updatedBy(),
                 ts(entry.updatedAt()),
+                ts(entry.publishRequestedAt()),
+                entry.publishRequestedBy(),
                 entry.id());
     }
 
@@ -501,6 +518,9 @@
                         .append(")");
                 args.addAll(query.states());
             }
+            if (query.publishRequested()) {
+                sql.append(" AND e.publish_requested_at IS NOT NULL");
+            }
         } else {
             sql.append(" AND e.publication_state = 'published' AND e.published_payload IS NOT NULL");
             if (query.visibilityField() != null) {
@@ -660,7 +680,9 @@
                 rs.getObject("created_by", UUID.class),
                 rs.getObject("updated_by", UUID.class),
                 instant(rs, "created_at"),
-                instant(rs, "updated_at"));
+                instant(rs, "updated_at"),
+                instant(rs, "publish_requested_at"),
+                rs.getObject("publish_requested_by", UUID.class));
     }
 
     private RowMapper<RevisionRecord> revisionMapper() {
```

`src/main/java/com/fallrising/cms/content/service/EntryService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/service/EntryService.java
+++ b/src/main/java/com/fallrising/cms/content/service/EntryService.java
@@ -135,7 +135,7 @@
         AccessFilter access = accessFilter(authorization.listAccess(
                 principal, needsDraft ? CmsAction.READ_DRAFT : CmsAction.READ_PUBLISHED, typeKey, surface));
         EntryPage page = store.queryEntries(new EntryQuery(type.id(), IndexScope.WORK, parsed.states(), type.titleField(),
-                parsed.q(), parsed.filters(), parsed.refs(), access, null, List.of(), parsed.sort(), parsed.page(), parsed.size()));
+                parsed.q(), parsed.filters(), parsed.refs(), access, null, List.of(), parsed.sort(), parsed.page(), parsed.size(), false));
         return new ListResult(type, fields, page, parsed.page(), parsed.size());
     }
 
@@ -175,7 +175,8 @@
                 current.createdBy(),
                 principal == null ? current.updatedBy() : principal.id(),
                 current.createdAt(),
-                now);
+                now)
+                .withPublishRequest(current.publishRequestedAt(), current.publishRequestedBy());
         store.updateEntry(updated);
         store.replaceRefs(updated.id(), extractRefs(updated, type));
         mediaService.replaceAttachments(updated.id(), extractMediaAttachments(updated, type));
@@ -326,7 +327,8 @@
                 current.createdBy(),
                 principal == null ? current.updatedBy() : principal.id(),
                 current.createdAt(),
-                now));
+                now)
+                .withPublishRequest(current.publishRequestedAt(), current.publishRequestedBy()));
     }
 
     public void purge(Principal principal, Surface surface, UUID id) {
@@ -398,7 +400,7 @@
         ListQueryParser.Parsed parsed = ListQueryParser.parse(type, fields, IndexScope.PUBLISHED, params);
         EntryPage page = store.queryEntries(new EntryQuery(type.id(), IndexScope.PUBLISHED, parsed.states(), type.titleField(),
                 parsed.q(), parsed.filters(), parsed.refs(), access, type.visibilityField(), type.publicRequiresPublishedRefs(),
-                parsed.sort(), parsed.page(), parsed.size()));
+                parsed.sort(), parsed.page(), parsed.size(), false));
         return new ListResult(type, fields, page, parsed.page(), parsed.size());
     }
 
@@ -460,7 +462,8 @@
                 current.createdBy(),
                 principal == null ? current.updatedBy() : principal.id(),
                 current.createdAt(),
-                now);
+                now)
+                .withPublishRequest(current.publishRequestedAt(), current.publishRequestedBy());
         return store.updateEntry(updated);
     }
 
```

`src/integrationTest/java/com/fallrising/cms/contract/ListQueryPerformanceTests.java`：

```diff
--- a/src/integrationTest/java/com/fallrising/cms/contract/ListQueryPerformanceTests.java
+++ b/src/integrationTest/java/com/fallrising/cms/contract/ListQueryPerformanceTests.java
@@ -69,9 +69,9 @@
 
         EntryQuery work = new EntryQuery(type.id(), IndexScope.WORK, List.of("draft", "published"), "title", "harbour",
                 List.of(FieldFilter.equalsValue("status", "enum", "open")), List.of(), AccessFilter.none(), null, List.of(),
-                SortKey.system("updatedAt", true), 1, 20);
+                SortKey.system("updatedAt", true), 1, 20, false);
         EntryQuery pub = new EntryQuery(type.id(), IndexScope.PUBLISHED, List.of("published"), "title", null, List.of(),
-                List.of(), AccessFilter.none(), "visibility", List.of(), SortKey.field("rank", "int", false), 1, 20);
+                List.of(), AccessFilter.none(), "visibility", List.of(), SortKey.field("rank", "int", false), 1, 20, false);
 
         statements.set(0);
         EntryPage workPage = store.queryEntries(work);
```

### 5.2 審計查詢的 store（T04）

語意見 §4.4（store 收到的已是解析後的條件）。JDBC：`SELECT COUNT(*) FROM cms_audit_event WHERE …` 與 `SELECT * … ORDER BY at DESC, id::text COLLATE "C" ASC LIMIT ? OFFSET ?`；前綴比對寫成 `action LIKE ? ESCAPE '\'`。`listAudits`（BW0）保留不動。

`src/main/java/com/fallrising/cms/identity/domain/AuditQuery.java`：

```java
package com.fallrising.cms.identity.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * Audit search (02 §4.6). Null means "no condition". from is inclusive, to is exclusive. action matches exactly, or
 * as a prefix when actionPrefix is true. Results are ordered by at descending, then id text ascending.
 */
public record AuditQuery(
        Instant from,
        Instant to,
        UUID actorId,
        String action,
        boolean actionPrefix,
        String category,
        String targetType,
        UUID targetId,
        String outcome,
        int page,
        int size) {

    public int offset() {
        return (page - 1) * size;
    }
}
```

`src/main/java/com/fallrising/cms/identity/domain/AuditPage.java`：

```java
package com.fallrising.cms.identity.domain;

import java.util.List;

/** One page of audit events and the number of matching events on all pages. */
public record AuditPage(List<AuditEvent> items, long total) {

    public AuditPage {
        items = List.copyOf(items);
    }
}
```

`src/main/java/com/fallrising/cms/identity/store/IdentityStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/store/IdentityStore.java
+++ b/src/main/java/com/fallrising/cms/identity/store/IdentityStore.java
@@ -1,6 +1,8 @@
 package com.fallrising.cms.identity.store;
 
 import com.fallrising.cms.identity.domain.AuditEvent;
+import com.fallrising.cms.identity.domain.AuditPage;
+import com.fallrising.cms.identity.domain.AuditQuery;
 import com.fallrising.cms.identity.domain.Credential;
 import com.fallrising.cms.identity.domain.Permission;
 import com.fallrising.cms.identity.domain.Principal;
@@ -59,6 +61,11 @@
 
     List<AuditEvent> listAudits(String action, UUID targetId);
 
+    /** Audit search with paging (02 §4.6, B-07). */
+    AuditPage queryAudits(AuditQuery query);
+
+    Optional<AuditEvent> findAudit(UUID id);
+
     long countUsableAdmins();
 
     void replacePrincipalRolesKeepingUsableAdmin(UUID principalId, List<PrincipalRoleAssignment> assignments);
```

`src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java
+++ b/src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java
@@ -2,6 +2,8 @@
 
 import com.fallrising.cms.identity.IdentityException;
 import com.fallrising.cms.identity.domain.AuditEvent;
+import com.fallrising.cms.identity.domain.AuditPage;
+import com.fallrising.cms.identity.domain.AuditQuery;
 import com.fallrising.cms.identity.domain.Credential;
 import com.fallrising.cms.identity.domain.Permission;
 import com.fallrising.cms.identity.domain.Principal;
@@ -194,6 +196,28 @@
     }
 
     @Override
+    public AuditPage queryAudits(AuditQuery query) {
+        List<AuditEvent> matching = audits.stream()
+                .filter(e -> query.from() == null || !e.at().isBefore(query.from()))
+                .filter(e -> query.to() == null || e.at().isBefore(query.to()))
+                .filter(e -> query.actorId() == null || query.actorId().equals(e.actorPrincipalId()))
+                .filter(e -> query.action() == null
+                        || (query.actionPrefix() ? e.action().startsWith(query.action()) : query.action().equals(e.action())))
+                .filter(e -> query.category() == null || query.category().equals(e.category()))
+                .filter(e -> query.targetType() == null || query.targetType().equals(e.targetType()))
+                .filter(e -> query.targetId() == null || query.targetId().equals(e.targetId()))
+                .filter(e -> query.outcome() == null || query.outcome().equals(e.outcome()))
+                .sorted(Comparator.comparing(AuditEvent::at).reversed().thenComparing(e -> e.id().toString()))
+                .toList();
+        return new AuditPage(matching.stream().skip(query.offset()).limit(query.size()).toList(), matching.size());
+    }
+
+    @Override
+    public Optional<AuditEvent> findAudit(UUID id) {
+        return audits.stream().filter(e -> e.id().equals(id)).findFirst();
+    }
+
+    @Override
     public long countUsableAdmins() {
         return listPrincipals().stream().filter(this::isUsableAdmin).count();
     }
```

`src/main/java/com/fallrising/cms/identity/store/JdbcIdentityStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/store/JdbcIdentityStore.java
+++ b/src/main/java/com/fallrising/cms/identity/store/JdbcIdentityStore.java
@@ -2,6 +2,8 @@
 
 import com.fallrising.cms.identity.IdentityException;
 import com.fallrising.cms.identity.domain.AuditEvent;
+import com.fallrising.cms.identity.domain.AuditPage;
+import com.fallrising.cms.identity.domain.AuditQuery;
 import com.fallrising.cms.identity.domain.Credential;
 import com.fallrising.cms.identity.domain.Permission;
 import com.fallrising.cms.identity.domain.Principal;
@@ -250,6 +252,40 @@
     }
 
     @Override
+    public AuditPage queryAudits(AuditQuery query) {
+        StringBuilder where = new StringBuilder(" WHERE 1=1");
+        List<Object> args = new ArrayList<>();
+        if (query.from() != null) { where.append(" AND at >= ?"); args.add(ts(query.from())); }
+        if (query.to() != null) { where.append(" AND at < ?"); args.add(ts(query.to())); }
+        if (query.actorId() != null) { where.append(" AND actor_principal_id = ?"); args.add(query.actorId()); }
+        if (query.action() != null) {
+            if (query.actionPrefix()) {
+                where.append(" AND action LIKE ? ESCAPE '\\'");
+                args.add(query.action().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
+            } else {
+                where.append(" AND action = ?");
+                args.add(query.action());
+            }
+        }
+        if (query.category() != null) { where.append(" AND category = ?"); args.add(query.category()); }
+        if (query.targetType() != null) { where.append(" AND target_type = ?"); args.add(query.targetType()); }
+        if (query.targetId() != null) { where.append(" AND target_id = ?"); args.add(query.targetId()); }
+        if (query.outcome() != null) { where.append(" AND outcome = ?"); args.add(query.outcome()); }
+        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM cms_audit_event" + where, Long.class, args.toArray());
+        List<Object> pageArgs = new ArrayList<>(args);
+        pageArgs.add(query.size());
+        pageArgs.add(query.offset());
+        List<AuditEvent> items = jdbc.query("SELECT * FROM cms_audit_event" + where
+                + " ORDER BY at DESC, id::text COLLATE \"C\" ASC LIMIT ? OFFSET ?", auditMapper(), pageArgs.toArray());
+        return new AuditPage(items, total == null ? 0 : total);
+    }
+
+    @Override
+    public Optional<AuditEvent> findAudit(UUID id) {
+        return jdbc.query("SELECT * FROM cms_audit_event WHERE id = ?", auditMapper(), id).stream().findFirst();
+    }
+
+    @Override
     public long countUsableAdmins() {
         Long count = jdbc.queryForObject("""
                 SELECT COUNT(DISTINCT p.id)
```

### 5.3 交易與審計寫入（T06）

- `TransactionRunner`（`@Component`）：有 `DataSource` 時用 `TransactionTemplate(new DataSourceTransactionManager(ds))`，沒有時直接執行。in-memory store 沒有回滾，所以每個呼叫者都先做完所有檢查再寫入（本來就是這樣）。`withoutDatabase()` 給手動建構服務的單元測試用。
- `AuditLog`（`@Component`）：`record(actor, surface, category, action, targetType, targetId, outcome, detail)`；`detail` 以 Jackson 寫成 JSON。
- 包進 `TransactionRunner` 的寫入：`EntryService` 的 create（寫 entry、關聯、媒體附件、審計）、patch（entry、關聯、附件；沒有審計）、publish（revision、刪舊 revision、entry、審計）、unpublish／archive／restore／softDelete（共用 `commit`）、purge、revert；類型 create／enable／disable；選單 publish；媒體刪除；角色權限更新。
- `AuthorizationService.require`：決定為拒絕且動作在 `CmsAction.GOVERNANCE` 時，拋出之前直接以 `IdentityStore.insertAudit` 寫一筆（§4.3 最後一列）。
- `PrincipalAdminService` 多兩個建構子參數；`IdentityHardeningTests` 的兩處手動建構要跟著改。

`src/main/java/com/fallrising/cms/platform/TransactionRunner.java`：

```java
package com.fallrising.cms.platform;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.util.function.Supplier;

/**
 * Runs work in one database transaction (02 BD-09): a state change and its audit event commit or roll back together.
 * With a DataSource, the JDBC stores' own TransactionTemplates join this transaction (same DataSource). Without one
 * (./gradlew test, in-memory stores) the work simply runs; in-memory stores have no rollback, so callers validate
 * before they write.
 */
@Component
public class TransactionRunner {

    private final TransactionTemplate template;

    @Autowired
    public TransactionRunner(ObjectProvider<DataSource> dataSource) {
        this(dataSource.getIfAvailable());
    }

    private TransactionRunner(DataSource ds) {
        this.template = ds == null ? null : new TransactionTemplate(new DataSourceTransactionManager(ds));
    }

    /** A runner without a database, for unit tests that build services by hand. */
    public static TransactionRunner withoutDatabase() {
        return new TransactionRunner((DataSource) null);
    }

    public <T> T inTransaction(Supplier<T> work) {
        return template == null ? work.get() : template.execute(status -> work.get());
    }

    public void run(Runnable work) {
        inTransaction(() -> {
            work.run();
            return null;
        });
    }
}
```

`src/main/java/com/fallrising/cms/identity/service/AuditLog.java`：

```java
package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Writes audit events for content, schema, settings, media and role changes (02 §4.6, B-07). Callers run it inside
 * the same TransactionRunner block as the change. Identity events (login, principals) keep their own writers.
 */
@Component
public class AuditLog {

    public static final String OK = "ok";
    public static final String DENIED = "denied";

    private final IdentityStore store;
    private final ObjectMapper objectMapper;

    public AuditLog(IdentityStore store, ObjectMapper objectMapper) {
        this.store = store;
        this.objectMapper = objectMapper;
    }

    /** detail may be null; otherwise it is stored as a JSON object. */
    public void record(Principal actor, Surface surface, String category, String action, String targetType, UUID targetId,
            String outcome, Map<String, Object> detail) {
        store.insertAudit(new AuditEvent(UUID.randomUUID(), Instant.now(), actor == null ? null : actor.id(), category,
                action, targetType, targetId, surface == null ? null : surface.wire(), outcome, null, json(detail)));
    }

    private String json(Map<String, Object> detail) {
        if (detail == null) return null;
        try {
            return objectMapper.writeValueAsString(detail);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
```

`src/main/java/com/fallrising/cms/content/service/EntryService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/service/EntryService.java
+++ b/src/main/java/com/fallrising/cms/content/service/EntryService.java
@@ -18,15 +18,16 @@
 import com.fallrising.cms.content.store.ContentStore;
 import com.fallrising.cms.content.validation.PayloadValidator;
 import com.fallrising.cms.identity.IdentityException;
-import com.fallrising.cms.identity.domain.AuditEvent;
 import com.fallrising.cms.identity.domain.CmsAction;
 import com.fallrising.cms.identity.domain.Principal;
 import com.fallrising.cms.identity.domain.RoleCode;
 import com.fallrising.cms.identity.domain.Surface;
+import com.fallrising.cms.identity.service.AuditLog;
 import com.fallrising.cms.identity.service.AuthorizationService;
 import com.fallrising.cms.identity.store.IdentityStore;
 import com.fallrising.cms.media.domain.MediaAttachment;
 import com.fallrising.cms.media.service.MediaService;
+import com.fallrising.cms.platform.TransactionRunner;
 import org.springframework.stereotype.Service;
 
 import java.time.Instant;
@@ -40,22 +41,29 @@
 public class EntryService {
 
     private static final int REVISION_KEEP = 20;
+    private static final String CONTENT = "CONTENT";
 
     private final ContentStore store;
     private final AuthorizationService authorization;
     private final IdentityStore identityStore;
     private final MediaService mediaService;
     private final PayloadValidator validator;
+    private final TransactionRunner transactions;
+    private final AuditLog audit;
 
     public EntryService(
             ContentStore store,
             AuthorizationService authorization,
             IdentityStore identityStore,
-            MediaService mediaService) {
+            MediaService mediaService,
+            TransactionRunner transactions,
+            AuditLog audit) {
         this.store = store;
         this.authorization = authorization;
         this.identityStore = identityStore;
         this.mediaService = mediaService;
+        this.transactions = transactions;
+        this.audit = audit;
         this.validator = new PayloadValidator(store, identityStore);
     }
 
@@ -94,10 +102,13 @@
                 actor,
                 now,
                 now);
-        store.insertEntry(entry);
-        store.replaceRefs(entry.id(), extractRefs(entry, type));
-        mediaService.replaceAttachments(entry.id(), extractMediaAttachments(entry, type));
-        return entry;
+        return transactions.inTransaction(() -> {
+            store.insertEntry(entry);
+            store.replaceRefs(entry.id(), extractRefs(entry, type));
+            mediaService.replaceAttachments(entry.id(), extractMediaAttachments(entry, type));
+            audit.record(principal, surface, CONTENT, "entry.create", "entry", entry.id(), AuditLog.OK, null);
+            return entry;
+        });
     }
 
     public EntryRecord getWork(Principal principal, Surface surface, UUID id) {
@@ -177,10 +188,12 @@
                 current.createdAt(),
                 now)
                 .withPublishRequest(current.publishRequestedAt(), current.publishRequestedBy());
-        store.updateEntry(updated);
-        store.replaceRefs(updated.id(), extractRefs(updated, type));
-        mediaService.replaceAttachments(updated.id(), extractMediaAttachments(updated, type));
-        return updated;
+        return transactions.inTransaction(() -> {
+            store.updateEntry(updated);
+            store.replaceRefs(updated.id(), extractRefs(updated, type));
+            mediaService.replaceAttachments(updated.id(), extractMediaAttachments(updated, type));
+            return updated;
+        });
     }
 
     public EntryRecord publish(Principal principal, Surface surface, UUID id) {
@@ -205,7 +218,7 @@
         validatePayload(type, current.payload(), true);
         Instant now = Instant.now();
         int nextNo = store.revisionsOf(current.id()).stream().mapToInt(RevisionRecord::revisionNo).max().orElse(0) + 1;
-        store.insertRevision(new RevisionRecord(
+        RevisionRecord revision = new RevisionRecord(
                 UUID.randomUUID(),
                 current.id(),
                 nextNo,
@@ -213,8 +226,7 @@
                 current.payloadCopy(),
                 now,
                 principal == null ? null : principal.id(),
-                current.contentTypeKey()));
-        store.deleteOldestRevisions(current.id(), REVISION_KEEP);
+                current.contentTypeKey());
         EntryRecord published = new EntryRecord(
                 current.id(),
                 current.contentTypeId(),
@@ -231,7 +243,14 @@
                 principal == null ? current.updatedBy() : principal.id(),
                 current.createdAt(),
                 now);
-        return store.updateEntry(published);
+        return transactions.inTransaction(() -> {
+            store.insertRevision(revision);
+            store.deleteOldestRevisions(current.id(), REVISION_KEEP);
+            store.updateEntry(published);
+            audit.record(principal, surface, CONTENT, "entry.publish", "entry", published.id(), AuditLog.OK,
+                    Map.of("revisionNo", nextNo));
+            return published;
+        });
     }
 
     public EntryRecord unpublish(Principal principal, Surface surface, UUID id) {
@@ -240,7 +259,7 @@
             throw ContentException.invalidTransition();
         }
         Instant now = Instant.now();
-        return store.updateEntry(new EntryRecord(
+        return commit(principal, surface, "entry.unpublish", new EntryRecord(
                 current.id(),
                 current.contentTypeId(),
                 current.contentTypeKey(),
@@ -255,7 +274,7 @@
                 current.createdBy(),
                 principal == null ? current.updatedBy() : principal.id(),
                 current.createdAt(),
-                now));
+                now), null);
     }
 
     public EntryRecord archive(Principal principal, Surface surface, UUID id) {
@@ -264,7 +283,7 @@
             throw ContentException.invalidTransition();
         }
         Instant now = Instant.now();
-        return store.updateEntry(new EntryRecord(
+        return commit(principal, surface, "entry.archive", new EntryRecord(
                 current.id(),
                 current.contentTypeId(),
                 current.contentTypeKey(),
@@ -279,7 +298,7 @@
                 current.createdBy(),
                 principal == null ? current.updatedBy() : principal.id(),
                 current.createdAt(),
-                now));
+                now), null);
     }
 
     public EntryRecord restore(Principal principal, Surface surface, UUID id) {
@@ -288,7 +307,7 @@
             throw ContentException.invalidTransition();
         }
         Instant now = Instant.now();
-        return store.updateEntry(new EntryRecord(
+        return commit(principal, surface, "entry.restore", new EntryRecord(
                 current.id(),
                 current.contentTypeId(),
                 current.contentTypeKey(),
@@ -303,7 +322,7 @@
                 current.createdBy(),
                 principal == null ? current.updatedBy() : principal.id(),
                 current.createdAt(),
-                now));
+                now), null);
     }
 
     public void softDelete(Principal principal, Surface surface, UUID id) {
@@ -312,7 +331,7 @@
             throw ContentException.refConstraint();
         }
         Instant now = Instant.now();
-        store.updateEntry(new EntryRecord(
+        commit(principal, surface, "entry.soft_delete", new EntryRecord(
                 current.id(),
                 current.contentTypeId(),
                 current.contentTypeKey(),
@@ -328,7 +347,7 @@
                 principal == null ? current.updatedBy() : principal.id(),
                 current.createdAt(),
                 now)
-                .withPublishRequest(current.publishRequestedAt(), current.publishRequestedBy()));
+                .withPublishRequest(current.publishRequestedAt(), current.publishRequestedBy()), null);
     }
 
     public void purge(Principal principal, Surface surface, UUID id) {
@@ -344,19 +363,10 @@
         if (!store.refsTo(id).isEmpty()) {
             throw ContentException.refConstraint();
         }
-        store.hardDeleteEntry(id);
-        identityStore.insertAudit(new AuditEvent(
-                UUID.randomUUID(),
-                Instant.now(),
-                principal.id(),
-                "CONTENT",
-                "ENTRY_PURGED",
-                "entry",
-                current.id(),
-                surface.wire(),
-                "ok",
-                null,
-                null));
+        transactions.run(() -> {
+            store.hardDeleteEntry(id);
+            audit.record(principal, surface, CONTENT, "entry.purge", "entry", current.id(), AuditLog.OK, null);
+        });
     }
 
     public EntryRecord publicGet(Principal principal, String typeKey, UUID id, String slug) {
@@ -464,7 +474,21 @@
                 current.createdAt(),
                 now)
                 .withPublishRequest(current.publishRequestedAt(), current.publishRequestedBy());
-        return store.updateEntry(updated);
+        return transactions.inTransaction(() -> {
+            store.updateEntry(updated);
+            audit.record(principal, surface, CONTENT, "entry.revert", "entry", updated.id(), AuditLog.OK,
+                    Map.of("revisionNo", revisionNo));
+            return updated;
+        });
+    }
+
+    /** Writes a state change and its audit event in one transaction (02 BD-09). */
+    private EntryRecord commit(Principal principal, Surface surface, String action, EntryRecord next, Map<String, Object> detail) {
+        return transactions.inTransaction(() -> {
+            store.updateEntry(next);
+            audit.record(principal, surface, CONTENT, action, "entry", next.id(), AuditLog.OK, detail);
+            return next;
+        });
     }
 
     private EntryRecord loadForTransition(Principal principal, Surface surface, UUID id, CmsAction action) {
```

`src/main/java/com/fallrising/cms/content/web/AdminContentController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/AdminContentController.java
+++ b/src/main/java/com/fallrising/cms/content/web/AdminContentController.java
@@ -10,9 +10,11 @@
 import com.fallrising.cms.identity.IdentityException;
 import com.fallrising.cms.identity.domain.CmsAction;
 import com.fallrising.cms.identity.domain.Surface;
+import com.fallrising.cms.identity.service.AuditLog;
 import com.fallrising.cms.identity.store.IdentityStore;
 import com.fallrising.cms.identity.web.AuthController;
 import com.fallrising.cms.identity.web.IdentityRequest;
+import com.fallrising.cms.platform.TransactionRunner;
 import jakarta.servlet.http.HttpServletRequest;
 import org.springframework.http.HttpStatus;
 import org.springframework.web.bind.annotation.GetMapping;
@@ -36,6 +38,8 @@
 @RequestMapping("/api/v1/admin")
 public class AdminContentController {
 
+    private static final String SCHEMA = "SCHEMA";
+
     public record FieldBody(String key, String type, Boolean required, Boolean indexed, String refTarget, List<String> enumValues) {}
 
     public record TypeBody(
@@ -48,18 +52,24 @@
     private final EntryService entries;
     private final IdentityStore identityStore;
     private final com.fallrising.cms.identity.service.AuthorizationService authorization;
+    private final TransactionRunner transactions;
+    private final AuditLog audit;
 
     public AdminContentController(
             ContentStore store,
             NavigationService navigation,
             EntryService entries,
             IdentityStore identityStore,
-            com.fallrising.cms.identity.service.AuthorizationService authorization) {
+            com.fallrising.cms.identity.service.AuthorizationService authorization,
+            TransactionRunner transactions,
+            AuditLog audit) {
         this.store = store;
         this.navigation = navigation;
         this.entries = entries;
         this.identityStore = identityStore;
         this.authorization = authorization;
+        this.transactions = transactions;
+        this.audit = audit;
     }
 
     @GetMapping("/content-types")
@@ -71,7 +81,7 @@
     @PostMapping("/content-types")
     @ResponseStatus(HttpStatus.CREATED)
     public Map<String, Object> createType(@RequestBody TypeBody body, HttpServletRequest request) {
-        manageTypes(request);
+        IdentityRequest identity = manageTypes(request);
         if (body.key() == null || !body.key().matches("^[a-z][a-z0-9_]{1,62}$")) {
             throw ContentException.validation(ErrorCode.FIELD_VALIDATION, "Invalid type key");
         }
@@ -93,10 +103,10 @@
                 List.of(),
                 now,
                 now);
-        store.insertType(type);
-        int order = 0;
-        if (body.fields() != null) {
-            for (FieldBody field : body.fields()) {
+        transactions.run(() -> {
+            store.insertType(type);
+            int order = 0;
+            for (FieldBody field : body.fields() == null ? List.<FieldBody>of() : body.fields()) {
                 store.insertField(new FieldRecord(
                         UUID.randomUUID(),
                         type.id(),
@@ -113,25 +123,31 @@
                         true,
                         "media-ref".equals(field.type())));
             }
-        }
+            audit.record(identity.principal(), identity.surface(), SCHEMA, "type.create", "content_type", type.id(),
+                    AuditLog.OK, null);
+        });
         return typeJson(type);
     }
 
     @PostMapping("/content-types/{typeKey}/disable")
     public Map<String, Object> disable(@PathVariable String typeKey, HttpServletRequest request) {
-        manageTypes(request);
-        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::typeNotFound);
-        ContentTypeRecord updated = type.withEnabled(false, Instant.now());
-        store.updateType(updated);
-        return typeJson(updated);
+        return setEnabled(typeKey, false, request);
     }
 
     @PostMapping("/content-types/{typeKey}/enable")
     public Map<String, Object> enable(@PathVariable String typeKey, HttpServletRequest request) {
-        manageTypes(request);
+        return setEnabled(typeKey, true, request);
+    }
+
+    private Map<String, Object> setEnabled(String typeKey, boolean enabled, HttpServletRequest request) {
+        IdentityRequest identity = manageTypes(request);
         ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::typeNotFound);
-        ContentTypeRecord updated = type.withEnabled(true, Instant.now());
-        store.updateType(updated);
+        ContentTypeRecord updated = type.withEnabled(enabled, Instant.now());
+        transactions.run(() -> {
+            store.updateType(updated);
+            audit.record(identity.principal(), identity.surface(), SCHEMA, enabled ? "type.enable" : "type.disable",
+                    "content_type", type.id(), AuditLog.OK, null);
+        });
         return typeJson(updated);
     }
 
@@ -182,9 +198,10 @@
         return Map.of("items", items);
     }
 
-    private void manageTypes(HttpServletRequest request) {
+    private IdentityRequest manageTypes(HttpServletRequest request) {
         IdentityRequest identity = AuthController.current(request);
         authorization.require(identity.principal(), CmsAction.MANAGE_TYPES, null, null, identity.surface());
+        return identity;
     }
 
     private static IdentityRequest adminSurface(HttpServletRequest request) {
```

`src/main/java/com/fallrising/cms/content/service/NavigationService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/service/NavigationService.java
+++ b/src/main/java/com/fallrising/cms/content/service/NavigationService.java
@@ -6,7 +6,9 @@
 import com.fallrising.cms.identity.domain.CmsAction;
 import com.fallrising.cms.identity.domain.Principal;
 import com.fallrising.cms.identity.domain.Surface;
+import com.fallrising.cms.identity.service.AuditLog;
 import com.fallrising.cms.identity.service.AuthorizationService;
+import com.fallrising.cms.platform.TransactionRunner;
 import org.springframework.stereotype.Service;
 
 import java.time.Instant;
@@ -19,10 +21,15 @@
 
     private final ContentStore store;
     private final AuthorizationService authorization;
+    private final TransactionRunner transactions;
+    private final AuditLog audit;
 
-    public NavigationService(ContentStore store, AuthorizationService authorization) {
+    public NavigationService(ContentStore store, AuthorizationService authorization, TransactionRunner transactions,
+            AuditLog audit) {
         this.store = store;
         this.authorization = authorization;
+        this.transactions = transactions;
+        this.audit = audit;
     }
 
     public NavigationRecord getWork(Principal principal, Surface surface, String menuKey) {
@@ -62,7 +69,11 @@
                 current.document(),
                 principal == null ? current.updatedBy() : principal.id(),
                 now);
-        store.upsertNavigation(next);
+        transactions.run(() -> {
+            store.upsertNavigation(next);
+            audit.record(principal, surface, "SETTINGS", "navigation.publish", "navigation", current.id(), AuditLog.OK,
+                    Map.of("menuKey", menuKey));
+        });
         return next;
     }
 
```

`src/main/java/com/fallrising/cms/media/service/MediaService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/media/service/MediaService.java
+++ b/src/main/java/com/fallrising/cms/media/service/MediaService.java
@@ -9,7 +9,9 @@
 import com.fallrising.cms.identity.domain.CmsAction;
 import com.fallrising.cms.identity.domain.Principal;
 import com.fallrising.cms.identity.domain.Surface;
+import com.fallrising.cms.identity.service.AuditLog;
 import com.fallrising.cms.identity.service.AuthorizationService;
+import com.fallrising.cms.platform.TransactionRunner;
 import com.fallrising.cms.media.ImageVariants;
 import com.fallrising.cms.media.MediaException;
 import com.fallrising.cms.media.domain.MediaAsset;
@@ -40,13 +42,17 @@
     private final MediaObjectStore objects;
     private final ContentStore content;
     private final AuthorizationService authorization;
+    private final TransactionRunner transactions;
+    private final AuditLog audit;
 
-    public MediaService(
-            MediaStore store, MediaObjectStore objects, ContentStore content, AuthorizationService authorization) {
+    public MediaService(MediaStore store, MediaObjectStore objects, ContentStore content, AuthorizationService authorization,
+            TransactionRunner transactions, AuditLog audit) {
         this.store = store;
         this.objects = objects;
         this.content = content;
         this.authorization = authorization;
+        this.transactions = transactions;
+        this.audit = audit;
     }
 
     public MediaAsset upload(
@@ -151,7 +157,10 @@
                 current.createdAt(),
                 now,
                 current.variants());
-        store.update(deleted);
+        transactions.run(() -> {
+            store.update(deleted);
+            audit.record(principal, surface, "MEDIA", "media.delete", "media", id, AuditLog.OK, null);
+        });
         return deleted;
     }
 
```

`src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java
+++ b/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java
@@ -14,6 +14,7 @@
 import com.fallrising.cms.identity.domain.Surface;
 import com.fallrising.cms.identity.store.IdentityStore;
 import com.fallrising.cms.identity.web.IdentityRequest;
+import com.fallrising.cms.platform.TransactionRunner;
 import com.fasterxml.jackson.databind.JsonNode;
 import com.fasterxml.jackson.databind.ObjectMapper;
 import org.springframework.stereotype.Service;
@@ -42,15 +43,20 @@
     private final AuthorizationService authorizationService;
     private final ObjectMapper objectMapper;
     private final ContentTypeDirectory contentTypes;
+    private final TransactionRunner transactions;
+    private final AuditLog auditLog;
 
     public PrincipalAdminService(IdentityStore store, PasswordHasher passwordHasher, AuthService authService,
-            AuthorizationService authorizationService, ObjectMapper objectMapper, ContentTypeDirectory contentTypes) {
+            AuthorizationService authorizationService, ObjectMapper objectMapper, ContentTypeDirectory contentTypes,
+            TransactionRunner transactions, AuditLog auditLog) {
         this.store = store;
         this.passwordHasher = passwordHasher;
         this.authService = authService;
         this.authorizationService = authorizationService;
         this.objectMapper = objectMapper;
         this.contentTypes = contentTypes;
+        this.transactions = transactions;
+        this.auditLog = auditLog;
     }
 
     public List<Principal> list(IdentityRequest request) { authService.requireManagePrincipals(request); return store.listPrincipals(); }
@@ -175,8 +181,11 @@
             if (!seen.add(key)) throw IdentityException.validation("duplicate permission");
             next.add(new Permission(UUID.randomUUID(), role.id(), action.wire(), p.contentTypeCode(), p.predicateJson(), surfaces, now));
         }
-        store.replaceRolePermissionsKeepingUsableAdmin(role.id(), next);
-        audit(request, "PERMISSION_CHANGED", role.id());
+        transactions.run(() -> {
+            store.replaceRolePermissionsKeepingUsableAdmin(role.id(), next);
+            auditLog.record(request.principal(), request.surface(), "AUTH", "role.permissions_update", "role", role.id(),
+                    AuditLog.OK, java.util.Map.of("roleCode", role.code(), "permissions", next.size()));
+        });
     }
 
     public List<java.util.Map<String, Object>> effective(IdentityRequest request, UUID id) {
```

`src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java
+++ b/src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java
@@ -1,6 +1,7 @@
 package com.fallrising.cms.identity.service;
 
 import com.fallrising.cms.identity.IdentityException;
+import com.fallrising.cms.identity.domain.AuditEvent;
 import com.fallrising.cms.identity.domain.Capabilities;
 import com.fallrising.cms.identity.domain.CmsAction;
 import com.fallrising.cms.identity.domain.Permission;
@@ -16,6 +17,7 @@
 import org.springframework.web.context.request.RequestAttributes;
 import org.springframework.web.context.request.RequestContextHolder;
 
+import java.time.Instant;
 import java.util.ArrayList;
 import java.util.HashSet;
 import java.util.List;
@@ -52,8 +54,17 @@
         this.objectMapper = objectMapper;
     }
 
+    /**
+     * Throws SURFACE_FORBIDDEN or FORBIDDEN unless allowed. A denied governance action (CmsAction.GOVERNANCE) is also
+     * written to the audit log with outcome "denied" (02 §4.6).
+     */
     public void require(Principal principal, CmsAction action, String contentType, Map<String, Object> entry, Surface surface) {
         Decision decision = allow(principal, action, contentType, entry, surface);
+        if (!decision.allowed() && CmsAction.GOVERNANCE.contains(action)) {
+            store.insertAudit(new AuditEvent(UUID.randomUUID(), Instant.now(), principal == null ? null : principal.id(),
+                    "GOVERNANCE", action.wire(), null, null, decision.surface().wire(), "denied",
+                    null, "{\"reason\":\"" + decision.kind().name() + "\"}"));
+        }
         if (decision.kind() == DecisionKind.SURFACE_FORBIDDEN) throw IdentityException.surfaceForbidden(action.wire(), contentType, surface.wire());
         if (decision.kind() == DecisionKind.FORBIDDEN) throw IdentityException.forbidden(action.wire(), contentType, surface.wire());
     }
```

`src/test/java/com/fallrising/cms/IdentityHardeningTests.java`：

```diff
--- a/src/test/java/com/fallrising/cms/IdentityHardeningTests.java
+++ b/src/test/java/com/fallrising/cms/IdentityHardeningTests.java
@@ -13,11 +13,13 @@
 import com.fallrising.cms.identity.domain.SessionRecord;
 import com.fallrising.cms.identity.domain.Surface;
 import com.fallrising.cms.identity.service.AuthService;
+import com.fallrising.cms.identity.service.AuditLog;
 import com.fallrising.cms.identity.service.AuthorizationService;
 import com.fallrising.cms.identity.service.ContentTypeDirectory;
 import com.fallrising.cms.identity.service.PrincipalAdminService;
 import com.fallrising.cms.identity.store.IdentityStore;
 import com.fallrising.cms.identity.store.InMemoryIdentityStore;
+import com.fallrising.cms.platform.TransactionRunner;
 import com.fallrising.cms.identity.web.IdentityRequest;
 import com.fasterxml.jackson.databind.ObjectMapper;
 import org.junit.jupiter.api.Test;
@@ -114,7 +116,8 @@
         ObjectMapper mapper = new ObjectMapper();
         AuthorizationService authz = new AuthorizationService(store, mapper);
         AuthService auth = new AuthService(store, hasher, props, authz);
-        PrincipalAdminService admin = new PrincipalAdminService(store, hasher, auth, authz, mapper, NO_TYPES);
+        PrincipalAdminService admin = new PrincipalAdminService(store, hasher, auth, authz, mapper, NO_TYPES,
+                TransactionRunner.withoutDatabase(), new AuditLog(store, mapper));
         Principal principal = store.findPrincipalByUsername("admin").orElseThrow();
         IdentityRequest request = adminRequest(principal);
 
@@ -141,7 +144,8 @@
         ObjectMapper mapper = new ObjectMapper();
         AuthorizationService authz = new AuthorizationService(store, mapper);
         AuthService auth = new AuthService(store, hasher, props, authz);
-        PrincipalAdminService admin = new PrincipalAdminService(store, hasher, auth, authz, mapper, NO_TYPES);
+        PrincipalAdminService admin = new PrincipalAdminService(store, hasher, auth, authz, mapper, NO_TYPES,
+                TransactionRunner.withoutDatabase(), new AuditLog(store, mapper));
         Principal principal = store.findPrincipalByUsername("admin").orElseThrow();
         IdentityRequest request = adminRequest(principal);
         Role adminRole = store.findRoleByCode("admin").orElseThrow();
```

### 5.4 審計查詢端點（T08）

`AuditSearch` 做授權（`require(read_audit)`，所以 Front／Back 由 hard-deny 擋下並寫 `denied`）、解析參數（§4.4）與投影。`AuditController` 取代 `AdminContentController` 裡 BW0 的 `GET /audit`（同一個路徑，所以必須同一張卡移除舊的）。

`src/main/java/com/fallrising/cms/identity/service/AuditSearch.java`：

```java
package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.AuditPage;
import com.fallrising.cms.identity.domain.AuditQuery;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * GET /admin/audit and /admin/audit/{id} (02 §4.6, B-07). Needs read_audit (Admin surface only, by the hard-deny sets).
 * Query parameters: page (≥ 1, default 1), size (1..100, default 20), from (inclusive) and to (exclusive) as ISO-8601
 * date-times with offset, actor (username; unknown → empty page), action (exact; a value ending with "." is a prefix),
 * category, targetType, targetId (UUID), outcome. Blank values mean "no condition"; other parameters are ignored.
 * Every rejected value is 400 VALIDATION_FAILED.
 */
@Service
public class AuditSearch {

    private final IdentityStore store;
    private final AuthorizationService authorization;
    private final ObjectMapper objectMapper;

    public AuditSearch(IdentityStore store, AuthorizationService authorization, ObjectMapper objectMapper) {
        this.store = store;
        this.authorization = authorization;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> search(IdentityRequest request, Map<String, String[]> params) {
        authorization.require(request.principal(), CmsAction.READ_AUDIT, null, null, request.surface());
        int page = intParam(params, "page", 1, 1, Integer.MAX_VALUE);
        int size = intParam(params, "size", 20, 1, 100);
        String actorName = text(params, "actor");
        UUID actorId = null;
        if (actorName != null) {
            Optional<Principal> actor = store.findPrincipalByUsername(actorName);
            if (actor.isEmpty()) return page(List.of(), 0, page, size);
            actorId = actor.get().id();
        }
        String action = text(params, "action");
        AuditPage result = store.queryAudits(new AuditQuery(
                instant(params, "from"), instant(params, "to"), actorId, action, action != null && action.endsWith("."),
                text(params, "category"), text(params, "targetType"), uuid(params, "targetId"), text(params, "outcome"),
                page, size));
        Map<UUID, Map<String, Object>> actors = new HashMap<>();
        List<Map<String, Object>> items = result.items().stream().map(e -> item(e, actors)).toList();
        return page(items, result.total(), page, size);
    }

    public Map<String, Object> get(IdentityRequest request, UUID id) {
        authorization.require(request.principal(), CmsAction.READ_AUDIT, null, null, request.surface());
        AuditEvent event = store.findAudit(id).orElseThrow(IdentityException::auditNotFound);
        Map<String, Object> json = item(event, new HashMap<>());
        json.put("detail", detail(event.detailJson()));
        return json;
    }

    private Map<String, Object> item(AuditEvent event, Map<UUID, Map<String, Object>> actors) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("id", event.id().toString());
        json.put("at", event.at());
        json.put("actor", event.actorPrincipalId() == null ? null
                : actors.computeIfAbsent(event.actorPrincipalId(), this::actor));
        json.put("category", event.category());
        json.put("action", event.action());
        json.put("targetType", event.targetType());
        json.put("targetId", event.targetId() == null ? null : event.targetId().toString());
        json.put("surface", event.surface());
        json.put("outcome", event.outcome());
        return json;
    }

    /** { id, username, displayName }; a principal that no longer exists keeps only its id (username and displayName null). */
    private Map<String, Object> actor(UUID id) {
        Map<String, Object> json = new LinkedHashMap<>();
        Principal principal = store.findPrincipalById(id).orElse(null);
        json.put("id", id.toString());
        json.put("username", principal == null ? null : principal.username());
        json.put("displayName", principal == null ? null : principal.displayName());
        return json;
    }

    private Object detail(String raw) {
        if (raw == null) return null;
        try {
            return objectMapper.readValue(raw, Object.class);
        } catch (Exception e) {
            return null;
        }
    }

    private static Map<String, Object> page(List<Map<String, Object>> items, long total, int page, int size) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("items", items);
        json.put("total", total);
        json.put("page", page);
        json.put("size", size);
        json.put("offset", (page - 1) * size);
        json.put("limit", size);
        return json;
    }

    private static String text(Map<String, String[]> params, String name) {
        String[] values = params.get(name);
        if (values == null || values.length == 0) return null;
        if (values.length > 1) throw IdentityException.validation(name + " must not repeat");
        return values[0] == null || values[0].isBlank() ? null : values[0].trim();
    }

    private static int intParam(Map<String, String[]> params, String name, int fallback, int min, int max) {
        String raw = text(params, name);
        if (raw == null) return fallback;
        try {
            int value = Integer.parseInt(raw);
            if (value < min || value > max) throw new NumberFormatException();
            return value;
        } catch (NumberFormatException e) {
            throw IdentityException.validation(max == Integer.MAX_VALUE
                    ? name + " must be a positive integer"
                    : name + " must be an integer from " + min + " to " + max);
        }
    }

    private static Instant instant(Map<String, String[]> params, String name) {
        String raw = text(params, name);
        if (raw == null) return null;
        try {
            return Instant.parse(raw);
        } catch (DateTimeParseException e) {
            try {
                return OffsetDateTime.parse(raw).toInstant();
            } catch (DateTimeParseException e2) {
                throw IdentityException.validation(name + " must be an ISO-8601 date-time with offset");
            }
        }
    }

    private static UUID uuid(Map<String, String[]> params, String name) {
        String raw = text(params, name);
        if (raw == null) return null;
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            throw IdentityException.validation(name + " must be a UUID");
        }
    }
}
```

`src/main/java/com/fallrising/cms/identity/web/AuditController.java`：

```java
package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.service.AuditSearch;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin/audit")
public class AuditController {

    private final AuditSearch audit;

    public AuditController(AuditSearch audit) {
        this.audit = audit;
    }

    @GetMapping
    public Map<String, Object> search(HttpServletRequest request) {
        return audit.search(AuthController.current(request), request.getParameterMap());
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable UUID id, HttpServletRequest request) {
        return audit.get(AuthController.current(request), id);
    }
}
```

`src/main/java/com/fallrising/cms/content/web/AdminContentController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/AdminContentController.java
+++ b/src/main/java/com/fallrising/cms/content/web/AdminContentController.java
@@ -11,7 +11,6 @@
 import com.fallrising.cms.identity.domain.CmsAction;
 import com.fallrising.cms.identity.domain.Surface;
 import com.fallrising.cms.identity.service.AuditLog;
-import com.fallrising.cms.identity.store.IdentityStore;
 import com.fallrising.cms.identity.web.AuthController;
 import com.fallrising.cms.identity.web.IdentityRequest;
 import com.fallrising.cms.platform.TransactionRunner;
@@ -23,7 +22,6 @@
 import org.springframework.web.bind.annotation.PostMapping;
 import org.springframework.web.bind.annotation.RequestBody;
 import org.springframework.web.bind.annotation.RequestMapping;
-import org.springframework.web.bind.annotation.RequestParam;
 import org.springframework.web.bind.annotation.ResponseStatus;
 import org.springframework.web.bind.annotation.RestController;
 
@@ -50,7 +48,6 @@
     private final ContentStore store;
     private final NavigationService navigation;
     private final EntryService entries;
-    private final IdentityStore identityStore;
     private final com.fallrising.cms.identity.service.AuthorizationService authorization;
     private final TransactionRunner transactions;
     private final AuditLog audit;
@@ -59,14 +56,12 @@
             ContentStore store,
             NavigationService navigation,
             EntryService entries,
-            IdentityStore identityStore,
             com.fallrising.cms.identity.service.AuthorizationService authorization,
             TransactionRunner transactions,
             AuditLog audit) {
         this.store = store;
         this.navigation = navigation;
         this.entries = entries;
-        this.identityStore = identityStore;
         this.authorization = authorization;
         this.transactions = transactions;
         this.audit = audit;
@@ -177,27 +172,6 @@
         entries.purge(identity.principal(), identity.surface(), id);
     }
 
-    @GetMapping("/audit")
-    public Map<String, Object> audit(
-            @RequestParam(required = false) String action,
-            @RequestParam(required = false) UUID targetId,
-            HttpServletRequest request) {
-        IdentityRequest identity = adminSurface(request);
-        authorization.require(identity.principal(), CmsAction.READ_AUDIT, null, null, identity.surface());
-        List<Map<String, Object>> items = identityStore.listAudits(action, targetId).stream()
-                .map(event -> {
-                    Map<String, Object> json = new LinkedHashMap<>();
-                    json.put("action", event.action());
-                    json.put("targetType", event.targetType());
-                    json.put("targetId", event.targetId() == null ? null : event.targetId().toString());
-                    json.put("outcome", event.outcome());
-                    json.put("at", event.at());
-                    return json;
-                })
-                .toList();
-        return Map.of("items", items);
-    }
-
     private IdentityRequest manageTypes(HttpServletRequest request) {
         IdentityRequest identity = AuthController.current(request);
         authorization.require(identity.principal(), CmsAction.MANAGE_TYPES, null, null, identity.surface());
```

`src/main/java/com/fallrising/cms/api/error/ErrorCode.java`：

```diff
--- a/src/main/java/com/fallrising/cms/api/error/ErrorCode.java
+++ b/src/main/java/com/fallrising/cms/api/error/ErrorCode.java
@@ -20,6 +20,7 @@
     ENTRY_NOT_FOUND("ENTRY_NOT_FOUND", HttpStatus.NOT_FOUND),
     CONTENT_TYPE_NOT_FOUND("CONTENT_TYPE_NOT_FOUND", HttpStatus.NOT_FOUND),
     NAVIGATION_NOT_FOUND("NAVIGATION_NOT_FOUND", HttpStatus.NOT_FOUND),
+    AUDIT_EVENT_NOT_FOUND("AUDIT_EVENT_NOT_FOUND", HttpStatus.NOT_FOUND),
     AUDIENCE_PARAM_REJECTED("AUDIENCE_PARAM_REJECTED", HttpStatus.BAD_REQUEST),
     INVALID_STATE_TRANSITION("INVALID_STATE_TRANSITION", HttpStatus.CONFLICT),
     SLUG_CONFLICT("SLUG_CONFLICT", HttpStatus.CONFLICT),
```

`src/main/java/com/fallrising/cms/identity/IdentityException.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/IdentityException.java
+++ b/src/main/java/com/fallrising/cms/identity/IdentityException.java
@@ -61,6 +61,10 @@
                 "admin");
     }
 
+    public static IdentityException auditNotFound() {
+        return new IdentityException(ErrorCode.AUDIT_EVENT_NOT_FOUND, "Audit event not found", null, null, null);
+    }
+
     public static IdentityException validation(String message) {
         return new IdentityException(ErrorCode.VALIDATION_FAILED, message, null, null, null);
     }
```

`src/main/resources/openapi/openapi.yaml`：

```diff
--- a/src/main/resources/openapi/openapi.yaml
+++ b/src/main/resources/openapi/openapi.yaml
@@ -25,7 +25,7 @@
     - 405 `METHOD_NOT_ALLOWED` when the path exists but the HTTP method does not.
     - 415 `MEDIA_TYPE_NOT_SUPPORTED` when a JSON operation receives another Content-Type.
     - 500 `INTERNAL_ERROR` for any unexpected server failure.
-  version: 0.7.0
+  version: 0.8.0
   license:
     name: Proprietary
 servers:
@@ -1104,29 +1104,62 @@
       operationId: listAudit
       tags: [Admin]
       description: |
-        Newest first. Not paginated in this version.
-        Errors:
-        - 403 SURFACE_FORBIDDEN: called from the Front or Back surface.
-        - 403 FORBIDDEN: caller lacks `read_audit`.
+        Audit search (02 §4.6, B-07). Order: `at` descending, then id text ascending. Blank parameters mean
+        no condition; other parameters are ignored. `actor` is a username; an unknown username gives an
+        empty page. `action` matches exactly, or as a prefix when the value ends with `.` (for example
+        `entry.`). `from` is inclusive and `to` exclusive.
+        Errors:
+        - 400 VALIDATION_FAILED: `page` or `size` out of range; `from`, `to` or `targetId` malformed; a
+          parameter repeated.
+        - 403 SURFACE_FORBIDDEN: called from the Front or Back surface (also written to the audit log as a
+          denied `read_audit`).
+        - 403 FORBIDDEN: caller lacks `read_audit` (also written as denied).
       parameters:
+        - $ref: "#/components/parameters/Page"
+        - $ref: "#/components/parameters/Size"
+        - { in: query, name: from, required: false, schema: { type: string, format: date-time } }
+        - { in: query, name: to, required: false, schema: { type: string, format: date-time } }
+        - { in: query, name: actor, required: false, description: Username of the actor., schema: { type: string } }
         - in: query
           name: action
           required: false
-          description: Exact audit action, for example `LOGIN_SUCCESS`.
+          description: Exact action, for example `entry.publish`; a value ending with `.` is a prefix.
           schema: { type: string }
-        - in: query
-          name: targetId
-          required: false
-          schema: { type: string, format: uuid }
+        - { in: query, name: category, required: false, schema: { type: string } }
+        - { in: query, name: targetType, required: false, schema: { type: string } }
+        - { in: query, name: targetId, required: false, schema: { type: string, format: uuid } }
+        - { in: query, name: outcome, required: false, schema: { type: string } }
+      responses:
+        "200":
+          description: One page of audit events
+          content:
+            application/json:
+              schema: { $ref: "#/components/schemas/AuditEventPage" }
+        "400": { $ref: "#/components/responses/Error400" }
+        "401": { $ref: "#/components/responses/Error401" }
+        "403": { $ref: "#/components/responses/Error403" }
+        "500": { $ref: "#/components/responses/Error500" }
+  /api/v1/admin/audit/{id}:
+    get:
+      operationId: getAuditEvent
+      tags: [Admin]
+      description: |
+        One audit event with its `detail`.
+        Errors:
+        - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listAudit.
+        - 404 AUDIT_EVENT_NOT_FOUND: no event with this id.
+      parameters:
+        - $ref: "#/components/parameters/Id"
       responses:
         "200":
-          description: Audit events
+          description: Audit event
           content:
             application/json:
-              schema: { $ref: "#/components/schemas/AuditEventList" }
+              schema: { $ref: "#/components/schemas/AuditEventDetail" }
         "400": { $ref: "#/components/responses/Error400" }
         "401": { $ref: "#/components/responses/Error401" }
         "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
         "500": { $ref: "#/components/responses/Error500" }
   /api/v1/media:
     get:
@@ -1472,6 +1505,7 @@
         - ENTRY_NOT_FOUND
         - CONTENT_TYPE_NOT_FOUND
         - NAVIGATION_NOT_FOUND
+        - AUDIT_EVENT_NOT_FOUND
         - AUDIENCE_PARAM_REJECTED
         - INVALID_STATE_TRANSITION
         - SLUG_CONFLICT
@@ -2200,24 +2234,77 @@
           allOf:
             - $ref: "#/components/schemas/NavigationDocument"
           nullable: true
+    AuditActor:
+      type: object
+      additionalProperties: false
+      required: [id, username, displayName]
+      properties:
+        id: { type: string, format: uuid }
+        username:
+          type: string
+          nullable: true
+          description: Null when the principal no longer exists.
+        displayName: { type: string, nullable: true }
     AuditEventSummary:
       type: object
       additionalProperties: false
-      required: [action, targetType, targetId, outcome, at]
+      required: [id, at, actor, category, action, targetType, targetId, surface, outcome]
       properties:
+        id: { type: string, format: uuid }
+        at: { type: string, format: date-time }
+        actor:
+          allOf:
+            - $ref: "#/components/schemas/AuditActor"
+          nullable: true
+          description: Null for events without an actor (anonymous login attempts, seeding).
+        category:
+          type: string
+          description: AUTH, CONTENT, SCHEMA, SETTINGS, MEDIA or GOVERNANCE.
+        action:
+          type: string
+          description: For example `entry.publish`, `type.create`, `LOGIN_SUCCESS`, or a denied governance action such as `manage_types`.
+        targetType: { type: string, nullable: true }
+        targetId: { type: string, format: uuid, nullable: true }
+        surface: { type: string, nullable: true }
+        outcome:
+          type: string
+          description: ok or denied.
+    AuditEventDetail:
+      type: object
+      additionalProperties: false
+      description: AuditEventSummary plus detail.
+      required: [id, at, actor, category, action, targetType, targetId, surface, outcome, detail]
+      properties:
+        id: { type: string, format: uuid }
+        at: { type: string, format: date-time }
+        actor:
+          allOf:
+            - $ref: "#/components/schemas/AuditActor"
+          nullable: true
+        category: { type: string }
         action: { type: string }
         targetType: { type: string, nullable: true }
         targetId: { type: string, format: uuid, nullable: true }
+        surface: { type: string, nullable: true }
         outcome: { type: string }
-        at: { type: string, format: date-time }
-    AuditEventList:
+        detail:
+          type: object
+          nullable: true
+          additionalProperties: true
+          description: The event's detail_json, or null.
+    AuditEventPage:
       type: object
       additionalProperties: false
-      required: [items]
+      required: [items, total, page, size, offset, limit]
       properties:
         items:
           type: array
           items: { $ref: "#/components/schemas/AuditEventSummary" }
+        total: { type: integer, format: int64 }
+        page: { type: integer, minimum: 1 }
+        size: { type: integer, minimum: 1, maximum: 100 }
+        offset: { type: integer }
+        limit: { type: integer }
     MediaVariantLink:
       type: object
       additionalProperties: false
```

### 5.5 請求發布（T10）

`requestPublish`：找 entry（軟刪除當作不存在）→ `require(update)` → 狀態必須是 draft，或 published 且 `dirty` → 已經有請求就原樣回傳 → 否則設定 `(now, 呼叫者)`，與 `entry.publish_request` 同一個交易。`cancelPublishRequest`：找 entry → `require(update)` → 沒有請求就原樣回傳 → 否則清除並寫 `entry.publish_request_cancel`。兩者都不改 `version`、`updatedAt`。

`src/main/java/com/fallrising/cms/content/service/EntryService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/service/EntryService.java
+++ b/src/main/java/com/fallrising/cms/content/service/EntryService.java
@@ -146,7 +146,8 @@
         AccessFilter access = accessFilter(authorization.listAccess(
                 principal, needsDraft ? CmsAction.READ_DRAFT : CmsAction.READ_PUBLISHED, typeKey, surface));
         EntryPage page = store.queryEntries(new EntryQuery(type.id(), IndexScope.WORK, parsed.states(), type.titleField(),
-                parsed.q(), parsed.filters(), parsed.refs(), access, null, List.of(), parsed.sort(), parsed.page(), parsed.size(), false));
+                parsed.q(), parsed.filters(), parsed.refs(), access, null, List.of(), parsed.sort(), parsed.page(), parsed.size(),
+                parsed.publishRequested()));
         return new ListResult(type, fields, page, parsed.page(), parsed.size());
     }
 
@@ -253,6 +254,41 @@
         });
     }
 
+    /**
+     * Asks a publisher to publish (G-03). Needs update; the entry must be a draft, or published with unpublished
+     * changes (dirty). An open request is kept as it is (no second audit event). Version and updatedAt do not change.
+     */
+    public EntryRecord requestPublish(Principal principal, Surface surface, UUID id) {
+        EntryRecord current = store.findEntry(id).orElseThrow(ContentException::notFound);
+        if (current.deleted()) {
+            throw ContentException.notFound();
+        }
+        authorization.require(principal, CmsAction.UPDATE, current.contentTypeKey(), current.payload(), surface);
+        boolean eligible = current.publicationState() == PublicationState.DRAFT
+                || (current.publicationState() == PublicationState.PUBLISHED && current.dirty());
+        if (!eligible) {
+            throw ContentException.invalidTransition();
+        }
+        if (current.publishRequested()) {
+            return current;
+        }
+        return commit(principal, surface, "entry.publish_request",
+                current.withPublishRequest(Instant.now(), principal == null ? null : principal.id()), null);
+    }
+
+    /** Withdraws a publish request (G-03). Needs update; without an open request nothing changes. */
+    public EntryRecord cancelPublishRequest(Principal principal, Surface surface, UUID id) {
+        EntryRecord current = store.findEntry(id).orElseThrow(ContentException::notFound);
+        if (current.deleted()) {
+            throw ContentException.notFound();
+        }
+        authorization.require(principal, CmsAction.UPDATE, current.contentTypeKey(), current.payload(), surface);
+        if (!current.publishRequested()) {
+            return current;
+        }
+        return commit(principal, surface, "entry.publish_request_cancel", current.withPublishRequest(null, null), null);
+    }
+
     public EntryRecord unpublish(Principal principal, Surface surface, UUID id) {
         EntryRecord current = loadForTransition(principal, surface, id, CmsAction.UNPUBLISH);
         if (current.publicationState() != PublicationState.PUBLISHED) {
```

`src/main/java/com/fallrising/cms/content/web/EntryController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/EntryController.java
+++ b/src/main/java/com/fallrising/cms/content/web/EntryController.java
@@ -96,6 +96,18 @@
         return workJson(entries.publish(identity.principal(), identity.surface(), id));
     }
 
+    @PostMapping("/entries/{id}/publish-request")
+    public Map<String, Object> requestPublish(@PathVariable UUID id, HttpServletRequest request) {
+        IdentityRequest identity = rejectFront(request);
+        return workJson(entries.requestPublish(identity.principal(), identity.surface(), id));
+    }
+
+    @DeleteMapping("/entries/{id}/publish-request")
+    public Map<String, Object> cancelPublishRequest(@PathVariable UUID id, HttpServletRequest request) {
+        IdentityRequest identity = rejectFront(request);
+        return workJson(entries.cancelPublishRequest(identity.principal(), identity.surface(), id));
+    }
+
     @PostMapping("/entries/{id}/unpublish")
     public Map<String, Object> unpublish(@PathVariable UUID id, HttpServletRequest request) {
         IdentityRequest identity = rejectFront(request);
```

`src/main/java/com/fallrising/cms/content/query/ListQueryParser.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/query/ListQueryParser.java
+++ b/src/main/java/com/fallrising/cms/content/query/ListQueryParser.java
@@ -29,6 +29,7 @@
  *   <li>filter.&lt;field&gt;: equality on a filterable field; datetime fields take filter.&lt;field&gt;.from
  *       (inclusive) and filter.&lt;field&gt;.to (exclusive) instead. Each name at most once.</li>
  *   <li>ref.&lt;field&gt;: target entry id; may repeat, all must match. Blank values are ignored.</li>
+ *   <li>publishRequested (work only): true keeps only entries with an open publish request; false or absent = all.</li>
  * </ul>
  *
  * A field is sortable or filterable when it is enabled and gets index rows (EntryIndexer.indexedKeys); filterable
@@ -53,7 +54,8 @@
             List<RefFilter> refs,
             SortKey sort,
             int page,
-            int size) {}
+            int size,
+            boolean publishRequested) {}
 
     private ListQueryParser() {}
 
@@ -114,7 +116,15 @@
             }
         }
         ranges.forEach((key, bounds) -> filters.add(FieldFilter.range(key, bounds[0], bounds[1])));
-        return new Parsed(states, q, filters, refs, sort, page, size);
+        boolean publishRequested = false;
+        if (!publicScope) {
+            String raw = single(params, "publishRequested");
+            if (raw != null && !"true".equals(raw) && !"false".equals(raw)) {
+                throw ContentException.invalidParameter("publishRequested must be true or false");
+            }
+            publishRequested = "true".equals(raw);
+        }
+        return new Parsed(states, q, filters, refs, sort, page, size, publishRequested);
     }
 
     private static List<String> states(Map<String, String[]> params) {
```

`src/main/java/com/fallrising/cms/content/web/ContentProjection.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/ContentProjection.java
+++ b/src/main/java/com/fallrising/cms/content/web/ContentProjection.java
@@ -26,6 +26,8 @@
         json.put("dirty", entry.dirty());
         json.put("publishedAt", entry.publishedAt());
         json.put("updatedAt", entry.updatedAt());
+        json.put("publishRequestedAt", entry.publishRequestedAt());
+        json.put("publishRequestedBy", entry.publishRequestedBy() == null ? null : entry.publishRequestedBy().toString());
         return json;
     }
 
```

`src/test/java/com/fallrising/cms/content/query/ListQueryParserTests.java`：

```diff
--- a/src/test/java/com/fallrising/cms/content/query/ListQueryParserTests.java
+++ b/src/test/java/com/fallrising/cms/content/query/ListQueryParserTests.java
@@ -72,7 +72,7 @@
     void G02_workDefaults() {
         ListQueryParser.Parsed parsed = work("offset", "40", "unknown", "x");
         assertThat(parsed).isEqualTo(new ListQueryParser.Parsed(List.of("draft", "published"), null, List.of(), List.of(),
-                SortKey.system("updatedAt", true), 1, 20));
+                SortKey.system("updatedAt", true), 1, 20, false));
     }
 
     @Test
```

`src/test/java/com/fallrising/cms/OpenApiResponseValidatorSelfTests.java`：

```diff
--- a/src/test/java/com/fallrising/cms/OpenApiResponseValidatorSelfTests.java
+++ b/src/test/java/com/fallrising/cms/OpenApiResponseValidatorSelfTests.java
@@ -14,7 +14,7 @@
     static final String ENTRY = """
             {"id":"6f1c2f2e-3a52-4c55-9d0e-1f4f0a3b9c11","contentType":"album","slug":"a","publicationState":"draft",
              "version":1,"title":"A","payload":{"title":"A"},"dirty":false,"publishedAt":null,
-             "updatedAt":"2026-09-25T00:00:00Z"%s}
+             "updatedAt":"2026-09-25T00:00:00Z","publishRequestedAt":null,"publishRequestedBy":null%s}
             """;
 
     @Test
```

`src/main/resources/openapi/openapi.yaml`：

```diff
--- a/src/main/resources/openapi/openapi.yaml
+++ b/src/main/resources/openapi/openapi.yaml
@@ -614,9 +614,10 @@
         Field filters: `filter.<fieldKey>=<value>` on a field with `filterable=true` and index rows;
         datetime fields take `filter.<fieldKey>.from` (inclusive) and `filter.<fieldKey>.to` (exclusive).
         Relation filters: `ref.<fieldKey>=<entry uuid>`; may repeat, all must match.
+        `publishRequested=true` keeps only entries with an open publish request (G-03).
         Other query parameters are ignored.
         Errors:
-        - 400 VALIDATION_FAILED: `page` or `size` out of range; unknown `state` value; `sort` names a key
+        - 400 VALIDATION_FAILED: `publishRequested` other than true or false; `page` or `size` out of range; unknown `state` value; `sort` names a key
           that is not sortable; a filter names a field that is not filterable or has a value of the wrong
           kind; a `ref.<fieldKey>` value is not a UUID; a parameter other than `ref.<fieldKey>` is repeated.
         - 403 SURFACE_FORBIDDEN: called from the Front surface.
@@ -629,6 +630,10 @@
         - $ref: "#/components/parameters/Page"
         - $ref: "#/components/parameters/Size"
         - $ref: "#/components/parameters/Sort"
+        - in: query
+          name: publishRequested
+          required: false
+          schema: { type: boolean }
       responses:
         "200":
           description: Work entries including drafts
@@ -787,6 +792,56 @@
         "409": { $ref: "#/components/responses/Error409" }
         "422": { $ref: "#/components/responses/Error422" }
         "500": { $ref: "#/components/responses/Error500" }
+  /api/v1/entries/{id}/publish-request:
+    post:
+      operationId: requestPublish
+      tags: [Content]
+      description: |
+        Asks for the entry to be published (G-03). Needs `update`. The entry must be a draft, or published
+        with unpublished changes (`dirty`). An open request is returned unchanged. `version` and `updatedAt`
+        do not change. Publish, unpublish, archive and restore clear the request. Audit: `entry.publish_request`.
+        Errors:
+        - 403 SURFACE_FORBIDDEN, FORBIDDEN: as getWorkEntry (action `update`).
+        - 404 ENTRY_NOT_FOUND: entry missing or soft-deleted.
+        - 409 INVALID_STATE_TRANSITION: archived, or published without changes.
+      parameters:
+        - $ref: "#/components/parameters/Id"
+        - $ref: "#/components/parameters/CsrfHeader"
+      responses:
+        "200":
+          description: Entry with an open publish request
+          content:
+            application/json:
+              schema: { $ref: "#/components/schemas/WorkEntry" }
+        "400": { $ref: "#/components/responses/Error400" }
+        "401": { $ref: "#/components/responses/Error401" }
+        "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
+        "409": { $ref: "#/components/responses/Error409" }
+        "500": { $ref: "#/components/responses/Error500" }
+    delete:
+      operationId: cancelPublishRequest
+      tags: [Content]
+      description: |
+        Withdraws the open publish request. Needs `update`. Without a request the entry is returned
+        unchanged. Audit: `entry.publish_request_cancel`.
+        Errors:
+        - 403 SURFACE_FORBIDDEN, FORBIDDEN: as getWorkEntry (action `update`).
+        - 404 ENTRY_NOT_FOUND: entry missing or soft-deleted.
+      parameters:
+        - $ref: "#/components/parameters/Id"
+        - $ref: "#/components/parameters/CsrfHeader"
+      responses:
+        "200":
+          description: Entry without a publish request
+          content:
+            application/json:
+              schema: { $ref: "#/components/schemas/WorkEntry" }
+        "400": { $ref: "#/components/responses/Error400" }
+        "401": { $ref: "#/components/responses/Error401" }
+        "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
+        "500": { $ref: "#/components/responses/Error500" }
   /api/v1/entries/{id}/unpublish:
     post:
       operationId: unpublishEntry
@@ -2019,7 +2074,8 @@
     WorkEntry:
       type: object
       additionalProperties: false
-      required: [id, contentType, slug, publicationState, version, title, payload, dirty, publishedAt, updatedAt]
+      required: [id, contentType, slug, publicationState, version, title, payload, dirty, publishedAt, updatedAt,
+        publishRequestedAt, publishRequestedBy]
       properties:
         id: { type: string, format: uuid }
         contentType: { type: string }
@@ -2036,6 +2092,16 @@
           description: True when published and the work copy differs from the published copy.
         publishedAt: { type: string, format: date-time, nullable: true }
         updatedAt: { type: string, format: date-time }
+        publishRequestedAt:
+          type: string
+          format: date-time
+          nullable: true
+          description: When an open publish request was made (G-03); null without one.
+        publishRequestedBy:
+          type: string
+          format: uuid
+          nullable: true
+          description: Principal who made the open publish request.
     WorkEntryPage:
       type: object
       additionalProperties: false
```

### 5.6 可指派使用者（T12）

`PrincipalAdminService.assignable`：未登入 401；`contentType` 空白或不是啟用中的類型 400；呼叫者在自己的 surface 對該類型沒有 `update`（`hasAction`，忽略 predicate）403；候選人是 `listPrincipals()` 中未刪除、`ACTIVE`、在 Back 對該類型有 `update` 的 principal（每個候選人的 grant 在同一個請求內各讀一次）；`q` 比對 username 或 displayName（不分大小寫、包含）；依 displayName（小寫）再依 username 排序；最多 20 筆。principal 數量是 demo 規模，逐一判斷權限；超過數百人時改成 SQL（留給 BW4 量測）。

`src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java
+++ b/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java
@@ -21,6 +21,7 @@
 
 import java.time.Instant;
 import java.util.ArrayList;
+import java.util.Comparator;
 import java.util.HashSet;
 import java.util.List;
 import java.util.Locale;
@@ -61,6 +62,32 @@
 
     public List<Principal> list(IdentityRequest request) { authService.requireManagePrincipals(request); return store.listPrincipals(); }
 
+    /**
+     * Principals that can be assigned to entries of contentType (G-04): active, not deleted, and holding update on
+     * that type on the Back surface (predicates ignored). The caller needs update on the type on its own surface.
+     * q filters by username or displayName (case-insensitive substring). Ordered by displayName, then username; at
+     * most 20.
+     */
+    public List<Principal> assignable(IdentityRequest request, String contentType, String q) {
+        if (request.principal() == null) throw IdentityException.unauthenticated();
+        if (contentType == null || contentType.isBlank()) throw IdentityException.validation("contentType is required");
+        if (!contentTypes.enabledTypeKeys().contains(contentType)) throw IdentityException.validation("unknown contentType");
+        if (!authorizationService.hasAction(request.principal(), CmsAction.UPDATE, contentType, request.surface())) {
+            throw IdentityException.forbidden(CmsAction.UPDATE.wire(), contentType, request.surface().wire());
+        }
+        String needle = q == null ? "" : q.trim().toLowerCase(Locale.ROOT);
+        return store.listPrincipals().stream()
+                .filter(p -> !p.deleted() && p.status() == PrincipalStatus.ACTIVE)
+                .filter(p -> needle.isEmpty()
+                        || p.username().toLowerCase(Locale.ROOT).contains(needle)
+                        || (p.displayName() != null && p.displayName().toLowerCase(Locale.ROOT).contains(needle)))
+                .filter(p -> authorizationService.hasAction(p, CmsAction.UPDATE, contentType, Surface.BACK))
+                .sorted(Comparator.comparing((Principal p) -> p.displayName() == null ? "" : p.displayName().toLowerCase(Locale.ROOT))
+                        .thenComparing(Principal::username))
+                .limit(20)
+                .toList();
+    }
+
     public Principal get(IdentityRequest request, UUID id) {
         authService.requireManagePrincipals(request);
         return store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
```

`src/main/java/com/fallrising/cms/identity/web/PrincipalController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/web/PrincipalController.java
+++ b/src/main/java/com/fallrising/cms/identity/web/PrincipalController.java
@@ -14,6 +14,7 @@
 import org.springframework.web.bind.annotation.PutMapping;
 import org.springframework.web.bind.annotation.RequestBody;
 import org.springframework.web.bind.annotation.RequestMapping;
+import org.springframework.web.bind.annotation.RequestParam;
 import org.springframework.web.bind.annotation.ResponseStatus;
 import org.springframework.web.bind.annotation.RestController;
 
@@ -49,6 +50,17 @@
         return Map.of("items", items, "page", 0, "size", items.size(), "total", items.size());
     }
 
+    @GetMapping("/principals/assignable")
+    public Map<String, Object> assignable(
+            @RequestParam(required = false) String contentType,
+            @RequestParam(required = false) String q,
+            HttpServletRequest request) {
+        List<Map<String, Object>> items = principals.assignable(AuthController.current(request), contentType, q).stream()
+                .map(p -> Map.<String, Object>of("id", p.id().toString(), "displayName", p.displayName()))
+                .toList();
+        return Map.of("items", items);
+    }
+
     @PostMapping("/principals")
     @ResponseStatus(HttpStatus.CREATED)
     public Map<String, Object> create(@RequestBody CreatePrincipalBody body, HttpServletRequest request) {
```

`src/main/resources/openapi/openapi.yaml`：

```diff
--- a/src/main/resources/openapi/openapi.yaml
+++ b/src/main/resources/openapi/openapi.yaml
@@ -203,6 +203,31 @@
         "403": { $ref: "#/components/responses/Error403" }
         "415": { $ref: "#/components/responses/Error415" }
         "500": { $ref: "#/components/responses/Error500" }
+  /api/v1/principals/assignable:
+    get:
+      operationId: listAssignablePrincipals
+      tags: [Principals]
+      description: |
+        Principals that entries of `contentType` can be assigned to (G-04): active, not deleted, holding
+        `update` on the type on the Back surface (predicates ignored). The caller needs `update` on the type
+        on its own surface. `q` is a case-insensitive substring of username or displayName. Order:
+        displayName, then username; at most 20. Only `id` and `displayName` are returned.
+        Errors:
+        - 400 VALIDATION_FAILED: `contentType` missing, unknown or disabled.
+        - 403 FORBIDDEN: caller lacks `update` on the type.
+      parameters:
+        - { in: query, name: contentType, required: true, schema: { type: string } }
+        - { in: query, name: q, required: false, schema: { type: string } }
+      responses:
+        "200":
+          description: Assignable principals
+          content:
+            application/json:
+              schema: { $ref: "#/components/schemas/AssignablePrincipalList" }
+        "400": { $ref: "#/components/responses/Error400" }
+        "401": { $ref: "#/components/responses/Error401" }
+        "403": { $ref: "#/components/responses/Error403" }
+        "500": { $ref: "#/components/responses/Error500" }
   /api/v1/principals/{id}:
     get:
       operationId: getPrincipal
@@ -1781,6 +1806,21 @@
       properties:
         currentPassword: { type: string }
         newPassword: { type: string, minLength: 12 }
+    AssignablePrincipalList:
+      type: object
+      additionalProperties: false
+      required: [items]
+      properties:
+        items:
+          type: array
+          maxItems: 20
+          items:
+            type: object
+            additionalProperties: false
+            required: [id, displayName]
+            properties:
+              id: { type: string, format: uuid }
+              displayName: { type: string }
     Principal:
       type: object
       additionalProperties: false
```

### 5.7 批次更新（T14）

單筆 PATCH 拆成 `preparePatch`（找、狀態、權限、版本、slug、合併、驗證，**不寫入**；驗證錯誤放在回傳值裡）與 `applyPatch`（寫 entry、關聯、附件）。`batchPatch` 的步驟：

1. `items` 為 null、空或超過 100：400。
2. 依序檢查每筆的 `id`：null 400 `items[i].id is required`；重複 400 `items[i].id is repeated`。
3. 依序對每筆 `preparePatch`：任何 `CmsApiException`（404、409、403、428）立刻以 `ContentException.inBatchItem(i, e)` 拋出（同代碼、同 `action`／`contentType`／`surface`／`fields`，訊息加 `items[i]: `）；欄位錯誤收集起來，路徑前面加 `items[i].`。
4. 有欄位錯誤：一次拋出 422（代碼依 BW1c 的 `topLevelCode`）。
5. 在一個 `TransactionRunner` 區塊內依序 `applyPatch`，回傳更新後的 entries（依 items 順序）。

版本檢查與寫入之間沒有鎖（與單筆 PATCH 相同）。

`src/main/java/com/fallrising/cms/content/service/EntryService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/service/EntryService.java
+++ b/src/main/java/com/fallrising/cms/content/service/EntryService.java
@@ -1,5 +1,6 @@
 package com.fallrising.cms.content.service;
 
+import com.fallrising.cms.api.error.CmsApiException;
 import com.fallrising.cms.api.error.ErrorCode;
 import com.fallrising.cms.api.error.FieldError;
 import com.fallrising.cms.content.ContentException;
@@ -32,9 +33,11 @@
 
 import java.time.Instant;
 import java.util.ArrayList;
+import java.util.HashSet;
 import java.util.LinkedHashMap;
 import java.util.List;
 import java.util.Map;
+import java.util.Set;
 import java.util.UUID;
 
 @Service
@@ -152,6 +155,63 @@
     }
 
     public EntryRecord patch(Principal principal, Surface surface, UUID id, String slug, Map<String, Object> payload, Integer version) {
+        PreparedPatch prepared = preparePatch(principal, surface, id, slug, payload, version);
+        if (!prepared.errors().isEmpty()) {
+            throw ContentException.fieldErrors(prepared.errors());
+        }
+        return transactions.inTransaction(() -> applyPatch(prepared));
+    }
+
+    /** One item of a batch patch (G-09). */
+    public record BatchItem(UUID id, Integer version, Map<String, Object> payload) {}
+
+    public static final int BATCH_MAX = 100;
+
+    /**
+     * Patches 1..100 entries atomically (G-09). Every item gets the same checks as a single PATCH, in item order; the
+     * first failing check that is not a field error stops the batch with that error (message prefixed "items[i]: ").
+     * Field errors of all items are collected with paths "items[i].payload.&lt;key&gt;" and thrown as one 422. Only when
+     * every item passes are all items written, in one transaction. Returns the updated entries in item order.
+     */
+    public List<EntryRecord> batchPatch(Principal principal, Surface surface, List<BatchItem> items) {
+        if (items == null || items.isEmpty() || items.size() > BATCH_MAX) {
+            throw ContentException.invalidParameter("items must contain 1 to " + BATCH_MAX + " entries");
+        }
+        Set<UUID> seen = new HashSet<>();
+        for (int i = 0; i < items.size(); i++) {
+            BatchItem item = items.get(i);
+            if (item == null || item.id() == null) {
+                throw ContentException.invalidParameter("items[" + i + "].id is required");
+            }
+            if (!seen.add(item.id())) {
+                throw ContentException.invalidParameter("items[" + i + "].id is repeated");
+            }
+        }
+        List<PreparedPatch> prepared = new ArrayList<>();
+        List<FieldError> errors = new ArrayList<>();
+        for (int i = 0; i < items.size(); i++) {
+            BatchItem item = items.get(i);
+            PreparedPatch one;
+            try {
+                one = preparePatch(principal, surface, item.id(), null, item.payload(), item.version());
+            } catch (CmsApiException e) {
+                throw ContentException.inBatchItem(i, e);
+            }
+            String prefix = "items[" + i + "].";
+            one.errors().forEach(e -> errors.add(new FieldError(prefix + e.field(), e.code(), e.message())));
+            prepared.add(one);
+        }
+        if (!errors.isEmpty()) {
+            throw ContentException.fieldErrors(errors);
+        }
+        return transactions.inTransaction(() -> prepared.stream().map(this::applyPatch).toList());
+    }
+
+    /** Checks and builds a patch without writing (single PATCH and batch share it). */
+    private record PreparedPatch(EntryRecord updated, ContentTypeRecord type, List<FieldError> errors) {}
+
+    private PreparedPatch preparePatch(Principal principal, Surface surface, UUID id, String slug, Map<String, Object> payload,
+            Integer version) {
         EntryRecord current = store.findEntry(id).orElseThrow(ContentException::notFound);
         if (current.deleted() || current.publicationState() == PublicationState.ARCHIVED) {
             throw ContentException.invalidTransition();
@@ -170,8 +230,7 @@
         if (payload != null) {
             nextPayload.putAll(payload);
         }
-        validatePayload(type, nextPayload, false);
-        Instant now = Instant.now();
+        List<FieldError> errors = validator.validate(store.fieldsOf(type.id()), nextPayload, false);
         EntryRecord updated = new EntryRecord(
                 current.id(),
                 current.contentTypeId(),
@@ -187,14 +246,17 @@
                 current.createdBy(),
                 principal == null ? current.updatedBy() : principal.id(),
                 current.createdAt(),
-                now)
+                Instant.now())
                 .withPublishRequest(current.publishRequestedAt(), current.publishRequestedBy());
-        return transactions.inTransaction(() -> {
-            store.updateEntry(updated);
-            store.replaceRefs(updated.id(), extractRefs(updated, type));
-            mediaService.replaceAttachments(updated.id(), extractMediaAttachments(updated, type));
-            return updated;
-        });
+        return new PreparedPatch(updated, type, errors);
+    }
+
+    private EntryRecord applyPatch(PreparedPatch prepared) {
+        EntryRecord updated = prepared.updated();
+        store.updateEntry(updated);
+        store.replaceRefs(updated.id(), extractRefs(updated, prepared.type()));
+        mediaService.replaceAttachments(updated.id(), extractMediaAttachments(updated, prepared.type()));
+        return updated;
     }
 
     public EntryRecord publish(Principal principal, Surface surface, UUID id) {
```

`src/main/java/com/fallrising/cms/content/web/EntryController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/EntryController.java
+++ b/src/main/java/com/fallrising/cms/content/web/EntryController.java
@@ -31,6 +31,8 @@
 
     public record EntryWriteBody(String slug, Map<String, Object> payload, Integer version) {}
 
+    public record BatchPatchBody(List<EntryService.BatchItem> items) {}
+
     private final EntryService entries;
     private final ContentStore store;
 
@@ -81,6 +83,13 @@
         return workJson(entry);
     }
 
+    @PostMapping("/entries:batch-patch")
+    public Map<String, Object> batchPatch(@RequestBody BatchPatchBody body, HttpServletRequest request) {
+        IdentityRequest identity = rejectFront(request);
+        List<EntryRecord> updated = entries.batchPatch(identity.principal(), identity.surface(), body == null ? null : body.items());
+        return Map.of("items", updated.stream().map(this::workJson).toList());
+    }
+
     @PatchMapping("/entries/{id}")
     public Map<String, Object> patch(
             @PathVariable UUID id, @RequestBody EntryWriteBody body, HttpServletRequest request) {
```

`src/main/java/com/fallrising/cms/content/ContentException.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/ContentException.java
+++ b/src/main/java/com/fallrising/cms/content/ContentException.java
@@ -1,6 +1,7 @@
 package com.fallrising.cms.content;
 
 import com.fallrising.cms.api.error.CmsApiException;
+import com.fallrising.cms.api.error.CmsApiException;
 import com.fallrising.cms.api.error.ErrorCode;
 import com.fallrising.cms.api.error.FieldError;
 import com.fallrising.cms.content.validation.PayloadValidator;
@@ -17,6 +18,15 @@
         super(code, message, null, null, null, fields);
     }
 
+    private ContentException(CmsApiException source, String message) {
+        super(source.code(), message, source.action(), source.contentType(), source.surface(), source.fields());
+    }
+
+    /** The error of one batch item (G-09): same code and details, message prefixed with "items[i]: ". */
+    public static ContentException inBatchItem(int index, CmsApiException source) {
+        return new ContentException(source, "items[" + index + "]: " + source.getMessage());
+    }
+
     public static ContentException notFound() {
         return new ContentException(ErrorCode.ENTRY_NOT_FOUND, "Entry not found");
     }
```

`src/main/resources/openapi/openapi.yaml`：

```diff
--- a/src/main/resources/openapi/openapi.yaml
+++ b/src/main/resources/openapi/openapi.yaml
@@ -817,6 +817,43 @@
         "409": { $ref: "#/components/responses/Error409" }
         "422": { $ref: "#/components/responses/Error422" }
         "500": { $ref: "#/components/responses/Error500" }
+  /api/v1/entries:batch-patch:
+    post:
+      operationId: batchPatchEntries
+      tags: [Content]
+      description: |
+        Patches 1 to 100 entries atomically (G-09). Each item gets the checks of patchEntry, in item order.
+        The first failing check that is not a field error stops the batch with that error; its message starts
+        with `items[<i>]: `. Otherwise all field errors of all items are returned together as one 422 with
+        paths `items[<i>].payload.<fieldKey>`. Nothing is written unless every item passes; then all items
+        are written in one transaction. `slug` cannot be changed here. No audit event (as patchEntry).
+        Errors:
+        - 400 VALIDATION_FAILED: `items` empty or longer than 100; an item without `id`; an id repeated.
+        - 403 SURFACE_FORBIDDEN, FORBIDDEN; 404 ENTRY_NOT_FOUND; 409 INVALID_STATE_TRANSITION, VERSION_CONFLICT;
+          428 VERSION_REQUIRED: as patchEntry, for the first failing item.
+        - 422 with `error.fields`: as patchEntry, for all items.
+      parameters:
+        - $ref: "#/components/parameters/CsrfHeader"
+      requestBody:
+        required: true
+        content:
+          application/json:
+            schema: { $ref: "#/components/schemas/BatchPatchRequest" }
+      responses:
+        "200":
+          description: Updated entries in item order
+          content:
+            application/json:
+              schema: { $ref: "#/components/schemas/WorkEntryList" }
+        "400": { $ref: "#/components/responses/Error400" }
+        "401": { $ref: "#/components/responses/Error401" }
+        "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
+        "409": { $ref: "#/components/responses/Error409" }
+        "415": { $ref: "#/components/responses/Error415" }
+        "422": { $ref: "#/components/responses/Error422" }
+        "428": { $ref: "#/components/responses/Error428" }
+        "500": { $ref: "#/components/responses/Error500" }
   /api/v1/entries/{id}/publish-request:
     post:
       operationId: requestPublish
@@ -2142,6 +2179,32 @@
           format: uuid
           nullable: true
           description: Principal who made the open publish request.
+    BatchPatchRequest:
+      type: object
+      required: [items]
+      properties:
+        items:
+          type: array
+          minItems: 1
+          maxItems: 100
+          items:
+            type: object
+            required: [id, version]
+            properties:
+              id: { type: string, format: uuid }
+              version: { type: integer, format: int32 }
+              payload:
+                allOf:
+                  - $ref: "#/components/schemas/EntryPayload"
+                nullable: true
+    WorkEntryList:
+      type: object
+      additionalProperties: false
+      required: [items]
+      properties:
+        items:
+          type: array
+          items: { $ref: "#/components/schemas/WorkEntry" }
     WorkEntryPage:
       type: object
       additionalProperties: false
```

### 5.8 `include=refs`（T16）

`EntryService.refSummaries(principal, surface, entries, fields)`：對同一類型的 entries，取啟用中、型別 `ref` 的欄位；收集值為小寫標準 UUID 的目標 id；一次 `findEntries` 讀目標、一次 `listTypes` 讀類型（沒有目標時不讀）；每個欄位的摘要依 §4.1 的 `RefSummary` 三種形狀。「可讀」用 `authorization.allow(principal, read_draft, 目標類型, 目標工作副本, surface)`，所以 predicate 會以目標的資料判斷。工作列表多 2 次 store 讀取（與筆數無關）；`GET /entries/{id}` 多 `findTypeByKey`、`fieldsOf`、`findEntries`、`listTypes`。

02 §6 寫的安全測試是「operator-album 展開 visit 的 ref，看不到寵物名」，但 `seed-operator-album` 沒有 `visit` 的讀取權，無法觸發；本檔改用「只有 `photo` editor 權限的 principal 展開照片的 `album`」（§7.6），驗證的是同一條規則。本 PR 在 02 §6 補註。

`src/main/java/com/fallrising/cms/content/service/EntryService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/service/EntryService.java
+++ b/src/main/java/com/fallrising/cms/content/service/EntryService.java
@@ -33,6 +33,7 @@
 
 import java.time.Instant;
 import java.util.ArrayList;
+import java.util.HashMap;
 import java.util.HashSet;
 import java.util.LinkedHashMap;
 import java.util.List;
@@ -519,6 +520,70 @@
                 .toList());
     }
 
+    /**
+     * Summaries of the entries that ref fields point to (G-10), for entries of one type whose fields are given.
+     * Result: entry id → (field key → summary), with a key only for enabled "ref" fields holding a UUID. Summary:
+     * { id, contentType, title, publicationState } when the caller may read_draft the target (predicates evaluated on
+     * the target's working copy); { id, restricted: true } otherwise; { id, missing: true } when the target does not
+     * exist or is soft-deleted. Targets are read with one findEntries call and types with one listTypes call.
+     */
+    public Map<UUID, Map<String, Object>> refSummaries(Principal principal, Surface surface, List<EntryRecord> entries,
+            List<FieldRecord> fields) {
+        List<FieldRecord> refFields = fields.stream().filter(f -> f.enabled() && "ref".equals(f.fieldType())).toList();
+        Map<UUID, Map<String, UUID>> wanted = new LinkedHashMap<>();
+        Set<UUID> ids = new HashSet<>();
+        for (EntryRecord entry : entries) {
+            Map<String, UUID> byField = new LinkedHashMap<>();
+            for (FieldRecord field : refFields) {
+                Object raw = entry.payload() == null ? null : entry.payload().get(field.fieldKey());
+                UUID target = raw instanceof String text ? canonicalUuid(text) : null;
+                if (target != null) {
+                    byField.put(field.fieldKey(), target);
+                    ids.add(target);
+                }
+            }
+            wanted.put(entry.id(), byField);
+        }
+        Map<UUID, EntryRecord> targets = new HashMap<>();
+        store.findEntries(ids).forEach(t -> targets.put(t.id(), t));
+        Map<UUID, ContentTypeRecord> types = new HashMap<>();
+        if (!targets.isEmpty()) store.listTypes().forEach(t -> types.put(t.id(), t));
+        Map<UUID, Map<String, Object>> result = new LinkedHashMap<>();
+        wanted.forEach((entryId, byField) -> {
+            Map<String, Object> summaries = new LinkedHashMap<>();
+            byField.forEach((key, targetId) -> summaries.put(key, summary(principal, surface, targetId, targets.get(targetId), types)));
+            result.put(entryId, summaries);
+        });
+        return result;
+    }
+
+    private Map<String, Object> summary(Principal principal, Surface surface, UUID id, EntryRecord target,
+            Map<UUID, ContentTypeRecord> types) {
+        Map<String, Object> json = new LinkedHashMap<>();
+        json.put("id", id.toString());
+        if (target == null || target.deleted()) {
+            json.put("missing", true);
+        } else if (!authorization.allow(principal, CmsAction.READ_DRAFT, target.contentTypeKey(), target.payload(), surface).allowed()) {
+            json.put("restricted", true);
+        } else {
+            ContentTypeRecord type = types.get(target.contentTypeId());
+            Object title = type == null || target.payload() == null ? null : target.payload().get(type.titleField());
+            json.put("contentType", target.contentTypeKey());
+            json.put("title", title == null ? null : String.valueOf(title));
+            json.put("publicationState", target.publicationState().wire());
+        }
+        return json;
+    }
+
+    private static UUID canonicalUuid(String text) {
+        try {
+            UUID id = UUID.fromString(text);
+            return id.toString().equals(text) ? id : null;
+        } catch (IllegalArgumentException e) {
+            return null;
+        }
+    }
+
     private boolean publishedRefsPublic(EntryRecord entry, ContentTypeRecord type) {
         for (String refField : type.publicRequiresPublishedRefs()) {
             Object raw = entry.publishedPayload() == null ? null : entry.publishedPayload().get(refField);
```

`src/main/java/com/fallrising/cms/content/web/EntryController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/EntryController.java
+++ b/src/main/java/com/fallrising/cms/content/web/EntryController.java
@@ -1,7 +1,9 @@
 package com.fallrising.cms.content.web;
 
+import com.fallrising.cms.content.ContentException;
 import com.fallrising.cms.content.domain.ContentTypeRecord;
 import com.fallrising.cms.content.domain.EntryRecord;
+import com.fallrising.cms.content.domain.FieldRecord;
 import com.fallrising.cms.content.service.EntryService;
 import com.fallrising.cms.content.store.ContentStore;
 import com.fallrising.cms.identity.IdentityException;
@@ -59,8 +61,11 @@
         IdentityRequest identity = work(request, CmsAction.READ_DRAFT, typeKey);
         EntryService.ListResult result = entries.listWork(
                 identity.principal(), identity.surface(), typeKey, request.getParameterMap());
+        Map<UUID, Map<String, Object>> refs = includeRefs(request)
+                ? entries.refSummaries(identity.principal(), identity.surface(), result.page().items(), result.fields())
+                : null;
         List<Map<String, Object>> items = result.page().items().stream()
-                .map(entry -> ContentProjection.work(entry, result.type()))
+                .map(entry -> withRefs(ContentProjection.work(entry, result.type()), refs, entry))
                 .toList();
         return ContentProjection.page(items, result);
     }
@@ -80,7 +85,13 @@
     public Map<String, Object> get(@PathVariable UUID id, HttpServletRequest request) {
         IdentityRequest identity = rejectFront(request);
         EntryRecord entry = entries.getWork(identity.principal(), identity.surface(), id);
-        return workJson(entry);
+        if (!includeRefs(request)) {
+            return workJson(entry);
+        }
+        ContentTypeRecord type = store.findTypeByKey(entry.contentTypeKey()).orElse(null);
+        List<FieldRecord> fields = type == null ? List.of() : store.fieldsOf(type.id());
+        return withRefs(ContentProjection.work(entry, type),
+                entries.refSummaries(identity.principal(), identity.surface(), List.of(entry), fields), entry);
     }
 
     @PostMapping("/entries:batch-patch")
@@ -183,6 +194,26 @@
         return ContentProjection.work(entry, store.findTypeByKey(entry.contentTypeKey()).orElse(null));
     }
 
+    /** include is a comma-separated list; the only value is "refs" (G-10). Other values are 400. */
+    private static boolean includeRefs(HttpServletRequest request) {
+        String[] values = request.getParameterValues("include");
+        if (values == null) return false;
+        if (values.length > 1) throw ContentException.invalidParameter("include must not repeat");
+        boolean refs = false;
+        for (String part : values[0].split(",")) {
+            String value = part.trim();
+            if (value.isEmpty()) continue;
+            if (!"refs".equals(value)) throw ContentException.invalidParameter("include: unknown value " + value);
+            refs = true;
+        }
+        return refs;
+    }
+
+    private static Map<String, Object> withRefs(Map<String, Object> json, Map<UUID, Map<String, Object>> refs, EntryRecord entry) {
+        if (refs != null) json.put("refs", refs.getOrDefault(entry.id(), Map.of()));
+        return json;
+    }
+
     private static IdentityRequest rejectFront(HttpServletRequest request) {
         IdentityRequest identity = AuthController.current(request);
         if (identity.surface() == Surface.FRONT) {
```

`src/main/resources/openapi/openapi.yaml`：

```diff
--- a/src/main/resources/openapi/openapi.yaml
+++ b/src/main/resources/openapi/openapi.yaml
@@ -640,9 +640,10 @@
         datetime fields take `filter.<fieldKey>.from` (inclusive) and `filter.<fieldKey>.to` (exclusive).
         Relation filters: `ref.<fieldKey>=<entry uuid>`; may repeat, all must match.
         `publishRequested=true` keeps only entries with an open publish request (G-03).
+        `include=refs` adds `refs` to every item (G-10): two more store reads per page, not per item.
         Other query parameters are ignored.
         Errors:
-        - 400 VALIDATION_FAILED: `publishRequested` other than true or false; `page` or `size` out of range; unknown `state` value; `sort` names a key
+        - 400 VALIDATION_FAILED: `include` other than `refs`; `publishRequested` other than true or false; `page` or `size` out of range; unknown `state` value; `sort` names a key
           that is not sortable; a filter names a field that is not filterable or has a value of the wrong
           kind; a `ref.<fieldKey>` value is not a UUID; a parameter other than `ref.<fieldKey>` is repeated.
         - 403 SURFACE_FORBIDDEN: called from the Front surface.
@@ -659,6 +660,7 @@
           name: publishRequested
           required: false
           schema: { type: boolean }
+        - $ref: "#/components/parameters/IncludeRefs"
       responses:
         "200":
           description: Work entries including drafts
@@ -712,12 +714,15 @@
       operationId: getWorkEntry
       tags: [Content]
       description: |
+        `include=refs` adds `refs` (G-10).
         Errors:
+        - 400 VALIDATION_FAILED: `include` other than `refs`.
         - 403 SURFACE_FORBIDDEN: called from the Front surface.
         - 403 FORBIDDEN: caller may not read this entry.
         - 404 ENTRY_NOT_FOUND: entry missing or soft-deleted.
       parameters:
         - $ref: "#/components/parameters/Id"
+        - $ref: "#/components/parameters/IncludeRefs"
       responses:
         "200":
           description: Work copy
@@ -1533,6 +1538,12 @@
         type's titleField), or an enabled field with index rows whose type is not ref (in public lists,
         visibility `public` only).
       schema: { type: string }
+    IncludeRefs:
+      in: query
+      name: include
+      required: false
+      description: Comma-separated; the only value is `refs`.
+      schema: { type: string }
     CsrfHeader:
       in: header
       name: X-CSRF-Token
@@ -2179,6 +2190,10 @@
           format: uuid
           nullable: true
           description: Principal who made the open publish request.
+        refs:
+          type: object
+          description: Present only with `include=refs` (G-10); one key per ref field that holds an entry id.
+          additionalProperties: { $ref: "#/components/schemas/RefSummary" }
     BatchPatchRequest:
       type: object
       required: [items]
@@ -2205,6 +2220,20 @@
         items:
           type: array
           items: { $ref: "#/components/schemas/WorkEntry" }
+    RefSummary:
+      type: object
+      additionalProperties: false
+      required: [id]
+      description: |
+        Target of a ref field. Readable (caller has read_draft on the target): id, contentType, title,
+        publicationState. Not readable: id and restricted=true. Missing or soft-deleted: id and missing=true.
+      properties:
+        id: { type: string, format: uuid }
+        contentType: { type: string }
+        title: { type: string, nullable: true }
+        publicationState: { $ref: "#/components/schemas/PublicationState" }
+        restricted: { type: boolean }
+        missing: { type: boolean }
     WorkEntryPage:
       type: object
       additionalProperties: false
```

T16 之後：`cmp docs/v2/contracts/BW2.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。

---

## 6. 任務卡

大小：S ≤ 150 行、M ≤ 400 行（只算手寫或手改的行；整檔複製算 1 行）。所有指令在 `apps/cms-scaffold` 執行。預期紅燈是預演實測的結果；某個預期紅燈的測試若已經綠了，照樣繼續。

### BW2-T01 【測試先行】store 契約：請求發布與批次讀取

- **目標**：把 §5.1 寫成契約案例。
- **輸入**：BW1c `VERIFIED`。
- **步驟**：套用 §7.1 的 `ContentStoreContract.java` diff。
- **完成條件**：預期紅燈：`src/test` 編譯失敗（`withPublishRequest`、`findEntries`、`EntryQuery` 的參數數量）。
- **驗證**：`./gradlew :services:cms-api:compileTestJava`（預期失敗）
- **對應 ID**：G-03、G-10
- **大小**：S

### BW2-T02 V8、請求發布欄位與 `findEntries`

- **目標**：§4.5、§5.1。
- **輸入**：T01。
- **步驟**：
  1. 建立 §4.5 的 V8。
  2. 以 §5.1 全文取代 `EntryRecord.java`。
  3. 套用 §5.1 的六段 diff（`EntryQuery`、三個 store、`EntryService`、`ListQueryPerformanceTests`）。
- **完成條件**：`./gradlew :services:cms-api:test` 197 個全綠；`integrationTest` 70 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：G-03、G-10
- **大小**：S

### BW2-T03 【測試先行】store 契約：審計查詢

- **目標**：把 §4.4 的審計查詢語意寫成契約案例。
- **輸入**：T02。
- **步驟**：套用 §7.2 的 `IdentityStoreContract.java` diff。
- **完成條件**：預期紅燈：`src/test` 編譯失敗（`AuditQuery`、`AuditPage`、`queryAudits`、`findAudit` 不存在）。
- **驗證**：`./gradlew :services:cms-api:compileTestJava`（預期失敗）
- **對應 ID**：B-07
- **大小**：S

### BW2-T04 審計查詢的 store

- **目標**：§5.2。
- **輸入**：T03。
- **步驟**：
  1. 建立 §5.2 的 `AuditQuery.java`、`AuditPage.java`（套件 `com.fallrising.cms.identity.domain`）。
  2. 套用 §5.2 的三段 diff。
- **完成條件**：`test` 199 個全綠；`integrationTest` 72 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：B-07
- **大小**：S

### BW2-T05 【測試先行】審計寫入

- **目標**：把 §4.3 寫成 API 測試。
- **輸入**：T04。
- **步驟**：建立 §7.3 的 `AuditTrailApiTests.java`；套用 §7.3 的 `WaveEAcceptanceTests.java` diff。
- **完成條件**：預期紅燈正好 4 個：`AuditTrailApiTests` 3 個全部與 `WaveEAcceptanceTests.tCt06SoftDeleteHidesThenAdminPurgeAudits`。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.AuditTrailApiTests' --tests 'com.fallrising.cms.WaveEAcceptanceTests'`
- **對應 ID**：B-07
- **大小**：S

### BW2-T06 交易與審計寫入

- **目標**：§5.3。
- **輸入**：T05。
- **步驟**：
  1. 建立 §5.3 的 `TransactionRunner.java`（套件 `com.fallrising.cms.platform`）與 `AuditLog.java`。
  2. 套用 §5.3 的七段 diff。
- **完成條件**：`test` 202 個全綠；`integrationTest` 72 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：B-07、BD-09
- **大小**：M

### BW2-T07 【測試先行】審計查詢 API

- **目標**：把 §4.4 的端點寫成 API 測試。
- **輸入**：T06。
- **步驟**：建立 §7.4 的 `ApiFixture.java`（`src/test/java/com/fallrising/cms/support/`）與 `AuditQueryApiTests.java`。
- **完成條件**：預期紅燈正好 3 個：`AuditQueryApiTests` 全部。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.AuditQueryApiTests'`
- **對應 ID**：B-07
- **大小**：S

### BW2-T08 審計查詢端點

- **目標**：§5.4。
- **輸入**：T07。
- **步驟**：
  1. 建立 §5.4 的 `AuditSearch.java`、`AuditController.java`。
  2. 套用 §5.4 的四段 diff（`AdminContentController`、`ErrorCode`、`IdentityException`、`openapi.yaml`）。
- **完成條件**：`test` 205 個全綠；`integrationTest` 72 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：B-07
- **大小**：M

### BW2-T09 【測試先行】請求發布

- **目標**：G-03 的 API 測試。
- **輸入**：T08。
- **步驟**：建立 §7.5 的 `PublishRequestApiTests.java`。
- **完成條件**：預期紅燈正好 3 個：`PublishRequestApiTests` 全部。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.PublishRequestApiTests'`
- **對應 ID**：G-03
- **大小**：S

### BW2-T10 請求發布

- **目標**：§5.5。
- **輸入**：T09。
- **步驟**：套用 §5.5 的七段 diff。
- **完成條件**：`test` 208 個全綠；`integrationTest` 72 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：G-03
- **大小**：S

### BW2-T11 【測試先行】可指派使用者

- **目標**：G-04 的 API 測試。
- **輸入**：T10。
- **步驟**：建立 §7.5 的 `AssignablePrincipalsApiTests.java`。
- **完成條件**：預期紅燈正好 2 個：本類別全部。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.AssignablePrincipalsApiTests'`
- **對應 ID**：G-04
- **大小**：S

### BW2-T12 可指派使用者

- **目標**：§5.6。
- **輸入**：T11。
- **步驟**：套用 §5.6 的三段 diff。
- **完成條件**：`test` 210 個全綠；`integrationTest` 72 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：G-04
- **大小**：S

### BW2-T13 【測試先行】批次更新

- **目標**：G-09 的 API 測試。
- **輸入**：T12。
- **步驟**：建立 §7.6 的 `BatchPatchApiTests.java`。
- **完成條件**：預期紅燈正好 4 個：本類別全部。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.BatchPatchApiTests'`
- **對應 ID**：G-09
- **大小**：S

### BW2-T14 批次更新

- **目標**：§5.7。
- **輸入**：T13。
- **步驟**：套用 §5.7 的四段 diff。
- **完成條件**：`test` 214 個全綠；`integrationTest` 72 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：G-09、BD-11
- **大小**：M

### BW2-T15 【測試先行】`include=refs`

- **目標**：G-10 的 API 測試。
- **輸入**：T14。
- **步驟**：建立 §7.6 的 `IncludeRefsApiTests.java`。
- **完成條件**：預期紅燈正好 3 個：本類別全部。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.IncludeRefsApiTests'`
- **對應 ID**：G-10
- **大小**：S

### BW2-T16 `include=refs`

- **目標**：§5.8。
- **輸入**：T15。
- **步驟**：
  1. 套用 §5.8 的三段 diff。
  2. `cmp docs/v2/contracts/BW2.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`，沒有輸出。
- **完成條件**：`test` 217 個全綠；`integrationTest` 72 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：G-10
- **大小**：S

### BW2-T17 完整閘門、狀態與 PR

- **目標**：交付。
- **輸入**：T16。
- **步驟**：
  1. 執行 §9 的完整閘門。
  2. `docs/v2/README.md` 路線圖中 BW2 的狀態從 `DOC_READY` 改成 `VERIFIED`。
  3. 逐項勾選 §9，貼進 PR 說明。PR 標題：`feat(cms-scaffold): BW2 審計、請求發布、批次更新與關聯展開`；說明列出 B-07、G-03、G-04、G-09、G-10 與 §4.2 的行為變更。
- **完成條件**：§9 全部打勾；CI 的 `java`、`java-integration` 全綠；`web` 全綠，或只有 §2.1 所說的失敗並已在 PR 說明。
- **驗證**：§9 的指令。
- **對應 ID**：全部
- **大小**：S

---

## 7. 測試規格

層級：`ContentStoreContract`、`IdentityStoreContract` 是 store 契約（`test` 與 `integrationTest` 各跑一次）；其餘新測試是 `@SpringBootTest` + MockMvc，回應經過 BW0 的全域 OpenAPI 驗證。帳號密碼一律用 `@Value("${cms.identity.seed-password}")`；`ApiFixture.principalWithRole` 建立的帳號使用每次執行隨機產生的密碼，不是種子密碼。每個 API 測試建立自己的資料，以隨機 token 區隔。

### 7.1 `ContentStoreContract`（T01）

| 案例 | 固定的行為 |
| --- | --- |
| `G03_publishRequestRoundTripsAndClears` | 兩個新欄寫入後讀回相同；清除後讀回 null |
| `G03_queryCanKeepOnlyOpenPublishRequests` | `publishRequested=true` 只留有請求且未刪除的；`false` 不限制 |
| `G10_findEntriesReadsManyIdsInOneCall` | 含軟刪除、略過不存在與重複、依 id 文字排序；空集合回空 |

`src/test/java/com/fallrising/cms/contract/ContentStoreContract.java`：

```diff
--- a/src/test/java/com/fallrising/cms/contract/ContentStoreContract.java
+++ b/src/test/java/com/fallrising/cms/contract/ContentStoreContract.java
@@ -616,6 +616,45 @@
         assertThat(workSlugs(query(pet).access(mine))).isEmpty();
     }
 
+    // ---- BW2: publish requests (G-03) and batch reads (G-10) ----
+
+    @Test
+    void G03_publishRequestRoundTripsAndClears() {
+        ContentTypeRecord issue = insertType("issue", field("title", "string"));
+        UUID actor = UUID.randomUUID();
+        EntryRecord requested = entry(issue, "i", PublicationState.DRAFT, Map.of("title", "I"), t(1)).withPublishRequest(t(2), actor);
+        store.insertEntry(requested);
+        assertThat(store.findEntry(requested.id())).contains(requested);
+        EntryRecord cleared = requested.withPublishRequest(null, null);
+        store.updateEntry(cleared);
+        assertThat(store.findEntry(requested.id())).contains(cleared);
+    }
+
+    @Test
+    void G03_queryCanKeepOnlyOpenPublishRequests() {
+        ContentTypeRecord issue = insertType("issue", field("title", "string"));
+        store.insertEntry(entry(issue, "asked", PublicationState.DRAFT, Map.of("title", "A"), t(1)).withPublishRequest(t(5), UUID.randomUUID()));
+        store.insertEntry(entry(issue, "plain", PublicationState.DRAFT, Map.of("title", "P"), t(2)));
+        store.insertEntry(deleted(entry(issue, "gone", PublicationState.DRAFT, Map.of("title", "G"), t(3))
+                .withPublishRequest(t(5), UUID.randomUUID()), t(4)));
+        assertThat(workSlugs(query(issue).publishRequested(true))).containsExactly("asked");
+        assertThat(workSlugs(query(issue))).containsExactly("plain", "asked");
+    }
+
+    @Test
+    void G10_findEntriesReadsManyIdsInOneCall() {
+        ContentTypeRecord album = insertType("album");
+        ContentTypeRecord page = insertType("page");
+        EntryRecord a = entry(album, "a", PublicationState.DRAFT, Map.of(), t(1));
+        EntryRecord p = entry(page, "p", PublicationState.PUBLISHED, Map.of("title", "P"), t(2));
+        EntryRecord gone = deleted(entry(album, "gone", PublicationState.DRAFT, Map.of(), t(3)), t(4));
+        List.of(a, p, gone).forEach(store::insertEntry);
+        List<EntryRecord> byId = java.util.stream.Stream.of(a, p, gone)
+                .sorted(java.util.Comparator.comparing(e -> e.id().toString())).toList();
+        assertThat(store.findEntries(List.of(gone.id(), a.id(), UUID.randomUUID(), p.id(), a.id()))).containsExactlyElementsOf(byId);
+        assertThat(store.findEntries(List.of())).isEmpty();
+    }
+
     // ---- fixtures ----
 
     protected static Instant t(int seconds) {
@@ -743,6 +782,7 @@
         private SortKey sort = SortKey.system("updatedAt", true);
         private int page = 1;
         private int size = 100;
+        private boolean publishRequested;
 
         QueryBuilder(ContentTypeRecord type, IndexScope scope) {
             this.type = type;
@@ -761,10 +801,11 @@
         QueryBuilder sort(SortKey v) { sort = v; return this; }
         QueryBuilder page(int v) { page = v; return this; }
         QueryBuilder size(int v) { size = v; return this; }
+        QueryBuilder publishRequested(boolean v) { publishRequested = v; return this; }
 
         EntryQuery build() {
             return new EntryQuery(type.id(), scope, states, titleField, q, filters, refs, access, visibilityField,
-                    requiredRefs, sort, page, size);
+                    requiredRefs, sort, page, size, publishRequested);
         }
     }
 }
```

### 7.2 `IdentityStoreContract`（T03）

| 案例 | 固定的行為 |
| --- | --- |
| `B07_queryAuditsFiltersPagesAndOrders` | 5 筆事件：排序（同一時間依 id）、前綴與完整的 `action`、actor＋outcome、category、target、`[from, to)`、第 2 頁 |
| `B07_findAuditReturnsOneEventWithDetail` | 讀回相同（`detailJson` 以 JSON 內容比較，因為 PostgreSQL 的 JSONB 會重排空白）；不存在回空 |

`src/test/java/com/fallrising/cms/contract/IdentityStoreContract.java`：

```diff
--- a/src/test/java/com/fallrising/cms/contract/IdentityStoreContract.java
+++ b/src/test/java/com/fallrising/cms/contract/IdentityStoreContract.java
@@ -2,6 +2,8 @@
 
 import com.fallrising.cms.identity.IdentityException;
 import com.fallrising.cms.identity.domain.AuditEvent;
+import com.fallrising.cms.identity.domain.AuditPage;
+import com.fallrising.cms.identity.domain.AuditQuery;
 import com.fallrising.cms.identity.domain.Permission;
 import com.fallrising.cms.identity.domain.Principal;
 import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
@@ -187,6 +189,50 @@
     }
 
     @Test
+    void B07_queryAuditsFiltersPagesAndOrders() {
+        Principal anna = principal("anna");
+        store.insertPrincipal(anna);
+        UUID entry = UUID.randomUUID();
+        AuditEvent create = new AuditEvent(UUID.randomUUID(), T0.plusSeconds(1), anna.id(), "CONTENT", "entry.create", "entry", entry, "back", "ok", null, null);
+        AuditEvent publish = new AuditEvent(UUID.randomUUID(), T0.plusSeconds(2), anna.id(), "CONTENT", "entry.publish", "entry", entry, "back", "ok", null, null);
+        AuditEvent denied = new AuditEvent(UUID.randomUUID(), T0.plusSeconds(3), anna.id(), "GOVERNANCE", "manage_types", null, null, "back", "denied", null, null);
+        AuditEvent login = new AuditEvent(UUID.randomUUID(), T0.plusSeconds(3), null, "AUTH", "LOGIN_SUCCESS", "principal", anna.id(), "admin", "ok", null, null);
+        AuditEvent entryx = new AuditEvent(UUID.randomUUID(), T0.plusSeconds(4), null, "CONTENT", "entryx.other", "entry", entry, "back", "ok", null, null);
+        List.of(create, publish, denied, login, entryx).forEach(store::insertAudit);
+
+        AuditPage all = store.queryAudits(auditQuery().build());
+        assertThat(all.total()).isEqualTo(5);
+        List<UUID> tied = java.util.stream.Stream.of(denied, login).map(AuditEvent::id)
+                .sorted(java.util.Comparator.comparing(UUID::toString)).toList();
+        assertThat(all.items()).extracting(AuditEvent::id)
+                .containsExactly(entryx.id(), tied.get(0), tied.get(1), publish.id(), create.id());
+        assertThat(store.queryAudits(auditQuery().action("entry.", true).build()).items()).extracting(AuditEvent::id)
+                .containsExactly(publish.id(), create.id());
+        assertThat(store.queryAudits(auditQuery().action("entry.create", false).build()).items()).containsExactly(create);
+        assertThat(store.queryAudits(auditQuery().action("entry", false).build()).items()).isEmpty();
+        assertThat(store.queryAudits(auditQuery().actorId(anna.id()).outcome("denied").build()).items()).containsExactly(denied);
+        assertThat(store.queryAudits(auditQuery().category("AUTH").build()).items()).containsExactly(login);
+        assertThat(store.queryAudits(auditQuery().targetType("entry").targetId(entry).build()).total()).isEqualTo(3);
+        assertThat(store.queryAudits(auditQuery().from(T0.plusSeconds(2)).to(T0.plusSeconds(4)).build()).items())
+                .extracting(AuditEvent::id).containsExactly(tied.get(0), tied.get(1), publish.id());
+        AuditPage second = store.queryAudits(auditQuery().page(2).size(2).build());
+        assertThat(second.total()).isEqualTo(5);
+        assertThat(second.items()).extracting(AuditEvent::id).containsExactly(tied.get(1), publish.id());
+    }
+
+    @Test
+    void B07_findAuditReturnsOneEventWithDetail() throws Exception {
+        AuditEvent withDetail = new AuditEvent(UUID.randomUUID(), T0, null, "CONTENT", "entry.publish_request", "entry",
+                UUID.randomUUID(), "back", "ok", "10.0.0.1", "{\"requested\":true}");
+        store.insertAudit(withDetail);
+        AuditEvent found = store.findAudit(withDetail.id()).orElseThrow();
+        assertThat(found).usingRecursiveComparison().ignoringFields("detailJson").isEqualTo(withDetail);
+        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
+        assertThat(mapper.readTree(found.detailJson())).isEqualTo(mapper.readTree(withDetail.detailJson()));
+        assertThat(store.findAudit(UUID.randomUUID())).isEmpty();
+    }
+
+    @Test
     void B08_lastAdminGuard() {
         Role admin = role("admin");
         store.insertRole(admin);
@@ -226,6 +272,40 @@
         return new SessionRecord(UUID.randomUUID(), principalId, hash, T0, expiresAt, T0, null, "back", null, null);
     }
 
+    protected static AuditQueryBuilder auditQuery() {
+        return new AuditQueryBuilder();
+    }
+
+    /** All conditions null, page 1 of 100. */
+    protected static final class AuditQueryBuilder {
+        private Instant from;
+        private Instant to;
+        private UUID actorId;
+        private String action;
+        private boolean actionPrefix;
+        private String category;
+        private String targetType;
+        private UUID targetId;
+        private String outcome;
+        private int page = 1;
+        private int size = 100;
+
+        AuditQueryBuilder from(Instant v) { from = v; return this; }
+        AuditQueryBuilder to(Instant v) { to = v; return this; }
+        AuditQueryBuilder actorId(UUID v) { actorId = v; return this; }
+        AuditQueryBuilder action(String v, boolean prefix) { action = v; actionPrefix = prefix; return this; }
+        AuditQueryBuilder category(String v) { category = v; return this; }
+        AuditQueryBuilder targetType(String v) { targetType = v; return this; }
+        AuditQueryBuilder targetId(UUID v) { targetId = v; return this; }
+        AuditQueryBuilder outcome(String v) { outcome = v; return this; }
+        AuditQueryBuilder page(int v) { page = v; return this; }
+        AuditQueryBuilder size(int v) { size = v; return this; }
+
+        AuditQuery build() {
+            return new AuditQuery(from, to, actorId, action, actionPrefix, category, targetType, targetId, outcome, page, size);
+        }
+    }
+
     protected static AuditEvent audit(String action, UUID target, Instant at) {
         return new AuditEvent(UUID.randomUUID(), at, null, "AUTH", action, "principal", target, "admin", "ok", null, null);
     }
```

### 7.3 `AuditTrailApiTests`、`WaveEAcceptanceTests`（T05）

| 測試 | 步驟 | 斷言 |
| --- | --- | --- |
| `B07_entryLifecycleIsAudited` | operator 建立相簿，publish、unpublish、publish、archive、restore、revert 到 revision 1、軟刪除 | admin 以 `action`＋`targetId` 查：create 1、publish 2、unpublish 1、archive 1、restore 1、revert 1、soft_delete 1，全部 `ok` |
| `B07_schemaSettingsMediaAndRoleChangesAreAudited` | admin 建立類型、停用、啟用、發布 `front.primary`、以原本的內容重設 editor 的權限；operator 上傳並刪除一個媒體 | 前五個動作各多 1 筆；`media.delete` 對該媒體 1 筆 |
| `B07_deniedGovernanceIsAudited` | operator 在 Back 呼叫 `GET /admin/content-types` | `manage_types` 的 `denied` 多 1 筆 |
| `WaveEAcceptanceTests.tCt06SoftDeleteHidesThenAdminPurgeAudits`（改） | 既有測試 | 查詢的動作名改成 `entry.purge` |

`src/test/java/com/fallrising/cms/AuditTrailApiTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** B-07: every state change and governance action in 02 §4.6 writes an audit event (read back via GET /admin/audit). */
@SpringBootTest
@AutoConfigureMockMvc
class AuditTrailApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void B07_entryLifecycleIsAudited() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String id = json(mockMvc.perform(op.apply(post("/api/v1/content-types/album/entries"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("slug", token(), "payload", Map.of("title", "Audited")))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).get("id").asText();
        for (String step : List.of("publish", "unpublish", "publish", "archive", "restore")) {
            mockMvc.perform(op.apply(post("/api/v1/entries/{id}/" + step, id))).andExpect(status().isOk());
        }
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/revisions/1/revert", id))).andExpect(status().isOk());
        mockMvc.perform(op.apply(delete("/api/v1/entries/{id}", id))).andExpect(status().isNoContent());

        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        assertThat(countOk(admin, "entry.create", id)).isEqualTo(1);
        assertThat(countOk(admin, "entry.publish", id)).isEqualTo(2);
        assertThat(countOk(admin, "entry.unpublish", id)).isEqualTo(1);
        assertThat(countOk(admin, "entry.archive", id)).isEqualTo(1);
        assertThat(countOk(admin, "entry.restore", id)).isEqualTo(1);
        assertThat(countOk(admin, "entry.revert", id)).isEqualTo(1);
        assertThat(countOk(admin, "entry.soft_delete", id)).isEqualTo(1);
    }

    @Test
    void B07_schemaSettingsMediaAndRoleChangesAreAudited() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        List<String> actions = List.of("type.create", "type.disable", "type.enable", "navigation.publish", "role.permissions_update");
        Map<String, Long> before = new java.util.HashMap<>();
        for (String action : actions) before.put(action, countOk(admin, action, null));

        String key = "audit_" + UUID.randomUUID().toString().substring(0, 8);
        mockMvc.perform(admin.apply(post("/api/v1/admin/content-types"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("key", key, "fields", List.of(Map.of("key", "title"))))))
                .andExpect(status().isCreated());
        mockMvc.perform(admin.apply(post("/api/v1/admin/content-types/{key}/disable", key))).andExpect(status().isOk());
        mockMvc.perform(admin.apply(post("/api/v1/admin/content-types/{key}/enable", key))).andExpect(status().isOk());
        mockMvc.perform(admin.apply(post("/api/v1/admin/navigation/front.primary/publish"))).andExpect(status().isOk());
        JsonNode current = json(mockMvc.perform(admin.apply(get("/api/v1/roles/editor/permissions")))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("items");
        List<JsonNode> same = new ArrayList<>();
        current.forEach(p -> same.add(((ObjectNode) p.deepCopy()).without("id")));
        mockMvc.perform(admin.apply(put("/api/v1/roles/editor/permissions"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(same)))
                .andExpect(status().isNoContent());
        for (String action : actions) {
            assertThat(countOk(admin, action, null)).as(action).isEqualTo(before.get(action) + 1);
        }

        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        BufferedImage image = new BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(image, "png", png);
        String mediaId = json(mockMvc.perform(op.apply(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", "a.png", "image/png", png.toByteArray()))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).get("id").asText();
        mockMvc.perform(op.apply(delete("/api/v1/media/{id}", mediaId))).andExpect(status().is2xxSuccessful());
        admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        assertThat(countOk(admin, "media.delete", mediaId)).isEqualTo(1);
    }

    @Test
    void B07_deniedGovernanceIsAudited() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        long before = count(admin, "manage_types", null, "denied");
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/admin/content-types"))).andExpect(status().isForbidden());
        admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        assertThat(count(admin, "manage_types", null, "denied")).isEqualTo(before + 1);
    }

    private long countOk(TestSession admin, String action, String targetId) throws Exception {
        return count(admin, action, targetId, "ok");
    }

    private long count(TestSession admin, String action, String targetId, String outcome) throws Exception {
        var request = get("/api/v1/admin/audit").param("action", action);
        if (targetId != null) request.param("targetId", targetId);
        JsonNode items = json(mockMvc.perform(admin.apply(request)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("items");
        long n = 0;
        for (JsonNode item : items) {
            if (outcome.equals(item.get("outcome").asText())) n++;
        }
        return n;
    }

    private JsonNode json(String body) throws Exception {
        return mapper.readTree(body);
    }

    private static String token() {
        return "a" + UUID.randomUUID().toString().substring(0, 8);
    }
}
```

`src/test/java/com/fallrising/cms/WaveEAcceptanceTests.java`：

```diff
--- a/src/test/java/com/fallrising/cms/WaveEAcceptanceTests.java
+++ b/src/test/java/com/fallrising/cms/WaveEAcceptanceTests.java
@@ -139,13 +139,13 @@
                         .cookie(admin.sessionCookie(), admin.csrfCookie()))
                 .andExpect(status().isNoContent());
         mockMvc.perform(get("/api/v1/admin/audit")
-                        .param("action", "ENTRY_PURGED")
+                        .param("action", "entry.purge")
                         .param("targetId", id)
                         .header("Origin", ADMIN)
                         .cookie(admin.sessionCookie()))
                 .andExpect(status().isOk())
                 .andExpect(jsonPath("$.items.length()").value(greaterThanOrEqualTo(1)))
-                .andExpect(jsonPath("$.items[0].action").value("ENTRY_PURGED"));
+                .andExpect(jsonPath("$.items[0].action").value("entry.purge"));
         mockMvc.perform(get("/api/v1/admin/audit")
                         .header("Origin", BACK)
                         .cookie(op.sessionCookie()))
```

### 7.4 `AuditQueryApiTests`（T07）

| 測試 | 斷言 |
| --- | --- |
| `B07_searchFiltersByTargetActorActionAndPages` | 同一個 target 兩筆（publish 在前）；actor 物件；第 2 頁 1 筆；`entry.` 前綴 2 筆、`entry` 完整 0 筆；actor 過濾；不存在的 actor 與未來的 `from` 都是 0 |
| `B07_oneEventCarriesItsDetail` | `detail.revisionNo` 是 1；不存在的 id 404 `AUDIT_EVENT_NOT_FOUND` |
| `B07_invalidParametersAre400AndBackIsForbidden` | `size=0`、`from=yesterday`、`targetId=x`、`page=-1` 都 400；Back 403 `SURFACE_FORBIDDEN` |

`src/test/java/com/fallrising/cms/support/ApiFixture.java`：

```java
package com.fallrising.cms.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Small HTTP helpers shared by the BW2 API tests. */
public record ApiFixture(MockMvc mockMvc, ObjectMapper mapper) {

    public static String token(String prefix) {
        return prefix + UUID.randomUUID().toString().substring(0, 8);
    }

    public JsonNode json(ResultActions result) throws Exception {
        return mapper.readTree(result.andReturn().getResponse().getContentAsString());
    }

    /** Creates an entry (201) and returns its JSON. */
    public JsonNode create(TestSession session, String type, Map<String, Object> payload) throws Exception {
        return json(mockMvc.perform(session.apply(post("/api/v1/content-types/{type}/entries", type))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("slug", token("s"), "payload", payload))))
                .andExpect(status().isCreated()));
    }

    public ResultActions patchEntry(TestSession session, String id, int version, Map<String, Object> payload) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("version", version);
        body.put("payload", payload);
        return mockMvc.perform(session.apply(patch("/api/v1/entries/{id}", id))
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)));
    }

    public ResultActions action(TestSession session, String id, String action) throws Exception {
        return mockMvc.perform(session.apply(post("/api/v1/entries/{id}/" + action, id)));
    }

    public JsonNode work(TestSession session, String id) throws Exception {
        return json(mockMvc.perform(session.apply(get("/api/v1/entries/{id}", id))).andExpect(status().isOk()));
    }

    /**
     * Creates a principal with one role limited to contentTypes and logs it in on the given surface. The password is
     * random per test run and is not a seed password.
     */
    public TestSession principalWithRole(TestSession admin, String role, List<String> contentTypes, String origin) throws Exception {
        String username = token("u");
        String password = "Pw-" + UUID.randomUUID() + "-Aa1";
        JsonNode created = json(mockMvc.perform(admin.apply(post("/api/v1/principals"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("username", username, "displayName", username,
                                "temporaryPassword", password))))
                .andExpect(status().isCreated()));
        String id = created.get("id").asText();
        mockMvc.perform(admin.apply(put("/api/v1/principals/{id}/roles", id))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(List.of(Map.of("code", role, "contentTypeCodes", contentTypes)))))
                .andExpect(status().is2xxSuccessful());
        return TestSession.login(mockMvc, username, password, origin);
    }
}
```

`src/test/java/com/fallrising/cms/AuditQueryApiTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.hamcrest.Matchers.equalTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** B-07: GET /admin/audit search and GET /admin/audit/{id} (02 §4.6). */
@SpringBootTest
@AutoConfigureMockMvc
class AuditQueryApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    ApiFixture api;

    @BeforeEach
    void setUp() {
        api = new ApiFixture(mockMvc, mapper);
    }

    @Test
    void B07_searchFiltersByTargetActorActionAndPages() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String id = api.create(op, "album", Map.of("title", "Audit search")).get("id").asText();
        api.action(op, id, "publish").andExpect(status().isOk());
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);

        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetType", "entry").param("targetId", id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.items[*].action").value(equalTo(List.of("entry.publish", "entry.create"))))
                .andExpect(jsonPath("$.items[0].actor.username").value("seed-operator-album"))
                .andExpect(jsonPath("$.items[0].actor.displayName").value("Album operator"))
                .andExpect(jsonPath("$.items[0].category").value("CONTENT"))
                .andExpect(jsonPath("$.items[0].surface").value("back"))
                .andExpect(jsonPath("$.items[0].outcome").value("ok"));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("page", "2").param("size", "1")))
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.offset").value(1))
                .andExpect(jsonPath("$.items[*].action").value(equalTo(List.of("entry.create"))));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("action", "entry.")))
                .andExpect(jsonPath("$.total").value(2));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("action", "entry")))
                .andExpect(jsonPath("$.total").value(0));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("actor", "seed-operator-album")))
                .andExpect(jsonPath("$.total").value(2));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("actor", "nobody-here")))
                .andExpect(jsonPath("$.total").value(0));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("from", "2999-01-01T00:00:00Z")))
                .andExpect(jsonPath("$.total").value(0));
    }

    @Test
    void B07_oneEventCarriesItsDetail() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String id = api.create(op, "album", Map.of("title", "Audit detail")).get("id").asText();
        api.action(op, id, "publish").andExpect(status().isOk());
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        JsonNode page = api.json(mockMvc.perform(admin.apply(get("/api/v1/admin/audit")
                .param("targetId", id).param("action", "entry.publish"))));
        String eventId = page.get("items").get(0).get("id").asText();
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit/{id}", eventId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.action").value("entry.publish"))
                .andExpect(jsonPath("$.detail.revisionNo").value(1));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit/{id}", UUID.randomUUID())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("AUDIT_EVENT_NOT_FOUND"));
    }

    @Test
    void B07_invalidParametersAre400AndBackIsForbidden() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        for (String[] bad : List.of(new String[] {"size", "0"}, new String[] {"from", "yesterday"},
                new String[] {"targetId", "x"}, new String[] {"page", "-1"})) {
            mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param(bad[0], bad[1])))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        }
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/admin/audit")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
    }
}
```

### 7.5 `PublishRequestApiTests`（T09）、`AssignablePrincipalsApiTests`（T11）

| 測試 | 斷言 |
| --- | --- |
| `G03_editorRequestsAndWithdrawsAndTheListCanShowOnlyRequests` | editor 請求：兩欄有值、`version` 不變；再請求一次時間不變；`publishRequested=true` 只列出它；撤回後兩欄 null，再撤回仍 200；審計有 create、publish_request、publish_request_cancel |
| `G03_publishClearsTheRequestAndOnlyDraftOrDirtyEntriesQualify` | 發布清除；已發布無變更 409；有變更後可請求；PATCH 保留；archive 清除；封存後 409 |
| `G03_needsUpdateAndAValidFilterValue` | 沒有權限 403 `FORBIDDEN`；`publishRequested=maybe` 400 |
| `G04_listsActivePrincipalsWithUpdateOnTheType` | 含 `Album editor`、`Album operator`，不含 `Clinic operator`；只有 `id`、`displayName`；`q=EDITOR-ALB` 只剩 `Album editor` |
| `G04_rejectsMissingOrUnknownTypesAndCallersWithoutUpdate` | 沒有 `contentType`、`nope` 400；`seed-editor-clinic` 對 album 403 |

`src/test/java/com/fallrising/cms/PublishRequestApiTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** G-03: POST/DELETE /entries/{id}/publish-request and the publishRequested list filter. */
@SpringBootTest
@AutoConfigureMockMvc
class PublishRequestApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    ApiFixture api;

    @BeforeEach
    void setUp() {
        api = new ApiFixture(mockMvc, mapper);
    }

    @Test
    void G03_editorRequestsAndWithdrawsAndTheListCanShowOnlyRequests() throws Exception {
        TestSession editor = TestSession.login(mockMvc, "seed-editor-album", password, TestSession.BACK);
        String token = ApiFixture.token("pr");
        String asked = api.create(editor, "album", Map.of("title", token + " asked")).get("id").asText();
        api.create(editor, "album", Map.of("title", token + " plain"));

        JsonNode first = api.json(mockMvc.perform(editor.apply(post("/api/v1/entries/{id}/publish-request", asked)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publishRequestedAt").value(notNullValue()))
                .andExpect(jsonPath("$.publishRequestedBy").value(notNullValue()))
                .andExpect(jsonPath("$.version").value(1)));
        mockMvc.perform(editor.apply(post("/api/v1/entries/{id}/publish-request", asked)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publishRequestedAt").value(first.get("publishRequestedAt").asText()));
        mockMvc.perform(editor.apply(get("/api/v1/content-types/album/entries").param("q", token).param("publishRequested", "true")))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of(token + " asked"))));
        mockMvc.perform(editor.apply(get("/api/v1/content-types/album/entries").param("q", token)))
                .andExpect(jsonPath("$.total").value(2));

        mockMvc.perform(editor.apply(delete("/api/v1/entries/{id}/publish-request", asked)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publishRequestedAt").value(nullValue()))
                .andExpect(jsonPath("$.publishRequestedBy").value(nullValue()));
        mockMvc.perform(editor.apply(delete("/api/v1/entries/{id}/publish-request", asked))).andExpect(status().isOk());

        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        JsonNode audit = api.json(mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", asked))));
        assertThat(audit.get("items").findValuesAsText("action"))
                .containsExactlyInAnyOrder("entry.create", "entry.publish_request", "entry.publish_request_cancel");
    }

    @Test
    void G03_publishClearsTheRequestAndOnlyDraftOrDirtyEntriesQualify() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String id = api.create(op, "album", Map.of("title", "Request then publish")).get("id").asText();
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish-request", id))).andExpect(status().isOk());
        api.action(op, id, "publish").andExpect(status().isOk()).andExpect(jsonPath("$.publishRequestedAt").value(nullValue()));

        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish-request", id)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("INVALID_STATE_TRANSITION"));
        api.patchEntry(op, id, 1, Map.of("title", "Changed after publish")).andExpect(status().isOk());
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish-request", id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dirty").value(true));
        api.patchEntry(op, id, 2, Map.of("title", "Changed again")).andExpect(status().isOk())
                .andExpect(jsonPath("$.publishRequestedAt").value(notNullValue()));
        api.action(op, id, "archive").andExpect(status().isOk()).andExpect(jsonPath("$.publishRequestedAt").value(nullValue()));
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish-request", id)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("INVALID_STATE_TRANSITION"));
    }

    @Test
    void G03_needsUpdateAndAValidFilterValue() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String id = api.create(op, "album", Map.of("title", "Not yours")).get("id").asText();
        TestSession clinic = TestSession.login(mockMvc, "seed-editor-clinic", password, TestSession.BACK);
        mockMvc.perform(clinic.apply(post("/api/v1/entries/{id}/publish-request", id)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        mockMvc.perform(op.apply(get("/api/v1/content-types/album/entries").param("publishRequested", "maybe")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }
}
```

`src/test/java/com/fallrising/cms/AssignablePrincipalsApiTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** G-04: GET /principals/assignable. */
@SpringBootTest
@AutoConfigureMockMvc
class AssignablePrincipalsApiTests {

    @Autowired
    MockMvc mockMvc;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void G04_listsActivePrincipalsWithUpdateOnTheType() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/principals/assignable").param("contentType", "album")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].displayName").value(hasItems("Album editor", "Album operator")))
                .andExpect(jsonPath("$.items[*].displayName").value(not(hasItem("Clinic operator"))))
                .andExpect(jsonPath("$.items[0].username").doesNotExist());
        mockMvc.perform(op.apply(get("/api/v1/principals/assignable").param("contentType", "album").param("q", "EDITOR-ALB")))
                .andExpect(jsonPath("$.items[*].displayName").value(equalTo(List.of("Album editor"))));
    }

    @Test
    void G04_rejectsMissingOrUnknownTypesAndCallersWithoutUpdate() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/principals/assignable")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        mockMvc.perform(op.apply(get("/api/v1/principals/assignable").param("contentType", "nope")))
                .andExpect(status().isBadRequest());
        TestSession clinic = TestSession.login(mockMvc, "seed-editor-clinic", password, TestSession.BACK);
        mockMvc.perform(clinic.apply(get("/api/v1/principals/assignable").param("contentType", "album")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }
}
```

### 7.6 `BatchPatchApiTests`（T13）、`IncludeRefsApiTests`（T15）

| 測試 | 斷言 |
| --- | --- |
| `G09_patchesEveryItemAndReturnsThemInOrder` | 兩筆都更新，依 items 順序回傳，版本 2 |
| `G09_fieldErrorsOfAllItemsNameTheItemAndNothingIsWritten` | 422，`fields` 是 `items[1].payload.visibility`、`items[2].payload.sortMode`；第一筆沒被寫入 |
| `G09_firstFailingItemStopsTheBatch` | 第二筆版本錯 409，訊息以 `items[1]: ` 開頭；不存在的 id 404 以 `items[0]: ` 開頭；沒有版本 428；都沒有寫入 |
| `G09_sizeAndIdRulesAndSurface` | 空 400；101 筆 400；重複 id 400（訊息逐字）；Front 403 `SURFACE_FORBIDDEN` |
| `G10_listAndSingleReadExpandRefs` | 列表與單筆的 `refs.album` 有 id、類型、標題、狀態；沒帶 `include` 時沒有 `refs` |
| `G10_targetsTheCallerCannotReadAreRestricted` | 只有 `photo` editor 權限的新帳號讀照片：`refs.album` 只有 id 與 `restricted: true`，沒有標題 |
| `G10_unknownIncludeValueIs400` | `include=refs,everything` 400 |

`src/test/java/com/fallrising/cms/BatchPatchApiTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** G-09: POST /entries:batch-patch is all or nothing. */
@SpringBootTest
@AutoConfigureMockMvc
class BatchPatchApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    ApiFixture api;
    TestSession op;

    @BeforeEach
    void setUp() throws Exception {
        api = new ApiFixture(mockMvc, mapper);
        op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
    }

    @Test
    void G09_patchesEveryItemAndReturnsThemInOrder() throws Exception {
        String a = api.create(op, "album", Map.of("title", "A")).get("id").asText();
        String b = api.create(op, "album", Map.of("title", "B")).get("id").asText();
        batch(List.of(item(b, 1, Map.of("title", "B2")), item(a, 1, Map.of("title", "A2"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id").value(equalTo(List.of(b, a))))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of("B2", "A2"))))
                .andExpect(jsonPath("$.items[*].version").value(equalTo(List.of(2, 2))));
    }

    @Test
    void G09_fieldErrorsOfAllItemsNameTheItemAndNothingIsWritten() throws Exception {
        String a = api.create(op, "album", Map.of("title", "Keep A")).get("id").asText();
        String b = api.create(op, "album", Map.of("title", "Keep B")).get("id").asText();
        String c = api.create(op, "album", Map.of("title", "Keep C")).get("id").asText();
        batch(List.of(item(a, 1, Map.of("title", "Changed A")), item(b, 1, Map.of("visibility", "secret")),
                        item(c, 1, Map.of("sortMode", 7))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))
                .andExpect(jsonPath("$.error.fields[*].field").value(equalTo(List.of("items[1].payload.visibility", "items[2].payload.sortMode"))));
        mockMvc.perform(op.apply(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/v1/entries/{id}", a)))
                .andExpect(jsonPath("$.title").value("Keep A"))
                .andExpect(jsonPath("$.version").value(1));
    }

    @Test
    void G09_firstFailingItemStopsTheBatch() throws Exception {
        String a = api.create(op, "album", Map.of("title", "First")).get("id").asText();
        String b = api.create(op, "album", Map.of("title", "Second")).get("id").asText();
        batch(List.of(item(a, 1, Map.of("title", "x")), item(b, 5, Map.of("title", "y"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"))
                .andExpect(jsonPath("$.error.message").value(startsWith("items[1]: ")));
        batch(List.of(item(UUID.randomUUID().toString(), 1, Map.of())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.message").value(startsWith("items[0]: ")));
        Map<String, Object> noVersion = new LinkedHashMap<>();
        noVersion.put("id", a);
        noVersion.put("payload", Map.of("title", "z"));
        batch(List.of(noVersion))
                .andExpect(status().isPreconditionRequired())
                .andExpect(jsonPath("$.error.code").value("VERSION_REQUIRED"));
        mockMvc.perform(op.apply(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/v1/entries/{id}", a)))
                .andExpect(jsonPath("$.title").value("First"));
    }

    @Test
    void G09_sizeAndIdRulesAndSurface() throws Exception {
        String a = api.create(op, "album", Map.of("title", "Limits")).get("id").asText();
        batch(List.of()).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        List<Map<String, Object>> tooMany = new ArrayList<>();
        for (int i = 0; i < 101; i++) tooMany.add(item(UUID.randomUUID().toString(), 1, Map.of()));
        batch(tooMany).andExpect(status().isBadRequest());
        batch(List.of(item(a, 1, Map.of()), item(a, 1, Map.of())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message").value("items[1].id is repeated"));
        TestSession front = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.FRONT);
        mockMvc.perform(front.apply(post("/api/v1/entries:batch-patch")).contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("items", List.of(item(a, 1, Map.of()))))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
    }

    private static Map<String, Object> item(String id, int version, Map<String, Object> payload) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", id);
        item.put("version", version);
        item.put("payload", payload);
        return item;
    }

    private ResultActions batch(List<Map<String, Object>> items) throws Exception {
        return mockMvc.perform(op.apply(post("/api/v1/entries:batch-patch"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("items", items))));
    }
}
```

`src/test/java/com/fallrising/cms/IncludeRefsApiTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** G-10: include=refs on the work list and GET /entries/{id}; 02 §6 restricted targets. */
@SpringBootTest
@AutoConfigureMockMvc
class IncludeRefsApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    ApiFixture api;

    @BeforeEach
    void setUp() {
        api = new ApiFixture(mockMvc, mapper);
    }

    @Test
    void G10_listAndSingleReadExpandRefs() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = ApiFixture.token("r");
        String album = api.create(op, "album", Map.of("title", token + " album")).get("id").asText();
        String photo = api.create(op, "photo", Map.of("title", token + " photo", "album", album)).get("id").asText();

        mockMvc.perform(op.apply(get("/api/v1/content-types/photo/entries").param("q", token).param("include", "refs")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].refs.album.id").value(album))
                .andExpect(jsonPath("$.items[0].refs.album.contentType").value("album"))
                .andExpect(jsonPath("$.items[0].refs.album.title").value(token + " album"))
                .andExpect(jsonPath("$.items[0].refs.album.publicationState").value("draft"));
        mockMvc.perform(op.apply(get("/api/v1/content-types/photo/entries").param("q", token)))
                .andExpect(jsonPath("$.items[0].refs").doesNotExist());
        mockMvc.perform(op.apply(get("/api/v1/entries/{id}", photo).param("include", "refs")))
                .andExpect(jsonPath("$.refs.album.title").value(token + " album"));
    }

    @Test
    void G10_targetsTheCallerCannotReadAreRestricted() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = ApiFixture.token("r");
        String album = api.create(op, "album", Map.of("title", token + " secret album")).get("id").asText();
        String photo = api.create(op, "photo", Map.of("title", token + " photo", "album", album)).get("id").asText();

        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        TestSession photoOnly = api.principalWithRole(admin, "editor", List.of("photo"), TestSession.BACK);
        mockMvc.perform(photoOnly.apply(get("/api/v1/entries/{id}", photo).param("include", "refs")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.refs.album.id").value(album))
                .andExpect(jsonPath("$.refs.album.restricted").value(true))
                .andExpect(jsonPath("$.refs.album.title").doesNotExist());
    }

    @Test
    void G10_unknownIncludeValueIs400() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/photo/entries").param("include", "refs,everything")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }
}
```

### 7.7 其他既有測試的修改

`ListQueryParserTests`、`OpenApiResponseValidatorSelfTests` 的 diff 在 §5.5；`IdentityHardeningTests` 在 §5.3。

### 7.8 故障注入

沒有。交易回滾（審計寫入失敗時狀態變更也回滾）沒有專門的測試：in-memory store 沒有交易，而 `integrationTest` 的 store 契約只測單一 store。交易邊界由 §2.3 的事實與 §5.3 的程式碼保證；02 §5.1 沒有要求 JDBC 版的 API 測試，所以記為 BW4 的補強項（見 §8 BW2-FM16）。

---

## 8. 失敗模式對照

| FM ID | 失敗情境 | 期望行為 | 由哪個測試覆蓋 | 任務卡 |
| --- | --- | --- | --- | --- |
| BW2-FM01 | 未登入呼叫新端點 | 401 `UNAUTHENTICATED`（filter，不變） | 既有 `IdentityAuthTests`；`assignable` 在服務層也檢查 | — |
| BW2-FM02 | 錯的 surface | 審計查詢在 Back 403 `SURFACE_FORBIDDEN`；批次在 Front 403 | `B07_invalidParametersAre400AndBackIsForbidden`、`G09_sizeAndIdRulesAndSurface` | T07～T14 |
| BW2-FM03 | 權限不足 | 403 `FORBIDDEN` | `G03_needsUpdateAndAValidFilterValue`、`G04_rejectsMissingOrUnknownTypesAndCallersWithoutUpdate` | T09～T12 |
| BW2-FM04 | 參數不合法 | 400 `VALIDATION_FAILED` | `B07_invalidParametersAre400…`、`G03_needsUpdate…`、`G09_sizeAndIdRules…`、`G10_unknownIncludeValueIs400` | T07～T16 |
| BW2-FM05 | 批次中有欄位錯誤 | 422，全部路徑以 `items[i].` 開頭，沒有寫入 | `G09_fieldErrorsOfAllItems…` | T13、T14 |
| BW2-FM06 | 批次中有版本衝突、不存在、沒有版本 | 409／404／428，訊息指出第幾筆，沒有寫入 | `G09_firstFailingItemStopsTheBatch` | T13、T14 |
| BW2-FM07 | 請求發布時狀態不符 | 409 `INVALID_STATE_TRANSITION` | `G03_publishClearsTheRequest…` | T09、T10 |
| BW2-FM08 | 審計事件不存在 | 404 `AUDIT_EVENT_NOT_FOUND` | `B07_oneEventCarriesItsDetail` | T07、T08 |
| BW2-FM09 | 治理操作被拒 | 寫一筆 `denied` | `B07_deniedGovernanceIsAudited` | T05、T06 |
| BW2-FM10 | 關聯目標無權讀取 | `restricted`，不洩漏標題 | `G10_targetsTheCallerCannotReadAreRestricted` | T15、T16 |
| BW2-FM11 | 關聯目標不存在或已軟刪除 | `missing: true` | 沒有 API 測試：store 契約 `G10_findEntriesReadsManyIdsInOneCall` 固定了「含軟刪除」，形狀由契約的 `RefSummary` 固定；軟刪除有關聯的 entry 本身會被 `REF_CONSTRAINT` 擋下，所以只有資料庫被直接修改時才會發生 | — |
| BW2-FM12 | 審計查詢的 actor 已被刪除 | `username`、`displayName` 為 null | 沒有測試：v2 沒有刪除 principal 的 API | — |
| BW2-FM13 | 資料庫失敗 | 500 `INTERNAL_ERROR`（不變） | BW0 `ApiExceptionHandlerTests` | — |
| BW2-FM14 | 既有的審計資料名稱 | 舊列保留 `ENTRY_PURGED`、`PERMISSION_CHANGED`；新列用新名稱 | `WaveEAcceptanceTests.tCt06…`（新名稱） | T05、T06 |
| BW2-FM15 | 回應與契約不符 | 全域 OpenAPI 驗證失敗 | 全部 MockMvc 測試；`OpenApiContractTests`（路徑） | T08～T16 |
| BW2-FM16 | 審計寫入失敗 | 狀態變更一起回滾（JDBC） | 沒有測試，見 §7.8；02 BQ-12 | — |

---

## 9. 交付檢查表

- [ ] T01～T17 全部完成。
- [ ] `./gradlew test` 全綠（預期 217 個＝BW1c 的 194＋本波 23）。
- [ ] `./gradlew integrationTest` 全綠（72 個＝BW1c 的 67＋本波 5）；沒有 Docker 時勾「只在 CI 跑過」並附連結。
- [ ] `npm ci && npm run lint && npm run typecheck && npm test && npm run build` 全綠；或只有 §2.1 的 codegen 新鮮度／fixture 型別失敗，並已在 PR 說明列出。
- [ ] `cmp docs/v2/contracts/BW2.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。
- [ ] B-07：`AuditTrailApiTests`、`AuditQueryApiTests`、`IdentityStoreContract.B07_*` 綠。
- [ ] G-03：`PublishRequestApiTests`、`ContentStoreContract.G03_*` 綠。
- [ ] G-04：`AssignablePrincipalsApiTests` 綠。
- [ ] G-09：`BatchPatchApiTests` 綠。
- [ ] G-10：`IncludeRefsApiTests`、`ContentStoreContract.G10_*` 綠。
- [ ] `gradle.lockfile` 沒有變動。
- [ ] 沒有秘密或密碼（`ApiFixture` 的密碼是每次執行隨機產生的）。
- [ ] `docs/v2/README.md` 的 BW2 狀態已改成 `VERIFIED`。
- [ ] PR 說明列出 §4.2 的行為變更，以及實際跑過的指令與結果。

---

## 10. BW2 必寫內容索引

| REFINE-PROMPT 要求 | 位置 |
| --- | --- |
| 每個新端點的授權矩陣（角色 × surface × 結果） | §4.7 |
| 審計事件的 `detail_json` 內容 | §4.3 |
