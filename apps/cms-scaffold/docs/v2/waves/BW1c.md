# BW1c 施工圖 — 驗證與破壞性變更

[回 v2 索引](../README.md) ・ 框架：[02 §7 BW1c](../02-backend-sdd.md#7-後端波次) ・ 契約：[contracts/BW1c.openapi.yaml](../contracts/BW1c.openapi.yaml) ・ 前一波：[BW1b](BW1b.md)

狀態：**DOC_READY**（本檔合併即生效）  
日期：2026-09-25  
讀者：實作 BW1c 的 agent。只讀本檔、`contracts/BW1c.openapi.yaml` 與本檔引用的檔案就能完成，不需要做任何設計決定。

> **預演紀錄。** 本檔的程式碼、YAML 與測試，已套用在「BW1b 施工圖完成後」的 `services/cms-api` 副本上，並逐張任務卡執行過（2026-09-25）。T02、T04 完成後，`./gradlew :services:cms-api:test` 依序是 187、194 個測試，每次唯一失敗的是 `CmsApiApplicationTests.runtimeIsJava25`（預演環境只有 JDK 21）；T04 後 `integrationTest` 67 個全綠，但用的是本機 PostgreSQL 16.13，不是 Testcontainers。各「測試先行」卡的預期紅燈清單也是實際跑出來的。

---

## 1. 範圍

### 1.1 解決的 ID

| ID | 來源 | 本波次做到什麼程度 |
| --- | --- | --- |
| B-06 | 02 §1.2 | 驗證一次收集所有欄位錯誤，每個錯誤有欄位路徑與代碼；`string`、`markdown`、`datetime`、`int`、`enum` 有明確規則（§4.3） |
| B-13 | 02 §1.2 | 公開投影中無法公開的 `media-ref` 回 `null`，不再回原始 UUID |
| G-07 | 01 §9 | PATCH 的 `null` 清空欄位：寫進契約並以 API 測試固定 |
| BD-08 | 02 §2 | `error.fields: [{ field, code, message }]`（錯誤信封本身在 BW0 已統一） |
| 02 §4.4 | 02 | 三項破壞性變更全部（§4.2 前後對照） |

稽核 ID：沒有新的稽核 ID。前端配合的是 W1（欄位錯誤、428）與 W3（媒體 null），見 02 §4.4。

### 1.2 不做

- 01 §1.2、AGENTS.md「不要做」全部。
- 02 BQ-06（principal 400 改 404）、BQ-07（媒體錯誤代碼改大寫）：都是破壞性變更，而 BD-02 只允許 02 §4.4 的三項；兩題都還沒有 owner 的決定，本波次不做。
- 02 BQ-08（管理端輸入驗證）、BQ-10（公開 `ref` 篩選）、BQ-11（公開列表的媒體批次解析）：沒有 owner 的決定，本波次不做。公開投影對每個 `media-ref` 仍各自呼叫 `MediaService.resolvePublic`，本波次只改它失敗時的回傳值。
- `slug` 的驗證：`SLUG_REQUIRED`、`SLUG_CONFLICT` 行為不變，沒有 `error.fields`（`slug` 不是 payload 欄位）。
- 管理端（`/admin/**`）與身分（`/principals/**`）的錯誤不加 `error.fields`。
- 已經存進資料庫、不符合新規則的值不會被修正或拒絕讀取；只在下一次寫入或發布時被驗證（§4.2 最後一列）。
- 不新增依賴，所以 `gradle.lockfile` 不變。

---

## 2. 先決條件

### 2.1 前置波次

- **BW1b 必須已是 `VERIFIED`**。02 §7 原本寫「BW1c 只依賴 BW0，可以與 BW1a、BW1b 平行」；細化後改為依序：本檔的 `openapi.yaml` 是在 BW1b 契約上修改後整檔取代，而且 `EntryService`、`PublicContentController`、`ContentProjection` 的 diff 以 BW1b 完成後的檔案為基準。本 PR 在 02 §7 補註。
- 本檔所有 diff 都以「BW1b 施工圖完成後」的檔案為基準；如果 `main` 上的這些檔案與 BW1b 施工圖的結果不同，先停下來回報，不要硬套。
- **與前端的關係（[01 Q-10](../01-frontend-sdd.md#133-w0-細化時新增已決定owner2026-09-25)）。** 前後端各自依自己的契約開發，差異在整合階段一起處理。W0 已合併時，T04 換上 BW1c 契約後 `web` job 的 `codegen.test.ts` 會失敗：本波次不改前端，在 PR 說明列出，§9 的 `web` 一項改勾「只有 codegen 新鮮度或 fixture 型別失敗」。三項破壞性變更要等前端 W1、W3 配合（02 §4.4）；本波次只交付後端與契約。

### 2.2 環境

與 [BW0 §2.2](BW0.md#22-環境) 相同：JDK 25、`./gradlew`、`integrationTest` 需要 Docker、沒有新的環境變數。

### 2.3 查證過的外部事實

本波次沒有新的外部依賴或函式庫 API。用到的事實都以預演執行查證（2026-09-25，Spring Boot 3.5.16 BOM 解析出的版本）：

| 事實 | 用在哪裡 | 查證方式 |
| --- | --- | --- |
| Jackson 2.19（Boot BOM）把 JSON 整數讀成 `Integer`、超過 int 的讀成 `Long`、超過 long 的讀成 `BigInteger`；有小數點的讀成 `Double` | `int` 規則 | 預演：`PayloadValidatorTests.B06_numbersBooleansDatetimesAndEnumsCheckJsonTypes`、`EntryWriteRulesApiTests.B06_createReturnsEveryFieldErrorAtOnce`（`sortMode: 5` 的 enum 案例） |
| `HttpStatus.PRECONDITION_REQUIRED` 是 428；`MockMvcResultMatchers.status().isPreconditionRequired()` 存在 | 428 | 預演：`BW1c_patchWithoutVersionIsPreconditionRequired` |
| `String.codePointCount` 把一個 emoji（兩個 UTF-16 單位）算成 1 | 長度規則 | 預演：`B06_lengthLimitsCountCodePoints` |
| Hamcrest `hasKey` 對 JSON 物件有效，可以區分「鍵存在且值為 null」與「沒有這個鍵」 | G-07、B-13 測試 | 預演：`G07_*`、`B13_*` |

---

## 3. 檔案清單

路徑相對於 `apps/cms-scaffold/services/cms-api/`，另有註明者除外。**實作者不得碰清單以外的檔案。**

| 路徑 | 動作 | 用途 | 任務卡 |
| --- | --- | --- | --- |
| `src/main/java/com/fallrising/cms/api/error/FieldError.java` | 新增 | 一個欄位錯誤 | T02 |
| `src/main/java/com/fallrising/cms/api/error/FieldErrorCode.java` | 新增 | 欄位錯誤代碼 | T02 |
| `src/main/java/com/fallrising/cms/content/validation/PayloadValidator.java` | 新增 | payload 驗證規則 | T02 |
| `src/main/java/com/fallrising/cms/api/error/ErrorCode.java` | 修改 | `VERSION_REQUIRED`（428） | T04 |
| `src/main/java/com/fallrising/cms/api/error/CmsApiException.java` | 修改 | 可攜帶欄位錯誤 | T04 |
| `src/main/java/com/fallrising/cms/api/error/ErrorBody.java` | 修改 | 輸出 `error.fields` | T04 |
| `src/main/java/com/fallrising/cms/content/ContentException.java` | 修改 | `fieldErrors`、`versionRequired` | T04 |
| `src/main/java/com/fallrising/cms/content/service/EntryService.java` | 修改 | 改用 `PayloadValidator`；PATCH 必帶 `version` | T04 |
| `src/main/java/com/fallrising/cms/content/web/ContentProjection.java` | 修改 | 媒體展開失敗時為 null | T04 |
| `src/main/java/com/fallrising/cms/content/web/PublicContentController.java` | 修改 | `expandMedia` 失敗時回 null | T04 |
| `src/main/resources/openapi/openapi.yaml` | 修改（整檔取代） | 等於 `docs/v2/contracts/BW1c.openapi.yaml` | T04 |
| `src/test/java/com/fallrising/cms/content/validation/PayloadValidatorTests.java` | 新增 | 驗證規則（單元） | T01 |
| `src/test/java/com/fallrising/cms/EntryWriteRulesApiTests.java` | 新增 | 三項破壞性變更與 G-07（MockMvc） | T03 |
| `src/test/java/com/fallrising/cms/ContentApiTests.java` | 修改 | PATCH 加 `version` | T04 |
| `src/test/java/com/fallrising/cms/DemoPackTests.java` | 修改 | PATCH 加 `version` | T04 |
| `src/test/java/com/fallrising/cms/WaveEAcceptanceTests.java` | 修改 | PATCH 加 `version` | T04 |
| `apps/cms-scaffold/docs/v2/README.md` | 修改 | 路線圖 BW1c 狀態改 `VERIFIED` | T05 |

不會碰：`build.gradle.kts`、`gradle.lockfile`、migration、store、`MediaService.java`、`ApiExceptionHandler.java`、上表以外的測試、前端、`e2e/`、workflow。

---

## 4. 契約

### 4.1 OpenAPI

完整契約是 [`docs/v2/contracts/BW1c.openapi.yaml`](../contracts/BW1c.openapi.yaml)，`info.version` 0.7.0。T04 整檔取代 `openapi.yaml`。撰寫規則沿用 [BW0 §4.1](BW0.md#41-openapi) 的 R1～R10。相對於 BW1b 契約的變更：

| schema／operation | 變更 |
| --- | --- |
| `ErrorCode` | 新增 `VERSION_REQUIRED` |
| `ErrorEnvelope.error` | 新增選填 `fields`（`FieldError[]`，至少 1 個） |
| `FieldError`（新） | `field`、`code`、`message`，全部必填 |
| `FieldErrorCode`（新） | 10 個值（§4.3） |
| `EntryPatchRequest`（新） | `slug`、`payload`、`version`（必填）；`patchEntry` 改用它 |
| `EntryWriteRequest` | `version` 描述改為「create 時忽略」（create 仍用它） |
| 回應 `Error428`（新） | `patchEntry` 加上 `428` |
| `patchEntry` | 描述：`null` 清空、`version` 必填、錯誤依序 |
| `createEntry`、`publishEntry` | 422 描述：`error.fields`、`error.code` 的決定方式 |
| `PublicEntry` | 描述：無法公開的 `media-ref` 為 null |

Operation 摘要：

| 方法與路徑 | surface | action | 本波次新增的錯誤 |
| --- | --- | --- | --- |
| `POST /api/v1/content-types/{typeKey}/entries` | Back、Admin | `create` | 422 帶 `error.fields` |
| `PATCH /api/v1/entries/{id}` | Back、Admin | `update` | 428 `VERSION_REQUIRED`；422 帶 `error.fields` |
| `POST /api/v1/entries/{id}/publish` | Back、Admin | `publish` | 422 帶 `error.fields`（含 `REQUIRED`） |
| `GET /api/v1/public/content-types/{typeKey}/entries[/{id}]`、`…/slugs/{slug}` | 全部 | `read_published` | 沒有新錯誤；無法公開的 `media-ref` 是 null（§4.2） |

`ErrorCode` 全清單（BW0 的 36 個加 `VERSION_REQUIRED`，共 37 個）以契約的 `components.schemas.ErrorCode` 為準，`ErrorCodeContractTests`（BW0）檢查 Java enum 與它一致。

### 4.2 三項破壞性變更：前後對照

| # | 變更 | 以前（BW1b） | 以後（BW1c） | 測試 |
| --- | --- | --- | --- | --- |
| 1 | PATCH 必帶 `version` | 沒帶或 `null` 時不檢查，直接覆蓋 | 沒帶或 `null`：428 `VERSION_REQUIRED`（在權限檢查之後、版本比對之前）；不相等仍是 409 `VERSION_CONFLICT` | `EntryWriteRulesApiTests.BW1c_patchWithoutVersionIsPreconditionRequired` |
| 2 | 公開投影的 `media-ref` | 無法公開時回原始值（例如 UUID 字串） | 無法公開時回 `null`（鍵仍在）；可以公開時仍是 MediaAsset 物件；原本就是 null 時仍是 null | `EntryWriteRulesApiTests.B13_unreadableMediaIsNullAndReadableMediaIsExpanded` |
| 3 | 422 回傳全部欄位錯誤 | 遇到第一個錯誤就回；沒有 `error.fields`；`message` 是那個錯誤的說明 | `error.fields` 列出全部；`message` 是摘要 `"<N> invalid field(s); first: <第一個的 message>"`；`error.code` 見 §4.3 最後一段 | `EntryWriteRulesApiTests.B06_createReturnsEveryFieldErrorAtOnce`、`B06_firstReferenceErrorKeepsItsV1Code`、`B06_publishListsEveryMissingRequiredField` |

伴隨 #3 的規則收緊（B-06 要求；不另算破壞性變更，因為都是「以前錯誤地接受」的輸入）：

| 值 | 以前 | 以後 |
| --- | --- | --- |
| `string` 超過 1,000 字元；`markdown` 超過 100,000 字元 | 接受 | 422 `TOO_LONG` |
| `string`／`markdown` 不是 JSON 字串（例如數字） | 接受 | 422 `WRONG_TYPE` |
| `datetime` 不是 ISO-8601 含時區（例如 `2026-01-01`、`tomorrow`） | 接受 | 422 `INVALID_DATETIME` |
| `int` 是小數（`1.5`） | 接受（`Number`） | 422 `WRONG_TYPE` |
| `enum` 不是字串（例如數字 `1` 而 enum 值有 `"1"`） | 以 `String.valueOf` 比對，文字相等就接受 | 422 `WRONG_TYPE` |
| `ref`、`principal-ref` 是大寫 UUID | 接受 | 422 `INVALID_UUID`（BW1b 的公開列表只認得小寫，§4.3） |
| 已存的舊值不符合新規則 | — | 讀取不受影響；發布時的驗證會回 422，要先改正 |

G-07（不是破壞性變更，只是寫進契約並加測試）：PATCH 的 payload 某鍵是 `null` 時，該鍵以 JSON null 存入，不驗證；之後發布時若是必填欄位，回 422 `REQUIRED`。已發布副本與公開投影裡，該鍵存在且值為 `null`。測試：`EntryWriteRulesApiTests.G07_nullClearsAFieldWithoutValidationAndPublishStillChecksRequired`。

### 4.3 驗證規則與 `error.fields`

**路徑格式：** `field` 一律是 `payload.<欄位 key>`，例如 `payload.title`；保留字鍵也是 `payload.<鍵>`（例如 `payload.version`）。沒有巢狀路徑（v2 的欄位型別都是單一值）。

**順序：** 先依 payload 的鍵順序（JSON 物件的順序）列出保留字鍵，再依 `fieldsOf` 的順序（`sortOrder`，再依 key）列出欄位；每個鍵最多一個錯誤（第一個不符合的規則）。這個順序讓 `fields[0]` 等於 v1 會回的那一個錯誤。

**空值：** `null` 或空白字串。空值只檢查「發布時必填」（`REQUIRED`），其他規則都跳過；所以 PATCH 送 `null` 永遠可以（G-07）。

**保留字鍵**（`RESERVED_KEY`）：`id`、`slug`、`contentType`、`publicationState`、`version`、`createdAt`、`updatedAt`、`publishedAt`、`deletedAt`、`createdBy`、`updatedBy`、`payload`（與 v1 相同）。

**每種欄位型別的規則（非空值）：**

| 欄位型別 | 合法 | 不合法 → `code`（`message`） |
| --- | --- | --- |
| `string` | JSON 字串，最多 1,000 個 code point | 不是字串 → `WRONG_TYPE`（`<key> must be a string`）；太長 → `TOO_LONG`（`<key> must be at most 1000 characters`） |
| `markdown` | JSON 字串，最多 100,000 個 code point | 同上（上限 100000） |
| `int` | JSON 整數，在 long 範圍內 | 其他 → `WRONG_TYPE`（`<key> must be an integer`） |
| `boolean` | JSON 布林 | 其他 → `WRONG_TYPE`（`<key> must be boolean`） |
| `datetime` | JSON 字串，`Instant.parse` 或 `OffsetDateTime.parse` 可解析（與 BW1b 索引相同的 `EntryIndexer.parseInstant`） | 不是字串 → `WRONG_TYPE`；無法解析 → `INVALID_DATETIME`（`<key> must be an ISO-8601 date-time with offset`） |
| `enum` | JSON 字串，且在 `enumValues` 內（`enumValues` 空時任何字串） | 不是字串 → `WRONG_TYPE`；不在清單 → `NOT_IN_ENUM`（`<key> is not a valid enum value`） |
| `ref` | 小寫標準格式的 UUID 字串；該 entry 存在（軟刪除也算）；欄位有 `refTargetTypeKey` 時類型相同 | 不是這種字串 → `INVALID_UUID`（`<key> must be a UUID`）；不存在 → `REF_TARGET_NOT_FOUND`（`Referenced entry not found`）；類型不同 → `REF_TARGET_WRONG_TYPE`（`Referenced entry is the wrong type`） |
| `principal-ref` | 小寫標準格式的 UUID 字串；principal 存在 | 不是這種字串 → `INVALID_UUID`；不存在 → `PRINCIPAL_REF_UNRESOLVED`（`Principal not found`） |
| `media-ref` | `MediaService.parseMediaId` 可解析（UUID 字串，或 `{"mediaId": "<uuid>"}`）；不檢查媒體是否存在（與 v1 相同） | 其他 → `INVALID_UUID`（`<key> must be a media UUID`） |
| 其他型別（例如 `date`，或管理端建立的未知型別） | 不檢查 | — |
| 任何型別，發布時必填而值為空 | — | `REQUIRED`（`Missing required field <key>`） |

- 1,000 與 100,000 是本波次定的上限（02 沒有數字）：1,000 足夠標題、名稱、地址；100,000 足夠一篇長文。種子資料都在上限內（預演：`DemoPackTests` 全綠）。
- 不在類型欄位中的 payload 鍵（非保留字）不檢查，與 v1 相同。
- 停用的欄位也照規則檢查，與 v1 相同。

**`error.code`（頂層）：** `fields[0].code` 是 `REF_TARGET_NOT_FOUND`、`REF_TARGET_WRONG_TYPE`、`PRINCIPAL_REF_UNRESOLVED` 時用同名的 `ErrorCode`，否則 `FIELD_VALIDATION`。因為順序與 v1 相同，頂層代碼與 v1 對同一個輸入回的代碼相同，只有 HTTP 422 的內容多了 `fields`。HTTP 狀態一律 422。

### 4.4 範例

失敗：`POST /api/v1/content-types/album/entries`（`seed-operator-album`，Back），payload `{"slug":"inside-payload","title":"<1001 個 t>","cover":"not-a-uuid","visibility":"secret","sortMode":5}`，`422`：

```json
{
  "error": {
    "code": "FIELD_VALIDATION",
    "message": "5 invalid field(s); first: Reserved field: slug",
    "fields": [
      { "field": "payload.slug", "code": "RESERVED_KEY", "message": "Reserved field: slug" },
      { "field": "payload.title", "code": "TOO_LONG", "message": "title must be at most 1000 characters" },
      { "field": "payload.cover", "code": "INVALID_UUID", "message": "cover must be a media UUID" },
      { "field": "payload.visibility", "code": "NOT_IN_ENUM", "message": "visibility is not a valid enum value" },
      { "field": "payload.sortMode", "code": "WRONG_TYPE", "message": "sortMode must be a string" }
    ]
  },
  "requestId": "…"
}
```

失敗：`PATCH /api/v1/entries/{id}`，body `{"payload":{"title":"x"}}`，`428`：

```json
{ "error": { "code": "VERSION_REQUIRED", "message": "PATCH requires the entry version" }, "requestId": "…" }
```

成功：`PATCH /api/v1/entries/{id}`，body `{"version":1,"payload":{"description":null}}`，`200`，節錄：

```json
{ "id": "…", "version": 2, "payload": { "title": "Clear me", "description": null, "visibility": "public" } }
```

成功：公開讀一本 `cover` 指向不存在媒體的已發布相簿，節錄：

```json
{ "slug": "…", "title": "Hidden cover", "payload": { "title": "Hidden cover", "cover": null, "visibility": "public" } }
```

### 4.5 資料表

沒有 migration。

### 4.6 型別

`FieldError`、`FieldErrorCode` 見 §5.1；`CmsApiException.fields()` 見 §5.2。

---

## 5. 模組規格

### 5.1 `PayloadValidator`（T02）

套件 `com.fallrising.cms.content.validation`。建構子收 `ContentStore`（查 ref 目標）與 `IdentityStore`（查 principal）；`EntryService` 在自己的建構子裡建立它（不是 Spring bean）。`validate(fields, payload, publish)` 回傳錯誤清單（空清單＝合法），不丟例外；`topLevelCode(errors)` 是 §4.3 最後一段。每個 `ref` 值讀一次 `findEntry`、每個 `principal-ref` 值讀一次 `findPrincipalById`（與 v1 相同）。

`src/main/java/com/fallrising/cms/api/error/FieldError.java`：

```java
package com.fallrising.cms.api.error;

/**
 * One invalid input field (02 BD-08). field is a path: "payload.&lt;fieldKey&gt;" for an entry payload key.
 * message is an English developer message, not for display; clients show text chosen by code.
 */
public record FieldError(String field, FieldErrorCode code, String message) {}
```

`src/main/java/com/fallrising/cms/api/error/FieldErrorCode.java`：

```java
package com.fallrising.cms.api.error;

/** error.fields[].code. The wire value must match components.schemas.FieldErrorCode in openapi.yaml. */
public enum FieldErrorCode {
    REQUIRED,
    RESERVED_KEY,
    WRONG_TYPE,
    TOO_LONG,
    INVALID_DATETIME,
    NOT_IN_ENUM,
    INVALID_UUID,
    REF_TARGET_NOT_FOUND,
    REF_TARGET_WRONG_TYPE,
    PRINCIPAL_REF_UNRESOLVED;

    public String wire() {
        return name();
    }
}
```

`src/main/java/com/fallrising/cms/content/validation/PayloadValidator.java`：

```java
package com.fallrising.cms.content.validation;

import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.api.error.FieldError;
import com.fallrising.cms.api.error.FieldErrorCode;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.index.EntryIndexer;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.media.service.MediaService;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Validates an entry payload and returns every problem at once (02 B-06, BD-08). Order: reserved keys in payload key
 * order, then fields in fieldsOf order (sortOrder, then key); at most one error per key. A null or blank-string value
 * is "empty": it is only checked for REQUIRED when publish is true, and an empty value clears the field (G-07).
 *
 * <p>Rules for a non-empty value, by field type:
 * string: a JSON string of at most 1,000 code points; markdown: a JSON string of at most 100,000 code points;
 * int: a JSON integer within the long range; boolean: a JSON boolean; datetime: a JSON string that is an ISO-8601
 * instant or offset date-time (EntryIndexer.parseInstant); enum: a JSON string listed in enumValues (any string when
 * enumValues is empty); ref: a lowercase UUID string of an existing entry (deleted entries count) of refTargetTypeKey when set;
 * principal-ref: a lowercase UUID string of an existing principal; media-ref: a UUID string or an object with a UUID mediaId.
 * Other field types are not checked.
 */
public final class PayloadValidator {

    public static final int STRING_MAX = 1_000;
    public static final int MARKDOWN_MAX = 100_000;
    public static final Set<String> RESERVED = Set.of(
            "id", "slug", "contentType", "publicationState", "version", "createdAt", "updatedAt", "publishedAt",
            "deletedAt", "createdBy", "updatedBy", "payload");

    private static final BigInteger LONG_MIN = BigInteger.valueOf(Long.MIN_VALUE);
    private static final BigInteger LONG_MAX = BigInteger.valueOf(Long.MAX_VALUE);

    private final ContentStore content;
    private final IdentityStore identity;

    public PayloadValidator(ContentStore content, IdentityStore identity) {
        this.content = content;
        this.identity = identity;
    }

    public List<FieldError> validate(List<FieldRecord> fields, Map<String, Object> payload, boolean publish) {
        List<FieldError> errors = new ArrayList<>();
        for (String key : payload.keySet()) {
            if (RESERVED.contains(key)) {
                errors.add(error(key, FieldErrorCode.RESERVED_KEY, "Reserved field: " + key));
            }
        }
        for (FieldRecord field : fields) {
            Object value = payload.get(field.fieldKey());
            if (isEmpty(value)) {
                if (publish && field.required()) {
                    errors.add(error(field.fieldKey(), FieldErrorCode.REQUIRED, "Missing required field " + field.fieldKey()));
                }
                continue;
            }
            FieldError error = check(field, value);
            if (error != null) errors.add(error);
        }
        return errors;
    }

    /**
     * error.code for a list of field errors: the code of the first error when it is REF_TARGET_NOT_FOUND,
     * REF_TARGET_WRONG_TYPE or PRINCIPAL_REF_UNRESOLVED (the codes v1 returned for that first error), otherwise
     * FIELD_VALIDATION.
     */
    public static ErrorCode topLevelCode(List<FieldError> errors) {
        return switch (errors.getFirst().code()) {
            case REF_TARGET_NOT_FOUND -> ErrorCode.REF_TARGET_NOT_FOUND;
            case REF_TARGET_WRONG_TYPE -> ErrorCode.REF_TARGET_WRONG_TYPE;
            case PRINCIPAL_REF_UNRESOLVED -> ErrorCode.PRINCIPAL_REF_UNRESOLVED;
            default -> ErrorCode.FIELD_VALIDATION;
        };
    }

    private FieldError check(FieldRecord field, Object value) {
        String key = field.fieldKey();
        return switch (field.fieldType()) {
            case "string" -> text(key, value, STRING_MAX);
            case "markdown" -> text(key, value, MARKDOWN_MAX);
            case "int" -> isLongInteger(value) ? null : error(key, FieldErrorCode.WRONG_TYPE, key + " must be an integer");
            case "boolean" -> value instanceof Boolean ? null : error(key, FieldErrorCode.WRONG_TYPE, key + " must be boolean");
            case "datetime" -> {
                if (!(value instanceof String text)) yield error(key, FieldErrorCode.WRONG_TYPE, key + " must be a string");
                yield EntryIndexer.parseInstant(text) != null ? null
                        : error(key, FieldErrorCode.INVALID_DATETIME, key + " must be an ISO-8601 date-time with offset");
            }
            case "enum" -> {
                if (!(value instanceof String text)) yield error(key, FieldErrorCode.WRONG_TYPE, key + " must be a string");
                yield field.enumValues() == null || field.enumValues().isEmpty() || field.enumValues().contains(text) ? null
                        : error(key, FieldErrorCode.NOT_IN_ENUM, key + " is not a valid enum value");
            }
            case "ref" -> {
                UUID id = uuid(value);
                if (id == null) yield error(key, FieldErrorCode.INVALID_UUID, key + " must be a UUID");
                EntryRecord target = content.findEntry(id).orElse(null);
                if (target == null) yield error(key, FieldErrorCode.REF_TARGET_NOT_FOUND, "Referenced entry not found");
                yield field.refTargetTypeKey() == null || field.refTargetTypeKey().equals(target.contentTypeKey()) ? null
                        : error(key, FieldErrorCode.REF_TARGET_WRONG_TYPE, "Referenced entry is the wrong type");
            }
            case "principal-ref" -> {
                UUID id = uuid(value);
                if (id == null) yield error(key, FieldErrorCode.INVALID_UUID, key + " must be a UUID");
                yield identity.findPrincipalById(id).isPresent() ? null
                        : error(key, FieldErrorCode.PRINCIPAL_REF_UNRESOLVED, "Principal not found");
            }
            case "media-ref" -> MediaService.parseMediaId(value) != null ? null
                    : error(key, FieldErrorCode.INVALID_UUID, key + " must be a media UUID");
            default -> null;
        };
    }

    private static FieldError text(String key, Object value, int max) {
        if (!(value instanceof String text)) return error(key, FieldErrorCode.WRONG_TYPE, key + " must be a string");
        return text.codePointCount(0, text.length()) <= max ? null
                : error(key, FieldErrorCode.TOO_LONG, key + " must be at most " + max + " characters");
    }

    private static boolean isLongInteger(Object value) {
        if (value instanceof Integer || value instanceof Long || value instanceof Short || value instanceof Byte) return true;
        return value instanceof BigInteger big && big.compareTo(LONG_MIN) >= 0 && big.compareTo(LONG_MAX) <= 0;
    }

    /**
     * The UUID of a string in lowercase canonical 8-4-4-4-12 form, otherwise null. Lowercase only, because public
     * lists compare the stored text with that form (waves/BW1b.md §5.2, condition 5).
     */
    private static UUID uuid(Object value) {
        if (!(value instanceof String text)) return null;
        try {
            UUID id = UUID.fromString(text);
            return id.toString().equals(text) ? id : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static FieldError error(String key, FieldErrorCode code, String message) {
        return new FieldError("payload." + key, code, message);
    }

    private static boolean isEmpty(Object value) {
        return value == null || (value instanceof String s && s.isBlank());
    }
}
```

### 5.2 錯誤信封、`EntryService`、公開投影（T04）

- `CmsApiException` 多一個建構子與 `fields()`；原本的建構子等於「沒有欄位錯誤」，所以 identity、media 的例外不用改。
- `ErrorBody.of(...)` 在 `fields` 非空時加上 `error.fields`；鍵順序 `field`、`code`、`message`。`ApiExceptionHandler` 不用改（它呼叫 `ErrorBody.of(ex, requestId)`）。
- `ContentException.fieldErrors(errors)`：代碼與訊息見 §4.3；`versionRequired()`：428。
- `EntryService`：刪除私有的 `RESERVED` 與舊的逐項驗證；`validatePayload` 改成呼叫 `PayloadValidator`，有錯誤就丟 `fieldErrors`。呼叫點不變：`create`（`publish=false`）、`patch`（合併後的 payload，`publish=false`）、`publish`（工作副本，`publish=true`，在 `SLUG_REQUIRED` 檢查之後）。`patch` 在權限檢查之後、版本比對之前檢查 `version == null`。
- 公開投影：`PublicContentController.expandMedia` 在 `resolvePublic` 為空時回 `null`；`ContentProjection.published` 對 `media-ref` 一律放入展開結果（原值是 null 時放 null，不呼叫展開）。

`src/main/java/com/fallrising/cms/api/error/ErrorCode.java`：

```diff
--- a/src/main/java/com/fallrising/cms/api/error/ErrorCode.java
+++ b/src/main/java/com/fallrising/cms/api/error/ErrorCode.java
@@ -24,6 +24,7 @@
     INVALID_STATE_TRANSITION("INVALID_STATE_TRANSITION", HttpStatus.CONFLICT),
     SLUG_CONFLICT("SLUG_CONFLICT", HttpStatus.CONFLICT),
     VERSION_CONFLICT("VERSION_CONFLICT", HttpStatus.CONFLICT),
+    VERSION_REQUIRED("VERSION_REQUIRED", HttpStatus.PRECONDITION_REQUIRED),
     TYPE_DISABLED("TYPE_DISABLED", HttpStatus.CONFLICT),
     TYPE_IN_USE("TYPE_IN_USE", HttpStatus.CONFLICT),
     REF_CONSTRAINT("REF_CONSTRAINT", HttpStatus.CONFLICT),
```

`src/main/java/com/fallrising/cms/api/error/CmsApiException.java`：

```diff
--- a/src/main/java/com/fallrising/cms/api/error/CmsApiException.java
+++ b/src/main/java/com/fallrising/cms/api/error/CmsApiException.java
@@ -2,6 +2,8 @@
 
 import org.springframework.http.HttpStatus;
 
+import java.util.List;
+
 /** Base class of every exception that is rendered as an ErrorEnvelope with a known ErrorCode. */
 public abstract class CmsApiException extends RuntimeException {
 
@@ -9,13 +11,20 @@
     private final String action;
     private final String contentType;
     private final String surface;
+    private final List<FieldError> fields;
 
     protected CmsApiException(ErrorCode code, String message, String action, String contentType, String surface) {
+        this(code, message, action, contentType, surface, List.of());
+    }
+
+    protected CmsApiException(ErrorCode code, String message, String action, String contentType, String surface,
+            List<FieldError> fields) {
         super(message);
         this.code = code;
         this.action = action;
         this.contentType = contentType;
         this.surface = surface;
+        this.fields = List.copyOf(fields);
     }
 
     public ErrorCode code() {
@@ -37,4 +46,9 @@
     public String surface() {
         return surface;
     }
+
+    /** Field errors rendered as error.fields; empty for errors that are not about input fields. */
+    public List<FieldError> fields() {
+        return fields;
+    }
 }
```

`src/main/java/com/fallrising/cms/api/error/ErrorBody.java`：

```diff
--- a/src/main/java/com/fallrising/cms/api/error/ErrorBody.java
+++ b/src/main/java/com/fallrising/cms/api/error/ErrorBody.java
@@ -1,15 +1,21 @@
 package com.fallrising.cms.api.error;
 
 import java.util.LinkedHashMap;
+import java.util.List;
 import java.util.Map;
 
-/** Builds the ErrorEnvelope JSON body: { "error": { code, message, action?, contentType?, surface? }, "requestId" }. */
+/** Builds the ErrorEnvelope JSON body: { "error": { code, message, action?, contentType?, surface?, fields? }, "requestId" }. */
 public final class ErrorBody {
 
     private ErrorBody() {}
 
     public static Map<String, Object> of(ErrorCode code, String message, String action, String contentType,
             String surface, String requestId) {
+        return of(code, message, action, contentType, surface, List.of(), requestId);
+    }
+
+    public static Map<String, Object> of(ErrorCode code, String message, String action, String contentType,
+            String surface, List<FieldError> fields, String requestId) {
         Map<String, Object> error = new LinkedHashMap<>();
         error.put("code", code.wire());
         error.put("message", message == null ? "" : message);
@@ -22,6 +28,15 @@
         if (surface != null) {
             error.put("surface", surface);
         }
+        if (!fields.isEmpty()) {
+            error.put("fields", fields.stream().map(f -> {
+                Map<String, Object> item = new LinkedHashMap<>();
+                item.put("field", f.field());
+                item.put("code", f.code().wire());
+                item.put("message", f.message());
+                return item;
+            }).toList());
+        }
         Map<String, Object> body = new LinkedHashMap<>();
         body.put("error", error);
         body.put("requestId", requestId == null ? "" : requestId);
@@ -29,6 +44,6 @@
     }
 
     public static Map<String, Object> of(CmsApiException ex, String requestId) {
-        return of(ex.code(), ex.getMessage(), ex.action(), ex.contentType(), ex.surface(), requestId);
+        return of(ex.code(), ex.getMessage(), ex.action(), ex.contentType(), ex.surface(), ex.fields(), requestId);
     }
 }
```

`src/main/java/com/fallrising/cms/content/ContentException.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/ContentException.java
+++ b/src/main/java/com/fallrising/cms/content/ContentException.java
@@ -2,6 +2,10 @@
 
 import com.fallrising.cms.api.error.CmsApiException;
 import com.fallrising.cms.api.error.ErrorCode;
+import com.fallrising.cms.api.error.FieldError;
+import com.fallrising.cms.content.validation.PayloadValidator;
+
+import java.util.List;
 
 public class ContentException extends CmsApiException {
 
@@ -9,6 +13,10 @@
         super(code, message, null, null, null);
     }
 
+    private ContentException(ErrorCode code, String message, List<FieldError> fields) {
+        super(code, message, null, null, null, fields);
+    }
+
     public static ContentException notFound() {
         return new ContentException(ErrorCode.ENTRY_NOT_FOUND, "Entry not found");
     }
@@ -38,6 +46,16 @@
         return new ContentException(ErrorCode.VERSION_CONFLICT, "Entry version does not match");
     }
 
+    public static ContentException versionRequired() {
+        return new ContentException(ErrorCode.VERSION_REQUIRED, "PATCH requires the entry version");
+    }
+
+    /** 422 with every field error (BD-08); code from PayloadValidator.topLevelCode, message is a summary. */
+    public static ContentException fieldErrors(List<FieldError> errors) {
+        return new ContentException(PayloadValidator.topLevelCode(errors),
+                errors.size() + " invalid field(s); first: " + errors.getFirst().message(), errors);
+    }
+
     public static ContentException validation(ErrorCode code, String message) {
         return new ContentException(code, message);
     }
```

`src/main/java/com/fallrising/cms/content/service/EntryService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/service/EntryService.java
+++ b/src/main/java/com/fallrising/cms/content/service/EntryService.java
@@ -1,6 +1,7 @@
 package com.fallrising.cms.content.service;
 
 import com.fallrising.cms.api.error.ErrorCode;
+import com.fallrising.cms.api.error.FieldError;
 import com.fallrising.cms.content.ContentException;
 import com.fallrising.cms.content.PublicVisibility;
 import com.fallrising.cms.content.domain.ContentTypeRecord;
@@ -15,6 +16,7 @@
 import com.fallrising.cms.content.query.EntryQuery;
 import com.fallrising.cms.content.query.ListQueryParser;
 import com.fallrising.cms.content.store.ContentStore;
+import com.fallrising.cms.content.validation.PayloadValidator;
 import com.fallrising.cms.identity.IdentityException;
 import com.fallrising.cms.identity.domain.AuditEvent;
 import com.fallrising.cms.identity.domain.CmsAction;
@@ -32,31 +34,18 @@
 import java.util.LinkedHashMap;
 import java.util.List;
 import java.util.Map;
-import java.util.Set;
 import java.util.UUID;
 
 @Service
 public class EntryService {
 
-    private static final Set<String> RESERVED = Set.of(
-            "id",
-            "slug",
-            "contentType",
-            "publicationState",
-            "version",
-            "createdAt",
-            "updatedAt",
-            "publishedAt",
-            "deletedAt",
-            "createdBy",
-            "updatedBy",
-            "payload");
     private static final int REVISION_KEEP = 20;
 
     private final ContentStore store;
     private final AuthorizationService authorization;
     private final IdentityStore identityStore;
     private final MediaService mediaService;
+    private final PayloadValidator validator;
 
     public EntryService(
             ContentStore store,
@@ -67,6 +56,7 @@
         this.authorization = authorization;
         this.identityStore = identityStore;
         this.mediaService = mediaService;
+        this.validator = new PayloadValidator(store, identityStore);
     }
 
     public ContentTypeRecord requireType(String typeKey) {
@@ -155,7 +145,10 @@
             throw ContentException.invalidTransition();
         }
         authorization.require(principal, CmsAction.UPDATE, current.contentTypeKey(), current.payload(), surface);
-        if (version != null && version != current.version()) {
+        if (version == null) {
+            throw ContentException.versionRequired();
+        }
+        if (version != current.version()) {
             throw ContentException.versionConflict();
         }
         ContentTypeRecord type = store.findTypeByKey(current.contentTypeKey()).orElseThrow(ContentException::typeNotFound);
@@ -491,62 +484,11 @@
         });
     }
 
+    /** Throws 422 with every field error (PayloadValidator) when the payload is invalid. */
     private void validatePayload(ContentTypeRecord type, Map<String, Object> payload, boolean publish) {
-        List<FieldRecord> fields = store.fieldsOf(type.id());
-        for (String key : payload.keySet()) {
-            if (RESERVED.contains(key)) {
-                throw ContentException.validation(ErrorCode.FIELD_VALIDATION, "Reserved field: " + key);
-            }
-        }
-        for (FieldRecord field : fields) {
-            Object value = payload.get(field.fieldKey());
-            if (publish && field.required() && isBlank(value)) {
-                throw ContentException.validation(ErrorCode.FIELD_VALIDATION, "Missing required field " + field.fieldKey());
-            }
-            if (isBlank(value)) {
-                continue;
-            }
-            switch (field.fieldType()) {
-                case "int" -> {
-                    if (!(value instanceof Number)) {
-                        throw ContentException.validation(ErrorCode.FIELD_VALIDATION, field.fieldKey() + " must be a number");
-                    }
-                }
-                case "boolean" -> {
-                    if (!(value instanceof Boolean)) {
-                        throw ContentException.validation(ErrorCode.FIELD_VALIDATION, field.fieldKey() + " must be boolean");
-                    }
-                }
-                case "enum" -> {
-                    if (field.enumValues() != null
-                            && !field.enumValues().isEmpty()
-                            && !field.enumValues().contains(String.valueOf(value))) {
-                        throw ContentException.validation(ErrorCode.FIELD_VALIDATION, field.fieldKey() + " is not a valid enum value");
-                    }
-                }
-                case "ref" -> {
-                    UUID targetId = parseUuid(value, field.fieldKey());
-                    EntryRecord target = store.findEntry(targetId).orElseThrow(() ->
-                            ContentException.validation(ErrorCode.REF_TARGET_NOT_FOUND, "Referenced entry not found"));
-                    if (field.refTargetTypeKey() != null && !field.refTargetTypeKey().equals(target.contentTypeKey())) {
-                        throw ContentException.validation(ErrorCode.REF_TARGET_WRONG_TYPE, "Referenced entry is the wrong type");
-                    }
-                }
-                case "principal-ref" -> {
-                    UUID principalId = parseUuid(value, field.fieldKey());
-                    if (identityStore.findPrincipalById(principalId).isEmpty()) {
-                        throw ContentException.validation(ErrorCode.PRINCIPAL_REF_UNRESOLVED, "Principal not found");
-                    }
-                }
-                case "media-ref" -> {
-                    if (MediaService.parseMediaId(value) == null) {
-                        throw ContentException.validation(ErrorCode.FIELD_VALIDATION, field.fieldKey() + " must be a media UUID");
-                    }
-                }
-                default -> {
-                    // string, markdown, datetime, date: accept scalar
-                }
-            }
+        List<FieldError> errors = validator.validate(store.fieldsOf(type.id()), payload, publish);
+        if (!errors.isEmpty()) {
+            throw ContentException.fieldErrors(errors);
         }
     }
 
```

`src/main/java/com/fallrising/cms/content/web/ContentProjection.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/ContentProjection.java
+++ b/src/main/java/com/fallrising/cms/content/web/ContentProjection.java
@@ -40,8 +40,7 @@
             if (field.enabled() && "public".equals(field.visibility()) && source.containsKey(field.fieldKey())) {
                 Object value = source.get(field.fieldKey());
                 if ("media-ref".equals(field.fieldType()) && mediaExpander != null) {
-                    Object expanded = mediaExpander.apply(value);
-                    payload.put(field.fieldKey(), expanded == null ? value : expanded);
+                    payload.put(field.fieldKey(), value == null ? null : mediaExpander.apply(value));
                 } else {
                     payload.put(field.fieldKey(), value);
                 }
```

`src/main/java/com/fallrising/cms/content/web/PublicContentController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/PublicContentController.java
+++ b/src/main/java/com/fallrising/cms/content/web/PublicContentController.java
@@ -102,8 +102,9 @@
         return json;
     }
 
+    /** Public media JSON, or null when the reference is not publicly readable (B-13: never echo the raw id). */
     private Object expandMedia(Object raw) {
-        return media.resolvePublic(raw).map(Object.class::cast).orElse(raw);
+        return media.resolvePublic(raw).map(Object.class::cast).orElse(null);
     }
 
     private static void rejectAudienceParams(HttpServletRequest request) {
```

`openapi.yaml`：`cp docs/v2/contracts/BW1c.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`。

**既有測試要加 `version`**（PATCH 不帶 `version` 會變成 428）。每一處的版本號：新建立的 entry 是 1；`publish` 不改版本；每次成功的 PATCH 加 1。`DemoPackTests.tPj02UnknownIssueStatusIsUnprocessable` 改的是種子資料，版本號先用 `GET /entries/{id}` 讀出。`DemoPackTests` 中以 `seed-editor-projects` 發出、預期 403 的那一次也加上版本（2），讓它只測權限。`ErrorEnvelopeTests` 的兩個 PATCH（壞 JSON、錯的 Content-Type）在讀 body 之前就失敗，不用改。

`src/test/java/com/fallrising/cms/ContentApiTests.java`：

```diff
--- a/src/test/java/com/fallrising/cms/ContentApiTests.java
+++ b/src/test/java/com/fallrising/cms/ContentApiTests.java
@@ -77,7 +77,7 @@
                         .header("X-CSRF-Token", op.csrf)
                         .cookie(op.sessionCookie(), op.csrfCookie())
                         .content("""
-                                {"payload":{"title":"Dirty draft title"}}
+                                {"version":1,"payload":{"title":"Dirty draft title"}}
                                 """))
                 .andExpect(status().isOk())
                 .andExpect(jsonPath("$.payload.title").value("Dirty draft title"))
```

`src/test/java/com/fallrising/cms/DemoPackTests.java`：

```diff
--- a/src/test/java/com/fallrising/cms/DemoPackTests.java
+++ b/src/test/java/com/fallrising/cms/DemoPackTests.java
@@ -64,7 +64,7 @@
                         .header("X-CSRF-Token", op.csrf)
                         .cookie(op.sessionCookie(), op.csrfCookie())
                         .content("""
-                                {"payload":{"cover":"%s"}}
+                                {"version":1,"payload":{"cover":"%s"}}
                                 """.formatted(media[0])))
                 .andExpect(status().isOk());
         mockMvc.perform(get("/api/v1/preview/entries/" + albumId)
@@ -334,7 +334,7 @@
                         .header("X-CSRF-Token", op.csrf)
                         .cookie(op.sessionCookie(), op.csrfCookie())
                         .content("""
-                                {"payload":{"status":"in_progress"}}
+                                {"version":1,"payload":{"status":"in_progress"}}
                                 """))
                 .andExpect(status().isOk())
                 .andExpect(jsonPath("$.payload.status").value("in_progress"))
@@ -382,7 +382,7 @@
                         .header("X-CSRF-Token", editor.csrf)
                         .cookie(editor.sessionCookie(), editor.csrfCookie())
                         .content("""
-                                {"payload":{"status":"done"}}
+                                {"version":2,"payload":{"status":"done"}}
                                 """))
                 .andExpect(status().isForbidden());
     }
@@ -396,14 +396,18 @@
                 .andExpect(status().isOk())
                 .andReturn();
         String issueId = idFromTitle(issues.getResponse().getContentAsString(), "Kanban DnD");
+        String issue = mockMvc.perform(get("/api/v1/entries/" + issueId).header("Origin", BACK).cookie(op.sessionCookie()))
+                .andExpect(status().isOk())
+                .andReturn().getResponse().getContentAsString();
+        String version = issue.replaceAll("(?s).*\"version\":(\\d+).*", "$1");
         mockMvc.perform(patch("/api/v1/entries/" + issueId)
                         .contentType(MediaType.APPLICATION_JSON)
                         .header("Origin", BACK)
                         .header("X-CSRF-Token", op.csrf)
                         .cookie(op.sessionCookie(), op.csrfCookie())
                         .content("""
-                                {"payload":{"status":"epic"}}
-                                """))
+                                {"version":%s,"payload":{"status":"epic"}}
+                                """.formatted(version)))
                 .andExpect(status().isUnprocessableEntity())
                 .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"));
     }
```

`src/test/java/com/fallrising/cms/WaveEAcceptanceTests.java`：

```diff
--- a/src/test/java/com/fallrising/cms/WaveEAcceptanceTests.java
+++ b/src/test/java/com/fallrising/cms/WaveEAcceptanceTests.java
@@ -92,8 +92,8 @@
                             .header("X-CSRF-Token", op.csrf)
                             .cookie(op.sessionCookie(), op.csrfCookie())
                             .content("""
-                                    {"payload":{"title":"R%d"}}
-                                    """.formatted(i)))
+                                    {"version":%d,"payload":{"title":"R%d"}}
+                                    """.formatted(i + 1, i)))
                     .andExpect(status().isOk());
             mockMvc.perform(post("/api/v1/entries/" + id + "/publish")
                             .header("Origin", BACK)
```

---

## 6. 任務卡

大小：S ≤ 150 行、M ≤ 400 行（只算手寫或手改的行；整檔複製算 1 行）。所有指令在 `apps/cms-scaffold` 執行。預期紅燈是預演實測的結果；某個預期紅燈的測試若已經綠了，照樣繼續。

### BW1c-T01 【測試先行】驗證規則

- **目標**：把 §4.3 的規則寫成單元測試。
- **輸入**：BW1b `VERIFIED`。
- **步驟**：建立 §7.1 的 `src/test/java/com/fallrising/cms/content/validation/PayloadValidatorTests.java`。
- **完成條件**：預期紅燈：`src/test` 編譯失敗（`FieldError`、`FieldErrorCode`、`PayloadValidator` 不存在）。
- **驗證**：`./gradlew :services:cms-api:compileTestJava`（預期失敗）
- **對應 ID**：B-06
- **大小**：S

### BW1c-T02 `PayloadValidator`

- **目標**：§5.1。
- **輸入**：T01。
- **步驟**：建立 §5.1 的 `FieldError.java`、`FieldErrorCode.java`（套件 `com.fallrising.cms.api.error`）與 `PayloadValidator.java`（套件 `com.fallrising.cms.content.validation`）。本卡不接線。
- **完成條件**：`PayloadValidatorTests` 7 個綠；`./gradlew :services:cms-api:test` 187 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`
- **對應 ID**：B-06
- **大小**：S

### BW1c-T03 【測試先行】三項破壞性變更與清空欄位

- **目標**：把 §4.2 寫成 API 測試。
- **輸入**：T02。
- **步驟**：建立 §7.2 的 `src/test/java/com/fallrising/cms/EntryWriteRulesApiTests.java`。
- **完成條件**：本類別 7 個測試中，預期紅燈正好 6 個：`B06_createReturnsEveryFieldErrorAtOnce`、`B06_firstReferenceErrorKeepsItsV1Code`、`B06_publishListsEveryMissingRequiredField`、`BW1c_patchWithoutVersionIsPreconditionRequired`、`G07_nullClearsAFieldWithoutValidationAndPublishStillChecksRequired`（清空本身已經可以，紅在發布時沒有 `error.fields`）、`B13_unreadableMediaIsNullAndReadableMediaIsExpanded`。`BW1c_sessionSurfaceExistenceAndPermissionAreCheckedBeforeVersion` 已綠（回歸保護：T04 加上 428 之後，這些檢查仍要在它之前）。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.EntryWriteRulesApiTests'`
- **對應 ID**：B-06、B-13、G-07
- **大小**：S

### BW1c-T04 接線、契約與既有測試

- **目標**：§5.2，並換上 BW1c 契約。必須同一張卡：新的 422 有 `error.fields`、新的 428，都要契約允許，而全域回應驗證（BW0）會檢查每一個回應；PATCH 改成必帶 `version` 的同時，既有測試也要加上版本。
- **輸入**：T03。
- **步驟**：
  1. 套用 §5.2 的七段 diff（`ErrorCode`、`CmsApiException`、`ErrorBody`、`ContentException`、`EntryService`、`ContentProjection`、`PublicContentController`）。
  2. `cp docs/v2/contracts/BW1c.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`，並以 `cmp` 確認相同。
  3. 套用 §5.2 的三段測試 diff（`ContentApiTests`、`DemoPackTests`、`WaveEAcceptanceTests`）。
  4. 執行 `grep -rn "orElse(raw)" services/cms-api/src/main`，沒有輸出。
- **完成條件**：`EntryWriteRulesApiTests` 7 個綠；`./gradlew :services:cms-api:test` 194 個全綠；`./gradlew :services:cms-api:integrationTest` 67 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：B-06、B-13、G-07、BD-08
- **大小**：M

### BW1c-T05 完整閘門、狀態與 PR

- **目標**：交付。
- **輸入**：T04。
- **步驟**：
  1. 執行 §9 的完整閘門。
  2. `docs/v2/README.md` 路線圖中 BW1c 那一列的狀態從 `DOC_READY` 改成 `VERIFIED`。
  3. 逐項勾選 §9，貼進 PR 說明。PR 標題：`feat(cms-scaffold): BW1c 驗證與破壞性變更`；說明列出 B-06、B-13、G-07，以及 §4.2 的三項破壞性變更與規則收緊。
- **完成條件**：§9 全部打勾；CI 的 `java`、`java-integration` 全綠；`web` 全綠，或只有 §2.1 所說的 codegen 新鮮度／fixture 型別失敗並已在 PR 說明。
- **驗證**：§9 的指令。
- **對應 ID**：全部
- **大小**：S

---

## 7. 測試規格

層級：`PayloadValidatorTests` 是 `test` 的 JUnit（in-memory store，不啟動 Spring）；`EntryWriteRulesApiTests` 是 `@SpringBootTest` + MockMvc，回應經過 BW0 的全域 OpenAPI 驗證。帳號密碼一律用 `@Value("${cms.identity.seed-password}")`。

### 7.1 `PayloadValidatorTests`

前置資料：一組 11 個欄位（`title` 必填 string、`body` markdown、`count` int、`flag` boolean、`startsAt` datetime、`status` enum `open/closed`、`tag` enum 沒有值清單、`venue` ref 目標 `venue`、`host` principal-ref、`cover` media-ref、`legacy` date）；in-memory store 中一筆 `venue`、一筆 `page`；identity store 中一個 principal。

| 測試 | 斷言 |
| --- | --- |
| `B06_validPayloadHasNoErrors` | 11 個欄位都合法（含 `{"mediaId": …}`、`date` 欄位放數字、未知鍵放陣列），發布模式也沒有錯誤 |
| `B06_collectsEveryErrorInValidationOrderWithPaths` | 10 個錯誤：先是 payload 順序的 `payload.id`、`payload.version`（`RESERVED_KEY`），再依欄位順序 `title` `TOO_LONG`、`count` `WRONG_TYPE`、`flag` `WRONG_TYPE`、`startsAt` `INVALID_DATETIME`、`status` `NOT_IN_ENUM`、`venue` `INVALID_UUID`、`host` `PRINCIPAL_REF_UNRESOLVED`、`cover` `INVALID_UUID`；`message` 逐字比對 |
| `B06_lengthLimitsCountCodePoints` | 1,000 個 emoji 合法、1,001 個 `TOO_LONG`；`markdown` 100,000／100,001；數字與布林放在文字欄位 `WRONG_TYPE` |
| `B06_numbersBooleansDatetimesAndEnumsCheckJsonTypes` | `Long.MAX_VALUE` 與同值的 `BigInteger` 合法，大一的 `BigInteger` 不合法；字串 `"3"`、`"true"`；datetime 的 `Z`、只有日期、數字；enum 的數字與大小寫不同 |
| `B06_referencesMustResolve` | 存在的 ref 合法；大寫 UUID、數字 `INVALID_UUID`；別的類型 `REF_TARGET_WRONG_TYPE`；不存在 `REF_TARGET_NOT_FOUND`；principal 壞字串；`{"mediaId":"x"}` |
| `B06_emptyValuesAreOnlyCheckedForRequiredOnPublish` | 非發布模式下 null、空字串、空白都沒有錯誤；發布模式下只有缺少的必填 `title` 是 `REQUIRED`（空字串的 `count` 不是必填，沒有錯誤）；空白的 `title` 也是 `REQUIRED` |
| `B06_topLevelCodeFollowsTheFirstError` | §4.3 最後一段的四種情況 |

`src/test/java/com/fallrising/cms/content/validation/PayloadValidatorTests.java`：

```java
package com.fallrising.cms.content.validation;

import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.api.error.FieldError;
import com.fallrising.cms.api.error.FieldErrorCode;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.store.InMemoryContentStore;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigInteger;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PayloadValidatorTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    InMemoryContentStore content;
    InMemoryIdentityStore identity;
    PayloadValidator validator;
    List<FieldRecord> fields;
    EntryRecord venue;
    EntryRecord page;
    Principal host;

    @BeforeEach
    void setUp() {
        content = new InMemoryContentStore();
        identity = new InMemoryIdentityStore();
        validator = new PayloadValidator(content, identity);
        UUID type = UUID.randomUUID();
        fields = List.of(
                field(type, "title", "string", true, null, List.of(), 0),
                field(type, "body", "markdown", false, null, List.of(), 1),
                field(type, "count", "int", false, null, List.of(), 2),
                field(type, "flag", "boolean", false, null, List.of(), 3),
                field(type, "startsAt", "datetime", false, null, List.of(), 4),
                field(type, "status", "enum", false, null, List.of("open", "closed"), 5),
                field(type, "tag", "enum", false, null, List.of(), 6),
                field(type, "venue", "ref", false, "venue", List.of(), 7),
                field(type, "host", "principal-ref", false, null, List.of(), 8),
                field(type, "cover", "media-ref", false, null, List.of(), 9),
                field(type, "legacy", "date", false, null, List.of(), 10));
        venue = entry("venue");
        page = entry("page");
        host = identity.insertPrincipal(new Principal(UUID.randomUUID(), "host", "Host", null, PrincipalStatus.ACTIVE, 0,
                null, null, T0, T0, null));
    }

    static FieldRecord field(UUID type, String key, String fieldType, boolean required, String target, List<String> enums, int order) {
        return new FieldRecord(UUID.randomUUID(), type, key, fieldType, required, false, false, "public", order, target,
                "restrict", enums, true, false);
    }

    EntryRecord entry(String typeKey) {
        ContentTypeRecord type = new ContentTypeRecord(UUID.randomUUID(), typeKey, typeKey, typeKey, null, "title",
                "optional", false, true, true, List.of(), T0, T0);
        content.insertType(type);
        EntryRecord e = new EntryRecord(UUID.randomUUID(), type.id(), typeKey, typeKey, PublicationState.DRAFT, 1,
                Map.of(), null, null, null, null, null, null, T0, T0);
        content.insertEntry(e);
        return e;
    }

    static Map<String, Object> payload(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
        return map;
    }

    List<FieldErrorCode> codes(Map<String, Object> payload, boolean publish) {
        return validator.validate(fields, payload, publish).stream().map(FieldError::code).toList();
    }

    @Test
    void B06_validPayloadHasNoErrors() {
        assertThat(validator.validate(fields, payload(
                "title", "Night market", "body", "# Hi", "count", 3, "flag", false,
                "startsAt", "2026-03-01T18:00:00+08:00", "status", "open", "tag", "anything",
                "venue", venue.id().toString(), "host", host.id().toString(),
                "cover", Map.of("mediaId", UUID.randomUUID().toString()), "legacy", 20260101, "unknownKey", List.of(1)), true))
                .isEmpty();
    }

    @Test
    void B06_collectsEveryErrorInValidationOrderWithPaths() {
        Map<String, Object> bad = payload(
                "cover", "not-a-uuid", "id", "x", "title", "a".repeat(1_001), "count", 1.5, "flag", "yes",
                "startsAt", "tomorrow", "status", "maybe", "venue", "abc", "host", UUID.randomUUID().toString(),
                "version", 3);
        assertThat(validator.validate(fields, bad, false)).containsExactly(
                new FieldError("payload.id", FieldErrorCode.RESERVED_KEY, "Reserved field: id"),
                new FieldError("payload.version", FieldErrorCode.RESERVED_KEY, "Reserved field: version"),
                new FieldError("payload.title", FieldErrorCode.TOO_LONG, "title must be at most 1000 characters"),
                new FieldError("payload.count", FieldErrorCode.WRONG_TYPE, "count must be an integer"),
                new FieldError("payload.flag", FieldErrorCode.WRONG_TYPE, "flag must be boolean"),
                new FieldError("payload.startsAt", FieldErrorCode.INVALID_DATETIME, "startsAt must be an ISO-8601 date-time with offset"),
                new FieldError("payload.status", FieldErrorCode.NOT_IN_ENUM, "status is not a valid enum value"),
                new FieldError("payload.venue", FieldErrorCode.INVALID_UUID, "venue must be a UUID"),
                new FieldError("payload.host", FieldErrorCode.PRINCIPAL_REF_UNRESOLVED, "Principal not found"),
                new FieldError("payload.cover", FieldErrorCode.INVALID_UUID, "cover must be a media UUID"));
    }

    @Test
    void B06_lengthLimitsCountCodePoints() {
        String emoji = "😀";
        assertThat(codes(payload("title", emoji.repeat(1_000)), false)).isEmpty();
        assertThat(codes(payload("title", emoji.repeat(1_001)), false)).containsExactly(FieldErrorCode.TOO_LONG);
        assertThat(codes(payload("body", "b".repeat(100_000)), false)).isEmpty();
        assertThat(codes(payload("body", "b".repeat(100_001)), false)).containsExactly(FieldErrorCode.TOO_LONG);
        assertThat(codes(payload("title", 5, "body", true), false)).containsExactly(FieldErrorCode.WRONG_TYPE, FieldErrorCode.WRONG_TYPE);
    }

    @Test
    void B06_numbersBooleansDatetimesAndEnumsCheckJsonTypes() {
        assertThat(codes(payload("count", Long.MAX_VALUE), false)).isEmpty();
        assertThat(codes(payload("count", BigInteger.valueOf(Long.MAX_VALUE)), false)).isEmpty();
        assertThat(codes(payload("count", BigInteger.valueOf(Long.MAX_VALUE).add(BigInteger.ONE)), false))
                .containsExactly(FieldErrorCode.WRONG_TYPE);
        assertThat(codes(payload("count", "3"), false)).containsExactly(FieldErrorCode.WRONG_TYPE);
        assertThat(codes(payload("flag", "true"), false)).containsExactly(FieldErrorCode.WRONG_TYPE);
        assertThat(codes(payload("startsAt", "2026-01-01T00:00:00Z"), false)).isEmpty();
        assertThat(codes(payload("startsAt", "2026-01-01"), false)).containsExactly(FieldErrorCode.INVALID_DATETIME);
        assertThat(codes(payload("startsAt", 1_700_000_000), false)).containsExactly(FieldErrorCode.WRONG_TYPE);
        assertThat(codes(payload("status", 1), false)).containsExactly(FieldErrorCode.WRONG_TYPE);
        assertThat(codes(payload("status", "Open"), false)).containsExactly(FieldErrorCode.NOT_IN_ENUM);
    }

    @Test
    void B06_referencesMustResolve() {
        assertThat(codes(payload("venue", venue.id().toString()), false)).isEmpty();
        assertThat(codes(payload("venue", venue.id().toString().toUpperCase()), false)).containsExactly(FieldErrorCode.INVALID_UUID);
        assertThat(codes(payload("venue", page.id().toString()), false)).containsExactly(FieldErrorCode.REF_TARGET_WRONG_TYPE);
        assertThat(codes(payload("venue", UUID.randomUUID().toString()), false)).containsExactly(FieldErrorCode.REF_TARGET_NOT_FOUND);
        assertThat(codes(payload("venue", 7), false)).containsExactly(FieldErrorCode.INVALID_UUID);
        assertThat(codes(payload("host", "abc"), false)).containsExactly(FieldErrorCode.INVALID_UUID);
        assertThat(codes(payload("cover", Map.of("mediaId", "x")), false)).containsExactly(FieldErrorCode.INVALID_UUID);
    }

    @Test
    void B06_emptyValuesAreOnlyCheckedForRequiredOnPublish() {
        assertThat(codes(payload("title", null, "count", "", "startsAt", "  "), false)).isEmpty();
        assertThat(codes(payload("count", ""), true)).containsExactly(FieldErrorCode.REQUIRED);
        assertThat(validator.validate(fields, payload("title", " "), true))
                .containsExactly(new FieldError("payload.title", FieldErrorCode.REQUIRED, "Missing required field title"));
    }

    @Test
    void B06_topLevelCodeFollowsTheFirstError() {
        assertThat(PayloadValidator.topLevelCode(List.of(
                new FieldError("payload.venue", FieldErrorCode.REF_TARGET_NOT_FOUND, "m"),
                new FieldError("payload.count", FieldErrorCode.WRONG_TYPE, "m")))).isEqualTo(ErrorCode.REF_TARGET_NOT_FOUND);
        assertThat(PayloadValidator.topLevelCode(List.of(
                new FieldError("payload.venue", FieldErrorCode.REF_TARGET_WRONG_TYPE, "m")))).isEqualTo(ErrorCode.REF_TARGET_WRONG_TYPE);
        assertThat(PayloadValidator.topLevelCode(List.of(
                new FieldError("payload.host", FieldErrorCode.PRINCIPAL_REF_UNRESOLVED, "m")))).isEqualTo(ErrorCode.PRINCIPAL_REF_UNRESOLVED);
        assertThat(PayloadValidator.topLevelCode(List.of(
                new FieldError("payload.count", FieldErrorCode.WRONG_TYPE, "m"),
                new FieldError("payload.venue", FieldErrorCode.REF_TARGET_NOT_FOUND, "m")))).isEqualTo(ErrorCode.FIELD_VALIDATION);
    }
}
```

### 7.2 `EntryWriteRulesApiTests`

前置資料：demo 種子（`album`、`photo` 類型與 `seed-operator-album`）。每個測試建立自己的 entry，slug 是隨機的 `w` + 8 碼。

| 測試 | # | 動作 | 斷言 |
| --- | --- | --- | --- |
| `B06_createReturnsEveryFieldErrorAtOnce` | 1 | 建立相簿，payload 含保留字 `slug`、1,001 字的 `title`、`cover` `not-a-uuid`、`visibility` `secret`、`sortMode` 5 | 422 `FIELD_VALIDATION`；`message` 是摘要；`fields[*].field` 與 `code` 依序是 §4.4 的五個 |
| `B06_firstReferenceErrorKeepsItsV1Code` | 1 | 建立照片，`album` 是不存在的 UUID、`takenAt` 是 `yesterday` | 422 `REF_TARGET_NOT_FOUND`；`fields` 的代碼是 `REF_TARGET_NOT_FOUND`、`INVALID_DATETIME` |
| `B06_publishListsEveryMissingRequiredField` | 1 | 建立沒有 `album` 的照片（201），發布 | 422 `FIELD_VALIDATION`；`fields` 只有 `payload.album` `REQUIRED` |
| `BW1c_sessionSurfaceExistenceAndPermissionAreCheckedBeforeVersion` | 1 | 都不帶 `version`：沒有 session；operator 對不存在的 id；operator 在 Front；`seed-editor-clinic`（沒有 `album` 權限）在 Back | 401 `UNAUTHENTICATED`；404 `ENTRY_NOT_FOUND`；403 `SURFACE_FORBIDDEN`；403 `FORBIDDEN`（順序：同一帳號在另一個 surface 登入會讓先前的 session 失效，所以 Front 那一步放在 404 之後） |
| `BW1c_patchWithoutVersionIsPreconditionRequired` | 1 | 建立相簿；PATCH 不帶 `version`；PATCH `version: null` | 兩次都 428 `VERSION_REQUIRED` |
| | 2 | PATCH `version: 1` | 200，`version` 2 |
| | 3 | 再 PATCH `version: 1` | 409 `VERSION_CONFLICT` |
| `G07_nullClearsAFieldWithoutValidationAndPublishStillChecksRequired` | 1 | 建立有 `description` 的相簿；PATCH `version: 1`，`description` 與 `title` 都是 null | 200；`payload` 有 `description` 鍵且值為 null；`visibility` 不變 |
| | 2 | 發布 | 422；`fields` 只有 `payload.title`（必填） |
| | 3 | PATCH `version: 2` 補回 `title`，發布，公開讀 slug | 200；公開 `payload` 有 `description` 鍵且值為 null |
| `B13_unreadableMediaIsNullAndReadableMediaIsExpanded` | 1 | 上傳一張 PNG；發布兩本公開相簿：`cover` 是不存在的媒體 UUID／上傳的媒體 | — |
| | 2 | 公開讀第一本；公開列表 `q=Hidden cover` | `payload` 有 `cover` 鍵且值為 null；列表第一筆的 `cover` 也是 null |
| | 3 | 公開讀第二本 | `payload.cover.mediaId` 是上傳的媒體 id |

`src/test/java/com/fallrising/cms/EntryWriteRulesApiTests.java`：

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
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** BW1c: field errors (B-06, BD-08), PATCH version (02 §4.4), clearing with null (G-07), public media null (B-13). */
@SpringBootTest
@AutoConfigureMockMvc
class EntryWriteRulesApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void B06_createReturnsEveryFieldErrorAtOnce() throws Exception {
        TestSession op = operator();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("slug", "inside-payload");
        payload.put("title", "t".repeat(1_001));
        payload.put("cover", "not-a-uuid");
        payload.put("visibility", "secret");
        payload.put("sortMode", 5);
        create(op, "album", payload)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))
                .andExpect(jsonPath("$.error.message").value("5 invalid field(s); first: Reserved field: slug"))
                .andExpect(jsonPath("$.error.fields[*].field").value(equalTo(List.of(
                        "payload.slug", "payload.title", "payload.cover", "payload.visibility", "payload.sortMode"))))
                .andExpect(jsonPath("$.error.fields[*].code").value(equalTo(List.of(
                        "RESERVED_KEY", "TOO_LONG", "INVALID_UUID", "NOT_IN_ENUM", "WRONG_TYPE"))));
    }

    @Test
    void B06_firstReferenceErrorKeepsItsV1Code() throws Exception {
        TestSession op = operator();
        create(op, "photo", Map.of("album", UUID.randomUUID().toString(), "takenAt", "yesterday"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("REF_TARGET_NOT_FOUND"))
                .andExpect(jsonPath("$.error.fields[*].code").value(equalTo(List.of("REF_TARGET_NOT_FOUND", "INVALID_DATETIME"))));
    }

    @Test
    void B06_publishListsEveryMissingRequiredField() throws Exception {
        TestSession op = operator();
        String id = id(create(op, "photo", Map.of("caption", "no album yet")).andExpect(status().isCreated()));
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish", id)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))
                .andExpect(jsonPath("$.error.fields[*].field").value(equalTo(List.of("payload.album"))))
                .andExpect(jsonPath("$.error.fields[0].code").value("REQUIRED"));
    }

    @Test
    void BW1c_patchWithoutVersionIsPreconditionRequired() throws Exception {
        TestSession op = operator();
        String id = id(create(op, "album", Map.of("title", "Versioned")).andExpect(status().isCreated()));
        for (String body : List.of("{\"payload\":{\"title\":\"x\"}}", "{\"version\":null,\"payload\":{\"title\":\"x\"}}")) {
            mockMvc.perform(op.apply(patch("/api/v1/entries/{id}", id)).contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isPreconditionRequired())
                    .andExpect(jsonPath("$.error.code").value("VERSION_REQUIRED"));
        }
        patchEntry(op, id, 1, Map.of("title", "Now versioned"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2));
        patchEntry(op, id, 1, Map.of("title", "Stale"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"));
    }

    @Test
    void BW1c_sessionSurfaceExistenceAndPermissionAreCheckedBeforeVersion() throws Exception {
        TestSession op = operator();
        String id = id(create(op, "album", Map.of("title", "Guarded")).andExpect(status().isCreated()));
        String noVersion = "{\"payload\":{\"title\":\"x\"}}";
        mockMvc.perform(patch("/api/v1/entries/{id}", id).header("Origin", TestSession.BACK)
                        .contentType(MediaType.APPLICATION_JSON).content(noVersion))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
        mockMvc.perform(op.apply(patch("/api/v1/entries/{id}", UUID.randomUUID())).contentType(MediaType.APPLICATION_JSON).content(noVersion))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("ENTRY_NOT_FOUND"));
        TestSession front = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.FRONT);
        mockMvc.perform(front.apply(patch("/api/v1/entries/{id}", id)).contentType(MediaType.APPLICATION_JSON).content(noVersion))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
        TestSession clinicEditor = TestSession.login(mockMvc, "seed-editor-clinic", password, TestSession.BACK);
        mockMvc.perform(clinicEditor.apply(patch("/api/v1/entries/{id}", id)).contentType(MediaType.APPLICATION_JSON).content(noVersion))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void G07_nullClearsAFieldWithoutValidationAndPublishStillChecksRequired() throws Exception {
        TestSession op = operator();
        String slug = token();
        String id = id(create(op, "album", Map.of("title", "Clear me", "description", "Some text", "visibility", "public"), slug)
                .andExpect(status().isCreated()));
        Map<String, Object> clear = new LinkedHashMap<>();
        clear.put("description", null);
        clear.put("title", null);
        patchEntry(op, id, 1, clear)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload").value(hasKey("description")))
                .andExpect(jsonPath("$.payload.description").value(nullValue()))
                .andExpect(jsonPath("$.payload.visibility").value("public"));
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish", id)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[*].field").value(equalTo(List.of("payload.title"))));
        patchEntry(op, id, 2, Map.of("title", "Filled again")).andExpect(status().isOk());
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish", id))).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/content-types/album/slugs/{slug}", slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload").value(hasKey("description")))
                .andExpect(jsonPath("$.payload.description").value(nullValue()));
    }

    @Test
    void B13_unreadableMediaIsNullAndReadableMediaIsExpanded() throws Exception {
        TestSession op = operator();
        String media = upload(op);
        String hiddenSlug = token();
        String shownSlug = token();
        publish(op, id(create(op, "album", Map.of("title", "Hidden cover", "visibility", "public",
                "cover", UUID.randomUUID().toString()), hiddenSlug).andExpect(status().isCreated())));
        publish(op, id(create(op, "album", Map.of("title", "Shown cover", "visibility", "public", "cover", media), shownSlug)
                .andExpect(status().isCreated())));

        mockMvc.perform(get("/api/v1/public/content-types/album/slugs/{slug}", hiddenSlug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload").value(hasKey("cover")))
                .andExpect(jsonPath("$.payload.cover").value(nullValue()));
        mockMvc.perform(get("/api/v1/public/content-types/album/entries").param("q", "Hidden cover"))
                .andExpect(jsonPath("$.items[0].payload.cover").value(nullValue()));
        mockMvc.perform(get("/api/v1/public/content-types/album/slugs/{slug}", shownSlug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload.cover.mediaId").value(media));
    }

    private TestSession operator() throws Exception {
        return TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
    }

    private ResultActions create(TestSession op, String type, Map<String, Object> payload) throws Exception {
        return create(op, type, payload, token());
    }

    private ResultActions create(TestSession op, String type, Map<String, Object> payload, String slug) throws Exception {
        return mockMvc.perform(op.apply(post("/api/v1/content-types/{type}/entries", type))
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("slug", slug, "payload", payload))));
    }

    private ResultActions patchEntry(TestSession op, String id, int version, Map<String, Object> payload) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("version", version);
        body.put("payload", payload);
        return mockMvc.perform(op.apply(patch("/api/v1/entries/{id}", id))
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)));
    }

    private void publish(TestSession op, String id) throws Exception {
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish", id))).andExpect(status().isOk());
    }

    private String upload(TestSession op) throws Exception {
        BufferedImage image = new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(image, "png", png);
        return id(mockMvc.perform(op.apply(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", "cover.png", "image/png", png.toByteArray()))))
                .andExpect(status().isCreated()));
    }

    private String id(ResultActions result) throws Exception {
        return mapper.readTree(result.andReturn().getResponse().getContentAsString()).get("id").asText();
    }

    private static String token() {
        return "w" + UUID.randomUUID().toString().substring(0, 8);
    }
}
```

### 7.3 故障注入

沒有。本波次的錯誤路徑都是輸入驗證，由上面的測試直接觸發。

---

## 8. 失敗模式對照

| FM ID | 失敗情境 | 期望行為 | 由哪個測試覆蓋 | 任務卡 |
| --- | --- | --- | --- | --- |
| BW1c-FM01 | 未登入 PATCH | 401 `UNAUTHENTICATED`（不變，在 428 之前） | `EntryWriteRulesApiTests.BW1c_sessionSurfaceExistenceAndPermissionAreCheckedBeforeVersion` | T03 |
| BW1c-FM02 | Front 上 PATCH | 403 `SURFACE_FORBIDDEN`（不變，在 428 之前） | 同上 | T03 |
| BW1c-FM03 | 沒有 `update` 權限，也沒帶 `version` | 403 `FORBIDDEN`（在 428 之前） | 同上 | T03、T04 |
| BW1c-FM04 | 沒帶 `version` | 428 `VERSION_REQUIRED` | `EntryWriteRulesApiTests.BW1c_patchWithoutVersionIsPreconditionRequired` | T03、T04 |
| BW1c-FM05 | 版本衝突 | 409 `VERSION_CONFLICT`（不變） | 同上第 3 步；既有 `ErrorEnvelopeTests.B14_staleVersionIsVersionConflict` | T03、T04 |
| BW1c-FM06 | 多個欄位同時不合法 | 422，`error.fields` 全部列出 | `B06_createReturnsEveryFieldErrorAtOnce`、`PayloadValidatorTests.B06_collectsEveryErrorInValidationOrderWithPaths` | T01～T04 |
| BW1c-FM07 | 第一個錯誤是 ref 類 | 頂層代碼與 v1 相同 | `B06_firstReferenceErrorKeepsItsV1Code`、`B06_topLevelCodeFollowsTheFirstError` | T01～T04 |
| BW1c-FM08 | 發布時必填欄位空白 | 422 `REQUIRED` | `B06_publishListsEveryMissingRequiredField`、`B06_emptyValuesAreOnlyCheckedForRequiredOnPublish` | T01～T04 |
| BW1c-FM09 | 清空欄位 | 存成 null，不驗證 | `G07_nullClearsAFieldWithoutValidationAndPublishStillChecksRequired` | T03、T04 |
| BW1c-FM10 | 公開投影遇到無法公開的媒體 | `null` | `B13_unreadableMediaIsNullAndReadableMediaIsExpanded` | T03、T04 |
| BW1c-FM11 | 資源不存在 | PATCH 404 `ENTRY_NOT_FOUND`（不變，在 428 之前） | `EntryWriteRulesApiTests.BW1c_sessionSurfaceExistenceAndPermissionAreCheckedBeforeVersion` | T03 |
| BW1c-FM12 | 資料庫失敗 | 500 `INTERNAL_ERROR`（BW0 不變） | BW0 `ApiExceptionHandlerTests` | — |
| BW1c-FM13 | 已存資料不符合新規則 | 讀取正常；下一次寫入或發布回 422 | 沒有專門測試：規則本身由 `PayloadValidatorTests` 覆蓋，讀取路徑沒有改 | — |
| BW1c-FM14 | 回應多了契約沒有的屬性，或 W0 已合併時契約改變 | 全域 OpenAPI 驗證讓 MockMvc 測試失敗；`web` 的 codegen 依 §2.1 | 全部 MockMvc 測試 | T04、T05 |

---

## 9. 交付檢查表

- [ ] T01～T05 全部完成。
- [ ] `./gradlew test` 全綠（預期 194 個＝BW1b 的 180＋本波 14）。
- [ ] `./gradlew integrationTest` 全綠（67 個，本波沒有新增）；本機沒有 Docker 時勾「只在 CI 跑過」並附連結（02 BQ-09）。
- [ ] `npm ci && npm run lint && npm run typecheck && npm test && npm run build` 全綠；或只有 §2.1 所說的 codegen 新鮮度／fixture 型別失敗，並已在 PR 說明列出（01 Q-10）。
- [ ] `cmp docs/v2/contracts/BW1c.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。
- [ ] `grep -rn "orElse(raw)" services/cms-api/src/main` 沒有輸出。
- [ ] B-06：`PayloadValidatorTests`、`EntryWriteRulesApiTests.B06_*` 綠。
- [ ] B-13：`EntryWriteRulesApiTests.B13_*` 綠。
- [ ] G-07：`EntryWriteRulesApiTests.G07_*` 綠。
- [ ] 428：`EntryWriteRulesApiTests.BW1c_*` 綠。
- [ ] `gradle.lockfile` 沒有變動。
- [ ] 沒有秘密或密碼。
- [ ] `docs/v2/README.md` 的 BW1c 狀態已改成 `VERIFIED`。
- [ ] PR 說明列出 §4.2 的三項破壞性變更與規則收緊，以及實際跑過的指令與結果。

---

## 10. BW1c 必寫內容索引

| REFINE-PROMPT 要求 | 位置 |
| --- | --- |
| 每一種欄位型別的驗證規則與錯誤代碼 | §4.3 |
| `error.fields` 的路徑格式 | §4.3「路徑格式」 |
| 三項破壞性變更各自的前後對照與測試 | §4.2 |
