# BW5 施工圖 — 開放問題收尾

[回 v2 索引](../README.md) ・ 框架：[02 §7 BW5](../02-backend-sdd.md#7-後端波次)、[§8](../02-backend-sdd.md#8-開放問題) ・ 契約：[contracts/BW5.openapi.yaml](../contracts/BW5.openapi.yaml) ・ 前一波：[BW4](BW4.md)

狀態：**DOC_READY**（本檔合併即生效）  
日期：2026-09-26  
讀者：實作 BW5 的 agent。只讀本檔、`contracts/BW5.openapi.yaml` 與本檔引用的檔案就能完成，不需要做任何設計決定。

> **預演紀錄。** 本檔的程式碼、YAML 與測試，已套用在「BW4 施工圖完成後」的 `services/cms-api` 副本上，並逐張任務卡執行過（2026-09-26）。每張「測試先行」卡的預期紅燈、每張實作卡完成後的測試數，都是實際跑出來的（§6 各卡的完成條件）。最後 `./gradlew :services:cms-api:test` 239 個，唯一失敗的是 `CmsApiApplicationTests.runtimeIsJava25`（預演環境只有 JDK 21）；`integrationTest` 80 個全綠（本機 PostgreSQL 16.13，不是 Testcontainers）。

> **Owner 決定（2026-09-25）：** [02 BQ-06、07、08、10、11](../02-backend-sdd.md#8-開放問題) 都選 A。它們原本建議的波次（BW1c、BW2）已經細化完成，改早期波次就得重做之後每一波的施工圖，所以 owner 決定集中成本波次，以 BW4 完成後為基準。

---

## 1. 範圍

### 1.1 解決的 ID

| ID | 本波次做到什麼程度 | 任務卡 |
| --- | --- | --- |
| BQ-06 | `/principals/{id}` 系列 7 個 operation 在 id 不存在時回 404 `PRINCIPAL_NOT_FOUND`（原本 400 或 200） | T01、T02 |
| BQ-07 | 6 個媒體錯誤代碼改成大寫（§4.2 的對照表） | T03、T04 |
| BQ-08 | 管理端所有「會在資料庫層失敗成 500」的輸入都先驗證（§4.3 的盤點表） | T05、T06 |
| BQ-10 | 公開列表的 `ref.<field>` 依**已發布副本**的關聯篩選；V10 為既有資料補索引列 | T07、T08 |
| BQ-11 | 公開列表與會員列表的 `media-ref` 一次解析整頁；store 呼叫數與筆數無關 | T09～T12 |

### 1.2 不做

- 01 §1.2、AGENTS.md「不要做」全部。
- `/roles/{code}` 系列在角色不存在時仍回 400（BQ-06 只問 principal）。
- 前端的調整：前端以 BW5 的契約產生型別；W0、W1 施工圖的 MSW mock 用了 `"not_found"`，由前端波次依 §4.2 改（見 §2.1）。
- 並發下的重複 email：兩個請求同時用同一個 email 建立 principal，第二個仍會在資料庫的唯一索引失敗成 500。v2 的管理端是 demo 規模、單一管理者操作，本波次接受（§8 BW5-FM09）。
- 不新增依賴，所以 `gradle.lockfile` 不變。

---

## 2. 先決條件

### 2.1 前置波次

- **BW4 必須已是 `VERIFIED`**。本檔所有 diff 都以「BW4 施工圖完成後」的檔案為基準；不同時先停下來回報。
- **與前端的關係。** BW5 改了兩類前端看得到的錯誤（`PRINCIPAL_NOT_FOUND`、媒體代碼大寫）。依 [README 路線圖](../README.md#路線圖)，建議後端 BW0～BW5 先依序實作完，前端 W2（媒體）、W4（Admin）以 `contracts/BW5.openapi.yaml` 產生型別。若前端某一波已經以舊代碼實作，在該波的下一個 PR 依 §4.2 替換字串；本波次不改前端檔案。

### 2.2 環境

與 [BW0 §2.2](BW0.md#22-環境) 相同。T07、T08、T10 需要本機可以跑 `integrationTest`（Docker）。

### 2.3 查證過的外部事實

沒有新的依賴。預演中確認（2026-09-26）：

- Flyway 以類別名稱決定 Java migration 的版本；`V10__index_ref_fields extends V7__backfill_entry_index` 會以版本 10 執行 V7 的 `migrate`（V7 不是 `final`）。
- `@MockitoSpyBean` 包起來的 in-memory store，自己呼叫自己的 public 方法也會被記錄；所以 §5.5 的 `InMemoryMediaStore.findAll` 直接讀 map，不呼叫 `variantsOf`，否則 §7.6 的計數會隨筆數增加。

---

## 3. 檔案清單

路徑相對於 `apps/cms-scaffold/services/cms-api/`，另有註明者除外。**實作者不得碰清單以外的檔案。**

| 路徑 | 動作 | 用途 | 任務卡 |
| --- | --- | --- | --- |
| `src/test/java/com/fallrising/cms/PrincipalNotFoundApiTests.java` | 新增 | BQ-06 | T01 |
| `src/main/java/com/fallrising/cms/api/error/ErrorCode.java` | 修改 | `PRINCIPAL_NOT_FOUND`；媒體代碼大寫 | T02、T04 |
| `src/main/java/com/fallrising/cms/identity/IdentityException.java` | 修改 | `principalNotFound()` | T02 |
| `src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java` | 修改 | 404；principal 與權限的輸入驗證 | T02、T06 |
| `src/main/resources/openapi/openapi.yaml` | 修改 | 四段 diff；T08 後等於 `docs/v2/contracts/BW5.openapi.yaml` | T02、T04、T06、T08 |
| `src/test/java/com/fallrising/cms/MediaErrorCodeApiTests.java` | 新增 | BQ-07 | T03 |
| `src/test/java/com/fallrising/cms/AdminInputValidationApiTests.java` | 新增 | BQ-08 | T05 |
| `src/main/java/com/fallrising/cms/api/error/FieldErrorCode.java` | 修改 | `INVALID_FORMAT`、`DUPLICATE` | T06 |
| `src/main/java/com/fallrising/cms/content/web/AdminContentController.java` | 修改 | 類型建立的輸入驗證 | T06 |
| `src/test/java/com/fallrising/cms/contract/ContentStoreContract.java` | 修改 | BQ-10 store 契約 | T07 |
| `src/integrationTest/java/com/fallrising/cms/contract/EntryIndexBackfillTests.java` | 修改 | V10 | T07 |
| `src/test/java/com/fallrising/cms/PublicRefFilterApiTests.java` | 新增 | BQ-10 API | T07 |
| `src/main/java/com/fallrising/cms/content/index/EntryIndexer.java` | 修改 | ref 欄位一律有索引列 | T08 |
| `src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java` | 修改 | 公開範圍的 ref 篩選改用索引列 | T08 |
| `src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java` | 修改 | 同上 | T08 |
| `src/main/java/db/migration/V10__index_ref_fields.java` | 新增 | 重建索引列 | T08 |
| `src/test/java/com/fallrising/cms/contract/MediaStoreContract.java` | 修改 | 批次方法的契約 | T09 |
| `src/main/java/com/fallrising/cms/media/store/MediaStore.java` | 修改 | `findAll`、`attachmentsOfMedia(Collection)` | T10 |
| `src/main/java/com/fallrising/cms/media/store/InMemoryMediaStore.java` | 修改 | 實作 | T10 |
| `src/main/java/com/fallrising/cms/media/store/JdbcMediaStore.java` | 修改 | 實作 | T10 |
| `src/test/java/com/fallrising/cms/PublicMediaCountTests.java` | 新增 | BQ-11 呼叫數 | T11 |
| `src/main/java/com/fallrising/cms/media/service/MediaService.java` | 修改 | 批次解析 | T12 |
| `src/main/java/com/fallrising/cms/content/web/ContentProjection.java` | 修改 | `mediaRefs` | T12 |
| `src/main/java/com/fallrising/cms/content/web/PublicContentController.java` | 修改 | 公開列表用批次解析 | T12 |
| `src/main/java/com/fallrising/cms/content/web/MeController.java` | 修改 | 會員列表用批次解析 | T12 |
| `apps/cms-scaffold/docs/v2/README.md` | 修改 | 路線圖 BW5 狀態改 `VERIFIED` | T13 |

不會碰：`build.gradle.kts`、`gradle.lockfile`、既有 migration、上表以外的測試、前端、`e2e/`、workflow。

---

## 4. 契約

### 4.1 OpenAPI

完整契約是 [`docs/v2/contracts/BW5.openapi.yaml`](../contracts/BW5.openapi.yaml)，`info.version` 0.11.0，`ErrorCode` 40 個（加 `PRINCIPAL_NOT_FOUND`；6 個媒體代碼改名），`FieldErrorCode` 12 個（加 `INVALID_FORMAT`、`DUPLICATE`）。沒有新 operation。`ErrorCodeContractTests` 要求 Java enum 與契約一致，所以契約分四段隨 T02、T04、T06、T08 套用；T08 後以 `cmp` 確認。

### 4.2 錯誤代碼的變更（前端要知道的）

| 情境 | BW4 | BW5 |
| --- | --- | --- |
| `/principals/{id}` 系列（get、patch、disable、unlock、roles、password）的 id 不存在 | 400 `VALIDATION_FAILED`（message `not found`） | 404 `PRINCIPAL_NOT_FOUND` |
| `GET /principals/{id}/effective-permissions` 的 id 不存在 | 200，只有匿名 grant | 404 `PRINCIPAL_NOT_FOUND` |
| 媒體不存在 | 404 `not_found` | 404 `MEDIA_NOT_FOUND` |
| 變體不存在 | 404 `variant_not_available` | 404 `MEDIA_VARIANT_NOT_AVAILABLE` |
| 不允許的檔案類型 | 415 `unsupported_media_type` | 415 `MEDIA_UNSUPPORTED_TYPE` |
| 配額用完 | 409 `quota_exceeded` | 409 `MEDIA_QUOTA_EXCEEDED` |
| 檔案太大 | 413 `file_too_large` | 413 `MEDIA_FILE_TOO_LARGE` |
| 媒體已軟刪除 | 410 `gone` | 410 `MEDIA_GONE` |
| 建立類型的輸入錯誤 | 422 `FIELD_VALIDATION`，沒有 `error.fields`（只檢查 key） | 422 `FIELD_VALIDATION`，`error.fields` 列出全部問題（§4.3） |

HTTP 狀態碼除了前兩列都不變。Java enum 的常數名稱（`MEDIA_NOT_FOUND` 等）本來就是大寫，只有 wire 值改變，所以 `MediaException` 不必改。

### 4.3 BQ-08：資料庫限制與驗證的對照

盤點方法：從 V2～V9 列出每個 `VARCHAR(n)`、`CHECK`、`UNIQUE`，再找出管理端 API 能寫進去、但服務層沒有先檢查的欄位。

| 端點 | 輸入 | 資料庫限制 | BW4 | BW5 |
| --- | --- | --- | --- | --- |
| `POST /admin/content-types` | `key` | `^[a-z][a-z0-9_]{1,62}$`、唯一 | 422（沒有 fields） | `key` `INVALID_FORMAT`／`DUPLICATE`／`REQUIRED` |
| | `displayName`、`pluralDisplayName` | `VARCHAR(80)` | 500 | `TOO_LONG` |
| | `titleField` | `VARCHAR(63)` | 500 | `TOO_LONG` |
| | `slugPolicy` | `CHECK (required, optional, none)` | 500 | `NOT_IN_ENUM` |
| | `fields[i]` 為 null | — | 500（`NullPointerException`） | `fields[i]` `REQUIRED` |
| | `fields[i].key` | `NOT NULL`、`VARCHAR(63)`、類型內唯一 | 500 | `REQUIRED`／`TOO_LONG`／`DUPLICATE` |
| | `fields[i].type` | `VARCHAR(32)`（沒有 CHECK） | 500 或寫入無用的型別 | 不是 9 種欄位型別之一時 `NOT_IN_ENUM` |
| | `fields[i].refTarget` | `VARCHAR(63)` | 500 | `TOO_LONG` |
| `POST /principals`、`PATCH /principals/{id}` | `displayName` | `VARCHAR(80)` | 500 | 400 `VALIDATION_FAILED`，message 含 `displayName` |
| | `email` | `VARCHAR(254)`、`LOWER(email)` 唯一 | 500 | 400，message 含 `email`（太長）或 `email is taken`（其他 principal 已使用，不分大小寫；自己的不算） |
| `PUT /roles/{code}/permissions` | `contentTypeCode` | `VARCHAR(64)` | 500 | 400，message 含 `contentTypeCode` |

- 錯誤形式沿用各端點既有的慣例：類型建立是 422 與 `error.fields`（BW1c 的格式，路徑用 `displayName`、`fields[3].key` 這種 body 路徑）；principal 與權限是 400 `VALIDATION_FAILED`（與 `username is taken` 等既有訊息相同）。
- 類型建立一次回報全部問題，順序是 body 的順序（`key`、`displayName`、`pluralDisplayName`、`titleField`、`slugPolicy`、`fields[0]…`）；有任何問題就什麼都不寫。
- 其他管理端輸入已經有驗證，或寫進 `TEXT`／`JSONB`（例如 principal 的 `contentTypeCodes`、導覽的 `document`、媒體的 `title`），不在本表。

### 4.4 BQ-10：公開列表的關聯篩選

- **BW4 的行為**：公開列表的 `ref.<field>=<id>` 以 `cms_entry_ref` 篩選；這張表記錄的是**工作副本**的關聯。照片改到另一本相簿但還沒重新發布時，公開列表會把它列在新相簿（公開讀者看不到的狀態）。
- **BW5**：`EntryIndexer` 讓每個啟用的 `ref`、`principal-ref` 欄位都有索引列（`value_kind='ref'`，兩個 scope 各一列）。公開範圍（`IndexScope.PUBLISHED`）的 `ref.<field>` 改查 `cms_entry_index` 的 `published` 列；工作範圍不變，仍查 `cms_entry_ref`。
- **V10** 以目前的 `EntryIndexer` 重建全部索引列（同 V7），讓既有資料也有 ref 欄位的索引列。
- 連帶影響：ref 欄位有了索引列，所以 `filterable=true` 的 ref 欄位也能用 `filter.<field>`（與 `ref.<field>` 同樣比對 id 文字），predicate 也可以指向任何 ref 欄位（`PredicateIndexCheck` 只要求有索引列）。兩者都沒有擴大權限：`filter.*` 與 predicate 本來就只看得到呼叫者有權讀的範圍。

### 4.5 BQ-11：媒體批次解析

- **BW4 的行為**：公開列表每一筆 entry 的每個 `media-ref` 值，都各自查一次媒體、variants、附著、附著的 entry、類型與欄位，查詢數隨筆數增加（02 §5.4 的「與筆數無關」只對 content store 成立）。
- **BW5**：`MediaService.resolvePublicAll` 一次解析整頁。store 呼叫：媒體 `findAll`、`attachmentsOfMedia(Collection)` 各一次；content `findEntries` 兩次（附著的 entry、它們的 `publicRequiresPublishedRefs` 目標）；`findTypeByKey`、`fieldsOf` 每個**不同的**類型各一次。公開列表與會員列表（`/me`）都改用它；單筆端點仍呼叫 `resolvePublic`（它內部也走同一條路，只是一次一筆）。
- 「可以公開」的判斷與 BW4 完全相同（媒體可用；附著在已發布、未刪除、公開可讀的 entry 的 `publicBytes` 欄位；該 entry 的 `publicRequiresPublishedRefs` 目標也是已發布且公開可讀）；只改查詢方式。

### 4.6 範例

`POST /api/v1/admin/content-types`，body `{"key":"gallery","slugPolicy":"sometimes","fields":[{"key":"title"},{"key":"title","type":"photo"}]}`，`422`：

```json
{ "error": { "code": "FIELD_VALIDATION", "message": "3 invalid field(s); first: slugPolicy must be required, optional or none",
             "fields": [ { "field": "slugPolicy", "code": "NOT_IN_ENUM", "message": "slugPolicy must be required, optional or none" },
                         { "field": "fields[1].key", "code": "DUPLICATE", "message": "fields[1].key repeats an earlier field" },
                         { "field": "fields[1].type", "code": "NOT_IN_ENUM", "message": "fields[1].type is not a field type" } ] },
  "requestId": "…" }
```

`GET /api/v1/principals/<不存在的 id>`（admin，Admin），`404`：

```json
{ "error": { "code": "PRINCIPAL_NOT_FOUND", "message": "Principal not found" }, "requestId": "…" }
```

---

## 5. 模組規格

### 5.1 BQ-06（T02）

`PrincipalAdminService` 的 6 處 `IdentityException.validation("not found")` 改成 `IdentityException.principalNotFound()`；`effective` 先確認 principal 存在。契約：7 個 operation 的說明與回應加 404，移除「no principal with this id」的 400 說明（400 仍保留給格式錯誤的 id）。

`src/main/java/com/fallrising/cms/api/error/ErrorCode.java`：

```diff
--- a/src/main/java/com/fallrising/cms/api/error/ErrorCode.java
+++ b/src/main/java/com/fallrising/cms/api/error/ErrorCode.java
@@ -21,6 +21,7 @@
     CONTENT_TYPE_NOT_FOUND("CONTENT_TYPE_NOT_FOUND", HttpStatus.NOT_FOUND),
     NAVIGATION_NOT_FOUND("NAVIGATION_NOT_FOUND", HttpStatus.NOT_FOUND),
     AUDIT_EVENT_NOT_FOUND("AUDIT_EVENT_NOT_FOUND", HttpStatus.NOT_FOUND),
+    PRINCIPAL_NOT_FOUND("PRINCIPAL_NOT_FOUND", HttpStatus.NOT_FOUND),
     AUDIENCE_PARAM_REJECTED("AUDIENCE_PARAM_REJECTED", HttpStatus.BAD_REQUEST),
     INVALID_STATE_TRANSITION("INVALID_STATE_TRANSITION", HttpStatus.CONFLICT),
     SLUG_CONFLICT("SLUG_CONFLICT", HttpStatus.CONFLICT),
```

`src/main/java/com/fallrising/cms/identity/IdentityException.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/IdentityException.java
+++ b/src/main/java/com/fallrising/cms/identity/IdentityException.java
@@ -68,6 +68,10 @@
                 "admin");
     }
 
+    public static IdentityException principalNotFound() {
+        return new IdentityException(ErrorCode.PRINCIPAL_NOT_FOUND, "Principal not found", null, null, null);
+    }
+
     public static IdentityException auditNotFound() {
         return new IdentityException(ErrorCode.AUDIT_EVENT_NOT_FOUND, "Audit event not found", null, null, null);
     }
```

`src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java
+++ b/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java
@@ -90,7 +90,7 @@
 
     public Principal get(IdentityRequest request, UUID id) {
         authService.requireManagePrincipals(request);
-        return store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
+        return store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
     }
 
     public CreatedPrincipal create(IdentityRequest request, String username, String displayName, String email, String temporaryPassword) {
@@ -113,7 +113,7 @@
 
     public Principal patch(IdentityRequest request, UUID id, String displayName, String email, String status) {
         authService.requireManagePrincipals(request);
-        Principal current = store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
+        Principal current = store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
         Instant now = Instant.now();
         PrincipalStatus nextStatus = status == null ? current.status() : parseStatus(status);
         Principal updated = current.withProfile(displayName == null ? current.displayName() : displayName,
@@ -130,7 +130,7 @@
 
     public Principal disable(IdentityRequest request, UUID id) {
         authService.requireManagePrincipals(request);
-        Principal current = store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
+        Principal current = store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
         Principal updated = store.updatePrincipalKeepingUsableAdmin(current.withStatus(PrincipalStatus.DISABLED, Instant.now()));
         store.revokeAllForPrincipal(id, Instant.now(), null);
         audit(request, "PRINCIPAL_DISABLED", id);
@@ -139,7 +139,7 @@
 
     public Principal unlock(IdentityRequest request, UUID id) {
         authService.requireManagePrincipals(request);
-        Principal current = store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
+        Principal current = store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
         if (current.status() == PrincipalStatus.DISABLED) throw IdentityException.accountDisabled();
         Principal updated = current.withLock(0, null, PrincipalStatus.ACTIVE, Instant.now());
         store.updatePrincipal(updated);
@@ -148,7 +148,7 @@
 
     public void replaceRoles(IdentityRequest request, UUID id, List<RoleAssignmentInput> inputs) {
         authService.requireManagePrincipals(request);
-        store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
+        store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
         if (inputs == null) throw IdentityException.validation("roles are required");
         Set<String> seen = new HashSet<>();
         List<PrincipalRoleAssignment> assignments = new ArrayList<>();
@@ -168,7 +168,7 @@
 
     public String setPassword(IdentityRequest request, UUID id, String temporaryPassword) {
         authService.requireManagePrincipals(request);
-        Principal principal = store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
+        Principal principal = store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
         String password = temporaryPassword;
         if (password == null || password.isBlank()) password = SessionTokens.randomToken() + "Aa1";
         authService.validateNewPassword(principal.username(), password);
@@ -217,6 +217,7 @@
 
     public List<java.util.Map<String, Object>> effective(IdentityRequest request, UUID id) {
         authService.requireManagePrincipals(request);
+        store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
         return authorizationService.effectivePermissions(id);
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
-  version: 0.10.0
+  version: 0.11.0
   license:
     name: Proprietary
 servers:
@@ -235,8 +235,8 @@
       tags: [Principals]
       description: |
         Errors:
-        - 400 VALIDATION_FAILED: no principal with this id (message `not found`; see BQ-06).
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listPrincipals.
+        - 404 PRINCIPAL_NOT_FOUND: no principal with this id.
       parameters:
         - $ref: "#/components/parameters/Id"
       responses:
@@ -248,6 +248,7 @@
         "400": { $ref: "#/components/responses/Error400" }
         "401": { $ref: "#/components/responses/Error401" }
         "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
         "500": { $ref: "#/components/responses/Error500" }
     patch:
       operationId: patchPrincipal
@@ -255,9 +256,10 @@
       description: |
         Null or absent properties keep their current value.
         Errors:
-        - 400 VALIDATION_FAILED: no principal with this id, or `status` is not a PrincipalStatus.
+        - 400 VALIDATION_FAILED: `status` is not a PrincipalStatus.
         - 403 LAST_ADMIN: the change would leave no active admin.
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listPrincipals.
+        - 404 PRINCIPAL_NOT_FOUND: no principal with this id.
       parameters:
         - $ref: "#/components/parameters/Id"
         - $ref: "#/components/parameters/CsrfHeader"
@@ -275,6 +277,7 @@
         "400": { $ref: "#/components/responses/Error400" }
         "401": { $ref: "#/components/responses/Error401" }
         "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
         "415": { $ref: "#/components/responses/Error415" }
         "500": { $ref: "#/components/responses/Error500" }
   /api/v1/principals/{id}/disable:
@@ -284,9 +287,9 @@
       description: |
         Revokes every session of the principal.
         Errors:
-        - 400 VALIDATION_FAILED: no principal with this id.
         - 403 LAST_ADMIN: the principal is the last active admin.
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listPrincipals.
+        - 404 PRINCIPAL_NOT_FOUND: no principal with this id.
       parameters:
         - $ref: "#/components/parameters/Id"
         - $ref: "#/components/parameters/CsrfHeader"
@@ -299,6 +302,7 @@
         "400": { $ref: "#/components/responses/Error400" }
         "401": { $ref: "#/components/responses/Error401" }
         "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
         "500": { $ref: "#/components/responses/Error500" }
   /api/v1/principals/{id}/unlock:
     post:
@@ -306,9 +310,9 @@
       tags: [Principals]
       description: |
         Errors:
-        - 400 VALIDATION_FAILED: no principal with this id.
         - 403 ACCOUNT_DISABLED: a disabled principal cannot be unlocked.
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listPrincipals.
+        - 404 PRINCIPAL_NOT_FOUND: no principal with this id.
       parameters:
         - $ref: "#/components/parameters/Id"
         - $ref: "#/components/parameters/CsrfHeader"
@@ -321,6 +325,7 @@
         "400": { $ref: "#/components/responses/Error400" }
         "401": { $ref: "#/components/responses/Error401" }
         "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
         "500": { $ref: "#/components/responses/Error500" }
   /api/v1/principals/{id}/roles:
     put:
@@ -329,10 +334,11 @@
       description: |
         Replaces all role assignments. `editor` and `operator` need a non-empty `contentTypeCodes`.
         Errors:
-        - 400 VALIDATION_FAILED: no principal with this id, missing or duplicate role code,
-          unknown role, or editor/operator without an allowlist.
+        - 400 VALIDATION_FAILED: missing or duplicate role code, unknown role, or editor/operator
+          without an allowlist.
         - 403 LAST_ADMIN: the change would leave no active admin.
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listPrincipals.
+        - 404 PRINCIPAL_NOT_FOUND: no principal with this id.
       parameters:
         - $ref: "#/components/parameters/Id"
         - $ref: "#/components/parameters/CsrfHeader"
@@ -348,6 +354,7 @@
         "400": { $ref: "#/components/responses/Error400" }
         "401": { $ref: "#/components/responses/Error401" }
         "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
         "415": { $ref: "#/components/responses/Error415" }
         "500": { $ref: "#/components/responses/Error500" }
   /api/v1/principals/{id}/password:
@@ -358,9 +365,9 @@
         Sets a temporary password and revokes every session of the principal. When the body or
         `temporaryPassword` is omitted the server generates one. The password is returned once.
         Errors:
-        - 400 VALIDATION_FAILED: no principal with this id, or the password is shorter than
-          12 characters or equals the username.
+        - 400 VALIDATION_FAILED: the password is shorter than 12 characters or equals the username.
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listPrincipals.
+        - 404 PRINCIPAL_NOT_FOUND: no principal with this id.
       parameters:
         - $ref: "#/components/parameters/Id"
         - $ref: "#/components/parameters/CsrfHeader"
@@ -378,6 +385,7 @@
         "400": { $ref: "#/components/responses/Error400" }
         "401": { $ref: "#/components/responses/Error401" }
         "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
         "415": { $ref: "#/components/responses/Error415" }
         "500": { $ref: "#/components/responses/Error500" }
   /api/v1/principals/{id}/effective-permissions:
@@ -385,10 +393,10 @@
       operationId: effectivePermissions
       tags: [Principals]
       description: |
-        Lists anonymous grants plus the grants of every role of the principal. An unknown id
-        returns only the anonymous grants.
+        Lists anonymous grants plus the grants of every role of the principal.
         Errors:
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listPrincipals.
+        - 404 PRINCIPAL_NOT_FOUND: no principal with this id.
       parameters:
         - $ref: "#/components/parameters/Id"
       responses:
@@ -400,6 +408,7 @@
         "400": { $ref: "#/components/responses/Error400" }
         "401": { $ref: "#/components/responses/Error401" }
         "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
         "500": { $ref: "#/components/responses/Error500" }
   /api/v1/roles:
     get:
@@ -1780,6 +1789,7 @@
         - CONTENT_TYPE_NOT_FOUND
         - NAVIGATION_NOT_FOUND
         - AUDIT_EVENT_NOT_FOUND
+        - PRINCIPAL_NOT_FOUND
         - AUDIENCE_PARAM_REJECTED
         - INVALID_STATE_TRANSITION
         - SLUG_CONFLICT
```

### 5.2 BQ-07（T04）

`src/main/java/com/fallrising/cms/api/error/ErrorCode.java`：

```diff
--- a/src/main/java/com/fallrising/cms/api/error/ErrorCode.java
+++ b/src/main/java/com/fallrising/cms/api/error/ErrorCode.java
@@ -36,12 +36,12 @@
     REF_TARGET_NOT_FOUND("REF_TARGET_NOT_FOUND", HttpStatus.UNPROCESSABLE_ENTITY),
     REF_TARGET_WRONG_TYPE("REF_TARGET_WRONG_TYPE", HttpStatus.UNPROCESSABLE_ENTITY),
     PRINCIPAL_REF_UNRESOLVED("PRINCIPAL_REF_UNRESOLVED", HttpStatus.UNPROCESSABLE_ENTITY),
-    MEDIA_NOT_FOUND("not_found", HttpStatus.NOT_FOUND),
-    MEDIA_VARIANT_NOT_AVAILABLE("variant_not_available", HttpStatus.NOT_FOUND),
-    MEDIA_UNSUPPORTED_TYPE("unsupported_media_type", HttpStatus.UNSUPPORTED_MEDIA_TYPE),
-    MEDIA_QUOTA_EXCEEDED("quota_exceeded", HttpStatus.CONFLICT),
-    MEDIA_FILE_TOO_LARGE("file_too_large", HttpStatus.PAYLOAD_TOO_LARGE),
-    MEDIA_GONE("gone", HttpStatus.GONE),
+    MEDIA_NOT_FOUND("MEDIA_NOT_FOUND", HttpStatus.NOT_FOUND),
+    MEDIA_VARIANT_NOT_AVAILABLE("MEDIA_VARIANT_NOT_AVAILABLE", HttpStatus.NOT_FOUND),
+    MEDIA_UNSUPPORTED_TYPE("MEDIA_UNSUPPORTED_TYPE", HttpStatus.UNSUPPORTED_MEDIA_TYPE),
+    MEDIA_QUOTA_EXCEEDED("MEDIA_QUOTA_EXCEEDED", HttpStatus.CONFLICT),
+    MEDIA_FILE_TOO_LARGE("MEDIA_FILE_TOO_LARGE", HttpStatus.PAYLOAD_TOO_LARGE),
+    MEDIA_GONE("MEDIA_GONE", HttpStatus.GONE),
     ROUTE_NOT_FOUND("ROUTE_NOT_FOUND", HttpStatus.NOT_FOUND),
     METHOD_NOT_ALLOWED("METHOD_NOT_ALLOWED", HttpStatus.METHOD_NOT_ALLOWED),
     MEDIA_TYPE_NOT_SUPPORTED("MEDIA_TYPE_NOT_SUPPORTED", HttpStatus.UNSUPPORTED_MEDIA_TYPE),
```

`src/main/resources/openapi/openapi.yaml`：

```diff
--- a/src/main/resources/openapi/openapi.yaml
+++ b/src/main/resources/openapi/openapi.yaml
@@ -1460,9 +1460,9 @@
         Errors:
         - 400 VALIDATION_FAILED: the `file` part is missing.
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listMedia.
-        - 409 quota_exceeded: library or per-principal quota would be exceeded.
-        - 413 file_too_large: file is larger than the configured maximum.
-        - 415 unsupported_media_type: empty file or not an allowed type.
+        - 409 MEDIA_QUOTA_EXCEEDED: library or per-principal quota would be exceeded.
+        - 413 MEDIA_FILE_TOO_LARGE: file is larger than the configured maximum.
+        - 415 MEDIA_UNSUPPORTED_TYPE: empty file or not an allowed type.
       parameters:
         - $ref: "#/components/parameters/CsrfHeader"
       requestBody:
@@ -1507,7 +1507,7 @@
         Returns deleted media metadata as well.
         Errors:
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listMedia.
-        - 404 not_found: media does not exist.
+        - 404 MEDIA_NOT_FOUND: media does not exist.
       parameters:
         - $ref: "#/components/parameters/Id"
       responses:
@@ -1527,7 +1527,7 @@
       description: |
         Errors:
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listMedia.
-        - 404 not_found: media does not exist.
+        - 404 MEDIA_NOT_FOUND: media does not exist.
       parameters:
         - $ref: "#/components/parameters/Id"
         - $ref: "#/components/parameters/CsrfHeader"
@@ -1547,9 +1547,9 @@
         Errors:
         - 403 SURFACE_FORBIDDEN: called from the Front surface.
         - 403 FORBIDDEN: caller may not read this media.
-        - 404 not_found: media does not exist.
-        - 404 variant_not_available: variant is not original, thumbnail or web, or was not generated.
-        - 410 gone: media is soft-deleted.
+        - 404 MEDIA_NOT_FOUND: media does not exist.
+        - 404 MEDIA_VARIANT_NOT_AVAILABLE: variant is not original, thumbnail or web, or was not generated.
+        - 410 MEDIA_GONE: media is soft-deleted.
       parameters:
         - $ref: "#/components/parameters/Id"
         - $ref: "#/components/parameters/Variant"
@@ -1578,7 +1578,7 @@
       security: []
       description: |
         Errors:
-        - 404 not_found: media missing, deleted, or not attached to a published public entry field.
+        - 404 MEDIA_NOT_FOUND: media missing, deleted, or not attached to a published public entry field.
       parameters:
         - $ref: "#/components/parameters/Id"
       responses:
@@ -1597,7 +1597,7 @@
       security: []
       description: |
         Errors:
-        - 404 not_found: media not publicly readable, or the variant is unknown or missing.
+        - 404 MEDIA_NOT_FOUND: media not publicly readable, or the variant is unknown or missing.
       parameters:
         - $ref: "#/components/parameters/Id"
         - $ref: "#/components/parameters/Variant"
@@ -1732,7 +1732,7 @@
         application/json:
           schema: { $ref: "#/components/schemas/ErrorEnvelope" }
     Error413:
-      description: Payload too large (file_too_large).
+      description: Payload too large (MEDIA_FILE_TOO_LARGE).
       content:
         application/json:
           schema: { $ref: "#/components/schemas/ErrorEnvelope" }
@@ -1773,7 +1773,7 @@
     ErrorCode:
       type: string
       description: |
-        Every `error.code` the API can return. Media codes are lowercase for compatibility (BQ-07).
+        Every `error.code` the API can return. Media codes were lowercase until BW5 (BQ-07).
       enum:
         - UNAUTHENTICATED
         - INVALID_CREDENTIALS
@@ -1804,12 +1804,12 @@
         - REF_TARGET_NOT_FOUND
         - REF_TARGET_WRONG_TYPE
         - PRINCIPAL_REF_UNRESOLVED
-        - not_found
-        - variant_not_available
-        - unsupported_media_type
-        - quota_exceeded
-        - file_too_large
-        - gone
+        - MEDIA_NOT_FOUND
+        - MEDIA_VARIANT_NOT_AVAILABLE
+        - MEDIA_UNSUPPORTED_TYPE
+        - MEDIA_QUOTA_EXCEEDED
+        - MEDIA_FILE_TOO_LARGE
+        - MEDIA_GONE
         - ROUTE_NOT_FOUND
         - METHOD_NOT_ALLOWED
         - MEDIA_TYPE_NOT_SUPPORTED
```

### 5.3 BQ-08（T06）

規則見 §4.3。`AdminContentController.validateType` 收集全部 `FieldError` 後以 `ContentException.fieldErrors` 丟出（`error.code` 由 BW1c 的 `topLevelCode` 決定，這裡永遠是 `FIELD_VALIDATION`）；原本兩個只檢查 key 的 `ContentException.validation` 移除。`PrincipalAdminService.validateProfile` 在建立與修改時檢查；email 是否被使用，以 `listPrincipals()` 逐一比對（demo 規模，與 BW2 的 `assignable` 相同做法）。

`src/main/java/com/fallrising/cms/api/error/FieldErrorCode.java`：

```diff
--- a/src/main/java/com/fallrising/cms/api/error/FieldErrorCode.java
+++ b/src/main/java/com/fallrising/cms/api/error/FieldErrorCode.java
@@ -11,7 +11,9 @@
     INVALID_UUID,
     REF_TARGET_NOT_FOUND,
     REF_TARGET_WRONG_TYPE,
-    PRINCIPAL_REF_UNRESOLVED;
+    PRINCIPAL_REF_UNRESOLVED,
+    INVALID_FORMAT,
+    DUPLICATE;
 
     public String wire() {
         return name();
```

`src/main/java/com/fallrising/cms/content/web/AdminContentController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/AdminContentController.java
+++ b/src/main/java/com/fallrising/cms/content/web/AdminContentController.java
@@ -1,6 +1,7 @@
 package com.fallrising.cms.content.web;
 
-import com.fallrising.cms.api.error.ErrorCode;
+import com.fallrising.cms.api.error.FieldError;
+import com.fallrising.cms.api.error.FieldErrorCode;
 import com.fallrising.cms.content.ContentException;
 import com.fallrising.cms.content.domain.ContentTypeRecord;
 import com.fallrising.cms.content.domain.FieldRecord;
@@ -27,9 +28,11 @@
 
 import java.time.Instant;
 import java.util.ArrayList;
+import java.util.HashSet;
 import java.util.LinkedHashMap;
 import java.util.List;
 import java.util.Map;
+import java.util.Set;
 import java.util.UUID;
 
 @RestController
@@ -38,6 +41,10 @@
 
     private static final String SCHEMA = "SCHEMA";
 
+    /** Field types the content kernel understands (PayloadValidator, EntryIndexer). */
+    static final Set<String> FIELD_TYPES =
+            Set.of("string", "markdown", "int", "boolean", "datetime", "enum", "ref", "principal-ref", "media-ref");
+
     public record FieldBody(String key, String type, Boolean required, Boolean indexed, String refTarget, List<String> enumValues) {}
 
     public record TypeBody(
@@ -77,12 +84,8 @@
     @ResponseStatus(HttpStatus.CREATED)
     public Map<String, Object> createType(@RequestBody TypeBody body, HttpServletRequest request) {
         IdentityRequest identity = manageTypes(request);
-        if (body.key() == null || !body.key().matches("^[a-z][a-z0-9_]{1,62}$")) {
-            throw ContentException.validation(ErrorCode.FIELD_VALIDATION, "Invalid type key");
-        }
-        if (store.findTypeByKey(body.key()).isPresent()) {
-            throw ContentException.validation(ErrorCode.FIELD_VALIDATION, "Type already exists");
-        }
+        List<FieldError> errors = validateType(body);
+        if (!errors.isEmpty()) throw ContentException.fieldErrors(errors);
         Instant now = Instant.now();
         ContentTypeRecord type = new ContentTypeRecord(
                 UUID.randomUUID(),
@@ -124,6 +127,55 @@
         return typeJson(type);
     }
 
+    /**
+     * 02 BQ-08: everything the database would reject (column lengths, the slug_policy CHECK, the unique type key and
+     * field keys), plus unknown field types. All problems are returned together, in body order.
+     */
+    private List<FieldError> validateType(TypeBody body) {
+        List<FieldError> errors = new ArrayList<>();
+        if (body.key() == null || body.key().isBlank()) {
+            errors.add(new FieldError("key", FieldErrorCode.REQUIRED, "key is required"));
+        } else if (!body.key().matches("^[a-z][a-z0-9_]{1,62}$")) {
+            errors.add(new FieldError("key", FieldErrorCode.INVALID_FORMAT, "key must match ^[a-z][a-z0-9_]{1,62}$"));
+        } else if (store.findTypeByKey(body.key()).isPresent()) {
+            errors.add(new FieldError("key", FieldErrorCode.DUPLICATE, "a content type with this key exists"));
+        }
+        maxLength(errors, "displayName", body.displayName(), 80);
+        maxLength(errors, "pluralDisplayName", body.pluralDisplayName(), 80);
+        maxLength(errors, "titleField", body.titleField(), 63);
+        if (body.slugPolicy() != null && !List.of("required", "optional", "none").contains(body.slugPolicy())) {
+            errors.add(new FieldError("slugPolicy", FieldErrorCode.NOT_IN_ENUM, "slugPolicy must be required, optional or none"));
+        }
+        List<FieldBody> fields = body.fields() == null ? List.of() : body.fields();
+        Set<String> keys = new HashSet<>();
+        for (int i = 0; i < fields.size(); i++) {
+            FieldBody field = fields.get(i);
+            String path = "fields[" + i + "]";
+            if (field == null) {
+                errors.add(new FieldError(path, FieldErrorCode.REQUIRED, path + " must be an object"));
+                continue;
+            }
+            if (field.key() == null || field.key().isBlank()) {
+                errors.add(new FieldError(path + ".key", FieldErrorCode.REQUIRED, path + ".key is required"));
+            } else if (field.key().length() > 63) {
+                errors.add(new FieldError(path + ".key", FieldErrorCode.TOO_LONG, path + ".key is longer than 63"));
+            } else if (!keys.add(field.key())) {
+                errors.add(new FieldError(path + ".key", FieldErrorCode.DUPLICATE, path + ".key repeats an earlier field"));
+            }
+            if (field.type() != null && !FIELD_TYPES.contains(field.type())) {
+                errors.add(new FieldError(path + ".type", FieldErrorCode.NOT_IN_ENUM, path + ".type is not a field type"));
+            }
+            maxLength(errors, path + ".refTarget", field.refTarget(), 63);
+        }
+        return errors;
+    }
+
+    private static void maxLength(List<FieldError> errors, String path, String value, int max) {
+        if (value != null && value.length() > max) {
+            errors.add(new FieldError(path, FieldErrorCode.TOO_LONG, path + " is longer than " + max));
+        }
+    }
+
     @PostMapping("/content-types/{typeKey}/disable")
     public Map<String, Object> disable(@PathVariable String typeKey, HttpServletRequest request) {
         return setEnabled(typeKey, false, request);
```

`src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java
+++ b/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java
@@ -98,6 +98,7 @@
         String normalized = username == null ? "" : username.toLowerCase(Locale.ROOT);
         if (!USERNAME.matcher(normalized).matches()) throw IdentityException.validation("username must match [a-z0-9._-]{3,32}");
         if (store.findPrincipalByUsername(normalized).isPresent()) throw IdentityException.validation("username is taken");
+        validateProfile(null, displayName, email);
         String password = temporaryPassword;
         if (password == null || password.isBlank()) password = SessionTokens.randomToken() + "Aa1";
         authService.validateNewPassword(normalized, password);
@@ -114,6 +115,7 @@
     public Principal patch(IdentityRequest request, UUID id, String displayName, String email, String status) {
         authService.requireManagePrincipals(request);
         Principal current = store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
+        validateProfile(id, displayName, email);
         Instant now = Instant.now();
         PrincipalStatus nextStatus = status == null ? current.status() : parseStatus(status);
         Principal updated = current.withProfile(displayName == null ? current.displayName() : displayName,
@@ -201,6 +203,9 @@
             try { action = CmsAction.fromWire(p.action()); } catch (IllegalArgumentException e) { throw IdentityException.validation(e.getMessage()); }
             List<String> surfaces = p.allowedSurfaces() == null || p.allowedSurfaces().isEmpty() ? defaultSurfaces(action.wire()) : p.allowedSurfaces().stream().distinct().toList();
             if (surfaces.stream().anyMatch(s -> !SURFACES.contains(s))) throw IdentityException.validation("unknown surface");
+            if (p.contentTypeCode() != null && p.contentTypeCode().length() > 64) {
+                throw IdentityException.validation("contentTypeCode must be at most 64 characters");
+            }
             validatePredicate(p.predicateJson());
             String predicateProblem = PredicateIndexCheck.problem(objectMapper, contentTypes, p.contentTypeCode(), p.predicateJson());
             if (predicateProblem != null) throw IdentityException.validation(predicateProblem);
@@ -221,6 +226,21 @@
         return authorizationService.effectivePermissions(id);
     }
 
+    /**
+     * 02 BQ-08: cms_principal.display_name is VARCHAR(80), email VARCHAR(254) with a case-insensitive unique index.
+     * self is the principal being changed (its own email is not "taken"); null when creating.
+     */
+    private void validateProfile(UUID self, String displayName, String email) {
+        if (displayName != null && displayName.length() > 80) {
+            throw IdentityException.validation("displayName must be at most 80 characters");
+        }
+        if (email == null) return;
+        if (email.length() > 254) throw IdentityException.validation("email must be at most 254 characters");
+        boolean taken = store.listPrincipals().stream()
+                .anyMatch(p -> !p.id().equals(self) && p.email() != null && p.email().equalsIgnoreCase(email));
+        if (taken) throw IdentityException.validation("email is taken");
+    }
+
     private void validatePredicate(String predicateJson) {
         if (predicateJson == null || predicateJson.isBlank()) return;
         try {
```

`src/main/resources/openapi/openapi.yaml`：

```diff
--- a/src/main/resources/openapi/openapi.yaml
+++ b/src/main/resources/openapi/openapi.yaml
@@ -184,7 +184,9 @@
         the server generates one and returns it once.
         Errors:
         - 400 VALIDATION_FAILED: username does not match `^[a-z0-9._-]{3,32}$`, username is taken,
-          or the temporary password is shorter than 12 characters or equals the username.
+          `displayName` is longer than 80, `email` is longer than 254 or already used by another
+          principal (case-insensitive), or the temporary password is shorter than 12 characters or
+          equals the username.
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listPrincipals.
       parameters:
         - $ref: "#/components/parameters/CsrfHeader"
@@ -256,7 +258,8 @@
       description: |
         Null or absent properties keep their current value.
         Errors:
-        - 400 VALIDATION_FAILED: `status` is not a PrincipalStatus.
+        - 400 VALIDATION_FAILED: `status` is not a PrincipalStatus, `displayName` is longer than 80,
+          or `email` is longer than 254 or used by another principal (case-insensitive).
         - 403 LAST_ADMIN: the change would leave no active admin.
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listPrincipals.
         - 404 PRINCIPAL_NOT_FOUND: no principal with this id.
@@ -458,7 +461,7 @@
         - 400 VALIDATION_FAILED: unknown role, unknown action, unknown surface, duplicate
           permission, malformed predicate, a predicate without `contentType`, a predicate whose field is
           not an enabled string, enum, ref or principal-ref field with index rows in that type (02 §4.1),
-          or an empty list for the anonymous role.
+          `contentTypeCode` longer than 64, or an empty list for the anonymous role.
         - 403 LAST_ADMIN: the change would leave no active admin.
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as listPrincipals.
       parameters:
@@ -1080,7 +1083,13 @@
       description: |
         Errors:
         - 403 SURFACE_FORBIDDEN, FORBIDDEN: as adminListContentTypes.
-        - 422 FIELD_VALIDATION: key does not match `^[a-z][a-z0-9_]{1,62}$` or already exists.
+        - 422 FIELD_VALIDATION: every invalid input in `error.fields`, in body order (02 BQ-08):
+          `key` REQUIRED, INVALID_FORMAT (not `^[a-z][a-z0-9_]{1,62}$`) or DUPLICATE (type exists);
+          `displayName`, `pluralDisplayName` TOO_LONG (over 80); `titleField` TOO_LONG (over 63);
+          `slugPolicy` NOT_IN_ENUM; `fields[i]` REQUIRED (null item); `fields[i].key` REQUIRED, TOO_LONG
+          (over 63) or DUPLICATE (repeats an earlier field); `fields[i].type` NOT_IN_ENUM (not string,
+          markdown, int, boolean, datetime, enum, ref, principal-ref or media-ref); `fields[i].refTarget`
+          TOO_LONG (over 63). Nothing is written.
       parameters:
         - $ref: "#/components/parameters/CsrfHeader"
       requestBody:
@@ -1864,7 +1873,8 @@
       description: |
         Why a field is invalid. REQUIRED (publish, member create, or a missing setting), RESERVED_KEY, WRONG_TYPE, TOO_LONG (string over 1,000 or
         markdown over 100,000 code points), INVALID_DATETIME, NOT_IN_ENUM, INVALID_UUID, REF_TARGET_NOT_FOUND,
-        REF_TARGET_WRONG_TYPE, PRINCIPAL_REF_UNRESOLVED.
+        REF_TARGET_WRONG_TYPE, PRINCIPAL_REF_UNRESOLVED, INVALID_FORMAT (a value that must match a pattern), DUPLICATE
+        (a key that already exists or repeats in the request).
       enum:
         - REQUIRED
         - RESERVED_KEY
@@ -1876,6 +1886,8 @@
         - REF_TARGET_NOT_FOUND
         - REF_TARGET_WRONG_TYPE
         - PRINCIPAL_REF_UNRESOLVED
+        - INVALID_FORMAT
+        - DUPLICATE
     Health:
       type: object
       additionalProperties: true
```

### 5.4 BQ-10（T08）

規則見 §4.4。JDBC 的公開範圍篩選：`EXISTS (SELECT 1 FROM cms_entry_index rf WHERE rf.entry_id = e.id AND rf.scope = 'published' AND rf.field_key = ? AND rf.value_string = ?)`，值是目標 id 的小寫文字（BW1c 起 ref 值一律是小寫 UUID）。使用 V6 的 `cms_entry_index_str_idx (field_key, scope, value_string)`。

`src/main/java/com/fallrising/cms/content/index/EntryIndexer.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/index/EntryIndexer.java
+++ b/src/main/java/com/fallrising/cms/content/index/EntryIndexer.java
@@ -18,8 +18,9 @@
  * Computes the cms_entry_index rows of an entry (02 §3.2). Pure: the content stores and the V7 backfill both use it,
  * so every store indexes identically.
  *
- * <p>Indexed fields: enabled fields with indexed=true, plus the type's titleField, sortField, visibilityField,
- * ownerField and every field in publicRequiresPublishedRefs. Value kind by field type:
+ * <p>Indexed fields: enabled fields with indexed=true, every enabled ref and principal-ref field (so the public list
+ * can filter ref.&lt;field&gt; by the published copy, 02 BQ-10), plus the type's titleField, sortField,
+ * visibilityField, ownerField and every field in publicRequiresPublishedRefs. Value kind by field type:
  * string and markdown → string; enum → enum; int → int (JSON numbers only, truncated to long);
  * boolean → bool (JSON booleans only); datetime → datetime (ISO-8601 instant or offset date-time);
  * ref and principal-ref → ref (the value's text). Other types and media-ref are not indexed.
@@ -33,7 +34,7 @@
     public static Set<String> indexedKeys(ContentTypeRecord type, List<FieldRecord> fields) {
         Set<String> wanted = new TreeSet<>();
         for (FieldRecord field : fields) {
-            if (field.enabled() && field.indexed()) wanted.add(field.fieldKey());
+            if (field.enabled() && (field.indexed() || "ref".equals(kind(field.fieldType())))) wanted.add(field.fieldKey());
         }
         addIfPresent(wanted, type.titleField());
         addIfPresent(wanted, type.sortField());
```

`src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
@@ -576,9 +576,18 @@
             sql.append(")");
         }
         for (RefFilter ref : query.refs()) {
-            sql.append(" AND EXISTS (SELECT 1 FROM cms_entry_ref rf WHERE rf.from_entry_id = e.id AND rf.field_key = ? AND rf.to_id = ?)");
-            args.add(ref.fieldKey());
-            args.add(ref.targetId());
+            if (query.scope() == IndexScope.PUBLISHED) {
+                // The published copy's relation (02 BQ-10); cms_entry_ref holds the working copy's.
+                sql.append(" AND EXISTS (SELECT 1 FROM cms_entry_index rf WHERE rf.entry_id = e.id AND rf.scope = ?"
+                        + " AND rf.field_key = ? AND rf.value_string = ?)");
+                args.add(scope);
+                args.add(ref.fieldKey());
+                args.add(ref.targetId().toString());
+            } else {
+                sql.append(" AND EXISTS (SELECT 1 FROM cms_entry_ref rf WHERE rf.from_entry_id = e.id AND rf.field_key = ? AND rf.to_id = ?)");
+                args.add(ref.fieldKey());
+                args.add(ref.targetId());
+            }
         }
         AccessFilter access = query.access();
         if (!access.unrestricted()) {
```

`src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
@@ -283,8 +283,14 @@
             if (!matches(row(e.id(), scope, filter.fieldKey()), filter)) return false;
         }
         for (RefFilter ref : query.refs()) {
-            boolean found = refs.getOrDefault(e.id(), List.of()).stream()
-                    .anyMatch(r -> ref.fieldKey().equals(r.fieldKey()) && ref.targetId().equals(r.toId()));
+            boolean found;
+            if (scope == IndexScope.PUBLISHED) {
+                IndexRow row = row(e.id(), scope, ref.fieldKey());
+                found = row != null && ref.targetId().toString().equals(row.stringValue());
+            } else {
+                found = refs.getOrDefault(e.id(), List.of()).stream()
+                        .anyMatch(r -> ref.fieldKey().equals(r.fieldKey()) && ref.targetId().equals(r.toId()));
+            }
             if (!found) return false;
         }
         AccessFilter access = query.access();
```

`src/main/java/db/migration/V10__index_ref_fields.java`：

```java
package db.migration;

/**
 * BW5: every ref and principal-ref field now has index rows (02 BQ-10, EntryIndexer). Rebuilds cms_entry_index for
 * existing entries exactly as V7 did, with the current EntryIndexer.
 */
public class V10__index_ref_fields extends V7__backfill_entry_index {}
```

`src/main/resources/openapi/openapi.yaml`：

```diff
--- a/src/main/resources/openapi/openapi.yaml
+++ b/src/main/resources/openapi/openapi.yaml
@@ -510,7 +510,7 @@
         `filterable=true`, index rows and visibility `public`; datetime fields take
         `filter.<fieldKey>.from` (inclusive) and `filter.<fieldKey>.to` (exclusive) as ISO-8601 with offset.
         Relation filters: `ref.<fieldKey>=<entry uuid>` on a public ref field; may repeat, all must match.
-        They read the relations of the working copy (02 BQ-10).
+        They read the relations of the published copy (02 BQ-10, BW5).
         Other query parameters are ignored.
         Errors:
         - 400 AUDIENCE_PARAM_REJECTED: `state`, `includeDraft` or `asOf` is present.
```

T08 之後：`cmp docs/v2/contracts/BW5.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。

### 5.5 BQ-11：store 的批次方法（T10）

`findAll` 回傳已知的媒體（含已刪除，由服務層過濾），含 variants；JDBC 固定兩句 SQL（媒體、variants）。`attachmentsOfMedia(Collection)` 一句 SQL。空集合直接回空 list，不查資料庫。

`src/main/java/com/fallrising/cms/media/store/MediaStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/media/store/MediaStore.java
+++ b/src/main/java/com/fallrising/cms/media/store/MediaStore.java
@@ -4,6 +4,7 @@
 import com.fallrising.cms.media.domain.MediaAttachment;
 import com.fallrising.cms.media.domain.MediaVariant;
 
+import java.util.Collection;
 import java.util.List;
 import java.util.Optional;
 import java.util.UUID;
@@ -14,6 +15,9 @@
 
     Optional<MediaAsset> find(UUID id);
 
+    /** Every known media among ids (deleted ones included), with variants; unknown ids are skipped (02 BQ-11). */
+    List<MediaAsset> findAll(Collection<UUID> ids);
+
     List<MediaAsset> listAvailable();
 
     void update(MediaAsset asset);
@@ -26,6 +30,9 @@
 
     List<MediaAttachment> attachmentsOfMedia(UUID mediaId);
 
+    /** Attachments of every media among mediaIds (02 BQ-11). */
+    List<MediaAttachment> attachmentsOfMedia(Collection<UUID> mediaIds);
+
     long countFiles();
 
     long sumStoredBytes();
```

`src/main/java/com/fallrising/cms/media/store/InMemoryMediaStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/media/store/InMemoryMediaStore.java
+++ b/src/main/java/com/fallrising/cms/media/store/InMemoryMediaStore.java
@@ -5,6 +5,7 @@
 import com.fallrising.cms.media.domain.MediaVariant;
 
 import java.util.ArrayList;
+import java.util.Collection;
 import java.util.Comparator;
 import java.util.List;
 import java.util.Optional;
@@ -73,6 +74,11 @@
     }
 
     @Override
+    public List<MediaAsset> findAll(Collection<UUID> ids) {
+        return ids.stream().distinct().map(assets::get).filter(a -> a != null).map(this::withVariants).toList();
+    }
+
+    @Override
     public void replaceAttachments(UUID entryId, List<MediaAttachment> attachments) {
         attachmentsByEntry.put(entryId, new ArrayList<>(attachments));
     }
@@ -86,6 +92,14 @@
     }
 
     @Override
+    public List<MediaAttachment> attachmentsOfMedia(Collection<UUID> mediaIds) {
+        return attachmentsByEntry.values().stream()
+                .flatMap(List::stream)
+                .filter(a -> mediaIds.contains(a.mediaId()))
+                .toList();
+    }
+
+    @Override
     public long countFiles() {
         return assets.size();
     }
@@ -122,6 +136,6 @@
                 asset.deletedAt(),
                 asset.createdAt(),
                 asset.updatedAt(),
-                variantsOf(asset.id()));
+                List.copyOf(variants.getOrDefault(asset.id(), List.of())));
     }
 }
```

`src/main/java/com/fallrising/cms/media/store/JdbcMediaStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/media/store/JdbcMediaStore.java
+++ b/src/main/java/com/fallrising/cms/media/store/JdbcMediaStore.java
@@ -11,7 +11,10 @@
 import java.sql.SQLException;
 import java.sql.Timestamp;
 import java.time.Instant;
+import java.util.Collection;
 import java.util.List;
+import java.util.Map;
+import java.util.stream.Collectors;
 import java.util.Optional;
 import java.util.UUID;
 
@@ -59,6 +62,22 @@
         return Optional.of(withVariants(asset));
     }
 
+    /** Two queries whatever the number of ids: the media rows, then all their variants. */
+    @Override
+    public List<MediaAsset> findAll(Collection<UUID> ids) {
+        List<UUID> distinct = ids.stream().distinct().toList();
+        if (distinct.isEmpty()) return List.of();
+        String in = placeholders(distinct.size());
+        List<MediaAsset> rows = jdbc.query("SELECT * FROM cms_media WHERE id IN (" + in + ")", assetMapper(), distinct.toArray());
+        if (rows.isEmpty()) return List.of();
+        Map<UUID, List<MediaVariant>> variants = jdbc.query(
+                        "SELECT * FROM cms_media_variant WHERE media_id IN (" + placeholders(rows.size()) + ")",
+                        variantMapper(), rows.stream().map(MediaAsset::id).toArray())
+                .stream()
+                .collect(Collectors.groupingBy(MediaVariant::mediaId));
+        return rows.stream().map(a -> withVariants(a, variants.getOrDefault(a.id(), List.of()))).toList();
+    }
+
     @Override
     public List<MediaAsset> listAvailable() {
         return jdbc.query(
@@ -135,6 +154,24 @@
     }
 
     @Override
+    public List<MediaAttachment> attachmentsOfMedia(Collection<UUID> mediaIds) {
+        List<UUID> distinct = mediaIds.stream().distinct().toList();
+        if (distinct.isEmpty()) return List.of();
+        return jdbc.query(
+                "SELECT * FROM cms_media_attachment WHERE media_id IN (" + placeholders(distinct.size()) + ")",
+                (rs, n) -> new MediaAttachment(
+                        rs.getObject("media_id", UUID.class),
+                        rs.getObject("entry_id", UUID.class),
+                        rs.getString("field_key"),
+                        instant(rs, "attached_at")),
+                distinct.toArray());
+    }
+
+    private static String placeholders(int count) {
+        return String.join(", ", java.util.Collections.nCopies(count, "?"));
+    }
+
+    @Override
     public long countFiles() {
         Long count = jdbc.queryForObject("SELECT COUNT(*) FROM cms_media", Long.class);
         return count == null ? 0 : count;
@@ -167,6 +204,10 @@
     }
 
     private MediaAsset withVariants(MediaAsset asset) {
+        return withVariants(asset, variantsOf(asset.id()));
+    }
+
+    private static MediaAsset withVariants(MediaAsset asset, List<MediaVariant> variants) {
         return new MediaAsset(
                 asset.id(),
                 asset.ownerPrincipalId(),
@@ -183,7 +224,7 @@
                 asset.deletedAt(),
                 asset.createdAt(),
                 asset.updatedAt(),
-                variantsOf(asset.id()));
+                variants);
     }
 
     private RowMapper<MediaAsset> assetMapper() {
```

### 5.6 BQ-11：服務與控制器（T12）

規則見 §4.5。`MediaService.readableAssets` 取代原本逐筆的 `publiclyReadable`／`publishedRefsOk`；`publiclyReadable`、`resolvePublic` 保留原本的簽名，內部改呼叫它。`Lookup` 在一次解析內快取類型與欄位。控制器先以 `ContentProjection.mediaRefs` 收集整頁的 `media-ref` 值，再以 `MediaService.publicExpander` 取得逐值的轉換函式。

`src/main/java/com/fallrising/cms/media/service/MediaService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/media/service/MediaService.java
+++ b/src/main/java/com/fallrising/cms/media/service/MediaService.java
@@ -1,6 +1,7 @@
 package com.fallrising.cms.media.service;
 
 import com.fallrising.cms.content.PublicVisibility;
+import com.fallrising.cms.content.domain.ContentTypeRecord;
 import com.fallrising.cms.content.domain.EntryRecord;
 import com.fallrising.cms.content.domain.FieldRecord;
 import com.fallrising.cms.content.domain.PublicationState;
@@ -24,14 +25,18 @@
 import java.security.MessageDigest;
 import java.time.Instant;
 import java.util.ArrayList;
+import java.util.Collection;
+import java.util.HashMap;
 import java.util.HexFormat;
 import java.util.LinkedHashMap;
+import java.util.LinkedHashSet;
 import java.util.List;
 import java.util.Locale;
 import java.util.Map;
 import java.util.Optional;
 import java.util.Set;
 import java.util.UUID;
+import java.util.function.Function;
 
 @Service
 public class MediaService {
@@ -169,25 +174,7 @@
     }
 
     public boolean publiclyReadable(UUID mediaId) {
-        MediaAsset asset = store.find(mediaId).orElse(null);
-        if (asset == null || !asset.available()) {
-            return false;
-        }
-        for (MediaAttachment attachment : store.attachmentsOfMedia(mediaId)) {
-            Optional<EntryRecord> entry = content.findEntry(attachment.entryId());
-            if (entry.isEmpty() || entry.get().deleted() || entry.get().publicationState() != PublicationState.PUBLISHED) {
-                continue;
-            }
-            boolean allowedField = content.fieldsOf(entry.get().contentTypeId()).stream()
-                    .anyMatch(f -> f.fieldKey().equals(attachment.fieldKey()) && f.publicBytes() && f.enabled());
-            if (allowedField
-                    && PublicVisibility.gettable(
-                            content.findTypeByKey(entry.get().contentTypeKey()).orElse(null), entry.get().publishedPayload())
-                    && publishedRefsOk(entry.get())) {
-                return true;
-            }
-        }
-        return false;
+        return readableAssets(List.of(mediaId)).containsKey(mediaId);
     }
 
     public byte[] privateBytes(Principal principal, Surface surface, UUID id, String variant) {
@@ -245,39 +232,136 @@
                 "maxFileBytes", quota.maxFileBytes());
     }
 
-    private boolean publishedRefsOk(EntryRecord entry) {
-        var type = content.findTypeByKey(entry.contentTypeKey()).orElse(null);
+    public Optional<Map<String, Object>> resolvePublic(Object rawMediaRef) {
+        UUID id = parseMediaId(rawMediaRef);
+        return id == null ? Optional.empty() : Optional.ofNullable(resolvePublicAll(List.of(id)).get(id));
+    }
+
+    /**
+     * Public media JSON for many media-ref values at once (02 BQ-11), keyed by media id; a value that is not publicly
+     * readable is absent. The store calls do not depend on the number of values (see readableAssets).
+     */
+    public Map<UUID, Map<String, Object>> resolvePublicAll(Collection<?> rawMediaRefs) {
+        Set<UUID> ids = new LinkedHashSet<>();
+        for (Object raw : rawMediaRefs) {
+            UUID id = raw instanceof UUID uuid ? uuid : parseMediaId(raw);
+            if (id != null) ids.add(id);
+        }
+        Map<UUID, Map<String, Object>> resolved = new LinkedHashMap<>();
+        readableAssets(ids).forEach((id, asset) -> resolved.put(id, json(asset, true)));
+        return resolved;
+    }
+
+    /** A media-ref expander for one page: resolves every value first, then maps a value to its JSON or null (B-13). */
+    public Function<Object, Object> publicExpander(Collection<?> rawMediaRefs) {
+        Map<UUID, Map<String, Object>> resolved = resolvePublicAll(rawMediaRefs);
+        return raw -> {
+            UUID id = parseMediaId(raw);
+            return id == null ? null : resolved.get(id);
+        };
+    }
+
+    /**
+     * The publicly readable media among ids: available, and attached through an enabled public-bytes field to a
+     * published, not deleted entry that is publicly gettable and whose publicRequiresPublishedRefs targets are
+     * published and gettable. Store calls: media findAll and attachmentsOfMedia once each; content findEntries once for
+     * the attached entries and once for their required-ref targets; findTypeByKey and fieldsOf once per distinct type.
+     */
+    private Map<UUID, MediaAsset> readableAssets(Collection<UUID> ids) {
+        if (ids.isEmpty()) return Map.of();
+        List<MediaAsset> assets = store.findAll(ids).stream().filter(MediaAsset::available).toList();
+        if (assets.isEmpty()) return Map.of();
+        List<MediaAttachment> attachments = store.attachmentsOfMedia(assets.stream().map(MediaAsset::id).toList());
+        Map<UUID, EntryRecord> entries = byId(content.findEntries(attachments.stream().map(MediaAttachment::entryId).toList()));
+        Lookup lookup = new Lookup();
+        Set<UUID> targetIds = new LinkedHashSet<>();
+        for (EntryRecord entry : entries.values()) {
+            if (!published(entry)) continue;
+            ContentTypeRecord type = lookup.type(entry.contentTypeKey());
+            if (type == null) continue;
+            for (String refField : type.publicRequiresPublishedRefs()) {
+                UUID target = uuidOrNull(refSource(entry).get(refField));
+                if (target != null) targetIds.add(target);
+            }
+        }
+        Map<UUID, EntryRecord> targets = byId(content.findEntries(targetIds));
+        Map<UUID, MediaAsset> readable = new LinkedHashMap<>();
+        for (MediaAsset asset : assets) {
+            for (MediaAttachment attachment : attachments) {
+                if (!attachment.mediaId().equals(asset.id())) continue;
+                EntryRecord entry = entries.get(attachment.entryId());
+                if (entry == null || !published(entry)) continue;
+                boolean allowedField = lookup.fields(entry.contentTypeId()).stream()
+                        .anyMatch(f -> f.fieldKey().equals(attachment.fieldKey()) && f.publicBytes() && f.enabled());
+                if (allowedField
+                        && PublicVisibility.gettable(lookup.type(entry.contentTypeKey()), entry.publishedPayload())
+                        && publishedRefsOk(entry, lookup, targets)) {
+                    readable.put(asset.id(), asset);
+                    break;
+                }
+            }
+        }
+        return readable;
+    }
+
+    private boolean publishedRefsOk(EntryRecord entry, Lookup lookup, Map<UUID, EntryRecord> targets) {
+        ContentTypeRecord type = lookup.type(entry.contentTypeKey());
         if (type == null || type.publicRequiresPublishedRefs().isEmpty()) {
             return true;
         }
-        Map<String, Object> payload = entry.publishedPayload() == null ? entry.payload() : entry.publishedPayload();
+        Map<String, Object> payload = refSource(entry);
         for (String refField : type.publicRequiresPublishedRefs()) {
-            Object raw = payload == null ? null : payload.get(refField);
+            Object raw = payload.get(refField);
             if (raw == null) {
                 continue;
             }
-            try {
-                EntryRecord target = content.findEntry(UUID.fromString(raw.toString())).orElse(null);
-                if (target == null
-                        || target.deleted()
-                        || target.publicationState() != PublicationState.PUBLISHED
-                        || !PublicVisibility.gettable(
-                                content.findTypeByKey(target.contentTypeKey()).orElse(null), target.publishedPayload())) {
-                    return false;
-                }
-            } catch (IllegalArgumentException e) {
+            UUID id = uuidOrNull(raw);
+            EntryRecord target = id == null ? null : targets.get(id);
+            if (target == null
+                    || !published(target)
+                    || !PublicVisibility.gettable(lookup.type(target.contentTypeKey()), target.publishedPayload())) {
                 return false;
             }
         }
         return true;
     }
 
-    public Optional<Map<String, Object>> resolvePublic(Object rawMediaRef) {
-        UUID id = parseMediaId(rawMediaRef);
-        if (id == null || !publiclyReadable(id)) {
-            return Optional.empty();
+    private static boolean published(EntryRecord entry) {
+        return !entry.deleted() && entry.publicationState() == PublicationState.PUBLISHED;
+    }
+
+    private static Map<String, Object> refSource(EntryRecord entry) {
+        Map<String, Object> payload = entry.publishedPayload() == null ? entry.payload() : entry.publishedPayload();
+        return payload == null ? Map.of() : payload;
+    }
+
+    private static UUID uuidOrNull(Object raw) {
+        if (raw == null) return null;
+        try {
+            return UUID.fromString(raw.toString());
+        } catch (IllegalArgumentException e) {
+            return null;
+        }
+    }
+
+    private static Map<UUID, EntryRecord> byId(List<EntryRecord> entries) {
+        Map<UUID, EntryRecord> map = new LinkedHashMap<>();
+        entries.forEach(e -> map.put(e.id(), e));
+        return map;
+    }
+
+    /** Content types and fields read at most once per distinct type within one resolution. */
+    private final class Lookup {
+        private final Map<String, Optional<ContentTypeRecord>> types = new HashMap<>();
+        private final Map<UUID, List<FieldRecord>> fields = new HashMap<>();
+
+        ContentTypeRecord type(String key) {
+            return types.computeIfAbsent(key, content::findTypeByKey).orElse(null);
+        }
+
+        List<FieldRecord> fields(UUID typeId) {
+            return fields.computeIfAbsent(typeId, content::fieldsOf);
         }
-        return Optional.of(json(get(id), true));
     }
 
     public static UUID parseMediaId(Object raw) {
```

`src/main/java/com/fallrising/cms/content/web/ContentProjection.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/ContentProjection.java
+++ b/src/main/java/com/fallrising/cms/content/web/ContentProjection.java
@@ -5,6 +5,7 @@
 import com.fallrising.cms.content.domain.FieldRecord;
 import com.fallrising.cms.content.service.EntryService;
 
+import java.util.ArrayList;
 import java.util.LinkedHashMap;
 import java.util.List;
 import java.util.Map;
@@ -31,6 +32,22 @@
         return json;
     }
 
+    /** Values of the enabled public media-ref fields in the payloads, for one batch resolution (02 BQ-11). */
+    static List<Object> mediaRefs(List<Map<String, Object>> payloads, List<FieldRecord> fields) {
+        List<Object> values = new ArrayList<>();
+        for (Map<String, Object> payload : payloads) {
+            if (payload == null) continue;
+            for (FieldRecord field : fields) {
+                Object value = payload.get(field.fieldKey());
+                if (value != null && field.enabled() && "public".equals(field.visibility())
+                        && "media-ref".equals(field.fieldType())) {
+                    values.add(value);
+                }
+            }
+        }
+        return values;
+    }
+
     static Map<String, Object> published(
             EntryRecord entry,
             ContentTypeRecord type,
```

`src/main/java/com/fallrising/cms/content/web/PublicContentController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/PublicContentController.java
+++ b/src/main/java/com/fallrising/cms/content/web/PublicContentController.java
@@ -23,6 +23,7 @@
 import java.util.List;
 import java.util.Map;
 import java.util.UUID;
+import java.util.function.Function;
 
 @RestController
 @RequestMapping("/api/v1/public")
@@ -62,8 +63,10 @@
     public Map<String, Object> list(@PathVariable String typeKey, HttpServletRequest request) {
         rejectAudienceParams(request);
         EntryService.ListResult result = entries.publicList(principal(request), typeKey, request.getParameterMap());
+        Function<Object, Object> expander = media.publicExpander(ContentProjection.mediaRefs(
+                result.page().items().stream().map(EntryRecord::publishedPayload).toList(), result.fields()));
         List<Map<String, Object>> items = result.page().items().stream()
-                .map(e -> ContentProjection.published(e, result.type(), result.fields(), this::expandMedia))
+                .map(e -> ContentProjection.published(e, result.type(), result.fields(), expander))
                 .toList();
         return ContentProjection.page(items, result);
     }
```

`src/main/java/com/fallrising/cms/content/web/MeController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/MeController.java
+++ b/src/main/java/com/fallrising/cms/content/web/MeController.java
@@ -1,6 +1,7 @@
 package com.fallrising.cms.content.web;
 
 import com.fallrising.cms.content.ContentException;
+import com.fallrising.cms.content.domain.EntryRecord;
 import com.fallrising.cms.content.service.MeService;
 import com.fallrising.cms.identity.web.AuthController;
 import com.fallrising.cms.identity.web.IdentityRequest;
@@ -19,6 +20,7 @@
 import java.util.List;
 import java.util.Map;
 import java.util.UUID;
+import java.util.function.Function;
 
 /** Member endpoints (02 §4.5). Front surface only; see MeService. */
 @RestController
@@ -40,8 +42,10 @@
     public Map<String, Object> list(@PathVariable String typeKey, HttpServletRequest request) {
         IdentityRequest identity = AuthController.current(request);
         MeService.MeList result = me.list(identity.principal(), identity.surface(), typeKey, request.getParameterMap());
+        Function<Object, Object> expander = media.publicExpander(ContentProjection.mediaRefs(
+                result.page().items().stream().map(EntryRecord::payload).toList(), result.fields()));
         List<Map<String, Object>> items = result.page().items().stream()
-                .map(e -> ContentProjection.member(e, result.type(), result.fields(), this::expandMedia))
+                .map(e -> ContentProjection.member(e, result.type(), result.fields(), expander))
                 .toList();
         Map<String, Object> json = new LinkedHashMap<>();
         json.put("items", items);
```

---

## 6. 任務卡

大小：S ≤ 150 行、M ≤ 400 行（只算手寫或手改的行；整檔複製算 1 行）。所有指令在 `apps/cms-scaffold` 執行。測試數以 BW4 完成後的 `test` 230、`integrationTest` 76 為起點。

### BW5-T01 【測試先行】`PRINCIPAL_NOT_FOUND`

- **目標**：BQ-06 寫成測試。
- **輸入**：BW4 `VERIFIED`。
- **步驟**：建立 §7.1 的 `PrincipalNotFoundApiTests.java`。
- **完成條件**：預期紅燈正好 1 個（本類別）；失敗訊息列出 7 個 operation，前 6 個是 `400 VALIDATION_FAILED`，`effectivePermissions` 是 `200`。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.PrincipalNotFoundApiTests'`
- **對應 ID**：BQ-06
- **大小**：S

### BW5-T02 `PRINCIPAL_NOT_FOUND`

- **目標**：§5.1。
- **輸入**：T01。
- **步驟**：套用 §5.1 的四段 diff。
- **完成條件**：`test` 231 個全綠（`ErrorCodeContractTests` 確認 enum 與契約一致）。
- **驗證**：`./gradlew :services:cms-api:test`
- **對應 ID**：BQ-06
- **大小**：S

### BW5-T03 【測試先行】媒體錯誤代碼

- **目標**：BQ-07 寫成測試。
- **輸入**：T02。
- **步驟**：建立 §7.2 的 `MediaErrorCodeApiTests.java`。
- **完成條件**：預期紅燈正好 1 個（本類別），訊息為 `expected:<MEDIA_NOT_FOUND> but was:<not_found>`。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.MediaErrorCodeApiTests'`
- **對應 ID**：BQ-07
- **大小**：S

### BW5-T04 媒體錯誤代碼大寫

- **目標**：§5.2。
- **輸入**：T03。
- **步驟**：套用 §5.2 的兩段 diff。
- **完成條件**：`test` 232 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`
- **對應 ID**：BQ-07
- **大小**：S

### BW5-T05 【測試先行】管理端輸入驗證

- **目標**：§4.3 寫成測試。
- **輸入**：T04。
- **步驟**：建立 §7.3 的 `AdminInputValidationApiTests.java`。
- **完成條件**：預期紅燈正好 2 個（本類別兩個測試）。第一個的訊息是回應驗證器拒絕 201 回應中的 `slugPolicy`（非法值被寫進去了），第二個是 `Status expected:<400> but was:<201>`。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.AdminInputValidationApiTests'`
- **對應 ID**：BQ-08
- **大小**：S

### BW5-T06 管理端輸入驗證

- **目標**：§5.3。
- **輸入**：T05。
- **步驟**：套用 §5.3 的四段 diff。
- **完成條件**：`test` 234 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`
- **對應 ID**：BQ-08
- **大小**：M

### BW5-T07 【測試先行】公開列表的關聯篩選

- **目標**：§4.4 寫成測試。
- **輸入**：T06。
- **步驟**：
  1. 套用 §7.4 的 `ContentStoreContract.java`、`EntryIndexBackfillTests.java` 兩段 diff。
  2. 建立 §7.4 的 `PublicRefFilterApiTests.java`。
- **完成條件**：預期紅燈：`test` 正好 2 個（`InMemoryContentStoreContractTests.BQ10_…`、`PublicRefFilterApiTests.BQ10_…`）；`integrationTest` 正好 2 個（`JdbcContentStoreContractTests.BQ10_…`、`EntryIndexBackfillTests.BQ10_…`）。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`（兩者都預期失敗）
- **對應 ID**：BQ-10
- **大小**：S

### BW5-T08 ref 欄位的索引列與公開篩選

- **目標**：§5.4。
- **輸入**：T07。
- **步驟**：
  1. 套用 §5.4 的 `EntryIndexer`、`JdbcContentStore`、`InMemoryContentStore`、`openapi.yaml` 四段 diff。
  2. 建立 §5.4 的 `V10__index_ref_fields.java`。
  3. `cmp docs/v2/contracts/BW5.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`，沒有輸出。
- **完成條件**：`test` 236 個全綠；`integrationTest` 78 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：BQ-10
- **大小**：S

### BW5-T09 【測試先行】媒體 store 的批次方法

- **目標**：固定 `findAll`、`attachmentsOfMedia(Collection)`。
- **輸入**：T08。
- **步驟**：套用 §7.5 的 `MediaStoreContract.java` diff。
- **完成條件**：預期紅燈：`src/test` 編譯失敗（兩個方法不存在）。
- **驗證**：`./gradlew :services:cms-api:compileTestJava`（預期失敗）
- **對應 ID**：BQ-11
- **大小**：S

### BW5-T10 媒體 store 的批次方法

- **目標**：§5.5。
- **輸入**：T09。
- **步驟**：套用 §5.5 的三段 diff。
- **完成條件**：`test` 238 個全綠；`integrationTest` 80 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：BQ-11
- **大小**：S

### BW5-T11 【測試先行】含媒體的公開列表呼叫數

- **目標**：BQ-11 寫成測試。
- **輸入**：T10。
- **步驟**：建立 §7.6 的 `PublicMediaCountTests.java`。
- **完成條件**：預期紅燈正好 1 個（本類別）：3 筆時的 content store 呼叫比 1 筆時多（每筆多 `findEntry`、`fieldsOf`、`findTypeByKey`）。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.PublicMediaCountTests'`
- **對應 ID**：BQ-11
- **大小**：S

### BW5-T12 媒體批次解析

- **目標**：§5.6。
- **輸入**：T11。
- **步驟**：套用 §5.6 的四段 diff。
- **完成條件**：`test` 239 個全綠（`MediaApiTests`、`MemberApiTests` 等既有測試確認可公開的判斷沒有改變）；`integrationTest` 80 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：BQ-11
- **大小**：M

### BW5-T13 完整閘門、狀態與 PR

- **目標**：交付。
- **輸入**：T12。
- **步驟**：
  1. 執行 §9 的完整閘門。
  2. `docs/v2/README.md` 路線圖中 BW5 的狀態從 `DOC_READY` 改成 `VERIFIED`。
  3. 逐項勾選 §9，貼進 PR 說明，並附上 §4.2 的對照表（給前端）。PR 標題：`feat(cms-scaffold): BW5 開放問題收尾`。
- **完成條件**：§9 全部打勾；CI 的 `java`、`java-integration` 全綠；`web` 全綠，或只有 BW1c §2.1 所說的失敗並已在 PR 說明。
- **驗證**：§9 的指令。
- **對應 ID**：全部
- **大小**：S

---

## 7. 測試規格

### 7.1 `PrincipalNotFoundApiTests`（MockMvc）

admin 在 Admin 以隨機 UUID 呼叫 7 個 operation，每一個都要是 `404 PRINCIPAL_NOT_FOUND`；失敗時列出所有不符的 operation。

`src/test/java/com/fallrising/cms/PrincipalNotFoundApiTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/** 02 BQ-06: every /principals/{id} operation answers 404 PRINCIPAL_NOT_FOUND for an id that is not a principal. */
@SpringBootTest
@AutoConfigureMockMvc
class PrincipalNotFoundApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void BQ06_unknownPrincipalIdIs404OnEveryOperation() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        String id = UUID.randomUUID().toString();
        Map<String, MockHttpServletRequestBuilder> operations = new LinkedHashMap<>();
        operations.put("getPrincipal", get("/api/v1/principals/{id}", id));
        operations.put("patchPrincipal", patch("/api/v1/principals/{id}", id)
                .contentType(MediaType.APPLICATION_JSON).content("{\"displayName\":\"Nobody\"}"));
        operations.put("disablePrincipal", post("/api/v1/principals/{id}/disable", id));
        operations.put("unlockPrincipal", post("/api/v1/principals/{id}/unlock", id));
        operations.put("replacePrincipalRoles", put("/api/v1/principals/{id}/roles", id)
                .contentType(MediaType.APPLICATION_JSON).content("[{\"code\":\"member\"}]"));
        operations.put("setPrincipalPassword", post("/api/v1/principals/{id}/password", id)
                .contentType(MediaType.APPLICATION_JSON).content("{}"));
        operations.put("effectivePermissions", get("/api/v1/principals/{id}/effective-permissions", id));

        List<String> mismatches = new ArrayList<>();
        for (Map.Entry<String, MockHttpServletRequestBuilder> operation : operations.entrySet()) {
            MvcResult result = mockMvc.perform(admin.apply(operation.getValue())).andReturn();
            String actual = result.getResponse().getStatus() + " "
                    + mapper.readTree(result.getResponse().getContentAsString()).at("/error/code").asText();
            if (!actual.equals("404 PRINCIPAL_NOT_FOUND")) mismatches.add(operation.getKey() + ": " + actual);
        }
        assertThat(mismatches).isEmpty();
    }
}
```

### 7.2 `MediaErrorCodeApiTests`（MockMvc）

operator-album 在 Back：不存在的媒體（工作端與公開端）`MEDIA_NOT_FOUND`；上傳文字檔 `MEDIA_UNSUPPORTED_TYPE`；上傳一張 PNG 後要求不存在的變體 `MEDIA_VARIANT_NOT_AVAILABLE`；刪除後讀檔 `MEDIA_GONE`。`MEDIA_QUOTA_EXCEEDED`、`MEDIA_FILE_TOO_LARGE` 不另外觸發（需要調整全域配額或上傳 15 MB）：它們的 wire 值由 `ErrorCodeContractTests` 與契約保證。

`src/test/java/com/fallrising/cms/MediaErrorCodeApiTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 02 BQ-07: media error codes are upper case like every other ErrorCode. */
@SpringBootTest
@AutoConfigureMockMvc
class MediaErrorCodeApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void BQ07_mediaErrorCodesAreUpperCase() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String missing = UUID.randomUUID().toString();
        mockMvc.perform(op.apply(get("/api/v1/media/{id}", missing)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("MEDIA_NOT_FOUND"));
        mockMvc.perform(get("/api/v1/public/media/{id}", missing))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("MEDIA_NOT_FOUND"));
        mockMvc.perform(op.apply(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", "notes.txt", "text/plain", "hello".getBytes()))))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error.code").value("MEDIA_UNSUPPORTED_TYPE"));

        String id = mapper.readTree(mockMvc.perform(op.apply(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", "dot.png", "image/png", png()))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).get("id").asText();
        mockMvc.perform(op.apply(get("/api/v1/media/{id}/file/{variant}", id, "poster")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("MEDIA_VARIANT_NOT_AVAILABLE"));
        mockMvc.perform(op.apply(delete("/api/v1/media/{id}", id))).andExpect(status().isNoContent());
        mockMvc.perform(op.apply(get("/api/v1/media/{id}/file/{variant}", id, "original")))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.error.code").value("MEDIA_GONE"));
    }

    private static byte[] png() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }
}
```

### 7.3 `AdminInputValidationApiTests`（MockMvc）

| 測試 | 斷言 |
| --- | --- |
| `BQ08_contentTypeCreateReportsEveryInvalidInput` | 一個 body 含 8 個問題：422，`error.fields` 正好是 §4.3 對應的 8 項、依 body 順序；類型沒有被建立。另外：不合格式的 key `INVALID_FORMAT`；已存在的 key（`album`）`DUPLICATE` |
| `BQ08_principalAndPermissionInputsThatTheDatabaseRejectsAre400` | 建立：displayName 81 字、email 255 字、與既有 email 只差大小寫，都 400；修改：改成別人的 email、displayName 81 字 400；改成自己的 email（只差大小寫）200；權限的 `contentTypeCode` 65 字 400 |

`src/test/java/com/fallrising/cms/AdminInputValidationApiTests.java`：

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
import org.springframework.test.web.servlet.ResultActions;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 02 BQ-08: admin inputs that the database would reject (column length, CHECK, UNIQUE) are rejected before any write:
 * content types with 422 FIELD_VALIDATION and error.fields, principals and role permissions with 400 VALIDATION_FAILED.
 */
@SpringBootTest
@AutoConfigureMockMvc
class AdminInputValidationApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void BQ08_contentTypeCreateReportsEveryInvalidInput() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        String key = "bq08_" + ApiFixture.token("t").toLowerCase().replaceAll("[^a-z0-9]", "");
        Map<String, Object> body = Map.of(
                "key", key,
                "displayName", "x".repeat(81),
                "titleField", "t".repeat(64),
                "slugPolicy", "sometimes",
                "fields", List.of(
                        Map.of("type", "string"),
                        Map.of("key", "k".repeat(64), "type", "string"),
                        Map.of("key", "dup", "type", "string"),
                        Map.of("key", "dup", "type", "string"),
                        Map.of("key", "shape", "type", "photo"),
                        Map.of("key", "owner", "type", "ref", "refTarget", "r".repeat(64))));
        JsonNode error = mapper.readTree(createType(admin, body)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))
                .andReturn().getResponse().getContentAsString()).get("error");
        List<String> fields = new ArrayList<>();
        error.get("fields").forEach(f -> fields.add(f.get("field").asText() + " " + f.get("code").asText()));
        assertThat(fields).containsExactly(
                "displayName TOO_LONG",
                "titleField TOO_LONG",
                "slugPolicy NOT_IN_ENUM",
                "fields[0].key REQUIRED",
                "fields[1].key TOO_LONG",
                "fields[3].key DUPLICATE",
                "fields[4].type NOT_IN_ENUM",
                "fields[5].refTarget TOO_LONG");
        assertThat(mockMvc.perform(admin.apply(get("/api/v1/admin/content-types"))).andReturn().getResponse()
                .getContentAsString()).doesNotContain(key);

        createType(admin, Map.of("key", "Not-A-Key"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[0].field").value("key"))
                .andExpect(jsonPath("$.error.fields[0].code").value("INVALID_FORMAT"));
        createType(admin, Map.of("key", "album"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[0].field").value("key"))
                .andExpect(jsonPath("$.error.fields[0].code").value("DUPLICATE"));
    }

    @Test
    void BQ08_principalAndPermissionInputsThatTheDatabaseRejectsAre400() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        String name = ApiFixture.token("p").toLowerCase().replaceAll("[^a-z0-9]", "");
        String email = name + "@Example.test";

        createPrincipal(admin, Map.of("username", name + "a", "displayName", "d".repeat(81)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.error.message", containsString("displayName")));
        createPrincipal(admin, Map.of("username", name + "b", "email", "e".repeat(243) + "@example.test"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message", containsString("email")));
        String first = mapper.readTree(createPrincipal(admin, Map.of("username", name + "c", "email", email))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText();
        createPrincipal(admin, Map.of("username", name + "d", "email", email.toUpperCase()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message", containsString("email is taken")));
        String second = mapper.readTree(createPrincipal(admin, Map.of("username", name + "e"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText();
        patchPrincipal(admin, second, Map.of("email", email))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message", containsString("email is taken")));
        patchPrincipal(admin, second, Map.of("displayName", "d".repeat(81)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message", containsString("displayName")));
        patchPrincipal(admin, first, Map.of("email", email.toLowerCase(), "displayName", "Same address"))
                .andExpect(status().isOk());

        mockMvc.perform(admin.apply(put("/api/v1/roles/{code}/permissions", "editor")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(List.of(Map.of("action", "read_draft",
                                "contentTypeCode", "c".repeat(65), "allowedSurfaces", List.of("back")))))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message", containsString("contentTypeCode")));
    }

    private ResultActions createType(TestSession session, Map<String, Object> body) throws Exception {
        return mockMvc.perform(session.apply(post("/api/v1/admin/content-types")
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))));
    }

    private ResultActions createPrincipal(TestSession session, Map<String, Object> body) throws Exception {
        return mockMvc.perform(session.apply(post("/api/v1/principals")
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))));
    }

    private ResultActions patchPrincipal(TestSession session, String id, Map<String, Object> body) throws Exception {
        return mockMvc.perform(session.apply(patch("/api/v1/principals/{id}", id)
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))));
    }
}
```

### 7.4 BQ-10

`ContentStoreContract.BQ10_publishedQueryFiltersRefsByThePublishedCopy`（in-memory 與 JDBC 各一次）：照片 `moved` 的已發布副本在 a1、工作副本在 a2；公開查詢 `ref.album=a1` 得到 `stays`、`moved`，`ref.album=a2` 為空；工作查詢 `ref.album=a2` 得到 `moved`。照片類型的 `album` 欄位**沒有**設 `indexed`，所以這個測試也證明 ref 欄位一律有索引列。

`src/test/java/com/fallrising/cms/contract/ContentStoreContract.java`：

```diff
--- a/src/test/java/com/fallrising/cms/contract/ContentStoreContract.java
+++ b/src/test/java/com/fallrising/cms/contract/ContentStoreContract.java
@@ -580,6 +580,30 @@
         assertThat(publicSlugs(publicQuery(photo).requiredRefs(List.of("album")))).containsExactly("loose", "in-unlisted", "in-open");
     }
 
+    // ---- BW5: public ref filters follow the published copy (02 BQ-10) ----
+
+    @Test
+    void BQ10_publishedQueryFiltersRefsByThePublishedCopy() {
+        ContentTypeRecord album = insertType("album", field("title", "string"));
+        ContentTypeRecord photo = insertType(type("photo", "title"), field("title", "string"), field("album", "ref"));
+        EntryRecord a1 = entry(album, "a1", PublicationState.PUBLISHED, Map.of("title", "A1"), t(1));
+        EntryRecord a2 = entry(album, "a2", PublicationState.PUBLISHED, Map.of("title", "A2"), t(2));
+        EntryRecord moved = new EntryRecord(UUID.randomUUID(), photo.id(), "photo", "moved", PublicationState.PUBLISHED, 2,
+                Map.of("title", "M", "album", a2.id().toString()), Map.of("title", "M", "album", a1.id().toString()),
+                t(3), null, null, null, null, T0, t(4));
+        EntryRecord stays = entry(photo, "stays", PublicationState.PUBLISHED, Map.of("title", "S", "album", a1.id().toString()), t(5));
+        EntryRecord draft = entry(photo, "draft", PublicationState.DRAFT, Map.of("title", "D", "album", a1.id().toString()), t(6));
+        List.of(a1, a2, moved, stays, draft).forEach(store::insertEntry);
+        store.replaceRefs(moved.id(), List.of(new EntryRefRecord(moved.id(), "album", a2.id(), "entry", 0)));
+        store.replaceRefs(stays.id(), List.of(new EntryRefRecord(stays.id(), "album", a1.id(), "entry", 0)));
+        store.replaceRefs(draft.id(), List.of(new EntryRefRecord(draft.id(), "album", a1.id(), "entry", 0)));
+
+        assertThat(publicSlugs(publicQuery(photo).refs(List.of(new RefFilter("album", a1.id())))))
+                .containsExactlyInAnyOrder("stays", "moved");
+        assertThat(publicSlugs(publicQuery(photo).refs(List.of(new RefFilter("album", a2.id()))))).isEmpty();
+        assertThat(workSlugs(query(photo).refs(List.of(new RefFilter("album", a2.id()))))).containsExactly("moved");
+    }
+
     // ---- BW1b: authorization pushdown (B-10) ----
 
     @Test
```

`EntryIndexBackfillTests.BQ10_v10IndexesRefFieldsOfExistingEntries`：migrate 到 V9、直接以 SQL 寫入一筆含 ref 欄位的 entry，再 migrate 到最新；兩個 scope 都有 `album` 的索引列。

`src/integrationTest/java/com/fallrising/cms/contract/EntryIndexBackfillTests.java`：

```diff
--- a/src/integrationTest/java/com/fallrising/cms/contract/EntryIndexBackfillTests.java
+++ b/src/integrationTest/java/com/fallrising/cms/contract/EntryIndexBackfillTests.java
@@ -13,7 +13,7 @@
 
 import static org.assertj.core.api.Assertions.assertThat;
 
-/** V7 rebuilds cms_entry_index for entries written before BW1b (02 §3.2). */
+/** V7 rebuilds cms_entry_index for entries written before BW1b (02 §3.2); V10 adds rows of ref fields (02 BQ-10). */
 class EntryIndexBackfillTests {
 
     @Test
@@ -50,4 +50,33 @@
         assertThat(store.indexRowsOf(draft)).containsExactly(
                 new IndexRow(draft, "title", IndexScope.WORK, "string", "Draft", null, null, null));
     }
+
+    @Test
+    void BQ10_v10IndexesRefFieldsOfExistingEntries() {
+        DataSource dataSource = PostgresFixture.emptyDataSource();
+        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").target("9").load().migrate();
+        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
+        UUID type = UUID.randomUUID();
+        UUID entry = UUID.randomUUID();
+        UUID oldAlbum = UUID.randomUUID();
+        UUID newAlbum = UUID.randomUUID();
+        jdbc.update("INSERT INTO cms_content_type (id, type_key, display_name, plural_display_name, title_field) "
+                + "VALUES (?, 'photo', 'Photo', 'Photos', 'title')", type);
+        jdbc.update("INSERT INTO cms_field (id, content_type_id, field_key, field_type, indexed) VALUES (?, ?, 'title', 'string', false)",
+                UUID.randomUUID(), type);
+        jdbc.update("INSERT INTO cms_field (id, content_type_id, field_key, field_type, indexed) VALUES (?, ?, 'album', 'ref', false)",
+                UUID.randomUUID(), type);
+        jdbc.update("INSERT INTO cms_entry (id, content_type_id, slug, publication_state, payload, published_payload) "
+                + "VALUES (?, ?, 'a', 'published', CAST(? AS jsonb), CAST(? AS jsonb))", entry, type,
+                "{\"title\":\"T\",\"album\":\"" + newAlbum + "\"}", "{\"title\":\"T\",\"album\":\"" + oldAlbum + "\"}");
+
+        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();
+
+        JdbcContentStore store = new JdbcContentStore(dataSource, new ObjectMapper());
+        assertThat(store.indexRowsOf(entry)).containsExactly(
+                new IndexRow(entry, "album", IndexScope.PUBLISHED, "ref", oldAlbum.toString(), null, null, null),
+                new IndexRow(entry, "title", IndexScope.PUBLISHED, "string", "T", null, null, null),
+                new IndexRow(entry, "album", IndexScope.WORK, "ref", newAlbum.toString(), null, null, null),
+                new IndexRow(entry, "title", IndexScope.WORK, "string", "T", null, null, null));
+    }
 }
```

`PublicRefFilterApiTests`：operator 建兩本相簿並發布；照片在第一本發布後改到第二本（不重新發布）：公開列表 `ref.album=第一本` 有它、第二本沒有；重新發布後相反。

`src/test/java/com/fallrising/cms/PublicRefFilterApiTests.java`：

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
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 02 BQ-10: the public list's ref.<field> follows the published copy, not the working copy. */
@SpringBootTest
@AutoConfigureMockMvc
class PublicRefFilterApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void BQ10_photoMovedToAnotherAlbumStaysInThePublishedAlbumUntilRepublished() throws Exception {
        ApiFixture api = new ApiFixture(mockMvc, mapper);
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String first = api.create(op, "album", Map.of("title", ApiFixture.token("First "))).get("id").asText();
        String second = api.create(op, "album", Map.of("title", ApiFixture.token("Second "))).get("id").asText();
        api.action(op, first, "publish").andExpect(status().isOk());
        api.action(op, second, "publish").andExpect(status().isOk());
        JsonNode photo = api.create(op, "photo", Map.of("title", "Moving", "album", first));
        String id = photo.get("id").asText();
        api.action(op, id, "publish").andExpect(status().isOk());
        api.patchEntry(op, id, api.work(op, id).get("version").asInt(), Map.of("title", "Moving", "album", second))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", first))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].id").value(id));
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", second))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));

        api.action(op, id, "publish").andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", second))
                .andExpect(jsonPath("$.total").value(1));
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", first))
                .andExpect(jsonPath("$.total").value(0));
    }
}
```

### 7.5 媒體 store 契約（`MediaStoreContract`，in-memory 與 JDBC 各一次）

| 測試 | 斷言 |
| --- | --- |
| `BQ11_findAllReturnsKnownMediaWithVariantsIncludingDeleted` | 可用的、已刪除的都回傳，未知的 id 與重複的 id 略過；variants 一併回傳；空集合回空 |
| `BQ11_attachmentsOfManyMedia` | 只回傳指定媒體的附著；空集合回空 |

`src/test/java/com/fallrising/cms/contract/MediaStoreContract.java`：

```diff
--- a/src/test/java/com/fallrising/cms/contract/MediaStoreContract.java
+++ b/src/test/java/com/fallrising/cms/contract/MediaStoreContract.java
@@ -108,6 +108,39 @@
         assertThat(store.quota()).isEqualTo(new MediaStore.Quota(15_728_640L, 2_147_483_648L, 10_000, 2_000));
     }
 
+    @Test
+    void BQ11_findAllReturnsKnownMediaWithVariantsIncludingDeleted() {
+        MediaAsset a = asset(UUID.randomUUID(), "available", null, T0);
+        MediaAsset b = asset(UUID.randomUUID(), "deleted", T0.plusSeconds(1), T0);
+        MediaAsset c = asset(UUID.randomUUID(), "available", null, T0);
+        List.of(a, b, c).forEach(store::insert);
+        MediaVariant thumb = variant(a.id(), "thumbnail", "image/jpeg", 10, 320, 240);
+        store.insertVariant(thumb);
+
+        List<MediaAsset> found = store.findAll(List.of(a.id(), b.id(), UUID.randomUUID(), a.id()));
+        assertThat(found).extracting(MediaAsset::id).containsExactlyInAnyOrder(a.id(), b.id());
+        MediaAsset foundA = found.stream().filter(m -> m.id().equals(a.id())).findFirst().orElseThrow();
+        assertThat(foundA).usingRecursiveComparison().ignoringFields("variants").isEqualTo(a);
+        assertThat(foundA.variants()).containsExactly(thumb);
+        assertThat(store.findAll(List.of())).isEmpty();
+    }
+
+    @Test
+    void BQ11_attachmentsOfManyMedia() {
+        MediaAsset a = asset(UUID.randomUUID(), "available", null, T0);
+        MediaAsset b = asset(UUID.randomUUID(), "available", null, T0);
+        MediaAsset c = asset(UUID.randomUUID(), "available", null, T0);
+        List.of(a, b, c).forEach(store::insert);
+        UUID entry = UUID.randomUUID();
+        store.replaceAttachments(entry, List.of(
+                new MediaAttachment(a.id(), entry, "cover", T0), new MediaAttachment(b.id(), entry, "media", T0)));
+        store.replaceAttachments(UUID.randomUUID(), List.of(new MediaAttachment(c.id(), UUID.randomUUID(), "cover", T0)));
+
+        assertThat(store.attachmentsOfMedia(List.of(a.id(), b.id()))).containsExactlyInAnyOrder(
+                new MediaAttachment(a.id(), entry, "cover", T0), new MediaAttachment(b.id(), entry, "media", T0));
+        assertThat(store.attachmentsOfMedia(List.of())).isEmpty();
+    }
+
     protected static MediaAsset asset(UUID owner, String status, Instant deletedAt, Instant createdAt) {
         return new MediaAsset(UUID.randomUUID(), owner, "Title", "Alt", "shot.png", "image/png", 100, 150, 640, 480,
                 "a".repeat(64), status, deletedAt, createdAt, createdAt, List.of());
```

### 7.6 `PublicMediaCountTests`（MockMvc，spy store）

operator 建一本相簿與 3 張各有一個媒體的照片並全部發布。公開列表 `ref.album=<相簿>` 以 `size=1` 與 `size=3` 各請求一次：content store 與 media store 的呼叫序列相同；media store 正好是 `findAll`、`attachmentsOfMedia`；每頁最後一筆的 `payload.media.variants.thumbnail.url` 存在（媒體確實有展開）。

`src/test/java/com/fallrising/cms/PublicMediaCountTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.media.store.MediaStore;
import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.mockito.invocation.Invocation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 02 BQ-11 and §5.4: a public list whose entries carry media-ref values makes the same content-store and media-store
 * calls for 1 item as for 3 (media are resolved for the whole page at once).
 */
@SpringBootTest
@AutoConfigureMockMvc
class PublicMediaCountTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @MockitoSpyBean
    ContentStore contentStore;

    @MockitoSpyBean
    MediaStore mediaStore;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void BQ11_publicListWithMediaStoreCallsDoNotGrowWithItems() throws Exception {
        ApiFixture api = new ApiFixture(mockMvc, mapper);
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String album = api.create(op, "album", Map.of("title", ApiFixture.token("Media "))).get("id").asText();
        api.action(op, album, "publish").andExpect(status().isOk());
        for (int i = 0; i < 3; i++) {
            String media = mapper.readTree(mockMvc.perform(op.apply(multipart("/api/v1/media")
                            .file(new MockMultipartFile("file", "p" + i + ".png", "image/png", png()))))
                    .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText();
            String photo = api.create(op, "photo", Map.of("title", "P" + i, "album", album, "media", media, "sortOrder", i))
                    .get("id").asText();
            api.action(op, photo, "publish").andExpect(status().isOk());
        }

        Calls one = calls(get("/api/v1/public/content-types/photo/entries").param("ref.album", album).param("size", "1"), 1);
        Calls three = calls(get("/api/v1/public/content-types/photo/entries").param("ref.album", album).param("size", "3"), 3);
        assertThat(three.content()).isEqualTo(one.content());
        assertThat(three.media()).isEqualTo(one.media());
        assertThat(one.media()).containsExactly("findAll", "attachmentsOfMedia");
    }

    record Calls(List<String> content, List<String> media) {}

    private Calls calls(MockHttpServletRequestBuilder request, int items) throws Exception {
        Mockito.clearInvocations(contentStore, mediaStore);
        mockMvc.perform(request)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(items))
                .andExpect(jsonPath("$.items[" + (items - 1) + "].payload.media.variants.thumbnail.url").exists());
        return new Calls(names(contentStore), names(mediaStore));
    }

    private static List<String> names(Object spy) {
        return Mockito.mockingDetails(spy).getInvocations().stream().map(Invocation::getMethod).map(m -> m.getName()).toList();
    }

    private static byte[] png() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }
}
```

### 7.7 故障注入

沒有。資料庫失敗的行為不變（BW0 `ApiExceptionHandlerTests`、BW4 `AuditRollbackIntegrationTests`）。

---

## 8. 失敗模式對照

| FM ID | 失敗情境 | 期望行為 | 由哪個測試覆蓋 | 任務卡 |
| --- | --- | --- | --- | --- |
| BW5-FM01 | principal id 不存在 | 404 `PRINCIPAL_NOT_FOUND`（7 個 operation） | `PrincipalNotFoundApiTests` | T01、T02 |
| BW5-FM02 | principal id 格式錯誤 | 400 `VALIDATION_FAILED`（不變） | BW0 既有測試 | — |
| BW5-FM03 | 前端仍比對小寫媒體代碼 | 比對不到；依 §4.2 替換 | 前端波次 | — |
| BW5-FM04 | 媒體錯誤 | 大寫代碼 | `MediaErrorCodeApiTests` | T03、T04 |
| BW5-FM05 | 建立類型的輸入超出資料庫限制 | 422，全部問題一次回報，不寫入 | `BQ08_contentType…` | T05、T06 |
| BW5-FM06 | principal 的 displayName／email 超長 | 400 | `BQ08_principal…` | T05、T06 |
| BW5-FM07 | email 已被使用（不分大小寫） | 400 `email is taken`；自己的不算 | `BQ08_principal…` | T05、T06 |
| BW5-FM08 | 權限的 `contentTypeCode` 超長 | 400 | `BQ08_principal…` | T05、T06 |
| BW5-FM09 | 兩個請求同時用同一個 email | 第二個 500（資料庫唯一索引）；接受 | 沒有測試（§1.2） | — |
| BW5-FM10 | 已發布副本與工作副本的關聯不同 | 公開列表依已發布副本 | `BQ10_…`（契約、API） | T07、T08 |
| BW5-FM11 | 升級既有資料庫 | V10 補上 ref 欄位的索引列 | `EntryIndexBackfillTests.BQ10_…` | T07、T08 |
| BW5-FM12 | 公開列表每頁的媒體很多 | store 呼叫數與筆數無關 | `PublicMediaCountTests` | T11、T12 |
| BW5-FM13 | 媒體無法公開（草稿、非公開欄位、目標未發布） | 展開為 null（B-13，不變） | BW1c 既有測試、`MediaApiTests` | T12 |

---

## 9. 交付檢查表

- [ ] T01～T13 全部完成。
- [ ] `./gradlew test` 全綠（預期 239 個＝BW4 的 230＋本波 9）。
- [ ] `./gradlew integrationTest` 全綠（預期 80 個＝BW4 的 76＋本波 4）。
- [ ] `npm ci && npm run lint && npm run typecheck && npm test && npm run build` 全綠；或只有 BW1c §2.1 的 codegen 新鮮度／fixture 型別失敗，並已在 PR 說明列出。
- [ ] `cmp docs/v2/contracts/BW5.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。
- [ ] PR 說明附上 §4.2 的對照表。
- [ ] `gradle.lockfile` 沒有變動。
- [ ] 沒有秘密或密碼。
- [ ] `docs/v2/README.md` 的 BW5 狀態已改成 `VERIFIED`。
- [ ] PR 說明列出實際跑過的指令與結果。

---

## 10. BW5 必寫內容索引

| 要求 | 位置 |
| --- | --- |
| 每個 BQ 的前後對照與測試（02 BQ 的選項 A） | §4.2～§4.5、§7 |
| 前端看得到的變更 | §4.2 |
| 資料庫限制的盤點（BQ-08） | §4.3 |
