# BW1a 施工圖 — 類型設定與欄位中繼資料

[回 v2 索引](../README.md) ・ 框架：[02 §7 BW1a](../02-backend-sdd.md#7-後端波次) ・ 契約：[contracts/BW1a.openapi.yaml](../contracts/BW1a.openapi.yaml) ・ 前一波：[BW0](BW0.md)

狀態：**DOC_READY**（本檔合併即生效）  
日期：2026-09-25  
讀者：實作 BW1a 的 agent。只讀本檔、`contracts/BW1a.openapi.yaml` 與本檔引用的檔案就能完成，不需要做任何設計決定。

> **預演紀錄。** 本檔的程式碼、YAML 與測試，已套用在「BW0 施工圖完成後」的 `services/cms-api` 副本上，並逐張任務卡執行過（2026-09-25）。T02、T04、T06、T08 完成後，`./gradlew :services:cms-api:test` 依序是 116、120、124、139 個測試，每次唯一失敗的是 `CmsApiApplicationTests.runtimeIsJava25`（預演環境只有 JDK 21）；`integrationTest` 每次都是 49 個全綠，但用的是本機 PostgreSQL 16.13，不是 Testcontainers。各「測試先行」卡的預期紅燈清單也是實際跑出來的。

---

## 1. 範圍

### 1.1 解決的 ID

| ID | 來源 | 本波次做到什麼程度 |
| --- | --- | --- |
| B-03 | 02 §1.2 | kernel 不再讀 demo 欄位名：公開可見性讀 `visibilityField`、公開排序讀 `sortField`、工作投影標題與 `q` 搜尋讀 `titleField` |
| B-04 | 02 §1.2 | `/auth/me` 與登入回應新增 `capabilities` |
| B-05 | 02 §1.2 | 欄位中繼資料（`label`、`group`、`listable`、`filterable`、`enumLabels`、`placeholder`、`helpText`、`visibility`、`order`）對外輸出 |
| B-12 | 02 §1.2 | 同一個 HTTP 請求內，每個 principal 的角色與權限只從 store 讀一次 |
| G-01 | 01 §9 | `capabilities` |
| G-05 | 01 §9 | 欄位中繼資料 |
| G-06 | 01 §9 | `enumLabels`（種子提供 zh-Hant） |
| G-11 | 01 §9 | 工作投影的 `title` 取 `payload[titleField]` |
| BD-05、BD-06、BD-07 | 02 §2 | 全部 |

稽核 ID：C-12（Back 列表只顯示 slug）的後端成因由 G-11 修掉；前端部分在 W1。

### 1.2 不做

- 01 §1.2、AGENTS.md「不要做」全部。
- BW1b 的範圍：V6／V7、`cms_entry_index` 寫入、分頁、`sort`／`filter.<field>` 參數、predicate 下推、效能量測（B-02、B-09、B-10、G-02）。本波次的列表仍然一次回全部，`total` 仍等於筆數。
- BW1c 的範圍：欄位錯誤收集與 `error.fields`、428、公開投影的媒體 null（B-06、B-13、G-07）。
- `/me` 端點（`ownerField` 只存與輸出，BW3 才使用）。
- 管理端建立或修改類型設定與欄位中繼資料：`POST /admin/content-types` 的 request 不變，新類型的設定一律是 null、欄位中繼資料一律是空值；修改的 API 不在 v2 已排的波次裡。
- 類型的顯示名稱（`displayName`）維持英文，種子不改。
- 公開的類型清單（`GET /public/content-types`）不加欄位中繼資料。
- 不新增依賴，所以 `gradle.lockfile` 不變。

---

## 2. 先決條件

### 2.1 前置波次

- **BW0 必須已是 `VERIFIED`**。本波次直接修改 BW0 新增的檔案：`ContentStoreContract.java`（新增案例並改 `listEntries` 呼叫）、`openapi.yaml`（以 BW1a 契約整檔取代）、`TestSession.java`（新測試使用）、`OpenApiValidationConfig`（全域回應驗證，所以 T08 前後的 `/auth/me` 回應必須與契約一致）。
- 本檔所有 diff 都以「BW0 施工圖完成後」的檔案為基準；如果 `main` 上的這些檔案與 BW0 施工圖的結果不同，先停下來回報，不要硬套。

### 2.2 環境

與 [BW0 §2.2](BW0.md#22-環境) 相同：JDK 25、`./gradlew`、`integrationTest` 需要 Docker、沒有新的環境變數。

### 2.3 查證過的外部事實

本波次沒有新的外部依賴或函式庫 API。用到的 Spring API：`RequestContextHolder.getRequestAttributes()`、`RequestAttributes.getAttribute/setAttribute(name, value, SCOPE_REQUEST)`、`ServletRequestAttributes`，以 spring-web 6.2.19（Boot 3.5.16 BOM 解析的版本，見 [BW0 §2.3](BW0.md#23-查證過的外部事實)）在預演中編譯並執行（`GrantCacheTests`）。另一個測試寫法上的事實也是預演中實測得出：Spring 的 `jsonPath(...).value(List.of(...))` 會把 JSON 轉成預期值的類別，對 `List.of` 回傳 null，所以本檔的測試比對 JSON 陣列時一律用 Hamcrest 的 `equalTo(...)` 或 `hasItem(...)`。

---

## 3. 檔案清單

路徑相對於 `apps/cms-scaffold/services/cms-api/`，另有註明者除外。**實作者不得碰清單以外的檔案。**

| 路徑 | 動作 | 用途 | 任務卡 |
| --- | --- | --- | --- |
| `src/main/resources/db/migration/V5__type_settings_and_field_metadata.sql` | 新增 | 類型設定與欄位中繼資料欄 | T02 |
| `src/main/java/com/fallrising/cms/content/domain/ContentTypeRecord.java` | 修改（整檔取代） | 新增 `sortField`、`visibilityField`、`ownerField` | T02 |
| `src/main/java/com/fallrising/cms/content/domain/FieldRecord.java` | 修改（整檔取代） | 新增 7 個中繼資料欄 | T02 |
| `src/main/java/com/fallrising/cms/content/store/ContentStore.java` | 修改 | `updateTypeSettings`、`updateFieldMetadata`；`listEntries` 加 `titleField` | T02 |
| `src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java` | 修改 | 同上 | T02 |
| `src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java` | 修改 | 同上，並讀寫新欄 | T02 |
| `src/main/java/com/fallrising/cms/content/service/EntryService.java` | 修改 | T02：傳 `titleField` 給 `listEntries`；T06：可見性與排序改讀類型設定 | T02、T06 |
| `src/main/java/com/fallrising/cms/content/service/ContentTypeSeed.java` | 修改（整檔取代） | 類型設定、欄位標籤與 enum 標籤；對既有資料庫補值 | T04 |
| `src/main/java/com/fallrising/cms/content/PublicVisibility.java` | 修改（整檔取代） | 改讀 `visibilityField` | T06 |
| `src/main/java/com/fallrising/cms/media/service/MediaService.java` | 修改 | 呼叫新的 `PublicVisibility` | T06 |
| `src/main/java/com/fallrising/cms/content/web/ContentProjection.java` | 修改 | 工作投影標題、類型與欄位 schema | T08 |
| `src/main/java/com/fallrising/cms/content/web/EntryController.java` | 修改 | 用新的投影 | T08 |
| `src/main/java/com/fallrising/cms/content/web/AdminContentController.java` | 修改 | 用新的投影 | T08 |
| `src/main/java/com/fallrising/cms/content/web/StoreContentTypeDirectory.java` | 新增 | 提供啟用中的類型給 identity | T08 |
| `src/main/java/com/fallrising/cms/identity/domain/Capabilities.java` | 新增 | `capabilities` 的資料型別 | T08 |
| `src/main/java/com/fallrising/cms/identity/service/ContentTypeDirectory.java` | 新增 | identity 不直接依賴 content 的介面 | T08 |
| `src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java` | 修改 | `capabilities()`；請求內快取 grant | T08 |
| `src/main/java/com/fallrising/cms/identity/web/AuthController.java` | 修改 | `/auth/me` 與登入回應加 `capabilities` | T08 |
| `src/main/resources/openapi/openapi.yaml` | 修改（整檔取代） | 等於 `docs/v2/contracts/BW1a.openapi.yaml` | T08 |
| `src/test/java/com/fallrising/cms/contract/ContentStoreContract.java` | 修改 | 5 個新案例；`listEntries` 呼叫加 `"title"` | T01 |
| `src/test/java/com/fallrising/cms/content/service/ContentTypeSeedTests.java` | 新增 | 種子 | T03 |
| `src/test/java/com/fallrising/cms/PublicVisibilityTests.java` | 新增 | 可見性 | T05 |
| `src/test/java/com/fallrising/cms/content/service/PublicOrderTests.java` | 新增 | 公開排序 | T05 |
| `src/test/java/com/fallrising/cms/TypeSchemaTests.java` | 新增 | 類型 schema 與標題（MockMvc） | T07 |
| `src/test/java/com/fallrising/cms/CapabilitiesTests.java` | 新增 | `capabilities`（MockMvc） | T07 |
| `src/test/java/com/fallrising/cms/identity/service/GrantCacheTests.java` | 新增 | 授權快取 | T07 |
| `apps/cms-scaffold/docs/v2/README.md` | 修改 | 路線圖 BW1a 狀態改 `VERIFIED` | T09 |

不會碰：`build.gradle.kts`、`gradle.lockfile`、V1～V4、`DemoContentSeed.java`、`SeedService.java`、既有測試類別（`ContentStoreContract.java` 除外）、前端、`e2e/`、workflow。

---

## 4. 契約

### 4.1 OpenAPI

完整契約是 [`docs/v2/contracts/BW1a.openapi.yaml`](../contracts/BW1a.openapi.yaml)，`info.version` 0.5.0。合併方式同 BW0：T08 整檔取代 `openapi.yaml`。撰寫規則沿用 [BW0 §4.1](BW0.md#41-openapi) 的 R1～R10。

相對於 BW0 契約的變更（全部是新增欄位或描述，沒有移除，也沒有新的 operation 或錯誤代碼）：

| schema／operation | 變更 |
| --- | --- |
| `Me`、`LoginResponse` | 新增必填 `capabilities`（`Capabilities`） |
| `Capabilities`（新） | `surface`、`types[]`、`global[]` |
| `TypeCapability`（新） | `key`、`actions[]`、`scoped` |
| `WorkContentType`、`AdminContentType` | 新增 `sortField`、`visibilityField`、`ownerField`（皆 nullable）、`singleton`、`previewable` |
| `WorkField`、`AdminField` | 新增 `label`、`helpText`、`group`、`order`、`listable`、`filterable`、`enumLabels`、`placeholder`、`visibility`；`AdminField` 另有 `enabled`（`indexed` 原本就有） |
| `WorkEntry.title` | 描述改為「`payload[titleField]`」 |
| `listPublicEntries`、`getPublicEntry` | 描述改為依 `visibilityField` 與 `sortField` |
| 參數 `Q` | 描述改為「`payload[titleField]` 的字面子字串，不分大小寫」 |

`WorkField` 不列出 `enabled=false` 或 `visibility=internal` 的欄位；`AdminField` 列出全部欄位。

### 4.2 行為變更（API 可觀察）

| 項目 | 以前 | 以後 | 受影響的種子類型 |
| --- | --- | --- | --- |
| 公開列表的可見性 | 所有類型都讀 payload 的 `visibility` 鍵 | 只讀類型的 `visibilityField`；沒設定的類型全部公開 | 只有 `album`、`project` 有這個欄位，結果不變 |
| 公開列表排序 | 所有類型依 payload 的 `sortOrder` 數字遞增（沒有數字的排最後），再依 `updatedAt` 遞減 | 有 `sortField` 的類型依該欄數字遞增（沒有數字的排最後），再依 `updatedAt` 遞減；沒有 `sortField` 的依 `publishedAt` 遞減，再依 `updatedAt` 遞減 | `photo`、`milestone` 不變；`album`、`page`、`project`、`vet`、`clinic_profile` 從「最近更新」變成「最近發布」在前 |
| 工作投影的 `title` | `payload.title` | `payload[titleField]` | `clinic_profile` 從 null 變成 `name` 的值（修 C-12） |
| 工作列表的 `q` | 比對 `payload.title` | 比對 `payload[titleField]` | `clinic_profile` 可以用名稱搜尋 |
| `/auth/me`、登入回應 | 沒有 `capabilities` | 有 | 全部 |
| `GET /content-types[/{key}]`、`GET /admin/content-types` | 欄位只有 `key`、`type`、`required`、`refTarget`、`enumValues`（admin 另有 `indexed`） | §4.1 的全部欄位 | 全部 |

### 4.3 範例

`GET /api/v1/content-types/album`（`seed-operator-album`，Back），節錄兩個欄位：

```json
{
  "key": "album",
  "displayName": "Album",
  "pluralDisplayName": "Albums",
  "titleField": "title",
  "sortField": null,
  "visibilityField": "visibility",
  "ownerField": null,
  "slugPolicy": "required",
  "singleton": false,
  "previewable": true,
  "fields": [
    { "key": "title", "type": "string", "label": "標題", "helpText": null, "required": true, "group": "main",
      "order": 0, "listable": true, "filterable": false, "enumValues": [], "enumLabels": {}, "refTarget": null,
      "placeholder": null, "visibility": "public" },
    { "key": "visibility", "type": "enum", "label": "可見性", "helpText": null, "required": false, "group": "settings",
      "order": 3, "listable": true, "filterable": true, "enumValues": ["public", "unlisted"],
      "enumLabels": { "public": "公開", "unlisted": "不公開列出" }, "refTarget": null, "placeholder": null,
      "visibility": "public" }
  ]
}
```

`GET /api/v1/auth/me` 的 `capabilities`（`seed-editor-album`，Back）：

```json
{
  "surface": "back",
  "types": [
    { "key": "album", "actions": ["read_published", "read_draft", "create", "update"], "scoped": false },
    { "key": "clinic_profile", "actions": ["read_published"], "scoped": false },
    { "key": "milestone", "actions": ["read_published"], "scoped": false },
    { "key": "page", "actions": ["read_published"], "scoped": false },
    { "key": "photo", "actions": ["read_published", "read_draft", "create", "update"], "scoped": false },
    { "key": "project", "actions": ["read_published"], "scoped": false },
    { "key": "vet", "actions": ["read_published"], "scoped": false }
  ],
  "global": ["manage_media"]
}
```

`clinic_profile` 等類型出現在清單裡，是因為 anonymous 角色對公開類型有 `read_published`，而 anonymous 的 grant 適用於每個人。前端側欄要依自己的規則過濾（01 §7.2：有 `read_draft`／`create`／`update` 的類型才放側欄）。

失敗範例：本波次沒有新的錯誤。`/auth/me` 未登入時仍是 401 `UNAUTHENTICATED`（[BW0 §4.4](BW0.md#44-範例)）。

### 4.4 `capabilities` 的計算規則

輸入：principal、請求的 surface（`IdentityRequest.surface()`）、啟用中的類型 key（依 key 遞增）。

1. 取得 grant：anonymous 角色的全部 permission，加上 principal 每個角色的全部 permission（同 `AuthorizationService.collectGrants`）。
2. 對每個類型 T，依序檢查 `read_published, read_draft, create, update, publish, unpublish, delete, archive`：
   1. surface 是 Front 且動作在 `FRONT_HARD_DENY`，或 surface 是 Back 且動作在 `BACK_HARD_DENY`：跳過。
   2. 找出所有「不看 predicate 時符合 (動作, T, surface)」的 grant（`matchesGrant`：動作相同、surface 在 `allowedSurfaces`、editor／operator 的 allowlist 含 T、permission 的 `contentTypeCode` 為空或等於 T）。
   3. 沒有符合的：跳過。有：把動作加入清單；如果符合的 grant **全部**帶 predicate，`scoped = true`。
3. 動作清單非空的類型才輸出。
4. `global`：依序檢查 `manage_media, manage_types, manage_principals, manage_settings, read_audit`，套用同樣的 hard-deny，再看是否有 `matchesGrant(grant, 動作, null, surface)` 為真的 grant。

### 4.5 資料表：V5 全文

`src/main/resources/db/migration/V5__type_settings_and_field_metadata.sql`：

```sql
-- BW1a: content type settings and field metadata (02 §3.1).
-- Kernel columns only; demo values are written by ContentTypeSeed, not here.

ALTER TABLE cms_content_type
    ADD COLUMN sort_field       VARCHAR(63),
    ADD COLUMN visibility_field VARCHAR(63),
    ADD COLUMN owner_field      VARCHAR(63);

ALTER TABLE cms_field
    ADD COLUMN label       VARCHAR(80),
    ADD COLUMN group_key   VARCHAR(32),
    ADD COLUMN listable    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN filterable  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN enum_labels JSONB,
    ADD COLUMN placeholder VARCHAR(120);
```

- 只新增 nullable 欄或有預設值的欄，所以既有資料列不需要回填 SQL：demo 類型的值由 `ContentTypeSeed` 在下次啟動時補上（§5.3）。
- 沒有新的 CHECK 或 UNIQUE。`group_key` 不限制值（02 §3.1：main／media／relations／settings 或自訂）；`sort_field` 等欄位不以外鍵約束欄位存在，因為欄位由 `(content_type_id, field_key)` 識別，不是 id。
- 向前修正：已合併的 V5 不能再改；要改欄位定義就新增 V6 之後的 migration（BW1b 的 V6 已經排定用途，額外修正依序往後編號）。

### 4.6 型別

- Java：`ContentTypeRecord`、`FieldRecord`、`Capabilities` 全文在 §5.1、§5.5。`ContentTypeRecord` 與 `FieldRecord` 各保留一個**舊參數數量**的建構子，新欄位預設 null／false／空 Map，所以既有的建構呼叫（`AdminContentController`、`DemoContentSeed`、測試）不用改。
- TypeScript：W0 由 `openapi-typescript` 產生；schema 名稱見 §4.1。

---

## 5. 模組規格

本波次沒有前端與文案（種子的 zh-Hant 標籤是資料，不是 copy key）。transaction 邊界：沒有新增或改變。

### 5.1 資料型別與 store（T02）

`ContentTypeRecord`（整檔取代）。新欄位接在最後；`withEnabled` 要保留設定；新增 `withSettings`。

`src/main/java/com/fallrising/cms/content/domain/ContentTypeRecord.java`：

```java
package com.fallrising.cms.content.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A content type. sortField, visibilityField and ownerField name fields of this type (null = not set):
 * sortField orders public lists, visibilityField holds public/unlisted/private, ownerField is a principal-ref.
 */
public record ContentTypeRecord(
        UUID id,
        String typeKey,
        String displayName,
        String pluralDisplayName,
        String description,
        String titleField,
        String slugPolicy,
        boolean singleton,
        boolean enabled,
        boolean previewable,
        List<String> publicRequiresPublishedRefs,
        Instant createdAt,
        Instant updatedAt,
        String sortField,
        String visibilityField,
        String ownerField) {

    /** Type without settings (sortField, visibilityField, ownerField all null). */
    public ContentTypeRecord(
            UUID id,
            String typeKey,
            String displayName,
            String pluralDisplayName,
            String description,
            String titleField,
            String slugPolicy,
            boolean singleton,
            boolean enabled,
            boolean previewable,
            List<String> publicRequiresPublishedRefs,
            Instant createdAt,
            Instant updatedAt) {
        this(id, typeKey, displayName, pluralDisplayName, description, titleField, slugPolicy, singleton, enabled,
                previewable, publicRequiresPublishedRefs, createdAt, updatedAt, null, null, null);
    }

    public ContentTypeRecord withEnabled(boolean enabled, Instant now) {
        return new ContentTypeRecord(
                id,
                typeKey,
                displayName,
                pluralDisplayName,
                description,
                titleField,
                slugPolicy,
                singleton,
                enabled,
                previewable,
                publicRequiresPublishedRefs,
                createdAt,
                now,
                sortField,
                visibilityField,
                ownerField);
    }

    public ContentTypeRecord withSettings(String sortField, String visibilityField, String ownerField, Instant now) {
        return new ContentTypeRecord(
                id,
                typeKey,
                displayName,
                pluralDisplayName,
                description,
                titleField,
                slugPolicy,
                singleton,
                enabled,
                previewable,
                publicRequiresPublishedRefs,
                createdAt,
                now,
                sortField,
                visibilityField,
                ownerField);
    }
}
```

`FieldRecord`（整檔取代）。`enumLabels` 在 compact constructor 中把 null 轉成空 Map；新增 `withPublicBytes`、`withMetadata`。

`src/main/java/com/fallrising/cms/content/domain/FieldRecord.java`：

```java
package com.fallrising.cms.content.domain;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * A field of a content type. The last seven components are display metadata (02 BD-06): label, groupKey,
 * listable, filterable, enumLabels (enum value to display name; never null), placeholder, helpText.
 */
public record FieldRecord(
        UUID id,
        UUID contentTypeId,
        String fieldKey,
        String fieldType,
        boolean required,
        boolean uniqueInType,
        boolean indexed,
        String visibility,
        int sortOrder,
        String refTargetTypeKey,
        String onDelete,
        List<String> enumValues,
        boolean enabled,
        boolean publicBytes,
        String label,
        String groupKey,
        boolean listable,
        boolean filterable,
        Map<String, String> enumLabels,
        String placeholder,
        String helpText) {

    public FieldRecord {
        enumLabels = enumLabels == null ? Map.of() : Map.copyOf(enumLabels);
    }

    /** Field without display metadata. */
    public FieldRecord(
            UUID id,
            UUID contentTypeId,
            String fieldKey,
            String fieldType,
            boolean required,
            boolean uniqueInType,
            boolean indexed,
            String visibility,
            int sortOrder,
            String refTargetTypeKey,
            String onDelete,
            List<String> enumValues,
            boolean enabled,
            boolean publicBytes) {
        this(id, contentTypeId, fieldKey, fieldType, required, uniqueInType, indexed, visibility, sortOrder,
                refTargetTypeKey, onDelete, enumValues, enabled, publicBytes, null, null, false, false, Map.of(), null, null);
    }

    public FieldRecord withPublicBytes(boolean publicBytes) {
        return new FieldRecord(id, contentTypeId, fieldKey, fieldType, required, uniqueInType, indexed, visibility,
                sortOrder, refTargetTypeKey, onDelete, enumValues, enabled, publicBytes, label, groupKey, listable,
                filterable, enumLabels, placeholder, helpText);
    }

    public FieldRecord withMetadata(String label, String groupKey, boolean listable, boolean filterable,
            Map<String, String> enumLabels, String placeholder, String helpText) {
        return new FieldRecord(id, contentTypeId, fieldKey, fieldType, required, uniqueInType, indexed, visibility,
                sortOrder, refTargetTypeKey, onDelete, enumValues, enabled, publicBytes, label, groupKey, listable,
                filterable, enumLabels, placeholder, helpText);
    }
}
```

Store：

- `updateTypeSettings(type)`：只寫 `sortField`、`visibilityField`、`ownerField`、`updatedAt`（BW0 契約規定 `updateType` 只寫 5 欄，所以另開一個方法）。
- `updateFieldMetadata(field)`：以 `field.id()` 找到欄位，只寫 7 個中繼資料欄。
- `listEntries` 多一個 `titleField` 參數，`q` 比對 `payload[titleField]`；`titleField` 為 null 時 `q` 不會命中任何 entry。JDBC 寫成 `payload->>?` 並綁定參數。
- `enum_labels` 在 JDBC 以 JSONB 儲存；空 Map 寫成 `{}`，讀回空 Map；SQL NULL 也讀成空 Map。

`src/main/java/com/fallrising/cms/content/store/ContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/ContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/ContentStore.java
@@ -21,17 +21,25 @@
 
     void updateType(ContentTypeRecord type);
 
+    /** Writes only sortField, visibilityField, ownerField and updatedAt of the type with type.id(). */
+    void updateTypeSettings(ContentTypeRecord type);
+
     List<FieldRecord> fieldsOf(UUID typeId);
 
     void insertField(FieldRecord field);
 
+    /** Writes only label, groupKey, listable, filterable, enumLabels, placeholder and helpText of the field with field.id(). */
+    void updateFieldMetadata(FieldRecord field);
+
     default void markMediaRefsPublic() {}
 
     Optional<EntryRecord> findEntry(UUID id);
 
     Optional<EntryRecord> findBySlug(UUID typeId, String slug);
 
-    List<EntryRecord> listEntries(UUID typeId, List<String> states, boolean includeDeleted, String q, String refField, UUID refTarget);
+    /** q matches payload[titleField] case-insensitively as a literal substring; blank q means no filter. */
+    List<EntryRecord> listEntries(
+            UUID typeId, List<String> states, boolean includeDeleted, String titleField, String q, String refField, UUID refTarget);
 
     long countEntries(UUID typeId, boolean includeDeleted);
```

`src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
@@ -57,7 +57,17 @@
                 current.previewable(),
                 current.publicRequiresPublishedRefs(),
                 current.createdAt(),
-                type.updatedAt()));
+                type.updatedAt(),
+                current.sortField(),
+                current.visibilityField(),
+                current.ownerField()));
+    }
+
+    @Override
+    public void updateTypeSettings(ContentTypeRecord type) {
+        types.computeIfPresent(type.typeKey(), (key, current) -> current.id().equals(type.id())
+                ? current.withSettings(type.sortField(), type.visibilityField(), type.ownerField(), type.updatedAt())
+                : current);
     }
 
     @Override
@@ -73,26 +83,24 @@
     }
 
     @Override
+    public void updateFieldMetadata(FieldRecord field) {
+        List<FieldRecord> list = fields.get(field.contentTypeId());
+        if (list == null) {
+            return;
+        }
+        list.replaceAll(current -> current.id().equals(field.id())
+                ? current.withMetadata(field.label(), field.groupKey(), field.listable(), field.filterable(),
+                        field.enumLabels(), field.placeholder(), field.helpText())
+                : current);
+    }
+
+    @Override
     public void markMediaRefsPublic() {
         fields.replaceAll((typeId, list) -> {
             List<FieldRecord> next = new CopyOnWriteArrayList<>();
             for (FieldRecord field : list) {
                 if ("media-ref".equals(field.fieldType()) && !field.publicBytes()) {
-                    next.add(new FieldRecord(
-                            field.id(),
-                            field.contentTypeId(),
-                            field.fieldKey(),
-                            field.fieldType(),
-                            field.required(),
-                            field.uniqueInType(),
-                            field.indexed(),
-                            field.visibility(),
-                            field.sortOrder(),
-                            field.refTargetTypeKey(),
-                            field.onDelete(),
-                            field.enumValues(),
-                            field.enabled(),
-                            true));
+                    next.add(field.withPublicBytes(true));
                 } else {
                     next.add(field);
                 }
@@ -118,12 +126,12 @@
 
     @Override
     public List<EntryRecord> listEntries(
-            UUID typeId, List<String> states, boolean includeDeleted, String q, String refField, UUID refTarget) {
+            UUID typeId, List<String> states, boolean includeDeleted, String titleField, String q, String refField, UUID refTarget) {
         return entries.values().stream()
                 .filter(e -> e.contentTypeId().equals(typeId))
                 .filter(e -> includeDeleted || !e.deleted())
                 .filter(e -> states == null || states.isEmpty() || states.contains(e.publicationState().wire()))
-                .filter(e -> matchesQ(e, q))
+                .filter(e -> matchesQ(e, titleField, q))
                 .filter(e -> matchesRef(e.id(), refField, refTarget))
                 .sorted(Comparator.comparing(EntryRecord::updatedAt).reversed())
                 .toList();
@@ -198,11 +206,11 @@
         menus.put(menu.menuKey(), menu);
     }
 
-    private boolean matchesQ(EntryRecord entry, String q) {
+    private boolean matchesQ(EntryRecord entry, String titleField, String q) {
         if (q == null || q.isBlank()) {
             return true;
         }
-        Object title = entry.payload() == null ? null : entry.payload().get("title");
+        Object title = entry.payload() == null || titleField == null ? null : entry.payload().get(titleField);
         return title != null && title.toString().toLowerCase(Locale.ROOT).contains(q.toLowerCase(Locale.ROOT));
     }
```

`src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
@@ -28,6 +28,7 @@
 
     private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
     private static final TypeReference<List<String>> STRINGS = new TypeReference<>() {};
+    private static final TypeReference<Map<String, String>> LABELS = new TypeReference<>() {};
 
     private final JdbcTemplate jdbc;
     private final ObjectMapper mapper;
@@ -53,8 +54,9 @@
                 """
                 INSERT INTO cms_content_type
                   (id, type_key, display_name, plural_display_name, description, title_field, slug_policy,
-                   singleton, enabled, previewable, public_requires_published_refs, created_at, updated_at)
-                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?)
+                   singleton, enabled, previewable, public_requires_published_refs, created_at, updated_at,
+                   sort_field, visibility_field, owner_field)
+                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, ?, ?)
                 """,
                 type.id(),
                 type.typeKey(),
@@ -68,7 +70,10 @@
                 type.previewable(),
                 json(type.publicRequiresPublishedRefs()),
                 ts(type.createdAt()),
-                ts(type.updatedAt()));
+                ts(type.updatedAt()),
+                type.sortField(),
+                type.visibilityField(),
+                type.ownerField());
     }
 
     @Override
@@ -87,6 +92,17 @@
     }
 
     @Override
+    public void updateTypeSettings(ContentTypeRecord type) {
+        jdbc.update(
+                "UPDATE cms_content_type SET sort_field = ?, visibility_field = ?, owner_field = ?, updated_at = ? WHERE id = ?",
+                type.sortField(),
+                type.visibilityField(),
+                type.ownerField(),
+                ts(type.updatedAt()),
+                type.id());
+    }
+
+    @Override
     public List<FieldRecord> fieldsOf(UUID typeId) {
         return jdbc.query(
                 "SELECT * FROM cms_field WHERE content_type_id = ? ORDER BY sort_order, field_key",
@@ -100,8 +116,9 @@
                 """
                 INSERT INTO cms_field
                   (id, content_type_id, field_key, field_type, required, unique_in_type, indexed, visibility,
-                   sort_order, ref_target_type_key, on_delete, enum_values, enabled, public_bytes)
-                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?)
+                   sort_order, ref_target_type_key, on_delete, enum_values, enabled, public_bytes,
+                   label, group_key, listable, filterable, enum_labels, placeholder, help_text)
+                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?)
                 """,
                 field.id(),
                 field.contentTypeId(),
@@ -116,7 +133,32 @@
                 field.onDelete(),
                 json(field.enumValues()),
                 field.enabled(),
-                field.publicBytes());
+                field.publicBytes(),
+                field.label(),
+                field.groupKey(),
+                field.listable(),
+                field.filterable(),
+                json(field.enumLabels()),
+                field.placeholder(),
+                field.helpText());
+    }
+
+    @Override
+    public void updateFieldMetadata(FieldRecord field) {
+        jdbc.update(
+                """
+                UPDATE cms_field SET label = ?, group_key = ?, listable = ?, filterable = ?,
+                  enum_labels = CAST(? AS jsonb), placeholder = ?, help_text = ?
+                WHERE id = ?
+                """,
+                field.label(),
+                field.groupKey(),
+                field.listable(),
+                field.filterable(),
+                json(field.enumLabels()),
+                field.placeholder(),
+                field.helpText(),
+                field.id());
     }
 
     @Override
@@ -151,7 +193,7 @@
 
     @Override
     public List<EntryRecord> listEntries(
-            UUID typeId, List<String> states, boolean includeDeleted, String q, String refField, UUID refTarget) {
+            UUID typeId, List<String> states, boolean includeDeleted, String titleField, String q, String refField, UUID refTarget) {
         StringBuilder sql = new StringBuilder(
                 """
                 SELECT e.*, t.type_key FROM cms_entry e
@@ -170,7 +212,8 @@
             args.addAll(states);
         }
         if (q != null && !q.isBlank()) {
-            sql.append(" AND e.payload->>'title' ILIKE ? ESCAPE '\\'");
+            sql.append(" AND e.payload->>? ILIKE ? ESCAPE '\\'");
+            args.add(titleField);
             args.add("%" + escapeLike(q) + "%");
         }
         if (refField != null && refTarget != null) {
@@ -376,7 +419,10 @@
                 rs.getBoolean("previewable"),
                 readStrings(rs.getString("public_requires_published_refs")),
                 instant(rs, "created_at"),
-                instant(rs, "updated_at"));
+                instant(rs, "updated_at"),
+                rs.getString("sort_field"),
+                rs.getString("visibility_field"),
+                rs.getString("owner_field"));
     }
 
     private RowMapper<FieldRecord> fieldMapper() {
@@ -394,7 +440,14 @@
                 rs.getString("on_delete"),
                 readStrings(rs.getString("enum_values")),
                 rs.getBoolean("enabled"),
-                columnOrFalse(rs, "public_bytes"));
+                columnOrFalse(rs, "public_bytes"),
+                rs.getString("label"),
+                rs.getString("group_key"),
+                rs.getBoolean("listable"),
+                rs.getBoolean("filterable"),
+                readLabels(rs.getString("enum_labels")),
+                rs.getString("placeholder"),
+                rs.getString("help_text"));
     }
 
     private RowMapper<EntryRecord> entryMapper() {
@@ -462,6 +515,18 @@
         } catch (Exception e) {
             throw new IllegalStateException(e);
         }
+    }
+
+    private Map<String, String> readLabels(String raw) {
+        if (raw == null || raw.isBlank() || "null".equals(raw)) {
+            return Map.of();
+        }
+        try {
+            Map<String, String> labels = mapper.readValue(raw, LABELS);
+            return labels == null ? Map.of() : labels;
+        } catch (Exception e) {
+            throw new IllegalStateException(e);
+        }
     }
 
     private Map<String, Object> readNullableMap(String raw) {
```

`src/main/java/com/fallrising/cms/content/service/EntryService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/service/EntryService.java
+++ b/src/main/java/com/fallrising/cms/content/service/EntryService.java
@@ -142,7 +142,7 @@
         } else {
             authorization.require(principal, CmsAction.READ_PUBLISHED, typeKey, null, surface);
         }
-        return store.listEntries(type.id(), wanted, false, q, refField, refTarget);
+        return store.listEntries(type.id(), wanted, false, type.titleField(), q, refField, refTarget);
     }
 
     public EntryRecord patch(Principal principal, Surface surface, UUID id, String slug, Map<String, Object> payload, Integer version) {
@@ -395,7 +395,7 @@
         if (!authorization.hasAction(principal, CmsAction.READ_PUBLISHED, typeKey, Surface.FRONT)) {
             throw IdentityException.forbidden(CmsAction.READ_PUBLISHED.wire(), typeKey, Surface.FRONT.wire());
         }
-        return store.listEntries(type.id(), List.of("published"), false, q, refField, refTarget).stream()
+        return store.listEntries(type.id(), List.of("published"), false, type.titleField(), q, refField, refTarget).stream()
                 .filter(e -> e.publishedPayload() != null)
                 .filter(e -> PublicVisibility.indexable(e.publishedPayload()))
                 .filter(e -> authorization.allow(
```

### 5.2 kernel 改讀類型設定（T06）

`PublicVisibility`（整檔取代）：兩個方法都多一個 `ContentTypeRecord` 參數。`type` 為 null（找不到類型）或沒有 `visibilityField` 時一律公開。

`src/main/java/com/fallrising/cms/content/PublicVisibility.java`：

```java
package com.fallrising.cms.content;

import com.fallrising.cms.content.domain.ContentTypeRecord;

import java.util.Map;

/**
 * Public visibility of a published payload, read from the type's visibilityField (02 BD-05).
 * A type without visibilityField, or a payload whose value is missing or blank, is "public".
 */
public final class PublicVisibility {

    private PublicVisibility() {}

    /** True when the entry may appear in public lists: visibility is "public". */
    public static boolean indexable(ContentTypeRecord type, Map<String, Object> payload) {
        return "public".equals(visibility(type, payload));
    }

    /** True when the entry may be read by id or slug: visibility is not "private" ("unlisted" is readable, BQ-02). */
    public static boolean gettable(ContentTypeRecord type, Map<String, Object> payload) {
        return !"private".equals(visibility(type, payload));
    }

    static String visibility(ContentTypeRecord type, Map<String, Object> payload) {
        String field = type == null ? null : type.visibilityField();
        if (field == null || payload == null || payload.get(field) == null) {
            return "public";
        }
        String raw = String.valueOf(payload.get(field));
        return raw.isBlank() ? "public" : raw;
    }
}
```

`EntryService.publicOrder` 改成 package-private static、以類型為參數（`PublicOrderTests` 直接呼叫）。規則見 §4.2 第 2 列：`sortField` 的值只認 JSON 數字（`Number`），字串數字視為沒有值。

`src/main/java/com/fallrising/cms/content/service/EntryService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/service/EntryService.java
+++ b/src/main/java/com/fallrising/cms/content/service/EntryService.java
@@ -375,7 +375,7 @@
                 || entry.deleted()
                 || entry.publicationState() != PublicationState.PUBLISHED
                 || entry.publishedPayload() == null
-                || !PublicVisibility.gettable(entry.publishedPayload())) {
+                || !PublicVisibility.gettable(type, entry.publishedPayload())) {
             throw ContentException.notFound();
         }
         if (!authorization.allow(principal, CmsAction.READ_PUBLISHED, typeKey, entry.publishedPayload(), Surface.FRONT).allowed()) {
@@ -397,12 +397,12 @@
         }
         return store.listEntries(type.id(), List.of("published"), false, type.titleField(), q, refField, refTarget).stream()
                 .filter(e -> e.publishedPayload() != null)
-                .filter(e -> PublicVisibility.indexable(e.publishedPayload()))
+                .filter(e -> PublicVisibility.indexable(type, e.publishedPayload()))
                 .filter(e -> authorization.allow(
                                 principal, CmsAction.READ_PUBLISHED, typeKey, e.publishedPayload(), Surface.FRONT)
                         .allowed())
                 .filter(e -> publishedRefsPublic(e, type))
-                .sorted(publicOrder())
+                .sorted(publicOrder(type))
                 .toList();
     }
 
@@ -417,7 +417,8 @@
                 if (target == null
                         || target.deleted()
                         || target.publicationState() != PublicationState.PUBLISHED
-                        || !PublicVisibility.gettable(target.publishedPayload())) {
+                        || !PublicVisibility.gettable(
+                                store.findTypeByKey(target.contentTypeKey()).orElse(null), target.publishedPayload())) {
                     return false;
                 }
             } catch (IllegalArgumentException e) {
@@ -427,15 +428,22 @@
         return true;
     }
 
-    private static Comparator<EntryRecord> publicOrder() {
-        return Comparator.comparingInt((EntryRecord e) -> {
-                    Object value = e.publishedPayload() == null ? null : e.publishedPayload().get("sortOrder");
-                    if (value instanceof Number number) {
-                        return number.intValue();
-                    }
-                    return Integer.MAX_VALUE;
+    /**
+     * Public list order (02 §3.1): with a sortField, numeric value ascending (entries without a number last),
+     * then updatedAt descending; without a sortField, publishedAt descending, then updatedAt descending.
+     */
+    static Comparator<EntryRecord> publicOrder(ContentTypeRecord type) {
+        Comparator<EntryRecord> newestUpdate = Comparator.comparing(EntryRecord::updatedAt, Comparator.nullsLast(Comparator.reverseOrder()));
+        String sortField = type.sortField();
+        if (sortField == null) {
+            return Comparator.comparing(EntryRecord::publishedAt, Comparator.nullsLast(Comparator.reverseOrder()))
+                    .thenComparing(newestUpdate);
+        }
+        return Comparator.comparingDouble((EntryRecord e) -> {
+                    Object value = e.publishedPayload() == null ? null : e.publishedPayload().get(sortField);
+                    return value instanceof Number number ? number.doubleValue() : Double.MAX_VALUE;
                 })
-                .thenComparing(EntryRecord::updatedAt, Comparator.nullsLast(Comparator.reverseOrder()));
+                .thenComparing(newestUpdate);
     }
 
     public List<RevisionRecord> revisions(Principal principal, Surface surface, UUID id) {
```

`src/main/java/com/fallrising/cms/media/service/MediaService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/media/service/MediaService.java
+++ b/src/main/java/com/fallrising/cms/media/service/MediaService.java
@@ -172,7 +172,8 @@
             boolean allowedField = content.fieldsOf(entry.get().contentTypeId()).stream()
                     .anyMatch(f -> f.fieldKey().equals(attachment.fieldKey()) && f.publicBytes() && f.enabled());
             if (allowedField
-                    && PublicVisibility.gettable(entry.get().publishedPayload())
+                    && PublicVisibility.gettable(
+                            content.findTypeByKey(entry.get().contentTypeKey()).orElse(null), entry.get().publishedPayload())
                     && publishedRefsOk(entry.get())) {
                 return true;
             }
@@ -251,7 +252,8 @@
                 if (target == null
                         || target.deleted()
                         || target.publicationState() != PublicationState.PUBLISHED
-                        || !PublicVisibility.gettable(target.publishedPayload())) {
+                        || !PublicVisibility.gettable(
+                                content.findTypeByKey(target.contentTypeKey()).orElse(null), target.publishedPayload())) {
                     return false;
                 }
             } catch (IllegalArgumentException e) {
```

### 5.3 種子（T04）

`ContentTypeSeed`（整檔取代）。規則：

1. 類型不存在就建立（不含設定）；欄位不存在就建立（不含中繼資料）。這兩步與以前相同。
2. **類型設定**：只有當三個設定**全部是 null** 時才寫入種子的值。所以既有資料庫在第一次以 BW1a 啟動時會補上，之後 admin 改過就不會被覆蓋。
3. **欄位中繼資料**：只有當欄位的 `label` 是 null 時才寫入。`label` 非 null 表示已經寫過（或 admin 改過），整組中繼資料都不動。
4. `group`：`media-ref` → `media`；`ref`、`principal-ref` → `relations`；欄位 key 等於類型的 `sortField` 或 `visibilityField` → `settings`；其他 → `main`。
5. `listable`：欄位是 `titleField`，或型別是 `enum`、`datetime`。
6. `filterable`：欄位 `indexed=true`，而且型別是 `enum` 或 `datetime`（BW1b 的 `filter.<field>` 只允許 filterable 欄位，而它需要索引）。
7. `placeholder`、`helpText`：一律 null。

`src/main/java/com/fallrising/cms/content/service/ContentTypeSeed.java`：

```java
package com.fallrising.cms.content.service;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.store.ContentStore;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Demo content types. Idempotent: missing types and fields are inserted; type settings are written only while all
 * three are null; field metadata is written only while the field label is null. Values edited later are kept.
 */
@Component
@Order(100)
public class ContentTypeSeed {

    private final ContentStore store;

    public ContentTypeSeed(ContentStore store) {
        this.store = store;
    }

    @Order(100)
    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        seed();
    }

    public void seed() {
        type("album", "Album", "Albums", "title", "required", false, List.of(), null, "visibility", null, List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("description", "markdown", false, false, null, List.of()).label("說明"),
                field("cover", "media-ref", false, false, null, List.of(), true).label("封面"),
                field("visibility", "enum", false, true, null, List.of("public", "unlisted"))
                        .label("可見性", labels("public", "公開", "unlisted", "不公開列出")),
                field("sortMode", "enum", false, false, null, List.of("manual", "captured_at"))
                        .label("排序方式", labels("manual", "手動", "captured_at", "拍攝時間"))));
        type("photo", "Photo", "Photos", "title", "optional", false, List.of("album"), "sortOrder", null, null, List.of(
                field("title", "string", false, true, null, List.of()).label("標題"),
                field("caption", "string", false, false, null, List.of()).label("圖說"),
                field("album", "ref", true, false, "album", List.of()).label("相簿"),
                field("sortOrder", "int", false, true, null, List.of()).label("排序"),
                field("takenAt", "datetime", false, false, null, List.of()).label("拍攝時間"),
                field("media", "media-ref", false, false, null, List.of(), true).label("圖片")));
        type("page", "Page", "Pages", "title", "required", false, List.of(), null, null, null, List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("body", "markdown", false, false, null, List.of()).label("內文")));
        type("clinic_profile", "Clinic profile", "Clinic profiles", "name", "required", true, List.of(), null, null, null, List.of(
                field("name", "string", true, true, null, List.of()).label("名稱"),
                field("intro", "markdown", true, false, null, List.of()).label("簡介"),
                field("address", "string", false, false, null, List.of()).label("地址"),
                field("telephone", "string", false, false, null, List.of()).label("電話"),
                field("hours", "markdown", false, false, null, List.of()).label("門診時間"),
                field("hero", "media-ref", false, false, null, List.of(), true).label("主視覺")));
        type("owner", "Owner", "Owners", "title", "optional", false, List.of(), null, null, "ownerPrincipalId", List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("firstName", "string", false, true, null, List.of()).label("名"),
                field("lastName", "string", false, true, null, List.of()).label("姓"),
                field("address", "string", false, false, null, List.of()).label("地址"),
                field("city", "string", false, true, null, List.of()).label("城市"),
                field("telephone", "string", false, false, null, List.of()).label("電話"),
                field("email", "string", false, false, null, List.of()).label("電子郵件"),
                field("ownerPrincipalId", "principal-ref", false, true, null, List.of()).label("會員帳號")));
        type("pet", "Pet", "Pets", "title", "optional", false, List.of(), null, null, "ownerPrincipalId", List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("name", "string", false, true, null, List.of()).label("名字"),
                field("petType", "enum", false, true, null, List.of("cat", "dog", "bird", "hamster", "lizard", "snake", "other"))
                        .label("種類", labels("cat", "貓", "dog", "狗", "bird", "鳥", "hamster", "倉鼠", "lizard", "蜥蜴",
                                "snake", "蛇", "other", "其他")),
                field("birthDate", "datetime", false, false, null, List.of()).label("出生日期"),
                field("owner", "ref", true, false, "owner", List.of()).label("飼主"),
                field("ownerPrincipalId", "principal-ref", false, true, null, List.of()).label("會員帳號"),
                field("notes", "markdown", false, false, null, List.of()).label("備註"),
                field("photo", "media-ref", false, false, null, List.of(), true).label("照片")));
        type("vet", "Vet", "Vets", "title", "optional", false, List.of(), null, null, null, List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("firstName", "string", false, true, null, List.of()).label("名"),
                field("lastName", "string", false, true, null, List.of()).label("姓"),
                field("specialty", "enum", false, true, null, List.of("general", "radiology", "surgery", "dentistry"))
                        .label("專長", labels("general", "一般", "radiology", "放射科", "surgery", "外科", "dentistry", "牙科")),
                field("bio", "markdown", false, false, null, List.of()).label("簡介"),
                field("photo", "media-ref", false, false, null, List.of(), true).label("照片")));
        type("visit", "Visit", "Visits", "title", "none", false, List.of(), null, null, "ownerPrincipalId", List.of(
                field("title", "string", false, true, null, List.of()).label("標題"),
                field("pet", "ref", true, false, "pet", List.of()).label("寵物"),
                field("owner", "ref", false, false, "owner", List.of()).label("飼主"),
                field("vet", "ref", false, false, "vet", List.of()).label("獸醫"),
                field("scheduledAt", "datetime", false, true, null, List.of()).label("預約時間"),
                field("description", "string", false, false, null, List.of()).label("說明"),
                field("visitKind", "enum", false, true, null, List.of("checkup", "vaccine", "surgery", "other"))
                        .label("類別", labels("checkup", "健康檢查", "vaccine", "疫苗", "surgery", "手術", "other", "其他")),
                field("ownerPrincipalId", "principal-ref", false, true, null, List.of()).label("會員帳號")));
        type("project", "Project", "Projects", "title", "required", false, List.of(), null, "visibility", null, List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("summary", "markdown", false, false, null, List.of()).label("摘要"),
                field("cover", "media-ref", false, false, null, List.of(), true).label("封面"),
                field("visibility", "enum", false, true, null, List.of("public", "private"))
                        .label("可見性", labels("public", "公開", "private", "不公開")),
                field("lifecycle", "enum", false, true, null, List.of("active", "completed"))
                        .label("階段", labels("active", "進行中", "completed", "已完成"))));
        type("issue", "Issue", "Issues", "title", "optional", false, List.of(), null, null, null, List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("project", "ref", true, false, "project", List.of()).label("專案"),
                field("milestone", "ref", false, false, "milestone", List.of()).label("里程碑"),
                field("body", "markdown", false, false, null, List.of()).label("內容"),
                field("status", "enum", true, true, null, List.of("backlog", "ready", "in_progress", "in_review", "done"))
                        .label("狀態", labels("backlog", "待辦", "ready", "就緒", "in_progress", "進行中",
                                "in_review", "審查中", "done", "完成")),
                field("assigneePrincipalId", "string", false, true, null, List.of()).label("負責人"),
                field("sortOrder", "int", false, true, null, List.of()).label("排序")));
        type("milestone", "Milestone", "Milestones", "title", "required", false, List.of("project"), "sortOrder", null, null, List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("project", "ref", true, false, "project", List.of()).label("專案"),
                field("description", "markdown", false, false, null, List.of()).label("說明"),
                field("dueDate", "datetime", false, false, null, List.of()).label("到期日"),
                field("status", "enum", false, true, null, List.of("planned", "reached", "missed"))
                        .label("狀態", labels("planned", "已規劃", "reached", "已達成", "missed", "未達成")),
                field("sortOrder", "int", false, true, null, List.of()).label("排序")));
        store.markMediaRefsPublic();
        if (store.findNavigation("front.primary").isEmpty()) {
            Instant now = Instant.now();
            store.upsertNavigation(new NavigationRecord(
                    UUID.randomUUID(),
                    "front.primary",
                    "front",
                    "draft",
                    1,
                    Map.of("items", List.of(
                            Map.of("label", "Albums", "href", "/album"),
                            Map.of("label", "Clinic", "href", "/clinic"),
                            Map.of("label", "Projects", "href", "/projects"))),
                    null,
                    null,
                    now));
        }
    }

    private void type(
            String key,
            String name,
            String plural,
            String titleField,
            String slugPolicy,
            boolean singleton,
            List<String> publishedRefs,
            String sortField,
            String visibilityField,
            String ownerField,
            List<FieldSpec> fields) {
        Instant now = Instant.now();
        ContentTypeRecord type = store.findTypeByKey(key).orElseGet(() -> {
            ContentTypeRecord created = new ContentTypeRecord(
                    UUID.randomUUID(),
                    key,
                    name,
                    plural,
                    null,
                    titleField,
                    slugPolicy,
                    singleton,
                    true,
                    true,
                    publishedRefs,
                    now,
                    now);
            store.insertType(created);
            return created;
        });
        if (type.sortField() == null && type.visibilityField() == null && type.ownerField() == null
                && (sortField != null || visibilityField != null || ownerField != null)) {
            store.updateTypeSettings(type.withSettings(sortField, visibilityField, ownerField, now));
        }
        List<FieldRecord> existing = store.fieldsOf(type.id());
        Set<String> have = existing.stream().map(FieldRecord::fieldKey).collect(Collectors.toSet());
        int order = existing.stream().mapToInt(FieldRecord::sortOrder).max().orElse(-1) + 1;
        for (FieldSpec spec : fields) {
            if (have.contains(spec.key)) {
                continue;
            }
            store.insertField(new FieldRecord(
                    UUID.randomUUID(),
                    type.id(),
                    spec.key,
                    spec.type,
                    spec.required,
                    false,
                    spec.indexed,
                    "public",
                    order++,
                    spec.refTarget,
                    "restrict",
                    spec.enums,
                    true,
                    spec.publicBytes));
        }
        Map<String, FieldSpec> specs = fields.stream().collect(Collectors.toMap(FieldSpec::key, s -> s));
        for (FieldRecord field : store.fieldsOf(type.id())) {
            FieldSpec spec = specs.get(field.fieldKey());
            if (spec == null || spec.label == null || field.label() != null) {
                continue;
            }
            store.updateFieldMetadata(field.withMetadata(
                    spec.label,
                    group(field, sortField, visibilityField),
                    field.fieldKey().equals(titleField) || "enum".equals(field.fieldType()) || "datetime".equals(field.fieldType()),
                    field.indexed() && ("enum".equals(field.fieldType()) || "datetime".equals(field.fieldType())),
                    spec.enumLabels,
                    null,
                    null));
        }
    }

    /** media-ref → media; ref and principal-ref → relations; the type's sortField or visibilityField → settings; else main. */
    static String group(FieldRecord field, String sortField, String visibilityField) {
        return switch (field.fieldType()) {
            case "media-ref" -> "media";
            case "ref", "principal-ref" -> "relations";
            default -> field.fieldKey().equals(sortField) || field.fieldKey().equals(visibilityField) ? "settings" : "main";
        };
    }

    private static Map<String, String> labels(String... pairs) {
        Map<String, String> labels = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            labels.put(pairs[i], pairs[i + 1]);
        }
        return labels;
    }

    private static FieldSpec field(String key, String type, boolean required, boolean indexed, String refTarget, List<String> enums) {
        return field(key, type, required, indexed, refTarget, enums, false);
    }

    private static FieldSpec field(
            String key, String type, boolean required, boolean indexed, String refTarget, List<String> enums, boolean publicBytes) {
        return new FieldSpec(key, type, required, indexed, refTarget, enums, publicBytes, null, Map.of());
    }

    private record FieldSpec(
            String key,
            String type,
            boolean required,
            boolean indexed,
            String refTarget,
            List<String> enums,
            boolean publicBytes,
            String label,
            Map<String, String> enumLabels) {

        FieldSpec label(String label) {
            return label(label, Map.of());
        }

        FieldSpec label(String label, Map<String, String> enumLabels) {
            return new FieldSpec(key, type, required, indexed, refTarget, enums, publicBytes, label, enumLabels);
        }
    }
}
```

逐欄內容（由上面的程式產生，規則 4～6 已套用）：

| 類型 | titleField | sortField | visibilityField | ownerField |
| --- | --- | --- | --- | --- |
| `album` | `title` | — | `visibility` | — |
| `photo` | `title` | `sortOrder` | — | — |
| `page` | `title` | — | — | — |
| `clinic_profile` | `name` | — | — | — |
| `owner` | `title` | — | — | `ownerPrincipalId` |
| `pet` | `title` | — | — | `ownerPrincipalId` |
| `vet` | `title` | — | — | — |
| `visit` | `title` | — | — | `ownerPrincipalId` |
| `project` | `title` | — | `visibility` | — |
| `issue` | `title` | — | — | — |
| `milestone` | `title` | `sortOrder` | — | — |

| 類型 | 欄位 | 型別 | label | group | listable | filterable | enumLabels |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `album` | `title` | string | 標題 | main | ✓ |  | — |
| `album` | `description` | markdown | 說明 | main |  |  | — |
| `album` | `cover` | media-ref | 封面 | media |  |  | — |
| `album` | `visibility` | enum | 可見性 | settings | ✓ | ✓ | `public`=公開、`unlisted`=不公開列出 |
| `album` | `sortMode` | enum | 排序方式 | main | ✓ |  | `manual`=手動、`captured_at`=拍攝時間 |
| `photo` | `title` | string | 標題 | main | ✓ |  | — |
| `photo` | `caption` | string | 圖說 | main |  |  | — |
| `photo` | `album` | ref | 相簿 | relations |  |  | — |
| `photo` | `sortOrder` | int | 排序 | settings |  |  | — |
| `photo` | `takenAt` | datetime | 拍攝時間 | main | ✓ |  | — |
| `photo` | `media` | media-ref | 圖片 | media |  |  | — |
| `page` | `title` | string | 標題 | main | ✓ |  | — |
| `page` | `body` | markdown | 內文 | main |  |  | — |
| `clinic_profile` | `name` | string | 名稱 | main | ✓ |  | — |
| `clinic_profile` | `intro` | markdown | 簡介 | main |  |  | — |
| `clinic_profile` | `address` | string | 地址 | main |  |  | — |
| `clinic_profile` | `telephone` | string | 電話 | main |  |  | — |
| `clinic_profile` | `hours` | markdown | 門診時間 | main |  |  | — |
| `clinic_profile` | `hero` | media-ref | 主視覺 | media |  |  | — |
| `owner` | `title` | string | 標題 | main | ✓ |  | — |
| `owner` | `firstName` | string | 名 | main |  |  | — |
| `owner` | `lastName` | string | 姓 | main |  |  | — |
| `owner` | `address` | string | 地址 | main |  |  | — |
| `owner` | `city` | string | 城市 | main |  |  | — |
| `owner` | `telephone` | string | 電話 | main |  |  | — |
| `owner` | `email` | string | 電子郵件 | main |  |  | — |
| `owner` | `ownerPrincipalId` | principal-ref | 會員帳號 | relations |  |  | — |
| `pet` | `title` | string | 標題 | main | ✓ |  | — |
| `pet` | `name` | string | 名字 | main |  |  | — |
| `pet` | `petType` | enum | 種類 | main | ✓ | ✓ | `cat`=貓、`dog`=狗、`bird`=鳥、`hamster`=倉鼠、`lizard`=蜥蜴、`snake`=蛇、`other`=其他 |
| `pet` | `birthDate` | datetime | 出生日期 | main | ✓ |  | — |
| `pet` | `owner` | ref | 飼主 | relations |  |  | — |
| `pet` | `ownerPrincipalId` | principal-ref | 會員帳號 | relations |  |  | — |
| `pet` | `notes` | markdown | 備註 | main |  |  | — |
| `pet` | `photo` | media-ref | 照片 | media |  |  | — |
| `vet` | `title` | string | 標題 | main | ✓ |  | — |
| `vet` | `firstName` | string | 名 | main |  |  | — |
| `vet` | `lastName` | string | 姓 | main |  |  | — |
| `vet` | `specialty` | enum | 專長 | main | ✓ | ✓ | `general`=一般、`radiology`=放射科、`surgery`=外科、`dentistry`=牙科 |
| `vet` | `bio` | markdown | 簡介 | main |  |  | — |
| `vet` | `photo` | media-ref | 照片 | media |  |  | — |
| `visit` | `title` | string | 標題 | main | ✓ |  | — |
| `visit` | `pet` | ref | 寵物 | relations |  |  | — |
| `visit` | `owner` | ref | 飼主 | relations |  |  | — |
| `visit` | `vet` | ref | 獸醫 | relations |  |  | — |
| `visit` | `scheduledAt` | datetime | 預約時間 | main | ✓ | ✓ | — |
| `visit` | `description` | string | 說明 | main |  |  | — |
| `visit` | `visitKind` | enum | 類別 | main | ✓ | ✓ | `checkup`=健康檢查、`vaccine`=疫苗、`surgery`=手術、`other`=其他 |
| `visit` | `ownerPrincipalId` | principal-ref | 會員帳號 | relations |  |  | — |
| `project` | `title` | string | 標題 | main | ✓ |  | — |
| `project` | `summary` | markdown | 摘要 | main |  |  | — |
| `project` | `cover` | media-ref | 封面 | media |  |  | — |
| `project` | `visibility` | enum | 可見性 | settings | ✓ | ✓ | `public`=公開、`private`=不公開 |
| `project` | `lifecycle` | enum | 階段 | main | ✓ | ✓ | `active`=進行中、`completed`=已完成 |
| `issue` | `title` | string | 標題 | main | ✓ |  | — |
| `issue` | `project` | ref | 專案 | relations |  |  | — |
| `issue` | `milestone` | ref | 里程碑 | relations |  |  | — |
| `issue` | `body` | markdown | 內容 | main |  |  | — |
| `issue` | `status` | enum | 狀態 | main | ✓ | ✓ | `backlog`=待辦、`ready`=就緒、`in_progress`=進行中、`in_review`=審查中、`done`=完成 |
| `issue` | `assigneePrincipalId` | string | 負責人 | main |  |  | — |
| `issue` | `sortOrder` | int | 排序 | main |  |  | — |
| `milestone` | `title` | string | 標題 | main | ✓ |  | — |
| `milestone` | `project` | ref | 專案 | relations |  |  | — |
| `milestone` | `description` | markdown | 說明 | main |  |  | — |
| `milestone` | `dueDate` | datetime | 到期日 | main | ✓ |  | — |
| `milestone` | `status` | enum | 狀態 | main | ✓ | ✓ | `planned`=已規劃、`reached`=已達成、`missed`=未達成 |
| `milestone` | `sortOrder` | int | 排序 | settings |  |  | — |

### 5.4 API 輸出（T08）

- `ContentProjection.work(entry, type)`：標題取 `payload[type.titleField]`；`type` 為 null 時標題為 null。
- `ContentProjection.typeSchema(type, fields, admin)` 與 `fieldSchema(field, admin)`：Back（`admin=false`）排除停用與 internal 欄位；Admin（`admin=true`）列出全部，另加類型的 `enabled` 與欄位的 `indexed`、`enabled`。鍵的順序以程式為準。
- `EntryController` 以 `workJson(entry)` 取代原本的 `ContentProjection.work(entry)`：以 `entry.contentTypeKey()` 查類型再投影。名稱不用 `work`，因為同一個類別已經有 `static work(request, action, typeKey)`。

`src/main/java/com/fallrising/cms/content/web/ContentProjection.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/ContentProjection.java
+++ b/src/main/java/com/fallrising/cms/content/web/ContentProjection.java
@@ -12,14 +12,15 @@
 
     private ContentProjection() {}
 
-    static Map<String, Object> work(EntryRecord entry) {
+    /** Work copy. title is payload[type.titleField] (G-11); type is null only when the type row is missing. */
+    static Map<String, Object> work(EntryRecord entry, ContentTypeRecord type) {
         Map<String, Object> json = new LinkedHashMap<>();
         json.put("id", entry.id().toString());
         json.put("contentType", entry.contentTypeKey());
         json.put("slug", entry.slug());
         json.put("publicationState", entry.publicationState().wire());
         json.put("version", entry.version());
-        json.put("title", title(entry.payload(), "title"));
+        json.put("title", title(entry.payload(), type == null ? null : type.titleField()));
         json.put("payload", entry.payloadCopy());
         json.put("dirty", entry.dirty());
         json.put("publishedAt", entry.publishedAt());
@@ -55,6 +56,55 @@
         return json;
     }
 
+    /**
+     * Type schema for Back and Admin (02 §4.7). admin=true adds enabled, and per field indexed and enabled,
+     * and includes internal and disabled fields; admin=false omits internal and disabled fields.
+     */
+    static Map<String, Object> typeSchema(ContentTypeRecord type, List<FieldRecord> fields, boolean admin) {
+        Map<String, Object> json = new LinkedHashMap<>();
+        json.put("key", type.typeKey());
+        json.put("displayName", type.displayName());
+        json.put("pluralDisplayName", type.pluralDisplayName());
+        json.put("titleField", type.titleField());
+        json.put("sortField", type.sortField());
+        json.put("visibilityField", type.visibilityField());
+        json.put("ownerField", type.ownerField());
+        json.put("slugPolicy", type.slugPolicy());
+        json.put("singleton", type.singleton());
+        json.put("previewable", type.previewable());
+        if (admin) {
+            json.put("enabled", type.enabled());
+        }
+        json.put("fields", fields.stream()
+                .filter(f -> admin || (f.enabled() && !"internal".equals(f.visibility())))
+                .map(f -> fieldSchema(f, admin))
+                .toList());
+        return json;
+    }
+
+    static Map<String, Object> fieldSchema(FieldRecord field, boolean admin) {
+        Map<String, Object> json = new LinkedHashMap<>();
+        json.put("key", field.fieldKey());
+        json.put("type", field.fieldType());
+        json.put("label", field.label());
+        json.put("helpText", field.helpText());
+        json.put("required", field.required());
+        json.put("group", field.groupKey());
+        json.put("order", field.sortOrder());
+        json.put("listable", field.listable());
+        json.put("filterable", field.filterable());
+        json.put("enumValues", field.enumValues());
+        json.put("enumLabels", field.enumLabels());
+        json.put("refTarget", field.refTargetTypeKey());
+        json.put("placeholder", field.placeholder());
+        json.put("visibility", field.visibility());
+        if (admin) {
+            json.put("indexed", field.indexed());
+            json.put("enabled", field.enabled());
+        }
+        return json;
+    }
+
     static Object title(Map<String, Object> payload, String titleField) {
         if (payload == null || titleField == null) {
             return null;
```

`src/main/java/com/fallrising/cms/content/web/EntryController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/EntryController.java
+++ b/src/main/java/com/fallrising/cms/content/web/EntryController.java
@@ -75,7 +75,7 @@
         List<Map<String, Object>> items = entries.listWork(
                         identity.principal(), identity.surface(), typeKey, states, q, refField, refTarget)
                 .stream()
-                .map(ContentProjection::work)
+                .map(this::workJson)
                 .toList();
         return Map.of("items", items, "total", items.size(), "offset", 0, "limit", items.size());
     }
@@ -88,14 +88,14 @@
         EntryWriteBody write = body == null ? new EntryWriteBody(null, Map.of(), null) : body;
         EntryRecord created = entries.create(
                 identity.principal(), identity.surface(), typeKey, write.slug(), write.payload());
-        return ContentProjection.work(created);
+        return workJson(created);
     }
 
     @GetMapping("/entries/{id}")
     public Map<String, Object> get(@PathVariable UUID id, HttpServletRequest request) {
         IdentityRequest identity = rejectFront(request);
         EntryRecord entry = entries.getWork(identity.principal(), identity.surface(), id);
-        return ContentProjection.work(entry);
+        return workJson(entry);
     }
 
     @PatchMapping("/entries/{id}")
@@ -104,31 +104,31 @@
         IdentityRequest identity = rejectFront(request);
         EntryRecord updated = entries.patch(
                 identity.principal(), identity.surface(), id, body.slug(), body.payload(), body.version());
-        return ContentProjection.work(updated);
+        return workJson(updated);
     }
 
     @PostMapping("/entries/{id}/publish")
     public Map<String, Object> publish(@PathVariable UUID id, HttpServletRequest request) {
         IdentityRequest identity = rejectFront(request);
-        return ContentProjection.work(entries.publish(identity.principal(), identity.surface(), id));
+        return workJson(entries.publish(identity.principal(), identity.surface(), id));
     }
 
     @PostMapping("/entries/{id}/unpublish")
     public Map<String, Object> unpublish(@PathVariable UUID id, HttpServletRequest request) {
         IdentityRequest identity = rejectFront(request);
-        return ContentProjection.work(entries.unpublish(identity.principal(), identity.surface(), id));
+        return workJson(entries.unpublish(identity.principal(), identity.surface(), id));
     }
 
     @PostMapping("/entries/{id}/archive")
     public Map<String, Object> archive(@PathVariable UUID id, HttpServletRequest request) {
         IdentityRequest identity = rejectFront(request);
-        return ContentProjection.work(entries.archive(identity.principal(), identity.surface(), id));
+        return workJson(entries.archive(identity.principal(), identity.surface(), id));
     }
 
     @PostMapping("/entries/{id}/restore")
     public Map<String, Object> restore(@PathVariable UUID id, HttpServletRequest request) {
         IdentityRequest identity = rejectFront(request);
-        return ContentProjection.work(entries.restore(identity.principal(), identity.surface(), id));
+        return workJson(entries.restore(identity.principal(), identity.surface(), id));
     }
 
     @DeleteMapping("/entries/{id}")
@@ -154,13 +154,13 @@
     @PostMapping("/entries/{id}/revisions/{revisionNo}/revert")
     public Map<String, Object> revert(@PathVariable UUID id, @PathVariable int revisionNo, HttpServletRequest request) {
         IdentityRequest identity = rejectFront(request);
-        return ContentProjection.work(entries.revert(identity.principal(), identity.surface(), id, revisionNo));
+        return workJson(entries.revert(identity.principal(), identity.surface(), id, revisionNo));
     }
 
     @GetMapping("/preview/entries/{id}")
     public Map<String, Object> preview(@PathVariable UUID id, HttpServletRequest request) {
         IdentityRequest identity = rejectFront(request);
-        return ContentProjection.work(entries.getWork(identity.principal(), identity.surface(), id));
+        return workJson(entries.getWork(identity.principal(), identity.surface(), id));
     }
 
     private static IdentityRequest work(HttpServletRequest request, CmsAction action, String typeKey) {
@@ -172,25 +172,11 @@
     }
 
     private Map<String, Object> typeJson(ContentTypeRecord type) {
-        java.util.LinkedHashMap<String, Object> json = new java.util.LinkedHashMap<>();
-        json.put("key", type.typeKey());
-        json.put("displayName", type.displayName());
-        json.put("pluralDisplayName", type.pluralDisplayName());
-        json.put("titleField", type.titleField());
-        json.put("slugPolicy", type.slugPolicy());
-        json.put("fields", store.fieldsOf(type.id()).stream()
-                .filter(f -> f.enabled() && !"internal".equals(f.visibility()))
-                .map(f -> {
-                    java.util.LinkedHashMap<String, Object> field = new java.util.LinkedHashMap<>();
-                    field.put("key", f.fieldKey());
-                    field.put("type", f.fieldType());
-                    field.put("required", f.required());
-                    field.put("refTarget", f.refTargetTypeKey());
-                    field.put("enumValues", f.enumValues());
-                    return field;
-                })
-                .toList());
-        return json;
+        return ContentProjection.typeSchema(type, store.fieldsOf(type.id()), false);
+    }
+
+    private Map<String, Object> workJson(EntryRecord entry) {
+        return ContentProjection.work(entry, store.findTypeByKey(entry.contentTypeKey()).orElse(null));
     }
 
     private static IdentityRequest rejectFront(HttpServletRequest request) {
```

`src/main/java/com/fallrising/cms/content/web/AdminContentController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/AdminContentController.java
+++ b/src/main/java/com/fallrising/cms/content/web/AdminContentController.java
@@ -196,25 +196,7 @@
     }
 
     private Map<String, Object> typeJson(ContentTypeRecord type) {
-        Map<String, Object> json = new LinkedHashMap<>();
-        json.put("key", type.typeKey());
-        json.put("displayName", type.displayName());
-        json.put("pluralDisplayName", type.pluralDisplayName());
-        json.put("titleField", type.titleField());
-        json.put("slugPolicy", type.slugPolicy());
-        json.put("enabled", type.enabled());
-        List<Map<String, Object>> fields = new ArrayList<>();
-        for (FieldRecord field : store.fieldsOf(type.id())) {
-            Map<String, Object> item = new LinkedHashMap<>();
-            item.put("key", field.fieldKey());
-            item.put("type", field.fieldType());
-            item.put("required", field.required());
-            item.put("indexed", field.indexed());
-            item.put("refTarget", field.refTargetTypeKey());
-            fields.add(item);
-        }
-        json.put("fields", fields);
-        return json;
+        return ContentProjection.typeSchema(type, store.fieldsOf(type.id()), true);
     }
 
     private static Map<String, Object> navJson(com.fallrising.cms.content.domain.NavigationRecord menu) {
```

### 5.5 `capabilities` 與授權快取（T08）

依賴方向：content 已經依賴 identity，所以 identity 不能反過來依賴 content 的 store。identity 定義 `ContentTypeDirectory` 介面，content 提供實作 `StoreContentTypeDirectory`（Spring `@Component`），`AuthController` 注入介面。

`src/main/java/com/fallrising/cms/identity/domain/Capabilities.java`：

```java
package com.fallrising.cms.identity.domain;

import java.util.List;

/**
 * What the caller may do on one surface (02 BD-07). types lists only enabled types with at least one action;
 * scoped is true when some listed action is granted only through predicate grants (it applies to some entries).
 */
public record Capabilities(String surface, List<TypeCapability> types, List<String> global) {

    public record TypeCapability(String key, List<String> actions, boolean scoped) {}
}
```

`src/main/java/com/fallrising/cms/identity/service/ContentTypeDirectory.java`：

```java
package com.fallrising.cms.identity.service;

import java.util.List;

/** Enabled content type keys in key order. Implemented by the content module so identity does not depend on it. */
public interface ContentTypeDirectory {

    List<String> enabledTypeKeys();
}
```

`src/main/java/com/fallrising/cms/content/web/StoreContentTypeDirectory.java`：

```java
package com.fallrising.cms.content.web;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.service.ContentTypeDirectory;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class StoreContentTypeDirectory implements ContentTypeDirectory {

    private final ContentStore store;

    public StoreContentTypeDirectory(ContentStore store) {
        this.store = store;
    }

    @Override
    public List<String> enabledTypeKeys() {
        return store.listTypes().stream().filter(ContentTypeRecord::enabled).map(ContentTypeRecord::typeKey).toList();
    }
}
```

`AuthorizationService`：

- `capabilities(principal, surface, enabledTypeKeys)` 依 §4.4。
- **授權快取（B-12）**：`collectGrants` 在有 HTTP 請求時（`RequestContextHolder.getRequestAttributes()` 不是 null），以 request attribute `AuthorizationService.class.getName() + ".grants:" + principalId`（匿名時是 `anonymous`）快取不可變的 grant 清單；沒有請求（種子、單元測試）時每次重讀。快取只活到請求結束，所以權限變更在下一個請求生效。同一個請求裡先改權限再檢查權限的流程目前不存在；以後新增這種流程時，要在改完後移除對應的 attribute。

`src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java
+++ b/src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java
@@ -1,6 +1,7 @@
 package com.fallrising.cms.identity.service;
 
 import com.fallrising.cms.identity.IdentityException;
+import com.fallrising.cms.identity.domain.Capabilities;
 import com.fallrising.cms.identity.domain.CmsAction;
 import com.fallrising.cms.identity.domain.Permission;
 import com.fallrising.cms.identity.domain.Principal;
@@ -12,6 +13,8 @@
 import com.fasterxml.jackson.databind.JsonNode;
 import com.fasterxml.jackson.databind.ObjectMapper;
 import org.springframework.stereotype.Service;
+import org.springframework.web.context.request.RequestAttributes;
+import org.springframework.web.context.request.RequestContextHolder;
 
 import java.util.ArrayList;
 import java.util.HashSet;
@@ -24,6 +27,18 @@
 @Service
 public class AuthorizationService {
 
+    /** Per-content-type actions reported by capabilities(), in this order. */
+    public static final List<CmsAction> TYPE_ACTIONS = List.of(
+            CmsAction.READ_PUBLISHED, CmsAction.READ_DRAFT, CmsAction.CREATE, CmsAction.UPDATE,
+            CmsAction.PUBLISH, CmsAction.UNPUBLISH, CmsAction.DELETE, CmsAction.ARCHIVE);
+
+    /** Global actions reported by capabilities(), in this order. */
+    public static final List<CmsAction> GLOBAL_ACTIONS = List.of(
+            CmsAction.MANAGE_MEDIA, CmsAction.MANAGE_TYPES, CmsAction.MANAGE_PRINCIPALS,
+            CmsAction.MANAGE_SETTINGS, CmsAction.READ_AUDIT);
+
+    static final String GRANT_CACHE_PREFIX = AuthorizationService.class.getName() + ".grants:";
+
     public enum DecisionKind { ALLOW, FORBIDDEN, SURFACE_FORBIDDEN }
     public record Decision(DecisionKind kind, CmsAction action, String contentType, Surface surface) {
         public boolean allowed() { return kind == DecisionKind.ALLOW; }
@@ -63,6 +78,42 @@
         return false;
     }
 
+    /**
+     * Capabilities of the principal on the surface (02 §4.2). Hard-deny sets are applied first; an action is listed
+     * when at least one grant matches it ignoring predicates; scoped is true when every matching grant of some listed
+     * action carries a predicate.
+     */
+    public Capabilities capabilities(Principal principal, Surface surface, List<String> enabledTypeKeys) {
+        Surface resolved = surface == null ? Surface.FRONT : surface;
+        List<Grant> grants = collectGrants(principal);
+        List<Capabilities.TypeCapability> types = new ArrayList<>();
+        for (String typeKey : enabledTypeKeys) {
+            List<String> actions = new ArrayList<>();
+            boolean scoped = false;
+            for (CmsAction action : TYPE_ACTIONS) {
+                if (hardDenied(resolved, action)) continue;
+                List<Grant> matching = grants.stream().filter(g -> matchesGrant(g, action, typeKey, resolved)).toList();
+                if (matching.isEmpty()) continue;
+                actions.add(action.wire());
+                if (matching.stream().allMatch(g -> g.permission.predicateJson() != null && !g.permission.predicateJson().isBlank())) {
+                    scoped = true;
+                }
+            }
+            if (!actions.isEmpty()) types.add(new Capabilities.TypeCapability(typeKey, List.copyOf(actions), scoped));
+        }
+        List<String> global = new ArrayList<>();
+        for (CmsAction action : GLOBAL_ACTIONS) {
+            if (hardDenied(resolved, action)) continue;
+            if (grants.stream().anyMatch(g -> matchesGrant(g, action, null, resolved))) global.add(action.wire());
+        }
+        return new Capabilities(resolved.wire(), List.copyOf(types), List.copyOf(global));
+    }
+
+    private static boolean hardDenied(Surface surface, CmsAction action) {
+        return (surface == Surface.FRONT && CmsAction.FRONT_HARD_DENY.contains(action))
+                || (surface == Surface.BACK && CmsAction.BACK_HARD_DENY.contains(action));
+    }
+
     private boolean matches(Grant grant, Principal principal, CmsAction action, String contentType, Map<String, Object> entry, Surface surface) {
         return matchesGrant(grant, action, contentType, surface)
                 && predicateAllows(grant.permission.predicateJson(), principal, entry);
@@ -100,16 +151,34 @@
         }
     }
 
+    /**
+     * Grants of the principal plus anonymous grants. Inside an HTTP request the result is cached as a request
+     * attribute, so one request reads roles and permissions from the store once per principal (B-12).
+     * Outside a request (seeders, unit tests) nothing is cached.
+     */
+    @SuppressWarnings("unchecked")
     private List<Grant> collectGrants(Principal principal) {
+        RequestAttributes request = RequestContextHolder.getRequestAttributes();
+        String key = GRANT_CACHE_PREFIX + (principal == null ? "anonymous" : principal.id());
+        if (request != null) {
+            Object cached = request.getAttribute(key, RequestAttributes.SCOPE_REQUEST);
+            if (cached != null) return (List<Grant>) cached;
+        }
+        List<Grant> grants = loadGrants(principal);
+        if (request != null) request.setAttribute(key, grants, RequestAttributes.SCOPE_REQUEST);
+        return grants;
+    }
+
+    private List<Grant> loadGrants(Principal principal) {
         List<Grant> grants = new ArrayList<>();
         Optional<Role> anonymous = store.findRoleByCode(RoleCode.ANONYMOUS.wire());
         anonymous.ifPresent(role -> store.permissionsOfRole(role.id()).forEach(permission -> grants.add(new Grant(RoleCode.ANONYMOUS.wire(), Set.of(), permission))));
-        if (principal == null) return grants;
+        if (principal == null) return List.copyOf(grants);
         for (PrincipalRoleAssignment assignment : store.rolesOf(principal.id())) {
             Set<String> allowlist = new HashSet<>(assignment.contentTypeCodes());
             for (Permission permission : store.permissionsOfRole(assignment.roleId())) grants.add(new Grant(assignment.roleCode(), allowlist, permission));
         }
-        return grants;
+        return List.copyOf(grants);
     }
 
     public List<Map<String, Object>> effectivePermissions(UUID principalId) {
```

`AuthController`：`mePayload` 改成實例方法並接收 surface；登入用 `identity.surface()`，`/auth/me` 也一樣。

`src/main/java/com/fallrising/cms/identity/web/AuthController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/web/AuthController.java
+++ b/src/main/java/com/fallrising/cms/identity/web/AuthController.java
@@ -1,9 +1,13 @@
 package com.fallrising.cms.identity.web;
 
 import com.fallrising.cms.identity.crypto.SessionTokens;
+import com.fallrising.cms.identity.domain.Capabilities;
 import com.fallrising.cms.identity.domain.Principal;
 import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
+import com.fallrising.cms.identity.domain.Surface;
 import com.fallrising.cms.identity.service.AuthService;
+import com.fallrising.cms.identity.service.AuthorizationService;
+import com.fallrising.cms.identity.service.ContentTypeDirectory;
 import jakarta.servlet.http.HttpServletRequest;
 import jakarta.servlet.http.HttpServletResponse;
 import jakarta.validation.Valid;
@@ -32,10 +36,18 @@
 
     private final AuthService authService;
     private final CookieSupport cookies;
+    private final AuthorizationService authorization;
+    private final ContentTypeDirectory contentTypes;
 
-    public AuthController(AuthService authService, CookieSupport cookies) {
+    public AuthController(
+            AuthService authService,
+            CookieSupport cookies,
+            AuthorizationService authorization,
+            ContentTypeDirectory contentTypes) {
         this.authService = authService;
         this.cookies = cookies;
+        this.authorization = authorization;
+        this.contentTypes = contentTypes;
     }
 
     @PostMapping("/login")
@@ -45,7 +57,7 @@
         AuthService.LoginResult result = authService.login(body.username(), body.password(), identity);
         cookies.setSession(response, result.sessionToken());
         cookies.setCsrf(response, result.csrfToken());
-        Map<String, Object> payload = mePayload(authService.toMe(result.principal()));
+        Map<String, Object> payload = mePayload(authService.toMe(result.principal()), identity.surface());
         payload.put("csrfToken", result.csrfToken());
         return payload;
     }
@@ -60,7 +72,8 @@
 
     @GetMapping("/me")
     public Map<String, Object> me(HttpServletRequest request) {
-        return mePayload(authService.me(current(request)));
+        IdentityRequest identity = current(request);
+        return mePayload(authService.me(identity), identity.surface());
     }
 
     @GetMapping("/csrf")
@@ -82,7 +95,7 @@
         return (IdentityRequest) request.getAttribute(IdentityErrorWriter.ATTR);
     }
 
-    static Map<String, Object> mePayload(AuthService.MeResult me) {
+    Map<String, Object> mePayload(AuthService.MeResult me, Surface surface) {
         Principal principal = me.principal();
         Map<String, Object> principalJson = new LinkedHashMap<>();
         principalJson.put("id", principal.id().toString());
@@ -94,9 +107,25 @@
         body.put("principal", principalJson);
         body.put("roles", roles);
         body.put("surfaces", me.surfaces());
+        body.put("capabilities", capabilitiesJson(
+                authorization.capabilities(principal, surface, contentTypes.enabledTypeKeys())));
         return body;
     }
 
+    private static Map<String, Object> capabilitiesJson(Capabilities capabilities) {
+        Map<String, Object> json = new LinkedHashMap<>();
+        json.put("surface", capabilities.surface());
+        json.put("types", capabilities.types().stream().map(type -> {
+            Map<String, Object> item = new LinkedHashMap<>();
+            item.put("key", type.key());
+            item.put("actions", type.actions());
+            item.put("scoped", type.scoped());
+            return item;
+        }).toList());
+        json.put("global", capabilities.global());
+        return json;
+    }
+
     private static Map<String, Object> roleJson(PrincipalRoleAssignment assignment) {
         Map<String, Object> json = new LinkedHashMap<>();
         json.put("code", assignment.roleCode());
```

---

## 6. 任務卡

大小：S ≤ 150 行、M ≤ 400 行（只算手寫或手改的行；整檔複製算 1 行）。所有指令在 `apps/cms-scaffold` 執行。預期紅燈是預演實測的結果；某個預期紅燈的測試若已經綠了，照樣繼續。

### BW1a-T01 【測試先行】store 契約：類型設定、欄位中繼資料、以 titleField 搜尋

- **目標**：把新的 store 行為寫成契約案例。
- **輸入**：BW0 `VERIFIED`。
- **步驟**：套用 §7.1 的 `ContentStoreContract.java` diff（新增 5 個案例；既有 6 處 `listEntries(...)` 呼叫在第 4 個參數加上 `"title"`）。
- **完成條件**：預期紅燈：`src/test` 編譯失敗（`withSettings`、`withMetadata`、`updateTypeSettings`、`updateFieldMetadata` 不存在，`listEntries` 參數數量不符）。
- **驗證**：`./gradlew :services:cms-api:compileTestJava`（預期失敗）
- **對應 ID**：B-03、B-05
- **大小**：S

### BW1a-T02 V5、資料型別與 store

- **目標**：§5.1。
- **輸入**：T01。
- **步驟**：
  1. 建立 §4.5 的 V5 migration。
  2. 以 §5.1 全文取代 `ContentTypeRecord.java`、`FieldRecord.java`。
  3. 套用 §5.1 的四段 diff（`ContentStore`、`InMemoryContentStore`、`JdbcContentStore`、`EntryService`）。
- **完成條件**：`./gradlew :services:cms-api:test` 116 個測試全綠；`./gradlew :services:cms-api:integrationTest` 49 個全綠（其中 `JdbcContentStoreContractTests` 24 個）。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：B-03、B-05
- **大小**：M

### BW1a-T03 【測試先行】種子

- **目標**：把 §5.3 的種子規則寫成測試。
- **輸入**：T02。
- **步驟**：建立 `src/test/java/com/fallrising/cms/content/service/ContentTypeSeedTests.java`（§7.2）。
- **完成條件**：預期紅燈正好 3 個：`B03_seedSetsTypeSettings`、`B05_seedWritesFieldMetadata`、`B03_seedFillsAnExistingDatabaseOnceAndKeepsLaterEdits`；`B03_seedIsIdempotent` 已綠。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.content.service.ContentTypeSeedTests'`
- **對應 ID**：B-03、B-05、G-06
- **大小**：S

### BW1a-T04 種子

- **目標**：§5.3。
- **輸入**：T03。
- **步驟**：以 §5.3 全文取代 `ContentTypeSeed.java`。
- **完成條件**：`ContentTypeSeedTests` 4 個全綠；`./gradlew :services:cms-api:test` 120 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`
- **對應 ID**：B-03、B-05、G-06
- **大小**：M
- **順序說明**：這張卡必須在 T06 之前。預演時先做 T06 再做本卡，`DemoPackTests` 的 `tAl01AlbumHappyPathUsesEntryApi`、`tAl04UnlistedAlbumIsHiddenFromIndex`、`tPj01IssueStatusIsNotPublicationState` 會失敗，因為可見性改讀 `visibilityField` 時，`album` 與 `project` 還沒有這個設定。

### BW1a-T05 【測試先行】可見性與公開排序

- **目標**：把 §4.2 前兩列寫成測試。
- **輸入**：T04。
- **步驟**：建立 `src/test/java/com/fallrising/cms/PublicVisibilityTests.java` 與 `src/test/java/com/fallrising/cms/content/service/PublicOrderTests.java`（§7.3）。
- **完成條件**：預期紅燈：`src/test` 編譯失敗（`PublicVisibility.indexable/gettable` 與 `EntryService.publicOrder` 的參數不符）。
- **驗證**：`./gradlew :services:cms-api:compileTestJava`（預期失敗）
- **對應 ID**：B-03
- **大小**：S

### BW1a-T06 kernel 改讀類型設定

- **目標**：§5.2。
- **輸入**：T05。
- **步驟**：以 §5.2 全文取代 `PublicVisibility.java`；套用 §5.2 的兩段 diff（`EntryService`、`MediaService`）。
- **完成條件**：`PublicVisibilityTests` 2 個、`PublicOrderTests` 2 個綠；`./gradlew :services:cms-api:test` 124 個全綠。另執行 `grep -rn '"sortOrder"\|get("visibility")\|"title")' services/cms-api/src/main/java/com/fallrising/cms --include=*.java | grep -v Seed`，輸出只有一行：`JdbcMediaStore.java` 讀媒體標題的 `rs.getString("title")`。
- **驗證**：`./gradlew :services:cms-api:test`
- **對應 ID**：B-03
- **大小**：S

### BW1a-T07 【測試先行】類型 schema、標題與 capabilities

- **目標**：寫下 API 輸出的所有預期。
- **輸入**：T06。
- **步驟**：建立 `TypeSchemaTests.java`、`CapabilitiesTests.java`（§7.4、§7.5，放在 `src/test/java/com/fallrising/cms/`）與 `src/test/java/com/fallrising/cms/identity/service/GrantCacheTests.java`（§7.6）。
- **完成條件**：`GrantCacheTests` 編譯失敗（`capabilities` 不存在）。先執行 `mkdir -p /tmp/bw1a-hold && mv services/cms-api/src/test/java/com/fallrising/cms/identity/service/GrantCacheTests.java /tmp/bw1a-hold/`，跑驗證指令，再執行 `mv /tmp/bw1a-hold/GrantCacheTests.java services/cms-api/src/test/java/com/fallrising/cms/identity/service/`。預期紅燈是 `TypeSchemaTests` 5 個中的 4 個（`G05_unknownTypeIsNotFound` 已綠，是回歸保護）與 `CapabilitiesTests` 7 個全部。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.TypeSchemaTests' --tests 'com.fallrising.cms.CapabilitiesTests'`
- **對應 ID**：G-01、G-05、G-06、G-11、B-04、B-12
- **大小**：M

### BW1a-T08 API 輸出、capabilities、授權快取與契約

- **目標**：§5.4、§5.5，並換上 BW1a 契約。這些必須在同一張卡：契約的 `Me` 與 `LoginResponse` 把 `capabilities` 列為必填，而全域回應驗證（BW0）會檢查每一個回應，所以契約、類型 schema 與 `capabilities` 必須一起上。
- **輸入**：T07。
- **步驟**：
  1. 建立 §5.5 的 `Capabilities.java`、`ContentTypeDirectory.java`、`StoreContentTypeDirectory.java`。
  2. 套用 §5.4 的三段 diff（`ContentProjection`、`EntryController`、`AdminContentController`）與 §5.5 的兩段 diff（`AuthorizationService`、`AuthController`）。
  3. `cp docs/v2/contracts/BW1a.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`，並以 `cmp` 確認相同。
- **完成條件**：`TypeSchemaTests`、`CapabilitiesTests`、`GrantCacheTests` 共 15 個綠；`./gradlew :services:cms-api:test` 139 個全綠；`./gradlew :services:cms-api:integrationTest` 49 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：G-01、G-05、G-06、G-11、B-04、B-05、B-12
- **大小**：M

### BW1a-T09 完整閘門、狀態與 PR

- **目標**：交付。
- **輸入**：T08。
- **步驟**：
  1. 執行 §9 的完整閘門。
  2. `docs/v2/README.md` 路線圖中 BW1a 那一列的狀態從 `DOC_READY` 改成 `VERIFIED`。
  3. 逐項勾選 §9，貼進 PR 說明。PR 標題：`feat(cms-scaffold): BW1a 類型設定與欄位中繼資料`；說明列出 B-03、B-04、B-05、B-12、G-01、G-05、G-06、G-11，以及 §4.2 的行為變更。
- **完成條件**：§9 全部打勾；CI 的 `java`、`java-integration`、`web` 全綠。
- **驗證**：§9 的指令。
- **對應 ID**：全部
- **大小**：S

---

## 7. 測試規格

層級沿用 [BW0 §7](BW0.md#7-測試規格)：MockMvc 測試在 `./gradlew test` 執行，使用 in-memory store 與種子，並經過全域 OpenAPI 回應驗證；store 契約在 `test`（in-memory）與 `integrationTest`（PostgreSQL）各跑一次。

### 7.1 `ContentStoreContract` 新增的案例（store 契約）

| 案例 | 固定的行為 |
| --- | --- |
| `B03_typeSettingsRoundTrip` | 三個設定寫入後讀回相同 |
| `B03_updateTypeSettingsChangesOnlySettings` | `updateTypeSettings` 只改三個設定與 `updatedAt` |
| `B05_fieldMetadataRoundTrip` | 七個中繼資料欄寫入後讀回相同（`enumLabels` 含兩個鍵） |
| `B05_updateFieldMetadataChangesOnlyMetadata` | `updateFieldMetadata` 只改七個中繼資料欄 |
| `B03_searchUsesGivenTitleField` | `q` 比對指定的 `titleField`，不比對 `title`；`titleField` 為 null 時沒有結果 |

`src/test/java/com/fallrising/cms/contract/ContentStoreContract.java`：

```diff
--- a/src/test/java/com/fallrising/cms/contract/ContentStoreContract.java
+++ b/src/test/java/com/fallrising/cms/contract/ContentStoreContract.java
@@ -150,11 +150,11 @@
         EntryRecord other = entry(page, "o", PublicationState.DRAFT, Map.of("title", "o"), t(50));
         List.of(draft, published, archived, gone, other).forEach(store::insertEntry);
 
-        assertThat(store.listEntries(album.id(), List.of(), false, null, null, null))
+        assertThat(store.listEntries(album.id(), List.of(), false, "title", null, null, null))
                 .extracting(EntryRecord::slug).containsExactly("p", "a", "d");
-        assertThat(store.listEntries(album.id(), List.of("draft", "published"), false, null, null, null))
+        assertThat(store.listEntries(album.id(), List.of("draft", "published"), false, "title", null, null, null))
                 .extracting(EntryRecord::slug).containsExactly("p", "d");
-        assertThat(store.listEntries(album.id(), List.of(), true, null, null, null))
+        assertThat(store.listEntries(album.id(), List.of(), true, "title", null, null, null))
                 .extracting(EntryRecord::slug).containsExactly("x", "p", "a", "d");
     }
 
@@ -185,9 +185,9 @@
         store.replaceRefs(p1.id(), List.of(new EntryRefRecord(p1.id(), "album", a1.id(), "entry", 0)));
         store.replaceRefs(p2.id(), List.of(new EntryRefRecord(p2.id(), "album", a2.id(), "entry", 0)));
 
-        assertThat(store.listEntries(photo.id(), List.of(), false, null, "album", a1.id()))
+        assertThat(store.listEntries(photo.id(), List.of(), false, "title", null, "album", a1.id()))
                 .extracting(EntryRecord::slug).containsExactly("p1");
-        assertThat(store.listEntries(photo.id(), List.of(), false, null, "cover", a1.id())).isEmpty();
+        assertThat(store.listEntries(photo.id(), List.of(), false, "title", null, "cover", a1.id())).isEmpty();
     }
 
     @Test
@@ -282,6 +282,54 @@
         assertThat(store.findNavigation("front.primary")).contains(published);
     }
 
+    @Test
+    void B03_typeSettingsRoundTrip() {
+        ContentTypeRecord photo = type("photo").withSettings("sortOrder", "visibility", "ownerPrincipalId", T0);
+        store.insertType(photo);
+        assertThat(store.findTypeByKey("photo")).contains(photo);
+    }
+
+    @Test
+    void B03_updateTypeSettingsChangesOnlySettings() {
+        ContentTypeRecord album = type("album");
+        store.insertType(album);
+        ContentTypeRecord changed = new ContentTypeRecord(album.id(), "album", "Other", "Others", "desc", "name",
+                "none", true, false, false, List.of("cover"), t(50), t(60), "sortOrder", "visibility", "owner");
+        store.updateTypeSettings(changed);
+        assertThat(store.findTypeByKey("album")).contains(album.withSettings("sortOrder", "visibility", "owner", t(60)));
+    }
+
+    @Test
+    void B05_fieldMetadataRoundTrip() {
+        ContentTypeRecord album = insertType("album");
+        FieldRecord visibility = field(album.id(), "visibility", "enum", 0).withMetadata(
+                "可見性", "settings", true, true, Map.of("public", "公開", "unlisted", "不公開列出"), "選一個", "說明文字");
+        store.insertField(visibility);
+        assertThat(store.fieldsOf(album.id())).containsExactly(visibility);
+    }
+
+    @Test
+    void B05_updateFieldMetadataChangesOnlyMetadata() {
+        ContentTypeRecord album = insertType("album");
+        FieldRecord title = field(album.id(), "title", "string", 0);
+        store.insertField(title);
+        FieldRecord changed = new FieldRecord(title.id(), album.id(), "renamed", "int", true, true, true, "back", 9,
+                "page", "cascade_soft", List.of("x"), false, true, "標題", "main", true, false, Map.of(), "輸入標題", "顯示在列表");
+        store.updateFieldMetadata(changed);
+        assertThat(store.fieldsOf(album.id())).containsExactly(
+                title.withMetadata("標題", "main", true, false, Map.of(), "輸入標題", "顯示在列表"));
+    }
+
+    @Test
+    void B03_searchUsesGivenTitleField() {
+        ContentTypeRecord profile = insertType("clinic_profile");
+        store.insertEntry(entry(profile, "c1", PublicationState.DRAFT, Map.of("name", "Cedar Clinic", "title", "zzz"), t(1)));
+        store.insertEntry(entry(profile, "c2", PublicationState.DRAFT, Map.of("name", "Oak", "title", "Cedar"), t(2)));
+        assertThat(store.listEntries(profile.id(), List.of(), false, "name", "cedar", null, null))
+                .extracting(EntryRecord::slug).containsExactly("c1");
+        assertThat(store.listEntries(profile.id(), List.of(), false, null, "cedar", null, null)).isEmpty();
+    }
+
     // ---- fixtures ----
 
     protected static Instant t(int seconds) {
@@ -323,6 +371,6 @@
     }
 
     private List<String> slugs(ContentTypeRecord type, String q) {
-        return store.listEntries(type.id(), List.of(), false, q, null, null).stream().map(EntryRecord::slug).toList();
+        return store.listEntries(type.id(), List.of(), false, "title", q, null, null).stream().map(EntryRecord::slug).toList();
     }
 }
```

### 7.2 `ContentTypeSeedTests`（單元，in-memory store）

| 測試 | 前置資料 | 斷言 |
| --- | --- | --- |
| `B03_seedSetsTypeSettings` | 空 store，執行 `seed()` | 9 個類型的三個設定符合 §5.3 表格 |
| `B05_seedWritesFieldMetadata` | 同上 | 抽查 10 個欄位的 label、group、listable、filterable、enumLabels；所有欄位的 label 都不是空白 |
| `B03_seedFillsAnExistingDatabaseOnceAndKeepsLaterEdits` | 先放入沒有設定的 `album` 與沒有 label 的 `title` 欄位（模擬 V5 之前的資料庫） | 第一次 `seed()` 補上設定與 label；之後手動改 label 為「名稱」、改 `visibilityField` 為 `shownTo`，第二次 `seed()` 不覆蓋 |
| `B03_seedIsIdempotent` | 執行兩次 `seed()` | 類型與欄位完全相同 |

`src/test/java/com/fallrising/cms/content/service/ContentTypeSeedTests.java`：

```java
package com.fallrising.cms.content.service;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.store.InMemoryContentStore;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class ContentTypeSeedTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    @Test
    void B03_seedSetsTypeSettings() {
        InMemoryContentStore store = new InMemoryContentStore();
        new ContentTypeSeed(store).seed();
        assertThat(settings(store, "album")).containsExactly(null, "visibility", null);
        assertThat(settings(store, "project")).containsExactly(null, "visibility", null);
        assertThat(settings(store, "photo")).containsExactly("sortOrder", null, null);
        assertThat(settings(store, "milestone")).containsExactly("sortOrder", null, null);
        assertThat(settings(store, "owner")).containsExactly(null, null, "ownerPrincipalId");
        assertThat(settings(store, "pet")).containsExactly(null, null, "ownerPrincipalId");
        assertThat(settings(store, "visit")).containsExactly(null, null, "ownerPrincipalId");
        assertThat(settings(store, "page")).containsExactly(null, null, null);
        assertThat(settings(store, "issue")).containsExactly(null, null, null);
    }

    @Test
    void B05_seedWritesFieldMetadata() {
        InMemoryContentStore store = new InMemoryContentStore();
        new ContentTypeSeed(store).seed();
        FieldRecord visibility = field(store, "album", "visibility");
        assertThat(visibility.label()).isEqualTo("可見性");
        assertThat(visibility.groupKey()).isEqualTo("settings");
        assertThat(visibility.listable()).isTrue();
        assertThat(visibility.filterable()).isTrue();
        assertThat(visibility.enumLabels()).isEqualTo(Map.of("public", "公開", "unlisted", "不公開列出"));
        assertThat(field(store, "album", "cover").groupKey()).isEqualTo("media");
        assertThat(field(store, "photo", "album").groupKey()).isEqualTo("relations");
        assertThat(field(store, "photo", "sortOrder").groupKey()).isEqualTo("settings");
        assertThat(field(store, "photo", "sortOrder").listable()).isFalse();
        assertThat(field(store, "issue", "sortOrder").groupKey()).isEqualTo("main");
        assertThat(field(store, "visit", "scheduledAt").filterable()).isTrue();
        assertThat(field(store, "pet", "birthDate").listable()).isTrue();
        assertThat(field(store, "pet", "birthDate").filterable()).isFalse();
        assertThat(field(store, "clinic_profile", "name").listable()).isTrue();
        assertThat(field(store, "clinic_profile", "address").listable()).isFalse();
        assertThat(field(store, "issue", "status").enumLabels()).containsEntry("in_review", "審查中");
        assertThat(store.listTypes()).allSatisfy(type -> assertThat(store.fieldsOf(type.id()))
                .allSatisfy(f -> assertThat(f.label()).isNotBlank()));
    }

    @Test
    void B03_seedFillsAnExistingDatabaseOnceAndKeepsLaterEdits() {
        InMemoryContentStore store = new InMemoryContentStore();
        ContentTypeRecord album = new ContentTypeRecord(UUID.randomUUID(), "album", "Album", "Albums", null, "title",
                "required", false, true, true, List.of(), T0, T0);
        store.insertType(album);
        FieldRecord title = new FieldRecord(UUID.randomUUID(), album.id(), "title", "string", true, false, true,
                "public", 0, null, "restrict", List.of(), true, false);
        store.insertField(title);

        ContentTypeSeed seed = new ContentTypeSeed(store);
        seed.seed();
        assertThat(settings(store, "album")).containsExactly(null, "visibility", null);
        assertThat(field(store, "album", "title").label()).isEqualTo("標題");

        store.updateFieldMetadata(field(store, "album", "title").withMetadata("名稱", "main", true, false, Map.of(), null, null));
        store.updateTypeSettings(store.findTypeByKey("album").orElseThrow().withSettings(null, "shownTo", null, T0));
        seed.seed();
        assertThat(field(store, "album", "title").label()).isEqualTo("名稱");
        assertThat(settings(store, "album")).containsExactly(null, "shownTo", null);
    }

    @Test
    void B03_seedIsIdempotent() {
        InMemoryContentStore store = new InMemoryContentStore();
        ContentTypeSeed seed = new ContentTypeSeed(store);
        seed.seed();
        List<ContentTypeRecord> types = store.listTypes();
        List<List<FieldRecord>> fields = types.stream().map(t -> store.fieldsOf(t.id())).toList();
        seed.seed();
        assertThat(store.listTypes()).isEqualTo(types);
        assertThat(store.listTypes().stream().map(t -> store.fieldsOf(t.id())).toList()).isEqualTo(fields);
    }

    private static List<String> settings(InMemoryContentStore store, String key) {
        ContentTypeRecord type = store.findTypeByKey(key).orElseThrow();
        return java.util.Arrays.asList(type.sortField(), type.visibilityField(), type.ownerField());
    }

    private static FieldRecord field(InMemoryContentStore store, String type, String key) {
        return store.fieldsOf(store.findTypeByKey(type).orElseThrow().id()).stream()
                .filter(f -> f.fieldKey().equals(key)).findFirst().orElseThrow();
    }
}
```

### 7.3 `PublicVisibilityTests`、`PublicOrderTests`（單元）

| 測試 | 斷言 |
| --- | --- |
| `B03_typeWithoutVisibilityFieldIsAlwaysPublic` | 沒有 `visibilityField` 時，payload 的 `visibility: private` 不影響 |
| `B03_visibilityFieldDecides` | `public` 可列可讀；`unlisted` 不可列可讀；`private` 不可列不可讀；其他鍵、空白、null payload 都視為公開 |
| `B03_sortFieldAscendingThenNewestUpdate` | 數字遞增；同值時 `updatedAt` 新的在前；沒有數字與字串數字排最後 |
| `B03_withoutSortFieldNewestPublishFirst` | 沒有 `sortField` 時忽略 payload 的 `sortOrder`，依 `publishedAt` 遞減 |

`src/test/java/com/fallrising/cms/PublicVisibilityTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.content.PublicVisibility;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PublicVisibilityTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    static ContentTypeRecord type(String visibilityField) {
        return new ContentTypeRecord(UUID.randomUUID(), "album", "Album", "Albums", null, "title", "required", false,
                true, true, List.of(), T0, T0, null, visibilityField, null);
    }

    @Test
    void B03_typeWithoutVisibilityFieldIsAlwaysPublic() {
        ContentTypeRecord type = type(null);
        assertThat(PublicVisibility.indexable(type, Map.of("visibility", "private"))).isTrue();
        assertThat(PublicVisibility.gettable(type, Map.of("visibility", "private"))).isTrue();
    }

    @Test
    void B03_visibilityFieldDecides() {
        ContentTypeRecord type = type("shownTo");
        assertThat(PublicVisibility.indexable(type, Map.of("shownTo", "public"))).isTrue();
        assertThat(PublicVisibility.indexable(type, Map.of("shownTo", "unlisted"))).isFalse();
        assertThat(PublicVisibility.gettable(type, Map.of("shownTo", "unlisted"))).isTrue();
        assertThat(PublicVisibility.indexable(type, Map.of("shownTo", "private"))).isFalse();
        assertThat(PublicVisibility.gettable(type, Map.of("shownTo", "private"))).isFalse();
        assertThat(PublicVisibility.indexable(type, Map.of("visibility", "private"))).isTrue();
        assertThat(PublicVisibility.indexable(type, Map.of("shownTo", " "))).isTrue();
        assertThat(PublicVisibility.indexable(type, null)).isTrue();
    }
}
```

`src/test/java/com/fallrising/cms/content/service/PublicOrderTests.java`：

```java
package com.fallrising.cms.content.service;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.PublicationState;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PublicOrderTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    static ContentTypeRecord type(String sortField) {
        return new ContentTypeRecord(UUID.randomUUID(), "photo", "Photo", "Photos", null, "title", "optional", false,
                true, true, List.of(), T0, T0, sortField, null, null);
    }

    static EntryRecord entry(String slug, Map<String, Object> payload, int publishedAt, int updatedAt) {
        return new EntryRecord(UUID.randomUUID(), UUID.randomUUID(), "photo", slug, PublicationState.PUBLISHED, 1,
                payload, payload, T0.plusSeconds(publishedAt), null, null, null, null, T0, T0.plusSeconds(updatedAt));
    }

    @Test
    void B03_sortFieldAscendingThenNewestUpdate() {
        List<EntryRecord> entries = List.of(
                entry("b", Map.of("rank", 2), 1, 1),
                entry("none", Map.of(), 1, 9),
                entry("a2", Map.of("rank", 1), 1, 1),
                entry("a1", Map.of("rank", 1), 1, 5),
                entry("text", Map.of("rank", "1"), 1, 8));
        assertThat(entries.stream().sorted(EntryService.publicOrder(type("rank"))).map(EntryRecord::slug))
                .containsExactly("a1", "a2", "b", "none", "text");
    }

    @Test
    void B03_withoutSortFieldNewestPublishFirst() {
        List<EntryRecord> entries = List.of(
                entry("old", Map.of("sortOrder", 1), 1, 50),
                entry("new", Map.of("sortOrder", 9), 3, 3),
                entry("mid", Map.of(), 2, 2));
        assertThat(entries.stream().sorted(EntryService.publicOrder(type(null))).map(EntryRecord::slug))
                .containsExactly("new", "mid", "old");
    }
}
```

### 7.4 `TypeSchemaTests`（MockMvc）

前置資料：種子帳號 `seed-operator-album`、`seed-operator-projects`、`seed-operator-clinic`（Back）、`seed-admin`（Admin）；`DemoContentSeed` 建立的 `clinic_profile`（`name` = `Cedar Pet Clinic`）。

| # | 測試 | 動作 | 斷言 |
| --- | --- | --- | --- |
| 1 | `G05_workTypeSchemaHasSettingsAndFieldMetadata` | `GET /api/v1/content-types/album`、`/photo` | 設定、`singleton`、`previewable`；`title` 的 label 與 listable；`visibility` 的 group 與 filterable；`cover` 的 group 與 visibility；`photo` 的 `sortField` 與 `album` 欄位的 group、refTarget |
| 2 | `G06_enumLabelsAreExposed` | `GET /api/v1/content-types/issue` | `status` 的 `enumLabels.in_progress` 是「進行中」；非 enum 欄位的 `enumLabels` 是 `{}` |
| 3 | `G05_adminTypeSchemaAddsIndexedAndEnabled` | admin `GET /api/v1/admin/content-types` | `visit` 的 `ownerField`、`enabled`；`scheduledAt` 的 `indexed` 與 label |
| 4 | `G11_workTitleUsesTitleField` | `GET /api/v1/content-types/clinic_profile/entries`，以及加 `q=cedar` | 第一筆 `title` 是 `Cedar Pet Clinic`；搜尋 `total` 為 1 |
| 5 | `G05_unknownTypeIsNotFound` | `GET /api/v1/content-types/no_such_type` | 404 `CONTENT_TYPE_NOT_FOUND` |

`src/test/java/com/fallrising/cms/TypeSchemaTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class TypeSchemaTests {

    @Autowired
    MockMvc mockMvc;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void G05_workTypeSchemaHasSettingsAndFieldMetadata() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/album")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.titleField").value("title"))
                .andExpect(jsonPath("$.visibilityField").value("visibility"))
                .andExpect(jsonPath("$.sortField").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.singleton").value(false))
                .andExpect(jsonPath("$.previewable").value(true))
                .andExpect(jsonPath("$.fields[?(@.key=='title')].label").value(hasItem("標題")))
                .andExpect(jsonPath("$.fields[?(@.key=='title')].listable").value(hasItem(true)))
                .andExpect(jsonPath("$.fields[?(@.key=='visibility')].group").value(hasItem("settings")))
                .andExpect(jsonPath("$.fields[?(@.key=='visibility')].filterable").value(hasItem(true)))
                .andExpect(jsonPath("$.fields[?(@.key=='cover')].group").value(hasItem("media")))
                .andExpect(jsonPath("$.fields[?(@.key=='cover')].visibility").value(hasItem("public")));
        mockMvc.perform(op.apply(get("/api/v1/content-types/photo")))
                .andExpect(jsonPath("$.sortField").value("sortOrder"))
                .andExpect(jsonPath("$.fields[?(@.key=='album')].group").value(hasItem("relations")))
                .andExpect(jsonPath("$.fields[?(@.key=='album')].refTarget").value(hasItem("album")));
    }

    @Test
    void G06_enumLabelsAreExposed() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-projects", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/issue")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fields[?(@.key=='status')].enumLabels.in_progress").value(hasItem("進行中")))
                .andExpect(jsonPath("$.fields[?(@.key=='status')].enumValues[0]").value(hasItem("backlog")))
                .andExpect(jsonPath("$.fields[?(@.key=='title')].enumLabels").value(hasItem(java.util.Map.of())));
    }

    @Test
    void G05_adminTypeSchemaAddsIndexedAndEnabled() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        mockMvc.perform(admin.apply(get("/api/v1/admin/content-types")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.key=='visit')].ownerField").value(hasItem("ownerPrincipalId")))
                .andExpect(jsonPath("$.items[?(@.key=='visit')].enabled").value(hasItem(true)))
                .andExpect(jsonPath("$.items[?(@.key=='visit')].fields[?(@.key=='scheduledAt')].indexed").value(hasItem(true)))
                .andExpect(jsonPath("$.items[?(@.key=='visit')].fields[?(@.key=='scheduledAt')].label").value(hasItem("預約時間")));
    }

    @Test
    void G11_workTitleUsesTitleField() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-clinic", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/clinic_profile/entries")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].title").value("Cedar Pet Clinic"));
        mockMvc.perform(op.apply(get("/api/v1/content-types/clinic_profile/entries").param("q", "cedar")))
                .andExpect(jsonPath("$.total").value(1));
    }

    @Test
    void G05_unknownTypeIsNotFound() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/no_such_type")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("CONTENT_TYPE_NOT_FOUND"));
    }
}
```

### 7.5 `CapabilitiesTests`（MockMvc）

| # | 測試 | 帳號與 surface | 斷言 |
| --- | --- | --- | --- |
| 1 | `G01_operatorOnBackGetsAllActionsOnAllowlistedTypes` | `seed-operator-album`／Back | `album`、`photo` 有全部 8 個動作且 `scoped=false`；`page` 只有 `read_published`；沒有 `pet`；`global` 是 `[manage_media]` |
| 2 | `G01_editorCannotPublish` | `seed-editor-album`／Back | `album` 的動作是 `read_published, read_draft, create, update` |
| 3 | `G01_frontHardDenyIsApplied` | `seed-operator-album`／Front | `album` 只有 `read_published`；`global` 是空陣列 |
| 4 | `G01_memberPredicateGrantsAreScoped` | `seed-member-clinic`／Front | `pet` 只有 `read_published` 且 `scoped=true`；`album` 的 `scoped=false`；沒有 `issue` |
| 5 | `G01_adminGovernanceOnlyOnAdminSurface` | `seed-admin`／Admin，再以 Back 登入 | Admin 上 `global` 有 5 個；Back 上只有 `manage_media`，`visit` 有全部 8 個動作 |
| 6 | `G01_disabledTypeIsNotListed` | `seed-admin`／Admin，先停用 `page` | 清單中沒有 `page`；測試最後重新啟用 `page`（放在 `finally`） |
| 7 | `G01_loginResponseCarriesCapabilities` | 以 `seed-editor-album` 從 Back 登入 | 登入回應的 `capabilities.surface` 是 `back`，第一個類型是 `album` |

`src/test/java/com/fallrising/cms/CapabilitiesTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CapabilitiesTests {

    static final List<String> ALL_TYPE_ACTIONS =
            List.of("read_published", "read_draft", "create", "update", "publish", "unpublish", "delete", "archive");

    @Autowired
    MockMvc mockMvc;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void G01_operatorOnBackGetsAllActionsOnAllowlistedTypes() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/auth/me")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capabilities.surface").value("back"))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='album')].actions").value(hasItem(ALL_TYPE_ACTIONS)))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='photo')].actions").value(hasItem(ALL_TYPE_ACTIONS)))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='album')].scoped").value(hasItem(false)))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='page')].actions").value(hasItem(List.of("read_published"))))
                .andExpect(jsonPath("$.capabilities.types[*].key").value(not(hasItem("pet"))))
                .andExpect(jsonPath("$.capabilities.global").value(equalTo(List.of("manage_media"))));
    }

    @Test
    void G01_editorCannotPublish() throws Exception {
        TestSession editor = TestSession.login(mockMvc, "seed-editor-album", password, TestSession.BACK);
        mockMvc.perform(editor.apply(get("/api/v1/auth/me")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='album')].actions")
                        .value(hasItem(List.of("read_published", "read_draft", "create", "update"))));
    }

    @Test
    void G01_frontHardDenyIsApplied() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.FRONT);
        mockMvc.perform(op.apply(get("/api/v1/auth/me")))
                .andExpect(jsonPath("$.capabilities.surface").value("front"))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='album')].actions").value(hasItem(List.of("read_published"))))
                .andExpect(jsonPath("$.capabilities.global").value(empty()));
    }

    @Test
    void G01_memberPredicateGrantsAreScoped() throws Exception {
        TestSession member = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.FRONT);
        mockMvc.perform(member.apply(get("/api/v1/auth/me")))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='pet')].actions").value(hasItem(List.of("read_published"))))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='pet')].scoped").value(hasItem(true)))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='album')].scoped").value(hasItem(false)))
                .andExpect(jsonPath("$.capabilities.types[*].key").value(not(hasItem("issue"))));
    }

    @Test
    void G01_adminGovernanceOnlyOnAdminSurface() throws Exception {
        TestSession onAdmin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        mockMvc.perform(onAdmin.apply(get("/api/v1/auth/me")))
                .andExpect(jsonPath("$.capabilities.global")
                        .value(equalTo(List.of("manage_media", "manage_types", "manage_principals", "manage_settings", "read_audit"))));
        TestSession onBack = TestSession.login(mockMvc, "seed-admin", password, TestSession.BACK);
        mockMvc.perform(onBack.apply(get("/api/v1/auth/me")))
                .andExpect(jsonPath("$.capabilities.global").value(equalTo(List.of("manage_media"))))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='visit')].actions").value(hasItem(ALL_TYPE_ACTIONS)));
    }

    @Test
    void G01_disabledTypeIsNotListed() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        mockMvc.perform(admin.apply(post("/api/v1/admin/content-types/page/disable"))).andExpect(status().isOk());
        try {
            mockMvc.perform(admin.apply(get("/api/v1/auth/me")))
                    .andExpect(jsonPath("$.capabilities.types[*].key").value(not(hasItem("page"))));
        } finally {
            mockMvc.perform(admin.apply(post("/api/v1/admin/content-types/page/enable"))).andExpect(status().isOk());
        }
    }

    @Test
    void G01_loginResponseCarriesCapabilities() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", TestSession.BACK)
                        .content("{\"username\":\"seed-editor-album\",\"password\":\"%s\"}".formatted(password)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capabilities.surface").value("back"))
                .andExpect(jsonPath("$.capabilities.types[0].key").value("album"));
    }
}
```

### 7.6 `GrantCacheTests`（單元）

前置資料：in-memory identity store，一個 operator 角色（`read_draft`，Back）與一個指派了該角色、allowlist 為 `album` 的 principal。store 用 `java.lang.reflect.Proxy` 包一層，計算 `rolesOf` 被呼叫的次數。

| # | 測試 | 動作 | 斷言 |
| --- | --- | --- | --- |
| 1 | `B12_grantsAreLoadedOncePerRequest` | 綁定一個 request 後呼叫 `hasAction` 50 次與 `capabilities` 1 次 | `rolesOf` 被呼叫 1 次 |
| 2 | `B12_eachRequestLoadsItsOwnGrants` | 兩個不同的 request 各呼叫 1 次 | 2 次 |
| 3 | `B12_outsideARequestNothingIsCached` | 沒有 request，呼叫 3 次 | 3 次 |

`src/test/java/com/fallrising/cms/identity/service/GrantCacheTests.java`：

```java
package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.lang.reflect.Proxy;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class GrantCacheTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    AtomicInteger rolesOfCalls = new AtomicInteger();
    AuthorizationService authorization;
    Principal principal;

    @BeforeEach
    void setUp() {
        InMemoryIdentityStore real = new InMemoryIdentityStore();
        Role operator = new Role(UUID.randomUUID(), "operator", "Operator", true, T0);
        real.insertRole(operator);
        real.insertPermission(new Permission(UUID.randomUUID(), operator.id(), "read_draft", null, null, List.of("back"), T0));
        principal = new Principal(UUID.randomUUID(), "anna", "anna", null, PrincipalStatus.ACTIVE, 0, null, null, T0, T0, null);
        real.insertPrincipal(principal);
        real.replacePrincipalRoles(principal.id(),
                List.of(new PrincipalRoleAssignment(principal.id(), operator.id(), "operator", List.of("album"))));
        IdentityStore counting = (IdentityStore) Proxy.newProxyInstance(
                IdentityStore.class.getClassLoader(), new Class<?>[] {IdentityStore.class}, (proxy, method, args) -> {
                    if (method.getName().equals("rolesOf")) rolesOfCalls.incrementAndGet();
                    return method.invoke(real, args);
                });
        authorization = new AuthorizationService(counting, new ObjectMapper());
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void B12_grantsAreLoadedOncePerRequest() {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        for (int i = 0; i < 50; i++) {
            assertThat(authorization.hasAction(principal, CmsAction.READ_DRAFT, "album", Surface.BACK)).isTrue();
        }
        authorization.capabilities(principal, Surface.BACK, List.of("album", "photo"));
        assertThat(rolesOfCalls.get()).isEqualTo(1);
    }

    @Test
    void B12_eachRequestLoadsItsOwnGrants() {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        authorization.hasAction(principal, CmsAction.READ_DRAFT, "album", Surface.BACK);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        authorization.hasAction(principal, CmsAction.READ_DRAFT, "album", Surface.BACK);
        assertThat(rolesOfCalls.get()).isEqualTo(2);
    }

    @Test
    void B12_outsideARequestNothingIsCached() {
        for (int i = 0; i < 3; i++) {
            authorization.hasAction(principal, CmsAction.READ_DRAFT, "album", Surface.BACK);
        }
        assertThat(rolesOfCalls.get()).isEqualTo(3);
    }
}
```

### 7.7 故障注入

沒有。本波次沒有新的錯誤路徑。

---

## 8. 失敗模式對照

| FM ID | 失敗情境 | 期望行為 | 由哪個測試覆蓋 | 任務卡 |
| --- | --- | --- | --- | --- |
| BW1a-FM01 | 未登入呼叫 `/auth/me` | 401 `UNAUTHENTICATED`（不變） | 既有 `IdentityAuthTests.meWithoutSessionIs401` | T08 |
| BW1a-FM02 | 在 Front 取得 `capabilities` | Front hard-deny 的動作不出現 | `CapabilitiesTests.G01_frontHardDenyIsApplied` | T07、T08 |
| BW1a-FM03 | 權限不足的類型 | 不出現在 `capabilities.types` | `CapabilitiesTests.G01_operatorOnBackGetsAllActionsOnAllowlistedTypes`（沒有 `pet`） | T07、T08 |
| BW1a-FM04 | 只有帶 predicate 的 grant | `scoped=true`，前端仍要處理 403 | `CapabilitiesTests.G01_memberPredicateGrantsAreScoped` | T07、T08 |
| BW1a-FM05 | 停用的類型 | 不出現在 `capabilities`；`GET /content-types` 不列出（不變） | `CapabilitiesTests.G01_disabledTypeIsNotListed` | T07、T08 |
| BW1a-FM06 | 驗證失敗、版本衝突 | 本波次沒有改寫入路徑；行為不變 | 既有 `ErrorEnvelopeTests.B14_staleVersionIsVersionConflict`、`DemoPackTests` | — |
| BW1a-FM07 | 類型不存在 | `GET /content-types/{key}` 404 `CONTENT_TYPE_NOT_FOUND`（不變）；工作投影在類型列遺失時 `title` 為 null，不丟例外 | `TypeSchemaTests.G05_unknownTypeIsNotFound`；`ContentProjection.work` 對 null 類型的處理見 §5.4 | T07、T08 |
| BW1a-FM08 | 資料庫失敗 | 500 `INTERNAL_ERROR`（BW0 不變） | BW0 `ApiExceptionHandlerTests` | — |
| BW1a-FM09 | 既有資料庫升級到 V5（demo 類型沒有設定、欄位沒有 label） | 下次啟動時種子補上；之後 admin 的修改不被覆蓋 | `ContentTypeSeedTests.B03_seedFillsAnExistingDatabaseOnceAndKeepsLaterEdits` | T03、T04 |
| BW1a-FM10 | 類型沒有 `visibilityField` 但 payload 有 `visibility: private` | 仍然公開 | `PublicVisibilityTests.B03_typeWithoutVisibilityFieldIsAlwaysPublic` | T05、T06 |
| BW1a-FM11 | `sortField` 的值不是數字 | 排在最後 | `PublicOrderTests.B03_sortFieldAscendingThenNewestUpdate` | T05、T06 |
| BW1a-FM12 | `titleField` 指向不存在的欄位，或類型列遺失 | 標題為 null；`q` 沒有結果 | `ContentStoreContract.B03_searchUsesGivenTitleField`（null titleField） | T01、T02 |
| BW1a-FM13 | 一個請求內大量授權檢查 | 角色與權限只讀一次 | `GrantCacheTests.B12_grantsAreLoadedOncePerRequest` | T07、T08 |
| BW1a-FM14 | 權限在兩個請求之間被修改 | 下一個請求看到新權限 | `GrantCacheTests.B12_eachRequestLoadsItsOwnGrants` | T07、T08 |
| BW1a-FM15 | 回應多了契約沒有的屬性 | 全域 OpenAPI 驗證讓該 MockMvc 測試失敗（處理方式同 [BW0-FM12](BW0.md#8-失敗模式對照)） | 全部 MockMvc 測試 | T08 |

---

## 9. 交付檢查表

- [ ] T01～T09 全部完成。
- [ ] `./gradlew test` 全綠（預期 139 個＝BW0 的 111＋本波 28）。
- [ ] `./gradlew integrationTest` 全綠（49 個）；本機沒有 Docker 時勾「只在 CI 跑過」並附連結。
- [ ] `npm ci && npm run lint && npm run typecheck && npm test && npm run build` 全綠。
- [ ] `cmp docs/v2/contracts/BW1a.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。
- [ ] B-03：T06 的 `grep` 只輸出 `JdbcMediaStore.java` 那一行。
- [ ] B-04／G-01：`CapabilitiesTests` 綠。
- [ ] B-05／G-05／G-06：`TypeSchemaTests`、`ContentTypeSeedTests` 綠。
- [ ] B-12：`GrantCacheTests` 綠。
- [ ] G-11：`TypeSchemaTests.G11_workTitleUsesTitleField` 綠。
- [ ] `gradle.lockfile` 沒有變動（`git diff --stat origin/main -- services/cms-api/gradle.lockfile` 沒有輸出）。
- [ ] 沒有秘密或密碼（新測試只用 `@Value("${cms.identity.seed-password}")`）。
- [ ] `docs/v2/README.md` 的 BW1a 狀態已改成 `VERIFIED`。
- [ ] PR 說明列出 §4.2 的行為變更，以及實際跑過的指令與結果。

---

## 10. BW1a 必寫內容索引

| REFINE-PROMPT 要求 | 位置 |
| --- | --- |
| V5 migration 全文 | §4.5 |
| 種子更新的逐欄內容 | §5.3 表格 |
| `capabilities` 的計算規則 | §4.4 |
