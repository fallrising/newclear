# BW4 施工圖 — 後端硬化

[回 v2 索引](../README.md) ・ 框架：[02 §7 BW4](../02-backend-sdd.md#7-後端波次) ・ 契約：[contracts/BW4.openapi.yaml](../contracts/BW4.openapi.yaml) ・ 前一波：[BW3](BW3.md) ・ 量測紀錄：[perf-records.md](../perf-records.md)

狀態：**DOC_READY**（本檔合併即生效）  
日期：2026-09-25  
讀者：實作 BW4 的 agent。只讀本檔、`contracts/BW4.openapi.yaml` 與本檔引用的檔案就能完成，不需要做任何設計決定。

> **預演紀錄。** 本檔的程式碼、YAML 與測試，已套用在「BW3 施工圖完成後」的 `services/cms-api` 副本上，並逐張任務卡執行過（2026-09-25）。T02、T04、T05 完成後，`./gradlew :services:cms-api:test` 依序是 225、229、230 個測試，唯一失敗的是 `CmsApiApplicationTests.runtimeIsJava25`（預演環境只有 JDK 21）；`integrationTest` 在 T02 後是 74 個、T07 後是 76 個，全綠（本機 PostgreSQL 16.13，不是 Testcontainers）。各「測試先行」卡的預期紅燈也是實際跑出來的；§5.3 的矩陣測試與 §5.5 的回滾測試另外做過反向檢查（故意改錯一格、故意拿掉 `publish` 的交易，測試都會失敗）。

> **Owner 決定（2026-09-25）：** 審計保留預設 **90 天**（[surface-admin §7.2](../../specs/surface-admin.md)，[02 BQ-03](../02-backend-sdd.md#8-開放問題)）；[02 BQ-12](../02-backend-sdd.md#8-開放問題) 選 A，在本波次加回滾測試（§5.5）；寫回滾測試時發現「應用程式有 DataSource 卻用 in-memory store」，owner 決定在本波次修正（§5.5，02 BQ-13）。

---

## 1. 範圍

### 1.1 解決的 ID

| ID | 來源 | 本波次做到什麼程度 |
| --- | --- | --- |
| BW4「效能量測記錄」 | 02 §7、§5.4 | 量測腳本、門檻、未達標處理（§5.4）；數字寫進 `docs/v2/perf-records.md` |
| BW4「審計保留期限設定」 | 02 §7、BQ-03；surface-admin §5.5、§7.2 | `GET`／`PATCH /api/v1/admin/settings/audit`；V9；每日清理工作 |
| BW4「安全測試補齊」 | 02 §6 第一條 | BW0 之後新增的 10 個 operation，在每個不該用的 surface 與沒有權限的呼叫者都被拒絕（§5.3） |
| BQ-12 | 02 §8（owner 選 A） | 應用程式在 PostgreSQL 上啟動，審計寫入失敗時狀態變更回滾（§5.5） |
| BQ-13 | 02 §8（BW4 細化時發現，owner 決定在 BW4 修） | 三個 `*StoreConfig` 在有 DataSource 時改用 JDBC store（§5.5） |

### 1.2 不做

- 01 §1.2、AGENTS.md「不要做」全部。
- surface-admin §9 的 `/settings/media`、`/settings/security`：不在 02 §7 BW4 的範圍。
- 「立刻清空」或單筆刪除審計：surface-admin §7.2 明定不提供。
- 清理本身不寫審計事件（surface-admin §7.1 的事件表沒有它，§7.1 也說不要把審計變成 access log）；只寫一行應用程式日誌。
- 02 BQ-06、07、08、10、11（owner 選 A）：在 BW5 做，不在本波次。
- [02 BQ-05](../02-backend-sdd.md#8-開放問題)（GIN 索引）：§5.4 的數字全部達標，不改索引設計；本 PR 在 BQ-05 補註量測結果。
- 多實例部署時的清理協調：每個實例各自跑清理，`DELETE … WHERE at < ?` 重複執行無害（第二次刪 0 筆），不需要鎖。
- 不新增依賴，所以 `gradle.lockfile` 不變（`@EnableScheduling` 在 `spring-context` 內）。

---

## 2. 先決條件

### 2.1 前置波次

- **BW3 必須已是 `VERIFIED`**。本檔所有 diff 都以「BW3 施工圖完成後」的檔案為基準；不同時先停下來回報。
- **與前端的關係。** 前端 W4 的 Admin「Settings → Audit retention」頁使用本波次的端點；surface-admin §9 的草案路徑 `PATCH /api/v1/settings/audit` 對應本檔的 `PATCH /api/v1/admin/settings/audit`（與 BW2 把 `/audit-events` 放在 `/admin/audit` 下相同）。

### 2.2 環境

與 [BW0 §2.2](BW0.md#22-環境) 相同。T06～T08 另外需要本機可以跑 `integrationTest`（Docker，見 BW0）。

### 2.3 查證過的外部事實

沒有新的依賴。預演中確認（2026-09-25，Spring Boot 3.5.16）：

- `@Scheduled(initialDelayString = "PT1H", fixedDelayString = "PT24H")` 接受 ISO-8601 duration。
- `ScheduledTaskHolder`（`ScheduledAnnotationBeanPostProcessor` 實作它）是可注入的 bean；`FixedDelayTask.getIntervalDuration()`、`getInitialDelayDuration()` 存在。`Task.getRunnable()` 回傳的是包裝過的 runnable，不能用 `instanceof ScheduledMethodRunnable` 判斷，只能比對 `toString()`（等於「類別全名.方法名」），§7.2 這樣做。
- Jackson 把 JSON 整數 `30` 讀成 `Integer`，`"30"` 讀成 `String`，`30.0` 讀成 `Double`；§5.2 以 `instanceof Integer` 判斷型別。

---

## 3. 檔案清單

路徑相對於 `apps/cms-scaffold/services/cms-api/`，另有註明者除外。**實作者不得碰清單以外的檔案。**

| 路徑 | 動作 | 用途 | 任務卡 |
| --- | --- | --- | --- |
| `src/test/java/com/fallrising/cms/contract/IdentityStoreContract.java` | 修改 | 保留設定與刪除的契約 | T01 |
| `src/main/java/com/fallrising/cms/identity/domain/AuditRetention.java` | 新增 | 保留設定的值物件 | T02 |
| `src/main/resources/db/migration/V9__audit_retention.sql` | 新增 | `cms_audit_settings` | T02 |
| `src/main/java/com/fallrising/cms/identity/store/IdentityStore.java` | 修改 | 三個方法 | T02 |
| `src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java` | 修改 | 實作 | T02 |
| `src/main/java/com/fallrising/cms/identity/store/JdbcIdentityStore.java` | 修改 | 實作 | T02 |
| `src/test/java/com/fallrising/cms/identity/service/AuditRetentionServiceTests.java` | 新增 | 清理（單元） | T03 |
| `src/test/java/com/fallrising/cms/AuditRetentionApiTests.java` | 新增 | 端點與排程（MockMvc） | T03 |
| `src/main/java/com/fallrising/cms/identity/IdentityException.java` | 修改 | `fieldValidation` | T04 |
| `src/main/java/com/fallrising/cms/identity/service/AuditRetentionService.java` | 新增 | 讀寫與清理 | T04 |
| `src/main/java/com/fallrising/cms/identity/service/AuditPurgeJob.java` | 新增 | 排程 | T04 |
| `src/main/java/com/fallrising/cms/platform/SchedulingConfig.java` | 新增 | `@EnableScheduling` | T04 |
| `src/main/java/com/fallrising/cms/identity/web/AuditSettingsController.java` | 新增 | `/api/v1/admin/settings/audit` | T04 |
| `src/main/resources/application.yaml` | 修改 | 清理的兩個時間 | T04 |
| `src/main/resources/openapi/openapi.yaml` | 修改 | 等於 `docs/v2/contracts/BW4.openapi.yaml` | T04 |
| `src/test/java/com/fallrising/cms/SurfaceMatrixTests.java` | 新增 | surface 拒絕矩陣 | T05 |
| `src/integrationTest/java/com/fallrising/cms/AuditRollbackIntegrationTests.java` | 新增 | 應用程式在 PostgreSQL 上：JDBC store、審計失敗回滾 | T06 |
| `src/main/java/com/fallrising/cms/identity/web/IdentityStoreConfig.java` | 修改 | 有 DataSource 時用 JDBC store | T07 |
| `src/main/java/com/fallrising/cms/content/web/ContentStoreConfig.java` | 修改 | 同上 | T07 |
| `src/main/java/com/fallrising/cms/media/web/MediaStoreConfig.java` | 修改 | 同上 | T07 |
| `apps/cms-scaffold/docs/v2/perf-records.md` | 修改 | 加三列實測數字 | T08 |
| `apps/cms-scaffold/docs/v2/README.md` | 修改 | 路線圖 BW4 狀態改 `VERIFIED` | T09 |

不會碰：`build.gradle.kts`、`gradle.lockfile`、既有 migration、content 與 media 模組（上表的兩個 `*StoreConfig.java` 除外）、`application-prod.yaml`、上表以外的測試（包括 `IdentitySurfaceHardeningTests.java`，見 §5.3）、前端、`e2e/`、workflow。

---

## 4. 契約

### 4.1 OpenAPI

完整契約是 [`docs/v2/contracts/BW4.openapi.yaml`](../contracts/BW4.openapi.yaml)，`info.version` 0.10.0，`ErrorCode` 不變（39 個）。T04 以一段 diff 加入（`OpenApiContractTests` 要求路徑與實作一致，所以不能提前）；T04 後以 `cmp` 確認。

| operation | 方法與路徑 | surface | 授權 | 錯誤 |
| --- | --- | --- | --- | --- |
| `getAuditSettings` | `GET /api/v1/admin/settings/audit` | 只有 Admin | `manage_settings` | 401；403 `SURFACE_FORBIDDEN`、`FORBIDDEN` |
| `patchAuditSettings` | `PATCH /api/v1/admin/settings/audit` | 只有 Admin | `manage_settings` | 400 `VALIDATION_FAILED`；401；403；415；422 `FIELD_VALIDATION` |

新 schema：`AuditSettings`、`AuditSettingsPatchRequest`。另外更新兩段說明：`FieldError.field` 可以是設定請求的屬性名；`FieldErrorCode` 的 `REQUIRED` 不再只用於發布（BW3 的會員建立也用它）。

### 4.2 行為

- 回應 `AuditSettings`：`retentionDays`（30、90 或 365）、`allowedDays`（永遠 `[30, 90, 365]`，給前端畫選項）、`updatedAt`、`updatedBy`（最後修改者的 principal id；還是預設值時為 null）。
- `PATCH` body 只能有 `retentionDays`：
  1. 授權（`manage_settings`；被拒時由 `AuthorizationService.require` 寫 `denied` 審計，與 BW2 相同）。
  2. 有其他屬性 → 400 `VALIDATION_FAILED`；body 不是 JSON 物件 → 400（`ApiExceptionHandler` 既有行為）。
  3. `retentionDays` 缺少或 null → 422，`error.fields[0]` 為 `{field: "retentionDays", code: "REQUIRED"}`；不是整數 → `WRONG_TYPE`；不是 30／90／365 → `NOT_IN_ENUM`。
  4. 與目前值相同 → 200，不寫資料、不寫審計。
  5. 不同 → 同一個交易內更新設定並寫 `settings.retention_updated`，回 200。
- **清理**：`AuditPurgeJob` 在啟動後 1 小時第一次執行，之後每次結束後 24 小時再執行（`fixedDelay`）；刪除 `at < 現在 − retentionDays 天` 的事件（剛好等於邊界的保留）。縮短保留期限不立即刪除，下一次清理才生效（surface-admin §7.2）。兩個時間可用 `cms.audit.purge-initial-delay`、`cms.audit.purge-interval` 覆寫（ISO-8601 duration）。

### 4.3 授權矩陣

本波次的兩個端點：

| 帳號 | Front | Back | Admin |
| --- | --- | --- | --- |
| 未登入 | 401 | 401 | 401 |
| `seed-admin` | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | 200 |
| editor、operator | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | 403 `FORBIDDEN` |
| member | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | 403 `FORBIDDEN` |

BW0 之後新增的全部 operation 的拒絕矩陣見 §5.3。

### 4.4 審計

| 情境 | `category` | `action` | `targetType`／`targetId` | `surface` | `outcome` | `detail_json` |
| --- | --- | --- | --- | --- | --- | --- |
| 修改保留期限 | `SETTINGS` | `settings.retention_updated` | `settings`／null | `admin` | `ok` | `{"from": 90, "to": 30}` |
| 被拒（surface 或權限） | `GOVERNANCE` | `manage_settings` | null／null | 呼叫的 surface | `denied` | `{"reason": "SURFACE_FORBIDDEN"}` 或 `{"reason": "FORBIDDEN"}`（BW2 既有） |
| 清理 | 不寫 | — | — | — | — | — |

設定為相同的值、讀取設定，都不寫。

### 4.5 資料

V9 新增一張只有一列的表（同 V4 的 `cms_media_settings` 做法）：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | `SMALLINT` PK，`CHECK (id = 1)` | 永遠只有一列 |
| `retention_days` | `INTEGER NOT NULL`，`CHECK (retention_days IN (30, 90, 365))` | migration 寫入 90 |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_by` | `UUID`，參照 `cms_principal (id)` | migration 寫入 null |

既有資料庫升級時 V9 建表並寫入預設列；不回填、不刪既有審計。清理使用 V2 既有的 `cms_audit_event_at_idx`。

### 4.6 範例

成功：`PATCH /api/v1/admin/settings/audit`（`seed-admin`，Admin），body `{"retentionDays":30}`，`200`：

```json
{ "retentionDays": 30, "allowedDays": [30, 90, 365], "updatedAt": "2026-09-25T13:40:00Z", "updatedBy": "<seed-admin 的 id>" }
```

失敗：body `{"retentionDays":45}`，`422`：

```json
{ "error": { "code": "FIELD_VALIDATION", "message": "Invalid fields",
             "fields": [ { "field": "retentionDays", "code": "NOT_IN_ENUM", "message": "retentionDays must be one of [30, 90, 365]" } ] },
  "requestId": "…" }
```

失敗：同一個帳號在 Back 呼叫，`403`：

```json
{ "error": { "code": "SURFACE_FORBIDDEN", "message": "Action manage_settings is not allowed on surface back",
             "action": "manage_settings", "surface": "back" }, "requestId": "…" }
```

---

## 5. 模組規格

### 5.1 保留設定的資料層（T02）

`AuditRetention` 在建構時檢查天數（`IllegalArgumentException`），所以非法值到不了 store；資料庫的 `CHECK` 是第二道保護。in-memory store 的初始值是 90 天、`updatedAt` 為建立 store 的時間、`updatedBy` null。`deleteAuditsBefore` 回傳刪除筆數，嚴格小於 cutoff 才刪。

`src/main/java/com/fallrising/cms/identity/domain/AuditRetention.java`：

```java
package com.fallrising.cms.identity.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * How long audit events are kept (surface-admin §7.2): one of ALLOWED_DAYS, default 90. updatedBy is null until an
 * admin changes it.
 */
public record AuditRetention(int days, Instant updatedAt, UUID updatedBy) {

    public static final List<Integer> ALLOWED_DAYS = List.of(30, 90, 365);
    public static final int DEFAULT_DAYS = 90;

    public AuditRetention {
        if (!ALLOWED_DAYS.contains(days)) throw new IllegalArgumentException("retention days must be one of " + ALLOWED_DAYS);
    }
}
```

`src/main/resources/db/migration/V9__audit_retention.sql`：

```sql
-- BW4: audit retention setting (surface-admin §7.2, 02 BQ-03). One row; the purge job deletes events older than it.

CREATE TABLE cms_audit_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    retention_days INTEGER NOT NULL CHECK (retention_days IN (30, 90, 365)),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES cms_principal (id)
);

INSERT INTO cms_audit_settings (id, retention_days) VALUES (1, 90);
```

`src/main/java/com/fallrising/cms/identity/store/IdentityStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/store/IdentityStore.java
+++ b/src/main/java/com/fallrising/cms/identity/store/IdentityStore.java
@@ -3,6 +3,7 @@
 import com.fallrising.cms.identity.domain.AuditEvent;
 import com.fallrising.cms.identity.domain.AuditPage;
 import com.fallrising.cms.identity.domain.AuditQuery;
+import com.fallrising.cms.identity.domain.AuditRetention;
 import com.fallrising.cms.identity.domain.Credential;
 import com.fallrising.cms.identity.domain.Permission;
 import com.fallrising.cms.identity.domain.Principal;
@@ -66,6 +67,14 @@
 
     Optional<AuditEvent> findAudit(UUID id);
 
+    /** The audit retention setting (surface-admin §7.2); a new store has 90 days and updatedBy null. */
+    AuditRetention auditRetention();
+
+    void updateAuditRetention(AuditRetention retention);
+
+    /** Deletes audit events with at before cutoff (strictly); returns how many were deleted. */
+    int deleteAuditsBefore(Instant cutoff);
+
     long countUsableAdmins();
 
     void replacePrincipalRolesKeepingUsableAdmin(UUID principalId, List<PrincipalRoleAssignment> assignments);
```

`src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java
+++ b/src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java
@@ -4,6 +4,7 @@
 import com.fallrising.cms.identity.domain.AuditEvent;
 import com.fallrising.cms.identity.domain.AuditPage;
 import com.fallrising.cms.identity.domain.AuditQuery;
+import com.fallrising.cms.identity.domain.AuditRetention;
 import com.fallrising.cms.identity.domain.Credential;
 import com.fallrising.cms.identity.domain.Permission;
 import com.fallrising.cms.identity.domain.Principal;
@@ -36,6 +37,7 @@
     private final ConcurrentHashMap<UUID, SessionRecord> sessionsById = new ConcurrentHashMap<>();
     private final CopyOnWriteArrayList<AuditEvent> audits = new CopyOnWriteArrayList<>();
     private final Object adminGuard = new Object();
+    private volatile AuditRetention auditRetention = new AuditRetention(AuditRetention.DEFAULT_DAYS, Instant.now(), null);
 
     @Override
     public Optional<Principal> findPrincipalById(UUID id) {
@@ -218,6 +220,23 @@
     }
 
     @Override
+    public AuditRetention auditRetention() {
+        return auditRetention;
+    }
+
+    @Override
+    public void updateAuditRetention(AuditRetention retention) {
+        auditRetention = retention;
+    }
+
+    @Override
+    public int deleteAuditsBefore(Instant cutoff) {
+        List<AuditEvent> expired = audits.stream().filter(e -> e.at().isBefore(cutoff)).toList();
+        audits.removeAll(expired);
+        return expired.size();
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
@@ -4,6 +4,7 @@
 import com.fallrising.cms.identity.domain.AuditEvent;
 import com.fallrising.cms.identity.domain.AuditPage;
 import com.fallrising.cms.identity.domain.AuditQuery;
+import com.fallrising.cms.identity.domain.AuditRetention;
 import com.fallrising.cms.identity.domain.Credential;
 import com.fallrising.cms.identity.domain.Permission;
 import com.fallrising.cms.identity.domain.Principal;
@@ -286,6 +287,24 @@
     }
 
     @Override
+    public AuditRetention auditRetention() {
+        return jdbc.queryForObject("SELECT retention_days, updated_at, updated_by FROM cms_audit_settings WHERE id = 1",
+                (rs, n) -> new AuditRetention(rs.getInt("retention_days"), instant(rs, "updated_at"),
+                        rs.getObject("updated_by", UUID.class)));
+    }
+
+    @Override
+    public void updateAuditRetention(AuditRetention retention) {
+        jdbc.update("UPDATE cms_audit_settings SET retention_days = ?, updated_at = ?, updated_by = ? WHERE id = 1",
+                retention.days(), ts(retention.updatedAt()), retention.updatedBy());
+    }
+
+    @Override
+    public int deleteAuditsBefore(Instant cutoff) {
+        return jdbc.update("DELETE FROM cms_audit_event WHERE at < ?", ts(cutoff));
+    }
+
+    @Override
     public long countUsableAdmins() {
         Long count = jdbc.queryForObject("""
                 SELECT COUNT(DISTINCT p.id)
```

### 5.2 端點、清理與排程（T04）

規則見 §4.2。`AuditRetentionService` 的時間來自 `Clock`（正式環境 `Clock.systemUTC()`，單元測試用固定時鐘）。`SchedulingConfig` 放在 `platform` 套件，讓之後的排程工作共用；本波次只有 `AuditPurgeJob`。測試環境也會註冊這個排程，但第一次執行在 1 小時後，測試不會觸發它。

`src/main/java/com/fallrising/cms/identity/IdentityException.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/IdentityException.java
+++ b/src/main/java/com/fallrising/cms/identity/IdentityException.java
@@ -2,6 +2,9 @@
 
 import com.fallrising.cms.api.error.CmsApiException;
 import com.fallrising.cms.api.error.ErrorCode;
+import com.fallrising.cms.api.error.FieldError;
+
+import java.util.List;
 
 public class IdentityException extends CmsApiException {
 
@@ -9,6 +12,10 @@
         super(code, message, action, contentType, surface);
     }
 
+    private IdentityException(ErrorCode code, String message, List<FieldError> fields) {
+        super(code, message, null, null, null, fields);
+    }
+
     public static IdentityException unauthenticated() {
         return new IdentityException(ErrorCode.UNAUTHENTICATED, "Authentication required", null, null, null);
     }
@@ -68,4 +75,9 @@
     public static IdentityException validation(String message) {
         return new IdentityException(ErrorCode.VALIDATION_FAILED, message, null, null, null);
     }
+
+    /** 422 FIELD_VALIDATION with error.fields. */
+    public static IdentityException fieldValidation(List<FieldError> fields) {
+        return new IdentityException(ErrorCode.FIELD_VALIDATION, "Invalid fields", fields);
+    }
 }
```

`src/main/java/com/fallrising/cms/identity/service/AuditRetentionService.java`：

```java
package com.fallrising.cms.identity.service;

import com.fallrising.cms.api.error.FieldError;
import com.fallrising.cms.api.error.FieldErrorCode;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.AuditRetention;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fallrising.cms.platform.TransactionRunner;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Audit retention (surface-admin §7.2, 02 BQ-03). GET and PATCH /admin/settings/audit need manage_settings (Admin
 * surface only, by the hard-deny sets). A change writes settings.retention_updated with detail {from, to} in the same
 * transaction; setting the current value again changes nothing and writes no event. purgeExpired deletes events older
 * than the retention; AuditPurgeJob calls it on a schedule, so a shorter retention applies at the next run.
 */
@Service
public class AuditRetentionService {

    private final IdentityStore store;
    private final AuthorizationService authorization;
    private final TransactionRunner transactions;
    private final AuditLog audit;
    private final Clock clock;

    @Autowired
    public AuditRetentionService(IdentityStore store, AuthorizationService authorization, TransactionRunner transactions,
            AuditLog audit) {
        this(store, authorization, transactions, audit, Clock.systemUTC());
    }

    AuditRetentionService(IdentityStore store, AuthorizationService authorization, TransactionRunner transactions,
            AuditLog audit, Clock clock) {
        this.store = store;
        this.authorization = authorization;
        this.transactions = transactions;
        this.audit = audit;
        this.clock = clock;
    }

    public Map<String, Object> get(IdentityRequest request) {
        authorization.require(request.principal(), CmsAction.MANAGE_SETTINGS, null, null, request.surface());
        return json(store.auditRetention());
    }

    /** body is the parsed JSON object; only retentionDays is allowed. */
    public Map<String, Object> update(IdentityRequest request, Map<String, Object> body) {
        authorization.require(request.principal(), CmsAction.MANAGE_SETTINGS, null, null, request.surface());
        for (String key : body.keySet()) {
            if (!key.equals("retentionDays")) throw IdentityException.validation("Unknown property " + key);
        }
        Object raw = body.get("retentionDays");
        if (raw == null) throw invalid(FieldErrorCode.REQUIRED, "retentionDays is required");
        if (!(raw instanceof Integer days)) throw invalid(FieldErrorCode.WRONG_TYPE, "retentionDays must be an integer");
        if (!AuditRetention.ALLOWED_DAYS.contains(days)) {
            throw invalid(FieldErrorCode.NOT_IN_ENUM, "retentionDays must be one of " + AuditRetention.ALLOWED_DAYS);
        }
        return transactions.inTransaction(() -> {
            AuditRetention current = store.auditRetention();
            if (current.days() == days) return json(current);
            AuditRetention next = new AuditRetention(days, clock.instant(), request.principal().id());
            store.updateAuditRetention(next);
            audit.record(request.principal(), request.surface(), "SETTINGS", "settings.retention_updated", "settings",
                    null, AuditLog.OK, Map.of("from", current.days(), "to", days));
            return json(next);
        });
    }

    /** Deletes audit events with at before now minus the retention; returns how many. */
    public int purgeExpired() {
        return store.deleteAuditsBefore(clock.instant().minus(Duration.ofDays(store.auditRetention().days())));
    }

    private static IdentityException invalid(FieldErrorCode code, String message) {
        return IdentityException.fieldValidation(List.of(new FieldError("retentionDays", code, message)));
    }

    private static Map<String, Object> json(AuditRetention retention) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("retentionDays", retention.days());
        json.put("allowedDays", AuditRetention.ALLOWED_DAYS);
        json.put("updatedAt", retention.updatedAt());
        json.put("updatedBy", retention.updatedBy() == null ? null : retention.updatedBy().toString());
        return json;
    }
}
```

`src/main/java/com/fallrising/cms/identity/service/AuditPurgeJob.java`：

```java
package com.fallrising.cms.identity.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Deletes expired audit events (surface-admin §7.2): first run one hour after startup, then 24 hours after each run
 * ends. Both are ISO-8601 durations and can be changed with cms.audit.purge-initial-delay and cms.audit.purge-interval.
 */
@Component
public class AuditPurgeJob {

    private static final Logger log = LoggerFactory.getLogger(AuditPurgeJob.class);

    private final AuditRetentionService retention;

    public AuditPurgeJob(AuditRetentionService retention) {
        this.retention = retention;
    }

    @Scheduled(initialDelayString = "${cms.audit.purge-initial-delay:PT1H}",
            fixedDelayString = "${cms.audit.purge-interval:PT24H}")
    public void run() {
        int deleted = retention.purgeExpired();
        log.info("Audit purge deleted {} events", deleted);
    }
}
```

`src/main/java/com/fallrising/cms/platform/SchedulingConfig.java`：

```java
package com.fallrising.cms.platform;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Turns on @Scheduled methods (BW4: AuditPurgeJob). */
@Configuration
@EnableScheduling
public class SchedulingConfig {}
```

`src/main/java/com/fallrising/cms/identity/web/AuditSettingsController.java`：

```java
package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.service.AuditRetentionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/settings/audit")
public class AuditSettingsController {

    private final AuditRetentionService retention;

    public AuditSettingsController(AuditRetentionService retention) {
        this.retention = retention;
    }

    @GetMapping
    public Map<String, Object> get(HttpServletRequest request) {
        return retention.get(AuthController.current(request));
    }

    @PatchMapping
    public Map<String, Object> patch(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return retention.update(AuthController.current(request), body);
    }
}
```

`src/main/resources/application.yaml`：

```diff
--- a/src/main/resources/application.yaml
+++ b/src/main/resources/application.yaml
@@ -44,3 +44,6 @@
     argon2-iterations: 3
   media:
     root: ${CMS_MEDIA_ROOT:./data/media}
+  audit:
+    purge-initial-delay: PT1H
+    purge-interval: PT24H
```

`src/main/resources/openapi/openapi.yaml`：

```diff
--- a/src/main/resources/openapi/openapi.yaml
+++ b/src/main/resources/openapi/openapi.yaml
@@ -25,7 +25,7 @@
     - 405 `METHOD_NOT_ALLOWED` when the path exists but the HTTP method does not.
     - 415 `MEDIA_TYPE_NOT_SUPPORTED` when a JSON operation receives another Content-Type.
     - 500 `INTERNAL_ERROR` for any unexpected server failure.
-  version: 0.9.0
+  version: 0.10.0
   license:
     name: Proprietary
 servers:
@@ -1284,6 +1284,57 @@
         "403": { $ref: "#/components/responses/Error403" }
         "404": { $ref: "#/components/responses/Error404" }
         "500": { $ref: "#/components/responses/Error500" }
+  /api/v1/admin/settings/audit:
+    get:
+      operationId: getAuditSettings
+      tags: [Admin]
+      description: |
+        Audit retention (surface-admin §7.2). Requires `manage_settings` (Admin surface). Events older than
+        `retentionDays` are deleted by a job that runs one hour after startup and then every 24 hours.
+        Errors:
+        - 403 SURFACE_FORBIDDEN: called from the Front or Back surface (also written to the audit log as a
+          denied `manage_settings`).
+        - 403 FORBIDDEN: caller lacks `manage_settings` (also written as denied).
+      responses:
+        "200":
+          description: Current audit retention
+          content:
+            application/json:
+              schema: { $ref: "#/components/schemas/AuditSettings" }
+        "401": { $ref: "#/components/responses/Error401" }
+        "403": { $ref: "#/components/responses/Error403" }
+        "500": { $ref: "#/components/responses/Error500" }
+    patch:
+      operationId: patchAuditSettings
+      tags: [Admin]
+      description: |
+        Changes the retention. A change writes `settings.retention_updated` (category SETTINGS, targetType
+        `settings`, detail `{from, to}`); sending the current value changes nothing and writes no event. A shorter
+        retention takes effect at the next purge run; nothing is deleted immediately.
+        Errors:
+        - 400 VALIDATION_FAILED: body is not a JSON object, or has a property other than `retentionDays`.
+        - 403 SURFACE_FORBIDDEN, FORBIDDEN: as getAuditSettings.
+        - 422 FIELD_VALIDATION: `error.fields[0].field` is `retentionDays`, code REQUIRED (missing or null),
+          WRONG_TYPE (not an integer) or NOT_IN_ENUM (not 30, 90 or 365).
+      parameters:
+        - $ref: "#/components/parameters/CsrfHeader"
+      requestBody:
+        required: true
+        content:
+          application/json:
+            schema: { $ref: "#/components/schemas/AuditSettingsPatchRequest" }
+      responses:
+        "200":
+          description: Updated audit retention
+          content:
+            application/json:
+              schema: { $ref: "#/components/schemas/AuditSettings" }
+        "400": { $ref: "#/components/responses/Error400" }
+        "401": { $ref: "#/components/responses/Error401" }
+        "403": { $ref: "#/components/responses/Error403" }
+        "415": { $ref: "#/components/responses/Error415" }
+        "422": { $ref: "#/components/responses/Error422" }
+        "500": { $ref: "#/components/responses/Error500" }
   /api/v1/me/content-types/{typeKey}/entries:
     get:
       operationId: listMyEntries
@@ -1792,7 +1843,7 @@
       properties:
         field:
           type: string
-          description: Path of the input, `payload.<fieldKey>`.
+          description: Path of the input, `payload.<fieldKey>`, or the property name of a settings request.
           example: payload.title
         code: { $ref: "#/components/schemas/FieldErrorCode" }
         message:
@@ -1801,7 +1852,7 @@
     FieldErrorCode:
       type: string
       description: |
-        Why a field is invalid. REQUIRED (publish only), RESERVED_KEY, WRONG_TYPE, TOO_LONG (string over 1,000 or
+        Why a field is invalid. REQUIRED (publish, member create, or a missing setting), RESERVED_KEY, WRONG_TYPE, TOO_LONG (string over 1,000 or
         markdown over 100,000 code points), INVALID_DATETIME, NOT_IN_ENUM, INVALID_UUID, REF_TARGET_NOT_FOUND,
         REF_TARGET_WRONG_TYPE, PRINCIPAL_REF_UNRESOLVED.
       enum:
@@ -2622,6 +2673,28 @@
           nullable: true
           additionalProperties: true
           description: The event's detail_json, or null.
+    AuditSettings:
+      type: object
+      additionalProperties: false
+      required: [retentionDays, allowedDays, updatedAt, updatedBy]
+      properties:
+        retentionDays: { type: integer, enum: [30, 90, 365] }
+        allowedDays:
+          type: array
+          items: { type: integer }
+          description: Always `[30, 90, 365]`.
+        updatedAt: { type: string, format: date-time }
+        updatedBy:
+          type: string
+          format: uuid
+          nullable: true
+          description: Principal who last changed the retention; null while it is the default.
+    AuditSettingsPatchRequest:
+      type: object
+      additionalProperties: false
+      required: [retentionDays]
+      properties:
+        retentionDays: { type: integer, enum: [30, 90, 365] }
     AuditEventPage:
       type: object
       additionalProperties: false
```

T04 之後：`cmp docs/v2/contracts/BW4.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。

### 5.3 surface 拒絕矩陣（T05）

02 §6 要求「新端點都要在 `IdentitySurfaceHardeningTests` 補上 Front／Back／Admin 各自的拒絕案例」。本波次把它寫成**新的** `SurfaceMatrixTests`，不改 `IdentitySurfaceHardeningTests`：後者有自己的登入方式，而新類別與其他 BW 測試一樣用 `TestSession` 與 `cms.identity.seed-password`。本 PR 在 02 §6 補註新的位置。

涵蓋 BW0 契約之後新增的 10 個 operation。每一列是一個（帳號，surface），每一格是預期的「狀態碼 錯誤代碼」；空格表示該組合是允許的，由各功能波的測試負責（例如 member 在 Front 用 `/me`）。

| operation | 未登入（Admin 的 Origin） | member @ Front | editor-clinic @ Back | editor-clinic @ Admin | admin @ Front | admin @ Back |
| --- | --- | --- | --- | --- | --- | --- |
| `listAssignablePrincipals`（`contentType=album`） | 401 | 403 `FORBIDDEN` | 403 `FORBIDDEN` | 403 `FORBIDDEN` | 403 `FORBIDDEN` | |
| `batchPatchEntries` | 401 | 403 `SURFACE_FORBIDDEN` | 403 `FORBIDDEN` | 403 `FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | |
| `requestPublish` | 401 | 403 `SURFACE_FORBIDDEN` | 403 `FORBIDDEN` | 403 `FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | |
| `cancelPublishRequest` | 401 | 403 `SURFACE_FORBIDDEN` | 403 `FORBIDDEN` | 403 `FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | |
| `getAuditEvent` | 401 | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | 403 `FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` |
| `listMyEntries` | 401 | | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | | 403 `SURFACE_FORBIDDEN` |
| `getMyEntry` | 401 | | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | | 403 `SURFACE_FORBIDDEN` |
| `createMyEntry` | 401 | | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | 403 `FORBIDDEN` | 403 `SURFACE_FORBIDDEN` |
| `getAuditSettings` | 401 | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | 403 `FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` |
| `patchAuditSettings` | 401 | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | 403 `FORBIDDEN` | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` |

- `listAssignablePrincipals` 在 Front 回 `FORBIDDEN` 而不是 `SURFACE_FORBIDDEN`：它檢查的是「呼叫者在自己的 surface 對該類型有 `update`」（BW2 契約已這樣寫），`update` 不在 Front 的 hard-deny 集合內。這是既有行為，本波次只把它固定下來。
- `admin @ Front` 的 `/me` 讀取兩格留空：admin 在 Front 可以讀 `/me`（只看得到自己的，種子資料裡是空的，BW3 §4.3）；建立則因為 admin 在 Front 沒有 `create` 而 403 `FORBIDDEN`。
- `admin @ Back` 的前四格留空：admin 在 Back 有這些權限。
- 被拒的 `getAuditEvent`、`*AuditSettings` 會寫 `denied` 審計（BW2 既有），測試不檢查它，也不會改變任何資料。
- 同一個帳號在另一個 surface 登入會撤銷它先前的 session（BW1c 預演時發現），所以測試一列跑完才登入下一列。

**T05 是補測試，不是測試先行**：它保護 BW2～BW4 已有的行為，建立後就應該是綠的。若有任何一格失敗，代表前面波次的實作與契約不一致：**停下來回報**失敗訊息（測試會列出每一個不符的格子），不要改測試的預期值來遷就。

### 5.4 效能量測與紀錄（T08）

**門檻**（02 §5.4，不變）：

| 目標 | 門檻 | 由誰檢查 | BW4 細化時預演（3 次） |
| --- | --- | --- | --- |
| 工作列表，一頁 20 筆，含 `q` 與一個 `filter` | p95 ≤ 150 ms | `ListQueryPerformanceTests`（`integrationTest`） | 41、41、43 ms |
| 公開列表，一頁 20 筆 | p95 ≤ 100 ms | 同上 | 41、38、42 ms |
| 單筆 PATCH（含索引重建） | p95 ≤ 80 ms | 同上 | 8、8、9 ms |
| 一次請求內的 SQL 數（列表） | ≤ 5，與筆數無關 | 同上（`queryEntries` 2 句）＋`ListQueryCountTests`（`test`） | 4 |

量測方法（資料產生、暖機、p95 的算法、只量 store 層的理由）見 [BW1b §5.6](BW1b.md#56-效能量測方法t11)；本波次不改測試本身。

**量測腳本**：在 `apps/cms-scaffold` 執行。它跑三次效能測試（`--rerun-tasks` 讓 Gradle 不因為輸入沒變而跳過），每次從 JUnit 的 XML 報告取出測試印出的那一行：

```bash
for i in 1 2 3; do
  ./gradlew :services:cms-api:integrationTest --tests '*ListQueryPerformanceTests' --rerun-tasks -q || echo "run $i FAILED"
  grep -ho 'BW1b perf[^&<]*' services/cms-api/build/test-results/integrationTest/TEST-*ListQueryPerformanceTests.xml
done
./gradlew :services:cms-api:test --tests '*ListQueryCountTests' -q && echo "ListQueryCountTests passed"
```

預期輸出三行 `BW1b perf (10000 entries): work list p95 … ms, public list p95 … ms, patch p95 … ms`，最後一行 `ListQueryCountTests passed`，沒有 `FAILED`。

**紀錄**：在 [`docs/v2/perf-records.md`](../perf-records.md) 的表格末尾加三列（每次一列），欄位依表頭：日期、量測者（`BW4 實作`）、環境（作業系統、CPU 核數 `nproc`、PostgreSQL 版本、JDK 版本）、三個 p95、SQL 數（固定 4，來自測試斷言）、結果（`達標` 或 `未達標`）。同樣三列貼進 PR 說明。

**未達標時的處理**：

1. 效能測試本身就是門檻：任何一次失敗，`integrationTest` 紅燈，PR 不能合併。
2. 在同一台機器再跑腳本一次。若仍未達標，用 `EXPLAIN (ANALYZE, BUFFERS)` 檢查對應 SQL（`JdbcContentStore.queryEntries` 印出的 SQL 與參數），常見原因是缺索引或 planner 沒用索引列。
3. 可以做的修正：只限 BW4 範圍內能改的東西（新增 migration 補索引，例如 V10）；需要改 SQL 產生方式或 schema 設計時，**停下來回報**，附上三次輸出與 `EXPLAIN` 結果，由 owner 決定（屆時一併評估 [02 BQ-05](../02-backend-sdd.md#8-開放問題) 的 GIN 選項）。
4. 不得調高門檻、跳過或 `@Disabled` 測試、減少資料筆數。
5. 只在 CI 失敗、本機達標時：依 AGENTS.md 只重跑一次 CI；再失敗就當成真的未達標，照第 2～3 步處理，並在 `perf-records.md` 加一列 CI 的結果（環境寫 `GitHub Actions ubuntu-latest`）。

### 5.5 應用程式在 PostgreSQL 上：JDBC store 與審計回滾（T06、T07）

**發現（BW4 細化，2026-09-25）。** 寫 02 BQ-12 的測試時，以 PostgreSQL 啟動整個應用程式，結果 `IdentityStore`、`ContentStore`、`MediaStore` 都是 in-memory 版本。原因：三個 `*StoreConfig` 以 `@ConditionalOnBean(DataSource.class)` 選 JDBC store，但這個條件在一般 `@Configuration` 上是在 Spring Boot 的自動設定定義 `DataSource` **之前**判斷的，所以永遠不成立。後果：正式環境的資料只存在記憶體，重啟就消失；`./gradlew test` 本來就用 in-memory，所以一直沒被發現。JDBC store 本身由 store 契約測試保證，問題只在接線。

**修正**：與 BW2 的 `TransactionRunner` 相同，在 bean 方法內以 `ObjectProvider<DataSource>` 判斷：有 DataSource（identity 另外要有 `PlatformTransactionManager`）就建 JDBC store，否則 in-memory。bean 名稱改成 `identityStore`、`contentStore`、`mediaStore`；沒有程式以名稱取用它們。

**回滾測試（02 BQ-12）**：`AuditRollbackIntegrationTests` 以 Testcontainers 的 PostgreSQL 啟動整個應用程式（`spring.autoconfigure.exclude` 清空、Flyway 開啟，覆蓋 `src/test/resources/application.yaml` 為 `./gradlew test` 關掉的資料庫設定）。`IdentityStore` 以 `@MockitoSpyBean` 包起來：`entry.publish` 的事件改成以一個不存在的 principal id 當 actor，交給同一個 DataSource 上的 `JdbcIdentityStore` 寫入，於是在資料庫違反 `cms_audit_event.actor_principal_id` 的外鍵。其他事件照常寫入。

- 種子密碼：`integrationTest` 的 classpath 上，main 的 `application.yaml` 排在 test 的前面，所以 `cms.identity.seed-password` 會是空字串。測試以 `@DynamicPropertySource` 設一個每次執行都不同的隨機值（`UUID`），不寫進任何檔案。
- 這個類別自己啟動一個 PostgreSQL 容器，不使用 `contract/PostgresFixture`（它是 package-private，而且給 store 契約用）。

`src/main/java/com/fallrising/cms/identity/web/IdentityStoreConfig.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/web/IdentityStoreConfig.java
+++ b/src/main/java/com/fallrising/cms/identity/web/IdentityStoreConfig.java
@@ -3,8 +3,7 @@
 import com.fallrising.cms.identity.store.IdentityStore;
 import com.fallrising.cms.identity.store.InMemoryIdentityStore;
 import com.fallrising.cms.identity.store.JdbcIdentityStore;
-import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
-import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
+import org.springframework.beans.factory.ObjectProvider;
 import org.springframework.context.annotation.Bean;
 import org.springframework.context.annotation.Configuration;
 import org.springframework.transaction.PlatformTransactionManager;
@@ -12,18 +11,19 @@
 
 import javax.sql.DataSource;
 
+/**
+ * JDBC store when the application has a DataSource and a transaction manager, else in-memory (./gradlew test). The
+ * choice is made inside the bean method: @ConditionalOnBean on a user configuration is evaluated before Spring Boot's
+ * auto-configuration defines the DataSource, so it always chose the in-memory store (found in BW4, 02 BQ-12).
+ */
 @Configuration
 public class IdentityStoreConfig {
 
     @Bean
-    @ConditionalOnBean({DataSource.class, PlatformTransactionManager.class})
-    IdentityStore jdbcIdentityStore(DataSource dataSource, PlatformTransactionManager transactionManager) {
-        return new JdbcIdentityStore(dataSource, new TransactionTemplate(transactionManager));
-    }
-
-    @Bean
-    @ConditionalOnMissingBean(IdentityStore.class)
-    IdentityStore inMemoryIdentityStore() {
-        return new InMemoryIdentityStore();
+    IdentityStore identityStore(ObjectProvider<DataSource> dataSource,
+            ObjectProvider<PlatformTransactionManager> transactionManager) {
+        DataSource ds = dataSource.getIfAvailable();
+        PlatformTransactionManager tm = transactionManager.getIfAvailable();
+        return ds != null && tm != null ? new JdbcIdentityStore(ds, new TransactionTemplate(tm)) : new InMemoryIdentityStore();
     }
 }
```

`src/main/java/com/fallrising/cms/content/web/ContentStoreConfig.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/ContentStoreConfig.java
+++ b/src/main/java/com/fallrising/cms/content/web/ContentStoreConfig.java
@@ -4,25 +4,19 @@
 import com.fallrising.cms.content.store.InMemoryContentStore;
 import com.fallrising.cms.content.store.JdbcContentStore;
 import com.fasterxml.jackson.databind.ObjectMapper;
-import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
-import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
+import org.springframework.beans.factory.ObjectProvider;
 import org.springframework.context.annotation.Bean;
 import org.springframework.context.annotation.Configuration;
 
 import javax.sql.DataSource;
 
+/** JDBC store when the application has a DataSource, else in-memory; see IdentityStoreConfig for why not @ConditionalOnBean. */
 @Configuration
 public class ContentStoreConfig {
 
     @Bean
-    @ConditionalOnBean(DataSource.class)
-    ContentStore jdbcContentStore(DataSource dataSource, ObjectMapper objectMapper) {
-        return new JdbcContentStore(dataSource, objectMapper);
-    }
-
-    @Bean
-    @ConditionalOnMissingBean(ContentStore.class)
-    ContentStore inMemoryContentStore() {
-        return new InMemoryContentStore();
+    ContentStore contentStore(ObjectProvider<DataSource> dataSource, ObjectMapper objectMapper) {
+        DataSource ds = dataSource.getIfAvailable();
+        return ds != null ? new JdbcContentStore(ds, objectMapper) : new InMemoryContentStore();
     }
 }
```

`src/main/java/com/fallrising/cms/media/web/MediaStoreConfig.java`：

```diff
--- a/src/main/java/com/fallrising/cms/media/web/MediaStoreConfig.java
+++ b/src/main/java/com/fallrising/cms/media/web/MediaStoreConfig.java
@@ -5,9 +5,8 @@
 import com.fallrising.cms.media.store.LocalDiskMediaObjectStore;
 import com.fallrising.cms.media.store.MediaObjectStore;
 import com.fallrising.cms.media.store.MediaStore;
+import org.springframework.beans.factory.ObjectProvider;
 import org.springframework.beans.factory.annotation.Value;
-import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
-import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
 import org.springframework.context.annotation.Bean;
 import org.springframework.context.annotation.Configuration;
 
@@ -22,15 +21,10 @@
         return new LocalDiskMediaObjectStore(Path.of(root));
     }
 
+    /** JDBC store when the application has a DataSource, else in-memory; see IdentityStoreConfig. */
     @Bean
-    @ConditionalOnBean(DataSource.class)
-    MediaStore jdbcMediaStore(DataSource dataSource) {
-        return new JdbcMediaStore(dataSource);
-    }
-
-    @Bean
-    @ConditionalOnMissingBean(MediaStore.class)
-    MediaStore inMemoryMediaStore() {
-        return new InMemoryMediaStore();
+    MediaStore mediaStore(ObjectProvider<DataSource> dataSource) {
+        DataSource ds = dataSource.getIfAvailable();
+        return ds != null ? new JdbcMediaStore(ds) : new InMemoryMediaStore();
     }
 }
```

---

## 6. 任務卡

大小：S ≤ 150 行、M ≤ 400 行（只算手寫或手改的行；整檔複製算 1 行）。所有指令在 `apps/cms-scaffold` 執行。

### BW4-T01 【測試先行】保留設定與刪除的 store 契約

- **目標**：固定 store 的三個新方法。
- **輸入**：BW3 `VERIFIED`。
- **步驟**：套用 §7.1 的 `IdentityStoreContract.java` diff。
- **完成條件**：預期紅燈：`src/test` 編譯失敗（`AuditRetention`、`auditRetention`、`updateAuditRetention`、`deleteAuditsBefore` 不存在）。
- **驗證**：`./gradlew :services:cms-api:compileTestJava`（預期失敗）
- **對應 ID**：BW4 審計保留
- **大小**：S

### BW4-T02 V9 與 store

- **目標**：§4.5、§5.1。
- **輸入**：T01。
- **步驟**：
  1. 建立 §5.1 的 `AuditRetention.java`、`V9__audit_retention.sql`。
  2. 套用 §5.1 的三段 diff（`IdentityStore`、`InMemoryIdentityStore`、`JdbcIdentityStore`）。
- **完成條件**：`test` 225 個全綠（多 2 個 in-memory 契約）；`integrationTest` 74 個全綠（多 2 個 JDBC 契約；V9 由 `PostgresFixture` 的 Flyway 套用）。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：BW4 審計保留
- **大小**：S

### BW4-T03 【測試先行】保留設定端點與清理

- **目標**：把 §4.2、§4.4 寫成測試。
- **輸入**：T02。
- **步驟**：建立 §7.2 的 `AuditRetentionServiceTests.java`、`AuditRetentionApiTests.java`。
- **完成條件**：預期紅燈：`src/test` 編譯失敗（`AuditRetentionService`、`AuditPurgeJob` 不存在）。
- **驗證**：`./gradlew :services:cms-api:compileTestJava`（預期失敗）
- **對應 ID**：BW4 審計保留
- **大小**：M

### BW4-T04 保留設定端點、清理與排程

- **目標**：§5.2。
- **輸入**：T03。
- **步驟**：
  1. 套用 §5.2 的 `IdentityException` diff。
  2. 建立 §5.2 的 `AuditRetentionService.java`、`AuditPurgeJob.java`、`SchedulingConfig.java`、`AuditSettingsController.java`。
  3. 套用 §5.2 的 `application.yaml`、`openapi.yaml` 兩段 diff。
  4. `cmp docs/v2/contracts/BW4.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`，沒有輸出。
- **完成條件**：T03 的 4 個測試綠；`test` 229 個全綠（`OpenApiContractTests`、`OpenApiCompletenessTests` 涵蓋新路徑）；`integrationTest` 74 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：BW4 審計保留
- **大小**：M

### BW4-T05 surface 拒絕矩陣

- **目標**：§5.3。
- **輸入**：T04。
- **步驟**：建立 §7.3 的 `SurfaceMatrixTests.java`。
- **完成條件**：`SurfaceMatrixTests` 1 個綠（51 格全部符合）；`test` 230 個全綠。任何一格不符：依 §5.3 停下來回報。
- **驗證**：`./gradlew :services:cms-api:test`
- **對應 ID**：BW4 安全測試補齊
- **大小**：S

### BW4-T06 【測試先行】應用程式在 PostgreSQL 上

- **目標**：把 §5.5 的兩件事寫成測試。
- **輸入**：T05。
- **步驟**：建立 §7.4 的 `AuditRollbackIntegrationTests.java`（放在 `src/integrationTest`）。
- **完成條件**：預期紅燈正好 2 個：`BW4_applicationWithADataSourceUsesTheJdbcStores`（store 是 `InMemoryIdentityStore`）、`BQ12_failedAuditInsertRollsBackThePublish`（in-memory store 沒有交易，entry 變成 `published`）。其餘 74 個綠。
- **驗證**：`./gradlew :services:cms-api:integrationTest`（預期失敗）
- **對應 ID**：BQ-12、BQ-13
- **大小**：S

### BW4-T07 store 接線

- **目標**：§5.5 的修正。
- **輸入**：T06。
- **步驟**：套用 §5.5 的三段 diff（`IdentityStoreConfig`、`ContentStoreConfig`、`MediaStoreConfig`）。
- **完成條件**：`integrationTest` 76 個全綠；`test` 230 個全綠（沒有 DataSource，仍是 in-memory）。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：BQ-12、BQ-13
- **大小**：S

### BW4-T08 效能量測紀錄

- **目標**：§5.4。
- **輸入**：T07。
- **步驟**：
  1. 執行 §5.4 的量測腳本。
  2. 在 `docs/v2/perf-records.md` 的表格末尾加三列。
  3. 若未達標，依 §5.4「未達標時的處理」。
- **完成條件**：三次都達標且已記錄；`ListQueryCountTests passed`。
- **驗證**：§5.4 的腳本。
- **對應 ID**：BW4 效能量測記錄
- **大小**：S

### BW4-T09 完整閘門、狀態與 PR

- **目標**：交付。
- **輸入**：T08。
- **步驟**：
  1. 執行 §9 的完整閘門。
  2. `docs/v2/README.md` 路線圖中 BW4 的狀態從 `DOC_READY` 改成 `VERIFIED`。
  3. 逐項勾選 §9，貼進 PR 說明，連同 T08 的三列數字。PR 標題：`feat(cms-scaffold): BW4 後端硬化`。
- **完成條件**：§9 全部打勾；CI 的 `java`、`java-integration` 全綠；`web` 全綠，或只有 BW1c §2.1 所說的失敗並已在 PR 說明。
- **驗證**：§9 的指令。
- **對應 ID**：全部
- **大小**：S

---

## 7. 測試規格

### 7.1 store 契約（`IdentityStoreContract`，in-memory 與 JDBC 各跑一次）

| 測試 | 斷言 |
| --- | --- |
| `BW4_auditRetentionDefaultsToNinetyDaysAndRoundTrips` | 新 store 是 90 天、`updatedBy` null；寫入 30 天（含修改者）後讀回相同；再寫 365 天、修改者 null，讀回相同 |
| `BW4_deleteAuditsBeforeRemovesOnlyOlderEvents` | 三筆事件在 cutoff 前 1 秒、剛好 cutoff、後 1 秒：刪 1 筆，剩下兩筆；再刪一次回 0 |

`src/test/java/com/fallrising/cms/contract/IdentityStoreContract.java`：

```diff
--- a/src/test/java/com/fallrising/cms/contract/IdentityStoreContract.java
+++ b/src/test/java/com/fallrising/cms/contract/IdentityStoreContract.java
@@ -4,6 +4,7 @@
 import com.fallrising.cms.identity.domain.AuditEvent;
 import com.fallrising.cms.identity.domain.AuditPage;
 import com.fallrising.cms.identity.domain.AuditQuery;
+import com.fallrising.cms.identity.domain.AuditRetention;
 import com.fallrising.cms.identity.domain.Permission;
 import com.fallrising.cms.identity.domain.Principal;
 import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
@@ -233,6 +234,31 @@
     }
 
     @Test
+    void BW4_auditRetentionDefaultsToNinetyDaysAndRoundTrips() {
+        AuditRetention initial = store.auditRetention();
+        assertThat(initial.days()).isEqualTo(90);
+        assertThat(initial.updatedBy()).isNull();
+        Principal anna = principal("anna");
+        store.insertPrincipal(anna);
+        store.updateAuditRetention(new AuditRetention(30, T0.plusSeconds(5), anna.id()));
+        assertThat(store.auditRetention()).isEqualTo(new AuditRetention(30, T0.plusSeconds(5), anna.id()));
+        store.updateAuditRetention(new AuditRetention(365, T0.plusSeconds(6), null));
+        assertThat(store.auditRetention()).isEqualTo(new AuditRetention(365, T0.plusSeconds(6), null));
+    }
+
+    @Test
+    void BW4_deleteAuditsBeforeRemovesOnlyOlderEvents() {
+        AuditEvent old = audit("LOGIN_SUCCESS", UUID.randomUUID(), T0.minusSeconds(1));
+        AuditEvent edge = audit("LOGIN_SUCCESS", UUID.randomUUID(), T0);
+        AuditEvent fresh = audit("LOGOUT", UUID.randomUUID(), T0.plusSeconds(1));
+        List.of(old, edge, fresh).forEach(store::insertAudit);
+        assertThat(store.deleteAuditsBefore(T0)).isEqualTo(1);
+        assertThat(store.listAudits(null, null)).extracting(AuditEvent::id).containsExactly(fresh.id(), edge.id());
+        assertThat(store.findAudit(old.id())).isEmpty();
+        assertThat(store.deleteAuditsBefore(T0)).isZero();
+    }
+
+    @Test
     void B08_lastAdminGuard() {
         Role admin = role("admin");
         store.insertRole(admin);
```

### 7.2 保留設定與清理

`AuditRetentionServiceTests`（單元，固定時鐘 2026-09-25T03:00Z）：四筆事件在 100、90、40、10 天前。保留 90 天時清理刪 1 筆（100 天；剛好 90 天的保留）；改成 30 天再清理刪 2 筆（90、40 天）；改成 365 天再清理刪 0 筆。

`src/test/java/com/fallrising/cms/identity/service/AuditRetentionServiceTests.java`：

```java
package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.AuditRetention;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fallrising.cms.platform.TransactionRunner;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** surface-admin §7.2: the purge deletes events older than the retention; a shorter retention applies at the next run. */
class AuditRetentionServiceTests {

    static final Instant NOW = Instant.parse("2026-09-25T03:00:00Z");

    @Test
    void BW4_purgeDeletesEventsOlderThanTheRetention() {
        InMemoryIdentityStore store = new InMemoryIdentityStore();
        ObjectMapper mapper = new ObjectMapper();
        AuditRetentionService service = new AuditRetentionService(store, new AuthorizationService(store, mapper),
                TransactionRunner.withoutDatabase(), new AuditLog(store, mapper), Clock.fixed(NOW, ZoneOffset.UTC));
        AuditEvent days100 = event(NOW.minus(Duration.ofDays(100)));
        AuditEvent days90 = event(NOW.minus(Duration.ofDays(90)));
        AuditEvent days40 = event(NOW.minus(Duration.ofDays(40)));
        AuditEvent days10 = event(NOW.minus(Duration.ofDays(10)));
        List.of(days100, days90, days40, days10).forEach(store::insertAudit);

        assertThat(service.purgeExpired()).isEqualTo(1);
        assertThat(store.listAudits(null, null)).extracting(AuditEvent::id)
                .containsExactly(days10.id(), days40.id(), days90.id());

        store.updateAuditRetention(new AuditRetention(30, NOW, null));
        assertThat(service.purgeExpired()).isEqualTo(2);
        assertThat(store.listAudits(null, null)).extracting(AuditEvent::id).containsExactly(days10.id());

        store.updateAuditRetention(new AuditRetention(365, NOW, null));
        assertThat(service.purgeExpired()).isZero();
    }

    private static AuditEvent event(Instant at) {
        return new AuditEvent(UUID.randomUUID(), at, null, "AUTH", "LOGIN_SUCCESS", "principal", UUID.randomUUID(), "admin",
                "ok", null, null);
    }
}
```

`AuditRetentionApiTests`（MockMvc）。每個測試結束時把設定還原成 90 天、`updatedBy` null，讓測試順序不影響結果。

| 測試 | # | 動作 | 斷言 |
| --- | --- | --- | --- |
| `BW4_adminChangesRetentionAndTheChangeIsAudited` | 1 | admin 讀設定 | 90；`allowedDays` `[30, 90, 365]`；`updatedBy` null |
| | 2 | 改成 30 | 200；30；`updatedBy` 是 admin 的 id；再讀是 30；`settings.retention_updated` 多 1 筆 |
| | 3 | 讀最新一筆事件 | `SETTINGS`、`settings`、`admin`、`seed-admin`；`detail` `{"from":90,"to":30}` |
| | 4 | 再改成 30 | 200；事件數不變 |
| `BW4_retentionOutsideThirtyNinetyOrThreeSixtyFiveIsRejected` | 1 | 45 | 422 `FIELD_VALIDATION`，`retentionDays` `NOT_IN_ENUM` |
| | 2 | `{}` | 422 `REQUIRED` |
| | 3 | `"30"` | 422 `WRONG_TYPE` |
| | 4 | 多一個 `purgeNow` | 400 `VALIDATION_FAILED` |
| | 5 | 再讀 | 仍是 90 |
| `BW4_purgeRunsDailyStartingAnHourAfterStartup` | 1 | 查 `ScheduledTaskHolder` | 正好一個 `AuditPurgeJob.run` 的 fixed-delay 工作，間隔 24 小時、初始延遲 1 小時 |

`src/test/java/com/fallrising/cms/AuditRetentionApiTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.identity.domain.AuditRetention;
import com.fallrising.cms.identity.service.AuditPurgeJob;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.scheduling.config.FixedDelayTask;
import org.springframework.scheduling.config.ScheduledTaskHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** surface-admin §7.2 and 02 BQ-03: GET/PATCH /admin/settings/audit and the scheduled purge. */
@SpringBootTest
@AutoConfigureMockMvc
class AuditRetentionApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    IdentityStore identityStore;

    @Autowired
    ScheduledTaskHolder scheduledTasks;

    @Value("${cms.identity.seed-password}")
    String password;

    @AfterEach
    void restoreDefault() {
        identityStore.updateAuditRetention(new AuditRetention(AuditRetention.DEFAULT_DAYS, Instant.now(), null));
    }

    @Test
    void BW4_adminChangesRetentionAndTheChangeIsAudited() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        mockMvc.perform(admin.apply(get("/api/v1/admin/settings/audit")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.retentionDays").value(90))
                .andExpect(jsonPath("$.allowedDays").value(equalTo(List.of(30, 90, 365))))
                .andExpect(jsonPath("$.updatedBy").isEmpty());
        long before = retentionEvents(admin);

        String adminId = mapper.readTree(mockMvc.perform(admin.apply(get("/api/v1/auth/me")))
                .andReturn().getResponse().getContentAsString()).at("/principal/id").asText();
        retention(admin, "{\"retentionDays\":30}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.retentionDays").value(30))
                .andExpect(jsonPath("$.updatedBy").value(adminId));
        mockMvc.perform(admin.apply(get("/api/v1/admin/settings/audit"))).andExpect(jsonPath("$.retentionDays").value(30));
        assertThat(retentionEvents(admin)).isEqualTo(before + 1);

        JsonNode latest = json(mockMvc.perform(admin.apply(get("/api/v1/admin/audit")
                .param("action", "settings.retention_updated").param("size", "1"))));
        assertThat(latest.at("/items/0/category").asText()).isEqualTo("SETTINGS");
        assertThat(latest.at("/items/0/targetType").asText()).isEqualTo("settings");
        assertThat(latest.at("/items/0/surface").asText()).isEqualTo("admin");
        assertThat(latest.at("/items/0/actor/username").asText()).isEqualTo("seed-admin");
        JsonNode detail = json(mockMvc.perform(admin.apply(
                get("/api/v1/admin/audit/{id}", latest.at("/items/0/id").asText()))));
        assertThat(detail.get("detail")).isEqualTo(mapper.readTree("{\"from\":90,\"to\":30}"));

        retention(admin, "{\"retentionDays\":30}").andExpect(status().isOk());
        assertThat(retentionEvents(admin)).isEqualTo(before + 1);
    }

    @Test
    void BW4_retentionOutsideThirtyNinetyOrThreeSixtyFiveIsRejected() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        retention(admin, "{\"retentionDays\":45}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))
                .andExpect(jsonPath("$.error.fields[0].field").value("retentionDays"))
                .andExpect(jsonPath("$.error.fields[0].code").value("NOT_IN_ENUM"));
        retention(admin, "{}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[0].code").value("REQUIRED"));
        retention(admin, "{\"retentionDays\":\"30\"}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[0].code").value("WRONG_TYPE"));
        retention(admin, "{\"retentionDays\":30,\"purgeNow\":true}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        mockMvc.perform(admin.apply(get("/api/v1/admin/settings/audit"))).andExpect(jsonPath("$.retentionDays").value(90));
    }

    @Test
    void BW4_purgeRunsDailyStartingAnHourAfterStartup() {
        List<FixedDelayTask> purge = scheduledTasks.getScheduledTasks().stream()
                .map(t -> t.getTask())
                .filter(t -> t instanceof FixedDelayTask)
                .map(t -> (FixedDelayTask) t)
                .filter(t -> t.getRunnable().toString().equals(AuditPurgeJob.class.getName() + ".run"))
                .toList();
        assertThat(purge).hasSize(1);
        assertThat(purge.get(0).getIntervalDuration()).isEqualTo(Duration.ofHours(24));
        assertThat(purge.get(0).getInitialDelayDuration()).isEqualTo(Duration.ofHours(1));
    }

    private ResultActions retention(TestSession session, String body) throws Exception {
        return mockMvc.perform(session.apply(patch("/api/v1/admin/settings/audit")
                .contentType(MediaType.APPLICATION_JSON).content(body)));
    }

    private long retentionEvents(TestSession admin) throws Exception {
        return json(mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("action", "settings.retention_updated"))))
                .get("total").asLong();
    }

    private JsonNode json(ResultActions result) throws Exception {
        return mapper.readTree(result.andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
}
```

### 7.3 `SurfaceMatrixTests`（MockMvc）

前置：以 `seed-operator-album` 在 Back 建立一本相簿（`requestPublish`、`cancelPublishRequest`、`batchPatchEntries` 用它的 id）；`getAuditEvent`、`getMyEntry` 用隨機 UUID（授權先於查找）。預期值見 §5.3 的表。失敗時，訊息列出每一個不符的格子，例如 `seed-admin @ http://localhost:5174 getAuditSettings: expected 403 FORBIDDEN, got 403 SURFACE_FORBIDDEN`。

`src/test/java/com/fallrising/cms/SurfaceMatrixTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 02 §6: every endpoint added after BW0 is denied on each surface where it does not belong, and to callers without
 * the permission. One row per (account, surface); each cell is the expected "status code" of one endpoint. Rows run
 * one after another because a new login of the same account revokes its earlier session.
 */
@SpringBootTest
@AutoConfigureMockMvc
class SurfaceMatrixTests {

    static final String UNAUTH = "401 UNAUTHENTICATED";
    static final String SURFACE = "403 SURFACE_FORBIDDEN";
    static final String FORBIDDEN = "403 FORBIDDEN";

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    record Row(String username, String origin, Map<String, String> expected) {}

    @Test
    void BW4_newEndpointsAreDeniedOnEverySurfaceWhereTheyDoNotBelong() throws Exception {
        TestSession operator = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String album = new ApiFixture(mockMvc, mapper).create(operator, "album", Map.of("title", "Matrix")).get("id").asText();
        String anyId = UUID.randomUUID().toString();
        Map<String, Supplier<MockHttpServletRequestBuilder>> endpoints = new LinkedHashMap<>();
        endpoints.put("listAssignablePrincipals", () -> get("/api/v1/principals/assignable").param("contentType", "album"));
        endpoints.put("batchPatchEntries", () -> post("/api/v1/entries:batch-patch").contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[{\"id\":\"" + album + "\",\"version\":1,\"payload\":{\"title\":\"x\"}}]}"));
        endpoints.put("requestPublish", () -> post("/api/v1/entries/{id}/publish-request", album));
        endpoints.put("cancelPublishRequest", () -> delete("/api/v1/entries/{id}/publish-request", album));
        endpoints.put("getAuditEvent", () -> get("/api/v1/admin/audit/{id}", anyId));
        endpoints.put("listMyEntries", () -> get("/api/v1/me/content-types/pet/entries"));
        endpoints.put("getMyEntry", () -> get("/api/v1/me/entries/{id}", anyId));
        endpoints.put("createMyEntry", () -> post("/api/v1/me/content-types/appointment_request/entries")
                .contentType(MediaType.APPLICATION_JSON).content("{\"payload\":{\"reason\":\"x\"}}"));
        endpoints.put("getAuditSettings", () -> get("/api/v1/admin/settings/audit"));
        endpoints.put("patchAuditSettings", () -> patch("/api/v1/admin/settings/audit")
                .contentType(MediaType.APPLICATION_JSON).content("{\"retentionDays\":30}"));

        List<Row> rows = List.of(
                new Row(null, TestSession.ADMIN, all(endpoints, UNAUTH)),
                new Row("seed-member-clinic", TestSession.FRONT, cells(
                        "listAssignablePrincipals", FORBIDDEN, "batchPatchEntries", SURFACE, "requestPublish", SURFACE,
                        "cancelPublishRequest", SURFACE, "getAuditEvent", SURFACE, "getAuditSettings", SURFACE,
                        "patchAuditSettings", SURFACE)),
                new Row("seed-editor-clinic", TestSession.BACK, cells(
                        "listAssignablePrincipals", FORBIDDEN, "batchPatchEntries", FORBIDDEN, "requestPublish", FORBIDDEN,
                        "cancelPublishRequest", FORBIDDEN, "getAuditEvent", SURFACE, "listMyEntries", SURFACE,
                        "getMyEntry", SURFACE, "createMyEntry", SURFACE, "getAuditSettings", SURFACE,
                        "patchAuditSettings", SURFACE)),
                new Row("seed-editor-clinic", TestSession.ADMIN, cells(
                        "listAssignablePrincipals", FORBIDDEN, "batchPatchEntries", FORBIDDEN, "requestPublish", FORBIDDEN,
                        "cancelPublishRequest", FORBIDDEN, "getAuditEvent", FORBIDDEN, "listMyEntries", SURFACE,
                        "getMyEntry", SURFACE, "createMyEntry", SURFACE, "getAuditSettings", FORBIDDEN,
                        "patchAuditSettings", FORBIDDEN)),
                new Row("seed-admin", TestSession.FRONT, cells(
                        "listAssignablePrincipals", FORBIDDEN, "batchPatchEntries", SURFACE, "requestPublish", SURFACE,
                        "cancelPublishRequest", SURFACE, "getAuditEvent", SURFACE, "createMyEntry", FORBIDDEN,
                        "getAuditSettings", SURFACE, "patchAuditSettings", SURFACE)),
                new Row("seed-admin", TestSession.BACK, cells(
                        "getAuditEvent", SURFACE, "listMyEntries", SURFACE, "getMyEntry", SURFACE, "createMyEntry", SURFACE,
                        "getAuditSettings", SURFACE, "patchAuditSettings", SURFACE)));

        List<String> mismatches = new ArrayList<>();
        for (Row row : rows) {
            TestSession session = row.username() == null ? null
                    : TestSession.login(mockMvc, row.username(), password, row.origin());
            for (Map.Entry<String, String> cell : row.expected().entrySet()) {
                MockHttpServletRequestBuilder request = endpoints.get(cell.getKey()).get();
                MvcResult result = mockMvc.perform(session == null ? request.header("Origin", row.origin())
                        : session.apply(request)).andReturn();
                String actual = result.getResponse().getStatus() + " " + code(result);
                if (!actual.equals(cell.getValue())) {
                    mismatches.add(row.username() + " @ " + row.origin() + " " + cell.getKey() + ": expected "
                            + cell.getValue() + ", got " + actual);
                }
            }
        }
        assertThat(mismatches).isEmpty();
    }

    private String code(MvcResult result) throws Exception {
        JsonNode body = mapper.readTree(result.getResponse().getContentAsString());
        return body.at("/error/code").asText();
    }

    private static Map<String, String> all(Map<String, ?> endpoints, String expected) {
        Map<String, String> cells = new LinkedHashMap<>();
        endpoints.keySet().forEach(name -> cells.put(name, expected));
        return cells;
    }

    private static Map<String, String> cells(String... pairs) {
        Map<String, String> cells = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) cells.put(pairs[i], pairs[i + 1]);
        return cells;
    }
}
```

### 7.4 `AuditRollbackIntegrationTests`（`integrationTest`，Testcontainers）

| 測試 | 斷言 |
| --- | --- |
| `BW4_applicationWithADataSourceUsesTheJdbcStores` | 三個 store 分別是 `JdbcIdentityStore`、`JdbcContentStore`、`JdbcMediaStore` |
| `BQ12_failedAuditInsertRollsBackThePublish` | operator 建立相簿；讓 `entry.publish` 的審計寫入違反外鍵後發布：500 `INTERNAL_ERROR`；entry 仍是 `draft`、`version` 與 revision 數不變；審計沒有這筆的 `entry.publish` |

`src/integrationTest/java/com/fallrising/cms/AuditRollbackIntegrationTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import com.fallrising.cms.media.store.JdbcMediaStore;
import com.fallrising.cms.media.store.MediaStore;
import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import javax.sql.DataSource;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 02 BQ-12 (BD-09): the application on PostgreSQL. When the audit insert of a state change fails in the database,
 * the state change of the same request is rolled back. The failure is a real foreign-key violation: the
 * entry.publish event is written with an actor id that is not a principal. Also checks that the application on a
 * DataSource uses the JDBC stores (it did not before BW4; see IdentityStoreConfig).
 */
@SpringBootTest(properties = {"spring.autoconfigure.exclude=", "spring.flyway.enabled=true"})
@AutoConfigureMockMvc
@Testcontainers
class AuditRollbackIntegrationTests {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    /** A random seed password per run: main's application.yaml precedes the test one on this classpath. */
    static final String SEED = UUID.randomUUID().toString();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("cms.identity.seed-password", () -> SEED);
        registry.add("cms.media.root", () -> "./build/tmp-media");
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    DataSource dataSource;

    @Autowired
    PlatformTransactionManager transactionManager;

    @Autowired
    ContentStore contentStore;

    @Autowired
    MediaStore mediaStore;

    @MockitoSpyBean
    IdentityStore identityStore;

    @Test
    void BW4_applicationWithADataSourceUsesTheJdbcStores() {
        assertThat(identityStore).isInstanceOf(JdbcIdentityStore.class);
        assertThat(contentStore).isInstanceOf(JdbcContentStore.class);
        assertThat(mediaStore).isInstanceOf(JdbcMediaStore.class);
    }

    @Test
    void BQ12_failedAuditInsertRollsBackThePublish() throws Exception {
        ApiFixture api = new ApiFixture(mockMvc, mapper);
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", SEED, TestSession.BACK);
        String id = api.create(op, "album", Map.of("title", "Rollback")).get("id").asText();
        JsonNode before = api.work(op, id);
        int revisions = revisionCount(op, id);

        JdbcIdentityStore direct = new JdbcIdentityStore(dataSource, new TransactionTemplate(transactionManager));
        doAnswer(invocation -> {
            AuditEvent event = invocation.getArgument(0);
            direct.insertAudit(!event.action().equals("entry.publish") ? event : new AuditEvent(event.id(), event.at(),
                    UUID.randomUUID(), event.category(), event.action(), event.targetType(), event.targetId(),
                    event.surface(), event.outcome(), event.ip(), event.detailJson()));
            return null;
        }).when(identityStore).insertAudit(any());

        api.action(op, id, "publish")
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error.code").value("INTERNAL_ERROR"));

        JsonNode after = api.work(op, id);
        assertThat(after.get("publicationState").asText()).isEqualTo("draft");
        assertThat(after.get("version").asInt()).isEqualTo(before.get("version").asInt());
        assertThat(revisionCount(op, id)).isEqualTo(revisions);
        TestSession admin = TestSession.login(mockMvc, "seed-admin", SEED, TestSession.ADMIN);
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("action", "entry.publish")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));
    }

    private int revisionCount(TestSession session, String id) throws Exception {
        return mapper.readTree(mockMvc.perform(session.apply(get("/api/v1/entries/{id}/revisions", id)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).get("items").size();
    }
}
```

### 7.5 故障注入

`AuditRetentionServiceTests` 以固定的 `Clock` 注入時間。`AuditRollbackIntegrationTests` 讓 `entry.publish` 的審計寫入在 PostgreSQL 違反外鍵（§7.4）。保留設定的 `PATCH` 不另外測資料庫失敗：它與 `publish` 同樣在 `TransactionRunner` 內；排程中的清理失敗由 Spring 記錄例外，下一次照常執行。

---

## 8. 失敗模式對照

| FM ID | 失敗情境 | 期望行為 | 由哪個測試覆蓋 | 任務卡 |
| --- | --- | --- | --- | --- |
| BW4-FM01 | 未登入 | 401 | `SurfaceMatrixTests` | T05 |
| BW4-FM02 | Front／Back 呼叫設定端點 | 403 `SURFACE_FORBIDDEN`，寫 `denied` 審計 | `SurfaceMatrixTests` | T05 |
| BW4-FM03 | 沒有 `manage_settings` | 403 `FORBIDDEN`，寫 `denied` 審計 | `SurfaceMatrixTests` | T05 |
| BW4-FM04 | 天數不是 30／90／365、缺少、型別錯 | 422 `FIELD_VALIDATION` 與 `error.fields` | `BW4_retentionOutside…` | T03、T04 |
| BW4-FM05 | body 有其他屬性 | 400 | `BW4_retentionOutside…` | T03、T04 |
| BW4-FM06 | 設成目前的值 | 200，不寫審計 | `BW4_adminChanges…`（步驟 4） | T03、T04 |
| BW4-FM07 | 縮短保留期限 | 不立即刪；下一次清理生效 | `AuditRetentionServiceTests` | T03、T04 |
| BW4-FM08 | 事件剛好在邊界 | 保留 | 契約 `BW4_deleteAuditsBefore…`；`AuditRetentionServiceTests`（90 天那筆） | T01～T04 |
| BW4-FM09 | 繞過服務寫入非法天數 | `AuditRetention` 建構時拋出；資料庫 `CHECK` 拒絕 | 沒有獨立測試（建構子一行檢查） | T02 |
| BW4-FM10 | 排程沒有啟用（忘了 `@EnableScheduling`） | 測試失敗 | `BW4_purgeRuns…` | T03、T04 |
| BW4-FM11 | 多個實例同時清理 | 重複 `DELETE` 無害 | 沒有測試（單一實例） | — |
| BW4-FM12 | 既有資料庫升級 | V9 建表並寫入 90 天 | JDBC 契約（Flyway 從 V1 套到 V9） | T02 |
| BW4-FM13 | 前面波次的端點在錯的 surface 被允許 | 矩陣測試失敗；停下來回報 | `SurfaceMatrixTests` | T05 |
| BW4-FM14 | 效能未達標 | `integrationTest` 紅燈；依 §5.4 處理 | `ListQueryPerformanceTests` | T08 |
| BW4-FM15 | 資料庫失敗 | 500，交易回滾（不變） | BW0 `ApiExceptionHandlerTests` | — |
| BW4-FM16 | 審計寫入在資料庫失敗（02 BQ-12） | 500；同一個請求的狀態變更、revision 都回滾，不留審計 | `BQ12_failedAuditInsertRollsBackThePublish` | T06、T07 |
| BW4-FM17 | 應用程式有 DataSource 卻用 in-memory store（BW4 細化前的現況） | 啟動後三個 store 都是 JDBC | `BW4_applicationWithADataSourceUsesTheJdbcStores` | T06、T07 |

---

## 9. 交付檢查表

- [ ] T01～T09 全部完成。
- [ ] `./gradlew test` 全綠（預期 230 個＝BW3 的 223＋本波 7）。
- [ ] `./gradlew integrationTest` 全綠（預期 76 個＝BW3 的 72＋本波 4）。
- [ ] `npm ci && npm run lint && npm run typecheck && npm test && npm run build` 全綠；或只有 BW1c §2.1 的 codegen 新鮮度／fixture 型別失敗，並已在 PR 說明列出。
- [ ] `cmp docs/v2/contracts/BW4.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。
- [ ] `SurfaceMatrixTests` 綠，沒有改動 §5.3 的預期值。
- [ ] `AuditRollbackIntegrationTests` 2 個綠（應用程式在 PostgreSQL 上用 JDBC store；審計失敗時回滾）。
- [ ] §5.4 三次量測達標，`docs/v2/perf-records.md` 與 PR 說明都有三列數字。
- [ ] `gradle.lockfile` 沒有變動。
- [ ] 沒有秘密或密碼。
- [ ] `docs/v2/README.md` 的 BW4 狀態已改成 `VERIFIED`。
- [ ] PR 說明列出實際跑過的指令與結果。

---

## 10. BW4 必寫內容索引

| REFINE-PROMPT 要求 | 位置 |
| --- | --- |
| 量測腳本 | §5.4「量測腳本」 |
| 門檻值 | §5.4「門檻」 |
| 未達標時的處理方式 | §5.4「未達標時的處理」 |
