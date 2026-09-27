# BW3 施工圖 — 會員區

[回 v2 索引](../README.md) ・ 框架：[02 §7 BW3](../02-backend-sdd.md#7-後端波次) ・ 契約：[contracts/BW3.openapi.yaml](../contracts/BW3.openapi.yaml) ・ 前一波：[BW2](BW2.md)

狀態：**DOC_READY**（本檔合併即生效）  
日期：2026-09-25  
讀者：實作 BW3 的 agent。只讀本檔、`contracts/BW3.openapi.yaml` 與本檔引用的檔案就能完成，不需要做任何設計決定。

> **預演紀錄。** 本檔的程式碼、YAML 與測試，已套用在「BW2 施工圖完成後」的 `services/cms-api` 副本上，並逐張任務卡執行過（2026-09-25）。T02、T04 完成後，`./gradlew :services:cms-api:test` 依序是 218、223 個測試，唯一失敗的是 `CmsApiApplicationTests.runtimeIsJava25`（預演環境只有 JDK 21）；`integrationTest` 兩次都是 72 個全綠（本機 PostgreSQL 16.13，不是 Testcontainers）。各「測試先行」卡的預期紅燈清單也是實際跑出來的。

---

## 1. 範圍

### 1.1 解決的 ID

| ID | 來源 | 本波次做到什麼程度 |
| --- | --- | --- |
| G-08 | 01 §9 | `/api/v1/me/**` 三個端點；Clinic demo pack 的 `appointment_request` 類型與 member 的 `create` 權限 |
| B-11 | 02 §1.2 | 補完（BW2 做了其餘部分） |
| BD-12 | 02 §2 | 全部 |
| surface-front AC-10、AC-11、AC-12 | `docs/specs/surface-front.md` §11 | API 級驗收（§7.2） |

### 1.2 不做

- 01 §1.2、AGENTS.md「不要做」全部。
- 前端會員區（W3b）。surface-front §7.1 的 `/me/pets`、`/me/appointments`、`/me/appointment-requests` 是前端規格的草案路徑；後端依 02 §4.5／BD-12 做**通用**路徑，前端的對應見 §4.2。
- surface-front §7.6 的 `vetSlug`：02 §4.5 的 `appointment_request` 只有四個欄位，本波次照 02。
- 會員修改或取消自己的預約（02 沒有列）。
- 02 §4.5 說授與 member「帶 predicate 的 `read_draft`」：`/me` 以 owner 條件把關、不用 `read_draft`，而 Front 對 `read_draft` 是 hard-deny，這個 grant 不會被任何端點用到，所以本波次**不授與**；本 PR 在 02 §4.5 補註。
- 頻率限制只存在單一應用程式實例的記憶體中（多實例部署時各算各的），見 §5.2。
- 不新增依賴，所以 `gradle.lockfile` 不變。

---

## 2. 先決條件

### 2.1 前置波次

- **BW2 必須已是 `VERIFIED`**。本檔所有 diff 都以「BW2 施工圖完成後」的檔案為基準；不同時先停下來回報。
- **與前端的關係（[01 Q-10](../01-frontend-sdd.md#133-w0-細化時新增已決定owner2026-09-25)）。** 同 [BW1c §2.1](BW1c.md#21-前置波次)。

### 2.2 環境

與 [BW0 §2.2](BW0.md#22-環境) 相同。

### 2.3 查證過的外部事實

沒有新的依賴。預演中確認（2026-09-25）：`HttpStatus.TOO_MANY_REQUESTS` 是 429，`MockMvcResultMatchers.status().isTooManyRequests()` 存在；`java.time.Clock` 可以在測試中以子類別替換（`MeRateLimiterTests`）。

---

## 3. 檔案清單

路徑相對於 `apps/cms-scaffold/services/cms-api/`，另有註明者除外。**實作者不得碰清單以外的檔案。**

| 路徑 | 動作 | 用途 | 任務卡 |
| --- | --- | --- | --- |
| `src/main/java/com/fallrising/cms/content/service/MeRateLimiter.java` | 新增 | 每分鐘 5 次 | T02 |
| `src/main/java/com/fallrising/cms/api/error/ErrorCode.java` | 修改 | `RATE_LIMITED`（429） | T02 |
| `src/main/java/com/fallrising/cms/content/ContentException.java` | 修改 | `rateLimited()` | T02 |
| `src/main/java/com/fallrising/cms/content/service/MeService.java` | 新增 | 會員端點的邏輯 | T04 |
| `src/main/java/com/fallrising/cms/content/web/MeController.java` | 新增 | `/api/v1/me/**` | T04 |
| `src/main/java/com/fallrising/cms/content/web/ContentProjection.java` | 修改 | 會員投影 | T04 |
| `src/main/java/com/fallrising/cms/content/service/ContentTypeSeed.java` | 修改 | `appointment_request` 類型 | T04 |
| `src/main/java/com/fallrising/cms/identity/service/SeedService.java` | 修改 | member 的 `create` | T04 |
| `src/main/resources/openapi/openapi.yaml` | 修改 | T02、T04 各一段 diff；T04 後等於 `docs/v2/contracts/BW3.openapi.yaml` | T02、T04 |
| `src/test/java/com/fallrising/cms/content/service/MeRateLimiterTests.java` | 新增 | 頻率限制（單元） | T01 |
| `src/test/java/com/fallrising/cms/MemberApiTests.java` | 新增 | 會員端點（MockMvc） | T03 |
| `apps/cms-scaffold/docs/v2/README.md` | 修改 | 路線圖 BW3 狀態改 `VERIFIED` | T05 |

不會碰：`build.gradle.kts`、`gradle.lockfile`、migration、store、`DemoContentSeed.java`、上表以外的測試、前端、`e2e/`、workflow。

---

## 4. 契約

### 4.1 OpenAPI

完整契約是 [`docs/v2/contracts/BW3.openapi.yaml`](../contracts/BW3.openapi.yaml)，`info.version` 0.9.0，`ErrorCode` 39 個（加 `RATE_LIMITED`）。合併方式同 BW2：T02 先加 `RATE_LIMITED`（`ErrorCodeContractTests` 要求 Java enum 與契約一致），T04 加三個 operation（`OpenApiContractTests` 要求路徑與實作一致）；T04 後以 `cmp` 確認。

| operation | 方法與路徑 | surface | 授權 | 錯誤 |
| --- | --- | --- | --- | --- |
| `listMyEntries` | `GET /api/v1/me/content-types/{typeKey}/entries` | 只有 Front | 已登入；只列 ownerField＝自己的 | 400；401；403 `SURFACE_FORBIDDEN`；404 `CONTENT_TYPE_NOT_FOUND` |
| `getMyEntry` | `GET /api/v1/me/entries/{id}` | 只有 Front | 已登入；不是自己的 403 | 401；403 `SURFACE_FORBIDDEN`、`FORBIDDEN`；404 `ENTRY_NOT_FOUND` |
| `createMyEntry` | `POST /api/v1/me/content-types/{typeKey}/entries` | 只有 Front | 已登入；該類型在 Front 的 `create` | 400；401；403；404；422；429 `RATE_LIMITED` |

新 schema：`MemberEntry`、`MemberEntryPage`、`MemberCreateRequest`；新回應 `Error429`；新 tag `Member`。

### 4.2 行為

- 只有類型設了 `ownerField`（種子：`owner`、`pet`、`visit`、`appointment_request`）才開放；其他類型 404 `CONTENT_TYPE_NOT_FOUND`（不說明原因，避免列舉）。停用的類型同樣 404。
- **讀取**以「entry 工作副本的 `ownerField` 等於呼叫者 id」把關，不看 `read_published`／`read_draft`。列表只含 `draft` 與 `published`（不含封存與軟刪除）。
- 列表的 `page`、`size`、`sort`、`q`、`filter.*`、`ref.*` 沿用工作列表的文法（[BW1b §4.3](BW1b.md#43-查詢參數文法)）；`state`、`publishRequested` 會照文法檢查（不合法 400），但不影響結果：狀態固定為 `draft`、`published`。
- **會員投影（`MemberEntry`）**：`id`、`contentType`、`publicationState`、`title`（titleField）、`payload`（工作副本中可見性 `public` 的欄位；`media-ref` 與公開投影同樣展開，無法公開時為 null）、`createdAt`、`updatedAt`。沒有 `version`，因為會員不能修改。
- **建立**的步驟：Front、已登入 → 類型有 ownerField → 呼叫者在 Front 對該類型有 `create`（`hasAction`）→ 頻率限制 → ownerField 設為呼叫者（覆蓋客戶端的值）→ 必填欄位不可為空（`REQUIRED`；會員不能發布，所以發布時的檢查提前在這裡做）→ 指向「有 ownerField 的類型」的 ref 必須是自己的（否則 `REF_TARGET_NOT_FOUND`，不透露別人的 id 存在）→ `EntryService.create`（其餘驗證、`entry.create` 審計）。永遠建立為 `draft`；body 帶 `publicationState` 400。
- 前端對應：surface-front 的 `/me/pets` → `GET /me/content-types/pet/entries`；`/me/appointments` → `GET /me/content-types/appointment_request/entries`；`/me/appointments/{id}` → `GET /me/entries/{id}`；`POST /me/appointment-requests` → `POST /me/content-types/appointment_request/entries`，body `{ "payload": { "pet", "preferredAt", "reason" } }`，201 回整筆 `MemberEntry`（含 `id`）。

### 4.3 授權矩陣

| 帳號 | Front | Back | Admin |
| --- | --- | --- | --- |
| 未登入 | 401（三個端點） | 401 | 401 |
| `seed-member-clinic` | 讀：自己的 `pet`（Leo）、`owner`、`visit`、`appointment_request`；別人的 403；建立 `appointment_request` 201，其他類型 403 | 403 `SURFACE_FORBIDDEN` | 403 `SURFACE_FORBIDDEN` |
| 其他 member（例如新建的） | 讀：自己的（通常是空的）；建立 `appointment_request` 201 | 403 | 403 |
| editor、operator、admin | 讀：自己的（種子資料沒有指向他們的 ownerField，所以是空的）；建立：沒有 Front 的 `create`，403 | 403 | 403 |

測試覆蓋：未登入、member 讀自己、Back 403、別人的 403、別的類型建立 403、頻率限制（§7.2）。editor／operator／admin 的格子由同一段程式路徑（`requireMember` 與 `hasAction`）保證。

### 4.4 審計

`createMyEntry` 經 `EntryService.create` 寫 `entry.create`（`category=CONTENT`、`targetType=entry`、`detail` null、`surface=front`），與 BW2 §4.3 相同。讀取不寫審計。被拒（403／429）不寫：它們不是 02 §4.6 的治理動作。

### 4.5 資料

沒有 migration。`ContentTypeSeed` 新增的類型（既有資料庫在下次啟動時補上，與 BW1a 的種子規則相同）：

| 欄位 | 型別 | 必填 | 有索引 | 目標 | 標籤 |
| --- | --- | --- | --- | --- | --- |
| `pet` | ref | 是 | 否 | `pet` | 寵物 |
| `preferredAt` | datetime | 是 | 是 | — | 希望時間 |
| `reason` | string | 是 | 否（它是 titleField，所以有索引列） | — | 原因 |
| `ownerPrincipalId` | principal-ref | 否（由伺服器設定） | 是（也是 ownerField） | — | 會員帳號 |

類型設定：`titleField=reason`、`slugPolicy=none`、`ownerField=ownerPrincipalId`、不是 singleton、沒有 `sortField`／`visibilityField`。`SeedService` 對 member 加 `create`、類型 `appointment_request`、surface `[front]`（`FRONT_HARD_DENY` 不含 `create`）。

### 4.6 範例

成功：`POST /api/v1/me/content-types/appointment_request/entries`（`seed-member-clinic`，Front），body `{"payload":{"pet":"<Leo id>","preferredAt":"2026-10-01T10:00:00+08:00","reason":"Annual check","ownerPrincipalId":"<別人的 id>"}}`，`201`：

```json
{ "id": "…", "contentType": "appointment_request", "publicationState": "draft", "title": "Annual check",
  "payload": { "pet": "<Leo id>", "preferredAt": "2026-10-01T10:00:00+08:00", "reason": "Annual check",
               "ownerPrincipalId": "<seed-member-clinic 的 id>" },
  "createdAt": "…", "updatedAt": "…" }
```

失敗：另一位 member 讀這筆，`403`：

```json
{ "error": { "code": "FORBIDDEN", "message": "…", "action": "read_published", "contentType": "appointment_request",
             "surface": "front" }, "requestId": "…" }
```

失敗：同一位 member 一分鐘內第六次建立，`429`：

```json
{ "error": { "code": "RATE_LIMITED", "message": "Too many requests; try again in a minute" }, "requestId": "…" }
```

---

## 5. 模組規格

### 5.1 頻率限制（T02）

`MeRateLimiter.acquire(principalId)`：丟掉 60 秒以前的紀錄；已有 5 筆就丟 429；否則記一筆。每位 principal 一個佇列（`synchronized`）。只要呼叫到限制器就算一次，無論之後是否建立成功（例如 422）。

`src/main/java/com/fallrising/cms/content/service/MeRateLimiter.java`：

```java
package com.fallrising.cms.content.service;

import com.fallrising.cms.content.ContentException;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * At most LIMIT member create requests per principal in any WINDOW (02 §4.5: 5 per minute). A request counts when it
 * reaches the limiter, whether or not the entry is then created. Kept in memory per application instance.
 */
@Component
public class MeRateLimiter {

    public static final int LIMIT = 5;
    public static final Duration WINDOW = Duration.ofMinutes(1);

    private final Clock clock;
    private final Map<UUID, Deque<Instant>> calls = new ConcurrentHashMap<>();

    public MeRateLimiter() {
        this(Clock.systemUTC());
    }

    MeRateLimiter(Clock clock) {
        this.clock = clock;
    }

    /** Records one call, or throws 429 RATE_LIMITED when LIMIT calls happened in the last WINDOW. */
    public void acquire(UUID principalId) {
        Instant now = clock.instant();
        Deque<Instant> recent = calls.computeIfAbsent(principalId, id -> new ArrayDeque<>());
        synchronized (recent) {
            while (!recent.isEmpty() && !recent.peekFirst().isAfter(now.minus(WINDOW))) {
                recent.pollFirst();
            }
            if (recent.size() >= LIMIT) {
                throw ContentException.rateLimited();
            }
            recent.addLast(now);
        }
    }
}
```

`src/main/java/com/fallrising/cms/api/error/ErrorCode.java`：

```diff
--- a/src/main/java/com/fallrising/cms/api/error/ErrorCode.java
+++ b/src/main/java/com/fallrising/cms/api/error/ErrorCode.java
@@ -44,6 +44,7 @@
     ROUTE_NOT_FOUND("ROUTE_NOT_FOUND", HttpStatus.NOT_FOUND),
     METHOD_NOT_ALLOWED("METHOD_NOT_ALLOWED", HttpStatus.METHOD_NOT_ALLOWED),
     MEDIA_TYPE_NOT_SUPPORTED("MEDIA_TYPE_NOT_SUPPORTED", HttpStatus.UNSUPPORTED_MEDIA_TYPE),
+    RATE_LIMITED("RATE_LIMITED", HttpStatus.TOO_MANY_REQUESTS),
     INTERNAL_ERROR("INTERNAL_ERROR", HttpStatus.INTERNAL_SERVER_ERROR);
 
     private final String wire;
```

`src/main/java/com/fallrising/cms/content/ContentException.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/ContentException.java
+++ b/src/main/java/com/fallrising/cms/content/ContentException.java
@@ -74,6 +74,10 @@
         return new ContentException(ErrorCode.VALIDATION_FAILED, message);
     }
 
+    public static ContentException rateLimited() {
+        return new ContentException(ErrorCode.RATE_LIMITED, "Too many requests; try again in a minute");
+    }
+
     public static ContentException typeDisabled() {
         return new ContentException(ErrorCode.TYPE_DISABLED, "Content type is disabled");
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
-  version: 0.8.0
+  version: 0.9.0
   license:
     name: Proprietary
 servers:
@@ -1601,6 +1601,11 @@
       content:
         application/json:
           schema: { $ref: "#/components/schemas/ErrorEnvelope" }
+    Error429:
+      description: Too many requests (RATE_LIMITED).
+      content:
+        application/json:
+          schema: { $ref: "#/components/schemas/ErrorEnvelope" }
     Error500:
       description: INTERNAL_ERROR.
       content:
@@ -1657,6 +1662,7 @@
         - ROUTE_NOT_FOUND
         - METHOD_NOT_ALLOWED
         - MEDIA_TYPE_NOT_SUPPORTED
+        - RATE_LIMITED
         - INTERNAL_ERROR
     ErrorEnvelope:
       type: object
```

### 5.2 會員端點（T04）

規則見 §4.2。`MeService` 的交易：讀取不需要；建立沿用 `EntryService.create` 的交易（BW2）。頻率限制在單一實例的記憶體中；多實例部署時實際上限是「實例數 × 5」，本波次接受（demo 規模），記在 §8 BW3-FM09。

`src/main/java/com/fallrising/cms/content/service/MeService.java`：

```java
package com.fallrising.cms.content.service;

import com.fallrising.cms.api.error.FieldError;
import com.fallrising.cms.api.error.FieldErrorCode;
import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.index.IndexScope;
import com.fallrising.cms.content.query.AccessFilter;
import com.fallrising.cms.content.query.EntryPage;
import com.fallrising.cms.content.query.EntryQuery;
import com.fallrising.cms.content.query.ListQueryParser;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuthorizationService;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Member endpoints (02 §4.5, BD-12): entries of a type with an ownerField whose owner is the caller. Front surface
 * only. Reads are gated by ownership, not by read_draft (members never get read_draft on Front); create needs the
 * create action and the server sets the ownerField.
 */
@Service
public class MeService {

    /** Result of a member list: the type, its fields and one page. */
    public record MeList(ContentTypeRecord type, List<FieldRecord> fields, EntryPage page, int pageNo, int size) {}

    /** One entry with its type and fields for projection. */
    public record MeEntry(ContentTypeRecord type, List<FieldRecord> fields, EntryRecord entry) {}

    private final ContentStore store;
    private final EntryService entries;
    private final AuthorizationService authorization;
    private final MeRateLimiter rateLimiter;

    public MeService(ContentStore store, EntryService entries, AuthorizationService authorization, MeRateLimiter rateLimiter) {
        this.store = store;
        this.entries = entries;
        this.authorization = authorization;
        this.rateLimiter = rateLimiter;
    }

    /**
     * The caller's entries of typeKey in draft or published state. page, size and sort follow the work list grammar
     * (waves/BW1b.md §4.3); state, filter.* and ref.* are rejected or ignored as there.
     */
    public MeList list(Principal principal, Surface surface, String typeKey, Map<String, String[]> params) {
        requireMember(principal, surface);
        ContentTypeRecord type = ownedType(typeKey);
        List<FieldRecord> fields = store.fieldsOf(type.id());
        ListQueryParser.Parsed parsed = ListQueryParser.parse(type, fields, IndexScope.WORK, params);
        AccessFilter mine = AccessFilter.anyOf(List.of(new AccessFilter.Clause(type.ownerField(), principal.id().toString())));
        EntryPage page = store.queryEntries(new EntryQuery(type.id(), IndexScope.WORK, List.of("draft", "published"),
                type.titleField(), parsed.q(), parsed.filters(), parsed.refs(), mine, null, List.of(), parsed.sort(),
                parsed.page(), parsed.size(), false));
        return new MeList(type, fields, page, parsed.page(), parsed.size());
    }

    /** One of the caller's entries; another member's entry is 403 FORBIDDEN (surface-front AC-11), not 404. */
    public MeEntry get(Principal principal, Surface surface, UUID id) {
        requireMember(principal, surface);
        EntryRecord entry = store.findEntry(id).orElseThrow(ContentException::notFound);
        if (entry.deleted()) {
            throw ContentException.notFound();
        }
        ContentTypeRecord type = store.findTypeByKey(entry.contentTypeKey()).orElseThrow(ContentException::notFound);
        if (type.ownerField() == null || !type.enabled()) {
            throw ContentException.notFound();
        }
        Object owner = entry.payload() == null ? null : entry.payload().get(type.ownerField());
        if (!principal.id().toString().equals(owner)) {
            throw IdentityException.forbidden(CmsAction.READ_PUBLISHED.wire(), type.typeKey(), surface.wire());
        }
        return new MeEntry(type, store.fieldsOf(type.id()), entry);
    }

    /**
     * Creates a draft owned by the caller. Steps: Front and signed in; type has an ownerField; caller has create on
     * the type on Front (403 otherwise); rate limit (429); ownerField set to the caller (any client value replaced);
     * required fields must not be empty (422 REQUIRED; members cannot publish, so the publish-time check is done here);
     * every ref field whose target type has an ownerField must point to an entry the caller owns (422
     * REF_TARGET_NOT_FOUND otherwise, so other members' ids are not confirmed); then EntryService.create.
     */
    public MeEntry create(Principal principal, Surface surface, String typeKey, Map<String, Object> payload) {
        requireMember(principal, surface);
        ContentTypeRecord type = ownedType(typeKey);
        if (!authorization.hasAction(principal, CmsAction.CREATE, typeKey, surface)) {
            throw IdentityException.forbidden(CmsAction.CREATE.wire(), typeKey, surface.wire());
        }
        rateLimiter.acquire(principal.id());
        Map<String, Object> body = payload == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload);
        body.put(type.ownerField(), principal.id().toString());
        List<FieldRecord> fields = store.fieldsOf(type.id());
        List<FieldError> errors = new ArrayList<>();
        for (FieldRecord field : fields) {
            Object value = body.get(field.fieldKey());
            if (field.required() && (value == null || (value instanceof String text && text.isBlank()))) {
                errors.add(new FieldError("payload." + field.fieldKey(), FieldErrorCode.REQUIRED,
                        "Missing required field " + field.fieldKey()));
            }
        }
        errors.addAll(foreignRefs(principal, fields, body));
        if (!errors.isEmpty()) {
            throw ContentException.fieldErrors(errors);
        }
        EntryRecord created = entries.create(principal, surface, typeKey, null, body);
        return new MeEntry(type, fields, created);
    }

    private List<FieldError> foreignRefs(Principal principal, List<FieldRecord> fields, Map<String, Object> body) {
        List<FieldError> errors = new ArrayList<>();
        for (FieldRecord field : fields) {
            if (!"ref".equals(field.fieldType()) || field.refTargetTypeKey() == null) continue;
            ContentTypeRecord target = store.findTypeByKey(field.refTargetTypeKey()).orElse(null);
            Object raw = body.get(field.fieldKey());
            if (target == null || target.ownerField() == null || !(raw instanceof String text)) continue;
            EntryRecord entry = uuid(text) == null ? null : store.findEntry(uuid(text)).orElse(null);
            if (entry == null) continue;
            Object owner = entry.payload() == null ? null : entry.payload().get(target.ownerField());
            if (!principal.id().toString().equals(owner)) {
                errors.add(new FieldError("payload." + field.fieldKey(), FieldErrorCode.REF_TARGET_NOT_FOUND,
                        "Referenced entry not found"));
            }
        }
        return errors;
    }

    private ContentTypeRecord ownedType(String typeKey) {
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::typeNotFound);
        if (!type.enabled() || type.ownerField() == null) {
            throw ContentException.typeNotFound();
        }
        return type;
    }

    private static void requireMember(Principal principal, Surface surface) {
        if (principal == null) {
            throw IdentityException.unauthenticated();
        }
        if (surface != Surface.FRONT) {
            throw IdentityException.surfaceForbidden("me", null, surface == null ? null : surface.wire());
        }
    }

    private static UUID uuid(String text) {
        try {
            UUID id = UUID.fromString(text);
            return id.toString().equals(text) ? id : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
```

`src/main/java/com/fallrising/cms/content/web/MeController.java`：

```java
package com.fallrising.cms.content.web;

import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.service.MeService;
import com.fallrising.cms.identity.web.AuthController;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fallrising.cms.media.service.MediaService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Member endpoints (02 §4.5). Front surface only; see MeService. */
@RestController
@RequestMapping("/api/v1/me")
public class MeController {

    /** publicationState is rejected so that a member can never ask for a published entry. */
    public record MeCreateBody(Map<String, Object> payload, String publicationState) {}

    private final MeService me;
    private final MediaService media;

    public MeController(MeService me, MediaService media) {
        this.me = me;
        this.media = media;
    }

    @GetMapping("/content-types/{typeKey}/entries")
    public Map<String, Object> list(@PathVariable String typeKey, HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        MeService.MeList result = me.list(identity.principal(), identity.surface(), typeKey, request.getParameterMap());
        List<Map<String, Object>> items = result.page().items().stream()
                .map(e -> ContentProjection.member(e, result.type(), result.fields(), this::expandMedia))
                .toList();
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("items", items);
        json.put("total", result.page().total());
        json.put("page", result.pageNo());
        json.put("size", result.size());
        json.put("offset", (result.pageNo() - 1) * result.size());
        json.put("limit", result.size());
        return json;
    }

    @GetMapping("/entries/{id}")
    public Map<String, Object> get(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        MeService.MeEntry found = me.get(identity.principal(), identity.surface(), id);
        return ContentProjection.member(found.entry(), found.type(), found.fields(), this::expandMedia);
    }

    @PostMapping("/content-types/{typeKey}/entries")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@PathVariable String typeKey, @RequestBody(required = false) MeCreateBody body,
            HttpServletRequest request) {
        if (body != null && body.publicationState() != null) {
            throw ContentException.invalidParameter("publicationState is not accepted");
        }
        IdentityRequest identity = AuthController.current(request);
        MeService.MeEntry created = me.create(identity.principal(), identity.surface(), typeKey, body == null ? null : body.payload());
        return ContentProjection.member(created.entry(), created.type(), created.fields(), this::expandMedia);
    }

    private Object expandMedia(Object raw) {
        return media.resolvePublic(raw).map(Object.class::cast).orElse(null);
    }
}
```

`src/main/java/com/fallrising/cms/content/web/ContentProjection.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/ContentProjection.java
+++ b/src/main/java/com/fallrising/cms/content/web/ContentProjection.java
@@ -59,6 +59,34 @@
     }
 
     /**
+     * Member copy (02 §4.5): the working copy's public fields (so drafts are included), with media-ref expanded like the
+     * public projection (null when not publicly readable), plus publicationState and timestamps.
+     */
+    static Map<String, Object> member(
+            EntryRecord entry,
+            ContentTypeRecord type,
+            List<FieldRecord> fields,
+            java.util.function.Function<Object, Object> mediaExpander) {
+        Map<String, Object> payload = new LinkedHashMap<>();
+        Map<String, Object> source = entry.payload() == null ? Map.of() : entry.payload();
+        for (FieldRecord field : fields) {
+            if (field.enabled() && "public".equals(field.visibility()) && source.containsKey(field.fieldKey())) {
+                Object value = source.get(field.fieldKey());
+                payload.put(field.fieldKey(), "media-ref".equals(field.fieldType()) && value != null ? mediaExpander.apply(value) : value);
+            }
+        }
+        Map<String, Object> json = new LinkedHashMap<>();
+        json.put("id", entry.id().toString());
+        json.put("contentType", entry.contentTypeKey());
+        json.put("publicationState", entry.publicationState().wire());
+        json.put("title", title(source, type.titleField()));
+        json.put("payload", payload);
+        json.put("createdAt", entry.createdAt());
+        json.put("updatedAt", entry.updatedAt());
+        return json;
+    }
+
+    /**
      * Type schema for Back and Admin (02 §4.7). admin=true adds enabled, and per field indexed and enabled,
      * and includes internal and disabled fields; admin=false omits internal and disabled fields.
      */
```

`src/main/java/com/fallrising/cms/content/service/ContentTypeSeed.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/service/ContentTypeSeed.java
+++ b/src/main/java/com/fallrising/cms/content/service/ContentTypeSeed.java
@@ -127,6 +127,12 @@
                 field("status", "enum", false, true, null, List.of("planned", "reached", "missed"))
                         .label("狀態", labels("planned", "已規劃", "reached", "已達成", "missed", "未達成")),
                 field("sortOrder", "int", false, true, null, List.of()).label("排序")));
+        type("appointment_request", "Appointment request", "Appointment requests", "reason", "none", false, List.of(), null, null,
+                "ownerPrincipalId", List.of(
+                        field("pet", "ref", true, false, "pet", List.of()).label("寵物"),
+                        field("preferredAt", "datetime", true, true, null, List.of()).label("希望時間"),
+                        field("reason", "string", true, false, null, List.of()).label("原因"),
+                        field("ownerPrincipalId", "principal-ref", false, true, null, List.of()).label("會員帳號")));
         store.markMediaRefsPublic();
         if (store.findNavigation("front.primary").isEmpty()) {
             Instant now = Instant.now();
```

`src/main/java/com/fallrising/cms/identity/service/SeedService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/service/SeedService.java
+++ b/src/main/java/com/fallrising/cms/identity/service/SeedService.java
@@ -109,6 +109,7 @@
         ensurePermission(member.id(), CmsAction.READ_PUBLISHED, "pet", predicate, ALL_SURFACES);
         ensurePermission(member.id(), CmsAction.READ_PUBLISHED, "visit", predicate, ALL_SURFACES);
         ensurePermission(member.id(), CmsAction.READ_PUBLISHED, "owner", predicate, ALL_SURFACES);
+        ensurePermission(member.id(), CmsAction.CREATE, "appointment_request", null, List.of(Surface.FRONT.wire()));
         if (store.permissionsOfRole(editor.id()).isEmpty()) {
             addPermission(editor.id(), CmsAction.READ_PUBLISHED, null, null, ALL_SURFACES);
             addPermission(editor.id(), CmsAction.READ_DRAFT, null, null, WORK_SURFACES);
```

`src/main/resources/openapi/openapi.yaml`：

```diff
--- a/src/main/resources/openapi/openapi.yaml
+++ b/src/main/resources/openapi/openapi.yaml
@@ -38,6 +38,7 @@
   - name: Content
   - name: Media
   - name: Admin
+  - name: Member
 paths:
   /actuator/health:
     get:
@@ -1283,6 +1284,95 @@
         "403": { $ref: "#/components/responses/Error403" }
         "404": { $ref: "#/components/responses/Error404" }
         "500": { $ref: "#/components/responses/Error500" }
+  /api/v1/me/content-types/{typeKey}/entries:
+    get:
+      operationId: listMyEntries
+      tags: [Member]
+      description: |
+        The caller's entries of a type that has an ownerField (02 §4.5, G-08): entries whose ownerField equals
+        the caller's id, in draft or published state, with the public fields of the working copy. Front surface
+        only. Paging and sorting as listWorkEntries (default `-updatedAt`); `state` is rejected as unknown.
+        Errors:
+        - 400 VALIDATION_FAILED: `page`, `size`, `sort` or a filter as listWorkEntries.
+        - 403 SURFACE_FORBIDDEN: called from the Back or Admin surface.
+        - 404 CONTENT_TYPE_NOT_FOUND: type missing, disabled, or without ownerField.
+      parameters:
+        - $ref: "#/components/parameters/TypeKey"
+        - $ref: "#/components/parameters/Page"
+        - $ref: "#/components/parameters/Size"
+        - $ref: "#/components/parameters/Sort"
+      responses:
+        "200":
+          description: The caller's entries
+          content:
+            application/json:
+              schema: { $ref: "#/components/schemas/MemberEntryPage" }
+        "400": { $ref: "#/components/responses/Error400" }
+        "401": { $ref: "#/components/responses/Error401" }
+        "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
+        "500": { $ref: "#/components/responses/Error500" }
+    post:
+      operationId: createMyEntry
+      tags: [Member]
+      description: |
+        Creates a draft owned by the caller (02 §4.5). Front surface only; needs `create` on the type. The
+        ownerField is set to the caller (a client value is replaced). A ref field whose target type has an
+        ownerField must point to an entry the caller owns. At most 5 requests per member per minute. Audit:
+        `entry.create`.
+        Errors:
+        - 400 VALIDATION_FAILED: `publicationState` present in the body.
+        - 403 SURFACE_FORBIDDEN: called from the Back or Admin surface.
+        - 403 FORBIDDEN: caller lacks `create` on the type.
+        - 404 CONTENT_TYPE_NOT_FOUND: type missing, disabled, or without ownerField.
+        - 422 with `error.fields`: payload invalid as createEntry, or a ref to an entry the caller does not own
+          (`REF_TARGET_NOT_FOUND`).
+        - 429 RATE_LIMITED: more than 5 requests in the last minute.
+      parameters:
+        - $ref: "#/components/parameters/TypeKey"
+        - $ref: "#/components/parameters/CsrfHeader"
+      requestBody:
+        required: true
+        content:
+          application/json:
+            schema: { $ref: "#/components/schemas/MemberCreateRequest" }
+      responses:
+        "201":
+          description: Created draft
+          content:
+            application/json:
+              schema: { $ref: "#/components/schemas/MemberEntry" }
+        "400": { $ref: "#/components/responses/Error400" }
+        "401": { $ref: "#/components/responses/Error401" }
+        "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
+        "415": { $ref: "#/components/responses/Error415" }
+        "422": { $ref: "#/components/responses/Error422" }
+        "429": { $ref: "#/components/responses/Error429" }
+        "500": { $ref: "#/components/responses/Error500" }
+  /api/v1/me/entries/{id}:
+    get:
+      operationId: getMyEntry
+      tags: [Member]
+      description: |
+        One of the caller's entries. Front surface only.
+        Errors:
+        - 403 SURFACE_FORBIDDEN: called from the Back or Admin surface.
+        - 403 FORBIDDEN: the entry belongs to someone else (surface-front AC-11; not hidden as 404).
+        - 404 ENTRY_NOT_FOUND: entry missing or soft-deleted, or its type is disabled or has no ownerField.
+      parameters:
+        - $ref: "#/components/parameters/Id"
+      responses:
+        "200":
+          description: The caller's entry
+          content:
+            application/json:
+              schema: { $ref: "#/components/schemas/MemberEntry" }
+        "400": { $ref: "#/components/responses/Error400" }
+        "401": { $ref: "#/components/responses/Error401" }
+        "403": { $ref: "#/components/responses/Error403" }
+        "404": { $ref: "#/components/responses/Error404" }
+        "500": { $ref: "#/components/responses/Error500" }
   /api/v1/media:
     get:
       operationId: listMedia
@@ -2240,6 +2330,42 @@
         publicationState: { $ref: "#/components/schemas/PublicationState" }
         restricted: { type: boolean }
         missing: { type: boolean }
+    MemberEntry:
+      type: object
+      additionalProperties: false
+      required: [id, contentType, publicationState, title, payload, createdAt, updatedAt]
+      description: |
+        The caller's entry (02 §4.5): public fields of the working copy; media-ref values expanded as in
+        PublicEntry (null when not publicly readable).
+      properties:
+        id: { type: string, format: uuid }
+        contentType: { type: string }
+        publicationState: { $ref: "#/components/schemas/PublicationState" }
+        title: { type: string, nullable: true }
+        payload: { $ref: "#/components/schemas/EntryPayload" }
+        createdAt: { type: string, format: date-time }
+        updatedAt: { type: string, format: date-time }
+    MemberEntryPage:
+      type: object
+      additionalProperties: false
+      required: [items, total, page, size, offset, limit]
+      properties:
+        items:
+          type: array
+          items: { $ref: "#/components/schemas/MemberEntry" }
+        total: { type: integer, format: int64 }
+        page: { type: integer, minimum: 1 }
+        size: { type: integer, minimum: 1, maximum: 100 }
+        offset: { type: integer }
+        limit: { type: integer }
+    MemberCreateRequest:
+      type: object
+      required: [payload]
+      properties:
+        payload: { $ref: "#/components/schemas/EntryPayload" }
+        publicationState:
+          type: string
+          description: Must be absent; present is 400 VALIDATION_FAILED.
     WorkEntryPage:
       type: object
       additionalProperties: false
```

T04 之後：`cmp docs/v2/contracts/BW3.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。

---

## 6. 任務卡

大小：S ≤ 150 行、M ≤ 400 行（只算手寫或手改的行；整檔複製算 1 行）。所有指令在 `apps/cms-scaffold` 執行。

### BW3-T01 【測試先行】頻率限制

- **目標**：固定「每分鐘 5 次」。
- **輸入**：BW2 `VERIFIED`。
- **步驟**：建立 §7.1 的 `MeRateLimiterTests.java`。
- **完成條件**：預期紅燈：`src/test` 編譯失敗（`MeRateLimiter` 不存在）。
- **驗證**：`./gradlew :services:cms-api:compileTestJava`（預期失敗）
- **對應 ID**：G-08
- **大小**：S

### BW3-T02 頻率限制與 `RATE_LIMITED`

- **目標**：§5.1。
- **輸入**：T01。
- **步驟**：
  1. 建立 §5.1 的 `MeRateLimiter.java`。
  2. 套用 §5.1 的三段 diff（`ErrorCode`、`ContentException`、`openapi.yaml`）。
- **完成條件**：`MeRateLimiterTests` 綠；`./gradlew :services:cms-api:test` 218 個全綠；`integrationTest` 72 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：G-08
- **大小**：S

### BW3-T03 【測試先行】會員端點

- **目標**：把 §4.2、AC-10～12 寫成 API 測試。
- **輸入**：T02。
- **步驟**：建立 §7.2 的 `MemberApiTests.java`。
- **完成條件**：預期紅燈正好 5 個：本類別全部。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.MemberApiTests'`
- **對應 ID**：G-08、B-11
- **大小**：S

### BW3-T04 會員端點與種子

- **目標**：§4.5、§5.2。
- **輸入**：T03。
- **步驟**：
  1. 建立 §5.2 的 `MeService.java`、`MeController.java`。
  2. 套用 §5.2 的四段 diff（`ContentProjection`、`ContentTypeSeed`、`SeedService`、`openapi.yaml`）。
  3. `cmp docs/v2/contracts/BW3.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`，沒有輸出。
- **完成條件**：`MemberApiTests` 5 個綠；`test` 223 個全綠（其中 `PredicateIndexCheck` 在每個 `@SpringBootTest` 啟動時檢查新的種子）；`integrationTest` 72 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：G-08、B-11、BD-12
- **大小**：M

### BW3-T05 完整閘門、狀態與 PR

- **目標**：交付。
- **輸入**：T04。
- **步驟**：
  1. 執行 §9 的完整閘門。
  2. `docs/v2/README.md` 路線圖中 BW3 的狀態從 `DOC_READY` 改成 `VERIFIED`。
  3. 逐項勾選 §9，貼進 PR 說明。PR 標題：`feat(cms-scaffold): BW3 會員端點`。
- **完成條件**：§9 全部打勾；CI 的 `java`、`java-integration` 全綠；`web` 全綠，或只有 §2.1 所說的失敗並已在 PR 說明。
- **驗證**：§9 的指令。
- **對應 ID**：全部
- **大小**：S

---

## 7. 測試規格

### 7.1 `MeRateLimiterTests`（單元）

以可手動前進的 `Clock`：每 10 秒呼叫一次，共 5 次都通過；第 6 次 429 `RATE_LIMITED`；另一位 principal 不受影響；時間移到第一筆之後 70 秒，同一位又可以呼叫。

`src/test/java/com/fallrising/cms/content/service/MeRateLimiterTests.java`：

```java
package com.fallrising.cms.content.service;

import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.content.ContentException;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MeRateLimiterTests {

    /** A clock the test moves by hand. */
    static final class MovingClock extends Clock {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");

        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    @Test
    void BW3_fifthCallPassesSixthIsRateLimitedUntilTheWindowMoves() {
        MovingClock clock = new MovingClock();
        MeRateLimiter limiter = new MeRateLimiter(clock);
        UUID member = UUID.randomUUID();
        for (int i = 0; i < 5; i++) {
            clock.now = clock.now.plusSeconds(10);
            limiter.acquire(member);
        }
        assertThatThrownBy(() -> limiter.acquire(member))
                .isInstanceOf(ContentException.class)
                .satisfies(e -> assertThat(((ContentException) e).code()).isEqualTo(ErrorCode.RATE_LIMITED));
        assertThatNoException().isThrownBy(() -> limiter.acquire(UUID.randomUUID()));
        clock.now = Instant.parse("2026-01-01T00:01:10Z");
        assertThatNoException().isThrownBy(() -> limiter.acquire(member));
    }
}
```

### 7.2 `MemberApiTests`（MockMvc）

前置資料：demo 種子（`seed-member-clinic` 擁有 `Leo`；`Basil` 屬於別人）。AC-11 與頻率限制使用 `ApiFixture.principalWithRole` 新建的 member（每次執行不同帳號，所以頻率限制不受其他測試影響）。

| 測試 | # | 動作 | 斷言 |
| --- | --- | --- | --- |
| `AC10_membersAreSignedInAndSeeOnlyTheirOwnEntries` | 1 | 未登入列 `pet` | 401 `UNAUTHENTICATED` |
| | 2 | member 列 `pet` | 只有 `Leo`，`payload.name`，`published` |
| | 3 | member 列 `album` | 404 `CONTENT_TYPE_NOT_FOUND` |
| `BW3_meIsFrontOnly` | 1 | member 在 Back 列 `pet` | 403 `SURFACE_FORBIDDEN` |
| `AC12_memberCreatesADraftRequestOwnedByThemselves` | 1 | 以 Leo 建立預約，payload 帶別人的 `ownerPrincipalId` | 201，`draft`，`ownerPrincipalId` 是自己 |
| | 2 | 讀單筆；以 `q` 列預約 | 200；`total` 1 |
| | 3 | body 帶 `publicationState` | 400 `VALIDATION_FAILED` |
| `BW3_requiredFieldsForeignRefsAndTypesWithoutCreateAreRejected` | 1 | 以 Basil 建立 | 422 `REF_TARGET_NOT_FOUND`，`payload.pet` |
| | 2 | 只給 `preferredAt` | 422，`payload.pet`、`payload.reason` 都是 `REQUIRED` |
| | 3 | 建立 `pet` | 403 `FORBIDDEN` |
| `AC11_anotherMembersRequestIsForbiddenAndCreatesAreRateLimited` | 1 | member A 建立一筆；新 member B 讀它 | 403 `FORBIDDEN` |
| | 2 | B 列預約 | `total` 0 |
| | 3 | B 連送 5 次不合法的建立（`preferredAt=tomorrow`），第 6 次 | 前 5 次 422，第 6 次 429 `RATE_LIMITED` |

`src/test/java/com/fallrising/cms/MemberApiTests.java`：

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
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.hamcrest.Matchers.equalTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** G-08: /me endpoints; surface-front AC-10 (sign-in wall), AC-11 (someone else's request), AC-12 (Front command). */
@SpringBootTest
@AutoConfigureMockMvc
class MemberApiTests {

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
    void AC10_membersAreSignedInAndSeeOnlyTheirOwnEntries() throws Exception {
        mockMvc.perform(get("/api/v1/me/content-types/pet/entries").header("Origin", TestSession.FRONT))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
        TestSession member = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.FRONT);
        mockMvc.perform(member.apply(get("/api/v1/me/content-types/pet/entries")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of("Leo"))))
                .andExpect(jsonPath("$.items[0].payload.name").value("Leo"))
                .andExpect(jsonPath("$.items[0].publicationState").value("published"));
        mockMvc.perform(member.apply(get("/api/v1/me/content-types/album/entries")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("CONTENT_TYPE_NOT_FOUND"));
    }

    @Test
    void BW3_meIsFrontOnly() throws Exception {
        TestSession back = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.BACK);
        mockMvc.perform(back.apply(get("/api/v1/me/content-types/pet/entries")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
    }

    @Test
    void AC12_memberCreatesADraftRequestOwnedByThemselves() throws Exception {
        TestSession member = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.FRONT);
        String leo = mine(member, "pet").get(0).get("id").asText();
        String memberId = api.json(mockMvc.perform(member.apply(get("/api/v1/auth/me")))).get("principal").get("id").asText();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("pet", leo);
        payload.put("preferredAt", "2026-10-01T10:00:00+08:00");
        payload.put("reason", "Annual check " + ApiFixture.token("x"));
        payload.put("ownerPrincipalId", UUID.randomUUID().toString());
        JsonNode created = api.json(createRequest(member, Map.of("payload", payload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.publicationState").value("draft"))
                .andExpect(jsonPath("$.payload.ownerPrincipalId").value(memberId)));
        mockMvc.perform(member.apply(get("/api/v1/me/entries/{id}", created.get("id").asText())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value(payload.get("reason")));
        mockMvc.perform(member.apply(get("/api/v1/me/content-types/appointment_request/entries").param("q", (String) payload.get("reason"))))
                .andExpect(jsonPath("$.total").value(1));

        createRequest(member, Map.of("payload", payload, "publicationState", "published"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void BW3_requiredFieldsForeignRefsAndTypesWithoutCreateAreRejected() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-clinic", password, TestSession.BACK);
        JsonNode pets = api.json(mockMvc.perform(op.apply(get("/api/v1/content-types/pet/entries").param("q", "Basil"))));
        String basil = pets.get("items").get(0).get("id").asText();
        TestSession member = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.FRONT);
        createRequest(member, Map.of("payload", Map.of("pet", basil, "preferredAt", "2026-10-01T10:00:00Z", "reason", "Not mine")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("REF_TARGET_NOT_FOUND"))
                .andExpect(jsonPath("$.error.fields[0].field").value("payload.pet"));
        createRequest(member, Map.of("payload", Map.of("preferredAt", "2026-10-01T10:00:00Z")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[*].field").value(equalTo(List.of("payload.pet", "payload.reason"))))
                .andExpect(jsonPath("$.error.fields[0].code").value("REQUIRED"));
        mockMvc.perform(member.apply(post("/api/v1/me/content-types/pet/entries")).contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("payload", Map.of("title", "New pet")))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void AC11_anotherMembersRequestIsForbiddenAndCreatesAreRateLimited() throws Exception {
        TestSession owner = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.FRONT);
        String leo = mine(owner, "pet").get(0).get("id").asText();
        String requestId = api.json(createRequest(owner, Map.of("payload",
                        Map.of("pet", leo, "preferredAt", "2026-11-01T10:00:00Z", "reason", "Owner only")))
                .andExpect(status().isCreated())).get("id").asText();

        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        TestSession other = api.principalWithRole(admin, "member", List.of(), TestSession.FRONT);
        mockMvc.perform(other.apply(get("/api/v1/me/entries/{id}", requestId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        mockMvc.perform(other.apply(get("/api/v1/me/content-types/appointment_request/entries")))
                .andExpect(jsonPath("$.total").value(0));

        Map<String, Object> invalid = Map.of("payload", Map.of("preferredAt", "tomorrow", "reason", "x"));
        for (int i = 0; i < 5; i++) {
            createRequest(other, invalid).andExpect(status().isUnprocessableEntity());
        }
        createRequest(other, invalid)
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error.code").value("RATE_LIMITED"));
    }

    private ResultActions createRequest(TestSession session, Map<String, Object> body) throws Exception {
        return mockMvc.perform(session.apply(post("/api/v1/me/content-types/appointment_request/entries"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)));
    }

    private JsonNode mine(TestSession session, String type) throws Exception {
        return api.json(mockMvc.perform(session.apply(get("/api/v1/me/content-types/{type}/entries", type)))
                .andExpect(status().isOk())).get("items");
    }
}
```

### 7.3 故障注入

`MeRateLimiterTests` 以假的 `Clock` 注入時間；沒有其他故障注入。

---

## 8. 失敗模式對照

| FM ID | 失敗情境 | 期望行為 | 由哪個測試覆蓋 | 任務卡 |
| --- | --- | --- | --- | --- |
| BW3-FM01 | 未登入 | 401 | `AC10_…`（步驟 1） | T03、T04 |
| BW3-FM02 | Back／Admin 呼叫 `/me` | 403 `SURFACE_FORBIDDEN` | `BW3_meIsFrontOnly` | T03、T04 |
| BW3-FM03 | 讀別人的 entry | 403 `FORBIDDEN`，不是 404 | `AC11_…` | T03、T04 |
| BW3-FM04 | 類型沒有 ownerField 或不存在 | 404 `CONTENT_TYPE_NOT_FOUND` | `AC10_…`（album） | T03、T04 |
| BW3-FM05 | 沒有 `create` 權限 | 403 `FORBIDDEN` | `BW3_requiredFields…`（pet） | T03、T04 |
| BW3-FM06 | 客戶端偽造 owner | 伺服器覆蓋成自己 | `AC12_…` | T03、T04 |
| BW3-FM07 | 引用別人的寵物 | 422 `REF_TARGET_NOT_FOUND` | `BW3_requiredFields…` | T03、T04 |
| BW3-FM08 | 要求發布（`publicationState`） | 400 | `AC12_…` | T03、T04 |
| BW3-FM09 | 頻率超過 | 429 `RATE_LIMITED`；多實例時各實例各算（沒有測試：單元測試只有一個實例） | `MeRateLimiterTests`、`AC11_…` | T01～T04 |
| BW3-FM10 | 驗證失敗 | 422 帶 `error.fields`（BW1c） | `BW3_requiredFields…`、`AC11_…` | T03、T04 |
| BW3-FM11 | 資料庫失敗 | 500（不變） | BW0 `ApiExceptionHandlerTests` | — |
| BW3-FM12 | 既有資料庫升級 | 下次啟動時種子補上類型與權限；`PredicateIndexCheck` 通過 | 每個 `@SpringBootTest` 的啟動 | T04 |

---

## 9. 交付檢查表

- [ ] T01～T05 全部完成。
- [ ] `./gradlew test` 全綠（預期 223 個＝BW2 的 217＋本波 6）。
- [ ] `./gradlew integrationTest` 全綠（72 個，本波沒有新增）。
- [ ] `npm ci && npm run lint && npm run typecheck && npm test && npm run build` 全綠；或只有 §2.1 的 codegen 新鮮度／fixture 型別失敗，並已在 PR 說明列出。
- [ ] `cmp docs/v2/contracts/BW3.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。
- [ ] G-08／AC-10～12：`MemberApiTests` 綠。
- [ ] `gradle.lockfile` 沒有變動。
- [ ] 沒有秘密或密碼。
- [ ] `docs/v2/README.md` 的 BW3 狀態已改成 `VERIFIED`。
- [ ] PR 說明列出實際跑過的指令與結果。

---

## 10. BW3 必寫內容索引

| REFINE-PROMPT 要求 | 位置 |
| --- | --- |
| 每個新端點的授權矩陣（角色 × surface × 結果） | §4.3 |
| 審計事件的 `detail_json` 內容 | §4.4 |
